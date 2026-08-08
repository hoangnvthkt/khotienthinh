-- Run after supplier payment ledger recovery migration.
-- Safe on Cloud: reversal state and diagnostic rows are rolled back.

begin;

create temp table supplier_payment_ledger_fixture on commit drop as
select
  batch.id as batch_id,
  batch.code,
  batch.paid_by as actor_id,
  app_user.auth_id,
  app_user.email,
  batch.payment_amount,
  batch.project_id,
  batch.construction_site_id,
  batch.payment_date,
  payable.id as payable_document_id,
  payable.recognized_amount
from public.supplier_payment_batches batch
join public.users app_user on app_user.id = batch.paid_by
left join lateral (
  select document.id, document.recognized_amount
  from public.supplier_payment_allocations allocation
  join public.supplier_payable_documents document on document.id = allocation.payable_document_id
  where allocation.payment_batch_id = batch.id
    and document.source_type = 'supplier_delivery_statement'
  limit 1
) payable on true
where batch.code = 'PAY-20260807-9D4F5BC7'
  and batch.status = 'paid'
limit 1;

do $$
begin
  if not exists (select 1 from supplier_payment_ledger_fixture) then
    raise exception 'Missing paid PAY fixture PAY-20260807-9D4F5BC7';
  end if;
end $$;

grant select on supplier_payment_ledger_fixture to authenticated;
grant execute on function app_private.can_manage_supplier_payments(text, text) to authenticated;

set local role authenticated;

select
  set_config('request.jwt.claim.sub', '', true),
  set_config('request.jwt.claim.email', '', true),
  set_config('request.jwt.claims', '{"role":"authenticated"}', true);

do $$
declare
  fixture supplier_payment_ledger_fixture%rowtype;
begin
  select * into fixture from supplier_payment_ledger_fixture;
  if app_private.can_manage_supplier_payments(fixture.project_id, fixture.construction_site_id) then
    raise exception 'Supplier payment permission unexpectedly granted without an authenticated app user';
  end if;
end $$;

select
  set_config('request.jwt.claim.sub', auth_id::text, true),
  set_config('request.jwt.claim.email', coalesce(email, ''), true),
  set_config('request.jwt.claims', jsonb_build_object(
    'sub', auth_id::text,
    'email', coalesce(email, ''),
    'role', 'authenticated'
  )::text, true)
from supplier_payment_ledger_fixture;

do $$
declare
  fixture supplier_payment_ledger_fixture%rowtype;
  posted public.supplier_payment_batches%rowtype;
  reversed public.supplier_payment_batches%rowtype;
  transaction_count integer;
  reversal_count integer;
  first_reversal_date text;
  spoofed_actor_rejected boolean := false;
  deleted_payable_id uuid := gen_random_uuid();
  direct_batch_write_rejected boolean := false;
  paid_allocation_write_rejected boolean := false;
begin
  select * into fixture from supplier_payment_ledger_fixture;

  begin
    perform public.post_supplier_payment_batch(fixture.batch_id, gen_random_uuid());
  exception when others then
    spoofed_actor_rejected := sqlerrm like '%không khớp với phiên đăng nhập%';
  end;

  if not spoofed_actor_rejected then
    raise exception 'Supplier payment RPC accepted a spoofed actor id';
  end if;

  posted := public.post_supplier_payment_batch(fixture.batch_id, fixture.actor_id);
  posted := public.post_supplier_payment_batch(fixture.batch_id, fixture.actor_id);

  begin
    update public.supplier_payment_batches
    set updated_at = now()
    where id = fixture.batch_id;
  exception when others then
    direct_batch_write_rejected := sqlerrm like '%bất biến ngoài RPC%';
  end;

  if not direct_batch_write_rejected then
    raise exception 'Direct table update bypassed paid supplier payment batch invariants';
  end if;

  begin
    update public.supplier_payment_allocations
    set allocated_amount = allocated_amount
    where payment_batch_id = fixture.batch_id;
  exception when others then
    paid_allocation_write_rejected := sqlerrm like '%Không được sửa phân bổ%';
  end;

  if not paid_allocation_write_rejected then
    raise exception 'Direct table update changed allocations of a paid supplier payment batch';
  end if;

  select count(*) into transaction_count
  from public.project_transactions transaction_row
  where transaction_row.source_ref = 'supplier_payment_batch:' || fixture.batch_id::text
    and transaction_row.type = 'expense'
    and transaction_row.category = 'materials'
    and transaction_row.amount = fixture.payment_amount
    and transaction_row.project_id is not distinct from fixture.project_id
    and transaction_row.construction_site_id is not distinct from fixture.construction_site_id
    and transaction_row.date = fixture.payment_date::text;

  if transaction_count <> 1 then
    raise exception 'Posting PAY must produce exactly one matching ledger transaction, got %', transaction_count;
  end if;

  if posted.project_transaction_id is null or not exists (
    select 1
    from public.project_transactions transaction_row
    where transaction_row.id = posted.project_transaction_id
      and transaction_row.source_ref = 'supplier_payment_batch:' || fixture.batch_id::text
  ) then
    raise exception 'Paid batch is not linked to its ledger transaction';
  end if;

  if fixture.payable_document_id is null or not exists (
    select 1
    from public.project_transactions transaction_row
    where transaction_row.source_ref = 'supplier_payable_document:' || fixture.payable_document_id::text || ':recognition'
      and transaction_row.type = 'expense'
      and transaction_row.category = 'materials'
      and transaction_row.amount = fixture.recognized_amount
  ) then
    raise exception 'Statement AP recognition was not materialized as one idempotent actual-cost transaction';
  end if;

  insert into public.supplier_payable_documents (
    id, code, source_type, source_id, project_id, construction_site_id,
    supplier_id, supplier_name_snapshot, document_no, document_date,
    recognized_amount, status, created_by
  ) values (
    deleted_payable_id,
    'AP-SMOKE-' || deleted_payable_id::text,
    'supplier_delivery_statement',
    'smoke-' || deleted_payable_id::text,
    fixture.project_id,
    fixture.construction_site_id,
    (select supplier_id from public.supplier_payment_batches where id = fixture.batch_id),
    'NCC smoke test',
    'SMOKE-' || deleted_payable_id::text,
    current_date,
    123,
    'open',
    fixture.actor_id
  );

  delete from public.supplier_payable_documents where id = deleted_payable_id;

  if not exists (
    select 1
    from public.project_transactions transaction_row
    where transaction_row.source_ref = 'supplier_payable_document:' || deleted_payable_id::text || ':recognition'
      and transaction_row.amount = 0
  ) then
    raise exception 'Deleting statement AP did not neutralize its recognition transaction';
  end if;

  if exists (
    select 1
    from public.supplier_payment_batches batch
    where batch.status = 'paid'
      and batch.project_transaction_id is null
  ) then
    raise exception 'Backfill left paid supplier payment batches without ledger links';
  end if;

  reversed := public.reverse_supplier_payment_batch(fixture.batch_id, fixture.actor_id);

  select transaction_row.date into first_reversal_date
  from public.project_transactions transaction_row
  where transaction_row.source_ref = 'supplier_payment_batch:' || fixture.batch_id::text || ':reversal';

  update public.project_transactions
  set date = '2000-01-01'
  where source_ref = 'supplier_payment_batch:' || fixture.batch_id::text || ':reversal';

  reversed := public.reverse_supplier_payment_batch(fixture.batch_id, fixture.actor_id);

  select count(*) into reversal_count
  from public.project_transactions transaction_row
  where transaction_row.source_ref = 'supplier_payment_batch:' || fixture.batch_id::text || ':reversal'
    and transaction_row.type = 'expense'
    and transaction_row.category = 'materials'
    and transaction_row.amount = -fixture.payment_amount;

  if reversal_count <> 1 then
    raise exception 'Reversing PAY must produce exactly one negative ledger transaction, got %', reversal_count;
  end if;

  if not exists (
    select 1
    from public.project_transactions transaction_row
    where transaction_row.source_ref = 'supplier_payment_batch:' || fixture.batch_id::text || ':reversal'
      and transaction_row.date = '2000-01-01'
  ) then
    raise exception 'Retrying a reversal changed the original reversal reporting date (initially %) ', first_reversal_date;
  end if;

  if reversed.status <> 'reversed' or reversed.project_transaction_id <> posted.project_transaction_id then
    raise exception 'Reversal must preserve the original ledger link and reversed status';
  end if;
end $$;

reset role;

select 'supplier_payment_ledger_recovery_smoke_passed' as result;

rollback;
