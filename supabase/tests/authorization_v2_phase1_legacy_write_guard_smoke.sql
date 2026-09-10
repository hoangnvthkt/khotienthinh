begin;

create temporary table authorization_v2_phase1_smoke_context (
  actor_id uuid not null,
  target_id uuid not null,
  audit_count_before bigint not null
) on commit drop;

do $$
declare
  v_actor public.users%rowtype;
  v_target_id uuid := gen_random_uuid();
  v_suffix text := replace(v_target_id::text, '-', '');
begin
  select user_row.*
    into v_actor
  from public.users user_row
  where user_row.role = 'ADMIN'
    and user_row.is_active
    and user_row.account_status = 'ACTIVE'
    and user_row.auth_id is not null
  order by user_row.created_at
  limit 1;

  if v_actor.id is null then
    raise exception 'AUTH_V2_SMOKE_ACTIVE_ADMIN_REQUIRED';
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_actor.auth_id,
      'email', v_actor.email,
      'role', 'authenticated'
    )::text,
    true
  );

  insert into public.users (
    id, name, email, username, role, is_active, account_status
  ) values (
    v_target_id,
    'Authorization V2 Smoke',
    'authorization-v2-smoke-' || v_suffix || '@invalid.local',
    'authorization-v2-smoke-' || v_suffix,
    'EMPLOYEE',
    true,
    'ACTIVE'
  );

  insert into authorization_v2_phase1_smoke_context (
    actor_id,
    target_id,
    audit_count_before
  ) values (
    v_actor.id,
    v_target_id,
    (select count(*) from app_private.authorization_legacy_write_audit)
  );
end;
$$;

do $$
declare
  v_context authorization_v2_phase1_smoke_context%rowtype;
  v_audit_count bigint;
begin
  select * into v_context from authorization_v2_phase1_smoke_context;

  if app_private.permission_hardening_flag('legacy_permission_writes_disabled') then
    raise exception 'AUTH_V2_SMOKE_FLAG_MUST_DEFAULT_FALSE';
  end if;

  perform set_config('app.authorization_legacy_write_reason', 'phase1-smoke-audit-only', true);
  update public.users
  set allowed_modules = array['AUTH_V2_SMOKE']::text[]
  where id = v_context.target_id;

  select count(*) into v_audit_count
  from app_private.authorization_legacy_write_audit audit_row
  where audit_row.target_user_id = v_context.target_id
    and audit_row.changed_columns = array['allowed_modules']::text[]
    and audit_row.reason = 'phase1-smoke-audit-only';

  if v_audit_count <> 1 then
    raise exception 'AUTH_V2_SMOKE_AUDIT_ROW_MISSING';
  end if;
end;
$$;

update app_private.permission_hardening_settings
set value = 'true'::jsonb,
    updated_at = now()
where key = 'legacy_permission_writes_disabled';

do $$
declare
  v_context authorization_v2_phase1_smoke_context%rowtype;
  v_blocked boolean := false;
begin
  select * into v_context from authorization_v2_phase1_smoke_context;

  begin
    update public.users
    set allowed_sub_modules = '{"AUTH_V2_SMOKE":["blocked"]}'::jsonb
    where id = v_context.target_id;
  exception
    when insufficient_privilege then
      v_blocked := sqlerrm = 'Legacy permission writes are disabled';
  end;

  if not v_blocked then
    raise exception 'AUTH_V2_SMOKE_DISABLED_WRITE_NOT_BLOCKED';
  end if;
end;
$$;

select set_config('app.authorization_legacy_migration', 'on', true);

do $$
declare
  v_context authorization_v2_phase1_smoke_context%rowtype;
  v_audit_count_after bigint;
  v_admin_modules text[];
begin
  select * into v_context from authorization_v2_phase1_smoke_context;

  update public.users
  set admin_modules = array['AUTH_V2_MIGRATION']::text[]
  where id = v_context.target_id
  returning admin_modules into v_admin_modules;

  if v_admin_modules is distinct from array['AUTH_V2_MIGRATION']::text[] then
    raise exception 'AUTH_V2_SMOKE_CONTROLLED_MIGRATION_FAILED';
  end if;

  select count(*) into v_audit_count_after
  from app_private.authorization_legacy_write_audit;

  if v_audit_count_after <> v_context.audit_count_before + 1 then
    raise exception 'AUTH_V2_SMOKE_BYPASS_MUST_NOT_AUDIT';
  end if;
end;
$$;

select jsonb_build_object(
  'legacyWriteGuard', 'ok',
  'transaction', 'rollback'
) as authorization_v2_phase1_smoke;

rollback;
