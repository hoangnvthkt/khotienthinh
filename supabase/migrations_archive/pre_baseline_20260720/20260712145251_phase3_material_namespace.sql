-- Phase 3.3 Material namespace refactor.
-- Material mutations now use explicit project.material_* PBAC v2 grants.

create schema if not exists app_private;

insert into public.permission_actions (
  module_code,
  action,
  permission_code,
  label,
  scope_modes,
  legacy_module_key,
  legacy_route,
  legacy_admin_only,
  sort_order
)
values (
  'project.material_request',
  'confirm_fulfillment',
  'project.material_request.confirm_fulfillment',
  'Xác nhận cấp hàng',
  array['global','project','construction_site']::text[],
  'DA',
  '/da/tabs/material',
  true,
  125
)
on conflict (permission_code) do update
set module_code = excluded.module_code,
    action = excluded.action,
    label = excluded.label,
    scope_modes = excluded.scope_modes,
    legacy_module_key = excluded.legacy_module_key,
    legacy_route = excluded.legacy_route,
    legacy_admin_only = excluded.legacy_admin_only,
    sort_order = excluded.sort_order,
    is_active = true,
    updated_at = now();

create or replace function app_private.material_has_action(
  p_project_id text,
  p_construction_site_id text,
  p_permission_code text,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_permission_code like 'project.material%'
    and (
      public.is_admin()
      or public.is_module_admin('DA')
      or app_private.project_has_permission_v2(
        p_project_id,
        p_construction_site_id,
        p_permission_code,
        p_user_id
      )
    );
$$;

revoke all on function app_private.material_has_action(text, text, text, uuid) from public;
revoke all on function app_private.material_has_action(text, text, text, uuid) from anon;
grant execute on function app_private.material_has_action(text, text, text, uuid) to authenticated;

create or replace function app_private.material_has_any_action(
  p_project_id text,
  p_construction_site_id text,
  p_permission_codes text[],
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from unnest(coalesce(p_permission_codes, '{}'::text[])) as permission_code
    where app_private.material_has_action(
      p_project_id,
      p_construction_site_id,
      permission_code,
      p_user_id
    )
  );
$$;

revoke all on function app_private.material_has_any_action(text, text, text[], uuid) from public;
revoke all on function app_private.material_has_any_action(text, text, text[], uuid) from anon;
grant execute on function app_private.material_has_any_action(text, text, text[], uuid) to authenticated;

create or replace function app_private.material_transition_context_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select current_setting('app.material_transition_context', true) = 'on';
$$;

revoke all on function app_private.material_transition_context_enabled() from public;
revoke all on function app_private.material_transition_context_enabled() from anon;
grant execute on function app_private.material_transition_context_enabled() to authenticated;

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
      and (
        public.is_admin()
        or public.is_module_admin('DA')
        or p_requester_id = public.current_app_user_id()
        or p_submitted_to_user_id = public.current_app_user_id()::text
        or app_private.project_scope_has_any_grant_v2(p_project_id, null, public.current_app_user_id())
        or app_private.material_has_any_action(
          p_project_id,
          null,
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
      )
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
      app_private.material_has_action(
        p_project_id,
        null,
        'project.material_request.create',
        public.current_app_user_id()
      )
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
      public.is_admin()
      or public.is_module_admin('DA')
      or (
        coalesce(p_status, 'DRAFT') in ('DRAFT', 'REJECTED')
        and (
          app_private.material_has_action(p_project_id, null, 'project.material_request.edit_all', public.current_app_user_id())
          or (
            p_requester_id = public.current_app_user_id()
            and app_private.material_has_action(p_project_id, null, 'project.material_request.edit_own', public.current_app_user_id())
          )
        )
      )
      or (
        p_submitted_to_user_id = public.current_app_user_id()::text
        and app_private.material_has_any_action(
          p_project_id,
          null,
          array[
            'project.material_request.return',
            'project.material_request.approve',
            'project.material_request.confirm_fulfillment'
          ],
          public.current_app_user_id()
        )
      )
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
      coalesce(p_status, 'DRAFT') in ('DRAFT', 'REJECTED')
      and (
        public.is_admin()
        or public.is_module_admin('DA')
        or (
          p_requester_id = public.current_app_user_id()
          and not coalesce(p_ever_submitted, false)
          and app_private.material_has_action(p_project_id, null, 'project.material_request.create', public.current_app_user_id())
        )
      )
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
      or p_submitted_to_user_id = public.current_app_user_id()::text
    )
  end;
$$;

revoke all on function app_private.material_request_can_select(text, text, uuid, text, text, text) from public, anon;
revoke all on function app_private.material_request_can_write(text, text, uuid, text, text, text) from public, anon;
revoke all on function app_private.material_request_can_update(text, text, text, uuid, text, text, text) from public, anon;
revoke all on function app_private.material_request_can_delete(text, text, text, boolean, uuid, text, text, text) from public, anon;
grant execute on function app_private.material_request_can_select(text, text, uuid, text, text, text) to authenticated;
grant execute on function app_private.material_request_can_write(text, text, uuid, text, text, text) to authenticated;
grant execute on function app_private.material_request_can_update(text, text, text, uuid, text, text, text) to authenticated;
grant execute on function app_private.material_request_can_delete(text, text, text, boolean, uuid, text, text, text) to authenticated;

create or replace function public.transition_project_material_request_status(
  p_request_id text,
  p_status text,
  p_action text,
  p_actor_user_id text,
  p_target_user_id text default null,
  p_target_permission text default null,
  p_note text default null,
  p_patch jsonb default '{}'::jsonb
)
returns public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.requests%rowtype;
  v_user_id uuid := public.current_app_user_id();
  v_required_permission text;
  v_previous_guard text;
begin
  if v_user_id is null or p_actor_user_id is distinct from v_user_id::text then
    raise exception 'Không xác định được người dùng chuyển bước phiếu vật tư.'
      using errcode = '42501';
  end if;

  select *
  into v_request
  from public.requests
  where id = p_request_id
    and coalesce(request_origin, 'wms') = 'project'
  for update;

  if not found then
    raise exception 'Không tìm thấy phiếu vật tư dự án.';
  end if;

  v_required_permission := case
    when upper(coalesce(p_action, '')) in ('SUBMITTED', 'RESUBMITTED') then 'project.material_request.submit'
    when upper(coalesce(p_action, '')) in ('RETURNED', 'REJECTED') then 'project.material_request.return'
    when upper(coalesce(p_action, '')) in ('FULFILLED', 'CONFIRMED', 'CONFIRM_FULFILLMENT') then 'project.material_request.confirm_fulfillment'
    when coalesce(p_patch->>'workflow_step', '') in ('site_quality_check', 'completed')
      or upper(coalesce(p_status, '')) in ('COMPLETED', 'IN_TRANSIT') then 'project.material_request.confirm_fulfillment'
    else 'project.material_request.approve'
  end;

  if v_required_permission = 'project.material_request.submit' then
    if coalesce(v_request.status::text, 'DRAFT') not in ('DRAFT', 'REJECTED') then
      raise exception 'Chỉ phiếu nháp hoặc bị trả lại mới được gửi duyệt.';
    end if;
    if not (public.is_admin() or public.is_module_admin('DA')) and v_request.requester_id is distinct from v_user_id then
      raise exception 'Chỉ người tạo phiếu mới được gửi duyệt.'
        using errcode = '42501';
    end if;
  elsif not (public.is_admin() or public.is_module_admin('DA')) then
    if v_request.submitted_to_user_id is not null
      and v_request.submitted_to_user_id <> v_user_id::text then
      raise exception 'Bạn không phải người đang được giao xử lý phiếu vật tư này.'
        using errcode = '42501';
    end if;
  end if;

  if not app_private.material_has_action(v_request.project_id, v_request.construction_site_id, v_required_permission, v_user_id) then
    raise exception 'Bạn cần quyền % để chuyển bước phiếu vật tư.', v_required_permission
      using errcode = '42501';
  end if;

  if nullif(p_target_user_id, '') is not null and nullif(p_target_permission, '') is not null then
    if not app_private.material_has_action(
      v_request.project_id,
      v_request.construction_site_id,
      p_target_permission,
      p_target_user_id::uuid
    ) then
      raise exception 'Người được chọn chưa có quyền % trong Tổ chức dự án.', p_target_permission
        using errcode = '42501';
    end if;
  end if;

  v_previous_guard := current_setting('app.material_transition_context', true);
  perform set_config('app.material_transition_context', 'on', true);

  update public.requests
  set
    status = coalesce(nullif(p_status, '')::public.request_status, status),
    logs = case when p_patch ? 'logs' then p_patch->'logs' else logs end,
    ever_submitted = case when p_patch ? 'ever_submitted' then coalesce((p_patch->>'ever_submitted')::boolean, ever_submitted) else ever_submitted end,
    last_action_by = case when p_patch ? 'last_action_by' then nullif(p_patch->>'last_action_by', '') else last_action_by end,
    last_action_at = case when p_patch ? 'last_action_at' then nullif(p_patch->>'last_action_at', '')::timestamptz else last_action_at end,
    workflow_step = case when p_patch ? 'workflow_step' then nullif(p_patch->>'workflow_step', '') else workflow_step end,
    workflow_step_started_at = case when p_patch ? 'workflow_step_started_at' then nullif(p_patch->>'workflow_step_started_at', '')::timestamptz else workflow_step_started_at end,
    workflow_step_due_at = case when p_patch ? 'workflow_step_due_at' then nullif(p_patch->>'workflow_step_due_at', '')::timestamptz else workflow_step_due_at end,
    workflow_step_sla_hours = case when p_patch ? 'workflow_step_sla_hours' then nullif(p_patch->>'workflow_step_sla_hours', '')::integer else workflow_step_sla_hours end,
    workflow_step_actor_user_id = case when p_patch ? 'workflow_step_actor_user_id' then nullif(p_patch->>'workflow_step_actor_user_id', '') else workflow_step_actor_user_id end,
    submitted_to_user_id = case when p_patch ? 'submitted_to_user_id' then nullif(p_patch->>'submitted_to_user_id', '') else submitted_to_user_id end,
    submitted_to_name = case when p_patch ? 'submitted_to_name' then nullif(p_patch->>'submitted_to_name', '') else submitted_to_name end,
    submitted_to_permission = case when p_patch ? 'submitted_to_permission' then nullif(p_patch->>'submitted_to_permission', '') else submitted_to_permission end,
    submission_note = case when p_patch ? 'submission_note' then nullif(p_patch->>'submission_note', '') else submission_note end
  where id = p_request_id
  returning * into v_request;

  perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
  return v_request;
end;
$$;

revoke all on function public.transition_project_material_request_status(text, text, text, text, text, text, text, jsonb) from public;
revoke all on function public.transition_project_material_request_status(text, text, text, text, text, text, text, jsonb) from anon;
grant execute on function public.transition_project_material_request_status(text, text, text, text, text, text, text, jsonb) to authenticated;

create or replace function app_private.project_material_request_can_select(
  p_project_id text,
  p_construction_site_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or public.is_module_admin('DA')
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
        'project.material_request.confirm_fulfillment'
      ],
      public.current_app_user_id()
    );
$$;

create or replace function app_private.project_material_request_can_mutate(
  p_project_id text,
  p_construction_site_id text,
  p_status text,
  p_requested_by text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or public.is_module_admin('DA')
    or (
      coalesce(p_status, 'draft') in ('draft', 'returned', 'rejected')
      and (
        app_private.material_has_action(p_project_id, p_construction_site_id, 'project.material_request.edit_all', public.current_app_user_id())
        or (
          p_requested_by = public.current_app_user_id()::text
          and app_private.material_has_action(p_project_id, p_construction_site_id, 'project.material_request.edit_own', public.current_app_user_id())
        )
      )
    );
$$;

alter table if exists public.material_budget_items enable row level security;
alter table if exists public.project_work_boq_items enable row level security;
alter table if exists public.project_material_requests enable row level security;

drop policy if exists material_budget_items_select on public.material_budget_items;
drop policy if exists material_budget_items_insert on public.material_budget_items;
drop policy if exists material_budget_items_update on public.material_budget_items;
drop policy if exists material_budget_items_delete on public.material_budget_items;

create policy material_budget_items_select
  on public.material_budget_items
  for select
  to authenticated
  using (
    public.is_admin()
    or public.is_module_admin('DA')
    or app_private.project_scope_has_any_grant_v2(project_id, construction_site_id, public.current_app_user_id())
    or app_private.material_has_any_action(project_id, construction_site_id, array['project.material.view','project.material_boq.view','project.material_boq.edit'], public.current_app_user_id())
  );

create policy material_budget_items_insert
  on public.material_budget_items
  for insert
  to authenticated
  with check (app_private.material_has_action(project_id, construction_site_id, 'project.material_boq.edit', public.current_app_user_id()));

create policy material_budget_items_update
  on public.material_budget_items
  for update
  to authenticated
  using (app_private.material_has_action(project_id, construction_site_id, 'project.material_boq.edit', public.current_app_user_id()))
  with check (app_private.material_has_action(project_id, construction_site_id, 'project.material_boq.edit', public.current_app_user_id()));

create policy material_budget_items_delete
  on public.material_budget_items
  for delete
  to authenticated
  using (
    app_private.material_has_any_action(project_id, construction_site_id, array['project.material_boq.delete','project.material_boq.edit'], public.current_app_user_id())
  );

drop policy if exists project_work_boq_items_project_access on public.project_work_boq_items;
drop policy if exists project_work_boq_items_select on public.project_work_boq_items;
drop policy if exists project_work_boq_items_insert on public.project_work_boq_items;
drop policy if exists project_work_boq_items_update on public.project_work_boq_items;
drop policy if exists project_work_boq_items_delete on public.project_work_boq_items;

create policy project_work_boq_items_select
  on public.project_work_boq_items
  for select
  to authenticated
  using (
    public.is_admin()
    or public.is_module_admin('DA')
    or app_private.project_scope_has_any_grant_v2(project_id, construction_site_id, public.current_app_user_id())
    or app_private.material_has_any_action(project_id, construction_site_id, array['project.material.view','project.material_boq.view','project.material_boq.edit'], public.current_app_user_id())
  );

create policy project_work_boq_items_insert
  on public.project_work_boq_items
  for insert
  to authenticated
  with check (app_private.material_has_action(project_id, construction_site_id, 'project.material_boq.edit', public.current_app_user_id()));

create policy project_work_boq_items_update
  on public.project_work_boq_items
  for update
  to authenticated
  using (app_private.material_has_action(project_id, construction_site_id, 'project.material_boq.edit', public.current_app_user_id()))
  with check (app_private.material_has_action(project_id, construction_site_id, 'project.material_boq.edit', public.current_app_user_id()));

create policy project_work_boq_items_delete
  on public.project_work_boq_items
  for delete
  to authenticated
  using (
    app_private.material_has_any_action(project_id, construction_site_id, array['project.material_boq.delete','project.material_boq.edit'], public.current_app_user_id())
  );

drop policy if exists project_material_requests_select on public.project_material_requests;
drop policy if exists project_material_requests_insert on public.project_material_requests;
drop policy if exists project_material_requests_update on public.project_material_requests;
drop policy if exists project_material_requests_delete on public.project_material_requests;
drop policy if exists project_material_requests_project_access on public.project_material_requests;

create policy project_material_requests_select
  on public.project_material_requests
  for select
  to authenticated
  using (app_private.project_material_request_can_select(project_id, construction_site_id));

create policy project_material_requests_insert
  on public.project_material_requests
  for insert
  to authenticated
  with check (app_private.material_has_action(project_id, construction_site_id, 'project.material_request.create', public.current_app_user_id()));

create policy project_material_requests_update
  on public.project_material_requests
  for update
  to authenticated
  using (app_private.project_material_request_can_mutate(project_id, construction_site_id, status::text, requested_by))
  with check (app_private.project_material_request_can_select(project_id, construction_site_id));

create policy project_material_requests_delete
  on public.project_material_requests
  for delete
  to authenticated
  using (
    coalesce(status::text, 'draft') in ('draft', 'returned', 'rejected')
    and app_private.project_material_request_can_mutate(project_id, construction_site_id, status::text, requested_by)
  );

create or replace function app_private.custom_material_request_can_select(
  p_project_id text,
  p_construction_site_id text,
  p_created_by uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or public.is_module_admin('DA')
    or public.is_module_admin('WMS')
    or app_private.company_procurement_can_manage()
    or p_created_by = public.current_app_user_id()
    or app_private.project_scope_has_any_grant_v2(p_project_id, p_construction_site_id, public.current_app_user_id())
    or app_private.material_has_any_action(
      p_project_id,
      p_construction_site_id,
      array[
        'project.custom_material.view',
        'project.custom_material.create',
        'project.custom_material.approve',
        'project.material_po.create',
        'project.material_po.receive'
      ],
      public.current_app_user_id()
    );
$$;

create or replace function app_private.custom_material_request_can_mutate(
  p_project_id text,
  p_construction_site_id text,
  p_created_by uuid,
  p_status text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or public.is_module_admin('DA')
    or (
      p_status in ('draft', 'returned')
      and app_private.material_has_action(p_project_id, p_construction_site_id, 'project.custom_material.create', public.current_app_user_id())
    )
    or (
      p_status in ('submitted', 'approved', 'rfq_created', 'po_created', 'partially_received')
      and (
        public.is_module_admin('WMS')
        or app_private.company_procurement_can_manage()
        or app_private.material_has_any_action(
          p_project_id,
          p_construction_site_id,
          array['project.custom_material.approve','project.material_po.create','project.material_po.receive'],
          public.current_app_user_id()
        )
      )
    );
$$;

revoke all on function app_private.custom_material_request_can_select(text, text, uuid) from public, anon;
revoke all on function app_private.custom_material_request_can_mutate(text, text, uuid, text) from public, anon;
grant execute on function app_private.custom_material_request_can_select(text, text, uuid) to authenticated;
grant execute on function app_private.custom_material_request_can_mutate(text, text, uuid, text) to authenticated;

create or replace function app_private.guard_custom_material_direct_status_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app_private.material_transition_context_enabled() or pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.status is distinct from old.status
    or new.submitted_at is distinct from old.submitted_at
    or new.approved_at is distinct from old.approved_at
    or new.approved_by is distinct from old.approved_by
    or new.returned_at is distinct from old.returned_at
    or new.returned_by is distinct from old.returned_by
    or new.rejected_at is distinct from old.rejected_at
    or new.rejected_by is distinct from old.rejected_by
    or new.cancelled_at is distinct from old.cancelled_at
    or new.cancelled_by is distinct from old.cancelled_by then
    raise exception 'Custom Material workflow fields must be changed through transition_custom_material_request_status.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_custom_material_direct_status_update on public.custom_material_requests;
create trigger guard_custom_material_direct_status_update
  before update on public.custom_material_requests
  for each row
  execute function app_private.guard_custom_material_direct_status_update();

create or replace function public.transition_custom_material_request_status(
  p_request_id uuid,
  p_status text,
  p_actor_user_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.custom_material_requests%rowtype;
  v_user_id uuid := public.current_app_user_id();
  v_required_permission text;
  v_line_status text;
  v_previous_guard text;
  v_result jsonb;
begin
  if v_user_id is null or p_actor_user_id is distinct from v_user_id then
    raise exception 'Không xác định được người dùng chuyển trạng thái phiếu CMR.'
      using errcode = '42501';
  end if;

  select *
  into v_request
  from public.custom_material_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Không tìm thấy phiếu CMR.';
  end if;

  v_required_permission := case
    when p_status = 'submitted' then 'project.custom_material.create'
    when p_status in ('po_created') then 'project.material_po.create'
    when p_status in ('partially_received', 'completed') then 'project.material_po.receive'
    else 'project.custom_material.approve'
  end;

  if p_status = 'submitted' and coalesce(v_request.status, 'draft') not in ('draft', 'returned') then
    raise exception 'Chỉ phiếu nháp hoặc bị trả lại mới được gửi duyệt.';
  end if;

  if not app_private.material_has_action(v_request.project_id, v_request.construction_site_id, v_required_permission, v_user_id) then
    raise exception 'Bạn cần quyền % để chuyển trạng thái CMR.', v_required_permission
      using errcode = '42501';
  end if;

  v_line_status := case p_status
    when 'submitted' then 'submitted'
    when 'approved' then 'approved'
    when 'rejected' then 'cancelled'
    when 'cancelled' then 'cancelled'
    else null
  end;

  v_previous_guard := current_setting('app.material_transition_context', true);
  perform set_config('app.material_transition_context', 'on', true);

  update public.custom_material_requests
  set
    status = p_status,
    updated_by = v_user_id,
    submitted_at = case when p_status = 'submitted' then now() else submitted_at end,
    approved_at = case when p_status = 'approved' then now() else approved_at end,
    approved_by = case when p_status = 'approved' then v_user_id else approved_by end,
    returned_at = case when p_status = 'returned' then now() else returned_at end,
    returned_by = case when p_status = 'returned' then v_user_id else returned_by end,
    rejected_at = case when p_status = 'rejected' then now() else rejected_at end,
    rejected_by = case when p_status = 'rejected' then v_user_id else rejected_by end,
    cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end,
    cancelled_by = case when p_status = 'cancelled' then v_user_id else cancelled_by end,
    updated_at = now()
  where id = p_request_id
  returning * into v_request;

  if v_line_status is not null then
    update public.custom_material_request_lines
    set status = v_line_status,
        updated_at = now()
    where request_id = p_request_id
      and status in ('draft', 'submitted');
  end if;

  insert into public.custom_material_request_events (
    request_id,
    event_type,
    actor_user_id,
    from_status,
    to_status,
    note,
    metadata
  )
  values (
    p_request_id,
    p_status,
    v_user_id,
    null,
    p_status,
    p_note,
    '{}'::jsonb
  );

  select to_jsonb(v_request)
    || jsonb_build_object(
      'lines',
      coalesce((
        select jsonb_agg(to_jsonb(l) order by l.sort_order)
        from public.custom_material_request_lines l
        where l.request_id = p_request_id
      ), '[]'::jsonb),
      'attachments',
      coalesce((
        select jsonb_agg(to_jsonb(a) order by a.created_at desc)
        from public.custom_material_request_attachments a
        where a.request_id = p_request_id
      ), '[]'::jsonb)
    )
  into v_result;

  perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
  return v_result;
end;
$$;

revoke all on function public.transition_custom_material_request_status(uuid, text, uuid, text) from public;
revoke all on function public.transition_custom_material_request_status(uuid, text, uuid, text) from anon;
grant execute on function public.transition_custom_material_request_status(uuid, text, uuid, text) to authenticated;

create or replace function app_private.guard_purchase_order_direct_status_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app_private.material_transition_context_enabled() or pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.status is distinct from old.status
    or new.submitted_to_user_id is distinct from old.submitted_to_user_id
    or new.submitted_to_name is distinct from old.submitted_to_name
    or new.submitted_to_permission is distinct from old.submitted_to_permission
    or new.submission_note is distinct from old.submission_note
    or new.ever_submitted is distinct from old.ever_submitted
    or new.last_action_by is distinct from old.last_action_by
    or new.last_action_at is distinct from old.last_action_at
    or new.received_transaction_ids is distinct from old.received_transaction_ids
    or new.actual_delivery_date is distinct from old.actual_delivery_date then
    raise exception 'Purchase Order workflow fields must be changed through transition_project_purchase_order_status.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_purchase_order_direct_status_update on public.purchase_orders;
create trigger guard_purchase_order_direct_status_update
  before update on public.purchase_orders
  for each row
  execute function app_private.guard_purchase_order_direct_status_update();

create or replace function public.transition_project_purchase_order_status(
  p_po_id text,
  p_status text,
  p_patch jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders%rowtype;
  v_user_id uuid := public.current_app_user_id();
  v_required_permission text;
  v_previous_guard text;
begin
  if v_user_id is null then
    raise exception 'Không xác định được người dùng chuyển trạng thái PO.'
      using errcode = '42501';
  end if;

  select *
  into v_po
  from public.purchase_orders
  where id = p_po_id
  for update;

  if not found then
    raise exception 'Không tìm thấy PO.';
  end if;

  v_required_permission := case
    when coalesce(p_status, '') in ('in_transit', 'partial', 'delivered', 'closed')
      or p_patch ? 'received_transaction_ids'
      or p_patch ? 'actual_delivery_date' then 'project.material_po.receive'
    when coalesce(p_status, '') in ('sent', 'confirmed', 'returned', 'cancelled') then 'project.material_po.approve'
    else 'project.material_po.create'
  end;

  if not (
    public.is_admin()
    or public.is_module_admin('DA')
    or (v_po.source_mode = 'company_consolidated' and app_private.company_procurement_can_manage())
    or (
      v_required_permission = 'project.material_po.receive'
      and (
        app_private.current_user_is_global_wms_keeper()
        or app_private.current_user_is_wms_keeper_for(v_po.target_warehouse_id)
      )
    )
    or app_private.material_has_action(v_po.project_id, v_po.construction_site_id, v_required_permission, v_user_id)
  ) then
    raise exception 'Bạn cần quyền % để chuyển trạng thái PO.', v_required_permission
      using errcode = '42501';
  end if;

  v_previous_guard := current_setting('app.material_transition_context', true);
  perform set_config('app.material_transition_context', 'on', true);

  update public.purchase_orders
  set
    status = coalesce(nullif(p_status, ''), status),
    submitted_to_user_id = case when p_patch ? 'submitted_to_user_id' then nullif(p_patch->>'submitted_to_user_id', '') else submitted_to_user_id end,
    submitted_to_name = case when p_patch ? 'submitted_to_name' then nullif(p_patch->>'submitted_to_name', '') else submitted_to_name end,
    submitted_to_permission = case when p_patch ? 'submitted_to_permission' then nullif(p_patch->>'submitted_to_permission', '') else submitted_to_permission end,
    submission_note = case when p_patch ? 'submission_note' then nullif(p_patch->>'submission_note', '') else submission_note end,
    ever_submitted = case when p_patch ? 'ever_submitted' then coalesce((p_patch->>'ever_submitted')::boolean, ever_submitted) else ever_submitted end,
    last_action_by = case when p_patch ? 'last_action_by' then nullif(p_patch->>'last_action_by', '') else last_action_by end,
    last_action_at = case when p_patch ? 'last_action_at' then nullif(p_patch->>'last_action_at', '')::timestamptz else last_action_at end,
    received_transaction_ids = case when p_patch ? 'received_transaction_ids' then coalesce(p_patch->'received_transaction_ids', '[]'::jsonb) else received_transaction_ids end,
    actual_delivery_date = case when p_patch ? 'actual_delivery_date' then nullif(p_patch->>'actual_delivery_date', '') else actual_delivery_date end
  where id = p_po_id;

  perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
end;
$$;

revoke all on function public.transition_project_purchase_order_status(text, text, jsonb) from public;
revoke all on function public.transition_project_purchase_order_status(text, text, jsonb) from anon;
grant execute on function public.transition_project_purchase_order_status(text, text, jsonb) to authenticated;

drop policy if exists purchase_orders_select on public.purchase_orders;
create policy purchase_orders_select
  on public.purchase_orders
  for select
  to authenticated
  using (
    archived_at is null
    and (
      app_private.material_has_any_action(project_id, construction_site_id, array['project.material_po.view','project.material_po.create','project.material_po.approve','project.material_po.receive'], public.current_app_user_id())
      or app_private.current_user_is_global_wms_keeper()
      or app_private.current_user_is_wms_keeper_for(target_warehouse_id)
      or (source_mode = 'company_consolidated' and app_private.company_procurement_can_manage())
      or (source_mode = 'company_consolidated' and app_private.company_purchase_order_can_view_from_links(id))
    )
  );

drop policy if exists purchase_orders_insert on public.purchase_orders;
create policy purchase_orders_insert
  on public.purchase_orders
  for insert
  to authenticated
  with check (
    public.is_admin()
    or public.is_module_admin('DA')
    or (source_mode = 'company_consolidated' and app_private.company_procurement_can_manage())
    or app_private.material_has_action(project_id, construction_site_id, 'project.material_po.create', public.current_app_user_id())
  );

drop policy if exists purchase_orders_update on public.purchase_orders;
create policy purchase_orders_update
  on public.purchase_orders
  for update
  to authenticated
  using (
    archived_at is null
    and (
      public.is_admin()
      or public.is_module_admin('DA')
      or (source_mode = 'company_consolidated' and app_private.company_procurement_can_manage())
      or app_private.material_has_any_action(project_id, construction_site_id, array['project.material_po.create','project.material_po.approve','project.material_po.receive'], public.current_app_user_id())
      or (
        status in ('in_transit', 'partial')
        and (
          app_private.current_user_is_global_wms_keeper()
          or app_private.current_user_is_wms_keeper_for(target_warehouse_id)
        )
      )
    )
  )
  with check (
    archived_at is null
    and (
      public.is_admin()
      or public.is_module_admin('DA')
      or (source_mode = 'company_consolidated' and app_private.company_procurement_can_manage())
      or app_private.material_has_any_action(project_id, construction_site_id, array['project.material_po.create','project.material_po.approve','project.material_po.receive'], public.current_app_user_id())
      or app_private.current_user_is_global_wms_keeper()
      or app_private.current_user_is_wms_keeper_for(target_warehouse_id)
    )
  );

notify pgrst, 'reload schema';
