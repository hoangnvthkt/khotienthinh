-- P1.4 finding: audit_trail was readable by every signed-in user. It stores
-- old/new row data of 30 tables (salary, project finance, contracts…), which
-- bypasses the finance / contract view switches. Only the Audit Trail page
-- reads it, so limit reads to system Admins and holders of
-- system.audit_trail.view. Writes are unchanged.
drop policy if exists audit_trail_read on public.audit_trail;
create policy audit_trail_read on public.audit_trail
  for select to authenticated
  using (
    (select public.is_admin())
    or (select app_private.has_permission(public.current_app_user_id(), 'system.audit_trail.view', 'global', '*'))
  );
