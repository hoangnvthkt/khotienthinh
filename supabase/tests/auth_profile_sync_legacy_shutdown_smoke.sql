-- Regression coverage for account creation after Authorization V2 legacy-write shutdown.
-- The auth.users trigger must create a canonical profile without touching legacy
-- permission columns, while direct legacy writes remain blocked.
begin;

create temporary table auth_profile_sync_smoke_context (
  auth_id uuid not null,
  email text not null
) on commit drop;

do $$
declare
  v_auth_id uuid := gen_random_uuid();
  v_email text := 'auth-profile-sync-' || v_auth_id::text || '@example.invalid';
  v_profile public.users%rowtype;
  v_legacy_write_blocked boolean := false;
begin
  insert into auth_profile_sync_smoke_context (auth_id, email)
  values (v_auth_id, v_email);

  insert into auth.users (id, email, raw_user_meta_data)
  values (
    v_auth_id,
    v_email,
    jsonb_build_object(
      'name', 'Auth Profile Sync Smoke',
      'username', 'auth-profile-sync-' || left(v_auth_id::text, 8),
      'phone', '0900000000'
    )
  );

  select *
    into v_profile
  from public.users
  where auth_id = v_auth_id;

  if v_profile.id is null then
    raise exception 'Auth profile sync did not create public.users row';
  end if;

  if v_profile.email is distinct from v_email
    or v_profile.name is distinct from 'Auth Profile Sync Smoke'
    or v_profile.phone is distinct from '0900000000'
    or v_profile.role is distinct from 'EMPLOYEE'::public.user_role
    or not v_profile.is_active
    or v_profile.account_status is distinct from 'ACTIVE'
  then
    raise exception 'Auth profile sync created an invalid profile: %', row_to_json(v_profile);
  end if;

  if v_profile.allowed_modules is not null
    or v_profile.admin_modules is not null
    or v_profile.allowed_sub_modules is not null
    or v_profile.admin_sub_modules is not null
  then
    raise exception 'Auth profile sync wrote legacy permission columns';
  end if;

  begin
    update public.users
    set allowed_modules = array['WMS']::text[]
    where id = v_profile.id;
  exception when insufficient_privilege then
    v_legacy_write_blocked := sqlerrm = 'Legacy permission writes are disabled';
  end;

  if not v_legacy_write_blocked then
    raise exception 'Legacy permission guard was weakened by auth profile hotfix';
  end if;
end;
$$;

select jsonb_build_object(
  'result', 'auth_profile_sync_legacy_shutdown_smoke_passed',
  'profileCount', (
    select count(*)
    from public.users profile
    join auth_profile_sync_smoke_context context
      on context.auth_id = profile.auth_id
  ),
  'legacyWritesDisabled', app_private.permission_hardening_flag(
    'legacy_permission_writes_disabled'
  )
) result;

rollback;
