-- Mua hàng — Ngày nghiệp vụ (ghi nhận theo ngày thực tế) + sửa lỗi "nhận 1 bước ép PO Đã nhận đủ". Chủ SP chốt 08/10/2026 (doc 13 mục 21):
--  A. Công nợ ghi nhận theo NGÀY HÀNG VỀ (ngày chứng từ phiếu nhập), không theo ngày bấm.
--  B. Ghi lùi ngày tối đa 7 ngày; lùi xa hơn cần ô quyền "Mua hàng → Nhập dữ liệu quá khứ" (Admin luôn có). Không ngày tương lai.
--  C. Nhận 1 bước ở Vật tư → Nhập xuất: đơn về thiếu giữ "Về một phần" (trước đây luôn ép "Đã nhận đủ"); chặn duyệt khi đợt đang đối chiếu.
--  D. Đơn mua có Ngày đặt hàng chọn được. Sửa ngày phiếu nhận hàng kéo theo công nợ, chi phí dự án, phiếu giao theo HĐ (kỳ đối soát).

insert into public.permission_actions (module_code, action, permission_code, label, description, scope_modes, legacy_module_key,
  legacy_route, legacy_admin_only, sort_order, is_active, risk_level, is_business_action, is_business_approval,
  direct_grant_requires_expiry, grant_readiness, access_application_code, direct_grant_allowed)
values ('system.procurement', 'backdate', 'system.procurement.backdate', 'Nhập dữ liệu quá khứ',
  'Ghi ngày nghiệp vụ lùi quá 7 ngày: ngày đặt hàng, ngày hàng về, ngày chứng từ kho. Cấp khi nhập bù lịch sử, gỡ khi xong.',
  array['global'], 'PROCUREMENT', '/procurement', false, 90, true, 'sensitive', true, false, false, 'enforced', 'procurement', true)
on conflict (permission_code) do nothing;

-- Được ghi ngày nghiệp vụ p_date? Không tương lai; lùi quá 7 ngày cần ô Nhập dữ liệu quá khứ hoặc Admin.
create function app_private.assert_business_date(p_date date)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_actor uuid := public.current_app_user_id();
begin
  if p_date is null then return; end if;
  if p_date > v_today then raise exception using errcode = '22023', message = 'BUSINESS_DATE_FUTURE: Ngày nghiệp vụ không được sau hôm nay.'; end if;
  if p_date < v_today - 7 and v_actor is not null and not (public.is_admin()
      or app_private.has_permission(v_actor, 'system.procurement.backdate', 'global', '*')) then
    raise exception using errcode = '42501', message = format('BUSINESS_DATE_BACKDATE: Ngày %s lùi quá 7 ngày — cần quyền "Nhập dữ liệu quá khứ" (Admin cấp ở Cài đặt → Người dùng).',
      to_char(p_date, 'DD/MM/YYYY'));
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.set_wms_document_date_v1(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_tx public.transactions%rowtype;
  v_new timestamptz;
  v_reason text := nullif(btrim(coalesce(p->>'reason', '')), '');
  v_posted boolean;
  v_inv uuid[];
  r record;
  v_before numeric; v_after numeric;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'WMS_DOC_DATE_DENIED'; end if;
  select * into v_tx from public.transactions where id = p->>'transactionId' for update;
  if not found then raise exception using errcode = 'P0002', message = 'WMS_DOC_NOT_FOUND'; end if;
  if not (public.is_admin() or app_private.has_permission(v_actor, 'wms.accounting.manage', 'global', '*')
      or app_private.wms_user_is_keeper(v_actor, v_tx.source_warehouse_id) or app_private.wms_user_is_keeper(v_actor, v_tx.target_warehouse_id)) then
    raise exception using errcode = '42501', message = 'WMS_DOC_DATE_DENIED';
  end if;
  if v_tx.status::text in ('CANCELLED', 'REJECTED') then raise exception using errcode = '22023', message = 'WMS_DOC_DATE_STATE'; end if;
  begin v_new := ((p->>'date')::date + time '12:00') at time zone 'Asia/Ho_Chi_Minh';
  exception when others then raise exception using errcode = '22023', message = 'WMS_DOC_DATE_INVALID'; end;
  if v_new is null or (p->>'date')::date > (now() at time zone 'Asia/Ho_Chi_Minh')::date then raise exception using errcode = '22023', message = 'WMS_DOC_DATE_FUTURE'; end if;
  if (p->>'date')::date < date '2025-01-01' then raise exception using errcode = '22023', message = 'WMS_DOC_DATE_INVALID'; end if;
  perform app_private.assert_business_date((p->>'date')::date); -- lùi quá 7 ngày cần quyền Nhập dữ liệu quá khứ
  select array_agg(id) into v_inv from public.inventory_transactions where source_type = 'wms_transaction' and source_id = v_tx.id and status = 'posted';
  v_posted := v_inv is not null;
  if v_posted and v_reason is null then raise exception using errcode = '22023', message = 'WMS_DOC_DATE_REASON'; end if;

  update public.transactions set date = v_new where id = v_tx.id;
  -- Ngày nghiệp vụ: phiếu nhận hàng theo đơn mua kéo theo công nợ, chi phí dự án, phiếu giao theo HĐ (kỳ đối soát).
  if v_tx.source_type = 'po_delivery_batch' and nullif(v_tx.source_id, '') is not null then
    if exists (select 1 from public.supplier_direct_delivery_notes n where n.source_delivery_batch_id::text = v_tx.source_id and n.status = 'statemented') then
      raise exception using errcode = '22023', message = 'WMS_DOC_DATE_STATEMENTED: Phiếu giao đã nằm trong bảng đối soát đã chốt — mở lại bảng đối soát trước khi đổi ngày.';
    end if;
    update public.supplier_direct_delivery_notes set delivery_date = (p->>'date')::date, updated_at = now() where source_delivery_batch_id::text = v_tx.source_id;
    update public.supplier_payable_documents set document_date = (p->>'date')::date, updated_at = now()
    where source_type = 'purchase_delivery_receipt' and source_id = v_tx.source_id and status not in ('cancelled', 'reversed');
    update public.project_transactions set date = p->>'date' where source_ref = 'purchase_receipt:' || v_tx.source_id;
  end if;
  if v_posted then
    create temp table if not exists wms_doc_date_mins(material_id text, warehouse_id text, before_min numeric) on commit drop;
    delete from pg_temp.wms_doc_date_mins;
    insert into pg_temp.wms_doc_date_mins
      select distinct e.material_id, e.warehouse_id, app_private.wms_min_running_balance(e.material_id, e.warehouse_id, '-infinity')
      from public.inventory_ledger_entries e where e.inventory_transaction_id = any(v_inv);
    update public.inventory_transactions set transaction_date = v_new where id = any(v_inv);
    update public.inventory_ledger_entries set transaction_date = v_new where inventory_transaction_id = any(v_inv);
    for r in select * from pg_temp.wms_doc_date_mins loop
      v_after := app_private.wms_min_running_balance(r.material_id, r.warehouse_id, '-infinity');
      if v_after < -0.0005 and v_after < r.before_min - 0.0005 then
        raise exception using errcode = 'P0001', message = format('WMS_BACKDATE_NEGATIVE: Đổi ngày làm "%s" tại "%s" âm tồn trong quá khứ (thấp nhất %s). Chọn ngày khác hoặc nhập bù trước.',
          coalesce((select name from public.items where id = r.material_id), r.material_id), coalesce((select name from public.warehouses where id = r.warehouse_id), r.warehouse_id),
          trim(to_char(v_after, 'FM999G999G990D###')));
      end if;
    end loop;
  end if;
  insert into public.wms_document_date_events (transaction_id, old_date, new_date, was_posted, reason, actor_id)
  values (v_tx.id, v_tx.date, v_new, v_posted, v_reason, v_actor);
  return jsonb_build_object('transactionId', v_tx.id, 'date', v_new, 'posted', v_posted);
end $function$;

CREATE OR REPLACE FUNCTION public.update_transaction_voucher_metadata(p_transaction_id text, p_date timestamp with time zone, p_note text DEFAULT NULL::text)
 RETURNS transactions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tx public.transactions%rowtype;
  v_user public.users%rowtype;
  v_can_approve boolean;
begin
  select * into v_tx
  from public.transactions
  where id = p_transaction_id
  for update;
  if not found then
    raise exception 'transaction not found: %', p_transaction_id;
  end if;

  select * into v_user
  from public.users
  where id = public.current_app_user_id();
  if v_user.id is null then
    raise exception 'authentication required';
  end if;

  if v_tx.status <> 'PENDING'::public.transaction_status then
    raise exception 'only pending transactions can have voucher metadata edited'
      using errcode = '55000';
  end if;

  v_can_approve := app_private.wms_has_action(
    'wms.transaction.approve',
    v_tx.source_warehouse_id,
    v_tx.target_warehouse_id,
    v_tx.requester_id,
    v_tx.approver_id,
    v_user.id
  );

  if v_tx.requester_id is distinct from v_user.id and not v_can_approve then
    raise exception 'insufficient privilege to edit voucher metadata'
      using errcode = '42501';
  end if;

  if p_date is null then
    raise exception 'voucher date is required';
  end if;
  if p_date is distinct from v_tx.date then
    perform app_private.assert_business_date((p_date at time zone 'Asia/Ho_Chi_Minh')::date); -- Ngày nghiệp vụ: lùi quá 7 ngày cần quyền
  end if;

  update public.transactions
  set date = p_date,
      note = nullif(trim(coalesce(p_note, '')), ''),
      updated_by = v_user.id
  where id = v_tx.id
  returning * into v_tx;

  return v_tx;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_receipt_reconciliation_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_batch_id uuid := nullif(p_input->>'deliveryBatchId', '')::uuid;
  v_decision text := p_input->>'decision';
  v_remainder text := coalesce(nullif(p_input->>'remainder', ''), 'keep_open');
  v_arrival date := nullif(p_input->>'arrivalDate', '')::date;
  v_reason text := nullif(btrim(coalesce(p_input->>'reason', '')), '');
  v_confirm text := nullif(p_input->>'confirmAs', '');
  v_expected integer := nullif(p_input->>'expectedRevision', '')::integer;
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_c record;
  v_b public.purchase_order_delivery_batches%rowtype;
  v_r public.procurement_receipt_reconciliations%rowtype;
  v_before jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_l record;
  v_qty numeric;
  v_given jsonb := coalesce(p_input->'lines', '[]'::jsonb);
  v_diff boolean := false;
  v_shortfall boolean := false;
  v_any boolean := false;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  select * into v_b from public.purchase_order_delivery_batches where id = v_batch_id for update;
  if not found then raise exception using errcode = '22023', message = 'RECEIPT_RECON_BATCH_CLOSED'; end if;
  select * into v_c from app_private.receipt_recon_candidates() c where c.batch_id = v_batch_id;
  if not found then raise exception using errcode = '22023', message = 'RECEIPT_RECON_BATCH_CLOSED'; end if;
  if not (app_private.receipt_recon_is_buyer() or app_private.receipt_recon_is_keeper(v_c.warehouse_id)) then
    raise exception using errcode = '42501', message = 'RECEIPT_RECON_EDIT_DENIED'; end if;
  if v_confirm = 'buyer' and not app_private.receipt_recon_is_buyer()
     or v_confirm = 'keeper' and not app_private.receipt_recon_is_keeper(v_c.warehouse_id)
     or v_confirm not in ('buyer', 'keeper') then
    raise exception using errcode = '42501', message = 'RECEIPT_RECON_CONFIRM_DENIED'; end if;
  if v_decision is null or v_decision not in ('full', 'partial', 'none') then
    raise exception using errcode = '22023', message = 'RECEIPT_RECON_DECISION_INVALID'; end if;
  if v_remainder not in ('keep_open', 'close') then raise exception using errcode = '22023', message = 'RECEIPT_RECON_DECISION_INVALID'; end if;

  if v_decision = 'none' then
    v_arrival := null;
  elsif v_arrival is null or v_arrival > v_today or v_arrival < date '2026-01-01' then
    raise exception using errcode = '22023', message = 'RECEIPT_RECON_ARRIVAL_INVALID';
  end if;
  if v_decision <> 'none' then perform app_private.assert_business_date(v_arrival); end if; -- lùi quá 7 ngày cần quyền

  if v_decision <> 'none' then
    if jsonb_typeof(v_given) <> 'array' then raise exception using errcode = '22023', message = 'RECEIPT_RECON_LINES_INVALID'; end if;
    for v_l in select l.id, coalesce(l.planned_qty, 0) planned, st.stocked_stock_qty, st.stock_factor
      from public.purchase_order_delivery_lines l left join app_private.receipt_recon_stocked(v_batch_id) st on st.delivery_line_id = l.id
      where l.delivery_batch_id = v_batch_id order by l.id
    loop
      if v_decision = 'full' then
        v_qty := v_l.planned;
      else
        select (x->>'receivedQty')::numeric into v_qty from jsonb_array_elements(v_given) x
        where x->>'deliveryLineId' = v_l.id::text limit 1;
        if v_qty is null or v_qty < 0 or v_qty > 1e12 then
          raise exception using errcode = '22023', message = 'RECEIPT_RECON_LINES_INVALID'; end if;
      end if;
      v_qty := round(v_qty, 6);
      if v_l.stocked_stock_qty is not null and v_qty * v_l.stock_factor < v_l.stocked_stock_qty - 0.000001 then
        raise exception using errcode = '22023', message = 'RECEIPT_RECON_BELOW_STOCKED'; end if;
      v_diff := v_diff or v_qty <> v_l.planned;
      v_shortfall := v_shortfall or v_qty < v_l.planned;
      v_any := v_any or v_qty > 0;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('deliveryLineId', v_l.id, 'receivedQty', v_qty));
    end loop;
    if jsonb_array_length(v_lines) = 0 then raise exception using errcode = '22023', message = 'RECEIPT_RECON_LINES_INVALID'; end if;
    if v_decision = 'partial' and jsonb_array_length(v_given) <> jsonb_array_length(v_lines) then
      raise exception using errcode = '22023', message = 'RECEIPT_RECON_LINES_INVALID'; end if;
    if not v_any then raise exception using errcode = '22023', message = 'RECEIPT_RECON_USE_NONE'; end if;
    if v_decision = 'partial' and not v_diff then v_decision := 'full'; end if;
  else
    if v_c.stocked then raise exception using errcode = '22023', message = 'RECEIPT_RECON_BELOW_STOCKED'; end if;
    v_shortfall := true;
  end if;
  if v_decision <> 'full' and v_reason is null then raise exception using errcode = '22023', message = 'RECEIPT_RECON_REASON_REQUIRED'; end if;

  select * into v_r from public.procurement_receipt_reconciliations
  where delivery_batch_id = v_batch_id and status = 'open' for update;
  if v_r.id is null then
    if v_expected is not null then raise exception using errcode = '40001', message = 'RECEIPT_RECON_REVISION_CONFLICT'; end if;
    insert into public.procurement_receipt_reconciliations (delivery_batch_id, purchase_order_id, warehouse_id, wms_transaction_id,
      decision, remainder, arrival_date, lines, reason, created_by, updated_by)
    values (v_batch_id, v_c.purchase_order_id, v_c.warehouse_id, v_c.tx_id, v_decision, v_remainder, v_arrival, v_lines, v_reason, v_actor, v_actor)
    returning * into v_r;
    insert into public.procurement_receipt_reconciliation_events (reconciliation_id, action, actor_id, revision, after)
    values (v_r.id, 'create', v_actor, v_r.revision, app_private.receipt_recon_snapshot(v_r));
  else
    if v_expected is distinct from v_r.revision then raise exception using errcode = '40001', message = 'RECEIPT_RECON_REVISION_CONFLICT'; end if;
    if (v_r.decision, v_r.remainder, v_r.arrival_date, v_r.lines, coalesce(v_r.reason, ''))
       is distinct from (v_decision, v_remainder, v_arrival, v_lines, coalesce(v_reason, '')) then
      v_before := app_private.receipt_recon_snapshot(v_r);
      -- Nội dung đổi: mọi xác nhận trước đó mất hiệu lực.
      update public.procurement_receipt_reconciliations
      set decision = v_decision, remainder = v_remainder, arrival_date = v_arrival, lines = v_lines, reason = v_reason,
        revision = revision + 1, buyer_confirmed_by = null, buyer_confirmed_at = null, keeper_confirmed_by = null, keeper_confirmed_at = null,
        rejection = null, updated_by = v_actor, updated_at = now()
      where id = v_r.id returning * into v_r;
      insert into public.procurement_receipt_reconciliation_events (reconciliation_id, action, actor_id, revision, before, after)
      values (v_r.id, 'save', v_actor, v_r.revision, v_before, app_private.receipt_recon_snapshot(v_r));
    end if;
  end if;

  if v_confirm is not null then
    perform public.confirm_receipt_reconciliation_v1(jsonb_build_object('reconciliationId', v_r.id, 'side', v_confirm, 'revision', v_r.revision));
  end if;
  return app_private.receipt_recon_item(v_batch_id);
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.post_purchase_receipt_finance_v2(p_delivery_batch_id uuid, p_actor_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_po public.purchase_orders%rowtype;
  v_tx public.transactions%rowtype;
  v_project_finance_id text;
  v_received_gross numeric(18,2);
  v_committed_gross numeric(18,2);
  v_source_ref text := 'purchase_receipt:' || p_delivery_batch_id::text;
  v_description text;
  v_existing_cost public.project_transactions%rowtype;
  v_existing_ap public.supplier_payable_documents%rowtype;
begin
  select * into v_batch
  from public.purchase_order_delivery_batches
  where id = p_delivery_batch_id
  for update;
  if not found then
    raise exception 'Khong tim thay Dot giao %.', p_delivery_batch_id using errcode = '22023';
  end if;

  v_received_gross := round(coalesce(v_batch.accepted_gross_amount, 0), 2);
  if v_received_gross <= 0 then
    return;
  end if;

  select * into v_po
  from public.purchase_orders
  where id = v_batch.purchase_order_id
  for update;
  if not found then
    raise exception 'Khong tim thay Goi mua hang cua Dot giao %.', p_delivery_batch_id using errcode = '22023';
  end if;

  -- Việc 2: đơn gom ghi công nợ và chi phí cho dự án của công trường nhận (đợt giao).
  v_po.project_id := coalesce(v_batch.project_id, v_po.project_id);
  v_po.construction_site_id := coalesce(v_batch.construction_site_id, v_po.construction_site_id);

  select * into v_tx
  from public.transactions
  where id = v_batch.wms_transaction_id
  for update;
  if not found then
    raise exception 'Khong tim thay WMS cua Dot giao %.', p_delivery_batch_id using errcode = '22023';
  end if;
  if v_tx.status <> 'COMPLETED'::public.transaction_status then
    raise exception 'Chi ghi nhan chi phi receipt khi WMS da COMPLETED.' using errcode = '22023';
  end if;

  -- Việc 4: đơn gọi hàng theo HĐ nguyên tắc ghi nợ khi chốt đối soát tháng, không ghi lúc nhận.
  if v_po.supplier_contract_id is not null then
    perform app_private.procurement_contract_receipt_note(p_delivery_batch_id, p_actor_user_id);
    return;
  end if;

  select round(coalesce(sum(
    coalesce(line.planned_qty, 0)
    * coalesce(line.delivery_unit_price, 0)
    * (1 + coalesce(v_batch.vat_rate, 0) / 100)
  ), 0), 2)
  into v_committed_gross
  from public.purchase_order_delivery_lines line
  where line.delivery_batch_id = p_delivery_batch_id;

  select id into v_project_finance_id
  from public.project_finances
  where (v_po.project_id is not null and project_id = v_po.project_id)
     or (v_po.construction_site_id is not null and construction_site_id = v_po.construction_site_id)
  limit 1;

  v_description := 'Nhận hàng NCC '
    || coalesce(v_batch.supplier_name_snapshot, v_po.vendor_name, v_po.vendor_id, 'Nhà cung cấp')
    || ' - '
    || coalesce(v_po.po_number, v_po.id)
    || ' - đợt '
    || coalesce(v_batch.delivery_no::text, p_delivery_batch_id::text);

  select * into v_existing_cost
  from public.project_transactions
  where source_ref = v_source_ref
  for update;
  if found then
    if round(coalesce(v_existing_cost.amount, 0), 2) <> v_received_gross then
      raise exception 'Anomaly: chi phi receipt da ton tai voi gia tri khac.' using errcode = 'P0001';
    end if;
  else
    insert into public.project_transactions (
      id, "projectFinanceId", "constructionSiteId",
      project_id, project_finance_id, construction_site_id,
      type, category, amount, description, date, source,
      "sourceRef", source_ref, contract_cost_item_id,
      cost_classification_status, counterparty_partner_id,
      counterparty_name, attachments, "createdBy", "createdAt"
    )
    values (
      'purchase-receipt-' || p_delivery_batch_id::text,
      coalesce(v_project_finance_id, ''),
      coalesce(v_po.construction_site_id, ''),
      v_po.project_id,
      nullif(v_project_finance_id, ''),
      v_po.construction_site_id,
      'expense',
      'materials',
      v_received_gross,
      v_description,
      coalesce((v_tx.date at time zone 'Asia/Ho_Chi_Minh')::date, current_date)::text, -- Ngày nghiệp vụ: chi phí theo ngày hàng về
      'workflow',
      v_source_ref,
      v_source_ref,
      null,
      'auto',
      null,
      coalesce(v_batch.supplier_name_snapshot, v_po.vendor_name, v_po.vendor_id, 'Nhà cung cấp'),
      coalesce(v_tx.attachments, '[]'::jsonb),
      p_actor_user_id::text,
      now()
    )
    on conflict (source_ref) do nothing;
  end if;

  select * into v_existing_ap
  from public.supplier_payable_documents
  where source_type = 'purchase_delivery_receipt'
    and source_id = p_delivery_batch_id::text
  for update;
  if found then
    if round(coalesce(v_existing_ap.recognized_amount, 0), 2) <> v_received_gross
       or round(coalesce(v_existing_ap.committed_amount, 0), 2) <> v_committed_gross then
      raise exception 'Anomaly: AP receipt da ton tai voi gia tri khac.' using errcode = 'P0001';
    end if;
    return;
  end if;

  insert into public.supplier_payable_documents (
    code, source_type, source_id, project_id, construction_site_id,
    supplier_id, supplier_name_snapshot, document_no, document_date, due_date,
    committed_amount, recognized_amount, credit_amount, status, qr_token,
    metadata, created_by
  )
  values (
    'AP-REC-' || replace(p_delivery_batch_id::text, '-', ''),
    'purchase_delivery_receipt',
    p_delivery_batch_id::text,
    v_po.project_id,
    v_po.construction_site_id,
    v_batch.supplier_id,
    coalesce(v_batch.supplier_name_snapshot, v_po.vendor_name, v_po.vendor_id, 'Nhà cung cấp'),
    coalesce(v_po.po_number, v_po.id) || '-' || lpad(coalesce(v_batch.delivery_no, 0)::text, 2, '0'),
    coalesce((v_tx.date at time zone 'Asia/Ho_Chi_Minh')::date, current_date), -- công nợ theo ngày hàng về (chủ SP 08/10)
    null,
    v_committed_gross,
    v_received_gross,
    0,
    'open',
    'ap_receipt_' || replace(p_delivery_batch_id::text, '-', ''),
    jsonb_build_object(
      'purchaseOrderId', v_po.id,
      'purchaseOrderNo', v_po.po_number,
      'deliveryBatchId', p_delivery_batch_id,
      'wmsTransactionId', v_tx.id,
      'fulfillmentMode', v_batch.fulfillment_mode,
      'sourceRef', v_source_ref
    ),
    p_actor_user_id
  )
  on conflict (source_type, source_id) do nothing;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.procurement_contract_receipt_note(p_batch_id uuid, p_actor uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_b public.purchase_order_delivery_batches%rowtype;
  v_po public.purchase_orders%rowtype;
  v_c public.supplier_contracts%rowtype;
  v_note_id uuid;
  v_date date;
begin
  select id into v_note_id from public.supplier_direct_delivery_notes where source_delivery_batch_id = p_batch_id;
  if found then return v_note_id; end if;
  select * into v_b from public.purchase_order_delivery_batches where id = p_batch_id;
  select * into v_po from public.purchase_orders where id = v_b.purchase_order_id;
  select * into v_c from public.supplier_contracts where id = v_po.supplier_contract_id;
  -- Ngày nghiệp vụ: phiếu giao theo HĐ mang ngày hàng về (ngày chứng từ phiếu nhập), không theo lúc bấm nhận.
  v_date := coalesce((select (t.date at time zone 'Asia/Ho_Chi_Minh')::date from public.transactions t where t.id = v_b.wms_transaction_id),
    (v_b.received_at at time zone 'Asia/Ho_Chi_Minh')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  v_note_id := gen_random_uuid();
  insert into public.supplier_direct_delivery_notes (id, code, project_id, construction_site_id, supplier_contract_id, supplier_contract_code,
    supplier_id, supplier_name_snapshot, delivery_ticket_no, delivery_date, status, created_by, note, source_delivery_batch_id, purchase_order_id)
  values (v_note_id, 'GHHD-' || to_char(v_date, 'YYYYMMDD') || '-' || upper(substr(md5(p_batch_id::text), 1, 6)),
    coalesce(v_b.project_id, v_po.project_id), coalesce(v_b.construction_site_id, v_po.construction_site_id), v_c.id, v_c.code,
    coalesce(v_b.supplier_id, v_po.vendor_id), coalesce(v_b.supplier_name_snapshot, v_po.vendor_name, v_c.supplier_name, 'Nhà cung cấp'),
    coalesce(v_po.po_number, v_po.id) || '-' || lpad(coalesce(v_b.delivery_no, 0)::text, 2, '0'), v_date, 'accepted', p_actor,
    'Nhận theo đơn ' || coalesce(v_po.po_number, v_po.id) || ' đợt ' || coalesce(v_b.delivery_no::text, '')
      || case when v_b.fulfillment_mode = 'DIRECT_CONSUMPTION' then ' · nhập–xuất thẳng' else ' · nhập lưu kho' end,
    p_batch_id, v_po.id);
  insert into public.supplier_direct_delivery_lines (delivery_note_id, supplier_contract_id, supplier_contract_line_id, line_no, item_id,
    sku_snapshot, item_name_snapshot, unit_snapshot, quantity, unit_price, vat_rate, accepted_quantity, status, note,
    wms_flow_mode, target_warehouse_id, wms_import_transaction_id, wms_status, source_delivery_line_id)
  select v_note_id, v_c.id, nullif(x.value->>'contractLineId', '')::uuid, row_number() over (order by l.created_at, l.id), l.item_id,
    i.sku, coalesce(x.value->>'name', i.name, l.item_id), coalesce(l.unit, i.unit), l.accepted_qty, coalesce(l.delivery_unit_price, 0),
    coalesce(v_b.vat_rate, v_po.vat_rate, 0), l.accepted_qty, 'accepted',
    case when coalesce(x.value->>'priceSource', '') = 'manual' then 'Giá tạm trên đơn — chốt khi đối soát' end,
    'none', coalesce(v_b.target_warehouse_id, v_po.target_warehouse_id), v_b.wms_transaction_id, 'not_required', l.id
  from public.purchase_order_delivery_lines l
  left join public.items i on i.id = l.item_id
  left join lateral (select x.value from jsonb_array_elements(coalesce(v_po.items, '[]'::jsonb)) x
    where x.value->>'lineId' = l.purchase_order_line_id limit 1) x on true
  where l.delivery_batch_id = p_batch_id and coalesce(l.accepted_qty, 0) > 0;
  return v_note_id;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.finalize_purchase_receipt_v2(p_delivery_batch_id uuid, p_wms_transaction_id text, p_actor_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_po_id text;
  v_po public.purchase_orders%rowtype;
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_tx public.transactions%rowtype;
  v_item jsonb;
  v_item_id text;
  v_qty numeric;
  v_planned_purchase_qty numeric;
  v_accepted_purchase_qty numeric;
  v_delivery_status text;
  v_next_items jsonb;
  v_is_delivered boolean;
  v_already_recorded boolean;
  v_previous_guard text;
begin
  if p_actor_user_id is null then
    raise exception 'Nguoi thuc hien lenh khong hop le.' using errcode = '42501';
  end if;
  if public.current_app_user_id() is null or p_actor_user_id <> public.current_app_user_id() then
    raise exception 'Nguoi thuc hien lenh khong hop le.' using errcode = '42501';
  end if;

  select purchase_order_id into v_po_id
  from public.purchase_order_delivery_batches
  where id = p_delivery_batch_id;
  if not found then
    raise exception 'Khong tim thay Dot giao %.', p_delivery_batch_id using errcode = '22023';
  end if;

  select * into v_po
  from public.purchase_orders
  where id = v_po_id
  for update;
  if not found then
    raise exception 'Khong tim thay Goi mua hang cua Dot giao %.', p_delivery_batch_id using errcode = '22023';
  end if;

  select * into v_batch
  from public.purchase_order_delivery_batches
  where id = p_delivery_batch_id
  for update;
  if not found then
    raise exception 'Khong tim thay Dot giao %.', p_delivery_batch_id using errcode = '22023';
  end if;
  if v_batch.wms_transaction_id is distinct from p_wms_transaction_id then
    raise exception 'WMS transaction khong khop Dot giao.' using errcode = '22023';
  end if;

  select * into v_tx
  from public.transactions
  where id = p_wms_transaction_id
  for update;
  if not found then
    raise exception 'Khong tim thay WMS cua Dot giao.' using errcode = '22023';
  end if;
  if v_tx.source_type <> 'po_delivery_batch' or v_tx.source_id <> p_delivery_batch_id::text then
    raise exception 'WMS khong lien ket dung Dot giao.' using errcode = '22023';
  end if;
  if not app_private.current_user_can_receive_purchase_batch_v2(p_actor_user_id, v_tx.target_warehouse_id) then
    raise exception 'Nguoi dung khong co quyen xac nhan nhan hang tai kho nhan.' using errcode = '42501';
  end if;

  if v_batch.status in ('received', 'received_short', 'received_over')
     and v_tx.status = 'COMPLETED'::public.transaction_status then
    return app_private.purchase_receipt_command_result_v2(p_delivery_batch_id, true);
  end if;
  if v_batch.status in ('received', 'received_short', 'received_over')
     or v_tx.status = 'COMPLETED'::public.transaction_status then
    raise exception 'Anomaly: Dot giao va WMS khong dong bo trang thai finalize.' using errcode = 'P0001';
  end if;
  if v_batch.status <> 'quality_approved' or v_tx.status <> 'APPROVED'::public.transaction_status then
    raise exception 'Chi finalize Dot da duyet SL/CL va WMS APPROVED.' using errcode = '22023';
  end if;

  perform 1
  from public.purchase_order_delivery_lines
  where delivery_batch_id = p_delivery_batch_id
  order by id
  for update;

  perform 1
  from public.items item
  where item.id in (
    select distinct line.value ->> 'itemId'
    from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) line(value)
    where nullif(line.value ->> 'itemId', '') is not null
  )
  order by item.id
  for update;

  if coalesce(v_batch.fulfillment_mode, 'RECEIVE_TO_STOCK') = 'RECEIVE_TO_STOCK' then
    for v_item in
      select value from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) as item(value)
    loop
      v_item_id := nullif(v_item ->> 'itemId', '');
      v_qty := coalesce(nullif(v_item ->> 'quantity', '')::numeric, 0);
      if v_item_id is null or v_qty < 0 then
        raise exception 'WMS item nhan hang khong hop le.' using errcode = '22023';
      end if;
      if v_qty > 0 and not exists(select 1 from app_private.request_purchase_po_links l where l.purchase_order_id=v_po.id and l.kind='asset') then
        perform public.apply_stock_change(v_item_id, v_tx.target_warehouse_id, v_qty);
      end if;
    end loop;
  elsif coalesce(v_batch.fulfillment_mode, '') <> 'DIRECT_CONSUMPTION' then
    raise exception 'Fulfillment mode khong hop le: %', v_batch.fulfillment_mode using errcode = '22023';
  end if;

  update public.transactions
  set status = 'COMPLETED'::public.transaction_status,
      approver_id = p_actor_user_id,
      approved_at = coalesce(approved_at, now())
  where id = p_wms_transaction_id
  returning * into v_tx;

  select
    coalesce(sum(coalesce(planned_qty, 0)), 0),
    coalesce(sum(coalesce(accepted_qty, 0)), 0)
  into v_planned_purchase_qty, v_accepted_purchase_qty
  from public.purchase_order_delivery_lines
  where delivery_batch_id = p_delivery_batch_id;

  v_delivery_status := case
    when v_accepted_purchase_qty > v_planned_purchase_qty then 'received_over'
    when v_accepted_purchase_qty < v_planned_purchase_qty then 'received_short'
    else 'received'
  end;

  update public.purchase_order_delivery_batches
  set status = v_delivery_status,
      received_by = p_actor_user_id,
      received_at = now(),
      updated_at = now()
  where id = p_delivery_batch_id
  returning * into v_batch;

  select exists (
    select 1
    from jsonb_array_elements_text(coalesce(v_po.received_transaction_ids, '[]'::jsonb)) existing(id)
    where existing.id = v_tx.id
  ) into v_already_recorded;

  with receipt_by_line as (
    select
      purchase_order_line_id,
      sum(coalesce(accepted_qty, 0)) as accepted_purchase_qty
    from public.purchase_order_delivery_lines
    where delivery_batch_id = p_delivery_batch_id
    group by purchase_order_line_id
  ),
  item_rows as (
    select
      item.value as item,
      item.ordinality,
      coalesce(item.value ->> 'lineId', item.value ->> 'line_id', item.value ->> 'itemId', item.value ->> 'item_id') as line_key,
      coalesce(nullif(item.value ->> 'receivedQty', '')::numeric, 0) as current_received_qty
    from jsonb_array_elements(coalesce(v_po.items, '[]'::jsonb)) with ordinality item(value, ordinality)
  ),
  next_rows as (
    select
      case
        when coalesce(r.accepted_purchase_qty, 0) > 0 then
          jsonb_set(
            ir.item,
            '{receivedQty}',
            to_jsonb(ir.current_received_qty + coalesce(r.accepted_purchase_qty, 0)),
            true
          )
        else ir.item
      end as item,
      ir.ordinality
    from item_rows ir
    left join receipt_by_line r on r.purchase_order_line_id = ir.line_key
  )
  select coalesce(jsonb_agg(item order by ordinality), '[]'::jsonb)
  into v_next_items
  from next_rows;

  select coalesce(bool_and(
    coalesce(nullif(item.value ->> 'receivedQty', '')::numeric, 0)
      >= coalesce(nullif(item.value ->> 'qty', '')::numeric, 0)
  ), false)
  into v_is_delivered
  from jsonb_array_elements(coalesce(v_next_items, '[]'::jsonb)) item(value);

  v_previous_guard := current_setting('app.material_transition_context', true);
  perform set_config('app.material_transition_context', 'on', true);

  update public.purchase_orders
  set items = v_next_items,
      status = case when v_is_delivered then 'delivered' else 'partial' end,
      actual_delivery_date = case when v_is_delivered then coalesce((v_tx.date at time zone 'Asia/Ho_Chi_Minh')::date, current_date)::text else actual_delivery_date end, -- ngày hàng về
      received_transaction_ids = case
        when v_already_recorded then coalesce(received_transaction_ids, '[]'::jsonb)
        else coalesce(received_transaction_ids, '[]'::jsonb) || jsonb_build_array(v_tx.id)
      end
  where id = v_po.id;

  perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);

  update public.material_request_fulfillment_lines mfl
  set received_qty = coalesce(line.accepted_stock_qty, line.accepted_qty, 0),
      variance_reason = coalesce(v_batch.variance_reason, mfl.variance_reason),
      updated_at = now()
  from public.purchase_order_delivery_lines line
  where mfl.po_delivery_line_id = line.id
    and line.delivery_batch_id = p_delivery_batch_id;

  update public.material_request_fulfillment_batches
  set status = 'received',
      received_by = p_actor_user_id,
      received_at = now(),
      updated_at = now()
  where po_delivery_batch_id = p_delivery_batch_id
    and status = 'issued';

  return app_private.purchase_receipt_command_result_v2(p_delivery_batch_id, false);
exception
  when others then
    perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_material_po_receipt(p_delivery_batch_id uuid, p_wms_transaction_id text, p_actor_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_result jsonb;
  v_po_id text;
  v_purchase_mode text;
  v_previous_guard text;
begin
  if exists (select 1 from public.procurement_receipt_reconciliations r where r.delivery_batch_id = p_delivery_batch_id and r.status = 'open') then
    raise exception using errcode = '22023', message = 'PURCHASE_RECEIPT_RECON_OPEN: Đợt này đang đối chiếu ở Mua hàng → Nhận hàng. Hoàn tất (xác nhận + Ghi sổ) ở màn đối chiếu.';
  end if;
  v_actor := app_private.require_purchase_receipt_stage_action(
    p_wms_transaction_id,
    p_actor_user_id,
    'wms.transaction.complete'
  );

  v_result := app_private.finalize_purchase_receipt_v2(
    p_delivery_batch_id,
    p_wms_transaction_id,
    v_actor
  );

  select batch.purchase_order_id, po.purchase_mode
  into v_po_id, v_purchase_mode
  from public.purchase_order_delivery_batches batch
  join public.purchase_orders po on po.id = batch.purchase_order_id
  where batch.id = p_delivery_batch_id;

  -- 08/10/2026: không còn ép "Đã nhận đủ" sau mỗi đợt — trạng thái đơn (Về một phần / Đã nhận đủ) đã tính theo SL thực nhận ở finalize.
  v_result := v_result || jsonb_build_object(
    'purchaseOrderStatus', (select status from public.purchase_orders where id = v_po_id)
  );

  return v_result;
exception
  when others then
    perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.receive_purchase_delivery_v1(p_delivery_batch_id uuid, p_wms_transaction_id text, p_quality_result text DEFAULT 'passed'::text, p_lines jsonb DEFAULT '[]'::jsonb, p_attachments jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_tx_status text;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  select * into v_batch from public.purchase_order_delivery_batches where id = p_delivery_batch_id for update;
  if not found or v_batch.wms_transaction_id is distinct from p_wms_transaction_id then
    raise exception using errcode = '22023', message = 'PURCHASE_RECEIPT_BATCH_MISMATCH'; end if;
  -- Đợt đang đối chiếu ở Mua hàng: không nhận 1 bước ở Nhập xuất (tránh ghi đủ số đặt / sai ngày).
  if exists (select 1 from public.procurement_receipt_reconciliations r where r.delivery_batch_id = p_delivery_batch_id and r.status = 'open') then
    raise exception using errcode = '22023', message = 'PURCHASE_RECEIPT_RECON_OPEN: Đợt này đang đối chiếu ở Mua hàng → Nhận hàng. Hoàn tất (xác nhận + Ghi sổ) ở màn đối chiếu.';
  end if;
  select status::text into v_tx_status from public.transactions where id = p_wms_transaction_id for update;

  if v_batch.status in ('received','received_short','received_over') and v_tx_status='COMPLETED' then
    return public.finalize_material_po_receipt(p_delivery_batch_id,p_wms_transaction_id,v_actor);
  end if;

  if v_batch.status = 'wms_pending' and v_tx_status = 'PENDING' then
    update public.purchase_order_delivery_batches set status = 'receiving', updated_at = now() where id = v_batch.id;
    v_batch.status := 'receiving';
  end if;

  if v_batch.status = 'receiving' and v_tx_status = 'PENDING' then
    perform public.approve_material_po_quality(p_delivery_batch_id, p_wms_transaction_id, v_actor, p_quality_result, p_lines, p_attachments);
  elsif not (v_batch.status = 'quality_approved' and v_tx_status = 'APPROVED') then
    raise exception using errcode = '22023', message = 'PURCHASE_RECEIPT_NOT_RECEIVABLE';
  end if;

  return public.finalize_material_po_receipt(p_delivery_batch_id, p_wms_transaction_id, v_actor);
end;
$function$;


-- Ngày đặt hàng của đơn mua. p = { purchaseOrderId, orderDate: 'YYYY-MM-DD' }
create function public.set_purchase_order_order_date_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_po public.purchase_orders%rowtype; v_date date;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'PO_DATE_DENIED'; end if;
  select * into v_po from public.purchase_orders where id = p->>'purchaseOrderId' for update;
  if not found then raise exception using errcode = 'P0002', message = 'PO_NOT_FOUND'; end if;
  -- Cùng quyền với lập / sửa đơn mua (Quản trị Mua hàng hoặc gọi hàng theo HĐ của dự án).
  if not (public.is_admin() or app_private.procurement_can('manage')
      or (v_po.supplier_contract_id is not null and app_private.procurement_contract_can_order(v_po.project_id, v_po.construction_site_id))) then
    raise exception using errcode = '42501', message = 'PO_DATE_DENIED'; end if;
  if v_po.status in ('cancelled') or v_po.archived_at is not null then raise exception using errcode = '22023', message = 'PO_DATE_STATE'; end if;
  begin v_date := (p->>'orderDate')::date; exception when others then raise exception using errcode = '22023', message = 'PO_DATE_INVALID'; end;
  if v_date is null then raise exception using errcode = '22023', message = 'PO_DATE_INVALID'; end if;
  if v_po.order_date is not distinct from to_char(v_date, 'YYYY-MM-DD') then return jsonb_build_object('purchaseOrderId', v_po.id, 'orderDate', v_po.order_date); end if;
  perform app_private.assert_business_date(v_date);
  perform set_config('app.procurement_hub_context', 'on', true);
  perform set_config('app.material_transition_context', 'on', true);
  update public.purchase_orders set order_date = to_char(v_date, 'YYYY-MM-DD') where id = v_po.id;
  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('purchase_order', v_po.id, 'order_date', v_actor, null, jsonb_build_object('from', v_po.order_date, 'to', to_char(v_date, 'YYYY-MM-DD')));
  return jsonb_build_object('purchaseOrderId', v_po.id, 'orderDate', to_char(v_date, 'YYYY-MM-DD'));
end $$;

revoke all on function app_private.assert_business_date(date) from public, anon;
grant execute on function app_private.assert_business_date(date) to authenticated;
revoke all on function public.set_purchase_order_order_date_v1(jsonb) from public, anon;
grant execute on function public.set_purchase_order_order_date_v1(jsonb) to authenticated;

notify pgrst, 'reload schema';
