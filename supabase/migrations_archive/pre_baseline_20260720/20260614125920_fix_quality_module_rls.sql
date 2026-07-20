-- Fix Quality module RLS for the current app auth model.
--
-- The frontend uses the publishable/anon Supabase client and app-level
-- permissions for Quality actions. Existing Quality policies were limited to
-- the Postgres "authenticated" role, causing draft saves from the UI to fail
-- with: "new row violates row-level security policy".

do $$
declare
  tbl text;
  policy_name text;
begin
  foreach tbl in array array[
    'quality_checklists',
    'quality_inspection_attempts',
    'inspection_categories',
    'inspection_work_types',
    'inspection_templates',
    'template_sections',
    'inspection_template_items',
    'quality_checklist_templates'
  ]
  loop
    if to_regclass(format('public.%I', tbl)) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', tbl);
    execute format('grant select, insert, update, delete on table public.%I to anon, authenticated', tbl);

    for policy_name in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = tbl
        and policyname in (
          'quality_checklists_all',
          'attempts_all',
          'categories_all',
          'work_types_all',
          'templates_all',
          'sections_all',
          'items_all',
          'quality_checklist_templates_all',
          'quality_module_all'
        )
    loop
      execute format('drop policy if exists %I on public.%I', policy_name, tbl);
    end loop;

    execute format(
      'create policy quality_module_all on public.%I for all to anon, authenticated using (true) with check (true)',
      tbl
    );
  end loop;
end $$;
