-- Keep check-in writes strict but usable from the authenticated frontend.
-- Employees may create/update only their own attendance record; admins and HRM
-- module admins can manage all records.

drop policy if exists attendance_write on public.hrm_attendance;
drop policy if exists attendance_insert on public.hrm_attendance;
drop policy if exists attendance_update on public.hrm_attendance;

create policy attendance_insert on public.hrm_attendance
for insert
to authenticated
with check (
  public.is_admin()
  or public.is_module_admin('HRM')
  or "employeeId" in (
    select e.id
    from public.employees e
    where e.user_id = public.current_app_user_id()
       or lower(e.email) = lower(coalesce(auth.jwt() ->> 'email', current_setting('request.jwt.claim.email', true), ''))
  )
);

create policy attendance_update on public.hrm_attendance
for update
to authenticated
using (
  public.is_admin()
  or public.is_module_admin('HRM')
  or "employeeId" in (
    select e.id
    from public.employees e
    where e.user_id = public.current_app_user_id()
       or lower(e.email) = lower(coalesce(auth.jwt() ->> 'email', current_setting('request.jwt.claim.email', true), ''))
  )
)
with check (
  public.is_admin()
  or public.is_module_admin('HRM')
  or "employeeId" in (
    select e.id
    from public.employees e
    where e.user_id = public.current_app_user_id()
       or lower(e.email) = lower(coalesce(auth.jwt() ->> 'email', current_setting('request.jwt.claim.email', true), ''))
  )
);
