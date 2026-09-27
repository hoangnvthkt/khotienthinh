-- P2.1: turn generic Workflow notifications back on (owner decision
-- 27/09/2026). The gate has been off since 18/09, so assignees of generic
-- workflows were never told about new steps.
--   * Material-request workflows are notified by their own module (design
--     2026-09-18 §9). The generic worker only suppressed request/project
--     subjects and marked material-request events "delivered" to nobody;
--     suppress them explicitly instead.
--   * Backlog: keep only step-assigned events whose step is still waiting on
--     a generic workflow; suppress the rest with a reason.
--   * The 14 Request notifications that failed in August (retries exhausted)
--     are closed with a note; they are never retried.

CREATE OR REPLACE FUNCTION app_private.deliver_workflow_notification(p_outbox_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  o app_private.workflow_notification_outbox%rowtype;
  i public.workflow_instances%rowtype;
  v_user uuid;
  v_content jsonb;
  v_link text;
  v_delivery uuid;
  v_notification uuid;
  v_count integer := 0;
begin
  perform app_private.workflow_require_notification_worker();
  select * into o from app_private.workflow_notification_outbox where id = p_outbox_id for update;
  if o.id is null then raise exception 'WORKFLOW_NOTIFICATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if o.status <> 'PROCESSING' then return jsonb_build_object('status', o.status, 'delivered', 0); end if;

  if exists (select 1 from public.request_instances r where r.workflow_instance_id = o.instance_id)
    or exists (select 1 from public.workflow_subjects s where s.workflow_instance_id = o.instance_id
      and s.subject_type in ('request', 'project', 'material_request')) then
    update app_private.workflow_notification_outbox
    set status = 'SUPPRESSED', last_error = 'request_owned', locked_at = null, updated_at = now()
    where id = o.id;
    return jsonb_build_object('status', 'SUPPRESSED', 'delivered', 0);
  end if;

  select * into strict i from public.workflow_instances where id = o.instance_id;
  v_content := app_private.workflow_notification_content(o.id);
  v_link := '/wf/' || i.id::text;
  if nullif(o.payload ->> 'nodeId', '') is not null then
    v_link := v_link || '?node=' || (o.payload ->> 'nodeId');
  end if;
  if nullif(o.payload ->> 'commentId', '') is not null then
    v_link := v_link || case when position('?' in v_link) = 0 then '?' else '&' end
      || 'comment=' || (o.payload ->> 'commentId');
  end if;
  if nullif(o.event_type, '') is not null then
    v_link := v_link || case when position('?' in v_link) = 0 then '?' else '&' end
      || 'event=' || o.event_type;
  end if;

  for v_user in
    select distinct candidate.user_id
    from unnest(o.recipient_user_ids) candidate(user_id)
    join public.users u on u.id = candidate.user_id
      and u.is_active and u.account_status = 'ACTIVE'
    where candidate.user_id is distinct from o.actor_user_id
      and (
        app_private.workflow_instance_user_can_select(i.id, candidate.user_id)
        or (o.event_type = 'workflow.watchers_removed' and candidate.user_id = any(o.recipient_user_ids))
      )
  loop
    insert into app_private.workflow_notification_deliveries(outbox_id, user_id)
    values (o.id, v_user)
    on conflict(outbox_id, user_id) do nothing
    returning id into v_delivery;
    if v_delivery is null then continue; end if;

    insert into public.notifications(
      user_id, title, message, body, type, priority, module, category, severity,
      source_type, source_id, entity_type, entity_id, link, action_url, push_enabled, metadata
    ) values (
      v_user::text, v_content ->> 'title', v_content ->> 'message', v_content ->> 'message',
      'info', 'normal', 'WF', 'workflow', 'info', 'workflow_instance', i.id::text,
      'workflow_instance', i.id, v_link, '/#' || v_link, true, v_content -> 'metadata'
    ) returning id into v_notification;
    update app_private.workflow_notification_deliveries
    set notification_id = v_notification where id = v_delivery;
    v_count := v_count + 1;
  end loop;

  update app_private.workflow_notification_outbox
  set status = 'DELIVERED', delivered_at = now(), locked_at = null, last_error = null, updated_at = now()
  where id = o.id;
  return jsonb_build_object('status', 'DELIVERED', 'delivered', v_count);
end;
$function$;


update app_private.workflow_notification_outbox o
set status = 'SUPPRESSED',
    last_error = case
      when exists (select 1 from public.workflow_subjects s where s.workflow_instance_id = o.instance_id and s.subject_type in ('request', 'project', 'material_request'))
        then 'request_owned'
      else 'p2_stale_backlog'
    end,
    locked_at = null,
    updated_at = now()
where o.status = 'PENDING'
  and not (
    o.event_type = 'workflow.step_assigned'
    and not exists (select 1 from public.workflow_subjects s where s.workflow_instance_id = o.instance_id)
    and exists (
      select 1 from public.workflow_instances i
      where i.id = o.instance_id and i.status::text = 'RUNNING' and i.current_node_id::text = o.payload ->> 'nodeId'
    )
  );

update app_private.request_notification_outbox
set last_error = 'closed_p2_2026_09_27 (owner: not resent): ' || coalesce(last_error, ''),
    updated_at = now()
where status = 'FAILED' and coalesce(last_error, '') not like 'closed_p2_2026_09_27%';

update app_private.workflow_notification_settings set enabled = true where singleton;
