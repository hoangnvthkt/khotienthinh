-- Run after daily_xp_legacy_fixture.sql and repair_and_harden_daily_xp in an
-- isolated local database. All runtime mutations below are rolled back.

begin;

do $repair_assertions$
declare
  v_batch_id uuid;
  v_definition text;
  v_function_config text[];
  v_security_definer boolean;
  v_badges jsonb;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('user_xp', 'xp_events')
      and column_name = 'user_id'
      and (data_type <> 'uuid' or is_nullable <> 'NO')
  ) or (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('user_xp', 'xp_events')
      and column_name = 'user_id'
      and data_type = 'uuid'
      and is_nullable = 'NO'
  ) <> 2 then
    raise exception 'XP user_id columns are not canonical non-null UUIDs';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.user_xp'::regclass
      and constraint_row.confrelid = 'public.users'::regclass
      and constraint_row.contype = 'f'
      and constraint_row.conkey = array[
        (select attribute.attnum
         from pg_catalog.pg_attribute attribute
         where attribute.attrelid = 'public.user_xp'::regclass
           and attribute.attname = 'user_id')
      ]::smallint[]
      and constraint_row.confkey = array[
        (select attribute.attnum
         from pg_catalog.pg_attribute attribute
         where attribute.attrelid = 'public.users'::regclass
           and attribute.attname = 'id')
      ]::smallint[]
      and constraint_row.confdeltype = 'c'
      and constraint_row.convalidated
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.xp_events'::regclass
      and constraint_row.confrelid = 'public.users'::regclass
      and constraint_row.contype = 'f'
      and constraint_row.conkey = array[
        (select attribute.attnum
         from pg_catalog.pg_attribute attribute
         where attribute.attrelid = 'public.xp_events'::regclass
           and attribute.attname = 'user_id')
      ]::smallint[]
      and constraint_row.confkey = array[
        (select attribute.attnum
         from pg_catalog.pg_attribute attribute
         where attribute.attrelid = 'public.users'::regclass
           and attribute.attname = 'id')
      ]::smallint[]
      and constraint_row.confdeltype = 'c'
      and constraint_row.convalidated
  ) then
    raise exception 'XP foreign keys to public.users(id) are missing';
  end if;

  if exists (
    select 1
    from public.user_xp profile
    left join public.users app_user on app_user.id = profile.user_id
    where app_user.id is null
  ) or exists (
    select 1
    from public.xp_events event_row
    left join public.users app_user on app_user.id = event_row.user_id
    where app_user.id is null
  ) then
    raise exception 'orphan XP rows remain after canonical repair';
  end if;

  select archive.repair_batch_id
  into v_batch_id
  from app_private.xp_repair_archive archive
  where archive.source_table = 'public.user_xp'
    and archive.row_data ->> 'id' = '71000000-0000-4000-8000-000000000004'
  order by archive.archived_at desc
  limit 1;

  if v_batch_id is null then
    raise exception 'fixture source rows were not archived under a repair batch';
  end if;

  if exists (
    with expected(source_table, source_id) as (
      values
        ('public.user_xp', '71000000-0000-4000-8000-000000000001'),
        ('public.user_xp', '71000000-0000-4000-8000-000000000002'),
        ('public.user_xp', '71000000-0000-4000-8000-000000000003'),
        ('public.user_xp', '71000000-0000-4000-8000-000000000004'),
        ('public.xp_events', '72000000-0000-4000-8000-000000000001'),
        ('public.xp_events', '72000000-0000-4000-8000-000000000002'),
        ('public.xp_events', '72000000-0000-4000-8000-000000000003'),
        ('public.xp_events', '72000000-0000-4000-8000-000000000004'),
        ('public.xp_events', '72000000-0000-4000-8000-000000000005'),
        ('public.xp_events', '72000000-0000-4000-8000-000000000006'),
        ('public.xp_events', '72000000-0000-4000-8000-000000000010'),
        ('public.xp_events', '72000000-0000-4000-8000-000000000018')

      union all

      select 'public.user_xp', md5('xp-level-profile-' || level_no)::uuid::text
      from generate_series(1, 10) as levels(level_no)

      union all

      select 'public.user_xp', md5('xp-streak-30-profile')::uuid::text

      union all

      select
        'public.xp_events',
        ('73000000-0000-4000-8000-' || lpad(day_no::text, 12, '0'))::uuid::text
      from generate_series(1, 7) as login_days(day_no)

      union all

      select 'public.xp_events', md5('xp-level-event-' || level_no)::uuid::text
      from generate_series(2, 10) as levels(level_no)

      union all

      select 'public.xp_events', md5('xp-streak-30-event-' || day_no)::uuid::text
      from generate_series(1, 30) as login_days(day_no)
    )
    select 1
    from expected
    where not exists (
      select 1
      from app_private.xp_repair_archive archive
      where archive.repair_batch_id = v_batch_id
        and archive.source_table = expected.source_table
        and archive.row_data ->> 'id' = expected.source_id
    )
  ) then
    raise exception 'not every deterministic legacy source row was snapshotted';
  end if;

  if exists (
    select 1
    from (
      values
        ('catalog.pg_proc'),
        ('catalog.pg_class'),
        ('catalog.pg_policy'),
        ('catalog.pg_attribute'),
        ('catalog.pg_constraint'),
        ('catalog.pg_index'),
        ('catalog.acl')
    ) as expected(source_table)
    where not exists (
      select 1
      from app_private.xp_repair_archive archive
      where archive.repair_batch_id = v_batch_id
        and archive.source_table = expected.source_table
    )
  ) or not exists (
    select 1
    from app_private.xp_repair_archive archive
    cross join lateral jsonb_array_elements(archive.row_data -> 'objects') object_row
    where archive.repair_batch_id = v_batch_id
      and archive.source_table = 'catalog.pg_proc'
      and object_row ->> 'name' = 'add_xp'
      and object_row ->> 'definition' ilike '%insert into public.xp_events%'
  ) or not exists (
    select 1
    from app_private.xp_repair_archive archive
    cross join lateral jsonb_array_elements(archive.row_data -> 'objects') object_row
    where archive.repair_batch_id = v_batch_id
      and archive.source_table = 'catalog.pg_proc'
      and object_row ->> 'name' = 'record_xp'
  ) or exists (
    select 1
    from (
      values ('xp_fixture_permissive_all'), ('xp_event_fixture_permissive_all')
    ) as expected(policy_name)
    where not exists (
      select 1
      from app_private.xp_repair_archive archive
      cross join lateral jsonb_array_elements(archive.row_data -> 'objects') object_row
      where archive.repair_batch_id = v_batch_id
        and archive.source_table = 'catalog.pg_policy'
        and object_row ->> 'name' = expected.policy_name
    )
  ) or not exists (
    select 1
    from app_private.xp_repair_archive archive
    cross join lateral jsonb_array_elements(archive.row_data -> 'objects') object_row
    where archive.repair_batch_id = v_batch_id
      and archive.source_table = 'catalog.pg_class'
      and object_row ->> 'name' = 'user_xp'
      and (object_row ->> 'rls_enabled')::boolean
  ) or not exists (
    select 1
    from app_private.xp_repair_archive archive
    cross join lateral jsonb_array_elements(archive.row_data -> 'objects') object_row
    where archive.repair_batch_id = v_batch_id
      and archive.source_table = 'catalog.pg_attribute'
      and object_row ->> 'table' = 'user_xp'
      and object_row ->> 'name' = 'user_id'
      and object_row -> 'acl' is not null
  ) or exists (
    select 1
    from (
      values ('catalog.pg_constraint'), ('catalog.pg_index')
    ) as expected(source_table)
    where not exists (
      select 1
      from app_private.xp_repair_archive archive
      where archive.repair_batch_id = v_batch_id
        and archive.source_table = expected.source_table
        and jsonb_array_length(archive.row_data -> 'objects') > 0
    )
  ) or exists (
    select 1
    from (values ('anon'), ('authenticated')) as expected(grantee)
    where not exists (
      select 1
      from app_private.xp_repair_archive archive
      cross join lateral jsonb_array_elements(archive.row_data -> 'entries') acl_entry
      where archive.repair_batch_id = v_batch_id
        and archive.source_table = 'catalog.acl'
        and acl_entry ->> 'grantee' = expected.grantee
    )
  ) then
    raise exception 'XP function/catalog/ACL snapshot is incomplete';
  end if;

  if not exists (
    select 1
    from app_private.xp_repair_archive archive
    where archive.repair_batch_id = v_batch_id
      and archive.source_table = 'public.user_xp.orphan'
      and archive.row_data #>> '{row,id}' = '71000000-0000-4000-8000-000000000004'
  ) or not exists (
    select 1
    from app_private.xp_repair_archive archive
    where archive.repair_batch_id = v_batch_id
      and archive.source_table = 'public.xp_events.orphan'
      and archive.row_data #>> '{row,id}' = '72000000-0000-4000-8000-000000000006'
  ) then
    raise exception 'unmappable XP rows were not explicitly archived';
  end if;

  if not exists (
    select 1
    from public.user_xp
    where id = '71000000-0000-4000-8000-000000000001'
      and user_id = 'aaaaaaaa-1000-4000-8000-000000000001'
  ) or exists (
    select 1
    from public.user_xp
    where id = '71000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'direct app-user profile did not win the canonical merge';
  end if;

  if not exists (
    select 1
    from public.user_xp
    where id = '71000000-0000-4000-8000-000000000003'
      and user_id = 'aaaaaaaa-2000-4000-8000-000000000002'
  ) then
    raise exception 'employee legacy profile was not retained when no direct profile existed';
  end if;

  if not exists (
    select 1
    from app_private.xp_repair_archive archive
    where archive.repair_batch_id = v_batch_id
      and archive.source_table = 'public.user_xp.merged_duplicate'
      and archive.row_data #>> '{row,id}' = '71000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'merged profile loser was not archived';
  end if;

  if not exists (
    select 1
    from public.xp_events
    where id = '72000000-0000-4000-8000-000000000001'
      and user_id = 'aaaaaaaa-1000-4000-8000-000000000001'
      and event_type = 'daily_login'
      and xp_amount = 5
  ) or exists (
    select 1 from public.xp_events
    where id = '72000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'daily login canonical-day dedupe did not retain the earliest row at 5 XP';
  end if;

  if not exists (
    select 1
    from public.xp_events
    where id = '72000000-0000-4000-8000-000000000003'
      and user_id = 'aaaaaaaa-1000-4000-8000-000000000001'
      and event_type = 'daily_checkin'
      and xp_amount = 10
  ) or exists (
    select 1 from public.xp_events
    where id = '72000000-0000-4000-8000-000000000004'
  ) then
    raise exception 'daily check-in canonical-day dedupe did not retain the earliest row at 10 XP';
  end if;

  if exists (
    select 1
    from (
      values
        ('72000000-0000-4000-8000-000000000002'),
        ('72000000-0000-4000-8000-000000000004')
    ) as expected(event_id)
    where not exists (
      select 1
      from app_private.xp_repair_archive archive
      where archive.repair_batch_id = v_batch_id
        and archive.source_table = 'public.xp_events.daily_duplicate'
        and archive.row_data #>> '{row,id}' = expected.event_id
    )
  ) then
    raise exception 'daily duplicate rows were not archived';
  end if;

  if not exists (
    select 1
    from public.xp_events
    where id = '72000000-0000-4000-8000-000000000005'
      and event_type = 'create_request'
      and xp_amount = 17
      and idempotency_key is null
  ) then
    raise exception 'non-daily historical event amount was not preserved';
  end if;

  if not exists (
    select 1
    from app_private.xp_repair_archive archive
    where archive.repair_batch_id = v_batch_id
      and archive.source_table = 'public.xp_events.idempotency_key_conflict'
      and archive.row_data #>> '{row,id}' = '72000000-0000-4000-8000-000000000005'
  ) then
    raise exception 'pre-existing idempotency collision was not archived and reconciled';
  end if;

  if exists (
    select 1
    from public.user_xp profile
    left join (
      select event_row.user_id, coalesce(sum(event_row.xp_amount), 0)::integer as total_xp
      from public.xp_events event_row
      group by event_row.user_id
    ) event_total on event_total.user_id = profile.user_id
    where profile.total_xp <> coalesce(event_total.total_xp, 0)
  ) then
    raise exception 'a repaired profile total does not equal its remaining event sum';
  end if;

  if exists (
    select 1
    from (
      values
        (1, 0, 1),
        (2, 100, 2),
        (3, 300, 3),
        (4, 600, 4),
        (5, 1000, 5),
        (6, 1500, 6),
        (7, 2500, 7),
        (8, 4000, 8),
        (9, 6000, 9),
        (10, 10000, 10)
    ) as expected(level_no, total_xp, expected_level)
    left join public.user_xp profile
      on profile.user_id = md5('xp-level-user-' || expected.level_no)::uuid
    where profile.id is null
       or profile.total_xp <> expected.total_xp
       or profile.level <> expected.expected_level
  ) then
    raise exception 'one or more XP level thresholds were recomputed incorrectly';
  end if;

  select profile.badges
  into v_badges
  from public.user_xp profile
  where profile.user_id = 'aaaaaaaa-2000-4000-8000-000000000002';

  if not exists (
    select 1
    from public.user_xp profile
    where profile.user_id = 'aaaaaaaa-2000-4000-8000-000000000002'
      and profile.total_xp = 105
      and profile.level = 2
      and profile.streak_days = 7
      and profile.last_active_date = date '2026-07-07'
  ) then
    raise exception 'login-only streak or last-active date was recomputed incorrectly';
  end if;

  if (select (badge ->> 'earnedAt')::timestamptz from jsonb_array_elements(v_badges) badge where badge ->> 'id' = 'first_login')
       is distinct from timestamptz '2026-06-30 01:00:00+00'
     or (select (badge ->> 'earnedAt')::timestamptz from jsonb_array_elements(v_badges) badge where badge ->> 'id' = 'streak_7')
       is distinct from timestamptz '2026-07-07 01:00:00+00'
     or (select (badge ->> 'earnedAt')::timestamptz from jsonb_array_elements(v_badges) badge where badge ->> 'id' = 'xp_100')
       is distinct from timestamptz '2026-07-08 01:00:00+00'
  then
    raise exception 'badge first-earned timestamps were not derived from event history: %', v_badges;
  end if;

  select profile.badges
  into v_badges
  from public.user_xp profile
  where profile.user_id = md5('xp-streak-30-user')::uuid;

  if not exists (
    select 1
    from public.user_xp profile
    where profile.user_id = md5('xp-streak-30-user')::uuid
      and profile.total_xp = 150
      and profile.level = 2
      and profile.streak_days = 30
      and profile.last_active_date = date '2026-05-30'
  ) or (select (badge ->> 'earnedAt')::timestamptz from jsonb_array_elements(v_badges) badge where badge ->> 'id' = 'first_login')
       is distinct from timestamptz '2026-05-01 01:00:00+00'
     or (select (badge ->> 'earnedAt')::timestamptz from jsonb_array_elements(v_badges) badge where badge ->> 'id' = 'streak_7')
       is distinct from timestamptz '2026-05-07 01:00:00+00'
     or (select (badge ->> 'earnedAt')::timestamptz from jsonb_array_elements(v_badges) badge where badge ->> 'id' = 'streak_30')
       is distinct from timestamptz '2026-05-30 01:00:00+00'
     or (select (badge ->> 'earnedAt')::timestamptz from jsonb_array_elements(v_badges) badge where badge ->> 'id' = 'xp_100')
       is distinct from timestamptz '2026-05-20 01:00:00+00'
  then
    raise exception 'thirty-day streak badge timestamps are incorrect: %', v_badges;
  end if;

  if (
    select (badge ->> 'earnedAt')::timestamptz
    from public.user_xp profile
    cross join lateral jsonb_array_elements(profile.badges) badge
    where profile.user_id = md5('xp-level-user-4')::uuid
      and badge ->> 'id' = 'xp_500'
  ) is distinct from timestamptz '2026-01-04 00:00:00+00'
  or (
    select (badge ->> 'earnedAt')::timestamptz
    from public.user_xp profile
    cross join lateral jsonb_array_elements(profile.badges) badge
    where profile.user_id = md5('xp-level-user-5')::uuid
      and badge ->> 'id' = 'xp_1000'
  ) is distinct from timestamptz '2026-01-05 00:00:00+00'
  or (
    select (badge ->> 'earnedAt')::timestamptz
    from public.user_xp profile
    cross join lateral jsonb_array_elements(profile.badges) badge
    where profile.user_id = md5('xp-level-user-5')::uuid
      and badge ->> 'id' = 'level_5'
  ) is distinct from timestamptz '2026-01-05 00:00:00+00'
  or (
    select (badge ->> 'earnedAt')::timestamptz
    from public.user_xp profile
    cross join lateral jsonb_array_elements(profile.badges) badge
    where profile.user_id = md5('xp-level-user-10')::uuid
      and badge ->> 'id' = 'level_10'
  ) is distinct from timestamptz '2026-01-10 00:00:00+00'
  then
    raise exception 'XP/level badge first-earned timestamps are incorrect';
  end if;

  if exists (
    select 1
    from public.xp_events
    where event_type in ('daily_login', 'daily_checkin')
      and (
        idempotency_key is null
        or idempotency_key <> format(
          '%s:%s',
          event_type,
          (created_at at time zone 'Asia/Ho_Chi_Minh')::date
        )
        or source_type is distinct from case event_type
          when 'daily_login' then 'daily_login'
          when 'daily_checkin' then 'legacy_daily_checkin'
        end
      )
  ) then
    raise exception 'repaired daily events are missing server metadata/idempotency keys';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index index_row
    where index_row.indrelid = 'public.xp_events'::regclass
      and index_row.indisvalid
      and index_row.indisunique
      and index_row.indnkeyatts = 2
      and pg_catalog.pg_get_indexdef(index_row.indexrelid, 1, true) = 'user_id'
      and pg_catalog.pg_get_indexdef(index_row.indexrelid, 2, true) = 'idempotency_key'
      and pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid)
        ilike '%idempotency_key%is not null%'
  ) or not exists (
    select 1
    from pg_catalog.pg_index index_row
    where index_row.indrelid = 'public.xp_events'::regclass
      and index_row.indisvalid
      and index_row.indnkeyatts >= 2
      and pg_catalog.pg_get_indexdef(index_row.indexrelid, 1, true) = 'user_id'
      and pg_catalog.pg_get_indexdef(index_row.indexrelid, 2, true) = 'created_at'
      and coalesce(
        pg_catalog.pg_index_column_has_property(index_row.indexrelid, 2, 'desc'),
        false
      )
  ) then
    raise exception 'XP idempotency/history indexes are missing';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class relation
    cross join lateral pg_catalog.aclexplode(
      coalesce(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
    ) privilege_row
    where relation.oid in ('public.user_xp'::regclass, 'public.xp_events'::regclass)
      and (
        privilege_row.grantee = 0
        or privilege_row.grantee = (select oid from pg_catalog.pg_roles where rolname = 'anon')
        or (
          privilege_row.grantee = (select oid from pg_catalog.pg_roles where rolname = 'authenticated')
          and privilege_row.privilege_type <> 'SELECT'
        )
        or (
          privilege_row.grantee = (select oid from pg_catalog.pg_roles where rolname = 'service_role')
          and privilege_row.privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
        )
      )
  ) or exists (
    select 1
    from (
      values
        ('public.user_xp', 'authenticated', 'SELECT'),
        ('public.xp_events', 'authenticated', 'SELECT'),
        ('public.user_xp', 'service_role', 'SELECT'),
        ('public.user_xp', 'service_role', 'INSERT'),
        ('public.user_xp', 'service_role', 'UPDATE'),
        ('public.user_xp', 'service_role', 'DELETE'),
        ('public.xp_events', 'service_role', 'SELECT'),
        ('public.xp_events', 'service_role', 'INSERT'),
        ('public.xp_events', 'service_role', 'UPDATE'),
        ('public.xp_events', 'service_role', 'DELETE')
    ) as expected(relation_name, grantee_name, privilege_type)
    where not exists (
      select 1
      from pg_catalog.pg_class relation
      cross join lateral pg_catalog.aclexplode(
        coalesce(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
      ) privilege_row
      where relation.oid = expected.relation_name::regclass
        and privilege_row.grantee = (
          select oid from pg_catalog.pg_roles where rolname = expected.grantee_name
        )
        and privilege_row.privilege_type = expected.privilege_type
    )
  ) or exists (
    select 1
    from pg_catalog.pg_attribute attribute
    cross join lateral pg_catalog.aclexplode(attribute.attacl) privilege_row
    where attribute.attrelid in ('public.user_xp'::regclass, 'public.xp_events'::regclass)
      and attribute.attnum > 0
      and not attribute.attisdropped
      and privilege_row.grantee in (
        0,
        (select oid from pg_catalog.pg_roles where rolname = 'anon'),
        (select oid from pg_catalog.pg_roles where rolname = 'authenticated')
      )
  ) or exists (
    select 1
    from pg_catalog.pg_class relation
    cross join lateral pg_catalog.aclexplode(
      coalesce(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
    ) privilege_row
    where relation.oid = 'app_private.xp_repair_archive'::regclass
      and privilege_row.grantee = 0
  ) or pg_catalog.has_table_privilege('authenticated', 'app_private.xp_repair_archive', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     or pg_catalog.has_table_privilege('anon', 'app_private.xp_repair_archive', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
     or pg_catalog.has_schema_privilege('anon', 'app_private', 'USAGE')
     or not pg_catalog.has_schema_privilege('authenticated', 'app_private', 'USAGE')
     or not pg_catalog.has_schema_privilege('service_role', 'app_private', 'USAGE')
     or not pg_catalog.has_table_privilege('service_role', 'app_private.xp_repair_archive', 'SELECT')
     or exists (
       select 1
       from pg_catalog.pg_namespace namespace_row
       cross join lateral pg_catalog.aclexplode(
         coalesce(namespace_row.nspacl, pg_catalog.acldefault('n', namespace_row.nspowner))
       ) privilege_row
       where namespace_row.nspname = 'app_private'
         and privilege_row.grantee = 0
     )
  then
    raise exception 'XP/archive table or column ACL matrix is incorrect';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'user_xp'
      and policyname = 'user_xp_authenticated_leaderboard'
      and cmd = 'SELECT'
      and roles = array['authenticated'::name]
      and qual ilike '%select%current_app_user_id()%'
  ) or not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'xp_events'
      and policyname = 'xp_events_authenticated_own'
      and cmd = 'SELECT'
      and roles = array['authenticated'::name]
      and qual ilike '%user_id%=%select%current_app_user_id()%'
  ) or exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename in ('user_xp', 'xp_events')
      and cmd <> 'SELECT'
  ) then
    raise exception 'XP RLS policies are missing, uncached, or permit writes';
  end if;

  if to_regprocedure('public.award_my_daily_xp(text,uuid)') is null
     or to_regprocedure('app_private.award_my_daily_xp_impl(text,uuid)') is null then
    raise exception 'daily XP RPC pair is missing';
  end if;

  select
    function_row.prosecdef,
    function_row.proconfig,
    regexp_replace(
      pg_catalog.pg_get_functiondef(function_row.oid),
      '[[:space:]]+',
      ' ',
      'g'
    )
  into v_security_definer, v_function_config, v_definition
  from pg_catalog.pg_proc function_row
  where function_row.oid = 'public.award_my_daily_xp(text,uuid)'::regprocedure;

  if v_security_definer
     or not ('search_path=""' = any(coalesce(v_function_config, '{}'::text[])))
     or v_definition not ilike '%select app_private.award_my_daily_xp_impl(p_event_type, p_source_id)%'
  then
    raise exception 'public daily XP wrapper is not a fixed-path security invoker: %', v_definition;
  end if;

  select
    function_row.prosecdef,
    function_row.proconfig,
    regexp_replace(
      pg_catalog.pg_get_functiondef(function_row.oid),
      '[[:space:]]+',
      ' ',
      'g'
    )
  into v_security_definer, v_function_config, v_definition
  from pg_catalog.pg_proc function_row
  where function_row.oid = 'app_private.award_my_daily_xp_impl(text,uuid)'::regprocedure;

  if not v_security_definer
     or not ('search_path=""' = any(coalesce(v_function_config, '{}'::text[])))
     or v_definition not ilike '%current_app_user_id()%'
     or v_definition not ilike '%"employeeId"%'
     or v_definition not ilike '%"checkIn"%'
     or v_definition not ilike '%ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING%'
  then
    raise exception 'private daily XP core lacks required actor/source/concurrency hardening: %', v_definition;
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_namespace function_schema on function_schema.oid = function_row.pronamespace
    where function_schema.nspname = 'public'
      and function_row.proname = 'award_my_daily_xp'
      and (
        pg_catalog.pg_get_function_identity_arguments(function_row.oid) <> 'p_event_type text, p_source_id uuid'
        or function_row.pronargdefaults <> 1
        or function_row.prorettype <> 'jsonb'::regtype
        or function_row.prosecdef
      )
  ) or (
    select count(*)
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_namespace function_schema on function_schema.oid = function_row.pronamespace
    where function_schema.nspname = 'public'
      and function_row.proname = 'award_my_daily_xp'
  ) <> 1 then
    raise exception 'public daily XP RPC payload/signature is broader than event type plus source UUID';
  end if;

  if pg_catalog.has_function_privilege('anon', 'public.award_my_daily_xp(text,uuid)', 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', 'app_private.award_my_daily_xp_impl(text,uuid)', 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', 'public.award_my_daily_xp(text,uuid)', 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', 'app_private.award_my_daily_xp_impl(text,uuid)', 'EXECUTE')
  then
    raise exception 'daily XP function ACL matrix is incorrect';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc function_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(function_row.proacl, pg_catalog.acldefault('f', function_row.proowner))
    ) privilege_row
    where function_row.oid in (
      'public.award_my_daily_xp(text,uuid)'::regprocedure,
      'app_private.award_my_daily_xp_impl(text,uuid)'::regprocedure
    )
      and privilege_row.grantee = 0
      and privilege_row.privilege_type = 'EXECUTE'
  ) then
    raise exception 'PUBLIC retains execute on a daily XP award RPC';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_namespace function_schema
      on function_schema.oid = function_row.pronamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(function_row.proacl, pg_catalog.acldefault('f', function_row.proowner))
    ) privilege_row
    where function_schema.nspname in ('public', 'app_private')
      and function_row.oid not in (
        'public.award_my_daily_xp(text,uuid)'::regprocedure,
        'app_private.award_my_daily_xp_impl(text,uuid)'::regprocedure
      )
      and (
        function_row.proname ~* '(^|_)xp($|_)|(award|add|grant|record|increment).*xp|xp.*(award|add|grant|record|increment)'
        or function_row.prosrc ilike '%user_xp%'
        or function_row.prosrc ilike '%xp_events%'
      )
      and privilege_row.grantee in (
        0,
        (select oid from pg_catalog.pg_roles where rolname = 'anon'),
        (select oid from pg_catalog.pg_roles where rolname = 'authenticated')
      )
      and privilege_row.privilege_type = 'EXECUTE'
  ) then
    raise exception 'an untrusted role can still execute a legacy XP mutator';
  end if;
end
$repair_assertions$;

insert into public.employees (id, employee_code, full_name, email, user_id)
values
  (
    'eeeeeeee-3000-4000-8000-000000000003',
    'XP-RPC-A',
    'XP RPC Actor',
    'xp.level.1@example.test',
    md5('xp-level-user-1')::uuid
  ),
  (
    'eeeeeeee-4000-4000-8000-000000000004',
    'XP-RPC-B',
    'XP RPC Other Actor',
    'xp.level.2@example.test',
    md5('xp-level-user-2')::uuid
  );

insert into public.hrm_attendance (id, "employeeId", date, status, "checkIn", "createdAt")
values
  (
    'abababab-3000-4000-8000-000000000003',
    'eeeeeeee-3000-4000-8000-000000000003',
    (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date::text,
    'present',
    '08:00',
    clock_timestamp()
  ),
  (
    'abababab-4000-4000-8000-000000000004',
    'eeeeeeee-4000-4000-8000-000000000004',
    (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date::text,
    'present',
    '08:05',
    clock_timestamp()
  ),
  (
    'abababab-5000-4000-8000-000000000005',
    'eeeeeeee-3000-4000-8000-000000000003',
    ((clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date - 1)::text,
    'present',
    null,
    clock_timestamp()
  );

select set_config(
  'test.xp_expected_profile_count',
  (select count(*)::text from public.user_xp),
  true
);

set local role authenticated;
set local request.jwt.claim.sub = '91919191-9191-4191-8191-919191919191';
set local request.jwt.claim.email = 'xp.level.1@example.test';
set local request.jwt.claims = '{"sub":"91919191-9191-4191-8191-919191919191","email":"xp.level.1@example.test","role":"authenticated"}';

do $rpc_assertions$
declare
  v_actor_user_id uuid := md5('xp-level-user-1')::uuid;
  v_other_user_id uuid := md5('xp-level-user-2')::uuid;
  v_before_total integer;
  v_after_login_total integer;
  v_before_count bigint;
  v_result jsonb;
  v_duplicate jsonb;
  v_keys text[];
  v_denied boolean;
  v_sqlstate text;
begin
  if public.current_app_user_id() is distinct from v_actor_user_id then
    raise exception 'smoke JWT did not resolve to the canonical app actor';
  end if;

  if (select count(*) from public.user_xp)
       <> current_setting('test.xp_expected_profile_count')::bigint then
    raise exception 'authenticated leaderboard SELECT cannot see all XP profiles';
  end if;

  if exists (select 1 from public.xp_events where user_id <> v_actor_user_id) then
    raise exception 'XP event SELECT policy exposes another user';
  end if;

  v_denied := false;
  begin
    insert into public.xp_events(user_id, event_type, xp_amount)
    values (v_actor_user_id, 'daily_login', 5000);
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'authenticated unexpectedly has direct XP event INSERT';
  end if;

  v_denied := false;
  begin
    update public.user_xp set total_xp = 999999 where user_id = v_actor_user_id;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'authenticated unexpectedly has direct XP profile UPDATE';
  end if;

  v_denied := false;
  begin
    delete from public.user_xp where user_id = v_actor_user_id;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'authenticated unexpectedly has direct XP profile DELETE';
  end if;

  select total_xp into v_before_total from public.user_xp where user_id = v_actor_user_id;
  select count(*) into v_before_count from public.xp_events where user_id = v_actor_user_id;

  v_result := public.award_my_daily_xp('daily_login', null);
  select array_agg(key order by key) into v_keys from jsonb_object_keys(v_result) key;
  if v_keys is distinct from array['awarded', 'newBadges', 'profile', 'xpGained']::text[]
     or coalesce((v_result ->> 'awarded')::boolean, false) is not true
     or (v_result ->> 'xpGained')::integer <> 5
  then
    raise exception 'daily login returned an invalid XPAwardResult: %', v_result;
  end if;

  select array_agg(key order by key) into v_keys from jsonb_object_keys(v_result -> 'profile') key;
  if v_keys is distinct from array[
       'badges', 'createdAt', 'id', 'lastActiveDate', 'level',
       'streakDays', 'totalXp', 'updatedAt', 'userId'
     ]::text[]
     or v_result #>> '{profile,userId}' <> v_actor_user_id::text
     or jsonb_typeof(v_result -> 'profile' -> 'badges') <> 'array'
     or jsonb_typeof(v_result -> 'newBadges') <> 'array'
  then
    raise exception 'daily login returned an invalid profile payload: %', v_result;
  end if;

  if jsonb_array_length(v_result -> 'newBadges') > 0 then
    select array_agg(key order by key)
    into v_keys
    from jsonb_object_keys(v_result -> 'newBadges' -> 0) key;
    if v_keys is distinct from array['description', 'earnedAt', 'icon', 'id', 'name']::text[] then
      raise exception 'new badge payload keys are invalid: %', v_result -> 'newBadges' -> 0;
    end if;
  end if;

  select total_xp into v_after_login_total from public.user_xp where user_id = v_actor_user_id;
  if v_after_login_total <> v_before_total + 5
     or (select count(*) from public.xp_events where user_id = v_actor_user_id) <> v_before_count + 1
  then
    raise exception 'first daily login was not one event and one 5 XP increment';
  end if;

  v_duplicate := public.award_my_daily_xp('daily_login', null);
  if coalesce((v_duplicate ->> 'awarded')::boolean, true) is not false
     or (v_duplicate ->> 'xpGained')::integer <> 0
     or v_duplicate -> 'newBadges' <> '[]'::jsonb
     or (select total_xp from public.user_xp where user_id = v_actor_user_id) <> v_after_login_total
     or (select count(*) from public.xp_events where user_id = v_actor_user_id) <> v_before_count + 1
  then
    raise exception 'same-business-day duplicate login was not idempotent: %', v_duplicate;
  end if;

  foreach v_result in array array[
    jsonb_build_object('kind', 'missing'),
    jsonb_build_object('kind', 'fake'),
    jsonb_build_object('kind', 'other'),
    jsonb_build_object('kind', 'empty_checkin'),
    jsonb_build_object('kind', 'invalid_event')
  ]
  loop
    v_denied := false;
    begin
      case v_result ->> 'kind'
        when 'missing' then
          perform public.award_my_daily_xp('daily_checkin', null);
        when 'fake' then
          perform public.award_my_daily_xp('daily_checkin', 'ffffffff-ffff-4fff-8fff-ffffffffffff');
        when 'other' then
          perform app_private.award_my_daily_xp_impl(
            'daily_checkin',
            'abababab-4000-4000-8000-000000000004'
          );
        when 'empty_checkin' then
          perform public.award_my_daily_xp(
            'daily_checkin',
            'abababab-5000-4000-8000-000000000005'
          );
        when 'invalid_event' then
          perform public.award_my_daily_xp('create_request', null);
      end case;
    exception when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
      v_denied := v_sqlstate = '22023';
    end;
    if not v_denied then
      raise exception 'invalid daily XP request did not return SQLSTATE 22023: %, %',
        v_result,
        v_sqlstate;
    end if;
  end loop;

  if (select total_xp from public.user_xp where user_id = v_actor_user_id) <> v_after_login_total
     or (select count(*) from public.xp_events where user_id = v_actor_user_id) <> v_before_count + 1
  then
    raise exception 'rejected check-in/event request changed XP state';
  end if;

  v_result := public.award_my_daily_xp(
    'daily_checkin',
    'abababab-3000-4000-8000-000000000003'
  );
  if coalesce((v_result ->> 'awarded')::boolean, false) is not true
     or (v_result ->> 'xpGained')::integer <> 10
     or v_result #>> '{profile,userId}' <> v_actor_user_id::text
     or not exists (
       select 1
       from public.xp_events
       where user_id = v_actor_user_id
         and event_type = 'daily_checkin'
         and xp_amount = 10
         and source_type = 'hrm_attendance'
         and source_id = 'abababab-3000-4000-8000-000000000003'
         and idempotency_key is not null
     )
  then
    raise exception 'owned attendance did not produce a verified 10 XP check-in award: %', v_result;
  end if;

  perform set_config('request.jwt.claim.email', 'xp.level.2@example.test', true);
  perform set_config('request.jwt.claim.sub', '92929292-9292-4292-8292-929292929292', true);
  perform set_config(
    'request.jwt.claims',
    '{"sub":"92929292-9292-4292-8292-929292929292","email":"xp.level.2@example.test","role":"authenticated"}',
    true
  );

  if public.current_app_user_id() is distinct from v_other_user_id
     or exists (select 1 from public.xp_events where user_id = v_actor_user_id)
     or not exists (select 1 from public.xp_events where user_id = v_other_user_id)
  then
    raise exception 'own-event RLS did not switch with the canonical actor';
  end if;
end
$rpc_assertions$;

rollback;
