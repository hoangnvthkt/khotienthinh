-- Dòng chảy công việc — PR-1 (13/10/2026). Thiết kế: docs/command-center/08-dong-chay-cong-viec-2026-10-13.md (chủ SP duyệt 9 câu 13/10).
-- Một hàm đọc public.vcc_flow_v1 trả đủ số cho tab "Dòng chảy công việc" của Trung tâm điều hành:
--   links/outcomes/unitOutcomes/people/creators/daily  ← lượt giao bước xử lý trong khoảng (7/30/90 ngày): workflow_step_assignments + work_task_assignments
--   waiting                                           ← việc đang chờ HÔM NAY, mọi thời điểm phát sinh, gom 19 nguồn (như vcc_my_work_items_v1) nhưng cho cả công ty
--   projects, notifications, gaps, thresholds, scope
-- Quyền (quyết định ở máy chủ, người gọi phải vào được Center — app_private.center_actor_v1):
--   toàn công ty: Admin hoặc quyền center.flow.view (mẫu Ban giám đốc có sẵn quyền này cho lần áp sau)
--   phòng mình (+ phòng con): người đang giữ slot trưởng phòng (org_units.manager_slot_id → hrm_employee_slot_assignments ACTIVE)
--   dự án mình: giám đốc dự án (projects.manager_id) hoặc Room có quyền duyệt nhật ký / phân công / duyệt đề xuất vật tư (như Bảng điều khiển)
--   không thuộc bậc nào → {access:false}; lọc phòng / dự án ngoài phạm vi → 42501 FLOW_SCOPE_DENIED.
-- Hiệu năng: 2 tập dữ liệu dựng một lần (CTE materialized) rồi mọi số đếm đọc trong bộ nhớ; chỉ mục theo assigned_at và PENDING;
--   không trả danh sách phiếu (PR-3 có hàm riêng theo trang). Hôm nay 489 lượt giao / 42 việc chờ → vài chục ms.
-- Ngưỡng (chủ SP duyệt 13/10, đổi được ở Thiết lập sau): đứng yên > 3 ngày làm việc (tuần 6 ngày), ùn ở người ≥ 5, phiếu chết > 30 ngày,
--   thông tin chưa đọc > 7 ngày, SLA mặc định 48 giờ cho lượt giao chưa có hạn.
-- Rollback: supabase/tests/center_flow_v1_rollback.sql · Smoke: supabase/tests/center_flow_v1_smoke.sql

-- ── 1. Quyền ────────────────────────────────────────────────────────────────────────────────
insert into public.permission_modules(application_code,code,name,routes,sort_order,is_active)
values ('center','center.flow','Dòng chảy công việc',array['/center'],30,true)
on conflict(code) do update set name=excluded.name,routes=excluded.routes,is_active=true;

insert into public.permission_actions(module_code,action,permission_code,label,scope_modes,sort_order,is_active,risk_level,is_business_action,is_business_approval,grant_readiness,access_application_code)
values ('center.flow','view','center.flow.view','Xem dòng chảy công việc toàn công ty',array['global'],1,true,'normal',false,false,'enforced','center')
on conflict(permission_code) do update set label=excluded.label,scope_modes=excluded.scope_modes,grant_readiness='enforced',is_active=true;

-- Mẫu "Ban giám đốc" có thêm quyền này cho lần áp mẫu sau; người đã áp mẫu không tự đổi (quy ước 06/10) — cấp cho Ban lãnh đạo
-- hiện tại bằng supabase/tests/center_flow_v1_grant_executive.sql hoặc màn Phân quyền.
update public.user_permission_templates
set items = items || '[{"scopeType":"global","permissionCode":"center.flow.view"}]'::jsonb, updated_at = now()
where code = 'executive'
  and not exists (select 1 from jsonb_array_elements(items) i where i ->> 'permissionCode' = 'center.flow.view');

-- ── 2. Chỉ mục cho quét theo thời gian / đang chờ (các chỉ mục cũ đều theo người nhận) ─────
create index if not exists idx_wsa_flow_assigned_at on public.workflow_step_assignments (assigned_at desc) where assignee_user_id is not null;
create index if not exists idx_wsa_flow_pending on public.workflow_step_assignments (assigned_at) where status = 'PENDING';
create index if not exists idx_employees_user_id on public.employees (user_id) where user_id is not null;

-- ── 3. Hàm phụ ──────────────────────────────────────────────────────────────────────────────
-- Số ngày làm việc đã trôi qua từ p_from tới p_to (không tính ngày p_to), tuần p_week_days ngày (6 = nghỉ Chủ nhật), giờ Việt Nam.
create function app_private.vcc_flow_business_days(p_from timestamptz, p_to timestamptz, p_week_days integer default 6)
returns integer language sql immutable set search_path = '' as $$
  select coalesce((select count(*)::int
    from generate_series((p_from at time zone 'Asia/Ho_Chi_Minh')::date, (p_to at time zone 'Asia/Ho_Chi_Minh')::date - 1, interval '1 day') d
    where extract(isodow from d) <= coalesce(p_week_days, 6)), 0);
$$;
revoke all on function app_private.vcc_flow_business_days(timestamptz, timestamptz, integer) from public, anon, authenticated;

-- Một phòng và mọi phòng con đang hoạt động.
create function app_private.vcc_flow_unit_tree(p_root uuid)
returns uuid[] language sql stable set search_path = '' as $$
  with recursive t as (
    select o.id from public.org_units o where o.id = p_root
    union select c.id from public.org_units c join t on c.parent_id = t.id where c.is_active
  ) select coalesce(array_agg(id), '{}') from t;
$$;
revoke all on function app_private.vcc_flow_unit_tree(uuid) from public, anon, authenticated;

-- Các phòng người này là trưởng phòng (slot quản lý đang hiệu lực), gồm phòng con.
create function app_private.vcc_flow_managed_units(p_user uuid)
returns uuid[] language sql stable set search_path = '' as $$
  with recursive mine as (
    select o.id from public.org_units o
    join public.hrm_employee_slot_assignments a on a.slot_id = o.manager_slot_id and a.status = 'ACTIVE'
      and a.effective_from <= current_date and (a.effective_to is null or a.effective_to >= current_date)
    join public.employees e on e.id = a.employee_id
    where o.is_active and e.user_id = p_user
    union select c.id from public.org_units c join mine on c.parent_id = mine.id where c.is_active
  ) select coalesce(array_agg(id), '{}') from mine;
$$;
revoke all on function app_private.vcc_flow_managed_units(uuid) from public, anon, authenticated;

-- ── 4. RPC ──────────────────────────────────────────────────────────────────────────────────
create function public.vcc_flow_v1(p_range_days integer default 90, p_project_id text default null, p_unit_id uuid default null, p_access_only boolean default false)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_admin boolean; v_company boolean;
  v_units_all uuid[] := '{}'; v_projects_all text[] := '{}';
  v_units uuid[] := '{}'; v_projects text[] := '{}';
  v_kind text;
  v_range integer := case when p_range_days in (7, 30, 90) then p_range_days else 90 end;
  v_from timestamptz; v_daily_from date;
  v_stuck_days constant integer := 3; v_pile constant integer := 5; v_dead_days constant integer := 30;
  v_unread_days constant integer := 7; v_sla_default constant interval := interval '48 hours'; v_week_days constant integer := 6;
  v_out jsonb;
begin
  begin
    v_actor := app_private.center_actor_v1();
  exception when insufficient_privilege then
    return jsonb_build_object('access', false, 'reason', 'no_center');
  end;
  v_admin := coalesce(public.is_admin(), false);
  v_company := v_admin or app_private.has_permission(v_actor, 'center.flow.view', 'global', '*');
  if not v_company then
    v_units_all := app_private.vcc_flow_managed_units(v_actor);
    select coalesce(array_agg(p.id), '{}') into v_projects_all from public.projects p
    where app_private.cdb_in_scope(p.id, p.status, p.is_hidden)
      and (p.manager_id = v_actor::text
        or app_private.project_has_permission_v2(p.id, p.construction_site_id::text, 'project.daily_log.approve', v_actor)
        or app_private.project_has_permission_v2(p.id, p.construction_site_id::text, 'project.org.assign_staff', v_actor)
        or app_private.project_has_permission_v2(p.id, p.construction_site_id::text, 'project.material_request.approve', v_actor));
    if cardinality(v_units_all) = 0 and cardinality(v_projects_all) = 0 then
      return jsonb_build_object('access', false, 'reason', 'no_scope');
    end if;
  end if;

  if p_project_id is not null then
    if not v_company and not (p_project_id = any(v_projects_all)) then
      raise exception using errcode = '42501', message = 'FLOW_SCOPE_DENIED';
    end if;
    v_kind := 'project'; v_projects := array[p_project_id];
  elsif p_unit_id is not null then
    if not v_company and not (p_unit_id = any(v_units_all)) then
      raise exception using errcode = '42501', message = 'FLOW_SCOPE_DENIED';
    end if;
    v_kind := 'unit'; v_units := app_private.vcc_flow_unit_tree(p_unit_id);
  elsif v_company then
    v_kind := 'company';
  elsif cardinality(v_units_all) > 0 then
    v_kind := 'unit'; v_units := v_units_all;
  else
    v_kind := 'project'; v_projects := v_projects_all;
  end if;

  if coalesce(p_access_only, false) then
    return jsonb_build_object('access', true, 'scope', jsonb_build_object('kind', v_kind, 'canCompany', v_company,
      'unitIds', to_jsonb(v_units), 'projectIds', to_jsonb(v_projects)));
  end if;

  v_from := now() - make_interval(days => v_range);
  v_daily_from := (now() at time zone 'Asia/Ho_Chi_Minh')::date - 29;

  with
  -- Người → phòng (nhân viên đang làm việc trước, mới nhất trước). Người không có hồ sơ nhân viên hoặc chưa gắn phòng → 'unassigned'.
  pu as materialized (
    select u.id::text as uid, u.name,
      (select e.org_unit_id from public.employees e where e.user_id = u.id
         order by (e.status = 'Đang làm việc') desc, e.updated_at desc nulls last limit 1) as unit_id
    from public.users u
  ),
  -- Lượt giao bước xử lý trong khoảng: quy trình (đủ người giao / nhận / hạn / kết quả) + Vioo Work.
  f0 as (
    select 'wf'::text as source, a.id::text as id, a.assigned_by::text as from_uid, a.assignee_user_id::text as to_uid,
      a.assigned_at as since, a.acted_at as done_at, a.due_at,
      case a.status when 'PENDING' then 'waiting' when 'APPROVED' then 'done' when 'REJECTED' then 'rejected' when 'RETURNED' then 'returned'
        when 'SKIPPED' then 'skipped' when 'CANCELLED' then 'cancelled' else lower(a.status) end as outcome,
      s.project_id, w.template_id::text as kind_id
    from public.workflow_step_assignments a
    left join public.workflow_subjects s on s.id = a.workflow_subject_id
    left join public.workflow_instances w on w.id = a.workflow_instance_id
    where a.assigned_at >= v_from and a.assignee_user_id is not null
    union all
    select 'work', x.id::text, x.assigned_by::text, x.user_id::text, x.assigned_at, coalesce(x.completed_at, x.ended_at),
      coalesce(x.execution_sla_due_at, x.acknowledgement_due_at, t.deadline_at),
      case when x.state = 'completed' then 'done' when x.state = 'transferred' then 'skipped'
        when x.state = 'cancelled' or x.ended_at is not null or t.status = 'cancelled' then 'cancelled' else 'waiting' end,
      t.project_id, null
    from public.work_task_assignments x join public.work_tasks t on t.id = x.task_id
    where x.assigned_at >= v_from
  ),
  f as materialized (
    select f0.*, coalesce(pf.unit_id::text, 'unassigned') as from_unit, coalesce(pt.unit_id::text, 'unassigned') as to_unit, pt.name as to_name,
      extract(epoch from (f0.done_at - f0.since)) / 3600 as hours
    from f0 left join pu pf on pf.uid = f0.from_uid left join pu pt on pt.uid = f0.to_uid
    where case v_kind when 'company' then true
      when 'unit' then (pf.unit_id = any(v_units) or pt.unit_id = any(v_units))
      else f0.project_id = any(v_projects) end
  ),
  -- Việc đang chờ hôm nay, 19 nguồn. to_uid = người đang giữ; to_role = chờ một vai (HR, kế toán, thủ kho…) chứ không phải chưa giao.
  w0 as (
    select 'wf'::text as source, case s.subject_type when 'material_request' then 'project' when 'request' then 'request' else 'workflow' end as module,
      a.id::text as id, a.assigned_by::text as from_uid, a.assignee_user_id::text as to_uid, null::text as to_role,
      s.project_id, a.assigned_at as since, a.due_at, coalesce(t.name, 'Phiếu quy trình') as kind_name
    from public.workflow_step_assignments a
    left join public.workflow_subjects s on s.id = a.workflow_subject_id
    left join public.workflow_instances w on w.id = a.workflow_instance_id
    left join public.workflow_templates t on t.id = w.template_id
    where a.status = 'PENDING'
    union all
    -- Đề xuất vật tư đường cũ (gửi thẳng cho người duyệt); phiếu đã có bước quy trình đang chờ thì tính ở 'wf', không đếm hai lần.
    select 'mr', 'project', r.id, r.requester_id::text, r.submitted_to_user_id, null, r.project_id,
      coalesce(r.workflow_step_started_at, r.last_action_at, r.created_date), coalesce(r.workflow_step_due_at, r.expected_date), 'Đề xuất vật tư'
    from public.requests r
    where r.status = 'PENDING'
      and not exists (select 1 from public.workflow_step_assignments a where a.workflow_subject_id = r.workflow_subject_id and a.status = 'PENDING')
    union all
    select 'wms_tx', 'warehouse', t.id, t.requester_id::text, t.approver_id::text, case when t.approver_id is null then 'Thủ kho' end, null, t.created_at, null, 'Phiếu kho'
    from public.transactions t where t.status = 'PENDING'
    union all
    select 'daily_log', 'project', d.id, d.created_by_id, d.submitted_to_user_id, null, d.project_id, coalesce(d.submitted_at, d.created_at), null, 'Nhật ký thi công'
    from public.daily_logs d where d.status = 'submitted'
    union all
    select 'work_plan', 'project', w.id::text, coalesce(w.submitted_by, w.created_by)::text, w.submitted_to_user_id::text, null, w.project_id,
      coalesce(w.submitted_at, w.updated_at), null, 'Kế hoạch tuần / tháng'
    from public.project_work_plans w where w.status = 'submitted'
    union all
    select 'po', 'procurement', o.id, o.created_by_id, o.submitted_to_user_id, null, o.project_id, coalesce(o.last_action_at, o.created_at),
      app_private.vcc_date(o.expected_delivery_date)::timestamptz, 'Đơn hàng'
    from public.purchase_orders o where o.status = 'sent' and o.archived_at is null
    union all
    select 'po_delivery', 'procurement', b.id::text, b.approval_requested_by::text, b.approval_assignee_user_id::text, null, b.project_id,
      coalesce(b.approval_requested_at, b.updated_at), b.planned_delivery_date::timestamptz, 'Đợt giao'
    from public.purchase_order_delivery_batches b where b.approval_status = 'pending_approval' and b.status = 'planned'
    union all
    select 'hot', 'procurement', h.id::text, h.created_by::text, h.submitted_to_user_id, null, h.project_id, h.updated_at, null, 'Mua nóng / CCDC'
    from public.site_direct_purchases h where h.status = 'submitted'
    union all
    select 'fin_payment', 'finance', r.id::text, r.created_by::text, null, 'Kế toán', r.project_id, coalesce(r.submitted_at, r.created_at), r.planned_date::timestamptz,
      case r.status when 'approved' then 'Đề nghị chi · chờ chi' else 'Đề nghị chi' end
    from public.finance_payment_requests r where r.status in ('pending', 'approved')
    union all
    select 'fin_site_expense', 'finance', x.id::text, x.created_by::text, null, 'Kế toán', x.project_id, x.updated_at, null, 'Chi quỹ công trường'
    from public.finance_site_expenses x where x.status = 'submitted'
    union all
    select 'fin_fund_opening', 'finance', o.id::text, o.created_by::text, null, 'Kế toán', o.project_id, o.created_at, null, 'Mở quỹ công trường'
    from public.finance_project_fund_openings o where o.status = 'submitted'
    union all
    select 'leave', 'hrm', l.id::text, coalesce(l.created_by::text, e.user_id::text),
      (l.approvers -> (coalesce(l.current_step, 1) - 1) ->> 'userId'),
      case when (l.approvers -> (coalesce(l.current_step, 1) - 1) ->> 'userId') is null then 'HR' end,
      null, l."createdAt", l."dueDate", 'Nghỉ phép'
    from public.hrm_leave_requests l left join public.employees e on e.id = l."employeeId" where l.status = 'pending'
    union all
    select 'makeup', 'hrm', a.id::text, pe.user_id::text, a."submittedToUserId", case when a."submittedToUserId" is null then 'HR' end, null, a."createdAt", null, 'Chấm công bù'
    from public.hrm_attendance_proposals a left join public.employees pe on pe.id::text = a."proposerEmployeeId" where a."proposalStatus" = 'pending'
    union all
    select 'site_assignment', 'hrm', a.id::text, a.created_by::text, null, 'HR', null, a.created_at, a.start_date::timestamptz, 'Điều động công trường'
    from public.hrm_site_assignments a where a.status = 'pending'
    union all
    select 'timesheet', 'hrm', t.id::text, coalesce(t.submitted_by, t.opened_by)::text, null, 'HR', null, coalesce(t.submitted_at, t.opened_at), null, 'Chốt công tháng'
    from public.hrm_timesheet_periods t where t.status in ('reviewing', 'submitted')
    union all
    select 'profile_change', 'hrm', c.id::text, c.requested_by::text, null, 'HR', null, c.created_at, null, 'Hồ sơ nhân sự'
    from public.hrm_profile_change_requests c where c.status = 'pending'
    union all
    select 'office', 'office', d.id::text, d.created_by::text,
      (select a.user_id::text from public.office_document_approvals a where a.document_id = d.id and a.round = d.approval_round and a.status = 'PENDING' order by a.step limit 1),
      case when d.status = 'WAITING_NUMBER' then 'Văn thư' end, d.project_id, coalesce(d.submitted_at, d.updated_at), d.due_date::timestamptz,
      case d.status when 'WAITING_NUMBER' then 'Văn bản · chờ cấp số' else 'Văn bản' end
    from public.office_documents d where d.status in ('PENDING_APPROVAL', 'WAITING_NUMBER')
    union all
    select 'work', 'work', x.id::text, x.assigned_by::text, x.user_id::text, null, t.project_id, x.assigned_at,
      coalesce(x.execution_sla_due_at, x.acknowledgement_due_at, t.deadline_at), 'Vioo Work'
    from public.work_task_assignments x join public.work_tasks t on t.id = x.task_id
    where t.status not in ('draft', 'completed', 'cancelled')
      and x.state in ('pending_acknowledgement', 'clarification_requested', 'not_started', 'in_progress', 'blocked', 'changes_requested')
    union all
    select 'vehicle', 'vehicle', v.id::text, v.requester_user_id::text, v.manager_user_id_snapshot::text, case when v.manager_user_id_snapshot is null then 'Hành chính' end, null,
      coalesce(v.submitted_at, v.created_at), v.requested_pickup_at, 'Đặt xe'
    from public.vehicle_bookings v where v.status = 'PENDING_APPROVAL'
    union all
    select 'stock_count', 'warehouse', c.id::text, c.created_by::text, null, 'Thủ kho', null, coalesce(c.submitted_at, c.created_at), null, 'Kiểm kê'
    from public.wms_inventory_counts c where c.status = 'counting'
    union all
    select 'reconciliation', 'procurement', r.id::text, r.created_by::text, null, 'Mua hàng', null, r.created_at, null, 'Đối chiếu nhận hàng'
    from public.procurement_receipt_reconciliations r where r.status = 'open'
  ),
  w as materialized (
    select w0.*, coalesce(pf.unit_id::text, 'unassigned') as from_unit, coalesce(pt.unit_id::text, 'unassigned') as to_unit, pt.name as to_name,
      (w0.to_uid is null and w0.to_role is null) as unassigned,
      app_private.vcc_flow_business_days(w0.since, now(), v_week_days) > v_stuck_days as stuck,
      coalesce(w0.due_at, w0.since + v_sla_default) < now() as overdue,
      w0.due_at is null as sla_default,
      w0.since < now() - make_interval(days => v_dead_days) as dead,
      case when w0.since > now() - interval '1 day' then 'd1' when w0.since > now() - interval '3 days' then 'd3'
        when w0.since > now() - interval '7 days' then 'd7' when w0.since > now() - interval '30 days' then 'd30' else 'd30p' end as age
    from w0 left join pu pf on pf.uid = w0.from_uid left join pu pt on pt.uid = w0.to_uid
    where case v_kind when 'company' then true
      when 'unit' then (pt.unit_id = any(v_units) or pf.unit_id = any(v_units))
      else w0.project_id = any(v_projects) end
  ),
  units as (
    select o.id::text as id, o.name, o.type, o.parent_id::text as parent_id, o.is_active,
      (select count(*) from public.employees e where e.org_unit_id = o.id and e.status = 'Đang làm việc') as people
    from public.org_units o
    where o.is_active or o.id::text in (select from_unit from f union select to_unit from f union select to_unit from w)
  )
  select jsonb_build_object(
    'access', true,
    'generatedAt', now(),
    'rangeDays', v_range,
    'from', v_from,
    'scope', jsonb_build_object('kind', v_kind, 'canCompany', v_company, 'unitIds', to_jsonb(v_units), 'projectIds', to_jsonb(v_projects),
      'managedUnitIds', to_jsonb(v_units_all), 'ledProjectIds', to_jsonb(v_projects_all)),
    'thresholds', jsonb_build_object('stuckBusinessDays', v_stuck_days, 'pilePerson', v_pile, 'deadDays', v_dead_days,
      'unreadDays', v_unread_days, 'slaDefaultHours', (extract(epoch from v_sla_default) / 3600)::int, 'weekDays', v_week_days),
    'units', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'type', u.type, 'parentId', u.parent_id, 'people', u.people, 'active', u.is_active)
        order by u.people desc, u.name), '[]'::jsonb) from units u)
      || jsonb_build_array(jsonb_build_object('id', 'unassigned', 'name', 'Chưa gắn phòng ban', 'type', 'gap', 'parentId', null, 'active', true,
        'people', (select count(*) from public.employees e where e.status = 'Đang làm việc' and e.org_unit_id is null))),
    'links', (select coalesce(jsonb_agg(jsonb_build_object('from', x.from_unit, 'to', x.to_unit, 'n', x.n, 'done', x.done, 'waiting', x.waiting, 'medHours', x.med)
        order by x.n desc), '[]'::jsonb)
      from (select from_unit, to_unit, count(*) n, count(*) filter (where outcome = 'done') done, count(*) filter (where outcome = 'waiting') waiting,
              round((percentile_cont(0.5) within group (order by hours) filter (where done_at is not null))::numeric, 1) med
            from f group by 1, 2) x),
    'outcomes', (select coalesce(jsonb_agg(jsonb_build_object('outcome', x.outcome, 'n', x.n, 'avgHours', x.avg, 'medHours', x.med) order by x.n desc), '[]'::jsonb)
      from (select outcome, count(*) n, round(avg(hours)::numeric, 1) avg,
              round((percentile_cont(0.5) within group (order by hours))::numeric, 1) med
            from f group by 1) x),
    'unitOutcomes', (select coalesce(jsonb_agg(jsonb_build_object('unit', x.to_unit, 'outcome', x.outcome, 'n', x.n) order by x.to_unit, x.n desc), '[]'::jsonb)
      from (select to_unit, outcome, count(*) n from f group by 1, 2) x),
    'people', (select coalesce(jsonb_agg(jsonb_build_object('userId', x.to_uid, 'name', x.to_name, 'unitId', x.to_unit, 'received', x.received, 'done', x.done,
        'medHours', x.med, 'onTimePct', x.on_time, 'returned', x.returned, 'rejected', x.rejected,
        'holding', coalesce((select count(*) from w where w.to_uid = x.to_uid), 0)) order by x.received desc, x.to_name), '[]'::jsonb)
      from (select to_uid, max(to_name) to_name, max(to_unit) to_unit, count(*) received, count(*) filter (where done_at is not null) done,
              round((percentile_cont(0.5) within group (order by hours) filter (where done_at is not null))::numeric, 1) med,
              case when count(*) filter (where done_at is not null and due_at is not null) > 0
                then round(100.0 * count(*) filter (where done_at is not null and due_at is not null and done_at <= due_at)
                  / count(*) filter (where done_at is not null and due_at is not null)) end on_time,
              count(*) filter (where outcome = 'returned') returned, count(*) filter (where outcome = 'rejected') rejected
            from f where to_uid is not null group by 1 order by received desc limit 50) x),
    'creators', (select coalesce(jsonb_agg(jsonb_build_object('userId', x.from_uid, 'name', x.name, 'unitId', x.from_unit, 'n', x.n) order by x.n desc, x.name), '[]'::jsonb)
      from (select f.from_uid, max(pu.name) name, max(f.from_unit) from_unit, count(*) n from f left join pu on pu.uid = f.from_uid
            where f.from_uid is not null group by 1 order by n desc limit 20) x),
    'daily', (select jsonb_agg(jsonb_build_object('d', to_char(d.d, 'YYYY-MM-DD'), 'n', coalesce(s.n, 0)) order by d.d)
      from generate_series(v_daily_from, (now() at time zone 'Asia/Ho_Chi_Minh')::date, interval '1 day') d
      left join (select (since at time zone 'Asia/Ho_Chi_Minh')::date dd, count(*) n from f where since >= v_daily_from::timestamp at time zone 'Asia/Ho_Chi_Minh' group by 1) s on s.dd = d.d::date),
    'waiting', jsonb_build_object(
      'total', (select count(*) from w),
      'stuck', (select count(*) filter (where stuck) from w),
      'overdue', (select count(*) filter (where overdue) from w),
      'overdueByDefaultSla', (select count(*) filter (where overdue and sla_default) from w),
      'unassigned', (select count(*) filter (where unassigned) from w),
      'dead', (select count(*) filter (where dead) from w),
      'byUnit', (select coalesce(jsonb_agg(jsonb_build_object('unit', x.to_unit, 'n', x.n, 'stuck', x.stuck, 'overdue', x.overdue, 'dead', x.dead) order by x.n desc), '[]'::jsonb)
        from (select to_unit, count(*) n, count(*) filter (where stuck) stuck, count(*) filter (where overdue) overdue, count(*) filter (where dead) dead
              from w where to_uid is not null group by 1) x),
      'byRole', (select coalesce(jsonb_agg(jsonb_build_object('role', x.to_role, 'n', x.n, 'stuck', x.stuck) order by x.n desc), '[]'::jsonb)
        from (select to_role, count(*) n, count(*) filter (where stuck) stuck from w where to_uid is null and to_role is not null group by 1) x),
      'age', (select jsonb_agg(jsonb_build_object('bucket', b.bucket, 'n', coalesce(x.n, 0)) order by b.ord)
        from (values ('d1', 1), ('d3', 2), ('d7', 3), ('d30', 4), ('d30p', 5)) b(bucket, ord)
        left join (select age, count(*) n from w group by 1) x on x.age = b.bucket),
      'byKind', (select coalesce(jsonb_agg(jsonb_build_object('name', x.kind_name, 'source', x.source, 'n', x.n, 'stuck', x.stuck) order by x.n desc), '[]'::jsonb)
        from (select kind_name, max(source) source, count(*) n, count(*) filter (where stuck) stuck from w group by 1 order by n desc limit 12) x),
      'bySource', (select coalesce(jsonb_agg(jsonb_build_object('source', x.source, 'module', x.module, 'n', x.n, 'stuck', x.stuck, 'withPerson', x.wp) order by x.n desc), '[]'::jsonb)
        from (select source, max(module) module, count(*) n, count(*) filter (where stuck) stuck, count(*) filter (where to_uid is not null) wp from w group by 1) x),
      'byPerson', (select coalesce(jsonb_agg(jsonb_build_object('userId', x.to_uid, 'name', x.to_name, 'unitId', x.to_unit, 'n', x.n, 'stuck', x.stuck,
          'overdue', x.overdue, 'oldestAt', x.oldest, 'pile', x.n >= v_pile) order by x.n desc, x.oldest), '[]'::jsonb)
        from (select to_uid, max(to_name) to_name, max(to_unit) to_unit, count(*) n, count(*) filter (where stuck) stuck, count(*) filter (where overdue) overdue, min(since) oldest
              from w where to_uid is not null group by 1 order by n desc, oldest limit 20) x),
      'byProject', (select coalesce(jsonb_agg(jsonb_build_object('projectId', x.project_id, 'n', x.n, 'stuck', x.stuck) order by x.n desc), '[]'::jsonb)
        from (select project_id, count(*) n, count(*) filter (where stuck) stuck from w where project_id is not null group by 1 order by n desc limit 20) x)),
    'projects', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name, 'status', p.status,
        'waiting', coalesce(wp.n, 0), 'stuck', coalesce(wp.stuck, 0),
        'mrPending', coalesce(mr.pending, 0), 'mrApproved', coalesce(mr.approved, 0), 'mrTransit', coalesce(mr.transit, 0), 'mrAvgDays', mr.avg_days)
        order by coalesce(wp.n, 0) + coalesce(mr.pending, 0) + coalesce(mr.approved, 0) desc, p.name), '[]'::jsonb)
      from public.projects p
      left join (select project_id, count(*) n, count(*) filter (where stuck) stuck from w where project_id is not null group by 1) wp on wp.project_id = p.id
      left join (select r.project_id, count(*) filter (where r.status = 'PENDING') pending, count(*) filter (where r.status = 'APPROVED') approved,
                   count(*) filter (where r.status = 'IN_TRANSIT') transit,
                   round((avg(extract(epoch from (now() - r.created_date)) / 86400) filter (where r.status in ('APPROVED', 'IN_TRANSIT')))::numeric, 1) avg_days
                 from public.requests r where r.status in ('PENDING', 'APPROVED', 'IN_TRANSIT') and r.project_id is not null group by 1) mr on mr.project_id = p.id
      where app_private.cdb_in_scope(p.id, p.status, p.is_hidden)
        and (v_kind <> 'project' or p.id = any(v_projects))
        and (coalesce(wp.n, 0) + coalesce(mr.pending, 0) + coalesce(mr.approved, 0) + coalesce(mr.transit, 0)) > 0),
    'notifications', case when v_kind = 'company' then (
      select jsonb_build_object('total30', count(*), 'unread30', count(*) filter (where read_at is null and not coalesce(is_read, false)),
        'unread7d', count(*) filter (where read_at is null and not coalesce(is_read, false) and created_at < now() - make_interval(days => v_unread_days)),
        'people7d', count(distinct user_id) filter (where read_at is null and not coalesce(is_read, false) and created_at < now() - make_interval(days => v_unread_days)),
        'noModule', count(*) filter (where module is null))
      from public.notifications where created_at >= now() - interval '30 days') else null end,
    'gaps', jsonb_build_object(
      'employeesWithoutUnit', (select count(*) from public.employees e where e.status = 'Đang làm việc' and e.org_unit_id is null),
      'employeesActive', (select count(*) from public.employees e where e.status = 'Đang làm việc'),
      'assignmentsWithoutSla', (select count(*) filter (where due_at is null) from f where source = 'wf'),
      'assignments', (select count(*) filter (where source = 'wf') from f),
      'unitsWithoutManager', (select count(*) from public.org_units o where o.is_active and o.type = 'department'
         and not exists (select 1 from public.hrm_employee_slot_assignments a where a.slot_id = o.manager_slot_id and a.status = 'ACTIVE'
           and (a.effective_to is null or a.effective_to >= current_date))))
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.vcc_flow_v1(integer, text, uuid, boolean) from public, anon;
grant execute on function public.vcc_flow_v1(integer, text, uuid, boolean) to authenticated, service_role;
comment on function public.vcc_flow_v1(integer, text, uuid, boolean) is
  'Dòng chảy công việc (Trung tâm điều hành): lượt giao trong khoảng + việc đang chờ hôm nay, gom theo phòng / người / kết quả / dự án. Quyền kiểm ở máy chủ.';
