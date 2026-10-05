-- ===========================================================================
-- Xuất bản Module Tài chính — P1 (05/10/2026)
-- Thiết kế: docs/designs/project-closed-loop-2026-09-30/14-xuat-ban-module-tai-chinh.md (chủ SP duyệt cả 9 câu 05/10)
--
-- * Màn "Tài chính dự án" trong module Tài chính: một trang cho một dự án (tổng quan, chi phí & ngân sách, phải thu, phải trả, sổ giao dịch).
-- * Ai xem: người có Tài chính — Xem (toàn công ty) HOẶC người được bật công tắc "xem tài chính dự án" (project_sensitive_view_grants
--   domain finance — Admin bật theo từng người, từng dự án hoặc tất cả dự án; thành viên Room Thanh toán / Nghiệm thu tự được xem).
--   Không thêm quyền mới: 3 người đang có công tắc (Phạm Ngọc Sơn, Nguyễn Chấp Việt — SMB; Nguyễn Thị Mơ — mọi dự án) tự xem được.
-- * Chỉ đọc với người xem theo dự án: các nút ghi vẫn theo quyền Tài chính toàn công ty (finance_can_flags).
-- ===========================================================================

create function app_private.finance_project_visible(p_project text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_app_user_id() is not null and nullif(p_project, '') is not null
    and (app_private.finance_can('view') or app_private.sensitive_can_view('finance', p_project, null));
$$;

-- Người dùng đang xem được gì trong Tài chính (để dựng menu và danh sách dự án).
create function public.get_finance_my_scope_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_company boolean := app_private.finance_can('view'); v_all boolean := app_private.sensitive_view_all('finance');
begin
  if public.current_app_user_id() is null then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  return jsonb_build_object('companyView', v_company, 'can', app_private.finance_can_flags(),
    'projects', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name) order by p.code)
      from (select s.id, s.code, s.name from app_private.finance_cost_scope() s
        where v_company or v_all or s.id = any(app_private.sensitive_view_project_ids('finance'))) p), '[]'::jsonb));
end $$;

-- Một trang tài chính của một dự án.
create function public.get_finance_project_v1(p_project_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_p public.projects%rowtype; v_set public.finance_settings%rowtype;
begin
  select * into v_p from public.projects where id = p_project_id;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_PROJECT_NOT_FOUND'; end if;
  if not app_private.finance_project_visible(v_p.id) then raise exception using errcode = '42501', message = 'FINANCE_PROJECT_VIEW_DENIED'; end if;
  select * into v_set from public.finance_settings where id = 1;
  return jsonb_build_object('today', v_today, 'cutoverDate', v_set.ap_cutover_date, 'companyView', app_private.finance_can('view'), 'can', app_private.finance_can_flags(),
    'project', jsonb_build_object('id', v_p.id, 'code', v_p.code, 'name', v_p.name, 'status', v_p.status,
      'progress', app_private.finance_project_gantt_progress(v_p.id)),
    'cost', app_private.finance_project_cost_summary(v_p.id),
    'fund', app_private.finance_project_fund(v_p.id),
    'contracts', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name, 'customerName', c.customer_name, 'value', c.value,
        'vatPercent', coalesce(c.vat_percent, 0), 'endDate', c.end_date, 'status', c.status, 'metrics', app_private.finance_customer_contract_metrics(c.id)) order by c.code)
      from public.customer_contracts c where c.project_id = v_p.id and coalesce(c.status, '') not in ('cancelled', 'draft')), '[]'::jsonb),
    'subcontracts', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', coalesce(b.name, s.subcontractor_name), 'value', s.value,
        'status', s.status, 'metrics', app_private.finance_subcontract_metrics(s.id)) order by s.code)
      from public.subcontractor_contracts s left join public.business_partners b on b.id = s.partner_id
      where s.project_id = v_p.id and coalesce(s.status, '') not in ('draft', 'negotiating', 'cancelled')), '[]'::jsonb),
    'payables', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'code', x.code, 'documentNo', x.document_no, 'sourceType', x.source_type,
        'supplierId', x.supplier_id, 'supplierName', x.supplier_name, 'documentDate', x.document_date, 'dueDate', x.due_date, 'recognized', x.recognized,
        'paid', x.paid, 'outstanding', x.outstanding, 'pendingExternal', x.pending_external) order by x.due_date nulls last, x.document_date)
      from app_private.finance_payable_rows() x where x.project_id = v_p.id and x.outstanding > 0.5 and not x.internal), '[]'::jsonb),
    -- Theo tháng (12 tháng gần nhất): tiền CĐT trả, chi phí ghi nhận (không gồm dòng chi tiền NCC), tiền đã chi NCC.
    'months', coalesce((select jsonb_agg(jsonb_build_object('month', m.mon, 'revenue', m.revenue, 'cost', m.cost, 'paid', m.paid) order by m.mon)
      from (select left(t.date, 7) mon,
          coalesce(sum(t.amount) filter (where t.type = 'revenue_received'), 0) revenue,
          coalesce(sum(t.amount) filter (where t.type = 'expense' and coalesce(t.source_ref, '') not like 'supplier_payment_batch:%'), 0) cost,
          coalesce(sum(t.amount) filter (where t.type = 'expense' and t.source_ref like 'supplier_payment_batch:%'), 0) paid
        from public.project_transactions t where t.project_id = v_p.id and t.date >= to_char(v_today - interval '12 months', 'YYYY-MM')
        group by 1) m), '[]'::jsonb),
    'ledger', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'date', l.date, 'type', l.type, 'category', l.category, 'item', l.contract_cost_item_symbol_snapshot,
        'itemName', l.contract_cost_item_name_snapshot, 'amount', l.amount, 'description', l.description, 'counterparty', l.counterparty_name, 'source', l.source,
        'invoiceNo', l.invoice_no, 'payment', coalesce(l.source_ref, '') like 'supplier_payment_batch:%') order by l.date desc, l."createdAt" desc)
      from (select * from public.project_transactions t where t.project_id = v_p.id order by t.date desc, t."createdAt" desc limit 2000) l), '[]'::jsonb),
    'ledgerTotal', (select count(*) from public.project_transactions t where t.project_id = v_p.id));
end $$;

do $$ declare f text; begin
  foreach f in array array['public.get_finance_my_scope_v1()', 'public.get_finance_project_v1(text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  execute 'revoke all on function app_private.finance_project_visible(text) from public, anon, authenticated';
end $$;

-- Vá: chi tiết chi phí dự án, HĐ CĐT, HĐ thầu phụ đọc được cho người xem tài chính của đúng dự án đó (nút ghi vẫn theo quyền toàn công ty).
CREATE OR REPLACE FUNCTION public.get_finance_project_cost_v1(p_project_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id(); v_set public.finance_settings%rowtype; v_p public.projects%rowtype; v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  select * into v_p from public.projects where id = p_project_id;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_PROJECT_NOT_FOUND'; end if;
  if not app_private.finance_project_visible(v_p.id) then raise exception using errcode = '42501', message = 'FINANCE_PROJECT_VIEW_DENIED'; end if;
  select * into v_set from public.finance_settings where id = 1;
  return jsonb_build_object('today', v_today, 'cutoverDate', v_set.ap_cutover_date, 'warnPercent', v_set.budget_warn_percent,
    'can', app_private.finance_can_flags() || jsonb_build_object('capital', v_actor = any(v_set.capital_provider_ids)),
    'project', jsonb_build_object('id', v_p.id, 'code', v_p.code, 'name', v_p.name,
      'contractValue', (select nullif(sum(c.value), 0) from public.customer_contracts c where c.project_id = v_p.id and c.status <> 'cancelled'),
      'receivedAll', coalesce((select sum(t.amount) from public.project_transactions t where t.project_id = v_p.id and t.type = 'revenue_received'), 0))
      || app_private.finance_project_cost_summary(v_p.id),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'symbol', i.symbol, 'name', i.name, 'groupSymbol', i.group_symbol, 'groupName', i.group_name) order by i.ord)
      from app_private.finance_budget_items() i), '[]'::jsonb),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('costItemId', l.cost_item_id, 'symbol', c.symbol, 'name', c.name, 'groupSymbol', coalesce(g.symbol, c.symbol),
        'groupName', coalesce(g.name, c.name), 'budget', l.budget, 'actual', l.actual, 'autoMapped', l.auto_mapped, 'committed', l.committed,
        'budgetSource', case when l.budget is null then null when c.symbol = 'CPNVL' then 'material' else 'budget' end)
      order by coalesce(i.ord, 999), c.symbol nulls last)
      from app_private.finance_project_cost_lines(v_p.id, null) l left join public.contract_cost_items c on c.id = l.cost_item_id
      left join public.contract_cost_items g on g.id = c.parent_id left join app_private.finance_budget_items() i on i.id = l.cost_item_id), '[]'::jsonb),
    'budgets', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'versionNo', b.version_no, 'status', b.status, 'reason', b.reason,
        'materialBudget', b.material_budget, 'otherTotal', b.other_total, 'createdByName', app_private.finance_user_name(b.created_by), 'createdAt', b.created_at,
        'decidedByName', app_private.finance_user_name(b.decided_by), 'decidedAt', b.decided_at, 'decisionNote', b.decision_note, 'rowVersion', b.row_version,
        'canDecide', b.status = 'submitted' and app_private.finance_can('manage') and b.created_by is distinct from v_actor,
        'canWithdraw', b.status = 'submitted' and b.created_by = v_actor,
        'lines', coalesce((select jsonb_agg(jsonb_build_object('costItemId', l.cost_item_id, 'amount', l.amount, 'note', l.note)) from public.finance_project_budget_lines l
          where l.budget_id = b.id), '[]'::jsonb)) order by b.version_no desc)
      from public.finance_project_budgets b where b.project_id = v_p.id), '[]'::jsonb),
    'commitments', coalesce((select jsonb_agg(jsonb_build_object('poId', c.po_id, 'poNumber', c.po_number, 'vendor', c.vendor_name, 'status', c.status, 'expectedDate', c.expected_date,
        'netTotal', c.net_total, 'receivedNet', c.received_net, 'openNet', c.open_net, 'stale', c.stale, 'hub', c.hub) order by c.stale desc, c.open_net desc)
      from app_private.finance_po_commitments(v_p.id) c where c.open_net > 0.5), '[]'::jsonb),
    'fund', app_private.finance_project_fund(v_p.id) || jsonb_build_object(
      'openingRecord', (select jsonb_build_object('id', o.id, 'status', o.status, 'cutoverDate', o.cutover_date, 'receivedToDate', o.received_to_date,
          'spentToDate', o.spent_to_date, 'balance', o.balance, 'note', o.note, 'attachments', o.attachments, 'createdByName', app_private.finance_user_name(o.created_by),
          'createdAt', o.created_at, 'decidedByName', app_private.finance_user_name(o.decided_by), 'decidedAt', o.decided_at, 'decisionNote', o.decision_note,
          'canDecide', o.status = 'submitted' and app_private.finance_can('confirm') and o.created_by is distinct from v_actor,
          'canCancel', o.status = 'confirmed' and app_private.finance_can('manage'))
        from public.finance_project_fund_openings o where o.project_id = v_p.id order by o.created_at desc limit 1),
      'rows', coalesce((select jsonb_agg(jsonb_build_object('date', r.entry_date, 'kind', r.kind, 'code', r.code, 'description', r.description, 'amount', r.amount,
          'sourceType', r.source_type, 'reversal', r.reversal) order by r.entry_date desc, r.code)
        from app_private.finance_project_fund_rows(v_p.id) r where r.entry_date >= v_set.ap_cutover_date), '[]'::jsonb),
      'pending', app_private.finance_project_fund_pending(v_p.id, null),
      'capitalList', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'kind', c.kind, 'amount', c.amount, 'date', c.entry_date, 'reason', c.reason,
          'sourceType', c.source_type, 'status', c.status, 'createdByName', app_private.finance_user_name(c.created_by), 'createdAt', c.created_at,
          'reversedByName', app_private.finance_user_name(c.reversed_by), 'reverseReason', c.reverse_reason,
          'canReverse', c.status = 'posted' and c.source_type = 'manual' and v_actor = any(v_set.capital_provider_ids)) order by c.created_at desc)
        from public.finance_project_capital c where c.project_id = v_p.id), '[]'::jsonb)));
end $function$;
CREATE OR REPLACE FUNCTION public.get_finance_customer_contract_v1(p_contract_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_actor uuid := public.current_app_user_id(); c public.customer_contracts%rowtype;
  v_record boolean := app_private.finance_can('record'); v_confirm boolean := app_private.finance_can('confirm');
begin
  select * into c from public.customer_contracts where id = p_contract_id;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_CONTRACT_NOT_FOUND'; end if;
  if not (app_private.finance_can('view') or app_private.finance_project_visible(c.project_id)) then
    raise exception using errcode = '42501', message = 'FINANCE_PROJECT_VIEW_DENIED'; end if;
  return jsonb_build_object('today', v_today, 'can', app_private.finance_can_flags(), 'currentUserId', v_actor,
    'cutoverDate', (select ap_cutover_date from public.finance_settings where id = 1),
    'contract', jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name, 'customerName', c.customer_name, 'customerTaxCode', c.customer_tax_code,
      'projectId', c.project_id, 'projectCode', (select code from public.projects where id = c.project_id), 'value', c.value, 'vatPercent', coalesce(c.vat_percent, 0),
      'signedDate', c.signed_date, 'endDate', c.end_date, 'status', c.status, 'warrantyMonths', c.warranty_months,
      'advanceRecoveryPercent', c.advance_recovery_percent, 'retentionPercent', c.retention_percent, 'paymentTermDays', c.payment_term_days),
    'metrics', app_private.finance_customer_contract_metrics(c.id),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'sequenceNo', r.sequence_no, 'kind', r.kind, 'description', r.description,
        'netAmount', r.net_amount, 'vatPercent', r.vat_percent, 'vatAmount', r.vat_amount, 'gross', r.gross_amount, 'advanceRecovery', r.advance_recovery,
        'retention', r.retention, 'receivable', r.receivable, 'suggestedRecovery', r.suggested_recovery, 'suggestedRetention', r.suggested_retention,
        'adjustReason', r.adjust_reason, 'status', r.status, 'sentDate', r.sent_date, 'confirmedDate', r.confirmed_date,
        'confirmedByName', app_private.finance_user_name(r.confirmed_by), 'submittedGross', r.submitted_gross, 'customerNote', r.customer_note,
        'dueDate', r.due_date, 'invoiceNo', r.invoice_no, 'invoiceDate', r.invoice_date, 'attachments', r.attachments, 'note', r.note,
        'legacy', r.legacy_schedule_id is not null, 'cancelReason', r.cancel_reason, 'createdByName', app_private.finance_user_name(r.created_by),
        'createdAt', r.created_at, 'rowVersion', r.row_version, 'received', x.received, 'pending', x.pending, 'outstanding', x.outstanding,
        'overdue', x.outstanding > 0.5 and r.due_date < v_today, 'lastReceived', x.last_received,
        'canEdit', v_record and r.status = 'draft', 'canAct', v_record and r.status <> 'cancelled' and r.kind <> 'opening' and r.legacy_schedule_id is null)
        order by r.sequence_no)
      from public.finance_receivable_rounds r join app_private.finance_receivable_round_rows() x on x.id = r.id where r.contract_id = c.id), '[]'::jsonb),
    'receipts', coalesce((select jsonb_agg(jsonb_build_object('id', rc.id, 'code', rc.code, 'receiptDate', rc.receipt_date, 'amount', rc.amount,
        'documentRef', rc.document_ref, 'attachments', rc.attachments, 'note', rc.note, 'status', rc.status, 'rowVersion', rc.row_version,
        'createdBy', rc.created_by, 'createdByName', app_private.finance_user_name(rc.created_by), 'createdAt', rc.created_at,
        'decidedByName', app_private.finance_user_name(rc.decided_by), 'decidedAt', rc.decided_at, 'decisionNote', rc.decision_note,
        'reversedByName', app_private.finance_user_name(rc.reversed_by), 'reversedAt', rc.reversed_at, 'reverseReason', rc.reverse_reason,
        'allocations', (select coalesce(jsonb_agg(jsonb_build_object('roundId', x.round_id, 'sequenceNo', r.sequence_no, 'description', r.description,
            'amount', x.amount, 'kind', x.kind) order by r.sequence_no), '[]'::jsonb)
          from public.finance_customer_receipt_allocations x join public.finance_receivable_rounds r on r.id = x.round_id where x.receipt_id = rc.id),
        'unallocated', rc.amount - coalesce((select sum(x.amount) from public.finance_customer_receipt_allocations x where x.receipt_id = rc.id), 0),
        'canDecide', rc.status = 'submitted' and v_confirm and rc.created_by is distinct from v_actor,
        'canWithdraw', rc.status = 'submitted' and rc.created_by = v_actor, 'canReverse', rc.status = 'confirmed' and v_confirm)
        order by rc.receipt_date desc, rc.created_at desc)
      from public.finance_customer_receipts rc where rc.contract_id = c.id), '[]'::jsonb),
    'openings', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'cutoverDate', o.cutover_date, 'receivableAmount', o.receivable_amount,
        'receivableDueDate', o.receivable_due_date, 'advanceRemaining', o.advance_remaining, 'retentionHeld', o.retention_held, 'note', o.note,
        'attachments', o.attachments, 'status', o.status, 'createdBy', o.created_by, 'createdByName', app_private.finance_user_name(o.created_by),
        'createdAt', o.created_at, 'decidedByName', app_private.finance_user_name(o.decided_by), 'decidedAt', o.decided_at, 'decisionNote', o.decision_note,
        'canDecide', o.status = 'submitted' and v_confirm and o.created_by is distinct from v_actor, 'canCancel', o.status = 'confirmed' and v_confirm)
        order by o.created_at desc)
      from public.finance_customer_openings o where o.contract_id = c.id), '[]'::jsonb),
    'guarantees', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'type', g.guarantee_type, 'name', g.name, 'amount', nullif(g.amount, 0),
        'percent', nullif(g.percent, 0), 'bankName', g.bank_name, 'number', g.guarantee_number, 'issueDate', g.issue_date, 'expiryDate', g.expiry_date,
        'status', g.status, 'note', g.note, 'expiring', g.status = 'active' and g.expiry_date <= v_today + 30) order by g.guarantee_type)
      from public.contract_guarantees g where g.contract_id = c.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'actorName', app_private.finance_user_name(e.actor_id), 'reason', e.reason,
        'payload', e.payload, 'at', e.created_at) order by e.created_at desc)
      from (select * from public.finance_events where entity_type in ('receivable_round', 'customer_receipt', 'customer_opening', 'customer_terms', 'guarantee')
        and payload->>'contractId' = c.id order by created_at desc limit 100) e), '[]'::jsonb));
end $function$;
CREATE OR REPLACE FUNCTION public.get_finance_subcontract_v1(p_subcontract_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_actor uuid := public.current_app_user_id(); c public.subcontractor_contracts%rowtype;
  v_record boolean := app_private.finance_can('record'); v_confirm boolean := app_private.finance_can('confirm'); v_item uuid := app_private.finance_sub_cost_item();
  v_budget jsonb;
begin
  select * into c from public.subcontractor_contracts where id = p_subcontract_id;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_SUBCONTRACT_NOT_FOUND'; end if;
  if not (app_private.finance_can('view') or app_private.finance_project_visible(c.project_id)) then
    raise exception using errcode = '42501', message = 'FINANCE_PROJECT_VIEW_DENIED'; end if;
  if c.project_id is not null then
    select jsonb_build_object('item', b.item_name, 'budget', b.budget, 'projected', b.projected) into v_budget from app_private.finance_budget_check(c.project_id, v_item, 0, null) b;
  end if;
  return jsonb_build_object('today', v_today, 'can', app_private.finance_can_flags(), 'currentUserId', v_actor,
    'cutoverDate', (select ap_cutover_date from public.finance_settings where id = 1),
    'contract', jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name, 'subcontractorName', c.subcontractor_name, 'taxCode', c.subcontractor_tax_code,
      'scopeOfWork', c.scope_of_work, 'projectId', c.project_id, 'projectCode', (select code from public.projects where id = c.project_id),
      'partnerId', c.partner_id, 'partner', (select jsonb_build_object('id', p.id, 'name', p.name, 'taxCode', p.tax_code, 'bankName', p.bank_name, 'bankAccount', p.bank_account)
        from public.business_partners p where p.id = c.partner_id),
      'value', c.value, 'status', c.status, 'signedDate', c.signed_date, 'completionDate', c.completion_date, 'retentionPercent', c.retention_percent,
      'vatPercent', c.vat_percent, 'advanceRecoveryPercent', c.advance_recovery_percent, 'paymentTermDays', c.payment_term_days, 'warrantyMonths', c.warranty_months,
      'withholdPit', c.withhold_pit, 'pitPercent', c.pit_percent),
    'metrics', app_private.finance_subcontract_metrics(c.id),
    'budget', v_budget,
    'manDays', (select jsonb_build_object('lines', count(*), 'people', coalesce(sum(coalesce(l.people_count, l.count)), 0), 'lastDate', max(dl.date))
      from public.daily_log_labor l join public.daily_logs dl on dl.id = l.daily_log_id where l.subcontract_id = c.id),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'sequenceNo', r.sequence_no, 'kind', r.kind, 'periodStart', r.period_start, 'periodEnd', r.period_end,
        'description', r.description, 'cumulativeNet', r.cumulative_net, 'previousNet', r.previous_net, 'netAmount', r.net_amount, 'vatPercent', r.vat_percent,
        'vatAmount', r.vat_amount, 'gross', r.gross_amount, 'advanceRecovery', r.advance_recovery, 'retention', r.retention, 'pit', r.pit_amount,
        'otherDeduction', r.other_deduction, 'deductions', r.deductions, 'payable', r.payable, 'suggestedRecovery', r.suggested_recovery,
        'suggestedRetention', r.suggested_retention, 'suggestedPit', r.suggested_pit, 'adjustReason', r.adjust_reason, 'overContractReason', r.over_contract_reason,
        'status', r.status, 'submittedAt', r.submitted_at, 'returnReason', r.return_reason, 'returnedByName', app_private.finance_user_name(r.returned_by),
        'recognizedDate', r.recognized_date, 'recognizedByName', app_private.finance_user_name(r.recognized_by), 'dueDate', r.due_date,
        'retentionDueDate', r.retention_due_date, 'attachments', r.attachments, 'note', r.note, 'cancelReason', r.cancel_reason,
        'createdBy', r.created_by, 'createdByName', app_private.finance_user_name(r.created_by), 'createdAt', r.created_at, 'rowVersion', r.row_version,
        'paid', (select coalesce(sum(x.paid), 0) from app_private.finance_payable_rows() x where x.id in (r.payable_document_id, r.retention_document_id)),
        'outstanding', (select coalesce(sum(x.outstanding), 0) from app_private.finance_payable_rows() x where x.id = r.payable_document_id),
        'canEdit', v_record and r.status = 'draft' and r.kind = 'progress',
        'canSubmit', v_record and r.status = 'draft' and r.kind = 'progress',
        'canWithdraw', r.status = 'submitted' and r.created_by = v_actor,
        'canDecide', v_confirm and r.status = 'submitted' and r.created_by is distinct from v_actor,
        'canCancel', v_record and r.status in ('draft', 'submitted') and r.kind = 'progress',
        'canReverse', v_confirm and r.status = 'recognized' and r.kind = 'progress'
          and not exists (select 1 from public.finance_subcontract_rounds y where y.subcontract_id = r.subcontract_id and y.sequence_no > r.sequence_no and y.status = 'recognized'))
        order by r.sequence_no)
      from public.finance_subcontract_rounds r where r.subcontract_id = c.id), '[]'::jsonb),
    'openings', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'cutoverDate', o.cutover_date, 'cumulativeNet', o.cumulative_net, 'paidTotal', o.paid_total,
        'outstanding', o.outstanding, 'outstandingDueDate', o.outstanding_due_date, 'retentionHeld', o.retention_held, 'retentionDueDate', o.retention_due_date,
        'advanceRemaining', o.advance_remaining, 'note', o.note, 'attachments', o.attachments, 'status', o.status, 'createdBy', o.created_by,
        'createdByName', app_private.finance_user_name(o.created_by), 'createdAt', o.created_at, 'decidedByName', app_private.finance_user_name(o.decided_by),
        'decidedAt', o.decided_at, 'decisionNote', o.decision_note,
        'canDecide', o.status = 'submitted' and v_confirm and o.created_by is distinct from v_actor,
        'canCancel', o.status = 'confirmed' and v_confirm) order by o.created_at desc)
      from public.finance_subcontract_openings o where o.subcontract_id = c.id), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'code', x.code, 'documentNo', x.document_no, 'sourceType', x.source_type,
        'documentDate', x.document_date, 'dueDate', x.due_date, 'recognized', x.recognized, 'paid', x.paid, 'outstanding', x.outstanding,
        'pendingExternal', x.pending_external, 'status', x.status) order by x.document_date, x.code)
      from app_private.finance_payable_rows() x join public.supplier_payable_documents d on d.id = x.id where d.subcontract_id = c.id), '[]'::jsonb),
    'advances', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'code', a.code, 'status', a.status, 'amount', a.amount, 'offset', a.offset_amount,
        'refunded', a.refunded, 'remaining', a.remaining, 'repayDueDate', a.repay_due_date, 'paidDate', a.paid_date) order by a.created_at)
      from app_private.finance_advance_rows() a join public.finance_payment_requests r on r.id = a.id where r.subcontract_id = c.id
        and r.status not in ('rejected', 'withdrawn', 'cancelled')), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'actorName', app_private.finance_user_name(e.actor_id), 'reason', e.reason,
        'payload', e.payload, 'at', e.created_at) order by e.created_at desc)
      from (select * from public.finance_events where entity_type in ('subcontract_round', 'subcontract_opening', 'subcontract_terms')
        and payload->>'subcontractId' = c.id order by created_at desc limit 100) e), '[]'::jsonb),
    'partners', case when app_private.finance_can('manage') then coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'taxCode', p.tax_code) order by p.name)
      from public.business_partners p where coalesce(p.is_active, true) and p.classifications && array['contractor', 'crew', 'supplier']::text[]), '[]'::jsonb) else '[]'::jsonb end);
end $function$;
-- Đơn mua quá hẹn (Chi phí & ngân sách toàn công ty): trả mã đơn để bấm mở đúng đơn.
CREATE OR REPLACE FUNCTION public.get_finance_cost_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id(); v_set public.finance_settings%rowtype; v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  select * into v_set from public.finance_settings where id = 1;
  return (with s as (select x.*, app_private.finance_project_cost_summary(x.id) cs, app_private.finance_project_fund(x.id) fund from app_private.finance_cost_scope() x),
    st as (select * from app_private.finance_po_commitments(null) c where c.stale)
  select jsonb_build_object('today', v_today, 'cutoverDate', v_set.ap_cutover_date, 'warnPercent', v_set.budget_warn_percent,
    'can', app_private.finance_can_flags() || jsonb_build_object('capital', v_actor = any(v_set.capital_provider_ids)),
    'capitalProviders', (select coalesce(jsonb_agg(app_private.finance_user_name(i)), '[]'::jsonb) from unnest(v_set.capital_provider_ids) i),
    'budgetApprovers', (select coalesce(jsonb_agg(app_private.finance_user_name(i)), '[]'::jsonb) from unnest(v_set.budget_extra_approver_ids) i),
    'projects', coalesce((select jsonb_agg(s.cs || s.fund || jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name,
        'contractValue', (select nullif(sum(c.value), 0) from public.customer_contracts c where c.project_id = s.id and c.status <> 'cancelled'),
        'receivedAll', coalesce((select sum(t.amount) from public.project_transactions t where t.project_id = s.id and t.type = 'revenue_received'), 0),
        'currentBudget', (select jsonb_build_object('id', b.id, 'versionNo', b.version_no, 'decidedAt', b.decided_at) from public.finance_project_budgets b
          where b.project_id = s.id and b.status = 'approved'),
        'pendingBudget', (select jsonb_build_object('id', b.id, 'versionNo', b.version_no, 'createdByName', app_private.finance_user_name(b.created_by),
            'canDecide', app_private.finance_can('manage') and b.created_by is distinct from v_actor) from public.finance_project_budgets b
          where b.project_id = s.id and b.status = 'submitted'),
        'openingStatus', coalesce((select o.status from public.finance_project_fund_openings o where o.project_id = s.id and o.status in ('submitted', 'confirmed')), 'none'),
        'openingCanDecide', exists (select 1 from public.finance_project_fund_openings o where o.project_id = s.id and o.status = 'submitted'
          and o.created_by is distinct from v_actor and app_private.finance_can('confirm')))
      order by (s.cs->>'actual')::numeric desc, s.code) from s), '[]'::jsonb),
    'poBudget', coalesce((select jsonb_agg(jsonb_build_object('purchaseOrderId', o.id, 'poNumber', o.po_number, 'projectId', o.project_id,
        'projectCode', (select code from public.projects p where p.id = o.project_id), 'vendor', o.vendor_name, 'order', (o.metadata->'budgetApproval'->>'order')::numeric,
        'budget', (o.metadata->'budgetApproval'->>'budget')::numeric, 'projected', (o.metadata->'budgetApproval'->>'projected')::numeric,
        'requestedByName', o.metadata->'budgetApproval'->>'requestedByName', 'requestedAt', o.metadata->'budgetApproval'->>'requestedAt',
        'approverName', o.submitted_to_name, 'createdByName', app_private.finance_user_name(nullif(o.created_by_id, '')::uuid),
        'canDecide', v_actor = any(v_set.budget_extra_approver_ids) and o.created_by_id is distinct from v_actor::text) order by o.last_action_at)
      from public.purchase_orders o where o.status = 'sent' and o.archived_at is null and o.metadata->'budgetApproval'->>'status' = 'pending'), '[]'::jsonb),
    'stale', jsonb_build_object('count', (select count(*) from st), 'amount', coalesce((select sum(open_net) from st), 0),
      'items', coalesce((select jsonb_agg(jsonb_build_object('poId', st.po_id, 'poNumber', st.po_number, 'projectCode', p.code, 'vendor', st.vendor_name, 'status', st.status,
          'expectedDate', st.expected_date, 'openNet', st.open_net, 'hub', st.hub) order by st.expected_date)
        from st left join public.projects p on p.id = st.project_id), '[]'::jsonb))));
end $function$;
