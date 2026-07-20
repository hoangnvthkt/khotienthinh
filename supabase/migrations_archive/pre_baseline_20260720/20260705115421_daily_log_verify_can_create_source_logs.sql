drop policy if exists daily_logs_insert on public.daily_logs;
create policy daily_logs_insert
  on public.daily_logs
  for insert
  to authenticated
  with check (
    public.is_admin()
    or app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'edit')
    or app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'submit')
    or app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'verify')
    or (
      summary_source_type = 'member_contributions'
      and (
        app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'verify')
        or not app_private.daily_log_scope_has_staff(project_id::text, construction_site_id::text)
      )
    )
  );

drop policy if exists daily_logs_update on public.daily_logs;
create policy daily_logs_update
  on public.daily_logs
  for update
  to authenticated
  using (
    app_private.project_doc_can_update_step(project_id::text, construction_site_id::text, status::text, submitted_to_user_id)
    or (
      coalesce(summary_source_type, '') <> 'member_contributions'
      and coalesce(created_by_id, submitted_by_id, submitted_by) = public.current_app_user_id()::text
      and coalesce(status::text, 'draft') in ('draft', 'rejected')
      and (
        app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'edit')
        or app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'submit')
        or app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'verify')
        or not app_private.daily_log_scope_has_staff(project_id::text, construction_site_id::text)
      )
    )
    or (
      summary_source_type = 'member_contributions'
      and coalesce(status::text, 'draft') in ('draft', 'rejected')
      and (
        app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'verify')
        or not app_private.daily_log_scope_has_staff(project_id::text, construction_site_id::text)
      )
    )
  )
  with check (project_id is not null or construction_site_id is not null or public.is_admin());

notify pgrst, 'reload schema';
