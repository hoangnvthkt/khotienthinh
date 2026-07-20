-- Allow HRM module/sub-module admins to manage employee profiles.
-- Frontend canManage('/hrm/employees') allows system admins, legacy HRM module admins,
-- and route-level admins for /hrm/employees; mirror that at RLS level.

create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated;

create or replace function app_private.can_manage_hrm_employees()
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
      and coalesce(u.is_active, true)
      and (
        u.role = 'ADMIN'
        or 'HRM' = any(coalesce(u.admin_modules, '{}'::text[]))
        or coalesce(u.admin_sub_modules -> 'HRM', '[]'::jsonb) ? '/hrm/employees'
      )
  );
$$;

revoke all on function app_private.can_manage_hrm_employees() from public, anon, authenticated;
grant execute on function app_private.can_manage_hrm_employees() to authenticated;

drop policy if exists employees_write on public.employees;
drop policy if exists employees_update on public.employees;
drop policy if exists employees_delete on public.employees;

create policy employees_write
on public.employees for insert
to authenticated
with check (app_private.can_manage_hrm_employees());

create policy employees_update
on public.employees for update
to authenticated
using (app_private.can_manage_hrm_employees())
with check (app_private.can_manage_hrm_employees());

create policy employees_delete
on public.employees for delete
to authenticated
using (app_private.can_manage_hrm_employees());

notify pgrst, 'reload schema';
