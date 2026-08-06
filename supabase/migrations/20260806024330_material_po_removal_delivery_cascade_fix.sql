-- Delete guarded delivery children while the locked parent PO is still visible.
-- This preserves the existing delivery mutation guard and only fixes cascade order.

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

    if to_regclass('public.purchase_order_delivery_batches') is not null then
      delete from public.purchase_order_delivery_batches batch
      where batch.purchase_order_id = v_po.id::text;
    end if;

    if to_regclass('public.purchase_order_delivery_groups') is not null then
      delete from public.purchase_order_delivery_groups delivery_group
      where delivery_group.purchase_order_id = v_po.id::text;
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
