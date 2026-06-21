create schema if not exists app_private;

create or replace function app_private.project_po_delivery_batch_refresh_status_v1(
  p_delivery_batch_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_has_rows boolean := false;
  v_has_open boolean := false;
  v_has_received boolean := false;
  v_all_rejected boolean := false;
  v_next_status text;
begin
  if p_delivery_batch_id is null
     or to_regclass('public.purchase_order_delivery_batches') is null
     or to_regclass('public.material_request_fulfillment_batches') is null
     or to_regclass('public.material_request_fulfillment_lines') is null then
    return;
  end if;

  select
    count(*) > 0,
    coalesce(bool_or(lower(coalesce(batch.status::text, '')) in ('issued', 'variance_pending')), false),
    coalesce(bool_or(lower(coalesce(batch.status::text, '')) = 'received' or coalesce(line_totals.received_qty, 0) > 0), false),
    count(*) > 0
      and coalesce(bool_and(lower(coalesce(batch.status::text, '')) in ('returned', 'cancelled')), false)
      and not coalesce(bool_or(coalesce(line_totals.received_qty, 0) > 0), false)
  into v_has_rows, v_has_open, v_has_received, v_all_rejected
  from public.material_request_fulfillment_batches batch
  left join lateral (
    select coalesce(sum(coalesce(line.received_qty, 0)), 0) as received_qty
    from public.material_request_fulfillment_lines line
    where line.batch_id = batch.id
  ) line_totals on true
  where batch.po_delivery_batch_id = p_delivery_batch_id;

  if not v_has_rows then
    return;
  end if;

  v_next_status := case
    when v_all_rejected then 'cancelled'
    when v_has_open then 'wms_pending'
    when v_has_received then 'received'
    else 'wms_pending'
  end;

  update public.purchase_order_delivery_batches
  set status = v_next_status
  where id = p_delivery_batch_id
    and status is distinct from v_next_status;
end;
$$;

create or replace function app_private.project_po_delivery_group_refresh_status_v1(
  p_delivery_group_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_has_rows boolean := false;
  v_has_open boolean := false;
  v_has_received boolean := false;
  v_all_rejected boolean := false;
  v_next_status text;
begin
  if p_delivery_group_id is null
     or to_regclass('public.purchase_order_delivery_groups') is null
     or to_regclass('public.material_request_fulfillment_batches') is null
     or to_regclass('public.material_request_fulfillment_lines') is null then
    return;
  end if;

  select
    count(*) > 0,
    coalesce(bool_or(lower(coalesce(batch.status::text, '')) in ('issued', 'variance_pending')), false),
    coalesce(bool_or(lower(coalesce(batch.status::text, '')) = 'received' or coalesce(line_totals.received_qty, 0) > 0), false),
    count(*) > 0
      and coalesce(bool_and(lower(coalesce(batch.status::text, '')) in ('returned', 'cancelled')), false)
      and not coalesce(bool_or(coalesce(line_totals.received_qty, 0) > 0), false)
  into v_has_rows, v_has_open, v_has_received, v_all_rejected
  from public.material_request_fulfillment_batches batch
  left join lateral (
    select coalesce(sum(coalesce(line.received_qty, 0)), 0) as received_qty
    from public.material_request_fulfillment_lines line
    where line.batch_id = batch.id
  ) line_totals on true
  where batch.po_delivery_group_id = p_delivery_group_id;

  if not v_has_rows then
    return;
  end if;

  v_next_status := case
    when v_all_rejected then 'cancelled'
    when v_has_open then 'issued'
    when v_has_received then 'received'
    else 'issued'
  end;

  update public.purchase_order_delivery_groups
  set status = v_next_status
  where id = p_delivery_group_id
    and status is distinct from v_next_status;
end;
$$;

create or replace function app_private.project_po_sync_cancelled_receipt_transaction_v1(
  p_transaction_id text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx public.transactions%rowtype;
  v_reason text := coalesce(nullif(trim(p_reason), ''), 'Phiếu kho nhập PO đã bị từ chối trước khi nhập kho.');
  v_batch_ids uuid[] := array[]::uuid[];
  v_delivery_batch_ids uuid[] := array[]::uuid[];
  v_delivery_group_ids uuid[] := array[]::uuid[];
  v_id uuid;
begin
  if p_transaction_id is null
     or to_regclass('public.material_request_fulfillment_batches') is null
     or to_regclass('public.material_request_fulfillment_lines') is null then
    return jsonb_build_object('synced', false, 'reason', 'missing_input_or_tables');
  end if;

  select *
    into v_tx
  from public.transactions
  where id = p_transaction_id
  for update;

  if not found then
    return jsonb_build_object('synced', false, 'reason', 'transaction_not_found');
  end if;

  if v_tx.status <> 'CANCELLED'::public.transaction_status then
    return jsonb_build_object('synced', false, 'reason', 'transaction_not_cancelled');
  end if;

  if to_regclass('public.inventory_ledger_entries') is not null
     and exists (
       select 1
       from public.inventory_ledger_entries entry
       where entry.source_type = 'wms_transaction'
         and entry.source_id = v_tx.id::text
     ) then
    return jsonb_build_object('synced', false, 'reason', 'stock_ledger_exists');
  end if;

  select coalesce(array_agg(distinct batch.id), array[]::uuid[])
    into v_batch_ids
  from public.material_request_fulfillment_batches batch
  where batch.transaction_id::text = v_tx.id::text
    and lower(coalesce(batch.source_type::text, '')) = 'po_receipt'
    and lower(coalesce(batch.status::text, '')) in ('issued', 'variance_pending')
    and not exists (
      select 1
      from public.material_request_fulfillment_lines line
      where line.batch_id = batch.id
        and coalesce(line.received_qty, 0) > 0
    );

  if coalesce(array_length(v_batch_ids, 1), 0) = 0 then
    return jsonb_build_object('synced', false, 'reason', 'no_receipt_batches_to_return');
  end if;

  update public.material_request_fulfillment_batches batch
  set status = 'returned',
      cancel_reason = coalesce(nullif(batch.cancel_reason, ''), v_reason),
      reason = coalesce(nullif(batch.reason, ''), v_reason)
  where batch.id = any(v_batch_ids);

  select coalesce(array_agg(distinct batch.po_delivery_batch_id) filter (where batch.po_delivery_batch_id is not null), array[]::uuid[]),
         coalesce(array_agg(distinct batch.po_delivery_group_id) filter (where batch.po_delivery_group_id is not null), array[]::uuid[])
    into v_delivery_batch_ids, v_delivery_group_ids
  from public.material_request_fulfillment_batches batch
  where batch.id = any(v_batch_ids);

  foreach v_id in array v_delivery_batch_ids loop
    perform app_private.project_po_delivery_batch_refresh_status_v1(v_id);
  end loop;

  foreach v_id in array v_delivery_group_ids loop
    perform app_private.project_po_delivery_group_refresh_status_v1(v_id);
  end loop;

  return jsonb_build_object(
    'synced', true,
    'transactionId', v_tx.id,
    'returnedBatchCount', coalesce(array_length(v_batch_ids, 1), 0)
  );
end;
$$;

create or replace function app_private.project_po_sync_cancelled_receipt_transaction_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.status = 'CANCELLED'::public.transaction_status
     and old.status is distinct from new.status then
    perform app_private.project_po_sync_cancelled_receipt_transaction_v1(
      new.id::text,
      'Phiếu kho nhập PO đã bị từ chối trước khi nhập kho.'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_project_po_sync_cancelled_receipt_transaction
  on public.transactions;
create trigger trg_project_po_sync_cancelled_receipt_transaction
after update of status on public.transactions
for each row
execute function app_private.project_po_sync_cancelled_receipt_transaction_trigger_v1();

create or replace function app_private.project_po_has_failed_delivery_work_v1(p_po_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_has_failed boolean := false;
begin
  if to_regclass('public.material_request_fulfillment_batches') is not null
     and to_regclass('public.material_request_fulfillment_lines') is not null then
    select exists (
      select 1
      from public.material_request_fulfillment_lines line
      join public.material_request_fulfillment_batches batch on batch.id = line.batch_id
      left join public.transactions tx on tx.id::text = batch.transaction_id::text
      where line.po_id = p_po_id
        and coalesce(line.received_qty, 0) <= 0
        and (
          lower(coalesce(batch.status::text, '')) in ('returned', 'cancelled')
          or (
            lower(coalesce(batch.status::text, '')) in ('issued', 'variance_pending')
            and tx.status = 'CANCELLED'::public.transaction_status
          )
        )
    )
      into v_has_failed;

    if v_has_failed then
      return true;
    end if;
  end if;

  if to_regclass('public.purchase_order_delivery_batches') is not null then
    select exists (
      select 1
      from public.purchase_order_delivery_batches batch
      where batch.purchase_order_id = p_po_id
        and lower(coalesce(batch.status::text, '')) = 'cancelled'
    )
      into v_has_failed;

    if v_has_failed then
      return true;
    end if;
  end if;

  if to_regclass('public.purchase_order_delivery_groups') is not null then
    select exists (
      select 1
      from public.purchase_order_delivery_groups delivery_group
      where delivery_group.purchase_order_id = p_po_id
        and lower(coalesce(delivery_group.status::text, '')) = 'cancelled'
    )
      into v_has_failed;
  end if;

  return coalesce(v_has_failed, false);
end;
$$;

create or replace function app_private.project_po_has_pending_work_v1(p_po_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_has_pending boolean := false;
begin
  if to_regclass('public.material_request_fulfillment_batches') is not null
     and to_regclass('public.material_request_fulfillment_lines') is not null then
    select exists (
      select 1
      from public.material_request_fulfillment_lines line
      join public.material_request_fulfillment_batches batch on batch.id = line.batch_id
      left join public.transactions tx on tx.id::text = batch.transaction_id::text
      where line.po_id = p_po_id
        and lower(coalesce(batch.status::text, '')) in ('issued', 'variance_pending')
        and coalesce(tx.status, 'PENDING'::public.transaction_status) <> 'CANCELLED'::public.transaction_status
    )
      into v_has_pending;

    if v_has_pending then
      return true;
    end if;
  end if;

  if to_regclass('public.purchase_order_delivery_batches') is not null then
    select exists (
      select 1
      from public.purchase_order_delivery_batches batch
      where batch.purchase_order_id = p_po_id
        and lower(coalesce(batch.status::text, '')) = 'wms_pending'
    )
      into v_has_pending;

    if v_has_pending then
      return true;
    end if;
  end if;

  if app_private.project_po_has_failed_delivery_work_v1(p_po_id) then
    return true;
  end if;

  if to_regclass('public.purchase_order_supplier_returns') is not null then
    select exists (
      select 1
      from public.purchase_order_supplier_returns r
      where r.purchase_order_id = p_po_id
        and lower(coalesce(r.status::text, '')) not in ('completed', 'cancelled')
    )
      into v_has_pending;
  end if;

  return coalesce(v_has_pending, false);
end;
$$;

create or replace function public.remove_purchase_order_delivery_batch_v1(p_delivery_batch_id uuid)
returns table(action text, id text, purchase_order_id text, po_number text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery public.purchase_order_delivery_batches%rowtype;
  v_po public.purchase_orders%rowtype;
  v_has_permission boolean := false;
  v_batch_ids uuid[] := array[]::uuid[];
  v_transaction_ids text[] := array[]::text[];
begin
  select *
    into v_delivery
  from public.purchase_order_delivery_batches
  where public.purchase_order_delivery_batches.id = p_delivery_batch_id
  for update;

  if not found then
    raise exception 'Không tìm thấy đợt giao cần xoá.';
  end if;

  select *
    into v_po
  from public.purchase_orders
  where public.purchase_orders.id = v_delivery.purchase_order_id
  for update;

  if not found then
    raise exception 'Không tìm thấy PO của đợt giao.';
  end if;

  v_has_permission := public.is_admin()
    or nullif(v_po.created_by_id, '') = public.current_app_user_id()::text;

  if not v_has_permission then
    raise exception 'Chỉ Admin hoặc người tạo PO được xoá đợt giao này.'
      using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct batch.id), array[]::uuid[]),
         coalesce(array_agg(distinct batch.transaction_id::text) filter (where batch.transaction_id is not null), array[]::text[])
    into v_batch_ids, v_transaction_ids
  from public.material_request_fulfillment_batches batch
  where batch.po_delivery_batch_id = p_delivery_batch_id;

  if coalesce(array_length(v_batch_ids, 1), 0) > 0 then
    if exists (
      select 1
      from public.material_request_fulfillment_batches batch
      where batch.id = any(v_batch_ids)
        and lower(coalesce(batch.status::text, '')) not in ('returned', 'cancelled')
    ) then
      raise exception 'Chỉ xoá được đợt giao đã bị từ chối/huỷ và không còn chờ xử lý.';
    end if;

    if exists (
      select 1
      from public.material_request_fulfillment_lines line
      where line.batch_id = any(v_batch_ids)
        and coalesce(line.received_qty, 0) > 0
    ) then
      raise exception 'Đợt giao đã phát sinh thực nhận, không thể xoá.';
    end if;
  end if;

  if coalesce(array_length(v_transaction_ids, 1), 0) > 0 then
    if exists (
      select 1
      from public.transactions tx
      where tx.id::text = any(v_transaction_ids)
        and tx.status = 'COMPLETED'::public.transaction_status
    ) then
      raise exception 'Đợt giao đã có phiếu kho hoàn tất, không thể xoá.';
    end if;

    if to_regclass('public.inventory_ledger_entries') is not null
       and exists (
         select 1
         from public.inventory_ledger_entries entry
         where entry.source_type = 'wms_transaction'
           and entry.source_id = any(v_transaction_ids)
       ) then
      raise exception 'Đợt giao đã phát sinh ledger kho, không thể xoá.';
    end if;
  end if;

  if to_regclass('public.project_document_links') is not null then
    delete from public.project_document_links link
    where (link.source_type = 'transaction' and link.source_id = any(v_transaction_ids))
       or (link.target_type = 'transaction' and link.target_id = any(v_transaction_ids));
  end if;

  if coalesce(array_length(v_batch_ids, 1), 0) > 0 then
    delete from public.material_request_fulfillment_batches batch
    where batch.id = any(v_batch_ids);
  end if;

  if coalesce(array_length(v_transaction_ids, 1), 0) > 0 then
    delete from public.transactions tx
    where tx.id::text = any(v_transaction_ids)
      and tx.status <> 'COMPLETED'::public.transaction_status
      and (
        to_regclass('public.inventory_ledger_entries') is null
        or not exists (
          select 1
          from public.inventory_ledger_entries entry
          where entry.source_type = 'wms_transaction'
            and entry.source_id = tx.id::text
        )
      )
      and not exists (
        select 1
        from public.material_request_fulfillment_batches batch
        where batch.transaction_id::text = tx.id::text
      )
      and (
        to_regclass('public.purchase_order_supplier_returns') is null
        or not exists (
          select 1
          from public.purchase_order_supplier_returns r
          where r.transaction_id::text = tx.id::text
        )
      );
  end if;

  delete from public.purchase_order_delivery_batches
  where public.purchase_order_delivery_batches.id = p_delivery_batch_id;

  action := 'deleted';
  id := p_delivery_batch_id::text;
  purchase_order_id := v_po.id::text;
  po_number := v_po.po_number::text;
  return next;
end;
$$;

create or replace function public.remove_purchase_order_delivery_group_v1(p_delivery_group_id uuid)
returns table(action text, id text, purchase_order_id text, po_number text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery public.purchase_order_delivery_groups%rowtype;
  v_po public.purchase_orders%rowtype;
  v_has_permission boolean := false;
  v_batch_ids uuid[] := array[]::uuid[];
  v_transaction_ids text[] := array[]::text[];
begin
  select *
    into v_delivery
  from public.purchase_order_delivery_groups
  where public.purchase_order_delivery_groups.id = p_delivery_group_id
  for update;

  if not found then
    raise exception 'Không tìm thấy đợt giao cần xoá.';
  end if;

  select *
    into v_po
  from public.purchase_orders
  where public.purchase_orders.id = v_delivery.purchase_order_id
  for update;

  if not found then
    raise exception 'Không tìm thấy PO của đợt giao.';
  end if;

  v_has_permission := public.is_admin()
    or nullif(v_po.created_by_id, '') = public.current_app_user_id()::text;

  if not v_has_permission then
    raise exception 'Chỉ Admin hoặc người tạo PO được xoá đợt giao này.'
      using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct batch.id), array[]::uuid[]),
         coalesce(array_agg(distinct batch.transaction_id::text) filter (where batch.transaction_id is not null), array[]::text[])
    into v_batch_ids, v_transaction_ids
  from public.material_request_fulfillment_batches batch
  where batch.po_delivery_group_id = p_delivery_group_id;

  if coalesce(array_length(v_batch_ids, 1), 0) > 0 then
    if exists (
      select 1
      from public.material_request_fulfillment_batches batch
      where batch.id = any(v_batch_ids)
        and lower(coalesce(batch.status::text, '')) not in ('returned', 'cancelled')
    ) then
      raise exception 'Chỉ xoá được đợt giao đã bị từ chối/huỷ và không còn chờ xử lý.';
    end if;

    if exists (
      select 1
      from public.material_request_fulfillment_lines line
      where line.batch_id = any(v_batch_ids)
        and coalesce(line.received_qty, 0) > 0
    ) then
      raise exception 'Đợt giao đã phát sinh thực nhận, không thể xoá.';
    end if;
  end if;

  if coalesce(array_length(v_transaction_ids, 1), 0) > 0 then
    if exists (
      select 1
      from public.transactions tx
      where tx.id::text = any(v_transaction_ids)
        and tx.status = 'COMPLETED'::public.transaction_status
    ) then
      raise exception 'Đợt giao đã có phiếu kho hoàn tất, không thể xoá.';
    end if;

    if to_regclass('public.inventory_ledger_entries') is not null
       and exists (
         select 1
         from public.inventory_ledger_entries entry
         where entry.source_type = 'wms_transaction'
           and entry.source_id = any(v_transaction_ids)
       ) then
      raise exception 'Đợt giao đã phát sinh ledger kho, không thể xoá.';
    end if;
  end if;

  if to_regclass('public.project_document_links') is not null then
    delete from public.project_document_links link
    where (link.source_type = 'transaction' and link.source_id = any(v_transaction_ids))
       or (link.target_type = 'transaction' and link.target_id = any(v_transaction_ids));
  end if;

  if coalesce(array_length(v_batch_ids, 1), 0) > 0 then
    delete from public.material_request_fulfillment_batches batch
    where batch.id = any(v_batch_ids);
  end if;

  if coalesce(array_length(v_transaction_ids, 1), 0) > 0 then
    delete from public.transactions tx
    where tx.id::text = any(v_transaction_ids)
      and tx.status <> 'COMPLETED'::public.transaction_status
      and (
        to_regclass('public.inventory_ledger_entries') is null
        or not exists (
          select 1
          from public.inventory_ledger_entries entry
          where entry.source_type = 'wms_transaction'
            and entry.source_id = tx.id::text
        )
      )
      and not exists (
        select 1
        from public.material_request_fulfillment_batches batch
        where batch.transaction_id::text = tx.id::text
      )
      and (
        to_regclass('public.purchase_order_supplier_returns') is null
        or not exists (
          select 1
          from public.purchase_order_supplier_returns r
          where r.transaction_id::text = tx.id::text
        )
      );
  end if;

  delete from public.purchase_order_delivery_groups
  where public.purchase_order_delivery_groups.id = p_delivery_group_id;

  action := 'deleted';
  id := p_delivery_group_id::text;
  purchase_order_id := v_po.id::text;
  po_number := v_po.po_number::text;
  return next;
end;
$$;

do $$
declare
  v_transaction_id text;
begin
  for v_transaction_id in
    select distinct tx.id::text
    from public.transactions tx
    join public.material_request_fulfillment_batches batch on batch.transaction_id::text = tx.id::text
    where tx.status = 'CANCELLED'::public.transaction_status
      and lower(coalesce(batch.source_type::text, '')) = 'po_receipt'
      and lower(coalesce(batch.status::text, '')) in ('issued', 'variance_pending')
  loop
    perform app_private.project_po_sync_cancelled_receipt_transaction_v1(
      v_transaction_id,
      'Phiếu kho nhập PO đã bị từ chối trước khi nhập kho.'
    );
  end loop;
end;
$$;

revoke all on function app_private.project_po_delivery_batch_refresh_status_v1(uuid) from public, anon, authenticated;
revoke all on function app_private.project_po_delivery_group_refresh_status_v1(uuid) from public, anon, authenticated;
revoke all on function app_private.project_po_sync_cancelled_receipt_transaction_v1(text, text) from public, anon, authenticated;
revoke all on function app_private.project_po_sync_cancelled_receipt_transaction_trigger_v1() from public, anon, authenticated;
revoke all on function app_private.project_po_has_failed_delivery_work_v1(text) from public, anon, authenticated;
revoke all on function app_private.project_po_has_pending_work_v1(text) from public, anon, authenticated;
revoke all on function public.remove_purchase_order_delivery_batch_v1(uuid) from public, anon;
revoke all on function public.remove_purchase_order_delivery_group_v1(uuid) from public, anon;
grant execute on function public.remove_purchase_order_delivery_batch_v1(uuid) to authenticated;
grant execute on function public.remove_purchase_order_delivery_group_v1(uuid) to authenticated;

notify pgrst, 'reload schema';
