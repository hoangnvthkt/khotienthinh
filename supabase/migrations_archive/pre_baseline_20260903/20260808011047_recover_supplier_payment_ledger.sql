create or replace function app_private.can_manage_supplier_payments(
  p_project_id text,
  p_construction_site_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.is_admin()
    or public.is_module_admin('DA')
    or app_private.project_has_permission_v2(
      p_project_id,
      p_construction_site_id,
      'project.cashflow.manage',
      public.current_app_user_id()
    )
    or app_private.project_has_permission_v2(
      p_project_id,
      p_construction_site_id,
      'project.payment.mark_paid',
      public.current_app_user_id()
    ),
    false
  );
$$;

revoke all on function app_private.can_manage_supplier_payments(text, text) from public, anon, authenticated;

create or replace function public.post_supplier_payment_batch(p_batch_id uuid, p_actor_id uuid default null)
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
$$;

create or replace function public.reverse_supplier_payment_batch(p_batch_id uuid, p_actor_id uuid default null)
returns public.supplier_payment_batches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.supplier_payment_batches%rowtype;
  v_finance_id text := '';
  v_tx_id text;
  v_reversal_ref text;
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
    raise exception 'Người thực hiện đảo thanh toán không khớp với phiên đăng nhập.';
  end if;

  if not app_private.can_manage_supplier_payments(v_batch.project_id, v_batch.construction_site_id) then
    raise exception 'Bạn không có quyền đảo đợt thanh toán này.';
  end if;

  if v_batch.status not in ('paid', 'reversed') then
    raise exception 'Chỉ đảo được đợt thanh toán đã paid.';
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
    amount = excluded.amount,
    description = excluded.description,
    date = excluded.date,
    attachments = excluded.attachments,
    counterparty_name = excluded.counterparty_name,
    counterparty_partner_id = excluded.counterparty_partner_id
  returning id into v_tx_id;

  v_reversal_ref := 'supplier_payment_batch:' || p_batch_id::text || ':reversal';

  insert into public.project_transactions (
    id, "projectFinanceId", "constructionSiteId", project_id, project_finance_id, construction_site_id,
    type, category, amount, description, date, source, "sourceRef", source_ref,
    attachments, "createdBy", "createdAt", counterparty_name, counterparty_partner_id
  )
  values (
    'supplier-payment-reversal-' || p_batch_id::text,
    coalesce(v_finance_id, ''),
    coalesce(v_batch.construction_site_id, ''),
    v_batch.project_id,
    nullif(v_finance_id, ''),
    v_batch.construction_site_id,
    'expense',
    'materials',
    -v_batch.payment_amount,
    'Đảo thanh toán NCC ' || v_batch.supplier_name_snapshot || ' - ' || v_batch.code,
    current_date::text,
    'workflow',
    v_reversal_ref,
    v_reversal_ref,
    '[]'::jsonb,
    coalesce(v_actor_id, v_batch.paid_by, v_batch.created_by)::text,
    now(),
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
    source = excluded.source,
    "sourceRef" = excluded."sourceRef",
    counterparty_name = excluded.counterparty_name,
    counterparty_partner_id = excluded.counterparty_partner_id;

  update public.supplier_payment_batches
  set
    status = 'reversed',
    project_transaction_id = v_tx_id,
    updated_at = now(),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'reversedBy', coalesce(metadata -> 'reversedBy', to_jsonb(v_actor_id)),
      'reversedAt', coalesce(metadata -> 'reversedAt', to_jsonb(now()))
    )
  where id = p_batch_id
  returning * into v_batch;

  update public.supplier_payable_documents d
  set
    status = case
      when balance.outstanding_amount <= 0 then 'paid'
      when balance.paid_amount > 0 then 'partial'
      when d.recognized_amount > 0 then 'open'
      else 'draft'
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
$$;

create or replace function app_private.guard_supplier_payment_batch_direct_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_trusted_executor boolean := current_user in ('postgres', 'supabase_admin', 'service_role');
begin
  if v_trusted_executor then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' and new.status in ('paid', 'reversed') then
    raise exception 'Đợt thanh toán chỉ được chuyển sang paid/reversed qua RPC tài chính.';
  end if;

  if tg_op = 'UPDATE' and (
    old.status in ('paid', 'reversed')
    or new.status in ('paid', 'reversed')
  ) then
    raise exception 'Đợt thanh toán đã paid/reversed là bất biến ngoài RPC tài chính.';
  end if;

  if tg_op = 'DELETE' and old.status in ('paid', 'reversed') then
    raise exception 'Không được xóa trực tiếp đợt thanh toán đã paid/reversed.';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function app_private.guard_supplier_payment_batch_direct_write() from public, anon, authenticated;

drop trigger if exists trg_guard_supplier_payment_batch_direct_write
on public.supplier_payment_batches;
create trigger trg_guard_supplier_payment_batch_direct_write
before insert or update or delete
on public.supplier_payment_batches
for each row
execute function app_private.guard_supplier_payment_batch_direct_write();

create or replace function app_private.guard_paid_supplier_payment_allocation_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch_id uuid := case when tg_op = 'DELETE' then old.payment_batch_id else new.payment_batch_id end;
  v_old_batch_id uuid := case when tg_op = 'UPDATE' then old.payment_batch_id else null end;
  v_trusted_executor boolean := current_user in ('postgres', 'supabase_admin', 'service_role');
begin
  if v_trusted_executor then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if exists (
    select 1
    from public.supplier_payment_batches batch
    where batch.id in (v_batch_id, v_old_batch_id)
      and batch.status in ('paid', 'reversed')
  ) then
    raise exception 'Không được sửa phân bổ của đợt thanh toán đã paid/reversed.';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function app_private.guard_paid_supplier_payment_allocation_write() from public, anon, authenticated;

drop trigger if exists trg_guard_paid_supplier_payment_allocation_write
on public.supplier_payment_allocations;
create trigger trg_guard_paid_supplier_payment_allocation_write
before insert or update or delete
on public.supplier_payment_allocations
for each row
execute function app_private.guard_paid_supplier_payment_allocation_write();

create or replace function app_private.sync_supplier_payable_recognition_transaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_finance_id text := '';
  v_source_ref text;
  v_recognized_amount numeric(18,2);
begin
  if tg_op = 'DELETE' then
    if old.source_type = 'supplier_delivery_statement' then
      update public.project_transactions
      set
        amount = 0,
        description = 'Ngừng ghi nhận công nợ vật tư NCC ' || old.supplier_name_snapshot || ' - ' || old.code
      where source_ref = 'supplier_payable_document:' || old.id::text || ':recognition';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE'
     and old.source_type = 'supplier_delivery_statement'
     and new.source_type is distinct from 'supplier_delivery_statement'
  then
    update public.project_transactions
    set
      amount = 0,
      description = 'Ngừng ghi nhận công nợ vật tư NCC ' || old.supplier_name_snapshot || ' - ' || old.code
    where source_ref = 'supplier_payable_document:' || old.id::text || ':recognition';
  end if;

  if new.source_type is distinct from 'supplier_delivery_statement' then
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

revoke all on function app_private.sync_supplier_payable_recognition_transaction() from public, anon, authenticated;

drop trigger if exists trg_sync_supplier_payable_recognition_transaction
on public.supplier_payable_documents;
create trigger trg_sync_supplier_payable_recognition_transaction
after insert or update or delete
on public.supplier_payable_documents
for each row
execute function app_private.sync_supplier_payable_recognition_transaction();

update public.supplier_payable_documents
set recognized_amount = recognized_amount
where source_type = 'supplier_delivery_statement';

drop policy if exists supplier_payable_documents_access on public.supplier_payable_documents;
drop policy if exists supplier_payable_documents_active_actor_gate on public.supplier_payable_documents;

create policy supplier_payable_documents_active_actor_gate
on public.supplier_payable_documents
as restrictive
for all to authenticated
using ((select public.current_app_user_id()) is not null)
with check ((select public.current_app_user_id()) is not null);

create policy supplier_payable_documents_select
on public.supplier_payable_documents
for select to authenticated
using (app_private.ap_scope_can_view(project_id, construction_site_id));

create policy supplier_payable_documents_insert
on public.supplier_payable_documents
for insert to authenticated
with check (app_private.ap_scope_can_mutate(project_id, construction_site_id));

create policy supplier_payable_documents_update
on public.supplier_payable_documents
for update to authenticated
using (app_private.ap_scope_can_mutate(project_id, construction_site_id))
with check (app_private.ap_scope_can_mutate(project_id, construction_site_id));

create policy supplier_payable_documents_delete
on public.supplier_payable_documents
for delete to authenticated
using (app_private.ap_scope_can_mutate(project_id, construction_site_id));

insert into public.project_transactions (
  id, "projectFinanceId", "constructionSiteId", project_id, project_finance_id, construction_site_id,
  type, category, amount, description, date, source, "sourceRef", source_ref,
  attachments, "createdBy", "createdAt", counterparty_name, counterparty_partner_id
)
select
  'supplier-payment-' || batch.id::text,
  coalesce(finance.id, ''),
  coalesce(batch.construction_site_id, ''),
  batch.project_id,
  finance.id,
  batch.construction_site_id,
  'expense',
  'materials',
  batch.payment_amount,
  'Thanh toán NCC ' || batch.supplier_name_snapshot || ' - ' || batch.code,
  batch.payment_date::text,
  'workflow',
  'supplier_payment_batch:' || batch.id::text,
  'supplier_payment_batch:' || batch.id::text,
  coalesce(batch.attachments, '[]'::jsonb),
  coalesce(batch.paid_by, batch.created_by)::text,
  coalesce(batch.paid_at, batch.updated_at, batch.created_at, now()),
  batch.supplier_name_snapshot,
  batch.supplier_id
from public.supplier_payment_batches batch
left join lateral (
  select project_finance.id
  from public.project_finances project_finance
  where (batch.project_id is not null and project_finance.project_id = batch.project_id)
     or (batch.construction_site_id is not null and project_finance.construction_site_id = batch.construction_site_id)
  order by
    case when batch.project_id is not null and project_finance.project_id = batch.project_id then 0 else 1 end,
    project_finance.id
  limit 1
) finance on true
where batch.status = 'paid'
  and batch.project_transaction_id is null
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
  counterparty_partner_id = excluded.counterparty_partner_id;

update public.supplier_payment_batches batch
set
  project_transaction_id = transaction_row.id,
  updated_at = now()
from public.project_transactions transaction_row
where batch.status = 'paid'
  and batch.project_transaction_id is null
  and transaction_row.source_ref = 'supplier_payment_batch:' || batch.id::text;

revoke all on function public.post_supplier_payment_batch(uuid, uuid) from public, anon;
revoke all on function public.reverse_supplier_payment_batch(uuid, uuid) from public, anon;
grant execute on function public.post_supplier_payment_batch(uuid, uuid) to authenticated;
grant execute on function public.reverse_supplier_payment_batch(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
