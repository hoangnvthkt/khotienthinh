select ddl
from (
  select '-- Managed-schema application policies and triggers.'::text as ddl,
    '00:header'::text as sort_key

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
) rendered
order by sort_key;
