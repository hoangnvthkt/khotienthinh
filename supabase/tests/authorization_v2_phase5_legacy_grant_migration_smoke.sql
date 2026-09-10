-- Run after authorization_v2_phase5_legacy_grant_migration.

do $$
declare
  v_cutover_id constant uuid := '6aa37d8c-1d58-4eb4-a5a9-709100333020';
begin
  if exists (
    select 1 from app_private.authorization_legacy_user_snapshots snapshot
    where snapshot.cutover_id = v_cutover_id
      and snapshot.checksum <> encode(extensions.digest(snapshot.legacy_payload::text, 'sha256'), 'hex')
  ) then
    raise exception 'Legacy snapshot checksum mismatch';
  end if;

  if (
    select count(*) from app_private.authorization_legacy_user_snapshots
    where cutover_id = v_cutover_id
  ) <> (
    select count(*) from public.users where is_active and account_status = 'ACTIVE'
  ) then
    raise exception 'Legacy snapshot does not cover every active user';
  end if;

  if exists (
    select 1 from app_private.authorization_legacy_migration_dispositions
    where cutover_id = v_cutover_id and disposition = 'manual_review'
  ) then
    raise exception 'Legacy migration still has manual_review rows';
  end if;

  if exists (
    select 1
    from app_private.authorization_legacy_migration_dispositions disposition
    join public.permission_actions action_row on action_row.permission_code = disposition.permission_code
    where disposition.cutover_id = v_cutover_id
      and disposition.disposition = 'mapped_view'
      and action_row.action not in ('view', 'view_own', 'view_related', 'access')
  ) then
    raise exception 'mapped_view produced a non-view permission';
  end if;

  if exists (
    select 1
    from app_private.authorization_legacy_migration_dispositions disposition
    join public.permission_actions action_row on action_row.permission_code = disposition.permission_code
    where disposition.cutover_id = v_cutover_id
      and disposition.disposition = 'mapped_manage'
      and action_row.action <> 'manage'
  ) then
    raise exception 'mapped_manage produced a non-manage permission';
  end if;

  if exists (
    select 1
    from public.user_permission_grants grant_row
    where grant_row.is_active
      and grant_row.permission_code ~ '^project\.(material_waste|custom_material|subcontract)\.'
      and grant_row.permission_code not in (
        'project.material_waste.view', 'project.custom_material.view', 'project.subcontract.view'
      )
  ) then
    raise exception 'View-only retired Project module received a mutation grant';
  end if;

  if exists (
    select user_id, permission_code, scope_type, scope_id
    from public.user_permission_grants
    where is_active
    group by user_id, permission_code, scope_type, scope_id
    having count(*) > 1
  ) then
    raise exception 'Duplicate active canonical grant tuple detected';
  end if;

  if exists (
    select 1
    from public.users user_row
    where user_row.is_active and user_row.account_status = 'ACTIVE'
      and user_row.role <> 'ADMIN'
      and (user_row.allowed_modules is not null or user_row.admin_modules is not null
        or user_row.allowed_sub_modules is not null or user_row.admin_sub_modules is not null)
      and not exists (select 1 from public.user_permission_grants grant_row where grant_row.user_id = user_row.id and grant_row.is_active)
      and not exists (select 1 from public.principal_role_assignments assignment where assignment.principal_id = user_row.id and assignment.status = 'ACTIVE')
      and not exists (
        select 1 from public.project_staff staff
        join public.project_permission_room_members member on member.project_staff_id = staff.id and member.is_active
        where staff.user_id = user_row.id::text and staff.end_date is null
      )
  ) then
    raise exception 'A legacy-only active user remains';
  end if;
end $$;

do $$
declare
  v_admin public.users%rowtype;
  v_summary jsonb;
begin
  select * into v_admin from public.users
  where role = 'ADMIN' and is_active and account_status = 'ACTIVE' and auth_id is not null
  order by created_at, id limit 1;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_admin.auth_id, 'email', v_admin.email, 'role', 'authenticated'
  )::text, true);
  perform set_config('role', 'authenticated', true);
  v_summary := public.get_authorization_legacy_migration_summary();
  if coalesce((v_summary->>'manualReview')::integer, -1) <> 0
    or coalesce((v_summary->>'legacyOnlyUsers')::integer, -1) <> 0 then
    raise exception 'Public legacy migration summary does not satisfy the gate';
  end if;
  perform set_config('role', 'postgres', true);
end $$;

select jsonb_build_object(
  'result', 'authorization_v2_phase5_legacy_grant_migration_smoke_passed',
  'snapshots', (select count(*) from app_private.authorization_legacy_user_snapshots where cutover_id = '6aa37d8c-1d58-4eb4-a5a9-709100333020'),
  'dispositions', (
    select jsonb_object_agg(disposition, item_count)
    from (
      select disposition, count(*) item_count
      from app_private.authorization_legacy_migration_dispositions
      where cutover_id = '6aa37d8c-1d58-4eb4-a5a9-709100333020'
      group by disposition order by disposition
    ) counts
  ),
  'generatedHrRoles', (select count(*) from public.role_permission_templates where code like 'LEGACY_HR_%'),
  'activeCanonicalGrants', (select count(*) from public.user_permission_grants where is_active),
  'manualReview', (select count(*) from app_private.authorization_legacy_migration_dispositions where cutover_id = '6aa37d8c-1d58-4eb4-a5a9-709100333020' and disposition = 'manual_review')
) result;
