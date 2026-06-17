-- Purchase order removal workflow v2.
-- PO rows without any stock movement can be physically deleted. PO rows that
-- already touched stock stay as auditable records and can only be archived.

create schema if not exists app_private;

create or replace function app_private.project_po_status_marks_submitted(p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(coalesce(p_status, 'draft')) in (
    'sent',
    'confirmed',
    'in_transit',
    'partial',
    'delivered',
    'closed',
    'returned'
  );
$$;

create or replace function app_private.project_doc_touch()
returns trigger
language plpgsql
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

create or replace function app_private.project_po_has_stock_impact_v1(
  p_po_id text,
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
  v_received_transaction_ids text[] := array[]::text[];
  v_has_stock_impact boolean := false;
begin
  select coalesce(array_agg(distinct tx_id), array[]::text[])
    into v_received_transaction_ids
  from (
    select jsonb_array_elements_text(
      case
        when jsonb_typeof(coalesce(p_received_transaction_ids, '[]'::jsonb)) = 'array'
          then coalesce(p_received_transaction_ids, '[]'::jsonb)
        else '[]'::jsonb
      end
    ) as tx_id
  ) tx
  where nullif(tx_id, '') is not null;

  select exists (
    select 1
    from jsonb_array_elements(
      case
        when jsonb_typeof(coalesce(p_items, '[]'::jsonb)) = 'array'
          then coalesce(p_items, '[]'::jsonb)
        else '[]'::jsonb
      end
    ) item(value)
    where coalesce(nullif(item.value->>'receivedQty', '')::numeric, 0) > 0
  )
    into v_has_stock_impact;

  if v_has_stock_impact then
    return true;
  end if;

  if to_regclass('public.material_request_fulfillment_lines') is not null then
    select exists (
      select 1
      from public.material_request_fulfillment_lines line
      where line.po_id = p_po_id
        and coalesce(line.received_qty, 0) > 0
    )
      into v_has_stock_impact;

    if v_has_stock_impact then
      return true;
    end if;
  end if;

  if coalesce(array_length(v_received_transaction_ids, 1), 0) > 0 then
    select exists (
      select 1
      from public.transactions t
      where t.id::text = any(v_received_transaction_ids)
        and upper(coalesce(t.status::text, '')) = 'COMPLETED'
        and exists (
          select 1
          from jsonb_array_elements(coalesce(t.items, '[]'::jsonb)) tx_item(value)
          where coalesce(nullif(tx_item.value->>'quantity', '')::numeric, 0) <> 0
        )
    )
      into v_has_stock_impact;

    if v_has_stock_impact then
      return true;
    end if;

    if to_regclass('public.inventory_ledger_entries') is not null then
      select exists (
        select 1
        from public.inventory_ledger_entries entry
        where entry.source_type = 'wms_transaction'
          and entry.source_id = any(v_received_transaction_ids)
      )
      into v_has_stock_impact;

      if v_has_stock_impact then
        return true;
      end if;
    end if;
  end if;

  if to_regclass('public.material_request_fulfillment_batches') is not null
     and to_regclass('public.material_request_fulfillment_lines') is not null then
    select exists (
      select 1
      from public.material_request_fulfillment_lines line
      join public.material_request_fulfillment_batches batch
        on batch.id = line.batch_id
      left join public.transactions t
        on t.id::text = batch.transaction_id::text
      where line.po_id = p_po_id
        and batch.transaction_id is not null
        and (
          upper(coalesce(t.status::text, '')) = 'COMPLETED'
          or (
            to_regclass('public.inventory_ledger_entries') is not null
            and exists (
              select 1
              from public.inventory_ledger_entries entry
              where entry.source_type = 'wms_transaction'
                and entry.source_id = batch.transaction_id::text
            )
          )
        )
    )
      into v_has_stock_impact;

    if v_has_stock_impact then
      return true;
    end if;
  end if;

  if to_regclass('public.purchase_order_supplier_returns') is not null then
    select exists (
      select 1
      from public.purchase_order_supplier_returns r
      left join public.transactions t
        on t.id::text = r.transaction_id::text
      where r.purchase_order_id = p_po_id
        and (
          lower(coalesce(r.status, '')) = 'completed'
          or upper(coalesce(t.status::text, '')) = 'COMPLETED'
          or (
            to_regclass('public.inventory_ledger_entries') is not null
            and exists (
              select 1
              from public.inventory_ledger_entries entry
              where entry.source_type = 'wms_transaction'
                and entry.source_id = r.transaction_id::text
            )
          )
        )
    )
      into v_has_stock_impact;

    if v_has_stock_impact then
      return true;
    end if;
  end if;

  return false;
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
    or app_private.project_user_has_permission(
      v_po.project_id::text,
      v_po.construction_site_id::text,
      'delete'
    );

  if not v_has_permission then
    raise exception 'Bạn cần quyền xoá dữ liệu để xoá/lưu trữ PO này.'
      using errcode = '42501';
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
         or (
           link.source_type = 'transaction'
           and link.source_id = any(v_cleanup_transaction_ids)
         )
         or (
           link.target_type = 'transaction'
           and link.target_id = any(v_cleanup_transaction_ids)
         )
         or (
           link.source_type = 'supplier_return'
           and link.source_id = any(v_supplier_return_text_ids)
         )
         or (
           link.target_type = 'supplier_return'
           and link.target_id = any(v_supplier_return_text_ids)
         );
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

revoke all on function app_private.project_po_status_marks_submitted(text) from public, anon, authenticated;
revoke all on function app_private.project_po_has_stock_impact_v1(text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.remove_purchase_order_v1(text) from public, anon;
grant execute on function public.remove_purchase_order_v1(text) to authenticated;

notify pgrst, 'reload schema';
