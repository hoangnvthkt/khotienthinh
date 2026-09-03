-- Keep PO delivery schedules and project MR workflow status in sync when a
-- WMS receipt is completed from the transaction approval screen.

create or replace function app_private.sync_po_delivery_schedule_status_v1(
  p_po_delivery_batch_id uuid default null,
  p_po_delivery_group_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_batch_count integer := 0;
  v_all_received boolean := false;
  v_all_rejected boolean := false;
  v_fulfillment_batch_ids text[] := '{}';
  v_next_schedule_status text;
  v_next_group_status text;
begin
  if p_po_delivery_batch_id is not null then
    with related as (
      select
        b.id,
        b.status,
        coalesce(sum(coalesce(l.received_qty, 0)), 0) as received_qty
      from public.material_request_fulfillment_batches b
      left join public.material_request_fulfillment_lines l on l.batch_id = b.id
      where b.po_delivery_batch_id = p_po_delivery_batch_id
      group by b.id, b.status
    )
    select
      count(*)::integer,
      coalesce(bool_and(status = 'received'), false),
      coalesce(bool_and(status in ('cancelled', 'returned') and received_qty <= 0), false),
      coalesce(array_agg(id::text order by id::text), '{}')
    into v_batch_count, v_all_received, v_all_rejected, v_fulfillment_batch_ids
    from related;

    if v_batch_count > 0 then
      v_next_schedule_status := case
        when v_all_received then 'received'
        when v_all_rejected then 'cancelled'
        else 'wms_pending'
      end;

      update public.purchase_order_delivery_batches
      set status = v_next_schedule_status,
          fulfillment_batch_ids = v_fulfillment_batch_ids
      where id = p_po_delivery_batch_id;
    end if;
  end if;

  if p_po_delivery_group_id is not null then
    with related as (
      select
        b.id,
        b.status,
        coalesce(sum(coalesce(l.received_qty, 0)), 0) as received_qty
      from public.material_request_fulfillment_batches b
      left join public.material_request_fulfillment_lines l on l.batch_id = b.id
      where b.po_delivery_group_id = p_po_delivery_group_id
      group by b.id, b.status
    )
    select
      count(*)::integer,
      coalesce(bool_and(status = 'received'), false),
      coalesce(bool_and(status in ('cancelled', 'returned') and received_qty <= 0), false)
    into v_batch_count, v_all_received, v_all_rejected
    from related;

    if v_batch_count > 0 then
      v_next_group_status := case
        when v_all_received then 'received'
        when v_all_rejected then 'cancelled'
        else 'issued'
      end;

      update public.purchase_order_delivery_groups
      set status = v_next_group_status
      where id = p_po_delivery_group_id;
    end if;
  end if;

  return jsonb_build_object(
    'synced', true,
    'poDeliveryBatchId', p_po_delivery_batch_id,
    'poDeliveryGroupId', p_po_delivery_group_id
  );
end;
$$;

revoke all on function app_private.sync_po_delivery_schedule_status_v1(uuid, uuid) from public, anon, authenticated;

create or replace function app_private.sync_material_request_receipt_status_v1(
  p_request_id text,
  p_actor_user_id uuid default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_request public.requests%rowtype;
  v_total_committed numeric := 0;
  v_total_issued numeric := 0;
  v_total_received numeric := 0;
  v_total_closed numeric := 0;
  v_open_need numeric := 0;
  v_has_open_batch boolean := false;
  v_next_status public.request_status;
  v_next_step text;
  v_step_changed boolean := false;
  v_sla_hours integer;
begin
  if coalesce(p_request_id, '') = '' then
    return jsonb_build_object('synced', false, 'reason', 'missing_request_id');
  end if;

  select *
  into v_request
  from public.requests
  where id = p_request_id
  for update;

  if not found then
    return jsonb_build_object('synced', false, 'reason', 'request_not_found', 'requestId', p_request_id);
  end if;

  if v_request.status in (
    'DRAFT'::public.request_status,
    'PENDING'::public.request_status,
    'REJECTED'::public.request_status
  ) then
    return jsonb_build_object(
      'synced', false,
      'reason', 'request_waiting_approval_or_rejected',
      'requestId', p_request_id,
      'status', v_request.status
    );
  end if;

  select coalesce(sum(coalesce(
    nullif(item.value ->> 'requestQty', '')::numeric,
    nullif(item.value ->> 'request_qty', '')::numeric,
    nullif(item.value ->> 'approvedQty', '')::numeric,
    nullif(item.value ->> 'approved_qty', '')::numeric,
    0
  )), 0)
  into v_total_committed
  from jsonb_array_elements(coalesce(v_request.items, '[]'::jsonb)) item(value);

  select
    coalesce(sum(case when b.status not in ('draft', 'cancelled', 'returned') then coalesce(l.issued_qty, 0) else 0 end), 0),
    coalesce(sum(case when b.status = 'received' then coalesce(l.received_qty, 0) else 0 end), 0),
    coalesce(bool_or(b.status in ('issued', 'variance_pending')), false)
  into v_total_issued, v_total_received, v_has_open_batch
  from public.material_request_fulfillment_batches b
  left join public.material_request_fulfillment_lines l on l.batch_id = b.id
  where b.material_request_id = p_request_id;

  if to_regclass('public.material_request_line_need_closures') is not null then
    select coalesce(sum(coalesce(closed_qty, 0)), 0)
    into v_total_closed
    from public.material_request_line_need_closures
    where material_request_id = p_request_id
      and status = 'active';
  end if;

  v_open_need := greatest(0, v_total_committed - v_total_received - v_total_closed);

  v_next_status := case
    when v_total_committed > 0 and v_open_need <= 0 then 'COMPLETED'::public.request_status
    when v_total_issued > 0 or v_total_received > 0 then 'IN_TRANSIT'::public.request_status
    else 'APPROVED'::public.request_status
  end;

  v_next_step := case
    when v_next_status = 'COMPLETED'::public.request_status then 'completed'
    when v_has_open_batch then 'site_quality_check'
    when v_total_received > 0 and v_open_need > 0 then 'batch_planning'
    when v_total_issued > 0 then 'site_quality_check'
    else 'batch_planning'
  end;

  v_step_changed := v_request.workflow_step is distinct from v_next_step;
  v_sla_hours := case
    when v_next_step = 'batch_planning' then 48
    when v_next_step = 'site_quality_check' then 8
    else null
  end;

  update public.requests
  set status = v_next_status,
      workflow_step = v_next_step,
      workflow_step_started_at = case when v_step_changed then now() else workflow_step_started_at end,
      workflow_step_due_at = case
        when v_next_step = 'completed' then null
        when v_step_changed and v_sla_hours is not null then now() + make_interval(hours => v_sla_hours)
        else workflow_step_due_at
      end,
      workflow_step_sla_hours = case
        when v_next_step = 'completed' then null
        when v_step_changed then v_sla_hours
        else workflow_step_sla_hours
      end,
      workflow_step_actor_user_id = coalesce(p_actor_user_id::text, workflow_step_actor_user_id),
      submitted_to_user_id = case when v_next_step = 'completed' then null else submitted_to_user_id end,
      submitted_to_name = case when v_next_step = 'completed' then null else submitted_to_name end,
      submitted_to_permission = case when v_next_step = 'completed' then null else submitted_to_permission end,
      submission_note = case
        when v_next_step = 'completed' then null
        when nullif(trim(coalesce(p_note, '')), '') is not null then p_note
        else submission_note
      end
  where id = p_request_id;

  return jsonb_build_object(
    'synced', true,
    'requestId', p_request_id,
    'status', v_next_status,
    'workflowStep', v_next_step,
    'committedQty', v_total_committed,
    'receivedQty', v_total_received,
    'closedNeedQty', v_total_closed,
    'openNeedQty', v_open_need
  );
end;
$$;

revoke all on function app_private.sync_material_request_receipt_status_v1(text, uuid, text) from public, anon, authenticated;

create or replace function public.sync_fulfillment_receipt_for_transaction(
  p_transaction_id text,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_tx public.transactions%rowtype;
  v_user public.users%rowtype;
  v_batch public.material_request_fulfillment_batches%rowtype;
  v_actor_user_id uuid;
  v_can_sync boolean := false;
  v_line record;
  v_received_qty numeric;
  v_reason text;
  v_has_variance boolean := false;
  v_po_id text;
  v_po public.purchase_orders%rowtype;
  v_next_items jsonb;
  v_is_delivered boolean;
  v_already_recorded boolean;
begin
  select * into v_tx
  from public.transactions
  where id = p_transaction_id
  for update;
  if not found then
    raise exception 'transaction not found: %', p_transaction_id;
  end if;

  select * into v_user
  from public.users
  where id = public.current_app_user_id();
  if v_user.id is null then
    raise exception 'authentication required';
  end if;

  v_actor_user_id := coalesce(p_actor_user_id, v_user.id);

  v_can_sync :=
    public.is_admin()
    or public.is_module_admin('WMS')
    or (
      v_user.role = 'WAREHOUSE_KEEPER'
      and (
        v_user.assigned_warehouse_id is null
        or (
          v_tx.type in ('IMPORT'::public.transaction_type, 'TRANSFER'::public.transaction_type)
          and v_user.assigned_warehouse_id is not distinct from v_tx.target_warehouse_id
        )
      )
    );

  if not v_can_sync then
    raise exception 'insufficient privilege to sync fulfillment receipt';
  end if;

  if v_tx.status <> 'COMPLETED'::public.transaction_status then
    raise exception 'Chỉ đồng bộ nhận hàng cho phiếu kho đã hoàn tất.';
  end if;

  select * into v_batch
  from public.material_request_fulfillment_batches
  where transaction_id = p_transaction_id
  for update;
  if not found then
    return jsonb_build_object('synced', false, 'reason', 'batch_not_found');
  end if;

  if v_batch.status not in ('issued', 'received') then
    return jsonb_build_object('synced', false, 'reason', 'batch_not_receivable', 'batchStatus', v_batch.status);
  end if;

  for v_line in
    select *
    from public.material_request_fulfillment_lines
    where batch_id = v_batch.id
    order by created_at asc
    for update
  loop
    select
      coalesce(sum(coalesce(nullif(item.value->>'quantity', '')::numeric, 0)), 0),
      max(nullif(item.value->>'varianceReason', ''))
    into v_received_qty, v_reason
    from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) item(value)
    where coalesce(item.value->>'fulfillmentBatchId', '') = v_batch.id::text
      and item.value->>'requestLineId' = v_line.request_line_id;

    if coalesce(v_received_qty, 0) = 0 then
      select
        coalesce(sum(coalesce(nullif(item.value->>'quantity', '')::numeric, 0)), 0),
        max(nullif(item.value->>'varianceReason', ''))
      into v_received_qty, v_reason
      from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) item(value)
      where coalesce(item.value->>'fulfillmentBatchId', '') = v_batch.id::text
        and item.value->>'itemId' = v_line.item_id;
    end if;

    if coalesce(v_received_qty, 0) <> coalesce(v_line.issued_qty, 0) then
      v_has_variance := true;
    end if;

    update public.material_request_fulfillment_lines
    set
      received_qty = coalesce(v_received_qty, 0),
      variance_reason = coalesce(
        nullif(v_reason, ''),
        variance_reason,
        case
          when coalesce(v_received_qty, 0) <> coalesce(v_line.issued_qty, 0)
            then 'Thủ kho công trường xác nhận số lượng thực nhận lệch phiếu kho.'
          else null
        end
      )
    where id = v_line.id;
  end loop;

  if v_batch.status = 'issued' then
    update public.material_request_fulfillment_batches
    set
      status = 'received',
      received_by = v_actor_user_id,
      received_at = now(),
      reason = coalesce(
        reason,
        case when v_has_variance then 'Thủ kho công trường xác nhận nhận lệch theo thực tế.' else null end
      )
    where id = v_batch.id
    returning * into v_batch;
  end if;

  for v_po_id in
    select distinct po_id
    from public.material_request_fulfillment_lines
    where batch_id = v_batch.id
      and po_id is not null
  loop
    select * into v_po
    from public.purchase_orders
    where id = v_po_id
    for update;
    if not found then
      continue;
    end if;

    select exists (
      select 1
      from jsonb_array_elements_text(coalesce(v_po.received_transaction_ids, '[]'::jsonb)) existing(id)
      where existing.id = v_tx.id
    )
    into v_already_recorded;
    if v_already_recorded then
      continue;
    end if;

    with receipt_by_line as (
      select po_line_id, sum(coalesce(received_qty, 0)) as received_qty
      from public.material_request_fulfillment_lines
      where batch_id = v_batch.id
        and po_id = v_po_id
        and po_line_id is not null
      group by po_line_id
    ),
    item_rows as (
      select
        item.value as item,
        item.ordinality,
        coalesce(item.value->>'lineId', item.value->>'line_id', item.value->>'itemId', item.value->>'item_id') as line_key,
        coalesce(nullif(item.value->>'qty', '')::numeric, 0) as ordered_qty,
        coalesce(nullif(item.value->>'receivedQty', '')::numeric, 0) as current_received_qty
      from jsonb_array_elements(coalesce(v_po.items, '[]'::jsonb)) with ordinality item(value, ordinality)
    ),
    next_rows as (
      select
        case
          when coalesce(r.received_qty, 0) > 0 then
            jsonb_set(
              ir.item,
              '{receivedQty}',
              to_jsonb(least(ir.ordered_qty, ir.current_received_qty + coalesce(r.received_qty, 0))),
              true
            )
          else ir.item
        end as item,
        ir.ordinality
      from item_rows ir
      left join receipt_by_line r on r.po_line_id = ir.line_key
    )
    select coalesce(jsonb_agg(item order by ordinality), '[]'::jsonb)
    into v_next_items
    from next_rows;

    select coalesce(bool_and(
      coalesce(nullif(item.value->>'qty', '')::numeric, 0) <= coalesce(nullif(item.value->>'receivedQty', '')::numeric, 0)
    ), false)
    into v_is_delivered
    from jsonb_array_elements(coalesce(v_next_items, '[]'::jsonb)) item(value);

    update public.purchase_orders
    set
      items = v_next_items,
      status = case when v_is_delivered then 'delivered' else 'partial' end,
      actual_delivery_date = case when v_is_delivered then current_date::text else actual_delivery_date end,
      received_transaction_ids = coalesce(received_transaction_ids, '[]'::jsonb) || jsonb_build_array(v_tx.id)
    where id = v_po_id;
  end loop;

  perform app_private.sync_po_delivery_schedule_status_v1(
    v_batch.po_delivery_batch_id,
    v_batch.po_delivery_group_id
  );

  perform app_private.sync_material_request_receipt_status_v1(
    v_batch.material_request_id,
    v_actor_user_id,
    'Đồng bộ sau khi phiếu kho hoàn tất'
  );

  return jsonb_build_object(
    'synced', true,
    'batchId', v_batch.id,
    'batchStatus', v_batch.status,
    'hasVariance', v_has_variance
  );
end;
$$;

revoke all on function public.sync_fulfillment_receipt_for_transaction(text, uuid) from public, anon;
grant execute on function public.sync_fulfillment_receipt_for_transaction(text, uuid) to authenticated;

do $$
declare
  v_delivery_batch_id uuid;
  v_delivery_group_id uuid;
  v_request_id text;
begin
  for v_delivery_batch_id in
    select distinct po_delivery_batch_id
    from public.material_request_fulfillment_batches
    where po_delivery_batch_id is not null
  loop
    perform app_private.sync_po_delivery_schedule_status_v1(v_delivery_batch_id, null);
  end loop;

  for v_delivery_group_id in
    select distinct po_delivery_group_id
    from public.material_request_fulfillment_batches
    where po_delivery_group_id is not null
  loop
    perform app_private.sync_po_delivery_schedule_status_v1(null, v_delivery_group_id);
  end loop;

  for v_request_id in
    select distinct material_request_id
    from public.material_request_fulfillment_batches
    where material_request_id is not null
      and status in ('issued', 'received', 'variance_pending')
  loop
    perform app_private.sync_material_request_receipt_status_v1(
      v_request_id,
      null,
      'Đồng bộ lại trạng thái sau khi kho nhận hàng'
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';
