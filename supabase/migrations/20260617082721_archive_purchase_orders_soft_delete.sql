-- Soft-archive purchase orders instead of physically deleting returned stock documents.

create schema if not exists app_private;

alter table if exists public.purchase_orders
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.users(id) on delete set null,
  add column if not exists archive_reason text;

create index if not exists idx_purchase_orders_active_scope_created
  on public.purchase_orders(project_id, construction_site_id, created_at desc, id desc)
  where archived_at is null;

create index if not exists idx_purchase_orders_active_stock_created
  on public.purchase_orders(source_mode, created_at desc, id desc)
  where archived_at is null;

create or replace function app_private.project_po_direct_supplier_return_cleanup_ok(
  p_po_id text,
  p_received_transaction_ids jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_receipt_transaction_ids text[] := array[]::text[];
  v_has_received_qty boolean := false;
  v_has_unfinished_receipts boolean := false;
  v_has_active_supplier_returns boolean := false;
  v_has_unfinished_return_transactions boolean := false;
  v_has_insufficient_return_qty boolean := true;
begin
  if to_regclass('public.purchase_order_supplier_returns') is null
    or to_regclass('public.transactions') is null
  then
    return false;
  end if;

  select coalesce(array_agg(distinct tx_id), array[]::text[])
    into v_receipt_transaction_ids
  from (
    select jsonb_array_elements_text(coalesce(p_received_transaction_ids, '[]'::jsonb)) as tx_id
  ) tx
  where nullif(tx_id, '') is not null;

  if coalesce(array_length(v_receipt_transaction_ids, 1), 0) = 0 then
    return false;
  end if;

  select coalesce(bool_or(upper(coalesce(t.status::text, '')) not in ('COMPLETED', 'CANCELLED')), false)
    into v_has_unfinished_receipts
  from public.transactions t
  where t.id::text = any(v_receipt_transaction_ids);

  if v_has_unfinished_receipts then
    return false;
  end if;

  select exists (
    select 1
    from public.transactions t
    cross join lateral jsonb_array_elements(coalesce(t.items, '[]'::jsonb)) elem
    where t.id::text = any(v_receipt_transaction_ids)
      and upper(coalesce(t.status::text, '')) = 'COMPLETED'
      and nullif(elem->>'itemId', '') is not null
      and coalesce(nullif(elem->>'quantity', '')::numeric, 0) > 0
  )
    into v_has_received_qty;

  if not v_has_received_qty then
    return false;
  end if;

  select exists (
    select 1
    from public.purchase_order_supplier_returns r
    where r.purchase_order_id = p_po_id
      and lower(coalesce(r.status, '')) not in ('completed', 'cancelled')
  )
    into v_has_active_supplier_returns;

  if v_has_active_supplier_returns then
    return false;
  end if;

  select exists (
    select 1
    from public.purchase_order_supplier_returns r
    left join public.transactions t on t.id::text = r.transaction_id::text
    where r.purchase_order_id = p_po_id
      and lower(coalesce(r.status, '')) = 'completed'
      and (t.id is null or upper(coalesce(t.status::text, '')) <> 'COMPLETED')
  )
    into v_has_unfinished_return_transactions;

  if v_has_unfinished_return_transactions then
    return false;
  end if;

  select exists (
    with received as (
      select
        elem->>'itemId' as item_id,
        sum(coalesce(nullif(elem->>'quantity', '')::numeric, 0))::numeric as qty
      from public.transactions t
      cross join lateral jsonb_array_elements(coalesce(t.items, '[]'::jsonb)) elem
      where t.id::text = any(v_receipt_transaction_ids)
        and upper(coalesce(t.status::text, '')) = 'COMPLETED'
        and nullif(elem->>'itemId', '') is not null
      group by elem->>'itemId'
    ),
    returned as (
      select
        elem->>'itemId' as item_id,
        sum(coalesce(nullif(elem->>'quantity', '')::numeric, 0))::numeric as qty
      from public.purchase_order_supplier_returns r
      join public.transactions t on t.id::text = r.transaction_id::text
      cross join lateral jsonb_array_elements(coalesce(t.items, '[]'::jsonb)) elem
      where r.purchase_order_id = p_po_id
        and lower(coalesce(r.status, '')) = 'completed'
        and upper(coalesce(t.status::text, '')) = 'COMPLETED'
        and nullif(elem->>'itemId', '') is not null
      group by elem->>'itemId'
    )
    select 1
    from received r
    left join returned ret on ret.item_id = r.item_id
    where coalesce(ret.qty, 0) + 0.000000001 < r.qty
    limit 1
  )
    into v_has_insufficient_return_qty;

  return not v_has_insufficient_return_qty;
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
    or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'delete');

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

create or replace function app_private.enforce_purchase_order_archive_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_payload jsonb;
  v_new_payload jsonb;
begin
  if old.archived_at is not null then
    raise exception 'PO đã lưu trữ không thể chỉnh sửa.';
  end if;

  if new.archived_at is null then
    return new;
  end if;

  if not app_private.project_po_can_archive_v1(
    old.id::text,
    old.project_id::text,
    old.construction_site_id::text,
    old.status::text,
    old.ever_submitted,
    old.received_transaction_ids,
    old.items
  ) then
    raise exception 'Chỉ lưu trữ PO nháp chưa gửi duyệt, hoặc PO đã hoàn trả đủ/không còn giao dịch kho dang dở.';
  end if;

  new.archived_at := coalesce(new.archived_at, now());
  new.archived_by := coalesce(new.archived_by, public.current_app_user_id());
  new.archive_reason := nullif(trim(coalesce(new.archive_reason, '')), '');

  v_old_payload := to_jsonb(old) - 'archived_at' - 'archived_by' - 'archive_reason';
  v_new_payload := to_jsonb(new) - 'archived_at' - 'archived_by' - 'archive_reason';

  if v_old_payload <> v_new_payload then
    raise exception 'Thao tác lưu trữ PO chỉ được cập nhật các trường lưu trữ.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_purchase_order_archive_update on public.purchase_orders;
create trigger trg_enforce_purchase_order_archive_update
before update on public.purchase_orders
for each row execute function app_private.enforce_purchase_order_archive_update();

create or replace function app_private.sync_purchase_order_archive_dependencies()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.archived_at is null
    and new.archived_at is not null
    and to_regclass('public.project_document_links') is not null
  then
    update public.project_document_links
    set status = case when status = 'active' then 'archived' else status end,
        metadata = coalesce(metadata, '{}'::jsonb)
          || jsonb_build_object(
            'purchaseOrderArchivedAt', new.archived_at,
            'purchaseOrderArchiveReason', new.archive_reason
          ),
        updated_at = now()
    where (source_type = 'purchase_order' and source_id = new.id)
       or (target_type = 'purchase_order' and target_id = new.id);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_purchase_order_archive_dependencies on public.purchase_orders;
create trigger trg_sync_purchase_order_archive_dependencies
after update of archived_at on public.purchase_orders
for each row execute function app_private.sync_purchase_order_archive_dependencies();

drop policy if exists purchase_orders_select on public.purchase_orders;
create policy purchase_orders_select
  on public.purchase_orders
  for select
  to authenticated
  using (
    archived_at is null
    and (
      app_private.project_doc_can_view(project_id, construction_site_id, submitted_to_user_id)
      or app_private.current_user_is_global_wms_keeper()
      or app_private.current_user_is_wms_keeper_for(target_warehouse_id)
    )
  );

drop policy if exists purchase_orders_update on public.purchase_orders;
create policy purchase_orders_update
  on public.purchase_orders
  for update
  to authenticated
  using (
    archived_at is null
    and (
      app_private.project_po_can_update(project_id, construction_site_id, status, submitted_to_user_id)
      or (
        status in ('in_transit', 'partial')
        and (
          app_private.current_user_is_global_wms_keeper()
          or app_private.current_user_is_wms_keeper_for(target_warehouse_id)
        )
      )
    )
  )
  with check (
    archived_at is null
    and (
      project_id is not null
      or construction_site_id is not null
      or public.is_admin()
    )
    and (
      app_private.project_po_can_update(project_id, construction_site_id, status, submitted_to_user_id)
      or app_private.current_user_is_global_wms_keeper()
      or app_private.current_user_is_wms_keeper_for(target_warehouse_id)
    )
  );

drop policy if exists purchase_orders_archive_update on public.purchase_orders;
create policy purchase_orders_archive_update
  on public.purchase_orders
  for update
  to authenticated
  using (
    archived_at is null
    and app_private.project_po_can_archive_v1(
      id::text,
      project_id::text,
      construction_site_id::text,
      status::text,
      ever_submitted,
      received_transaction_ids,
      items
    )
  )
  with check (
    archived_at is not null
    and app_private.project_po_can_archive_v1(
      id::text,
      project_id::text,
      construction_site_id::text,
      status::text,
      ever_submitted,
      received_transaction_ids,
      items
    )
  );

drop policy if exists purchase_orders_delete on public.purchase_orders;
create policy purchase_orders_delete
  on public.purchase_orders
  for delete
  to authenticated
  using (false);

revoke all on function app_private.project_po_direct_supplier_return_cleanup_ok(text, jsonb) from public, anon, authenticated;
revoke all on function app_private.project_po_can_archive_v1(text, text, text, text, boolean, jsonb, jsonb) from public, anon, authenticated;
revoke all on function app_private.enforce_purchase_order_archive_update() from public, anon, authenticated;
revoke all on function app_private.sync_purchase_order_archive_dependencies() from public, anon, authenticated;
grant execute on function app_private.project_po_can_archive_v1(text, text, text, text, boolean, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
