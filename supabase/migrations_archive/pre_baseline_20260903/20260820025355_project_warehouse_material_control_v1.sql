-- Project warehouse material control V1
-- Scope is resolved from the physical warehouse. BOQ actual use is resolved
-- from material-party events, never from purchase/request projections.

create extension if not exists pgcrypto;
create schema if not exists app_private;

alter table public.warehouses
  add column if not exists project_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'warehouses_project_id_fkey'
      and conrelid = 'public.warehouses'::regclass
  ) then
    alter table public.warehouses
      add constraint warehouses_project_id_fkey
      foreign key (project_id) references public.projects(id) on delete restrict;
  end if;
end $$;

create table if not exists public.material_issue_settlements (
  id uuid primary key default gen_random_uuid(),
  settlement_no text not null unique,
  issue_order_id uuid not null references public.material_issue_orders(id) on delete restrict,
  settlement_type text not null check (settlement_type in ('consume', 'loss')),
  settlement_date date not null,
  status text not null default 'posted' check (status in ('posted', 'reversed')),
  reason text not null,
  attachments jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  reversal_of_settlement_id uuid null references public.material_issue_settlements(id) on delete restrict,
  created_by uuid null references public.users(id) on delete set null,
  approved_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  reversed_at timestamptz null,
  reversal_reason text null
);

create table if not exists public.material_issue_settlement_lines (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.material_issue_settlements(id) on delete restrict,
  issue_line_id uuid not null references public.material_issue_lines(id) on delete restrict,
  item_id text not null,
  quantity numeric(18, 4) not null check (quantity > 0),
  work_boq_item_id text null,
  note text null,
  created_at timestamptz not null default now(),
  unique(settlement_id, issue_line_id)
);

create index if not exists idx_material_issue_settlements_order_date
  on public.material_issue_settlements(issue_order_id, status, settlement_date, created_at);
create index if not exists idx_material_issue_settlements_reversal
  on public.material_issue_settlements(reversal_of_settlement_id)
  where reversal_of_settlement_id is not null;
create index if not exists idx_material_issue_settlement_lines_issue_line
  on public.material_issue_settlement_lines(issue_line_id, settlement_id);
create index if not exists idx_material_party_ledger_project_item_date
  on public.material_party_ledger(project_id, item_id, created_at, ledger_type);
create index if not exists idx_material_budget_items_project_inventory
  on public.material_budget_items(project_id, inventory_item_id);

alter table public.material_issue_settlements enable row level security;
alter table public.material_issue_settlement_lines enable row level security;

drop policy if exists material_issue_settlements_select on public.material_issue_settlements;
create policy material_issue_settlements_select
on public.material_issue_settlements
for select to authenticated
using (
  exists (
    select 1 from public.material_issue_orders issue_order
    where issue_order.id = issue_order_id
      and app_private.material_issue_can_view(
        issue_order.project_id, issue_order.construction_site_id,
        issue_order.source_warehouse_id, issue_order.created_by,
        issue_order.responsible_user_id, issue_order.recipient_type,
        issue_order.recipient_id
      )
  )
);

drop policy if exists material_issue_settlement_lines_select on public.material_issue_settlement_lines;
create policy material_issue_settlement_lines_select
on public.material_issue_settlement_lines
for select to authenticated
using (
  exists (
    select 1
    from public.material_issue_settlements settlement
    join public.material_issue_orders issue_order on issue_order.id = settlement.issue_order_id
    where settlement.id = settlement_id
      and app_private.material_issue_can_view(
        issue_order.project_id, issue_order.construction_site_id,
        issue_order.source_warehouse_id, issue_order.created_by,
        issue_order.responsible_user_id, issue_order.recipient_type,
        issue_order.recipient_id
      )
  )
);

revoke all on table public.material_issue_settlements from public, anon, authenticated;
revoke all on table public.material_issue_settlement_lines from public, anon, authenticated;
grant select on table public.material_issue_settlements to authenticated;
grant select on table public.material_issue_settlement_lines to authenticated;

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
  select * into v_settlement
  from public.material_issue_settlements
  where idempotency_key = p_idempotency_key;
  if found then return v_settlement; end if;

  select * into v_order from public.material_issue_orders
  where id = p_order_id for update;
  if not found then raise exception 'Không tìm thấy phiếu xuất cấp.'; end if;
  if v_order.status not in ('issued', 'partially_received', 'received', 'settling', 'partially_returned') then
    raise exception 'Phiếu chưa sẵn sàng quyết toán.';
  end if;
  if not app_private.material_issue_can_process(
    v_order.source_warehouse_id, v_order.created_by, v_order.responsible_user_id,
    v_order.recipient_type, v_order.recipient_id
  ) then
    raise exception 'Bạn không có quyền quyết toán phiếu này.';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Chứng từ quyết toán chưa có dòng vật tư.';
  end if;

  insert into public.material_issue_settlements(
    id, settlement_no, issue_order_id, settlement_type, settlement_date,
    status, reason, attachments, idempotency_key, created_by, approved_by
  ) values (
    v_settlement_id,
    'MIS-' || to_char(coalesce(p_settlement_date, (now() at time zone 'Asia/Ho_Chi_Minh')::date), 'YYYYMMDD')
      || '-' || upper(substr(replace(v_settlement_id::text, '-', ''), 1, 8)),
    p_order_id, p_settlement_type,
    coalesce(p_settlement_date, (now() at time zone 'Asia/Ho_Chi_Minh')::date),
    'posted', btrim(p_reason), coalesce(p_attachments, '[]'::jsonb),
    btrim(p_idempotency_key), v_actor, v_actor
  ) returning * into v_settlement;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_qty := coalesce(nullif(v_line->>'quantity', '')::numeric, 0);
    if v_qty <= 0 then raise exception 'Số lượng quyết toán phải lớn hơn 0.'; end if;
    select * into v_issue_line from public.material_issue_lines
    where id = (v_line->>'issueLineId')::uuid
      and issue_order_id = p_order_id
    for update;
    if not found then raise exception 'Không tìm thấy dòng phiếu xuất cấp.'; end if;
    v_available := v_issue_line.issued_qty - v_issue_line.returned_qty
      - v_issue_line.consumed_qty - v_issue_line.lost_qty;
    if v_qty > v_available then
      raise exception 'Số lượng quyết toán vượt số lượng còn lại.';
    end if;

    insert into public.material_issue_settlement_lines(
      settlement_id, issue_line_id, item_id, quantity, work_boq_item_id, note
    ) values (
      v_settlement_id, v_issue_line.id, v_issue_line.item_id, v_qty,
      nullif(v_line->>'workBoqItemId', ''), nullif(btrim(coalesce(v_line->>'note', '')), '')
    );
    if p_settlement_type = 'consume' then
      update public.material_issue_lines
      set consumed_qty = consumed_qty + v_qty where id = v_issue_line.id;
    else
      update public.material_issue_lines
      set lost_qty = lost_qty + v_qty where id = v_issue_line.id;
    end if;
    insert into public.material_party_ledger(
      issue_order_id, issue_line_id, source_document_type, source_document_id,
      ledger_type, project_id, construction_site_id, recipient_type, recipient_id,
      recipient_name, item_id, item_name_snapshot, unit, quantity_delta, reason,
      metadata, created_by
    ) values (
      p_order_id, v_issue_line.id, 'material_issue_settlement', v_settlement_id::text,
      p_settlement_type, v_order.project_id, v_order.construction_site_id,
      v_order.recipient_type, v_order.recipient_id, v_order.recipient_name,
      v_issue_line.item_id, v_issue_line.item_name_snapshot, v_issue_line.unit,
      -v_qty, btrim(p_reason),
      jsonb_build_object('settlementId', v_settlement_id, 'attachments', coalesce(p_attachments, '[]'::jsonb)),
      v_actor
    );
  end loop;
  update public.material_issue_orders set status = 'settling'
  where id = p_order_id and status not in ('closed', 'cancelled');
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
  select * into v_reversal from public.material_issue_settlements
  where idempotency_key = p_idempotency_key;
  if found then return v_reversal; end if;

  select * into v_original from public.material_issue_settlements
  where id = p_settlement_id for update;
  if not found then raise exception 'Không tìm thấy chứng từ quyết toán.'; end if;
  if v_original.status <> 'posted' or v_original.reversal_of_settlement_id is not null then
    raise exception 'Chứng từ quyết toán không còn đủ điều kiện hoàn tác.';
  end if;
  select * into v_order from public.material_issue_orders
  where id = v_original.issue_order_id for update;
  if not app_private.material_issue_can_process(
    v_order.source_warehouse_id, v_order.created_by, v_order.responsible_user_id,
    v_order.recipient_type, v_order.recipient_id
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
    (now() at time zone 'Asia/Ho_Chi_Minh')::date, 'posted', btrim(p_reason), '[]'::jsonb,
    jsonb_build_object('reversalOfSettlementId', v_original.id),
    btrim(p_idempotency_key), v_original.id, v_actor, v_actor
  ) returning * into v_reversal;

  for v_line in
    select * from public.material_issue_settlement_lines
    where settlement_id = v_original.id order by created_at, id
  loop
    select * into v_issue_line from public.material_issue_lines
    where id = v_line.issue_line_id for update;
    if v_original.settlement_type = 'consume' then
      if v_issue_line.consumed_qty < v_line.quantity then
        raise exception 'Không thể hoàn tác làm số đã dùng âm.';
      end if;
      update public.material_issue_lines
      set consumed_qty = consumed_qty - v_line.quantity where id = v_issue_line.id;
    else
      if v_issue_line.lost_qty < v_line.quantity then
        raise exception 'Không thể hoàn tác làm số hao hụt âm.';
      end if;
      update public.material_issue_lines
      set lost_qty = lost_qty - v_line.quantity where id = v_issue_line.id;
    end if;
    insert into public.material_issue_settlement_lines(
      settlement_id, issue_line_id, item_id, quantity, work_boq_item_id, note
    ) values (
      v_reversal_id, v_line.issue_line_id, v_line.item_id, v_line.quantity,
      v_line.work_boq_item_id, 'Hoàn tác: ' || btrim(p_reason)
    );
    insert into public.material_party_ledger(
      issue_order_id, issue_line_id, source_document_type, source_document_id,
      ledger_type, project_id, construction_site_id, recipient_type, recipient_id,
      recipient_name, item_id, item_name_snapshot, unit, quantity_delta, reason,
      metadata, created_by
    ) values (
      v_order.id, v_issue_line.id, 'material_issue_settlement_reversal', v_reversal_id::text,
      v_original.settlement_type, v_order.project_id, v_order.construction_site_id,
      v_order.recipient_type, v_order.recipient_id, v_order.recipient_name,
      v_issue_line.item_id, v_issue_line.item_name_snapshot, v_issue_line.unit,
      v_line.quantity, btrim(p_reason),
      jsonb_build_object('reversalOfSettlementId', v_original.id), v_actor
    );
  end loop;
  update public.material_issue_settlements set
    status = 'reversed', reversed_at = now(), reversal_reason = btrim(p_reason)
  where id = v_original.id;
  perform app_private.material_issue_refresh_status(v_order.id);
  return v_reversal;
end;
$$;

create or replace function public.record_material_issue_settlement(
  p_order_id uuid,
  p_settlement_type text,
  p_lines jsonb,
  p_reason text,
  p_attachments jsonb default '[]'::jsonb
)
returns public.material_issue_orders
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.post_material_issue_settlement_v1(
    p_order_id, p_settlement_type,
    (now() at time zone 'Asia/Ho_Chi_Minh')::date,
    p_lines, p_reason,
    'compat:' || gen_random_uuid()::text,
    p_attachments
  );
  return (select issue_order from public.material_issue_orders issue_order where issue_order.id = p_order_id);
end;
$$;

revoke all on function public.post_material_issue_settlement_v1(uuid, text, date, jsonb, text, text, jsonb) from public, anon;
grant execute on function public.post_material_issue_settlement_v1(uuid, text, date, jsonb, text, text, jsonb) to authenticated;
revoke all on function public.reverse_material_issue_settlement_v1(uuid, text, text) from public, anon;
grant execute on function public.reverse_material_issue_settlement_v1(uuid, text, text) to authenticated;

-- Materialize existing consume/loss events as legacy audit documents only.
-- Counters and party-ledger deltas are intentionally left untouched.
insert into public.material_issue_settlements(
  id, settlement_no, issue_order_id, settlement_type, settlement_date,
  status, reason, attachments, metadata, idempotency_key,
  created_by, approved_by, created_at
)
select
  gen_random_uuid(),
  'MIS-LEGACY-' || upper(substr(replace(party_entry.id::text, '-', ''), 1, 12)),
  party_entry.issue_order_id,
  party_entry.ledger_type,
  (party_entry.created_at at time zone 'Asia/Ho_Chi_Minh')::date,
  'posted', coalesce(nullif(party_entry.reason, ''), 'Dữ liệu quyết toán trước V1'),
  coalesce(party_entry.metadata->'attachments', '[]'::jsonb),
  jsonb_build_object(
    'legacyPartyLedgerId', party_entry.id,
    'legacySourceDocumentType', party_entry.source_document_type,
    'legacySourceDocumentId', party_entry.source_document_id
  ),
  'legacy:' || party_entry.id::text,
  party_entry.created_by, party_entry.created_by, party_entry.created_at
from public.material_party_ledger party_entry
where party_entry.ledger_type in ('consume', 'loss')
on conflict (idempotency_key) do nothing;

insert into public.material_issue_settlement_lines(
  settlement_id, issue_line_id, item_id, quantity, work_boq_item_id, note, created_at
)
select settlement.id, party_entry.issue_line_id, party_entry.item_id,
  abs(party_entry.quantity_delta), issue_line.work_boq_item_id,
  'Dòng quyết toán legacy; không cập nhật lại projection.', party_entry.created_at
from public.material_party_ledger party_entry
join public.material_issue_settlements settlement
  on settlement.idempotency_key = 'legacy:' || party_entry.id::text
join public.material_issue_lines issue_line on issue_line.id = party_entry.issue_line_id
where party_entry.ledger_type in ('consume', 'loss')
  and party_entry.quantity_delta <> 0
on conflict (settlement_id, issue_line_id) do nothing;

create or replace function public.get_project_material_boq_reconciliation(
  p_project_id text,
  p_construction_site_id text default null,
  p_report_date date default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  p_planned_progress_percent numeric default 0
)
returns table(
  inventory_item_id text,
  sku text,
  item_name text,
  unit text,
  total_boq_qty numeric,
  planned_progress_percent numeric,
  planned_qty_to_date numeric,
  request_po_receipt_qty numeric,
  proactive_po_receipt_qty numeric,
  site_hot_purchase_receipt_qty numeric,
  direct_supplier_receipt_qty numeric,
  direct_manual_receipt_qty numeric,
  transfer_receipt_qty numeric,
  gross_received_qty numeric,
  current_stock_qty numeric,
  construction_issued_qty numeric,
  project_returned_qty numeric,
  net_issued_qty numeric,
  confirmed_used_qty numeric,
  loss_after_issue_qty numeric,
  open_with_recipient_qty numeric,
  used_variance_to_plan numeric,
  used_variance_to_boq numeric,
  used_percent_of_boq numeric,
  data_quality_flags text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_report_date date := coalesce(p_report_date, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  v_end_at timestamptz;
  v_progress numeric := greatest(0, least(coalesce(p_planned_progress_percent, 0), 100));
begin
  if nullif(p_project_id, '') is null then raise exception 'Thiếu dự án đối chiếu.'; end if;
  if not (
    public.is_admin()
    or public.is_module_admin('DA')
    or app_private.project_scope_has_any_grant_v2(
      p_project_id, p_construction_site_id, public.current_app_user_id()
    )
    or app_private.material_has_any_action(
      p_project_id, p_construction_site_id,
      array['project.material.view', 'project.material_boq.view', 'project.material_boq.edit'],
      public.current_app_user_id()
    )
  ) then
    raise exception 'Bạn không có quyền xem đối chiếu vật tư dự án.';
  end if;
  v_end_at := ((v_report_date + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh');

  return query
  with mapped_boq as (
    select budget.inventory_item_id,
      sum(case
        when lower(btrim(budget.unit)) = lower(btrim(coalesce(item.unit, budget.unit)))
          then coalesce(budget.budget_qty, 0)
        else 0
      end)::numeric as boq_qty,
      bool_or(lower(btrim(budget.unit)) <> lower(btrim(coalesce(item.unit, budget.unit)))) as unit_mismatch,
      max(budget.item_name) as boq_name
    from public.material_budget_items budget
    left join public.items item on item.id = budget.inventory_item_id
    where budget.project_id = p_project_id
      and (p_construction_site_id is null or budget.construction_site_id = p_construction_site_id)
      and budget.inventory_item_id is not null
    group by budget.inventory_item_id
  ),
  unmapped_boq as (
    select
      'unmapped:' || lower(coalesce(nullif(btrim(budget.material_code), ''), btrim(budget.item_name)))
        || ':' || lower(btrim(budget.unit)) as row_key,
      max(budget.material_code) as sku,
      max(budget.item_name) as item_name,
      budget.unit,
      sum(coalesce(budget.budget_qty, 0))::numeric as boq_qty
    from public.material_budget_items budget
    where budget.project_id = p_project_id
      and (p_construction_site_id is null or budget.construction_site_id = p_construction_site_id)
      and budget.inventory_item_id is null
    group by
      lower(coalesce(nullif(btrim(budget.material_code), ''), btrim(budget.item_name))),
      budget.unit
  ),
  inventory_agg as (
    select entry.material_id,
      sum(entry.quantity_in) filter (where entry.movement_direction = 'in')::numeric as gross_received_qty,
      sum(entry.quantity_in) filter (where entry.business_event_type = 'request_po_receipt')::numeric as request_po_receipt_qty,
      sum(entry.quantity_in) filter (where entry.business_event_type = 'proactive_po_receipt')::numeric as proactive_po_receipt_qty,
      sum(entry.quantity_in) filter (where entry.business_event_type = 'site_hot_purchase_receipt')::numeric as site_hot_purchase_receipt_qty,
      sum(entry.quantity_in) filter (where entry.business_event_type = 'direct_supplier_receipt')::numeric as direct_supplier_receipt_qty,
      sum(entry.quantity_in) filter (where entry.business_event_type in ('direct_manual_receipt', 'legacy_direct_receipt'))::numeric as direct_manual_receipt_qty,
      sum(entry.quantity_in) filter (
        where entry.business_event_type = 'warehouse_transfer' and entry.movement_direction = 'in'
      )::numeric as transfer_receipt_qty,
      sum(entry.quantity_delta)::numeric as current_stock_qty,
      bool_or(entry.business_event_type in ('legacy_direct_receipt', 'legacy_direct_issue')) as has_legacy,
      bool_or(
        item.unit is not null and entry.unit is not null
        and lower(btrim(entry.unit)) <> lower(btrim(item.unit))
      ) as unit_mismatch
    from public.inventory_ledger_entries entry
    left join public.items item on item.id = entry.material_id
    where entry.project_id = p_project_id
      and (p_construction_site_id is null or entry.construction_site_id = p_construction_site_id)
      and entry.transaction_date < v_end_at
    group by entry.material_id
  ),
  party_agg as (
    select party_entry.item_id,
      sum(party_entry.quantity_delta) filter (where party_entry.ledger_type = 'issue')::numeric as issued_qty,
      -sum(party_entry.quantity_delta) filter (where party_entry.ledger_type = 'return')::numeric as returned_qty,
      -sum(party_entry.quantity_delta) filter (where party_entry.ledger_type = 'consume')::numeric as used_qty,
      -sum(party_entry.quantity_delta) filter (where party_entry.ledger_type = 'loss')::numeric as loss_qty,
      bool_or(
        item.unit is not null and party_entry.unit is not null
        and lower(btrim(party_entry.unit)) <> lower(btrim(item.unit))
      ) as unit_mismatch,
      max(party_entry.item_name_snapshot) as item_name_snapshot,
      max(party_entry.unit) as unit_snapshot
    from public.material_party_ledger party_entry
    left join public.items item on item.id = party_entry.item_id
    where party_entry.project_id = p_project_id
      and (p_construction_site_id is null or party_entry.construction_site_id = p_construction_site_id)
      and party_entry.created_at < v_end_at
    group by party_entry.item_id
  ),
  mapped_keys as (
    select mapped_boq.inventory_item_id as material_id from mapped_boq
    union select inventory_agg.material_id from inventory_agg
    union select party_agg.item_id from party_agg
  ),
  mapped_rows as (
    select key_row.material_id as inventory_item_id,
      item.sku,
      coalesce(item.name, mapped_boq.boq_name, party_agg.item_name_snapshot, key_row.material_id) as item_name,
      coalesce(item.unit, party_agg.unit_snapshot) as unit,
      coalesce(mapped_boq.boq_qty, 0)::numeric as total_boq_qty,
      coalesce(inventory_agg.request_po_receipt_qty, 0)::numeric as request_po_receipt_qty,
      coalesce(inventory_agg.proactive_po_receipt_qty, 0)::numeric as proactive_po_receipt_qty,
      coalesce(inventory_agg.site_hot_purchase_receipt_qty, 0)::numeric as site_hot_purchase_receipt_qty,
      coalesce(inventory_agg.direct_supplier_receipt_qty, 0)::numeric as direct_supplier_receipt_qty,
      coalesce(inventory_agg.direct_manual_receipt_qty, 0)::numeric as direct_manual_receipt_qty,
      coalesce(inventory_agg.transfer_receipt_qty, 0)::numeric as transfer_receipt_qty,
      coalesce(inventory_agg.gross_received_qty, 0)::numeric as gross_received_qty,
      coalesce(inventory_agg.current_stock_qty, 0)::numeric as current_stock_qty,
      coalesce(party_agg.issued_qty, 0)::numeric as construction_issued_qty,
      coalesce(party_agg.returned_qty, 0)::numeric as project_returned_qty,
      coalesce(party_agg.used_qty, 0)::numeric as confirmed_used_qty,
      coalesce(party_agg.loss_qty, 0)::numeric as loss_after_issue_qty,
      coalesce(mapped_boq.unit_mismatch, false)
        or coalesce(inventory_agg.unit_mismatch, false)
        or coalesce(party_agg.unit_mismatch, false) as has_unit_mismatch,
      coalesce(inventory_agg.has_legacy, false) as has_legacy,
      mapped_boq.inventory_item_id is null as not_in_boq,
      item.id is null as missing_master
    from mapped_keys key_row
    left join public.items item on item.id = key_row.material_id
    left join mapped_boq on mapped_boq.inventory_item_id = key_row.material_id
    left join inventory_agg on inventory_agg.material_id = key_row.material_id
    left join party_agg on party_agg.item_id = key_row.material_id
  ),
  all_rows as (
    select
      mapped_rows.inventory_item_id, mapped_rows.sku, mapped_rows.item_name, mapped_rows.unit,
      mapped_rows.total_boq_qty,
      mapped_rows.request_po_receipt_qty, mapped_rows.proactive_po_receipt_qty,
      mapped_rows.site_hot_purchase_receipt_qty, mapped_rows.direct_supplier_receipt_qty,
      mapped_rows.direct_manual_receipt_qty, mapped_rows.transfer_receipt_qty,
      mapped_rows.gross_received_qty, mapped_rows.current_stock_qty,
      mapped_rows.construction_issued_qty, mapped_rows.project_returned_qty,
      mapped_rows.confirmed_used_qty, mapped_rows.loss_after_issue_qty,
      mapped_rows.has_unit_mismatch, mapped_rows.has_legacy,
      mapped_rows.not_in_boq, mapped_rows.missing_master, false as unmapped_material
    from mapped_rows
    union all
    select
      null::text, unmapped_boq.sku, unmapped_boq.item_name, unmapped_boq.unit,
      unmapped_boq.boq_qty,
      0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric,
      0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric, 0::numeric,
      false, false, false, false, true
    from unmapped_boq
  )
  select
    all_rows.inventory_item_id,
    all_rows.sku,
    all_rows.item_name,
    all_rows.unit,
    round(all_rows.total_boq_qty, 4),
    round(v_progress, 4),
    round(all_rows.total_boq_qty * v_progress / 100, 4) as planned_qty_to_date,
    round(all_rows.request_po_receipt_qty, 4),
    round(all_rows.proactive_po_receipt_qty, 4),
    round(all_rows.site_hot_purchase_receipt_qty, 4),
    round(all_rows.direct_supplier_receipt_qty, 4),
    round(all_rows.direct_manual_receipt_qty, 4),
    round(all_rows.transfer_receipt_qty, 4),
    round(all_rows.gross_received_qty, 4),
    round(all_rows.current_stock_qty, 4),
    round(all_rows.construction_issued_qty, 4),
    round(all_rows.project_returned_qty, 4),
    round(all_rows.construction_issued_qty - all_rows.project_returned_qty, 4) as net_issued_qty,
    round(all_rows.confirmed_used_qty, 4),
    round(all_rows.loss_after_issue_qty, 4),
    round(
      all_rows.construction_issued_qty - all_rows.project_returned_qty
        - all_rows.confirmed_used_qty - all_rows.loss_after_issue_qty,
      4
    ) as open_with_recipient_qty,
    round(all_rows.confirmed_used_qty - (all_rows.total_boq_qty * v_progress / 100), 4) as used_variance_to_plan,
    round(all_rows.confirmed_used_qty - all_rows.total_boq_qty, 4) as used_variance_to_boq,
    case when all_rows.total_boq_qty = 0 then 0
      else round(all_rows.confirmed_used_qty * 100 / all_rows.total_boq_qty, 2) end as used_percent_of_boq,
    array_remove(array[
      case when all_rows.unmapped_material or all_rows.missing_master then 'unmapped_material' end,
      case when all_rows.has_unit_mismatch then 'unit_mismatch' end,
      case when all_rows.has_legacy then 'legacy_transaction' end,
      case when all_rows.not_in_boq then 'not_in_boq' end,
      case when all_rows.construction_issued_qty - all_rows.project_returned_qty
        - all_rows.confirmed_used_qty - all_rows.loss_after_issue_qty <> 0
        then 'pending_settlement' end
    ]::text[], null)::text[] as data_quality_flags
  from all_rows
  order by all_rows.item_name, all_rows.sku nulls last;
end;
$$;

revoke all on function public.get_project_material_boq_reconciliation(text, text, date, numeric) from public, anon;
grant execute on function public.get_project_material_boq_reconciliation(text, text, date, numeric) to authenticated;

notify pgrst, 'reload schema';

create index if not exists idx_warehouses_project_site
  on public.warehouses(project_id, construction_site_id)
  where project_id is not null;

alter table public.transactions
  add column if not exists business_event_type text,
  add column if not exists business_event_reason text;

alter table public.inventory_transactions
  add column if not exists business_event_type text;

alter table public.inventory_ledger_entries
  add column if not exists business_event_type text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'transactions_business_event_type_check'
      and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions
      add constraint transactions_business_event_type_check check (
        business_event_type is null or business_event_type in (
          'request_po_receipt', 'proactive_po_receipt',
          'site_hot_purchase_receipt', 'direct_supplier_receipt',
          'direct_manual_receipt', 'project_return_receipt',
          'warehouse_transfer', 'construction_issue', 'supplier_return',
          'warehouse_loss', 'inventory_adjustment', 'opening_balance',
          'reversal', 'legacy_direct_receipt', 'legacy_direct_issue'
        )
      );
  end if;
end $$;

create index if not exists idx_transactions_business_event
  on public.transactions(business_event_type, date desc)
  where business_event_type is not null;
create index if not exists idx_inventory_transactions_business_event
  on public.inventory_transactions(business_event_type, transaction_date desc)
  where business_event_type is not null;
create index if not exists idx_inventory_ledger_project_material_date
  on public.inventory_ledger_entries(project_id, material_id, transaction_date, id);
create index if not exists idx_inventory_ledger_business_event
  on public.inventory_ledger_entries(project_id, business_event_type, material_id, transaction_date)
  where business_event_type in ('construction_issue', 'project_return_receipt', 'warehouse_loss');

comment on column public.warehouses.project_id is
  'Dự án sở hữu kho SITE. Backend dùng trường này làm scope authoritative khi post WMS.';
comment on column public.transactions.business_event_type is
  'Mục đích nghiệp vụ độc lập với chuyển động vật lý transactions.type.';
comment on column public.transactions.business_event_reason is
  'Lý do bắt buộc cho nhập trực tiếp/hao hụt/điều chỉnh không có chứng từ nguồn.';

-- Approved mapping. The removed PRJ-240AC280 record must never own a warehouse.
update public.warehouses warehouse
set project_id = project.id
from public.projects project
where warehouse.construction_site_id is not null
  and project.construction_site_id = warehouse.construction_site_id
  and project.code <> 'PRJ-240AC280'
  and not exists (
    select 1
    from public.projects competing
    where competing.construction_site_id = warehouse.construction_site_id
      and competing.code <> 'PRJ-240AC280'
      and competing.id <> project.id
  );

update public.warehouses warehouse
set project_id = project.id
from public.projects project
where warehouse.name = 'Kho Sơn Miền Bắc'
  and project.code = 'SMB-2026';

update public.warehouses warehouse
set project_id = project.id
from public.projects project
where warehouse.name = 'Kho Xin Hai Vina'
  and project.code = 'DA29';

do $$
declare
  v_missing integer;
begin
  select count(*) into v_missing
  from public.warehouses warehouse
  where warehouse.type = 'SITE'
    and not coalesce(warehouse.is_archived, false)
    and (warehouse.project_id is null or warehouse.construction_site_id is null);
  if v_missing > 0 then
    raise exception 'V1 cut-over stopped: % active SITE warehouses have no project/site scope.', v_missing;
  end if;
end $$;

create or replace function app_private.resolve_warehouse_project_scope(p_warehouse_id text)
returns table(project_id text, construction_site_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    warehouse.project_id as project_id,
    warehouse.construction_site_id::text as construction_site_id
  from public.warehouses warehouse
  where warehouse.id = p_warehouse_id;
$$;

revoke all on function app_private.resolve_warehouse_project_scope(text) from public, anon, authenticated;

create or replace function app_private.validate_warehouse_project_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_site uuid;
begin
  if new.type = 'SITE' and not coalesce(new.is_archived, false) then
    if new.project_id is null or new.construction_site_id is null then
      raise exception 'Kho công trường đang hoạt động phải gắn đủ dự án và công trường.';
    end if;
  end if;

  if new.project_id is not null then
    select project.construction_site_id into v_project_site
    from public.projects project
    where project.id = new.project_id;
    if not found then
      raise exception 'Không tìm thấy dự án %.', new.project_id;
    end if;
    if v_project_site is distinct from new.construction_site_id then
      raise exception 'Dự án và công trường của kho không cùng scope.';
    end if;
  end if;

  return new;
end;
$$;

create or replace function app_private.guard_used_warehouse_project_reassignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.project_id is not distinct from old.project_id
     and new.construction_site_id is not distinct from old.construction_site_id
  then
    return new;
  end if;

  if exists (
    select 1 from public.transactions transaction_row
    where transaction_row.source_warehouse_id = old.id
       or transaction_row.target_warehouse_id = old.id
  ) or exists (
    select 1 from public.inventory_ledger_entries entry
    where entry.warehouse_id = old.id
  ) or exists (
    select 1 from public.inventory_balances balance
    where balance.warehouse_id = old.id
      and coalesce(balance.on_hand_qty, 0) <> 0
  ) or exists (
    select 1 from public.material_issue_orders issue_order
    where issue_order.source_warehouse_id = old.id
  ) then
    raise exception 'Kho % đã phát sinh nghiệp vụ nên không thể đổi dự án/công trường.', old.name;
  end if;

  return new;
end;
$$;

revoke all on function app_private.validate_warehouse_project_scope() from public, anon, authenticated;
revoke all on function app_private.guard_used_warehouse_project_reassignment() from public, anon, authenticated;

drop trigger if exists trg_validate_warehouse_project_scope on public.warehouses;
create trigger trg_validate_warehouse_project_scope
before insert or update of type, is_archived, project_id, construction_site_id
on public.warehouses
for each row execute function app_private.validate_warehouse_project_scope();

drop trigger if exists trg_guard_used_warehouse_project_reassignment on public.warehouses;
create trigger trg_guard_used_warehouse_project_reassignment
before update of project_id, construction_site_id on public.warehouses
for each row execute function app_private.guard_used_warehouse_project_reassignment();

drop function if exists public.create_warehouse_with_site_binding(text, text, text, text, uuid, boolean);
create or replace function public.create_warehouse_with_site_binding(
  p_warehouse_id text,
  p_name text,
  p_address text,
  p_type text,
  p_project_id text default null,
  p_construction_site_id uuid default null,
  p_is_default_for_site boolean default false
)
returns public.warehouses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_warehouse public.warehouses%rowtype;
begin
  if not app_private.can_manage_warehouse_site_bindings() then
    raise exception 'Bạn không có quyền tạo và gán kho vào dự án.';
  end if;
  if nullif(btrim(p_warehouse_id), '') is null
     or nullif(btrim(p_name), '') is null
     or nullif(btrim(p_type), '') is null then
    raise exception 'Kho mới phải có mã, tên và loại kho.';
  end if;
  if p_type = 'SITE' and (p_project_id is null or p_construction_site_id is null) then
    raise exception 'Kho SITE phải chọn dự án và công trường.';
  end if;
  if coalesce(p_is_default_for_site, false)
     and (p_project_id is null or p_construction_site_id is null or p_type <> 'SITE') then
    raise exception 'Kho mặc định phải là kho SITE đã gắn dự án/công trường.';
  end if;
  if exists (select 1 from public.warehouses where id = p_warehouse_id) then
    raise exception 'Mã kho % đã tồn tại.', p_warehouse_id;
  end if;
  if coalesce(p_is_default_for_site, false) then
    update public.warehouses set is_default_for_site = false
    where construction_site_id = p_construction_site_id and is_default_for_site;
  end if;
  insert into public.warehouses(
    id, name, address, type, is_archived, project_id,
    construction_site_id, is_default_for_site
  ) values (
    p_warehouse_id, btrim(p_name), coalesce(p_address, ''), btrim(p_type), false,
    nullif(p_project_id, ''), p_construction_site_id, coalesce(p_is_default_for_site, false)
  ) returning * into v_warehouse;
  return v_warehouse;
end;
$$;

drop function if exists public.set_warehouse_construction_site_binding(text, uuid, boolean, text, text, text);
create or replace function public.set_warehouse_construction_site_binding(
  p_warehouse_id text,
  p_project_id text,
  p_construction_site_id uuid,
  p_is_default_for_site boolean default false,
  p_name text default null,
  p_address text default null,
  p_type text default null
)
returns public.warehouses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_warehouse public.warehouses%rowtype;
  v_next_type text;
begin
  if not app_private.can_manage_warehouse_site_bindings() then
    raise exception 'Bạn không có quyền gán kho vào dự án.';
  end if;
  select * into v_warehouse from public.warehouses
  where id = p_warehouse_id for update;
  if not found then raise exception 'Không tìm thấy kho %.', p_warehouse_id; end if;
  v_next_type := coalesce(nullif(btrim(p_type), ''), v_warehouse.type);
  if v_next_type = 'SITE' and (p_project_id is null or p_construction_site_id is null) then
    raise exception 'Kho SITE phải chọn dự án và công trường.';
  end if;
  if coalesce(p_is_default_for_site, false)
     and (p_project_id is null or p_construction_site_id is null or v_next_type <> 'SITE'
       or coalesce(v_warehouse.is_archived, false)) then
    raise exception 'Kho mặc định phải là kho SITE đã gắn dự án/công trường.';
  end if;
  if coalesce(p_is_default_for_site, false) then
    update public.warehouses set is_default_for_site = false
    where construction_site_id = p_construction_site_id
      and id <> p_warehouse_id and is_default_for_site;
  end if;
  update public.warehouses set
    name = coalesce(nullif(btrim(p_name), ''), name),
    address = coalesce(p_address, address),
    type = v_next_type,
    project_id = nullif(p_project_id, ''),
    construction_site_id = p_construction_site_id,
    is_default_for_site = coalesce(p_is_default_for_site, false)
  where id = p_warehouse_id
  returning * into v_warehouse;
  return v_warehouse;
end;
$$;

revoke all on function public.create_warehouse_with_site_binding(text, text, text, text, text, uuid, boolean) from public, anon;
grant execute on function public.create_warehouse_with_site_binding(text, text, text, text, text, uuid, boolean) to authenticated;
revoke all on function public.set_warehouse_construction_site_binding(text, text, uuid, boolean, text, text, text) from public, anon;
grant execute on function public.set_warehouse_construction_site_binding(text, text, uuid, boolean, text, text, text) to authenticated;

create or replace function app_private.classify_wms_business_event(
  p_type text,
  p_source_type text,
  p_related_request_id text,
  p_items jsonb
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_type = 'TRANSFER' then 'warehouse_transfer'
    when p_type = 'LIQUIDATION' then 'warehouse_loss'
    when p_type = 'ADJUSTMENT' then 'inventory_adjustment'
    when p_type = 'IMPORT' and exists (
      select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) line
      where nullif(line->>'materialIssueReturnId', '') is not null
    ) then 'project_return_receipt'
    when p_type = 'IMPORT' and lower(coalesce(p_source_type, '')) = 'site_direct_purchase'
      then 'site_hot_purchase_receipt'
    when p_type = 'IMPORT' and (
      lower(coalesce(p_source_type, '')) in ('supplier_direct_delivery_note', 'supplier_contract')
      or exists (
        select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) line
        where nullif(line->>'supplierDirectDeliveryNoteId', '') is not null
      )
    ) then 'direct_supplier_receipt'
    when p_type = 'IMPORT' and (
      lower(coalesce(p_source_type, '')) in ('po_delivery_batch', 'po_receipt')
      or exists (
        select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) line
        where nullif(line->>'purchaseOrderLineId', '') is not null
      )
    ) and (
      p_related_request_id is not null
      or exists (
        select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) line
        where nullif(line->>'materialRequestId', '') is not null
           or nullif(line->>'requestLineId', '') is not null
      )
    ) then 'request_po_receipt'
    when p_type = 'IMPORT' and lower(coalesce(p_source_type, '')) in ('po_delivery_batch', 'po_receipt')
      then 'proactive_po_receipt'
    when p_type = 'EXPORT' and exists (
      select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) line
      where nullif(line->>'materialIssueOrderId', '') is not null
        and nullif(line->>'materialIssueReturnId', '') is null
    ) then 'construction_issue'
    when p_type = 'EXPORT' and (
      lower(coalesce(p_source_type, '')) in ('supplier_return', 'purchase_order_supplier_return')
      or exists (
        select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) line
        where nullif(line->>'supplierReturnId', '') is not null
      )
    ) then 'supplier_return'
    else null
  end;
$$;

create or replace function app_private.resolve_wms_business_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_derived text;
  v_warehouse_id text;
  v_scope record;
  v_line jsonb;
  v_payload_project_id text;
  v_payload_site_id text;
begin
  v_derived := app_private.classify_wms_business_event(
    new.type::text, new.source_type, new.related_request_id, new.items
  );
  new.business_event_type := coalesce(new.business_event_type, v_derived);

  if new.status::text = 'COMPLETED' then
    if new.business_event_type is null then
      raise exception 'Phiếu kho hoàn tất phải có mục đích nghiệp vụ.';
    end if;
    if new.business_event_type in ('direct_manual_receipt', 'warehouse_loss', 'inventory_adjustment')
       and nullif(btrim(coalesce(new.business_event_reason, new.note, '')), '') is null then
      raise exception 'Bắt buộc nhập lý do cho mục đích nghiệp vụ này.';
    end if;

    for v_line in select value from jsonb_array_elements(coalesce(new.items, '[]'::jsonb))
    loop
      v_warehouse_id := case
        when new.type::text in ('EXPORT', 'LIQUIDATION') then new.source_warehouse_id
        when new.type::text = 'ADJUSTMENT' then coalesce(new.target_warehouse_id, new.source_warehouse_id)
        else new.target_warehouse_id
      end;
      select * into v_scope from app_private.resolve_warehouse_project_scope(v_warehouse_id);
      v_payload_project_id := nullif(coalesce(v_line->>'projectId', v_line->>'project_id'), '');
      v_payload_site_id := nullif(coalesce(v_line->>'constructionSiteId', v_line->>'construction_site_id'), '');
      if (v_payload_project_id is not null and v_payload_project_id is distinct from v_scope.project_id)
         or (v_payload_site_id is not null and v_payload_site_id is distinct from v_scope.construction_site_id) then
        raise exception 'Scope chứng từ không khớp scope kho.';
      end if;
    end loop;
  end if;
  return new;
end;
$$;

revoke all on function app_private.classify_wms_business_event(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function app_private.resolve_wms_business_event() from public, anon, authenticated;

-- Historical documents are classified, but unknown direct issues remain legacy
-- and are never converted to consume events.
update public.transactions transaction_row
set business_event_type = coalesce(
  app_private.classify_wms_business_event(
    transaction_row.type::text,
    transaction_row.source_type,
    transaction_row.related_request_id,
    transaction_row.items
  ),
  case
    when transaction_row.type::text = 'IMPORT' then 'legacy_direct_receipt'
    when transaction_row.type::text = 'EXPORT' then 'legacy_direct_issue'
    when transaction_row.type::text = 'TRANSFER' then 'warehouse_transfer'
    when transaction_row.type::text = 'LIQUIDATION' then 'warehouse_loss'
    when transaction_row.type::text = 'ADJUSTMENT' then 'inventory_adjustment'
    else null
  end
)
where transaction_row.business_event_type is null;

drop trigger if exists trg_resolve_wms_business_event on public.transactions;
create trigger trg_resolve_wms_business_event
before insert or update of status, type, items, source_type, related_request_id, business_event_type
on public.transactions
for each row execute function app_private.resolve_wms_business_event();

create or replace function app_private.sync_wms_transaction_to_inventory_ledger(p_transaction_id text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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

  if v_has_in then v_in_code := app_private.next_inventory_ledger_code('in'); end if;
  if v_has_out then v_out_code := app_private.next_inventory_ledger_code('out'); end if;
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
$$;

revoke all on function app_private.sync_wms_transaction_to_inventory_ledger(text) from public, anon, authenticated;

-- Snapshot current physical balances before changing only their reporting scope.
create temporary table v1_balance_before on commit drop as
select balance.warehouse_id, balance.material_id,
  sum(balance.on_hand_qty) as on_hand_qty,
  sum(balance.total_value) as total_value
from public.inventory_balances balance
group by balance.warehouse_id, balance.material_id;

update public.inventory_ledger_entries entry
set project_id = warehouse.project_id,
    construction_site_id = warehouse.construction_site_id::text
from public.warehouses warehouse
where warehouse.id = entry.warehouse_id
  and (entry.project_id is distinct from warehouse.project_id
    or entry.construction_site_id is distinct from warehouse.construction_site_id::text);

update public.inventory_ledger_entries entry
set business_event_type = transaction_row.business_event_type
from public.transactions transaction_row
where entry.source_type = 'wms_transaction'
  and transaction_row.id = entry.source_id
  and entry.business_event_type is null;

update public.inventory_ledger_entries entry
set business_event_type = case
  when entry.transaction_type in ('transfer_receipt', 'transfer_issue') then 'warehouse_transfer'
  when entry.transaction_type = 'project_return_receipt' then 'project_return_receipt'
  when entry.transaction_type = 'loss_issue' then 'warehouse_loss'
  when entry.transaction_type in ('adjustment_in', 'adjustment_out') then 'inventory_adjustment'
  when entry.movement_direction = 'in' then 'legacy_direct_receipt'
  else 'legacy_direct_issue'
end
where entry.business_event_type is null;

update public.inventory_balances balance
set project_id = warehouse.project_id,
    construction_site_id = warehouse.construction_site_id::text
from public.warehouses warehouse
where warehouse.id = balance.warehouse_id;

update public.inventory_transactions inventory_transaction
set business_event_type = transaction_row.business_event_type
from public.transactions transaction_row
where inventory_transaction.source_type = 'wms_transaction'
  and transaction_row.id = inventory_transaction.source_id;

with header_scope as (
  select entry.inventory_transaction_id,
    case when count(distinct coalesce(entry.project_id, '<null>')) = 1
      then max(entry.project_id) else null end as project_id,
    case when count(distinct coalesce(entry.construction_site_id, '<null>')) = 1
      then max(entry.construction_site_id) else null end as construction_site_id
  from public.inventory_ledger_entries entry
  group by entry.inventory_transaction_id
)
update public.inventory_transactions inventory_transaction
set project_id = header_scope.project_id,
    construction_site_id = header_scope.construction_site_id
from header_scope
where header_scope.inventory_transaction_id = inventory_transaction.id;

update public.material_issue_orders issue_order
set project_id = warehouse.project_id,
    construction_site_id = warehouse.construction_site_id::text
from public.warehouses warehouse
where warehouse.id = issue_order.source_warehouse_id;

update public.material_party_ledger party_entry
set project_id = issue_order.project_id,
    construction_site_id = issue_order.construction_site_id
from public.material_issue_orders issue_order
where issue_order.id = party_entry.issue_order_id;

do $$
declare
  v_balance_mismatch_count integer;
  v_unscoped_site_entries integer;
begin
  select count(*) into v_balance_mismatch_count
  from (
    select coalesce(before_row.warehouse_id, after_row.warehouse_id) as warehouse_id,
      coalesce(before_row.material_id, after_row.material_id) as material_id
    from v1_balance_before before_row
    full join (
      select balance.warehouse_id, balance.material_id,
        sum(balance.on_hand_qty) as on_hand_qty,
        sum(balance.total_value) as total_value
      from public.inventory_balances balance
      group by balance.warehouse_id, balance.material_id
    ) after_row using (warehouse_id, material_id)
    where coalesce(before_row.on_hand_qty, 0) <> coalesce(after_row.on_hand_qty, 0)
       or coalesce(before_row.total_value, 0) <> coalesce(after_row.total_value, 0)
  ) mismatch;
  if v_balance_mismatch_count > 0 then
    raise exception 'V1 cut-over stopped: % warehouse/material balances changed.', v_balance_mismatch_count;
  end if;

  select count(*) into v_unscoped_site_entries
  from public.inventory_ledger_entries entry
  join public.warehouses warehouse on warehouse.id = entry.warehouse_id
  where warehouse.type = 'SITE'
    and not coalesce(warehouse.is_archived, false)
    and (entry.project_id is null or entry.construction_site_id is null);
  if v_unscoped_site_entries > 0 then
    raise exception 'V1 cut-over stopped: % SITE ledger entries remain unscoped.', v_unscoped_site_entries;
  end if;
end $$;

notify pgrst, 'reload schema';
