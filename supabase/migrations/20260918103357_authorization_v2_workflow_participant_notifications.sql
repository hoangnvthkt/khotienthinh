create or replace function app_private.enqueue_workflow_notification_event(
  p_instance_id uuid,
  p_event_type text,
  p_actor_id uuid,
  p_event_key text,
  p_payload jsonb default '{}',
  p_recipient_user_ids uuid[] default null
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.workflow_instances%rowtype;
  v_recipients uuid[] := '{}';
  v_current_assignees uuid[] := '{}';
begin
  if exists (select 1 from public.request_instances r where r.workflow_instance_id = p_instance_id)
    or exists (
      select 1 from public.workflow_subjects s
      where s.workflow_instance_id = p_instance_id
        and s.subject_type in ('request', 'project')
    ) then
    return 0;
  end if;

  select * into strict i from public.workflow_instances where id = p_instance_id;

  select coalesce(array_agg(distinct x.value::uuid), '{}') into v_current_assignees
  from (
    select case when jsonb_typeof(i.step_assignees -> i.current_node_id::text) = 'string'
      then i.step_assignees -> i.current_node_id::text #>> '{}' end as value
    union all
    select value
    from jsonb_array_elements_text(
      case when jsonb_typeof(i.step_assignees -> i.current_node_id::text) = 'array'
        then i.step_assignees -> i.current_node_id::text else '[]'::jsonb end
    )
  ) x
  where x.value ~* '^[0-9a-f-]{36}$';

  if p_event_type = 'workflow.mentioned' then
    v_recipients := coalesce(p_recipient_user_ids, '{}');
  elsif p_event_type = 'workflow.step_assigned' then
    v_recipients := coalesce(p_recipient_user_ids, v_current_assignees);
  else
    select coalesce(array_agg(distinct participant_row.user_id), '{}') into v_recipients
    from public.workflow_instance_participants participant_row
    where participant_row.instance_id = i.id
      and participant_row.ended_at is null
      and (
        p_event_type not in (
          'workflow.submitted', 'workflow.step_approved',
          'workflow.revision_requested', 'workflow.reopened'
        )
        or not (participant_row.user_id = any(v_current_assignees))
      );

    if p_event_type in ('workflow.watchers_added', 'workflow.watchers_removed')
      and cardinality(coalesce(p_recipient_user_ids, '{}')) > 0 then
      select coalesce(array_agg(distinct recipient.user_id), '{}') into v_recipients
      from (
        select unnest(coalesce(v_recipients, '{}')) as user_id
        union all
        select unnest(coalesce(p_recipient_user_ids, '{}')) as user_id
      ) recipient;
    end if;
  end if;

  insert into app_private.workflow_notification_outbox(
    event_key, instance_id, event_type, actor_user_id, recipient_user_ids, payload
  ) values (
    p_event_key, p_instance_id, p_event_type, p_actor_id,
    coalesce(v_recipients, '{}'), coalesce(p_payload, '{}') || jsonb_build_object('eventKey', p_event_key)
  ) on conflict(event_key) do nothing;
  return case when found then 1 else 0 end;
end;
$$;

revoke all on function app_private.enqueue_workflow_notification_event(uuid, text, uuid, text, jsonb, uuid[])
  from public, anon, authenticated, service_role;

create or replace function app_private.notify_workflow_instance_comment_mentions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mentions uuid[];
begin
  select coalesce(array_agg((mention_row ->> 'userId')::uuid), '{}') into v_mentions
  from jsonb_array_elements(new.mentions) mention_row
  where (mention_row ->> 'userId') ~* '^[0-9a-f-]{36}$';

  perform app_private.enqueue_workflow_notification_event(
    new.instance_id, 'workflow.commented', new.author_user_id,
    'workflow.comment:' || new.id, jsonb_build_object('commentId', new.id)
  );
  if cardinality(v_mentions) > 0 then
    perform app_private.enqueue_workflow_notification_event(
      new.instance_id, 'workflow.mentioned', new.author_user_id,
      'workflow.mention:' || new.id, jsonb_build_object('commentId', new.id), v_mentions
    );
  end if;
  return new;
end;
$$;

revoke all on function app_private.notify_workflow_instance_comment_mentions()
  from public, anon, authenticated, service_role;

create or replace function app_private.enqueue_workflow_log_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.workflow_instances%rowtype;
  v_event text;
  v_extra uuid[] := '{}';
  v_current jsonb;
begin
  select * into strict i from public.workflow_instances where id = new.instance_id;
  v_current := i.step_assignees -> new.node_id::text;
  select coalesce(array_agg(distinct x.value::uuid), '{}') into v_extra
  from (
    select case when jsonb_typeof(v_current) = 'string' then v_current #>> '{}' end as value
    union all
    select value from jsonb_array_elements_text(
      case when jsonb_typeof(v_current) = 'array' then v_current else '[]'::jsonb end
    )
  ) x
  where x.value ~* '^[0-9a-f-]{36}$';

  v_event := case new.action
    when 'SUBMITTED' then 'workflow.submitted'
    when 'APPROVED' then 'workflow.step_approved'
    when 'REJECTED' then case when i.status = 'CANCELLED' then 'workflow.cancelled' else 'workflow.rejected' end
    when 'REVISION_REQUESTED' then 'workflow.revision_requested'
    when 'REOPENED' then 'workflow.reopened'
    else null
  end;

  if v_event is not null then
    perform app_private.enqueue_workflow_notification_event(
      i.id, v_event, new.acted_by, 'workflow.log:' || new.id,
      jsonb_build_object('nodeId', coalesce(i.current_node_id, new.node_id), 'outgoingNodeId', new.node_id), v_extra
    );
  end if;

  if new.action = 'SUBMITTED' and i.status = 'RUNNING' then
    perform app_private.enqueue_workflow_notification_event(
      i.id, 'workflow.step_assigned', new.acted_by, 'workflow.assigned:' || new.id,
      jsonb_build_object('nodeId', i.current_node_id, 'outgoingNodeId', new.node_id), v_extra
    );
  elsif new.action in ('APPROVED', 'REVISION_REQUESTED')
    and i.status = 'RUNNING'
    and i.current_node_id is distinct from new.node_id then
    perform app_private.enqueue_workflow_notification_event(
      i.id, 'workflow.step_assigned', new.acted_by, 'workflow.assigned:' || new.id,
      jsonb_build_object('nodeId', i.current_node_id, 'outgoingNodeId', new.node_id), v_extra
    );
  elsif new.action = 'REOPENED' and i.status = 'RUNNING' then
    perform app_private.enqueue_workflow_notification_event(
      i.id, 'workflow.step_assigned', new.acted_by, 'workflow.assigned:' || new.id,
      jsonb_build_object('nodeId', i.current_node_id, 'outgoingNodeId', new.node_id), v_extra
    );
  elsif new.action = 'APPROVED' and i.status = 'COMPLETED' then
    perform app_private.enqueue_workflow_notification_event(
      i.id, 'workflow.completed', new.acted_by, 'workflow.completed:' || new.id,
      jsonb_build_object('nodeId', new.node_id)
    );
  end if;
  return new;
end;
$$;

revoke all on function app_private.enqueue_workflow_log_notification()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_enqueue_workflow_log_notification on public.workflow_instance_logs;
create constraint trigger trg_enqueue_workflow_log_notification
after insert on public.workflow_instance_logs
deferrable initially deferred for each row
execute function app_private.enqueue_workflow_log_notification();

create or replace function app_private.workflow_notification_content(p_outbox_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o app_private.workflow_notification_outbox%rowtype;
  i public.workflow_instances%rowtype;
  v_actor text;
  v_action text;
  v_phrase text;
  v_title text;
  v_message text;
begin
  select * into strict o from app_private.workflow_notification_outbox where id = p_outbox_id;
  select * into strict i from public.workflow_instances where id = o.instance_id;
  select regexp_replace(btrim(u.name), '[[:space:]]+', ' ', 'g') into v_actor
  from public.users u where u.id = o.actor_user_id;
  v_actor := coalesce(nullif(v_actor, ''), 'Hệ thống');
  v_title := left(regexp_replace(btrim(i.title), '[[:space:]]+', ' ', 'g'), 140);
  v_action := case o.event_type
    when 'workflow.submitted' then 'Quy trình mới'
    when 'workflow.step_assigned' then 'Bước chờ xử lý'
    when 'workflow.step_approved' then 'Đã duyệt bước'
    when 'workflow.rejected' then 'Đã từ chối'
    when 'workflow.revision_requested' then 'Cần chỉnh sửa'
    when 'workflow.completed' then 'Đã hoàn tất'
    when 'workflow.watchers_added' then 'Được thêm theo dõi'
    when 'workflow.watchers_removed' then 'Đã dừng theo dõi'
    when 'workflow.cancelled' then 'Đã hủy'
    when 'workflow.reopened' then 'Đã mở lại'
    when 'workflow.commented' then 'Bình luận mới'
    when 'workflow.mentioned' then 'Đã nhắc đến bạn'
    when 'workflow.step_due_soon' then 'Sắp đến hạn'
    when 'workflow.step_overdue' then 'Quá hạn'
    else 'Có cập nhật'
  end;
  v_phrase := case o.event_type
    when 'workflow.submitted' then 'đã tạo'
    when 'workflow.step_assigned' then 'đã chuyển bước của'
    when 'workflow.step_approved' then 'đã duyệt một bước của'
    when 'workflow.rejected' then 'đã từ chối'
    when 'workflow.revision_requested' then 'đã yêu cầu chỉnh sửa'
    when 'workflow.completed' then 'đã hoàn tất'
    when 'workflow.watchers_added' then 'đã thêm người theo dõi vào'
    when 'workflow.watchers_removed' then 'đã gỡ người theo dõi khỏi'
    when 'workflow.cancelled' then 'đã hủy'
    when 'workflow.reopened' then 'đã mở lại'
    when 'workflow.commented' then 'đã bình luận trong'
    when 'workflow.mentioned' then 'đã nhắc đến bạn trong'
    else 'đã cập nhật'
  end;
  v_message := case when o.event_type in ('workflow.step_due_soon', 'workflow.step_overdue') then
    v_action || ': “' || v_title || '”'
  else v_actor || ' ' || v_phrase || ' “' || v_title || '”.' end;
  return jsonb_build_object(
    'title', left(i.code || ' · ' || v_action, 100),
    'message', left(v_message, 220),
    'metadata', jsonb_strip_nulls(jsonb_build_object(
      'workflowEventKey', o.event_key,
      'eventType', o.event_type,
      'instanceId', i.id,
      'instanceCode', i.code,
      'instanceTitle', v_title,
      'actorUserId', o.actor_user_id,
      'actorName', case when o.actor_user_id is not null then v_actor end,
      'nodeId', o.payload ->> 'nodeId',
      'commentId', o.payload ->> 'commentId'
    ))
  );
end;
$$;

revoke all on function app_private.workflow_notification_content(uuid)
  from public, anon, authenticated, service_role;

create or replace function app_private.deliver_workflow_notification(p_outbox_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
      and s.subject_type in ('request', 'project')) then
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
$$;

revoke all on function app_private.deliver_workflow_notification(uuid)
  from public, anon, authenticated;
grant execute on function app_private.deliver_workflow_notification(uuid) to service_role;
