-- Run after authorization_v2_phase5_disable_legacy_fallback.

do $$
declare
  v_cutover_id constant uuid := '6aa37d8c-1d58-4eb4-a5a9-709100333020';
  v_active_users integer;
  v_snapshot_users integer;
begin
  if not app_private.permission_hardening_flag('legacy_governance_fallback_disabled')
    or not app_private.permission_hardening_flag('legacy_fallback_disabled')
    or app_private.permission_hardening_flag('legacy_projection_enabled')
  then
    raise exception 'Legacy fallback flags are not fail-closed';
  end if;

  if exists (
    select 1
    from public.users user_row
    cross join lateral app_private.resolve_effective_permission_sources(
      user_row.id, null, null, null, now()
    ) source_row
    where user_row.is_active and user_row.account_status = 'ACTIVE'
      and source_row.source_type = 'LEGACY'
  ) then
    raise exception 'Effective resolver still emits LEGACY sources';
  end if;

  select count(*) into v_active_users
  from public.users where is_active and account_status = 'ACTIVE';
  select count(*) into v_snapshot_users
  from app_private.authorization_legacy_user_snapshots where cutover_id = v_cutover_id;
  if v_snapshot_users <> v_active_users then
    raise exception 'Rollback snapshot coverage drifted: snapshots %, active users %', v_snapshot_users, v_active_users;
  end if;

  if exists (
    select 1 from app_private.authorization_legacy_user_snapshots snapshot
    where snapshot.cutover_id = v_cutover_id
      and snapshot.checksum <> encode(extensions.digest(snapshot.legacy_payload::text, 'sha256'), 'hex')
  ) then
    raise exception 'Rollback snapshot checksum mismatch';
  end if;

  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'users'
      and column_name in ('allowed_modules', 'admin_modules', 'allowed_sub_modules', 'admin_sub_modules')
  ) <> 4 then
    raise exception 'Legacy rollback columns were removed before the observation window';
  end if;
end $$;

do $$
declare
  v_admin public.users%rowtype;
  v_summary jsonb;
  v_snapshot jsonb;
begin
  select * into v_admin from public.users
  where role = 'ADMIN' and is_active and account_status = 'ACTIVE' and auth_id is not null
  order by created_at, id limit 1;
  if v_admin.id is null then
    raise exception 'No active linked System Admin available for authenticated smoke';
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_admin.auth_id, 'email', v_admin.email, 'role', 'authenticated'
  )::text, true);
  perform set_config('role', 'authenticated', true);

  v_summary := public.get_authorization_legacy_migration_summary();
  if coalesce((v_summary->>'manualReview')::integer, -1) <> 0
    or coalesce((v_summary->>'legacyOnlyUsers')::integer, -1) <> 0
    or coalesce((v_summary->>'legacyFallbackDisabled')::boolean, false) is not true
    or coalesce((v_summary->>'legacyGovernanceFallbackDisabled')::boolean, false) is not true
    or coalesce((v_summary->>'legacyProjectionEnabled')::boolean, true) is not false
    or coalesce((v_summary->>'legacyConfiguredUsers')::integer, 0) <= 0
  then
    raise exception 'Legacy migration health summary does not satisfy Phase 5 gate: %', v_summary;
  end if;

  v_snapshot := public.get_my_authorization_snapshot();
  if coalesce((v_snapshot#>>'{flags,legacy_fallback_disabled}')::boolean, false) is not true
    or exists (
      select 1 from jsonb_array_elements(coalesce(v_snapshot->'sources', '[]'::jsonb)) source_row
      where upper(source_row->>'sourceType') = 'LEGACY'
    )
  then
    raise exception 'Authenticated authorization snapshot is not legacy-free';
  end if;

  perform set_config('role', 'postgres', true);
end $$;

select jsonb_build_object(
  'result', 'authorization_v2_phase5_no_legacy_fallback_smoke_passed',
  'legacyFallbackDisabled', app_private.permission_hardening_flag('legacy_fallback_disabled'),
  'legacyGovernanceFallbackDisabled', app_private.permission_hardening_flag('legacy_governance_fallback_disabled'),
  'legacyProjectionEnabled', app_private.permission_hardening_flag('legacy_projection_enabled'),
  'effectiveLegacySources', (
    select count(*)
    from public.users user_row
    cross join lateral app_private.resolve_effective_permission_sources(user_row.id, null, null, null, now()) source_row
    where user_row.is_active and user_row.account_status = 'ACTIVE' and source_row.source_type = 'LEGACY'
  ),
  'legacyConfiguredUsers', (
    select count(*) from public.users user_row
    where user_row.allowed_modules is not null or user_row.admin_modules is not null
      or user_row.allowed_sub_modules is not null or user_row.admin_sub_modules is not null
  ),
  'rollbackSnapshots', (
    select count(*) from app_private.authorization_legacy_user_snapshots
    where cutover_id = '6aa37d8c-1d58-4eb4-a5a9-709100333020'
  )
) result;
