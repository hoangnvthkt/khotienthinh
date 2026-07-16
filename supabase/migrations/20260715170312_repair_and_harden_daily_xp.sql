create schema if not exists app_private;

create table if not exists app_private.xp_repair_archive (
  id bigint generated always as identity primary key,
  repair_batch_id uuid not null,
  archived_at timestamptz not null default clock_timestamp(),
  source_table text not null,
  row_data jsonb not null
);

revoke all on table app_private.xp_repair_archive from public, anon, authenticated;
grant usage on schema app_private to service_role;
grant select on table app_private.xp_repair_archive to service_role;

create index if not exists xp_repair_archive_batch_idx
  on app_private.xp_repair_archive (repair_batch_id, source_table);

create temporary table xp_repair_context (
  repair_batch_id uuid primary key
) on commit drop;

insert into xp_repair_context(repair_batch_id)
values (gen_random_uuid());

-- Hold a stable repair set from the first source snapshot through every
-- destructive rewrite in the caller's surrounding transaction.
do $lock_xp_source_tables$
begin
  if to_regclass('public.user_xp') is not null
     and to_regclass('public.xp_events') is not null then
    lock table public.user_xp, public.xp_events in share row exclusive mode;
  elsif to_regclass('public.user_xp') is not null then
    lock table public.user_xp in share row exclusive mode;
  elsif to_regclass('public.xp_events') is not null then
    lock table public.xp_events in share row exclusive mode;
  end if;
end
$lock_xp_source_tables$;

-- Snapshot the complete source rows before any repair, including fixtures where
-- one or both legacy XP tables do not yet exist.
do $snapshot_source_rows$
begin
  if to_regclass('public.user_xp') is not null then
    execute $sql$
      insert into app_private.xp_repair_archive(
        repair_batch_id, archived_at, source_table, row_data
      )
      select
        (select repair_batch_id from xp_repair_context),
        clock_timestamp(),
        'public.user_xp',
        to_jsonb(source_row)
      from public.user_xp source_row
    $sql$;
  end if;

  if to_regclass('public.xp_events') is not null then
    execute $sql$
      insert into app_private.xp_repair_archive(
        repair_batch_id, archived_at, source_table, row_data
      )
      select
        (select repair_batch_id from xp_repair_context),
        clock_timestamp(),
        'public.xp_events',
        to_jsonb(source_row)
      from public.xp_events source_row
    $sql$;
  end if;
end
$snapshot_source_rows$;

-- Catalog snapshots are stored as one deterministic JSON document per catalog
-- so even an empty set of pre-existing XP functions remains auditable.
insert into app_private.xp_repair_archive(
  repair_batch_id, archived_at, source_table, row_data
)
select
  (select repair_batch_id from xp_repair_context),
  clock_timestamp(),
  'catalog.pg_proc',
  jsonb_build_object(
    'objects',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'schema', function_schema.nspname,
          'name', function_row.proname,
          'identity_arguments', pg_catalog.pg_get_function_identity_arguments(function_row.oid),
          'owner', pg_catalog.pg_get_userbyid(function_row.proowner),
          'security_definer', function_row.prosecdef,
          'configuration', to_jsonb(function_row.proconfig),
          'acl', to_jsonb(function_row.proacl),
          'definition', pg_catalog.pg_get_functiondef(function_row.oid)
        )
        order by function_schema.nspname, function_row.proname,
          pg_catalog.pg_get_function_identity_arguments(function_row.oid)
      ),
      '[]'::jsonb
    )
  )
from pg_catalog.pg_proc function_row
join pg_catalog.pg_namespace function_schema
  on function_schema.oid = function_row.pronamespace
where function_schema.nspname in ('public', 'app_private')
  and function_row.prokind in ('f', 'p')
  and (
    function_row.proname ilike '%xp%'
    or function_row.prosrc ilike '%user_xp%'
    or function_row.prosrc ilike '%xp_events%'
  );

insert into app_private.xp_repair_archive(
  repair_batch_id, archived_at, source_table, row_data
)
select
  (select repair_batch_id from xp_repair_context),
  clock_timestamp(),
  'catalog.pg_class',
  jsonb_build_object(
    'objects',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'schema', relation_schema.nspname,
          'name', relation.relname,
          'owner', pg_catalog.pg_get_userbyid(relation.relowner),
          'kind', relation.relkind,
          'rls_enabled', relation.relrowsecurity,
          'rls_forced', relation.relforcerowsecurity,
          'acl', to_jsonb(relation.relacl)
        )
        order by relation.relname
      ),
      '[]'::jsonb
    )
  )
from pg_catalog.pg_class relation
join pg_catalog.pg_namespace relation_schema
  on relation_schema.oid = relation.relnamespace
where relation_schema.nspname = 'public'
  and relation.relname in ('user_xp', 'xp_events');

insert into app_private.xp_repair_archive(
  repair_batch_id, archived_at, source_table, row_data
)
select
  (select repair_batch_id from xp_repair_context),
  clock_timestamp(),
  'catalog.pg_policy',
  jsonb_build_object(
    'objects',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'table', policy_table.relname,
          'name', policy.polname,
          'command', policy.polcmd,
          'permissive', policy.polpermissive,
          'roles', (
            select coalesce(
              jsonb_agg(
                case
                  when role_oid = 0 then 'PUBLIC'
                  else pg_catalog.pg_get_userbyid(role_oid)
                end
                order by role_oid
              ),
              '[]'::jsonb
            )
            from unnest(policy.polroles) role_oid
          ),
          'using', pg_catalog.pg_get_expr(policy.polqual, policy.polrelid),
          'with_check', pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid)
        )
        order by policy_table.relname, policy.polname
      ),
      '[]'::jsonb
    )
  )
from pg_catalog.pg_policy policy
join pg_catalog.pg_class policy_table
  on policy_table.oid = policy.polrelid
join pg_catalog.pg_namespace policy_schema
  on policy_schema.oid = policy_table.relnamespace
where policy_schema.nspname = 'public'
  and policy_table.relname in ('user_xp', 'xp_events');

insert into app_private.xp_repair_archive(
  repair_batch_id, archived_at, source_table, row_data
)
select
  (select repair_batch_id from xp_repair_context),
  clock_timestamp(),
  'catalog.pg_attribute',
  jsonb_build_object(
    'objects',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'table', attribute_table.relname,
          'name', attribute.attname,
          'position', attribute.attnum,
          'type', pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
          'not_null', attribute.attnotnull,
          'identity', attribute.attidentity,
          'generated', attribute.attgenerated,
          'acl', to_jsonb(attribute.attacl),
          'default', pg_catalog.pg_get_expr(attribute_default.adbin, attribute_default.adrelid)
        )
        order by attribute_table.relname, attribute.attnum
      ),
      '[]'::jsonb
    )
  )
from pg_catalog.pg_attribute attribute
join pg_catalog.pg_class attribute_table
  on attribute_table.oid = attribute.attrelid
join pg_catalog.pg_namespace attribute_schema
  on attribute_schema.oid = attribute_table.relnamespace
left join pg_catalog.pg_attrdef attribute_default
  on attribute_default.adrelid = attribute.attrelid
 and attribute_default.adnum = attribute.attnum
where attribute_schema.nspname = 'public'
  and attribute_table.relname in ('user_xp', 'xp_events')
  and attribute.attnum > 0
  and not attribute.attisdropped;

insert into app_private.xp_repair_archive(
  repair_batch_id, archived_at, source_table, row_data
)
select
  (select repair_batch_id from xp_repair_context),
  clock_timestamp(),
  'catalog.pg_constraint',
  jsonb_build_object(
    'objects',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'table', constraint_table.relname,
          'name', constraint_row.conname,
          'type', constraint_row.contype,
          'definition', pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
          'validated', constraint_row.convalidated
        )
        order by constraint_table.relname, constraint_row.conname
      ),
      '[]'::jsonb
    )
  )
from pg_catalog.pg_constraint constraint_row
join pg_catalog.pg_class constraint_table
  on constraint_table.oid = constraint_row.conrelid
join pg_catalog.pg_namespace constraint_schema
  on constraint_schema.oid = constraint_table.relnamespace
where constraint_schema.nspname = 'public'
  and constraint_table.relname in ('user_xp', 'xp_events');

insert into app_private.xp_repair_archive(
  repair_batch_id, archived_at, source_table, row_data
)
select
  (select repair_batch_id from xp_repair_context),
  clock_timestamp(),
  'catalog.pg_index',
  jsonb_build_object(
    'objects',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'table', indexed_table.relname,
          'name', index_relation.relname,
          'unique', index_row.indisunique,
          'valid', index_row.indisvalid,
          'definition', pg_catalog.pg_get_indexdef(index_row.indexrelid)
        )
        order by indexed_table.relname, index_relation.relname
      ),
      '[]'::jsonb
    )
  )
from pg_catalog.pg_index index_row
join pg_catalog.pg_class indexed_table
  on indexed_table.oid = index_row.indrelid
join pg_catalog.pg_class index_relation
  on index_relation.oid = index_row.indexrelid
join pg_catalog.pg_namespace indexed_schema
  on indexed_schema.oid = indexed_table.relnamespace
where indexed_schema.nspname = 'public'
  and indexed_table.relname in ('user_xp', 'xp_events');

with relevant_functions as (
  select function_row.oid, function_schema.nspname, function_row.proname,
    function_row.proowner, function_row.proacl
  from pg_catalog.pg_proc function_row
  join pg_catalog.pg_namespace function_schema
    on function_schema.oid = function_row.pronamespace
  where function_schema.nspname in ('public', 'app_private')
    and function_row.prokind in ('f', 'p')
    and (
      function_row.proname ilike '%xp%'
      or function_row.prosrc ilike '%user_xp%'
      or function_row.prosrc ilike '%xp_events%'
    )
), acl_entries as (
  select
    'table'::text as object_type,
    format('%I.%I', relation_schema.nspname, relation.relname) as object_identity,
    case
      when privilege_row.grantee = 0 then 'PUBLIC'
      else pg_catalog.pg_get_userbyid(privilege_row.grantee)
    end as grantee,
    privilege_row.privilege_type,
    privilege_row.is_grantable
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace relation_schema
    on relation_schema.oid = relation.relnamespace
  cross join lateral pg_catalog.aclexplode(
    coalesce(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
  ) privilege_row
  where relation_schema.nspname = 'public'
    and relation.relname in ('user_xp', 'xp_events')

  union all

  select
    'function'::text,
    format(
      '%I.%I(%s)',
      relevant_function.nspname,
      relevant_function.proname,
      pg_catalog.pg_get_function_identity_arguments(relevant_function.oid)
    ),
    case
      when privilege_row.grantee = 0 then 'PUBLIC'
      else pg_catalog.pg_get_userbyid(privilege_row.grantee)
    end,
    privilege_row.privilege_type,
    privilege_row.is_grantable
  from relevant_functions relevant_function
  cross join lateral pg_catalog.aclexplode(
    coalesce(relevant_function.proacl, pg_catalog.acldefault('f', relevant_function.proowner))
  ) privilege_row
)
insert into app_private.xp_repair_archive(
  repair_batch_id, archived_at, source_table, row_data
)
select
  (select repair_batch_id from xp_repair_context),
  clock_timestamp(),
  'catalog.acl',
  jsonb_build_object(
    'entries',
    coalesce(
      jsonb_agg(to_jsonb(acl_entry) order by acl_entry.object_type, acl_entry.object_identity, acl_entry.grantee),
      '[]'::jsonb
    )
  )
from acl_entries acl_entry;

-- The live database has these tables but no replayable repository migration.
-- Creating their legacy-compatible shape first also supports clean fixtures.
create table if not exists public.user_xp (
  id uuid primary key default gen_random_uuid(),
  user_id text not null unique,
  total_xp integer default 0,
  level integer default 1,
  streak_days integer default 0,
  last_active_date date,
  badges jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.xp_events (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  event_type text not null,
  xp_amount integer not null,
  description text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

alter table public.user_xp
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id text,
  add column if not exists total_xp integer default 0,
  add column if not exists level integer default 1,
  add column if not exists streak_days integer default 0,
  add column if not exists last_active_date date,
  add column if not exists badges jsonb default '[]'::jsonb,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table public.xp_events
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id text,
  add column if not exists event_type text,
  add column if not exists xp_amount integer,
  add column if not exists description text,
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists created_at timestamptz default now(),
  add column if not exists source_type text,
  add column if not exists source_id uuid,
  add column if not exists idempotency_key text;

update public.user_xp
set total_xp = coalesce(total_xp, 0),
    level = coalesce(level, 1),
    streak_days = coalesce(streak_days, 0),
    badges = coalesce(badges, '[]'::jsonb),
    created_at = coalesce(created_at, transaction_timestamp()),
    updated_at = coalesce(updated_at, transaction_timestamp());

update public.xp_events
set metadata = coalesce(metadata, '{}'::jsonb),
    created_at = coalesce(created_at, transaction_timestamp());

create temporary table xp_identity_map on commit drop as
with legacy_ids as (
  select profile.user_id::text as legacy_user_id from public.user_xp profile
  union
  select event_row.user_id::text from public.xp_events event_row
), normalized_ids as (
  select
    legacy.legacy_user_id,
    lower(
      regexp_replace(btrim(legacy.legacy_user_id), '[{}-]', '', 'g')
    ) as compact_user_id
  from legacy_ids legacy
), parsed_ids as (
  select
    normalized.legacy_user_id,
    case
      when normalized.compact_user_id ~ '^[0-9a-f]{32}$' then
        (
          substr(normalized.compact_user_id, 1, 8) || '-' ||
          substr(normalized.compact_user_id, 9, 4) || '-' ||
          substr(normalized.compact_user_id, 13, 4) || '-' ||
          substr(normalized.compact_user_id, 17, 4) || '-' ||
          substr(normalized.compact_user_id, 21, 12)
        )::uuid
      else null
    end as legacy_user_uuid
  from normalized_ids normalized
)
select
  legacy.legacy_user_id,
  coalesce(direct_user.id, employee_user.id) as canonical_user_id,
  case
    when direct_user.id is not null then 'direct_user'
    when employee_user.id is not null then 'employee_legacy'
    else 'unmappable'
  end as mapped_by
from parsed_ids legacy
left join public.users direct_user
  on direct_user.id = legacy.legacy_user_uuid
left join public.employees employee_legacy
  on employee_legacy.id = legacy.legacy_user_uuid
left join public.users employee_user
  on employee_user.id = employee_legacy.user_id;

insert into app_private.xp_repair_archive(
  repair_batch_id, archived_at, source_table, row_data
)
select
  (select repair_batch_id from xp_repair_context),
  clock_timestamp(),
  'public.user_xp.orphan',
  jsonb_build_object(
    'reason', 'user_id does not map to public.users.id or public.employees.user_id',
    'row', to_jsonb(profile)
  )
from public.user_xp profile
join xp_identity_map identity_map
  on identity_map.legacy_user_id is not distinct from profile.user_id::text
where identity_map.canonical_user_id is null;

insert into app_private.xp_repair_archive(
  repair_batch_id, archived_at, source_table, row_data
)
select
  (select repair_batch_id from xp_repair_context),
  clock_timestamp(),
  'public.xp_events.orphan',
  jsonb_build_object(
    'reason', 'user_id does not map to public.users.id or public.employees.user_id',
    'row', to_jsonb(event_row)
  )
from public.xp_events event_row
join xp_identity_map identity_map
  on identity_map.legacy_user_id is not distinct from event_row.user_id::text
where identity_map.canonical_user_id is null;

delete from public.user_xp profile
using xp_identity_map identity_map
where identity_map.legacy_user_id is not distinct from profile.user_id::text
  and identity_map.canonical_user_id is null;

delete from public.xp_events event_row
using xp_identity_map identity_map
where identity_map.legacy_user_id is not distinct from event_row.user_id::text
  and identity_map.canonical_user_id is null;

create temporary table xp_profile_resolution on commit drop as
with profile_candidates as (
  select
    profile.id as profile_id,
    profile.user_id::text as original_user_id,
    identity_map.canonical_user_id,
    identity_map.mapped_by,
    profile.created_at,
    profile.id
  from public.user_xp profile
  join xp_identity_map identity_map
    on identity_map.legacy_user_id is not distinct from profile.user_id::text
  where identity_map.canonical_user_id is not null
)
select
  profile_id,
  original_user_id,
  canonical_user_id,
  mapped_by,
  row_number() over (
    partition by canonical_user_id
    order by
      case
        when mapped_by = 'direct_user' then 0
        else 1
      end,
      created_at,
      id
  ) as profile_rank
from profile_candidates;

insert into app_private.xp_repair_archive(
  repair_batch_id, archived_at, source_table, row_data
)
select
  (select repair_batch_id from xp_repair_context),
  clock_timestamp(),
  'public.user_xp.merged_duplicate',
  jsonb_build_object(
    'reason', 'profile merged into canonical app-user profile',
    'canonical_user_id', profile_resolution.canonical_user_id,
    'row', to_jsonb(profile)
  )
from public.user_xp profile
join xp_profile_resolution profile_resolution
  on profile_resolution.profile_id = profile.id
where profile_resolution.profile_rank > 1;

delete from public.user_xp profile
using xp_profile_resolution profile_resolution
where profile.id = profile_resolution.profile_id
  and profile_resolution.profile_rank > 1;

do $canonicalize_user_ids$
declare
  v_user_xp_is_uuid boolean;
  v_xp_events_is_uuid boolean;
begin
  select attribute.atttypid = 'uuid'::regtype
  into v_user_xp_is_uuid
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid = 'public.user_xp'::regclass
    and attribute.attname = 'user_id'
    and not attribute.attisdropped;

  select attribute.atttypid = 'uuid'::regtype
  into v_xp_events_is_uuid
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid = 'public.xp_events'::regclass
    and attribute.attname = 'user_id'
    and not attribute.attisdropped;

  if v_user_xp_is_uuid then
    update public.user_xp profile
    set user_id = profile_resolution.canonical_user_id
    from xp_profile_resolution profile_resolution
    where profile.id = profile_resolution.profile_id
      and profile_resolution.profile_rank = 1;
  else
    update public.user_xp profile
    set user_id = profile_resolution.canonical_user_id::text
    from xp_profile_resolution profile_resolution
    where profile.id = profile_resolution.profile_id
      and profile_resolution.profile_rank = 1;
  end if;

  if v_xp_events_is_uuid then
    update public.xp_events event_row
    set user_id = identity_map.canonical_user_id
    from xp_identity_map identity_map
    where identity_map.legacy_user_id is not distinct from event_row.user_id::text
      and identity_map.canonical_user_id is not null;
  else
    update public.xp_events event_row
    set user_id = identity_map.canonical_user_id::text
    from xp_identity_map identity_map
    where identity_map.legacy_user_id is not distinct from event_row.user_id::text
      and identity_map.canonical_user_id is not null;
  end if;
end
$canonicalize_user_ids$;

create temporary table xp_daily_event_resolution on commit drop as
with daily_rows as (
  select
    event_row.id,
    event_row.user_id,
    event_row.event_type,
    event_row.created_at,
    (event_row.created_at at time zone 'Asia/Ho_Chi_Minh')::date as business_day
  from public.xp_events event_row
  where event_row.event_type in ('daily_login', 'daily_checkin')
)
select
  daily.id as event_id,
  daily.business_day,
  row_number() over (
    partition by daily.user_id, daily.event_type, daily.business_day
    order by daily.created_at, daily.id
  ) as daily_rank
from daily_rows daily;

insert into app_private.xp_repair_archive(
  repair_batch_id, archived_at, source_table, row_data
)
select
  (select repair_batch_id from xp_repair_context),
  clock_timestamp(),
  'public.xp_events.daily_duplicate',
  jsonb_build_object(
    'reason', 'duplicate canonical daily award on Asia/Ho_Chi_Minh business day',
    'business_day', daily_resolution.business_day,
    'row', to_jsonb(event_row)
  )
from public.xp_events event_row
join xp_daily_event_resolution daily_resolution
  on daily_resolution.event_id = event_row.id
where daily_resolution.daily_rank > 1;

delete from public.xp_events event_row
using xp_daily_event_resolution daily_resolution
where event_row.id = daily_resolution.event_id
  and daily_resolution.daily_rank > 1;

update public.xp_events event_row
set xp_amount = case event_row.event_type
      when 'daily_login' then 5
      when 'daily_checkin' then 10
      else event_row.xp_amount
    end,
    source_type = case event_row.event_type
      when 'daily_login' then 'daily_login'
      when 'daily_checkin' then 'legacy_daily_checkin'
    end,
    idempotency_key = format(
      '%s:%s',
      event_row.event_type,
      (event_row.created_at at time zone 'Asia/Ho_Chi_Minh')::date
    )
where event_row.event_type in ('daily_login', 'daily_checkin');

-- Preserve every historical event while reconciling duplicate pre-existing
-- keys. A canonical daily key wins its namespace; later conflicting keys are
-- archived and cleared before the unique partial index is installed.
create temporary table xp_idempotency_resolution on commit drop as
select
  event_row.id as event_id,
  row_number() over (
    partition by event_row.user_id, event_row.idempotency_key
    order by
      case
        when event_row.event_type in ('daily_login', 'daily_checkin')
          and event_row.idempotency_key = format(
            '%s:%s',
            event_row.event_type,
            (event_row.created_at at time zone 'Asia/Ho_Chi_Minh')::date
          )
        then 0
        else 1
      end,
      event_row.created_at,
      event_row.id
  ) as key_rank
from public.xp_events event_row
where event_row.idempotency_key is not null;

insert into app_private.xp_repair_archive(
  repair_batch_id, archived_at, source_table, row_data
)
select
  (select repair_batch_id from xp_repair_context),
  clock_timestamp(),
  'public.xp_events.idempotency_key_conflict',
  jsonb_build_object(
    'reason', 'duplicate canonical user/idempotency key; event retained with key cleared',
    'row', to_jsonb(event_row)
  )
from public.xp_events event_row
join xp_idempotency_resolution key_resolution
  on key_resolution.event_id = event_row.id
where key_resolution.key_rank > 1;

update public.xp_events event_row
set idempotency_key = null
from xp_idempotency_resolution key_resolution
where key_resolution.event_id = event_row.id
  and key_resolution.key_rank > 1;

do $convert_xp_user_ids_to_uuid$
begin
  if exists (
    select 1
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = 'public.user_xp'::regclass
      and attribute.attname = 'user_id'
      and attribute.atttypid <> 'uuid'::regtype
      and not attribute.attisdropped
  ) then
    execute 'alter table public.user_xp alter column user_id type uuid using user_id::uuid';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = 'public.xp_events'::regclass
      and attribute.attname = 'user_id'
      and attribute.atttypid <> 'uuid'::regtype
      and not attribute.attisdropped
  ) then
    execute 'alter table public.xp_events alter column user_id type uuid using user_id::uuid';
  end if;
end
$convert_xp_user_ids_to_uuid$;

alter table public.user_xp
  alter column id set default gen_random_uuid(),
  alter column user_id set not null,
  alter column total_xp set default 0,
  alter column total_xp set not null,
  alter column level set default 1,
  alter column level set not null,
  alter column streak_days set default 0,
  alter column streak_days set not null,
  alter column badges set default '[]'::jsonb,
  alter column badges set not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

alter table public.xp_events
  alter column id set default gen_random_uuid(),
  alter column user_id set not null,
  alter column event_type set not null,
  alter column xp_amount set not null,
  alter column metadata set default '{}'::jsonb,
  alter column metadata set not null,
  alter column created_at set default now(),
  alter column created_at set not null;

do $repair_xp_indexes$
declare
  v_index_oid oid;
begin
  v_index_oid := to_regclass('public.user_xp_user_id_key');
  if v_index_oid is not null and not exists (
    select 1
    from pg_catalog.pg_index index_row
    where index_row.indexrelid = v_index_oid
      and index_row.indrelid = 'public.user_xp'::regclass
      and index_row.indisvalid
      and index_row.indisunique
      and index_row.indnkeyatts = 1
      and index_row.indpred is null
      and pg_catalog.pg_get_indexdef(index_row.indexrelid, 1, true) = 'user_id'
  ) then
    if exists (
      select 1 from pg_catalog.pg_constraint where conindid = v_index_oid
    ) then
      raise exception 'user_xp_user_id_key is a constraint-owned index with an unexpected definition';
    end if;
    execute 'drop index public.user_xp_user_id_key';
  end if;

  v_index_oid := to_regclass('public.xp_events_user_id_idempotency_key_uidx');
  if v_index_oid is not null and not exists (
    select 1
    from pg_catalog.pg_index index_row
    where index_row.indexrelid = v_index_oid
      and index_row.indrelid = 'public.xp_events'::regclass
      and index_row.indisvalid
      and index_row.indisunique
      and index_row.indnkeyatts = 2
      and pg_catalog.pg_get_indexdef(index_row.indexrelid, 1, true) = 'user_id'
      and pg_catalog.pg_get_indexdef(index_row.indexrelid, 2, true) = 'idempotency_key'
      and pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid)
        ilike '%idempotency_key%is not null%'
  ) then
    if exists (
      select 1 from pg_catalog.pg_constraint where conindid = v_index_oid
    ) then
      raise exception 'xp_events_user_id_idempotency_key_uidx is constraint-owned with an unexpected definition';
    end if;
    execute 'drop index public.xp_events_user_id_idempotency_key_uidx';
  end if;

  v_index_oid := to_regclass('public.xp_events_user_created_at_idx');
  if v_index_oid is not null and not exists (
    select 1
    from pg_catalog.pg_index index_row
    where index_row.indexrelid = v_index_oid
      and index_row.indrelid = 'public.xp_events'::regclass
      and index_row.indisvalid
      and index_row.indnkeyatts = 2
      and index_row.indpred is null
      and pg_catalog.pg_get_indexdef(index_row.indexrelid, 1, true) = 'user_id'
      and pg_catalog.pg_get_indexdef(index_row.indexrelid, 2, true) = 'created_at'
      and coalesce(
        pg_catalog.pg_index_column_has_property(index_row.indexrelid, 2, 'desc'),
        false
      )
  ) then
    if exists (
      select 1 from pg_catalog.pg_constraint where conindid = v_index_oid
    ) then
      raise exception 'xp_events_user_created_at_idx is constraint-owned with an unexpected definition';
    end if;
    execute 'drop index public.xp_events_user_created_at_idx';
  end if;

  v_index_oid := to_regclass('public.user_xp_leaderboard_idx');
  if v_index_oid is not null and not exists (
    select 1
    from pg_catalog.pg_index index_row
    where index_row.indexrelid = v_index_oid
      and index_row.indrelid = 'public.user_xp'::regclass
      and index_row.indisvalid
      and index_row.indnkeyatts = 2
      and index_row.indpred is null
      and pg_catalog.pg_get_indexdef(index_row.indexrelid, 1, true) = 'total_xp'
      and coalesce(
        pg_catalog.pg_index_column_has_property(index_row.indexrelid, 1, 'desc'),
        false
      )
      and pg_catalog.pg_get_indexdef(index_row.indexrelid, 2, true) = 'user_id'
  ) then
    if exists (
      select 1 from pg_catalog.pg_constraint where conindid = v_index_oid
    ) then
      raise exception 'user_xp_leaderboard_idx is constraint-owned with an unexpected definition';
    end if;
    execute 'drop index public.user_xp_leaderboard_idx';
  end if;
end
$repair_xp_indexes$;

create unique index if not exists user_xp_user_id_key
  on public.user_xp (user_id);

create unique index if not exists xp_events_user_id_idempotency_key_uidx
  on public.xp_events (user_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists xp_events_user_created_at_idx
  on public.xp_events (user_id, created_at desc);

create index if not exists user_xp_leaderboard_idx
  on public.user_xp (total_xp desc, user_id);

do $xp_foreign_keys$
begin
  if exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conname = 'user_xp_user_id_fkey'
      and constraint_row.conrelid = 'public.user_xp'::regclass
      and not (
        constraint_row.contype = 'f'
        and constraint_row.confrelid = 'public.users'::regclass
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
      )
  ) then
    alter table public.user_xp drop constraint user_xp_user_id_fkey;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conname = 'user_xp_user_id_fkey'
      and constraint_row.conrelid = 'public.user_xp'::regclass
      and constraint_row.contype = 'f'
      and constraint_row.confrelid = 'public.users'::regclass
      and constraint_row.confdeltype = 'c'
  ) then
    alter table public.user_xp
      add constraint user_xp_user_id_fkey
      foreign key (user_id) references public.users(id) on delete cascade;
  end if;

  if exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conname = 'xp_events_user_id_fkey'
      and constraint_row.conrelid = 'public.xp_events'::regclass
      and not (
        constraint_row.contype = 'f'
        and constraint_row.confrelid = 'public.users'::regclass
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
      )
  ) then
    alter table public.xp_events drop constraint xp_events_user_id_fkey;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conname = 'xp_events_user_id_fkey'
      and constraint_row.conrelid = 'public.xp_events'::regclass
      and constraint_row.contype = 'f'
      and constraint_row.confrelid = 'public.users'::regclass
      and constraint_row.confdeltype = 'c'
  ) then
    alter table public.xp_events
      add constraint xp_events_user_id_fkey
      foreign key (user_id) references public.users(id) on delete cascade;
  end if;

  if exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'user_xp_user_id_fkey'
      and conrelid = 'public.user_xp'::regclass
      and not convalidated
  ) then
    alter table public.user_xp validate constraint user_xp_user_id_fkey;
  end if;

  if exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'xp_events_user_id_fkey'
      and conrelid = 'public.xp_events'::regclass
      and not convalidated
  ) then
    alter table public.xp_events validate constraint xp_events_user_id_fkey;
  end if;
end
$xp_foreign_keys$;

do $drop_existing_recompute_xp_profile$
declare
  routine_row record;
begin
  for routine_row in
    select function_row.oid
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_namespace function_schema
      on function_schema.oid = function_row.pronamespace
    where function_schema.nspname = 'app_private'
      and function_row.proname = 'recompute_xp_profile'
      and function_row.prokind in ('f', 'p')
  loop
    execute format('drop routine %s', routine_row.oid::regprocedure);
  end loop;
end
$drop_existing_recompute_xp_profile$;

create or replace function app_private.recompute_xp_profile(p_user_id uuid)
returns public.user_xp
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_profile public.user_xp;
begin
  if not exists (
    select 1 from public.users app_user where app_user.id = p_user_id
  ) then
    raise exception 'Cannot recompute XP for an unknown app user'
      using errcode = '23503';
  end if;

  insert into public.user_xp(user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  with event_stream as (
    select
      event_row.id,
      event_row.xp_amount,
      event_row.created_at
    from public.xp_events event_row
    where event_row.user_id = p_user_id
  ), event_running as (
    select
      event_stream.id,
      event_stream.created_at,
      sum(event_stream.xp_amount) over (
        order by event_stream.created_at, event_stream.id
        rows between unbounded preceding and current row
      ) as running_xp
    from event_stream
  ), event_totals as (
    select coalesce(sum(xp_amount), 0)::integer as total_xp
    from event_stream
  ), login_days as (
    select
      (event_row.created_at at time zone 'Asia/Ho_Chi_Minh')::date as login_day,
      min(event_row.created_at) as achieved_at
    from public.xp_events event_row
    where event_row.user_id = p_user_id
      and event_row.event_type = 'daily_login'
    group by (event_row.created_at at time zone 'Asia/Ho_Chi_Minh')::date
  ), login_numbered as (
    select
      login_days.login_day,
      login_days.achieved_at,
      row_number() over (order by login_days.login_day) as overall_day_number
    from login_days
  ), login_grouped as (
    select
      login_numbered.login_day,
      login_numbered.achieved_at,
      login_numbered.login_day - login_numbered.overall_day_number::integer as island_key
    from login_numbered
  ), login_ranked as (
    select
      login_grouped.login_day,
      login_grouped.achieved_at,
      login_grouped.island_key,
      row_number() over (
        partition by login_grouped.island_key
        order by login_grouped.login_day
      ) as island_day_number
    from login_grouped
  ), latest_login as (
    select
      count(*)::integer as streak_days,
      max(login_grouped.login_day) as last_active_date
    from login_grouped
    group by login_grouped.island_key
    order by max(login_grouped.login_day) desc
    limit 1
  ), badge_earned as (
    select 'first_login'::text as badge_id, min(event_stream.created_at) as earned_at
    from event_stream

    union all

    select 'streak_7', min(login_ranked.achieved_at)
      filter (where login_ranked.island_day_number = 7)
    from login_ranked

    union all

    select 'streak_30', min(login_ranked.achieved_at)
      filter (where login_ranked.island_day_number = 30)
    from login_ranked

    union all

    select 'xp_100', min(event_running.created_at)
      filter (where event_running.running_xp >= 100)
    from event_running

    union all

    select 'xp_500', min(event_running.created_at)
      filter (where event_running.running_xp >= 500)
    from event_running

    union all

    select 'xp_1000', min(event_running.created_at)
      filter (where event_running.running_xp >= 1000)
    from event_running

    union all

    select 'level_5', min(event_running.created_at)
      filter (where event_running.running_xp >= 1000)
    from event_running

    union all

    select 'level_10', min(event_running.created_at)
      filter (where event_running.running_xp >= 10000)
    from event_running
  ), badge_definitions(badge_id, badge_name, icon, description, sort_order) as (
    values
      ('first_login', 'Lần đầu', '🎉', 'Đăng nhập lần đầu', 1),
      ('streak_7', 'Chuyên cần', '🔥', 'Đăng nhập 7 ngày liên tục', 2),
      ('streak_30', 'Không nghỉ', '💪', 'Đăng nhập 30 ngày liên tục', 3),
      ('xp_100', 'Tích luỹ 100 XP', '⭐', 'Đạt 100 XP tổng cộng', 4),
      ('xp_500', 'Tích luỹ 500 XP', '🌟', 'Đạt 500 XP tổng cộng', 5),
      ('xp_1000', 'Ngàn XP', '💎', 'Đạt 1000 XP tổng cộng', 6),
      ('level_5', 'Chuyên gia', '🏅', 'Đạt Level 5', 7),
      ('level_10', 'Bất khả chiến bại', '🏆', 'Đạt Level 10', 8)
  ), badge_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', badge_definition.badge_id,
          'name', badge_definition.badge_name,
          'icon', badge_definition.icon,
          'description', badge_definition.description,
          'earnedAt', badge_earned.earned_at
        )
        order by badge_definition.sort_order
      ) filter (where badge_earned.earned_at is not null),
      '[]'::jsonb
    ) as badges
    from badge_definitions badge_definition
    join badge_earned using (badge_id)
  ), computed_profile as (
    select
      event_totals.total_xp,
      coalesce((
        select max(level_threshold.level_no)
        from (
          values
            (1, 0),
            (2, 100),
            (3, 300),
            (4, 600),
            (5, 1000),
            (6, 1500),
            (7, 2500),
            (8, 4000),
            (9, 6000),
            (10, 10000)
        ) as level_threshold(level_no, minimum_xp)
        where event_totals.total_xp >= level_threshold.minimum_xp
      ), 1) as level,
      coalesce((select latest_login.streak_days from latest_login), 0) as streak_days,
      (select latest_login.last_active_date from latest_login) as last_active_date,
      badge_json.badges
    from event_totals
    cross join badge_json
  )
  update public.user_xp profile
  set total_xp = computed_profile.total_xp,
      level = computed_profile.level,
      streak_days = computed_profile.streak_days,
      last_active_date = computed_profile.last_active_date,
      badges = computed_profile.badges,
      updated_at = clock_timestamp()
  from computed_profile
  where profile.user_id = p_user_id
  returning profile.* into v_profile;

  return v_profile;
end;
$function$;

revoke all on function app_private.recompute_xp_profile(uuid) from public, anon, authenticated;

do $recompute_all_xp_profiles$
declare
  v_user_id uuid;
begin
  for v_user_id in
    select profile.user_id from public.user_xp profile
    union
    select event_row.user_id from public.xp_events event_row
    order by 1
  loop
    perform app_private.recompute_xp_profile(v_user_id);
  end loop;
end
$recompute_all_xp_profiles$;

-- Remove all legacy XP policies before installing the exact read-only model.
do $drop_legacy_xp_policies$
declare
  policy_row record;
begin
  for policy_row in
    select policy.schemaname, policy.tablename, policy.policyname
    from pg_catalog.pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename in ('user_xp', 'xp_events')
  loop
    execute format(
      'drop policy %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  end loop;
end
$drop_legacy_xp_policies$;

alter table public.user_xp enable row level security;
alter table public.xp_events enable row level security;

revoke all on table public.user_xp, public.xp_events from public, anon, authenticated;

do $revoke_untrusted_xp_column_privileges$
declare
  relation_row record;
  v_columns text;
begin
  for relation_row in
    select relation.oid, relation_schema.nspname, relation.relname
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace relation_schema
      on relation_schema.oid = relation.relnamespace
    where relation_schema.nspname = 'public'
      and relation.relname in ('user_xp', 'xp_events')
  loop
    select string_agg(format('%I', attribute.attname), ', ' order by attribute.attnum)
    into v_columns
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = relation_row.oid
      and attribute.attnum > 0
      and not attribute.attisdropped;

    execute format(
      'revoke select (%1$s), insert (%1$s), update (%1$s), references (%1$s) on table %2$I.%3$I from public, anon, authenticated',
      v_columns,
      relation_row.nspname,
      relation_row.relname
    );
  end loop;
end
$revoke_untrusted_xp_column_privileges$;

grant select on table public.user_xp, public.xp_events to authenticated;
grant select, insert, update, delete on table public.user_xp, public.xp_events to service_role;

create policy user_xp_authenticated_leaderboard
on public.user_xp
for select
to authenticated
using ((select public.current_app_user_id()) is not null);

create policy xp_events_authenticated_own
on public.xp_events
for select
to authenticated
using (user_id = (select public.current_app_user_id()));

-- Existing live XP functions, if any, were snapshotted above. Remove all
-- untrusted execution before exposing the actor-bound replacement.
do $contain_legacy_xp_mutators$
declare
  function_row record;
begin
  for function_row in
    select function_definition.oid
    from pg_catalog.pg_proc function_definition
    join pg_catalog.pg_namespace function_schema
      on function_schema.oid = function_definition.pronamespace
    where function_schema.nspname in ('public', 'app_private')
      and function_definition.prokind in ('f', 'p')
      and (
        function_definition.proname ~* '(^|_)xp($|_)|(award|add|grant|record|increment).*xp|xp.*(award|add|grant|record|increment)'
        or function_definition.prosrc ilike '%user_xp%'
        or function_definition.prosrc ilike '%xp_events%'
      )
  loop
    execute format(
      'alter routine %s owner to %I',
      function_row.oid::regprocedure,
      current_user
    );
    execute format(
      'revoke all on routine %s from public, anon, authenticated',
      function_row.oid::regprocedure
    );
  end loop;
end
$contain_legacy_xp_mutators$;

do $drop_existing_daily_xp_api_overloads$
declare
  routine_row record;
begin
  for routine_row in
    select function_row.oid
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_namespace function_schema
      on function_schema.oid = function_row.pronamespace
    where function_row.prokind in ('f', 'p')
      and (
        (function_schema.nspname = 'public' and function_row.proname = 'award_my_daily_xp')
        or (
          function_schema.nspname = 'app_private'
          and function_row.proname = 'award_my_daily_xp_impl'
        )
      )
    order by case when function_schema.nspname = 'public' then 0 else 1 end,
      function_row.oid
  loop
    execute format('drop routine %s', routine_row.oid::regprocedure);
  end loop;
end
$drop_existing_daily_xp_api_overloads$;

create or replace function app_private.award_my_daily_xp_impl(p_event_type text, p_source_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_actor_user_id uuid := public.current_app_user_id();
  v_now timestamptz := clock_timestamp();
  v_business_day date := (v_now at time zone 'Asia/Ho_Chi_Minh')::date;
  v_xp_amount integer;
  v_idempotency_key text;
  v_inserted_event_id uuid;
  v_profile public.user_xp;
  v_old_badges jsonb := '[]'::jsonb;
  v_new_badges jsonb := '[]'::jsonb;
begin
  if v_actor_user_id is null or not exists (
    select 1
    from public.users app_user
    where app_user.id = v_actor_user_id
      and coalesce(app_user.is_active, true)
  ) then
    raise exception 'An authenticated app user is required to award daily XP'
      using errcode = '42501';
  end if;

  if p_event_type not in ('daily_login', 'daily_checkin') then
    raise exception 'Unsupported daily XP event type: %', p_event_type
      using errcode = '22023';
  end if;

  if p_event_type = 'daily_login' then
    if p_source_id is not null then
      raise exception 'daily_login does not accept a source UUID'
        using errcode = '22023';
    end if;
    v_xp_amount := 5;
  else
    if p_source_id is null then
      raise exception 'daily_checkin requires an attendance UUID'
        using errcode = '22023';
    end if;

    if not exists (
      select 1
      from public.hrm_attendance attendance
      join public.employees employee
        on employee.id = attendance."employeeId"
      where attendance.id = p_source_id
        and employee.user_id = v_actor_user_id
        and nullif(btrim(attendance."checkIn"::text), '') is not null
        and attendance.date::text = v_business_day::text
    ) then
      raise exception 'Attendance source is missing, unchecked, off-day, or belongs to another app user'
        using errcode = '22023';
    end if;

    v_xp_amount := 10;
  end if;

  v_idempotency_key := format('%s:%s', p_event_type, v_business_day);

  insert into public.user_xp(user_id)
  values (v_actor_user_id)
  on conflict (user_id) do nothing;

  select profile.*
  into v_profile
  from public.user_xp profile
  where profile.user_id = v_actor_user_id
  for update;

  v_old_badges := coalesce(v_profile.badges, '[]'::jsonb);

  insert into public.xp_events(
    user_id,
    event_type,
    xp_amount,
    description,
    metadata,
    created_at,
    source_type,
    source_id,
    idempotency_key
  )
  values (
    v_actor_user_id,
    p_event_type,
    v_xp_amount,
    case p_event_type
      when 'daily_login' then 'Đăng nhập hàng ngày'
      when 'daily_checkin' then 'Check-in hàng ngày'
    end,
    jsonb_build_object(
      'businessDay', v_business_day,
      'sourceVerified', p_event_type = 'daily_checkin'
    ),
    v_now,
    case p_event_type
      when 'daily_login' then 'system'
      when 'daily_checkin' then 'hrm_attendance'
    end,
    p_source_id,
    v_idempotency_key
  )
  on conflict (user_id, idempotency_key)
    where idempotency_key is not null
  do nothing
  returning id into v_inserted_event_id;

  if v_inserted_event_id is not null then
    v_profile := app_private.recompute_xp_profile(v_actor_user_id);

    select coalesce(
      jsonb_agg(new_badge.badge order by new_badge.ordinality),
      '[]'::jsonb
    )
    into v_new_badges
    from jsonb_array_elements(coalesce(v_profile.badges, '[]'::jsonb))
      with ordinality as new_badge(badge, ordinality)
    where not exists (
      select 1
      from jsonb_array_elements(v_old_badges) old_badge
      where old_badge ->> 'id' = new_badge.badge ->> 'id'
    );
  end if;

  return jsonb_build_object(
    'awarded', v_inserted_event_id is not null,
    'xpGained', case when v_inserted_event_id is null then 0 else v_xp_amount end,
    'profile', jsonb_build_object(
      'id', v_profile.id,
      'userId', v_profile.user_id,
      'totalXp', v_profile.total_xp,
      'level', v_profile.level,
      'streakDays', v_profile.streak_days,
      'lastActiveDate', v_profile.last_active_date,
      'badges', coalesce(v_profile.badges, '[]'::jsonb),
      'createdAt', v_profile.created_at,
      'updatedAt', v_profile.updated_at
    ),
    'newBadges', v_new_badges
  );
end;
$function$;

create or replace function public.award_my_daily_xp(p_event_type text, p_source_id uuid default null)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $function$
  select app_private.award_my_daily_xp_impl(p_event_type, p_source_id);
$function$;

revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated;

revoke all on function app_private.award_my_daily_xp_impl(text, uuid) from public, anon, authenticated;
grant execute on function app_private.award_my_daily_xp_impl(text, uuid) to authenticated;

revoke all on function public.award_my_daily_xp(text, uuid) from public, anon, authenticated;
grant execute on function public.award_my_daily_xp(text, uuid) to authenticated;

notify pgrst, 'reload schema';
