do $$
begin
  if to_regprocedure('public.current_app_user_id()') is null then
    raise exception 'Missing public.current_app_user_id()';
  end if;
  if to_regprocedure('public.enforce_active_app_actor()') is null then
    raise exception 'Missing public.enforce_active_app_actor()';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'users'
      and column_name = 'account_status'
  ) then
    raise exception 'Missing users.account_status';
  end if;
  if has_table_privilege('authenticated', 'public.users', 'DELETE') then
    raise exception 'authenticated still has DELETE on public.users';
  end if;
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'users'
      and policyname = 'users_active_actor_gate'
      and permissive = 'RESTRICTIVE'
  ) then
    raise exception 'Missing restrictive active actor gate on public.users';
  end if;
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
      and not exists (
        select 1
        from pg_policies p
        where p.schemaname = n.nspname
          and p.tablename = c.relname
          and p.policyname = left(c.relname || '_active_actor_gate', 63)
          and p.permissive = 'RESTRICTIVE'
          and 'authenticated' = any(p.roles)
      )
  ) then
    raise exception 'At least one RLS-enabled public table lacks the active actor gate';
  end if;
  if to_regclass('storage.objects') is not null and not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and p.policyname = 'storage_objects_active_actor_gate'
      and p.permissive = 'RESTRICTIVE'
      and 'authenticated' = any(p.roles)
  ) then
    raise exception 'storage.objects lacks the active actor gate';
  end if;
end;
$$;

create temp table active_actor_smoke_ids (
  active_id uuid not null,
  disabled_id uuid not null,
  active_email text not null,
  disabled_email text not null
) on commit drop;

insert into active_actor_smoke_ids
values (
  gen_random_uuid(),
  gen_random_uuid(),
  'active-actor-smoke@vioo.local',
  'disabled-actor-smoke@vioo.local'
);

grant select on active_actor_smoke_ids to authenticated;

delete from public.users
where email in (
  select active_email from active_actor_smoke_ids
  union all
  select disabled_email from active_actor_smoke_ids
);

insert into public.users (
  id, name, email, username, role, is_active, account_status,
  allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules
)
select active_id, 'Active Actor Smoke', active_email, 'active-actor-smoke',
       'EMPLOYEE'::public.user_role, true, 'ACTIVE', '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from active_actor_smoke_ids
union all
select disabled_id, 'Disabled Actor Smoke', disabled_email, 'disabled-actor-smoke',
       'EMPLOYEE'::public.user_role, false, 'DISABLED', '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from active_actor_smoke_ids;

set role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'email', (select active_email from active_actor_smoke_ids),
    'sub', gen_random_uuid()::text
  )::text,
  true
);

do $$
begin
  if public.current_app_user_id() is distinct from (select active_id from active_actor_smoke_ids) then
    raise exception 'Active profile did not resolve';
  end if;
  perform public.enforce_active_app_actor();
  begin
    update public.users
    set disabled_reason = 'client tamper attempt'
    where id = (select active_id from active_actor_smoke_ids);
    raise exception 'Active user changed protected lifecycle metadata';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'email', (select disabled_email from active_actor_smoke_ids),
    'sub', gen_random_uuid()::text
  )::text,
  true
);

do $$
begin
  if public.current_app_user_id() is not null then
    raise exception 'Disabled profile resolved as an active actor';
  end if;
  begin
    perform public.enforce_active_app_actor();
    raise exception 'Disabled actor passed the pre-request guard';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;
delete from public.users
where id in (
  select active_id from active_actor_smoke_ids
  union all
  select disabled_id from active_actor_smoke_ids
);
