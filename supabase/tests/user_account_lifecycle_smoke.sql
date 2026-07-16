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
  reactivate_operation_id uuid
) on commit drop;

insert into account_lifecycle_smoke_ids
values (
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), null, null
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

update account_lifecycle_smoke_ids
set disable_operation_id = (
  public.prepare_user_account_lifecycle(
    admin_id,
    target_id,
    'DISABLE',
    'Nhân viên nghỉ việc',
    disable_key
  ) ->> 'operationId'
)::uuid;

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
end;
$$;

reset role;
delete from public.permission_audit_events
where target_user_id in (select target_id from account_lifecycle_smoke_ids);
delete from public.user_permission_grants
where user_id in (select target_id from account_lifecycle_smoke_ids);
delete from app_private.user_account_operations
where target_user_id in (select target_id from account_lifecycle_smoke_ids);
delete from public.users
where id in (
  select admin_id from account_lifecycle_smoke_ids
  union all
  select backup_admin_id from account_lifecycle_smoke_ids
  union all
  select target_id from account_lifecycle_smoke_ids
);
