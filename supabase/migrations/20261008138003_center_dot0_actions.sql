-- Trung tâm điều hành đợt 0, PR-D: thao tác nhanh — máy chủ trả "được bấm gì" cho từng nhóm widget
-- (kế hoạch 07 mục 5). Chỉ đọc. Mỗi cờ là chính luật của module: Room của dự án, mẫu quyền HRM,
-- procurement_can, hot_purchase_can_create, finance_can, wms_has_action, nguồn quyền Office / Yêu cầu / Quy trình / Work.
-- Center chỉ hiện đúng cờ này (nút 🔒 khi false); thao tác thật vẫn chạy ở form / RPC sẵn có của module.

create function public.vcc_my_actions_v1(p_project_id text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := app_private.center_actor_v1();
  v_employee uuid := app_private.hrm_current_employee_id();
  v_admin boolean := public.is_admin();
  v_work boolean := app_private.has_permission(v_actor, 'work.module.access', 'global', '*');
  v_office boolean := app_private.has_permission(v_actor, 'office.module.access', 'global', '*');
  v_project public.projects%rowtype;
  v_site_text text;
  v_warehouse text;
  v_project_flags jsonb := null;
  v_supply_flags jsonb := null;
  v_finance_flags jsonb := null;
begin
  if nullif(btrim(p_project_id), '') is not null then
    select * into v_project from public.projects p where p.id = p_project_id and coalesce(p.status, '') in ('planning', 'active', 'paused');
  end if;

  if v_project.id is not null then
    v_site_text := v_project.construction_site_id::text;
    select w.id into v_warehouse from public.warehouses w where not coalesce(w.is_archived, false)
      and (w.project_id = v_project.id or (v_project.construction_site_id is not null and w.construction_site_id = v_project.construction_site_id))
    order by w.is_default_for_site desc, w.created_at limit 1;

    v_project_flags := jsonb_build_object(
      'materialRequest', v_admin or app_private.current_actor_has_effective_room_action(v_project.id, v_site_text, 'material_request', 'edit')
        or app_private.current_actor_has_effective_room_action(v_project.id, v_site_text, 'material_request', 'submit'),
      'dailyLog', v_admin or app_private.current_actor_has_effective_room_action(v_project.id, v_site_text, 'daily_log', 'edit')
        or app_private.current_actor_has_effective_room_action(v_project.id, v_site_text, 'daily_log', 'submit'),
      'dailyReport', v_admin or app_private.current_actor_has_effective_room_action(v_project.id, v_site_text, 'daily_log', 'view'),
      'workPlan', v_admin or app_private.current_actor_has_effective_room_action(v_project.id, v_site_text, 'work_plan', 'edit')
        or app_private.current_actor_has_effective_room_action(v_project.id, v_site_text, 'work_plan', 'submit'));

    v_supply_flags := jsonb_build_object(
      'hot', app_private.hot_purchase_can_create(v_project.id, v_site_text),
      'inbox', v_admin or app_private.procurement_can('view'),
      'receive', v_warehouse is not null and app_private.wms_has_action('wms.transaction.complete', v_warehouse, v_warehouse, null, null, v_actor),
      'count', v_warehouse is not null and app_private.wms_has_action('wms.inventory.edit', v_warehouse, null, null, null, v_actor),
      'warehouseId', v_warehouse);

    v_finance_flags := jsonb_build_object(
      'siteFund', exists (select 1 from public.cash_funds f where f.kind = 'site' and f.is_active and f.project_id = v_project.id
        and (f.holder_user_id = v_actor or app_private.finance_can('record'))),
      'projectFinance', app_private.finance_project_visible(v_project.id),
      'paymentRequest', app_private.finance_can('record'));
  end if;

  return jsonb_build_object(
    'projectId', v_project.id,
    'employee', v_employee is not null,
    'project', v_project_flags,
    'hrm', jsonb_build_object(
      'checkin', v_employee is not null,
      'leave', v_employee is not null,
      'makeup', v_employee is not null,
      'timesheet', v_employee is not null,
      'assignment', app_private.hrm_site_assignment_can_create_any(v_actor)),
    'work', jsonb_build_object(
      'request', v_admin or exists (select 1 from app_private.resolve_effective_permission_sources(v_actor, 'request.instance.create', null, null, now())),
      'workflow', v_admin or exists (select 1 from app_private.resolve_effective_permission_sources(v_actor, 'workflow.instance.create', null, null, now())),
      'po', v_admin or app_private.has_permission(v_actor, 'system.procurement.manage', 'global', '*'),
      'task', v_work and exists (select 1 from app_private.resolve_effective_permission_sources(v_actor, 'work.task.create', null, null, now()))),
    'office', jsonb_build_object(
      'compose', v_office and exists (select 1 from app_private.resolve_effective_permission_sources(v_actor, 'office.document.create', null, null, now())),
      'incoming', v_office,
      'booking', true,
      'directory', app_private.has_permission(v_actor, 'hrm.employee.view_directory', 'global', '*')
        or app_private.has_permission(v_actor, 'hrm.employee.view_profile', 'own', '*')),
    'supply', v_supply_flags,
    'finance', v_finance_flags);
end $$;
revoke all on function public.vcc_my_actions_v1(text) from public, anon;
grant execute on function public.vcc_my_actions_v1(text) to authenticated, service_role;
