alter table if exists public.site_cash_settlement_batches
  add column if not exists approved_site_cash_spend numeric(18,2) not null default 0,
  add column if not exists approved_staff_paid_amount numeric(18,2) not null default 0,
  add column if not exists staff_reimbursed_amount numeric(18,2) not null default 0,
  add column if not exists staff_outstanding_amount numeric(18,2) not null default 0,
  add column if not exists project_transaction_id text references public.project_transactions(id) on delete set null,
  add column if not exists cash_voucher_id uuid references public.cash_vouchers(id) on delete set null,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table if exists public.site_cash_settlement_batches
  drop constraint if exists site_cash_settlement_batches_approved_site_cash_spend_check,
  drop constraint if exists site_cash_settlement_batches_approved_staff_paid_amount_check,
  drop constraint if exists site_cash_settlement_batches_staff_reimbursed_amount_check,
  drop constraint if exists site_cash_settlement_batches_staff_outstanding_amount_check;

alter table if exists public.site_cash_settlement_batches
  add constraint site_cash_settlement_batches_approved_site_cash_spend_check check (approved_site_cash_spend >= 0),
  add constraint site_cash_settlement_batches_approved_staff_paid_amount_check check (approved_staff_paid_amount >= 0),
  add constraint site_cash_settlement_batches_staff_reimbursed_amount_check check (staff_reimbursed_amount >= 0),
  add constraint site_cash_settlement_batches_staff_outstanding_amount_check check (staff_outstanding_amount >= 0);

alter table if exists public.site_cash_settlement_batches
  drop constraint if exists site_cash_settlement_batches_status_check;

alter table if exists public.site_cash_settlement_batches
  add constraint site_cash_settlement_batches_status_check
  check (status in ('draft', 'submitted', 'reviewing', 'approved', 'closed', 'cancelled', 'reversed'));

alter table if exists public.site_cash_settlement_lines
  add column if not exists supplier_name_snapshot text,
  add column if not exists payment_source text,
  add column if not exists purchase_date date,
  add column if not exists payer_user_id uuid,
  add column if not exists payer_name_snapshot text,
  add column if not exists payable_document_id uuid references public.supplier_payable_documents(id) on delete set null,
  add column if not exists fund_spend_amount numeric(18,2) not null default 0,
  add column if not exists staff_claim_amount numeric(18,2) not null default 0,
  add column if not exists staff_reimbursed_amount numeric(18,2) not null default 0;

alter table if exists public.site_cash_settlement_lines
  drop constraint if exists site_cash_settlement_lines_payment_source_check,
  drop constraint if exists site_cash_settlement_lines_fund_spend_amount_check,
  drop constraint if exists site_cash_settlement_lines_staff_claim_amount_check,
  drop constraint if exists site_cash_settlement_lines_staff_reimbursed_amount_check,
  drop constraint if exists site_cash_settlement_lines_reimbursed_lte_claim_check;

update public.site_cash_settlement_lines
set staff_reimbursed_amount = approved_amount
where staff_reimbursed_amount > approved_amount;

alter table if exists public.site_cash_settlement_lines
  add constraint site_cash_settlement_lines_payment_source_check
    check (payment_source is null or payment_source in ('site_cash', 'company_bank', 'staff_paid', 'supplier_credit')),
  add constraint site_cash_settlement_lines_fund_spend_amount_check check (fund_spend_amount >= 0),
  add constraint site_cash_settlement_lines_staff_claim_amount_check check (staff_claim_amount >= 0),
  add constraint site_cash_settlement_lines_staff_reimbursed_amount_check check (staff_reimbursed_amount >= 0),
  add constraint site_cash_settlement_lines_reimbursed_lte_claim_check
    check (staff_reimbursed_amount <= approved_amount);

create index if not exists idx_site_cash_settlement_lines_source
  on public.site_cash_settlement_lines(source_type, source_id)
  where source_type = 'site_direct_purchase';

create index if not exists idx_site_cash_settlement_lines_payment_source
  on public.site_cash_settlement_lines(payment_source, status);

create or replace function public.sync_supplier_payable_from_site_direct_purchase(p_direct_purchase_id uuid)
returns public.supplier_payable_documents
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_purchase public.site_direct_purchases%rowtype;
  v_recognized numeric(18,2);
  v_document public.supplier_payable_documents%rowtype;
begin
  select * into v_purchase
  from public.site_direct_purchases
  where id = p_direct_purchase_id;

  if not found then
    raise exception 'Không tìm thấy phiếu mua nóng %. ', p_direct_purchase_id;
  end if;

  if not app_private.ap_scope_can_mutate(v_purchase.project_id, v_purchase.construction_site_id) then
    raise exception 'Bạn không có quyền đồng bộ công nợ phiếu mua nóng này.';
  end if;

  if exists (
    select 1
    from public.site_direct_purchase_lines line
    where line.direct_purchase_id = v_purchase.id
      and line.line_type = 'stock_item'
      and line.status <> 'rejected'
  )
  and not exists (
    select 1
    from public.transactions tx
    where tx.id = v_purchase.wms_transaction_id
      and upper(coalesce(tx.status::text, '')) = 'COMPLETED'
  )
  then
    raise exception 'Mua nóng vật tư tồn kho phải hoàn tất WMS import trước khi ghi nhận AP.';
  end if;

  select coalesce(sum(
    case
      when line.status in ('accepted', 'adjusted') then coalesce(nullif(line.accepted_amount, 0), line.line_amount)
      else 0
    end
  ), 0)::numeric(18,2)
  into v_recognized
  from public.site_direct_purchase_lines line
  where line.direct_purchase_id = v_purchase.id;

  insert into public.supplier_payable_documents (
    code, source_type, source_id, project_id, construction_site_id,
    supplier_id, supplier_name_snapshot, document_no, document_date, due_date,
    committed_amount, recognized_amount, credit_amount, status, qr_token,
    invoice_number, invoice_date, metadata, created_by
  )
  values (
    'AP-' || v_purchase.code,
    'site_direct_purchase',
    v_purchase.id::text,
    v_purchase.project_id,
    v_purchase.construction_site_id,
    v_purchase.supplier_id,
    v_purchase.supplier_name_snapshot,
    v_purchase.code,
    coalesce(v_purchase.purchase_date, current_date),
    null,
    v_purchase.total_amount,
    v_recognized,
    0,
    case when v_recognized > 0 then 'open' else 'draft' end,
    coalesce(v_purchase.qr_token, 'ap_direct_' || replace(v_purchase.id::text, '-', '')),
    v_purchase.invoice_number,
    v_purchase.invoice_date,
    jsonb_build_object(
      'purchaseMode', v_purchase.purchase_mode,
      'paymentSource', v_purchase.payment_source,
      'wmsTransactionId', v_purchase.wms_transaction_id
    ),
    v_purchase.created_by
  )
  on conflict (source_type, source_id) do update
  set
    project_id = excluded.project_id,
    construction_site_id = excluded.construction_site_id,
    supplier_id = excluded.supplier_id,
    supplier_name_snapshot = excluded.supplier_name_snapshot,
    document_no = excluded.document_no,
    document_date = excluded.document_date,
    committed_amount = excluded.committed_amount,
    recognized_amount = excluded.recognized_amount,
    invoice_number = excluded.invoice_number,
    invoice_date = excluded.invoice_date,
    metadata = public.supplier_payable_documents.metadata || excluded.metadata,
    updated_at = now()
  returning * into v_document;

  return v_document;
end;
$$;

create or replace function app_private.recompute_site_cash_settlement_totals(p_batch_id uuid)
returns table (
  accepted_spend_amount numeric,
  rejected_spend_amount numeric,
  approved_site_cash_spend numeric,
  approved_staff_paid_amount numeric,
  staff_reimbursed_amount numeric,
  staff_outstanding_amount numeric,
  closing_balance numeric
)
language sql
stable
set search_path = ''
as $$
  with batch as (
    select opening_balance, topup_amount
    from public.site_cash_settlement_batches
    where id = p_batch_id
  ),
  totals as (
    select
      coalesce(sum(case when status in ('accepted', 'adjusted') then approved_amount else 0 end), 0)::numeric(18,2) as accepted_spend_amount,
      coalesce(sum(case when status = 'rejected' then greatest(claimed_amount, spend_amount) else 0 end), 0)::numeric(18,2) as rejected_spend_amount,
      coalesce(sum(case when status in ('accepted', 'adjusted') and payment_source = 'site_cash' then coalesce(nullif(fund_spend_amount, 0), approved_amount) when status in ('accepted', 'adjusted') then fund_spend_amount else 0 end), 0)::numeric(18,2) as approved_site_cash_spend,
      coalesce(sum(case when status in ('accepted', 'adjusted') and payment_source = 'staff_paid' then approved_amount else 0 end), 0)::numeric(18,2) as approved_staff_paid_amount,
      coalesce(sum(case when status in ('accepted', 'adjusted') then staff_reimbursed_amount else 0 end), 0)::numeric(18,2) as staff_reimbursed_amount
    from public.site_cash_settlement_lines
    where settlement_batch_id = p_batch_id
  )
  select
    totals.accepted_spend_amount,
    totals.rejected_spend_amount,
    totals.approved_site_cash_spend,
    totals.approved_staff_paid_amount,
    totals.staff_reimbursed_amount,
    greatest(0, totals.approved_staff_paid_amount - totals.staff_reimbursed_amount)::numeric(18,2) as staff_outstanding_amount,
    (batch.opening_balance + batch.topup_amount - totals.approved_site_cash_spend - totals.staff_reimbursed_amount)::numeric(18,2) as closing_balance
  from batch, totals;
$$;

create or replace function public.post_site_cash_settlement_batch(p_batch_id uuid, p_actor_id uuid default null)
returns public.site_cash_settlement_batches
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch public.site_cash_settlement_batches%rowtype;
  v_totals record;
  v_finance_id text := '';
  v_tx_id text;
  v_voucher_id uuid;
  v_cashflow_amount numeric(18,2);
  v_actor_id uuid;
  v_document public.supplier_payable_documents%rowtype;
begin
  select * into v_batch
  from public.site_cash_settlement_batches
  where id = p_batch_id
  for update;

  if not found then
    raise exception 'Không tìm thấy bộ hoàn ứng %. ', p_batch_id;
  end if;

  if not app_private.ap_scope_can_mutate(v_batch.project_id, v_batch.construction_site_id) then
    raise exception 'Bạn không có quyền duyệt bộ hoàn ứng này.';
  end if;

  if v_batch.status in ('approved', 'closed') then
    return v_batch;
  end if;

  if v_batch.status in ('cancelled', 'reversed') then
    raise exception 'Không thể post bộ hoàn ứng đã huỷ/đảo.';
  end if;

  v_actor_id := coalesce(p_actor_id, v_batch.created_by);

  if not exists (
    select 1
    from public.site_cash_settlement_lines
    where settlement_batch_id = p_batch_id
  ) then
    raise exception 'Bộ hoàn ứng chưa có dòng chứng từ.';
  end if;

  if exists (
    select 1
    from public.site_cash_settlement_lines
    where settlement_batch_id = p_batch_id
      and status = 'pending'
  ) then
    raise exception 'Bộ hoàn ứng còn dòng chứng từ chưa review.';
  end if;

  if exists (
    select 1
    from public.site_cash_settlement_lines line
    join public.site_cash_settlement_lines other_line
      on other_line.source_type = line.source_type
     and other_line.source_id = line.source_id
     and other_line.settlement_batch_id <> line.settlement_batch_id
    join public.site_cash_settlement_batches other_batch on other_batch.id = other_line.settlement_batch_id
    where line.settlement_batch_id = p_batch_id
      and line.source_type = 'site_direct_purchase'
      and other_batch.status not in ('cancelled', 'reversed')
  ) then
    raise exception 'Có phiếu mua nóng đã nằm trong bộ hoàn ứng khác.';
  end if;

  if exists (
    select 1
    from public.site_cash_settlement_lines line
    join public.site_direct_purchases purchase on purchase.id::text = line.source_id
    where line.settlement_batch_id = p_batch_id
      and line.source_type = 'site_direct_purchase'
      and line.status in ('accepted', 'adjusted')
      and purchase.payment_source not in ('site_cash', 'staff_paid')
  ) then
    raise exception 'Bộ hoàn ứng chỉ nhận phiếu mua nóng nguồn quỹ công trường hoặc cá nhân ứng trước.';
  end if;

  if exists (
    select 1
    from public.site_cash_settlement_lines line
    join public.site_direct_purchases purchase on purchase.id::text = line.source_id
    where line.settlement_batch_id = p_batch_id
      and line.source_type = 'site_direct_purchase'
      and line.status in ('accepted', 'adjusted')
      and exists (
        select 1
        from public.site_direct_purchase_lines purchase_line
        left join public.transactions tx on tx.id = purchase.wms_transaction_id
        where purchase_line.direct_purchase_id = purchase.id
          and purchase_line.line_type = 'stock_item'
          and purchase_line.status <> 'rejected'
          and coalesce(tx.status::text, '') not in ('completed', 'COMPLETED', 'Hoàn tất')
      )
  ) then
    raise exception 'Phiếu mua nóng có vật tư tồn kho phải hoàn tất WMS trước khi hoàn ứng.';
  end if;

  if exists (
    select 1
    from public.site_cash_settlement_lines line
    where line.settlement_batch_id = p_batch_id
      and line.status in ('accepted', 'adjusted')
      and line.payment_source = 'staff_paid'
      and line.staff_reimbursed_amount > line.approved_amount
  ) then
    raise exception 'Số hoàn cá nhân không được vượt số đã duyệt.';
  end if;

  select * into v_totals
  from app_private.recompute_site_cash_settlement_totals(p_batch_id);

  if v_totals.closing_balance < 0 then
    raise exception 'Quỹ công trường âm sau hoàn ứng (%).', v_totals.closing_balance;
  end if;

  select id into v_finance_id
  from public.project_finances
  where (v_batch.project_id is not null and project_id = v_batch.project_id)
     or (v_batch.construction_site_id is not null and construction_site_id = v_batch.construction_site_id)
  limit 1;

  v_cashflow_amount := (v_totals.approved_site_cash_spend + v_totals.staff_reimbursed_amount)::numeric(18,2);
  v_tx_id := 'site-cash-settlement-' || p_batch_id::text;

  for v_document in
    select doc.*
    from (
      select distinct line.source_id::uuid as direct_purchase_id
      from public.site_cash_settlement_lines line
      where line.settlement_batch_id = p_batch_id
        and line.source_type = 'site_direct_purchase'
        and line.status in ('accepted', 'adjusted')
    ) source_purchase
    cross join lateral public.sync_supplier_payable_from_site_direct_purchase(source_purchase.direct_purchase_id) doc
  loop
    null;
  end loop;

  update public.site_cash_settlement_lines line
  set payable_document_id = payable.id
  from public.supplier_payable_documents payable
  where line.settlement_batch_id = p_batch_id
    and line.source_type = 'site_direct_purchase'
    and payable.source_type = 'site_direct_purchase'
    and payable.source_id = line.source_id;

  with settlement_credits as (
    select
      line.payable_document_id,
      sum(line.approved_amount)::numeric(18,2) as requested_credit_amount
    from public.site_cash_settlement_lines line
    where line.settlement_batch_id = p_batch_id
      and line.status in ('accepted', 'adjusted')
      and line.payable_document_id is not null
    group by line.payable_document_id
  ),
  credit_deltas as (
    select
      payable.id,
      least(
        greatest(balance.outstanding_amount, 0),
        settlement_credits.requested_credit_amount
      )::numeric(18,2) as credit_delta
    from public.supplier_payable_documents payable
    join public.supplier_payable_document_balances balance on balance.id = payable.id
    join settlement_credits on settlement_credits.payable_document_id = payable.id
  )
  update public.supplier_payable_documents payable
  set
    credit_amount = (payable.credit_amount + credit_deltas.credit_delta)::numeric(18,2),
    metadata = payable.metadata
      || jsonb_build_object(
        'siteCashSettlementCredits',
        coalesce(payable.metadata->'siteCashSettlementCredits', '{}'::jsonb)
          || jsonb_build_object(p_batch_id::text, credit_deltas.credit_delta)
      ),
    updated_at = now()
  from credit_deltas
  where payable.id = credit_deltas.id
    and credit_deltas.credit_delta > 0;

  update public.supplier_payable_documents payable
  set
    status = case
      when balance.outstanding_amount <= 0 then 'paid'
      when balance.paid_amount > 0 or payable.credit_amount > 0 then 'partial'
      when payable.recognized_amount > 0 then 'open'
      else 'draft'
    end,
    updated_at = now()
  from public.supplier_payable_document_balances balance
  where balance.id = payable.id
    and payable.id in (
      select payable_document_id
      from public.site_cash_settlement_lines
      where settlement_batch_id = p_batch_id
        and payable_document_id is not null
    );

  if v_cashflow_amount > 0 then
    insert into public.project_transactions (
      id, "projectFinanceId", "constructionSiteId", project_id, project_finance_id, construction_site_id,
      type, category, amount, description, date, source, "sourceRef", source_ref,
      attachments, "createdBy", "createdAt"
    )
    values (
      v_tx_id,
      coalesce(v_finance_id, ''),
      coalesce(v_batch.construction_site_id, ''),
      v_batch.project_id,
      nullif(v_finance_id, ''),
      v_batch.construction_site_id,
      'expense',
      'materials',
      v_cashflow_amount,
      'Hoàn ứng/quỹ công trường ' || v_batch.code,
      current_date::text,
      'workflow',
      'site_cash_settlement_batch:' || p_batch_id::text,
      'site_cash_settlement_batch:' || p_batch_id::text,
      '[]'::jsonb,
      v_actor_id::text,
      now()
    )
    on conflict (source_ref) do update
    set
      amount = excluded.amount,
      description = excluded.description,
      date = excluded.date,
      "createdBy" = excluded."createdBy";
  else
    v_tx_id := null;
  end if;

  if v_batch.cash_fund_id is not null and v_cashflow_amount > 0 then
    if v_actor_id is null then
      raise exception 'Thiếu người duyệt để tạo phiếu chi quỹ.';
    end if;

    insert into public.cash_vouchers (
      code, type, fund_id, date, amount, contact_name, contact_type, contact_id,
      reason, status, approved_by, approved_at, note, created_by
    )
    values (
      'PC-' || v_batch.code,
      'payment',
      v_batch.cash_fund_id,
      now(),
      v_cashflow_amount,
      'Công trường',
      'other',
      v_batch.construction_site_id,
      'Hoàn ứng/quỹ công trường ' || v_batch.code,
      'approved',
      v_actor_id,
      now(),
      v_batch.note,
      v_actor_id
    )
    on conflict (code) do update
    set
      amount = excluded.amount,
      approved_by = excluded.approved_by,
      approved_at = excluded.approved_at,
      note = excluded.note
    returning id into v_voucher_id;
  end if;

  update public.site_direct_purchases purchase
  set site_cash_settlement_id = p_batch_id, updated_at = now()
  where exists (
    select 1
    from public.site_cash_settlement_lines line
    where line.settlement_batch_id = p_batch_id
      and line.source_type = 'site_direct_purchase'
      and line.source_id = purchase.id::text
      and line.status in ('accepted', 'adjusted')
  );

  update public.site_cash_settlement_batches
  set
    accepted_spend_amount = v_totals.accepted_spend_amount,
    rejected_spend_amount = v_totals.rejected_spend_amount,
    approved_site_cash_spend = v_totals.approved_site_cash_spend,
    approved_staff_paid_amount = v_totals.approved_staff_paid_amount,
    staff_reimbursed_amount = v_totals.staff_reimbursed_amount,
    staff_outstanding_amount = v_totals.staff_outstanding_amount,
    closing_balance = v_totals.closing_balance,
    project_transaction_id = v_tx_id,
    cash_voucher_id = coalesce(v_voucher_id, cash_voucher_id),
    status = 'approved',
    approved_by = coalesce(v_actor_id, approved_by),
    approved_at = coalesce(approved_at, now()),
    updated_at = now()
  where id = p_batch_id
  returning * into v_batch;

  return v_batch;
end;
$$;

create or replace function public.reverse_site_cash_settlement_batch(p_batch_id uuid, p_actor_id uuid default null)
returns public.site_cash_settlement_batches
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch public.site_cash_settlement_batches%rowtype;
  v_reversal_ref text;
  v_actor_id uuid;
begin
  select * into v_batch
  from public.site_cash_settlement_batches
  where id = p_batch_id
  for update;

  if not found then
    raise exception 'Không tìm thấy bộ hoàn ứng %. ', p_batch_id;
  end if;

  if not app_private.ap_scope_can_mutate(v_batch.project_id, v_batch.construction_site_id) then
    raise exception 'Bạn không có quyền đảo bộ hoàn ứng này.';
  end if;

  if v_batch.status not in ('approved', 'closed') then
    raise exception 'Chỉ đảo được bộ hoàn ứng đã duyệt/đóng.';
  end if;

  v_actor_id := coalesce(p_actor_id, v_batch.approved_by, v_batch.created_by);

  v_reversal_ref := 'site_cash_settlement_batch:' || p_batch_id::text || ':reversal';

  if coalesce(v_batch.approved_site_cash_spend, 0) + coalesce(v_batch.staff_reimbursed_amount, 0) > 0 then
    insert into public.project_transactions (
      id, "projectFinanceId", "constructionSiteId", project_id, project_finance_id, construction_site_id,
      type, category, amount, description, date, source, "sourceRef", source_ref,
      attachments, "createdBy", "createdAt"
    )
    values (
      'site-cash-settlement-reversal-' || p_batch_id::text,
      coalesce((
        select id from public.project_finances
        where (v_batch.project_id is not null and project_id = v_batch.project_id)
           or (v_batch.construction_site_id is not null and construction_site_id = v_batch.construction_site_id)
        limit 1
      ), ''),
      coalesce(v_batch.construction_site_id, ''),
      v_batch.project_id,
      (
        select id from public.project_finances
        where (v_batch.project_id is not null and project_id = v_batch.project_id)
           or (v_batch.construction_site_id is not null and construction_site_id = v_batch.construction_site_id)
        limit 1
      ),
      v_batch.construction_site_id,
      'expense',
      'materials',
      -(coalesce(v_batch.approved_site_cash_spend, 0) + coalesce(v_batch.staff_reimbursed_amount, 0)),
      'Đảo hoàn ứng/quỹ công trường ' || v_batch.code,
      current_date::text,
      'workflow',
      v_reversal_ref,
      v_reversal_ref,
      '[]'::jsonb,
      v_actor_id::text,
      now()
    )
    on conflict (source_ref) do nothing;
  end if;

  update public.site_direct_purchases purchase
  set site_cash_settlement_id = null, updated_at = now()
  where site_cash_settlement_id = p_batch_id;

  with credit_deltas as (
    select
      payable.id,
      coalesce((payable.metadata->'siteCashSettlementCredits'->>p_batch_id::text)::numeric, 0)::numeric(18,2) as credit_delta
    from public.supplier_payable_documents payable
    where payable.id in (
      select payable_document_id
      from public.site_cash_settlement_lines
      where settlement_batch_id = p_batch_id
        and payable_document_id is not null
    )
  )
  update public.supplier_payable_documents payable
  set
    credit_amount = greatest(0, payable.credit_amount - credit_deltas.credit_delta)::numeric(18,2),
    metadata = (payable.metadata #- (array['siteCashSettlementCredits', p_batch_id::text]::text[]))
      || jsonb_build_object('lastSiteCashSettlementReversal', p_batch_id, 'lastSiteCashSettlementReversedAt', now()),
    updated_at = now()
  from credit_deltas
  where payable.id = credit_deltas.id
    and credit_deltas.credit_delta > 0;

  update public.supplier_payable_documents payable
  set
    status = case
      when balance.outstanding_amount <= 0 then 'paid'
      when balance.paid_amount > 0 or payable.credit_amount > 0 then 'partial'
      when payable.recognized_amount > 0 then 'open'
      else 'draft'
    end,
    updated_at = now()
  from public.supplier_payable_document_balances balance
  where balance.id = payable.id
    and payable.id in (
      select payable_document_id
      from public.site_cash_settlement_lines
      where settlement_batch_id = p_batch_id
        and payable_document_id is not null
    );

  update public.cash_vouchers
  set status = 'cancelled', note = coalesce(note, '') || ' | Đảo bộ hoàn ứng ' || v_batch.code
  where id = v_batch.cash_voucher_id;

  update public.site_cash_settlement_batches
  set
    status = 'reversed',
    metadata = metadata || jsonb_build_object('reversedBy', v_actor_id, 'reversedAt', now()),
    updated_at = now()
  where id = p_batch_id
  returning * into v_batch;

  return v_batch;
end;
$$;

revoke all on function app_private.recompute_site_cash_settlement_totals(uuid) from public, anon, authenticated;
revoke all on function public.sync_supplier_payable_from_site_direct_purchase(uuid) from public, anon;
revoke all on function public.post_site_cash_settlement_batch(uuid, uuid) from public, anon;
revoke all on function public.reverse_site_cash_settlement_batch(uuid, uuid) from public, anon;

grant execute on function public.sync_supplier_payable_from_site_direct_purchase(uuid) to authenticated;
grant execute on function public.post_site_cash_settlement_batch(uuid, uuid) to authenticated;
grant execute on function public.reverse_site_cash_settlement_batch(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
