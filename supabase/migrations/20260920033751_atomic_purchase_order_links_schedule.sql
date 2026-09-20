alter table public.purchase_orders
  add column row_version bigint not null default 1;

alter table public.purchase_order_request_lines
  add column updated_at timestamptz not null default now();

create or replace function app_private.bump_purchase_order_row_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.row_version := old.row_version + 1;
  return new;
end;
$$;

create trigger trg_purchase_orders_row_version
before update on public.purchase_orders
for each row execute function app_private.bump_purchase_order_row_version();

create or replace function app_private.set_purchase_order_request_line_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger trg_purchase_order_request_lines_updated_at
before update on public.purchase_order_request_lines
for each row execute function app_private.set_purchase_order_request_line_updated_at();

create or replace function app_private.set_po_delivery_batch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create table app_private.purchase_order_aggregate_commands (
  actor_user_id uuid not null references public.users(id) on delete restrict,
  idempotency_key uuid not null,
  purchase_order_id text not null,
  payload_hash text not null,
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (actor_user_id, idempotency_key),
  constraint purchase_order_aggregate_commands_payload_hash_check
    check (char_length(payload_hash) = 32),
  constraint purchase_order_aggregate_commands_result_check
    check ((result is null and completed_at is null) or (result is not null and completed_at is not null))
);

alter table app_private.purchase_order_aggregate_commands enable row level security;
revoke all on table app_private.purchase_order_aggregate_commands from public, anon, authenticated;
grant select, insert, update on table app_private.purchase_order_aggregate_commands to service_role;

create policy purchase_order_aggregate_commands_authenticated_deny
on app_private.purchase_order_aggregate_commands
for all
to authenticated
using (false)
with check (false);

create or replace function app_private.write_purchase_order_draft_batch_v1(
  p_po public.purchase_orders,
  p_batch jsonb,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch_id uuid;
  v_delivery_no integer;
  v_status text;
  v_approval_status text;
  v_lines jsonb;
  v_line jsonb;
  v_line_id uuid;
  v_line_key text;
  v_item_id text;
  v_stock_qty numeric;
  v_purchase_qty numeric;
  v_price numeric;
  v_line_count integer := 0;
begin
  begin
    v_batch_id := nullif(p_batch ->> 'id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'PO_DELIVERY_BATCH_ID_INVALID' using errcode = '22023';
  end;
  if v_batch_id is null then
    v_batch_id := gen_random_uuid();
  end if;
  v_delivery_no := coalesce(nullif(p_batch ->> 'delivery_no', '')::integer, 0);
  v_status := coalesce(nullif(p_batch ->> 'status', ''), 'planned');
  v_approval_status := coalesce(nullif(p_batch ->> 'approval_status', ''), 'draft');
  v_lines := coalesce(p_batch -> 'lines', '[]'::jsonb);

  if v_delivery_no <= 0
     or v_status not in ('planned', 'supplemental_pending', 'cancelled')
     or v_approval_status not in ('draft', 'revision_requested', 'rejected')
     or jsonb_typeof(v_lines) <> 'array'
     or jsonb_array_length(v_lines) = 0 then
    raise exception 'PO_DELIVERY_DRAFT_INVALID' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.purchase_order_delivery_batches batch
    where batch.id = v_batch_id
      and batch.purchase_order_id <> p_po.id
  ) then
    raise exception 'PO_DELIVERY_BATCH_SCOPE_CHANGED' using errcode = '42501';
  end if;

  insert into public.purchase_order_delivery_batches (
    id, purchase_order_id, project_id, construction_site_id,
    supplier_id, supplier_name_snapshot, delivery_no,
    planned_delivery_date, status, approval_status,
    fulfillment_mode, vat_rate, variance_reason, note, created_by
  ) values (
    v_batch_id, p_po.id, p_po.project_id, p_po.construction_site_id,
    p_po.vendor_id, p_po.vendor_name, v_delivery_no,
    nullif(p_batch ->> 'planned_delivery_date', '')::date,
    v_status, v_approval_status,
    coalesce(nullif(p_batch ->> 'fulfillment_mode', ''), p_po.fulfillment_mode),
    coalesce(nullif(p_batch ->> 'vat_rate', '')::numeric, 0),
    nullif(btrim(coalesce(p_batch ->> 'variance_reason', '')), ''),
    nullif(btrim(coalesce(p_batch ->> 'note', '')), ''),
    p_actor_user_id
  )
  on conflict (id) do update
  set project_id = excluded.project_id,
      construction_site_id = excluded.construction_site_id,
      supplier_id = excluded.supplier_id,
      supplier_name_snapshot = excluded.supplier_name_snapshot,
      delivery_no = excluded.delivery_no,
      planned_delivery_date = excluded.planned_delivery_date,
      status = excluded.status,
      approval_status = excluded.approval_status,
      approval_decided_by = null,
      approval_decided_at = null,
      approval_decision_note = null,
      fulfillment_mode = excluded.fulfillment_mode,
      vat_rate = excluded.vat_rate,
      variance_reason = excluded.variance_reason,
      note = excluded.note,
      updated_at = now();

  delete from public.purchase_order_delivery_lines
  where delivery_batch_id = v_batch_id;

  for v_line in select value from jsonb_array_elements(v_lines) line(value)
  loop
    v_line_key := nullif(coalesce(
      v_line ->> 'purchase_order_line_id', v_line ->> 'purchaseOrderLineId'
    ), '');
    v_item_id := nullif(coalesce(v_line ->> 'item_id', v_line ->> 'itemId'), '');
    v_stock_qty := coalesce(nullif(coalesce(
      v_line ->> 'stock_planned_qty', v_line ->> 'stockQty', v_line ->> 'requestQty'
    ), '')::numeric, 0);
    v_purchase_qty := coalesce(nullif(coalesce(
      v_line ->> 'planned_qty', v_line ->> 'purchaseQty'
    ), '')::numeric, 0);
    v_price := coalesce(nullif(coalesce(
      v_line ->> 'delivery_unit_price', v_line ->> 'purchaseUnitPrice'
    ), '')::numeric, 0);

    if v_line_key is null
       or v_item_id is null
       or v_stock_qty <= 0
       or v_purchase_qty <= 0
       or v_price < 0 then
      raise exception 'PO_DELIVERY_LINE_INVALID' using errcode = '22023';
    end if;
    if not exists (
      select 1
      from jsonb_array_elements(coalesce(p_po.items, '[]'::jsonb)) item(value)
      where coalesce(item.value ->> 'lineId', item.value ->> 'line_id', item.value ->> 'itemId') = v_line_key
        and coalesce(item.value ->> 'itemId', item.value ->> 'item_id') = v_item_id
    ) then
      raise exception 'PO_DELIVERY_LINE_SCOPE_CHANGED' using errcode = '42501';
    end if;

    begin
      v_line_id := coalesce(nullif(v_line ->> 'id', '')::uuid, gen_random_uuid());
    exception when invalid_text_representation then
      raise exception 'PO_DELIVERY_LINE_ID_INVALID' using errcode = '22023';
    end;

    insert into public.purchase_order_delivery_lines (
      id, delivery_batch_id, purchase_order_id, purchase_order_line_id,
      item_id, planned_qty, unit, stock_planned_qty, stock_unit,
      delivery_unit_price
    ) values (
      v_line_id, v_batch_id, p_po.id, v_line_key,
      v_item_id, v_purchase_qty,
      nullif(coalesce(v_line ->> 'unit', v_line ->> 'purchaseUnit'), ''),
      v_stock_qty,
      nullif(coalesce(v_line ->> 'stock_unit', v_line ->> 'stockUnit', v_line ->> 'requestUnit'), ''),
      v_price
    );
    v_line_count := v_line_count + 1;
  end loop;

  return jsonb_build_object(
    'deliveryBatchId', v_batch_id,
    'deliveryNo', v_delivery_no,
    'approvalStatus', v_approval_status,
    'lineCount', v_line_count
  );
end;
$$;

revoke all on function app_private.write_purchase_order_draft_batch_v1(
  public.purchase_orders, jsonb, uuid
) from public, anon, authenticated;
grant execute on function app_private.write_purchase_order_draft_batch_v1(
  public.purchase_orders, jsonb, uuid
) to service_role;

create or replace function app_private.save_material_po_batch_draft(
  p_purchase_order_id text,
  p_delivery_batch_id uuid,
  p_planned_delivery_date date,
  p_vat_rate numeric,
  p_variance_reason text,
  p_note text,
  p_lines jsonb,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders%rowtype;
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_batch_id uuid;
  v_delivery_no integer;
begin
  if p_actor_user_id is null
     or public.current_app_user_id() is null
     or p_actor_user_id <> public.current_app_user_id() then
    raise exception 'Người thực hiện lệnh không hợp lệ.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'Đợt giao phải có ít nhất một dòng vật tư.' using errcode = '22023';
  end if;
  if coalesce(p_vat_rate, 0) < 0 or coalesce(p_vat_rate, 0) > 100 then
    raise exception 'Thuế VAT phải trong khoảng 0 đến 100.' using errcode = '22023';
  end if;

  select * into v_po
  from public.purchase_orders po
  where po.id = p_purchase_order_id
  for update;
  if not found then
    raise exception 'Không tìm thấy PO.' using errcode = '22023';
  end if;
  if v_po.source_mode <> 'from_request' or v_po.purchase_mode <> 'multiple' then
    raise exception 'Chỉ lập đợt riêng cho PO vật tư giao nhiều lần.' using errcode = '22023';
  end if;
  if v_po.status in ('cancelled', 'closed', 'delivered') then
    raise exception 'PO đã kết thúc nên không thể lập thêm đợt giao.' using errcode = '22023';
  end if;
  perform app_private.assert_project_permission_room_action(
    v_po.project_id,
    v_po.construction_site_id,
    'material_po',
    'edit',
    p_actor_user_id
  );

  if p_delivery_batch_id is null then
    v_batch_id := gen_random_uuid();
    select coalesce(max(batch.delivery_no), 0) + 1
    into v_delivery_no
    from public.purchase_order_delivery_batches batch
    where batch.purchase_order_id = v_po.id;
  else
    select * into v_batch
    from public.purchase_order_delivery_batches batch
    where batch.id = p_delivery_batch_id
      and batch.purchase_order_id = v_po.id
    for update;
    if not found then
      raise exception 'Không tìm thấy đợt giao cần sửa.' using errcode = '22023';
    end if;
    if coalesce(v_batch.approval_status, 'draft') not in ('draft', 'revision_requested', 'rejected')
       or v_batch.wms_transaction_id is not null
       or v_batch.status <> 'planned' then
      raise exception 'Đợt đã gửi duyệt hoặc đã tạo WMS nên không thể sửa.' using errcode = '22023';
    end if;
    v_batch_id := v_batch.id;
    v_delivery_no := v_batch.delivery_no;
  end if;

  return app_private.write_purchase_order_draft_batch_v1(
    v_po,
    jsonb_build_object(
      'id', v_batch_id,
      'delivery_no', v_delivery_no,
      'planned_delivery_date', p_planned_delivery_date,
      'status', 'planned',
      'approval_status', 'draft',
      'fulfillment_mode', v_po.fulfillment_mode,
      'vat_rate', coalesce(p_vat_rate, 0),
      'variance_reason', p_variance_reason,
      'note', p_note,
      'lines', coalesce(p_lines, '[]'::jsonb)
    ),
    p_actor_user_id
  );
end;
$$;

create or replace function app_private.save_purchase_order_aggregate_v1(
  p_purchase_order jsonb,
  p_request_line_links jsonb,
  p_delivery_batches jsonb,
  p_expected_row_version bigint,
  p_expected_request_line_links jsonb,
  p_expected_delivery_batches jsonb,
  p_actor_user_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po_id text := nullif(btrim(coalesce(p_purchase_order ->> 'id', '')), '');
  v_existing_po public.purchase_orders%rowtype;
  v_saved_po public.purchase_orders%rowtype;
  v_prior app_private.purchase_order_aggregate_commands%rowtype;
  v_payload_hash text;
  v_link jsonb;
  v_batch jsonb;
  v_request public.requests%rowtype;
  v_result jsonb;
  v_link_count integer := 0;
  v_batch_count integer := 0;
begin
  if p_actor_user_id is null
     or public.current_app_user_id() is null
     or p_actor_user_id <> public.current_app_user_id() then
    raise exception 'PURCHASE_ORDER_ACTOR_INVALID' using errcode = '42501';
  end if;
  if v_po_id is null or p_idempotency_key is null then
    raise exception 'PURCHASE_ORDER_COMMAND_ID_INVALID' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_request_line_links, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_delivery_batches, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_expected_request_line_links, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_expected_delivery_batches, '[]'::jsonb)) <> 'array' then
    raise exception 'PURCHASE_ORDER_COMMAND_PAYLOAD_INVALID' using errcode = '22023';
  end if;

  v_payload_hash := md5(jsonb_build_object(
    'purchaseOrder', p_purchase_order,
    'requestLineLinks', coalesce(p_request_line_links, '[]'::jsonb),
    'deliveryBatches', coalesce(p_delivery_batches, '[]'::jsonb),
    'expectedRowVersion', p_expected_row_version,
    'expectedRequestLineLinks', coalesce(p_expected_request_line_links, '[]'::jsonb),
    'expectedDeliveryBatches', coalesce(p_expected_delivery_batches, '[]'::jsonb)
  )::text);

  perform pg_advisory_xact_lock(hashtextextended('purchase-order-aggregate:' || v_po_id, 0));

  insert into app_private.purchase_order_aggregate_commands (
    actor_user_id, idempotency_key, purchase_order_id, payload_hash
  ) values (
    p_actor_user_id, p_idempotency_key, v_po_id, v_payload_hash
  ) on conflict do nothing;

  select * into strict v_prior
  from app_private.purchase_order_aggregate_commands command
  where command.actor_user_id = p_actor_user_id
    and command.idempotency_key = p_idempotency_key
  for update;

  if v_prior.payload_hash <> v_payload_hash or v_prior.purchase_order_id <> v_po_id then
    raise exception 'PURCHASE_ORDER_IDEMPOTENCY_CONFLICT' using errcode = '22023';
  end if;
  if v_prior.result is not null then
    return v_prior.result || jsonb_build_object('replayed', true);
  end if;

  select * into v_existing_po
  from public.purchase_orders po
  where po.id = v_po_id
  for update;

  if p_expected_row_version is null then
    if found then
      raise exception 'PURCHASE_ORDER_ALREADY_EXISTS' using errcode = '40001';
    end if;
    if coalesce(p_purchase_order ->> 'status', 'draft') <> 'draft'
       or nullif(p_purchase_order ->> 'created_by_id', '') <> p_actor_user_id::text then
      raise exception 'PURCHASE_ORDER_CREATE_STATE_INVALID' using errcode = '42501';
    end if;
    if coalesce(p_purchase_order ->> 'source_mode', 'proactive_project') = 'company_consolidated'
       and not app_private.company_procurement_can_manage() then
      raise exception 'PURCHASE_ORDER_COMPANY_SCOPE_DENIED' using errcode = '42501';
    end if;

    insert into public.purchase_orders (
      id, project_id, construction_site_id, vendor_id, vendor_name,
      po_number, items, total_amount, approved_total_amount,
      supplemental_approval_status, vat_rate, order_date,
      expected_delivery_date, status, source_mode, purchase_mode,
      reference_gross_amount, closed_need_qty, fulfillment_mode,
      approval_request_title, procurement_group_id, procurement_group_no,
      qr_token, target_warehouse_id, material_request_id, delivery_note,
      note, created_by_id, created_at
    ) values (
      v_po_id,
      nullif(p_purchase_order ->> 'project_id', ''),
      nullif(p_purchase_order ->> 'construction_site_id', ''),
      nullif(p_purchase_order ->> 'vendor_id', ''),
      nullif(p_purchase_order ->> 'vendor_name', ''),
      nullif(p_purchase_order ->> 'po_number', ''),
      coalesce(p_purchase_order -> 'items', '[]'::jsonb),
      coalesce(nullif(p_purchase_order ->> 'total_amount', '')::numeric, 0),
      coalesce(nullif(p_purchase_order ->> 'approved_total_amount', '')::numeric, 0),
      coalesce(nullif(p_purchase_order ->> 'supplemental_approval_status', ''), 'none'),
      coalesce(nullif(p_purchase_order ->> 'vat_rate', '')::numeric, 0),
      nullif(p_purchase_order ->> 'order_date', ''),
      nullif(p_purchase_order ->> 'expected_delivery_date', ''),
      'draft',
      coalesce(nullif(p_purchase_order ->> 'source_mode', ''), 'proactive_project'),
      coalesce(nullif(p_purchase_order ->> 'purchase_mode', ''), 'single'),
      nullif(p_purchase_order ->> 'reference_gross_amount', '')::numeric,
      coalesce(nullif(p_purchase_order ->> 'closed_need_qty', '')::numeric, 0),
      coalesce(nullif(p_purchase_order ->> 'fulfillment_mode', ''), 'RECEIVE_TO_STOCK'),
      nullif(p_purchase_order ->> 'approval_request_title', ''),
      nullif(p_purchase_order ->> 'procurement_group_id', ''),
      nullif(p_purchase_order ->> 'procurement_group_no', ''),
      nullif(p_purchase_order ->> 'qr_token', ''),
      nullif(p_purchase_order ->> 'target_warehouse_id', ''),
      nullif(p_purchase_order ->> 'material_request_id', ''),
      nullif(p_purchase_order ->> 'delivery_note', ''),
      nullif(p_purchase_order ->> 'note', ''),
      p_actor_user_id::text,
      coalesce(nullif(p_purchase_order ->> 'created_at', '')::timestamptz, now())
    ) returning * into v_saved_po;
  else
    if not found or v_existing_po.row_version <> p_expected_row_version then
      raise exception 'PURCHASE_ORDER_VERSION_CONFLICT' using errcode = '40001';
    end if;
    if v_existing_po.status <> coalesce(p_purchase_order ->> 'status', v_existing_po.status)
       or v_existing_po.source_mode <> coalesce(p_purchase_order ->> 'source_mode', v_existing_po.source_mode)
       or v_existing_po.project_id is distinct from nullif(p_purchase_order ->> 'project_id', '')
       or v_existing_po.construction_site_id is distinct from nullif(p_purchase_order ->> 'construction_site_id', '')
       or nullif(v_existing_po.created_by_id, '') is distinct from nullif(p_purchase_order ->> 'created_by_id', '') then
      raise exception 'PURCHASE_ORDER_SCOPE_OR_STATE_CHANGED' using errcode = '40001';
    end if;
    if v_existing_po.source_mode = 'company_consolidated'
       and not app_private.company_procurement_can_manage() then
      raise exception 'PURCHASE_ORDER_COMPANY_SCOPE_DENIED' using errcode = '42501';
    end if;

    update public.purchase_orders
    set vendor_id = nullif(p_purchase_order ->> 'vendor_id', ''),
        vendor_name = nullif(p_purchase_order ->> 'vendor_name', ''),
        po_number = nullif(p_purchase_order ->> 'po_number', ''),
        items = coalesce(p_purchase_order -> 'items', '[]'::jsonb),
        total_amount = coalesce(nullif(p_purchase_order ->> 'total_amount', '')::numeric, 0),
        approved_total_amount = coalesce(nullif(p_purchase_order ->> 'approved_total_amount', '')::numeric, 0),
        supplemental_approval_status = coalesce(nullif(p_purchase_order ->> 'supplemental_approval_status', ''), 'none'),
        vat_rate = coalesce(nullif(p_purchase_order ->> 'vat_rate', '')::numeric, 0),
        order_date = nullif(p_purchase_order ->> 'order_date', ''),
        expected_delivery_date = nullif(p_purchase_order ->> 'expected_delivery_date', ''),
        purchase_mode = coalesce(nullif(p_purchase_order ->> 'purchase_mode', ''), 'single'),
        reference_gross_amount = nullif(p_purchase_order ->> 'reference_gross_amount', '')::numeric,
        closed_need_qty = coalesce(nullif(p_purchase_order ->> 'closed_need_qty', '')::numeric, 0),
        fulfillment_mode = coalesce(nullif(p_purchase_order ->> 'fulfillment_mode', ''), 'RECEIVE_TO_STOCK'),
        approval_request_title = nullif(p_purchase_order ->> 'approval_request_title', ''),
        procurement_group_id = nullif(p_purchase_order ->> 'procurement_group_id', ''),
        procurement_group_no = nullif(p_purchase_order ->> 'procurement_group_no', ''),
        qr_token = nullif(p_purchase_order ->> 'qr_token', ''),
        target_warehouse_id = nullif(p_purchase_order ->> 'target_warehouse_id', ''),
        material_request_id = nullif(p_purchase_order ->> 'material_request_id', ''),
        delivery_note = nullif(p_purchase_order ->> 'delivery_note', ''),
        note = nullif(p_purchase_order ->> 'note', '')
    where id = v_po_id
    returning * into v_saved_po;
  end if;

  perform 1
  from public.purchase_order_request_lines link
  where link.purchase_order_id = v_po_id
  order by link.id
  for update;

  perform 1
  from public.purchase_order_delivery_batches batch
  where batch.purchase_order_id = v_po_id
  order by batch.id
  for update;

  perform 1
  from public.purchase_order_delivery_lines line
  where line.purchase_order_id = v_po_id
  order by line.id
  for update;

  if (select count(*) from public.purchase_order_request_lines link where link.purchase_order_id = v_po_id)
      <> jsonb_array_length(coalesce(p_expected_request_line_links, '[]'::jsonb))
     or exists (
       select 1
       from public.purchase_order_request_lines link
       where link.purchase_order_id = v_po_id
         and not exists (
           select 1
           from jsonb_array_elements(coalesce(p_expected_request_line_links, '[]'::jsonb)) expected(value)
           where expected.value ->> 'id' = link.id::text
             and nullif(expected.value ->> 'updatedAt', '')::timestamptz = link.updated_at
         )
     ) then
    raise exception 'PURCHASE_ORDER_LINK_VERSION_CONFLICT' using errcode = '40001';
  end if;

  if (select count(*) from public.purchase_order_delivery_batches batch where batch.purchase_order_id = v_po_id)
      <> jsonb_array_length(coalesce(p_expected_delivery_batches, '[]'::jsonb))
     or exists (
       select 1
       from public.purchase_order_delivery_batches batch
       where batch.purchase_order_id = v_po_id
         and not exists (
           select 1
           from jsonb_array_elements(coalesce(p_expected_delivery_batches, '[]'::jsonb)) expected(value)
           where expected.value ->> 'id' = batch.id::text
             and nullif(expected.value ->> 'updatedAt', '')::timestamptz = batch.updated_at
         )
     ) then
    raise exception 'PURCHASE_ORDER_SCHEDULE_VERSION_CONFLICT' using errcode = '40001';
  end if;

  if exists (
    select 1
    from public.purchase_order_delivery_batches batch
    where batch.purchase_order_id = v_po_id
      and (
        batch.status not in ('planned', 'supplemental_pending', 'cancelled')
        or batch.approval_status not in ('draft', 'revision_requested', 'rejected')
        or batch.idempotency_key is not null
        or batch.qr_token is not null
        or batch.wms_transaction_id is not null
        or exists (
          select 1
          from public.purchase_order_delivery_lines line
          where line.delivery_batch_id = batch.id
            and (line.delivered_qty <> 0 or line.accepted_qty <> 0
              or line.delivered_stock_qty <> 0 or line.accepted_stock_qty <> 0
              or line.returned_qty <> 0)
        )
      )
  ) then
    raise exception 'PURCHASE_ORDER_POSTED_SCHEDULE_IMMUTABLE' using errcode = '22023';
  end if;

  for v_link in select value from jsonb_array_elements(coalesce(p_request_line_links, '[]'::jsonb)) item(value)
  loop
    if coalesce(v_link ->> 'purchase_order_id', v_po_id) <> v_po_id
       or coalesce(nullif(v_link ->> 'requested_qty', '')::numeric, 0) < 0
       or coalesce(nullif(v_link ->> 'ordered_qty', '')::numeric, 0) < 0 then
      raise exception 'PURCHASE_ORDER_LINK_INVALID' using errcode = '22023';
    end if;
    select * into v_request
    from public.requests request
    where request.id = nullif(v_link ->> 'material_request_id', '')
    for share;
    if not found
       or v_request.project_id is distinct from nullif(v_link ->> 'project_id', '')
       or v_request.construction_site_id is distinct from nullif(v_link ->> 'construction_site_id', '')
       or not exists (
         select 1
         from jsonb_array_elements(coalesce(v_request.items, '[]'::jsonb)) request_item(value)
         where coalesce(request_item.value ->> 'lineId', request_item.value ->> 'requestLineId', request_item.value ->> 'itemId')
             = nullif(v_link ->> 'request_line_id', '')
           and coalesce(request_item.value ->> 'itemId', request_item.value ->> 'item_id')
             = nullif(v_link ->> 'item_id', '')
       )
       or not exists (
         select 1
         from jsonb_array_elements(coalesce(v_saved_po.items, '[]'::jsonb)) po_item(value)
         where coalesce(po_item.value ->> 'lineId', po_item.value ->> 'line_id', po_item.value ->> 'itemId')
             = nullif(v_link ->> 'purchase_order_line_id', '')
           and coalesce(po_item.value ->> 'itemId', po_item.value ->> 'item_id')
             = nullif(v_link ->> 'item_id', '')
       ) then
      raise exception 'PURCHASE_ORDER_LINK_SCOPE_CHANGED' using errcode = '42501';
    end if;
  end loop;

  delete from public.purchase_order_request_lines
  where purchase_order_id = v_po_id;

  for v_link in select value from jsonb_array_elements(coalesce(p_request_line_links, '[]'::jsonb)) item(value)
  loop
    insert into public.purchase_order_request_lines (
      project_id, construction_site_id, source_construction_site_id,
      target_warehouse_id, allocation_status, purchase_order_id,
      purchase_order_line_id, material_request_id, material_request_code,
      request_line_id, item_id, work_boq_item_id, material_budget_item_id,
      requested_qty, ordered_qty, requested_qty_snapshot,
      ordered_stock_qty_snapshot, actual_received_qty_snapshot, unit, note
    ) values (
      nullif(v_link ->> 'project_id', ''),
      nullif(v_link ->> 'construction_site_id', ''),
      nullif(v_link ->> 'source_construction_site_id', ''),
      nullif(v_link ->> 'target_warehouse_id', ''),
      coalesce(nullif(v_link ->> 'allocation_status', ''), 'open'),
      v_po_id,
      nullif(v_link ->> 'purchase_order_line_id', ''),
      nullif(v_link ->> 'material_request_id', ''),
      nullif(v_link ->> 'material_request_code', ''),
      nullif(v_link ->> 'request_line_id', ''),
      nullif(v_link ->> 'item_id', ''),
      nullif(v_link ->> 'work_boq_item_id', ''),
      nullif(v_link ->> 'material_budget_item_id', ''),
      coalesce(nullif(v_link ->> 'requested_qty', '')::numeric, 0),
      coalesce(nullif(v_link ->> 'ordered_qty', '')::numeric, 0),
      coalesce(nullif(v_link ->> 'requested_qty_snapshot', '')::numeric, 0),
      coalesce(nullif(v_link ->> 'ordered_stock_qty_snapshot', '')::numeric, 0),
      coalesce(nullif(v_link ->> 'actual_received_qty_snapshot', '')::numeric, 0),
      nullif(v_link ->> 'unit', ''),
      nullif(v_link ->> 'note', '')
    );
    v_link_count := v_link_count + 1;
  end loop;

  delete from public.purchase_order_delivery_batches
  where purchase_order_id = v_po_id;

  for v_batch in select value from jsonb_array_elements(coalesce(p_delivery_batches, '[]'::jsonb)) item(value)
  loop
    if coalesce(v_batch ->> 'purchase_order_id', v_po_id) <> v_po_id
       or nullif(v_batch ->> 'project_id', '') is distinct from v_saved_po.project_id
       or nullif(v_batch ->> 'construction_site_id', '') is distinct from v_saved_po.construction_site_id then
      raise exception 'PURCHASE_ORDER_SCHEDULE_SCOPE_CHANGED' using errcode = '42501';
    end if;
    perform app_private.write_purchase_order_draft_batch_v1(v_saved_po, v_batch, p_actor_user_id);
    v_batch_count := v_batch_count + 1;
  end loop;

  v_result := jsonb_build_object(
    'purchaseOrderId', v_po_id,
    'rowVersion', v_saved_po.row_version,
    'requestLineCount', v_link_count,
    'deliveryBatchCount', v_batch_count,
    'replayed', false
  );

  update app_private.purchase_order_aggregate_commands
  set result = v_result,
      completed_at = now()
  where actor_user_id = p_actor_user_id
    and idempotency_key = p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function app_private.save_purchase_order_aggregate_v1(
  jsonb, jsonb, jsonb, bigint, jsonb, jsonb, uuid, uuid
) from public, anon, authenticated;
grant execute on function app_private.save_purchase_order_aggregate_v1(
  jsonb, jsonb, jsonb, bigint, jsonb, jsonb, uuid, uuid
) to authenticated, service_role;

create or replace function public.save_purchase_order_aggregate_v1(
  p_purchase_order jsonb,
  p_request_line_links jsonb default '[]'::jsonb,
  p_delivery_batches jsonb default '[]'::jsonb,
  p_expected_row_version bigint default null,
  p_expected_request_line_links jsonb default '[]'::jsonb,
  p_expected_delivery_batches jsonb default '[]'::jsonb,
  p_actor_user_id uuid default null,
  p_idempotency_key uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(p_actor_user_id, public.current_app_user_id());
begin
  if public.current_app_user_id() is null or v_actor <> public.current_app_user_id() then
    raise exception 'PURCHASE_ORDER_ACTOR_INVALID' using errcode = '42501';
  end if;
  return app_private.save_purchase_order_aggregate_v1(
    p_purchase_order,
    p_request_line_links,
    p_delivery_batches,
    p_expected_row_version,
    p_expected_request_line_links,
    p_expected_delivery_batches,
    v_actor,
    p_idempotency_key
  );
end;
$$;

revoke all on function public.save_purchase_order_aggregate_v1(
  jsonb, jsonb, jsonb, bigint, jsonb, jsonb, uuid, uuid
) from public, anon;
grant execute on function public.save_purchase_order_aggregate_v1(
  jsonb, jsonb, jsonb, bigint, jsonb, jsonb, uuid, uuid
) to authenticated, service_role;
