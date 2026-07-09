create schema if not exists app_private;

alter table if exists public.supplier_contracts
  add column if not exists qr_token text;

update public.supplier_contracts
set qr_token = 'qr_supplier_contract_' || substr(md5(id), 1, 24)
where qr_token is null or qr_token = '';

create unique index if not exists idx_supplier_contracts_qr_token_unique
  on public.supplier_contracts(qr_token)
  where qr_token is not null;

create or replace function app_private.trace_link_status(p_status text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case lower(coalesce(p_status, 'active'))
    when 'cancelled' then 'cancelled'
    when 'canceled' then 'cancelled'
    when 'reversed' then 'reversed'
    when 'void' then 'void'
    when 'returned' then 'returned'
    else 'active'
  end;
$$;

create or replace function app_private.upsert_project_document_link(
  p_source_type text,
  p_source_id text,
  p_target_type text,
  p_target_id text,
  p_project_id text default null,
  p_relation_type text default 'downstream',
  p_status text default 'active',
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(trim(coalesce(p_source_type, '')), '') is null
    or nullif(trim(coalesce(p_source_id, '')), '') is null
    or nullif(trim(coalesce(p_target_type, '')), '') is null
    or nullif(trim(coalesce(p_target_id, '')), '') is null
  then
    return;
  end if;

  insert into public.project_document_links (
    source_type,
    source_id,
    target_type,
    target_id,
    project_id,
    relation_type,
    status,
    metadata
  )
  values (
    p_source_type,
    p_source_id,
    p_target_type,
    p_target_id,
    p_project_id,
    coalesce(nullif(p_relation_type, ''), 'downstream'),
    app_private.trace_link_status(p_status),
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (source_type, source_id, target_type, target_id, relation_type)
  do update set
    project_id = coalesce(excluded.project_id, public.project_document_links.project_id),
    status = excluded.status,
    metadata = coalesce(public.project_document_links.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();
end;
$$;

create or replace function app_private.sync_supplier_direct_delivery_trace_links(p_note_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note public.supplier_direct_delivery_notes%rowtype;
  v_row record;
begin
  select * into v_note
  from public.supplier_direct_delivery_notes
  where id = p_note_id;

  if not found then
    return;
  end if;

  perform app_private.upsert_project_document_link(
    'supplier_contract',
    v_note.supplier_contract_id,
    'supplier_direct_delivery_note',
    v_note.id::text,
    v_note.project_id,
    'delivery_note',
    v_note.status,
    jsonb_build_object(
      'code', v_note.code,
      'deliveryTicketNo', v_note.delivery_ticket_no,
      'deliveryDate', v_note.delivery_date,
      'supplierName', v_note.supplier_name_snapshot,
      'amount', v_note.total_amount
    )
  );

  for v_row in
    select
      dl.wms_import_transaction_id as import_transaction_id,
      min(tx.status::text) as transaction_status,
      jsonb_agg(dl.id order by dl.line_no) as line_ids,
      count(*) as line_count
    from public.supplier_direct_delivery_lines dl
    left join public.transactions tx on tx.id = dl.wms_import_transaction_id
    where dl.delivery_note_id = p_note_id
      and dl.wms_import_transaction_id is not null
    group by dl.wms_import_transaction_id
  loop
    perform app_private.upsert_project_document_link(
      'supplier_direct_delivery_note',
      v_note.id::text,
      'wms_transaction',
      v_row.import_transaction_id,
      v_note.project_id,
      'wms_import',
      coalesce(v_row.transaction_status, v_note.status),
      jsonb_build_object(
        'lineIds', v_row.line_ids,
        'lineCount', v_row.line_count,
        'supplierDirectDeliveryNoteCode', v_note.code
      )
    );
  end loop;

  for v_row in
    select
      dl.wms_import_transaction_id as import_transaction_id,
      dl.wms_export_transaction_id as export_transaction_id,
      min(tx.status::text) as transaction_status,
      jsonb_agg(dl.id order by dl.line_no) as line_ids,
      count(*) as line_count
    from public.supplier_direct_delivery_lines dl
    left join public.transactions tx on tx.id = dl.wms_export_transaction_id
    where dl.delivery_note_id = p_note_id
      and dl.wms_import_transaction_id is not null
      and dl.wms_export_transaction_id is not null
    group by dl.wms_import_transaction_id, dl.wms_export_transaction_id
  loop
    perform app_private.upsert_project_document_link(
      'wms_transaction',
      v_row.import_transaction_id,
      'wms_transaction',
      v_row.export_transaction_id,
      v_note.project_id,
      'wms_export',
      coalesce(v_row.transaction_status, v_note.status),
      jsonb_build_object(
        'lineIds', v_row.line_ids,
        'lineCount', v_row.line_count,
        'supplierDirectDeliveryNoteId', v_note.id
      )
    );
  end loop;

  for v_row in
    select distinct
      s.id as statement_id,
      s.code as statement_code,
      s.status as statement_status,
      s.total_amount as statement_total_amount
    from public.supplier_delivery_statement_lines sl
    join public.supplier_delivery_statements s on s.id = sl.statement_id
    where sl.delivery_note_id = p_note_id
  loop
    perform app_private.upsert_project_document_link(
      'supplier_direct_delivery_note',
      v_note.id::text,
      'supplier_delivery_statement',
      v_row.statement_id::text,
      v_note.project_id,
      'statement',
      v_row.statement_status,
      jsonb_build_object(
        'statementCode', v_row.statement_code,
        'amount', v_row.statement_total_amount
      )
    );
  end loop;
end;
$$;

create or replace function app_private.sync_supplier_delivery_statement_trace_links(p_statement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_statement public.supplier_delivery_statements%rowtype;
  v_row record;
begin
  select * into v_statement
  from public.supplier_delivery_statements
  where id = p_statement_id;

  if not found then
    return;
  end if;

  for v_row in
    select distinct
      note.id as delivery_note_id,
      note.code as delivery_note_code,
      note.total_amount as delivery_note_amount
    from public.supplier_delivery_statement_lines sl
    join public.supplier_direct_delivery_notes note on note.id = sl.delivery_note_id
    where sl.statement_id = p_statement_id
  loop
    perform app_private.upsert_project_document_link(
      'supplier_direct_delivery_note',
      v_row.delivery_note_id::text,
      'supplier_delivery_statement',
      v_statement.id::text,
      v_statement.project_id,
      'statement',
      v_statement.status,
      jsonb_build_object(
        'deliveryNoteCode', v_row.delivery_note_code,
        'statementCode', v_statement.code,
        'amount', v_statement.total_amount
      )
    );
  end loop;

  if v_statement.payable_document_id is not null then
    perform app_private.upsert_project_document_link(
      'supplier_delivery_statement',
      v_statement.id::text,
      'supplier_payable_document',
      v_statement.payable_document_id::text,
      v_statement.project_id,
      'recognizes',
      v_statement.status,
      jsonb_build_object(
        'statementCode', v_statement.code,
        'supplierContractId', v_statement.supplier_contract_id,
        'amount', v_statement.total_amount
      )
    );
  end if;
end;
$$;

create or replace function app_private.sync_supplier_payable_trace_links(p_payable_document_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.supplier_payable_documents%rowtype;
begin
  select * into v_document
  from public.supplier_payable_documents
  where id = p_payable_document_id;

  if not found then
    return;
  end if;

  if v_document.source_type in ('purchase_order', 'site_direct_purchase', 'supplier_delivery_statement')
    and nullif(v_document.source_id, '') is not null
  then
    perform app_private.upsert_project_document_link(
      v_document.source_type,
      v_document.source_id,
      'supplier_payable_document',
      v_document.id::text,
      v_document.project_id,
      'recognizes',
      v_document.status,
      jsonb_build_object(
        'payableCode', v_document.code,
        'documentNo', v_document.document_no,
        'recognizedAmount', v_document.recognized_amount,
        'supplierName', v_document.supplier_name_snapshot
      )
    );
  end if;
end;
$$;

create or replace function app_private.sync_supplier_payment_batch_trace_links(p_payment_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.supplier_payment_batches%rowtype;
  v_row record;
begin
  select * into v_batch
  from public.supplier_payment_batches
  where id = p_payment_batch_id;

  if not found then
    return;
  end if;

  for v_row in
    select
      a.payable_document_id,
      a.allocated_amount,
      d.code as payable_code,
      d.document_no
    from public.supplier_payment_allocations a
    join public.supplier_payable_documents d on d.id = a.payable_document_id
    where a.payment_batch_id = p_payment_batch_id
  loop
    perform app_private.upsert_project_document_link(
      'supplier_payable_document',
      v_row.payable_document_id::text,
      'supplier_payment_batch',
      v_batch.id::text,
      v_batch.project_id,
      'paid_by',
      v_batch.status,
      jsonb_build_object(
        'paymentBatchCode', v_batch.code,
        'payableCode', v_row.payable_code,
        'documentNo', v_row.document_no,
        'allocatedAmount', v_row.allocated_amount
      )
    );
  end loop;

  if v_batch.project_transaction_id is not null then
    perform app_private.upsert_project_document_link(
      'supplier_payment_batch',
      v_batch.id::text,
      'project_transaction',
      v_batch.project_transaction_id,
      v_batch.project_id,
      'cashflow',
      v_batch.status,
      jsonb_build_object(
        'paymentBatchCode', v_batch.code,
        'amount', v_batch.payment_amount
      )
    );
  end if;
end;
$$;

create or replace function app_private.sync_site_cash_settlement_trace_links(p_settlement_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.site_cash_settlement_batches%rowtype;
  v_row record;
begin
  select * into v_batch
  from public.site_cash_settlement_batches
  where id = p_settlement_batch_id;

  if not found then
    return;
  end if;

  for v_row in
    select
      line.source_id,
      line.document_no_snapshot,
      line.approved_amount
    from public.site_cash_settlement_lines line
    where line.settlement_batch_id = p_settlement_batch_id
      and line.source_type = 'site_direct_purchase'
      and nullif(line.source_id, '') is not null
  loop
    perform app_private.upsert_project_document_link(
      'site_direct_purchase',
      v_row.source_id,
      'site_cash_settlement_batch',
      v_batch.id::text,
      v_batch.project_id,
      'settled_by',
      v_batch.status,
      jsonb_build_object(
        'settlementCode', v_batch.code,
        'documentNo', v_row.document_no_snapshot,
        'approvedAmount', v_row.approved_amount
      )
    );
  end loop;

  if v_batch.project_transaction_id is not null then
    perform app_private.upsert_project_document_link(
      'site_cash_settlement_batch',
      v_batch.id::text,
      'project_transaction',
      v_batch.project_transaction_id,
      v_batch.project_id,
      'cashflow',
      v_batch.status,
      jsonb_build_object(
        'settlementCode', v_batch.code,
        'amount', coalesce(v_batch.approved_site_cash_spend, 0) + coalesce(v_batch.staff_reimbursed_amount, 0)
      )
    );
  end if;
end;
$$;

create or replace function app_private.trg_supplier_direct_delivery_note_trace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.sync_supplier_direct_delivery_trace_links(new.id);
  return new;
end;
$$;

create or replace function app_private.trg_supplier_direct_delivery_line_trace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform app_private.sync_supplier_direct_delivery_trace_links(old.delivery_note_id);
    return old;
  end if;

  perform app_private.sync_supplier_direct_delivery_trace_links(new.delivery_note_id);
  if tg_op = 'UPDATE' and new.delivery_note_id is distinct from old.delivery_note_id then
    perform app_private.sync_supplier_direct_delivery_trace_links(old.delivery_note_id);
  end if;
  return new;
end;
$$;

create or replace function app_private.trg_supplier_delivery_statement_trace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.sync_supplier_delivery_statement_trace_links(new.id);
  if new.payable_document_id is not null then
    perform app_private.sync_supplier_payable_trace_links(new.payable_document_id);
  end if;
  return new;
end;
$$;

create or replace function app_private.trg_supplier_delivery_statement_line_trace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform app_private.sync_supplier_direct_delivery_trace_links(old.delivery_note_id);
    perform app_private.sync_supplier_delivery_statement_trace_links(old.statement_id);
    return old;
  end if;

  perform app_private.sync_supplier_direct_delivery_trace_links(new.delivery_note_id);
  perform app_private.sync_supplier_delivery_statement_trace_links(new.statement_id);
  if tg_op = 'UPDATE' and new.delivery_note_id is distinct from old.delivery_note_id then
    perform app_private.sync_supplier_direct_delivery_trace_links(old.delivery_note_id);
  end if;
  if tg_op = 'UPDATE' and new.statement_id is distinct from old.statement_id then
    perform app_private.sync_supplier_delivery_statement_trace_links(old.statement_id);
  end if;
  return new;
end;
$$;

create or replace function app_private.trg_supplier_payable_trace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.sync_supplier_payable_trace_links(new.id);
  return new;
end;
$$;

create or replace function app_private.trg_supplier_payment_allocation_trace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform app_private.sync_supplier_payment_batch_trace_links(old.payment_batch_id);
    return old;
  end if;
  perform app_private.sync_supplier_payment_batch_trace_links(new.payment_batch_id);
  if tg_op = 'UPDATE' and new.payment_batch_id is distinct from old.payment_batch_id then
    perform app_private.sync_supplier_payment_batch_trace_links(old.payment_batch_id);
  end if;
  return new;
end;
$$;

create or replace function app_private.trg_supplier_payment_batch_trace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.sync_supplier_payment_batch_trace_links(new.id);
  return new;
end;
$$;

create or replace function app_private.trg_site_cash_settlement_batch_trace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.sync_site_cash_settlement_trace_links(new.id);
  return new;
end;
$$;

create or replace function app_private.trg_site_cash_settlement_line_trace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform app_private.sync_site_cash_settlement_trace_links(old.settlement_batch_id);
    return old;
  end if;
  perform app_private.sync_site_cash_settlement_trace_links(new.settlement_batch_id);
  if tg_op = 'UPDATE' and new.settlement_batch_id is distinct from old.settlement_batch_id then
    perform app_private.sync_site_cash_settlement_trace_links(old.settlement_batch_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_trace_supplier_direct_delivery_note on public.supplier_direct_delivery_notes;
create trigger trg_trace_supplier_direct_delivery_note
after insert or update of supplier_contract_id, project_id, construction_site_id, status, code, total_amount
on public.supplier_direct_delivery_notes
for each row execute function app_private.trg_supplier_direct_delivery_note_trace();

drop trigger if exists trg_trace_supplier_direct_delivery_line on public.supplier_direct_delivery_lines;
create trigger trg_trace_supplier_direct_delivery_line
after insert or update of delivery_note_id, wms_import_transaction_id, wms_export_transaction_id, wms_status, statement_id, status or delete
on public.supplier_direct_delivery_lines
for each row execute function app_private.trg_supplier_direct_delivery_line_trace();

drop trigger if exists trg_trace_supplier_delivery_statement on public.supplier_delivery_statements;
create trigger trg_trace_supplier_delivery_statement
after insert or update of project_id, construction_site_id, status, total_amount, payable_document_id
on public.supplier_delivery_statements
for each row execute function app_private.trg_supplier_delivery_statement_trace();

drop trigger if exists trg_trace_supplier_delivery_statement_line on public.supplier_delivery_statement_lines;
create trigger trg_trace_supplier_delivery_statement_line
after insert or update of statement_id, delivery_note_id, delivery_line_id, total_amount or delete
on public.supplier_delivery_statement_lines
for each row execute function app_private.trg_supplier_delivery_statement_line_trace();

drop trigger if exists trg_trace_supplier_payable_document on public.supplier_payable_documents;
create trigger trg_trace_supplier_payable_document
after insert or update of source_type, source_id, project_id, construction_site_id, status, recognized_amount
on public.supplier_payable_documents
for each row execute function app_private.trg_supplier_payable_trace();

drop trigger if exists trg_trace_supplier_payment_batch on public.supplier_payment_batches;
create trigger trg_trace_supplier_payment_batch
after insert or update of project_id, construction_site_id, status, payment_amount, project_transaction_id
on public.supplier_payment_batches
for each row execute function app_private.trg_supplier_payment_batch_trace();

drop trigger if exists trg_trace_supplier_payment_allocation on public.supplier_payment_allocations;
create trigger trg_trace_supplier_payment_allocation
after insert or update of payment_batch_id, payable_document_id, allocated_amount or delete
on public.supplier_payment_allocations
for each row execute function app_private.trg_supplier_payment_allocation_trace();

drop trigger if exists trg_trace_site_cash_settlement_batch on public.site_cash_settlement_batches;
create trigger trg_trace_site_cash_settlement_batch
after insert or update of project_id, construction_site_id, status, approved_site_cash_spend, staff_reimbursed_amount, project_transaction_id
on public.site_cash_settlement_batches
for each row execute function app_private.trg_site_cash_settlement_batch_trace();

drop trigger if exists trg_trace_site_cash_settlement_line on public.site_cash_settlement_lines;
create trigger trg_trace_site_cash_settlement_line
after insert or update of settlement_batch_id, source_type, source_id, approved_amount or delete
on public.site_cash_settlement_lines
for each row execute function app_private.trg_site_cash_settlement_line_trace();

do $$
declare
  v_row record;
begin
  for v_row in select id from public.supplier_direct_delivery_notes loop
    perform app_private.sync_supplier_direct_delivery_trace_links(v_row.id);
  end loop;

  for v_row in select id from public.supplier_delivery_statements loop
    perform app_private.sync_supplier_delivery_statement_trace_links(v_row.id);
  end loop;

  for v_row in
    select id
    from public.supplier_payable_documents
    where source_type in ('purchase_order', 'site_direct_purchase', 'supplier_delivery_statement')
  loop
    perform app_private.sync_supplier_payable_trace_links(v_row.id);
  end loop;

  for v_row in select id from public.supplier_payment_batches loop
    perform app_private.sync_supplier_payment_batch_trace_links(v_row.id);
  end loop;

  for v_row in select id from public.site_cash_settlement_batches loop
    perform app_private.sync_site_cash_settlement_trace_links(v_row.id);
  end loop;
end;
$$;

revoke all on function app_private.trace_link_status(text) from public, anon, authenticated;
revoke all on function app_private.upsert_project_document_link(text, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function app_private.sync_supplier_direct_delivery_trace_links(uuid) from public, anon, authenticated;
revoke all on function app_private.sync_supplier_delivery_statement_trace_links(uuid) from public, anon, authenticated;
revoke all on function app_private.sync_supplier_payable_trace_links(uuid) from public, anon, authenticated;
revoke all on function app_private.sync_supplier_payment_batch_trace_links(uuid) from public, anon, authenticated;
revoke all on function app_private.sync_site_cash_settlement_trace_links(uuid) from public, anon, authenticated;
revoke all on function app_private.trg_supplier_direct_delivery_note_trace() from public, anon, authenticated;
revoke all on function app_private.trg_supplier_direct_delivery_line_trace() from public, anon, authenticated;
revoke all on function app_private.trg_supplier_delivery_statement_trace() from public, anon, authenticated;
revoke all on function app_private.trg_supplier_delivery_statement_line_trace() from public, anon, authenticated;
revoke all on function app_private.trg_supplier_payable_trace() from public, anon, authenticated;
revoke all on function app_private.trg_supplier_payment_allocation_trace() from public, anon, authenticated;
revoke all on function app_private.trg_supplier_payment_batch_trace() from public, anon, authenticated;
revoke all on function app_private.trg_site_cash_settlement_batch_trace() from public, anon, authenticated;
revoke all on function app_private.trg_site_cash_settlement_line_trace() from public, anon, authenticated;

notify pgrst, 'reload schema';
