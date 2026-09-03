create schema if not exists app_private;

create or replace function app_private.project_po_refresh_request_status_v1(
  p_request_ids text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id text;
  v_total_committed numeric := 0;
  v_total_active_issued numeric := 0;
  v_total_received numeric := 0;
  v_total_closed numeric := 0;
  v_open_need numeric := 0;
  v_next_status public.request_status;
  v_next_step text;
begin
  if p_request_ids is null or array_length(p_request_ids, 1) is null then
    return;
  end if;

  foreach v_request_id in array p_request_ids loop
    select coalesce(sum(
      coalesce(
        nullif(item.value ->> 'approvedQty', '')::numeric,
        nullif(item.value ->> 'requestQty', '')::numeric,
        0
      )
    ), 0)
    into v_total_committed
    from public.requests request
    cross join lateral jsonb_array_elements(coalesce(request.items, '[]'::jsonb)) item(value)
    where request.id = v_request_id;

    select
      coalesce(sum(case
        when lower(coalesce(batch.status::text, '')) not in ('draft', 'cancelled', 'returned')
          then coalesce(line.issued_qty, 0)
        else 0
      end), 0),
      coalesce(sum(case
        when lower(coalesce(batch.status::text, '')) = 'received'
          then coalesce(line.received_qty, 0)
        else 0
      end), 0)
    into v_total_active_issued, v_total_received
    from public.material_request_fulfillment_lines line
    join public.material_request_fulfillment_batches batch on batch.id = line.batch_id
    where line.material_request_id = v_request_id;

    v_total_closed := 0;
    if to_regclass('public.material_request_line_need_closures') is not null then
      select coalesce(sum(coalesce(closure.closed_qty, 0)), 0)
      into v_total_closed
      from public.material_request_line_need_closures closure
      where closure.material_request_id = v_request_id
        and lower(coalesce(closure.status::text, 'active')) = 'active';
    end if;

    v_open_need := greatest(0, v_total_committed - v_total_received - v_total_closed);
    v_next_status := case
      when v_total_committed > 0 and v_open_need <= 0 then 'COMPLETED'::public.request_status
      when v_total_active_issued > 0 or v_total_received > 0 then 'IN_TRANSIT'::public.request_status
      else 'APPROVED'::public.request_status
    end;
    v_next_step := case
      when v_next_status = 'COMPLETED'::public.request_status then 'completed'
      when v_next_status = 'IN_TRANSIT'::public.request_status then 'site_quality_check'
      else 'batch_planning'
    end;

    update public.requests
    set status = v_next_status,
        workflow_step = v_next_step,
        workflow_step_started_at = now(),
        submission_note = concat_ws(
          ' | ',
          nullif(submission_note, ''),
          'Đồng bộ lại sau khi phiếu nhập PO bị từ chối trước nhập kho.'
        )
    where id = v_request_id
      and status not in (
        'DRAFT'::public.request_status,
        'PENDING'::public.request_status,
        'REJECTED'::public.request_status
      )
      and (
        status is distinct from v_next_status
        or workflow_step is distinct from v_next_step
      );
  end loop;
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
  v_request_ids text[] := array[]::text[];
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
    and lower(coalesce(batch.status::text, '')) in ('issued', 'variance_pending', 'returned')
    and not exists (
      select 1
      from public.material_request_fulfillment_lines line
      where line.batch_id = batch.id
        and coalesce(line.received_qty, 0) > 0
    );

  if coalesce(array_length(v_batch_ids, 1), 0) = 0 then
    return jsonb_build_object('synced', false, 'reason', 'no_receipt_batches_to_cancel');
  end if;

  update public.material_request_fulfillment_batches batch
  set status = 'cancelled',
      cancel_reason = coalesce(nullif(batch.cancel_reason, ''), v_reason),
      reason = coalesce(nullif(batch.reason, ''), v_reason)
  where batch.id = any(v_batch_ids);

  select coalesce(array_agg(distinct batch.po_delivery_batch_id) filter (where batch.po_delivery_batch_id is not null), array[]::uuid[]),
         coalesce(array_agg(distinct batch.po_delivery_group_id) filter (where batch.po_delivery_group_id is not null), array[]::uuid[])
    into v_delivery_batch_ids, v_delivery_group_ids
  from public.material_request_fulfillment_batches batch
  where batch.id = any(v_batch_ids);

  select coalesce(array_agg(distinct line.material_request_id) filter (where line.material_request_id is not null), array[]::text[])
    into v_request_ids
  from public.material_request_fulfillment_lines line
  where line.batch_id = any(v_batch_ids);

  foreach v_id in array v_delivery_batch_ids loop
    perform app_private.project_po_delivery_batch_refresh_status_v1(v_id);
  end loop;

  foreach v_id in array v_delivery_group_ids loop
    perform app_private.project_po_delivery_group_refresh_status_v1(v_id);
  end loop;

  perform app_private.project_po_refresh_request_status_v1(v_request_ids);

  return jsonb_build_object(
    'synced', true,
    'transactionId', v_tx.id,
    'cancelledBatchCount', coalesce(array_length(v_batch_ids, 1), 0),
    'returnedBatchCount', 0
  );
end;
$$;

do $$
declare
  v_delivery_batch_ids uuid[] := array[]::uuid[];
  v_delivery_group_ids uuid[] := array[]::uuid[];
  v_request_ids text[] := array[]::text[];
  v_id uuid;
begin
  if to_regclass('public.material_request_fulfillment_batches') is null
     or to_regclass('public.material_request_fulfillment_lines') is null then
    return;
  end if;

  with repair_candidates as (
    select distinct batch.id
    from public.material_request_fulfillment_batches batch
    join public.transactions tx on tx.id::text = batch.transaction_id::text
    where tx.status = 'CANCELLED'::public.transaction_status
      and lower(coalesce(batch.source_type::text, '')) = 'po_receipt'
      and lower(coalesce(batch.status::text, '')) = 'returned'
      and not exists (
        select 1
        from public.material_request_fulfillment_lines line
        where line.batch_id = batch.id
          and coalesce(line.received_qty, 0) > 0
      )
      and (
        to_regclass('public.inventory_ledger_entries') is null
        or not exists (
          select 1
          from public.inventory_ledger_entries entry
          where entry.source_type = 'wms_transaction'
            and entry.source_id = tx.id::text
        )
      )
  ),
  updated as (
    update public.material_request_fulfillment_batches batch
    set status = 'cancelled',
        cancel_reason = coalesce(nullif(batch.cancel_reason, ''), 'Phiếu kho nhập PO đã bị từ chối trước khi nhập kho.'),
        reason = coalesce(nullif(batch.reason, ''), 'Phiếu kho nhập PO đã bị từ chối trước khi nhập kho.')
    where batch.id in (select id from repair_candidates)
    returning batch.id, batch.po_delivery_batch_id, batch.po_delivery_group_id
  )
  select coalesce(array_agg(distinct po_delivery_batch_id) filter (where po_delivery_batch_id is not null), array[]::uuid[]),
         coalesce(array_agg(distinct po_delivery_group_id) filter (where po_delivery_group_id is not null), array[]::uuid[])
  into v_delivery_batch_ids, v_delivery_group_ids
  from updated;

  select coalesce(array_agg(distinct line.material_request_id) filter (where line.material_request_id is not null), array[]::text[])
  into v_request_ids
  from public.material_request_fulfillment_lines line
  join public.material_request_fulfillment_batches batch on batch.id = line.batch_id
  join public.transactions tx on tx.id::text = batch.transaction_id::text
  where tx.status = 'CANCELLED'::public.transaction_status
    and lower(coalesce(batch.source_type::text, '')) = 'po_receipt'
    and lower(coalesce(batch.status::text, '')) = 'cancelled'
    and not exists (
      select 1
      from public.material_request_fulfillment_lines received_line
      where received_line.batch_id = batch.id
        and coalesce(received_line.received_qty, 0) > 0
    );

  foreach v_id in array v_delivery_batch_ids loop
    perform app_private.project_po_delivery_batch_refresh_status_v1(v_id);
  end loop;

  foreach v_id in array v_delivery_group_ids loop
    perform app_private.project_po_delivery_group_refresh_status_v1(v_id);
  end loop;

  perform app_private.project_po_refresh_request_status_v1(v_request_ids);
end;
$$;

revoke all on function app_private.project_po_refresh_request_status_v1(text[]) from public, anon, authenticated;
revoke all on function app_private.project_po_sync_cancelled_receipt_transaction_v1(text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
