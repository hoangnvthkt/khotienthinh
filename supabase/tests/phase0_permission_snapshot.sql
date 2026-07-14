-- Phase 0 permission containment snapshot.
-- Metadata only: policies, grants, helper functions, and user-table triggers.
-- Kept as one result set because `supabase db query -f` returns the final result.

with affected_tables(table_name) as (
  values
    ('projects'),
    ('project_groups'),
    ('project_types'),
    ('project_sectors'),
    ('work_groups'),
    ('work_group_members'),
    ('quality_checklists'),
    ('quality_inspection_attempts'),
    ('inspection_categories'),
    ('inspection_work_types'),
    ('inspection_templates'),
    ('template_sections'),
    ('inspection_template_items'),
    ('quality_checklist_templates'),
    ('users')
),
policy_rows as (
  select
    'policy' as section,
    format('%I.%I.%I', p.schemaname, p.tablename, p.policyname) as entity,
    jsonb_build_object(
      'cmd', p.cmd,
      'roles', p.roles,
      'qual', p.qual,
      'with_check', p.with_check
    ) as metadata
  from pg_policies p
  join affected_tables t on t.table_name = p.tablename
  where p.schemaname = 'public'
),
grant_rows as (
  select
    'role_table_grant' as section,
    format('%I.%I -> %I.%s', g.table_schema, g.table_name, g.grantee, g.privilege_type) as entity,
    jsonb_build_object(
      'table_schema', g.table_schema,
      'table_name', g.table_name,
      'grantee', g.grantee,
      'privilege_type', g.privilege_type
    ) as metadata
  from information_schema.role_table_grants g
  join affected_tables t using (table_name)
  where g.table_schema = 'public'
    and g.grantee in ('anon', 'authenticated')
),
function_rows as (
  select
    'function' as section,
    format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as entity,
    jsonb_build_object(
      'schema_name', n.nspname,
      'function_name', p.proname,
      'arguments', pg_get_function_identity_arguments(p.oid),
      'security_definer', p.prosecdef
    ) as metadata
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where (n.nspname, p.proname) in (
    ('app_private', 'can_access_module'),
    ('app_private', 'prevent_users_privilege_self_update'),
    ('public', 'is_admin'),
    ('public', 'is_module_admin')
  )
),
trigger_rows as (
  select
    'trigger' as section,
    format('public.users.%I', tg.tgname) as entity,
    jsonb_build_object(
      'trigger_name', tg.tgname,
      'trigger_definition', pg_get_triggerdef(tg.oid)
    ) as metadata
  from pg_trigger tg
  where tg.tgrelid = 'public.users'::regclass
    and not tg.tgisinternal
)
select section, entity, metadata
from policy_rows
union all
select section, entity, metadata
from grant_rows
union all
select section, entity, metadata
from function_rows
union all
select section, entity, metadata
from trigger_rows
order by section, entity;
