alter table public.user_permission_grants
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid references public.users(id) on delete set null,
  add column if not exists revoked_reason text;

create table if not exists app_private.user_account_operations (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  target_user_id uuid not null references public.users(id) on delete restrict,
  requested_by uuid not null references public.users(id) on delete restrict,
  action text not null check (action in ('DISABLE', 'REACTIVATE')),
  status text not null default 'PREPARED'
    check (status in ('PREPARED', 'DB_APPLIED', 'AUTH_RETRY', 'COMPLETED')),
  reason text not null,
  auth_id uuid,
  before_state jsonb not null default '{}'::jsonb,
  auth_result jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

revoke all on table app_private.user_account_operations from public, anon, authenticated;

create unique index if not exists ux_user_account_operations_unfinished
  on app_private.user_account_operations (target_user_id)
  where status <> 'COMPLETED';

alter table public.users
  add column if not exists account_operation_status text not null default 'IDLE',
  add column if not exists account_operation_action text;

alter table public.users
  drop constraint if exists users_account_operation_status_check,
  drop constraint if exists users_account_operation_consistency_check;

alter table public.users
  add constraint users_account_operation_status_check
    check (account_operation_status in ('IDLE', 'PENDING', 'AUTH_RETRY')),
  add constraint users_account_operation_consistency_check
    check (
      (account_operation_status = 'IDLE' and account_operation_action is null)
      or (
        account_operation_status in ('PENDING', 'AUTH_RETRY')
        and account_operation_action in ('DISABLE', 'REACTIVATE')
      )
    );

-- Preserve the existing self-update boundary while allowing only the trusted
-- service-role lifecycle transaction to change protected account fields.
create or replace function app_private.prevent_users_privilege_self_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid;
begin
  if auth.role() = 'service_role'
    and coalesce(current_setting('app.account_lifecycle_command', true), '') = 'on'
  then
    return new;
  end if;

  if public.is_admin() then
    return new;
  end if;

  current_user_id := public.current_app_user_id();

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
    or old.allowed_modules is distinct from new.allowed_modules
    or old.admin_modules is distinct from new.admin_modules
    or old.allowed_sub_modules is distinct from new.allowed_sub_modules
    or old.admin_sub_modules is distinct from new.admin_sub_modules
    or old.is_active is distinct from new.is_active
  then
    raise exception 'Self profile updates cannot change protected permission fields'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function app_private.prevent_users_privilege_self_update()
  from public, anon, authenticated;

create or replace function app_private.guard_user_account_lifecycle_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.account_status is distinct from new.account_status
    or old.disabled_at is distinct from new.disabled_at
    or old.disabled_by is distinct from new.disabled_by
    or old.disabled_reason is distinct from new.disabled_reason
    or old.reactivated_at is distinct from new.reactivated_at
    or old.reactivated_by is distinct from new.reactivated_by
    or old.reactivation_reason is distinct from new.reactivation_reason
    or old.account_operation_status is distinct from new.account_operation_status
    or old.account_operation_action is distinct from new.account_operation_action
  then
    if auth.role() = 'service_role'
      and coalesce(current_setting('app.account_lifecycle_command', true), '') = 'on'
    then
      return new;
    end if;

    raise exception 'Account lifecycle metadata can only be changed by the trusted command'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function app_private.guard_user_account_lifecycle_metadata()
  from public, anon, authenticated;

create or replace function app_private.assert_active_principal(p_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or not exists (
    select 1
    from public.users u
    where u.id = p_user_id
      and u.is_active
      and u.account_status = 'ACTIVE'
  ) then
    raise exception 'Active application principal required'
      using errcode = '23514';
  end if;
end;
$$;

revoke all on function app_private.assert_active_principal(uuid) from public, anon, authenticated;

create or replace function app_private.guard_user_permission_grant_principal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_active then
    perform app_private.assert_active_principal(new.user_id);
  end if;
  return new;
end;
$$;

create or replace function app_private.guard_responsibility_slot_principal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' then
    perform app_private.assert_active_principal(new.assignee_user_id);
  end if;
  return new;
end;
$$;

create or replace function app_private.guard_assignment_principal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' then
    perform app_private.assert_active_principal(new.principal_id);
  end if;
  return new;
end;
$$;

create or replace function app_private.guard_project_staff_principal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  if new.end_date is null then
    select u.id into v_user_id
    from public.users u
    where u.id::text = new.user_id
    limit 1;
    perform app_private.assert_active_principal(v_user_id);
  end if;
  return new;
end;
$$;

create or replace function app_private.guard_project_staff_permission_principal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  if coalesce(new.is_active, true) then
    select u.id into v_user_id
    from public.project_staff ps
    join public.users u on u.id::text = ps.user_id
    where ps.id = new.staff_id
    limit 1;
    perform app_private.assert_active_principal(v_user_id);
  end if;
  return new;
end;
$$;

revoke all on function app_private.guard_user_permission_grant_principal() from public, anon, authenticated;
revoke all on function app_private.guard_responsibility_slot_principal() from public, anon, authenticated;
revoke all on function app_private.guard_assignment_principal() from public, anon, authenticated;
revoke all on function app_private.guard_project_staff_principal() from public, anon, authenticated;
revoke all on function app_private.guard_project_staff_permission_principal() from public, anon, authenticated;

drop trigger if exists trg_user_permission_grants_active_principal on public.user_permission_grants;
create trigger trg_user_permission_grants_active_principal
  before insert or update of user_id, is_active on public.user_permission_grants
  for each row execute function app_private.guard_user_permission_grant_principal();

drop trigger if exists trg_app_responsibility_slots_active_principal on public.app_responsibility_slots;
create trigger trg_app_responsibility_slots_active_principal
  before insert or update of assignee_user_id, status on public.app_responsibility_slots
  for each row execute function app_private.guard_responsibility_slot_principal();

drop trigger if exists trg_app_assignments_active_principal on public.app_assignments;
create trigger trg_app_assignments_active_principal
  before insert or update of principal_id, status on public.app_assignments
  for each row execute function app_private.guard_assignment_principal();

drop trigger if exists trg_project_staff_active_principal on public.project_staff;
create trigger trg_project_staff_active_principal
  before insert or update of user_id, end_date on public.project_staff
  for each row execute function app_private.guard_project_staff_principal();

drop trigger if exists trg_project_staff_permissions_active_principal on public.project_staff_permissions;
create trigger trg_project_staff_permissions_active_principal
  before insert or update of staff_id, is_active on public.project_staff_permissions
  for each row execute function app_private.guard_project_staff_permission_principal();

create or replace function app_private.assert_legacy_system_admin(p_actor_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.users u
    where u.id = p_actor_user_id
      and u.role = 'ADMIN'
      and u.is_active
      and u.account_status = 'ACTIVE'
  ) then
    raise exception 'Active System Admin required'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function app_private.assert_legacy_system_admin(uuid) from public, anon, authenticated;

create or replace function app_private.revoke_user_access_sources(
  p_target_user_id uuid,
  p_actor_user_id uuid,
  p_operation_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot public.app_responsibility_slots%rowtype;
  v_assignment public.app_assignments%rowtype;
  v_direct_grants integer := 0;
  v_project_permissions integer := 0;
  v_project_staff integer := 0;
  v_slots integer := 0;
  v_assignments integer := 0;
begin
  update public.user_permission_grants
  set is_active = false,
      revoked_at = coalesce(revoked_at, now()),
      revoked_by = coalesce(revoked_by, p_actor_user_id),
      revoked_reason = coalesce(revoked_reason, p_reason),
      updated_at = now()
  where user_id = p_target_user_id
    and is_active;
  get diagnostics v_direct_grants = row_count;

  update public.project_staff_permissions psp
  set is_active = false
  from public.project_staff ps
  where psp.staff_id = ps.id
    and ps.user_id = p_target_user_id::text
    and coalesce(psp.is_active, true);
  get diagnostics v_project_permissions = row_count;

  update public.project_staff
  set end_date = current_date,
      updated_at = now()
  where user_id = p_target_user_id::text
    and end_date is null;
  get diagnostics v_project_staff = row_count;

  for v_slot in
    select *
    from public.app_responsibility_slots
    where assignee_user_id = p_target_user_id
      and status = 'active'
    for update
  loop
    update public.app_responsibility_slots
    set status = 'inactive',
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'needsReassignment', true,
          'accountOperationId', p_operation_id
        ),
        updated_at = now()
    where id = v_slot.id;

    insert into public.app_responsibility_slot_events (
      responsibility_slot_id,
      event_type,
      actor_user_id,
      before_data,
      after_data
    )
    select
      v_slot.id,
      'updated',
      p_actor_user_id,
      to_jsonb(v_slot),
      to_jsonb(updated_slot)
    from public.app_responsibility_slots updated_slot
    where updated_slot.id = v_slot.id;

    v_slots := v_slots + 1;
  end loop;

  for v_assignment in
    select *
    from public.app_assignments
    where principal_id = p_target_user_id
      and status = 'active'
    for update
  loop
    update public.app_assignments
    set status = 'closed',
        closed_at = now(),
        closed_by = p_actor_user_id,
        close_reason = 'account_disabled',
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'needsReassignment', true,
          'accountOperationId', p_operation_id
        ),
        updated_at = now()
    where id = v_assignment.id;

    insert into public.app_assignment_events (
      assignment_id,
      event_type,
      actor_user_id,
      metadata
    )
    values (
      v_assignment.id,
      'closed',
      p_actor_user_id,
      jsonb_build_object(
        'reason', 'account_disabled',
        'needsReassignment', true,
        'operationId', p_operation_id
      )
    );

    v_assignments := v_assignments + 1;
  end loop;

  return jsonb_build_object(
    'directGrants', v_direct_grants,
    'projectPermissions', v_project_permissions,
    'projectStaffAssignments', v_project_staff,
    'responsibilitySlots', v_slots,
    'runtimeAssignments', v_assignments,
    'needsReassignment', v_slots + v_assignments
  );
end;
$$;

revoke all on function app_private.revoke_user_access_sources(uuid, uuid, uuid, text)
  from public, anon, authenticated;

create or replace function app_private.account_operation_response(
  p_operation app_private.user_account_operations
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'operationId', p_operation.id,
    'idempotencyKey', p_operation.idempotency_key,
    'targetUserId', p_operation.target_user_id,
    'requestedBy', p_operation.requested_by,
    'action', p_operation.action,
    'status', p_operation.status,
    'reason', p_operation.reason,
    'authId', p_operation.auth_id,
    'authResult', p_operation.auth_result,
    'revocationSummary', p_operation.before_state -> 'revocationSummary',
    'lastError', p_operation.last_error,
    'createdAt', p_operation.created_at,
    'updatedAt', p_operation.updated_at,
    'completedAt', p_operation.completed_at
  );
$$;

revoke all on function app_private.account_operation_response(app_private.user_account_operations) from public, anon, authenticated;

create or replace function public.get_user_account_lifecycle_preview(p_target_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := public.current_app_user_id();
  v_result jsonb;
begin
  perform app_private.assert_legacy_system_admin(v_actor_user_id);

  select jsonb_build_object(
    'targetUserId', u.id,
    'accountStatus', u.account_status,
    'operationStatus', u.account_operation_status,
    'operationAction', u.account_operation_action,
    'hasAuthIdentity', u.auth_id is not null,
    'directGrants', (
      select count(*) from public.user_permission_grants g
      where g.user_id = u.id and g.is_active
    ),
    'legacyModules', cardinality(coalesce(u.allowed_modules, '{}'::text[]))
      + cardinality(coalesce(u.admin_modules, '{}'::text[])),
    'projectStaffAssignments', (
      select count(*) from public.project_staff ps
      where ps.user_id = u.id::text and ps.end_date is null
    ),
    'responsibilitySlots', (
      select count(*) from public.app_responsibility_slots slot
      where slot.assignee_user_id = u.id and slot.status = 'active'
    ),
    'runtimeAssignments', (
      select count(*) from public.app_assignments assignment_row
      where assignment_row.principal_id = u.id and assignment_row.status = 'active'
    )
  )
  into v_result
  from public.users u
  where u.id = p_target_user_id;

  if v_result is null then
    raise exception 'Target user does not exist'
      using errcode = 'P0002';
  end if;

  return v_result;
end;
$$;

revoke all on function public.get_user_account_lifecycle_preview(uuid) from public, anon;
grant execute on function public.get_user_account_lifecycle_preview(uuid) to authenticated;

create or replace function public.prepare_user_account_lifecycle(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_action text,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
      'allowedModules', v_target.allowed_modules,
      'adminModules', v_target.admin_modules,
      'allowedSubModules', v_target.allowed_sub_modules,
      'adminSubModules', v_target.admin_sub_modules,
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
        allowed_modules = '{}'::text[],
        admin_modules = '{}'::text[],
        allowed_sub_modules = '{}'::jsonb,
        admin_sub_modules = '{}'::jsonb,
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
$$;

revoke all on function public.prepare_user_account_lifecycle(uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.prepare_user_account_lifecycle(uuid, uuid, text, text, uuid) to service_role;

create or replace function public.complete_user_account_lifecycle(
  p_actor_user_id uuid,
  p_operation_id uuid,
  p_auth_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
        allowed_modules = '{}'::text[],
        admin_modules = '{}'::text[],
        allowed_sub_modules = '{}'::jsonb,
        admin_sub_modules = '{}'::jsonb,
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
$$;

revoke all on function public.complete_user_account_lifecycle(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.complete_user_account_lifecycle(uuid, uuid, jsonb) to service_role;

create or replace function public.fail_user_account_lifecycle(
  p_actor_user_id uuid,
  p_operation_id uuid,
  p_error text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation app_private.user_account_operations%rowtype;
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
$$;

revoke all on function public.fail_user_account_lifecycle(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.fail_user_account_lifecycle(uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
