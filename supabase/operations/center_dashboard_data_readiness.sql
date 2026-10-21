-- Độ đủ dữ liệu cho Bảng điều khiển (chỉ đọc, chỉ đếm — không lấy tên người, không lấy chứng từ).
-- Cùng phạm vi và cùng quy tắc "thiếu dữ liệu" (gaps) với get_center_dashboard_v1.
-- Chạy: npx supabase db query --linked --agent=no --file supabase/operations/center_dashboard_data_readiness.sql
with p as (
  -- Như app_private.cdb_in_scope: lập kế hoạch chỉ khi đã có HĐ CĐT, Gantt hoặc chi phí.
  select p.* from public.projects p where not coalesce(p.is_hidden, false) and (coalesce(p.status, '') in ('active', 'paused', 'completed')
    or (coalesce(p.status, '') = 'planning' and (
      exists (select 1 from public.customer_contracts c where c.project_id = p.id and coalesce(c.status, '') not in ('cancelled', 'draft'))
      or exists (select 1 from public.project_tasks t where t.project_id = p.id)
      or exists (select 1 from public.project_transactions t where t.project_id = p.id and t.type = 'expense'))))
), leaf as (
  select t.project_id,
    app_private.procurement_date_or_null(t.baseline_start) bs, app_private.procurement_date_or_null(t.baseline_end) be,
    app_private.procurement_date_or_null(t.start_date) ts, app_private.procurement_date_or_null(t.end_date) te, coalesce(t.progress, 0) pr
  from public.project_tasks t join p on p.id = t.project_id
  where not exists (select 1 from public.project_tasks c where c.parent_id = t.id)
), sd as (
  select project_id, count(*) n, count(*) filter (where bs is not null and be is not null) nb, count(*) filter (where pr > 0) started,
    min(coalesce(ts, bs)) first_day, max(coalesce(te, be)) last_day
  from leaf group by project_id
), cm as (
  select c.project_id, sum(coalesce(c.value, 0)) v from public.customer_contracts c join p on p.id = c.project_id
  where coalesce(c.status, '') not in ('cancelled', 'draft') group by c.project_id
), va as (
  select v.project_id, sum(coalesce(v.total_amount_delta, 0)) v from public.contract_variations v join p on p.id = v.project_id
  where v.contract_type = 'customer' and v.status = 'approved' group by v.project_id
), cs as (
  select p.id, app_private.finance_project_cost_summary(p.id) x from p
), ar as (
  select c.project_id, count(*) filter (where x.outstanding > 0.5 and x.due_date is null) no_due, count(*) filter (where x.outstanding > 0.5) open_rounds,
    count(*) filter (where x.status = 'confirmed' and x.kind in ('progress', 'settlement', 'other')) accepted_rounds
  from app_private.finance_receivable_round_rows() x join public.customer_contracts c on c.id = x.contract_id join p on p.id = c.project_id
  group by c.project_id
), ap as (
  select x.project_id, count(*) filter (where x.outstanding > 0.5 and x.due_date is null) no_due, count(*) filter (where x.outstanding > 0.5) open_docs
  from app_private.finance_payable_rows() x join p on p.id = x.project_id where not x.internal group by x.project_id
), mb as (
  select m.project_id, count(*) n, count(*) filter (where coalesce(m.budget_total, 0) <= 0) unpriced
  from public.material_budget_items m join p on p.id = m.project_id group by m.project_id
), tx as (
  select t.project_id, count(*) filter (where t.type = 'expense' and coalesce(t.source_ref, '') not like 'supplier_payment_batch:%') cost_rows,
    count(*) filter (where t.type = 'expense' and coalesce(t.source_ref, '') not like 'supplier_payment_batch:%'
      and coalesce(t.category, '') not in ('materials', 'labor', 'machinery', 'subcontract', 'overhead')) other_rows,
    count(*) filter (where t.type = 'revenue_received') in_rows,
    count(*) filter (where t.type = 'expense' and t.source_ref like 'supplier_payment_batch:%') pay_rows,
    count(distinct left(t.date, 7)) filter (where t.date ~ '^\d{4}-\d{2}' and left(t.date, 10) >= to_char(current_date - interval '12 months', 'YYYY-MM-DD')) months_12
  from public.project_transactions t join p on p.id = t.project_id group by t.project_id
), led as (
  select l.project_id, count(*) n, count(*) filter (where coalesce(l.amount, 0) = 0) no_amount
  from public.inventory_ledger_entries l join p on p.id = l.project_id group by l.project_id
), g as (
  select p.id,
    coalesce(p.start_date, sd.first_day) is null or coalesce(p.end_date, sd.last_day) is null gap_dates,
    sd.n is null gap_gantt,
    coalesce(sd.n, 0) > 0 and sd.nb < sd.n gap_baseline,
    s.latitude is null or s.longitude is null gap_coords,
    u.id is null gap_director,
    coalesce(cm.v, 0) + coalesce(va.v, 0) <= 0 gap_contract,
    (cs.x ->> 'budget') is null gap_budget,
    coalesce((cs.x ->> 'unclassified')::numeric, 0) > 0.5 gap_unclassified,
    coalesce(ar.no_due, 0) > 0 gap_ar_due,
    coalesce(ap.no_due, 0) > 0 gap_ap_due,
    mb.project_id is null gap_material_budget,
    coalesce(mb.unpriced, 0) > 0 gap_material_price
  from p
  left join public.hrm_construction_sites s on s.id = p.construction_site_id
  left join public.users u on u.id::text = p.manager_id
  left join sd on sd.project_id = p.id left join cm on cm.project_id = p.id left join va on va.project_id = p.id
  left join cs on cs.id = p.id left join ar on ar.project_id = p.id left join ap on ap.project_id = p.id left join mb on mb.project_id = p.id
)
select jsonb_pretty(jsonb_build_object(
  'projects', (select count(*) from p),
  'byStatus', (select jsonb_object_agg(s, n) from (select coalesce(status, '?') s, count(*) n from p group by 1) z),
  'missing', jsonb_build_object(
    'dates', (select count(*) from g where gap_dates), 'gantt', (select count(*) from g where gap_gantt),
    'baseline', (select count(*) from g where gap_baseline), 'coords', (select count(*) from g where gap_coords),
    'director', (select count(*) from g where gap_director), 'contract', (select count(*) from g where gap_contract),
    'budget', (select count(*) from g where gap_budget), 'unclassified', (select count(*) from g where gap_unclassified),
    'ar_due', (select count(*) from g where gap_ar_due), 'ap_due', (select count(*) from g where gap_ap_due),
    'material_budget', (select count(*) from g where gap_material_budget), 'material_price', (select count(*) from g where gap_material_price)),
  'projectsWithNoGap', (select count(*) from g where not (gap_dates or gap_gantt or gap_baseline or gap_coords or gap_director or gap_contract or gap_budget
    or gap_unclassified or gap_ar_due or gap_ap_due or gap_material_budget or gap_material_price)),
  'schedule', jsonb_build_object('withGantt', (select count(*) from sd), 'ganttStarted', (select count(*) from sd where started > 0),
    'leafTasks', (select coalesce(sum(n), 0) from sd), 'leafTasksWithBaseline', (select coalesce(sum(nb), 0) from sd)),
  'finance', jsonb_build_object('withContract', (select count(*) from cm where v > 0), 'withApprovedVariation', (select count(*) from va),
    'withAcceptedRounds', (select count(*) from ar where accepted_rounds > 0), 'openReceivableRounds', (select coalesce(sum(open_rounds), 0) from ar),
    'openPayableDocs', (select coalesce(sum(open_docs), 0) from ap),
    'withCostRows', (select count(*) from tx where cost_rows > 0), 'costRows', (select coalesce(sum(cost_rows), 0) from tx),
    'costRowsOtherOrNoCategory', (select coalesce(sum(other_rows), 0) from tx),
    'withRevenueReceivedRows', (select count(*) from tx where in_rows > 0), 'withSupplierPaymentRows', (select count(*) from tx where pay_rows > 0),
    'avgMonthsWithCostLast12', (select round(avg(months_12), 1) from tx where cost_rows > 0)),
  'materials', jsonb_build_object('withMaterialBudget', (select count(*) from mb), 'budgetLines', (select coalesce(sum(n), 0) from mb),
    'budgetLinesUnpriced', (select coalesce(sum(unpriced), 0) from mb),
    'withPurchaseOrders', (select count(distinct o.project_id) from public.purchase_orders o join p on p.id = o.project_id where o.archived_at is null
      and o.status in ('sent', 'confirmed', 'in_transit', 'partial', 'delivered', 'closed')),
    'withStockLedger', (select count(*) from led), 'ledgerRowsWithoutValue', (select coalesce(sum(no_amount), 0) from led),
    'openMaterialRequests', (select count(*) from public.requests q join p on p.id = q.project_id where q.status in ('PENDING', 'APPROVED', 'IN_TRANSIT'))),
  'cashLedgerSince', (select min(e.entry_date) from public.finance_cash_entries e)
));
