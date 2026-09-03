-- Phase 0 critical permission containment.
-- Keep legacy permission fields, but move critical enforcement into RLS/trigger.

create schema if not exists app_private;

revoke all on schema app_private from public;
revoke all on schema app_private from anon;
grant usage on schema app_private to authenticated;

create or replace function app_private.can_access_module(p_module text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users u
    where u.id = public.current_app_user_id()
      and coalesce(u.is_active, false)
      and (
        u.role = 'ADMIN'
        or p_module = any(coalesce(u.allowed_modules, '{}'::text[]))
        or p_module = any(coalesce(u.admin_modules, '{}'::text[]))
        or coalesce(u.allowed_sub_modules, '{}'::jsonb) ? p_module
        or coalesce(u.admin_sub_modules, '{}'::jsonb) ? p_module
      )
  );
$$;

revoke all on function app_private.can_access_module(text) from public;
revoke all on function app_private.can_access_module(text) from anon;
grant execute on function app_private.can_access_module(text) to authenticated;

create or replace function app_private.prevent_users_privilege_self_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid;
begin
  if public.is_admin() then
    return new;
  end if;

  current_user_id := public.current_app_user_id();

  if current_user_id is null
    or old.id is distinct from current_user_id
    or new.id is distinct from current_user_id
  then
    raise exception 'Only admins can update other user rows'
      using errcode = '42501';
  end if;

  if old.role is distinct from new.role
    or old.auth_id is distinct from new.auth_id
    or old.email is distinct from new.email
    or old.username is distinct from new.username
    or old.assigned_warehouse_id is distinct from new.assigned_warehouse_id
    or old.allowed_modules is distinct from new.allowed_modules
    or old.admin_modules is distinct from new.admin_modules
    or old.allowed_sub_modules is distinct from new.allowed_sub_modules
    or old.admin_sub_modules is distinct from new.admin_sub_modules
    or old.is_active is distinct from new.is_active
  then
    raise exception 'Self profile updates cannot change protected permission fields'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function app_private.prevent_users_privilege_self_update() from public;
revoke all on function app_private.prevent_users_privilege_self_update() from anon;
revoke all on function app_private.prevent_users_privilege_self_update() from authenticated;

alter table public.users enable row level security;

drop trigger if exists trg_users_prevent_privilege_self_update on public.users;
create trigger trg_users_prevent_privilege_self_update
  before update on public.users
  for each row
  execute function app_private.prevent_users_privilege_self_update();

drop policy if exists users_update on public.users;
drop policy if exists users_update_admin on public.users;
drop policy if exists users_update_self_profile on public.users;

create policy users_update_admin
on public.users for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy users_update_self_profile
on public.users for update
to authenticated
using (id = public.current_app_user_id())
with check (id = public.current_app_user_id());

do $$
declare
  tbl text;
  policy_name text;
  select_expr text;
  write_expr text;
begin
  foreach tbl in array array[
    'projects',
    'project_groups',
    'project_types',
    'project_sectors'
  ]
  loop
    select_expr := 'app_private.can_access_module(''DA'') or app_private.can_access_module(''SETTINGS'')';
    write_expr := 'public.is_module_admin(''DA'') or public.is_module_admin(''SETTINGS'')';
    if to_regclass(format('public.%I', tbl)) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', tbl);
    execute format('revoke all privileges on table public.%I from public', tbl);
    execute format('revoke all privileges on table public.%I from anon', tbl);
    execute format('revoke all privileges on table public.%I from authenticated', tbl);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', tbl);

    for policy_name in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = tbl
    loop
      execute format('drop policy if exists %I on public.%I', policy_name, tbl);
    end loop;

    execute format('create policy %I on public.%I for select to authenticated using (%s)', tbl || '_phase0_select', tbl, select_expr);
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)', tbl || '_phase0_insert', tbl, write_expr);
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', tbl || '_phase0_update', tbl, write_expr, write_expr);
    execute format('create policy %I on public.%I for delete to authenticated using (%s)', tbl || '_phase0_delete', tbl, write_expr);
  end loop;

  foreach tbl in array array[
    'work_groups',
    'work_group_members'
  ]
  loop
    select_expr := 'app_private.can_access_module(''HRM'') or app_private.can_access_module(''DA'') or app_private.can_access_module(''SETTINGS'')';
    write_expr := 'public.is_module_admin(''HRM'') or public.is_module_admin(''DA'') or public.is_module_admin(''SETTINGS'')';
    if to_regclass(format('public.%I', tbl)) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', tbl);
    execute format('revoke all privileges on table public.%I from public', tbl);
    execute format('revoke all privileges on table public.%I from anon', tbl);
    execute format('revoke all privileges on table public.%I from authenticated', tbl);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', tbl);

    for policy_name in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = tbl
    loop
      execute format('drop policy if exists %I on public.%I', policy_name, tbl);
    end loop;

    execute format('create policy %I on public.%I for select to authenticated using (%s)', tbl || '_phase0_select', tbl, select_expr);
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)', tbl || '_phase0_insert', tbl, write_expr);
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', tbl || '_phase0_update', tbl, write_expr, write_expr);
    execute format('create policy %I on public.%I for delete to authenticated using (%s)', tbl || '_phase0_delete', tbl, write_expr);
  end loop;

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
    select_expr := 'app_private.can_access_module(''DA'') or app_private.can_access_module(''SETTINGS'')';
    write_expr := 'public.is_module_admin(''DA'') or public.is_module_admin(''SETTINGS'')';
    if to_regclass(format('public.%I', tbl)) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', tbl);
    execute format('revoke all privileges on table public.%I from public', tbl);
    execute format('revoke all privileges on table public.%I from anon', tbl);
    execute format('revoke all privileges on table public.%I from authenticated', tbl);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', tbl);

    for policy_name in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = tbl
    loop
      execute format('drop policy if exists %I on public.%I', policy_name, tbl);
    end loop;

    execute format('create policy %I on public.%I for select to authenticated using (%s)', tbl || '_phase0_select', tbl, select_expr);
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)', tbl || '_phase0_insert', tbl, write_expr);
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', tbl || '_phase0_update', tbl, write_expr, write_expr);
    execute format('create policy %I on public.%I for delete to authenticated using (%s)', tbl || '_phase0_delete', tbl, write_expr);
  end loop;
end $$;

notify pgrst, 'reload schema';
