-- Phase 2 forward integration with the Phase 1 account lifecycle.

create or replace function app_private.revoke_business_roles_on_account_disable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revoked_count integer := 0;
  v_operation_id uuid;
begin
  if old.account_status = 'ACTIVE' and new.account_status = 'DISABLED' then
    if old.role = 'ADMIN' then
      perform app_private.assert_rollout_operator_continuity(null, new.id);
    end if;

    select operation_row.id
    into v_operation_id
    from app_private.user_account_operations operation_row
    where operation_row.target_user_id = new.id
      and operation_row.status = 'PREPARED'
      and operation_row.action = 'DISABLE'
    order by operation_row.created_at
    limit 1
    for update;

    update public.principal_role_assignments assignment_row
    set status = 'REVOKED',
        revoked_at = coalesce(assignment_row.revoked_at, now()),
        revoked_by = coalesce(assignment_row.revoked_by, new.disabled_by),
        revoked_reason = coalesce(
          assignment_row.revoked_reason,
          'account_disabled: ' || coalesce(new.disabled_reason, 'Account disabled')
        ),
        updated_at = now()
    where assignment_row.principal_type = 'user'
      and assignment_row.principal_id = new.id
      and assignment_row.status in ('ACTIVE');
    get diagnostics v_revoked_count = row_count;

    if v_operation_id is not null then
      update app_private.user_account_operations
      set before_state = before_state || jsonb_build_object(
            'businessRoleAssignmentsRevoked', v_revoked_count
          ),
          updated_at = now()
      where id = v_operation_id;
    end if;

    if v_revoked_count > 0 then
      insert into public.permission_audit_events (
        actor_user_id,
        target_user_id,
        event_type,
        before_grants,
        after_grants,
        metadata
      )
      values (
        new.disabled_by,
        new.id,
        'business_roles_revoked_on_account_disable',
        '[]'::jsonb,
        '[]'::jsonb,
        jsonb_build_object(
          'operationId', v_operation_id,
          'revokedCount', v_revoked_count,
          'reason', new.disabled_reason
        )
      );
    end if;
  end if;

  return new;
end;
$$;

revoke all on function app_private.revoke_business_roles_on_account_disable()
  from public, anon, authenticated;

drop trigger if exists trg_users_revoke_business_roles_on_disable on public.users;
create trigger trg_users_revoke_business_roles_on_disable
  after update of account_status on public.users
  for each row execute function app_private.revoke_business_roles_on_account_disable();

create or replace function public.get_user_account_lifecycle_preview(
  p_target_user_id uuid
)
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
    'legacyModules', cardinality(coalesce(user_row.allowed_modules, '{}'::text[]))
      + cardinality(coalesce(user_row.admin_modules, '{}'::text[])),
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
$$;

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
    'revocationSummary',
      coalesce(p_operation.before_state -> 'revocationSummary', '{}'::jsonb)
      || jsonb_build_object(
        'businessRoleAssignments',
        coalesce(
          (p_operation.before_state ->> 'businessRoleAssignmentsRevoked')::integer,
          0
        )
      ),
    'lastError', p_operation.last_error,
    'createdAt', p_operation.created_at,
    'updatedAt', p_operation.updated_at,
    'completedAt', p_operation.completed_at
  );
$$;

revoke all on function app_private.account_operation_response(
  app_private.user_account_operations
) from public, anon, authenticated;
