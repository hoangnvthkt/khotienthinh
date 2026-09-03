alter table public.supplier_payable_documents
  drop constraint if exists supplier_payable_documents_source_type_check;

alter table public.supplier_payable_documents
  add constraint supplier_payable_documents_source_type_check
  check (source_type in (
    'purchase_order',
    'purchase_delivery_receipt',
    'site_direct_purchase',
    'supplier_delivery_statement',
    'supplier_return_credit',
    'opening_balance',
    'manual_adjustment'
  ));

create or replace function app_private.post_purchase_receipt_finance_v2(
  p_delivery_batch_id uuid,
  p_actor_user_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
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
      current_date::text,
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
    current_date,
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
$$;

revoke all on function app_private.post_purchase_receipt_finance_v2(uuid, uuid)
  from public, anon, authenticated;

create or replace function app_private.trg_post_purchase_receipt_finance_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('received', 'received_short', 'received_over')
     and old.status is distinct from new.status then
    perform app_private.post_purchase_receipt_finance_v2(new.id, new.received_by);
  end if;
  return new;
end;
$$;

revoke all on function app_private.trg_post_purchase_receipt_finance_v2()
  from public, anon, authenticated;

drop trigger if exists trg_post_purchase_receipt_finance_v2
  on public.purchase_order_delivery_batches;

create trigger trg_post_purchase_receipt_finance_v2
after update of status on public.purchase_order_delivery_batches
for each row
execute function app_private.trg_post_purchase_receipt_finance_v2();

create or replace function public.post_supplier_payment_batch(p_batch_id uuid, p_actor_id uuid default null)
returns public.supplier_payment_batches
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch public.supplier_payment_batches%rowtype;
  v_allocated numeric(18,2);
  v_allocation record;
begin
  select * into v_batch
  from public.supplier_payment_batches
  where id = p_batch_id
  for update;

  if not found then
    raise exception 'Không tìm thấy đợt thanh toán %. ', p_batch_id;
  end if;

  if not app_private.ap_scope_can_mutate(v_batch.project_id, v_batch.construction_site_id) then
    raise exception 'Bạn không có quyền post đợt thanh toán này.';
  end if;

  if v_batch.status = 'paid' then
    return v_batch;
  end if;

  if v_batch.status in ('cancelled', 'reversed') then
    raise exception 'Không thể post đợt thanh toán đã huỷ/đảo.';
  end if;

  select coalesce(sum(allocated_amount), 0)::numeric(18,2)
  into v_allocated
  from public.supplier_payment_allocations
  where payment_batch_id = p_batch_id;

  if v_allocated <> v_batch.payment_amount then
    raise exception 'Tổng phân bổ (%) phải bằng số tiền thanh toán (%).', v_allocated, v_batch.payment_amount;
  end if;

  for v_allocation in
    select
      a.*,
      d.document_no,
      d.recognized_amount,
      d.credit_amount,
      coalesce((
        select sum(a2.allocated_amount + a2.discount_amount + a2.withholding_amount)
        from public.supplier_payment_allocations a2
        join public.supplier_payment_batches b2 on b2.id = a2.payment_batch_id
        where a2.payable_document_id = a.payable_document_id
          and b2.status = 'paid'
          and b2.id <> p_batch_id
      ), 0) as paid_before
    from public.supplier_payment_allocations a
    join public.supplier_payable_documents d on d.id = a.payable_document_id
    where a.payment_batch_id = p_batch_id
    for update of d
  loop
    if v_allocation.paid_before + v_allocation.allocated_amount + v_allocation.discount_amount + v_allocation.withholding_amount
      > v_allocation.recognized_amount - v_allocation.credit_amount
    then
      raise exception 'Số phân bổ vượt công nợ của chứng từ %.', v_allocation.document_no;
    end if;
  end loop;

  update public.supplier_payment_batches
  set
    status = 'paid',
    paid_by = coalesce(p_actor_id, paid_by),
    paid_at = coalesce(paid_at, now()),
    project_transaction_id = null,
    updated_at = now()
  where id = p_batch_id
  returning * into v_batch;

  update public.supplier_payable_documents d
  set
    status = case
      when b.outstanding_amount <= 0 then 'paid'
      when b.paid_amount > 0 then 'partial'
      else d.status
    end,
    updated_at = now()
  from public.supplier_payable_document_balances b
  where b.id = d.id
    and d.id in (
      select payable_document_id
      from public.supplier_payment_allocations
      where payment_batch_id = p_batch_id
    );

  return v_batch;
end;
$$;

create or replace function public.reverse_supplier_payment_batch(p_batch_id uuid, p_actor_id uuid default null)
returns public.supplier_payment_batches
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch public.supplier_payment_batches%rowtype;
begin
  select * into v_batch
  from public.supplier_payment_batches
  where id = p_batch_id
  for update;

  if not found then
    raise exception 'Không tìm thấy đợt thanh toán %. ', p_batch_id;
  end if;

  if not app_private.ap_scope_can_mutate(v_batch.project_id, v_batch.construction_site_id) then
    raise exception 'Bạn không có quyền đảo đợt thanh toán này.';
  end if;

  if v_batch.status <> 'paid' then
    raise exception 'Chỉ đảo được đợt thanh toán đã paid.';
  end if;

  update public.supplier_payment_batches
  set
    status = 'reversed',
    project_transaction_id = null,
    updated_at = now(),
    metadata = metadata || jsonb_build_object('reversedBy', p_actor_id, 'reversedAt', now())
  where id = p_batch_id
  returning * into v_batch;

  update public.supplier_payable_documents d
  set
    status = case
      when b.outstanding_amount <= 0 then 'paid'
      when b.paid_amount > 0 then 'partial'
      when d.recognized_amount > 0 then 'open'
      else 'draft'
    end,
    updated_at = now()
  from public.supplier_payable_document_balances b
  where b.id = d.id
    and d.id in (
      select payable_document_id
      from public.supplier_payment_allocations
      where payment_batch_id = p_batch_id
    );

  return v_batch;
end;
$$;

revoke all on function public.post_supplier_payment_batch(uuid, uuid) from public, anon;
revoke all on function public.reverse_supplier_payment_batch(uuid, uuid) from public, anon;
grant execute on function public.post_supplier_payment_batch(uuid, uuid) to authenticated;
grant execute on function public.reverse_supplier_payment_batch(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
