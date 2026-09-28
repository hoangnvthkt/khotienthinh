-- Rollback for authorization_p2_documents_activities_rls: reopens reads of
-- project_documents and activities to every signed-in person (the P0 state).
-- created_by stays on project_documents; it is harmless.
begin;
drop policy if exists project_documents_select on public.project_documents;
drop policy if exists project_documents_insert on public.project_documents;
drop policy if exists project_documents_update on public.project_documents;
drop policy if exists project_documents_delete on public.project_documents;
create policy proj_docs_select on public.project_documents for select using (true);
create policy proj_docs_write on public.project_documents for insert with check (true);
create policy proj_docs_update on public.project_documents for update using (public.is_admin());
create policy proj_docs_delete on public.project_documents for delete using (public.is_admin());

drop policy if exists activities_select on public.activities;
drop policy if exists activities_insert on public.activities;
create policy activities_select on public.activities for select using (true);
create policy activities_write on public.activities for insert to authenticated with check (true);

drop function if exists app_private.project_documents_can(text, text, text[]);
drop function if exists app_private.activity_wms_scope();
commit;
