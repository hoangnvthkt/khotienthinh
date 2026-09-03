select ddl
from (
  select '-- Managed-schema application policies and triggers.'::text as ddl,
    '00:header'::text as sort_key

  union all

  select
    'set search_path = public, app_private, private, extensions, auth, storage, pg_catalog;'::text,
    '00:search_path'::text

  union all

  select
    format(
      'revoke all privileges on table %I.%I from anon, authenticated, service_role;',
      target.schema_name,
      target.table_name
    ),
    format('acl:00:%I.%I', target.schema_name, target.table_name)
  from (values ('auth', 'users'), ('storage', 'objects')) target(schema_name, table_name)

  union all

  select
    format(
      'grant %s on table %I.%I to %I;',
      string_agg(distinct grant_row.privilege_type, ', ' order by grant_row.privilege_type),
      grant_row.table_schema,
      grant_row.table_name,
      grant_row.grantee
    ),
    format('acl:01:%I.%I.%I', grant_row.table_schema, grant_row.table_name, grant_row.grantee)
  from information_schema.role_table_grants grant_row
  where (grant_row.table_schema, grant_row.table_name) in (('auth', 'users'), ('storage', 'objects'))
    and grant_row.grantee in ('anon', 'authenticated', 'service_role')
    and grant_row.grantor = 'postgres'
  group by grant_row.table_schema, grant_row.table_name, grant_row.grantee

  union all

  select
    format(
      'drop policy if exists %I on %I.%I;%screate policy %I on %I.%I as %s for %s to %s%s%s;',
      p.policyname,
      p.schemaname,
      p.tablename,
      E'\n',
      p.policyname,
      p.schemaname,
      p.tablename,
      p.permissive,
      p.cmd,
      (
        select string_agg(quote_ident(role_name), ', ' order by role_name)
        from unnest(p.roles) role_name
      ),
      case when p.qual is null then '' else format(' using (%s)', p.qual) end,
      case when p.with_check is null then '' else format(' with check (%s)', p.with_check) end
    ) as ddl,
    format('policy:%I.%I.%I', p.schemaname, p.tablename, p.policyname) as sort_key
  from pg_policies p
  where p.schemaname in ('auth', 'storage')

  union all

  select
    format(
      'drop trigger if exists %I on %I.%I;%s%s;',
      t.tgname,
      n.nspname,
      c.relname,
      E'\n',
      pg_get_triggerdef(t.oid, true)
    ),
    format('trigger:%I.%I.%I', n.nspname, c.relname, t.tgname)
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_proc fn_proc on fn_proc.oid = t.tgfoid
  join pg_namespace fn_schema on fn_schema.oid = fn_proc.pronamespace
  where not t.tgisinternal
    and n.nspname in ('auth', 'storage')
    and fn_schema.nspname in ('public', 'app_private', 'private')

  union all

  select
    $$select pg_catalog.set_config('search_path', '', false);$$::text,
    'zz:reset_search_path'::text
) rendered
order by sort_key;
