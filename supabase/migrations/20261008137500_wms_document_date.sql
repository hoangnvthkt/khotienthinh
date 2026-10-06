-- Module Vật tư — Ngày chứng từ + lưu vết nhập–xuất thẳng. Chủ sản phẩm chốt 06/10/2026 (doc 13 mục 20):
--  1. Số phiếu mới theo NGÀY CHỨNG TỪ (NK20260908-…), không theo ngày bấm lưu. Phiếu cũ giữ nguyên số (mã định danh đã in / liên kết).
--  2. Sửa ngày chứng từ (kể cả phiếu đã ghi sổ): thủ kho kho đó, Kế toán kho, Admin; phiếu đã ghi sổ bắt buộc lý do, ghi nhật ký;
--     sổ kho dời theo ngày mới. Không cho ngày tương lai. Khóa kỳ (V3) sẽ chặn thêm các tháng đã khóa.
--  3. Không cho ghi / dời phiếu làm tồn âm trong quá khứ (chỉ chặn khi tạo thêm âm mới, dữ liệu cũ đang âm không bị khóa).
--  4. Nhập–xuất thẳng (DIRECT_CONSUMPTION): vẫn không lưu tồn, nhưng sổ kho ghi đủ "nhập mua" + "xuất dùng thẳng" cùng ngày, cùng giá
--     để có lịch sử vật tư (thẻ kho, báo cáo nhận theo BOQ). Chi phí dự án vẫn chỉ tính từ đơn mua / công nợ (không tính 2 lần).

-- Số phiếu theo ngày chứng từ (giờ Việt Nam).
create function app_private.next_inventory_ledger_code(p_direction text, p_date timestamptz)
returns text language plpgsql security definer set search_path = '' as $$
declare v_prefix text; v_seq regclass;
begin
  if lower(coalesce(p_direction, '')) = 'in' then v_prefix := 'NK'; v_seq := 'public.inventory_receipt_code_seq'::regclass;
  elsif lower(coalesce(p_direction, '')) = 'out' then v_prefix := 'XK'; v_seq := 'public.inventory_issue_code_seq'::regclass;
  else raise exception 'invalid inventory ledger direction: %', p_direction; end if;
  return v_prefix || to_char(coalesce(p_date, now()) at time zone 'Asia/Ho_Chi_Minh', 'YYYYMMDD') || '-' || lpad(nextval(v_seq)::text, 5, '0');
end $$;

-- Tồn thấp nhất theo thời gian (mọi phạm vi trong kho) từ ngày p_from trở đi. Dùng để chặn tạo tồn âm trong quá khứ.
create function app_private.wms_min_running_balance(p_material_id text, p_warehouse_id text, p_from timestamptz)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(min(x.bal) filter (where x.transaction_date >= p_from), 0) from (
    select e.transaction_date, sum(e.quantity_in - e.quantity_out) over (order by e.transaction_date, e.created_at, e.entry_no, e.id) bal
    from public.inventory_ledger_entries e where e.material_id = p_material_id and e.warehouse_id = p_warehouse_id) x;
$$;

create table public.wms_document_date_events (
  id uuid primary key default gen_random_uuid(),
  transaction_id text not null references public.transactions(id) on delete cascade,
  old_date timestamptz,
  new_date timestamptz not null,
  was_posted boolean not null,
  reason text,
  actor_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.wms_document_date_events enable row level security;
create policy wms_document_date_events_select on public.wms_document_date_events for select to authenticated
  using (app_private.wms_has_action('wms.transaction.view') or exists (select 1 from public.user_permission_grants g where g.user_id = public.current_app_user_id()
    and g.is_active and g.revoked_at is null and g.permission_code in ('wms.transaction.view', 'wms.transaction.keeper')));
revoke all on public.wms_document_date_events from anon;
grant select on public.wms_document_date_events to authenticated;

CREATE OR REPLACE FUNCTION app_private.sync_wms_transaction_to_inventory_ledger_pre_reversal_20260905(p_transaction_id text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tx public.transactions%rowtype;
  v_existing_id uuid;
  v_inventory_transaction_id uuid;
  v_has_in boolean := false;
  v_has_out boolean := false;
  v_in_code text;
  v_out_code text;
  v_header_code text;
  v_header_type text;
  v_line jsonb;
  v_entry_no integer := 0;
  v_tx_date timestamptz;
  v_item_id text;
  v_qty numeric;
  v_price numeric;
  v_source_line_id text;
  v_metadata jsonb;
  v_event_type text;
  v_entry_type text;
  v_warehouse_id text;
  v_scope record;
  v_payload_project_id text;
  v_payload_site_id text;
  v_header_project_id text;
  v_header_site_id text;
begin
  select * into v_tx
  from public.transactions
  where id = p_transaction_id
  for update;
  if not found then raise exception 'transaction not found: %', p_transaction_id; end if;
  if v_tx.status::text <> 'COMPLETED' then return null; end if;

  select id into v_existing_id
  from public.inventory_transactions
  where source_type = 'wms_transaction' and source_id = v_tx.id
  limit 1;
  if v_existing_id is not null then return v_existing_id; end if;

  v_event_type := coalesce(
    v_tx.business_event_type,
    app_private.classify_wms_business_event(
      v_tx.type::text, v_tx.source_type, v_tx.related_request_id, v_tx.items
    )
  );
  if v_event_type is null then
    raise exception 'Phiếu kho hoàn tất phải có mục đích nghiệp vụ.';
  end if;
  v_tx_date := coalesce(nullif(v_tx.date::text, '')::timestamptz, now());
  v_has_in := (
    v_tx.type::text in ('IMPORT', 'TRANSFER')
    and exists (
      select 1 from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) item(value)
      where coalesce(nullif(item.value->>'quantity', '')::numeric, 0) > 0
    )
  ) or exists (
    select 1 from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) item(value)
    where v_tx.type::text = 'ADJUSTMENT'
      and coalesce(nullif(item.value->>'quantity', '')::numeric, 0) > 0
  );
  v_has_out := (
    v_tx.type::text in ('EXPORT', 'TRANSFER', 'LIQUIDATION')
    and exists (
      select 1 from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) item(value)
      where coalesce(nullif(item.value->>'quantity', '')::numeric, 0) > 0
    )
  ) or exists (
    select 1 from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) item(value)
    where v_tx.type::text = 'ADJUSTMENT'
      and coalesce(nullif(item.value->>'quantity', '')::numeric, 0) < 0
  );
  if not v_has_in and not v_has_out then return null; end if;

  if v_has_in then v_in_code := app_private.next_inventory_ledger_code('in', v_tx_date); end if; -- số phiếu theo ngày chứng từ
  if v_has_out then v_out_code := app_private.next_inventory_ledger_code('out', v_tx_date); end if;
  v_header_code := coalesce(v_out_code, v_in_code);
  v_header_type := case
    when v_event_type = 'project_return_receipt' then 'project_return_receipt'
    when v_tx.type::text = 'TRANSFER' and v_has_out then 'transfer_issue'
    when v_tx.type::text = 'IMPORT' then 'purchase_receipt'
    when v_tx.type::text = 'EXPORT' then 'project_issue'
    when v_tx.type::text = 'LIQUIDATION' then 'loss_issue'
    when v_tx.type::text = 'ADJUSTMENT' and v_has_in then 'adjustment_in'
    else 'adjustment_out'
  end;

  v_metadata := jsonb_build_object(
    'wmsTransactionId', v_tx.id,
    'wmsType', v_tx.type::text,
    'wmsStatus', v_tx.status::text,
    'businessEventType', v_event_type,
    'businessEventReason', v_tx.business_event_reason,
    'sourceWarehouseId', v_tx.source_warehouse_id,
    'targetWarehouseId', v_tx.target_warehouse_id,
    'supplierId', v_tx.supplier_id,
    'items', coalesce(v_tx.items, '[]'::jsonb)
  );

  insert into public.inventory_transactions(
    code, transaction_type, status, transaction_date,
    source_type, source_id, source_code, related_request_id,
    project_id, construction_site_id, business_event_type,
    description, metadata, created_by, approved_by, posted_at
  ) values (
    v_header_code, v_header_type, 'posted', v_tx_date,
    'wms_transaction', v_tx.id, v_tx.id, v_tx.related_request_id,
    null, null, v_event_type,
    v_tx.note, v_metadata, v_tx.requester_id, v_tx.approver_id, now()
  ) returning id into v_inventory_transaction_id;

  for v_line in select value from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb))
  loop
    v_item_id := v_line->>'itemId';
    v_qty := coalesce(nullif(v_line->>'quantity', '')::numeric, 0);
    v_price := coalesce(nullif(v_line->>'price', '')::numeric, 0);
    v_source_line_id := nullif(coalesce(
      v_line->>'requestLineId', v_line->>'materialIssueLineId', v_line->>'lineId'
    ), '');
    if v_item_id is null then raise exception 'invalid transaction item payload'; end if;
    if v_qty = 0 then continue; end if;

    if v_tx.type::text = 'IMPORT' then
      if v_qty < 0 then raise exception 'invalid import quantity'; end if;
      v_warehouse_id := v_tx.target_warehouse_id;
      v_entry_type := case when v_event_type = 'project_return_receipt'
        then 'project_return_receipt' else 'purchase_receipt' end;
      select * into v_scope from app_private.resolve_warehouse_project_scope(v_warehouse_id);
      v_payload_project_id := nullif(coalesce(v_line->>'projectId', v_line->>'project_id'), '');
      v_payload_site_id := nullif(coalesce(v_line->>'constructionSiteId', v_line->>'construction_site_id'), '');
      if (v_payload_project_id is not null and v_payload_project_id is distinct from v_scope.project_id)
         or (v_payload_site_id is not null and v_payload_site_id is distinct from v_scope.construction_site_id) then
        raise exception 'Scope chứng từ không khớp scope kho.';
      end if;
      v_entry_no := v_entry_no + 1;
      perform app_private.post_inventory_ledger_entry(
        v_inventory_transaction_id, v_entry_no, v_in_code, v_tx_date,
        v_entry_type, 'in', v_item_id, v_warehouse_id,
        v_scope.project_id, v_scope.construction_site_id,
        'wms_transaction', v_tx.id, v_tx.id, v_source_line_id, v_tx.related_request_id,
        v_qty, v_price, v_tx.note,
        v_line || jsonb_build_object('businessEventType', v_event_type),
        v_tx.requester_id, v_tx.approver_id
      );
    elsif v_tx.type::text = 'EXPORT' then
      if v_qty < 0 then raise exception 'invalid export quantity'; end if;
      v_warehouse_id := v_tx.source_warehouse_id;
      select * into v_scope from app_private.resolve_warehouse_project_scope(v_warehouse_id);
      v_entry_no := v_entry_no + 1;
      perform app_private.post_inventory_ledger_entry(
        v_inventory_transaction_id, v_entry_no, v_out_code, v_tx_date,
        'project_issue', 'out', v_item_id, v_warehouse_id,
        v_scope.project_id, v_scope.construction_site_id,
        'wms_transaction', v_tx.id, v_tx.id, v_source_line_id, v_tx.related_request_id,
        v_qty, v_price, v_tx.note,
        v_line || jsonb_build_object('businessEventType', v_event_type),
        v_tx.requester_id, v_tx.approver_id
      );
    elsif v_tx.type::text = 'TRANSFER' then
      if v_qty < 0 then raise exception 'invalid transfer quantity'; end if;
      select * into v_scope from app_private.resolve_warehouse_project_scope(v_tx.source_warehouse_id);
      v_entry_no := v_entry_no + 1;
      perform app_private.post_inventory_ledger_entry(
        v_inventory_transaction_id, v_entry_no, v_out_code, v_tx_date,
        'transfer_issue', 'out', v_item_id, v_tx.source_warehouse_id,
        v_scope.project_id, v_scope.construction_site_id,
        'wms_transaction', v_tx.id, v_tx.id, v_source_line_id, v_tx.related_request_id,
        v_qty, v_price, v_tx.note,
        v_line || jsonb_build_object('businessEventType', v_event_type),
        v_tx.requester_id, v_tx.approver_id
      );
      select * into v_scope from app_private.resolve_warehouse_project_scope(v_tx.target_warehouse_id);
      v_entry_no := v_entry_no + 1;
      perform app_private.post_inventory_ledger_entry(
        v_inventory_transaction_id, v_entry_no, v_in_code, v_tx_date,
        'transfer_receipt', 'in', v_item_id, v_tx.target_warehouse_id,
        v_scope.project_id, v_scope.construction_site_id,
        'wms_transaction', v_tx.id, v_tx.id, v_source_line_id, v_tx.related_request_id,
        v_qty, v_price, v_tx.note,
        v_line || jsonb_build_object('businessEventType', v_event_type),
        v_tx.requester_id, v_tx.approver_id
      );
    elsif v_tx.type::text = 'LIQUIDATION' then
      if v_qty < 0 then raise exception 'invalid liquidation quantity'; end if;
      select * into v_scope from app_private.resolve_warehouse_project_scope(v_tx.source_warehouse_id);
      v_entry_no := v_entry_no + 1;
      perform app_private.post_inventory_ledger_entry(
        v_inventory_transaction_id, v_entry_no, v_out_code, v_tx_date,
        'loss_issue', 'out', v_item_id, v_tx.source_warehouse_id,
        v_scope.project_id, v_scope.construction_site_id,
        'wms_transaction', v_tx.id, v_tx.id, v_source_line_id, v_tx.related_request_id,
        v_qty, v_price, v_tx.note,
        v_line || jsonb_build_object('businessEventType', v_event_type),
        v_tx.requester_id, v_tx.approver_id
      );
    elsif v_tx.type::text = 'ADJUSTMENT' then
      v_warehouse_id := coalesce(v_tx.target_warehouse_id, v_tx.source_warehouse_id);
      select * into v_scope from app_private.resolve_warehouse_project_scope(v_warehouse_id);
      v_entry_no := v_entry_no + 1;
      perform app_private.post_inventory_ledger_entry(
        v_inventory_transaction_id, v_entry_no,
        case when v_qty > 0 then v_in_code else v_out_code end,
        v_tx_date,
        case when v_qty > 0 then 'adjustment_in' else 'adjustment_out' end,
        case when v_qty > 0 then 'in' else 'out' end,
        v_item_id, v_warehouse_id, v_scope.project_id, v_scope.construction_site_id,
        'wms_transaction', v_tx.id, v_tx.id, v_source_line_id, v_tx.related_request_id,
        abs(v_qty), v_price, v_tx.note,
        v_line || jsonb_build_object('businessEventType', v_event_type),
        v_tx.requester_id, v_tx.approver_id
      );
    end if;
  end loop;

  if v_entry_no = 0 then
    delete from public.inventory_transactions where id = v_inventory_transaction_id;
    return null;
  end if;

  update public.inventory_ledger_entries
  set business_event_type = v_event_type
  where inventory_transaction_id = v_inventory_transaction_id;

  select
    case when count(distinct coalesce(entry.project_id, '<null>')) = 1
      then max(entry.project_id) else null end,
    case when count(distinct coalesce(entry.construction_site_id, '<null>')) = 1
      then max(entry.construction_site_id) else null end
  into v_header_project_id, v_header_site_id
  from public.inventory_ledger_entries entry
  where entry.inventory_transaction_id = v_inventory_transaction_id;

  update public.inventory_transactions set
    project_id = v_header_project_id,
    construction_site_id = v_header_site_id,
    business_event_type = v_event_type
  where id = v_inventory_transaction_id;

  return v_inventory_transaction_id;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.sync_wms_transaction_to_inventory_ledger(p_transaction_id text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tx public.transactions%rowtype;
  v_existing_id uuid;
  v_original_inventory_transaction public.inventory_transactions%rowtype;
  v_inventory_transaction_id uuid;
  v_code text;
  v_line jsonb;
  v_entry_no integer := 0;
  v_tx_date timestamptz;
  v_item_id text;
  v_qty numeric;
  v_price numeric;
  v_source_line_id text;
  v_scope record;
  v_metadata jsonb;
begin
  select * into v_tx
  from public.transactions
  where id = p_transaction_id
  for update;
  if not found then raise exception 'transaction not found: %', p_transaction_id; end if;
  if v_tx.status::text <> 'COMPLETED' then return null; end if;
  if coalesce(v_tx.business_event_type, '') <> 'reversal' then
    return app_private.sync_wms_transaction_to_inventory_ledger_pre_reversal_20260905(
      p_transaction_id
    );
  end if;

  select id into v_existing_id
  from public.inventory_transactions
  where source_type = 'wms_transaction' and source_id = v_tx.id
  limit 1;
  if v_existing_id is not null then return v_existing_id; end if;

  if v_tx.type::text <> 'IMPORT'
     or nullif(v_tx.reversal_of_transaction_id, '') is null then
    raise exception 'Chứng từ đảo phải là IMPORT và liên kết phiếu WMS gốc.';
  end if;

  select original.* into v_original_inventory_transaction
  from public.inventory_transactions original
  where original.source_type = 'wms_transaction'
    and original.source_id = v_tx.reversal_of_transaction_id
  order by original.created_at
  limit 1
  for update;
  if not found then
    raise exception 'Không tìm thấy inventory transaction gốc để ghi đảo.';
  end if;
  if v_original_inventory_transaction.status <> 'posted' then
    raise exception 'Inventory transaction gốc không còn ở trạng thái posted.';
  end if;

  v_tx_date := coalesce(nullif(v_tx.date::text, '')::timestamptz, now());
  v_code := app_private.next_inventory_ledger_code('in', v_tx_date); -- số phiếu theo ngày chứng từ
  select * into v_scope
  from app_private.resolve_warehouse_project_scope(v_tx.target_warehouse_id);
  v_metadata := jsonb_build_object(
    'wmsTransactionId', v_tx.id,
    'reversalOfTransactionId', v_tx.reversal_of_transaction_id,
    'reversalOfInventoryTransactionId', v_original_inventory_transaction.id,
    'businessEventType', 'reversal',
    'businessEventReason', v_tx.business_event_reason,
    'targetWarehouseId', v_tx.target_warehouse_id,
    'items', coalesce(v_tx.items, '[]'::jsonb)
  );

  insert into public.inventory_transactions(
    code, transaction_type, status, transaction_date,
    source_type, source_id, source_code, related_request_id,
    project_id, construction_site_id, business_event_type,
    description, metadata, created_by, approved_by, posted_at,
    reversal_of_inventory_transaction_id
  ) values (
    v_code, 'reversal', 'posted', v_tx_date,
    'wms_transaction', v_tx.id, v_tx.id, v_tx.related_request_id,
    v_scope.project_id, v_scope.construction_site_id, 'reversal',
    v_tx.note, v_metadata, v_tx.requester_id, v_tx.approver_id, now(),
    v_original_inventory_transaction.id
  ) returning id into v_inventory_transaction_id;

  for v_line in select value from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb))
  loop
    v_item_id := v_line ->> 'itemId';
    v_qty := coalesce(nullif(v_line ->> 'quantity', '')::numeric, 0);
    v_price := coalesce(nullif(v_line ->> 'price', '')::numeric, 0);
    v_source_line_id := nullif(coalesce(
      v_line ->> 'materialIssueLineId',
      v_line ->> 'requestLineId',
      v_line ->> 'lineId'
    ), '');
    if v_item_id is null or v_qty <= 0 then
      raise exception 'invalid reversal transaction item payload';
    end if;
    v_entry_no := v_entry_no + 1;
    perform app_private.post_inventory_ledger_entry(
      v_inventory_transaction_id, v_entry_no, v_code, v_tx_date,
      'reversal', 'in', v_item_id, v_tx.target_warehouse_id,
      v_scope.project_id, v_scope.construction_site_id,
      'wms_transaction', v_tx.id, v_tx.id, v_source_line_id,
      v_tx.related_request_id, v_qty, v_price, v_tx.note,
      v_line || jsonb_build_object(
        'businessEventType', 'reversal',
        'reversalOfTransactionId', v_tx.reversal_of_transaction_id,
        'reversalOfInventoryTransactionId', v_original_inventory_transaction.id
      ),
      v_tx.requester_id, v_tx.approver_id
    );
  end loop;

  update public.inventory_transactions
  set status = 'reversed', reversed_at = now()
  where id = v_original_inventory_transaction.id;

  return v_inventory_transaction_id;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.trg_sync_wms_transaction_inventory_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists(select 1 from public.purchase_order_delivery_batches b join app_private.request_purchase_po_links l on l.purchase_order_id=b.purchase_order_id and l.kind='asset' where b.wms_transaction_id=new.id)
     and new.status::text = 'COMPLETED'
     and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and not (
       new.type = 'TRANSFER'::public.transaction_type
       and exists (
         select 1 from public.wms_transfer_lines line
         where line.transaction_id = new.id
       )
     )
     and not (
       new.source_type = 'po_delivery_batch'
       and exists (
         select 1 from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) item(value)
         where item.value ->> 'fulfillmentMode' = 'DIRECT_CONSUMPTION'
       )
     ) then
    perform app_private.sync_wms_transaction_to_inventory_ledger(new.id);
  -- Nhập–xuất thẳng: không lưu tồn nhưng sổ kho ghi nhập + xuất dùng thẳng để có lịch sử vật tư.
  elsif new.status::text = 'COMPLETED'
     and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and new.source_type = 'po_delivery_batch'
     and exists (select 1 from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) item(value) where item.value ->> 'fulfillmentMode' = 'DIRECT_CONSUMPTION')
     and not exists (select 1 from public.purchase_order_delivery_batches b join app_private.request_purchase_po_links l on l.purchase_order_id = b.purchase_order_id and l.kind = 'asset' where b.wms_transaction_id = new.id) then
    perform app_private.sync_wms_direct_consumption_ledger(new.id);
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.post_inventory_ledger_entry(p_inventory_transaction_id uuid, p_entry_no integer, p_document_code text, p_transaction_date timestamp with time zone, p_transaction_type text, p_direction text, p_material_id text, p_warehouse_id text, p_project_id text, p_construction_site_id text, p_source_type text, p_source_id text, p_source_code text, p_source_line_id text, p_related_request_id text, p_qty numeric, p_unit_price numeric, p_description text, p_metadata jsonb, p_created_by uuid, p_approved_by uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_entry_id uuid := gen_random_uuid();
  v_delta numeric;
  v_value_delta numeric;
  v_balance_after_qty numeric;
  v_balance_after_value numeric;
  v_unit text;
  v_total_after numeric;
  v_price numeric := coalesce(p_unit_price, 0);
  v_avg numeric;
  v_price_source text;
  v_dirty boolean := false;
  v_min_after numeric;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'ledger quantity must be positive';
  end if;
  if nullif(p_material_id, '') is null then
    raise exception 'material id is required';
  end if;
  if nullif(p_warehouse_id, '') is null then
    raise exception 'warehouse id is required';
  end if;

  select i.unit into v_unit
  from public.items i
  where i.id = p_material_id;

  v_unit := coalesce(
    v_unit,
    nullif(p_metadata->>'unit', ''),
    nullif(p_metadata->>'unitSnapshot', ''),
    nullif(p_metadata->>'accountingUnit', '')
  );

  -- K3a-2: chuyển kho đi theo giá vốn bình quân gia quyền của kho gửi tại lúc xuất (như phần mềm kế toán),
  -- không theo đơn giá gõ trên phiếu. Nhập vào kho đích, hoặc hàng trả về kho gửi, dùng đúng giá đã xuất của phiếu.
  if p_transaction_type = 'transfer_issue' and p_direction = 'out' then
    select case when sum(b.on_hand_qty) > 0 and sum(b.total_value) > 0
      then round(sum(b.total_value) / sum(b.on_hand_qty), 6) end into v_avg
    from public.inventory_balances b where b.material_id = p_material_id and b.warehouse_id = p_warehouse_id;
    v_price_source := case when v_avg is not null then 'weighted_average' else 'document' end;
    -- Tồn có hàng mà giá trị 0, hoặc hết hàng mà còn giá trị → giá bình quân chưa tin được.
    select exists (select 1 from public.inventory_balances b where b.material_id = p_material_id and b.warehouse_id = p_warehouse_id
      and ((b.on_hand_qty > 0 and b.total_value <= 0) or (b.on_hand_qty <= 0 and abs(b.total_value) > 1))) into v_dirty;
  elsif p_transaction_type = 'transfer_receipt' and p_direction = 'in' and nullif(p_source_code, '') is not null then
    select case when sum(le.quantity_out) > 0
      then round(sum(le.quantity_out * le.unit_price) / sum(le.quantity_out), 6) end into v_avg
    from public.inventory_ledger_entries le
    where le.transaction_type = 'transfer_issue' and le.source_code = p_source_code and le.material_id = p_material_id;
    v_price_source := case when v_avg is not null then 'transfer_issue' else 'document' end;
  end if;
  v_price := coalesce(v_avg, v_price);

  v_delta := case when p_direction = 'in' then p_qty else -p_qty end;
  v_value_delta := v_delta * v_price;

  insert into public.inventory_balances (
    material_id, warehouse_id, project_id, construction_site_id,
    on_hand_qty, total_value, average_unit_cost,
    last_ledger_entry_id, last_transaction_date, updated_at
  )
  values (
    p_material_id, p_warehouse_id, nullif(p_project_id, ''), nullif(p_construction_site_id, ''),
    v_delta, v_value_delta,
    case when v_delta = 0 then 0 else v_price end,
    v_entry_id, p_transaction_date, now()
  )
  on conflict (material_id, warehouse_id, scope_key)
  do update set
    on_hand_qty = public.inventory_balances.on_hand_qty + excluded.on_hand_qty,
    total_value = public.inventory_balances.total_value + excluded.total_value,
    average_unit_cost = case
      when (public.inventory_balances.on_hand_qty + excluded.on_hand_qty) = 0 then 0
      else (public.inventory_balances.total_value + excluded.total_value)
        / nullif(public.inventory_balances.on_hand_qty + excluded.on_hand_qty, 0)
    end,
    last_ledger_entry_id = excluded.last_ledger_entry_id,
    last_transaction_date = excluded.last_transaction_date,
    updated_at = now()
  returning on_hand_qty, total_value
    into v_balance_after_qty, v_balance_after_value;

  -- K1 (01/10/2026): không xuất quá tồn. Kiểm tra tổng tồn của vật tư trong kho (mọi phạm vi dự án/lô)
  -- để không chặn nhầm khi hàng nhập và xuất ghi ở hai phạm vi khác nhau của cùng một kho.
  if p_direction = 'out' and coalesce(current_setting('app.inventory_allow_negative', true), '') <> 'on' then
    select coalesce(sum(b.on_hand_qty), 0) into v_total_after
    from public.inventory_balances b where b.material_id = p_material_id and b.warehouse_id = p_warehouse_id;
    if v_total_after < -0.0005 then
      raise exception using errcode = 'P0001',
        message = format('INVENTORY_NEGATIVE_STOCK: Không đủ tồn "%s" tại kho "%s": còn %s %s, cần xuất %s. Kiểm tra lại tồn hoặc nhập bù trước khi xuất.',
          coalesce((select i.name from public.items i where i.id = p_material_id), p_material_id),
          coalesce((select w.name from public.warehouses w where w.id = p_warehouse_id), p_warehouse_id),
          trim(to_char(v_total_after + p_qty, 'FM999G999G990D###')), coalesce(v_unit, ''), trim(to_char(p_qty, 'FM999G999G990D###')));
    end if;
  end if;

  insert into public.inventory_ledger_entries (
    id, inventory_transaction_id, entry_no, document_code,
    transaction_date, transaction_type, movement_direction,
    material_id, warehouse_id, project_id, construction_site_id,
    source_type, source_id, source_code, source_line_id, related_request_id,
    quantity_in, quantity_out, unit, unit_price,
    balance_after_qty, balance_after_value,
    description, metadata, created_by, approved_by
  )
  values (
    v_entry_id, p_inventory_transaction_id, p_entry_no, p_document_code,
    p_transaction_date, p_transaction_type, p_direction,
    p_material_id, p_warehouse_id, nullif(p_project_id, ''), nullif(p_construction_site_id, ''),
    p_source_type, p_source_id, p_source_code, nullif(p_source_line_id, ''), nullif(p_related_request_id, ''),
    case when p_direction = 'in' then p_qty else 0 end,
    case when p_direction = 'out' then p_qty else 0 end,
    v_unit, v_price,
    v_balance_after_qty, v_balance_after_value,
    p_description,
    coalesce(p_metadata, '{}'::jsonb) || case when v_price_source is null then '{}'::jsonb
      else jsonb_build_object('priceSource', v_price_source, 'documentPrice', coalesce(p_unit_price, 0))
        || case when v_dirty then jsonb_build_object('dirtyStock', true) else '{}'::jsonb end end,
    p_created_by, p_approved_by
  );

  -- Ngày chứng từ: phiếu xuất ghi lùi ngày không được tạo tồn âm mới trong quá khứ (dữ liệu cũ đang âm không bị khóa).
  if p_direction = 'out' and coalesce(current_setting('app.inventory_allow_negative', true), '') <> 'on'
     and exists (select 1 from public.inventory_ledger_entries e where e.material_id = p_material_id and e.warehouse_id = p_warehouse_id
       and e.transaction_date > p_transaction_date and e.id <> v_entry_id) then
    v_min_after := app_private.wms_min_running_balance(p_material_id, p_warehouse_id, p_transaction_date);
    if v_min_after < -0.0005 and v_min_after + p_qty > -0.0005 then
      raise exception using errcode = 'P0001',
        message = format('WMS_BACKDATE_NEGATIVE: Xuất "%s" tại "%s" ngày %s làm âm tồn trong quá khứ (thấp nhất %s %s). Chọn ngày sau khi hàng về hoặc nhập bù trước.',
          coalesce((select i.name from public.items i where i.id = p_material_id), p_material_id),
          coalesce((select w.name from public.warehouses w where w.id = p_warehouse_id), p_warehouse_id),
          to_char(p_transaction_date at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY'), trim(to_char(v_min_after, 'FM999G999G990D###')), coalesce(v_unit, ''));
    end if;
  end if;

  return v_entry_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_wms_item_card_v1(p_item_id text, p_warehouse_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not (app_private.wms_has_action('wms.inventory.view', p_warehouse_id, p_warehouse_id) or app_private.wms_has_action('wms.inventory.edit', p_warehouse_id, p_warehouse_id)) then
    raise exception using errcode = '42501', message = 'WMS_STOCK_VIEW_DENIED';
  end if;
  return jsonb_build_object(
    'entries', coalesce((select jsonb_agg(jsonb_build_object('date', e.transaction_date, 'code', e.document_code, 'type', e.transaction_type,
        'qtyIn', e.quantity_in, 'qtyOut', e.quantity_out, 'unitPrice', e.unit_price, 'amount', e.amount, 'description', e.description,
        'fromSku', case when e.material_id <> p_item_id then (select m.sku from public.items m where m.id = e.material_id) end,
        'enteredAt', e.created_at, 'event', e.business_event_type)
        order by e.transaction_date, e.created_at, e.entry_no)
      from public.inventory_ledger_entries e where e.warehouse_id = p_warehouse_id
        -- V1-3a: kèm lịch sử các mã đã gộp vào mã này
        and (e.material_id = p_item_id or e.material_id in (select m.id from public.items m where m.merged_into_id = p_item_id))), '[]'::jsonb),
    'otherWarehouses', coalesce((select jsonb_agg(s.j order by s.n) from (
        select w.name n, jsonb_build_object('warehouseId', b.warehouse_id, 'warehouseName', w.name, 'qty', round(sum(b.on_hand_qty), 6)) j
        from public.inventory_balances b join public.warehouses w on w.id = b.warehouse_id
        where b.material_id = p_item_id and b.warehouse_id <> p_warehouse_id
          and (app_private.wms_has_action('wms.inventory.view', w.id, w.id) or app_private.wms_has_action('wms.inventory.edit', w.id, w.id))
        group by b.warehouse_id, w.name having sum(b.on_hand_qty) <> 0) s), '[]'::jsonb));
end $function$;


-- Nhập–xuất thẳng: ghi nhập mua rồi xuất dùng thẳng cùng ngày, cùng giá (tồn không đổi). Bỏ qua dòng dịch vụ ("Không qua kho").
-- Gọi lại nhiều lần vẫn chỉ ghi một lần.
create function app_private.sync_wms_direct_consumption_ledger(p_transaction_id text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_tx public.transactions%rowtype; v_inv uuid; v_date timestamptz; v_in text; v_out text; v_scope record; v_line jsonb; v_no int := 0;
  v_item text; v_qty numeric; v_price numeric; v_line_id text; v_event text;
begin
  select * into v_tx from public.transactions where id = p_transaction_id for update;
  if not found or v_tx.status::text <> 'COMPLETED' then return null; end if;
  select id into v_inv from public.inventory_transactions where source_type = 'wms_transaction' and source_id = v_tx.id limit 1;
  if v_inv is not null then return v_inv; end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) x join public.items i on i.id = x->>'itemId'
      where coalesce(nullif(x->>'quantity', '')::numeric, 0) > 0 and coalesce(i.inventory_mode, 'stock') <> 'service') then return null; end if;
  v_date := coalesce(nullif(v_tx.date::text, '')::timestamptz, now());
  v_event := coalesce(nullif(v_tx.business_event_type, ''), 'proactive_po_receipt');
  v_in := app_private.next_inventory_ledger_code('in', v_date);
  v_out := app_private.next_inventory_ledger_code('out', v_date);
  select * into v_scope from app_private.resolve_warehouse_project_scope(v_tx.target_warehouse_id);
  insert into public.inventory_transactions (code, transaction_type, status, transaction_date, source_type, source_id, source_code, related_request_id,
    project_id, construction_site_id, business_event_type, description, metadata, created_by, approved_by, posted_at)
  values (v_in, 'purchase_receipt', 'posted', v_date, 'wms_transaction', v_tx.id, v_tx.id, v_tx.related_request_id, null, null, v_event, v_tx.note,
    jsonb_build_object('wmsTransactionId', v_tx.id, 'wmsType', v_tx.type::text, 'businessEventType', v_event, 'fulfillmentMode', 'DIRECT_CONSUMPTION',
      'targetWarehouseId', v_tx.target_warehouse_id, 'items', coalesce(v_tx.items, '[]'::jsonb)), v_tx.requester_id, v_tx.approver_id, now())
  returning id into v_inv;
  for v_line in select x from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) x join public.items i on i.id = x->>'itemId'
      where coalesce(i.inventory_mode, 'stock') <> 'service' loop
    v_item := v_line->>'itemId';
    v_qty := coalesce(nullif(v_line->>'quantity', '')::numeric, 0);
    v_price := coalesce(nullif(v_line->>'price', '')::numeric, 0);
    v_line_id := nullif(coalesce(v_line->>'requestLineId', v_line->>'lineId'), '');
    if v_qty <= 0 then continue; end if;
    v_no := v_no + 1;
    perform app_private.post_inventory_ledger_entry(v_inv, v_no, v_in, v_date, 'purchase_receipt', 'in', v_item, v_tx.target_warehouse_id,
      v_scope.project_id, v_scope.construction_site_id, 'wms_transaction', v_tx.id, v_tx.id, v_line_id, v_tx.related_request_id,
      v_qty, v_price, v_tx.note, v_line || jsonb_build_object('businessEventType', v_event), v_tx.requester_id, v_tx.approver_id);
    v_no := v_no + 1;
    perform app_private.post_inventory_ledger_entry(v_inv, v_no, v_out, v_date, 'project_issue', 'out', v_item, v_tx.target_warehouse_id,
      v_scope.project_id, v_scope.construction_site_id, 'wms_transaction', v_tx.id, v_tx.id, v_line_id, v_tx.related_request_id,
      v_qty, v_price, 'Xuất dùng thẳng — ' || coalesce(nullif(v_tx.note, ''), v_in),
      v_line || jsonb_build_object('businessEventType', 'direct_consumption', 'directConsumptionOf', v_in), v_tx.requester_id, v_tx.approver_id);
  end loop;
  update public.inventory_ledger_entries set business_event_type = case when movement_direction = 'out' then 'direct_consumption' else v_event end
  where inventory_transaction_id = v_inv;
  return v_inv;
end $$;

-- Sửa ngày chứng từ. p = { transactionId, date: 'YYYY-MM-DD', reason }
create function public.set_wms_document_date_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_tx public.transactions%rowtype;
  v_new timestamptz;
  v_reason text := nullif(btrim(coalesce(p->>'reason', '')), '');
  v_posted boolean;
  v_inv uuid[];
  r record;
  v_before numeric; v_after numeric;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'WMS_DOC_DATE_DENIED'; end if;
  select * into v_tx from public.transactions where id = p->>'transactionId' for update;
  if not found then raise exception using errcode = 'P0002', message = 'WMS_DOC_NOT_FOUND'; end if;
  if not (public.is_admin() or app_private.has_permission(v_actor, 'wms.accounting.manage', 'global', '*')
      or app_private.wms_user_is_keeper(v_actor, v_tx.source_warehouse_id) or app_private.wms_user_is_keeper(v_actor, v_tx.target_warehouse_id)) then
    raise exception using errcode = '42501', message = 'WMS_DOC_DATE_DENIED';
  end if;
  if v_tx.status::text in ('CANCELLED', 'REJECTED') then raise exception using errcode = '22023', message = 'WMS_DOC_DATE_STATE'; end if;
  begin v_new := ((p->>'date')::date + time '12:00') at time zone 'Asia/Ho_Chi_Minh';
  exception when others then raise exception using errcode = '22023', message = 'WMS_DOC_DATE_INVALID'; end;
  if v_new is null or (p->>'date')::date > (now() at time zone 'Asia/Ho_Chi_Minh')::date then raise exception using errcode = '22023', message = 'WMS_DOC_DATE_FUTURE'; end if;
  if (p->>'date')::date < date '2025-01-01' then raise exception using errcode = '22023', message = 'WMS_DOC_DATE_INVALID'; end if;
  select array_agg(id) into v_inv from public.inventory_transactions where source_type = 'wms_transaction' and source_id = v_tx.id and status = 'posted';
  v_posted := v_inv is not null;
  if v_posted and v_reason is null then raise exception using errcode = '22023', message = 'WMS_DOC_DATE_REASON'; end if;

  update public.transactions set date = v_new where id = v_tx.id;
  if v_posted then
    create temp table if not exists wms_doc_date_mins(material_id text, warehouse_id text, before_min numeric) on commit drop;
    delete from pg_temp.wms_doc_date_mins;
    insert into pg_temp.wms_doc_date_mins
      select distinct e.material_id, e.warehouse_id, app_private.wms_min_running_balance(e.material_id, e.warehouse_id, '-infinity')
      from public.inventory_ledger_entries e where e.inventory_transaction_id = any(v_inv);
    update public.inventory_transactions set transaction_date = v_new where id = any(v_inv);
    update public.inventory_ledger_entries set transaction_date = v_new where inventory_transaction_id = any(v_inv);
    for r in select * from pg_temp.wms_doc_date_mins loop
      v_after := app_private.wms_min_running_balance(r.material_id, r.warehouse_id, '-infinity');
      if v_after < -0.0005 and v_after < r.before_min - 0.0005 then
        raise exception using errcode = 'P0001', message = format('WMS_BACKDATE_NEGATIVE: Đổi ngày làm "%s" tại "%s" âm tồn trong quá khứ (thấp nhất %s). Chọn ngày khác hoặc nhập bù trước.',
          coalesce((select name from public.items where id = r.material_id), r.material_id), coalesce((select name from public.warehouses where id = r.warehouse_id), r.warehouse_id),
          trim(to_char(v_after, 'FM999G999G990D###')));
      end if;
    end loop;
  end if;
  insert into public.wms_document_date_events (transaction_id, old_date, new_date, was_posted, reason, actor_id)
  values (v_tx.id, v_tx.date, v_new, v_posted, v_reason, v_actor);
  return jsonb_build_object('transactionId', v_tx.id, 'date', v_new, 'posted', v_posted);
end $$;

-- Lưu vết cho phiếu nhập–xuất thẳng đã nhận trước bản này.
do $$ declare t record; begin
  for t in select x.id from public.transactions x where x.status::text = 'COMPLETED' and x.source_type = 'po_delivery_batch'
    and exists (select 1 from jsonb_array_elements(coalesce(x.items, '[]'::jsonb)) i where i->>'fulfillmentMode' = 'DIRECT_CONSUMPTION')
    and not exists (select 1 from public.inventory_transactions it where it.source_type = 'wms_transaction' and it.source_id = x.id)
  loop perform app_private.sync_wms_direct_consumption_ledger(t.id); end loop;
end $$;

revoke all on function app_private.next_inventory_ledger_code(text, timestamptz), app_private.wms_min_running_balance(text, text, timestamptz),
  app_private.sync_wms_direct_consumption_ledger(text) from public, anon;
revoke all on function public.set_wms_document_date_v1(jsonb) from public, anon;
grant execute on function public.set_wms_document_date_v1(jsonb) to authenticated;

notify pgrst, 'reload schema';
