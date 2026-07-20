do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'approval_rules',
    'project_permission_types',
    'project_staff',
    'project_staff_permissions'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is null then
      continue;
    end if;

    execute format('revoke all on table public.%I from anon', table_name);
    execute format('revoke all on table public.%I from authenticated', table_name);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', table_name);

    execute format('alter table public.%I enable row level security', table_name);

    execute format('drop policy if exists %I on public.%I', table_name || '_select', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_insert', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_update', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_delete', table_name);

    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      table_name || '_select',
      table_name
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.is_module_admin(%L))',
      table_name || '_insert',
      table_name,
      'DA'
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.is_module_admin(%L)) with check (public.is_module_admin(%L))',
      table_name || '_update',
      table_name,
      'DA',
      'DA'
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.is_module_admin(%L))',
      table_name || '_delete',
      table_name,
      'DA'
    );
  end loop;
end $$;

notify pgrst, 'reload schema';
