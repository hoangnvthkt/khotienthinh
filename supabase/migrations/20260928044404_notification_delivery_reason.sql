-- Notification targeting, step 1: every notification records why its
-- recipient got it, so the inbox can separate "my work" from updates and
-- alerts. Who receives what does not change here.
--   assigned    → the recipient must act: an approval step waiting for them,
--                 a document submitted to them, work returned to them
--   mentioned   → @mentioned in a discussion, or a chat message to them
--   watching    → updates on something they created, follow or took part in
--   responsible → alerts for the business area they are responsible for
--   system      → global announcements (no recipient)
-- Producers may set delivery_reason themselves; otherwise the insert trigger
-- derives it from the source and, for approvals, from the pending
-- workflow_step_assignments of that person. Existing rows are backfilled the
-- same way (approval state as of today).

alter table public.notifications add column if not exists delivery_reason text;

create or replace function app_private.notification_delivery_reason(
  p_user_id text, p_source_type text, p_source_id text, p_category text, p_title text, p_metadata jsonb
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_event text := coalesce(v_meta ->> 'eventType', v_meta ->> 'event_type', '');
  v_title text := coalesce(p_title, '');
  v_user uuid;
begin
  if p_user_id is null then return 'system'; end if;
  v_user := case when p_user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_user_id::uuid end;

  -- Alerts configured in Settings → Alerts.
  if v_meta ? 'alertKey' then
    return case when v_meta ->> 'alertKey' = 'attendance_reminder' then 'assigned' else 'responsible' end;
  end if;

  if p_source_type in ('workflow_comment_mention', 'chat_v2_message')
     or v_event in ('REQUEST_COMMENT_MENTIONED', 'workflow.mentioned') then
    return 'mentioned';
  end if;

  -- Requests and workflows: assigned while this person holds a pending step.
  if p_source_type in ('request_instance', 'workflow_instance', 'workflow', 'workflow_sla', 'material_request') then
    if p_source_type = 'workflow_sla'
       or v_meta ->> 'submittedToUserId' = p_user_id
       or exists (select 1 from jsonb_array_elements_text(
            case when jsonb_typeof(v_meta -> 'assigneeUserIds') = 'array' then v_meta -> 'assigneeUserIds'
                 when jsonb_typeof(v_meta -> 'assignedUserIds') = 'array' then v_meta -> 'assignedUserIds'
                 else '[]'::jsonb end) assignee where assignee = p_user_id)
       or v_event in ('REQUEST_APPROVAL_REQUIRED', 'REQUEST_RETURNED', 'workflow.step_assigned', 'workflow.reopened') then
      return 'assigned';
    end if;
    if v_user is not null and exists (
      select 1 from public.workflow_step_assignments a
      where a.assignee_user_id = v_user and a.status = 'PENDING'
        and ((p_source_type = 'request_instance' and a.workflow_subject_id = (
                select r.workflow_subject_id from public.request_instances r where r.id::text = p_source_id))
          or (p_source_type in ('workflow_instance', 'workflow')
              and a.workflow_instance_id::text = coalesce(v_meta ->> 'instanceId', p_source_id)))
    ) then
      return 'assigned';
    end if;
    -- Messages sent directly to the step owner by the earlier browser flow.
    if p_source_type = 'workflow' and (v_title ilike '%cần duyệt%' or v_title ilike '%cần xử lý%'
       or v_title ilike '%cần bổ sung%' or v_title ilike '%quay về bước của bạn%') then
      return 'assigned';
    end if;
    return 'watching';
  end if;

  -- Documents submitted to one person for their decision.
  if p_source_type in ('purchase_order', 'purchase_order_delivery_batch', 'quality_checklist', 'quantity_acceptance') then
    return case when v_meta ->> 'submittedToUserId' = p_user_id then 'assigned' else 'watching' end;
  end if;
  if p_source_type in ('dailylog_submitted', 'dailylog_summary_submitted', 'dailylog_rejected', 'gate_pending',
                       'task_assignment', 'task_completion_submitted', 'task_completion_verified',
                       'safety_issue', 'safety_equipment', 'safety_inspection', 'safety_subcontractor') then
    return 'assigned';
  end if;
  if p_source_type = 'vehicle_booking' then
    return case when v_event = 'HANDOVER_ASSIGNED' then 'assigned' else 'watching' end;
  end if;
  if p_source_type = 'feedback' then
    return case when v_title = 'Góp ý mới' then 'responsible' else 'watching' end;
  end if;
  if p_category in ('budget', 'payment', 'material', 'progress', 'safety', 'hrm', 'inventory', 'attendance') and p_source_type in (
       'budget', 'payment', 'material', 'progress', 'safety', 'hrm', 'inventory', 'attendance') then
    return 'responsible';
  end if;
  return 'watching';
end;
$$;

create or replace function app_private.notifications_set_delivery_reason()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.delivery_reason is null then
    new.delivery_reason := app_private.notification_delivery_reason(
      new.user_id::text, new.source_type, new.source_id, new.category, new.title, new.metadata);
  end if;
  return new;
end;
$$;

revoke all on function app_private.notification_delivery_reason(text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function app_private.notifications_set_delivery_reason() from public, anon, authenticated;

drop trigger if exists notifications_set_delivery_reason on public.notifications;
create trigger notifications_set_delivery_reason
  before insert on public.notifications
  for each row execute function app_private.notifications_set_delivery_reason();

update public.notifications n
set delivery_reason = app_private.notification_delivery_reason(
  n.user_id::text, n.source_type, n.source_id, n.category, n.title, n.metadata)
where n.delivery_reason is null;

alter table public.notifications alter column delivery_reason set not null;
alter table public.notifications add constraint notifications_delivery_reason_check
  check (delivery_reason in ('assigned', 'mentioned', 'watching', 'responsible', 'system'));

create index if not exists idx_notifications_user_reason_visible_created_id
  on public.notifications (user_id, delivery_reason, created_at desc, id)
  where user_id is not null and is_dismissed = false;
