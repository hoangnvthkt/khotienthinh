-- Cloud-only Task 12.4.2-C smoke. All role, assignment and audit writes roll back.
begin;

create temporary table task12_4_2_role_context on commit drop as
select
  (select u.id from public.users u
   where u.is_active and u.account_status = 'ACTIVE' and u.role::text = 'ADMIN'
   order by u.id limit 1) as actor_id,
  (select u.auth_id from public.users u
   where u.is_active and u.account_status = 'ACTIVE' and u.role::text = 'ADMIN'
   order by u.id limit 1) as actor_auth_id,
  (select u.id from public.users u
   where u.is_active and u.account_status = 'ACTIVE' and u.role::text = 'EMPLOYEE'
     and u.auth_id is not null
     and not exists (select 1 from public.user_application_memberships m where m.user_id = u.id)
   order by u.id limit 1) as target_id,
  (select u.id from public.users u
   where u.is_active and u.account_status = 'ACTIVE' and u.role::text = 'ADMIN'
  order by u.id limit 1) as only_admin_id;

grant select on task12_4_2_role_context to authenticated;

do $$
begin
  if exists (
    select 1 from task12_4_2_role_context
    where actor_id is null or actor_auth_id is null or target_id is null
  ) then
    raise exception 'Role-transition smoke fixtures unavailable';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', actor_auth_id::text, true)
from task12_4_2_role_context;
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare
  v_target_id uuid := (select target_id from task12_4_2_role_context);
  v_version timestamptz;
  v_receipt jsonb;
  v_system_template_id uuid;
begin
  select updated_at into v_version from public.users where id = v_target_id;

  begin
    perform public.change_user_account_role_v2(
      v_target_id, 'WAREHOUSE_KEEPER', '*', v_version - interval '1 second',
      'Task 12.4.2 stale version test'
    );
    raise exception 'Stale transition unexpectedly succeeded';
  exception when serialization_failure then
    null;
  end;

  v_receipt := public.change_user_account_role_v2(
    v_target_id, 'WAREHOUSE_KEEPER', '*', v_version,
    'Task 12.4.2 assign all warehouses'
  );
  if v_receipt->>'role' <> 'WAREHOUSE_KEEPER'
    or (v_receipt->'assignedWarehouseId') <> 'null'::jsonb
  then
    raise exception 'Warehouse-keeper receipt is inconsistent: %', v_receipt;
  end if;

  select updated_at into v_version from public.users where id = v_target_id;
  v_receipt := public.change_user_account_role_v2(
    v_target_id, 'ADMIN', null, v_version,
    'Task 12.4.2 promote fixture admin'
  );
  select id into v_system_template_id
  from public.role_permission_templates where code = 'SYSTEM_ADMIN';
  if not exists (
    select 1 from public.principal_role_assignments
    where principal_type = 'user'
      and principal_id = v_target_id
      and role_template_id = v_system_template_id
      and scope_type = 'global' and scope_id = '*' and status = 'ACTIVE'
  ) then
    raise exception 'Admin promotion did not create SYSTEM_ADMIN mirror';
  end if;

  select updated_at into v_version from public.users where id = v_target_id;
  v_receipt := public.change_user_account_role_v2(
    v_target_id, 'EMPLOYEE', null, v_version,
    'Task 12.4.2 demote fixture employee'
  );
  if exists (
    select 1 from public.principal_role_assignments
    where principal_type = 'user'
      and principal_id = v_target_id
      and role_template_id = v_system_template_id
      and status = 'ACTIVE'
  ) then
    raise exception 'Admin demotion retained active SYSTEM_ADMIN mirror';
  end if;

  if not exists (
    select 1 from public.permission_audit_events
    where target_user_id = v_target_id and event_type = 'account_role_transitioned'
  ) then
    raise exception 'Role transition audit receipt is missing';
  end if;
end;
$$;

-- The production database currently has one active Admin. Its demotion must
-- remain blocked; the fixture promotion above has already been demoted.
do $$
declare
  v_admin_id uuid := (select only_admin_id from task12_4_2_role_context);
  v_version timestamptz;
begin
  select updated_at into v_version from public.users where id = v_admin_id;
  begin
    perform public.change_user_account_role_v2(
      v_admin_id, 'EMPLOYEE', null, v_version,
      'Task 12.4.2 last administrator guard'
    );
    raise exception 'Last administrator demotion unexpectedly succeeded';
  exception when object_not_in_prerequisite_state then
    null;
  end;
end;
$$;

reset role;
rollback;
