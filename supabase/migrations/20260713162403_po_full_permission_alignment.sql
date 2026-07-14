-- Align Project PO permissions after the Project Org permission refactor.

insert into public.permission_actions (
  module_code,
  action,
  permission_code,
  label,
  scope_modes,
  legacy_module_key,
  legacy_route,
  legacy_admin_only,
  sort_order,
  is_active
)
values (
  'project.material_po',
  'delete',
  'project.material_po.delete',
  'Xóa',
  array['global','project','construction_site']::text[],
  'DA',
  '/da/tabs/material/po',
  true,
  45,
  true
)
on conflict (permission_code) do update
set module_code = excluded.module_code,
    action = excluded.action,
    label = excluded.label,
    scope_modes = excluded.scope_modes,
    legacy_module_key = excluded.legacy_module_key,
    legacy_route = excluded.legacy_route,
    legacy_admin_only = excluded.legacy_admin_only,
    sort_order = excluded.sort_order,
    is_active = true;

update public.permission_actions
set scope_modes = array['global','project','construction_site']::text[],
    legacy_admin_only = true,
    sort_order = 50,
    is_active = true
where permission_code = 'project.material_po.manage';

create or replace function app_private.material_has_action(
  p_project_id text,
  p_construction_site_id text,
  p_permission_code text,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (
      p_permission_code like 'project.material%'
      or p_permission_code like 'project.custom_material.%'
    )
    and (
      public.is_admin()
      or public.is_module_admin('DA')
      or app_private.project_has_permission_v2(
        p_project_id,
        p_construction_site_id,
        p_permission_code,
        p_user_id
      )
      or (
        p_permission_code like 'project.material_po.%'
        and p_permission_code <> 'project.material_po.manage'
        and app_private.project_has_permission_v2(
          p_project_id,
          p_construction_site_id,
          'project.material_po.manage',
          p_user_id
        )
      )
    );
$$;

revoke all on function app_private.material_has_action(text, text, text, uuid) from public;
revoke all on function app_private.material_has_action(text, text, text, uuid) from anon;
grant execute on function app_private.material_has_action(text, text, text, uuid) to authenticated;

create or replace function app_private.material_transition_context_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select current_setting('app.material_transition_context', true) = 'on';
$$;

revoke all on function app_private.material_transition_context_enabled() from public;
revoke all on function app_private.material_transition_context_enabled() from anon;
grant execute on function app_private.material_transition_context_enabled() to authenticated;

create or replace function app_private.guard_purchase_order_direct_status_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app_private.material_transition_context_enabled() or pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.status is distinct from old.status
    or new.submitted_to_user_id is distinct from old.submitted_to_user_id
    or new.submitted_to_name is distinct from old.submitted_to_name
    or new.submitted_to_permission is distinct from old.submitted_to_permission
    or new.submission_note is distinct from old.submission_note
    or new.ever_submitted is distinct from old.ever_submitted
    or new.last_action_by is distinct from old.last_action_by
    or new.last_action_at is distinct from old.last_action_at
    or new.received_transaction_ids is distinct from old.received_transaction_ids
    or new.actual_delivery_date is distinct from old.actual_delivery_date then
    raise exception 'Purchase Order workflow fields must be changed through transition_project_purchase_order_status.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_purchase_order_direct_status_update on public.purchase_orders;
create trigger guard_purchase_order_direct_status_update
  before update on public.purchase_orders
  for each row
  execute function app_private.guard_purchase_order_direct_status_update();

revoke all on function app_private.guard_purchase_order_direct_status_update() from public;
revoke all on function app_private.guard_purchase_order_direct_status_update() from anon;

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
    or nullif(v_po.created_by_id, '') = public.current_app_user_id()::text
    or app_private.material_has_action(
      v_po.project_id::text,
      v_po.construction_site_id::text,
      'project.material_po.delete',
      public.current_app_user_id()
    );

  if not v_has_permission then
    raise exception 'Bạn cần quyền xoá PO, quyền quản trị PO, hoặc là người tạo PO để xoá/lưu trữ phiếu này.'
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

revoke all on function public.remove_purchase_order_v1(text) from public, anon;
grant execute on function public.remove_purchase_order_v1(text) to authenticated;

create or replace function public.create_purchase_order_supplier_return(
  p_purchase_order_id text,
  p_source_warehouse_id text,
  p_lines jsonb,
  p_reason text,
  p_note text default null
)
returns public.purchase_order_supplier_returns
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_po public.purchase_orders%rowtype;
  v_return public.purchase_order_supplier_returns%rowtype;
  v_return_id uuid := gen_random_uuid();
  v_transaction_id text := 'tx-supplier-return-' || replace(gen_random_uuid()::text, '-', '');
  v_return_no text;
  v_line jsonb;
  v_po_item jsonb;
  v_po_line_id text;
  v_item_id text;
  v_qty numeric;
  v_stock_qty numeric;
  v_received_qty numeric;
  v_returned_qty numeric;
  v_on_hand numeric;
  v_reserved numeric;
  v_purchase_unit text;
  v_stock_unit text;
  v_conversion_factor numeric;
  v_purchase_unit_price numeric;
  v_stock_unit_price numeric;
  v_is_converted boolean;
  v_transaction_items jsonb := '[]'::jsonb;
  v_return_line_rows jsonb := '[]'::jsonb;
  v_item_total record;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Bắt buộc nhập lý do trả hàng NCC.';
  end if;
  if coalesce(p_source_warehouse_id, '') = '' then
    raise exception 'Chưa chọn kho xuất trả NCC.';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Phiếu trả NCC chưa có dòng vật tư.';
  end if;

  select * into v_po
  from public.purchase_orders
  where id = p_purchase_order_id
  for update;
  if not found then raise exception 'Không tìm thấy PO cần trả hàng.'; end if;

  if not (
    public.is_admin()
    or public.is_module_admin('WMS')
    or app_private.current_user_is_global_wms_keeper()
    or app_private.material_has_action(
      v_po.project_id::text,
      v_po.construction_site_id::text,
      'project.material_po.manage',
      v_actor
    )
  ) then
    raise exception 'Bạn cần quyền quản trị PO, Admin, quản trị WMS hoặc thủ kho tổng để tạo phiếu trả hàng NCC.'
      using errcode = '42501';
  end if;

  if lower(coalesce(v_po.status::text, '')) not in ('partial', 'delivered', 'closed') then
    raise exception 'Chỉ trả NCC cho PO đã phát sinh nhận hàng và đang ở trạng thái giao một phần, hoàn thành hoặc đã đóng.';
  end if;
  if not exists (select 1 from public.warehouses w where w.id = p_source_warehouse_id) then
    raise exception 'Kho xuất trả NCC không tồn tại.';
  end if;

  v_return_no := 'SR-' || regexp_replace(coalesce(v_po.po_number, 'PO'), '[^A-Za-z0-9]+', '-', 'g')
    || '-' || upper(substr(replace(v_return_id::text, '-', ''), 1, 6));

  for v_line in
    select value from jsonb_array_elements(p_lines)
  loop
    v_po_line_id := coalesce(v_line ->> 'purchaseOrderLineId', v_line ->> 'poLineId', v_line ->> 'lineId');
    v_qty := coalesce(nullif(v_line ->> 'quantity', '')::numeric, 0);
    if coalesce(v_po_line_id, '') = '' or v_qty <= 0 then
      raise exception 'Dòng trả NCC không hợp lệ.';
    end if;

    select item.value into v_po_item
    from jsonb_array_elements(coalesce(v_po.items, '[]'::jsonb)) item(value)
    where coalesce(item.value ->> 'lineId', item.value ->> 'itemId') = v_po_line_id
    limit 1;
    if v_po_item is null then raise exception 'Dòng PO không tồn tại: %', v_po_line_id; end if;

    v_item_id := v_po_item ->> 'itemId';
    v_received_qty := coalesce(nullif(v_po_item ->> 'receivedQty', '')::numeric, 0);
    v_purchase_unit_price := coalesce(nullif(v_po_item ->> 'unitPrice', '')::numeric, 0);

    select coalesce(sum(line.return_qty), 0)
    into v_returned_qty
    from public.purchase_order_supplier_return_lines line
    join public.purchase_order_supplier_returns r on r.id = line.supplier_return_id
    where r.purchase_order_id = p_purchase_order_id
      and line.purchase_order_line_id = v_po_line_id
      and r.status in ('pending', 'completed');

    if v_qty > greatest(0, v_received_qty - v_returned_qty) then
      raise exception 'Số lượng trả của dòng % vượt khối lượng đã nhận còn có thể trả. Đã nhận %, đã/đang trả %, yêu cầu trả %.',
        v_po_line_id, v_received_qty, v_returned_qty, v_qty;
    end if;

    select
      coalesce((coalesce(i.stock_by_warehouse, '{}'::jsonb) ->> p_source_warehouse_id)::numeric, 0),
      coalesce(nullif(v_po_item ->> 'stockUnitSnapshot', ''), nullif(v_po_item ->> 'unitSnapshot', ''), i.unit, nullif(v_po_item ->> 'unit', '')),
      coalesce(nullif(v_po_item ->> 'purchaseUnitSnapshot', ''), nullif(v_po_item ->> 'unit', ''), i.purchase_unit, i.unit),
      coalesce(nullif(v_po_item ->> 'purchaseConversionFactor', '')::numeric, i.purchase_conversion_factor, 1)
    into v_on_hand, v_stock_unit, v_purchase_unit, v_conversion_factor
    from public.items i
    where i.id = v_item_id;
    if not found then raise exception 'Không tìm thấy vật tư: %', v_item_id; end if;

    v_conversion_factor := case when coalesce(v_conversion_factor, 0) > 0 then v_conversion_factor else 1 end;
    v_is_converted := coalesce(trim(v_stock_unit), '') <> ''
      and coalesce(trim(v_purchase_unit), '') <> ''
      and lower(trim(v_stock_unit)) <> lower(trim(v_purchase_unit));
    v_stock_qty := case when v_is_converted then v_qty * v_conversion_factor else v_qty end;
    v_stock_unit_price := case when v_is_converted then v_purchase_unit_price / v_conversion_factor else v_purchase_unit_price end;

    select coalesce(sum(coalesce(nullif(item.value ->> 'quantity', '')::numeric, 0)), 0)
    into v_reserved
    from public.transactions t
    cross join lateral jsonb_array_elements(coalesce(t.items, '[]'::jsonb)) item(value)
    where t.source_warehouse_id = p_source_warehouse_id
      and t.status in ('PENDING'::public.transaction_status, 'APPROVED'::public.transaction_status)
      and t.type in ('EXPORT'::public.transaction_type, 'LIQUIDATION'::public.transaction_type, 'TRANSFER'::public.transaction_type)
      and item.value ->> 'itemId' = v_item_id;

    if v_stock_qty > greatest(0, v_on_hand - v_reserved) then
      raise exception 'Kho xuất trả không đủ tồn khả dụng cho vật tư %. Tồn %, đang giữ %, khả dụng %, cần trả %.',
        coalesce(v_po_item ->> 'name', v_item_id), v_on_hand, v_reserved, greatest(0, v_on_hand - v_reserved), v_stock_qty;
    end if;

    v_transaction_items := v_transaction_items || jsonb_build_array(
      jsonb_build_object(
        'itemId', v_item_id,
        'quantity', v_stock_qty,
        'price', v_stock_unit_price,
        'supplierReturnId', v_return_id::text,
        'purchaseOrderId', p_purchase_order_id,
        'purchaseOrderLineId', v_po_line_id
      )
      || case when v_is_converted then jsonb_build_object(
        'accountingQty', v_qty,
        'accountingUnit', v_purchase_unit,
        'accountingPrice', v_purchase_unit_price
      ) else '{}'::jsonb end
    );

    v_return_line_rows := v_return_line_rows || jsonb_build_array(jsonb_build_object(
      'purchaseOrderLineId', v_po_line_id,
      'itemId', v_item_id,
      'receivedQtySnapshot', v_received_qty,
      'previouslyReturnedQtySnapshot', v_returned_qty,
      'returnQty', v_qty,
      'unit', v_purchase_unit,
      'unitPrice', v_purchase_unit_price,
      'stockReturnQty', v_stock_qty,
      'stockUnit', v_stock_unit
    ));
  end loop;

  for v_item_total in
    select
      item.value ->> 'itemId' as item_id,
      sum(coalesce(nullif(item.value ->> 'quantity', '')::numeric, 0)) as quantity
    from jsonb_array_elements(v_transaction_items) item(value)
    group by item.value ->> 'itemId'
  loop
    select coalesce((coalesce(i.stock_by_warehouse, '{}'::jsonb) ->> p_source_warehouse_id)::numeric, 0)
    into v_on_hand
    from public.items i
    where i.id = v_item_total.item_id
    for update;

    select coalesce(sum(coalesce(nullif(item.value ->> 'quantity', '')::numeric, 0)), 0)
    into v_reserved
    from public.transactions t
    cross join lateral jsonb_array_elements(coalesce(t.items, '[]'::jsonb)) item(value)
    where t.source_warehouse_id = p_source_warehouse_id
      and t.status in ('PENDING'::public.transaction_status, 'APPROVED'::public.transaction_status)
      and t.type in ('EXPORT'::public.transaction_type, 'LIQUIDATION'::public.transaction_type, 'TRANSFER'::public.transaction_type)
      and item.value ->> 'itemId' = v_item_total.item_id;

    if v_item_total.quantity > greatest(0, v_on_hand - v_reserved) then
      raise exception 'Tổng số lượng trả NCC vượt tồn khả dụng của vật tư %. Tồn %, đang giữ %, khả dụng %, cần trả %.',
        v_item_total.item_id, v_on_hand, v_reserved, greatest(0, v_on_hand - v_reserved), v_item_total.quantity;
    end if;
  end loop;

  insert into public.transactions(
    id, type, date, items, source_warehouse_id, requester_id,
    status, note
  ) values (
    v_transaction_id,
    'EXPORT'::public.transaction_type,
    now(),
    v_transaction_items,
    p_source_warehouse_id,
    v_actor,
    'PENDING'::public.transaction_status,
    'Trả hàng NCC ' || v_return_no || ' theo PO ' || coalesce(v_po.po_number, p_purchase_order_id)
      || case when coalesce(v_po.vendor_name, '') <> '' then ' - ' || v_po.vendor_name else '' end
  );

  insert into public.purchase_order_supplier_returns(
    id, return_no, purchase_order_id, project_id, construction_site_id,
    vendor_id, source_warehouse_id, status, transaction_id,
    reason, note, created_by
  ) values (
    v_return_id, v_return_no, v_po.id, v_po.project_id, v_po.construction_site_id,
    v_po.vendor_id, p_source_warehouse_id, 'pending', v_transaction_id,
    trim(p_reason), nullif(trim(coalesce(p_note, '')), ''), v_actor
  )
  returning * into v_return;

  insert into public.purchase_order_supplier_return_lines(
    supplier_return_id, purchase_order_line_id, item_id,
    received_qty_snapshot, previously_returned_qty_snapshot,
    return_qty, unit, unit_price, stock_return_qty, stock_unit
  )
  select
    v_return_id,
    line.value ->> 'purchaseOrderLineId',
    line.value ->> 'itemId',
    coalesce(nullif(line.value ->> 'receivedQtySnapshot', '')::numeric, 0),
    coalesce(nullif(line.value ->> 'previouslyReturnedQtySnapshot', '')::numeric, 0),
    coalesce(nullif(line.value ->> 'returnQty', '')::numeric, 0),
    nullif(line.value ->> 'unit', ''),
    coalesce(nullif(line.value ->> 'unitPrice', '')::numeric, 0),
    coalesce(nullif(line.value ->> 'stockReturnQty', '')::numeric, 0),
    nullif(line.value ->> 'stockUnit', '')
  from jsonb_array_elements(v_return_line_rows) line(value);

  return v_return;
end;
$$;

revoke all on function public.create_purchase_order_supplier_return(text, text, jsonb, text, text) from public;
revoke all on function public.create_purchase_order_supplier_return(text, text, jsonb, text, text) from anon;
grant execute on function public.create_purchase_order_supplier_return(text, text, jsonb, text, text) to authenticated;

notify pgrst, 'reload schema';
