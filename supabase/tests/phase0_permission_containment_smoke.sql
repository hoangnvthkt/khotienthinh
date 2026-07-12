-- Phase 0 critical containment smoke checks.
-- Raises exceptions when broad anon/authenticated write exposure remains.

do $$
declare
  affected_tables text[] := array[
    'projects',
    'project_groups',
    'project_types',
    'project_sectors',
    'work_groups',
    'work_group_members',
    'quality_checklists',
    'quality_inspection_attempts',
    'inspection_categories',
    'inspection_work_types',
    'inspection_templates',
    'template_sections',
    'inspection_template_items',
    'quality_checklist_templates'
  ];
  project_workgroup_tables text[] := array[
    'projects',
    'project_groups',
    'project_types',
    'project_sectors',
    'work_groups',
    'work_group_members'
  ];
  quality_tables text[] := array[
    'quality_checklists',
    'quality_inspection_attempts',
    'inspection_categories',
    'inspection_work_types',
    'inspection_templates',
    'template_sections',
    'inspection_template_items',
    'quality_checklist_templates'
  ];
begin
  if exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee = 'anon'
      and table_name = any(affected_tables)
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'phase0 smoke failed: anon still has write grants on affected tables';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = any(project_workgroup_tables)
      and (
        (qual ilike '%auth.role%' and qual ilike '%anon%' and qual ilike '%authenticated%')
        or
        (with_check ilike '%auth.role%' and with_check ilike '%anon%' and with_check ilike '%authenticated%')
      )
  ) then
    raise exception 'phase0 smoke failed: broad anon/authenticated policies remain on project or work group tables';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = any(quality_tables)
      and policyname = 'quality_module_all'
  ) then
    raise exception 'phase0 smoke failed: quality_module_all policy still exists';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'users'
      and policyname = 'users_update'
  ) then
    raise exception 'phase0 smoke failed: broad users_update policy still exists';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.users'::regclass
      and tgname = 'trg_users_prevent_privilege_self_update'
      and not tgisinternal
  ) then
    raise exception 'phase0 smoke failed: users privilege self-update trigger is missing';
  end if;

  if to_regprocedure('app_private.can_access_module(text)') is null then
    raise exception 'phase0 smoke failed: app_private.can_access_module(text) is missing';
  end if;
end $$;
