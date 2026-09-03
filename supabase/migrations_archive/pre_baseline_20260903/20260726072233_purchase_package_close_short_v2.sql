create schema if not exists app_private;

create or replace function app_private.close_purchase_package_short_v2(
  p_purchase_order_id text,
  p_actor_user_id uuid,
  p_reason text,
  p_lines jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders%rowtype;
  v_line jsonb;
  v_purchase_order_line_id text;
  v_close_qty numeric;
  v_po_item jsonb;
  v_request_id text;
  v_request_line_id text;
  v_item_id text;
  v_ordered_qty numeric;
  v_received_qty numeric;
  v_returned_qty numeric;
  v_existing_closed_qty numeric;
  v_remaining_need numeric;
  v_total_closed_qty numeric := 0;
  v_previous_guard text;
begin
  if p_actor_user_id is null then
    raise exception 'Nguoi thuc hien lenh khong hop le.' using errcode = '42501';
  end if;
  if public.current_app_user_id() is null or p_actor_user_id <> public.current_app_user_id() then
    raise exception 'Nguoi thuc hien lenh khong hop le.' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Ly do ket thuc thieu la bat buoc.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'Phai co it nhat mot dong can ket thuc thieu.' using errcode = '22023';
  end if;

  select * into v_po
  from public.purchase_orders
  where id = p_purchase_order_id
  for update;
  if not found then
    raise exception 'Khong tim thay Goi mua hang %.', p_purchase_order_id using errcode = '22023';
  end if;
  if coalesce(v_po.source_mode, '') <> 'from_request' or coalesce(v_po.purchase_mode, '') not in ('single', 'multiple') then
    raise exception 'Chi ket thuc thieu cho Goi mua hang V2 tao tu MR.' using errcode = '22023';
  end if;
  if v_po.status not in ('confirmed', 'in_transit', 'partial') then
    raise exception 'Chi ket thuc thieu cho Goi da duyet hoac dang giao.' using errcode = '22023';
  end if;

  perform app_private.assert_project_permission_room_action(
    v_po.project_id,
    v_po.construction_site_id,
    'material_po',
    'submit',
    p_actor_user_id
  );

  if exists (
    select 1
    from public.purchase_order_delivery_batches batch
    where batch.purchase_order_id = p_purchase_order_id
      and batch.status not in ('received', 'cancelled')
  ) then
    raise exception 'Goi mua hang con Dot giao mo, khong the ket thuc thieu.' using errcode = '22023';
  end if;

  for v_line in
    select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) as line(value)
  loop
    v_purchase_order_line_id := nullif(v_line ->> 'purchaseOrderLineId', '');
    v_close_qty := coalesce(nullif(v_line ->> 'closeQty', '')::numeric, 0);
    if v_purchase_order_line_id is null then
      raise exception 'Dong ket thuc thieu thieu PO line.' using errcode = '22023';
    end if;
    if v_close_qty <= 0 then
      raise exception 'So luong ket thuc thieu phai lon hon 0.' using errcode = '22023';
    end if;

    select item.value into v_po_item
    from jsonb_array_elements(coalesce(v_po.items, '[]'::jsonb)) as item(value)
    where coalesce(item.value ->> 'lineId', item.value ->> 'itemId') = v_purchase_order_line_id
    limit 1;
    if v_po_item is null then
      raise exception 'Khong tim thay dong Goi mua hang %.', v_purchase_order_line_id using errcode = '22023';
    end if;

    v_request_id := nullif(v_po_item ->> 'requestId', '');
    v_request_line_id := nullif(v_po_item ->> 'requestLineId', '');
    v_item_id := nullif(v_po_item ->> 'itemId', '');
    if v_request_id is null or v_request_line_id is null or v_item_id is null then
      raise exception 'Dong Goi mua hang thieu lien ket MR.' using errcode = '22023';
    end if;

    v_ordered_qty := coalesce(nullif(v_po_item ->> 'qty', '')::numeric, 0);
    v_received_qty := coalesce(nullif(v_po_item ->> 'receivedQty', '')::numeric, 0);
    v_returned_qty := coalesce(nullif(v_po_item ->> 'returnedQty', '')::numeric, 0);

    select coalesce(sum(closure.closed_qty), 0)
    into v_existing_closed_qty
    from public.material_request_line_need_closures closure
    where closure.material_request_id = v_request_id
      and closure.request_line_id = v_request_line_id
      and closure.status = 'active';

    v_remaining_need := greatest(0, v_ordered_qty - greatest(0, v_received_qty - v_returned_qty) - v_existing_closed_qty);
    if v_close_qty > v_remaining_need then
      raise exception 'So luong ket thuc thieu vuot nhu cau con lai cua dong %.', v_purchase_order_line_id using errcode = '22023';
    end if;

    insert into public.material_request_line_need_closures (
      project_id,
      construction_site_id,
      material_request_id,
      request_line_id,
      item_id,
      work_boq_item_id,
      material_budget_item_id,
      closed_qty,
      actual_received_qty_snapshot,
      reason,
      status,
      closed_by,
      closed_at
    ) values (
      v_po.project_id,
      v_po.construction_site_id,
      v_request_id,
      v_request_line_id,
      v_item_id,
      nullif(v_po_item ->> 'workBoqItemId', ''),
      nullif(v_po_item ->> 'materialBudgetItemId', ''),
      v_close_qty,
      greatest(0, v_received_qty - v_returned_qty),
      trim(p_reason),
      'active',
      p_actor_user_id,
      now()
    );

    v_total_closed_qty := v_total_closed_qty + v_close_qty;
  end loop;

  v_previous_guard := current_setting('app.material_transition_context', true);
  perform set_config('app.material_transition_context', 'on', true);

  update public.purchase_orders
  set closed_need_qty = coalesce(closed_need_qty, 0) + v_total_closed_qty,
      status = 'closed',
      last_action_by = p_actor_user_id::text,
      last_action_at = now()
  where id = p_purchase_order_id;

  perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
exception
  when others then
    perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
    raise;
end;
$$;

revoke all on function app_private.close_purchase_package_short_v2(text, uuid, text, jsonb)
  from public, anon;
grant execute on function app_private.close_purchase_package_short_v2(text, uuid, text, jsonb)
  to authenticated;

create or replace function public.close_purchase_package_short_v2(
  p_purchase_order_id text,
  p_actor_user_id uuid default null,
  p_reason text default null,
  p_lines jsonb default '[]'::jsonb
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current_actor text := nullif(public.current_app_user_id()::text, '');
  v_actor uuid := coalesce(p_actor_user_id, v_current_actor::uuid);
begin
  if v_current_actor is null or v_actor::text <> v_current_actor then
    raise exception 'Nguoi thuc hien lenh khong hop le.' using errcode = '42501';
  end if;

  perform app_private.close_purchase_package_short_v2(
    p_purchase_order_id,
    v_actor,
    p_reason,
    p_lines
  );
end;
$$;

revoke all on function public.close_purchase_package_short_v2(text, uuid, text, jsonb)
  from public, anon;
grant execute on function public.close_purchase_package_short_v2(text, uuid, text, jsonb)
  to authenticated;
