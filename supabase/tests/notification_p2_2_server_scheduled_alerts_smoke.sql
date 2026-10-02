-- Run after notification_p2_2_server_scheduled_alerts. Uses synthetic rows
-- and rolls back. Attendance reminders follow each person's shift since
-- 20261008100000; they are tested in notification_attendance_reminder_in_out_smoke.sql.
begin;
create temporary table p22_ctx on commit drop as
select m.project_id, m.construction_site_id::text site_id
from public.project_permission_room_members m
join public.project_permission_room_member_actions a on a.room_member_id = m.id and a.is_active and a.action_code in ('confirm', 'approve')
where m.is_active and m.room_code = 'payment'
limit 1;
create temporary table p22_before on commit drop as select now() - interval '1 second' t;

-- Enable the rules inside this rolled-back test only.
update public.notification_alert_rules set cooldown_minutes = 1440, is_enabled = true
where alert_key in ('overdue_payment', 'stale_daily_log');

-- Overdue payment on a project whose Payment Room has approvers.
insert into public.payment_schedules (id, project_id, construction_site_id, description, amount, due_date, status)
select gen_random_uuid()::text, project_id, site_id, 'P2.2 smoke', 1, '2000-01-01', 'pending' from p22_ctx;

create temporary table p22_run on commit drop as select app_private.run_scheduled_alerts() r;
create temporary table p22_run2 on commit drop as select app_private.run_scheduled_alerts() r;

do $$
declare v_expected uuid[]; v_got uuid[];
begin
  if ((select r from p22_run) ->> 'overdue_payment')::int < 1 then raise exception 'overdue payment not alerted: %', (select r from p22_run); end if;
  -- Second run within the cooldown sends nothing new.
  if ((select r from p22_run2) ->> 'overdue_payment')::int <> 0 then
    raise exception 'cooldown not respected: %', (select r from p22_run2);
  end if;
  -- Payment recipients = Payment Room approvers of that project + Admins.
  select array(select distinct unnest(app_private.alert_room_recipient_ids(project_id, site_id, 'payment', array['confirm','approve']) || app_private.alert_admin_ids()) order by 1)
    into v_expected from p22_ctx;
  select array(select distinct user_id::uuid from public.notifications where created_at >= (select t from p22_before) and metadata ->> 'alertKey' = 'overdue_payment' order by 1)
    into v_got;
  if v_got is distinct from v_expected then raise exception 'payment recipients differ: got % expected %', cardinality(v_got), cardinality(v_expected); end if;
end $$;
rollback;
