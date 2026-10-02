-- ===========================================================================
-- K3a-3 — Phiếu nhập trực tiếp NCC vào công nợ (02/10/2026)
-- Thiết kế: docs/designs/project-closed-loop-2026-09-30/08-trung-tam-tai-chinh-k3.md mục 11
--
-- Luật nghiệp vụ (chủ sản phẩm duyệt 02/10):
-- * Phiếu nhập kho trực tiếp từ NCC / HĐ NCC (màn Nhập kho, không qua PO, không qua phiếu giao HĐ) trước đây không sinh
--   công nợ và chi phí dự án. Từ nay phiếu đã hoàn tất vào hộp "Chờ ghi nợ" của Tài chính; kế toán kiểm giá + VAT rồi ghi nợ.
--   Áp cho cả phiếu cũ (46 phiếu từ 18/07).
-- * Dòng chưa có giá: kế toán nhập giá khi ghi nợ → cập nhật luôn phiếu kho, sổ kho và giá trị tồn (truy vết priceSetBy).
-- * Công nợ: source_type 'direct_supplier_receipt', 1 chứng từ / phiếu, giá trị gồm VAT. Chi phí dự án ghi cùng lúc qua trigger
--   ghi nhận (như đối soát HĐ); phiếu trước mốc chi phí MISA chỉ ghi nợ, chi phí về 0 (K3a-2). Kho không thuộc dự án (Kho Tổng)
--   → công nợ cấp công ty, không ghi chi phí (chi phí theo hàng khi chuyển kho).
-- * Tách nhiệm: người lập / người duyệt phiếu nhập không tự ghi nợ phiếu đó. Phiếu nghi trùng (cùng NCC, ngày, số tiền) phải
--   xác nhận đã đối chiếu với kho. Kế toán có thể trả lại kho kèm lý do; phiếu quay lại khi kho sửa phiếu.
-- * Kho hủy phiếu nhập đã ghi nợ: chưa thanh toán → công nợ hủy, chi phí về 0; đã có khoản chi → chặn hủy.
-- * Ma trận duyệt v2: thêm Giám đốc tài chính làm người dự phòng ở bước Kế toán trưởng (người lập không tự duyệt).
-- ===========================================================================

alter table public.supplier_payable_documents drop constraint supplier_payable_documents_source_type_check;
alter table public.supplier_payable_documents add constraint supplier_payable_documents_source_type_check
  check (source_type = any (array['purchase_order', 'purchase_delivery_receipt', 'supplier_invoice_adjustment', 'site_direct_purchase',
    'supplier_delivery_statement', 'supplier_return_credit', 'opening_balance', 'manual_adjustment', 'direct_supplier_receipt']));

-- ---------------------------------------------------------------------------
-- 1. Danh sách phiếu nhập trực tiếp (đã hoàn tất)
-- ---------------------------------------------------------------------------
create function app_private.finance_direct_receipt_rows()
returns table (id text, row_version bigint, receipt_date date, note text, warehouse_id text, warehouse_name text, project_id text, project_code text,
  construction_site_id text, cutover_date date, supplier_id text, supplier_name text, contract_id text, contract_code text,
  requester_id uuid, created_by uuid, approver_id uuid, attachments integer, items jsonb, value numeric, missing_price integer,
  posted boolean, returned jsonb)
language sql stable security definer set search_path = '' as $$
  select t.id, t.row_version, (t.date at time zone 'Asia/Ho_Chi_Minh')::date, t.note, w.id, w.name, pr.id, pr.code,
    w.construction_site_id::text, c.cutover_date,
    coalesce(sc.supplier_id::text, t.business_partner_id::text, nullif(t.supplier_id, '')),
    coalesce(bp.name, sc.supplier_name, t.business_partner_name_snapshot),
    sc.id::text, sc.code, t.requester_id, t.created_by, t.approver_id, jsonb_array_length(coalesce(t.attachments, '[]'::jsonb)), t.items,
    (select coalesce(sum(coalesce(nullif(x->>'quantity', '')::numeric, 0) * coalesce(nullif(x->>'price', '')::numeric, 0)), 0) from jsonb_array_elements(t.items) x),
    (select count(*)::integer from jsonb_array_elements(t.items) x where coalesce(nullif(x->>'price', '')::numeric, 0) <= 0),
    exists (select 1 from public.supplier_payable_documents d where d.source_type = 'direct_supplier_receipt' and d.source_id = t.id),
    (select jsonb_build_object('reason', e.reason, 'at', e.created_at, 'byName', app_private.finance_user_name(e.actor_id))
     from public.finance_events e where e.entity_type = 'direct_receipt' and e.entity_id = t.id and e.action = 'direct_receipt_return'
       and (e.payload->>'rowVersion')::bigint = t.row_version order by e.created_at desc limit 1)
  from public.transactions t
  join public.warehouses w on w.id = t.target_warehouse_id
  left join public.projects pr on pr.id = app_private.finance_warehouse_project(w.id)
  left join public.finance_project_cost_cutovers c on c.project_id = pr.id
  left join public.supplier_contracts sc on t.source_type = 'supplier_contract' and sc.id::text = t.source_id
  left join public.business_partners bp on bp.id::text = coalesce(sc.supplier_id::text, t.business_partner_id::text, nullif(t.supplier_id, ''))
  where t.type::text = 'IMPORT' and t.status::text = 'COMPLETED' and t.business_event_type = 'direct_supplier_receipt'
    and t.source_type in ('supplier_contract', 'business_partner');
$$;

create function public.list_finance_direct_receipts_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
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
      'lines', (select coalesce(jsonb_agg(jsonb_build_object('index', o, 'itemId', x->>'itemId', 'itemName', coalesce(i.name, x->>'itemId'), 'unit', i.unit,
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
end $$;

-- ---------------------------------------------------------------------------
-- 2. Ghi nợ: bổ sung giá dòng thiếu (phiếu kho + sổ kho + tồn), sinh chứng từ công nợ
-- ---------------------------------------------------------------------------
create function app_private.finance_set_direct_receipt_price(p_tx text, p_index integer, p_price numeric, p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_items jsonb; v_line jsonb; v_item text; v_k integer; v_le public.inventory_ledger_entries%rowtype; v_delta numeric; v_n integer;
begin
  select items into v_items from public.transactions where id = p_tx for update;
  v_line := v_items -> (p_index - 1);
  v_item := v_line->>'itemId';
  select count(*) into v_k from jsonb_array_elements(v_items) with ordinality x(v, o) where o < p_index and v->>'itemId' = v_item;
  update public.transactions set items = jsonb_set(items, array[(p_index - 1)::text],
    v_line || jsonb_build_object('price', p_price, 'priceSetBy', jsonb_build_object('source', 'finance_direct_receipt', 'userId', p_actor, 'at', now(),
      'previousPrice', coalesce(nullif(v_line->>'price', '')::numeric, 0))))
  where id = p_tx;
  select * into v_le from public.inventory_ledger_entries le
  where le.source_code = p_tx and le.material_id = v_item and le.movement_direction = 'in'
  order by le.entry_no offset v_k limit 1 for update;
  if not found then return; end if;
  v_delta := v_le.quantity_in * (p_price - coalesce(v_le.unit_price, 0));
  update public.inventory_ledger_entries set unit_price = p_price,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('priceSetBy', jsonb_build_object('source', 'finance_direct_receipt', 'userId', p_actor, 'at', now(), 'previousPrice', v_le.unit_price))
  where id = v_le.id;
  update public.inventory_ledger_entries set balance_after_value = balance_after_value + v_delta
  where material_id = v_le.material_id and warehouse_id = v_le.warehouse_id and created_at >= v_le.created_at;
  update public.inventory_balances b set total_value = b.total_value + v_delta,
    average_unit_cost = case when b.on_hand_qty = 0 then 0 else (b.total_value + v_delta) / b.on_hand_qty end, updated_at = now()
  where b.material_id = v_le.material_id and b.warehouse_id = v_le.warehouse_id
    and b.project_id is not distinct from v_le.project_id and b.construction_site_id is not distinct from v_le.construction_site_id;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception using errcode = 'P0001', message = 'FINANCE_STOCK_BALANCE_MISMATCH'; end if;
end $$;

create function public.post_finance_direct_receipts_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_vat text := nullif(p_input->>'vat', ''); v_rate numeric;
  v_invoice text := nullif(btrim(p_input->>'invoiceNo'), ''); v_checked boolean := coalesce((p_input->>'duplicateChecked')::boolean, false);
  v_r jsonb; v_tx public.transactions%rowtype; v_row record; v_line record; v_price numeric; v_net numeric; v_vat_amt numeric; v_gross numeric;
  v_dup text; v_doc public.supplier_payable_documents%rowtype; v_out jsonb := '[]'::jsonb; v_total numeric := 0;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  if v_vat is null or v_vat not in ('0', '5', '8', '10', 'incl') then raise exception using errcode = '22023', message = 'FINANCE_VAT_REQUIRED'; end if;
  v_rate := case when v_vat = 'incl' then 0 else v_vat::numeric end;
  if jsonb_typeof(p_input->'receipts') is distinct from 'array' or jsonb_array_length(p_input->'receipts') = 0 then
    raise exception using errcode = '22023', message = 'FINANCE_DIRECT_RECEIPT_REQUIRED'; end if;
  for v_r in select value from jsonb_array_elements(p_input->'receipts') loop
    select * into v_tx from public.transactions where id = v_r->>'transactionId' for update;
    if not found or v_tx.type::text <> 'IMPORT' or v_tx.status::text <> 'COMPLETED' or v_tx.business_event_type is distinct from 'direct_supplier_receipt'
      or v_tx.source_type not in ('supplier_contract', 'business_partner') then
      raise exception using errcode = '22023', message = 'FINANCE_DIRECT_RECEIPT_STATE'; end if;
    if v_tx.row_version is distinct from nullif(v_r->>'rowVersion', '')::bigint then
      raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
    if exists (select 1 from public.supplier_payable_documents where source_type = 'direct_supplier_receipt' and source_id = v_tx.id) then
      raise exception using errcode = '22023', message = 'FINANCE_DIRECT_RECEIPT_POSTED'; end if;
    if v_actor = v_tx.created_by or v_actor = v_tx.requester_id or v_actor = v_tx.approver_id then
      raise exception using errcode = '42501', message = 'FINANCE_DIRECT_RECEIPT_SELF_POST'; end if;
    select * into v_row from app_private.finance_direct_receipt_rows() x where x.id = v_tx.id;
    if v_row.supplier_id is null then raise exception using errcode = '22023', message = 'FINANCE_SUPPLIER_REQUIRED'; end if;
    select o.id into v_dup from app_private.finance_direct_receipt_rows() o
      where o.id <> v_row.id and o.supplier_id = v_row.supplier_id and o.receipt_date = v_row.receipt_date and v_row.value > 0 and abs(o.value - v_row.value) < 1 limit 1;
    if v_dup is not null and not v_checked then raise exception using errcode = '22023', message = 'FINANCE_DUPLICATE_UNCHECKED'; end if;
    for v_line in select o::integer idx, x it from jsonb_array_elements(v_tx.items) with ordinality y(x, o) loop
      if coalesce(nullif(v_line.it->>'price', '')::numeric, 0) <= 0 then
        v_price := round(nullif(v_r->'prices'->>(v_line.idx::text), '')::numeric, 2);
        if v_price is null or v_price <= 0 then raise exception using errcode = '22023', message = 'FINANCE_PRICE_REQUIRED'; end if;
        perform app_private.finance_set_direct_receipt_price(v_tx.id, v_line.idx, v_price, v_actor);
      end if;
    end loop;
    select * into v_tx from public.transactions where id = v_tx.id;
    select round(coalesce(sum(coalesce(nullif(x->>'quantity', '')::numeric, 0) * coalesce(nullif(x->>'price', '')::numeric, 0)), 0), 2) into v_net
    from jsonb_array_elements(v_tx.items) x;
    v_vat_amt := round(v_net * v_rate / 100, 2); v_gross := v_net + v_vat_amt;
    if v_gross <= 0 then raise exception using errcode = '22023', message = 'FINANCE_AMOUNT_INVALID'; end if;
    insert into public.supplier_payable_documents (code, source_type, source_id, project_id, construction_site_id, supplier_id, supplier_name_snapshot,
      supplier_contract_id, supplier_contract_code, document_no, document_date, committed_amount, recognized_amount, credit_amount, status,
      invoice_number, metadata, created_by)
    values ('AP-NTT-' || upper(substr(v_tx.id, 4)), 'direct_supplier_receipt', v_tx.id, v_row.project_id, v_row.construction_site_id, v_row.supplier_id,
      coalesce(v_row.supplier_name, 'Nhà cung cấp'), v_row.contract_id, v_row.contract_code, v_tx.id, v_row.receipt_date, v_gross, v_gross, 0, 'open', v_invoice,
      jsonb_build_object('wmsTransactionId', v_tx.id, 'warehouseId', v_row.warehouse_id, 'warehouseName', v_row.warehouse_name, 'note', v_tx.note,
        'netAmount', v_net, 'vatRate', v_rate, 'vatAmount', v_vat_amt, 'priceIncludesVat', v_vat = 'incl', 'duplicateOf', v_dup, 'duplicateChecked', v_dup is not null,
        'receivedById', coalesce(v_tx.created_by, v_tx.requester_id), 'approvedById', v_tx.approver_id, 'postedById', v_actor, 'postedAt', now())
        || case when v_row.project_id is null and v_row.construction_site_id is null then jsonb_build_object('scope', 'company') else '{}'::jsonb end,
      v_actor)
    returning * into v_doc;
    insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, after, payload)
    values ('payable_document', v_doc.id::text, v_doc.supplier_id, 'direct_receipt_post', v_actor, jsonb_build_object('amount', v_gross),
      jsonb_build_object('transactionId', v_tx.id, 'net', v_net, 'vat', v_vat, 'vatAmount', v_vat_amt, 'invoiceNo', v_invoice, 'duplicateOf', v_dup));
    v_out := v_out || jsonb_build_object('transactionId', v_tx.id, 'documentId', v_doc.id, 'code', v_doc.code, 'amount', v_gross);
    v_total := v_total + v_gross;
  end loop;
  return jsonb_build_object('documents', v_out, 'total', v_total);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Trả lại kho (sai giá, nghi trùng…) — phiếu quay lại hộp khi kho sửa phiếu (row_version đổi)
-- ---------------------------------------------------------------------------
create function public.return_finance_direct_receipts_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_reason text := nullif(btrim(p_input->>'reason'), ''); v_id text; v_row record; v_n integer := 0;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  for v_id in select jsonb_array_elements_text(coalesce(p_input->'transactionIds', '[]'::jsonb)) loop
    select * into v_row from app_private.finance_direct_receipt_rows() x where x.id = v_id;
    if not found or v_row.posted then raise exception using errcode = '22023', message = 'FINANCE_DIRECT_RECEIPT_STATE'; end if;
    insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, reason, payload)
    values ('direct_receipt', v_id, v_row.supplier_id, 'direct_receipt_return', v_actor, v_reason, jsonb_build_object('rowVersion', v_row.row_version));
    insert into public.notifications (user_id, type, category, title, message, body, severity, icon, link, source_type, source_id,
      priority, push_enabled, metadata, delivery_reason)
    select u::text, 'info', 'finance', 'Kế toán trả lại phiếu nhập', v_id || ': ' || v_reason, v_id || ': ' || v_reason, 'warning', '🏦', '/#/operations',
      'finance_direct_receipt_return', 'finance_direct_receipt_return:' || v_id || ':' || gen_random_uuid(), 'normal', true, '{}'::jsonb, 'responsible'
    from (select distinct unnest(array[v_row.created_by, v_row.requester_id, v_row.approver_id]) u) us where u is not null and u <> v_actor;
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception using errcode = '22023', message = 'FINANCE_DIRECT_RECEIPT_REQUIRED'; end if;
  return jsonb_build_object('returned', v_n);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Kho hủy phiếu nhập đã ghi nợ
-- ---------------------------------------------------------------------------
create function app_private.trg_finance_direct_receipt_cancel()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_doc public.supplier_payable_documents%rowtype;
begin
  if new.business_event_type is distinct from 'direct_supplier_receipt' or old.status::text <> 'COMPLETED' or new.status::text = 'COMPLETED' then return new; end if;
  select * into v_doc from public.supplier_payable_documents where source_type = 'direct_supplier_receipt' and source_id = new.id for update;
  if not found or v_doc.status in ('cancelled', 'reversed') then return new; end if;
  if v_doc.credit_amount > 0 or exists (select 1 from public.supplier_payment_allocations a join public.supplier_payment_batches b on b.id = a.payment_batch_id
      where a.payable_document_id = v_doc.id and b.status not in ('cancelled', 'rejected', 'reversed')) then
    raise exception using errcode = 'P0001', message = 'FINANCE_DIRECT_RECEIPT_PAID: Phiếu nhập đã có khoản chi trong Tài chính — đảo khoản chi trước khi hủy phiếu.';
  end if;
  update public.supplier_payable_documents set status = 'cancelled',
    metadata = metadata || jsonb_build_object('cancelledByWms', jsonb_build_object('at', now(), 'status', new.status::text))
  where id = v_doc.id;
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, payload)
  values ('payable_document', v_doc.id::text, v_doc.supplier_id, 'direct_receipt_cancel', jsonb_build_object('transactionId', new.id, 'amount', v_doc.recognized_amount));
  return new;
end $$;
create trigger trg_finance_direct_receipt_cancel after update of status on public.transactions
  for each row execute function app_private.trg_finance_direct_receipt_cancel();

-- ---------------------------------------------------------------------------
-- 5. Ma trận duyệt v2: Giám đốc tài chính dự phòng bước Kế toán trưởng
-- ---------------------------------------------------------------------------
do $$
declare v_old uuid; v_new uuid;
begin
  select id into v_old from public.finance_approval_matrix_versions where is_current;
  update public.finance_approval_matrix_versions set is_current = false where id = v_old;
  insert into public.finance_approval_matrix_versions (version_no, is_current, note)
  values ((select max(version_no) + 1 from public.finance_approval_matrix_versions), true,
    'Chủ sản phẩm duyệt 02/10/2026: thêm Giám đốc tài chính làm người dự phòng ở bước Kế toán trưởng (người lập không tự duyệt)')
  returning id into v_new;
  insert into public.finance_approval_rules (version_id, tier_no, min_amount, max_amount, steps)
  select v_new, r.tier_no, r.min_amount, r.max_amount,
    (select jsonb_agg(case when s->>'label' like 'Kế toán trưởng%' and not (s->'approverIds') ? '1b7bd7cb-54c3-43b5-b0ff-44ce63b8bd11'
      then jsonb_set(s, '{approverIds}', (s->'approverIds') || '["1b7bd7cb-54c3-43b5-b0ff-44ce63b8bd11"]'::jsonb) else s end order by o)
     from jsonb_array_elements(r.steps) with ordinality x(s, o))
  from public.finance_approval_rules r where r.version_id = v_old;
  insert into public.finance_events (entity_type, entity_id, action, reason, payload)
  values ('approval_matrix', v_new::text, 'matrix_save', 'Chủ sản phẩm duyệt 02/10/2026: thêm GĐ tài chính dự phòng bước Kế toán trưởng',
    jsonb_build_object('previousVersionId', v_old));
end $$;

-- ---------------------------------------------------------------------------
-- 6. Hàm có sẵn: trigger ghi nhận chi phí từ công nợ + nguồn gốc ở chi tiết NCC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.sync_supplier_payable_recognition_transaction()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_finance_id text := '';
  v_source_ref text;
  v_recognized_amount numeric(18,2);
begin
  if tg_op = 'DELETE' then
    if old.source_type in ('supplier_delivery_statement', 'direct_supplier_receipt') then
      update public.project_transactions
      set
        amount = 0,
        description = 'Ngừng ghi nhận công nợ vật tư NCC ' || old.supplier_name_snapshot || ' - ' || old.code
      where source_ref = 'supplier_payable_document:' || old.id::text || ':recognition';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE'
     and old.source_type in ('supplier_delivery_statement', 'direct_supplier_receipt')
     and new.source_type not in ('supplier_delivery_statement', 'direct_supplier_receipt')
  then
    update public.project_transactions
    set
      amount = 0,
      description = 'Ngừng ghi nhận công nợ vật tư NCC ' || old.supplier_name_snapshot || ' - ' || old.code
    where source_ref = 'supplier_payable_document:' || old.id::text || ':recognition';
  end if;

  -- K3a-3: phiếu nhập trực tiếp NCC cũng ghi chi phí khi ghi nợ; kho không thuộc dự án (cấp công ty) thì không ghi chi phí.
  if new.source_type not in ('supplier_delivery_statement', 'direct_supplier_receipt') or (new.project_id is null and new.construction_site_id is null) then
    return new;
  end if;

  select finance.id into v_finance_id
  from public.project_finances finance
  where (new.project_id is not null and finance.project_id = new.project_id)
     or (new.construction_site_id is not null and finance.construction_site_id = new.construction_site_id)
  order by
    case when new.project_id is not null and finance.project_id = new.project_id then 0 else 1 end,
    finance.id
  limit 1;

  v_source_ref := 'supplier_payable_document:' || new.id::text || ':recognition';
  v_recognized_amount := case
    when new.status = 'cancelled' then 0
    else greatest(coalesce(new.recognized_amount, 0), 0)
  end;

  insert into public.project_transactions (
    id, "projectFinanceId", "constructionSiteId", project_id, project_finance_id, construction_site_id,
    type, category, amount, description, date, source, "sourceRef", source_ref,
    attachments, "createdBy", "createdAt", counterparty_name, counterparty_partner_id
  )
  values (
    'supplier-ap-recognition-' || new.id::text,
    coalesce(v_finance_id, ''),
    coalesce(new.construction_site_id, ''),
    new.project_id,
    nullif(v_finance_id, ''),
    new.construction_site_id,
    'expense',
    'materials',
    v_recognized_amount,
    'Ghi nhận công nợ vật tư NCC ' || new.supplier_name_snapshot || ' - ' || new.code,
    coalesce(new.document_date, current_date)::text,
    'workflow',
    v_source_ref,
    v_source_ref,
    '[]'::jsonb,
    coalesce(new.created_by::text, 'system'),
    coalesce(new.created_at, now()),
    new.supplier_name_snapshot,
    new.supplier_id
  )
  on conflict (source_ref) do update
  set
    "projectFinanceId" = excluded."projectFinanceId",
    "constructionSiteId" = excluded."constructionSiteId",
    project_id = excluded.project_id,
    project_finance_id = excluded.project_finance_id,
    construction_site_id = excluded.construction_site_id,
    type = excluded.type,
    category = excluded.category,
    amount = excluded.amount,
    description = excluded.description,
    date = excluded.date,
    source = excluded.source,
    "sourceRef" = excluded."sourceRef",
    counterparty_name = excluded.counterparty_name,
    counterparty_partner_id = excluded.counterparty_partner_id;

  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.get_finance_supplier_v1(p_supplier_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
declare v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_actor uuid := public.current_app_user_id();
  v_bp public.business_partners%rowtype; v_set public.finance_settings%rowtype;
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  select * into v_bp from public.business_partners where id = p_supplier_id;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_SUPPLIER_NOT_FOUND'; end if;
  select * into v_set from public.finance_settings where id = 1;
  return jsonb_build_object(
    'today', v_today, 'cutoverDate', v_set.ap_cutover_date, 'defaultPaymentDays', v_set.default_payment_days,
    'can', app_private.finance_can_flags(), 'currentUserId', v_actor,
    'supplier', jsonb_build_object('id', v_bp.id, 'name', v_bp.name, 'code', v_bp.code, 'taxCode', v_bp.tax_code,
      'bankName', v_bp.bank_name, 'bankAccount', v_bp.bank_account,
      'internal', exists (select 1 from public.finance_internal_partners ip where ip.supplier_id = v_bp.id),
      'internalReason', (select ip.reason from public.finance_internal_partners ip where ip.supplier_id = v_bp.id),
      'terms', (select jsonb_build_object('paymentDays', t.payment_days, 'note', t.note, 'updatedAt', t.updated_at,
        'updatedByName', app_private.finance_user_name(t.updated_by)) from public.supplier_payment_terms t where t.supplier_id = v_bp.id)),
    'contracts', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'status', c.status,
        'paymentTermDays', c.payment_term_days, 'paymentTermsText', c.payment_terms, 'requireInvoice', c.require_invoice_before_payment) order by c.code)
      from public.supplier_contracts c where c.supplier_id = v_bp.id), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'code', r.code, 'documentNo', r.document_no, 'sourceType', r.source_type, 'origin', r.origin,
        'projectId', r.project_id, 'projectCode', r.project_code, 'projectName', r.project_name,
        'contractId', r.contract_id, 'contractCode', r.contract_code,
        'documentDate', r.document_date, 'dueDate', r.due_date, 'dueSource', r.due_date_source,
        'recognized', r.recognized, 'credit', r.credit, 'paid', r.paid, 'outstanding', r.outstanding,
        'pendingExternal', r.pending_external, 'status', r.status, 'issues', to_jsonb(r.issues), 'createdAt', r.created_at,
        'provenance', case r.source_type
          when 'purchase_delivery_receipt' then (select jsonb_build_object('poNumber', po.po_number, 'poId', po.id, 'deliveryNo', b.delivery_no,
              'warehouse', (select w.name from public.transactions t join public.warehouses w on w.id = t.target_warehouse_id where t.id = b.wms_transaction_id),
              'receivedAt', b.received_at, 'receivedByName', app_private.finance_user_name(b.received_by))
            from public.purchase_order_delivery_batches b join public.purchase_orders po on po.id = b.purchase_order_id where b.id::text = r.source_id)
          when 'supplier_delivery_statement' then (select jsonb_build_object('statementCode', st.code, 'periodMonth', st.period_month,
              'notes', (select count(distinct l.delivery_note_id) from public.supplier_direct_delivery_lines l where l.statement_id = st.id),
              'createdByName', app_private.finance_user_name(st.created_by), 'confirmedByName', st.metadata->>'confirmedByName',
              'postedByName', app_private.finance_user_name(st.posted_by), 'postedAt', st.posted_at)
            from public.supplier_delivery_statements st where st.id::text = r.source_id)
          when 'opening_balance' then (select jsonb_build_object('reconciliationId', o.id, 'misaAmount', o.misa_amount,
              'createdByName', app_private.finance_user_name(o.created_by), 'confirmedByName', app_private.finance_user_name(o.decided_by), 'confirmedAt', o.decided_at)
            from public.finance_opening_reconciliations o where o.id::text = r.source_id)
          when 'direct_supplier_receipt' then (select jsonb_build_object('transactionId', t.id, 'warehouse', w.name, 'note', t.note,
              'receivedByName', app_private.finance_user_name(coalesce(t.created_by, t.requester_id)), 'approvedByName', app_private.finance_user_name(t.approver_id),
              'postedByName', app_private.finance_user_name(nullif(d.metadata->>'postedById', '')::uuid), 'postedAt', d.metadata->>'postedAt',
              'netAmount', d.metadata->'netAmount', 'vatRate', d.metadata->'vatRate', 'vatAmount', d.metadata->'vatAmount',
              'priceIncludesVat', d.metadata->'priceIncludesVat', 'duplicateOf', d.metadata->>'duplicateOf')
            from public.supplier_payable_documents d join public.transactions t on t.id = d.source_id
            left join public.warehouses w on w.id = t.target_warehouse_id where d.id = r.id)
          else null end,
        'pendingAdjustment', (select jsonb_build_object('id', j.id, 'kind', j.kind, 'reason', j.reason, 'createdBy', j.created_by,
            'createdByName', app_private.finance_user_name(j.created_by), 'createdAt', j.created_at)
          from public.finance_payable_adjustments j where j.payable_document_id = r.id and j.status = 'submitted'))
        order by r.project_code, r.contract_code nulls last, r.document_date, r.document_no)
      from app_private.finance_payable_rows() r where r.supplier_id = v_bp.id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', pb.id, 'code', pb.code, 'status', pb.status, 'rowVersion', pb.row_version,
        'external', coalesce((pb.metadata->>'external')::boolean, false), 'projectId', pb.project_id,
        'projectCode', (select code from public.projects where id = pb.project_id), 'paymentDate', pb.payment_date, 'amount', pb.payment_amount,
        'method', pb.payment_method, 'documentRef', pb.document_ref, 'note', pb.note, 'attachments', pb.attachments,
        'createdBy', pb.created_by, 'createdByName', app_private.finance_user_name(pb.created_by), 'createdAt', pb.created_at,
        'paidByName', app_private.finance_user_name(pb.paid_by), 'paidAt', pb.paid_at, 'rejection', pb.metadata->'rejection',
        'reversal', pb.metadata->>'g7ReversalReason',
        'allocations', (select jsonb_agg(jsonb_build_object('documentId', a.payable_document_id, 'documentNo', a.document_no_snapshot, 'amount', a.allocated_amount))
          from public.supplier_payment_allocations a where a.payment_batch_id = pb.id)) order by pb.payment_date desc, pb.created_at desc)
      from public.supplier_payment_batches pb where pb.supplier_id = v_bp.id), '[]'::jsonb),
    'openings', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'projectId', o.project_id,
        'projectCode', (select code from public.projects where id = o.project_id), 'status', o.status, 'revision', o.revision,
        'cutoverDate', o.cutover_date, 'misaAmount', o.misa_amount, 'viooOutstanding', o.vioo_outstanding, 'openingAmount', o.opening_amount,
        'note', o.note, 'attachments', o.attachments, 'reviewedDocumentIds', to_jsonb(o.reviewed_document_ids),
        'createdBy', o.created_by, 'createdByName', app_private.finance_user_name(o.created_by), 'createdAt', o.created_at,
        'submittedByName', app_private.finance_user_name(o.submitted_by), 'submittedAt', o.submitted_at,
        'decidedByName', app_private.finance_user_name(o.decided_by), 'decidedAt', o.decided_at, 'decisionNote', o.decision_note,
        'openingDocumentId', o.opening_document_id) order by o.created_at desc)
      from public.finance_opening_reconciliations o where o.supplier_id = v_bp.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'entityType', e.entity_type, 'actorName', app_private.finance_user_name(e.actor_id),
        'reason', e.reason, 'payload', e.payload, 'at', e.created_at) order by e.created_at desc)
      from (select * from public.finance_events where supplier_id = v_bp.id order by created_at desc limit 100) e), '[]'::jsonb));
end;
$$;

revoke all on function app_private.finance_direct_receipt_rows(), app_private.finance_set_direct_receipt_price(text, integer, numeric, uuid),
  app_private.trg_finance_direct_receipt_cancel() from public, anon, authenticated;
revoke all on function public.list_finance_direct_receipts_v1(), public.post_finance_direct_receipts_v1(jsonb), public.return_finance_direct_receipts_v1(jsonb) from public, anon;
grant execute on function public.list_finance_direct_receipts_v1(), public.post_finance_direct_receipts_v1(jsonb), public.return_finance_direct_receipts_v1(jsonb) to authenticated;

notify pgrst, 'reload schema';
