-- Rollback for notification_event_recipients_request_safety: restores the
-- previous request fan-out (requester + watchers on every event, approvers on
-- approval events) and removes the safety issue trigger. Roll the frontend
-- back too, so the browser notifies safety assignees again.
begin;
create or replace function app_private.enqueue_request_notification_event(
  p_request_id uuid, p_event_type text, p_actor_id uuid, p_event_key text, p_payload jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare r public.request_instances%rowtype; v_user uuid; v_count integer:=0;
begin
  select * into strict r from public.request_instances where id=p_request_id;
  for v_user in
    select distinct q.user_id from(
      select r.created_by user_id
      union select p.user_id from public.workflow_participants p
        where p.workflow_subject_id=r.workflow_subject_id and p.role='WATCHER' and p.is_active
      union select a.assignee_user_id from public.workflow_step_assignments a
        where a.workflow_subject_id=r.workflow_subject_id and a.status='PENDING'
          and p_event_type in('REQUEST_SUBMITTED','REQUEST_APPROVAL_REQUIRED','REQUEST_STEP_APPROVED','REQUEST_REASSIGNED','REQUEST_RESUBMITTED')
    )q where q.user_id is not null and q.user_id is distinct from p_actor_id
      and q.user_id is distinct from nullif(p_payload->>'baseRecipientUserId','')::uuid
  loop
    insert into app_private.request_notification_outbox(event_key,request_id,recipient_user_id,event_type,payload)
    values(p_event_key||':participant:'||v_user,p_request_id,v_user,p_event_type,
      jsonb_strip_nulls((coalesce(p_payload,'{}')-'comment')||jsonb_build_object('actorUserId',p_actor_id,'participantFanout',true)))
    on conflict(event_key) do nothing;
    if found then v_count:=v_count+1; end if;
  end loop;
  return v_count;
end $$;
revoke all on function app_private.enqueue_request_notification_event(uuid, text, uuid, text, jsonb) from public, anon, authenticated;
drop trigger if exists trg_safety_issue_notify on public.safety_issues;
drop function if exists app_private.notify_safety_issue_change();
drop function if exists app_private.safety_user_ids(text[]);
commit;
