-- ===========================================================================
-- Bảng điều khiển — bảng tồn / nhập / xuất vật tư (chủ SP 10/10), thay bảng "Nhu cầu mua – cấp vật tư".
-- * get_center_dashboard_v1 thêm stockItems (dự án × vật tư: BOQ, đã đặt chưa giao, đang giao, nhập, xuất, trả NCC, tồn), bỏ needs.
-- * Phạm vi quyền tách ra app_private.cdb_actor_scope để hàm xem giao dịch dùng chung.
-- * get_center_material_moves_v1: chứng từ tạo nên mỗi số trên bảng (đơn mua, đợt giao, phiếu kho, phiếu trả NCC), có mã để mở đúng chứng từ.
-- ===========================================================================

-- Bảng người dùng được xem + dự án trong phạm vi (như get_center_dashboard_v1 trước đây).
create function app_private.cdb_actor_scope(p_actor uuid)
returns table (access text[], ids text[], admin boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_admin boolean; v_fin boolean; v_da boolean; v_mat boolean; v_lead text[] := '{}'; v_access text[] := '{}'; v_ids text[];
begin
  if p_actor is null then raise exception using errcode = '42501', message = 'DASHBOARD_DENIED'; end if;
  v_admin := coalesce(public.is_admin(), false);
  v_fin := v_admin or app_private.finance_can('view') or app_private.sensitive_view_all('finance');
  v_da := v_admin or app_private.has_permission(p_actor, 'system.da.manage');
  v_mat := v_admin or app_private.has_permission(p_actor, 'system.procurement.view') or app_private.has_permission(p_actor, 'system.procurement.manage')
    or app_private.has_permission(p_actor, 'system.wms.view') or app_private.has_permission(p_actor, 'system.wms.manage');
  if not (v_fin or v_da) then
    select coalesce(array_agg(p.id), '{}') into v_lead from public.projects p
    where app_private.cdb_in_scope(p.id, p.status, p.is_hidden)
      and (p.manager_id = p_actor::text
        or app_private.project_has_permission_v2(p.id, p.construction_site_id::text, 'project.daily_log.approve', p_actor)
        or app_private.project_has_permission_v2(p.id, p.construction_site_id::text, 'project.org.assign_staff', p_actor)
        or app_private.project_has_permission_v2(p.id, p.construction_site_id::text, 'project.material_request.approve', p_actor));
  end if;
  -- Thứ tự bảng: Kế toán (có Tài chính, không quản trị dự án) xem tiền trước; còn lại tiến độ trước.
  if v_fin and not v_da then
    v_access := array['cashflow', 'debt', 'portfolio'] || case when v_mat then array['materials'] else '{}'::text[] end;
  else
    if v_da or v_fin or cardinality(v_lead) > 0 then v_access := v_access || 'portfolio'::text; end if;
    if v_fin then v_access := v_access || 'cashflow'::text; end if;
    if v_mat or cardinality(v_lead) > 0 then v_access := v_access || 'materials'::text; end if;
    if v_fin then v_access := v_access || 'debt'::text; end if;
  end if;
  select coalesce(array_agg(p.id), '{}') into v_ids from public.projects p
  where cardinality(v_access) > 0 and app_private.cdb_in_scope(p.id, p.status, p.is_hidden)
    and (v_fin or v_da or v_mat or p.id = any(v_lead));
  return query select v_access, v_ids, v_admin;
end $$;
revoke all on function app_private.cdb_actor_scope(uuid) from public, anon, authenticated;

create or replace function public.get_center_dashboard_v1(p_access_only boolean default false)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_m0 date := (date_trunc('month', (now() at time zone 'Asia/Ho_Chi_Minh')::date) - interval '11 months')::date;
  v_admin boolean; v_ids text[]; v_access text[];
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'DASHBOARD_DENIED'; end if;
  select s.access, s.ids, s.admin into v_access, v_ids, v_admin from app_private.cdb_actor_scope(v_actor) s;
  if cardinality(v_access) = 0 or coalesce(p_access_only, false) then
    return jsonb_build_object('generatedAt', now(), 'today', v_today, 'access', to_jsonb(v_access), 'projects', '[]'::jsonb,
      'months', '[]'::jsonb, 'materialItems', '[]'::jsonb, 'stockItems', '[]'::jsonb);
  end if;

  return (
    with sc as materialized (
      select p.*, (v_admin or app_private.finance_project_visible(p.id)) fin, 'materials' = any(v_access) mat
      from public.projects p where p.id = any(v_ids)
    ),
    -- Tiến độ kế hoạch hôm nay: việc lá, trọng số như tiến độ thực tế (finance_project_gantt_progress); kế hoạch theo baseline,
    -- việc chưa chốt baseline dùng ngày kế hoạch hiện tại.
    tk as (
      select t.project_id, t.is_milestone, t.duration, t.estimated_cost_per_day, t.resource_count,
        app_private.procurement_date_or_null(t.baseline_start) bs, app_private.procurement_date_or_null(t.baseline_end) be,
        app_private.procurement_date_or_null(t.start_date) ts, app_private.procurement_date_or_null(t.end_date) te
      from public.project_tasks t join sc on sc.id = t.project_id
      where not exists (select 1 from public.project_tasks c where c.parent_id = t.id)
    ),
    tw as (
      select tk.*, coalesce(tk.bs, tk.ts) ps, coalesce(tk.be, tk.te) pe,
        case when coalesce(tk.estimated_cost_per_day, 0) * d.dur > 0 then tk.estimated_cost_per_day * d.dur
          else d.dur * greatest(1, coalesce(tk.resource_count, 1)) end wt
      from tk cross join lateral (select case when coalesce(tk.is_milestone, false) then 1 when coalesce(tk.duration, 0) > 0 then tk.duration
        else greatest(1, coalesce(tk.te - tk.ts, 1)) end dur) d
    ),
    sched as (
      select tw.project_id, count(*) n, count(*) filter (where tw.bs is not null and tw.be is not null) nb,
        min(coalesce(tw.ts, tw.bs)) first_day, max(coalesce(tw.te, tw.be)) last_day,
        round(100 * sum(tw.wt * case when v_today < tw.ps then 0 when v_today >= tw.pe then 1
            else (v_today - tw.ps + 1)::numeric / greatest(tw.pe - tw.ps + 1, 1) end) filter (where tw.ps is not null and tw.pe is not null)
          / nullif(sum(tw.wt) filter (where tw.ps is not null and tw.pe is not null), 0)) planned
      from tw group by tw.project_id
    ),
    -- Phải thu theo dự án của HĐ CĐT.
    rr as materialized (
      select x.*, c.project_id pid, r.net_amount
      from app_private.finance_receivable_round_rows() x
      join public.customer_contracts c on c.id = x.contract_id
      join public.finance_receivable_rounds r on r.id = x.id
      join sc on sc.id = c.project_id and sc.fin
    ),
    arx as (
      select rr.pid,
        coalesce(sum(rr.gross) filter (where rr.status in ('sent', 'confirmed') and rr.kind in ('progress', 'settlement', 'other')), 0) requested,
        coalesce(sum(rr.received), 0) received,
        coalesce(sum(rr.outstanding), 0) outstanding,
        coalesce(sum(rr.outstanding) filter (where rr.due_date < v_today), 0) overdue,
        count(*) filter (where rr.outstanding > 0.5 and rr.due_date is null) no_due,
        count(*) filter (where rr.status in ('sent', 'confirmed')) n,
        coalesce(sum(rr.net_amount) filter (where k.rv), 0) accepted,
        coalesce(sum(k.f * rr.received) filter (where k.rv), 0) f_paid,
        coalesce(sum(k.f * rr.outstanding) filter (where k.rv), 0) f_out,
        coalesce(sum(k.f * rr.retention) filter (where k.rv), 0) f_ret,
        coalesce(sum(k.f * rr.advance_recovery) filter (where k.rv), 0) f_rec
      from rr cross join lateral (select case when rr.gross > 0 then rr.net_amount / rr.gross else 0 end f,
        rr.status = 'confirmed' and rr.kind in ('progress', 'settlement', 'other') rv) k
      group by rr.pid
    ),
    cm as (
      select c.project_id, sum(coalesce(c.value, 0)) value,
        coalesce(sum((m.x->>'retentionHeld')::numeric), 0) ret, coalesce(sum((m.x->>'advanceRemaining')::numeric), 0) adv,
        coalesce(sum((m.x->>'advanceRecovered')::numeric), 0) rec
      from public.customer_contracts c join sc on sc.id = c.project_id and sc.fin
      cross join lateral (select app_private.finance_customer_contract_metrics(c.id) x) m
      where coalesce(c.status, '') not in ('cancelled', 'draft')
      group by c.project_id
    ),
    var as (
      select v.project_id, sum(coalesce(v.total_amount_delta, 0)) v
      from public.contract_variations v join sc on sc.id = v.project_id and sc.fin
      where v.contract_type = 'customer' and v.status = 'approved' group by v.project_id
    ),
    -- Phải trả: chứng từ công nợ (không tính đối tác nội bộ); có subcontract_id = thầu phụ, còn lại = NCC.
    pay as (
      select x.project_id, x.source_type, x.recognized - x.credit total, x.paid, x.outstanding, x.due_date, d.subcontract_id is not null sub
      from app_private.finance_payable_rows() x
      join public.supplier_payable_documents d on d.id = x.id
      join sc on sc.id = x.project_id and sc.fin
      where not x.internal
    ),
    apx as (
      select pay.project_id, sum(pay.total) requested, sum(pay.paid) paid, sum(pay.outstanding) outstanding,
        coalesce(sum(pay.outstanding) filter (where pay.due_date < v_today), 0) overdue,
        coalesce(sum(pay.outstanding) filter (where pay.source_type = 'subcontract_retention'), 0) ret,
        count(*) filter (where pay.outstanding > 0.5 and pay.due_date is null) no_due, count(*) n,
        coalesce(sum(pay.total) filter (where pay.sub), 0) sub_total, coalesce(sum(pay.paid) filter (where pay.sub), 0) sub_paid,
        coalesce(sum(pay.total) filter (where not pay.sub), 0) sup_total, coalesce(sum(pay.paid) filter (where not pay.sub), 0) sup_paid
      from pay group by pay.project_id
    ),
    -- Số chứng từ: phân biệt "chưa nhập" (hiện Chưa có dữ liệu) với số 0 thật.
    cash as (
      select t.project_id, count(*) filter (where t.type = 'revenue_received') receipts,
        count(*) filter (where t.type = 'expense' and t.source_ref like 'supplier_payment_batch:%') payments
      from public.project_transactions t join sc on sc.id = t.project_id and sc.fin
      where t.type in ('expense', 'revenue_received') group by t.project_id
    ),
    adv as (
      select a.project_id, sum(a.remaining) v from app_private.finance_advance_rows() a join sc on sc.id = a.project_id and sc.fin
      where a.status = 'paid' group by a.project_id
    ),
    tx as (
      select t.project_id,
        case when t.category in ('materials', 'labor', 'machinery', 'subcontract', 'overhead', 'other') then t.category else 'other' end category,
        sum(t.amount) v
      from public.project_transactions t join sc on sc.id = t.project_id and sc.fin
      where t.type = 'expense' and coalesce(t.source_ref, '') not like 'supplier_payment_batch:%'
      group by 1, 2
    ),
    -- Vật tư: dự toán vật tư, đơn mua đã chốt (giá trị chưa VAT), sổ kho nhập / xuất theo dự án.
    mb as (
      select m.project_id, nullif(sum(coalesce(m.budget_total, 0)), 0) budget, count(*) n,
        count(*) filter (where coalesce(m.budget_total, 0) <= 0) unpriced
      from public.material_budget_items m join sc on sc.id = m.project_id and sc.mat group by m.project_id
    ),
    po as (
      select o.project_id, sum(coalesce(o.total_amount, 0)) v
      from public.purchase_orders o join sc on sc.id = o.project_id and sc.mat
      where o.archived_at is null
        and (o.status in ('confirmed', 'in_transit', 'partial', 'delivered', 'closed') or (o.status = 'sent' and not app_private.procurement_po_is_hub(o.metadata)))
      group by o.project_id
    ),
    -- Dòng sổ kho chưa có giá trị: ước tính = số lượng × đơn giá (dòng sổ → dự toán vật tư của dự án → giá nhập danh mục); est = phần ước tính.
    led as materialized (
      select l.project_id, (l.transaction_date at time zone 'Asia/Ho_Chi_Minh')::date d, l.movement_direction dir,
        case when abs(coalesce(l.amount, 0)) > 0 then abs(l.amount) else coalesce(e.v, 0) end v,
        case when abs(coalesce(l.amount, 0)) > 0 then 0 else coalesce(e.v, 0) end est
      from public.inventory_ledger_entries l join sc on sc.id = l.project_id and sc.mat
      left join lateral (select round(abs(coalesce(l.quantity_in, 0) + coalesce(l.quantity_out, 0)) * coalesce(nullif(l.unit_price, 0),
          (select avg(m.budget_unit_price) from public.material_budget_items m
            where m.project_id = l.project_id and m.inventory_item_id = l.material_id and m.budget_unit_price > 0),
          (select nullif(i.price_in, 0) from public.items i where i.id = l.material_id)), 2) v
        where abs(coalesce(l.amount, 0)) = 0) e on true
    ),
    ledx as (
      select led.project_id, coalesce(sum(led.v) filter (where led.dir = 'in'), 0) imp, coalesce(sum(led.v) filter (where led.dir = 'out'), 0) exp,
        coalesce(sum(led.est), 0) est
      from led group by led.project_id
    ),
    -- 12 tháng gần nhất: doanh thu nghiệm thu, chi phí ghi nhận, tiền CĐT trả, tiền đã chi NCC / thầu phụ, nhập / xuất kho.
    mon as (
      select u.project_id, u.mon, sum(u.revenue) revenue, sum(u.cost) cost, sum(u.cash_in) cash_in, sum(u.cash_out) cash_out,
        sum(u.mat_in) mat_in, sum(u.mat_out) mat_out
      from (
        select c.project_id, date_trunc('month', coalesce(r.confirmed_date, r.legacy_received_date, r.sent_date, r.created_at::date))::date mon,
          r.net_amount revenue, 0::numeric cost, 0::numeric cash_in, 0::numeric cash_out, 0::numeric mat_in, 0::numeric mat_out
        from public.finance_receivable_rounds r join public.customer_contracts c on c.id = r.contract_id join sc on sc.id = c.project_id and sc.fin
        where r.status = 'confirmed' and r.kind in ('progress', 'settlement', 'other')
        union all
        select t.project_id, date_trunc('month', left(t.date, 10)::date)::date, 0,
          case when t.type = 'expense' and coalesce(t.source_ref, '') not like 'supplier_payment_batch:%' then t.amount else 0 end,
          case when t.type = 'revenue_received' then t.amount else 0 end,
          case when t.type = 'expense' and t.source_ref like 'supplier_payment_batch:%' then t.amount else 0 end, 0, 0
        from public.project_transactions t join sc on sc.id = t.project_id and sc.fin
        where t.type in ('expense', 'revenue_received') and t.date ~ '^\d{4}-\d{2}-\d{2}' and left(t.date, 10) >= to_char(v_m0, 'YYYY-MM-DD')
        union all
        select led.project_id, date_trunc('month', led.d)::date, 0, 0, 0, 0,
          case when led.dir = 'in' then led.v else 0 end, case when led.dir = 'out' then led.v else 0 end
        from led where led.d >= v_m0
      ) u
      where u.mon >= v_m0 and u.mon <= v_today
      group by u.project_id, u.mon
    ),
    items as (
      select z.* from (
        select m.id, m.project_id, m.item_name, m.unit, coalesce(m.budget_total, 0) budget,
          round(coalesce(m.cumulative_imported, 0) * coalesce(m.budget_unit_price, 0), 2) purchased,
          row_number() over (partition by m.project_id order by m.budget_total desc nulls last, m.id) rn
        from public.material_budget_items m join sc on sc.id = m.project_id and sc.mat
        where coalesce(m.budget_total, 0) > 0
      ) z where z.rn <= 10
    ),
    -- Tồn / nhập / xuất theo vật tư (chủ SP 10/10), cùng đơn vị kho. Khóa = mã vật tư danh mục (items.id); dòng dự toán chưa gắn
    -- danh mục tìm theo mã (sku), không có thì theo tên.
    --   Đã đặt chưa giao = phần dòng đơn mua chưa nhận, chưa lên đợt giao (procurement_po_line_undelivered, quy đổi đơn vị kho).
    --   Đang giao = dòng đợt giao chưa nhận xong (procurement_po_open_delivery_statuses).
    --   Nhập = vào kho dự án, trừ hàng công trường trả về kho. Xuất = ra khỏi kho dự án, trừ phiếu trả nhà cung cấp.
    --   Trả lại = trả nhà cung cấp (phiếu trả đã hoàn tất). Tồn kho = sổ kho (vào − ra, gồm hàng công trường trả về).
    --   Còn lại = BOQ − (nhập + đang giao + đã đặt chưa giao − trả lại): dương = còn được mua, âm = đã đặt / mua vượt BOQ.
    boq as (
      select m.project_id, coalesce(m.inventory_item_id, i.id, 'name:' || lower(btrim(m.item_name))) mkey,
        sum(coalesce(m.budget_qty, 0)) qty, max(m.item_name) name, max(m.material_code) code, max(m.unit) unit
      from public.material_budget_items m join sc on sc.id = m.project_id and sc.mat
      left join lateral (select x.id from public.items x where m.inventory_item_id is null and nullif(btrim(m.material_code), '') is not null
        and x.sku = btrim(m.material_code) limit 1) i on true
      group by 1, 2
    ),
    sret_tx as (select r.transaction_id from public.purchase_order_supplier_returns r join sc on sc.id = r.project_id and sc.mat),
    mv as (
      select l.project_id, l.material_id mkey,
        coalesce(sum(l.quantity_in) filter (where coalesce(l.business_event_type, '') <> 'project_return_receipt'), 0) imp,
        coalesce(sum(l.quantity_out) filter (where not (l.source_type = 'wms_transaction' and l.source_id in (select transaction_id from sret_tx))), 0) exp,
        coalesce(sum(l.quantity_in), 0) - coalesce(sum(l.quantity_out), 0) stock, max(l.unit) unit
      from public.inventory_ledger_entries l join sc on sc.id = l.project_id and sc.mat
      where l.material_id is not null
      group by 1, 2
    ),
    pol as (
      select o.id po_id, o.project_id, o.items, coalesce(x.value->>'lineId', x.value->>'itemId') line_id, x.value->>'itemId' mkey,
        case when coalesce(nullif(x.value->>'qty', '')::numeric, 0) > 0
          then app_private.procurement_po_line_stock_qty(x.value) / nullif(x.value->>'qty', '')::numeric else 1 end factor
      from public.purchase_orders o join sc on sc.id = o.project_id and sc.mat
      cross join lateral jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) x
      where o.archived_at is null and x.value->>'itemId' is not null
        and (o.status in ('confirmed', 'in_transit', 'partial') or (o.status = 'sent' and not app_private.procurement_po_is_hub(o.metadata)))
    ),
    ord as (
      select pol.project_id, pol.mkey, sum(app_private.procurement_po_line_undelivered(pol.po_id, pol.items, pol.line_id) * pol.factor) qty
      from pol group by 1, 2
    ),
    trn as (
      select b.project_id, dl.item_id mkey, sum(coalesce(nullif(dl.stock_planned_qty, 0), dl.planned_qty)) qty
      from public.purchase_order_delivery_lines dl
      join public.purchase_order_delivery_batches b on b.id = dl.delivery_batch_id
      join public.purchase_orders o on o.id = b.purchase_order_id and o.archived_at is null
      join sc on sc.id = b.project_id and sc.mat
      where b.status = any (app_private.procurement_po_open_delivery_statuses()) and dl.item_id is not null
      group by 1, 2
    ),
    sret as (
      select r.project_id, rl.item_id mkey, sum(coalesce(nullif(rl.stock_return_qty, 0), rl.return_qty)) qty
      from public.purchase_order_supplier_return_lines rl
      join public.purchase_order_supplier_returns r on r.id = rl.supplier_return_id and r.status = 'completed'
      join sc on sc.id = r.project_id and sc.mat
      where rl.item_id is not null group by 1, 2
    ),
    keys as (
      select project_id, mkey from boq union select project_id, mkey from mv union select project_id, mkey from ord where qty > 0
      union select project_id, mkey from trn union select project_id, mkey from sret
    ),
    stock as (
      select k.project_id, k.mkey, b.qty boq, coalesce(o.qty, 0) ordered, coalesce(t.qty, 0) transit, coalesce(v.imp, 0) imp, coalesce(v.exp, 0) exp,
        coalesce(r.qty, 0) ret, coalesce(v.stock, 0) onhand,
        coalesce(i.name, b.name, 'Vật tư') name, coalesce(nullif(i.sku, ''), b.code) code, coalesce(i.unit, b.unit, v.unit, '') unit, i.id item_id
      from keys k
      left join boq b on b.project_id = k.project_id and b.mkey = k.mkey
      left join mv v on v.project_id = k.project_id and v.mkey = k.mkey
      left join ord o on o.project_id = k.project_id and o.mkey = k.mkey
      left join trn t on t.project_id = k.project_id and t.mkey = k.mkey
      left join sret r on r.project_id = k.project_id and r.mkey = k.mkey
      left join public.items i on i.id = k.mkey
    )
    select jsonb_build_object(
      'generatedAt', now(), 'today', v_today, 'access', to_jsonb(v_access),
      'projects', coalesce((select jsonb_agg(jsonb_build_object(
          'id', sc.id, 'code', sc.code, 'name', sc.name, 'status', sc.status, 'createdAt', sc.created_at, 'director', u.name,
          'site', case when s.id is not null then jsonb_build_object('name', s.name, 'address', s.address, 'lat', s.latitude, 'lng', s.longitude) end,
          'start', coalesce(sc.start_date, sd.first_day), 'end', coalesce(sc.end_date, sd.last_day),
          'plannedProgress', sd.planned, 'actualProgress', g.actual, 'updatedAt', now(),
          'finance', case when sc.fin then jsonb_build_object(
            'contractValue', case when coalesce(cm.value, 0) + coalesce(va.v, 0) > 0 then coalesce(cm.value, 0) + coalesce(va.v, 0) end,
            'variation', coalesce(va.v, 0),
            'budget', (cs.x->>'budget')::numeric,
            'output', case when g.actual is not null and coalesce(cm.value, 0) + coalesce(va.v, 0) > 0
              then round((coalesce(cm.value, 0) + coalesce(va.v, 0)) * g.actual / 100, 2) end,
            'accepted', coalesce(ar.accepted, 0), 'received', coalesce(ar.received, 0), 'cost', coalesce((cs.x->>'actual')::numeric, 0),
            'costByCategory', coalesce((select jsonb_object_agg(tx.category, tx.v) from tx where tx.project_id = sc.id), '{}'::jsonb),
            'ar', jsonb_build_object('requested', coalesce(ar.requested, 0), 'retention', coalesce(cm.ret, 0), 'advance', coalesce(cm.adv, 0),
              'advanceRecovered', coalesce(cm.rec, 0), 'outstanding', coalesce(ar.outstanding, 0), 'overdue', coalesce(ar.overdue, 0),
              'flow', jsonb_build_object('paid', round(coalesce(ar.f_paid, 0), 2), 'outstanding', round(coalesce(ar.f_out, 0), 2),
                'retention', round(coalesce(ar.f_ret, 0), 2), 'recovered', round(coalesce(ar.f_rec, 0), 2))),
            'ap', jsonb_build_object('requested', coalesce(ap.requested, 0), 'retention', coalesce(ap.ret, 0), 'advance', coalesce(ad.v, 0),
              'outstanding', coalesce(ap.outstanding, 0), 'overdue', coalesce(ap.overdue, 0), 'paid', coalesce(ap.paid, 0),
              'subcontract', jsonb_build_object('total', coalesce(ap.sub_total, 0), 'paid', coalesce(ap.sub_paid, 0)),
              'supplier', jsonb_build_object('total', coalesce(ap.sup_total, 0), 'paid', coalesce(ap.sup_paid, 0))),
            'records', jsonb_build_object('arRounds', coalesce(ar.n, 0), 'apDocs', coalesce(ap.n, 0),
              'receipts', coalesce(ch.receipts, 0), 'payments', coalesce(ch.payments, 0))) end,
          'materials', case when sc.mat then jsonb_build_object('budget', mb.budget, 'purchased', coalesce(po.v, 0),
            'imported', coalesce(lx.imp, 0), 'exported', coalesce(lx.exp, 0), 'estimated', coalesce(lx.est, 0)) end,
          'gaps', to_jsonb(array_remove(array[
            case when coalesce(sc.start_date, sd.first_day) is null or coalesce(sc.end_date, sd.last_day) is null then 'dates' end,
            case when sd.n is null then 'gantt' end,
            case when sd.n > 0 and sd.nb < sd.n then 'baseline' end,
            case when s.latitude is null or s.longitude is null then 'coords' end,
            case when u.name is null then 'director' end,
            case when sc.fin and coalesce(cm.value, 0) + coalesce(va.v, 0) <= 0 then 'contract' end,
            case when sc.fin and (cs.x->>'budget') is null then 'budget' end,
            case when sc.fin and coalesce((cs.x->>'unclassified')::numeric, 0) > 0.5 then 'unclassified' end,
            case when sc.fin and coalesce(ar.no_due, 0) > 0 then 'ar_due' end,
            case when sc.fin and coalesce(ap.no_due, 0) > 0 then 'ap_due' end,
            case when sc.mat and mb.project_id is null then 'material_budget' end,
            case when sc.mat and coalesce(mb.unpriced, 0) > 0 then 'material_price' end], null))
        ) order by sc.code)
        from sc
        left join public.users u on u.id::text = sc.manager_id
        left join public.hrm_construction_sites s on s.id = sc.construction_site_id
        left join sched sd on sd.project_id = sc.id
        cross join lateral (select app_private.finance_project_gantt_progress(sc.id) actual) g
        left join lateral (select app_private.finance_project_cost_summary(sc.id) x where sc.fin) cs on true
        left join arx ar on ar.pid = sc.id
        left join cm on cm.project_id = sc.id
        left join var va on va.project_id = sc.id
        left join apx ap on ap.project_id = sc.id
        left join adv ad on ad.project_id = sc.id
        left join cash ch on ch.project_id = sc.id
        left join mb on mb.project_id = sc.id
        left join po on po.project_id = sc.id
        left join ledx lx on lx.project_id = sc.id), '[]'::jsonb),
      'months', coalesce((select jsonb_agg(jsonb_build_object('month', to_char(mon.mon, 'YYYY-MM'), 'projectId', mon.project_id,
          'revenue', mon.revenue, 'cost', mon.cost, 'cashIn', mon.cash_in, 'cashOut', mon.cash_out, 'matIn', mon.mat_in, 'matOut', mon.mat_out)
          order by mon.project_id, mon.mon) from mon), '[]'::jsonb),
      'materialItems', coalesce((select jsonb_agg(jsonb_build_object('id', items.id, 'projectId', items.project_id, 'name', items.item_name,
          'unit', coalesce(items.unit, ''), 'budget', items.budget, 'purchased', items.purchased) order by items.budget desc) from items), '[]'::jsonb),
      'stockItems', coalesce((select jsonb_agg(jsonb_build_object('projectId', stock.project_id, 'key', stock.mkey, 'itemId', stock.item_id,
          'name', stock.name, 'code', stock.code, 'unit', stock.unit, 'boq', stock.boq, 'ordered', round(stock.ordered, 3), 'transit', round(stock.transit, 3),
          'imported', stock.imp, 'exported', stock.exp, 'returned', stock.ret, 'stock', stock.onhand)
          order by stock.name) from stock), '[]'::jsonb)
    ));
end $$;

-- Chứng từ tạo nên một số trên bảng tồn / nhập / xuất (bấm vào số): p_kind = ordered (dòng đơn mua chưa giao) | transit (dòng đợt giao
-- chưa nhận xong) | in (nhập kho, không gồm hàng công trường trả về) | out (xuất kho, không gồm trả NCC) | return (trả nhà cung cấp)
-- | ledger (mọi dòng sổ kho, vào dương / ra âm — cộng lại = Tồn kho).
-- Mỗi dòng có mã phiếu kho (transactionId → Phiếu kho) hoặc mã đơn mua (poId → Mua hàng) để mở đúng chứng từ.
-- p_project_id null = mọi dự án người dùng xem được trên bảng Vật tư. Tối đa 500 dòng, mới nhất trước.
create function public.get_center_material_moves_v1(p_material_key text, p_kind text, p_project_id text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_access text[]; v_ids text[]; v_admin boolean; v_rows jsonb;
begin
  select s.access, s.ids, s.admin into v_access, v_ids, v_admin from app_private.cdb_actor_scope(public.current_app_user_id()) s;
  if not ('materials' = any(v_access)) then raise exception using errcode = '42501', message = 'DASHBOARD_DENIED'; end if;
  if p_kind not in ('ordered', 'transit', 'in', 'out', 'return', 'ledger') or nullif(btrim(p_material_key), '') is null then
    raise exception using errcode = '22023', message = 'DASHBOARD_MOVES_INVALID'; end if;
  if p_project_id is not null and not (p_project_id = any(v_ids)) then raise exception using errcode = '42501', message = 'DASHBOARD_DENIED'; end if;
  if p_project_id is not null then v_ids := array[p_project_id]; end if;

  if p_kind in ('in', 'out', 'ledger') then
    select jsonb_agg(z.o order by z.at desc, z.no desc) into v_rows from (
      select l.transaction_date at, l.entry_no no, jsonb_build_object('id', l.id::text, 'date', l.transaction_date,
          'code', coalesce(nullif(l.document_code, ''), nullif(l.source_code, ''), '—'), 'event', coalesce(l.business_event_type, l.transaction_type),
          'warehouse', w.name, 'projectId', l.project_id, 'projectCode', p.code, 'unit', l.unit,
          'qty', case when p_kind = 'out' then l.quantity_out when p_kind = 'ledger' then coalesce(l.quantity_in, 0) - coalesce(l.quantity_out, 0) else l.quantity_in end,
          'transactionId', case when l.source_type = 'wms_transaction' then l.source_id end) o
      from public.inventory_ledger_entries l
      join public.projects p on p.id = l.project_id
      left join public.warehouses w on w.id = l.warehouse_id
      where l.material_id = p_material_key and l.project_id = any(v_ids)
        and case when p_kind = 'ledger' then true
          when p_kind = 'out'
          then coalesce(l.quantity_out, 0) > 0 and not (l.source_type = 'wms_transaction' and exists (select 1 from public.purchase_order_supplier_returns r
            where r.transaction_id = l.source_id))
          else coalesce(l.quantity_in, 0) > 0 and coalesce(l.business_event_type, '') <> 'project_return_receipt' end
      order by l.transaction_date desc, l.entry_no desc limit 500) z;
  elsif p_kind = 'return' then
    select jsonb_agg(z.o order by z.at desc) into v_rows from (
      select coalesce(r.completed_at, r.created_at) at, jsonb_build_object('id', rl.id::text, 'date', coalesce(r.completed_at, r.created_at),
          'code', r.return_no, 'event', 'Trả nhà cung cấp', 'partner', o.vendor_name, 'warehouse', w.name, 'projectId', r.project_id, 'projectCode', p.code,
          'unit', coalesce(rl.stock_unit, rl.unit), 'qty', coalesce(nullif(rl.stock_return_qty, 0), rl.return_qty),
          'transactionId', r.transaction_id, 'poId', r.purchase_order_id, 'poNumber', o.po_number) o
      from public.purchase_order_supplier_return_lines rl
      join public.purchase_order_supplier_returns r on r.id = rl.supplier_return_id and r.status = 'completed'
      join public.projects p on p.id = r.project_id
      left join public.purchase_orders o on o.id = r.purchase_order_id
      left join public.warehouses w on w.id = r.source_warehouse_id
      where rl.item_id = p_material_key and r.project_id = any(v_ids)
      order by 1 desc limit 500) z;
  elsif p_kind = 'transit' then
    select jsonb_agg(z.o order by z.at desc nulls last) into v_rows from (
      select b.planned_delivery_date at, jsonb_build_object('id', dl.id::text, 'date', b.planned_delivery_date,
          'code', coalesce(o.po_number, o.id) || ' · đợt ' || coalesce(b.delivery_no::text, '?'), 'event', b.status, 'partner', coalesce(b.supplier_name_snapshot, o.vendor_name),
          'projectId', b.project_id, 'projectCode', p.code, 'unit', coalesce(dl.stock_unit, dl.unit),
          'qty', coalesce(nullif(dl.stock_planned_qty, 0), dl.planned_qty), 'poId', o.id, 'poNumber', o.po_number) o
      from public.purchase_order_delivery_lines dl
      join public.purchase_order_delivery_batches b on b.id = dl.delivery_batch_id
      join public.purchase_orders o on o.id = b.purchase_order_id and o.archived_at is null
      join public.projects p on p.id = b.project_id
      where dl.item_id = p_material_key and b.project_id = any(v_ids) and b.status = any (app_private.procurement_po_open_delivery_statuses())
      order by 1 desc nulls last limit 500) z;
  else
    select jsonb_agg(z.o order by z.at desc nulls last) into v_rows from (
      select app_private.procurement_date_or_null(o.order_date) at, jsonb_build_object('id', o.id || ':' || coalesce(x.value->>'lineId', x.value->>'itemId'),
          'date', app_private.procurement_date_or_null(o.order_date), 'code', coalesce(o.po_number, o.id), 'event', o.status, 'partner', o.vendor_name,
          'projectId', o.project_id, 'projectCode', p.code, 'unit', coalesce(x.value->>'stockUnitSnapshot', x.value->>'unit'),
          'qty', round(u.qty * case when coalesce(nullif(x.value->>'qty', '')::numeric, 0) > 0
            then app_private.procurement_po_line_stock_qty(x.value) / nullif(x.value->>'qty', '')::numeric else 1 end, 3),
          'expected', app_private.procurement_date_or_null(o.expected_delivery_date), 'poId', o.id, 'poNumber', o.po_number) o
      from public.purchase_orders o
      join public.projects p on p.id = o.project_id
      cross join lateral jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) x
      cross join lateral (select app_private.procurement_po_line_undelivered(o.id, o.items, coalesce(x.value->>'lineId', x.value->>'itemId')) qty) u
      where x.value->>'itemId' = p_material_key and o.project_id = any(v_ids) and o.archived_at is null and u.qty > 0
        and (o.status in ('confirmed', 'in_transit', 'partial') or (o.status = 'sent' and not app_private.procurement_po_is_hub(o.metadata)))
      order by 1 desc nulls last limit 500) z;
  end if;
  return jsonb_build_object('rows', coalesce(v_rows, '[]'::jsonb));
end $$;

revoke all on function public.get_center_dashboard_v1(boolean) from public, anon;
grant execute on function public.get_center_dashboard_v1(boolean) to authenticated;
revoke all on function public.get_center_material_moves_v1(text, text, text) from public, anon;
grant execute on function public.get_center_material_moves_v1(text, text, text) to authenticated;

notify pgrst, 'reload schema';
