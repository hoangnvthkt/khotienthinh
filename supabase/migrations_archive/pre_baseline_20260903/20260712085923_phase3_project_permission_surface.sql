-- Phase 3 Project submodule permission surface.
-- Extends Project PBAC v2 with missing submodule actions and shared backend helpers.

create schema if not exists app_private;

insert into public.permission_modules (application_code, code, name, routes, legacy_module_key, sort_order)
values
  ('project', 'project.master', 'Danh mục dự án', '{}'::text[], 'DA', 5),
  ('project', 'project.material_waste', 'Hao hụt vật tư', array['/da/tabs/material/waste']::text[], 'DA', 85),
  ('project', 'project.contract_item', 'Hạng mục hợp đồng', '{}'::text[], 'DA', 125),
  ('project', 'project.contract_variation', 'Phát sinh hợp đồng', '{}'::text[], 'DA', 126),
  ('project', 'project.dashboard', 'Dashboard dự án', '{}'::text[], 'DA', 220)
on conflict (code) do update
set application_code = excluded.application_code,
    name = excluded.name,
    routes = excluded.routes,
    legacy_module_key = excluded.legacy_module_key,
    sort_order = excluded.sort_order,
    is_active = true,
    updated_at = now();

update public.permission_modules
set routes = array_remove(routes, '/da/tabs/material/waste'),
    updated_at = now()
where code = 'project.material_request'
  and '/da/tabs/material/waste' = any(routes);

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
values
  ('project.master', 'view', 'project.master.view', 'Xem', array['global','project','construction_site']::text[], 'DA', null, false, 10),
  ('project.master', 'create', 'project.master.create', 'Tạo', array['global','project','construction_site']::text[], 'DA', null, true, 20),
  ('project.master', 'edit', 'project.master.edit', 'Sửa', array['global','project','construction_site']::text[], 'DA', null, true, 30),
  ('project.master', 'hide', 'project.master.hide', 'Ẩn', array['global','project','construction_site']::text[], 'DA', null, true, 40),
  ('project.master', 'restore', 'project.master.restore', 'Khôi phục', array['global','project','construction_site']::text[], 'DA', null, true, 50),
  ('project.master', 'manage_categories', 'project.master.manage_categories', 'Quản trị danh mục', array['global','project','construction_site']::text[], 'DA', null, true, 60),
  ('project.master', 'manage', 'project.master.manage', 'Quản trị', array['global','project','construction_site']::text[], 'DA', null, true, 70),

  ('project.daily_log', 'summarize', 'project.daily_log.summarize', 'Tổng hợp', array['global','project','construction_site']::text[], 'DA', '/da/tabs/dailylog', true, 130),

  ('project.material_waste', 'view', 'project.material_waste.view', 'Xem', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material/waste', false, 10),
  ('project.material_waste', 'record', 'project.material_waste.record', 'Ghi nhận', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material/waste', true, 20),
  ('project.material_waste', 'approve', 'project.material_waste.approve', 'Duyệt', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material/waste', true, 30),
  ('project.material_waste', 'manage', 'project.material_waste.manage', 'Quản trị', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material/waste', true, 40),

  ('project.contract_item', 'view', 'project.contract_item.view', 'Xem', array['global','project','construction_site']::text[], 'DA', '/da/tabs/contract', false, 10),
  ('project.contract_item', 'edit', 'project.contract_item.edit', 'Sửa', array['global','project','construction_site']::text[], 'DA', '/da/tabs/contract', true, 20),
  ('project.contract_item', 'manage', 'project.contract_item.manage', 'Quản trị', array['global','project','construction_site']::text[], 'DA', '/da/tabs/contract', true, 30),

  ('project.contract_variation', 'view', 'project.contract_variation.view', 'Xem', array['global','project','construction_site']::text[], 'DA', '/da/tabs/contract', false, 10),
  ('project.contract_variation', 'create', 'project.contract_variation.create', 'Tạo', array['global','project','construction_site']::text[], 'DA', '/da/tabs/contract', true, 20),
  ('project.contract_variation', 'submit', 'project.contract_variation.submit', 'Gửi', array['global','project','construction_site']::text[], 'DA', '/da/tabs/contract', true, 30),
  ('project.contract_variation', 'verify', 'project.contract_variation.verify', 'Kiểm tra', array['global','project','construction_site']::text[], 'DA', '/da/tabs/contract', true, 40),
  ('project.contract_variation', 'approve', 'project.contract_variation.approve', 'Duyệt', array['global','project','construction_site']::text[], 'DA', '/da/tabs/contract', true, 50),
  ('project.contract_variation', 'manage', 'project.contract_variation.manage', 'Quản trị', array['global','project','construction_site']::text[], 'DA', '/da/tabs/contract', true, 60),

  ('project.gantt', 'create_task', 'project.gantt.create_task', 'Tạo công việc', array['global','project','construction_site']::text[], 'DA', '/da/tabs/gantt', true, 20),
  ('project.gantt', 'edit_task', 'project.gantt.edit_task', 'Sửa công việc', array['global','project','construction_site']::text[], 'DA', '/da/tabs/gantt', true, 30),
  ('project.gantt', 'assign_task', 'project.gantt.assign_task', 'Giao việc', array['global','project','construction_site']::text[], 'DA', '/da/tabs/gantt', true, 40),
  ('project.gantt', 'submit_completion', 'project.gantt.submit_completion', 'Gửi hoàn thành', array['global','project','construction_site']::text[], 'DA', '/da/tabs/gantt', true, 50),
  ('project.gantt', 'verify_completion', 'project.gantt.verify_completion', 'Kiểm tra hoàn thành', array['global','project','construction_site']::text[], 'DA', '/da/tabs/gantt', true, 60),

  ('project.weekly_progress', 'lock', 'project.weekly_progress.lock', 'Khóa kỳ', array['global','project','construction_site']::text[], 'DA', '/da/tabs/weekly_progress', true, 70),

  ('project.quality', 'template_manage', 'project.quality.template_manage', 'Quản trị biểu mẫu', array['global','project','construction_site']::text[], 'DA', '/da/tabs/quality', true, 130),
  ('project.quality', 'checklist_create', 'project.quality.checklist_create', 'Tạo checklist', array['global','project','construction_site']::text[], 'DA', '/da/tabs/quality', true, 140),
  ('project.quality', 'checklist_edit_own', 'project.quality.checklist_edit_own', 'Sửa checklist của mình', array['global','project','construction_site']::text[], 'DA', '/da/tabs/quality', true, 150),
  ('project.quality', 'checklist_edit_all', 'project.quality.checklist_edit_all', 'Sửa mọi checklist', array['global','project','construction_site']::text[], 'DA', '/da/tabs/quality', true, 160),
  ('project.quality', 'delete', 'project.quality.delete', 'Xóa', array['global','project','construction_site']::text[], 'DA', '/da/tabs/quality', true, 170),

  ('project.safety', 'worker_manage', 'project.safety.worker_manage', 'Quản lý lao động', array['global','project','construction_site']::text[], 'DA', '/da/tabs/safety', true, 20),
  ('project.safety', 'issue_create', 'project.safety.issue_create', 'Tạo sự cố', array['global','project','construction_site']::text[], 'DA', '/da/tabs/safety', true, 30),
  ('project.safety', 'issue_edit_own', 'project.safety.issue_edit_own', 'Sửa sự cố của mình', array['global','project','construction_site']::text[], 'DA', '/da/tabs/safety', true, 40),
  ('project.safety', 'issue_edit_all', 'project.safety.issue_edit_all', 'Sửa mọi sự cố', array['global','project','construction_site']::text[], 'DA', '/da/tabs/safety', true, 50),
  ('project.safety', 'issue_close', 'project.safety.issue_close', 'Đóng sự cố', array['global','project','construction_site']::text[], 'DA', '/da/tabs/safety', true, 60),
  ('project.safety', 'training_manage', 'project.safety.training_manage', 'Quản lý huấn luyện', array['global','project','construction_site']::text[], 'DA', '/da/tabs/safety', true, 70),
  ('project.safety', 'document_verify', 'project.safety.document_verify', 'Xác minh hồ sơ', array['global','project','construction_site']::text[], 'DA', '/da/tabs/safety', true, 80),

  ('project.documents', 'edit_metadata', 'project.documents.edit_metadata', 'Sửa metadata', array['global','project','construction_site']::text[], 'DA', '/da/tabs/documents', true, 30),
  ('project.documents', 'delete_own', 'project.documents.delete_own', 'Xóa của mình', array['global','project','construction_site']::text[], 'DA', '/da/tabs/documents', true, 40),
  ('project.documents', 'delete_all', 'project.documents.delete_all', 'Xóa tất cả', array['global','project','construction_site']::text[], 'DA', '/da/tabs/documents', true, 50),
  ('project.documents', 'approve', 'project.documents.approve', 'Duyệt', array['global','project','construction_site']::text[], 'DA', '/da/tabs/documents', true, 60),

  ('project.dashboard', 'view_progress', 'project.dashboard.view_progress', 'Xem tiến độ', array['global','project','construction_site']::text[], 'DA', null, false, 10),
  ('project.dashboard', 'view_financials', 'project.dashboard.view_financials', 'Xem tài chính', array['global','project','construction_site']::text[], 'DA', null, false, 20),
  ('project.dashboard', 'view_risk', 'project.dashboard.view_risk', 'Xem rủi ro', array['global','project','construction_site']::text[], 'DA', null, false, 30),
  ('project.dashboard', 'manage', 'project.dashboard.manage', 'Quản trị', array['global','project','construction_site']::text[], 'DA', null, true, 40)
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

create or replace function app_private.project_has_any_permission_v2(
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
    from unnest(coalesce(p_permission_codes, '{}'::text[])) permission_code
    where app_private.project_has_permission_v2(
      p_project_id,
      p_construction_site_id,
      permission_code,
      p_user_id
    )
  );
$$;

revoke all on function app_private.project_has_any_permission_v2(text, text, text[], uuid) from public;
revoke all on function app_private.project_has_any_permission_v2(text, text, text[], uuid) from anon;
grant execute on function app_private.project_has_any_permission_v2(text, text, text[], uuid) to authenticated;

create or replace function app_private.project_scope_has_any_grant_v2(
  p_project_id text,
  p_construction_site_id text,
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
    from public.users u
    where u.id = p_user_id
      and coalesce(u.is_active, true)
      and u.role = 'ADMIN'
  )
  or exists (
    select 1
    from public.user_permission_grants g
    join public.users u on u.id = g.user_id
    where g.user_id = p_user_id
      and coalesce(u.is_active, true)
      and g.permission_code like 'project.%'
      and coalesce(g.is_active, false)
      and (g.expires_at is null or g.expires_at > now())
      and (
        g.scope_type = 'global'
        or (g.scope_type = 'project' and (g.scope_id = '*' or g.scope_id = p_project_id))
        or (
          p_construction_site_id is not null
          and g.scope_type = 'construction_site'
          and (g.scope_id = '*' or g.scope_id = p_construction_site_id)
        )
      )
  );
$$;

revoke all on function app_private.project_scope_has_any_grant_v2(text, text, uuid) from public;
revoke all on function app_private.project_scope_has_any_grant_v2(text, text, uuid) from anon;
grant execute on function app_private.project_scope_has_any_grant_v2(text, text, uuid) to authenticated;

create or replace function public.project_has_permission_v2(
  p_project_id text,
  p_construction_site_id text,
  p_permission_code text,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.project_has_permission_v2(
    p_project_id,
    p_construction_site_id,
    p_permission_code,
    p_user_id
  );
$$;

revoke all on function public.project_has_permission_v2(text, text, text, uuid) from public;
revoke all on function public.project_has_permission_v2(text, text, text, uuid) from anon;
grant execute on function public.project_has_permission_v2(text, text, text, uuid) to authenticated;

create or replace function public.project_scope_has_any_grant_v2(
  p_project_id text,
  p_construction_site_id text,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.project_scope_has_any_grant_v2(
    p_project_id,
    p_construction_site_id,
    p_user_id
  );
$$;

revoke all on function public.project_scope_has_any_grant_v2(text, text, uuid) from public;
revoke all on function public.project_scope_has_any_grant_v2(text, text, uuid) from anon;
grant execute on function public.project_scope_has_any_grant_v2(text, text, uuid) to authenticated;

create or replace function app_private.list_project_permission_recipients(
  p_project_id text,
  p_construction_site_id text,
  p_permission_codes text[]
)
returns table (
  staff_id uuid,
  project_id text,
  construction_site_id text,
  user_id text,
  user_name text,
  position_id uuid,
  position_name text,
  permission_codes text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (
    public.is_admin()
    or public.is_module_admin('DA')
    or app_private.project_scope_has_any_grant_v2(p_project_id, p_construction_site_id, public.current_app_user_id())
  ) then
    raise exception 'Not allowed to list Project permission recipients'
      using errcode = '42501';
  end if;

  return query
  with active_grants as (
    select
      g.user_id,
      array_agg(distinct g.permission_code order by g.permission_code) as permission_codes
    from public.user_permission_grants g
    where g.permission_code = any(coalesce(p_permission_codes, '{}'::text[]))
      and g.permission_code like 'project.%'
      and coalesce(g.is_active, false)
      and (g.expires_at is null or g.expires_at > now())
      and (
        g.scope_type = 'global'
        or (g.scope_type = 'project' and (g.scope_id = '*' or g.scope_id = p_project_id))
        or (
          p_construction_site_id is not null
          and g.scope_type = 'construction_site'
          and (g.scope_id = '*' or g.scope_id = p_construction_site_id)
        )
      )
    group by g.user_id
  )
  select
    ps.id,
    ps.project_id,
    ps.construction_site_id,
    ps.user_id,
    u.name,
    ps.position_id,
    hp.name,
    ag.permission_codes
  from active_grants ag
  join public.project_staff ps
    on ps.user_id = ag.user_id::text
   and ps.end_date is null
  left join public.users u
    on u.id = ag.user_id
  left join public.hrm_positions hp
    on hp.id = ps.position_id
  where (p_project_id is null or ps.project_id = p_project_id)
    and (
      p_construction_site_id is null
      or ps.construction_site_id is null
      or ps.construction_site_id = p_construction_site_id
    )
  order by hp.level nulls last, hp.name nulls last, u.name nulls last;
end;
$$;

revoke all on function app_private.list_project_permission_recipients(text, text, text[]) from public;
revoke all on function app_private.list_project_permission_recipients(text, text, text[]) from anon;
grant execute on function app_private.list_project_permission_recipients(text, text, text[]) to authenticated;

create or replace function public.list_project_permission_recipients(
  p_project_id text,
  p_construction_site_id text,
  p_permission_codes text[]
)
returns table (
  staff_id uuid,
  project_id text,
  construction_site_id text,
  user_id text,
  user_name text,
  position_id uuid,
  position_name text,
  permission_codes text[]
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from app_private.list_project_permission_recipients(
    p_project_id,
    p_construction_site_id,
    p_permission_codes
  );
$$;

revoke all on function public.list_project_permission_recipients(text, text, text[]) from public;
revoke all on function public.list_project_permission_recipients(text, text, text[]) from anon;
grant execute on function public.list_project_permission_recipients(text, text, text[]) to authenticated;

create or replace function app_private.can_manage_project_master(
  p_project_id text,
  p_permission_code text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or public.is_module_admin('DA')
    or public.is_module_admin('SETTINGS')
    or (
      p_project_id is not null
      and app_private.project_has_permission_v2(p_project_id, null, p_permission_code, public.current_app_user_id())
    )
    or app_private.has_explicit_permission(public.current_app_user_id(), p_permission_code, 'global', '*');
$$;

revoke all on function app_private.can_manage_project_master(text, text) from public;
revoke all on function app_private.can_manage_project_master(text, text) from anon;
grant execute on function app_private.can_manage_project_master(text, text) to authenticated;

create or replace function app_private.create_project(
  p_project jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.projects%rowtype;
  v_actor_user_id uuid := public.current_app_user_id();
  v_creator_user_id uuid := v_actor_user_id;
  v_created_by text := nullif(p_project->>'created_by', '');
begin
  if not app_private.can_manage_project_master(null, 'project.master.create') then
    raise exception 'Not allowed to create project'
      using errcode = '42501';
  end if;

  if nullif(p_project->>'name', '') is null then
    raise exception 'Project name is required'
      using errcode = '23502';
  end if;

  if v_created_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_creator_user_id := v_created_by::uuid;
  end if;

  insert into public.projects (
    code,
    name,
    description,
    client_name,
    project_type,
    project_group_id,
    project_type_id,
    project_sector_id,
    workflow_template_id,
    status,
    construction_site_id,
    manager_id,
    start_date,
    end_date,
    progress_calculation_mode,
    manual_progress_percent,
    created_by,
    source
  )
  values (
    coalesce(nullif(p_project->>'code', ''), 'PRJ-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
    nullif(p_project->>'name', ''),
    nullif(p_project->>'description', ''),
    nullif(p_project->>'client_name', ''),
    coalesce(nullif(p_project->>'project_type', ''), 'construction'),
    nullif(p_project->>'project_group_id', '')::uuid,
    nullif(p_project->>'project_type_id', '')::uuid,
    nullif(p_project->>'project_sector_id', '')::uuid,
    nullif(p_project->>'workflow_template_id', '')::uuid,
    coalesce(nullif(p_project->>'status', ''), 'planning'),
    nullif(p_project->>'construction_site_id', '')::uuid,
    nullif(p_project->>'manager_id', ''),
    nullif(p_project->>'start_date', '')::date,
    nullif(p_project->>'end_date', '')::date,
    coalesce(nullif(p_project->>'progress_calculation_mode', ''), 'gantt_weighted'),
    coalesce(nullif(p_project->>'manual_progress_percent', '')::numeric, 0),
    v_created_by,
    coalesce(nullif(p_project->>'source', ''), 'manual')
  )
  returning *
  into v_project;

  if v_creator_user_id is not null then
    insert into public.user_permission_grants (
      user_id,
      permission_code,
      scope_type,
      scope_id,
      is_active,
      granted_by,
      granted_at
    )
    select
      v_creator_user_id,
      permission_code,
      'project',
      v_project.id,
      true,
      v_actor_user_id,
      now()
    from unnest(array[
      'project.master.view',
      'project.master.edit',
      'project.org.view',
      'project.org.assign_staff',
      'project.org.grant_permissions'
    ]::text[]) permission_code
    on conflict (user_id, permission_code, scope_type, scope_id) do update
    set is_active = true,
        granted_by = excluded.granted_by,
        granted_at = excluded.granted_at,
        updated_at = now();
  end if;

  return to_jsonb(v_project);
end;
$$;

revoke all on function app_private.create_project(jsonb) from public;
revoke all on function app_private.create_project(jsonb) from anon;
grant execute on function app_private.create_project(jsonb) to authenticated;

create or replace function public.create_project(
  p_project jsonb
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.create_project(p_project);
$$;

revoke all on function public.create_project(jsonb) from public;
revoke all on function public.create_project(jsonb) from anon;
grant execute on function public.create_project(jsonb) to authenticated;

create or replace function app_private.update_project(
  p_project_id text,
  p_project jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.projects%rowtype;
begin
  if not app_private.can_manage_project_master(p_project_id, 'project.master.edit') then
    raise exception 'Not allowed to update project'
      using errcode = '42501';
  end if;

  update public.projects
  set code = coalesce(nullif(p_project->>'code', ''), code),
      name = coalesce(nullif(p_project->>'name', ''), name),
      description = case when p_project ? 'description' then nullif(p_project->>'description', '') else description end,
      client_name = case when p_project ? 'client_name' then nullif(p_project->>'client_name', '') else client_name end,
      project_type = coalesce(nullif(p_project->>'project_type', ''), project_type),
      project_group_id = case when p_project ? 'project_group_id' then nullif(p_project->>'project_group_id', '')::uuid else project_group_id end,
      project_type_id = case when p_project ? 'project_type_id' then nullif(p_project->>'project_type_id', '')::uuid else project_type_id end,
      project_sector_id = case when p_project ? 'project_sector_id' then nullif(p_project->>'project_sector_id', '')::uuid else project_sector_id end,
      workflow_template_id = case when p_project ? 'workflow_template_id' then nullif(p_project->>'workflow_template_id', '')::uuid else workflow_template_id end,
      status = coalesce(nullif(p_project->>'status', ''), status),
      construction_site_id = case when p_project ? 'construction_site_id' then nullif(p_project->>'construction_site_id', '')::uuid else construction_site_id end,
      manager_id = case when p_project ? 'manager_id' then nullif(p_project->>'manager_id', '') else manager_id end,
      start_date = case when p_project ? 'start_date' then nullif(p_project->>'start_date', '')::date else start_date end,
      end_date = case when p_project ? 'end_date' then nullif(p_project->>'end_date', '')::date else end_date end,
      progress_calculation_mode = coalesce(nullif(p_project->>'progress_calculation_mode', ''), progress_calculation_mode),
      manual_progress_percent = case when p_project ? 'manual_progress_percent' then coalesce(nullif(p_project->>'manual_progress_percent', '')::numeric, 0) else manual_progress_percent end,
      is_pinned = case when p_project ? 'is_pinned' then coalesce((p_project->>'is_pinned')::boolean, false) else is_pinned end,
      pinned_at = case when p_project ? 'pinned_at' then nullif(p_project->>'pinned_at', '')::timestamptz else pinned_at end,
      pinned_by = case when p_project ? 'pinned_by' then nullif(p_project->>'pinned_by', '') else pinned_by end,
      is_hidden = case when p_project ? 'is_hidden' then coalesce((p_project->>'is_hidden')::boolean, false) else is_hidden end,
      hidden_at = case when p_project ? 'hidden_at' then nullif(p_project->>'hidden_at', '')::timestamptz else hidden_at end,
      hidden_by = case when p_project ? 'hidden_by' then nullif(p_project->>'hidden_by', '') else hidden_by end,
      hidden_reason = case when p_project ? 'hidden_reason' then nullif(p_project->>'hidden_reason', '') else hidden_reason end
  where id = p_project_id
  returning *
  into v_project;

  if v_project.id is null then
    raise exception 'Project not found: %', p_project_id
      using errcode = 'P0002';
  end if;

  return to_jsonb(v_project);
end;
$$;

revoke all on function app_private.update_project(text, jsonb) from public;
revoke all on function app_private.update_project(text, jsonb) from anon;
grant execute on function app_private.update_project(text, jsonb) to authenticated;

create or replace function public.update_project(
  p_project_id text,
  p_project jsonb
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.update_project(p_project_id, p_project);
$$;

revoke all on function public.update_project(text, jsonb) from public;
revoke all on function public.update_project(text, jsonb) from anon;
grant execute on function public.update_project(text, jsonb) to authenticated;

create or replace function app_private.hide_project(
  p_project_id text,
  p_reason text,
  p_hidden_by text default null,
  p_force boolean default false,
  p_construction_site_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.projects%rowtype;
begin
  if not app_private.can_manage_project_master(p_project_id, 'project.master.hide') then
    raise exception 'Not allowed to hide project'
      using errcode = '42501';
  end if;

  if nullif(p_reason, '') is null then
    raise exception 'Hide reason is required'
      using errcode = '23502';
  end if;

  update public.projects
  set is_hidden = true,
      hidden_at = now(),
      hidden_by = nullif(p_hidden_by, ''),
      hidden_reason = btrim(p_reason)
  where id = p_project_id
  returning *
  into v_project;

  if v_project.id is null then
    raise exception 'Project not found: %', p_project_id
      using errcode = 'P0002';
  end if;

  return to_jsonb(v_project);
end;
$$;

revoke all on function app_private.hide_project(text, text, text, boolean, text) from public;
revoke all on function app_private.hide_project(text, text, text, boolean, text) from anon;
grant execute on function app_private.hide_project(text, text, text, boolean, text) to authenticated;

create or replace function public.hide_project(
  p_project_id text,
  p_reason text,
  p_hidden_by text default null,
  p_force boolean default false,
  p_construction_site_id text default null
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.hide_project(p_project_id, p_reason, p_hidden_by, p_force, p_construction_site_id);
$$;

revoke all on function public.hide_project(text, text, text, boolean, text) from public;
revoke all on function public.hide_project(text, text, text, boolean, text) from anon;
grant execute on function public.hide_project(text, text, text, boolean, text) to authenticated;

create or replace function app_private.restore_project(
  p_project_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.projects%rowtype;
begin
  if not app_private.can_manage_project_master(p_project_id, 'project.master.restore') then
    raise exception 'Not allowed to restore project'
      using errcode = '42501';
  end if;

  update public.projects
  set is_hidden = false,
      hidden_at = null,
      hidden_by = null,
      hidden_reason = null
  where id = p_project_id
  returning *
  into v_project;

  if v_project.id is null then
    raise exception 'Project not found: %', p_project_id
      using errcode = 'P0002';
  end if;

  return to_jsonb(v_project);
end;
$$;

revoke all on function app_private.restore_project(text) from public;
revoke all on function app_private.restore_project(text) from anon;
grant execute on function app_private.restore_project(text) to authenticated;

create or replace function public.restore_project(
  p_project_id text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.restore_project(p_project_id);
$$;

revoke all on function public.restore_project(text) from public;
revoke all on function public.restore_project(text) from anon;
grant execute on function public.restore_project(text) to authenticated;

create or replace function app_private.project_category_table_name(
  p_category_kind text
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case p_category_kind
    when 'group' then 'project_groups'
    when 'type' then 'project_types'
    when 'sector' then 'project_sectors'
  end;
$$;

revoke all on function app_private.project_category_table_name(text) from public;
revoke all on function app_private.project_category_table_name(text) from anon;
grant execute on function app_private.project_category_table_name(text) to authenticated;

create or replace function app_private.upsert_project_category(
  p_category_kind text,
  p_category jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table text := app_private.project_category_table_name(p_category_kind);
  v_result jsonb;
  v_id text := nullif(p_category->>'id', '');
begin
  if v_table is null then
    raise exception 'Invalid project category kind: %', p_category_kind
      using errcode = '22023';
  end if;

  if not app_private.can_manage_project_master(null, 'project.master.manage_categories') then
    raise exception 'Not allowed to manage project categories'
      using errcode = '42501';
  end if;

  if v_id is null then
    if nullif(p_category->>'name', '') is null then
      raise exception 'Project category name is required'
        using errcode = '23502';
    end if;

    execute format(
      'insert into public.%I (code, name, description, sort_order, is_active)
       values ($1, $2, $3, $4, $5)
       returning to_jsonb(%I.*)',
      v_table,
      v_table
    )
    into v_result
    using
      nullif(p_category->>'code', ''),
      nullif(p_category->>'name', ''),
      nullif(p_category->>'description', ''),
      coalesce(nullif(p_category->>'sort_order', '')::int, 0),
      coalesce((p_category->>'is_active')::boolean, true);

    return v_result;
  end if;

  execute format(
    'update public.%I
     set code = case when $2 then $3 else code end,
         name = case when $4 then coalesce($5, name) else name end,
         description = case when $6 then $7 else description end,
         sort_order = case when $8 then coalesce($9, sort_order) else sort_order end,
         is_active = case when $10 then coalesce($11, is_active) else is_active end,
         updated_at = now()
     where id = $1::uuid
     returning to_jsonb(%I.*)',
    v_table,
    v_table
  )
  into v_result
  using
    v_id,
    p_category ? 'code',
    nullif(p_category->>'code', ''),
    p_category ? 'name',
    nullif(p_category->>'name', ''),
    p_category ? 'description',
    nullif(p_category->>'description', ''),
    p_category ? 'sort_order',
    nullif(p_category->>'sort_order', '')::int,
    p_category ? 'is_active',
    (p_category->>'is_active')::boolean;

  if v_result is null then
    raise exception 'Project category not found: % %', p_category_kind, v_id
      using errcode = 'P0002';
  end if;

  return v_result;
end;
$$;

revoke all on function app_private.upsert_project_category(text, jsonb) from public;
revoke all on function app_private.upsert_project_category(text, jsonb) from anon;
grant execute on function app_private.upsert_project_category(text, jsonb) to authenticated;

create or replace function public.upsert_project_category(
  p_category_kind text,
  p_category jsonb
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.upsert_project_category(p_category_kind, p_category);
$$;

revoke all on function public.upsert_project_category(text, jsonb) from public;
revoke all on function public.upsert_project_category(text, jsonb) from anon;
grant execute on function public.upsert_project_category(text, jsonb) to authenticated;

create or replace function app_private.delete_project_category(
  p_category_kind text,
  p_category_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table text := app_private.project_category_table_name(p_category_kind);
  v_result jsonb;
begin
  if v_table is null then
    raise exception 'Invalid project category kind: %', p_category_kind
      using errcode = '22023';
  end if;

  if not app_private.can_manage_project_master(null, 'project.master.manage_categories') then
    raise exception 'Not allowed to delete project categories'
      using errcode = '42501';
  end if;

  execute format(
    'delete from public.%I where id = $1 returning to_jsonb(%I.*)',
    v_table,
    v_table
  )
  into v_result
  using p_category_id;

  if v_result is null then
    raise exception 'Project category not found: % %', p_category_kind, p_category_id
      using errcode = 'P0002';
  end if;

  return v_result;
end;
$$;

revoke all on function app_private.delete_project_category(text, uuid) from public;
revoke all on function app_private.delete_project_category(text, uuid) from anon;
grant execute on function app_private.delete_project_category(text, uuid) to authenticated;

create or replace function public.delete_project_category(
  p_category_kind text,
  p_category_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.delete_project_category(p_category_kind, p_category_id);
$$;

revoke all on function public.delete_project_category(text, uuid) from public;
revoke all on function public.delete_project_category(text, uuid) from anon;
grant execute on function public.delete_project_category(text, uuid) to authenticated;

create or replace function app_private.can_manage_work_groups()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.can_manage_project_master(null, 'project.master.manage_categories')
    or app_private.has_explicit_permission(public.current_app_user_id(), 'project.org.assign_staff', 'global', '*');
$$;

revoke all on function app_private.can_manage_work_groups() from public;
revoke all on function app_private.can_manage_work_groups() from anon;
grant execute on function app_private.can_manage_work_groups() to authenticated;

create or replace function app_private.upsert_work_group(
  p_work_group jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_id text := nullif(p_work_group->>'id', '');
begin
  if not app_private.can_manage_work_groups() then
    raise exception 'Not allowed to manage work groups'
      using errcode = '42501';
  end if;

  if v_id is null then
    if nullif(p_work_group->>'name', '') is null then
      raise exception 'Work group name is required'
        using errcode = '23502';
    end if;

    insert into public.work_groups (code, name, description, sort_order, is_active)
    values (
      nullif(p_work_group->>'code', ''),
      nullif(p_work_group->>'name', ''),
      nullif(p_work_group->>'description', ''),
      coalesce(nullif(p_work_group->>'sort_order', '')::int, 0),
      coalesce((p_work_group->>'is_active')::boolean, true)
    )
    returning to_jsonb(public.work_groups.*)
    into v_result;

    return v_result;
  end if;

  update public.work_groups
  set code = case when p_work_group ? 'code' then nullif(p_work_group->>'code', '') else code end,
      name = case when p_work_group ? 'name' then coalesce(nullif(p_work_group->>'name', ''), name) else name end,
      description = case when p_work_group ? 'description' then nullif(p_work_group->>'description', '') else description end,
      sort_order = case when p_work_group ? 'sort_order' then coalesce(nullif(p_work_group->>'sort_order', '')::int, sort_order) else sort_order end,
      is_active = case when p_work_group ? 'is_active' then coalesce((p_work_group->>'is_active')::boolean, is_active) else is_active end,
      updated_at = now()
  where id = v_id::uuid
  returning to_jsonb(public.work_groups.*)
  into v_result;

  if v_result is null then
    raise exception 'Work group not found: %', v_id
      using errcode = 'P0002';
  end if;

  return v_result;
end;
$$;

revoke all on function app_private.upsert_work_group(jsonb) from public;
revoke all on function app_private.upsert_work_group(jsonb) from anon;
grant execute on function app_private.upsert_work_group(jsonb) to authenticated;

create or replace function public.upsert_work_group(
  p_work_group jsonb
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.upsert_work_group(p_work_group);
$$;

revoke all on function public.upsert_work_group(jsonb) from public;
revoke all on function public.upsert_work_group(jsonb) from anon;
grant execute on function public.upsert_work_group(jsonb) to authenticated;

create or replace function app_private.delete_work_group(
  p_work_group_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not app_private.can_manage_work_groups() then
    raise exception 'Not allowed to delete work groups'
      using errcode = '42501';
  end if;

  delete from public.work_groups
  where id = p_work_group_id
  returning to_jsonb(public.work_groups.*)
  into v_result;

  if v_result is null then
    raise exception 'Work group not found: %', p_work_group_id
      using errcode = 'P0002';
  end if;

  return v_result;
end;
$$;

revoke all on function app_private.delete_work_group(uuid) from public;
revoke all on function app_private.delete_work_group(uuid) from anon;
grant execute on function app_private.delete_work_group(uuid) to authenticated;

create or replace function public.delete_work_group(
  p_work_group_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.delete_work_group(p_work_group_id);
$$;

revoke all on function public.delete_work_group(uuid) from public;
revoke all on function public.delete_work_group(uuid) from anon;
grant execute on function public.delete_work_group(uuid) to authenticated;

do $$
declare
  tbl text;
  policy_name text;
begin
  foreach tbl in array array['projects', 'project_groups', 'project_types', 'project_sectors', 'work_groups', 'work_group_members']
  loop
    if to_regclass(format('public.%I', tbl)) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', tbl);
    execute format('revoke all privileges on table public.%I from public', tbl);
    execute format('revoke all privileges on table public.%I from anon', tbl);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', tbl);

    for policy_name in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = tbl
    loop
      execute format('drop policy if exists %I on public.%I', policy_name, tbl);
    end loop;

    if tbl = 'projects' then
      execute format(
        'create policy %I on public.%I for select to authenticated using (
          app_private.can_access_module(''DA'')
          or app_private.project_scope_has_any_grant_v2(id::text, construction_site_id::text, public.current_app_user_id())
        )',
        tbl || '_phase3_select',
        tbl
      );
      execute format(
        'create policy %I on public.%I for insert to authenticated with check (
          app_private.can_manage_project_master(null, ''project.master.create'')
        )',
        tbl || '_phase3_insert',
        tbl
      );
      execute format(
        'create policy %I on public.%I for update to authenticated using (
          app_private.can_manage_project_master(id::text, ''project.master.edit'')
          or app_private.can_manage_project_master(id::text, ''project.master.hide'')
          or app_private.can_manage_project_master(id::text, ''project.master.restore'')
        ) with check (
          app_private.can_manage_project_master(id::text, ''project.master.edit'')
          or app_private.can_manage_project_master(id::text, ''project.master.hide'')
          or app_private.can_manage_project_master(id::text, ''project.master.restore'')
        )',
        tbl || '_phase3_update',
        tbl
      );
      execute format(
        'create policy %I on public.%I for delete to authenticated using (
          app_private.can_manage_project_master(id::text, ''project.master.hide'')
        )',
        tbl || '_phase3_delete',
        tbl
      );
    elsif tbl in ('work_groups', 'work_group_members') then
      execute format(
        'create policy %I on public.%I for select to authenticated using (
          app_private.can_access_module(''DA'') or app_private.can_access_module(''SETTINGS'')
        )',
        tbl || '_phase3_select',
        tbl
      );
      execute format(
        'create policy %I on public.%I for insert to authenticated with check (
          app_private.can_manage_work_groups()
        )',
        tbl || '_phase3_insert',
        tbl
      );
      execute format(
        'create policy %I on public.%I for update to authenticated using (
          app_private.can_manage_work_groups()
        ) with check (
          app_private.can_manage_work_groups()
        )',
        tbl || '_phase3_update',
        tbl
      );
      execute format(
        'create policy %I on public.%I for delete to authenticated using (
          app_private.can_manage_work_groups()
        )',
        tbl || '_phase3_delete',
        tbl
      );
    else
      execute format(
        'create policy %I on public.%I for select to authenticated using (
          app_private.can_access_module(''DA'') or app_private.can_access_module(''SETTINGS'')
        )',
        tbl || '_phase3_select',
        tbl
      );
      execute format(
        'create policy %I on public.%I for insert to authenticated with check (
          app_private.can_manage_project_master(null, ''project.master.manage_categories'')
        )',
        tbl || '_phase3_insert',
        tbl
      );
      execute format(
        'create policy %I on public.%I for update to authenticated using (
          app_private.can_manage_project_master(null, ''project.master.manage_categories'')
        ) with check (
          app_private.can_manage_project_master(null, ''project.master.manage_categories'')
        )',
        tbl || '_phase3_update',
        tbl
      );
      execute format(
        'create policy %I on public.%I for delete to authenticated using (
          app_private.can_manage_project_master(null, ''project.master.manage_categories'')
        )',
        tbl || '_phase3_delete',
        tbl
      );
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
