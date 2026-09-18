-- Workflow lifecycle actions approved in the Task 12.4.2 owner decision pack.
-- Draft actions are catalogued but remain non-grantable until a real draft
-- lifecycle exists. Cancel/reopen/administer are enforced by command guards.
insert into public.permission_actions (
  module_code, action, permission_code, label, description, scope_modes,
  legacy_module_key, legacy_route, legacy_admin_only, sort_order, is_active,
  risk_level, is_business_action, is_business_approval,
  direct_grant_requires_expiry, grant_readiness, access_application_code,
  direct_grant_allowed
)
values
  (
    'workflow.instance', 'edit_own_draft',
    'workflow.instance.edit_own_draft', 'Sửa bản nháp của mình',
    'Sửa phiên quy trình do chính người dùng tạo khi phiên còn ở trạng thái bản nháp.',
    array['own']::text[], 'WF', '/wf', true, 40, true,
    'normal', true, false, false, 'declared', 'workflow', false
  ),
  (
    'workflow.instance', 'delete_own_draft',
    'workflow.instance.delete_own_draft', 'Xóa bản nháp của mình',
    'Xóa phiên quy trình do chính người dùng tạo khi phiên còn ở trạng thái bản nháp.',
    array['own']::text[], 'WF', '/wf', true, 50, true,
    'important', true, false, false, 'declared', 'workflow', false
  ),
  (
    'workflow.instance', 'cancel',
    'workflow.instance.cancel', 'Hủy phiên quy trình',
    'Hủy một phiên quy trình đang chạy. Không được suy ra từ quyền tạo hoặc quyền sở hữu phiên.',
    array['global']::text[], 'WF', '/wf', true, 60, true,
    'important', true, false, false, 'enforced', 'workflow', true
  ),
  (
    'workflow.instance', 'reopen',
    'workflow.instance.reopen', 'Mở lại phiên quy trình',
    'Mở lại phiên đã hoàn thành hoặc bị từ chối tại một bước hợp lệ.',
    array['global']::text[], 'WF', '/wf', true, 70, true,
    'important', true, false, false, 'enforced', 'workflow', true
  ),
  (
    'workflow.instance', 'administer',
    'workflow.instance.administer', 'Quản trị phiên quy trình',
    'Quản trị người theo dõi và các thuộc tính vận hành của phiên quy trình.',
    array['global']::text[], 'WF', '/wf', true, 80, true,
    'important', true, false, false, 'enforced', 'workflow', true
  )
on conflict (permission_code) do update set
  module_code = excluded.module_code,
  action = excluded.action,
  label = excluded.label,
  description = excluded.description,
  scope_modes = excluded.scope_modes,
  legacy_module_key = excluded.legacy_module_key,
  legacy_route = excluded.legacy_route,
  legacy_admin_only = excluded.legacy_admin_only,
  sort_order = excluded.sort_order,
  is_active = true,
  risk_level = excluded.risk_level,
  is_business_action = excluded.is_business_action,
  is_business_approval = excluded.is_business_approval,
  direct_grant_requires_expiry = excluded.direct_grant_requires_expiry,
  grant_readiness = excluded.grant_readiness,
  access_application_code = excluded.access_application_code,
  direct_grant_allowed = excluded.direct_grant_allowed,
  updated_at = now();

create or replace function public.update_workflow_instance_watchers(
  p_instance_id uuid,
  p_watcher_user_ids uuid[],
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.workflow_notification_actor();
  v_cached jsonb;
  i public.workflow_instances%rowtype;
  v_new uuid[];
  v_added uuid[];
  v_removed uuid[];
  v_other_changes uuid[];
  v_result jsonb;
begin
  v_cached := app_private.workflow_command_begin(
    v_actor,
    p_idempotency_key,
    'update_workflow_instance_watchers',
    jsonb_build_object('instanceId', p_instance_id, 'watcherUserIds', p_watcher_user_ids)
  );
  if v_cached is not null then return v_cached; end if;

  select * into i
  from public.workflow_instances
  where id = p_instance_id
  for update;
  if i.id is null then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
  end if;
  if not app_private.workflow_instance_actor_can_select(i.id)
     and not app_private.workflow_has_action(
       'workflow.instance.administer', i.created_by, null, v_actor
     ) then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct candidate_id), '{}'::uuid[])
  into v_new
  from unnest(coalesce(p_watcher_user_ids, '{}'::uuid[])) candidate_id
  join public.users u
    on u.id = candidate_id
   and u.is_active
   and u.account_status = 'ACTIVE';

  select coalesce(array_agg(changed_id), '{}'::uuid[])
  into v_other_changes
  from (
    select candidate_id as changed_id
    from unnest(v_new) candidate_id
    where candidate_id <> v_actor
      and not (candidate_id::text = any(coalesce(i.watchers, '{}'::text[])))
    union
    select existing_id::uuid as changed_id
    from unnest(coalesce(i.watchers, '{}'::text[])) existing_id
    where existing_id ~* '^[0-9a-f-]{36}$'
      and existing_id::uuid <> v_actor
      and not (existing_id::uuid = any(v_new))
  ) changes;

  if cardinality(v_other_changes) > 0
     and not app_private.workflow_has_action(
       'workflow.instance.administer', i.created_by, null, v_actor
     ) then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
  end if;

  select coalesce(array_agg(candidate_id), '{}'::uuid[])
  into v_added
  from unnest(v_new) candidate_id
  where not (candidate_id::text = any(coalesce(i.watchers, '{}'::text[])));

  select coalesce(array_agg(existing_id::uuid), '{}'::uuid[])
  into v_removed
  from unnest(coalesce(i.watchers, '{}'::text[])) existing_id
  where existing_id ~* '^[0-9a-f-]{36}$'
    and not (existing_id::uuid = any(v_new));

  update public.workflow_instances
  set watchers = array(select candidate_id::text from unnest(v_new) candidate_id),
      updated_at = now()
  where id = i.id
  returning * into i;

  if cardinality(v_added) > 0 then
    perform app_private.enqueue_workflow_notification_event(
      i.id, 'workflow.watchers_added', v_actor,
      'workflow.watchers_added:' || p_idempotency_key,
      jsonb_build_object('nodeId', i.current_node_id), v_added
    );
  end if;
  if cardinality(v_removed) > 0 then
    perform app_private.enqueue_workflow_notification_event(
      i.id, 'workflow.watchers_removed', v_actor,
      'workflow.watchers_removed:' || p_idempotency_key,
      jsonb_build_object('nodeId', i.current_node_id), v_removed
    );
  end if;

  v_result := jsonb_build_object(
    'instance', to_jsonb(i),
    'addedWatcherUserIds', to_jsonb(v_added),
    'removedWatcherUserIds', to_jsonb(v_removed)
  );
  return app_private.workflow_command_finish(v_actor, p_idempotency_key, v_result);
end;
$$;

create or replace function public.cancel_workflow_instance(
  p_instance_id uuid,
  p_comment text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.workflow_notification_actor();
  v_cached jsonb;
  i public.workflow_instances%rowtype;
  l public.workflow_instance_logs%rowtype;
begin
  v_cached := app_private.workflow_command_begin(
    v_actor,
    p_idempotency_key,
    'cancel_workflow_instance',
    jsonb_build_object('instanceId', p_instance_id, 'comment', p_comment)
  );
  if v_cached is not null then return v_cached; end if;

  select * into i
  from public.workflow_instances
  where id = p_instance_id
  for update;
  if i.id is null
     or i.status <> 'RUNNING'
     or not app_private.workflow_has_action(
       'workflow.instance.cancel', i.created_by, null, v_actor
     ) then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
  end if;

  update public.workflow_instances
  set status = 'CANCELLED', updated_at = now()
  where id = i.id
  returning * into i;
  insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
  values (i.id, i.current_node_id, 'REJECTED', v_actor, coalesce(p_comment, ''))
  returning * into l;

  return app_private.workflow_command_finish(
    v_actor, p_idempotency_key,
    jsonb_build_object('instance', to_jsonb(i), 'log', to_jsonb(l))
  );
end;
$$;

create or replace function public.reopen_workflow_instance(
  p_instance_id uuid,
  p_target_node_id uuid,
  p_comment text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.workflow_notification_actor();
  v_cached jsonb;
  i public.workflow_instances%rowtype;
  l public.workflow_instance_logs%rowtype;
begin
  v_cached := app_private.workflow_command_begin(
    v_actor,
    p_idempotency_key,
    'reopen_workflow_instance',
    jsonb_build_object(
      'instanceId', p_instance_id,
      'targetNodeId', p_target_node_id,
      'comment', p_comment
    )
  );
  if v_cached is not null then return v_cached; end if;

  select * into i
  from public.workflow_instances
  where id = p_instance_id
  for update;
  if i.id is null
     or i.status not in ('COMPLETED', 'REJECTED')
     or not app_private.workflow_has_action(
       'workflow.instance.reopen', i.created_by, null, v_actor
     )
     or not exists (
       select 1
       from public.workflow_nodes n
       where n.id = p_target_node_id
         and n.template_id = i.template_id
     ) then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
  end if;

  update public.workflow_instances
  set status = 'RUNNING', current_node_id = p_target_node_id, updated_at = now()
  where id = i.id
  returning * into i;
  insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
  values (i.id, p_target_node_id, 'REOPENED', v_actor, coalesce(p_comment, ''))
  returning * into l;

  return app_private.workflow_command_finish(
    v_actor, p_idempotency_key,
    jsonb_build_object('instance', to_jsonb(i), 'log', to_jsonb(l))
  );
end;
$$;

revoke all on function public.update_workflow_instance_watchers(uuid, uuid[], uuid)
  from public, anon;
grant execute on function public.update_workflow_instance_watchers(uuid, uuid[], uuid)
  to authenticated;

revoke all on function public.cancel_workflow_instance(uuid, text, uuid)
  from public, anon;
grant execute on function public.cancel_workflow_instance(uuid, text, uuid)
  to authenticated;

revoke all on function public.reopen_workflow_instance(uuid, uuid, text, uuid)
  from public, anon;
grant execute on function public.reopen_workflow_instance(uuid, uuid, text, uuid)
  to authenticated;
