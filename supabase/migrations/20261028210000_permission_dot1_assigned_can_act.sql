-- Audit mẫu quyền — Đợt 1 (chủ SP duyệt 23/10/2026): "được giao là được làm".
-- 1) Phiếu yêu cầu: người đang giữ bước duyệt (assignment PENDING) duyệt / từ chối / trả lại được mà không cần
--    quyền riêng; người lập luôn sửa nội dung, gửi lại, hủy phiếu của mình. Bỏ đường tắt system.rq.view
--    (quyền "xem" từng mở được cả duyệt). Chuyển người xử lý giữ nguyên.
-- 2) Quy trình: người lập, người đang xử lý bước, quản lý mẫu THÊM được người theo dõi; gỡ người khác vẫn cần
--    quyền quản trị phiếu. Người lập hủy được phiếu đang chạy của mình.
-- 3) Hai quyền "Duyệt / Từ chối yêu cầu được giao" không còn bắt buộc hạn dùng; bỏ hạn các dòng đang có.
-- Phần "người đang xử lý bước Quy trình duyệt được" nằm ở PR #322 (workflow_instance_actor_can_process).

-- Trigger guard_request_assignment_lifecycle_v2 chạy BEFORE UPDATE, nên bước đang duyệt vẫn còn PENDING khi kiểm.
create or replace function app_private.request_actor_holds_pending_step(p_workflow_subject_id uuid, p_actor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_workflow_subject_id is not null
    and p_actor_id is not null
    and exists (
      select 1
      from public.workflow_step_assignments assignment_row
      where assignment_row.workflow_subject_id = p_workflow_subject_id
        and assignment_row.assignee_user_id = p_actor_id
        and assignment_row.status = 'PENDING'
    );
$$;

create or replace function app_private.request_actor_has_lifecycle_action(p_request_id uuid, p_actor_id uuid, p_action text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_actor_id is not null
    and exists (
      select 1
      from public.users actor
      where actor.id = p_actor_id
        and actor.is_active
        and actor.account_status = 'ACTIVE'
    )
    and exists (
      select 1
      from public.request_instances request_row
      where request_row.id = p_request_id
        and case upper(p_action)
          when 'APPROVE' then app_private.request_actor_holds_pending_step(request_row.workflow_subject_id, p_actor_id)
          when 'REJECT' then app_private.request_actor_holds_pending_step(request_row.workflow_subject_id, p_actor_id)
          when 'RETURN' then app_private.request_actor_holds_pending_step(request_row.workflow_subject_id, p_actor_id)
          when 'RESUBMIT' then request_row.created_by = p_actor_id
          when 'EDIT_CONTENT' then request_row.created_by = p_actor_id
          when 'CANCEL' then
            request_row.created_by = p_actor_id
            or app_private.has_permission(p_actor_id, 'request.instance.cancel', 'global', '*')
            or app_private.request_action_is_admin(p_actor_id)
          when 'REASSIGN' then
            app_private.has_permission(p_actor_id, 'request.instance.reassign', 'global', '*')
            or app_private.request_action_is_admin(p_actor_id)
            or app_private.request_actor_holds_pending_step(request_row.workflow_subject_id, p_actor_id)
          else false
        end
    );
$$;

revoke all on function app_private.request_actor_holds_pending_step(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function app_private.request_actor_has_lifecycle_action(uuid, uuid, text) from public, anon, authenticated, service_role;

comment on function app_private.request_actor_has_lifecycle_action(uuid, uuid, text) is
  'Đợt 1 (23/10/2026): người giữ bước PENDING duyệt/từ chối/trả lại; người lập sửa/gửi lại/hủy phiếu của mình.';

create or replace function public.update_workflow_instance_watchers(p_instance_id uuid, p_watcher_user_ids uuid[], p_idempotency_key uuid)
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
  v_added_others uuid[];
  v_removed_others uuid[];
  v_is_admin boolean;
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
  v_is_admin := app_private.workflow_has_action('workflow.instance.administer', i.created_by, null, v_actor);
  if not app_private.workflow_instance_actor_can_select(i.id) and not v_is_admin then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct candidate_id), '{}'::uuid[])
  into v_new
  from unnest(coalesce(p_watcher_user_ids, '{}'::uuid[])) candidate_id
  join public.users u
    on u.id = candidate_id
   and u.is_active
   and u.account_status = 'ACTIVE';

  select coalesce(array_agg(candidate_id), '{}'::uuid[])
  into v_added
  from unnest(v_new) candidate_id
  where not (candidate_id::text = any(coalesce(i.watchers, '{}'::text[])));

  select coalesce(array_agg(existing_id::uuid), '{}'::uuid[])
  into v_removed
  from unnest(coalesce(i.watchers, '{}'::text[])) existing_id
  where existing_id ~* '^[0-9a-f-]{36}$'
    and not (existing_id::uuid = any(v_new));

  select coalesce(array_agg(changed_id), '{}'::uuid[]) into v_added_others
  from unnest(v_added) changed_id where changed_id <> v_actor;
  select coalesce(array_agg(changed_id), '{}'::uuid[]) into v_removed_others
  from unnest(v_removed) changed_id where changed_id <> v_actor;

  -- Người lập, người đang xử lý bước, quản lý mẫu thêm được người theo dõi; gỡ người khác cần quyền quản trị.
  if cardinality(v_added_others) > 0
     and not v_is_admin
     and i.created_by is distinct from v_actor
     and not app_private.workflow_instance_actor_is_current_assignee(i.id, v_actor)
     and not exists (
       select 1 from public.workflow_templates template_row
       where template_row.id = i.template_id
         and coalesce(template_row.managers, '{}'::text[]) @> array[v_actor::text]
     ) then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
  end if;
  if cardinality(v_removed_others) > 0 and not v_is_admin then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
  end if;

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

create or replace function public.cancel_workflow_instance(p_instance_id uuid, p_comment text, p_idempotency_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.workflow_notification_actor();
  v_cached jsonb;
  v_instance public.workflow_instances%rowtype;
  v_log public.workflow_instance_logs%rowtype;
begin
  v_cached := app_private.workflow_command_begin(
    v_actor, p_idempotency_key, 'cancel_workflow_instance',
    jsonb_build_object('instanceId', p_instance_id, 'comment', p_comment)
  );
  if v_cached is not null then return v_cached; end if;
  select * into v_instance from public.workflow_instances where id = p_instance_id for update;
  -- Người lập hủy được phiếu đang chạy của mình; hủy phiếu người khác cần quyền Hủy phiên quy trình.
  if v_instance.id is null
     or v_instance.status <> 'RUNNING'
     or not (
       v_instance.created_by = v_actor
       or app_private.workflow_has_action('workflow.instance.cancel', v_instance.created_by, null, v_actor)
     ) then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
  end if;
  perform set_config('app.workflow_command', 'cancel', true);
  update public.workflow_instances
  set status = 'CANCELLED', updated_at = now()
  where id = v_instance.id
  returning * into v_instance;
  insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
  values (v_instance.id, v_instance.current_node_id, 'REJECTED', v_actor, coalesce(p_comment, ''))
  returning * into v_log;
  return app_private.workflow_command_finish(
    v_actor, p_idempotency_key,
    jsonb_build_object('instance', to_jsonb(v_instance), 'log', to_jsonb(v_log))
  );
end;
$$;

-- Quyền "được giao" không tự hết hạn.
update public.permission_actions
set direct_grant_requires_expiry = false, updated_at = now()
where permission_code in ('request.instance.approve_assigned', 'request.instance.reject_assigned')
  and direct_grant_requires_expiry;

update public.user_permission_grants
set expires_at = null, updated_at = now()
where permission_code in ('request.instance.approve_assigned', 'request.instance.reject_assigned')
  and scope_type = 'assigned'
  and is_active
  and expires_at is not null;

notify pgrst, 'reload schema';
