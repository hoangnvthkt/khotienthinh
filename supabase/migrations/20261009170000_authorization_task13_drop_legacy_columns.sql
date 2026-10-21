-- Task 13 (final): drop the four legacy permission columns on public.users.
-- T0 = 2026-10-02 (20261004140000_authorization_task13_stop_reading_legacy_modules, PR #51).
-- Runbook: docs/security/authorization-v2-task13-runbook.md.
-- Order: snapshot + checksum -> rewrite readers -> drop legacy-only routines/trigger -> drop columns.
-- No CASCADE anywhere. Rollback: supabase/operations/authorization_task13_drop_legacy_columns_rollback.sql.

do $$
begin
  if not app_private.permission_hardening_flag('legacy_fallback_disabled')
    or not app_private.permission_hardening_flag('legacy_governance_fallback_disabled')
    or not app_private.permission_hardening_flag('legacy_permission_writes_disabled')
    or app_private.permission_hardening_flag('legacy_projection_enabled')
  then
    raise exception 'Task 13 stop: legacy hardening flags are not fail-closed';
  end if;
end $$;

-- 1. Immutable backup of every users row (by user ID, not by active-count equality).
create table app_private.authorization_task13_legacy_column_snapshots (
  user_id uuid primary key,
  cutover_id uuid not null,
  allowed_modules text[],
  admin_modules text[],
  allowed_sub_modules jsonb,
  admin_sub_modules jsonb,
  user_is_active boolean,
  user_account_status text,
  captured_at timestamptz not null default now(),
  payload_sha256 text not null
);
alter table app_private.authorization_task13_legacy_column_snapshots enable row level security;
revoke all on app_private.authorization_task13_legacy_column_snapshots from public, anon, authenticated;

insert into app_private.authorization_task13_legacy_column_snapshots (
  user_id, cutover_id, allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules,
  user_is_active, user_account_status, payload_sha256
)
select u.id, '3fdab060-a1ce-4105-9a56-b57ab1b4f1c0', u.allowed_modules, u.admin_modules, u.allowed_sub_modules, u.admin_sub_modules,
  u.is_active, u.account_status,
  encode(sha256(convert_to(jsonb_build_object(
      'userId', u.id, 'allowedModules', u.allowed_modules, 'adminModules', u.admin_modules,
      'allowedSubModules', u.allowed_sub_modules, 'adminSubModules', u.admin_sub_modules
    )::text, 'UTF8')), 'hex')
from public.users u;

create or replace function app_private.authorization_task13_snapshot_digest(
  p_snapshot app_private.authorization_task13_legacy_column_snapshots
) returns text
language sql immutable
set search_path to ''
as $function$
  select encode(sha256(convert_to(jsonb_build_object(
      'userId', p_snapshot.user_id, 'allowedModules', p_snapshot.allowed_modules, 'adminModules', p_snapshot.admin_modules,
      'allowedSubModules', p_snapshot.allowed_sub_modules, 'adminSubModules', p_snapshot.admin_sub_modules
    )::text, 'UTF8')), 'hex');
$function$;
revoke all on function app_private.authorization_task13_snapshot_digest(app_private.authorization_task13_legacy_column_snapshots) from public, anon, authenticated;

do $$
declare v_missing int; v_bad int; v_diff int;
begin
  select count(*) into v_missing from public.users u
  where not exists (select 1 from app_private.authorization_task13_legacy_column_snapshots s where s.user_id = u.id);
  select count(*) into v_bad from app_private.authorization_task13_legacy_column_snapshots s
  where s.payload_sha256 <> app_private.authorization_task13_snapshot_digest(s);
  select count(*) into v_diff from public.users u
  join app_private.authorization_task13_legacy_column_snapshots s on s.user_id = u.id
  where s.allowed_modules is distinct from u.allowed_modules or s.admin_modules is distinct from u.admin_modules
    or s.allowed_sub_modules is distinct from u.allowed_sub_modules or s.admin_sub_modules is distinct from u.admin_sub_modules;
  if v_missing <> 0 or v_bad <> 0 or v_diff <> 0 then
    raise exception 'Task 13 stop: snapshot coverage/checksum failed (missing %, checksum %, payload %)', v_missing, v_bad, v_diff;
  end if;
end $$;

-- 2. Rewrite routines that still read or write the columns.
CREATE OR REPLACE FUNCTION app_private.resolve_effective_permission_sources(p_user_id uuid, p_permission_code text DEFAULT NULL::text, p_scope_type text DEFAULT NULL::text, p_scope_id text DEFAULT NULL::text, p_at timestamp with time zone DEFAULT now())
 RETURNS TABLE(permission_code text, source_type text, source_id text, source_code text, source_label text, scope_type text, scope_id text, starts_at timestamp with time zone, expires_at timestamp with time zone, risk_level text, is_business_approval boolean, metadata jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with active_user as (
    select u.* from public.users u
    where u.id=p_user_id and u.is_active and u.account_status='ACTIVE'
  ), active_actions as (
    select pa.*,pm.application_code,pm.legacy_module_key as module_legacy_key
    from public.permission_actions pa
    join public.permission_modules pm on pm.code=pa.module_code
    where pa.is_active and pm.is_active
      and (p_permission_code is null or pa.permission_code=p_permission_code)
  ), role_sources as (
    select item.permission_code,'ROLE'::text,assignment.id::text,
      role_template.code,role_template.name,
      case when assignment.scope_type='global' then item.scope_type else assignment.scope_type end,
      case when assignment.scope_type='global' then item.scope_id
        when item.scope_type='global' then assignment.scope_id
        when assignment.scope_id='*' then item.scope_id else assignment.scope_id end,
      assignment.starts_at,assignment.expires_at,action_row.risk_level,
      action_row.is_business_approval,
      jsonb_build_object('roleTemplateId',role_template.id,'assignmentId',assignment.id,
        'assignmentScopeType',assignment.scope_type,'assignmentScopeId',assignment.scope_id)
    from active_user user_row
    join public.principal_role_assignments assignment
      on assignment.principal_type='user' and assignment.principal_id=user_row.id
     and assignment.status='ACTIVE' and assignment.starts_at<=p_at
     and (assignment.expires_at is null or assignment.expires_at>p_at)
    join public.role_permission_templates role_template
      on role_template.id=assignment.role_template_id and role_template.is_active
    join public.role_permission_template_items item on item.template_id=role_template.id
    join active_actions action_row on action_row.permission_code=item.permission_code
    where app_private.permission_hardening_flag('business_role_resolver_enabled')
      and (item.permission_code<>'system.settings.manage'
        or (role_template.code='SYSTEM_ADMIN' and user_row.role='ADMIN'))
      and (assignment.scope_type='global' or item.scope_type='global'
        or (assignment.scope_type=item.scope_type and
          (assignment.scope_id='*' or item.scope_id='*' or assignment.scope_id=item.scope_id)))
      and (p_scope_type is null or (
        app_private.scope_covers(assignment.scope_type,assignment.scope_id,p_scope_type,p_scope_id)
        and app_private.scope_covers(item.scope_type,item.scope_id,p_scope_type,p_scope_id)))
  ), super_admin_sources as (
    select action_row.permission_code,'ROLE'::text,assignment.id::text,
      role_template.code,role_template.name,'global'::text,'*'::text,
      assignment.starts_at,assignment.expires_at,action_row.risk_level,
      action_row.is_business_approval,
      jsonb_build_object('roleTemplateId',role_template.id,'assignmentId',assignment.id,
        'dynamic',true,'futureActionPolicy','auto_include')
    from active_user user_row
    join public.principal_role_assignments assignment
      on assignment.principal_type='user' and assignment.principal_id=user_row.id
     and assignment.status='ACTIVE' and assignment.starts_at<=p_at
     and assignment.expires_at is null
     and assignment.scope_type='global' and assignment.scope_id='*'
    join public.role_permission_templates role_template
      on role_template.id=assignment.role_template_id
     and role_template.code='SUPER_ADMIN' and role_template.is_system and role_template.is_active
    cross join active_actions action_row
    where app_private.permission_hardening_flag('business_role_resolver_enabled')
      and (p_scope_type is null or app_private.scope_covers('global','*',p_scope_type,p_scope_id))
  ), direct_sources as (
    select grant_row.permission_code,'DIRECT'::text,grant_row.id::text,'DIRECT'::text,
      'Direct grant'::text,grant_row.scope_type,grant_row.scope_id,
      grant_row.granted_at,grant_row.expires_at,action_row.risk_level,
      action_row.is_business_approval,
      jsonb_build_object('grantedBy',grant_row.granted_by,'reason',grant_row.grant_reason)
    from active_user user_row
    join public.user_permission_grants grant_row
      on grant_row.user_id=user_row.id and grant_row.is_active
     and grant_row.granted_at<=p_at and (grant_row.expires_at is null or grant_row.expires_at>p_at)
    join active_actions action_row on action_row.permission_code=grant_row.permission_code
    where grant_row.permission_code<>'system.settings.manage'
      and (p_scope_type is null or app_private.scope_covers(
        grant_row.scope_type,grant_row.scope_id,p_scope_type,p_scope_id))
  )
  select * from role_sources
  union all select * from super_admin_sources
  union all select * from direct_sources
  union all select * from app_private.work_workspace_permission_sources(
    p_user_id,p_permission_code,p_scope_type,p_scope_id,p_at
  );
$function$;

CREATE OR REPLACE FUNCTION app_private.user_permission_state_fingerprint(p_user_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select app_private.permission_state_fingerprint_for_values(
    jsonb_build_object(
      'allowedModules', '[]'::jsonb,
      'allowedSubModules', '{}'::jsonb,
      'adminModules', '[]'::jsonb,
      'adminSubModules', '{}'::jsonb
    ),
    app_private.direct_permission_state_for_user(user_row.id)
  )
  from public.users user_row
  where user_row.id = p_user_id;
$function$;

CREATE OR REPLACE FUNCTION app_private.sync_user_account_status_compat()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'INSERT' then
    if session_user = 'supabase_auth_admin' then
      -- Auth metadata is profile input only. Authorization comes from V2 grants.
      new.role := 'EMPLOYEE';
      new.assigned_warehouse_id := null;
    end if;

    -- During compatibility, either explicit disabled signal must win over defaults.
    if new.account_status = 'DISABLED' or new.is_active = false then
      new.account_status := 'DISABLED';
      new.is_active := false;
    else
      new.account_status := 'ACTIVE';
      new.is_active := true;
    end if;
    return new;
  end if;

  if session_user = 'supabase_auth_admin' then
    new.role := old.role;
    new.assigned_warehouse_id := old.assigned_warehouse_id;
    new.account_status := old.account_status;
    new.is_active := old.is_active;
    return new;
  end if;

  if old.account_status is distinct from new.account_status
    or old.is_active is distinct from new.is_active
  then
    if coalesce(current_setting('app.account_lifecycle_command', true), '') <> 'on' then
      raise exception 'Account status can only be changed by the account lifecycle command'
        using errcode = '42501';
    end if;

    if old.account_status is distinct from new.account_status then
      new.is_active := new.account_status = 'ACTIVE';
    else
      new.account_status := case when new.is_active then 'ACTIVE' else 'DISABLED' end;
    end if;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.prevent_users_privilege_self_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  current_user_id uuid;
begin
  if session_user = 'supabase_auth_admin' then
    return new;
  end if;

  if auth.role() = 'service_role'
    and coalesce(current_setting('app.account_lifecycle_command', true), '') = 'on'
  then
    return new;
  end if;

  if public.is_admin() then
    return new;
  end if;

  current_user_id := public.current_app_user_id();

  if coalesce(current_setting('app.authorization_permission_command', true), '') = 'on'
    and current_user_id is not null
    and app_private.has_permission(
      current_user_id,
      'system.authorization.manage_grants',
      'global',
      '*'
    )
  then
    return new;
  end if;

  if current_user_id is null
    or old.id is distinct from current_user_id
    or new.id is distinct from current_user_id
  then
    raise exception 'Only admins can update other user rows'
      using errcode = '42501';
  end if;

  if old.role is distinct from new.role
    or old.auth_id is distinct from new.auth_id
    or old.email is distinct from new.email
    or old.username is distinct from new.username
    or old.assigned_warehouse_id is distinct from new.assigned_warehouse_id
    or old.is_active is distinct from new.is_active
  then
    raise exception 'Self profile updates cannot change protected permission fields'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_user_account_lifecycle(p_actor_user_id uuid, p_target_user_id uuid, p_action text, p_reason text, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  perform app_private.assert_legacy_system_admin(p_actor_user_id);

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

CREATE OR REPLACE FUNCTION public.complete_user_account_lifecycle(p_actor_user_id uuid, p_operation_id uuid, p_auth_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_operation app_private.user_account_operations%rowtype;
  v_final_revocation_summary jsonb := '{}'::jsonb;
begin
  perform app_private.assert_legacy_system_admin(p_actor_user_id);

  select * into v_operation
  from app_private.user_account_operations
  where id = p_operation_id
  for update;

  if v_operation.id is null then
    raise exception 'Account lifecycle operation does not exist'
      using errcode = 'P0002';
  end if;
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

CREATE OR REPLACE FUNCTION public.get_user_account_lifecycle_preview(p_target_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_user_id uuid := public.current_app_user_id();
  v_result jsonb;
begin
  perform app_private.assert_legacy_system_admin(v_actor_user_id);

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

CREATE OR REPLACE FUNCTION app_private.replace_user_permission_grants_v2_impl(p_user_id uuid, p_grants jsonb, p_reason text, p_warning_acceptances jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_user_id uuid;
  v_target public.users%rowtype;
  v_grants jsonb := coalesce(p_grants, '[]'::jsonb);
  v_reason text := btrim(coalesce(p_reason, ''));
  v_before jsonb := '[]'::jsonb;
  v_after jsonb := '[]'::jsonb;
  v_decision jsonb;
  v_command_id uuid := gen_random_uuid();
begin
  v_actor_user_id := app_private.assert_authorization_permission(
    'system.authorization.manage_grants'
  );

  if jsonb_typeof(v_grants) <> 'array' then
    raise exception 'Permission grants payload must be an array'
      using errcode = '22023';
  end if;

  select *
  into v_target
  from public.users
  where id = p_user_id
  for update;

  if v_target.id is null
    or not v_target.is_active
    or v_target.account_status <> 'ACTIVE'
  then
    raise exception 'Active target user required'
      using errcode = '23514';
  end if;

  v_decision := app_private.evaluate_direct_grant_replacement_impl(
    v_actor_user_id,
    p_user_id,
    v_grants
  );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'permissionCode', grant_row.permission_code,
        'scopeType', grant_row.scope_type,
        'scopeId', grant_row.scope_id,
        'expiresAt', grant_row.expires_at
      )
      order by grant_row.permission_code, grant_row.scope_type, grant_row.scope_id
    ),
    '[]'::jsonb
  )
  into v_before
  from public.user_permission_grants grant_row
  where grant_row.user_id = p_user_id
    and grant_row.is_active;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'permissionCode', normalized.permission_code,
        'scopeType', normalized.scope_type,
        'scopeId', normalized.scope_id,
        'expiresAt', normalized.expires_at
      )
      order by normalized.permission_code, normalized.scope_type, normalized.scope_id
    ),
    '[]'::jsonb
  )
  into v_after
  from (
    select
      grant_row.permission_code,
      coalesce(nullif(grant_row.scope_type, ''), 'global') as scope_type,
      coalesce(nullif(grant_row.scope_id, ''), '*') as scope_id,
      grant_row.expires_at
    from jsonb_to_recordset(v_grants) grant_row(
      permission_code text,
      scope_type text,
      scope_id text,
      is_active boolean,
      expires_at timestamptz
    )
    where coalesce(grant_row.is_active, true)
  ) normalized;

  if v_before is not distinct from v_after then
    return v_after;
  end if;

  if char_length(v_reason) < 10 then
    raise exception 'Direct permission grant change reason required'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(v_grants) grant_row(
      permission_code text,
      is_active boolean
    )
    join public.permission_actions action_row
      on action_row.permission_code = grant_row.permission_code
     and action_row.is_active
    where coalesce(grant_row.is_active, true)
      and action_row.risk_level in ('important', 'sensitive')
      and char_length(v_reason) < 10
  ) then
    raise exception 'Important direct permission grant requires a reason'
      using errcode = '23514';
  end if;

  perform app_private.assert_and_record_sod_warnings(
    v_decision,
    p_warning_acceptances,
    'REPLACE_DIRECT_GRANTS',
    v_command_id,
    v_actor_user_id,
    p_user_id
  );

  update public.user_permission_grants existing
  set is_active = false,
      revoked_at = coalesce(existing.revoked_at, now()),
      revoked_by = coalesce(existing.revoked_by, v_actor_user_id),
      revoked_reason = coalesce(existing.revoked_reason, v_reason),
      updated_at = now()
  where existing.user_id = p_user_id
    and existing.is_active
    and not exists (
      select 1
      from jsonb_to_recordset(v_grants) desired(
        permission_code text,
        scope_type text,
        scope_id text,
        is_active boolean,
        expires_at timestamptz
      )
      where coalesce(desired.is_active, true)
        and desired.permission_code = existing.permission_code
        and coalesce(nullif(desired.scope_type, ''), 'global') = existing.scope_type
        and coalesce(nullif(desired.scope_id, ''), '*') = existing.scope_id
    );

  insert into public.user_permission_grants (
    user_id,
    permission_code,
    scope_type,
    scope_id,
    is_active,
    granted_by,
    granted_at,
    expires_at,
    grant_reason,
    revoked_at,
    revoked_by,
    revoked_reason
  )
  select
    p_user_id,
    desired.permission_code,
    coalesce(nullif(desired.scope_type, ''), 'global'),
    coalesce(nullif(desired.scope_id, ''), '*'),
    true,
    v_actor_user_id,
    now(),
    desired.expires_at,
    nullif(v_reason, ''),
    null,
    null,
    null
  from jsonb_to_recordset(v_grants) desired(
    permission_code text,
    scope_type text,
    scope_id text,
    is_active boolean,
    expires_at timestamptz
  )
  where coalesce(desired.is_active, true)
  on conflict (user_id, permission_code, scope_type, scope_id) do update
  set is_active = true,
      granted_by = excluded.granted_by,
      granted_at = excluded.granted_at,
      expires_at = excluded.expires_at,
      grant_reason = excluded.grant_reason,
      revoked_at = null,
      revoked_by = null,
      revoked_reason = null,
      updated_at = now();

  insert into public.permission_audit_events (
    actor_user_id,
    target_user_id,
    event_type,
    before_grants,
    after_grants,
    metadata
  )
  values (
    v_actor_user_id,
    p_user_id,
    'direct_permission_grants_changed',
    v_before,
    v_after,
    jsonb_build_object(
      'commandId', v_command_id,
      'reason', v_reason,
      'decision', v_decision
    )
  );

  return v_after;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_authorization_legacy_migration_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_cutover_id constant uuid := '6aa37d8c-1d58-4eb4-a5a9-709100333020';
  v_task13_cutover_id constant uuid := '3fdab060-a1ce-4105-9a56-b57ab1b4f1c0';
begin
  perform app_private.assert_project_permission_room_admin();
  return jsonb_build_object(
    'cutoverId', v_cutover_id,
    'snapshots', (select count(*) from app_private.authorization_legacy_user_snapshots where cutover_id = v_cutover_id),
    'manualReview', (select count(*) from app_private.authorization_legacy_migration_dispositions where cutover_id = v_cutover_id and disposition = 'manual_review'),
    -- Task 13 dropped the legacy columns: no user can hold a legacy-only permission any more.
    'legacyOnlyUsers', 0,
    'legacyColumnsDropped', true,
    'task13CutoverId', v_task13_cutover_id,
    'legacyConfiguredUsers', (
      select count(*) from app_private.authorization_task13_legacy_column_snapshots snap
      where snap.cutover_id = v_task13_cutover_id
        and (snap.allowed_modules is not null or snap.admin_modules is not null
          or snap.allowed_sub_modules is not null or snap.admin_sub_modules is not null)
    ),
    'legacyConfiguredValues', (
      (select coalesce(sum(
        cardinality(coalesce(snap.allowed_modules, '{}'::text[]))
        + cardinality(coalesce(snap.admin_modules, '{}'::text[]))
      ), 0) from app_private.authorization_task13_legacy_column_snapshots snap where snap.cutover_id = v_task13_cutover_id)
      + (select count(*) from app_private.authorization_task13_legacy_column_snapshots snap
          cross join lateral jsonb_object_keys(coalesce(snap.allowed_sub_modules, '{}'::jsonb))
          where snap.cutover_id = v_task13_cutover_id)
      + (select count(*) from app_private.authorization_task13_legacy_column_snapshots snap
          cross join lateral jsonb_object_keys(coalesce(snap.admin_sub_modules, '{}'::jsonb))
          where snap.cutover_id = v_task13_cutover_id)
    ),
    'legacyFallbackDisabled', app_private.permission_hardening_flag('legacy_fallback_disabled'),
    'legacyGovernanceFallbackDisabled', app_private.permission_hardening_flag('legacy_governance_fallback_disabled'),
    'legacyProjectionEnabled', app_private.permission_hardening_flag('legacy_projection_enabled'),
    'dispositions', (
      select coalesce(jsonb_object_agg(disposition, item_count), '{}'::jsonb)
      from (
        select disposition, count(*) item_count
        from app_private.authorization_legacy_migration_dispositions
        where cutover_id = v_cutover_id
        group by disposition order by disposition
      ) counts
    ),
    'generatedAt', now()
  );
end;
$function$;

drop function public.list_authorization_principals();
drop function app_private.list_authorization_principals_impl();
CREATE OR REPLACE FUNCTION app_private.list_authorization_principals_impl()
 RETURNS TABLE(user_id uuid, name text, email text, account_status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_user_id uuid := public.current_app_user_id();
begin
  if not app_private.has_permission(
    v_actor_user_id,
    'system.authorization.view',
    'global',
    '*'
  ) then
    raise exception 'Not allowed to view authorization principals'
      using errcode = '42501';
  end if;

  return query
  select
    user_row.id,
    user_row.name,
    user_row.email,
    user_row.account_status
  from public.users user_row
  order by user_row.name, user_row.email, user_row.id;
end;
$function$;
revoke all on function app_private.list_authorization_principals_impl() from public, anon, service_role;
grant execute on function app_private.list_authorization_principals_impl() to authenticated;

CREATE OR REPLACE FUNCTION public.list_authorization_principals()
 RETURNS TABLE(user_id uuid, name text, email text, account_status text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select *
  from app_private.list_authorization_principals_impl();
$function$;
revoke all on function public.list_authorization_principals() from public, anon;
grant execute on function public.list_authorization_principals() to authenticated, service_role;

-- 3. Legacy-only objects: old permission command (p_legacy_state, no app caller, not executable by authenticated),
--    projection into the legacy columns, and the legacy write guard trigger.
drop function public.apply_user_permission_change(uuid, text, jsonb, jsonb, text, jsonb);
drop function public.preview_user_permission_change(uuid, jsonb, jsonb);
drop function app_private.apply_user_permission_change_impl(uuid, text, jsonb, jsonb, text, jsonb);
drop function app_private.preview_user_permission_change_impl(uuid, jsonb, jsonb);
drop function app_private.sync_legacy_permission_projection(uuid);
drop trigger trg_users_guard_legacy_permission_writes on public.users;
drop function app_private.guard_and_audit_legacy_permission_write();

-- 4. Dependency gate, then drop the columns.
do $$
declare v_left text;
begin
  select string_agg(n.nspname || '.' || p.proname, ', ') into v_left
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname not in ('pg_catalog', 'information_schema')
    and p.prosrc ~ '(allowed_modules|admin_modules|allowed_sub_modules|admin_sub_modules)'
    and p.proname not in ('normalize_legacy_permission_state', 'get_permission_health_summary_legacy_base',
      'get_authorization_legacy_migration_summary', 'authorization_task13_snapshot_digest');
  if v_left is not null then
    raise exception 'Task 13 stop: routines still reference legacy columns: %', v_left;
  end if;
  if exists (select 1 from pg_depend where refobjid = 'public.users'::regclass and refobjsubid in (
      select attnum from pg_attribute where attrelid = 'public.users'::regclass
        and attname in ('allowed_modules', 'admin_modules', 'allowed_sub_modules', 'admin_sub_modules'))) then
    raise exception 'Task 13 stop: objects still depend on legacy columns';
  end if;
end $$;

alter table public.users drop column allowed_modules;
alter table public.users drop column admin_modules;
alter table public.users drop column allowed_sub_modules;
alter table public.users drop column admin_sub_modules;
