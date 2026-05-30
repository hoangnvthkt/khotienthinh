-- Allow the destination/site warehouse keeper to complete fulfillment batch
-- receipt after approving/completing the linked WMS transfer transaction.
--
-- Before this, only ADMIN/WMS admin/the project material handler could mutate
-- material_request_fulfillment_batches and lines. A site keeper could complete
-- the transfer transaction, but the batch stayed "issued" and the project
-- request stayed IN_TRANSIT.

create schema if not exists app_private;

create or replace function app_private.material_request_fulfillment_can_view(p_request_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_admin()
    or public.is_module_admin('WMS')
    or exists (
      select 1
      from public.requests r
      where r.id = p_request_id
        and (
          r.requester_id::text = public.current_app_user_id()::text
          or r.submitted_to_user_id = public.current_app_user_id()::text
          or app_private.current_user_is_global_wms_keeper()
          or app_private.current_user_is_wms_keeper_for(r.source_warehouse_id)
          or app_private.current_user_is_wms_keeper_for(r.site_warehouse_id)
          or app_private.project_doc_can_view(
            r.project_id::text,
            r.construction_site_id::text,
            r.submitted_to_user_id
          )
        )
    );
$$;

create or replace function app_private.material_request_fulfillment_can_mutate(p_request_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_admin()
    or public.is_module_admin('WMS')
    or exists (
      select 1
      from public.requests r
      where r.id = p_request_id
        and (
          (
            r.submitted_to_user_id is not null
            and r.submitted_to_user_id = public.current_app_user_id()::text
          )
          or app_private.current_user_is_global_wms_keeper()
          or app_private.current_user_is_wms_keeper_for(r.source_warehouse_id)
          or app_private.current_user_is_wms_keeper_for(r.site_warehouse_id)
        )
    );
$$;

revoke all on function app_private.material_request_fulfillment_can_view(text) from public;
revoke all on function app_private.material_request_fulfillment_can_mutate(text) from public;
grant execute on function app_private.material_request_fulfillment_can_view(text) to authenticated;
grant execute on function app_private.material_request_fulfillment_can_mutate(text) to authenticated;

notify pgrst, 'reload schema';
