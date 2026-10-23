-- Audit mẫu quyền — Đợt 2a-2 (chủ SP duyệt 23/10/2026): "Quản lý tài khoản" không cần là ADMIN.
-- Người có settings.users.manage (toàn công ty) tạo, khóa, mở lại, đặt lại mật khẩu tài khoản nhân viên.
-- Người không phải ADMIN:
--   - tài khoản mới luôn là EMPLOYEE, không đổi role của hồ sơ có sẵn;
--   - không thao tác trên tài khoản quản trị: ADMIN, người giữ quyền quản lý phân quyền / Business Role,
--     hoặc tài khoản đang khóa mà trước khi khóa là ADMIN.
-- Đổi role / sửa phân quyền vẫn qua change_user_account_role_v2 / update_user_authorization_v2
-- (system.authorization.manage_roles + manage_grants) — không đổi ở đây.
-- Edge Function create-user / manage-user-account / reset-password kiểm qua account_manager_access_v1
-- (chỉ service_role gọi được); các RPC vòng đời kiểm lại cùng luật.

-- ---------------------------------------------------------------------------------------------
-- 1. Luật chung
-- ---------------------------------------------------------------------------------------------
create or replace function app_private.is_account_manager(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and exists (
      select 1
      from public.users actor
      where actor.id = p_user_id
        and actor.is_active
        and actor.account_status = 'ACTIVE'
        and (
          actor.role = 'ADMIN'
          or app_private.has_permission(actor.id, 'settings.users.manage', 'global', '*')
        )
    );
$$;

create or replace function app_private.account_target_requires_admin(p_target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users target_row
    where target_row.id = p_target_user_id
      and (
        target_row.role = 'ADMIN'
        or app_private.has_permission(target_row.id, 'system.authorization.manage_grants', 'global', '*')
        or app_private.has_permission(target_row.id, 'system.authorization.manage_roles', 'global', '*')
        -- Khóa tài khoản đưa role về EMPLOYEE; role trước khi khóa nằm ở lệnh khóa gần nhất.
        or (
          target_row.account_status = 'DISABLED'
          and (
            select operation_row.before_state ->> 'role'
            from app_private.user_account_operations operation_row
            where operation_row.target_user_id = target_row.id
              and operation_row.action = 'DISABLE'
            order by operation_row.created_at desc
            limit 1
          ) = 'ADMIN'
        )
      )
  );
$$;

create or replace function app_private.assert_account_manager_for_target(p_actor_user_id uuid, p_target_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app_private.is_account_manager(p_actor_user_id) then
    raise exception 'ACCOUNT_MANAGER_REQUIRED: Cần quyền Quản lý tài khoản.'
      using errcode = '42501';
  end if;

  if p_target_user_id is not null
    and not exists (
      select 1 from public.users actor where actor.id = p_actor_user_id and actor.role = 'ADMIN'
    )
    and app_private.account_target_requires_admin(p_target_user_id)
  then
    raise exception 'ACCOUNT_TARGET_ADMIN_ONLY: Chỉ Admin thao tác được trên tài khoản quản trị.'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function app_private.is_account_manager(uuid) from public, anon, authenticated, service_role;
revoke all on function app_private.account_target_requires_admin(uuid) from public, anon, authenticated, service_role;
revoke all on function app_private.assert_account_manager_for_target(uuid, uuid) from public, anon, authenticated, service_role;

-- Edge Function hỏi trước khi gọi Auth: người gọi có được quản lý tài khoản không, và đích (theo id hoặc
-- email của hồ sơ sẽ được gắn vào tài khoản mới) có phải tài khoản chỉ Admin đụng được không.
create or replace function public.account_manager_access_v1(
  p_actor_user_id uuid,
  p_target_user_id uuid default null,
  p_target_email text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_target_email text := lower(nullif(btrim(coalesce(p_target_email, '')), ''));
  v_target_user_id uuid := p_target_user_id;
begin
  if v_target_user_id is null and v_target_email is not null then
    select user_row.id
    into v_target_user_id
    from public.users user_row
    where lower(user_row.email) = v_target_email
    order by user_row.created_at nulls last, user_row.id
    limit 1;
  end if;

  return jsonb_build_object(
    'canManageAccounts', app_private.is_account_manager(p_actor_user_id),
    'targetRequiresAdmin', case
      when p_target_user_id is null and v_target_email is null then null
      else coalesce(app_private.account_target_requires_admin(v_target_user_id), false)
    end
  );
end;
$$;

revoke all on function public.account_manager_access_v1(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.account_manager_access_v1(uuid, uuid, text) to service_role;

comment on function public.account_manager_access_v1(uuid, uuid, text) is
  'Đợt 2a-2 (23/10/2026): Edge Function kiểm Quản lý tài khoản (ADMIN hoặc settings.users.manage) và tài khoản đích chỉ Admin đụng được.';

-- ---------------------------------------------------------------------------------------------
-- 2. Ghi hồ sơ sau khi create-user tạo đăng nhập (trigger Auth đã tạo / gắn dòng users)
-- ---------------------------------------------------------------------------------------------
-- Ghi bằng service_role trong lệnh tin cậy (app.account_lifecycle_command) vì guard
-- prevent_users_privilege_self_update chặn service_role ghi thẳng users.
create or replace function public.complete_user_account_creation_v1(
  p_actor_user_id uuid,
  p_auth_id uuid,
  p_profile jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile jsonb := coalesce(p_profile, '{}'::jsonb);
  v_actor_is_admin boolean;
  v_requested_role text := upper(btrim(coalesce(v_profile ->> 'role', 'EMPLOYEE')));
  v_target public.users%rowtype;
begin
  perform app_private.assert_account_manager_for_target(p_actor_user_id, null);

  select * into v_target
  from public.users
  where auth_id = p_auth_id
  for update;

  if v_target.id is null then
    raise exception 'ACCOUNT_PROFILE_NOT_LINKED: Chưa tìm thấy hồ sơ của tài khoản mới.'
      using errcode = 'P0002';
  end if;

  -- Hồ sơ có sẵn (cùng email) được gắn vào tài khoản mới: cùng luật như khóa / đặt lại mật khẩu.
  perform app_private.assert_account_manager_for_target(p_actor_user_id, v_target.id);

  v_actor_is_admin := exists (
    select 1 from public.users actor where actor.id = p_actor_user_id and actor.role = 'ADMIN'
  );
  if v_actor_is_admin and v_requested_role not in ('ADMIN', 'EMPLOYEE', 'WAREHOUSE_KEEPER') then
    v_requested_role := 'EMPLOYEE';
  end if;

  perform set_config('app.account_lifecycle_command', 'on', true);

  update public.users
  set name = coalesce(nullif(btrim(v_profile ->> 'name'), ''), name),
      username = coalesce(nullif(btrim(v_profile ->> 'username'), ''), username),
      phone = coalesce(nullif(btrim(v_profile ->> 'phone'), ''), phone),
      avatar = coalesce(nullif(btrim(v_profile ->> 'avatar'), ''), avatar),
      -- Không phải ADMIN: giữ role / kho của hồ sơ (trigger Auth tạo mới luôn là EMPLOYEE, chưa gán kho).
      role = case when v_actor_is_admin then v_requested_role::public.user_role else role end,
      assigned_warehouse_id = case
        when v_actor_is_admin then nullif(btrim(coalesce(v_profile ->> 'assignedWarehouseId', '')), '')
        else assigned_warehouse_id
      end,
      updated_at = now()
  where id = v_target.id
  returning * into v_target;

  insert into public.permission_audit_events (
    actor_user_id,
    target_user_id,
    event_type,
    before_grants,
    after_grants,
    metadata
  )
  values (
    p_actor_user_id,
    v_target.id,
    'account_created',
    '[]'::jsonb,
    '[]'::jsonb,
    jsonb_build_object(
      'authId', p_auth_id,
      'role', v_target.role,
      'requestedRole', upper(btrim(coalesce(v_profile ->> 'role', 'EMPLOYEE'))),
      'actorIsAdmin', v_actor_is_admin
    )
  );

  return jsonb_build_object('profileId', v_target.id, 'role', v_target.role);
end;
$$;

revoke all on function public.complete_user_account_creation_v1(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.complete_user_account_creation_v1(uuid, uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 3. Vòng đời tài khoản: thay assert_legacy_system_admin bằng luật Quản lý tài khoản
--    (thân hàm giữ nguyên bản đang chạy trên Cloud).
-- ---------------------------------------------------------------------------------------------
create or replace function public.prepare_user_account_lifecycle(p_actor_user_id uuid, p_target_user_id uuid, p_action text, p_reason text, p_idempotency_key uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_action text := upper(btrim(coalesce(p_action, '')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_operation app_private.user_account_operations%rowtype;
  v_target public.users%rowtype;
  v_before_grants jsonb := '[]'::jsonb;
  v_revocation_summary jsonb := '{}'::jsonb;
begin
  if v_action not in ('DISABLE', 'REACTIVATE') then
    raise exception 'Unsupported account lifecycle action'
      using errcode = '22023';
  end if;
  if char_length(v_reason) < 5 then
    raise exception 'Account lifecycle reason must contain at least 5 characters'
      using errcode = '22023';
  end if;

  -- Serialize lifecycle authorization so two concurrent admin disables cannot
  -- both pass the last-active-admin check against stale snapshots.
  perform pg_advisory_xact_lock(
    hashtextextended('user_account_lifecycle_active_admin', 0)
  );
  perform app_private.assert_account_manager_for_target(p_actor_user_id, p_target_user_id);

  select * into v_target
  from public.users
  where id = p_target_user_id
  for update;

  if v_target.id is null then
    raise exception 'Target user does not exist'
      using errcode = 'P0002';
  end if;

  select * into v_operation
  from app_private.user_account_operations
  where idempotency_key = p_idempotency_key
  for update;

  if v_operation.id is not null then
    if v_operation.target_user_id <> p_target_user_id
      or v_operation.action <> v_action
      or v_operation.requested_by <> p_actor_user_id
      or v_operation.reason <> v_reason
    then
      raise exception 'Idempotency key is already used for another command'
        using errcode = '23505';
    end if;
    return app_private.account_operation_response(v_operation);
  end if;

  -- A fresh browser command may safely resume only the same unfinished action.
  select * into v_operation
  from app_private.user_account_operations
  where target_user_id = p_target_user_id
    and status <> 'COMPLETED'
  order by created_at
  limit 1
  for update;

  if v_operation.id is not null then
    if v_operation.action <> v_action then
      raise exception 'Target account has an unfinished lifecycle operation'
        using errcode = '55000';
    end if;
    return app_private.account_operation_response(v_operation);
  end if;

  if v_action = 'DISABLE' then
    if p_actor_user_id = p_target_user_id then
      raise exception 'Cannot disable the current account'
        using errcode = '42501';
    end if;
    if v_target.is_active and v_target.role = 'ADMIN' and not exists (
      select 1
      from public.users other_admin
      where other_admin.id <> p_target_user_id
        and other_admin.role = 'ADMIN'
        and other_admin.is_active
        and other_admin.account_status = 'ACTIVE'
    ) then
      raise exception 'Cannot disable the last active System Admin'
        using errcode = '42501';
    end if;
  else
    if v_target.is_active or v_target.account_status = 'ACTIVE' then
      raise exception 'Target account is already active'
        using errcode = '22023';
    end if;
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(g) order by g.permission_code, g.scope_type, g.scope_id),
    '[]'::jsonb
  )
  into v_before_grants
  from public.user_permission_grants g
  where g.user_id = p_target_user_id
    and g.is_active;

  insert into app_private.user_account_operations (
    idempotency_key,
    target_user_id,
    requested_by,
    action,
    status,
    reason,
    auth_id,
    before_state
  )
  values (
    p_idempotency_key,
    p_target_user_id,
    p_actor_user_id,
    v_action,
    'PREPARED',
    v_reason,
    v_target.auth_id,
    jsonb_build_object(
      'role', v_target.role,
      'assignedWarehouseId', v_target.assigned_warehouse_id,
      'permissionGrants', v_before_grants
    )
  )
  returning * into v_operation;

  perform set_config('app.account_lifecycle_command', 'on', true);

  if v_action = 'DISABLE' then
    update public.users
    set account_status = 'DISABLED',
        is_active = false,
        disabled_at = case when v_target.is_active then now() else disabled_at end,
        disabled_by = case when v_target.is_active then p_actor_user_id else disabled_by end,
        disabled_reason = case when v_target.is_active then v_reason else disabled_reason end,
        role = 'EMPLOYEE',
        assigned_warehouse_id = null,
        account_operation_status = 'PENDING',
        account_operation_action = 'DISABLE',
        updated_at = now()
    where id = p_target_user_id;
  else
    update public.users
    set account_operation_status = 'PENDING',
        account_operation_action = 'REACTIVATE',
        updated_at = now()
    where id = p_target_user_id;
  end if;

  v_revocation_summary := app_private.revoke_user_access_sources(
    p_target_user_id,
    p_actor_user_id,
    v_operation.id,
    case
      when v_action = 'DISABLE' then 'account_disabled: ' || v_reason
      else 'reactivation_zero_rights_guard: ' || v_reason
    end
  );

  insert into public.permission_audit_events (
    actor_user_id,
    target_user_id,
    event_type,
    before_grants,
    after_grants,
    metadata
  )
  values (
    p_actor_user_id,
    p_target_user_id,
    case
      when v_action = 'DISABLE' then 'account_disabled_db_applied'
      else 'account_reactivation_prepared_zero_rights'
    end,
    v_before_grants,
    '[]'::jsonb,
    jsonb_build_object(
      'operationId', v_operation.id,
      'reason', v_reason,
      'revocationSummary', v_revocation_summary
    )
  );

  update app_private.user_account_operations
  set status = 'DB_APPLIED',
      before_state = before_state || jsonb_build_object(
        'revocationSummary', v_revocation_summary
      ),
      updated_at = now()
  where id = v_operation.id
  returning * into v_operation;

  return app_private.account_operation_response(v_operation);
end;
$function$;

create or replace function public.complete_user_account_lifecycle(p_actor_user_id uuid, p_operation_id uuid, p_auth_result jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_operation app_private.user_account_operations%rowtype;
  v_final_revocation_summary jsonb := '{}'::jsonb;
begin
  perform app_private.assert_account_manager_for_target(p_actor_user_id, null);

  select * into v_operation
  from app_private.user_account_operations
  where id = p_operation_id
  for update;

  if v_operation.id is null then
    raise exception 'Account lifecycle operation does not exist'
      using errcode = 'P0002';
  end if;
  perform app_private.assert_account_manager_for_target(p_actor_user_id, v_operation.target_user_id);
  if v_operation.status = 'COMPLETED' then
    return app_private.account_operation_response(v_operation);
  end if;
  if v_operation.status not in ('DB_APPLIED', 'AUTH_RETRY') then
    raise exception 'Account lifecycle operation is not ready for completion'
      using errcode = '55000';
  end if;

  -- Close anything created between prepare and Auth completion before activation.
  v_final_revocation_summary := app_private.revoke_user_access_sources(
    v_operation.target_user_id,
    p_actor_user_id,
    v_operation.id,
    'account_lifecycle_final_sweep: ' || v_operation.reason
  );

  perform set_config('app.account_lifecycle_command', 'on', true);

  if v_operation.action = 'REACTIVATE' then
    update public.users
    set account_status = 'ACTIVE',
        is_active = true,
        role = 'EMPLOYEE',
        assigned_warehouse_id = null,
        reactivated_at = now(),
        reactivated_by = p_actor_user_id,
        reactivation_reason = v_operation.reason,
        account_operation_status = 'IDLE',
        account_operation_action = null,
        updated_at = now()
    where id = v_operation.target_user_id;
  else
    update public.users
    set account_operation_status = 'IDLE',
        account_operation_action = null,
        updated_at = now()
    where id = v_operation.target_user_id;
  end if;

  update app_private.user_account_operations
  set status = 'COMPLETED',
      auth_result = coalesce(p_auth_result, '{}'::jsonb),
      last_error = null,
      updated_at = now(),
      completed_at = now()
  where id = v_operation.id
  returning * into v_operation;

  insert into public.permission_audit_events (
    actor_user_id,
    target_user_id,
    event_type,
    before_grants,
    after_grants,
    metadata
  )
  values (
    p_actor_user_id,
    v_operation.target_user_id,
    case
      when v_operation.action = 'REACTIVATE' then 'account_reactivated_zero_rights'
      else 'account_disabled_auth_completed'
    end,
    '[]'::jsonb,
    '[]'::jsonb,
    jsonb_build_object(
      'operationId', v_operation.id,
      'reason', v_operation.reason,
      'authResult', coalesce(p_auth_result, '{}'::jsonb),
      'finalRevocationSummary', v_final_revocation_summary
    )
  );

  return app_private.account_operation_response(v_operation);
end;
$function$;

create or replace function public.fail_user_account_lifecycle(p_actor_user_id uuid, p_operation_id uuid, p_error text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_operation app_private.user_account_operations%rowtype;
begin
  perform app_private.assert_account_manager_for_target(p_actor_user_id, null);

  select * into v_operation
  from app_private.user_account_operations
  where id = p_operation_id
  for update;

  if v_operation.id is null then
    raise exception 'Account lifecycle operation does not exist'
      using errcode = 'P0002';
  end if;
  perform app_private.assert_account_manager_for_target(p_actor_user_id, v_operation.target_user_id);

  if v_operation.status <> 'COMPLETED' then
    perform set_config('app.account_lifecycle_command', 'on', true);

    update app_private.user_account_operations
    set status = 'AUTH_RETRY',
        last_error = left(coalesce(p_error, 'Unknown Auth orchestration error'), 1000),
        updated_at = now()
    where id = p_operation_id
    returning * into v_operation;

    update public.users
    set account_operation_status = 'AUTH_RETRY',
        account_operation_action = v_operation.action,
        updated_at = now()
    where id = v_operation.target_user_id;

    insert into public.permission_audit_events (
      actor_user_id,
      target_user_id,
      event_type,
      before_grants,
      after_grants,
      metadata
    )
    values (
      p_actor_user_id,
      v_operation.target_user_id,
      'account_auth_retry_required',
      '[]'::jsonb,
      '[]'::jsonb,
      jsonb_build_object(
        'operationId', v_operation.id,
        'action', v_operation.action
      )
    );
  end if;

  return app_private.account_operation_response(v_operation);
end;
$function$;

create or replace function public.get_user_account_lifecycle_preview(p_target_user_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_actor_user_id uuid := public.current_app_user_id();
  v_result jsonb;
begin
  perform app_private.assert_account_manager_for_target(v_actor_user_id, p_target_user_id);

  select jsonb_build_object(
    'targetUserId', user_row.id,
    'accountStatus', user_row.account_status,
    'operationStatus', user_row.account_operation_status,
    'operationAction', user_row.account_operation_action,
    'hasAuthIdentity', user_row.auth_id is not null,
    'directGrants', (
      select count(*)
      from public.user_permission_grants grant_row
      where grant_row.user_id = user_row.id
        and grant_row.is_active
    ),
    'businessRoleAssignments', (
      select count(*)
      from public.principal_role_assignments assignment_row
      where assignment_row.principal_type = 'user'
        and assignment_row.principal_id = user_row.id
        and assignment_row.status in ('ACTIVE')
    ),
    -- Kept for the deployed UI; legacy module columns no longer exist.
    'legacyModules', 0,
    'projectStaffAssignments', (
      select count(*)
      from public.project_staff staff_row
      where staff_row.user_id = user_row.id::text
        and staff_row.end_date is null
    ),
    'responsibilitySlots', (
      select count(*)
      from public.app_responsibility_slots slot_row
      where slot_row.assignee_user_id = user_row.id
        and slot_row.status = 'active'
    ),
    'runtimeAssignments', (
      select count(*)
      from public.app_assignments assignment_row
      where assignment_row.principal_id = user_row.id
        and assignment_row.status = 'active'
    )
  )
  into v_result
  from public.users user_row
  where user_row.id = p_target_user_id;

  if v_result is null then
    raise exception 'Target user does not exist'
      using errcode = 'P0002';
  end if;

  return v_result;
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- 4. Danh mục: cấp riêng được, không bắt hạn; máy chủ đã kiểm nên chuyển sang enforced.
--    Cấp cho Trưởng phòng HCNS Nguyễn Thị Giang (đã bỏ ADMIN ngày 23/10).
-- ---------------------------------------------------------------------------------------------
update public.permission_actions
set direct_grant_allowed = true,
    direct_grant_requires_expiry = false,
    grant_readiness = 'enforced',
    updated_at = now()
where permission_code = 'settings.users.manage';

with granter as (
  select id from public.users where lower(email) = 'admin@khoviet.vn' limit 1
), granted as (
  insert into public.user_permission_grants (
    user_id, permission_code, scope_type, scope_id, is_active, granted_by, granted_at, grant_reason
  )
  select target_row.id, 'settings.users.manage', 'global', '*', true, (select id from granter), now(),
    'Đợt 2a-2 audit mẫu quyền 23/10/2026'
  from public.users target_row
  where target_row.id = 'fdbfaa60-7dd9-47eb-9ec0-f7e96886c328'
    and lower(target_row.email) = 'giangnt@tienthinhjsc.vn'
  on conflict (user_id, permission_code, scope_type, scope_id) do update
  set is_active = true,
      granted_by = excluded.granted_by,
      granted_at = excluded.granted_at,
      grant_reason = excluded.grant_reason,
      expires_at = null,
      revoked_at = null,
      revoked_by = null,
      revoked_reason = null,
      updated_at = now()
  where not public.user_permission_grants.is_active
    or public.user_permission_grants.expires_at is not null
  returning user_id, permission_code, scope_type, scope_id
)
insert into public.permission_audit_events (actor_user_id, target_user_id, event_type, before_grants, after_grants, metadata)
select (select id from granter), granted.user_id, 'direct_permission_grants_changed', '[]'::jsonb,
  jsonb_build_array(jsonb_build_object(
    'permission_code', granted.permission_code, 'scope_type', granted.scope_type, 'scope_id', granted.scope_id
  )),
  jsonb_build_object('reason', 'Đợt 2a-2 audit mẫu quyền 23/10/2026', 'source', 'migration_20261029100000')
from granted;

notify pgrst, 'reload schema';
