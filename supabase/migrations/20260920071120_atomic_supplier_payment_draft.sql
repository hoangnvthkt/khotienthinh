alter table public.supplier_payment_batches
  add column row_version bigint not null default 1;

create or replace function app_private.bump_supplier_payment_batch_row_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.row_version := old.row_version + 1;
  return new;
end;
$$;

create trigger trg_supplier_payment_batches_row_version
before update on public.supplier_payment_batches
for each row execute function app_private.bump_supplier_payment_batch_row_version();

create table app_private.supplier_payment_draft_commands (
  actor_user_id uuid not null references public.users(id) on delete restrict,
  idempotency_key uuid not null,
  payment_batch_id uuid not null,
  payload_hash text not null,
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (actor_user_id, idempotency_key),
  constraint supplier_payment_draft_commands_payload_hash_check
    check (char_length(payload_hash) = 32),
  constraint supplier_payment_draft_commands_result_check
    check ((result is null and completed_at is null) or (result is not null and completed_at is not null))
);

alter table app_private.supplier_payment_draft_commands enable row level security;
revoke all on table app_private.supplier_payment_draft_commands from public, anon, authenticated;
grant select, insert, update on table app_private.supplier_payment_draft_commands to service_role;

create policy supplier_payment_draft_commands_authenticated_deny
on app_private.supplier_payment_draft_commands
for all
to authenticated
using (false)
with check (false);

create or replace function app_private.save_supplier_payment_batch_draft_v1(
  p_batch jsonb,
  p_allocations jsonb,
  p_expected_row_version bigint,
  p_actor_user_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch_id uuid;
  v_existing public.supplier_payment_batches%rowtype;
  v_saved public.supplier_payment_batches%rowtype;
  v_prior app_private.supplier_payment_draft_commands%rowtype;
  v_document public.supplier_payable_documents%rowtype;
  v_allocation jsonb;
  v_payload_hash text;
  v_project_id text := nullif(p_batch ->> 'project_id', '');
  v_construction_site_id text := nullif(p_batch ->> 'construction_site_id', '');
  v_supplier_id text := nullif(p_batch ->> 'supplier_id', '');
  v_currency text := coalesce(nullif(p_batch ->> 'currency', ''), 'VND');
  v_payment_amount numeric(18,2);
  v_paid_before numeric(18,2);
  v_reduction numeric(18,2);
  v_allocation_count integer;
  v_distinct_document_count integer;
  v_result jsonb;
begin
  if p_actor_user_id is null
     or public.current_app_user_id() is null
     or p_actor_user_id <> public.current_app_user_id() then
    raise exception 'SUPPLIER_PAYMENT_ACTOR_INVALID' using errcode = '42501';
  end if;

  begin
    v_batch_id := nullif(p_batch ->> 'id', '')::uuid;
    v_payment_amount := nullif(p_batch ->> 'payment_amount', '')::numeric(18,2);
  exception when invalid_text_representation then
    raise exception 'SUPPLIER_PAYMENT_DRAFT_PAYLOAD_INVALID' using errcode = '22023';
  end;

  if v_batch_id is null
     or p_idempotency_key is null
     or v_project_id is null and v_construction_site_id is null
     or v_supplier_id is null
     or nullif(btrim(coalesce(p_batch ->> 'code', '')), '') is null
     or nullif(btrim(coalesce(p_batch ->> 'supplier_name_snapshot', '')), '') is null
     or nullif(p_batch ->> 'payment_date', '') is null
     or coalesce(p_batch ->> 'status', 'draft') <> 'draft'
     or coalesce(v_payment_amount, 0) <= 0
     or jsonb_typeof(coalesce(p_allocations, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_allocations, '[]'::jsonb)) = 0 then
    raise exception 'SUPPLIER_PAYMENT_DRAFT_PAYLOAD_INVALID' using errcode = '22023';
  end if;

  if not app_private.can_manage_supplier_payments(v_project_id, v_construction_site_id) then
    raise exception 'SUPPLIER_PAYMENT_SCOPE_DENIED' using errcode = '42501';
  end if;

  v_payload_hash := md5(jsonb_build_object(
    'batch', p_batch,
    'allocations', coalesce(p_allocations, '[]'::jsonb),
    'expectedRowVersion', p_expected_row_version
  )::text);

  perform pg_advisory_xact_lock(hashtextextended('supplier-payment-draft:' || v_batch_id::text, 0));

  insert into app_private.supplier_payment_draft_commands (
    actor_user_id, idempotency_key, payment_batch_id, payload_hash
  ) values (
    p_actor_user_id, p_idempotency_key, v_batch_id, v_payload_hash
  ) on conflict do nothing;

  select * into strict v_prior
  from app_private.supplier_payment_draft_commands command
  where command.actor_user_id = p_actor_user_id
    and command.idempotency_key = p_idempotency_key
  for update;

  if v_prior.payload_hash <> v_payload_hash or v_prior.payment_batch_id <> v_batch_id then
    raise exception 'SUPPLIER_PAYMENT_IDEMPOTENCY_CONFLICT' using errcode = '22023';
  end if;
  if v_prior.result is not null then
    return v_prior.result || jsonb_build_object('replayed', true);
  end if;

  select * into v_existing
  from public.supplier_payment_batches batch
  where batch.id = v_batch_id
  for update;

  if p_expected_row_version is null then
    if found then
      raise exception 'SUPPLIER_PAYMENT_BATCH_ALREADY_EXISTS' using errcode = '40001';
    end if;
  else
    if not found or v_existing.row_version <> p_expected_row_version then
      raise exception 'SUPPLIER_PAYMENT_BATCH_VERSION_CONFLICT' using errcode = '40001';
    end if;
    if v_existing.status <> 'draft' then
      raise exception 'SUPPLIER_PAYMENT_BATCH_NOT_DRAFT' using errcode = '22023';
    end if;
    if v_existing.project_id is distinct from v_project_id
       or v_existing.construction_site_id is distinct from v_construction_site_id
       or v_existing.created_by is distinct from p_actor_user_id then
      raise exception 'SUPPLIER_PAYMENT_BATCH_SCOPE_CHANGED' using errcode = '42501';
    end if;
  end if;

  begin
    select count(*),
           count(distinct nullif(allocation.value ->> 'payable_document_id', '')::uuid)
    into v_allocation_count, v_distinct_document_count
    from jsonb_array_elements(p_allocations) allocation(value);
  exception when invalid_text_representation then
    raise exception 'SUPPLIER_PAYMENT_ALLOCATION_INVALID' using errcode = '22023';
  end;

  if v_allocation_count <> v_distinct_document_count
     or exists (
       select 1
       from jsonb_array_elements(p_allocations) allocation(value)
       where coalesce(nullif(allocation.value ->> 'payment_batch_id', '')::uuid, v_batch_id) <> v_batch_id
          or nullif(allocation.value ->> 'payable_document_id', '') is null
          or coalesce(nullif(allocation.value ->> 'allocated_amount', '')::numeric, 0) <= 0
          or coalesce(nullif(allocation.value ->> 'discount_amount', '')::numeric, 0) < 0
          or coalesce(nullif(allocation.value ->> 'withholding_amount', '')::numeric, 0) < 0
     )
     or (
       select coalesce(sum(nullif(allocation.value ->> 'allocated_amount', '')::numeric), 0)::numeric(18,2)
       from jsonb_array_elements(p_allocations) allocation(value)
     ) <> v_payment_amount then
    raise exception 'SUPPLIER_PAYMENT_ALLOCATION_TOTAL_INVALID' using errcode = '22023';
  end if;

  perform document.id
  from public.supplier_payable_documents document
  where document.id in (
    select nullif(allocation.value ->> 'payable_document_id', '')::uuid
    from jsonb_array_elements(p_allocations) allocation(value)
  )
  order by document.id
  for update;

  if (
    select count(*)
    from public.supplier_payable_documents document
    where document.id in (
      select nullif(allocation.value ->> 'payable_document_id', '')::uuid
      from jsonb_array_elements(p_allocations) allocation(value)
    )
  ) <> v_distinct_document_count
     or exists (
       select 1
       from public.supplier_payable_documents document
       where document.id in (
         select nullif(allocation.value ->> 'payable_document_id', '')::uuid
         from jsonb_array_elements(p_allocations) allocation(value)
       )
         and (
           document.project_id is distinct from v_project_id
           or document.construction_site_id is distinct from v_construction_site_id
           or document.supplier_id is distinct from v_supplier_id
           or document.currency <> v_currency
           or document.status in ('cancelled', 'reversed')
         )
     ) then
    raise exception 'SUPPLIER_PAYMENT_AP_SCOPE_INVALID' using errcode = '42501';
  end if;

  for v_allocation in
    select value
    from jsonb_array_elements(p_allocations) allocation(value)
    order by value ->> 'payable_document_id'
  loop
    select * into strict v_document
    from public.supplier_payable_documents document
    where document.id = (v_allocation ->> 'payable_document_id')::uuid;

    select coalesce(sum(
      paid_allocation.allocated_amount
      + paid_allocation.discount_amount
      + paid_allocation.withholding_amount
    ), 0)::numeric(18,2)
    into v_paid_before
    from public.supplier_payment_allocations paid_allocation
    join public.supplier_payment_batches paid_batch
      on paid_batch.id = paid_allocation.payment_batch_id
    where paid_allocation.payable_document_id = v_document.id
      and paid_batch.status = 'paid'
      and paid_batch.id <> v_batch_id;

    v_reduction := (
      coalesce(nullif(v_allocation ->> 'allocated_amount', '')::numeric, 0)
      + coalesce(nullif(v_allocation ->> 'discount_amount', '')::numeric, 0)
      + coalesce(nullif(v_allocation ->> 'withholding_amount', '')::numeric, 0)
    )::numeric(18,2);
    if v_reduction > v_document.recognized_amount - v_document.credit_amount - v_paid_before then
      raise exception 'SUPPLIER_PAYMENT_AP_CREDIT_EXCEEDED: %', v_document.document_no
        using errcode = '23514';
    end if;
  end loop;

  if p_expected_row_version is null then
    insert into public.supplier_payment_batches (
      id, code, project_id, construction_site_id, supplier_id, supplier_name_snapshot,
      period_month, payment_date, payment_method, cash_fund_id, cash_voucher_id,
      bank_account_snapshot, document_ref, total_recognized_snapshot, payment_amount,
      currency, allocation_mode, status, qr_token, attachments, metadata,
      created_by, note
    ) values (
      v_batch_id,
      btrim(p_batch ->> 'code'),
      v_project_id,
      v_construction_site_id,
      v_supplier_id,
      btrim(p_batch ->> 'supplier_name_snapshot'),
      nullif(p_batch ->> 'period_month', '')::date,
      (p_batch ->> 'payment_date')::date,
      coalesce(nullif(p_batch ->> 'payment_method', ''), 'bank_transfer'),
      nullif(p_batch ->> 'cash_fund_id', '')::uuid,
      nullif(p_batch ->> 'cash_voucher_id', '')::uuid,
      nullif(p_batch ->> 'bank_account_snapshot', ''),
      nullif(p_batch ->> 'document_ref', ''),
      coalesce(nullif(p_batch ->> 'total_recognized_snapshot', '')::numeric, 0),
      v_payment_amount,
      v_currency,
      coalesce(nullif(p_batch ->> 'allocation_mode', ''), 'fifo'),
      'draft',
      nullif(p_batch ->> 'qr_token', ''),
      coalesce(p_batch -> 'attachments', '[]'::jsonb),
      coalesce(p_batch -> 'metadata', '{}'::jsonb),
      p_actor_user_id,
      nullif(p_batch ->> 'note', '')
    ) returning * into v_saved;
  else
    update public.supplier_payment_batches
    set code = btrim(p_batch ->> 'code'),
        supplier_id = v_supplier_id,
        supplier_name_snapshot = btrim(p_batch ->> 'supplier_name_snapshot'),
        period_month = nullif(p_batch ->> 'period_month', '')::date,
        payment_date = (p_batch ->> 'payment_date')::date,
        payment_method = coalesce(nullif(p_batch ->> 'payment_method', ''), 'bank_transfer'),
        cash_fund_id = nullif(p_batch ->> 'cash_fund_id', '')::uuid,
        cash_voucher_id = nullif(p_batch ->> 'cash_voucher_id', '')::uuid,
        bank_account_snapshot = nullif(p_batch ->> 'bank_account_snapshot', ''),
        document_ref = nullif(p_batch ->> 'document_ref', ''),
        total_recognized_snapshot = coalesce(nullif(p_batch ->> 'total_recognized_snapshot', '')::numeric, 0),
        payment_amount = v_payment_amount,
        currency = v_currency,
        allocation_mode = coalesce(nullif(p_batch ->> 'allocation_mode', ''), 'fifo'),
        qr_token = nullif(p_batch ->> 'qr_token', ''),
        attachments = coalesce(p_batch -> 'attachments', '[]'::jsonb),
        metadata = coalesce(p_batch -> 'metadata', '{}'::jsonb),
        note = nullif(p_batch ->> 'note', '')
    where id = v_batch_id
    returning * into v_saved;
  end if;

  delete from public.supplier_payment_allocations
  where payment_batch_id = v_batch_id;

  for v_allocation in
    select value
    from jsonb_array_elements(p_allocations) allocation(value)
    order by value ->> 'payable_document_id'
  loop
    select * into strict v_document
    from public.supplier_payable_documents document
    where document.id = (v_allocation ->> 'payable_document_id')::uuid;

    select coalesce(sum(
      paid_allocation.allocated_amount
      + paid_allocation.discount_amount
      + paid_allocation.withholding_amount
    ), 0)::numeric(18,2)
    into v_paid_before
    from public.supplier_payment_allocations paid_allocation
    join public.supplier_payment_batches paid_batch
      on paid_batch.id = paid_allocation.payment_batch_id
    where paid_allocation.payable_document_id = v_document.id
      and paid_batch.status = 'paid'
      and paid_batch.id <> v_batch_id;

    insert into public.supplier_payment_allocations (
      payment_batch_id, payable_document_id, source_type, source_id,
      document_no_snapshot, recognized_amount_snapshot, paid_before_snapshot,
      outstanding_before_snapshot, allocated_amount, discount_amount,
      withholding_amount, allocation_mode, note
    ) values (
      v_batch_id,
      v_document.id,
      v_document.source_type,
      v_document.source_id,
      v_document.document_no,
      v_document.recognized_amount,
      v_paid_before,
      greatest(0, v_document.recognized_amount - v_document.credit_amount - v_paid_before),
      (v_allocation ->> 'allocated_amount')::numeric,
      coalesce(nullif(v_allocation ->> 'discount_amount', '')::numeric, 0),
      coalesce(nullif(v_allocation ->> 'withholding_amount', '')::numeric, 0),
      coalesce(nullif(v_allocation ->> 'allocation_mode', ''), v_saved.allocation_mode),
      nullif(v_allocation ->> 'note', '')
    );
  end loop;

  v_result := jsonb_build_object(
    'paymentBatch', to_jsonb(v_saved),
    'allocationCount', v_allocation_count,
    'rowVersion', v_saved.row_version,
    'replayed', false
  );

  update app_private.supplier_payment_draft_commands
  set result = v_result,
      completed_at = now()
  where actor_user_id = p_actor_user_id
    and idempotency_key = p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function app_private.save_supplier_payment_batch_draft_v1(
  jsonb, jsonb, bigint, uuid, uuid
) from public, anon, authenticated;
grant execute on function app_private.save_supplier_payment_batch_draft_v1(
  jsonb, jsonb, bigint, uuid, uuid
) to authenticated, service_role;

create or replace function public.save_supplier_payment_batch_draft_v1(
  p_batch jsonb,
  p_allocations jsonb default '[]'::jsonb,
  p_expected_row_version bigint default null,
  p_actor_user_id uuid default null,
  p_idempotency_key uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(p_actor_user_id, public.current_app_user_id());
begin
  if public.current_app_user_id() is null or v_actor <> public.current_app_user_id() then
    raise exception 'SUPPLIER_PAYMENT_ACTOR_INVALID' using errcode = '42501';
  end if;
  return app_private.save_supplier_payment_batch_draft_v1(
    p_batch,
    p_allocations,
    p_expected_row_version,
    v_actor,
    p_idempotency_key
  );
end;
$$;

revoke all on function public.save_supplier_payment_batch_draft_v1(
  jsonb, jsonb, bigint, uuid, uuid
) from public, anon;
grant execute on function public.save_supplier_payment_batch_draft_v1(
  jsonb, jsonb, bigint, uuid, uuid
) to authenticated, service_role;

create or replace function app_private.post_supplier_payment_batch(
  p_batch_id uuid,
  p_actor_id uuid default null
)
returns public.supplier_payment_batches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.supplier_payment_batches%rowtype;
  v_allocated numeric(18,2);
  v_finance_id text := '';
  v_tx_id text;
  v_allocation record;
  v_actor_id uuid := public.current_app_user_id();
begin
  select * into v_batch
  from public.supplier_payment_batches batch
  where batch.id = p_batch_id
  for update;

  if not found then
    raise exception 'Không tìm thấy đợt thanh toán %. ', p_batch_id using errcode = 'P0002';
  end if;
  if v_actor_id is null or (p_actor_id is not null and p_actor_id <> v_actor_id) then
    raise exception 'Người thực hiện thanh toán không khớp với phiên đăng nhập.' using errcode = '42501';
  end if;
  if not app_private.can_manage_supplier_payments(v_batch.project_id, v_batch.construction_site_id) then
    raise exception 'Bạn không có quyền post đợt thanh toán này.' using errcode = '42501';
  end if;
  if v_batch.status in ('cancelled', 'reversed') then
    raise exception 'Không thể post đợt thanh toán đã huỷ/đảo.' using errcode = '22023';
  end if;

  if v_batch.status = 'paid' and exists (
    select 1
    from public.project_transactions transaction_row
    where transaction_row.source_ref = 'supplier_payment_batch:' || p_batch_id::text
  ) then
    return v_batch;
  end if;

  if v_batch.status <> 'paid' then
    select coalesce(sum(allocation.allocated_amount), 0)::numeric(18,2)
    into v_allocated
    from public.supplier_payment_allocations allocation
    where allocation.payment_batch_id = p_batch_id;

    if v_allocated <> v_batch.payment_amount then
      raise exception 'Tổng phân bổ (%) phải bằng số tiền thanh toán (%).', v_allocated, v_batch.payment_amount
        using errcode = '23514';
    end if;

    perform document.id
    from public.supplier_payable_documents document
    join public.supplier_payment_allocations allocation
      on allocation.payable_document_id = document.id
    where allocation.payment_batch_id = p_batch_id
    order by document.id
    for update of document;

    for v_allocation in
      select
        allocation.*,
        document.document_no,
        document.project_id,
        document.construction_site_id,
        document.supplier_id,
        document.currency,
        document.status as document_status,
        document.recognized_amount,
        document.credit_amount,
        coalesce((
          select sum(other_allocation.allocated_amount + other_allocation.discount_amount + other_allocation.withholding_amount)
          from public.supplier_payment_allocations other_allocation
          join public.supplier_payment_batches other_batch
            on other_batch.id = other_allocation.payment_batch_id
          where other_allocation.payable_document_id = allocation.payable_document_id
            and other_batch.status = 'paid'
            and other_batch.id <> p_batch_id
        ), 0) as paid_before
      from public.supplier_payment_allocations allocation
      join public.supplier_payable_documents document
        on document.id = allocation.payable_document_id
      where allocation.payment_batch_id = p_batch_id
      order by document.id
    loop
      if v_allocation.project_id is distinct from v_batch.project_id
         or v_allocation.construction_site_id is distinct from v_batch.construction_site_id
         or v_allocation.supplier_id is distinct from v_batch.supplier_id
         or v_allocation.currency <> v_batch.currency
         or v_allocation.document_status in ('cancelled', 'reversed') then
        raise exception 'Chứng từ AP % không còn thuộc phạm vi thanh toán.', v_allocation.document_no
          using errcode = '42501';
      end if;
      if v_allocation.paid_before
         + v_allocation.allocated_amount
         + v_allocation.discount_amount
         + v_allocation.withholding_amount
         > v_allocation.recognized_amount - v_allocation.credit_amount then
        raise exception 'Số phân bổ vượt công nợ của chứng từ %.', v_allocation.document_no
          using errcode = '23514';
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
  ) values (
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
  set "projectFinanceId" = excluded."projectFinanceId",
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
  set status = 'paid',
      paid_by = coalesce(paid_by, v_actor_id),
      paid_at = coalesce(paid_at, now()),
      project_transaction_id = v_tx_id,
      updated_at = now()
  where id = p_batch_id
  returning * into v_batch;

  update public.supplier_payable_documents document
  set status = case
        when balance.outstanding_amount <= 0 then 'paid'
        when balance.paid_amount > 0 then 'partial'
        else document.status
      end,
      updated_at = now()
  from public.supplier_payable_document_balances balance
  where balance.id = document.id
    and document.id in (
      select allocation.payable_document_id
      from public.supplier_payment_allocations allocation
      where allocation.payment_batch_id = p_batch_id
    );

  return v_batch;
end;
$$;

revoke all on function app_private.post_supplier_payment_batch(uuid, uuid)
from public, anon, authenticated;
grant execute on function app_private.post_supplier_payment_batch(uuid, uuid)
to authenticated, service_role;

create or replace function public.post_supplier_payment_batch(
  p_batch_id uuid,
  p_actor_id uuid default null
)
returns public.supplier_payment_batches
language sql
security invoker
set search_path = ''
as $$
  select app_private.post_supplier_payment_batch(p_batch_id, p_actor_id);
$$;

revoke all on function public.post_supplier_payment_batch(uuid, uuid) from public, anon;
grant execute on function public.post_supplier_payment_batch(uuid, uuid) to authenticated, service_role;
