-- Allow project PBAC users to mutate Gantt tasks.
--
-- Daily log verification recalculates task progress and writes back to
-- project_tasks. The previous live policies only allowed public.is_admin(),
-- so users with project/sub-tab admin rights and project_staff edit
-- permission could save daily logs but then fail when task progress synced.

alter table public.project_tasks enable row level security;

drop policy if exists project_tasks_write on public.project_tasks;
drop policy if exists project_tasks_insert on public.project_tasks;
drop policy if exists project_tasks_update on public.project_tasks;
drop policy if exists project_tasks_delete on public.project_tasks;

create policy project_tasks_insert
  on public.project_tasks
  for insert
  to authenticated
  with check (
    public.is_admin()
    or app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'edit')
  );

create policy project_tasks_update
  on public.project_tasks
  for update
  to authenticated
  using (
    public.is_admin()
    or app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'edit')
  )
  with check (
    public.is_admin()
    or app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'edit')
  );

create policy project_tasks_delete
  on public.project_tasks
  for delete
  to authenticated
  using (
    public.is_admin()
    or app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'delete')
  );
