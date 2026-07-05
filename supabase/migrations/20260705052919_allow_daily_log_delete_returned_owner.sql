drop policy if exists daily_logs_delete on public.daily_logs;

create policy daily_logs_delete
  on public.daily_logs
  for delete
  to authenticated
  using (
    public.is_admin()
    or (
      coalesce(status, 'draft') in ('draft', 'rejected')
      and coalesce(created_by_id, submitted_by_id, submitted_by, created_by) = public.current_app_user_id()::text
    )
  );

notify pgrst, 'reload schema';
