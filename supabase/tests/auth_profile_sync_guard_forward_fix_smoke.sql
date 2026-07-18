do $$
declare
  v_definition text;
begin
  select lower(regexp_replace(pg_get_functiondef(function_row.oid), '\s+', ' ', 'g'))
  into v_definition
  from pg_proc function_row
  join pg_namespace namespace_row on namespace_row.oid = function_row.pronamespace
  where namespace_row.nspname = 'app_private'
    and function_row.proname = 'prevent_users_privilege_self_update'
    and function_row.pronargs = 0;

  if v_definition is null then
    raise exception 'Missing users privilege guard';
  end if;
  if position(
    'if session_user = ''supabase_auth_admin'' then return new; end if;'
    in v_definition
  ) = 0 then
    raise exception 'Missing narrow supabase_auth_admin bypass';
  end if;
  if v_definition !~
    'if auth\.role\(\) = ''service_role'' and coalesce\(current_setting\(''app\.account_lifecycle_command'', true\), ''''\) = ''on'' then return new; end if;'
  then
    raise exception 'Missing lifecycle-gated service_role bypass';
  end if;
  if v_definition ~
    'session_user = ''supabase_auth_admin''\s+or\s+auth\.role\(\) = ''service_role'''
  then
    raise exception 'Broad service_role bypass was restored';
  end if;
  if position('set search_path to ''''' in v_definition) = 0
    or position('security definer' in v_definition) = 0
  then
    raise exception 'Privilege guard lost SECURITY DEFINER or empty search_path';
  end if;
end;
$$;

create temp table auth_profile_sync_guard_fixture
on commit drop
as
select *
from public.users
limit 1;

do $$
begin
  if (select count(*) from auth_profile_sync_guard_fixture) <> 1 then
    raise exception 'Auth guard smoke requires one existing app profile';
  end if;
end;
$$;

create trigger trg_auth_profile_sync_guard_fixture
before update on auth_profile_sync_guard_fixture
for each row execute function app_private.prevent_users_privilege_self_update();

grant select, update on auth_profile_sync_guard_fixture
  to authenticated, service_role;

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);

do $$
begin
  begin
    update auth_profile_sync_guard_fixture set name = name;
    raise exception 'Authenticated actor bypassed the users privilege guard';
  exception
    when sqlstate '42501' then null;
  end;
end;
$$;

reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('app.account_lifecycle_command', '', true);

do $$
begin
  begin
    update auth_profile_sync_guard_fixture set name = name;
    raise exception 'service_role bypassed without lifecycle command';
  exception
    when sqlstate '42501' then null;
  end;
end;
$$;

select set_config('app.account_lifecycle_command', 'on', true);
update auth_profile_sync_guard_fixture set name = name;
reset role;

do $$
begin
  if has_function_privilege(
    'anon',
    'app_private.prevent_users_privilege_self_update()',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'app_private.prevent_users_privilege_self_update()',
    'EXECUTE'
  ) or exists (
    select 1
    from pg_proc function_row
    cross join lateral aclexplode(
      coalesce(function_row.proacl, acldefault('f', function_row.proowner))
    ) acl
    where function_row.oid =
      'app_private.prevent_users_privilege_self_update()'::regprocedure
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'Privilege guard is executable by PUBLIC, anon or authenticated';
  end if;
end;
$$;

select 'auth_profile_sync_guard_forward_fix_smoke_passed' as checkpoint;
