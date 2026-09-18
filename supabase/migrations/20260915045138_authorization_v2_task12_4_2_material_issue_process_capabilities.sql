-- Keep the transition-era personas in one compatibility predicate, but make
-- every material-issue command choose its own canonical capability. Settlement
-- posting and reversal intentionally remain compatibility-only until a
-- dedicated business capability is reviewed.
create or replace function app_private.material_issue_has_process_compatibility_access(
  p_source_warehouse_id text,
  p_created_by uuid,
  p_responsible_user_id uuid,
  p_recipient_type text,
  p_recipient_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.is_admin()
    or public.is_module_admin('WMS')
    or app_private.current_user_is_global_wms_keeper()
    or app_private.current_user_is_wms_keeper_for(p_source_warehouse_id)
    or p_created_by = public.current_app_user_id()
    or p_responsible_user_id = public.current_app_user_id()
    or (
      p_recipient_type = 'employee'
      and p_recipient_id = public.current_app_user_id()::text
    ),
    false
  );
$$;

create or replace function app_private.material_issue_can_confirm_receipt(
  p_source_warehouse_id text,
  p_created_by uuid,
  p_responsible_user_id uuid,
  p_recipient_type text,
  p_recipient_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app_private.material_issue_has_process_compatibility_access(
      p_source_warehouse_id,
      p_created_by,
      p_responsible_user_id,
      p_recipient_type,
      p_recipient_id
    )
    or app_private.wms_has_canonical_action(
      'wms.transaction.complete',
      p_source_warehouse_id,
      null,
      null,
      null,
      public.current_app_user_id()
    ),
    false
  );
$$;

create or replace function app_private.material_issue_can_create_return(
  p_source_warehouse_id text,
  p_created_by uuid,
  p_responsible_user_id uuid,
  p_recipient_type text,
  p_recipient_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app_private.material_issue_has_process_compatibility_access(
      p_source_warehouse_id,
      p_created_by,
      p_responsible_user_id,
      p_recipient_type,
      p_recipient_id
    )
    or app_private.wms_has_canonical_action(
      'wms.transaction.create',
      p_source_warehouse_id,
      null,
      null,
      null,
      public.current_app_user_id()
    ),
    false
  );
$$;

create or replace function app_private.material_issue_can_post_settlement(
  p_source_warehouse_id text,
  p_created_by uuid,
  p_responsible_user_id uuid,
  p_recipient_type text,
  p_recipient_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.material_issue_has_process_compatibility_access(
    p_source_warehouse_id,
    p_created_by,
    p_responsible_user_id,
    p_recipient_type,
    p_recipient_id
  );
$$;

create or replace function app_private.material_issue_can_reverse_settlement(
  p_source_warehouse_id text,
  p_created_by uuid,
  p_responsible_user_id uuid,
  p_recipient_type text,
  p_recipient_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.material_issue_has_process_compatibility_access(
    p_source_warehouse_id,
    p_created_by,
    p_responsible_user_id,
    p_recipient_type,
    p_recipient_id
  );
$$;

revoke all on function app_private.material_issue_has_process_compatibility_access(
  text, uuid, uuid, text, text
) from public, anon, authenticated;
revoke all on function app_private.material_issue_can_confirm_receipt(
  text, uuid, uuid, text, text
) from public, anon, authenticated;
revoke all on function app_private.material_issue_can_create_return(
  text, uuid, uuid, text, text
) from public, anon, authenticated;
revoke all on function app_private.material_issue_can_post_settlement(
  text, uuid, uuid, text, text
) from public, anon, authenticated;
revoke all on function app_private.material_issue_can_reverse_settlement(
  text, uuid, uuid, text, text
) from public, anon, authenticated;

create or replace function public.confirm_material_issue_receipt(
  p_order_id uuid,
  p_lines jsonb,
  p_note text default null,
  p_attachments jsonb default '[]'::jsonb,
  p_signature_url text default null
)
returns public.material_issue_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_actor_name text;
  v_order public.material_issue_orders%rowtype;
  v_receipt_id uuid := gen_random_uuid();
  v_receipt_no text;
  v_line jsonb;
  v_issue_line public.material_issue_lines%rowtype;
  v_qty numeric;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  select * into v_order
  from public.material_issue_orders
  where id = p_order_id
  for update;
  if not found then raise exception 'Không tìm thấy phiếu xuất cấp.'; end if;
  if v_order.status not in (
    'issued', 'partially_received', 'received', 'settling', 'partially_returned'
  ) then
    raise exception 'Chỉ xác nhận nhận hàng sau khi WMS đã xuất kho.';
  end if;
  if not app_private.material_issue_can_confirm_receipt(
    v_order.source_warehouse_id,
    v_order.created_by,
    v_order.responsible_user_id,
    v_order.recipient_type,
    v_order.recipient_id
  ) then
    raise exception 'Bạn không có quyền xác nhận phiếu này.';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Chưa có dòng xác nhận nhận hàng.';
  end if;

  select coalesce(u.name, u.username, u.email)
  into v_actor_name
  from public.users u
  where u.id = v_actor;
  v_receipt_no := 'MIR-' || to_char(now(), 'YYYYMMDD') || '-'
    || upper(substr(replace(v_receipt_id::text, '-', ''), 1, 6));

  insert into public.material_issue_receipts(
    id, issue_order_id, receipt_no, received_by, received_by_name, note,
    signature_url, attachments
  ) values (
    v_receipt_id, p_order_id, v_receipt_no, v_actor, v_actor_name,
    nullif(trim(coalesce(p_note, '')), ''), nullif(p_signature_url, ''),
    coalesce(p_attachments, '[]'::jsonb)
  );

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_qty := coalesce(nullif(v_line ->> 'receivedQty', '')::numeric, 0);
    if v_qty < 0 then raise exception 'Số lượng nhận không hợp lệ.'; end if;
    select * into v_issue_line
    from public.material_issue_lines
    where id = (v_line ->> 'issueLineId')::uuid
      and issue_order_id = p_order_id
    for update;
    if not found then raise exception 'Không tìm thấy dòng phiếu xuất cấp.'; end if;
    if v_issue_line.received_qty + v_qty > v_issue_line.issued_qty then
      raise exception 'Số lượng nhận vượt số lượng đã xuất.';
    end if;

    insert into public.material_issue_receipt_lines(
      receipt_id, issue_line_id, item_id, received_qty, variance_reason
    ) values (
      v_receipt_id, v_issue_line.id, v_issue_line.item_id, v_qty,
      nullif(trim(coalesce(v_line ->> 'varianceReason', '')), '')
    );

    update public.material_issue_lines
    set received_qty = received_qty + v_qty
    where id = v_issue_line.id;

    insert into public.material_party_ledger(
      issue_order_id, issue_line_id, source_document_type, source_document_id,
      ledger_type, project_id, construction_site_id, recipient_type,
      recipient_id, recipient_name, item_id, item_name_snapshot, unit,
      quantity_delta, reason, metadata, created_by
    ) values (
      p_order_id, v_issue_line.id, 'material_issue_receipt', v_receipt_id::text,
      'receive_confirm', v_order.project_id, v_order.construction_site_id,
      v_order.recipient_type, v_order.recipient_id, v_order.recipient_name,
      v_issue_line.item_id, v_issue_line.item_name_snapshot, v_issue_line.unit, 0,
      nullif(trim(coalesce(p_note, '')), ''),
      jsonb_build_object('receivedQty', v_qty), v_actor
    ) on conflict do nothing;
  end loop;

  return app_private.material_issue_refresh_status(p_order_id);
end;
$$;

create or replace function app_private.create_material_issue_return_v2_impl(
  p_actor_id uuid,
  p_order_id uuid,
  p_target_warehouse_id text,
  p_lines jsonb,
  p_reason text,
  p_note text,
  p_idempotency_key text
)
returns public.material_issue_returns
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.material_issue_orders%rowtype;
  v_existing public.material_issue_returns%rowtype;
  v_result public.material_issue_returns%rowtype;
  v_return_id uuid := gen_random_uuid();
  v_transaction_id text := 'tx-material-return-'
    || replace(gen_random_uuid()::text, '-', '');
  v_return_no text;
  v_payload_hash text;
  v_items jsonb := '[]'::jsonb;
  v_return_lines jsonb := '[]'::jsonb;
  v_line jsonb;
  v_issue_line public.material_issue_lines%rowtype;
  v_qty numeric;
  v_available numeric;
begin
  if p_actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Bắt buộc nhập lý do hoàn trả.';
  end if;
  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'Thiếu khóa chống ghi lặp.';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Phiếu hoàn trả chưa có dòng vật tư.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_lines) payload(value)
    group by payload.value ->> 'issueLineId'
    having count(*) > 1
  ) then
    raise exception 'Mỗi dòng xuất cấp chỉ được xuất hiện một lần trong phiếu hoàn trả.';
  end if;

  select * into v_order
  from public.material_issue_orders
  where id = p_order_id
  for update;
  if not found then raise exception 'Không tìm thấy phiếu xuất cấp.'; end if;
  if p_target_warehouse_id is distinct from v_order.source_warehouse_id then
    raise exception 'Nhập hoàn phải trả về đúng kho xuất nguồn.';
  end if;
  if not app_private.material_issue_can_create_return(
    v_order.source_warehouse_id,
    v_order.created_by,
    v_order.responsible_user_id,
    v_order.recipient_type,
    v_order.recipient_id
  ) then
    raise exception 'Bạn không có quyền tạo phiếu hoàn trả.' using errcode = '42501';
  end if;

  v_payload_hash := app_private.material_issue_payload_hash(jsonb_build_object(
    'orderId', p_order_id,
    'targetWarehouseId', p_target_warehouse_id,
    'lines', p_lines,
    'reason', btrim(p_reason),
    'note', nullif(btrim(coalesce(p_note, '')), '')
  ));

  select * into v_existing
  from public.material_issue_returns
  where idempotency_key = btrim(p_idempotency_key)
  for update;
  if found then
    if v_existing.issue_order_id is distinct from p_order_id
       or v_existing.return_kind <> 'unused_return'
       or v_existing.metadata ->> 'payloadHash' is distinct from v_payload_hash then
      raise exception 'MATERIAL_ISSUE_IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    return v_existing;
  end if;

  if v_order.status not in (
    'issued', 'partially_received', 'received', 'settling', 'partially_returned'
  ) then
    raise exception 'Phiếu chưa sẵn sàng hoàn trả.';
  end if;

  v_return_no := 'MRET-' || to_char(now(), 'YYYYMMDD') || '-'
    || upper(substr(replace(v_return_id::text, '-', ''), 1, 6));

  for v_line in
    select payload.value
    from jsonb_array_elements(p_lines) payload(value)
    order by payload.value ->> 'issueLineId'
  loop
    v_qty := coalesce(nullif(v_line ->> 'returnQty', '')::numeric, 0);
    if v_qty <= 0 then raise exception 'Số lượng hoàn trả phải lớn hơn 0.'; end if;

    select * into v_issue_line
    from public.material_issue_lines
    where id = (v_line ->> 'issueLineId')::uuid
      and issue_order_id = p_order_id
    for update;
    if not found then raise exception 'Không tìm thấy dòng phiếu xuất cấp.'; end if;

    v_available := greatest(
      v_issue_line.issued_qty
        - v_issue_line.returned_qty
        - v_issue_line.consumed_qty
        - v_issue_line.lost_qty
        - app_private.material_issue_pending_return_qty(
            p_order_id,
            v_issue_line.id,
            null
          ),
      0
    );
    if v_qty > v_available then
      raise exception 'Số lượng hoàn trả vượt số lượng còn có thể hoàn.';
    end if;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'itemId', v_issue_line.item_id,
      'quantity', v_qty,
      'price', v_issue_line.unit_price,
      'materialIssueOrderId', p_order_id,
      'materialIssueLineId', v_issue_line.id,
      'materialIssueReturnId', v_return_id,
      'recipientType', v_order.recipient_type,
      'recipientNameSnapshot', v_order.recipient_name
    ));
    v_return_lines := v_return_lines || jsonb_build_array(jsonb_build_object(
      'issueLineId', v_issue_line.id,
      'itemId', v_issue_line.item_id,
      'returnQty', v_qty,
      'unit', v_issue_line.unit,
      'reason', nullif(btrim(coalesce(v_line ->> 'reason', '')), '')
    ));
  end loop;

  insert into public.transactions(
    id, type, date, items, source_warehouse_id, target_warehouse_id,
    requester_id, approver_id, status, note, related_request_id, pending_items,
    source_type, source_id, business_event_type, business_event_reason,
    idempotency_key
  ) values (
    v_transaction_id, 'IMPORT', now(), v_items, null, p_target_warehouse_id,
    p_actor_id, null, 'PENDING',
    'Hoàn trả vật tư từ ' || v_order.recipient_name || ' theo phiếu '
      || v_order.issue_no,
    v_order.material_request_id, '[]'::jsonb,
    'material_issue_return', v_return_id::text, 'project_return_receipt',
    btrim(p_reason), btrim(p_idempotency_key)
  );

  insert into public.material_issue_returns(
    id, issue_order_id, return_no, return_kind, target_warehouse_id, status,
    transaction_id, reason, note, idempotency_key, metadata, created_by
  ) values (
    v_return_id, p_order_id, v_return_no, 'unused_return',
    p_target_warehouse_id, 'pending', v_transaction_id, btrim(p_reason),
    nullif(btrim(coalesce(p_note, '')), ''), btrim(p_idempotency_key),
    jsonb_build_object('payloadHash', v_payload_hash), p_actor_id
  ) returning * into v_result;

  for v_line in select value from jsonb_array_elements(v_return_lines)
  loop
    insert into public.material_issue_return_lines(
      issue_return_id, issue_line_id, item_id, return_qty, unit, reason
    ) values (
      v_return_id,
      (v_line ->> 'issueLineId')::uuid,
      v_line ->> 'itemId',
      (v_line ->> 'returnQty')::numeric,
      nullif(v_line ->> 'unit', ''),
      nullif(v_line ->> 'reason', '')
    );
  end loop;

  if to_regclass('public.project_document_links') is not null then
    insert into public.project_document_links(
      source_type, source_id, target_type, target_id, project_id,
      relation_type, status, metadata
    ) values (
      'material_issue_order', v_order.id::text, 'material_issue_return',
      v_return_id::text, v_order.project_id, 'downstream', 'active',
      jsonb_build_object('returnNo', v_return_no, 'transactionId', v_transaction_id)
    )
    on conflict (source_type, source_id, target_type, target_id, relation_type)
    do update set
      status = excluded.status,
      metadata = excluded.metadata,
      updated_at = now();

    insert into public.project_document_links(
      source_type, source_id, target_type, target_id, project_id,
      relation_type, status, metadata
    ) values (
      'material_issue_order', v_order.id::text, 'transaction',
      v_transaction_id, v_order.project_id, 'downstream', 'active',
      jsonb_build_object('kind', 'material_issue_return', 'returnId', v_return_id)
    )
    on conflict (source_type, source_id, target_type, target_id, relation_type)
    do update set
      status = excluded.status,
      metadata = excluded.metadata,
      updated_at = now();
  end if;

  return v_result;
end;
$$;

create or replace function public.post_material_issue_settlement_v1(
  p_order_id uuid,
  p_settlement_type text,
  p_settlement_date date,
  p_lines jsonb,
  p_reason text,
  p_idempotency_key text,
  p_attachments jsonb default '[]'::jsonb
)
returns public.material_issue_settlements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_order public.material_issue_orders%rowtype;
  v_settlement public.material_issue_settlements%rowtype;
  v_settlement_id uuid := gen_random_uuid();
  v_line jsonb;
  v_issue_line public.material_issue_lines%rowtype;
  v_qty numeric;
  v_available numeric;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_settlement_type not in ('consume', 'loss') then
    raise exception 'Loại quyết toán không hợp lệ.';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Bắt buộc nhập lý do quyết toán.';
  end if;
  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'Thiếu khóa chống ghi lặp.';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Chứng từ quyết toán chưa có dòng vật tư.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_lines) payload(value)
    group by payload.value ->> 'issueLineId'
    having count(*) > 1
  ) then
    raise exception 'Mỗi dòng xuất cấp chỉ được quyết toán một lần trong chứng từ.';
  end if;

  select * into v_settlement
  from public.material_issue_settlements
  where idempotency_key = btrim(p_idempotency_key);
  if found then return v_settlement; end if;

  select * into v_order
  from public.material_issue_orders
  where id = p_order_id
  for update;
  if not found then raise exception 'Không tìm thấy phiếu xuất cấp.'; end if;
  if v_order.status not in (
    'issued', 'partially_received', 'received', 'settling', 'partially_returned'
  ) then
    raise exception 'Phiếu chưa sẵn sàng quyết toán.';
  end if;
  if not app_private.material_issue_can_post_settlement(
    v_order.source_warehouse_id,
    v_order.created_by,
    v_order.responsible_user_id,
    v_order.recipient_type,
    v_order.recipient_id
  ) then
    raise exception 'Bạn không có quyền quyết toán phiếu này.';
  end if;

  insert into public.material_issue_settlements(
    id, settlement_no, issue_order_id, settlement_type, settlement_date,
    status, reason, attachments, idempotency_key, created_by, approved_by
  ) values (
    v_settlement_id,
    'MIS-' || to_char(
      coalesce(p_settlement_date, (now() at time zone 'Asia/Ho_Chi_Minh')::date),
      'YYYYMMDD'
    ) || '-' || upper(substr(replace(v_settlement_id::text, '-', ''), 1, 8)),
    p_order_id, p_settlement_type,
    coalesce(p_settlement_date, (now() at time zone 'Asia/Ho_Chi_Minh')::date),
    'posted', btrim(p_reason), coalesce(p_attachments, '[]'::jsonb),
    btrim(p_idempotency_key), v_actor, v_actor
  ) returning * into v_settlement;

  for v_line in
    select payload.value
    from jsonb_array_elements(p_lines) payload(value)
    order by payload.value ->> 'issueLineId'
  loop
    v_qty := coalesce(nullif(v_line ->> 'quantity', '')::numeric, 0);
    if v_qty <= 0 then raise exception 'Số lượng quyết toán phải lớn hơn 0.'; end if;

    select * into v_issue_line
    from public.material_issue_lines
    where id = (v_line ->> 'issueLineId')::uuid
      and issue_order_id = p_order_id
    for update;
    if not found then raise exception 'Không tìm thấy dòng phiếu xuất cấp.'; end if;

    v_available := v_issue_line.issued_qty
      - v_issue_line.returned_qty
      - v_issue_line.consumed_qty
      - v_issue_line.lost_qty
      - app_private.material_issue_pending_return_qty(
          p_order_id,
          v_issue_line.id,
          null
        );
    if v_qty > greatest(v_available, 0) then
      raise exception 'Số lượng quyết toán vượt số lượng còn lại sau khi giữ chỗ nhập hoàn.';
    end if;

    insert into public.material_issue_settlement_lines(
      settlement_id, issue_line_id, item_id, quantity, work_boq_item_id, note
    ) values (
      v_settlement_id, v_issue_line.id, v_issue_line.item_id, v_qty,
      nullif(v_line ->> 'workBoqItemId', ''),
      nullif(btrim(coalesce(v_line ->> 'note', '')), '')
    );

    if p_settlement_type = 'consume' then
      update public.material_issue_lines
      set consumed_qty = consumed_qty + v_qty
      where id = v_issue_line.id;
    else
      update public.material_issue_lines
      set lost_qty = lost_qty + v_qty
      where id = v_issue_line.id;
    end if;

    insert into public.material_party_ledger(
      issue_order_id, issue_line_id, source_document_type, source_document_id,
      ledger_type, project_id, construction_site_id, recipient_type,
      recipient_id, recipient_name, item_id, item_name_snapshot, unit,
      quantity_delta, reason, metadata, created_by
    ) values (
      p_order_id, v_issue_line.id, 'material_issue_settlement',
      v_settlement_id::text, p_settlement_type, v_order.project_id,
      v_order.construction_site_id, v_order.recipient_type,
      v_order.recipient_id, v_order.recipient_name, v_issue_line.item_id,
      v_issue_line.item_name_snapshot, v_issue_line.unit, -v_qty,
      btrim(p_reason), jsonb_build_object(
        'settlementId', v_settlement_id,
        'attachments', coalesce(p_attachments, '[]'::jsonb)
      ), v_actor
    );
  end loop;

  update public.material_issue_orders
  set status = 'settling'
  where id = p_order_id and status not in ('closed', 'cancelled', 'reversed');
  perform app_private.material_issue_refresh_status(p_order_id);
  return v_settlement;
end;
$$;

create or replace function public.reverse_material_issue_settlement_v1(
  p_settlement_id uuid,
  p_reason text,
  p_idempotency_key text
)
returns public.material_issue_settlements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_original public.material_issue_settlements%rowtype;
  v_reversal public.material_issue_settlements%rowtype;
  v_order public.material_issue_orders%rowtype;
  v_line record;
  v_issue_line public.material_issue_lines%rowtype;
  v_reversal_id uuid := gen_random_uuid();
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Bắt buộc nhập lý do hoàn tác.';
  end if;
  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'Thiếu khóa chống ghi lặp.';
  end if;
  select * into v_reversal
  from public.material_issue_settlements
  where idempotency_key = p_idempotency_key;
  if found then return v_reversal; end if;

  select * into v_original
  from public.material_issue_settlements
  where id = p_settlement_id
  for update;
  if not found then raise exception 'Không tìm thấy chứng từ quyết toán.'; end if;
  if v_original.status <> 'posted'
     or v_original.reversal_of_settlement_id is not null then
    raise exception 'Chứng từ quyết toán không còn đủ điều kiện hoàn tác.';
  end if;
  select * into v_order
  from public.material_issue_orders
  where id = v_original.issue_order_id
  for update;
  if not app_private.material_issue_can_reverse_settlement(
    v_order.source_warehouse_id,
    v_order.created_by,
    v_order.responsible_user_id,
    v_order.recipient_type,
    v_order.recipient_id
  ) then
    raise exception 'Bạn không có quyền hoàn tác quyết toán phiếu này.';
  end if;

  insert into public.material_issue_settlements(
    id, settlement_no, issue_order_id, settlement_type, settlement_date,
    status, reason, attachments, metadata, idempotency_key,
    reversal_of_settlement_id, created_by, approved_by
  ) values (
    v_reversal_id,
    'MISR-' || to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date, 'YYYYMMDD')
      || '-' || upper(substr(replace(v_reversal_id::text, '-', ''), 1, 8)),
    v_original.issue_order_id, v_original.settlement_type,
    (now() at time zone 'Asia/Ho_Chi_Minh')::date, 'posted', btrim(p_reason),
    '[]'::jsonb,
    jsonb_build_object('reversalOfSettlementId', v_original.id),
    btrim(p_idempotency_key), v_original.id, v_actor, v_actor
  ) returning * into v_reversal;

  for v_line in
    select *
    from public.material_issue_settlement_lines
    where settlement_id = v_original.id
    order by created_at, id
  loop
    select * into v_issue_line
    from public.material_issue_lines
    where id = v_line.issue_line_id
    for update;
    if v_original.settlement_type = 'consume' then
      if v_issue_line.consumed_qty < v_line.quantity then
        raise exception 'Không thể hoàn tác làm số đã dùng âm.';
      end if;
      update public.material_issue_lines
      set consumed_qty = consumed_qty - v_line.quantity
      where id = v_issue_line.id;
    else
      if v_issue_line.lost_qty < v_line.quantity then
        raise exception 'Không thể hoàn tác làm số hao hụt âm.';
      end if;
      update public.material_issue_lines
      set lost_qty = lost_qty - v_line.quantity
      where id = v_issue_line.id;
    end if;
    insert into public.material_issue_settlement_lines(
      settlement_id, issue_line_id, item_id, quantity, work_boq_item_id, note
    ) values (
      v_reversal_id, v_line.issue_line_id, v_line.item_id, v_line.quantity,
      v_line.work_boq_item_id, 'Hoàn tác: ' || btrim(p_reason)
    );
    insert into public.material_party_ledger(
      issue_order_id, issue_line_id, source_document_type, source_document_id,
      ledger_type, project_id, construction_site_id, recipient_type,
      recipient_id, recipient_name, item_id, item_name_snapshot, unit,
      quantity_delta, reason, metadata, created_by
    ) values (
      v_order.id, v_issue_line.id, 'material_issue_settlement_reversal',
      v_reversal_id::text, v_original.settlement_type, v_order.project_id,
      v_order.construction_site_id, v_order.recipient_type,
      v_order.recipient_id, v_order.recipient_name, v_issue_line.item_id,
      v_issue_line.item_name_snapshot, v_issue_line.unit, v_line.quantity,
      btrim(p_reason),
      jsonb_build_object('reversalOfSettlementId', v_original.id), v_actor
    );
  end loop;
  update public.material_issue_settlements
  set status = 'reversed',
      reversed_at = now(),
      reversal_reason = btrim(p_reason)
  where id = v_original.id;
  perform app_private.material_issue_refresh_status(v_order.id);
  return v_reversal;
end;
$$;

drop function app_private.material_issue_can_process(
  text, uuid, uuid, text, text
);
