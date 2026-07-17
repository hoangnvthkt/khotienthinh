do $$
begin
  if to_regprocedure('app_private.revoke_business_roles_on_account_disable()') is null
    or not exists (
      select 1
      from pg_trigger trigger_row
      where trigger_row.tgrelid = 'public.users'::regclass
        and trigger_row.tgname = 'trg_users_revoke_business_roles_on_disable'
        and not trigger_row.tgisinternal
    )
  then
    raise exception 'Business Role account lifecycle integration contract failed';
  end if;
end;
$$;

do $$
begin
  if to_regprocedure('public.prepare_user_account_lifecycle(uuid,uuid,text,text,uuid)') is null then
    raise exception 'Missing prepare lifecycle RPC';
  end if;
  if has_function_privilege('authenticated', 'public.prepare_user_account_lifecycle(uuid,uuid,text,text,uuid)', 'EXECUTE') then
    raise exception 'authenticated can execute prepare lifecycle RPC';
  end if;
  if not has_function_privilege('authenticated', 'public.get_user_account_lifecycle_preview(uuid)', 'EXECUTE') then
    raise exception 'authenticated admin cannot execute lifecycle preview RPC';
  end if;
end;
$$;

create temp table account_lifecycle_smoke_ids (
  admin_id uuid not null,
  backup_admin_id uuid not null,
  target_id uuid not null,
  disable_key uuid not null,
  reactivate_key uuid not null,
  disable_operation_id uuid,
  reactivate_operation_id uuid,
  disable_result jsonb
) on commit drop;

insert into account_lifecycle_smoke_ids
values (
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), null, null, null
);

grant select, update on account_lifecycle_smoke_ids to authenticated, service_role;

insert into public.users (
  id, name, email, username, role, is_active, account_status,
  allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules
)
select admin_id, 'Lifecycle Admin', 'lifecycle-admin@vioo.local', 'lifecycle-admin',
       'ADMIN'::public.user_role, true, 'ACTIVE', '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from account_lifecycle_smoke_ids
union all
select backup_admin_id, 'Lifecycle Backup Admin', 'lifecycle-backup@vioo.local', 'lifecycle-backup',
       'ADMIN'::public.user_role, true, 'ACTIVE', '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from account_lifecycle_smoke_ids
union all
select target_id, 'Lifecycle Target', 'lifecycle-target@vioo.local', 'lifecycle-target',
       'WAREHOUSE_KEEPER'::public.user_role, true, 'ACTIVE', array['WMS'], array['WMS'],
       '{"WMS":["/wms"]}'::jsonb, '{"WMS":["/wms"]}'::jsonb
from account_lifecycle_smoke_ids;

insert into public.user_permission_grants (
  user_id, permission_code, scope_type, scope_id, is_active
)
select target_id, 'system.wms.view', 'global', '*', true
from account_lifecycle_smoke_ids;

insert into public.principal_role_assignments (
  principal_type,
  principal_id,
  role_template_id,
  scope_type,
  scope_id,
  starts_at,
  status,
  assigned_reason
)
select 'user', target_id, role_row.id, 'global', '*', now(), 'ACTIVE',
       'Lifecycle smoke Business Role assignment'
from account_lifecycle_smoke_ids
join public.role_permission_templates role_row on role_row.code = 'AUDITOR'
union all
select 'user', admin_id, role_row.id, 'global', '*', now(), 'ACTIVE',
       'Lifecycle smoke durable rollout operator assignment'
from account_lifecycle_smoke_ids
join public.role_permission_templates role_row on role_row.code = 'PERMISSION_ADMIN';

set role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'email', 'lifecycle-admin@vioo.local',
    'sub', gen_random_uuid()::text
  )::text,
  true
);

do $$
declare
  preview jsonb;
begin
  preview := public.get_user_account_lifecycle_preview(
    (select target_id from account_lifecycle_smoke_ids)
  );
  if (preview ->> 'directGrants')::integer <> 1 then
    raise exception 'Lifecycle preview did not count active grants';
  end if;
  if (preview ->> 'businessRoleAssignments')::integer <> 1 then
    raise exception 'Lifecycle preview did not count active Business Roles';
  end if;
  begin
    update public.users
    set account_operation_status = 'PENDING',
        account_operation_action = 'DISABLE'
    where id = (select admin_id from account_lifecycle_smoke_ids);
    raise exception 'Authenticated admin changed lifecycle operation metadata directly';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set role service_role;

do $$
declare
  v_result jsonb;
begin
  select public.prepare_user_account_lifecycle(
    admin_id,
    target_id,
    'DISABLE',
    'Nhân viên nghỉ việc',
    disable_key
  )
  into v_result
  from account_lifecycle_smoke_ids;

  update account_lifecycle_smoke_ids
  set disable_operation_id = (v_result ->> 'operationId')::uuid,
      disable_result = v_result;

  if (v_result #>> '{revocationSummary,businessRoleAssignments}')::integer <> 1 then
    raise exception 'Lifecycle result omitted Business Role revocation count';
  end if;
end;
$$;

select public.fail_user_account_lifecycle(
  (select admin_id from account_lifecycle_smoke_ids),
  (select disable_operation_id from account_lifecycle_smoke_ids),
  'simulated Auth outage'
);

do $$
declare
  resumed jsonb;
begin
  if not exists (
    select 1 from public.users u
    where u.id = (select target_id from account_lifecycle_smoke_ids)
      and u.account_operation_status = 'AUTH_RETRY'
      and u.account_operation_action = 'DISABLE'
  ) then
    raise exception 'Auth retry state was not persisted on the target profile';
  end if;

  begin
    perform public.prepare_user_account_lifecycle(
      (select admin_id from account_lifecycle_smoke_ids),
      (select target_id from account_lifecycle_smoke_ids),
      'REACTIVATE',
      'Không được đảo action khi disable chưa hoàn tất',
      gen_random_uuid()
    );
    raise exception 'Opposite action started while disable remained unfinished';
  exception
    when sqlstate '55000' then null;
  end;

  resumed := public.prepare_user_account_lifecycle(
    (select admin_id from account_lifecycle_smoke_ids),
    (select target_id from account_lifecycle_smoke_ids),
    'DISABLE',
    'Thử lại khóa đăng nhập',
    gen_random_uuid()
  );
  if resumed ->> 'operationId' is distinct from (
    select disable_operation_id::text
    from account_lifecycle_smoke_ids
  ) then
    raise exception 'Fresh browser retry did not resume the unfinished operation';
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1 from public.users u
    where u.id = (select target_id from account_lifecycle_smoke_ids)
      and (u.is_active or u.account_status <> 'DISABLED')
  ) then
    raise exception 'Target account was not disabled';
  end if;
  if exists (
    select 1 from public.users u
    where u.id = (select target_id from account_lifecycle_smoke_ids)
      and (
        u.role <> 'EMPLOYEE'
        or cardinality(coalesce(u.allowed_modules, '{}'::text[])) <> 0
        or cardinality(coalesce(u.admin_modules, '{}'::text[])) <> 0
      )
  ) then
    raise exception 'Legacy rights were not cleared';
  end if;
  if exists (
    select 1 from public.user_permission_grants g
    where g.user_id = (select target_id from account_lifecycle_smoke_ids)
      and g.is_active
  ) then
    raise exception 'Direct grants remained active';
  end if;
  if not exists (
    select 1
    from public.principal_role_assignments assignment_row
    where assignment_row.principal_id = (
      select target_id from account_lifecycle_smoke_ids
    )
      and assignment_row.status = 'REVOKED'
      and assignment_row.revoked_at is not null
      and assignment_row.revoked_reason is not null
  ) then
    raise exception 'Account disable did not retain revoked Business Role history';
  end if;
  begin
    update public.user_permission_grants
    set is_active = true
    where user_id = (select target_id from account_lifecycle_smoke_ids);
    raise exception 'Disabled principal accepted a newly active grant';
  exception
    when check_violation then null;
  end;
end;
$$;

select public.complete_user_account_lifecycle(
  (select admin_id from account_lifecycle_smoke_ids),
  (select disable_operation_id from account_lifecycle_smoke_ids),
  '{"auth":"skipped_no_identity"}'::jsonb
);

update account_lifecycle_smoke_ids
set reactivate_operation_id = (
  public.prepare_user_account_lifecycle(
    admin_id,
    target_id,
    'REACTIVATE',
    'Nhân viên quay lại làm việc',
    reactivate_key
  ) ->> 'operationId'
)::uuid;

select public.complete_user_account_lifecycle(
  (select admin_id from account_lifecycle_smoke_ids),
  (select reactivate_operation_id from account_lifecycle_smoke_ids),
  '{"auth":"unbanned"}'::jsonb
);

do $$
begin
  if not exists (
    select 1 from public.users u
    where u.id = (select target_id from account_lifecycle_smoke_ids)
      and u.is_active
      and u.account_status = 'ACTIVE'
      and u.role = 'EMPLOYEE'
      and u.account_operation_status = 'IDLE'
      and u.account_operation_action is null
      and cardinality(coalesce(u.allowed_modules, '{}'::text[])) = 0
      and cardinality(coalesce(u.admin_modules, '{}'::text[])) = 0
  ) then
    raise exception 'Reactivated account did not start with zero legacy rights';
  end if;
  if exists (
    select 1 from public.user_permission_grants g
    where g.user_id = (select target_id from account_lifecycle_smoke_ids)
      and g.is_active
  ) then
    raise exception 'Reactivation restored direct grants';
  end if;
  if exists (
    select 1
    from public.principal_role_assignments assignment_row
    where assignment_row.principal_id = (
      select target_id from account_lifecycle_smoke_ids
    )
      and assignment_row.status = 'ACTIVE'
  ) then
    raise exception 'Account lifecycle left or restored an active Business Role';
  end if;
end;
$$;

do $$
declare
  v_admin_assignment_id uuid;
  v_denied boolean := false;
  v_result jsonb;
begin
  select assignment_row.id
  into v_admin_assignment_id
  from public.principal_role_assignments assignment_row
  where assignment_row.principal_id = (
    select admin_id from account_lifecycle_smoke_ids
  )
    and assignment_row.status = 'ACTIVE';

  update public.principal_role_assignments assignment_row
  set status = 'EXPIRED',
      updated_at = now()
  where assignment_row.status = 'ACTIVE'
    and assignment_row.id <> v_admin_assignment_id;

  begin
    perform public.prepare_user_account_lifecycle(
      (select backup_admin_id from account_lifecycle_smoke_ids),
      (select admin_id from account_lifecycle_smoke_ids),
      'DISABLE',
      'Không được vô hiệu hóa rollout operator cuối cùng',
      gen_random_uuid()
    );
  exception
    when sqlstate '55000' then v_denied := true;
  end;
  if not v_denied then
    raise exception 'Last durable rollout operator disable unexpectedly succeeded';
  end if;

  if not exists (
    select 1
    from public.users user_row
    where user_row.id = (select admin_id from account_lifecycle_smoke_ids)
      and user_row.role = 'ADMIN'
      and user_row.account_status = 'ACTIVE'
  ) then
    raise exception 'Failed rollout-operator disable did not roll back atomically';
  end if;

  insert into public.principal_role_assignments (
    principal_type,
    principal_id,
    role_template_id,
    scope_type,
    scope_id,
    starts_at,
    status,
    assigned_reason
  )
  select 'user', backup_admin_id, role_row.id, 'global', '*', now(), 'ACTIVE',
         'Lifecycle smoke backup rollout operator assignment'
  from account_lifecycle_smoke_ids
  join public.role_permission_templates role_row
    on role_row.code = 'PERMISSION_ADMIN';

  v_result := public.prepare_user_account_lifecycle(
    (select backup_admin_id from account_lifecycle_smoke_ids),
    (select admin_id from account_lifecycle_smoke_ids),
    'DISABLE',
    'Vô hiệu hóa sau khi có rollout operator dự phòng',
    gen_random_uuid()
  );

  if v_result #>> '{revocationSummary,businessRoleAssignments}' <> '1'
    or not exists (
      select 1
      from public.users user_row
      where user_row.id = (select admin_id from account_lifecycle_smoke_ids)
        and user_row.account_status = 'DISABLED'
    )
  then
    raise exception 'Admin disable did not use backup rollout continuity';
  end if;
end;
$$;

reset role;
delete from public.permission_audit_events
where target_user_id in (
  select target_id from account_lifecycle_smoke_ids
  union all
  select admin_id from account_lifecycle_smoke_ids
);
delete from public.principal_role_assignments
where principal_id in (
  select target_id from account_lifecycle_smoke_ids
  union all
  select admin_id from account_lifecycle_smoke_ids
  union all
  select backup_admin_id from account_lifecycle_smoke_ids
);
delete from public.user_permission_grants
where user_id in (select target_id from account_lifecycle_smoke_ids);
delete from app_private.user_account_operations
where target_user_id in (
  select target_id from account_lifecycle_smoke_ids
  union all
  select admin_id from account_lifecycle_smoke_ids
);
delete from public.users
where id in (
  select admin_id from account_lifecycle_smoke_ids
  union all
  select backup_admin_id from account_lifecycle_smoke_ids
  union all
  select target_id from account_lifecycle_smoke_ids
);
