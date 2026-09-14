-- Authorization V2 / Task 13 readiness inventory.
-- Read-only: this script must not create, update, or drop any persistent object.

with
constants as (
  select
    '6aa37d8c-1d58-4eb4-a5a9-709100333020'::uuid as phase5_cutover_id,
    '(allowed_modules|admin_modules|allowed_sub_modules|admin_sub_modules)'::text as legacy_pattern
),
legacy_columns as (
  select column_name
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'users'
    and column_name in (
      'allowed_modules',
      'admin_modules',
      'allowed_sub_modules',
      'admin_sub_modules'
    )
),
active_users as (
  select id
  from public.users
  where is_active and account_status = 'ACTIVE'
),
phase5_snapshots as (
  select snapshot.*
  from app_private.authorization_legacy_user_snapshots snapshot
  cross join constants
  where snapshot.cutover_id = constants.phase5_cutover_id
),
legacy_routines as (
  select format(
    '%I.%I(%s)',
    namespace.nspname,
    routine.proname,
    pg_get_function_identity_arguments(routine.oid)
  ) as object_name
  from pg_proc routine
  join pg_namespace namespace on namespace.oid = routine.pronamespace
  cross join constants
  where namespace.nspname in ('public', 'app_private')
    and routine.prokind in ('f', 'p')
    and pg_get_functiondef(routine.oid) ~* constants.legacy_pattern
),
legacy_views as (
  select format('%I.%I', schemaname, viewname) as object_name
  from pg_views
  cross join constants
  where schemaname in ('public', 'app_private')
    and definition ~* constants.legacy_pattern
),
legacy_policies as (
  select format('%I.%I:%s', schemaname, tablename, policyname) as object_name
  from pg_policies
  cross join constants
  where coalesce(qual, '') || ' ' || coalesce(with_check, '') ~* constants.legacy_pattern
),
legacy_triggers as (
  select format('%I.%I:%s', namespace.nspname, relation.relname, trigger.tgname) as object_name
  from pg_trigger trigger
  join pg_class relation on relation.oid = trigger.tgrelid
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  cross join constants
  where not trigger.tgisinternal
    and pg_get_triggerdef(trigger.oid) ~* constants.legacy_pattern
),
authorization_rls as (
  select relation.relname, relation.relrowsecurity
  from pg_class relation
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname in (
      'permission_modules',
      'permission_actions',
      'user_permission_grants',
      'role_permission_templates',
      'role_permission_template_items',
      'principal_role_assignments',
      'project_permission_rooms',
      'project_permission_room_members'
    )
),
public_private_execute as (
  select format(
    '%I.%I(%s)',
    namespace.nspname,
    routine.proname,
    pg_get_function_identity_arguments(routine.oid)
  ) as object_name
  from pg_proc routine
  join pg_namespace namespace on namespace.oid = routine.pronamespace
  where namespace.nspname = 'app_private'
    and routine.prokind in ('f', 'p')
    and has_function_privilege('public', routine.oid, 'EXECUTE')
)
select jsonb_build_object(
  'result', 'authorization_v2_task13_readiness',
  'checkedAt', now(),
  'legacyColumns', (
    select coalesce(jsonb_agg(column_name order by column_name), '[]'::jsonb)
    from legacy_columns
  ),
  'hardeningFlags', jsonb_build_object(
    'legacyFallbackDisabled', app_private.permission_hardening_flag('legacy_fallback_disabled'),
    'legacyGovernanceFallbackDisabled', app_private.permission_hardening_flag('legacy_governance_fallback_disabled'),
    'legacyProjectionEnabled', app_private.permission_hardening_flag('legacy_projection_enabled'),
    'legacyPermissionWritesDisabled', app_private.permission_hardening_flag('legacy_permission_writes_disabled')
  ),
  'phase5Evidence', jsonb_build_object(
    'activeUsers', (select count(*) from active_users),
    'snapshotRows', (select count(*) from phase5_snapshots),
    'coveredActiveUsers', (
      select count(*)
      from active_users user_row
      join phase5_snapshots snapshot on snapshot.user_id = user_row.id
    ),
    'missingActiveUsers', (
      select count(*)
      from active_users user_row
      where not exists (
        select 1 from phase5_snapshots snapshot where snapshot.user_id = user_row.id
      )
    ),
    'snapshotsForInactiveUsers', (
      select count(*)
      from phase5_snapshots snapshot
      where not exists (
        select 1 from active_users user_row where user_row.id = snapshot.user_id
      )
    ),
    'checksumMismatches', (
      select count(*)
      from phase5_snapshots snapshot
      where snapshot.checksum <> encode(
        extensions.digest(snapshot.legacy_payload::text, 'sha256'),
        'hex'
      )
    ),
    'manualReviewDispositions', (
      select count(*)
      from app_private.authorization_legacy_migration_dispositions disposition
      cross join constants
      where disposition.cutover_id = constants.phase5_cutover_id
        and disposition.disposition = 'manual_review'
    )
  ),
  'runtimeState', jsonb_build_object(
    'effectiveLegacySources', (
      select count(*)
      from active_users user_row
      cross join lateral app_private.resolve_effective_permission_sources(
        user_row.id, null, null, null, now()
      ) source_row
      where source_row.source_type = 'LEGACY'
    ),
    'legacyConfiguredUsers', (
      select count(*)
      from public.users user_row
      where user_row.allowed_modules is not null
        or user_row.admin_modules is not null
        or user_row.allowed_sub_modules is not null
        or user_row.admin_sub_modules is not null
    ),
    'legacyWriteAuditEvents', (
      select count(*) from app_private.authorization_legacy_write_audit
    )
  ),
  'dependencies', jsonb_build_object(
    'routines', (
      select coalesce(jsonb_agg(object_name order by object_name), '[]'::jsonb)
      from legacy_routines
    ),
    'views', (
      select coalesce(jsonb_agg(object_name order by object_name), '[]'::jsonb)
      from legacy_views
    ),
    'policies', (
      select coalesce(jsonb_agg(object_name order by object_name), '[]'::jsonb)
      from legacy_policies
    ),
    'triggers', (
      select coalesce(jsonb_agg(object_name order by object_name), '[]'::jsonb)
      from legacy_triggers
    )
  ),
  'finalSecurityPreflight', jsonb_build_object(
    'authorizationTablesWithoutRls', (
      select coalesce(jsonb_agg(relname order by relname), '[]'::jsonb)
      from authorization_rls
      where not relrowsecurity
    ),
    'publicExecutablePrivateRoutines', jsonb_build_object(
      'count', (select count(*) from public_private_execute),
      'authorizationRelated', (
        select coalesce(jsonb_agg(object_name order by object_name), '[]'::jsonb)
        from public_private_execute
        where object_name ~* '(auth|permission|user_account)'
      )
    )
  )
) as result;
