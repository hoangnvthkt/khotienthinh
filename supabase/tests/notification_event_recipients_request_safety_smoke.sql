-- Run after notification_event_recipients_request_safety. Rolls back.
begin;
-- Request with a pending approver and a watcher who is neither.
create temporary table ner_req on commit drop as
select r.id request_id, r.created_by requester, a.assignee_user_id approver, a.node_id::text node_id, w.user_id watcher
from public.request_instances r
join public.workflow_step_assignments a on a.workflow_subject_id = r.workflow_subject_id and a.status = 'PENDING'
join public.workflow_participants w on w.workflow_subject_id = r.workflow_subject_id and w.role = 'WATCHER' and w.is_active
where w.user_id not in (r.created_by, a.assignee_user_id) and r.created_by <> a.assignee_user_id
  -- an approver who also watches the request rightly gets the final result; pick one who does not
  and not exists (select 1 from public.workflow_participants w2 where w2.workflow_subject_id = r.workflow_subject_id
                  and w2.user_id = a.assignee_user_id and w2.role = 'WATCHER' and w2.is_active)
limit 1;

select app_private.enqueue_request_notification_event(request_id, e.event_type, null, 'ner-smoke-' || e.event_type,
  case when e.event_type = 'REQUEST_OVERDUE' then jsonb_build_object('nodeId', node_id) else '{}'::jsonb end)
from ner_req, (values ('REQUEST_COMMENT_CREATED'), ('REQUEST_OVERDUE'), ('REQUEST_APPROVED'), ('REQUEST_STEP_APPROVED')) e(event_type);

do $$
declare c record;
  function_result text;
begin
  select * into c from ner_req;
  if c.request_id is null then raise exception 'no request with approver and watcher to test'; end if;
  -- expected[event] = {requester, watcher, approver}
  for function_result in
    select format('%s|%s|%s|%s', e.event_type,
      exists (select 1 from app_private.request_notification_outbox o where o.event_key like 'ner-smoke-' || e.event_type || ':%' and o.recipient_user_id = c.requester),
      exists (select 1 from app_private.request_notification_outbox o where o.event_key like 'ner-smoke-' || e.event_type || ':%' and o.recipient_user_id = c.watcher),
      exists (select 1 from app_private.request_notification_outbox o where o.event_key like 'ner-smoke-' || e.event_type || ':%' and o.recipient_user_id = c.approver))
    from (values ('REQUEST_COMMENT_CREATED'), ('REQUEST_OVERDUE'), ('REQUEST_APPROVED'), ('REQUEST_STEP_APPROVED')) e(event_type)
  loop
    if function_result not in (
      'REQUEST_COMMENT_CREATED|t|f|t',
      'REQUEST_OVERDUE|t|t|t',
      'REQUEST_APPROVED|t|t|f',
      'REQUEST_STEP_APPROVED|t|f|t') then
      raise exception 'request fan-out wrong: %', function_result;
    end if;
  end loop;
end $$;

-- Safety: a project whose Safety Room and site command both have people.
create temporary table ner_safety on commit drop as
select s.project_id,
  (select u.id::text from public.users u where u.is_active and u.account_status = 'ACTIVE' and u.auth_id is not null
     and u.id <> all(app_private.alert_room_recipient_ids(s.project_id, null, 'safety', array['confirm','approve'])
                     || app_private.alert_site_command_ids(s.project_id, null)) limit 1) reporter,
  (select u.id::text from public.users u where u.is_active and u.account_status = 'ACTIVE' and u.auth_id is not null
     and u.id <> all(app_private.alert_room_recipient_ids(s.project_id, null, 'safety', array['confirm','approve'])
                     || app_private.alert_site_command_ids(s.project_id, null)) offset 1 limit 1) assignee
from (select distinct project_id from public.project_staff where end_date is null and project_id is not null) s
where cardinality(app_private.alert_site_command_ids(s.project_id, null)) > 0
  and cardinality(app_private.alert_room_recipient_ids(s.project_id, null, 'safety', array['confirm','approve'])) > 0
limit 1;
create temporary table ner_before on commit drop as select now() t;

insert into public.safety_issues (project_id, code, title, severity, status, area, assigned_to_user_id, assigned_to_name, created_by)
select project_id, 'NER-HIGH', 'Smoke high', 'high', 'assigned', 'Khu A', assignee, 'Smoke', reporter from ner_safety
union all
select project_id, 'NER-LOW', 'Smoke low', 'low', 'assigned', 'Khu A', assignee, 'Smoke', reporter from ner_safety;
-- The Room status guard needs a signed-in verifier; this test checks notices only.
alter table public.safety_issues disable trigger authorization_v2_safety_issue_status_guard;
update public.safety_issues set status = 'resolved', resolved_at = now() where code = 'NER-LOW';
alter table public.safety_issues enable trigger authorization_v2_safety_issue_status_guard;

do $$
declare c record; v_high uuid[]; v_expected uuid[]; v_low_new int; v_low_resolved jsonb;
begin
  select * into c from ner_safety;
  if c.project_id is null then raise exception 'no project with Safety Room and site command'; end if;
  select array(select n.user_id::uuid from public.notifications n join public.safety_issues i on i.id::text = n.source_id
               where i.code = 'NER-HIGH' order by 1) into v_high;
  v_expected := array(select distinct x from unnest(
      array[c.assignee::uuid]
      || app_private.alert_room_recipient_ids(c.project_id, null, 'safety', array['confirm','approve'])
      || app_private.alert_site_command_ids(c.project_id, null)) x
    where x::text <> c.reporter order by 1);
  if v_high is distinct from v_expected then raise exception 'high issue recipients differ: got % expected %', cardinality(v_high), cardinality(v_expected); end if;
  if (select delivery_reason from public.notifications n join public.safety_issues i on i.id::text = n.source_id
      where i.code = 'NER-HIGH' and n.user_id = c.assignee) <> 'assigned' then raise exception 'assignee reason wrong'; end if;
  if exists (select 1 from public.notifications n join public.safety_issues i on i.id::text = n.source_id
             where i.code = 'NER-HIGH' and n.user_id <> c.assignee and n.delivery_reason <> 'responsible') then
    raise exception 'room / site command reason wrong';
  end if;

  select count(*) into v_low_new from public.notifications n join public.safety_issues i on i.id::text = n.source_id
  where i.code = 'NER-LOW' and n.title like 'Thấp:%';
  if v_low_new <> 1 then raise exception 'low issue should reach only the assignee, got %', v_low_new; end if;
  select jsonb_object_agg(n.user_id, n.delivery_reason) into v_low_resolved from public.notifications n
  join public.safety_issues i on i.id::text = n.source_id where i.code = 'NER-LOW' and n.title like 'Cập nhật an toàn%';
  if v_low_resolved <> jsonb_build_object(c.assignee, 'assigned', c.reporter, 'watching') then
    raise exception 'resolved issue recipients wrong: %', v_low_resolved;
  end if;
end $$;
rollback;
