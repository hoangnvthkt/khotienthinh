-- Notification targeting, step 2 (events): owner decisions 28/09/2026.
--
-- Requests. The module writes each event for its primary recipient; this
-- fan-out adds the other participants:
--   requester         → every event (unchanged)
--   template watchers → only the outcome (approved / rejected) and overdue
--                       (at most daily); no comments, new requests or steps.
--                       They read 12% of what they received.
--   pending approvers → approval events (unchanged), plus due-soon / overdue
--                       reminders for their step (they were never told) and
--                       new comments on a request they are deciding.
--
-- Safety issues move from the browser to a trigger:
--   new issue          → the assignee; for high / critical issues also the
--                        Safety Room (confirm / approve) and the site command
--   assignee changed   → the new assignee
--   status changed     → the assignee; resolved / closed → the reporter
-- The person who made the change is never notified.

create or replace function app_private.enqueue_request_notification_event(
  p_request_id uuid, p_event_type text, p_actor_id uuid, p_event_key text, p_payload jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare r public.request_instances%rowtype; v_user uuid; v_count integer := 0;
begin
  select * into strict r from public.request_instances where id = p_request_id;
  for v_user in
    select distinct q.user_id from (
      select r.created_by user_id
      union
      select p.user_id from public.workflow_participants p
      where p.workflow_subject_id = r.workflow_subject_id and p.role = 'WATCHER' and p.is_active
        and p_event_type in ('REQUEST_APPROVED', 'REQUEST_REJECTED', 'REQUEST_OVERDUE')
      union
      select a.assignee_user_id from public.workflow_step_assignments a
      where a.workflow_subject_id = r.workflow_subject_id and a.status = 'PENDING'
        and (p_event_type in ('REQUEST_SUBMITTED', 'REQUEST_APPROVAL_REQUIRED', 'REQUEST_STEP_APPROVED',
                              'REQUEST_REASSIGNED', 'REQUEST_RESUBMITTED', 'REQUEST_COMMENT_CREATED')
             or (p_event_type in ('REQUEST_DUE_SOON', 'REQUEST_OVERDUE')
                 and (nullif(p_payload ->> 'nodeId', '') is null or a.node_id::text = p_payload ->> 'nodeId')))
    ) q
    where q.user_id is not null and q.user_id is distinct from p_actor_id
      and q.user_id is distinct from nullif(p_payload ->> 'baseRecipientUserId', '')::uuid
  loop
    insert into app_private.request_notification_outbox(event_key, request_id, recipient_user_id, event_type, payload)
    values (p_event_key || ':participant:' || v_user, p_request_id, v_user, p_event_type,
      jsonb_strip_nulls((coalesce(p_payload, '{}') - 'comment')
        || jsonb_build_object('actorUserId', p_actor_id, 'participantFanout', true)))
    on conflict (event_key) do nothing;
    if found then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end $$;

revoke all on function app_private.enqueue_request_notification_event(uuid, text, uuid, text, jsonb) from public, anon, authenticated;

-- Safety issue notifications. User ids are text columns there; a malformed
-- value must not block saving the issue.
create or replace function app_private.safety_user_ids(variadic p_values text[])
returns uuid[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(value::uuid), '{}'::uuid[])
  from unnest(p_values) value
  where value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$$;

create or replace function app_private.notify_safety_issue_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := coalesce(public.current_app_user_id()::text, case when tg_op = 'INSERT' then new.created_by end);
  v_severity_label text := case new.severity when 'critical' then 'Nghiêm trọng' when 'high' then 'Cao'
                                 when 'medium' then 'Trung bình' else 'Thấp' end;
  v_status_label text := case new.status when 'new' then 'Mới ghi nhận' when 'assigned' then 'Đã giao xử lý'
                                 when 'in_progress' then 'Đang xử lý' when 'waiting_verification' then 'Chờ xác nhận'
                                 when 'resolved' then 'Đã khắc phục' when 'closed' then 'Đã đóng'
                                 when 'rejected' then 'Từ chối' when 'overdue' then 'Quá hạn' else new.status end;
  v_notice_severity text := case when new.severity = 'critical' or new.status = 'overdue' then 'critical'
                                  when new.severity = 'high' then 'warning' else 'info' end;
  v_metadata jsonb := jsonb_build_object('projectId', new.project_id, 'constructionSiteId', new.construction_site_id,
                                         'safetyId', new.id, 'safetyView', 'issues', 'deliveredBy', 'safety_issue_trigger');
  v_title text;
  v_message text;
  v_assigned uuid[] := '{}';
  v_responsible uuid[] := '{}';
  v_watching uuid[] := '{}';
  v_rule public.notification_alert_rules;
begin
  if tg_op = 'INSERT' then
    v_title := v_severity_label || ': ' || coalesce(new.title, 'Sự cố an toàn');
    v_message := coalesce(new.code, 'ATLĐ') || case when new.assigned_to_name is not null
      then ' đã giao cho ' || new.assigned_to_name || '.'
      else ' vừa được ghi nhận tại ' || coalesce(new.area, 'công trường') || '.' end;
    v_assigned := app_private.safety_user_ids(new.assigned_to_user_id);
    if new.severity in ('high', 'critical') and new.project_id is not null then
      select * into v_rule from public.notification_alert_rules where alert_key = 'safety_critical';
      v_rule.recipient_config := coalesce(v_rule.recipient_config, '{}'::jsonb)
        || '{"mode":"project_permission","includeSiteCommand":true,"includeAdmins":false,"fallbackToAdmin":false}'::jsonb;
      v_responsible := app_private.alert_resolve_recipients(v_rule, 'safety', new.project_id, new.construction_site_id);
    end if;
  elsif new.assigned_to_user_id is distinct from old.assigned_to_user_id and new.assigned_to_user_id is not null then
    v_title := 'Bạn được giao xử lý ' || coalesce(new.code, 'sự cố an toàn');
    v_message := coalesce(new.title, 'Sự cố an toàn') || ' (' || v_severity_label || ').';
    v_assigned := app_private.safety_user_ids(new.assigned_to_user_id);
  elsif new.status is distinct from old.status then
    v_title := 'Cập nhật an toàn ' || coalesce(new.code, '');
    v_message := coalesce(new.title, 'Sự cố an toàn') || ' chuyển sang ' || v_status_label || '.';
    v_assigned := app_private.safety_user_ids(new.assigned_to_user_id);
    if new.status in ('resolved', 'closed') then
      v_watching := app_private.safety_user_ids(new.created_by);
    end if;
  else
    return new;
  end if;

  insert into public.notifications (user_id, type, category, title, message, body, severity, icon, link,
    source_type, source_id, construction_site_id, priority, push_enabled, metadata, delivery_reason)
  select recipient.user_id::text,
    case v_notice_severity when 'critical' then 'error' when 'warning' then 'warning' else 'info' end,
    'safety', v_title, v_message, v_message, v_notice_severity, '🛡️', '/da',
    'safety_issue', new.id::text, new.construction_site_id,
    case when v_notice_severity = 'critical' then 'high' else 'normal' end, true, v_metadata, recipient.reason
  from (
    select distinct on (user_id) user_id, reason from (
      select unnest(v_assigned) user_id, 'assigned' reason, 1 rank
      union all select unnest(v_responsible), 'responsible', 2
      union all select unnest(v_watching), 'watching', 3
    ) candidates
    order by user_id, rank
  ) recipient
  join public.users u on u.id = recipient.user_id and u.is_active and u.account_status = 'ACTIVE'
  where recipient.user_id::text is distinct from v_actor;
  return new;
end;
$$;

revoke all on function app_private.safety_user_ids(text[]) from public, anon, authenticated;
revoke all on function app_private.notify_safety_issue_change() from public, anon, authenticated;

drop trigger if exists trg_safety_issue_notify on public.safety_issues;
create trigger trg_safety_issue_notify
  after insert or update of status, assigned_to_user_id on public.safety_issues
  for each row execute function app_private.notify_safety_issue_change();
