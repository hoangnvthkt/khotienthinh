-- Dòng chảy công việc — PR-3 (13/10/2026): danh sách phiếu đang chờ theo trang + nhắc người đang giữ việc.
-- Thiết kế: docs/command-center/08-dong-chay-cong-viec-2026-10-13.md (mục 12). Kèm vcc_flow_v1 (PR-1, không đổi).
--   app_private.vcc_flow_thresholds_v1()                 ngưỡng dùng chung (đứng yên 3 ngày làm việc, phiếu chết 30 ngày, SLA mặc định 48 giờ…)
--   app_private.vcc_flow_scope_v1(project, unit)         phạm vi của người gọi (toàn công ty / phòng mình / dự án mình) — cùng luật vcc_flow_v1
--   app_private.vcc_flow_waiting_rows_v1(kind, units, projects)  mọi việc đang chờ hôm nay trong phạm vi, có mã / tiêu đề / ref mở phiếu
--   app_private.vcc_flow_items_rows_v1(filter)           lọc theo người giữ / phòng / nguồn / loại phiếu / tình trạng / dự án
--   public.vcc_flow_items_v1(filter, limit, offset)       trang danh sách; mỗi dòng đúng khuôn vcc_item của "Việc của tôi" → Center mở phiếu thành tab
--   public.vcc_flow_remind_v1(filter, note)               nhắc người đang giữ các việc khớp lọc: thông báo trong app + push (trigger sẵn có),
--                                                         mỗi người tối đa 1 lần / 24 giờ / người nhắc, có audit_trail
-- Người được nhắc là người giữ việc (to_uid); việc chờ một vai (HR, Kế toán, Thủ kho…) không nhắc được. Không sửa phiếu, không đổi người xử lý.
-- Rollback: supabase/tests/center_flow_items_rollback.sql · Smoke: supabase/tests/center_flow_items_smoke.sql

-- ── 1. Ngưỡng dùng chung ─────────────────────────────────────────────────────────────────────
create function app_private.vcc_flow_thresholds_v1()
returns table(stuck_days integer, pile integer, dead_days integer, unread_days integer, sla_default interval, week_days integer)
language sql immutable set search_path = '' as $$ select 3, 5, 30, 7, interval '48 hours', 6 $$;
revoke all on function app_private.vcc_flow_thresholds_v1() from public, anon, authenticated;

-- ── 2. Phạm vi của người gọi (cùng luật vcc_flow_v1) ─────────────────────────────────────────
create function app_private.vcc_flow_scope_v1(p_project_id text, p_unit_id uuid)
returns table(kind text, company boolean, units uuid[], projects text[], units_all uuid[], projects_all text[])
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := app_private.center_actor_v1();
  v_company boolean; v_units_all uuid[] := '{}'; v_projects_all text[] := '{}'; v_units uuid[] := '{}'; v_projects text[] := '{}'; v_kind text;
begin
  v_company := coalesce(public.is_admin(), false) or app_private.has_permission(v_actor, 'center.flow.view', 'global', '*');
  if not v_company then
    v_units_all := app_private.vcc_flow_managed_units(v_actor);
    select coalesce(array_agg(p.id), '{}') into v_projects_all from public.projects p
    where app_private.cdb_in_scope(p.id, p.status, p.is_hidden)
      and (p.manager_id = v_actor::text
        or app_private.project_has_permission_v2(p.id, p.construction_site_id::text, 'project.daily_log.approve', v_actor)
        or app_private.project_has_permission_v2(p.id, p.construction_site_id::text, 'project.org.assign_staff', v_actor)
        or app_private.project_has_permission_v2(p.id, p.construction_site_id::text, 'project.material_request.approve', v_actor));
    if cardinality(v_units_all) = 0 and cardinality(v_projects_all) = 0 then
      return query select null::text, false, '{}'::uuid[], '{}'::text[], '{}'::uuid[], '{}'::text[]; return;
    end if;
  end if;
  if p_project_id is not null then
    if not v_company and not (p_project_id = any(v_projects_all)) then raise exception using errcode = '42501', message = 'FLOW_SCOPE_DENIED'; end if;
    v_kind := 'project'; v_projects := array[p_project_id];
  elsif p_unit_id is not null then
    if not v_company and not (p_unit_id = any(v_units_all)) then raise exception using errcode = '42501', message = 'FLOW_SCOPE_DENIED'; end if;
    v_kind := 'unit'; v_units := app_private.vcc_flow_unit_tree(p_unit_id);
  elsif v_company then v_kind := 'company';
  elsif cardinality(v_units_all) > 0 then v_kind := 'unit'; v_units := v_units_all;
  else v_kind := 'project'; v_projects := v_projects_all;
  end if;
  return query select v_kind, v_company, v_units, v_projects, v_units_all, v_projects_all;
end $$;
revoke all on function app_private.vcc_flow_scope_v1(text, uuid) from public, anon, authenticated;

-- ── 3. Mọi việc đang chờ hôm nay trong phạm vi, đủ mã / tiêu đề / ref để mở phiếu ──────────────
create type app_private.vcc_flow_row as (
  source text, module text, kind text, id text, code text, title text, from_uid text, from_name text, from_unit text,
  to_uid text, to_name text, to_unit text, to_role text, project_id text, project_code text, since timestamptz, due_at timestamptz,
  sla_default boolean, stuck boolean, overdue boolean, dead boolean, kind_name text, status text, meta text, ref jsonb);

create function app_private.vcc_flow_waiting_rows_v1(p_kind text, p_units uuid[], p_projects text[])
returns setof app_private.vcc_flow_row
language sql stable security definer set search_path = '' as $$
  with t as (select * from app_private.vcc_flow_thresholds_v1()),
  pu as materialized (
    select u.id::text as uid, u.name,
      (select e.org_unit_id from public.employees e where e.user_id = u.id order by (e.status = 'Đang làm việc') desc, e.updated_at desc nulls last limit 1) as unit_id
    from public.users u
  ),
  w0 as (
    -- Bước quy trình đang chờ: phiếu Yêu cầu (rq) / đề xuất vật tư (mr) / phiếu quy trình chung (wf) tùy chủ thể.
    select case when ri.id is not null then 'rq' when rq.id is not null then 'mr' else 'wf' end as source,
      case when ri.id is not null then 'request' when rq.id is not null then 'project' else 'workflow' end as module, 'approve' as kind,
      coalesce(ri.id::text, rq.id, w.id::text) as id, coalesce(ri.code, rq.code, w.code, 'Phiếu quy trình') as code,
      coalesce(ri.title, rq.title, w.title, 'Phiếu quy trình') as title,
      a.assigned_by::text as from_uid, a.assignee_user_id::text as to_uid, null::text as to_role, coalesce(s.project_id, rq.project_id) as project_id,
      a.assigned_at as since, a.due_at, coalesce(tpl.name, case when ri.id is not null then 'Yêu cầu' when rq.id is not null then 'Đề xuất vật tư' else 'Phiếu quy trình' end) as kind_name,
      coalesce(ri.status, rq.status::text, w.status::text) as status, nullif(btrim(n.label), '') as step_label,
      case when ri.id is not null then jsonb_build_object('requestId', ri.id)
        when rq.id is not null then jsonb_build_object('requestId', rq.id, 'projectId', rq.project_id, 'requestOrigin', rq.request_origin, 'siteWarehouseId', rq.site_warehouse_id)
        else jsonb_build_object('instanceId', w.id, 'nodeId', a.node_id) end as ref
    from public.workflow_step_assignments a
    left join public.workflow_subjects s on s.id = a.workflow_subject_id
    left join public.workflow_instances w on w.id = a.workflow_instance_id
    left join public.workflow_templates tpl on tpl.id = w.template_id
    left join public.workflow_nodes n on n.id = a.node_id
    left join public.request_instances ri on ri.workflow_subject_id = s.id and s.subject_type = 'request'
    left join public.requests rq on rq.workflow_subject_id = s.id and s.subject_type = 'material_request'
    where a.status = 'PENDING'
    union all
    select 'mr', 'project', 'approve', r.id, r.code, r.title, r.requester_id::text, r.submitted_to_user_id, null, r.project_id,
      coalesce(r.workflow_step_started_at, r.last_action_at, r.created_date), coalesce(r.workflow_step_due_at, r.expected_date), 'Đề xuất vật tư', r.status::text, null,
      jsonb_build_object('requestId', r.id, 'projectId', r.project_id, 'requestOrigin', r.request_origin, 'siteWarehouseId', r.site_warehouse_id)
    from public.requests r
    where r.status = 'PENDING' and not exists (select 1 from public.workflow_step_assignments a where a.workflow_subject_id = r.workflow_subject_id and a.status = 'PENDING')
    union all
    select 'wms_tx', 'warehouse', 'approve', x.id, x.id,
      'Phiếu ' || case x.type::text when 'IMPORT' then 'nhập' when 'EXPORT' then 'xuất' when 'TRANSFER' then 'chuyển' when 'ADJUSTMENT' then 'điều chỉnh' else 'thanh lý' end || ' kho'
        || coalesce(' · ' || coalesce(wt.name, ws.name), ''),
      coalesce(x.requester_id, x.created_by)::text, x.approver_id::text, case when x.approver_id is null then 'Thủ kho' end, null, x.created_at, null, 'Phiếu kho', x.status::text, null,
      jsonb_build_object('transactionId', x.id, 'type', x.type, 'sourceWarehouseId', x.source_warehouse_id, 'targetWarehouseId', x.target_warehouse_id)
    from public.transactions x left join public.warehouses ws on ws.id = x.source_warehouse_id left join public.warehouses wt on wt.id = x.target_warehouse_id
    where x.status = 'PENDING'
    union all
    select 'daily_log', 'project', 'approve', d.id, 'NK ' || coalesce(to_char(app_private.vcc_date(d.date), 'DD/MM'), d.date),
      'Nhật ký ' || coalesce(to_char(app_private.vcc_date(d.date), 'DD/MM'), d.date) || coalesce(' · ' || cs.name, ''),
      coalesce(d.submitted_by_id, d.created_by_id), d.submitted_to_user_id, null, d.project_id, coalesce(d.submitted_at, d.created_at), null, 'Nhật ký thi công', d.status, null,
      jsonb_build_object('dailyLogId', d.id, 'projectId', d.project_id, 'constructionSiteId', d.construction_site_id)
    from public.daily_logs d left join public.hrm_construction_sites cs on cs.id::text = d.construction_site_id
    where d.status = 'submitted'
    union all
    select 'work_plan', 'project', 'approve', wp.id::text, wp.code,
      'Kế hoạch ' || case wp.period_type when 'week' then 'tuần ' else 'tháng ' end || to_char(wp.period_start, 'DD/MM') || '–' || to_char(wp.period_end, 'DD/MM'),
      coalesce(wp.submitted_by, wp.created_by)::text, wp.submitted_to_user_id::text, null, wp.project_id, coalesce(wp.submitted_at, wp.updated_at), null, 'Kế hoạch tuần / tháng', wp.status, null,
      jsonb_build_object('planId', wp.id, 'projectId', wp.project_id, 'constructionSiteId', wp.construction_site_id, 'periodType', wp.period_type, 'periodStart', wp.period_start)
    from public.project_work_plans wp where wp.status = 'submitted'
    union all
    select 'po', 'procurement', 'approve', o.id, o.po_number, coalesce(o.vendor_name, 'Nhà cung cấp') || ' · ' || app_private.vcc_money(o.total_amount),
      o.created_by_id, o.submitted_to_user_id, null, o.project_id, coalesce(o.last_action_at, o.created_at), app_private.vcc_date(o.expected_delivery_date)::timestamptz, 'Đơn hàng', o.status, null,
      jsonb_build_object('poId', o.id, 'projectId', o.project_id)
    from public.purchase_orders o where o.status = 'sent' and o.archived_at is null
    union all
    select 'po_delivery', 'procurement', 'approve', b.id::text, o.po_number, 'Đợt giao ' || b.delivery_no || ' · ' || coalesce(o.vendor_name, 'Nhà cung cấp'),
      coalesce(b.approval_requested_by, b.created_by)::text, b.approval_assignee_user_id::text, null, b.project_id, coalesce(b.approval_requested_at, b.updated_at), b.planned_delivery_date::timestamptz, 'Đợt giao', b.approval_status, null,
      jsonb_build_object('poId', o.id, 'deliveryId', b.id, 'projectId', b.project_id)
    from public.purchase_order_delivery_batches b join public.purchase_orders o on o.id = b.purchase_order_id
    where b.approval_status = 'pending_approval' and b.status = 'planned'
    union all
    select 'hot', 'procurement', 'approve', h.id::text, h.code, coalesce(h.supplier_name_snapshot, 'Mua nóng') || ' · ' || app_private.vcc_money(h.total_amount),
      h.created_by::text, h.submitted_to_user_id, null, h.project_id, h.updated_at, null, 'Mua nóng / CCDC', h.status, null,
      jsonb_build_object('hotPurchaseId', h.id, 'projectId', h.project_id)
    from public.site_direct_purchases h where h.status = 'submitted'
    union all
    select 'fin_payment', 'finance', case when r.status = 'approved' then 'confirm' else 'approve' end, r.id::text, r.code,
      r.supplier_name || ' · ' || app_private.vcc_money(r.amount) || case r.status when 'approved' then ' · đã duyệt, chờ chi' else '' end,
      r.created_by::text, null, 'Kế toán', r.project_id, coalesce(r.submitted_at, r.created_at), r.planned_date::timestamptz,
      case r.status when 'approved' then 'Đề nghị chi · chờ chi' else 'Đề nghị chi' end, r.status, coalesce(r.route -> r.current_step ->> 'label', ''),
      jsonb_build_object('requestId', r.id, 'supplierId', r.supplier_id)
    from public.finance_payment_requests r where r.status in ('pending', 'approved')
    union all
    select 'fin_site_expense', 'finance', 'approve', x.id::text, x.code, x.description || ' · ' || app_private.vcc_money(x.amount),
      x.created_by::text, null, 'Kế toán', x.project_id, x.updated_at, null, 'Chi quỹ công trường', x.status, null,
      jsonb_build_object('expenseId', x.id, 'accountId', x.account_id, 'projectId', x.project_id)
    from public.finance_site_expenses x where x.status = 'submitted'
    union all
    select 'fin_fund_opening', 'finance', 'confirm', o.id::text, 'Đầu kỳ', 'Đầu kỳ quỹ công trường · số dư ' || app_private.vcc_money(o.balance),
      o.created_by::text, null, 'Kế toán', o.project_id, o.created_at, null, 'Mở quỹ công trường', o.status, null,
      jsonb_build_object('openingId', o.id, 'projectId', o.project_id)
    from public.finance_project_fund_openings o where o.status = 'submitted'
    union all
    select 'leave', 'hrm', 'approve', l.id::text, coalesce(l.code, 'Nghỉ phép'),
      coalesce(e.full_name::text, 'Nhân viên') || ' nghỉ ' || lower(coalesce(lt.name, l.type)) || ' ' || l."totalDays" || ' ngày ' || coalesce(to_char(app_private.vcc_date(l."startDate"), 'DD/MM'), l."startDate"),
      coalesce(l.created_by::text, e.user_id::text), (l.approvers -> (coalesce(l.current_step, 1) - 1) ->> 'userId'),
      case when (l.approvers -> (coalesce(l.current_step, 1) - 1) ->> 'userId') is null then 'HR' end, null, l."createdAt", l."dueDate", 'Nghỉ phép', l.status, null,
      jsonb_build_object('requestId', l.id, 'employeeId', l."employeeId")
    from public.hrm_leave_requests l left join public.employees e on e.id = l."employeeId" left join public.hrm_leave_types lt on lt.code = l.type
    where l.status = 'pending'
    union all
    select 'makeup', 'hrm', 'approve', a.id::text, 'Bù công ' || to_char(a.date, 'DD/MM'),
      coalesce(app_private.vcc_employee_name(a."targetEmployeeId"), 'Nhân viên') || ' đề nghị chấm công bù ' || to_char(a.date, 'DD/MM'),
      pe.user_id::text, a."submittedToUserId", case when a."submittedToUserId" is null then 'HR' end, null, a."createdAt", null, 'Chấm công bù', a."proposalStatus", left(a.reason, 80),
      jsonb_build_object('proposalId', a.id, 'date', a.date)
    from public.hrm_attendance_proposals a left join public.employees pe on pe.id::text = a."proposerEmployeeId" where a."proposalStatus" = 'pending'
    union all
    select 'site_assignment', 'hrm', 'approve', a.id::text, a.code,
      coalesce(e.full_name::text, 'Nhân viên') || ' đến ' || coalesce(cs.name, 'công trường') || ' từ ' || to_char(a.start_date, 'DD/MM'),
      a.created_by::text, null, 'HR', null, a.created_at, a.start_date::timestamptz, 'Điều động công trường', a.status, left(a.reason, 80),
      jsonb_build_object('assignmentId', a.id, 'employeeId', a.employee_id, 'siteId', a.site_id)
    from public.hrm_site_assignments a left join public.employees e on e.id = a.employee_id left join public.hrm_construction_sites cs on cs.id = a.site_id
    where a.status = 'pending'
    union all
    select 'timesheet', 'hrm', case when ts.status = 'reviewing' then 'do' else 'approve' end, ts.id::text, 'Kỳ công ' || lpad(ts.month::text, 2, '0') || '/' || ts.year,
      'Bảng công tháng ' || lpad(ts.month::text, 2, '0') || '/' || ts.year || case when ts.status = 'reviewing' then ' đang rà soát' else ' chờ chốt' end,
      coalesce(ts.submitted_by, ts.opened_by)::text, null, 'HR', null, coalesce(ts.submitted_at, ts.opened_at), null, 'Chốt công tháng', ts.status, null,
      jsonb_build_object('year', ts.year, 'month', ts.month)
    from public.hrm_timesheet_periods ts where ts.status in ('reviewing', 'submitted')
    union all
    select 'profile_change', 'hrm', 'approve', c.id::text, 'Hồ sơ', coalesce(e.full_name::text, 'Nhân viên') || ' cập nhật hồ sơ',
      c.requested_by::text, null, 'HR', null, c.created_at, null, 'Hồ sơ nhân sự', c.status, left(c.note, 80),
      jsonb_build_object('changeId', c.id, 'employeeId', c.employee_id)
    from public.hrm_profile_change_requests c left join public.employees e on e.id = c.employee_id where c.status = 'pending'
    union all
    select 'office', 'office', case when d.status = 'WAITING_NUMBER' then 'do' else 'approve' end, d.id::text, coalesce(d.document_number, 'Văn bản'), d.title,
      d.created_by::text,
      (select ap.user_id::text from public.office_document_approvals ap where ap.document_id = d.id and ap.round = d.approval_round and ap.status = 'PENDING' order by ap.step limit 1),
      case when d.status = 'WAITING_NUMBER' then 'Văn thư' end, d.project_id, coalesce(d.submitted_at, d.updated_at), d.due_date::timestamptz,
      case d.status when 'WAITING_NUMBER' then 'Văn bản · chờ cấp số' else 'Văn bản' end, d.status, null,
      jsonb_build_object('documentId', d.id)
    from public.office_documents d where d.status in ('PENDING_APPROVAL', 'WAITING_NUMBER')
    union all
    select 'work', 'work', 'do', x.id::text, tk.task_code, tk.title, x.assigned_by::text, x.user_id::text, null, tk.project_id, x.assigned_at,
      coalesce(x.execution_sla_due_at, x.acknowledgement_due_at, tk.deadline_at), 'Vioo Work', tk.status, null,
      jsonb_build_object('taskId', tk.id, 'taskCode', tk.task_code)
    from public.work_task_assignments x join public.work_tasks tk on tk.id = x.task_id
    where tk.status not in ('draft', 'completed', 'cancelled')
      and x.state in ('pending_acknowledgement', 'clarification_requested', 'not_started', 'in_progress', 'blocked', 'changes_requested')
    union all
    select 'vehicle', 'vehicle', 'approve', v.id::text, v.booking_code, v.purpose || ' · ' || v.destination_text,
      v.requester_user_id::text, v.manager_user_id_snapshot::text, case when v.manager_user_id_snapshot is null then 'Hành chính' end, null,
      coalesce(v.submitted_at, v.created_at), v.requested_pickup_at, 'Đặt xe', v.status, null, jsonb_build_object('bookingId', v.id)
    from public.vehicle_bookings v where v.status = 'PENDING_APPROVAL'
    union all
    select 'stock_count', 'warehouse', 'do', c.id::text, c.count_no, 'Kiểm kê ' || coalesce(wh.name, 'kho') || ' đang đếm',
      c.created_by::text, null, 'Thủ kho', null, coalesce(c.submitted_at, c.created_at), null, 'Kiểm kê', c.status, left(c.reason, 80),
      jsonb_build_object('countId', c.id, 'warehouseId', c.warehouse_id)
    from public.wms_inventory_counts c left join public.warehouses wh on wh.id = c.warehouse_id where c.status = 'counting'
    union all
    select 'reconciliation', 'procurement', 'confirm', r.id::text, coalesce(o.po_number, 'Đối chiếu'), 'Đối chiếu ' || coalesce(o.po_number, '') || ' · ' || coalesce(o.vendor_name, ''),
      r.created_by::text, null, 'Mua hàng', o.project_id, r.created_at, null, 'Đối chiếu nhận hàng', r.status, null,
      jsonb_build_object('reconciliationId', r.id, 'poId', r.purchase_order_id, 'deliveryId', r.delivery_batch_id, 'warehouseId', r.warehouse_id)
    from public.procurement_receipt_reconciliations r left join public.purchase_orders o on o.id = r.purchase_order_id where r.status = 'open'
  )
  select w0.source, w0.module, w0.kind, w0.id, w0.code, w0.title,
    w0.from_uid, pf.name, coalesce(pf.unit_id::text, 'unassigned'),
    w0.to_uid, pt.name, coalesce(pt.unit_id::text, 'unassigned'), w0.to_role,
    w0.project_id, p.code, w0.since, w0.due_at,
    w0.due_at is null,
    app_private.vcc_flow_business_days(w0.since, now(), t.week_days) > t.stuck_days,
    coalesce(w0.due_at, w0.since + t.sla_default) < now(),
    w0.since < now() - make_interval(days => t.dead_days),
    w0.kind_name, w0.status,
    w0.kind_name || coalesce(' · ' || w0.step_label, '') || coalesce(' · ' || p.code, ''),
    w0.ref
  from w0 cross join t
  left join pu pf on pf.uid = w0.from_uid
  left join pu pt on pt.uid = w0.to_uid
  left join public.projects p on p.id = w0.project_id
  where case p_kind when 'company' then true
    when 'unit' then (pt.unit_id = any(p_units) or pf.unit_id = any(p_units))
    else w0.project_id = any(p_projects) end
$$;
revoke all on function app_private.vcc_flow_waiting_rows_v1(text, uuid[], text[]) from public, anon, authenticated;

-- ── 4. Lọc theo người giữ / phòng / nguồn / loại / tình trạng / dự án (phạm vi lấy từ người gọi) ─
-- filter: projectId · unitId (phạm vi, như vcc_flow_v1) · holderUserId · holderUnit ('unassigned' = chưa gắn phòng) · source · kindName
--         · status: stuck | overdue | dead | unassigned | role · role · project (dự án của phiếu)
create function app_private.vcc_flow_items_rows_v1(p_filter jsonb)
returns setof app_private.vcc_flow_row
language plpgsql stable security definer set search_path = '' as $$
declare v_scope record; v_f jsonb := coalesce(p_filter, '{}'::jsonb);
begin
  select * into v_scope from app_private.vcc_flow_scope_v1(nullif(v_f ->> 'projectId', ''), app_private.vcc_uuid(v_f ->> 'unitId'));
  if v_scope.kind is null then return; end if;
  return query
    select r.* from app_private.vcc_flow_waiting_rows_v1(v_scope.kind, v_scope.units, v_scope.projects) r
    where (nullif(v_f ->> 'holderUserId', '') is null or r.to_uid = v_f ->> 'holderUserId')
      and (nullif(v_f ->> 'holderUnit', '') is null or (r.to_uid is not null and r.to_unit = v_f ->> 'holderUnit'))
      and (nullif(v_f ->> 'source', '') is null or r.source = v_f ->> 'source')
      and (nullif(v_f ->> 'kindName', '') is null or r.kind_name = v_f ->> 'kindName')
      and (nullif(v_f ->> 'role', '') is null or r.to_role = v_f ->> 'role')
      and (nullif(v_f ->> 'project', '') is null or r.project_id = v_f ->> 'project')
      and case coalesce(v_f ->> 'status', '')
            when 'stuck' then r.stuck when 'overdue' then r.overdue when 'dead' then r.dead
            when 'unassigned' then (r.to_uid is null and r.to_role is null) when 'role' then (r.to_uid is null and r.to_role is not null)
            else true end
    order by r.dead desc, r.stuck desc, r.overdue desc, r.since asc;
end $$;
revoke all on function app_private.vcc_flow_items_rows_v1(jsonb) from public, anon, authenticated;

-- ── 5. Trang danh sách ──────────────────────────────────────────────────────────────────────────
create function public.vcc_flow_items_v1(p_filter jsonb default '{}'::jsonb, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200); v_offset integer := greatest(coalesce(p_offset, 0), 0); v_total integer; v_items jsonb; v_scope record;
begin
  begin
    select * into v_scope from app_private.vcc_flow_scope_v1(nullif(coalesce(p_filter, '{}'::jsonb) ->> 'projectId', ''), app_private.vcc_uuid(coalesce(p_filter, '{}'::jsonb) ->> 'unitId'));
  exception when insufficient_privilege then
    if sqlerrm = 'FLOW_SCOPE_DENIED' then raise; end if;
    return jsonb_build_object('access', false, 'reason', 'no_center');
  end;
  if v_scope.kind is null then return jsonb_build_object('access', false, 'reason', 'no_scope'); end if;
  select count(*) into v_total from app_private.vcc_flow_items_rows_v1(p_filter);
  select coalesce(jsonb_agg(
      app_private.vcc_item(r.source, r.module, 'watch', r.id, r.code, r.title,
        case when r.to_uid is not null then coalesce(r.to_name, 'Người dùng') || ' đang giữ' when r.to_role is not null then 'Chờ ' || r.to_role else 'Chưa giao người' end,
        r.to_uid, r.meta, r.due_at, r.status, r.ref)
      || jsonb_build_object(
        'holder', case when r.to_uid is not null then jsonb_build_object('userId', r.to_uid, 'name', r.to_name, 'unitId', r.to_unit) else null end,
        'holderRole', r.to_role,
        'sender', case when r.from_uid is not null then jsonb_build_object('userId', r.from_uid, 'name', r.from_name, 'unitId', r.from_unit) else null end,
        'since', r.since, 'stuck', r.stuck, 'overdue', r.overdue, 'dead', r.dead, 'slaDefault', r.sla_default,
        'kindName', r.kind_name, 'projectId', r.project_id, 'projectCode', r.project_code)
      order by r.dead desc, r.stuck desc, r.overdue desc, r.since asc), '[]'::jsonb)
  into v_items
  from (select * from app_private.vcc_flow_items_rows_v1(p_filter) offset v_offset limit v_limit) r;
  return jsonb_build_object('access', true, 'generatedAt', now(), 'total', v_total, 'limit', v_limit, 'offset', v_offset, 'items', v_items,
    'scope', jsonb_build_object('kind', v_scope.kind, 'canCompany', v_scope.company));
end $$;
revoke all on function public.vcc_flow_items_v1(jsonb, integer, integer) from public, anon;
grant execute on function public.vcc_flow_items_v1(jsonb, integer, integer) to authenticated, service_role;
comment on function public.vcc_flow_items_v1(jsonb, integer, integer) is
  'Dòng chảy công việc: danh sách phiếu đang chờ theo trang trong phạm vi người gọi; mỗi dòng đúng khuôn vcc_item để Center mở phiếu thành tab.';

-- ── 6. Nhắc người đang giữ việc ──────────────────────────────────────────────────────────────────
create function public.vcc_flow_remind_v1(p_filter jsonb default '{}'::jsonb, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid; v_actor_name text; v_scope record; v_note text := nullif(left(btrim(coalesce(p_note, '')), 300), '');
  v_holder record; v_sent integer := 0; v_skipped integer := 0; v_holders jsonb := '[]'::jsonb; v_body text; v_codes text;
begin
  begin
    select * into v_scope from app_private.vcc_flow_scope_v1(nullif(coalesce(p_filter, '{}'::jsonb) ->> 'projectId', ''), app_private.vcc_uuid(coalesce(p_filter, '{}'::jsonb) ->> 'unitId'));
  exception when insufficient_privilege then
    if sqlerrm = 'FLOW_SCOPE_DENIED' then raise; end if;
    return jsonb_build_object('access', false, 'reason', 'no_center');
  end;
  if v_scope.kind is null then return jsonb_build_object('access', false, 'reason', 'no_scope'); end if;
  v_actor := public.current_app_user_id();
  v_actor_name := coalesce(app_private.vcc_user_name(v_actor::text), 'Ban lãnh đạo');
  for v_holder in
    select r.to_uid, max(r.to_name) as name, count(*) as n,
      string_agg(r.code, ', ' order by r.dead desc, r.stuck desc, r.since) filter (where rn <= 4) as codes,
      jsonb_agg(jsonb_build_object('source', r.source, 'id', r.id, 'code', r.code) order by r.since) as items
    from (select x.*, row_number() over (partition by x.to_uid order by x.dead desc, x.stuck desc, x.since) as rn
          from app_private.vcc_flow_items_rows_v1(p_filter) x where x.to_uid is not null) r
    group by r.to_uid order by n desc, name
  loop
    if v_holder.to_uid = v_actor::text then
      v_skipped := v_skipped + 1;
      v_holders := v_holders || jsonb_build_object('userId', v_holder.to_uid, 'name', v_holder.name, 'items', v_holder.n, 'status', 'self');
      continue;
    end if;
    if exists (select 1 from public.notifications nt where nt.user_id = v_holder.to_uid and nt.entity_type = 'flow_reminder'
                 and nt.metadata ->> 'by' = v_actor::text and nt.created_at > now() - interval '24 hours') then
      v_skipped := v_skipped + 1;
      v_holders := v_holders || jsonb_build_object('userId', v_holder.to_uid, 'name', v_holder.name, 'items', v_holder.n, 'status', 'skipped');
      continue;
    end if;
    v_codes := v_holder.codes || case when v_holder.n > 4 then ' và ' || (v_holder.n - 4) || ' việc khác' else '' end;
    v_body := v_actor_name || ' nhắc bạn xử lý ' || v_holder.n || ' việc đang chờ: ' || v_codes || coalesce('. ' || v_note, '') || '. Mở Trung tâm điều hành → Việc của tôi.';
    insert into public.notifications(user_id, title, body, type, priority, module, link, metadata, category, message, severity,
      source_type, source_id, push_enabled, action_url, entity_type, delivery_reason)
    values (v_holder.to_uid, 'Nhắc: ' || v_holder.n || ' việc đang chờ bạn xử lý', v_body, 'warning', 'high', 'CENTER', '/center',
      jsonb_build_object('by', v_actor::text, 'byName', v_actor_name, 'items', v_holder.items, 'note', v_note), 'flow_reminder', v_body, 'warning',
      'flow_reminder', v_actor::text, true, '/center', 'flow_reminder', 'responsible');
    insert into public.audit_trail(table_name, record_id, record_label, action, new_data, user_id, user_name, module, description, impact_level)
    values ('notifications', v_holder.to_uid, v_holder.name, 'INSERT', jsonb_build_object('items', v_holder.items, 'note', v_note),
      v_actor::text, v_actor_name, 'CENTER', 'Nhắc ' || coalesce(v_holder.name, 'người giữ việc') || ' xử lý ' || v_holder.n || ' việc đang chờ', 'normal');
    v_sent := v_sent + 1;
    v_holders := v_holders || jsonb_build_object('userId', v_holder.to_uid, 'name', v_holder.name, 'items', v_holder.n, 'status', 'sent');
  end loop;
  return jsonb_build_object('access', true, 'sent', v_sent, 'skipped', v_skipped, 'holders', v_holders);
end $$;
revoke all on function public.vcc_flow_remind_v1(jsonb, text) from public, anon;
grant execute on function public.vcc_flow_remind_v1(jsonb, text) to authenticated, service_role;
comment on function public.vcc_flow_remind_v1(jsonb, text) is
  'Dòng chảy công việc: nhắc người đang giữ các việc khớp lọc (thông báo trong app + push), mỗi người tối đa 1 lần / 24 giờ / người nhắc, có audit_trail.';
