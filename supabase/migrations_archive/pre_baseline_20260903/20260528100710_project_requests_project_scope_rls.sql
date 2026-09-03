-- Project material requests must be isolated by project_id.
-- Legacy WMS requests remain available only through WMS permissions.

create schema if not exists app_private;
revoke all on schema app_private from public;
revoke all on schema app_private from anon;
revoke all on schema app_private from authenticated;

alter table public.requests enable row level security;

alter table public.requests
  drop constraint if exists requests_project_origin_project_id_required;

alter table public.requests
  add constraint requests_project_origin_project_id_required
  check (request_origin <> 'project' or project_id is not null);

create or replace function app_private.current_user_is_global_wms_keeper()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users u
    where u.id = public.current_app_user_id()
      and coalesce(u.is_active, true)
      and u.role::text = 'WAREHOUSE_KEEPER'
      and u.assigned_warehouse_id is null
  );
$$;

create or replace function app_private.current_user_is_wms_keeper_for(p_warehouse_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users u
    where u.id = public.current_app_user_id()
      and coalesce(u.is_active, true)
      and u.role::text = 'WAREHOUSE_KEEPER'
      and p_warehouse_id is not null
      and u.assigned_warehouse_id = p_warehouse_id
  );
$$;

create or replace function app_private.project_request_can_write(
  p_project_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_project_id is not null
    and (
      public.is_admin()
      or app_private.project_user_has_permission(p_project_id, null, 'submit')
      or app_private.project_user_has_permission(p_project_id, null, 'edit')
    );
$$;

create or replace function app_private.wms_request_can_access(
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
  select public.is_admin()
    or public.is_module_admin('WMS')
    or p_requester_id = public.current_app_user_id()
    or (
      p_submitted_to_user_id is not null
      and p_submitted_to_user_id = public.current_app_user_id()::text
    )
    or app_private.current_user_is_global_wms_keeper()
    or app_private.current_user_is_wms_keeper_for(p_source_warehouse_id)
    or app_private.current_user_is_wms_keeper_for(p_site_warehouse_id);
$$;

create or replace function app_private.material_request_can_select(
  p_request_origin text,
  p_project_id text,
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
      and app_private.project_doc_can_view(p_project_id, null, p_submitted_to_user_id)
    else app_private.wms_request_can_access(
      p_requester_id,
      p_submitted_to_user_id,
      p_source_warehouse_id,
      p_site_warehouse_id
    )
  end;
$$;

create or replace function app_private.material_request_can_write(
  p_request_origin text,
  p_project_id text,
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
      app_private.project_request_can_write(p_project_id)
      or app_private.project_doc_is_current_handler(p_submitted_to_user_id)
    else app_private.wms_request_can_access(
      p_requester_id,
      p_submitted_to_user_id,
      p_source_warehouse_id,
      p_site_warehouse_id
    )
  end;
$$;

create or replace function app_private.material_request_can_update(
  p_request_origin text,
  p_project_id text,
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
      app_private.project_request_can_write(p_project_id)
      or app_private.project_doc_can_update_step(p_project_id, null, p_status, p_submitted_to_user_id)
    else app_private.wms_request_can_access(
      p_requester_id,
      p_submitted_to_user_id,
      p_source_warehouse_id,
      p_site_warehouse_id
    )
  end;
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
      app_private.project_doc_can_delete(p_project_id, null, p_status, p_ever_submitted)
    else (
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
      )
    )
  end;
$$;

drop policy if exists requests_select on public.requests;
drop policy if exists requests_write on public.requests;
drop policy if exists requests_insert on public.requests;
drop policy if exists requests_update on public.requests;
drop policy if exists requests_delete on public.requests;

revoke all on table public.requests from anon;
revoke all on table public.requests from public;
revoke all on table public.requests from authenticated;
grant select, insert, update, delete on table public.requests to authenticated;

create policy requests_select
  on public.requests
  for select
  to authenticated
  using (
    app_private.material_request_can_select(
      request_origin,
      project_id,
      requester_id,
      submitted_to_user_id,
      source_warehouse_id,
      site_warehouse_id
    )
  );

create policy requests_insert
  on public.requests
  for insert
  to authenticated
  with check (
    app_private.material_request_can_write(
      request_origin,
      project_id,
      requester_id,
      submitted_to_user_id,
      source_warehouse_id,
      site_warehouse_id
    )
  );

create policy requests_update
  on public.requests
  for update
  to authenticated
  using (
    app_private.material_request_can_update(
      request_origin,
      project_id,
      status::text,
      requester_id,
      submitted_to_user_id,
      source_warehouse_id,
      site_warehouse_id
    )
  )
  with check (
    app_private.material_request_can_write(
      request_origin,
      project_id,
      requester_id,
      submitted_to_user_id,
      source_warehouse_id,
      site_warehouse_id
    )
    or app_private.material_request_can_update(
      request_origin,
      project_id,
      status::text,
      requester_id,
      submitted_to_user_id,
      source_warehouse_id,
      site_warehouse_id
    )
  );

create policy requests_delete
  on public.requests
  for delete
  to authenticated
  using (
    app_private.material_request_can_delete(
      request_origin,
      project_id,
      status::text,
      ever_submitted,
      requester_id,
      submitted_to_user_id,
      source_warehouse_id,
      site_warehouse_id
    )
  );

notify pgrst, 'reload schema';
