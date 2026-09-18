-- Task 12.4.2-C: atomic account-role and SYSTEM_ADMIN mirror transition.

create or replace function app_private.change_user_account_role_v2_impl(
  p_user_id uuid,
  p_role text,
  p_warehouse_id text,
  p_expected_updated_at timestamptz,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_target public.users%rowtype;
  v_after public.users%rowtype;
  v_system_template public.role_permission_templates%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_next_role public.user_role;
  v_next_warehouse_id text;
  v_activated_assignment_id uuid;
  v_revoked_assignment_ids uuid[] := array[]::uuid[];
  v_audit_id uuid;
begin
  v_actor_id := app_private.assert_authorization_permission(
    'system.authorization.manage_roles'
  );
  if not app_private.has_permission(
    v_actor_id,
    'system.authorization.manage_grants',
    'global',
    '*'
  ) then
    raise exception 'Authorization grant administration permission required'
      using errcode = '42501';
  end if;
  if char_length(v_reason) < 10 then
    raise exception 'Account role transition reason required'
      using errcode = '22023';
  end if;
  if p_expected_updated_at is null then
    raise exception 'Expected user version required'
      using errcode = '22023';
  end if;

  begin
    v_next_role := p_role::public.user_role;
  exception when invalid_text_representation then
    raise exception 'Unsupported account role: %', p_role using errcode = '22023';
  end;
  if v_next_role::text <> all(array['ADMIN', 'WAREHOUSE_KEEPER', 'EMPLOYEE']::text[]) then
    raise exception 'Unsupported account role: %', p_role using errcode = '22023';
  end if;

  -- Serializes last-admin decisions and protects concurrent demotions.
  perform pg_advisory_xact_lock(hashtext('authorization_v2_account_role_transition'));

  select * into v_target
  from public.users
  where id = p_user_id
  for update;

  if v_target.id is null or not v_target.is_active or v_target.account_status <> 'ACTIVE' then
    raise exception 'Active target user required' using errcode = '23514';
  end if;
  if v_target.updated_at is distinct from p_expected_updated_at then
    raise exception 'User authorization version changed'
      using errcode = '40001',
        detail = jsonb_build_object(
          'code', 'stale_version',
          'field', 'expectedUpdatedAt',
          'message', 'Tài khoản đã thay đổi. Hãy tải lại trước khi lưu.'
        )::text;
  end if;
  if v_actor_id = v_target.id and v_target.role <> 'ADMIN' and v_next_role = 'ADMIN' then
    raise exception 'Self promotion to administrator is not allowed' using errcode = '42501';
  end if;

  if v_next_role = 'WAREHOUSE_KEEPER' then
    if nullif(btrim(coalesce(p_warehouse_id, '')), '') is null then
      raise exception 'Warehouse scope is required for warehouse keeper' using errcode = '22023';
    end if;
    v_next_warehouse_id := case when p_warehouse_id = '*' then null else p_warehouse_id end;
    if v_next_warehouse_id is not null and not exists (
      select 1 from public.warehouses
      where id = v_next_warehouse_id and not coalesce(is_archived, false)
    ) then
      raise exception 'Assigned warehouse does not exist or is archived' using errcode = '23503';
    end if;
  else
    v_next_warehouse_id := null;
  end if;

  select * into v_system_template
  from public.role_permission_templates
  where code = 'SYSTEM_ADMIN' and is_active
  for update;
  if v_system_template.id is null then
    raise exception 'SYSTEM_ADMIN role template is unavailable' using errcode = '55000';
  end if;

  perform set_config('app.authorization_permission_command', 'on', true);
  update public.users
  set role = v_next_role,
      assigned_warehouse_id = v_next_warehouse_id,
      updated_at = now()
  where id = v_target.id
  returning * into v_after;

  if v_next_role = 'ADMIN' then
    select assignment_row.id into v_activated_assignment_id
    from public.principal_role_assignments assignment_row
    where assignment_row.principal_type = 'user'
      and assignment_row.principal_id = v_target.id
      and assignment_row.role_template_id = v_system_template.id
      and assignment_row.scope_type = 'global'
      and assignment_row.scope_id = '*'
      and assignment_row.status = 'ACTIVE'
    for update;

    if v_activated_assignment_id is null then
      insert into public.principal_role_assignments (
        principal_type, principal_id, role_template_id, scope_type, scope_id,
        starts_at, status, assigned_by, assigned_reason
      ) values (
        'user', v_target.id, v_system_template.id, 'global', '*',
        now(), 'ACTIVE', v_actor_id, v_reason
      ) returning id into v_activated_assignment_id;
    end if;
  else
    with revoked as (
      update public.principal_role_assignments assignment_row
      set status = 'REVOKED',
          revoked_at = now(),
          revoked_by = v_actor_id,
          revoked_reason = v_reason,
          updated_at = now()
      where assignment_row.principal_type = 'user'
        and assignment_row.principal_id = v_target.id
        and assignment_row.role_template_id = v_system_template.id
        and assignment_row.status = 'ACTIVE'
      returning assignment_row.id
    )
    select coalesce(array_agg(id), array[]::uuid[])
    into v_revoked_assignment_ids
    from revoked;
  end if;

  insert into public.permission_audit_events (
    actor_user_id, target_user_id, event_type, before_grants, after_grants, metadata
  ) values (
    v_actor_id,
    v_target.id,
    'account_role_transitioned',
    jsonb_build_array(jsonb_build_object(
      'role', v_target.role,
      'assignedWarehouseId', v_target.assigned_warehouse_id
    )),
    jsonb_build_array(jsonb_build_object(
      'role', v_after.role,
      'assignedWarehouseId', v_after.assigned_warehouse_id
    )),
    jsonb_build_object(
      'reason', v_reason,
      'activatedAssignmentId', v_activated_assignment_id,
      'revokedAssignmentIds', to_jsonb(v_revoked_assignment_ids)
    )
  ) returning id into v_audit_id;

  return jsonb_build_object(
    'userId', v_after.id,
    'updatedAt', v_after.updated_at,
    'role', v_after.role,
    'assignedWarehouseId', v_after.assigned_warehouse_id,
    'activatedAssignmentId', v_activated_assignment_id,
    'revokedAssignmentIds', to_jsonb(v_revoked_assignment_ids),
    'auditEventId', v_audit_id
  );
end;
$$;

create or replace function public.change_user_account_role_v2(
  p_user_id uuid,
  p_role text,
  p_warehouse_id text,
  p_expected_updated_at timestamptz,
  p_reason text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.change_user_account_role_v2_impl(
    p_user_id,
    p_role,
    p_warehouse_id,
    p_expected_updated_at,
    p_reason
  );
$$;

revoke all on function app_private.change_user_account_role_v2_impl(uuid, text, text, timestamptz, text)
from public, anon, authenticated;
grant execute on function app_private.change_user_account_role_v2_impl(uuid, text, text, timestamptz, text)
to authenticated, service_role;

revoke all on function public.change_user_account_role_v2(uuid, text, text, timestamptz, text)
from public, anon, authenticated;
grant execute on function public.change_user_account_role_v2(uuid, text, text, timestamptz, text)
to authenticated, service_role;
