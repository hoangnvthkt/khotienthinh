-- Authorization remediation P0-A: block anonymous access to application data.
--
-- Vioo has no anonymous feature: the login screen only calls Supabase Auth and
-- every data screen runs as `authenticated`. The anon key ships in the web
-- bundle, so unauthenticated callers must not read, list or change data.
-- See docs/security/authorization-remediation-plan-2026-09-27.md (P0-A).

-- 1. Relations and sequences in public keep no anon privilege, including
--    objects that later migrations (run as postgres) create.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon;

-- 2. SECURITY DEFINER functions that anon could execute (Security Advisor 0028).
--    Explicit authenticated grants stay for the screens that call them.
revoke execute on function public.get_material_request_workflow_board(text, text, jsonb, integer, text) from public, anon;
revoke execute on function public.get_project_material_request_board(text, text, jsonb, integer, text) from public, anon;
revoke execute on function public.get_project_material_request_detail(text) from public, anon;
revoke execute on function public.get_project_workflow_action_context(text, text) from public, anon;
revoke execute on function public.get_project_workflow_timeline(uuid) from public, anon;
revoke execute on function public.timeout_stale_user_sessions(integer) from public, anon;
revoke execute on function public.enforce_active_app_actor() from public, anon;
revoke execute on function public.sync_auth_user_profile() from public, anon;
revoke execute on function public.sync_employee_status_from_metadata() from public, anon;
-- No caller remains: cron runs process_project_workflow_sla_reminders directly
-- and daily-log policies use Room helpers.
revoke execute on function public.process_project_workflow_sla_escalations() from public, anon, authenticated;
revoke execute on function public.daily_log_user_has_project_permission(text, text, text, text) from public, anon, authenticated;

-- 3. Storage: anon cannot list, upload, overwrite or delete objects.
--    Public-bucket download links do not use RLS and keep working.
create policy storage_objects_no_anon on storage.objects
  as restrictive for all to anon
  using (false) with check (false);

alter policy "Allow public read from avatars" on storage.objects to authenticated;
alter policy "Allow public upload to avatars" on storage.objects to authenticated;
alter policy "Public read access for project-attachments" on storage.objects to authenticated;
alter policy "Allow upload to project-attachments" on storage.objects to authenticated;
alter policy public_read on storage.objects to authenticated;
alter policy auth_insert on storage.objects to authenticated;
alter policy checkin_photos_select on storage.objects to authenticated;

-- 4. Overwrite and delete are limited to the uploader or a System Admin.
drop policy "Public Access project-photos" on storage.objects;
create policy project_photos_select on storage.objects
  for select to authenticated
  using (bucket_id = 'project-photos');
create policy project_photos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-photos');
create policy project_photos_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'project-photos' and (owner_id = (select auth.uid())::text or public.is_admin()))
  with check (bucket_id = 'project-photos');
create policy project_photos_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'project-photos' and (owner_id = (select auth.uid())::text or public.is_admin()));

alter policy auth_delete on storage.objects to authenticated
  using (bucket_id = 'project-files' and (owner_id = (select auth.uid())::text or public.is_admin()));

alter policy "Allow update in project-attachments" on storage.objects to authenticated
  using (
    bucket_id = 'project-attachments'
    and split_part(name, '/', 1) <> 'quality'
    and (owner_id = (select auth.uid())::text or public.is_admin())
  )
  with check (bucket_id = 'project-attachments' and split_part(name, '/', 1) <> 'quality');
alter policy "Allow delete from project-attachments" on storage.objects to authenticated
  using (
    bucket_id = 'project-attachments'
    and split_part(name, '/', 1) <> 'quality'
    and (owner_id = (select auth.uid())::text or public.is_admin())
  );

alter policy checkin_photos_update on storage.objects
  using (bucket_id = 'checkin-photos' and (owner_id = (select auth.uid())::text or public.is_admin()))
  with check (bucket_id = 'checkin-photos');
alter policy checkin_photos_delete on storage.objects
  using (bucket_id = 'checkin-photos' and (owner_id = (select auth.uid())::text or public.is_admin()));

alter policy workflow_attachments_update on storage.objects
  using (bucket_id = 'workflow-attachments' and (owner_id = (select auth.uid())::text or public.is_admin()))
  with check (bucket_id = 'workflow-attachments');
alter policy workflow_attachments_delete on storage.objects
  using (bucket_id = 'workflow-attachments' and (owner_id = (select auth.uid())::text or public.is_admin()));

-- 5. workflow-templates holds approval signatures and print templates.
--    A signature belongs to one user; print templates follow template edit rights;
--    request template DOCX versions keep their request_template_docx_* policies.
create or replace function app_private.workflow_templates_object_can_mutate(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_name like 'signatures/%' then
      public.is_admin()
      or p_name = 'signatures/' || public.current_app_user_id()::text || '.png'
    when p_name like 'request-template-versions/%' then false
    when split_part(p_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      app_private.workflow_template_actor_can_edit(
        split_part(p_name, '/', 1)::uuid,
        public.current_app_user_id()
      )
    else public.is_admin()
  end;
$$;

revoke all on function app_private.workflow_templates_object_can_mutate(text) from public, anon;
grant execute on function app_private.workflow_templates_object_can_mutate(text) to authenticated;

alter policy workflow_templates_read on storage.objects to authenticated;
alter policy workflow_templates_upload on storage.objects to authenticated
  with check (bucket_id = 'workflow-templates' and app_private.workflow_templates_object_can_mutate(name));
alter policy workflow_templates_update on storage.objects to authenticated
  using (bucket_id = 'workflow-templates' and app_private.workflow_templates_object_can_mutate(name))
  with check (bucket_id = 'workflow-templates' and app_private.workflow_templates_object_can_mutate(name));
alter policy workflow_templates_delete on storage.objects to authenticated
  using (bucket_id = 'workflow-templates' and app_private.workflow_templates_object_can_mutate(name));
