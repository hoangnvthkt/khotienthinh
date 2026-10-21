-- Quy cách ở Tài chính (chủ SP 10/10/2026, tiếp #152): công nợ, chốt giá, phiếu nhập trực tiếp, bảng đối soát chờ ghi sổ
-- hiện tên + quy cách của dòng chứng từ gốc. Số tiền, cách ghi nợ / chi phí không đổi (vẫn theo chứng từ, mã vật tư là khóa).
--   * Dòng giá của chứng từ công nợ (hóa đơn NCC, chốt giá): tên theo dòng đơn + quy cách.
--   * Dòng chốt giá (supplier_price_settlement_lines.specification): ảnh chụp lúc lập.
--   * Phiếu nhập trực tiếp chờ ghi nợ: tên + quy cách nếu phiếu có.
--   * Bảng đối soát chờ ghi sổ: thêm danh sách dòng để kế toán xem trước khi ghi.

alter table public.supplier_price_settlement_lines add column if not exists specification text;
comment on column public.supplier_price_settlement_lines.specification is 'Quy cách của dòng chứng từ được chốt giá (ảnh chụp lúc lập).';

-- Quy cách của một dòng giá chứng từ công nợ.
create or replace function app_private.finance_price_line_spec(p_kind text, p_line_id uuid)
returns text language sql stable security definer set search_path = ''
as $$
  select case p_kind
    when 'po_delivery_line' then (select app_private.po_line_desc(l.purchase_order_id, l.purchase_order_line_id)->>'specification'
      from public.purchase_order_delivery_lines l where l.id = p_line_id)
    when 'statement_line' then (select l.specification from public.supplier_direct_delivery_lines l where l.id = p_line_id)
  end;
$$;

create or replace function app_private.trg_snapshot_price_settlement_line_spec()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if nullif(btrim(coalesce(new.specification, '')), '') is null then
    new.specification := app_private.finance_price_line_spec(new.source_kind, new.source_line_id);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_snapshot_price_settlement_line_spec on public.supplier_price_settlement_lines;
create trigger trg_snapshot_price_settlement_line_spec before insert on public.supplier_price_settlement_lines
  for each row execute function app_private.trg_snapshot_price_settlement_line_spec();

CREATE OR REPLACE FUNCTION app_private.finance_price_doc_lines(p_doc uuid)
 RETURNS TABLE(line_id uuid, kind text, item_name text, unit text, qty numeric, ordered_price numeric, vat_rate numeric, po_id text, po_line_id text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select l.id, 'po_delivery_line', coalesce(app_private.po_line_desc(l.purchase_order_id, l.purchase_order_line_id)->>'itemNameSnapshot', i.name, l.item_id), coalesce(nullif(l.unit, ''), i.unit),
    greatest(coalesce(l.accepted_qty, 0) - coalesce(l.returned_qty, 0), 0), l.delivery_unit_price, coalesce(b.vat_rate, 0), l.purchase_order_id, l.purchase_order_line_id
  from public.supplier_payable_documents d join public.purchase_order_delivery_batches b on b.id::text = d.source_id
  join public.purchase_order_delivery_lines l on l.delivery_batch_id = b.id left join public.items i on i.id = l.item_id
  where d.id = p_doc and d.source_type = 'purchase_delivery_receipt' and coalesce(l.delivery_unit_price, 0) > 0
    and coalesce(l.accepted_qty, 0) - coalesce(l.returned_qty, 0) > 0
  union all
  select l.id, 'statement_line', l.item_name_snapshot, l.unit_snapshot, l.accepted_quantity, l.unit_price, coalesce(l.vat_rate, 0), null, null
  from public.supplier_payable_documents d join public.supplier_direct_delivery_lines l on l.statement_id::text = d.source_id
  where d.id = p_doc and d.source_type = 'supplier_delivery_statement' and coalesce(l.unit_price, 0) > 0
    and coalesce(l.accepted_quantity, 0) > 0 and coalesce(l.status, '') <> 'rejected';
$function$
;

CREATE OR REPLACE FUNCTION app_private.finance_doc_price_lines_json(p_doc uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when count(*) = 0 then null else jsonb_agg(jsonb_build_object('lineId', x.line_id, 'kind', x.kind, 'itemName', x.item_name,
    'specification', app_private.finance_price_line_spec(x.kind, x.line_id), 'unit', x.unit,
    'qty', x.qty, 'orderedPrice', x.ordered_price, 'currentPrice', coalesce(app_private.finance_price_current(x.line_id), x.ordered_price), 'vatRate', x.vat_rate,
    'pendingCode', (select s.code from public.supplier_price_settlement_lines k join public.supplier_price_settlements s on s.id = k.settlement_id
      where k.source_line_id = x.line_id and s.status = 'pending_approval' limit 1)) order by x.item_name, app_private.finance_price_line_spec(x.kind, x.line_id) nulls first, x.line_id) end
  from app_private.finance_price_doc_lines(p_doc) x;
$function$
;

CREATE OR REPLACE FUNCTION app_private.finance_price_json(p_id uuid, p_uid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object('id', s.id, 'code', s.code, 'supplierId', s.supplier_id, 'supplierName', s.supplier_name_snapshot, 'basis', s.basis,
    'invoiceNumber', i.invoice_number, 'agreementNo', s.agreement_no, 'agreementDate', s.agreement_date, 'reason', s.reason, 'attachments', s.attachments,
    'status', s.status, 'deltaGross', s.delta_gross, 'increaseGross', s.increase_gross,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('documentId', l.payable_document_id, 'lineId', l.source_line_id,
        'documentNo', coalesce(d.document_no, d.code), 'projectCode', p.code, 'poNumber', po.po_number, 'itemName', l.item_name, 'specification', l.specification, 'unit', l.unit, 'qty', l.qty,
        'fromPrice', l.from_price, 'toPrice', l.to_price, 'vatRate', l.vat_rate, 'deltaGross', l.delta_gross) order by d.document_date, l.item_name)
      from public.supplier_price_settlement_lines l join public.supplier_payable_documents d on d.id = l.payable_document_id
      left join public.projects p on p.id = d.project_id left join public.purchase_orders po on po.id = l.purchase_order_id
      where l.settlement_id = s.id), '[]'::jsonb),
    'steps', case when s.basis = 'invoice' then app_private.finance_price_steps_json(i.route, i.step_index, i.approvals)
      else app_private.finance_price_steps_json(s.route, s.step_index, s.approvals) end,
    'stepIndex', case when s.basis = 'invoice' then i.step_index else s.step_index end,
    'needsAdjustmentInvoice', s.needs_adjustment_invoice, 'adjustmentInvoice', s.adjustment_invoice,
    'effects', case when s.effects is null then null else jsonb_build_object('creditGross', s.effects->'creditGross',
      'increaseDocCode', (select string_agg(x, ', ') from jsonb_array_elements_text(s.effects->'increaseDocCodes') x),
      'supplierOwes', s.effects->'supplierOwes', 'inventoryDocs', s.effects->'inventoryDocs') end,
    'createdByName', app_private.finance_user_name(s.created_by), 'createdAt', s.created_at,
    'decidedByName', app_private.finance_user_name(s.decided_by), 'decidedAt', s.decided_at, 'decisionNote', s.decision_note,
    'reversedByName', app_private.finance_user_name(s.reversed_by), 'reversedAt', s.reversed_at, 'reversalReason', s.reversal_reason, 'rowVersion', s.row_version,
    'canDecide', s.basis = 'agreement' and s.status = 'pending_approval' and app_private.finance_price_can_decide(s.route, s.step_index, s.approvals, s.created_by,
      array(select distinct payable_document_id from public.supplier_price_settlement_lines where settlement_id = s.id), p_uid),
    'canWithdraw', s.basis = 'agreement' and s.status = 'pending_approval' and s.created_by = p_uid,
    'canAttachInvoice', s.status = 'posted' and s.needs_adjustment_invoice and s.adjustment_invoice is null and app_private.finance_can('record'),
    'canReverse', s.basis = 'agreement' and s.status = 'posted' and app_private.finance_can('confirm') and s.created_by is distinct from p_uid)
  from public.supplier_price_settlements s left join public.supplier_invoices i on i.id = s.invoice_id where s.id = p_id;
$function$
;

CREATE OR REPLACE FUNCTION public.get_procurement_po_price_settlements_v1(p_po_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not (app_private.procurement_can('view') or app_private.finance_can('view')) then
    raise exception using errcode = '42501', message = 'PROCUREMENT_VIEW_DENIED'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('poLineId', l.purchase_order_line_id, 'code', s.code, 'status', s.status, 'itemName', l.item_name, 'specification', l.specification, 'unit', l.unit,
      'qty', l.qty, 'fromPrice', l.from_price, 'toPrice', l.to_price, 'deltaGross', l.delta_gross, 'reason', s.reason,
      'at', coalesce(s.decided_at, s.created_at), 'deliveryNo', b.delivery_no) order by coalesce(s.decided_at, s.created_at))
    from public.supplier_price_settlement_lines l join public.supplier_price_settlements s on s.id = l.settlement_id
    left join public.purchase_order_delivery_lines dl on dl.id = l.source_line_id left join public.purchase_order_delivery_batches b on b.id = dl.delivery_batch_id
    where l.purchase_order_id = p_po_id and s.status in ('pending_approval', 'posted')), '[]'::jsonb);
end $function$
;

CREATE OR REPLACE FUNCTION public.list_finance_direct_receipts_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id(); v_record boolean := app_private.finance_can('record');
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  return (with r as (select * from app_private.finance_direct_receipt_rows() where not posted),
  shaped as (
    select r.*, jsonb_build_object('id', r.id, 'rowVersion', r.row_version, 'date', r.receipt_date, 'note', r.note,
      'warehouseId', r.warehouse_id, 'warehouse', r.warehouse_name, 'projectId', r.project_id, 'projectCode', r.project_code,
      'cutoverDate', r.cutover_date, 'beforeCutover', r.cutover_date is not null and r.receipt_date < r.cutover_date,
      'supplierId', r.supplier_id, 'supplierName', r.supplier_name, 'contractCode', r.contract_code,
      'createdByName', app_private.finance_user_name(coalesce(r.created_by, r.requester_id)), 'approvedByName', app_private.finance_user_name(r.approver_id),
      'attachments', r.attachments, 'value', round(r.value, 2), 'missingPrice', r.missing_price,
      'lines', (select coalesce(jsonb_agg(jsonb_build_object('index', o, 'itemId', x->>'itemId', 'itemName', coalesce(nullif(x->>'itemNameSnapshot', ''), i.name, x->>'itemId'),
          'specification', nullif(btrim(coalesce(x->>'specification', '')), ''), 'unit', i.unit,
          'qty', coalesce(nullif(x->>'quantity', '')::numeric, 0), 'price', coalesce(nullif(x->>'price', '')::numeric, 0),
          'catalogPrice', nullif(i.price_in, 0), 'vatRate', x->'vatRate', 'priceIncludesVat', coalesce((x->>'priceIncludesVat')::boolean, false)) order by o), '[]'::jsonb)
        from jsonb_array_elements(r.items) with ordinality y(x, o) left join public.items i on i.id = x->>'itemId'),
      'duplicateOf', (select o.id from app_private.finance_direct_receipt_rows() o
        where o.id <> r.id and o.supplier_id = r.supplier_id and o.receipt_date = r.receipt_date and r.value > 0 and abs(o.value - r.value) < 1
        order by o.id limit 1),
      'returned', r.returned,
      'canPost', v_record and v_actor is not null and v_actor is distinct from r.created_by and v_actor is distinct from r.requester_id
        and v_actor is distinct from r.approver_id) j
    from r)
  select jsonb_build_object(
    'receipts', coalesce((select jsonb_agg(j order by supplier_name, receipt_date desc, id) from shaped where returned is null), '[]'::jsonb),
    'returned', coalesce((select jsonb_agg(j order by receipt_date desc) from shaped where returned is not null), '[]'::jsonb),
    'can', jsonb_build_object('record', v_record)));
end $function$
;

CREATE OR REPLACE FUNCTION public.list_finance_pending_statements_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id();
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', st.id, 'code', st.code, 'supplierId', st.supplier_id,
      'supplierName', st.supplier_name_snapshot, 'contractCode', st.supplier_contract_code, 'projectId', st.project_id,
      'projectCode', (select code from public.projects where id = st.project_id), 'periodMonth', st.period_month,
      'statementDate', st.statement_date, 'grossAmount', st.gross_amount, 'vatAmount', st.vat_amount, 'totalAmount', st.total_amount,
      'createdByName', app_private.finance_user_name(st.created_by), 'confirmedByName', st.metadata->>'confirmedByName',
      'confirmedAt', st.metadata->>'confirmedAt',
      -- Dòng của bảng đối soát (tên + quy cách theo dòng giao nhận) để kế toán xem trước khi ghi sổ.
      'lines', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'itemName', x.item_name_snapshot, 'specification', x.specification,
          'unit', x.unit_snapshot, 'qty', x.accepted_quantity, 'unitPrice', x.unit_price_snapshot, 'vatRate', x.vat_rate_snapshot,
          'amount', x.accepted_amount, 'contractPrice', x.contract_unit_price, 'priceReason', x.price_reason)
          order by dl.line_no nulls last, x.item_name_snapshot, x.specification nulls first)
        from public.supplier_delivery_statement_lines x left join public.supplier_direct_delivery_lines dl on dl.id = x.delivery_line_id
        where x.statement_id = st.id), '[]'::jsonb),
      'canPost', app_private.procurement_statement_accountant_ok(v_actor, st.project_id, st.construction_site_id)) order by st.statement_date, st.code)
    from public.supplier_delivery_statements st where st.status = 'confirmed'), '[]'::jsonb);
end;
$function$
;


update public.supplier_price_settlement_lines l set specification = app_private.finance_price_line_spec(l.source_kind, l.source_line_id)
where l.specification is null and app_private.finance_price_line_spec(l.source_kind, l.source_line_id) is not null;

revoke all on function app_private.finance_price_line_spec(text, uuid), app_private.trg_snapshot_price_settlement_line_spec() from public, anon;

notify pgrst, 'reload schema';
