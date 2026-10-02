-- Smoke: attendance reminders 10 minutes before each person's shift starts and ends.
-- Runs inside a transaction that is rolled back; push delivery is switched off for the run.
begin;

update public.notification_alert_rules
set is_enabled = true, channels = channels || '{"webPush": false}'::jsonb
where alert_key = 'attendance_reminder';

create temp table att_fx on commit drop as
with fx_day as (
  -- the next Monday–Wednesday with no holiday on it or the two days after
  select d::date as day from generate_series(current_date + 1, current_date + 30, interval '1 day') d
  where extract(isodow from d) between 1 and 3
    and not exists (select 1 from public.hrm_holidays h where h.date between d::date and d::date + 2)
  order by d limit 1
),
people as (
  select e.id, row_number() over (order by e.id) n
  from public.employees e, fx_day
  where e.status = 'Đang làm việc' and e.user_id is not null
    and not exists (select 1 from public.hrm_leave_requests lr where lr."employeeId" = e.id and lr.status = 'approved'
                    and fx_day.day + 2 >= lr."startDate"::date and fx_day.day <= lr."endDate"::date)
  limit 2
)
select fx_day.day as day,
  (select id from people where n = 1) e1,
  (select id from people where n = 2) e2,
  (select id from public.hrm_shift_types where start_time = time '08:00' and end_time = time '17:00' limit 1) day_shift,
  (select id from public.hrm_shift_types where start_time = time '22:00' and end_time = time '06:00' limit 1) night_shift
from fx_day;

-- e1 and e2: 08:00–17:00 on day; e1: night shift on day + 1.
insert into public.hrm_employee_shifts (employee_id, shift_type_id, shift_date)
select e1, day_shift, day from att_fx union all
select e2, day_shift, day from att_fx union all
select e1, night_shift, day + 1 from att_fx;

create temp table att_runs (step text, sent integer) on commit drop;

do $smoke$
declare
  f att_fx;
  v_rule public.notification_alert_rules;
  v_count integer;
begin
  select * into f from att_fx;
  if f.e1 is null or f.e2 is null or f.day_shift is null or f.night_shift is null then
    raise exception 'fixture missing: %', row_to_json(f);
  end if;
  select * into v_rule from public.notification_alert_rules where alert_key = 'attendance_reminder';
  if (v_rule.thresholds ->> 'minutesBefore')::int <> 10 then raise exception 'lead time is not 10 minutes'; end if;

  -- Outside the window: nothing for e1.
  perform app_private.alert_attendance_reminders(v_rule, f.day + time '07:49');
  if exists (select 1 from public.notifications where source_id = 'attendance_in_' || f.e1 || '_' || f.day) then
    raise exception 'check-in reminder sent 11 minutes early';
  end if;

  -- 10 minutes before the shift: one check-in reminder each, not repeated 5 minutes later.
  perform app_private.alert_attendance_reminders(v_rule, f.day + time '07:50');
  perform app_private.alert_attendance_reminders(v_rule, f.day + time '07:55');
  select count(*) into v_count from public.notifications
  where source_id in ('attendance_in_' || f.e1 || '_' || f.day, 'attendance_in_' || f.e2 || '_' || f.day);
  if v_count <> 2 then raise exception 'expected 2 check-in reminders, got %', v_count; end if;
  if not exists (select 1 from public.notifications n join public.employees e on e.user_id::text = n.user_id
                 where n.source_id = 'attendance_in_' || f.e1 || '_' || f.day and e.id = f.e1
                   and n.message like 'Còn 10 phút nữa đến giờ vào ca (08:00)%' and n.push_enabled = false
                   and n.delivery_reason = 'assigned') then
    raise exception 'check-in reminder has the wrong person, text or reason';
  end if;

  -- Already checked in: no check-in reminder.
  insert into public.hrm_attendance ("employeeId", date, "checkIn") values (f.e1, (f.day + 1)::text, '21:55');
  -- e1 checked in on day, e2 did not: only e1 is reminded to check out.
  insert into public.hrm_attendance ("employeeId", date, "checkIn") values (f.e1, f.day::text, '07:58');
  perform app_private.alert_attendance_reminders(v_rule, f.day + time '16:50');
  if not exists (select 1 from public.notifications where source_id = 'attendance_out_' || f.e1 || '_' || f.day
                 and message like 'Còn 10 phút nữa hết ca (17:00)%') then
    raise exception 'check-out reminder missing';
  end if;
  if exists (select 1 from public.notifications where source_id = 'attendance_out_' || f.e2 || '_' || f.day) then
    raise exception 'check-out reminder sent to someone who never checked in';
  end if;

  -- Night shift (22:00–06:00): already checked in → no check-in reminder; check-out reminder next morning.
  perform app_private.alert_attendance_reminders(v_rule, f.day + 1 + time '21:50');
  if exists (select 1 from public.notifications where source_id = 'attendance_in_' || f.e1 || '_' || (f.day + 1)) then
    raise exception 'check-in reminder sent after checking in';
  end if;
  perform app_private.alert_attendance_reminders(v_rule, f.day + 2 + time '05:51');
  if not exists (select 1 from public.notifications where source_id = 'attendance_out_' || f.e1 || '_' || (f.day + 1)
                 and message like 'Còn 9 phút nữa hết ca (06:00)%') then
    raise exception 'night-shift check-out reminder missing';
  end if;

  -- Sundays have no shift.
  if exists (select 1 from app_private.attendance_shift_of_day(f.e2, f.day + (7 - extract(isodow from f.day))::int)) then
    raise exception 'Sunday treated as a workday';
  end if;

  -- The scheduler still reports the rule.
  if not (app_private.run_scheduled_alerts() ? 'attendance_reminder') then
    raise exception 'run_scheduled_alerts no longer runs the attendance reminder';
  end if;
end;
$smoke$;

select jsonb_build_object('ok', true) r;
rollback;
