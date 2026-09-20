create table app_private.material_request_receive_commands (
  actor_user_id uuid not null references public.users(id) on delete restrict,
  idempotency_key uuid not null,
  batch_id uuid not null references public.material_request_fulfillment_batches(id) on delete restrict,
  payload_hash text not null,
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (actor_user_id, idempotency_key),
  constraint material_request_receive_commands_payload_hash_check
    check (char_length(payload_hash) = 32),
  constraint material_request_receive_commands_result_check
    check ((result is null and completed_at is null) or (result is not null and completed_at is not null))
);

create index material_request_receive_commands_batch_idx
  on app_private.material_request_receive_commands(batch_id, created_at desc);

alter table app_private.material_request_receive_commands enable row level security;
revoke all on table app_private.material_request_receive_commands from public, anon, authenticated;
grant select, insert, update on table app_private.material_request_receive_commands to service_role;

create or replace function app_private.sync_material_request_fulfillment_receipt_v1(
  p_transaction_id text,
  p_batch_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tx public.transactions%rowtype;
  v_batch public.material_request_fulfillment_batches%rowtype;
  v_line record;
  v_received_qty numeric;
  v_reason text;
  v_match_count integer;
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
    raise exception 'FULFILLMENT_TRANSACTION_NOT_FOUND' using errcode = '22023';
  end if;

  select * into v_batch
  from public.material_request_fulfillment_batches
  where id = p_batch_id
    and transaction_id = p_transaction_id
  for update;
  if not found then
    raise exception 'FULFILLMENT_BATCH_TRANSACTION_CHANGED' using errcode = '40001';
  end if;
  if v_tx.status <> 'COMPLETED'::public.transaction_status then
    raise exception 'FULFILLMENT_TRANSACTION_NOT_COMPLETED' using errcode = '22023';
  end if;
  if v_batch.status not in ('issued', 'received') then
    return jsonb_build_object(
      'synced', false,
      'reason', 'batch_not_receivable',
      'batchStatus', v_batch.status
    );
  end if;

  for v_line in
    select *
    from public.material_request_fulfillment_lines
    where batch_id = p_batch_id
    order by id
    for update
  loop
    select
      count(*),
      coalesce(sum(coalesce(nullif(item.value ->> 'quantity', '')::numeric, 0)), 0),
      max(nullif(item.value ->> 'varianceReason', ''))
    into v_match_count, v_received_qty, v_reason
    from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) item(value)
    where item.value ->> 'fulfillmentBatchId' = p_batch_id::text
      and item.value ->> 'requestLineId' = v_line.request_line_id
      and item.value ->> 'itemId' = v_line.item_id;

    if v_match_count <> 1 then
      raise exception 'FULFILLMENT_TRANSACTION_LINE_SET_INVALID' using errcode = '22023';
    end if;
    if v_received_qty is distinct from v_line.issued_qty then
      v_has_variance := true;
    end if;

    update public.material_request_fulfillment_lines
    set
      received_qty = v_received_qty,
      variance_reason = coalesce(
        v_reason,
        variance_reason,
        case
          when v_received_qty is distinct from v_line.issued_qty
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
      received_by = p_actor_user_id,
      received_at = now(),
      reason = coalesce(
        reason,
        case when v_has_variance then 'Thủ kho công trường xác nhận nhận lệch theo thực tế.' else null end
      )
    where id = p_batch_id
    returning * into v_batch;
  end if;

  for v_po_id in
    select distinct po_id
    from public.material_request_fulfillment_lines
    where batch_id = p_batch_id
      and po_id is not null
    order by po_id
  loop
    select * into v_po
    from public.purchase_orders
    where id = v_po_id
    for update;
    if not found then
      raise exception 'FULFILLMENT_PURCHASE_ORDER_NOT_FOUND' using errcode = '22023';
    end if;

    if exists (
      select 1
      from public.material_request_fulfillment_lines fulfillment_line
      where fulfillment_line.batch_id = p_batch_id
        and fulfillment_line.po_id = v_po_id
        and fulfillment_line.po_line_id is not null
        and (
          select count(*)
          from jsonb_array_elements(coalesce(v_po.items, '[]'::jsonb)) po_item(value)
          where coalesce(
            po_item.value ->> 'lineId',
            po_item.value ->> 'line_id',
            po_item.value ->> 'itemId',
            po_item.value ->> 'item_id'
          ) = fulfillment_line.po_line_id
        ) <> 1
    ) then
      raise exception 'FULFILLMENT_PO_LINE_SET_INVALID' using errcode = '22023';
    end if;

    select exists (
      select 1
      from jsonb_array_elements_text(coalesce(v_po.received_transaction_ids, '[]'::jsonb)) existing(id)
      where existing.id = p_transaction_id
    ) into v_already_recorded;
    if v_already_recorded then
      continue;
    end if;

    with receipt_by_line as (
      select
        fulfillment_line.po_line_id,
        sum(
          case
            when nullif(transaction_line.value ->> 'accountingQty', '') is null
              then fulfillment_line.received_qty
            when fulfillment_line.received_qty = 0
              then 0
            when coalesce(nullif(transaction_line.value ->> 'orderedQty', '')::numeric, 0) > 0
              then fulfillment_line.received_qty
                * (transaction_line.value ->> 'accountingQty')::numeric
                / (transaction_line.value ->> 'orderedQty')::numeric
            else (transaction_line.value ->> 'accountingQty')::numeric
          end
        ) as received_qty
      from public.material_request_fulfillment_lines fulfillment_line
      join lateral (
        select item.value
        from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) item(value)
        where item.value ->> 'fulfillmentBatchId' = p_batch_id::text
          and item.value ->> 'requestLineId' = fulfillment_line.request_line_id
          and item.value ->> 'itemId' = fulfillment_line.item_id
      ) transaction_line on true
      where fulfillment_line.batch_id = p_batch_id
        and fulfillment_line.po_id = v_po_id
        and fulfillment_line.po_line_id is not null
      group by fulfillment_line.po_line_id
    ), item_rows as (
      select
        item.value as item,
        item.ordinality,
        coalesce(
          item.value ->> 'lineId',
          item.value ->> 'line_id',
          item.value ->> 'itemId',
          item.value ->> 'item_id'
        ) as line_key,
        coalesce(nullif(item.value ->> 'receivedQty', '')::numeric, 0) as current_received_qty
      from jsonb_array_elements(coalesce(v_po.items, '[]'::jsonb))
        with ordinality item(value, ordinality)
    ), next_rows as (
      select
        case
          when coalesce(receipt.received_qty, 0) > 0 then
            jsonb_set(
              item_row.item,
              '{receivedQty}',
              to_jsonb(item_row.current_received_qty + receipt.received_qty),
              true
            )
          else item_row.item
        end as item,
        item_row.ordinality
      from item_rows item_row
      left join receipt_by_line receipt on receipt.po_line_id = item_row.line_key
    )
    select coalesce(jsonb_agg(item order by ordinality), '[]'::jsonb)
    into v_next_items
    from next_rows;

    select coalesce(bool_and(
      coalesce(nullif(item.value ->> 'qty', '')::numeric, 0)
        <= coalesce(nullif(item.value ->> 'receivedQty', '')::numeric, 0)
    ), false)
    into v_is_delivered
    from jsonb_array_elements(coalesce(v_next_items, '[]'::jsonb)) item(value);

    update public.purchase_orders
    set
      items = v_next_items,
      status = case when v_is_delivered then 'delivered' else 'partial' end,
      actual_delivery_date = case when v_is_delivered then current_date::text else actual_delivery_date end,
      received_transaction_ids = coalesce(received_transaction_ids, '[]'::jsonb)
        || jsonb_build_array(p_transaction_id)
    where id = v_po_id;
  end loop;

  perform app_private.sync_po_delivery_schedule_status_v1(
    v_batch.po_delivery_batch_id,
    v_batch.po_delivery_group_id
  );
  perform app_private.sync_material_request_receipt_status_v1(
    v_batch.material_request_id,
    p_actor_user_id,
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

revoke all on function app_private.sync_material_request_fulfillment_receipt_v1(
  text, uuid, uuid
) from public, anon, authenticated;

create or replace function app_private.receive_material_request_fulfillment_batch_v1(
  p_batch_id uuid,
  p_expected_updated_at timestamptz,
  p_actor_user_id uuid,
  p_idempotency_key uuid,
  p_lines jsonb,
  p_override_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_command app_private.material_request_receive_commands%rowtype;
  v_batch public.material_request_fulfillment_batches%rowtype;
  v_tx public.transactions%rowtype;
  v_payload_hash text;
  v_input_count integer;
  v_input_distinct_count integer;
  v_line_count integer;
  v_transaction_line_count integer;
  v_next_items jsonb;
  v_item jsonb;
  v_item_id text;
  v_qty numeric;
  v_result jsonb;
  v_sync_result jsonb;
  v_lines jsonb;
  v_previous_guard text := current_setting('app.material_transition_context', true);
begin
  if v_actor is null
     or p_actor_user_id is null
     or p_actor_user_id is distinct from v_actor then
    raise exception 'FULFILLMENT_RECEIVE_ACTOR_INVALID' using errcode = '42501';
  end if;
  if p_batch_id is null
     or p_expected_updated_at is null
     or p_idempotency_key is null
     or jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'FULFILLMENT_RECEIVE_INPUT_INVALID' using errcode = '22023';
  end if;

  v_payload_hash := md5(jsonb_build_object(
    'batchId', p_batch_id,
    'expectedUpdatedAt', p_expected_updated_at,
    'lines', p_lines,
    'overrideReason', nullif(btrim(coalesce(p_override_reason, '')), '')
  )::text);

  select * into v_batch
  from public.material_request_fulfillment_batches
  where id = p_batch_id;
  if not found then
    raise exception 'FULFILLMENT_BATCH_NOT_FOUND' using errcode = '22023';
  end if;
  if v_batch.transaction_id is null then
    raise exception 'FULFILLMENT_TRANSACTION_REQUIRED' using errcode = '22023';
  end if;

  select * into v_tx
  from public.transactions
  where id = v_batch.transaction_id
  for update;
  if not found then
    raise exception 'FULFILLMENT_TRANSACTION_NOT_FOUND' using errcode = '22023';
  end if;

  select * into v_batch
  from public.material_request_fulfillment_batches
  where id = p_batch_id
  for update;
  if not found or v_batch.transaction_id is distinct from v_tx.id then
    raise exception 'FULFILLMENT_BATCH_TRANSACTION_CHANGED' using errcode = '40001';
  end if;

  select * into v_command
  from app_private.material_request_receive_commands
  where actor_user_id = v_actor
    and idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_command.batch_id is distinct from p_batch_id
       or v_command.payload_hash is distinct from v_payload_hash then
      raise exception 'FULFILLMENT_RECEIVE_IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    if v_command.result is not null then
      return v_command.result || jsonb_build_object('idempotentReplay', true);
    end if;
  else
    insert into app_private.material_request_receive_commands(
      actor_user_id, idempotency_key, batch_id, payload_hash
    ) values (
      v_actor, p_idempotency_key, p_batch_id, v_payload_hash
    )
    on conflict (actor_user_id, idempotency_key) do nothing;

    select * into strict v_command
    from app_private.material_request_receive_commands
    where actor_user_id = v_actor
      and idempotency_key = p_idempotency_key
    for update;

    if v_command.batch_id is distinct from p_batch_id
       or v_command.payload_hash is distinct from v_payload_hash then
      raise exception 'FULFILLMENT_RECEIVE_IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
  end if;

  if v_batch.updated_at is distinct from p_expected_updated_at then
    raise exception 'FULFILLMENT_BATCH_STALE' using errcode = '40001';
  end if;
  if v_batch.status <> 'issued' then
    raise exception 'FULFILLMENT_BATCH_NOT_RECEIVABLE' using errcode = '22023';
  end if;

  if v_tx.source_type = 'po_delivery_batch' then
    raise exception 'PURCHASE_RECEIPT_V2_OWNER_REQUIRED' using errcode = '22023';
  end if;
  if not app_private.wms_transaction_has_action(
    'wms.transaction.complete',
    v_tx.type,
    v_tx.source_warehouse_id,
    v_tx.target_warehouse_id,
    v_tx.items,
    v_tx.requester_id,
    v_tx.approver_id,
    v_actor
  ) then
    raise exception 'FULFILLMENT_RECEIVE_FORBIDDEN' using errcode = '42501';
  end if;
  if v_tx.status = 'PENDING'::public.transaction_status then
    raise exception 'FULFILLMENT_TRANSACTION_REQUIRES_QUALITY_APPROVAL' using errcode = '22023';
  end if;
  if v_tx.status not in (
    'APPROVED'::public.transaction_status,
    'COMPLETED'::public.transaction_status
  ) then
    raise exception 'FULFILLMENT_TRANSACTION_NOT_RECEIVABLE' using errcode = '22023';
  end if;

  perform 1
  from public.material_request_fulfillment_lines
  where batch_id = p_batch_id
  order by id
  for update;

  select count(*) into v_line_count
  from public.material_request_fulfillment_lines
  where batch_id = p_batch_id;

  select
    count(*),
    count(distinct nullif(value ->> 'lineId', '')::uuid)
  into v_input_count, v_input_distinct_count
  from jsonb_array_elements(p_lines) input(value);

  if v_line_count = 0
     or v_input_count <> v_line_count
     or v_input_distinct_count <> v_line_count then
    raise exception 'FULFILLMENT_RECEIVE_LINE_SET_INVALID' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lines) input(value)
    left join public.material_request_fulfillment_lines line
      on line.id = nullif(input.value ->> 'lineId', '')::uuid
     and line.batch_id = p_batch_id
    where line.id is null
       or nullif(input.value ->> 'receivedQty', '') is null
       or nullif(input.value ->> 'expectedUpdatedAt', '') is null
       or lower(input.value ->> 'receivedQty') in ('nan', 'infinity', '-infinity', 'inf', '-inf')
       or (input.value ->> 'receivedQty')::numeric < 0
  ) then
    raise exception 'FULFILLMENT_RECEIVE_LINE_INVALID' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lines) input(value)
    join public.material_request_fulfillment_lines line
      on line.id = nullif(input.value ->> 'lineId', '')::uuid
     and line.batch_id = p_batch_id
    where line.updated_at is distinct from (input.value ->> 'expectedUpdatedAt')::timestamptz
  ) then
    raise exception 'FULFILLMENT_RECEIVE_LINE_STALE' using errcode = '40001';
  end if;

  select count(*) into v_transaction_line_count
  from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) item(value)
  where item.value ->> 'fulfillmentBatchId' = p_batch_id::text;

  if jsonb_array_length(coalesce(v_tx.items, '[]'::jsonb)) <> v_line_count
     or v_transaction_line_count <> v_line_count
     or exists (
       select 1
       from public.material_request_fulfillment_lines line
       where line.batch_id = p_batch_id
         and (
           select count(*)
           from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) item(value)
           where item.value ->> 'fulfillmentBatchId' = p_batch_id::text
             and item.value ->> 'requestLineId' = line.request_line_id
             and item.value ->> 'itemId' = line.item_id
         ) <> 1
     ) then
    raise exception 'FULFILLMENT_TRANSACTION_LINE_SET_INVALID' using errcode = '22023';
  end if;

  with input_lines as (
    select
      nullif(value ->> 'lineId', '')::uuid as line_id,
      (value ->> 'receivedQty')::numeric as received_qty,
      nullif(btrim(coalesce(value ->> 'varianceReason', '')), '') as variance_reason
    from jsonb_array_elements(p_lines) input(value)
  ), next_rows as (
    select
      case
        when item.value ->> 'fulfillmentBatchId' = p_batch_id::text then (
          select jsonb_set(
            jsonb_set(
              jsonb_set(
                item.value,
                '{orderedQty}',
                to_jsonb(coalesce(
                  nullif(item.value ->> 'orderedQty', '')::numeric,
                  nullif(item.value ->> 'quantity', '')::numeric,
                  0
                )),
                true
              ),
              '{quantity}',
              to_jsonb(receive_line.received_qty),
              true
            ),
            '{varianceReason}',
            to_jsonb(coalesce(
              receive_line.variance_reason,
              fulfillment_line.variance_reason,
              case
                when receive_line.received_qty is distinct from fulfillment_line.issued_qty
                  then 'Thủ kho công trường xác nhận số lượng thực nhận lệch phiếu kho.'
                else ''
              end
            )),
            true
          )
          from public.material_request_fulfillment_lines fulfillment_line
          join input_lines receive_line on receive_line.line_id = fulfillment_line.id
          where fulfillment_line.batch_id = p_batch_id
            and fulfillment_line.request_line_id = item.value ->> 'requestLineId'
            and fulfillment_line.item_id = item.value ->> 'itemId'
        )
        else item.value
      end as value,
      item.ordinality
    from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb))
      with ordinality item(value, ordinality)
  )
  select coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb)
  into v_next_items
  from next_rows;

  if v_tx.status = 'COMPLETED'::public.transaction_status and exists (
    select 1
    from jsonb_array_elements(p_lines) input(value)
    join public.material_request_fulfillment_lines fulfillment_line
      on fulfillment_line.id = nullif(input.value ->> 'lineId', '')::uuid
     and fulfillment_line.batch_id = p_batch_id
    join lateral (
      select item.value
      from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) item(value)
      where item.value ->> 'fulfillmentBatchId' = p_batch_id::text
        and item.value ->> 'requestLineId' = fulfillment_line.request_line_id
        and item.value ->> 'itemId' = fulfillment_line.item_id
    ) transaction_line on true
    where (transaction_line.value ->> 'quantity')::numeric
      is distinct from (input.value ->> 'receivedQty')::numeric
  ) then
    raise exception 'FULFILLMENT_TRANSACTION_ALREADY_COMPLETED' using errcode = '22023';
  end if;

  if v_tx.status = 'APPROVED'::public.transaction_status then
    perform 1
    from public.items item
    where item.id in (
      select distinct transaction_line.value ->> 'itemId'
      from jsonb_array_elements(v_next_items) transaction_line(value)
      where nullif(transaction_line.value ->> 'itemId', '') is not null
    )
    order by item.id
    for update;

    for v_item in
      select value from jsonb_array_elements(v_next_items) item(value)
    loop
      v_item_id := nullif(v_item ->> 'itemId', '');
      v_qty := coalesce(nullif(v_item ->> 'quantity', '')::numeric, 0);
      if v_item_id is null
         or lower(v_qty::text) in ('nan', 'infinity', '-infinity', 'inf', '-inf')
         or v_qty < 0 then
        raise exception 'FULFILLMENT_TRANSACTION_ITEM_INVALID' using errcode = '22023';
      end if;
      if v_qty = 0 then
        continue;
      end if;

      if v_tx.type = 'IMPORT'::public.transaction_type then
        perform public.apply_stock_change(v_item_id, v_tx.target_warehouse_id, v_qty::numeric);
      elsif v_tx.type in ('EXPORT'::public.transaction_type, 'LIQUIDATION'::public.transaction_type) then
        perform public.apply_stock_change(v_item_id, v_tx.source_warehouse_id, -v_qty::numeric);
      elsif v_tx.type = 'TRANSFER'::public.transaction_type then
        perform public.apply_stock_change(v_item_id, v_tx.source_warehouse_id, -v_qty::numeric);
        perform public.apply_stock_change(v_item_id, v_tx.target_warehouse_id, v_qty::numeric);
      elsif v_tx.type = 'ADJUSTMENT'::public.transaction_type then
        perform public.apply_stock_change(v_item_id, v_tx.target_warehouse_id, v_qty::numeric);
      else
        raise exception 'FULFILLMENT_TRANSACTION_TYPE_INVALID' using errcode = '22023';
      end if;
    end loop;

    update public.transactions
    set items = v_next_items,
        status = 'COMPLETED'::public.transaction_status,
        approver_id = v_actor,
        approved_at = coalesce(approved_at, now())
    where id = v_tx.id
    returning * into v_tx;
  end if;

  if nullif(btrim(coalesce(p_override_reason, '')), '') is not null then
    update public.material_request_fulfillment_batches
    set reason = btrim(p_override_reason)
    where id = p_batch_id
    returning * into v_batch;
  end if;

  perform set_config('app.material_transition_context', 'on', true);
  v_sync_result := app_private.sync_material_request_fulfillment_receipt_v1(
    v_tx.id,
    p_batch_id,
    v_actor
  );
  perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);

  if coalesce(v_sync_result ->> 'synced', 'false') <> 'true' then
    raise exception 'FULFILLMENT_RECEIPT_SYNC_FAILED: %', coalesce(v_sync_result ->> 'reason', 'unknown')
      using errcode = 'P0001';
  end if;

  select * into v_batch
  from public.material_request_fulfillment_batches
  where id = p_batch_id;

  select coalesce(jsonb_agg(to_jsonb(line_row) order by line_row.created_at, line_row.id), '[]'::jsonb)
  into v_lines
  from public.material_request_fulfillment_lines line_row
  where line_row.batch_id = p_batch_id;

  v_result := jsonb_build_object(
    'batch', to_jsonb(v_batch),
    'lines', v_lines,
    'transactionId', v_tx.id,
    'transactionStatus', v_tx.status,
    'idempotentReplay', false
  );

  update app_private.material_request_receive_commands
  set result = v_result,
      completed_at = now()
  where actor_user_id = v_actor
    and idempotency_key = p_idempotency_key;

  return v_result;
exception
  when others then
    perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
    raise;
end;
$$;

revoke all on function app_private.receive_material_request_fulfillment_batch_v1(
  uuid, timestamptz, uuid, uuid, jsonb, text
) from public, anon, authenticated;
grant execute on function app_private.receive_material_request_fulfillment_batch_v1(
  uuid, timestamptz, uuid, uuid, jsonb, text
) to authenticated, service_role;

create or replace function public.receive_material_request_fulfillment_batch_v1(
  p_batch_id uuid,
  p_expected_updated_at timestamptz,
  p_actor_user_id uuid,
  p_idempotency_key uuid,
  p_lines jsonb,
  p_override_reason text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.receive_material_request_fulfillment_batch_v1(
    p_batch_id,
    p_expected_updated_at,
    p_actor_user_id,
    p_idempotency_key,
    p_lines,
    p_override_reason
  );
$$;

revoke all on function public.receive_material_request_fulfillment_batch_v1(
  uuid, timestamptz, uuid, uuid, jsonb, text
) from public, anon;
grant execute on function public.receive_material_request_fulfillment_batch_v1(
  uuid, timestamptz, uuid, uuid, jsonb, text
) to authenticated, service_role;

notify pgrst, 'reload schema';
