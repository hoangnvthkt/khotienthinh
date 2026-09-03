-- Align the Project Material Request screen and RLS with the fixed Room model.
-- Room grants remain additive to PBAC v2; workflow/status guards still enforce
-- the exact action and assignment at transition time.

create or replace function app_private.material_request_can_select_v2(
  p_request_origin text,
  p_project_id text,
  p_construction_site_id text,
  p_requester_id uuid,
  p_submitted_to_user_id text,
  p_source_warehouse_id text,
  p_site_warehouse_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(p_request_origin, 'wms') = 'project' then
      p_project_id is not null
      and (
        public.is_admin()
        or public.is_module_admin('DA')
        or p_requester_id = public.current_app_user_id()
        or p_submitted_to_user_id = public.current_app_user_id()::text
        or app_private.project_scope_has_any_grant_v2(p_project_id, p_construction_site_id, public.current_app_user_id())
        or app_private.material_has_any_action(
          p_project_id,
          p_construction_site_id,
          array[
            'project.material_request.view',
            'project.material_request.create',
            'project.material_request.edit_own',
            'project.material_request.edit_all',
            'project.material_request.submit',
            'project.material_request.return',
            'project.material_request.approve',
            'project.material_request.confirm_fulfillment',
            'project.material_request.view_available_stock'
          ],
          public.current_app_user_id()
        )
        or app_private.project_user_has_room_action(
          public.current_app_user_id(), p_project_id, p_construction_site_id, 'material_request', 'view'
        )
      )
    else app_private.wms_request_can_access(
      p_requester_id, p_submitted_to_user_id, p_source_warehouse_id, p_site_warehouse_id
    )
  end;
$$;

create or replace function app_private.material_request_can_write_v2(
  p_request_origin text,
  p_project_id text,
  p_construction_site_id text,
  p_requester_id uuid,
  p_submitted_to_user_id text,
  p_source_warehouse_id text,
  p_site_warehouse_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(p_request_origin, 'wms') = 'project' then
      app_private.material_has_action(
        p_project_id, p_construction_site_id, 'project.material_request.create', public.current_app_user_id()
      )
      or app_private.project_user_has_room_action(
        public.current_app_user_id(), p_project_id, p_construction_site_id, 'material_request', 'submit'
      )
    else app_private.wms_request_can_access(
      p_requester_id, p_submitted_to_user_id, p_source_warehouse_id, p_site_warehouse_id
    )
  end;
$$;

create or replace function app_private.material_request_can_update_v2(
  p_request_origin text,
  p_project_id text,
  p_construction_site_id text,
  p_status text,
  p_requester_id uuid,
  p_submitted_to_user_id text,
  p_source_warehouse_id text,
  p_site_warehouse_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(p_request_origin, 'wms') = 'project' then
      public.is_admin()
      or public.is_module_admin('DA')
      or (
        coalesce(p_status, 'DRAFT') in ('DRAFT', 'REJECTED')
        and (
          app_private.material_has_action(p_project_id, p_construction_site_id, 'project.material_request.edit_all', public.current_app_user_id())
          or (
            p_requester_id = public.current_app_user_id()
            and (
              app_private.material_has_action(p_project_id, p_construction_site_id, 'project.material_request.edit_own', public.current_app_user_id())
              or app_private.project_user_has_room_action(
                public.current_app_user_id(), p_project_id, p_construction_site_id, 'material_request', 'edit'
              )
            )
          )
        )
      )
      or (
        p_submitted_to_user_id = public.current_app_user_id()::text
        and app_private.material_has_any_action(
          p_project_id,
          p_construction_site_id,
          array[
            'project.material_request.return',
            'project.material_request.approve',
            'project.material_request.confirm_fulfillment'
          ],
          public.current_app_user_id()
        )
      )
    else app_private.wms_request_can_access(
      p_requester_id, p_submitted_to_user_id, p_source_warehouse_id, p_site_warehouse_id
    )
  end;
$$;

create or replace function app_private.material_request_can_delete_v3(
  p_request_origin text,
  p_project_id text,
  p_construction_site_id text,
  p_status text,
  p_ever_submitted boolean,
  p_requester_id uuid,
  p_submitted_to_user_id text,
  p_source_warehouse_id text,
  p_site_warehouse_id text,
  p_workflow_step text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(p_request_origin, 'wms') = 'project' then (
      public.is_admin()
      or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'delete')
      or (
        app_private.project_user_has_room_action(
          public.current_app_user_id(), p_project_id, p_construction_site_id, 'material_request', 'delete'
        )
        and (
          coalesce(p_status, 'DRAFT') in ('DRAFT', 'REJECTED')
          or coalesce(p_workflow_step, '') = 'returned_to_creator'
        )
      )
      or (
        p_requester_id = public.current_app_user_id()
        and (
          coalesce(p_status, 'DRAFT') = 'REJECTED'
          or coalesce(p_workflow_step, '') = 'returned_to_creator'
          or (coalesce(p_status, 'DRAFT') = 'DRAFT' and not coalesce(p_ever_submitted, false))
        )
      )
    )
    else app_private.material_request_can_delete_v2(
      p_request_origin, p_project_id, p_status, p_ever_submitted, p_requester_id,
      p_submitted_to_user_id, p_source_warehouse_id, p_site_warehouse_id, p_workflow_step
    )
  end;
$$;

revoke all on function app_private.material_request_can_select_v2(text, text, text, uuid, text, text, text) from public, anon;
revoke all on function app_private.material_request_can_write_v2(text, text, text, uuid, text, text, text) from public, anon;
revoke all on function app_private.material_request_can_update_v2(text, text, text, text, uuid, text, text, text) from public, anon;
revoke all on function app_private.material_request_can_delete_v3(text, text, text, text, boolean, uuid, text, text, text, text) from public, anon;
grant execute on function app_private.material_request_can_select_v2(text, text, text, uuid, text, text, text) to authenticated;
grant execute on function app_private.material_request_can_write_v2(text, text, text, uuid, text, text, text) to authenticated;
grant execute on function app_private.material_request_can_update_v2(text, text, text, text, uuid, text, text, text) to authenticated;
grant execute on function app_private.material_request_can_delete_v3(text, text, text, text, boolean, uuid, text, text, text, text) to authenticated;

drop policy if exists requests_select on public.requests;
create policy requests_select
  on public.requests
  for select
  to authenticated
  using (
    app_private.material_request_can_select_v2(
      request_origin, project_id, construction_site_id, requester_id, submitted_to_user_id, source_warehouse_id, site_warehouse_id
    )
    or app_private.material_request_workflow_participant_can_select(id)
  );

drop policy if exists requests_insert on public.requests;
create policy requests_insert
  on public.requests
  for insert
  to authenticated
  with check (
    app_private.material_request_can_write_v2(
      request_origin, project_id, construction_site_id, requester_id, submitted_to_user_id, source_warehouse_id, site_warehouse_id
    )
  );

drop policy if exists requests_update on public.requests;
create policy requests_update
  on public.requests
  for update
  to authenticated
  using (
    app_private.material_request_can_update_v2(
      request_origin, project_id, construction_site_id, status::text, requester_id, submitted_to_user_id, source_warehouse_id, site_warehouse_id
    )
    or (
      requester_id = public.current_app_user_id()
      and coalesce(status::text, 'DRAFT') in ('DRAFT', 'REJECTED')
      and app_private.material_request_can_write_v2(
        request_origin, project_id, construction_site_id, requester_id, submitted_to_user_id, source_warehouse_id, site_warehouse_id
      )
    )
  )
  with check (
    app_private.material_request_can_update_v2(
      request_origin, project_id, construction_site_id, status::text, requester_id, submitted_to_user_id, source_warehouse_id, site_warehouse_id
    )
    or (
      requester_id = public.current_app_user_id()
      and coalesce(status::text, 'DRAFT') in ('DRAFT', 'REJECTED')
      and app_private.material_request_can_write_v2(
        request_origin, project_id, construction_site_id, requester_id, submitted_to_user_id, source_warehouse_id, site_warehouse_id
      )
    )
  );

drop policy if exists requests_delete on public.requests;
create policy requests_delete
  on public.requests
  for delete
  to authenticated
  using (
    app_private.material_request_can_delete_v3(
      request_origin, project_id, construction_site_id, status::text, ever_submitted, requester_id,
      submitted_to_user_id, source_warehouse_id, site_warehouse_id, workflow_step
    )
  );

notify pgrst, 'reload schema';
