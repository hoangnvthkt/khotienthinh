-- Run after 20261024140000_hrm_work_status_events. Rolls back.
begin;
set local statement_timeout = '60s';

-- HR who may edit profiles, a user without HR rights, an active employee E with an old start date,
-- an active employee A without a start date, a resigned employee R without an exit date (if any).
select set_config('test.w.hr_auth', u.auth_id::text, true)
from public.users u where u.is_active and u.auth_id is not null
  and app_private.has_hrm_template_permission(u.id, 'hrm.employee.edit_profile')
  and app_private.has_governed_hrm_permission(u.id, 'hrm.employee.view_directory') order by u.name limit 1;
select set_config('test.w.x_auth', u.auth_id::text, true)
from public.users u where u.is_active and u.auth_id is not null
  and not app_private.has_hrm_template_permission(u.id, 'hrm.employee.edit_profile') order by u.name limit 1;
select set_config('test.w.e_emp', e.id::text, true)
from public.employees e where e.status = 'Đang làm việc' and e.start_date < current_date - 30
  and not exists (select 1 from public.hrm_employee_employment_events ev where ev.employee_id = e.id and ev.event_type_code in ('NGHI_VIEC', 'TIEP_NHAN'))
order by e.employee_code limit 1;
select set_config('test.w.a_emp', e.id::text, true)
from public.employees e where e.status = 'Đang làm việc' and e.start_date is null order by e.employee_code limit 1;
-- A resigned person without a recorded date; create one from a second active employee if prod has none left.
select set_config('test.w.r_emp', coalesce((
  select e.id from public.employees e where e.status = 'Đã nghỉ việc'
    and not exists (select 1 from public.hrm_employee_employment_events ev where ev.employee_id = e.id and ev.event_type_code = 'NGHI_VIEC')
  order by e.employee_code limit 1), (
  select e.id from public.employees e where e.status = 'Đang làm việc' and e.id::text <> current_setting('test.w.e_emp', true)
    and e.id::text <> coalesce(current_setting('test.w.a_emp', true), '') order by e.employee_code desc limit 1))::text, true);
update public.employees set status = 'Đã nghỉ việc', start_date = date '2025-01-06'
where id = current_setting('test.w.r_emp')::uuid;

do $$
begin
  if current_setting('test.w.hr_auth', true) is null or current_setting('test.w.x_auth', true) is null
    or current_setting('test.w.e_emp', true) is null or current_setting('test.w.a_emp', true) is null then
    raise exception 'WORK_STATUS_FIXTURE_MISSING';
  end if;
end;
$$;

create temp table smoke_expect_error(label text, expected text, got text) on commit drop;
grant select, insert on smoke_expect_error to authenticated;

-- ── Without HR rights: refused ──
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.w.x_auth'))::text, true);
set local role authenticated;
do $$
begin
  perform public.set_hrm_employee_work_status(current_setting('test.w.e_emp')::uuid, 'Đã nghỉ việc',
    current_date - 1, 'Tự xin nghỉ', null, 'Smoke nghỉ việc không quyền');
  raise exception 'WORK_STATUS_NON_HR_ALLOWED';
exception when insufficient_privilege then null;
end;
$$;
do $$
begin
  perform public.set_hrm_employee_start_date(current_setting('test.w.a_emp')::uuid, current_date - 100, 'Smoke ngày vào không quyền');
  raise exception 'START_DATE_NON_HR_ALLOWED';
exception when insufficient_privilege then null;
end;
$$;
reset role;

-- ── HR ──
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.w.hr_auth'))::text, true);
set local role authenticated;

-- Refusals, each with the expected code.
do $$
declare
  v_e uuid := current_setting('test.w.e_emp')::uuid;
  v_start date;
  v_cases text[][] := array[
    array['form without date', 'HRM_WORK_STATUS_DATE_REQUIRED'],
    array['future date', 'HRM_WORK_STATUS_DATE_IN_FUTURE'],
    array['before start', 'HRM_WORK_STATUS_DATE_BEFORE_START'],
    array['no reason', 'HRM_WORK_STATUS_NOTE_REQUIRED'],
    array['already active', 'HRM_WORK_STATUS_UNCHANGED'],
    array['old archive button', 'HRM_WORK_STATUS_DATE_REQUIRED'],
    array['create resigned', 'HRM_WORK_STATUS_CREATE_ACTIVE_ONLY'],
    array['start date set', 'HRM_START_DATE_ALREADY_SET'],
    array['start in future', 'HRM_WORK_STATUS_DATE_IN_FUTURE']
  ];
  v_i integer;
begin
  select e.start_date into v_start from public.list_hrm_employee_directory() d
    cross join lateral (select (d_item ->> 'start_date')::date start_date from jsonb_array_elements(d) d_item where d_item ->> 'id' = v_e::text) e;
  for v_i in 1 .. array_length(v_cases, 1) loop
    begin
      case v_i
        when 1 then perform public.update_hrm_employee_core_profile(v_e, 'Smoke', null, null, null, null, v_start, null,
          'Đã nghỉ việc', null, null, null, null, null, null, null, 'Smoke đổi trạng thái không ngày');
        when 2 then perform public.set_hrm_employee_work_status(v_e, 'Đã nghỉ việc', (now() at time zone 'Asia/Ho_Chi_Minh')::date + 1, 'Tự xin nghỉ', null, 'Smoke nghỉ ngày tương lai');
        when 3 then perform public.set_hrm_employee_work_status(v_e, 'Đã nghỉ việc', v_start - 1, 'Tự xin nghỉ', null, 'Smoke nghỉ trước ngày vào');
        when 4 then perform public.set_hrm_employee_work_status(v_e, 'Đã nghỉ việc', current_date - 1, ' ', null, 'Smoke nghỉ không lý do');
        when 5 then perform public.set_hrm_employee_work_status(v_e, 'Đang làm việc', current_date - 1, 'Đi làm lại', null, 'Smoke đi làm lại khi đang làm');
        when 6 then perform public.archive_hrm_employee(v_e, 'Smoke nút lưu nghỉ việc cũ');
        when 7 then perform public.create_hrm_employee_core(null, null, 'Smoke Người Nghỉ', null, null, null, null, null, null,
          'Đã nghỉ việc', null, null, null, null, null, null, null, 'Smoke tạo người đã nghỉ');
        when 8 then perform public.set_hrm_employee_start_date(v_e, current_date - 100, 'Smoke ghi đè ngày vào');
        when 9 then perform public.set_hrm_employee_start_date(current_setting('test.w.a_emp')::uuid, (now() at time zone 'Asia/Ho_Chi_Minh')::date + 1, 'Smoke ngày vào tương lai');
      end case;
      insert into smoke_expect_error values (v_cases[v_i][1], v_cases[v_i][2], 'NO ERROR');
    exception when others then
      insert into smoke_expect_error values (v_cases[v_i][1], v_cases[v_i][2], sqlerrm);
    end;
  end loop;
end;
$$;

do $$
declare v_bad text;
begin
  select string_agg(label || ': ' || got, '; ') into v_bad from smoke_expect_error where got <> expected;
  if v_bad is not null then raise exception 'WORK_STATUS_REFUSALS %', v_bad; end if;
end;
$$;

-- Form: resign with date + reason in one call; the old 17-argument call (Excel import) still works.
do $$
declare
  v_e uuid := current_setting('test.w.e_emp')::uuid;
  v_row jsonb;
  v_exit date := (now() at time zone 'Asia/Ho_Chi_Minh')::date - 2;
begin
  select d_item into v_row from jsonb_array_elements(public.list_hrm_employee_directory()) d_item where d_item ->> 'id' = v_e::text;
  perform public.update_hrm_employee_core_profile(v_e, v_row ->> 'full_name', v_row ->> 'gender', v_row ->> 'phone', v_row ->> 'email',
    (v_row ->> 'date_of_birth')::date, (v_row ->> 'start_date')::date, (v_row ->> 'official_date')::date,
    'Đang làm việc', (v_row ->> 'user_id')::uuid, (v_row ->> 'area_id')::uuid, (v_row ->> 'office_id')::uuid,
    (v_row ->> 'employee_type_id')::uuid, (v_row ->> 'work_schedule_id')::uuid, v_row ->> 'marital_status', v_row ->> 'avatar_url',
    'Smoke lưu hồ sơ không đổi trạng thái');
  perform public.update_hrm_employee_core_profile(v_e, v_row ->> 'full_name', v_row ->> 'gender', v_row ->> 'phone', v_row ->> 'email',
    (v_row ->> 'date_of_birth')::date, (v_row ->> 'start_date')::date, (v_row ->> 'official_date')::date,
    'Đã nghỉ việc', (v_row ->> 'user_id')::uuid, (v_row ->> 'area_id')::uuid, (v_row ->> 'office_id')::uuid,
    (v_row ->> 'employee_type_id')::uuid, (v_row ->> 'work_schedule_id')::uuid, v_row ->> 'marital_status', v_row ->> 'avatar_url',
    'Smoke nghỉ việc từ form hồ sơ', v_exit, 'Tự xin nghỉ', 'QĐ 01/2026/QĐ-TT');
  select d_item into v_row from jsonb_array_elements(public.list_hrm_employee_directory()) d_item where d_item ->> 'id' = v_e::text;
  if v_row ->> 'status' <> 'Đã nghỉ việc' or (v_row ->> 'exit_date')::date is distinct from v_exit then
    raise exception 'WORK_STATUS_FORM_RESIGN %', v_row;
  end if;

  -- Correction keeps one exit record.
  perform public.set_hrm_employee_work_status(v_e, 'Đã nghỉ việc', v_exit + 1, 'Hết hợp đồng', null, 'Smoke sửa ngày nghỉ việc');
  select d_item into v_row from jsonb_array_elements(public.list_hrm_employee_directory()) d_item where d_item ->> 'id' = v_e::text;
  if (v_row ->> 'exit_date')::date is distinct from v_exit + 1 then raise exception 'WORK_STATUS_CORRECTION %', v_row; end if;

  -- Return: not on/before the exit date; then today, history kept.
  begin
    perform public.set_hrm_employee_work_status(v_e, 'Đang làm việc', v_exit + 1, 'Đi làm lại', null, 'Smoke đi làm lại cùng ngày nghỉ');
    raise exception 'WORK_STATUS_RETURN_ON_EXIT_ALLOWED';
  exception when others then
    if sqlerrm <> 'HRM_WORK_STATUS_DATE_BEFORE_EXIT' then raise; end if;
  end;
  perform public.set_hrm_employee_work_status(v_e, 'Đang làm việc', v_exit + 2, 'Quay lại làm việc', null, 'Smoke đi làm lại sau nghỉ');
  select d_item into v_row from jsonb_array_elements(public.list_hrm_employee_directory()) d_item where d_item ->> 'id' = v_e::text;
  if v_row ->> 'status' <> 'Đang làm việc' or v_row -> 'exit_date' <> 'null'::jsonb then raise exception 'WORK_STATUS_RETURN %', v_row; end if;

  -- Resign again after return: a new record, not before the return date.
  begin
    perform public.set_hrm_employee_work_status(v_e, 'Đã nghỉ việc', v_exit + 1, 'Tự xin nghỉ', null, 'Smoke nghỉ lại trước ngày đi làm lại');
    raise exception 'WORK_STATUS_RESIGN_BEFORE_RETURN_ALLOWED';
  exception when others then
    if sqlerrm <> 'HRM_WORK_STATUS_DATE_BEFORE_START' then raise; end if;
  end;
end;
$$;

-- Resigned without a date: fill it in, status stays; start date must not be after the exit.
do $$
declare
  v_r uuid := current_setting('test.w.r_emp')::uuid;
  v_a uuid := current_setting('test.w.a_emp')::uuid;
  v_row jsonb;
  v_result jsonb;
begin
  v_result := public.set_hrm_employee_work_status(v_r, 'Đã nghỉ việc', date '2026-03-31', 'Tự xin nghỉ', null, 'Smoke bổ sung ngày nghỉ việc');
  if v_result ->> 'eventType' <> 'NGHI_VIEC' or (v_result ->> 'exitDate')::date <> date '2026-03-31' then raise exception 'WORK_STATUS_FILL %', v_result; end if;
  select d_item into v_row from jsonb_array_elements(public.list_hrm_employee_directory()) d_item where d_item ->> 'id' = v_r::text;
  if v_row ->> 'status' <> 'Đã nghỉ việc' or (v_row ->> 'exit_date')::date <> date '2026-03-31' then raise exception 'WORK_STATUS_FILL_DIR %', v_row; end if;

  v_result := public.set_hrm_employee_start_date(v_a, current_date - 200, 'Smoke bổ sung ngày vào làm');
  select d_item into v_row from jsonb_array_elements(public.list_hrm_employee_directory()) d_item where d_item ->> 'id' = v_a::text;
  if (v_row ->> 'start_date')::date <> current_date - 200 then raise exception 'START_DATE_FILL %', v_row; end if;
end;
$$;
reset role;

-- Records and audit, read as admin.
do $$
declare
  v_e uuid := current_setting('test.w.e_emp')::uuid;
  v_r uuid := current_setting('test.w.r_emp')::uuid;
  v_exits integer;
  v_returns integer;
  v_audit integer;
begin
  select count(*) filter (where event_type_code = 'NGHI_VIEC'), count(*) filter (where event_type_code = 'TIEP_NHAN')
    into v_exits, v_returns from public.hrm_employee_employment_events where employee_id = v_e and status = 'ACTIVE';
  if v_exits <> 1 or v_returns <> 1 then raise exception 'WORK_STATUS_EVENTS exits=% returns=%', v_exits, v_returns; end if;
  if not exists (select 1 from public.hrm_employee_employment_events where employee_id = v_e and event_type_code = 'NGHI_VIEC'
    and source_reference = 'QĐ 01/2026/QĐ-TT' and reason = 'Hết hợp đồng') then
    raise exception 'WORK_STATUS_EVENT_FIELDS';
  end if;
  select count(*) into v_audit from public.audit_trail
  where entity_type = 'HRM_EMPLOYMENT_EVENT' and record_label in (v_e::text, v_r::text) and created_at >= now() - interval '1 minute';
  if v_audit < 4 then raise exception 'WORK_STATUS_AUDIT %', v_audit; end if;
  if has_function_privilege('anon', 'public.set_hrm_employee_work_status(uuid, text, date, text, text, text)', 'execute')
    or has_function_privilege('anon', 'public.set_hrm_employee_start_date(uuid, date, text)', 'execute')
    or has_function_privilege('authenticated', 'app_private.hrm_apply_work_status(uuid, text, date, text, text, text)', 'execute') then
    raise exception 'WORK_STATUS_GRANTS';
  end if;
end;
$$;

select 'hrm_work_status_events_smoke ok' as result;
rollback;
