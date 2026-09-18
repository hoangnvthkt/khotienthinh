-- The production DELETE policy calls material_request_can_delete_v3. Keep its
-- Project/Room branch authoritative and isolate the transition-era WMS branch
-- used by v1/v2. There is no canonical WMS delete action to infer here.
create or replace function app_private.material_request_wms_can_delete_compatibility(
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
  select coalesce(
    public.is_admin()
    or public.is_module_admin('WMS')
    or (
      coalesce(p_status, 'DRAFT') in ('DRAFT', 'REJECTED')
      and p_requester_id = public.current_app_user_id()
    )
    or app_private.current_user_is_global_wms_keeper()
    or app_private.current_user_is_wms_keeper_for(p_source_warehouse_id)
    or app_private.current_user_is_wms_keeper_for(p_site_warehouse_id)
    or (
      p_submitted_to_user_id is not null
      and p_submitted_to_user_id = public.current_app_user_id()::text
    ),
    false
  );
$$;

create or replace function app_private.material_request_can_delete(
  p_request_origin text,
  p_project_id text,
  p_status text,
  p_ever_submitted boolean,
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
      coalesce(p_status, 'DRAFT') in ('DRAFT', 'REJECTED')
      and (
        public.is_admin()
        or public.is_module_admin('DA')
        or (
          p_requester_id = public.current_app_user_id()
          and not coalesce(p_ever_submitted, false)
          and app_private.material_has_action(
            p_project_id,
            null,
            'project.material_request.create',
            public.current_app_user_id()
          )
        )
      )
    else app_private.material_request_wms_can_delete_compatibility(
      p_status,
      p_requester_id,
      p_submitted_to_user_id,
      p_source_warehouse_id,
      p_site_warehouse_id
    )
  end;
$$;

create or replace function app_private.material_request_can_delete_v2(
  p_request_origin text,
  p_project_id text,
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
      or app_private.project_user_has_permission(p_project_id, null, 'delete')
      or (
        p_requester_id = public.current_app_user_id()
        and (
          coalesce(p_status, 'DRAFT') = 'REJECTED'
          or coalesce(p_workflow_step, '') = 'returned_to_creator'
          or (
            coalesce(p_status, 'DRAFT') = 'DRAFT'
            and not coalesce(p_ever_submitted, false)
          )
        )
      )
    )
    else app_private.material_request_wms_can_delete_compatibility(
      p_status,
      p_requester_id,
      p_submitted_to_user_id,
      p_source_warehouse_id,
      p_site_warehouse_id
    )
  end;
$$;

revoke all on function app_private.material_request_wms_can_delete_compatibility(
  text, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function app_private.material_request_wms_can_delete_compatibility(
  text, uuid, text, text, text
) to service_role;

-- v1 has no runtime caller; v2 is reached by the SECURITY DEFINER v3 policy
-- helper. Neither needs direct client execution.
revoke all on function app_private.material_request_can_delete(
  text, text, text, boolean, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function app_private.material_request_can_delete(
  text, text, text, boolean, uuid, text, text, text
) to service_role;

revoke all on function app_private.material_request_can_delete_v2(
  text, text, text, boolean, uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function app_private.material_request_can_delete_v2(
  text, text, text, boolean, uuid, text, text, text, text
) to service_role;
