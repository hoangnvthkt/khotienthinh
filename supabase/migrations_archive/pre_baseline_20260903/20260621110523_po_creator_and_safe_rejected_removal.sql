create schema if not exists app_private;

alter table if exists public.purchase_orders
  add column if not exists created_by_id text;

alter table if exists public.purchase_order_delivery_lines
  add column if not exists delivery_unit_price numeric not null default 0;

update public.purchase_orders
set created_by_id = nullif(last_action_by, '')
where nullif(created_by_id, '') is null
  and archived_at is null
  and nullif(last_action_by, '') is not null;

create index if not exists idx_purchase_orders_created_by_id
  on public.purchase_orders(created_by_id, created_at desc)
  where created_by_id is not null;

create or replace function app_private.project_doc_touch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_marks_submitted boolean := false;
begin
  if tg_table_name = 'purchase_orders' then
    v_marks_submitted := app_private.project_po_status_marks_submitted(new.status::text);

    if tg_op = 'UPDATE'
       and old.archived_at is null
       and new.archived_at is not null
       and old.status is not distinct from new.status
       and old.submitted_to_user_id is not distinct from new.submitted_to_user_id
    then
      return new;
    end if;
  else
    v_marks_submitted := coalesce(new.status::text, 'draft') <> 'draft';
  end if;

  if tg_op = 'INSERT' then
    if tg_table_name = 'purchase_orders' then
      new.created_by_id := coalesce(nullif(new.created_by_id, ''), public.current_app_user_id()::text, nullif(new.last_action_by, ''));
    end if;
    new.ever_submitted := coalesce(new.ever_submitted, false) or v_marks_submitted;
    new.last_action_by := coalesce(new.last_action_by, public.current_app_user_id()::text);
    new.last_action_at := coalesce(new.last_action_at, now());
    return new;
  end if;

  if old.status is distinct from new.status
     or old.submitted_to_user_id is distinct from new.submitted_to_user_id then
    new.last_action_by := coalesce(new.last_action_by, public.current_app_user_id()::text);
    new.last_action_at := coalesce(new.last_action_at, now());
  end if;

  new.ever_submitted := coalesce(old.ever_submitted, false)
    or coalesce(new.ever_submitted, false)
    or v_marks_submitted;

  return new;
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
      where line.po_id = p_po_id
        and lower(coalesce(batch.status::text, '')) in ('issued', 'variance_pending')
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

create or replace function app_private.project_po_can_archive_v1(
  p_po_id text,
  p_project_id text,
  p_construction_site_id text,
  p_status text,
  p_ever_submitted boolean,
  p_received_transaction_ids jsonb,
  p_items jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status text := lower(coalesce(p_status, 'draft'));
  v_has_permission boolean := false;
  v_received_item_qty numeric := 0;
  v_has_received_batch_qty boolean := false;
  v_no_receipt boolean := false;
  v_stock_cleanup_ok boolean := false;
  v_direct_supplier_return_cleanup_ok boolean := false;
begin
  v_has_permission := public.is_admin()
    or exists (
      select 1
      from public.purchase_orders po
      where po.id = p_po_id
        and nullif(po.created_by_id, '') = public.current_app_user_id()::text
    );

  if not v_has_permission then
    return false;
  end if;

  select coalesce(sum(coalesce(nullif(elem->>'receivedQty', '')::numeric, 0)), 0)
    into v_received_item_qty
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as elem;

  if to_regclass('public.material_request_fulfillment_lines') is not null then
    select coalesce(bool_or(coalesce(received_qty, 0) > 0), false)
      into v_has_received_batch_qty
    from public.material_request_fulfillment_lines
    where po_id = p_po_id;
  end if;

  v_no_receipt := v_received_item_qty <= 0
    and jsonb_array_length(coalesce(p_received_transaction_ids, '[]'::jsonb)) = 0
    and not v_has_received_batch_qty;

  if v_status in ('returned', 'cancelled', 'partial', 'delivered', 'closed') then
    v_stock_cleanup_ok := app_private.project_po_stock_cleanup_ok(p_po_id, p_received_transaction_ids);
    v_direct_supplier_return_cleanup_ok := app_private.project_po_direct_supplier_return_cleanup_ok(p_po_id, p_received_transaction_ids);
  end if;

  return
    (v_status = 'draft' and not coalesce(p_ever_submitted, false) and v_no_receipt)
    or (
      v_status in ('returned', 'cancelled')
      and (v_no_receipt or v_stock_cleanup_ok or v_direct_supplier_return_cleanup_ok)
    )
    or (
      v_status in ('partial', 'delivered', 'closed')
      and (v_stock_cleanup_ok or v_direct_supplier_return_cleanup_ok)
    );
end;
$$;

create or replace function public.remove_purchase_order_v1(p_po_id text)
returns table(action text, id text, po_number text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders%rowtype;
  v_has_permission boolean := false;
  v_has_stock_impact boolean := false;
  v_received_transaction_ids text[] := array[]::text[];
  v_fulfillment_transaction_ids text[] := array[]::text[];
  v_supplier_return_transaction_ids text[] := array[]::text[];
  v_supplier_return_ids uuid[] := array[]::uuid[];
  v_supplier_return_text_ids text[] := array[]::text[];
  v_cleanup_transaction_ids text[] := array[]::text[];
begin
  select *
    into v_po
  from public.purchase_orders
  where public.purchase_orders.id = p_po_id
  for update;

  if not found then
    raise exception 'Không tìm thấy PO cần xoá/lưu trữ.';
  end if;

  if v_po.archived_at is not null then
    raise exception 'PO đã được lưu trữ.';
  end if;

  v_has_permission := public.is_admin()
    or nullif(v_po.created_by_id, '') = public.current_app_user_id()::text;

  if not v_has_permission then
    raise exception 'Chỉ Admin hoặc người tạo PO được xoá/lưu trữ PO này.'
      using errcode = '42501';
  end if;

  if app_private.project_po_has_pending_work_v1(v_po.id::text) then
    raise exception 'PO đang có đợt giao/giao dịch chờ xử lý. Vui lòng huỷ hoặc xử lý xong trước khi xoá.';
  end if;

  v_has_stock_impact := app_private.project_po_has_stock_impact_v1(
    v_po.id::text,
    v_po.received_transaction_ids,
    v_po.items
  );

  if not v_has_stock_impact then
    select coalesce(array_agg(distinct tx_id), array[]::text[])
      into v_received_transaction_ids
    from (
      select jsonb_array_elements_text(
        case
          when jsonb_typeof(coalesce(v_po.received_transaction_ids, '[]'::jsonb)) = 'array'
            then coalesce(v_po.received_transaction_ids, '[]'::jsonb)
          else '[]'::jsonb
        end
      ) as tx_id
    ) tx
    where nullif(tx_id, '') is not null;

    if to_regclass('public.material_request_fulfillment_batches') is not null
       and to_regclass('public.material_request_fulfillment_lines') is not null then
      select coalesce(array_agg(distinct batch.transaction_id::text), array[]::text[])
        into v_fulfillment_transaction_ids
      from public.material_request_fulfillment_lines line
      join public.material_request_fulfillment_batches batch
        on batch.id = line.batch_id
      where line.po_id = v_po.id::text
        and batch.transaction_id is not null;
    end if;

    if to_regclass('public.purchase_order_supplier_returns') is not null then
      select coalesce(array_agg(distinct r.id), array[]::uuid[]),
             coalesce(array_agg(distinct r.transaction_id::text) filter (where r.transaction_id is not null), array[]::text[])
        into v_supplier_return_ids, v_supplier_return_transaction_ids
      from public.purchase_order_supplier_returns r
      where r.purchase_order_id = v_po.id::text;

      select coalesce(array_agg(ids.return_id::text), array[]::text[])
        into v_supplier_return_text_ids
      from unnest(v_supplier_return_ids) as ids(return_id);
    end if;

    select coalesce(array_agg(distinct tx_id), array[]::text[])
      into v_cleanup_transaction_ids
    from (
      select unnest(v_received_transaction_ids) as tx_id
      union
      select unnest(v_fulfillment_transaction_ids) as tx_id
      union
      select unnest(v_supplier_return_transaction_ids) as tx_id
    ) tx
    where nullif(tx_id, '') is not null;

    if to_regclass('public.project_document_links') is not null then
      delete from public.project_document_links link
      where (link.source_type = 'purchase_order' and link.source_id = v_po.id::text)
         or (link.target_type = 'purchase_order' and link.target_id = v_po.id::text)
         or (link.source_type = 'transaction' and link.source_id = any(v_cleanup_transaction_ids))
         or (link.target_type = 'transaction' and link.target_id = any(v_cleanup_transaction_ids))
         or (link.source_type = 'supplier_return' and link.source_id = any(v_supplier_return_text_ids))
         or (link.target_type = 'supplier_return' and link.target_id = any(v_supplier_return_text_ids));
    end if;

    if to_regclass('public.purchase_order_supplier_return_lines') is not null
       and coalesce(array_length(v_supplier_return_ids, 1), 0) > 0 then
      delete from public.purchase_order_supplier_return_lines line
      where line.supplier_return_id = any(v_supplier_return_ids);
    end if;

    if to_regclass('public.purchase_order_supplier_returns') is not null then
      delete from public.purchase_order_supplier_returns r
      where r.purchase_order_id = v_po.id::text;
    end if;

    if to_regclass('public.material_request_fulfillment_batches') is not null
       and to_regclass('public.material_request_fulfillment_lines') is not null then
      delete from public.material_request_fulfillment_batches batch
      where exists (
        select 1
        from public.material_request_fulfillment_lines line
        where line.batch_id = batch.id
          and line.po_id = v_po.id::text
      );
    end if;

    if coalesce(array_length(v_cleanup_transaction_ids, 1), 0) > 0 then
      delete from public.transactions t
      where t.id::text = any(v_cleanup_transaction_ids)
        and upper(coalesce(t.status::text, '')) <> 'COMPLETED'
        and not exists (
          select 1
          from public.inventory_ledger_entries entry
          where entry.source_type = 'wms_transaction'
            and entry.source_id = t.id::text
        )
        and (
          to_regclass('public.material_request_fulfillment_batches') is null
          or not exists (
            select 1
            from public.material_request_fulfillment_batches batch
            where batch.transaction_id::text = t.id::text
          )
        )
        and (
          to_regclass('public.purchase_order_supplier_returns') is null
          or not exists (
            select 1
            from public.purchase_order_supplier_returns r
            where r.transaction_id::text = t.id::text
          )
        );
    end if;

    delete from public.purchase_orders
    where public.purchase_orders.id = v_po.id;

    if to_regclass('public.project_document_links') is not null then
      delete from public.project_document_links link
      where (link.source_type = 'purchase_order' and link.source_id = v_po.id::text)
         or (link.target_type = 'purchase_order' and link.target_id = v_po.id::text);
    end if;

    action := 'deleted';
    id := v_po.id::text;
    po_number := v_po.po_number::text;
    return next;
    return;
  end if;

  if not app_private.project_po_can_archive_v1(
    v_po.id::text,
    v_po.project_id::text,
    v_po.construction_site_id::text,
    v_po.status::text,
    v_po.ever_submitted,
    v_po.received_transaction_ids,
    v_po.items
  ) then
    raise exception 'PO đã phát sinh kho và chưa đủ điều kiện lưu trữ. Vui lòng hoàn trả/đối soát đủ trước.';
  end if;

  update public.purchase_orders
  set archived_at = now(),
      archived_by = public.current_app_user_id(),
      archive_reason = 'Người dùng lưu trữ PO từ tab Cung ứng'
  where public.purchase_orders.id = v_po.id;

  action := 'archived';
  id := v_po.id::text;
  po_number := v_po.po_number::text;
  return next;
end;
$$;

revoke all on function app_private.project_doc_touch() from public, anon, authenticated;
revoke all on function app_private.project_po_has_pending_work_v1(text) from public, anon, authenticated;
revoke all on function app_private.project_po_can_archive_v1(text, text, text, text, boolean, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.remove_purchase_order_v1(text) from public, anon;
grant execute on function public.remove_purchase_order_v1(text) to authenticated;

notify pgrst, 'reload schema';
