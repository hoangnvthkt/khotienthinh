-- Material issue approval reversal and safe unused returns.
-- Completed WMS documents remain immutable; corrections are compensating entries.

alter table public.transactions
  add column if not exists reversal_of_transaction_id text
    references public.transactions(id) on delete restrict,
  add column if not exists idempotency_key text;

create index if not exists idx_transactions_reversal_of_transaction_id
  on public.transactions(reversal_of_transaction_id)
  where reversal_of_transaction_id is not null;

create unique index if not exists uq_transactions_active_reversal
  on public.transactions(reversal_of_transaction_id)
  where reversal_of_transaction_id is not null
    and status <> 'CANCELLED'::public.transaction_status;

create unique index if not exists uq_transactions_idempotency_key
  on public.transactions(idempotency_key)
  where idempotency_key is not null;

alter table public.material_issue_returns
  add column if not exists return_kind text not null default 'unused_return',
  add column if not exists idempotency_key text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.material_issue_returns
  drop constraint if exists material_issue_returns_return_kind_check,
  add constraint material_issue_returns_return_kind_check
    check (return_kind in ('unused_return', 'approval_reversal')),
  drop constraint if exists material_issue_returns_metadata_object_check,
  add constraint material_issue_returns_metadata_object_check
    check (jsonb_typeof(metadata) = 'object');

create unique index if not exists uq_material_issue_returns_idempotency_key
  on public.material_issue_returns(idempotency_key)
  where idempotency_key is not null;

alter table public.material_issue_orders
  drop constraint if exists material_issue_orders_status_check;

alter table public.material_issue_orders
  add constraint material_issue_orders_status_check check (status in (
    'draft', 'submitted', 'wms_pending', 'issued', 'partially_received',
    'received', 'settling', 'partially_returned', 'closed', 'reversed',
    'rejected', 'cancelled'
  ));

insert into public.permission_actions(
  module_code, action, permission_code, label, description, scope_modes,
  legacy_module_key, legacy_route, legacy_admin_only, sort_order, is_active,
  risk_level, is_business_action, is_business_approval,
  direct_grant_requires_expiry, grant_readiness, access_application_code
) values (
  'wms.transaction', 'reverse', 'wms.transaction.reverse', 'Hủy duyệt',
  'Đảo toàn bộ phiếu xuất đã ghi sổ khi hàng chưa rời kho.',
  array['global', 'warehouse'], null, '/operations', true, 50, true,
  'sensitive', true, false, true, 'enforced', 'wms'
)
on conflict (permission_code) do update set
  module_code = excluded.module_code,
  action = excluded.action,
  label = excluded.label,
  description = excluded.description,
  scope_modes = excluded.scope_modes,
  legacy_module_key = null,
  legacy_route = excluded.legacy_route,
  legacy_admin_only = true,
  sort_order = excluded.sort_order,
  is_active = true,
  risk_level = 'sensitive',
  is_business_action = true,
  is_business_approval = false,
  direct_grant_requires_expiry = true,
  grant_readiness = 'enforced',
  access_application_code = 'wms',
  updated_at = now();

create or replace function app_private.material_issue_payload_hash(p_payload jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select md5(coalesce(p_payload, 'null'::jsonb)::text);
$$;

create or replace function app_private.material_issue_pending_return_qty(
  p_order_id uuid,
  p_issue_line_id uuid,
  p_exclude_return_id uuid default null
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(return_line.return_qty), 0)::numeric
  from public.material_issue_returns material_return
  join public.material_issue_return_lines return_line
    on return_line.issue_return_id = material_return.id
  where material_return.issue_order_id = p_order_id
    and material_return.status = 'pending'
    and return_line.issue_line_id = p_issue_line_id
    and (p_exclude_return_id is null or material_return.id <> p_exclude_return_id);
$$;

create or replace function app_private.material_issue_returnable_qty(
  p_order_id uuid,
  p_issue_line_id uuid,
  p_exclude_return_id uuid default null
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    issue_line.issued_qty
      - issue_line.returned_qty
      - issue_line.consumed_qty
      - issue_line.lost_qty
      - app_private.material_issue_pending_return_qty(
          p_order_id,
          p_issue_line_id,
          p_exclude_return_id
        ),
    0
  )::numeric
  from public.material_issue_lines issue_line
  where issue_line.id = p_issue_line_id
    and issue_line.issue_order_id = p_order_id;
$$;

create or replace function app_private.material_issue_actor_can_reverse(
  p_actor_id uuid,
  p_source_warehouse_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from jsonb_array_elements(
      app_private.resolve_authorization_snapshot(p_actor_id) -> 'sources'
    ) source(value)
    where source.value ->> 'permissionCode' = 'wms.transaction.reverse'
      and upper(coalesce(source.value ->> 'sourceType', '')) <> 'LEGACY'
      and (
        source.value ->> 'scopeType' = 'global'
        or (
          source.value ->> 'scopeType' = 'warehouse'
          and source.value ->> 'scopeId' in ('*', p_source_warehouse_id)
        )
      )
  );
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
  v_transaction_id text := 'tx-material-return-' || replace(gen_random_uuid()::text, '-', '');
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
  if not app_private.material_issue_can_process(
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
    'Hoàn trả vật tư từ ' || v_order.recipient_name || ' theo phiếu ' || v_order.issue_no,
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
    do update set status = excluded.status,
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
    do update set status = excluded.status,
      metadata = excluded.metadata,
      updated_at = now();
  end if;

  return v_result;
end;
$$;

create or replace function public.create_material_issue_return_v2(
  p_order_id uuid,
  p_target_warehouse_id text,
  p_lines jsonb,
  p_reason text,
  p_note text,
  p_idempotency_key text
)
returns public.material_issue_returns
language sql
security definer
set search_path = ''
as $$
  select app_private.create_material_issue_return_v2_impl(
    public.current_app_user_id(), p_order_id, p_target_warehouse_id, p_lines,
    p_reason, p_note, p_idempotency_key
  );
$$;

create or replace function public.create_material_issue_return(
  p_order_id uuid,
  p_target_warehouse_id text,
  p_lines jsonb,
  p_reason text,
  p_note text default null
)
returns public.material_issue_returns
language sql
security definer
set search_path = ''
as $$
  select app_private.create_material_issue_return_v2_impl(
    public.current_app_user_id(), p_order_id, p_target_warehouse_id, p_lines,
    p_reason, p_note,
    'legacy-return:' || replace(gen_random_uuid()::text, '-', '')
  );
$$;

create or replace function app_private.sync_material_issue_from_transaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_order_id uuid;
  v_line_id uuid;
  v_return_id uuid;
  v_qty numeric;
  v_available numeric;
  v_expected_qty numeric;
  v_order public.material_issue_orders%rowtype;
  v_issue_line public.material_issue_lines%rowtype;
  v_return public.material_issue_returns%rowtype;
begin
  if new.status = old.status then return new; end if;

  for v_item in select value from jsonb_array_elements(coalesce(new.items, '[]'::jsonb))
  loop
    v_order_id := nullif(v_item ->> 'materialIssueOrderId', '')::uuid;
    v_line_id := nullif(v_item ->> 'materialIssueLineId', '')::uuid;
    v_return_id := nullif(v_item ->> 'materialIssueReturnId', '')::uuid;
    v_qty := coalesce(nullif(v_item ->> 'quantity', '')::numeric, 0);
    if v_order_id is null or v_line_id is null or v_qty <= 0 then continue; end if;

    select * into v_order
    from public.material_issue_orders
    where id = v_order_id
    for update;
    if not found then raise exception 'Không tìm thấy phiếu xuất cấp của giao dịch kho.'; end if;

    select * into v_issue_line
    from public.material_issue_lines
    where id = v_line_id and issue_order_id = v_order_id
    for update;
    if not found then raise exception 'Không tìm thấy dòng phiếu xuất cấp của giao dịch kho.'; end if;

    if v_return_id is null then
      if new.status = 'COMPLETED' and old.status <> 'COMPLETED' then
        update public.material_issue_lines
        set issued_qty = greatest(issued_qty, v_qty)
        where id = v_line_id;

        update public.material_issue_orders
        set status = 'issued',
            issued_by = coalesce(new.approver_id, public.current_app_user_id()),
            issued_at = coalesce(issued_at, now())
        where id = v_order_id and status in ('wms_pending', 'submitted', 'draft');

        insert into public.material_party_ledger(
          issue_order_id, issue_line_id, source_document_type, source_document_id,
          ledger_type, project_id, construction_site_id, recipient_type,
          recipient_id, recipient_name, item_id, item_name_snapshot, unit,
          quantity_delta, reason, metadata, created_by
        ) values (
          v_order_id, v_line_id, 'transaction', new.id, 'issue',
          v_order.project_id, v_order.construction_site_id,
          v_order.recipient_type, v_order.recipient_id, v_order.recipient_name,
          v_issue_line.item_id, v_issue_line.item_name_snapshot,
          v_issue_line.unit, v_qty, new.note,
          jsonb_build_object('transactionType', new.type),
          coalesce(new.approver_id, public.current_app_user_id())
        ) on conflict do nothing;

        perform app_private.material_issue_refresh_status(v_order_id);
      elsif new.status = 'CANCELLED' and old.status <> 'CANCELLED' then
        update public.material_issue_orders
        set status = 'rejected',
            cancel_reason = coalesce(cancel_reason, 'Phiếu kho xuất cấp bị từ chối/hủy.')
        where id = v_order_id and status = 'wms_pending';
      end if;
    else
      select * into v_return
      from public.material_issue_returns
      where id = v_return_id
        and issue_order_id = v_order_id
        and transaction_id = new.id
      for update;
      if not found then raise exception 'Không tìm thấy phiếu hoàn của giao dịch kho.'; end if;

      if new.status = 'COMPLETED' and old.status <> 'COMPLETED' then
        select return_qty into v_expected_qty
        from public.material_issue_return_lines
        where issue_return_id = v_return_id
          and issue_line_id = v_line_id
        for update;
        if not found or v_expected_qty is distinct from v_qty then
          raise exception 'Số lượng WMS không khớp phiếu hoàn.';
        end if;

        v_available := greatest(
          v_issue_line.issued_qty
            - v_issue_line.returned_qty
            - v_issue_line.consumed_qty
            - v_issue_line.lost_qty
            - app_private.material_issue_pending_return_qty(
                v_order_id,
                v_line_id,
                v_return_id
              ),
          0
        );
        if v_qty > v_available then
          raise exception 'Số lượng hoàn trả không còn khả dụng.';
        end if;

        update public.material_issue_lines
        set returned_qty = returned_qty + v_qty
        where id = v_line_id;

        update public.material_issue_returns
        set status = 'completed',
            completed_by = coalesce(new.approver_id, public.current_app_user_id()),
            completed_at = coalesce(completed_at, now())
        where id = v_return_id and status = 'pending';

        insert into public.material_party_ledger(
          issue_order_id, issue_line_id, source_document_type, source_document_id,
          ledger_type, project_id, construction_site_id, recipient_type,
          recipient_id, recipient_name, item_id, item_name_snapshot, unit,
          quantity_delta, reason, metadata, created_by
        ) values (
          v_order_id, v_line_id, 'material_issue_return', v_return_id::text,
          'return', v_order.project_id, v_order.construction_site_id,
          v_order.recipient_type, v_order.recipient_id, v_order.recipient_name,
          v_issue_line.item_id, v_issue_line.item_name_snapshot,
          v_issue_line.unit, -v_qty, v_return.reason,
          jsonb_build_object(
            'transactionId', new.id,
            'returnKind', v_return.return_kind
          ),
          coalesce(new.approver_id, public.current_app_user_id())
        ) on conflict do nothing;

        perform app_private.material_issue_refresh_status(v_order_id);
      elsif new.status = 'CANCELLED' and old.status <> 'CANCELLED' then
        update public.material_issue_returns
        set status = 'cancelled', cancelled_at = now()
        where id = v_return_id and status = 'pending';
      end if;
    end if;
  end loop;

  return new;
end;
$$;

create or replace function app_private.material_issue_refresh_status(p_order_id uuid)
returns public.material_issue_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.material_issue_orders%rowtype;
  v_total_issued numeric;
  v_total_received numeric;
  v_total_open numeric;
  v_next_status text;
begin
  select * into v_order
  from public.material_issue_orders
  where id = p_order_id
  for update;
  if not found then raise exception 'Không tìm thấy phiếu xuất cấp.'; end if;
  if v_order.status in (
    'draft', 'submitted', 'wms_pending', 'rejected', 'cancelled', 'reversed'
  ) then
    return v_order;
  end if;

  select
    coalesce(sum(issued_qty), 0),
    coalesce(sum(received_qty), 0),
    coalesce(sum(greatest(
      issued_qty - consumed_qty - returned_qty - lost_qty,
      0
    )), 0)
  into v_total_issued, v_total_received, v_total_open
  from public.material_issue_lines
  where issue_order_id = p_order_id;

  if v_total_issued <= 0 then v_next_status := 'wms_pending';
  elsif v_total_open = 0 then v_next_status := 'closed';
  elsif v_total_received >= v_total_issued then v_next_status := 'received';
  elsif v_total_received > 0 then v_next_status := 'partially_received';
  elsif exists (
    select 1 from public.material_issue_lines
    where issue_order_id = p_order_id and returned_qty > 0
  ) then v_next_status := 'partially_returned';
  else v_next_status := 'issued';
  end if;

  update public.material_issue_orders
  set status = v_next_status,
      closed_by = case
        when v_next_status = 'closed' then coalesce(closed_by, public.current_app_user_id())
        else null
      end,
      closed_at = case
        when v_next_status = 'closed' then coalesce(closed_at, now())
        else null
      end
  where id = p_order_id
  returning * into v_order;
  return v_order;
end;
$$;

create or replace function app_private.sync_material_issue_document_links(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.material_issue_orders%rowtype;
  v_link_status text;
begin
  if to_regclass('public.project_document_links') is null then return; end if;
  select * into v_order from public.material_issue_orders where id = p_order_id;
  if not found then return; end if;

  v_link_status := case
    when v_order.status in ('closed', 'cancelled', 'rejected', 'reversed')
      then 'reversed'
    else 'active'
  end;

  update public.project_document_links
  set status = v_link_status,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'materialIssueStatus', v_order.status,
        'settledAt', case when v_order.status = 'closed' then now() else null end,
        'reversedAt', case when v_order.status = 'reversed' then now() else null end
      ),
      updated_at = now()
  where (
      source_type = 'material_request'
      and source_id = coalesce(v_order.material_request_id, '')
      and target_type = 'material_issue_order'
      and target_id = v_order.id::text
    ) or (
      source_type = 'material_issue_order'
      and source_id = v_order.id::text
    ) or (
      source_type = 'subcontractor_contract'
      and source_id = coalesce(v_order.subcontractor_contract_id, '')
      and target_type = 'material_issue_order'
      and target_id = v_order.id::text
    );
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
  if not app_private.material_issue_can_process(
    v_order.source_warehouse_id, v_order.created_by, v_order.responsible_user_id,
    v_order.recipient_type, v_order.recipient_id
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

alter function app_private.sync_wms_transaction_to_inventory_ledger(text)
  rename to sync_wms_transaction_to_inventory_ledger_pre_reversal_20260905;

create or replace function app_private.sync_wms_transaction_to_inventory_ledger(
  p_transaction_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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

  v_code := app_private.next_inventory_ledger_code('in');
  v_tx_date := coalesce(nullif(v_tx.date::text, '')::timestamptz, now());
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
$$;

create or replace function app_private.complete_material_issue_reversal_transaction(
  p_transaction_id text,
  p_actor_id uuid
)
returns public.transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transaction public.transactions%rowtype;
  v_item jsonb;
  v_item_id text;
  v_qty numeric;
begin
  select * into v_transaction
  from public.transactions
  where id = p_transaction_id
  for update;
  if not found then raise exception 'Không tìm thấy chứng từ đảo WMS.'; end if;
  if v_transaction.status = 'COMPLETED' then return v_transaction; end if;
  if v_transaction.status <> 'PENDING'
     or v_transaction.type <> 'IMPORT'
     or v_transaction.business_event_type <> 'reversal'
     or v_transaction.reversal_of_transaction_id is null then
    raise exception 'Chứng từ WMS không đủ điều kiện hoàn tất đảo.';
  end if;

  for v_item in
    select payload.value
    from jsonb_array_elements(coalesce(v_transaction.items, '[]'::jsonb)) payload(value)
    order by payload.value ->> 'itemId', payload.value ->> 'materialIssueLineId'
  loop
    v_item_id := v_item ->> 'itemId';
    v_qty := coalesce(nullif(v_item ->> 'quantity', '')::numeric, 0);
    if v_item_id is null or v_qty <= 0 then
      raise exception 'Dòng chứng từ đảo WMS không hợp lệ.';
    end if;
    perform public.apply_stock_change(
      v_item_id,
      v_transaction.target_warehouse_id,
      v_qty
    );
  end loop;

  update public.transactions
  set status = 'COMPLETED',
      approver_id = p_actor_id,
      approved_at = now(),
      approval_note = 'Hoàn tất tự động trong lệnh đảo phiếu xuất.'
  where id = p_transaction_id
  returning * into v_transaction;
  return v_transaction;
end;
$$;

create or replace function app_private.reverse_material_issue_approval_v1_impl(
  p_actor_id uuid,
  p_order_id uuid,
  p_reason text,
  p_idempotency_key text
)
returns public.material_issue_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.material_issue_orders%rowtype;
  v_original_transaction public.transactions%rowtype;
  v_existing_return public.material_issue_returns%rowtype;
  v_return_id uuid := gen_random_uuid();
  v_transaction_id text := 'tx-material-issue-reversal-'
    || replace(gen_random_uuid()::text, '-', '');
  v_return_no text;
  v_payload_hash text;
  v_items jsonb := '[]'::jsonb;
  v_issue_line public.material_issue_lines%rowtype;
begin
  if p_actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Bắt buộc nhập lý do hủy duyệt.';
  end if;
  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'Thiếu khóa chống ghi lặp.';
  end if;

  select * into v_order
  from public.material_issue_orders
  where id = p_order_id
  for update;
  if not found then raise exception 'Không tìm thấy phiếu xuất cấp.'; end if;

  if not app_private.material_issue_actor_can_reverse(
    p_actor_id,
    v_order.source_warehouse_id
  ) then
    raise exception 'Bạn không có quyền hủy duyệt phiếu xuất tại kho này.'
      using errcode = '42501';
  end if;

  v_payload_hash := app_private.material_issue_payload_hash(jsonb_build_object(
    'orderId', p_order_id,
    'reason', btrim(p_reason),
    'stockNeverLeftWarehouse', true
  ));
  select * into v_existing_return
  from public.material_issue_returns
  where idempotency_key = btrim(p_idempotency_key)
  for update;
  if found then
    if v_existing_return.issue_order_id is distinct from p_order_id
       or v_existing_return.return_kind <> 'approval_reversal'
       or v_existing_return.metadata ->> 'payloadHash' is distinct from v_payload_hash then
      raise exception 'MATERIAL_ISSUE_IDEMPOTENCY_CONFLICT' using errcode = '22023';
    end if;
    if v_existing_return.status <> 'completed' or v_order.status <> 'reversed' then
      raise exception 'Chứng từ đảo idempotent chưa ở trạng thái hoàn tất.';
    end if;
    return v_order;
  end if;

  if v_order.status <> 'issued' then
    raise exception 'Chỉ hủy duyệt phiếu đang ở trạng thái đã xuất.';
  end if;
  if nullif(v_order.transaction_id, '') is null then
    raise exception 'Phiếu xuất cấp không có giao dịch WMS gốc.';
  end if;

  select * into v_original_transaction
  from public.transactions
  where id = v_order.transaction_id
  for update;
  if not found
     or v_original_transaction.type <> 'EXPORT'
     or v_original_transaction.status <> 'COMPLETED' then
    raise exception 'Giao dịch WMS gốc chưa phải phiếu xuất đã hoàn tất.';
  end if;

  perform receipt.id
  from public.material_issue_receipts receipt
  where receipt.issue_order_id = p_order_id
  order by receipt.id
  for update;
  perform material_return.id
  from public.material_issue_returns material_return
  where material_return.issue_order_id = p_order_id
  order by material_return.id
  for update;
  perform settlement.id
  from public.material_issue_settlements settlement
  where settlement.issue_order_id = p_order_id
  order by settlement.id
  for update;

  if exists (
    select 1 from public.material_issue_receipts
    where issue_order_id = p_order_id and status = 'confirmed'
  ) or exists (
    select 1 from public.material_issue_lines
    where issue_order_id = p_order_id and received_qty > 0
  ) then
    raise exception 'Hàng đã được xác nhận nhận; hãy dùng luồng nhập hoàn.';
  end if;
  if exists (
    select 1 from public.material_issue_returns
    where issue_order_id = p_order_id and status in ('pending', 'completed')
  ) or exists (
    select 1 from public.material_issue_lines
    where issue_order_id = p_order_id and returned_qty > 0
  ) then
    raise exception 'Phiếu đã phát sinh nhập hoàn; không thể hủy duyệt.';
  end if;
  if exists (
    select 1 from public.material_issue_settlements
    where issue_order_id = p_order_id and status = 'posted'
  ) or exists (
    select 1 from public.material_issue_lines
    where issue_order_id = p_order_id and (consumed_qty > 0 or lost_qty > 0)
  ) then
    raise exception 'Phiếu đã phát sinh sử dụng hoặc hao hụt; không thể hủy duyệt.';
  end if;
  if exists (
    select 1 from public.transactions
    where reversal_of_transaction_id = v_original_transaction.id
      and status <> 'CANCELLED'
  ) then
    raise exception 'Phiếu xuất đã có chứng từ đảo.';
  end if;
  if not exists (
    select 1 from public.material_issue_lines where issue_order_id = p_order_id
  ) or exists (
    select 1 from public.material_issue_lines
    where issue_order_id = p_order_id
      and (
        issued_qty <= 0
        or received_qty <> 0
        or returned_qty <> 0
        or consumed_qty <> 0
        or lost_qty <> 0
      )
  ) then
    raise exception 'Dòng phiếu xuất không còn nguyên trạng để hủy duyệt.';
  end if;

  for v_issue_line in
    select *
    from public.material_issue_lines
    where issue_order_id = p_order_id
    order by id
    for update
  loop
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'itemId', v_issue_line.item_id,
      'quantity', v_issue_line.issued_qty,
      'price', v_issue_line.unit_price,
      'materialIssueOrderId', p_order_id,
      'materialIssueLineId', v_issue_line.id,
      'materialIssueReturnId', v_return_id,
      'recipientType', v_order.recipient_type,
      'recipientNameSnapshot', v_order.recipient_name
    ));
  end loop;

  v_return_no := 'MREV-' || to_char(now(), 'YYYYMMDD') || '-'
    || upper(substr(replace(v_return_id::text, '-', ''), 1, 6));

  insert into public.transactions(
    id, type, date, items, source_warehouse_id, target_warehouse_id,
    requester_id, approver_id, status, note, related_request_id, pending_items,
    source_type, source_id, business_event_type, business_event_reason,
    reversal_of_transaction_id, idempotency_key
  ) values (
    v_transaction_id, 'IMPORT', now(), v_items, null,
    v_order.source_warehouse_id, p_actor_id, null, 'PENDING',
    'Đảo phiếu xuất ' || v_original_transaction.id || ': ' || btrim(p_reason),
    v_order.material_request_id, '[]'::jsonb,
    'material_issue_approval_reversal', p_order_id::text, 'reversal',
    btrim(p_reason), v_original_transaction.id, btrim(p_idempotency_key)
  );

  insert into public.material_issue_returns(
    id, issue_order_id, return_no, return_kind, target_warehouse_id, status,
    transaction_id, reason, note, idempotency_key, metadata, created_by
  ) values (
    v_return_id, p_order_id, v_return_no, 'approval_reversal',
    v_order.source_warehouse_id, 'pending', v_transaction_id, btrim(p_reason),
    'Hủy duyệt vì xác nhận hàng chưa rời kho.', btrim(p_idempotency_key),
    jsonb_build_object(
      'payloadHash', v_payload_hash,
      'stockNeverLeftWarehouse', true,
      'originalTransactionId', v_original_transaction.id,
      'returnKind', 'approval_reversal'
    ), p_actor_id
  );

  for v_issue_line in
    select * from public.material_issue_lines
    where issue_order_id = p_order_id
    order by id
  loop
    insert into public.material_issue_return_lines(
      issue_return_id, issue_line_id, item_id, return_qty, unit, reason
    ) values (
      v_return_id, v_issue_line.id, v_issue_line.item_id,
      v_issue_line.issued_qty, v_issue_line.unit, btrim(p_reason)
    );
  end loop;

  if to_regclass('public.project_document_links') is not null then
    insert into public.project_document_links(
      source_type, source_id, target_type, target_id, project_id,
      relation_type, status, metadata
    ) values (
      'material_issue_order', p_order_id::text, 'material_issue_return',
      v_return_id::text, v_order.project_id, 'downstream', 'active',
      jsonb_build_object(
        'kind', 'approval_reversal',
        'transactionId', v_transaction_id
      )
    ) on conflict (source_type, source_id, target_type, target_id, relation_type)
      do update set metadata = excluded.metadata, updated_at = now();

    insert into public.project_document_links(
      source_type, source_id, target_type, target_id, project_id,
      relation_type, status, metadata
    ) values (
      'material_issue_order', p_order_id::text, 'transaction',
      v_transaction_id, v_order.project_id, 'downstream', 'active',
      jsonb_build_object(
        'kind', 'approval_reversal',
        'reversalOfTransactionId', v_original_transaction.id
      )
    ) on conflict (source_type, source_id, target_type, target_id, relation_type)
      do update set metadata = excluded.metadata, updated_at = now();
  end if;

  perform app_private.complete_material_issue_reversal_transaction(
    v_transaction_id,
    p_actor_id
  );

  update public.material_issue_orders
  set status = 'reversed', closed_by = null, closed_at = null, updated_at = now()
  where id = p_order_id
  returning * into v_order;
  return v_order;
end;
$$;

create or replace function public.reverse_material_issue_approval_v1(
  p_order_id uuid,
  p_reason text,
  p_idempotency_key text
)
returns public.material_issue_orders
language sql
security definer
set search_path = ''
as $$
  select app_private.reverse_material_issue_approval_v1_impl(
    public.current_app_user_id(), p_order_id, p_reason, p_idempotency_key
  );
$$;

revoke all on function app_private.material_issue_payload_hash(jsonb)
  from public, anon, authenticated;
revoke all on function app_private.material_issue_pending_return_qty(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function app_private.material_issue_returnable_qty(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function app_private.material_issue_actor_can_reverse(uuid, text)
  from public, anon, authenticated;
revoke all on function app_private.create_material_issue_return_v2_impl(
  uuid, uuid, text, jsonb, text, text, text
) from public, anon, authenticated;
revoke all on function app_private.complete_material_issue_reversal_transaction(text, uuid)
  from public, anon, authenticated;
revoke all on function app_private.reverse_material_issue_approval_v1_impl(
  uuid, uuid, text, text
) from public, anon, authenticated;
revoke all on function app_private.sync_wms_transaction_to_inventory_ledger(text)
  from public, anon, authenticated;

revoke all on function public.create_material_issue_return_v2(
  uuid, text, jsonb, text, text, text
) from public, anon;
grant execute on function public.create_material_issue_return_v2(
  uuid, text, jsonb, text, text, text
) to authenticated, service_role;

revoke all on function public.reverse_material_issue_approval_v1(uuid, text, text)
  from public, anon;
grant execute on function public.reverse_material_issue_approval_v1(uuid, text, text)
  to authenticated, service_role;

revoke all on function public.create_material_issue_return(
  uuid, text, jsonb, text, text
) from public, anon;
grant execute on function public.create_material_issue_return(
  uuid, text, jsonb, text, text
) to authenticated, service_role;
