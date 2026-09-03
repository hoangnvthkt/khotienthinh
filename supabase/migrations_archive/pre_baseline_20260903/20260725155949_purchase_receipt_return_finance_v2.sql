create schema if not exists app_private;

create or replace function app_private.post_purchase_receipt_return_finance_v2(
  p_supplier_return_id uuid,
  p_actor_user_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_return public.purchase_order_supplier_returns%rowtype;
  v_po public.purchase_orders%rowtype;
  v_tx public.transactions%rowtype;
  v_has_v2_receipt boolean := false;
  v_existing_cost public.project_transactions%rowtype;
  v_project_finance_id text;
  v_source_ref text := 'purchase_receipt_return:' || p_supplier_return_id::text;
  v_description text;
  v_total_gross numeric(18,2) := 0;
  v_return_line record;
  v_delivery record;
  v_remaining_qty numeric;
  v_take_qty numeric;
  v_line_gross numeric(18,2);
  v_ap public.supplier_payable_documents%rowtype;
  v_credit_key text;
  v_existing_credit jsonb;
begin
  select * into v_return
  from public.purchase_order_supplier_returns
  where id = p_supplier_return_id
  for update;
  if not found then
    raise exception 'Khong tim thay phieu tra NCC %.', p_supplier_return_id using errcode = '22023';
  end if;
  if v_return.status <> 'completed' then
    raise exception 'Chi post finance cho phieu tra NCC da completed.' using errcode = '22023';
  end if;

  select * into v_existing_cost
  from public.project_transactions
  where source_ref = v_source_ref
  for update;
  if found then
    return;
  end if;

  select * into v_tx
  from public.transactions
  where id = v_return.transaction_id
  for update;
  if not found or v_tx.status <> 'COMPLETED'::public.transaction_status then
    raise exception 'Chi post finance tra NCC khi WMS EXPORT da COMPLETED.' using errcode = '22023';
  end if;

  select * into v_po
  from public.purchase_orders
  where id = v_return.purchase_order_id
  for update;
  if not found then
    raise exception 'Khong tim thay PO cua phieu tra NCC %.', p_supplier_return_id using errcode = '22023';
  end if;

  select exists (
    select 1
    from public.purchase_order_delivery_lines line
    join public.purchase_order_delivery_batches batch on batch.id = line.delivery_batch_id
    where line.purchase_order_id = v_return.purchase_order_id
      and batch.status in ('received', 'received_short', 'received_over')
      and coalesce(line.accepted_qty, 0) > 0
  ) into v_has_v2_receipt;

  if not v_has_v2_receipt then
    return;
  end if;

  select id into v_project_finance_id
  from public.project_finances
  where (v_po.project_id is not null and project_id = v_po.project_id)
     or (v_po.construction_site_id is not null and construction_site_id = v_po.construction_site_id)
  limit 1;

  for v_return_line in
    select *
    from public.purchase_order_supplier_return_lines
    where supplier_return_id = p_supplier_return_id
    order by id
  loop
    v_remaining_qty := coalesce(v_return_line.return_qty, 0);
    if v_remaining_qty <= 0 then
      raise exception 'Dong tra NCC khong hop le.' using errcode = '22023';
    end if;

    for v_delivery in
      select
        line.id as delivery_line_id,
        line.delivery_batch_id,
        line.purchase_order_line_id,
        line.accepted_qty,
        line.returned_qty,
        line.delivery_unit_price,
        batch.delivery_no,
        batch.vat_rate,
        batch.received_at,
        batch.updated_at,
        batch.created_at
      from public.purchase_order_delivery_lines line
      join public.purchase_order_delivery_batches batch on batch.id = line.delivery_batch_id
      where line.purchase_order_id = v_return.purchase_order_id
        and line.purchase_order_line_id = v_return_line.purchase_order_line_id
        and batch.status in ('received', 'received_short', 'received_over')
        and coalesce(line.accepted_qty, 0) > coalesce(line.returned_qty, 0)
      order by coalesce(batch.received_at, batch.updated_at, batch.created_at), batch.delivery_no, line.id
      for update of line
    loop
      exit when v_remaining_qty <= 0;

      v_take_qty := least(
        v_remaining_qty,
        greatest(0, coalesce(v_delivery.accepted_qty, 0) - coalesce(v_delivery.returned_qty, 0))
      );
      if v_take_qty <= 0 then
        continue;
      end if;

      update public.purchase_order_delivery_lines
      set returned_qty = round(coalesce(returned_qty, 0) + v_take_qty, 6),
          updated_at = now()
      where id = v_delivery.delivery_line_id;

      v_line_gross := round(
        v_take_qty
        * coalesce(v_delivery.delivery_unit_price, 0)
        * (1 + coalesce(v_delivery.vat_rate, 0) / 100),
        2
      );
      v_total_gross := round(v_total_gross + v_line_gross, 2);

      select * into v_ap
      from public.supplier_payable_documents
      where source_type = 'purchase_delivery_receipt'
        and source_id = v_delivery.delivery_batch_id::text
      for update;
      if not found then
        raise exception 'Anomaly: AP receipt cua Dot giao % chua duoc ghi nhan.', v_delivery.delivery_batch_id
          using errcode = 'P0001';
      end if;
      if v_ap.status in ('cancelled', 'reversed') then
        raise exception 'Anomaly: khong the credit AP receipt da huy/dao.' using errcode = 'P0001';
      end if;

      v_credit_key := p_supplier_return_id::text || ':' || v_delivery.delivery_line_id::text;
      v_existing_credit := coalesce(v_ap.metadata, '{}'::jsonb)
        -> 'purchaseReceiptReturnCredits'
        -> v_credit_key;

      if v_existing_credit is not null then
        if round(coalesce(nullif(v_existing_credit ->> 'amount', '')::numeric, 0), 2) <> v_line_gross then
          raise exception 'Anomaly: AP return credit da ton tai voi gia tri khac.' using errcode = 'P0001';
        end if;
      else
        update public.supplier_payable_documents
        set credit_amount = round(coalesce(credit_amount, 0) + v_line_gross, 2),
            status = case
              when round(coalesce(recognized_amount, 0) - (coalesce(credit_amount, 0) + v_line_gross), 2) <= 0 then 'paid'
              when coalesce(credit_amount, 0) + v_line_gross > 0 then 'partial'
              else status
            end,
            metadata = jsonb_set(
              coalesce(metadata, '{}'::jsonb),
              '{purchaseReceiptReturnCredits}',
              coalesce(metadata -> 'purchaseReceiptReturnCredits', '{}'::jsonb)
                || jsonb_build_object(
                  v_credit_key,
                  jsonb_build_object(
                    'sourceType', 'supplier_return_credit',
                    'sourceId', p_supplier_return_id::text,
                    'sourceRef', v_source_ref,
                    'deliveryBatchId', v_delivery.delivery_batch_id::text,
                    'deliveryLineId', v_delivery.delivery_line_id::text,
                    'purchaseOrderLineId', v_return_line.purchase_order_line_id,
                    'returnQty', v_take_qty,
                    'amount', v_line_gross
                  )
                ),
              true
            ),
            updated_at = now()
        where id = v_ap.id;
      end if;

      v_remaining_qty := v_remaining_qty - v_take_qty;
    end loop;

    if round(v_remaining_qty, 6) > 0 then
      raise exception 'So luong tra cua dong % vuot so luong delivery da accepted con co the tra.',
        v_return_line.purchase_order_line_id using errcode = '22023';
    end if;
  end loop;

  if v_total_gross <= 0 then
    return;
  end if;

  v_description := 'Return to supplier '
    || coalesce(v_return.return_no, p_supplier_return_id::text)
    || ' - '
    || coalesce(v_po.po_number, v_po.id);

  insert into public.project_transactions (
    id, "projectFinanceId", "constructionSiteId",
    project_id, project_finance_id, construction_site_id,
    type, category, amount, description, date, source,
    "sourceRef", source_ref, contract_cost_item_id,
    cost_classification_status, counterparty_partner_id,
    counterparty_name, attachments, "createdBy", "createdAt"
  )
  values (
    'purchase-return-cost-' || p_supplier_return_id::text,
    coalesce(v_project_finance_id, ''),
    coalesce(v_po.construction_site_id, ''),
    v_po.project_id,
    nullif(v_project_finance_id, ''),
    v_po.construction_site_id,
    'expense',
    'materials',
    -v_total_gross,
    v_description,
    current_date::text,
    'workflow',
    v_source_ref,
    v_source_ref,
    null,
    'auto',
    null,
    coalesce(v_po.vendor_name, v_po.vendor_id, 'Nha cung cap'),
    coalesce(v_tx.attachments, '[]'::jsonb),
    coalesce(p_actor_user_id, v_return.completed_by, v_return.created_by)::text,
    now()
  )
  on conflict (source_ref) do nothing;
end;
$$;

revoke all on function app_private.post_purchase_receipt_return_finance_v2(uuid, uuid)
  from public, anon, authenticated;

create or replace function app_private.trg_post_purchase_receipt_return_finance_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'completed'
     and old.status is distinct from new.status then
    perform app_private.post_purchase_receipt_return_finance_v2(
      new.id,
      coalesce(new.completed_by, new.created_by)
    );
  end if;
  return new;
end;
$$;

revoke all on function app_private.trg_post_purchase_receipt_return_finance_v2()
  from public, anon, authenticated;

drop trigger if exists trg_post_purchase_receipt_return_finance_v2
  on public.purchase_order_supplier_returns;

create trigger trg_post_purchase_receipt_return_finance_v2
after update of status on public.purchase_order_supplier_returns
for each row
execute function app_private.trg_post_purchase_receipt_return_finance_v2();

notify pgrst, 'reload schema';
