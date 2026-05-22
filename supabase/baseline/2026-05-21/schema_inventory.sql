with
tables as (
  select jsonb_agg(
    jsonb_build_object(
      'schema', schemaname,
      'name', tablename,
      'owner', tableowner,
      'rls_enabled', c.relrowsecurity,
      'rls_forced', c.relforcerowsecurity
    )
    order by schemaname, tablename
  ) as data
  from pg_tables t
  join pg_class c on c.relname = t.tablename
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = t.schemaname
  where schemaname = 'public'
),
columns as (
  select jsonb_agg(
    jsonb_build_object(
      'table_schema', table_schema,
      'table_name', table_name,
      'column_name', column_name,
      'ordinal_position', ordinal_position,
      'data_type', data_type,
      'udt_name', udt_name,
      'is_nullable', is_nullable,
      'column_default', column_default,
      'identity_generation', identity_generation,
      'character_maximum_length', character_maximum_length,
      'numeric_precision', numeric_precision,
      'numeric_scale', numeric_scale
    )
    order by table_schema, table_name, ordinal_position
  ) as data
  from information_schema.columns
  where table_schema = 'public'
),
constraints as (
  select jsonb_agg(
    jsonb_build_object(
      'schema', n.nspname,
      'table_name', c.relname,
      'constraint_name', con.conname,
      'constraint_type', con.contype,
      'definition', pg_get_constraintdef(con.oid, true)
    )
    order by n.nspname, c.relname, con.conname
  ) as data
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
),
indexes as (
  select jsonb_agg(
    jsonb_build_object(
      'schema', schemaname,
      'table_name', tablename,
      'index_name', indexname,
      'definition', indexdef
    )
    order by schemaname, tablename, indexname
  ) as data
  from pg_indexes
  where schemaname = 'public'
),
views as (
  select jsonb_agg(
    jsonb_build_object(
      'schema', table_schema,
      'name', table_name,
      'definition', view_definition
    )
    order by table_schema, table_name
  ) as data
  from information_schema.views
  where table_schema = 'public'
),
functions as (
  select jsonb_agg(
    jsonb_build_object(
      'schema', n.nspname,
      'name', p.proname,
      'identity_arguments', pg_get_function_identity_arguments(p.oid),
      'return_type', pg_get_function_result(p.oid),
      'security_definer', p.prosecdef,
      'volatility', p.provolatile,
      'definition', pg_get_functiondef(p.oid)
    )
    order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
  ) as data
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind in ('f', 'p')
),
policies as (
  select jsonb_agg(
    jsonb_build_object(
      'schema', schemaname,
      'table_name', tablename,
      'policy_name', policyname,
      'permissive', permissive,
      'roles', roles,
      'cmd', cmd,
      'qual', qual,
      'with_check', with_check
    )
    order by schemaname, tablename, policyname
  ) as data
  from pg_policies
  where schemaname = 'public'
),
triggers as (
  select jsonb_agg(
    jsonb_build_object(
      'schema', n.nspname,
      'table_name', c.relname,
      'trigger_name', tg.tgname,
      'enabled', tg.tgenabled,
      'definition', pg_get_triggerdef(tg.oid, true)
    )
    order by n.nspname, c.relname, tg.tgname
  ) as data
  from pg_trigger tg
  join pg_class c on c.oid = tg.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and not tg.tgisinternal
),
types as (
  select jsonb_agg(
    jsonb_build_object(
      'schema', n.nspname,
      'name', t.typname,
      'type_kind', t.typtype,
      'enum_labels', (
        select jsonb_agg(e.enumlabel order by e.enumsortorder)
        from pg_enum e
        where e.enumtypid = t.oid
      )
    )
    order by n.nspname, t.typname
  ) as data
  from pg_type t
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public'
    and t.typtype in ('e', 'd')
),
table_grants as (
  select jsonb_agg(
    jsonb_build_object(
      'table_schema', table_schema,
      'table_name', table_name,
      'grantee', grantee,
      'privilege_type', privilege_type,
      'is_grantable', is_grantable
    )
    order by table_schema, table_name, grantee, privilege_type
  ) as data
  from information_schema.table_privileges
  where table_schema = 'public'
    and grantee in ('anon', 'authenticated', 'service_role', 'public')
)
select jsonb_pretty(jsonb_build_object(
  'captured_at', now(),
  'schema', 'public',
  'tables', coalesce((select data from tables), '[]'::jsonb),
  'columns', coalesce((select data from columns), '[]'::jsonb),
  'constraints', coalesce((select data from constraints), '[]'::jsonb),
  'indexes', coalesce((select data from indexes), '[]'::jsonb),
  'views', coalesce((select data from views), '[]'::jsonb),
  'functions', coalesce((select data from functions), '[]'::jsonb),
  'policies', coalesce((select data from policies), '[]'::jsonb),
  'triggers', coalesce((select data from triggers), '[]'::jsonb),
  'types', coalesce((select data from types), '[]'::jsonb),
  'table_grants', coalesce((select data from table_grants), '[]'::jsonb)
)) as schema_inventory;
