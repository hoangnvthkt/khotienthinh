with fingerprint_objects as (
  select
    'schema'::text as kind,
    n.nspname::text as identity,
    md5(n.nspname)::text as definition_hash
  from pg_namespace n
  where n.nspname in ('public', 'app_private', 'private')

  union all

  select
    'relation',
    format('%I.%I', n.nspname, c.relname),
    md5(concat_ws('|', c.relkind, c.relrowsecurity, c.relforcerowsecurity))
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'app_private', 'private')
    and c.relkind in ('r', 'p', 'v', 'm', 'S')

  union all

  select
    'column',
    format('%I.%I.%I', n.nspname, c.relname, a.attname),
    md5(concat_ws('|',
      a.attnum,
      pg_catalog.format_type(a.atttypid, a.atttypmod),
      a.attnotnull,
      a.attidentity,
      a.attgenerated,
      pg_get_expr(d.adbin, d.adrelid)
    ))
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where n.nspname in ('public', 'app_private', 'private')
    and c.relkind in ('r', 'p', 'v', 'm')
    and a.attnum > 0
    and not a.attisdropped

  union all

  select
    'constraint',
    format('%I.%I.%I', n.nspname, c.relname, con.conname),
    md5(pg_get_constraintdef(con.oid, true))
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'app_private', 'private')

  union all

  select
    'index',
    format('%I.%I', n.nspname, c.relname),
    md5(pg_get_indexdef(c.oid))
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'app_private', 'private')
    and c.relkind = 'i'

  union all

  select
    'routine',
    format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)),
    md5(pg_get_functiondef(p.oid))
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'app_private', 'private')
    and p.prokind <> 'a'

  union all

  select
    'trigger',
    format('%I.%I.%I', n.nspname, c.relname, t.tgname),
    md5(pg_get_triggerdef(t.oid, true))
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_proc p on p.oid = t.tgfoid
  join pg_namespace fn on fn.oid = p.pronamespace
  where not t.tgisinternal
    and (
      n.nspname in ('public', 'app_private', 'private')
      or (n.nspname in ('auth', 'storage') and fn.nspname in ('public', 'app_private', 'private'))
    )

  union all

  select
    'policy',
    format('%I.%I.%I', p.schemaname, p.tablename, p.policyname),
    md5(concat_ws('|', p.permissive, p.roles::text, p.cmd, p.qual, p.with_check))
  from pg_policies p
  where p.schemaname in ('public', 'app_private', 'private', 'auth', 'storage')

  union all

  select
    'table_grant',
    format('%I.%I.%I.%s', g.table_schema, g.table_name, g.grantee, g.privilege_type),
    md5(concat_ws('|', g.privilege_type, g.is_grantable))
  from information_schema.role_table_grants g
  where g.table_schema in ('public', 'app_private', 'private', 'auth', 'storage')
    and g.grantee in ('anon', 'authenticated', 'service_role')

  union all

  select
    'routine_grant',
    format('%I.%I.%I.%s', g.routine_schema, g.routine_name, g.grantee, g.privilege_type),
    md5(concat_ws('|', g.privilege_type, g.is_grantable))
  from information_schema.role_routine_grants g
  where g.routine_schema in ('public', 'app_private', 'private')
    and g.grantee in ('anon', 'authenticated', 'service_role')

  union all

  select
    'extension',
    e.extname,
    md5(e.extname)
  from pg_extension e
  where e.extname not in ('plpgsql')
)
select jsonb_build_object(
  'kind', kind,
  'identity', identity,
  'definition_hash', definition_hash
)::text
from fingerprint_objects
order by kind, identity, definition_hash;
