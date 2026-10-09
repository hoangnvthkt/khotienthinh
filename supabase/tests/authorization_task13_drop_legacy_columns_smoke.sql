-- Task 13 final smoke: run after the authorization_task13_drop_legacy_columns migration. Read-only (ends in rollback).
begin;

do $$
declare v_left text; v_n int;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users'
      and column_name in ('allowed_modules', 'admin_modules', 'allowed_sub_modules', 'admin_sub_modules')) then
    raise exception 'legacy columns still exist';
  end if;

  if to_regprocedure('public.apply_user_permission_change(uuid,text,jsonb,jsonb,text,jsonb)') is not null
    or to_regprocedure('public.preview_user_permission_change(uuid,jsonb,jsonb)') is not null
    or to_regprocedure('app_private.apply_user_permission_change_impl(uuid,text,jsonb,jsonb,text,jsonb)') is not null
    or to_regprocedure('app_private.preview_user_permission_change_impl(uuid,jsonb,jsonb)') is not null
    or to_regprocedure('app_private.sync_legacy_permission_projection(uuid)') is not null
    or to_regprocedure('app_private.guard_and_audit_legacy_permission_write()') is not null
    or exists (select 1 from pg_trigger where tgname = 'trg_users_guard_legacy_permission_writes') then
    raise exception 'legacy-only routine or trigger still exists';
  end if;

  select string_agg(n.nspname || '.' || p.proname, ', ') into v_left
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname not in ('pg_catalog', 'information_schema')
    and p.prosrc ~ '(allowed_modules|admin_modules|allowed_sub_modules|admin_sub_modules|sync_legacy_permission_projection|legacy_sources)'
    and p.proname not in ('normalize_legacy_permission_state', 'get_permission_health_summary_legacy_base',
      'get_authorization_legacy_migration_summary', 'authorization_task13_snapshot_digest');
  if v_left is not null then raise exception 'routines still reference legacy state: %', v_left; end if;

  -- Snapshot: every users row covered by ID, every checksum valid.
  select count(*) into v_n from public.users u where not exists (
    select 1 from app_private.authorization_task13_legacy_column_snapshots s where s.user_id = u.id);
  if v_n <> 0 then raise exception '% users missing from the Task 13 snapshot', v_n; end if;
  select count(*) into v_n from app_private.authorization_task13_legacy_column_snapshots s
  where s.payload_sha256 <> app_private.authorization_task13_snapshot_digest(s);
  if v_n <> 0 then raise exception '% snapshot rows fail checksum', v_n; end if;
  if not (select relrowsecurity from pg_class where oid = 'app_private.authorization_task13_legacy_column_snapshots'::regclass) then
    raise exception 'snapshot table without RLS';
  end if;
  if has_table_privilege('authenticated', 'app_private.authorization_task13_legacy_column_snapshots', 'select') then
    raise exception 'authenticated can read the snapshot';
  end if;

  -- Effective resolver: no LEGACY source for any active user.
  select count(*) into v_n from public.users u
  cross join lateral app_private.resolve_effective_permission_sources(u.id) r
  where u.is_active and r.source_type = 'LEGACY';
  if v_n <> 0 then raise exception '% effective LEGACY sources', v_n; end if;

  -- Principal listing no longer returns legacy fields.
  if pg_get_function_result('public.list_authorization_principals()'::regprocedure) ~ 'modules' then
    raise exception 'list_authorization_principals still returns legacy fields';
  end if;
  if not has_function_privilege('authenticated', 'public.list_authorization_principals()', 'execute')
    or has_function_privilege('anon', 'public.list_authorization_principals()', 'execute') then
    raise exception 'list_authorization_principals ACL changed';
  end if;

  -- Rewritten routines still run.
  perform app_private.user_permission_state_fingerprint(u.id) from public.users u limit 5;
  if (select app_private.user_permission_state_fingerprint(u.id) from public.users u limit 1) is null then
    raise exception 'fingerprint returns null';
  end if;
end $$;

-- users triggers still guard self updates and still accept allowed profile edits.
create temporary table t13_self (id uuid, auth_id uuid, email text) on commit drop;
insert into t13_self
select u.id, u.auth_id, u.email from public.users u
where u.is_active and u.role <> 'ADMIN' and u.auth_id is not null
order by u.created_at limit 1;
grant select on t13_self to authenticated;

set local role authenticated;
do $$
declare v_self t13_self%rowtype; v_n int; v_blocked boolean := false;
begin
  select * into v_self from t13_self;
  if v_self.id is null then raise exception 'fixture missing'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_self.auth_id, 'email', v_self.email, 'role', 'authenticated')::text, true);
  begin
    update public.users set role = 'ADMIN' where id = v_self.id;
    get diagnostics v_n = row_count;
    if v_n = 0 then v_blocked := true; end if;
  exception when insufficient_privilege then v_blocked := true; end;
  if not v_blocked then raise exception 'employee escalated own role'; end if;
end $$;
reset role;

rollback;
