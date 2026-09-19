CREATE OR REPLACE FUNCTION public.post_supplier_payment_batch(p_batch_id uuid, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS supplier_payment_batches
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_batch public.supplier_payment_batches%rowtype;
  v_allocated numeric(18,2);
  v_finance_id text := '';
  v_tx_id text;
  v_allocation record;
  v_actor_id uuid := public.current_app_user_id();
begin
  select * into v_batch
  from public.supplier_payment_batches
  where id = p_batch_id
  for update;

  if not found then
    raise exception 'Không tìm thấy đợt thanh toán %. ', p_batch_id;
  end if;

  if v_actor_id is null or (p_actor_id is not null and p_actor_id <> v_actor_id) then
    raise exception 'Người thực hiện thanh toán không khớp với phiên đăng nhập.';
  end if;

  if not app_private.can_manage_supplier_payments(v_batch.project_id, v_batch.construction_site_id) then
    raise exception 'Bạn không có quyền post đợt thanh toán này.';
  end if;

  if v_batch.status in ('cancelled', 'reversed') then
    raise exception 'Không thể post đợt thanh toán đã huỷ/đảo.';
  end if;

  if v_batch.status <> 'paid' then
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
  end if;

  select finance.id into v_finance_id
  from public.project_finances finance
  where (v_batch.project_id is not null and finance.project_id = v_batch.project_id)
     or (v_batch.construction_site_id is not null and finance.construction_site_id = v_batch.construction_site_id)
  order by
    case when v_batch.project_id is not null and finance.project_id = v_batch.project_id then 0 else 1 end,
    finance.id
  limit 1;

  insert into public.project_transactions (
    id, "projectFinanceId", "constructionSiteId", project_id, project_finance_id, construction_site_id,
    type, category, amount, description, date, source, "sourceRef", source_ref,
    attachments, "createdBy", "createdAt", counterparty_name, counterparty_partner_id
  )
  values (
    'supplier-payment-' || p_batch_id::text,
    coalesce(v_finance_id, ''),
    coalesce(v_batch.construction_site_id, ''),
    v_batch.project_id,
    nullif(v_finance_id, ''),
    v_batch.construction_site_id,
    'expense',
    'materials',
    v_batch.payment_amount,
    'Thanh toán NCC ' || v_batch.supplier_name_snapshot || ' - ' || v_batch.code,
    v_batch.payment_date::text,
    'workflow',
    'supplier_payment_batch:' || p_batch_id::text,
    'supplier_payment_batch:' || p_batch_id::text,
    coalesce(v_batch.attachments, '[]'::jsonb),
    coalesce(v_batch.paid_by, v_actor_id, v_batch.created_by)::text,
    coalesce(v_batch.paid_at, now()),
    v_batch.supplier_name_snapshot,
    v_batch.supplier_id
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
    attachments = excluded.attachments,
    counterparty_name = excluded.counterparty_name,
    counterparty_partner_id = excluded.counterparty_partner_id
  returning id into v_tx_id;

  update public.supplier_payment_batches
  set
    status = 'paid',
    paid_by = coalesce(paid_by, v_actor_id),
    paid_at = coalesce(paid_at, now()),
    project_transaction_id = v_tx_id,
    updated_at = now()
  where id = p_batch_id
  returning * into v_batch;

  update public.supplier_payable_documents d
  set
    status = case
      when balance.outstanding_amount <= 0 then 'paid'
      when balance.paid_amount > 0 then 'partial'
      else d.status
    end,
    updated_at = now()
  from public.supplier_payable_document_balances balance
  where balance.id = d.id
    and d.id in (
      select payable_document_id
      from public.supplier_payment_allocations
      where payment_batch_id = p_batch_id
    );

  return v_batch;
end;
$function$
