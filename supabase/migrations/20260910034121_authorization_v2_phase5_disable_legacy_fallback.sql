-- Authorization V2 / Phase 5
-- Disable legacy authorization decisions while retaining all four legacy
-- columns and the deterministic migration snapshots for the rollback window.

do $$
declare
  v_cutover_id constant uuid := '6aa37d8c-1d58-4eb4-a5a9-709100333020';
begin
  if to_regclass('app_private.authorization_legacy_user_snapshots') is null
    or to_regclass('app_private.authorization_legacy_migration_dispositions') is null
  then
    raise exception 'Phase 5 legacy migration evidence is missing';
  end if;

  if exists (
    select 1
    from app_private.authorization_legacy_user_snapshots snapshot
    where snapshot.cutover_id = v_cutover_id
      and snapshot.checksum <> encode(extensions.digest(snapshot.legacy_payload::text, 'sha256'), 'hex')
  ) then
    raise exception 'Phase 5 legacy snapshot checksum mismatch';
  end if;

  if (
    select count(*) from app_private.authorization_legacy_user_snapshots
    where cutover_id = v_cutover_id
  ) <> (
    select count(*) from public.users where is_active and account_status = 'ACTIVE'
  ) then
    raise exception 'Phase 5 snapshot does not cover every active user';
  end if;

  if exists (
    select 1 from app_private.authorization_legacy_migration_dispositions
    where cutover_id = v_cutover_id and disposition = 'manual_review'
  ) then
    raise exception 'Phase 5 manual-review dispositions remain';
  end if;

  if exists (
    select 1
    from public.users user_row
    where user_row.is_active and user_row.account_status = 'ACTIVE' and user_row.role <> 'ADMIN'
      and (user_row.allowed_modules is not null or user_row.admin_modules is not null
        or user_row.allowed_sub_modules is not null or user_row.admin_sub_modules is not null)
      and not exists (
        select 1 from public.user_permission_grants grant_row
        where grant_row.user_id = user_row.id and grant_row.is_active
          and (grant_row.expires_at is null or grant_row.expires_at > now())
      )
      and not exists (
        select 1 from public.principal_role_assignments assignment
        where assignment.principal_id = user_row.id and assignment.status = 'ACTIVE'
          and assignment.starts_at <= now()
          and (assignment.expires_at is null or assignment.expires_at > now())
      )
      and not exists (
        select 1 from public.project_staff staff
        join public.project_permission_room_members member
          on member.project_staff_id = staff.id and member.is_active
        where staff.user_id = user_row.id::text and staff.end_date is null
      )
  ) then
    raise exception 'Phase 5 legacy-only active user remains';
  end if;
end $$;

insert into app_private.permission_hardening_settings (key, value, updated_at)
values
  ('legacy_governance_fallback_disabled', 'true'::jsonb, now()),
  ('legacy_fallback_disabled', 'true'::jsonb, now()),
  ('legacy_projection_enabled', 'false'::jsonb, now())
on conflict (key) do update set value = excluded.value, updated_at = now();

create or replace function public.get_authorization_legacy_migration_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cutover_id constant uuid := '6aa37d8c-1d58-4eb4-a5a9-709100333020';
begin
  perform app_private.assert_project_permission_room_admin();
  return jsonb_build_object(
    'cutoverId', v_cutover_id,
    'snapshots', (select count(*) from app_private.authorization_legacy_user_snapshots where cutover_id = v_cutover_id),
    'manualReview', (select count(*) from app_private.authorization_legacy_migration_dispositions where cutover_id = v_cutover_id and disposition = 'manual_review'),
    'legacyOnlyUsers', (
      select count(*)
      from public.users user_row
      where user_row.is_active and user_row.account_status = 'ACTIVE' and user_row.role <> 'ADMIN'
        and (user_row.allowed_modules is not null or user_row.admin_modules is not null
          or user_row.allowed_sub_modules is not null or user_row.admin_sub_modules is not null)
        and not exists (select 1 from public.user_permission_grants grant_row where grant_row.user_id = user_row.id and grant_row.is_active and (grant_row.expires_at is null or grant_row.expires_at > now()))
        and not exists (select 1 from public.principal_role_assignments assignment where assignment.principal_id = user_row.id and assignment.status = 'ACTIVE' and assignment.starts_at <= now() and (assignment.expires_at is null or assignment.expires_at > now()))
        and not exists (
          select 1 from public.project_staff staff
          join public.project_permission_room_members member on member.project_staff_id = staff.id and member.is_active
          where staff.user_id = user_row.id::text and staff.end_date is null
        )
    ),
    'legacyConfiguredUsers', (
      select count(*) from public.users user_row
      where user_row.allowed_modules is not null or user_row.admin_modules is not null
        or user_row.allowed_sub_modules is not null or user_row.admin_sub_modules is not null
    ),
    'legacyConfiguredValues', (
      (select coalesce(sum(
        cardinality(coalesce(user_row.allowed_modules, '{}'::text[]))
        + cardinality(coalesce(user_row.admin_modules, '{}'::text[]))
      ), 0) from public.users user_row)
      + (select count(*) from public.users user_row
          cross join lateral jsonb_object_keys(coalesce(user_row.allowed_sub_modules, '{}'::jsonb)))
      + (select count(*) from public.users user_row
          cross join lateral jsonb_object_keys(coalesce(user_row.admin_sub_modules, '{}'::jsonb)))
    ),
    'legacyFallbackDisabled', app_private.permission_hardening_flag('legacy_fallback_disabled'),
    'legacyGovernanceFallbackDisabled', app_private.permission_hardening_flag('legacy_governance_fallback_disabled'),
    'legacyProjectionEnabled', app_private.permission_hardening_flag('legacy_projection_enabled'),
    'dispositions', (
      select coalesce(jsonb_object_agg(disposition, item_count), '{}'::jsonb)
      from (
        select disposition, count(*) item_count
        from app_private.authorization_legacy_migration_dispositions
        where cutover_id = v_cutover_id
        group by disposition order by disposition
      ) counts
    ),
    'generatedAt', now()
  );
end;
$$;

revoke all on function public.get_authorization_legacy_migration_summary() from public, anon;
grant execute on function public.get_authorization_legacy_migration_summary() to authenticated, service_role;

do $$
begin
  if not app_private.permission_hardening_flag('legacy_governance_fallback_disabled')
    or not app_private.permission_hardening_flag('legacy_fallback_disabled')
    or app_private.permission_hardening_flag('legacy_projection_enabled')
  then
    raise exception 'Phase 5 legacy fallback flags are not fail-closed';
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
    raise exception 'An effective LEGACY authorization source remains after fallback cutover';
  end if;
end $$;
