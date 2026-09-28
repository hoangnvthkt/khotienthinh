-- Run after notification_delivery_reason. Synthetic rows; rolls back.
begin;
create temporary table ndr_ctx on commit drop as
select r.id::text request_id, a.assignee_user_id::text approver_id, r.created_by::text requester_id,
  u.auth_id approver_auth_id, u.email approver_email
from public.workflow_step_assignments a
join public.request_instances r on r.workflow_subject_id = a.workflow_subject_id
join public.users u on u.id = a.assignee_user_id and u.auth_id is not null
where a.status = 'PENDING' and r.created_by is not null and r.created_by <> a.assignee_user_id
limit 1;

insert into public.notifications (user_id, type, category, title, message, severity, source_type, source_id, metadata)
select approver_id, 'info', 'request', 'ndr approver', 'x', 'info', 'request_instance', request_id, '{"eventType":"REQUEST_OVERDUE"}'::jsonb from ndr_ctx
union all
select requester_id, 'info', 'request', 'ndr requester', 'x', 'info', 'request_instance', request_id, '{"eventType":"REQUEST_OVERDUE"}'::jsonb from ndr_ctx
union all
select requester_id, 'info', 'request', 'ndr mention', 'x', 'info', 'request_instance', request_id, '{"eventType":"REQUEST_COMMENT_MENTIONED"}'::jsonb from ndr_ctx
union all
select approver_id, 'warning', 'safety', 'ndr alert', 'x', 'warning', 'safety', 'ndr', '{"alertKey":"safety_critical"}'::jsonb from ndr_ctx
union all
select null, 'info', 'system', 'ndr broadcast', 'x', 'info', 'system', 'ndr', '{}'::jsonb from ndr_ctx;
insert into public.notifications (user_id, type, category, title, message, severity, source_type, source_id, metadata, delivery_reason)
select requester_id, 'info', 'request', 'ndr explicit', 'x', 'info', 'request_instance', request_id, '{}'::jsonb, 'responsible' from ndr_ctx;

do $$
declare v_got jsonb; v_expected jsonb := '{"ndr alert":"responsible","ndr mention":"mentioned","ndr approver":"assigned","ndr explicit":"responsible","ndr broadcast":"system","ndr requester":"watching"}';
begin
  if not exists (select 1 from ndr_ctx) then raise exception 'no pending request approval to test with'; end if;
  select jsonb_object_agg(title, delivery_reason) into v_got from public.notifications where title like 'ndr %';
  if v_got <> v_expected then raise exception 'reasons differ: %', v_got; end if;
  if exists (select 1 from public.notifications where delivery_reason is null) then raise exception 'rows without reason'; end if;
  begin
    insert into public.notifications (user_id, type, category, title, message, severity, delivery_reason)
    values (null, 'info', 'system', 'ndr bad', 'x', 'info', 'bogus');
    raise exception 'invalid reason accepted';
  exception when check_violation then null;
  end;
end $$;

-- The recipient reads the reason of their own notification.
select set_config('request.jwt.claims', jsonb_build_object('sub', approver_auth_id, 'email', approver_email, 'role', 'authenticated')::text, true) from ndr_ctx;
set local role authenticated;
do $$
begin
  if coalesce((select delivery_reason from public.notifications where title = 'ndr approver'), '') <> 'assigned' then
    raise exception 'recipient cannot read delivery_reason';
  end if;
end $$;
rollback;
