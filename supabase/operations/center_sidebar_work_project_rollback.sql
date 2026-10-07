-- Gỡ migration 20261008138005_center_sidebar_work_project: đưa hai RPC của Trung tâm điều hành về bản trước.
-- vcc_my_work_items_v1 → đúng bản 20261008138004 (không còn nguồn Quy trình / An toàn; giao diện vẫn chạy, nhóm
-- Công việc / Dự án chỉ còn các nguồn cũ). vcc_my_center_v1 → đúng bản 20261008138002 (chọn dự án lấy cả
-- planning / paused). Không đụng dữ liệu.
begin;
create or replace function public.vcc_my_work_items_v1(p_tab text default 'mine')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := app_private.center_actor_v1();
  v_me text := v_actor::text;
  v_tab text := coalesce(nullif(btrim(p_tab), ''), 'mine');
  v_employee uuid := app_private.hrm_current_employee_id();
  v_hr boolean := app_private.has_hrm_template_permission(v_actor, 'hrm.employee.view_sensitive');
  v_hr_manage boolean := app_private.has_hrm_template_permission(v_actor, 'hrm.master_data.manage');
  v_work boolean := app_private.has_permission(v_actor, 'work.module.access', 'global', '*');
  v_fin_record boolean := app_private.finance_can('record');
  v_fin_confirm boolean := app_private.finance_can('confirm');
  v_buyer boolean := app_private.receipt_recon_is_buyer();
  v_limit constant integer := 200;
  v_items jsonb := '[]'::jsonb;
  v_part jsonb;
  v_truncated text[] := '{}';
begin
  if v_tab not in ('mine', 'sent', 'watch') then
    raise exception using errcode = '22023', message = 'CENTER_TAB_INVALID';
  end if;

  -- 1. Đề xuất (module Yêu cầu) ───────────────────────────────────────────────────────────────
  select coalesce(jsonb_agg(app_private.vcc_item('rq', 'request',
      case when r.status = 'RETURNED' then 'do' when v_tab = 'mine' then 'approve' when v_tab = 'sent' then 'wait' else 'watch' end,
      r.id::text, r.code, r.title,
      case when r.status = 'RETURNED' then 'Bị trả lại để sửa' else app_private.vcc_user_name(r.created_by::text) || ' lập' end,
      r.created_by::text, coalesce(t.name, 'Yêu cầu'), r.due_at, r.status,
      jsonb_build_object('requestId', r.id))), '[]'::jsonb)
  into v_part
  from (select * from public.request_instances r
        where case v_tab
          when 'mine' then (r.status = 'PENDING' and exists (select 1 from public.workflow_step_assignments a
              where a.workflow_subject_id = r.workflow_subject_id and a.assignee_user_id = v_actor and a.status = 'PENDING'))
            or (r.status = 'RETURNED' and r.created_by = v_actor)
          when 'sent' then r.status = 'PENDING' and r.created_by = v_actor
          else r.status = 'PENDING' and r.created_by <> v_actor and exists (select 1 from public.workflow_participants p
              where p.workflow_subject_id = r.workflow_subject_id and p.user_id = v_actor and p.role = 'WATCHER' and p.is_active)
          end
        order by r.due_at nulls last, r.created_at limit v_limit) r
  left join public.request_templates t on t.id = r.request_template_id;
  v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'rq'; end if;

  -- 2. Đề xuất vật tư (module Dự án) ──────────────────────────────────────────────────────────
  if v_tab <> 'watch' then
    select coalesce(jsonb_agg(app_private.vcc_item('mr', 'project', case when v_tab = 'mine' then 'approve' else 'wait' end,
        r.id, r.code, r.title,
        case when v_tab = 'mine' then app_private.vcc_user_name(r.requester_id::text) || ' lập'
          else coalesce(r.submitted_to_name || ' đang duyệt', case r.status when 'APPROVED' then 'Đang cung ứng' when 'IN_TRANSIT' then 'Đang chuyển' else 'Chờ duyệt' end) end,
        r.requester_id::text,
        jsonb_array_length(coalesce(r.items, '[]'::jsonb)) || ' dòng · cần ' || to_char(r.expected_date, 'DD/MM')
          || coalesce(' · ' || p.code, ''),
        coalesce(r.workflow_step_due_at, r.expected_date), r.status::text,
        jsonb_build_object('requestId', r.id, 'projectId', r.project_id, 'requestOrigin', r.request_origin, 'siteWarehouseId', r.site_warehouse_id))), '[]'::jsonb)
    into v_part
    from (select * from public.requests r
          where case v_tab
            when 'mine' then r.status = 'PENDING' and (r.submitted_to_user_id = v_me
              or (r.workflow_subject_id is not null and app_private.project_workflow_actor_can_act(r.workflow_subject_id, v_actor)))
            else r.requester_id = v_actor and r.status in ('PENDING', 'APPROVED', 'IN_TRANSIT') end
          order by coalesce(r.workflow_step_due_at, r.expected_date), r.created_date limit v_limit) r
    left join public.projects p on p.id = r.project_id;
    v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'mr'; end if;
  end if;

  -- 3. Phiếu kho (module Vật tư) ─────────────────────────────────────────────────────────────
  -- Mỗi wms_has_action ~30 ms (tới 5 lần kiểm quyền). Gọi một lần cho mỗi bộ duy nhất
  -- (việc, kho nguồn, kho đích, tôi là người lập?, tôi được giao?) thay vì từng phiếu — cùng kết quả,
  -- vì hàm chỉ xét người lập / người được giao khi đó chính là người gọi.
  if v_tab <> 'watch' then
    select coalesce(jsonb_agg(app_private.vcc_item('wms_tx', 'warehouse',
        case when v_tab = 'sent' then 'wait' when t.status = 'PENDING' then 'approve' else 'confirm' end,
        t.id, t.id,
        'Phiếu ' || case t.type::text when 'IMPORT' then 'nhập' when 'EXPORT' then 'xuất' when 'TRANSFER' then 'chuyển'
          when 'ADJUSTMENT' then 'điều chỉnh' else 'thanh lý' end || ' kho'
          || coalesce(' · ' || coalesce(wt.name, ws.name), ''),
        case when v_tab = 'sent' then case t.status::text when 'PENDING' then 'Chờ duyệt' else 'Chờ kho xác nhận' end
          else coalesce(app_private.vcc_user_name(t.requester_id::text), app_private.vcc_user_name(t.created_by::text)) || ' lập' end,
        coalesce(t.requester_id, t.created_by)::text,
        jsonb_array_length(coalesce(t.items, '[]'::jsonb)) || ' dòng' || coalesce(' · ' || left(t.note, 60), ''),
        t.date, t.status::text,
        jsonb_build_object('transactionId', t.id, 'type', t.type, 'sourceWarehouseId', t.source_warehouse_id, 'targetWarehouseId', t.target_warehouse_id))), '[]'::jsonb)
    into v_part
    from (
      with open_tx as (
        select x.*,
          case when x.status = 'PENDING' and x.type in ('ADJUSTMENT', 'LIQUIDATION') then 'wms.transaction.exception_approve'
            when x.status = 'PENDING' then 'wms.transaction.approve' else 'wms.transaction.complete' end as code,
          case when x.requester_id = v_actor then v_actor end as req_me,
          case when x.approver_id = v_actor then v_actor end as appr_me
        from public.transactions x
        where x.status in ('PENDING', 'APPROVED')
          and (v_tab = 'mine' or x.requester_id = v_actor)
      ), allowed as materialized (
        select k.code, k.source_warehouse_id, k.target_warehouse_id, k.req_me, k.appr_me,
          app_private.wms_has_action(k.code, k.source_warehouse_id, k.target_warehouse_id, k.req_me, k.appr_me, v_actor) as ok
        from (select distinct code, source_warehouse_id, target_warehouse_id, req_me, appr_me from open_tx) k
        where v_tab = 'mine'
      )
      select o.* from open_tx o
      where v_tab = 'sent'
        or (not (o.code = 'wms.transaction.exception_approve' and o.requester_id = v_actor)
          and exists (select 1 from allowed a where a.ok and a.code = o.code
            and a.source_warehouse_id is not distinct from o.source_warehouse_id
            and a.target_warehouse_id is not distinct from o.target_warehouse_id
            and a.req_me is not distinct from o.req_me and a.appr_me is not distinct from o.appr_me))
      order by o.date desc limit v_limit) t
    left join public.warehouses ws on ws.id = t.source_warehouse_id
    left join public.warehouses wt on wt.id = t.target_warehouse_id;
    v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'wms_tx'; end if;
  end if;

  -- 4. Nhật ký thi công + phiếu kỹ sư (module Dự án) ──────────────────────────────────────────
  if v_tab <> 'watch' then
    select coalesce(jsonb_agg(app_private.vcc_item('daily_log', 'project', case when v_tab = 'mine' then 'approve' else 'wait' end,
        d.id, 'NK ' || coalesce(to_char(app_private.vcc_date(d.date), 'DD/MM'), d.date),
        'Nhật ký ' || coalesce(to_char(app_private.vcc_date(d.date), 'DD/MM'), d.date) || coalesce(' · ' || s.name, ''),
        case when v_tab = 'mine' then coalesce(app_private.vcc_user_name(d.submitted_by_id), app_private.vcc_user_name(d.created_by_id)) || ' gửi'
          else coalesce(d.submitted_to_name, 'Người duyệt') || ' đang duyệt' end,
        coalesce(d.submitted_by_id, d.created_by_id),
        d.worker_count || ' công' || case when d.summary_contribution_count > 0 then ' · ' || d.summary_contribution_count || ' phiếu kỹ sư' else '' end,
        app_private.vcc_date(d.date)::timestamptz, d.status,
        jsonb_build_object('dailyLogId', d.id, 'projectId', d.project_id, 'constructionSiteId', d.construction_site_id))), '[]'::jsonb)
    into v_part
    from (select * from public.daily_logs d
          where d.status = 'submitted' and case v_tab when 'mine' then d.submitted_to_user_id = v_me else d.created_by_id = v_me end
          order by d.date desc limit v_limit) d
    left join public.hrm_construction_sites s on s.id::text = d.construction_site_id;
    v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'daily_log'; end if;

    select coalesce(jsonb_agg(app_private.vcc_item('daily_slip', 'project', case when v_tab = 'mine' then 'do' else 'wait' end,
        c.id::text, 'Phiếu ' || to_char(c.date, 'DD/MM'),
        'Phiếu kỹ sư ' || to_char(c.date, 'DD/MM') || coalesce(' · ' || s.name, '')
          || case when c.status = 'returned' then ' bị trả lại' else '' end,
        case when c.status = 'returned' then coalesce(c.returned_by_name, 'Người tổng hợp') || ' trả lại'
          else coalesce(c.submitted_to_name, 'Người tổng hợp') || ' đang tổng hợp' end,
        coalesce(c.returned_by, c.submitted_to_user_id),
        coalesce(left(c.return_reason, 80), left(c.content, 80)),
        c.date::timestamptz, c.status,
        jsonb_build_object('contributionId', c.id, 'projectId', c.project_id, 'constructionSiteId', c.construction_site_id, 'date', c.date))), '[]'::jsonb)
    into v_part
    from (select * from public.daily_log_contributions c
          where c.author_user_id = v_me and c.status = case v_tab when 'mine' then 'returned' else 'submitted' end
          order by c.date desc limit v_limit) c
    left join public.hrm_construction_sites s on s.id::text = c.construction_site_id;
    v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'daily_slip'; end if;
  end if;

  -- 5. Kế hoạch tuần / tháng (module Dự án) ───────────────────────────────────────────────────
  if v_tab <> 'watch' then
    select coalesce(jsonb_agg(app_private.vcc_item('work_plan', 'project',
        case when w.status = 'returned' then 'do' when v_tab = 'mine' then 'approve' else 'wait' end,
        w.id::text, w.code,
        'Kế hoạch ' || case w.period_type when 'week' then 'tuần ' else 'tháng ' end
          || to_char(w.period_start, 'DD/MM') || '–' || to_char(w.period_end, 'DD/MM')
          || case when w.status = 'returned' then ' bị trả lại' else '' end,
        case when w.status = 'returned' then coalesce(app_private.vcc_user_name(w.returned_by::text), 'Người duyệt') || ' trả lại'
          when v_tab = 'mine' then coalesce(app_private.vcc_user_name(w.submitted_by::text), app_private.vcc_user_name(w.created_by::text)) || ' gửi'
          else coalesce(app_private.vcc_user_name(w.submitted_to_user_id::text), 'Người duyệt') || ' đang duyệt' end,
        coalesce(w.submitted_by, w.created_by)::text,
        coalesce(p.code, '') || case when w.status = 'returned' then coalesce(' · ' || left(w.return_reason, 80), '') else '' end,
        coalesce(w.submitted_at, w.updated_at), w.status,
        jsonb_build_object('planId', w.id, 'projectId', w.project_id, 'constructionSiteId', w.construction_site_id, 'periodType', w.period_type, 'periodStart', w.period_start))), '[]'::jsonb)
    into v_part
    from (select * from public.project_work_plans w
          where case v_tab
            when 'mine' then (w.status = 'submitted' and w.submitted_to_user_id = v_actor) or (w.status = 'returned' and w.created_by = v_actor)
            else w.status = 'submitted' and w.created_by = v_actor end
          order by w.submitted_at desc nulls last limit v_limit) w
    left join public.projects p on p.id = w.project_id;
    v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'work_plan'; end if;
  end if;

  -- 6. Đơn hàng + đợt giao (module Mua hàng) ──────────────────────────────────────────────────
  if v_tab <> 'watch' then
    select coalesce(jsonb_agg(app_private.vcc_item('po', 'procurement',
        case when o.status = 'returned' then 'do' when v_tab = 'mine' then 'approve' else 'wait' end,
        o.id, o.po_number,
        coalesce(o.vendor_name, 'Nhà cung cấp') || ' · ' || app_private.vcc_money(o.total_amount)
          || case when o.status = 'returned' then ' · bị trả lại' else '' end,
        case when v_tab = 'mine' and o.status <> 'returned' then coalesce(app_private.vcc_user_name(o.created_by_id), 'Mua hàng') || ' lập'
          else coalesce(o.submitted_to_name || ' đang duyệt', 'Chờ duyệt') end,
        o.created_by_id,
        jsonb_array_length(coalesce(o.items, '[]'::jsonb)) || ' dòng' || coalesce(' · ' || p.code, ''),
        app_private.vcc_date(o.expected_delivery_date)::timestamptz, o.status,
        jsonb_build_object('poId', o.id, 'projectId', o.project_id))), '[]'::jsonb)
    into v_part
    from (select * from public.purchase_orders o
          where o.archived_at is null and case v_tab
            when 'mine' then (o.status = 'sent' and o.submitted_to_user_id = v_me) or (o.status = 'returned' and o.created_by_id = v_me)
            else o.status = 'sent' and o.created_by_id = v_me end
          order by o.created_at desc limit v_limit) o
    left join public.projects p on p.id = o.project_id;
    v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'po'; end if;

    select coalesce(jsonb_agg(app_private.vcc_item('po_delivery', 'procurement', case when v_tab = 'mine' then 'approve' else 'wait' end,
        b.id::text, o.po_number,
        'Đợt giao ' || b.delivery_no || ' · ' || coalesce(o.vendor_name, 'Nhà cung cấp'),
        case when v_tab = 'mine' then coalesce(app_private.vcc_user_name(b.created_by::text), 'Mua hàng') || ' gửi duyệt'
          else coalesce(app_private.vcc_user_name(b.approval_assignee_user_id::text), 'Người duyệt') || ' đang duyệt' end,
        b.created_by::text,
        coalesce('giao ' || to_char(b.planned_delivery_date, 'DD/MM'), 'chưa có ngày giao') || coalesce(' · ' || p.code, ''),
        b.planned_delivery_date::timestamptz, b.approval_status,
        jsonb_build_object('poId', o.id, 'deliveryId', b.id, 'projectId', b.project_id))), '[]'::jsonb)
    into v_part
    from (select * from public.purchase_order_delivery_batches b
          where b.approval_status = 'pending_approval' and b.status = 'planned'
            and case v_tab when 'mine' then b.approval_assignee_user_id = v_actor else b.created_by = v_actor end
          order by b.planned_delivery_date nulls last limit v_limit) b
    join public.purchase_orders o on o.id = b.purchase_order_id
    left join public.projects p on p.id = b.project_id;
    v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'po_delivery'; end if;
  end if;

  -- 7. Mua nóng / CCDC (module Mua hàng) ──────────────────────────────────────────────────────
  if v_tab <> 'watch' then
    select coalesce(jsonb_agg(app_private.vcc_item('hot', 'procurement', case when v_tab = 'mine' then 'approve' else 'wait' end,
        h.id::text, h.code,
        coalesce(h.supplier_name_snapshot, 'Mua nóng') || ' · ' || app_private.vcc_money(h.total_amount),
        case when v_tab = 'mine' then coalesce(app_private.vcc_user_name(h.created_by::text), 'Công trường') || ' lập'
          else coalesce(h.submitted_to_name || ' đang duyệt', 'Chờ duyệt') end,
        h.created_by::text,
        coalesce(p.code, '') || case h.purchase_mode when 'immediate' then ' · đã mua' else ' · xin mua' end,
        h.purchase_date::timestamptz, h.status,
        jsonb_build_object('hotPurchaseId', h.id, 'projectId', h.project_id))), '[]'::jsonb)
    into v_part
    from (select * from public.site_direct_purchases h
          where h.status = 'submitted' and case v_tab when 'mine' then h.submitted_to_user_id = v_me else h.created_by = v_actor end
          order by h.created_at desc limit v_limit) h
    left join public.projects p on p.id = h.project_id;
    v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'hot'; end if;
  end if;

  -- 8. Đề nghị chi (module Tài chính) ─────────────────────────────────────────────────────────
  if v_tab <> 'watch' then
    select coalesce(jsonb_agg(app_private.vcc_item('fin_payment', 'finance',
        case when r.status = 'returned' then 'do' when v_tab = 'sent' then 'wait' when r.status = 'approved' then 'confirm' else 'approve' end,
        r.id::text, r.code,
        r.supplier_name || ' · ' || app_private.vcc_money(r.amount)
          || case r.status when 'returned' then ' · bị trả lại' when 'approved' then ' · đã duyệt, chờ chi' else '' end,
        case when v_tab = 'mine' and r.status = 'pending' then coalesce(app_private.vcc_user_name(r.created_by::text), 'Kế toán') || ' lập'
          when r.status = 'approved' then 'Chờ xác nhận đã chi'
          when r.status = 'returned' then 'Bị trả lại để sửa'
          else 'Bước ' || coalesce(r.route -> r.current_step ->> 'label', 'duyệt') end,
        r.created_by::text,
        coalesce(r.route -> r.current_step ->> 'label', '') || ' · chi ' || to_char(r.planned_date, 'DD/MM'),
        r.planned_date::timestamptz, r.status,
        jsonb_build_object('requestId', r.id, 'supplierId', r.supplier_id))), '[]'::jsonb)
    into v_part
    from (select * from public.finance_payment_requests r
          where case v_tab
            when 'mine' then
              (r.status = 'pending' and r.created_by is distinct from v_actor
                and (v_me in (select jsonb_array_elements_text(r.route -> r.current_step -> 'eligibleIds'))
                  or exists (select 1 from jsonb_array_elements_text(r.route -> r.current_step -> 'approverIds') a
                    where v_actor = any(app_private.finance_active_delegates(a::uuid))))
                and not exists (select 1 from public.finance_payment_request_steps s where s.request_id = r.id
                  and s.submission_no = r.submission_no and s.action = 'approve' and s.actor_id = v_actor))
              or (r.status = 'approved' and v_fin_confirm and r.created_by is distinct from v_actor)
              or (r.status = 'returned' and r.created_by = v_actor)
            else r.status in ('pending', 'approved') and r.created_by = v_actor end
          order by r.planned_date, r.created_at limit v_limit) r;
    v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'fin_payment'; end if;
  end if;

  -- 9. Quỹ công trường: khoản chi + đầu kỳ (module Tài chính) ─────────────────────────────────
  if v_tab <> 'watch' then
    select coalesce(jsonb_agg(app_private.vcc_item('fin_site_expense', 'finance', case when v_tab = 'mine' then 'approve' else 'wait' end,
        x.id::text, x.code, x.description || ' · ' || app_private.vcc_money(x.amount),
        case when v_tab = 'mine' then coalesce(app_private.vcc_user_name(x.created_by::text), 'Công trường') || ' gửi' else 'Chờ kế toán duyệt' end,
        x.created_by::text, coalesce(p.code, '') || coalesce(' · ' || f.name, ''),
        x.spent_date::timestamptz, x.status,
        jsonb_build_object('expenseId', x.id, 'accountId', x.account_id, 'projectId', x.project_id))), '[]'::jsonb)
    into v_part
    from (select x.* from public.finance_site_expenses x join public.cash_funds f on f.id = x.account_id
          where x.status = 'submitted' and case v_tab
            when 'mine' then v_fin_record and x.created_by is distinct from v_actor and f.holder_user_id is distinct from v_actor
            else x.created_by = v_actor end
          order by x.spent_date desc limit v_limit) x
    join public.cash_funds f on f.id = x.account_id
    left join public.projects p on p.id = x.project_id;
    v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'fin_site_expense'; end if;

    select coalesce(jsonb_agg(app_private.vcc_item('fin_fund_opening', 'finance', case when v_tab = 'mine' then 'confirm' else 'wait' end,
        o.id::text, 'Đầu kỳ', 'Đầu kỳ quỹ công trường ' || coalesce(p.code, ''),
        case when v_tab = 'mine' then coalesce(app_private.vcc_user_name(o.created_by::text), 'Kế toán') || ' khai' else 'Chờ xác nhận' end,
        o.created_by::text, 'số dư ' || app_private.vcc_money(o.balance) || ' · tới ' || to_char(o.cutover_date, 'DD/MM'),
        o.created_at, o.status,
        jsonb_build_object('openingId', o.id, 'projectId', o.project_id))), '[]'::jsonb)
    into v_part
    from (select * from public.finance_project_fund_openings o
          where o.status = 'submitted' and case v_tab
            when 'mine' then v_fin_confirm and o.created_by is distinct from v_actor else o.created_by = v_actor end
          order by o.created_at desc limit v_limit) o
    left join public.projects p on p.id = o.project_id;
    v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'fin_fund_opening'; end if;
  end if;

  -- 10. Nghỉ phép (module Nhân sự) ────────────────────────────────────────────────────────────
  if v_tab <> 'watch' then
    select coalesce(jsonb_agg(app_private.vcc_item('leave', 'hrm', case when v_tab = 'mine' then 'approve' else 'wait' end,
        l.id::text, coalesce(l.code, 'Nghỉ phép'),
        coalesce(e.full_name::text, 'Nhân viên') || ' nghỉ ' || lower(coalesce(lt.name, l.type)) || ' ' || l."totalDays" || ' ngày '
          || coalesce(to_char(app_private.vcc_date(l."startDate"), 'DD/MM'), l."startDate")
          || case when l."endDate" <> l."startDate" then '–' || coalesce(to_char(app_private.vcc_date(l."endDate"), 'DD/MM'), l."endDate") else '' end,
        case when v_tab = 'mine' then coalesce(e.full_name::text, 'Nhân viên') || ' gửi'
          else 'Chờ ' || coalesce(l.step ->> 'name', l.step ->> 'label', 'người duyệt') end,
        e.user_id::text, left(l.reason, 80),
        app_private.vcc_date(l."startDate")::timestamptz, l.status,
        jsonb_build_object('requestId', l.id, 'employeeId', l."employeeId"))), '[]'::jsonb)
    into v_part
    from (select l.*, l.approvers -> (coalesce(l.current_step, 1) - 1) as step from public.hrm_leave_requests l
          where l.status = 'pending' and case v_tab
            when 'mine' then (l.approvers -> (coalesce(l.current_step, 1) - 1) ->> 'userId') = v_me
              or ((l.approvers -> (coalesce(l.current_step, 1) - 1) ->> 'kind') = 'hr' and v_hr)
            else v_employee is not null and l."employeeId" = v_employee end
          order by l."startDate" limit v_limit) l
    left join public.employees e on e.id = l."employeeId"
    left join public.hrm_leave_types lt on lt.code = l.type;
    v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'leave'; end if;
  end if;

  -- 11. Chấm công bù (module Nhân sự) ─────────────────────────────────────────────────────────
  if v_tab <> 'watch' then
    select coalesce(jsonb_agg(app_private.vcc_item('makeup', 'hrm', case when v_tab = 'mine' then 'approve' else 'wait' end,
        a.id::text, 'Bù công ' || to_char(a.date, 'DD/MM'),
        coalesce(app_private.vcc_employee_name(a."targetEmployeeId"), 'Nhân viên') || ' đề nghị chấm công bù ' || to_char(a.date, 'DD/MM'),
        case when v_tab = 'mine' then coalesce(app_private.vcc_employee_name(a."proposerEmployeeId"), 'Nhân viên') || ' gửi'
          else coalesce(a."submittedToName", 'Người duyệt') || ' đang duyệt' end,
        a."submittedToUserId", left(a.reason, 80), a.date::timestamptz, a."proposalStatus",
        jsonb_build_object('proposalId', a.id, 'date', a.date))), '[]'::jsonb)
    into v_part
    from (select * from public.hrm_attendance_proposals a
          where a."proposalStatus" = 'pending' and case v_tab
            when 'mine' then a."submittedToUserId" = v_me
            else v_employee is not null and a."proposerEmployeeId" = v_employee::text end
          order by a.date desc limit v_limit) a;
    v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'makeup'; end if;
  end if;

  -- 12. Điều động công trường (module Nhân sự) ────────────────────────────────────────────────
  select coalesce(jsonb_agg(app_private.vcc_item('site_assignment', 'hrm', case v_tab when 'mine' then 'approve' when 'sent' then 'wait' else 'watch' end,
      a.id::text, a.code,
      coalesce(e.full_name::text, 'Nhân viên') || ' đến ' || coalesce(s.name, 'công trường') || ' từ ' || to_char(a.start_date, 'DD/MM')
        || case a.kind when 'temporary' then ' (tạm)' when 'concurrent' then ' (kiêm nhiệm)' else '' end,
      case when v_tab = 'sent' then 'Chờ HR Manage duyệt' else coalesce(app_private.vcc_user_name(a.created_by::text), 'HR') || ' lập' end,
      a.created_by::text, left(a.reason, 80), a.start_date::timestamptz, a.status,
      jsonb_build_object('assignmentId', a.id, 'employeeId', a.employee_id, 'siteId', a.site_id))), '[]'::jsonb)
  into v_part
  from (select * from public.hrm_site_assignments a
        where a.status = 'pending' and case v_tab
          when 'mine' then v_hr_manage
          when 'sent' then a.created_by = v_actor
          else not v_hr_manage and a.created_by is distinct from v_actor
            and (app_private.hrm_is_site_leader(v_actor, a.site_id) or (a.from_site_id is not null and app_private.hrm_is_site_leader(v_actor, a.from_site_id))) end
        order by a.start_date limit v_limit) a
  left join public.employees e on e.id = a.employee_id
  left join public.hrm_construction_sites s on s.id = a.site_id;
  v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'site_assignment'; end if;

  -- 13. Chốt công tháng (module Nhân sự) ──────────────────────────────────────────────────────
  if v_tab = 'mine' then
    select coalesce(jsonb_agg(app_private.vcc_item('timesheet', 'hrm', case when t.status = 'reviewing' then 'do' else 'approve' end,
        t.id::text, 'Kỳ công ' || lpad(t.month::text, 2, '0') || '/' || t.year,
        'Bảng công tháng ' || lpad(t.month::text, 2, '0') || '/' || t.year
          || case when t.status = 'reviewing' then ' đang rà soát' else ' chờ chốt' end,
        case when t.status = 'reviewing' then coalesce(app_private.vcc_user_name(t.opened_by::text), 'HR') || ' mở kỳ'
          else coalesce(app_private.vcc_user_name(t.submitted_by::text), 'HR') || ' gửi chốt' end,
        coalesce(t.submitted_by, t.opened_by)::text,
        case when t.status = 'reviewing' then 'HR rà soát rồi gửi chốt' else 'HR Manage duyệt để khóa tháng' end,
        coalesce(t.submitted_at, t.opened_at), t.status,
        jsonb_build_object('year', t.year, 'month', t.month))), '[]'::jsonb)
    into v_part
    from (select * from public.hrm_timesheet_periods t
          where (t.status = 'reviewing' and v_hr) or (t.status = 'submitted' and v_hr_manage)
          order by t.year desc, t.month desc limit v_limit) t;
    v_items := v_items || v_part;
  end if;

  -- 14. Hồ sơ nhân sự chờ duyệt (module Nhân sự) ──────────────────────────────────────────────
  if v_tab <> 'watch' then
    select coalesce(jsonb_agg(app_private.vcc_item('profile_change', 'hrm', case when v_tab = 'mine' then 'approve' else 'wait' end,
        c.id::text, 'Hồ sơ',
        coalesce(e.full_name::text, 'Nhân viên') || ' cập nhật ' || case c.kind when 'address' then 'địa chỉ' when 'identity' then 'giấy tờ tùy thân'
          when 'insurance' then 'bảo hiểm' when 'dependent' then 'người phụ thuộc' when 'bank' then 'tài khoản ngân hàng' when 'tax' then 'thuế'
          when 'qualification' then 'bằng cấp' when 'certification' then 'chứng chỉ' else 'thông tin khác' end,
        case when v_tab = 'mine' then coalesce(app_private.vcc_user_name(c.requested_by::text), 'Nhân viên') || ' gửi' else 'Chờ HR duyệt' end,
        c.requested_by::text, left(c.note, 80), c.created_at, c.status,
        jsonb_build_object('changeId', c.id, 'employeeId', c.employee_id))), '[]'::jsonb)
    into v_part
    from (select * from public.hrm_profile_change_requests c
          where c.status = 'pending' and case v_tab when 'mine' then v_hr else c.requested_by = v_actor end
          order by c.created_at limit v_limit) c
    left join public.employees e on e.id = c.employee_id;
    v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'profile_change'; end if;
  end if;

  -- 15. Văn bản (module Office) ───────────────────────────────────────────────────────────────
  select coalesce(jsonb_agg(app_private.vcc_item('office', 'office', d.kind, d.id::text,
      coalesce(d.document_number, t.code), d.title,
      case d.kind when 'approve' then d.creator_name || ' trình' when 'do' then d.creator_name || ' gửi'
        when 'read' then d.creator_name || ' phát hành' when 'wait' then 'Chờ ' || d.step_label else d.creator_name || ' phát hành' end,
      d.created_by::text,
      case d.kind when 'approve' then 'Duyệt nội dung' when 'do' then case when d.status = 'WAITING_NUMBER' then 'Cấp số văn bản'
          when d.status = 'RETURNED' then 'Bị trả lại để sửa' else 'Xử lý văn bản được giao' end
        when 'read' then 'Yêu cầu xác nhận đã đọc' when 'wait' then case d.status when 'PENDING_APPROVAL' then 'Đang duyệt' else 'Chờ cấp số' end
        else 'Đang theo dõi' end
        || case d.urgency when 'URGENT' then ' · khẩn' when 'VERY_URGENT' then ' · hỏa tốc' else '' end,
      coalesce(d.due_date::timestamptz, d.updated_at), d.status,
      jsonb_build_object('documentId', d.id))), '[]'::jsonb)
  into v_part
  from (
    select d.*, x.kind, x.step_label from (
      select 'approve' as kind, null::text as step_label, d.id from app_private.office_filtered('{"view":"approval"}'::jsonb) d where v_tab = 'mine'
      union all select 'do', null, d.id from app_private.office_filtered('{"view":"numbering"}'::jsonb) d where v_tab = 'mine'
      union all select 'do', null, d.id from app_private.office_filtered('{"view":"assigned"}'::jsonb) d where v_tab = 'mine'
      union all select 'do', null, d.id from app_private.office_filtered('{"view":"created","status":"RETURNED"}'::jsonb) d where v_tab = 'mine'
      union all select 'read', null, d.id from app_private.office_filtered('{"view":"unread"}'::jsonb) d where v_tab = 'mine' and d.require_acknowledgement
      union all select 'wait', coalesce((select a.label from public.office_document_approvals a where a.document_id = d.id and a.round = d.approval_round and a.status = 'PENDING' order by a.step limit 1), 'văn thư'), d.id
        from app_private.office_filtered('{"view":"created"}'::jsonb) d where v_tab = 'sent' and d.status in ('PENDING_APPROVAL', 'WAITING_NUMBER')
      union all select 'watch', null, d.id from app_private.office_filtered('{"view":"following"}'::jsonb) d where v_tab = 'watch' and d.status not in ('ARCHIVED', 'CANCELLED', 'REVOKED')
    ) x join public.office_documents d on d.id = x.id
    order by d.due_date nulls last, d.updated_at desc limit v_limit
  ) d
  left join public.office_document_types t on t.id = d.document_type_id;
  v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'office'; end if;

  -- 16. Vioo Work (module Công việc) ──────────────────────────────────────────────────────────
  if v_work then
    select coalesce(jsonb_agg(app_private.vcc_item('work', 'work', w.kind, w.id::text, w.task_code, w.title,
        case w.kind when 'approve' then coalesce(app_private.vcc_user_name(w.done_by), 'Người thực hiện') || ' nộp kết quả'
          when 'wait' then 'Đang chờ người thực hiện' when 'watch' then coalesce(app_private.vcc_user_name(w.created_by::text), '') || ' giao'
          else coalesce(app_private.vcc_user_name(w.created_by::text), '') || ' giao' end,
        w.created_by::text,
        case w.status when 'pending_acknowledgement' then 'Chờ nhận việc' when 'clarification_requested' then 'Đang hỏi lại'
          when 'not_started' then 'Chưa bắt đầu' when 'in_progress' then 'Đang làm' when 'blocked' then 'Bị chặn'
          when 'awaiting_review' then 'Chờ duyệt kết quả' when 'changes_requested' then 'Cần sửa lại' else w.status end
          || case w.priority when 'urgent' then ' · khẩn' when 'important' then ' · quan trọng' else '' end,
        w.deadline_at, w.status,
        jsonb_build_object('taskId', w.id, 'taskCode', w.task_code))), '[]'::jsonb)
    into v_part
    from (select t.*,
            case when v_tab = 'mine' and t.status = 'awaiting_review' then 'approve' when v_tab = 'mine' then 'do' when v_tab = 'sent' then 'wait' else 'watch' end as kind,
            (select x.user_id::text from public.work_task_assignments x where x.task_id = t.id and x.state = 'completed' order by x.completed_at desc nulls last limit 1) as done_by
          from public.work_tasks t
          where t.status not in ('draft', 'completed', 'cancelled') and case v_tab
            when 'mine' then
              (t.status in ('pending_acknowledgement', 'clarification_requested', 'not_started', 'in_progress', 'blocked', 'changes_requested')
                and exists (select 1 from public.work_task_assignments x where x.task_id = t.id and x.user_id = v_actor
                  and x.ended_at is null and x.state not in ('completed', 'cancelled')))
              or (t.status = 'awaiting_review' and (t.reviewer_user_id = v_actor or (t.review_policy = 'creator_review' and t.created_by = v_actor)))
            when 'sent' then t.created_by = v_actor
              and not (t.status = 'awaiting_review' and (t.reviewer_user_id = v_actor or (t.review_policy = 'creator_review' and t.created_by = v_actor)))
            else t.created_by <> v_actor and exists (select 1 from public.work_task_participants x where x.task_id = t.id and x.user_id = v_actor
              and x.participant_role = 'watcher' and x.ended_at is null) end
          order by t.deadline_at nulls last, t.updated_at desc limit v_limit) w;
    v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'work'; end if;
  end if;

  -- 17. Đặt xe (module Đặt xe) ────────────────────────────────────────────────────────────────
  if v_tab = 'mine' then
    select coalesce(jsonb_agg(app_private.vcc_item('vehicle', 'vehicle', 'approve', v.id::text, v.booking_code,
        v.purpose || ' · ' || v.destination_text,
        coalesce(v.requester_employee_name, app_private.vcc_user_name(v.requester_user_id::text), 'Nhân viên') || ' đặt',
        v.requester_user_id::text,
        to_char(v.requested_pickup_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI') || ' · ' || v.passenger_count || ' người',
        v.requested_pickup_at, v.status, jsonb_build_object('bookingId', v.id))), '[]'::jsonb)
    into v_part
    from (select * from app_private.get_pending_vehicle_booking_approval_cards_impl(v_actor) order by requested_pickup_at limit v_limit) v;
    v_items := v_items || v_part; if jsonb_array_length(v_part) >= v_limit then v_truncated := v_truncated || 'vehicle'; end if;
  elsif v_tab = 'sent' then
    select coalesce(jsonb_agg(app_private.vcc_item('vehicle', 'vehicle', 'wait', v.id::text, v.booking_code,
        v.purpose || ' · ' || v.destination_text, 'Chờ duyệt chuyến xe', v.requester_user_id::text,
        to_char(v.requested_pickup_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI') || ' · ' || v.passenger_count || ' người',
        v.requested_pickup_at, v.status, jsonb_build_object('bookingId', v.id))), '[]'::jsonb)
    into v_part
    from (select * from public.vehicle_bookings v where v.requester_user_id = v_actor and v.status = 'PENDING_APPROVAL'
          order by v.requested_pickup_at limit v_limit) v;
    v_items := v_items || v_part;
  end if;

  -- 18. Kiểm kê (module Vật tư) ───────────────────────────────────────────────────────────────
  if v_tab = 'mine' then
    select coalesce(jsonb_agg(app_private.vcc_item('stock_count', 'warehouse', 'do', c.id::text, c.count_no,
        'Kiểm kê ' || coalesce(w.name, 'kho') || ' đang đếm',
        coalesce(app_private.vcc_user_name(c.created_by::text), 'Thủ kho') || ' mở', c.created_by::text,
        left(c.reason, 80), c.snapshot_at, c.status,
        jsonb_build_object('countId', c.id, 'warehouseId', c.warehouse_id))), '[]'::jsonb)
    into v_part
    from (select * from public.wms_inventory_counts c
          where c.status = 'counting' and app_private.wms_has_action('wms.inventory.edit', c.warehouse_id, null, null, null, v_actor)
          order by c.snapshot_at desc limit v_limit) c
    left join public.warehouses w on w.id = c.warehouse_id;
    v_items := v_items || v_part;
  end if;

  -- 19. Đối chiếu nhận hàng (module Mua hàng) ─────────────────────────────────────────────────
  if v_tab = 'mine' then
    select coalesce(jsonb_agg(app_private.vcc_item('reconciliation', 'procurement', 'confirm', r.id::text, o.po_number,
        'Đối chiếu ' || o.po_number || ' · đợt ' || b.delivery_no || ' · ' || coalesce(o.vendor_name, ''),
        coalesce(app_private.vcc_user_name(r.created_by::text), 'Kho') || ' lập', r.created_by::text,
        coalesce(w.name, '') || case r.decision when 'full' then ' · nhận đủ' when 'partial' then ' · nhận một phần' else ' · không nhận' end,
        r.arrival_date::timestamptz, r.status,
        jsonb_build_object('reconciliationId', r.id, 'poId', r.purchase_order_id, 'deliveryId', r.delivery_batch_id, 'warehouseId', r.warehouse_id))), '[]'::jsonb)
    into v_part
    from (select * from public.procurement_receipt_reconciliations r
          where r.status = 'open' and (
            (v_buyer and r.buyer_confirmed_by is null and r.keeper_confirmed_by is distinct from v_actor)
            or (r.keeper_confirmed_by is null and r.buyer_confirmed_by is distinct from v_actor and app_private.receipt_recon_is_keeper(r.warehouse_id)))
          order by r.created_at desc limit v_limit) r
    join public.purchase_orders o on o.id = r.purchase_order_id
    join public.purchase_order_delivery_batches b on b.id = r.delivery_batch_id
    left join public.warehouses w on w.id = r.warehouse_id;
    v_items := v_items || v_part;
  end if;

  return jsonb_build_object(
    'tab', v_tab,
    'generatedAt', now(),
    'total', jsonb_array_length(v_items),
    'truncatedSources', to_jsonb(v_truncated),
    'sources', (select coalesce(jsonb_agg(jsonb_build_object('source', s.source, 'count', s.n) order by s.source), '[]'::jsonb)
      from (select i ->> 'source' as source, count(*) as n from jsonb_array_elements(v_items) i group by 1) s),
    'items', v_items);
end $$;
revoke all on function public.vcc_my_work_items_v1(text) from public, anon;
grant execute on function public.vcc_my_work_items_v1(text) to authenticated, service_role;

create or replace function public.vcc_my_center_v1(p_project_id text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := app_private.center_actor_v1();
  v_me text := v_actor::text;
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_today_text text := to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD');
  v_employee uuid := app_private.hrm_current_employee_id();
  v_admin boolean := public.is_admin();
  v_hr boolean := app_private.has_hrm_template_permission(v_actor, 'hrm.employee.view_sensitive');
  v_work boolean := app_private.has_permission(v_actor, 'work.module.access', 'global', '*');
  v_mine jsonb;
  v_options jsonb;
  v_site_project text;
  v_source text;
  v_project public.projects%rowtype;
  v_site public.hrm_construction_sites%rowtype;
  v_site_text text;
  v_can_po boolean;
  v_can_mr boolean;
  v_part jsonb;
  v_board jsonb;
  v_project_widget jsonb := null;
  v_hrm jsonb;
  v_work_widget jsonb;
  v_office jsonb;
  v_supply jsonb := null;
  v_finance jsonb := null;
begin
  -- Việc chờ tôi: đếm theo dự án và chọn dự án mặc định.
  v_mine := public.vcc_my_work_items_v1('mine');
  v_site_project := app_private.hrm_site_project_id(app_private.hrm_employee_primary_site_on(v_employee, v_today));

  with mine_projects as (
    select i -> 'ref' ->> 'projectId' as pid, count(*) as n
    from jsonb_array_elements(v_mine -> 'items') i where i -> 'ref' ->> 'projectId' is not null group by 1
  ), member as (
    select coalesce(s.project_id, app_private.hrm_site_project_id(app_private.vcc_uuid(s.construction_site_id))) as pid
    from public.project_staff s where s.user_id = v_me and (s.end_date is null or s.end_date >= v_today)
    union select v_site_project
    union select app_private.hrm_site_project_id(e.construction_site_id) from public.employees e where e.id = v_employee
    union select pid from mine_projects
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name, 'waiting', coalesce(m.n, 0))
      order by (p.status = 'active') desc, p.code), '[]'::jsonb)
  into v_options
  from public.projects p
  left join mine_projects m on m.pid = p.id
  where coalesce(p.status, '') in ('planning', 'active', 'paused')
    and (v_admin or p.id in (select pid from member where pid is not null));

  if nullif(btrim(p_project_id), '') is not null and exists (select 1 from jsonb_array_elements(v_options) o where o ->> 'id' = p_project_id) then
    v_source := 'selected'; select * into v_project from public.projects where id = p_project_id;
  elsif v_site_project is not null and exists (select 1 from jsonb_array_elements(v_options) o where o ->> 'id' = v_site_project) then
    v_source := 'assignment'; select * into v_project from public.projects where id = v_site_project;
  elsif exists (select 1 from jsonb_array_elements(v_options) o where (o ->> 'waiting')::int > 0) then
    v_source := 'most_work';
    select * into v_project from public.projects
    where id = (select o ->> 'id' from jsonb_array_elements(v_options) o order by (o ->> 'waiting')::int desc, o ->> 'code' limit 1);
  elsif jsonb_array_length(v_options) > 0 then
    v_source := 'member'; select * into v_project from public.projects where id = (v_options -> 0 ->> 'id');
  end if;

  if v_project.id is not null then
    select * into v_site from public.hrm_construction_sites where id = v_project.construction_site_id;
    v_site_text := v_site.id::text;
    v_can_po := v_admin or app_private.procurement_can('view')
      or app_private.current_actor_has_effective_room_action(v_project.id, v_site_text, 'material_po', 'view');
    v_can_mr := v_admin or app_private.procurement_can('view')
      or app_private.current_actor_has_effective_room_action(v_project.id, v_site_text, 'material_request', 'view');

    -- Thi công hôm nay: báo cáo ngày (quyền Room nhật ký — chính RPC today board kiểm).
    begin
      v_board := public.get_daily_log_today_board_v1(v_project.id, v_site_text, v_today);
      v_part := jsonb_build_object('state', 'ready',
        'slips', jsonb_array_length(coalesce(v_board -> 'slips', '[]'::jsonb)),
        'fronts', jsonb_array_length(coalesce(v_board -> 'slips', '[]'::jsonb)) + jsonb_array_length(coalesce(v_board -> 'missingFronts', '[]'::jsonb)),
        'people', coalesce((select sum(coalesce((s ->> 'people')::numeric, 0)) from jsonb_array_elements(coalesce(v_board -> 'slips', '[]'::jsonb)) s), 0),
        'summaryStatus', v_board -> 'summary' ->> 'status');
    exception when insufficient_privilege then v_part := jsonb_build_object('state', 'denied');
      when others then v_part := jsonb_build_object('state', 'error', 'code', sqlstate);
    end;
    v_project_widget := jsonb_build_object('construction', v_part);

    -- Vật tư đang về: PO của dự án đang giao.
    if v_can_po then
      select jsonb_build_object('state', 'ready',
          'count', count(*), 'amount', coalesce(sum(o.total_amount), 0),
          'nextPo', (select jsonb_build_object('poId', x.id, 'poNumber', x.po_number, 'expectedDate', app_private.vcc_date(x.expected_delivery_date))
            from public.purchase_orders x where x.project_id = v_project.id and x.archived_at is null and x.status in ('in_transit', 'partial')
            order by app_private.vcc_date(x.expected_delivery_date) nulls last, x.created_at limit 1))
      into v_part
      from public.purchase_orders o where o.project_id = v_project.id and o.archived_at is null and o.status in ('in_transit', 'partial');
    else
      v_part := jsonb_build_object('state', 'denied');
    end if;
    v_project_widget := v_project_widget || jsonb_build_object('supply', v_part);

    -- Tiến độ: cùng công thức màn Dự án (trọng số = chi phí/ngày × thời gian, không có thì thời gian × nguồn lực; chỉ việc lá).
    select jsonb_build_object('state', case when count(*) = 0 then 'empty' else 'ready' end,
        'mode', coalesce(v_project.progress_calculation_mode, 'gantt_weighted'),
        'percent', case when coalesce(v_project.progress_calculation_mode, 'gantt_weighted') = 'manual' then round(coalesce(v_project.manual_progress_percent, 0))
          when coalesce(sum(t.w), 0) > 0 then round(sum(least(100, greatest(0, t.progress)) * t.w) / sum(t.w)) else 0 end,
        'total', count(*),
        'done', count(*) filter (where t.progress >= 100),
        'overdue', count(*) filter (where t.progress < 100 and t.end_day < v_today),
        'inProgress', count(*) filter (where t.progress < 100 and t.progress > 0 and (t.end_day is null or t.end_day >= v_today)),
        'notStarted', count(*) filter (where t.progress <= 0 and (t.end_day is null or t.end_day >= v_today)),
        'endDate', v_project.end_date)
    into v_part
    from (
      select pt.progress, app_private.vcc_date(pt.end_date) as end_day,
        case when coalesce(pt.estimated_cost_per_day, 0) * d.dur > 0 then coalesce(pt.estimated_cost_per_day, 0) * d.dur
          else d.dur * greatest(1, coalesce(pt.resource_count, 1)) end as w
      from public.project_tasks pt
      cross join lateral (select case when pt.is_milestone then 1
        when coalesce(pt.duration, 0) > 0 then pt.duration
        else greatest(1, coalesce(app_private.vcc_date(pt.end_date) - app_private.vcc_date(pt.start_date), 0) + 1) end as dur) d
      where (pt.project_id = v_project.id or (pt.project_id is null and pt.construction_site_id = v_site_text))
        and not exists (select 1 from public.project_tasks c where c.parent_id = pt.id)
    ) t;
    v_project_widget := v_project_widget || jsonb_build_object('progress', v_part,
      'waiting', (select count(*) from jsonb_array_elements(v_mine -> 'items') i where i -> 'ref' ->> 'projectId' = v_project.id));

    -- Mua hàng & Kho của dự án.
    if v_can_mr then
      select jsonb_build_object('state', 'ready',
          'pending', count(*) filter (where r.status = 'PENDING'),
          'supplying', count(*) filter (where r.status in ('APPROVED', 'IN_TRANSIT')),
          'waitingStep', (select r2.workflow_step from public.requests r2 where r2.project_id = v_project.id and r2.status = 'PENDING'
            and r2.workflow_step is not null group by r2.workflow_step order by count(*) desc limit 1))
      into v_part
      from public.requests r where r.project_id = v_project.id and r.status in ('PENDING', 'APPROVED', 'IN_TRANSIT');
    else
      v_part := jsonb_build_object('state', 'denied');
    end if;
    v_supply := jsonb_build_object('requests', v_part);
    if v_can_po then
      select jsonb_build_object('state', 'ready', 'open', count(*), 'openAmount', coalesce(sum(o.total_amount), 0),
          'awaitingApproval', count(*) filter (where o.status = 'sent'))
      into v_part
      from public.purchase_orders o where o.project_id = v_project.id and o.archived_at is null and o.status in ('sent', 'confirmed', 'in_transit', 'partial');
    else
      v_part := jsonb_build_object('state', 'denied');
    end if;
    v_supply := v_supply || jsonb_build_object('orders', v_part);
    select jsonb_build_object('id', w.id, 'name', w.name, 'canView', app_private.wms_has_action('wms.inventory.view', w.id, null, null, null, v_actor))
    into v_part
    from public.warehouses w where not coalesce(w.is_archived, false)
      and (w.project_id = v_project.id or (v_site.id is not null and w.construction_site_id = v_site.id))
    order by w.is_default_for_site desc, w.created_at limit 1;
    v_supply := v_supply || jsonb_build_object('warehouse', v_part);

    -- Tài chính dự án: null khi không được xem → widget ẩn hẳn.
    begin
      v_finance := public.get_finance_project_summary_v1(v_project.id);
    exception when others then v_finance := null;
    end;
  end if;

  -- Nhân sự: của tôi (chấm công hôm nay, phép, công tháng) + đội công trường (CHT / HR).
  if v_employee is null then
    v_hrm := jsonb_build_object('state', 'empty');
  else
    select jsonb_build_object('checkIn', a."checkIn", 'checkOut', a."checkOut", 'locationName', a."locationName", 'status', a.status)
    into v_part from public.hrm_attendance a where a."employeeId" = v_employee and a.date = v_today_text order by a."createdAt" desc limit 1;
    v_hrm := jsonb_build_object('state', 'ready', 'attendance', v_part);
    begin
      v_part := public.get_hrm_leave_ledger(v_employee, extract(year from v_today)::int);
      v_hrm := v_hrm || jsonb_build_object('leave', case when v_part -> 'balance' is null or jsonb_typeof(v_part -> 'balance') = 'null' then null
        else jsonb_build_object('availableDays', v_part -> 'balance' -> 'availableDays', 'pendingDays', v_part -> 'balance' -> 'pendingDays', 'year', extract(year from v_today)::int) end);
    exception when others then v_hrm := v_hrm || jsonb_build_object('leave', null);
    end;
    begin
      v_part := public.get_hrm_timesheet(extract(year from v_today)::int, extract(month from v_today)::int, v_employee);
      v_hrm := v_hrm || jsonb_build_object('timesheet', jsonb_build_object('workDays', v_part -> 'totals' -> 'workDays',
        'month', extract(month from v_today)::int, 'year', extract(year from v_today)::int, 'periodStatus', v_part -> 'period' ->> 'status'));
    exception when others then v_hrm := v_hrm || jsonb_build_object('timesheet', null);
    end;
    if v_site.id is not null and (v_hr or v_admin or app_private.hrm_is_site_leader(v_actor, v_site.id)) then
      select jsonb_build_object('state', 'ready', 'total', count(*),
          'present', count(*) filter (where exists (select 1 from public.hrm_attendance a where a."employeeId" = e.id and a.date = v_today_text and a."checkIn" is not null)),
          'assignments', (select count(*) from public.hrm_site_assignments s where s.site_id = v_site.id and s.status = 'approved'
            and s.start_date <= v_today and (s.end_date is null or s.end_date >= v_today)))
      into v_part
      from public.employees e
      where e.status = 'Đang làm việc'
        and coalesce(app_private.hrm_employee_primary_site_on(e.id, v_today), e.construction_site_id) = v_site.id;
      v_hrm := v_hrm || jsonb_build_object('team', v_part);
    else
      v_hrm := v_hrm || jsonb_build_object('team', jsonb_build_object('state', case when v_site.id is null then 'empty' else 'denied' end));
    end if;
  end if;

  -- Công việc: Work (nếu có quyền), việc đã giao, yêu cầu tôi gửi.
  v_work_widget := jsonb_build_object('workEnabled', v_work,
    'assigned', case when v_work then (select jsonb_build_object('active', count(*),
        'overdue', count(*) filter (where (i ->> 'dueAt')::timestamptz < now()),
        'nearest', (select jsonb_build_object('code', j ->> 'code', 'taskCode', j -> 'ref' ->> 'taskCode', 'dueAt', j ->> 'dueAt')
          from jsonb_array_elements(v_mine -> 'items') j where j ->> 'source' = 'work' and j ->> 'kind' = 'do' and j ->> 'dueAt' is not null
          order by j ->> 'dueAt' limit 1))
      from jsonb_array_elements(v_mine -> 'items') i where i ->> 'source' = 'work' and i ->> 'kind' = 'do') else null end,
    'created', case when v_work then (select jsonb_build_object('open', count(*), 'awaitingReview', count(*) filter (where t.status = 'awaiting_review'))
      from public.work_tasks t where t.created_by = v_actor and t.status not in ('draft', 'completed', 'cancelled')) else null end,
    'requests', (select jsonb_build_object('pending', count(*), 'returned', count(*) filter (where r.status = 'RETURNED'),
        'latest', (select jsonb_build_object('id', x.id, 'code', x.code, 'title', x.title, 'status', x.status,
            'waitingOn', (select string_agg(u.name, ', ') from public.workflow_step_assignments a join public.users u on u.id = a.assignee_user_id
              where a.workflow_subject_id = x.workflow_subject_id and a.status = 'PENDING'))
          from public.request_instances x where x.created_by = v_actor and x.status in ('PENDING', 'RETURNED') order by x.created_at desc limit 1))
      from public.request_instances r where r.created_by = v_actor and r.status in ('PENDING', 'RETURNED')));

  -- Hành chính: văn bản cần xác nhận đã đọc, chuyến xe sắp tới của tôi.
  begin
    select jsonb_build_object('state', 'ready', 'count', count(*),
        'first', (select jsonb_build_object('id', d2.id, 'documentNumber', d2.document_number, 'title', d2.title)
          from app_private.office_filtered('{"view":"unread"}'::jsonb) d2 where d2.require_acknowledgement
          order by d2.due_date nulls last, d2.issued_at desc limit 1))
    into v_part
    from app_private.office_filtered('{"view":"unread"}'::jsonb) d where d.require_acknowledgement;
  exception when insufficient_privilege then v_part := jsonb_build_object('state', 'denied');
    when others then v_part := jsonb_build_object('state', 'error', 'code', sqlstate);
  end;
  v_office := jsonb_build_object('documents', v_part);
  select jsonb_build_object('id', b.id, 'code', b.booking_code, 'status', b.status, 'pickupAt', b.requested_pickup_at, 'destination', b.destination_text,
      'vehicle', (select coalesce(nullif(a.code, ''), a.name) from public.vehicle_booking_assignments x join public.assets a on a.id = x.vehicle_asset_id
        where x.booking_id = b.id and x.is_active and x.released_at is null and x.superseded_at is null order by x.version desc limit 1))
  into v_part
  from public.vehicle_bookings b
  where b.requester_user_id = v_actor and b.status in ('PENDING_APPROVAL', 'WAITING_DISPATCH', 'ASSIGNED', 'IN_PROGRESS')
    and b.expected_return_at >= now() - interval '1 day'
  order by b.requested_pickup_at limit 1;
  v_office := v_office || jsonb_build_object('nextTrip', v_part);

  return jsonb_build_object(
    'generatedAt', now(),
    'today', v_today,
    'project', case when v_project.id is null then null else jsonb_build_object(
      'id', v_project.id, 'code', v_project.code, 'name', v_project.name, 'status', v_project.status, 'endDate', v_project.end_date,
      'source', v_source,
      'site', case when v_site.id is null then null else jsonb_build_object('id', v_site.id, 'name', v_site.name,
        'latitude', v_site.latitude, 'longitude', v_site.longitude) end) end,
    'projectOptions', v_options,
    'widgets', jsonb_build_object(
      'project', v_project_widget,
      'hrm', v_hrm,
      'work', v_work_widget,
      'office', v_office,
      'supply', v_supply,
      'finance', v_finance));
end $$;
revoke all on function public.vcc_my_center_v1(text) from public, anon;
grant execute on function public.vcc_my_center_v1(text) to authenticated, service_role;
commit;
