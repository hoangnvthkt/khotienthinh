alter table public.site_direct_purchase_lines
  drop constraint if exists site_direct_purchase_lines_line_type_check;

alter table public.site_direct_purchase_lines
  add constraint site_direct_purchase_lines_line_type_check
  check (line_type in ('stock_item', 'expense_only', 'small_tool'));

alter table public.site_direct_purchase_lines
  add column if not exists small_tool_category text,
  add column if not exists small_tool_holder_type text,
  add column if not exists small_tool_holder_id text,
  add column if not exists small_tool_holder_name_snapshot text,
  add column if not exists small_tool_location_note text;

alter table public.site_direct_purchase_lines
  drop constraint if exists site_direct_purchase_lines_small_tool_holder_type_check;

alter table public.site_direct_purchase_lines
  add constraint site_direct_purchase_lines_small_tool_holder_type_check
  check (
    small_tool_holder_type is null
    or small_tool_holder_type in ('site', 'employee', 'team', 'manual')
  );

create table if not exists public.site_small_tool_records (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  project_id text,
  construction_site_id text not null,
  source_type text not null default 'site_direct_purchase'
    check (source_type in ('site_direct_purchase')),
  source_id text not null,
  source_line_id uuid not null references public.site_direct_purchase_lines(id) on delete cascade,
  source_code text,
  supplier_id text,
  supplier_name_snapshot text,
  item_name_snapshot text not null,
  category text,
  unit_snapshot text,
  quantity numeric(18,6) not null default 0,
  unit_cost numeric(18,2) not null default 0,
  total_amount numeric(18,2) not null default 0,
  purchase_date date,
  holder_type text not null default 'site'
    check (holder_type in ('site', 'employee', 'team', 'manual')),
  holder_id text,
  holder_name_snapshot text,
  location_note text,
  status text not null default 'stored'
    check (status in ('stored', 'in_use', 'damaged', 'lost', 'disposed')),
  attachments jsonb not null default '[]'::jsonb,
  qr_token text unique,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  note text,
  unique(source_type, source_line_id),
  check (project_id is not null or construction_site_id is not null),
  check (quantity >= 0),
  check (unit_cost >= 0),
  check (total_amount >= 0)
);

create index if not exists idx_site_small_tool_records_scope_status
  on public.site_small_tool_records(project_id, construction_site_id, status, purchase_date desc);

create index if not exists idx_site_small_tool_records_holder
  on public.site_small_tool_records(holder_type, holder_id, status);

create index if not exists idx_site_small_tool_records_source
  on public.site_small_tool_records(source_type, source_id, source_line_id);

drop trigger if exists trg_site_small_tool_records_updated_at on public.site_small_tool_records;
create trigger trg_site_small_tool_records_updated_at
before update on public.site_small_tool_records
for each row execute function public.set_updated_at();

create or replace function public.sync_site_small_tools_from_site_direct_purchase(p_direct_purchase_id uuid)
returns setof public.site_small_tool_records
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_purchase public.site_direct_purchases%rowtype;
begin
  select * into v_purchase
  from public.site_direct_purchases
  where id = p_direct_purchase_id;

  if not found then
    raise exception 'Không tìm thấy phiếu mua nóng %. ', p_direct_purchase_id;
  end if;

  if not app_private.ap_scope_can_mutate(v_purchase.project_id, v_purchase.construction_site_id) then
    raise exception 'Bạn không có quyền đồng bộ sổ CCDC nhỏ cho phiếu mua nóng này.';
  end if;

  delete from public.site_small_tool_records record
  using public.site_direct_purchase_lines line
  where record.source_type = 'site_direct_purchase'
    and record.source_line_id = line.id
    and line.direct_purchase_id = v_purchase.id
    and (
      line.line_type <> 'small_tool'
      or line.status not in ('accepted', 'adjusted')
    );

  return query
  insert into public.site_small_tool_records as target (
    code,
    project_id,
    construction_site_id,
    source_type,
    source_id,
    source_line_id,
    source_code,
    supplier_id,
    supplier_name_snapshot,
    item_name_snapshot,
    category,
    unit_snapshot,
    quantity,
    unit_cost,
    total_amount,
    purchase_date,
    holder_type,
    holder_id,
    holder_name_snapshot,
    location_note,
    status,
    attachments,
    qr_token,
    created_by,
    note
  )
  select
    'CCDC-' || v_purchase.code || '-' || lpad(line.line_no::text, 2, '0'),
    v_purchase.project_id,
    v_purchase.construction_site_id,
    'site_direct_purchase',
    v_purchase.id::text,
    line.id,
    v_purchase.code,
    v_purchase.supplier_id,
    v_purchase.supplier_name_snapshot,
    line.item_name_snapshot,
    nullif(line.small_tool_category, ''),
    line.unit_snapshot,
    coalesce(nullif(line.accepted_quantity, 0), line.quantity, 0)::numeric(18,6),
    case
      when coalesce(nullif(line.accepted_quantity, 0), line.quantity, 0) > 0 then
        round(
          coalesce(nullif(line.accepted_amount, 0), line.line_amount + line.vat_amount, 0)
          / coalesce(nullif(line.accepted_quantity, 0), line.quantity, 1),
          2
        )
      else coalesce(line.unit_price, 0)
    end::numeric(18,2),
    coalesce(nullif(line.accepted_amount, 0), line.line_amount + line.vat_amount, 0)::numeric(18,2),
    coalesce(v_purchase.purchase_date, current_date),
    coalesce(nullif(line.small_tool_holder_type, ''), 'site'),
    case
      when coalesce(nullif(line.small_tool_holder_type, ''), 'site') = 'site' then v_purchase.construction_site_id
      else nullif(line.small_tool_holder_id, '')
    end,
    coalesce(nullif(line.small_tool_holder_name_snapshot, ''), 'Công trường'),
    nullif(line.small_tool_location_note, ''),
    case
      when coalesce(nullif(line.small_tool_holder_type, ''), 'site') = 'site' then 'stored'
      else 'in_use'
    end,
    coalesce(v_purchase.attachments, '[]'::jsonb),
    'qr_ccdc_' || replace(line.id::text, '-', ''),
    v_purchase.created_by,
    line.note
  from public.site_direct_purchase_lines line
  where line.direct_purchase_id = v_purchase.id
    and line.line_type = 'small_tool'
    and line.status in ('accepted', 'adjusted')
  on conflict (source_type, source_line_id) do update
  set
    project_id = excluded.project_id,
    construction_site_id = excluded.construction_site_id,
    source_id = excluded.source_id,
    source_code = excluded.source_code,
    supplier_id = excluded.supplier_id,
    supplier_name_snapshot = excluded.supplier_name_snapshot,
    item_name_snapshot = excluded.item_name_snapshot,
    category = excluded.category,
    unit_snapshot = excluded.unit_snapshot,
    quantity = excluded.quantity,
    unit_cost = excluded.unit_cost,
    total_amount = excluded.total_amount,
    purchase_date = excluded.purchase_date,
    holder_type = coalesce(target.holder_type, excluded.holder_type),
    holder_id = coalesce(target.holder_id, excluded.holder_id),
    holder_name_snapshot = coalesce(target.holder_name_snapshot, excluded.holder_name_snapshot),
    location_note = coalesce(target.location_note, excluded.location_note),
    status = target.status,
    attachments = excluded.attachments,
    note = excluded.note,
    updated_at = now()
  returning *;
end;
$$;

alter table public.site_small_tool_records enable row level security;

drop policy if exists site_small_tool_records_access on public.site_small_tool_records;
create policy site_small_tool_records_access
on public.site_small_tool_records
for all to authenticated
using (app_private.ap_scope_can_view(project_id, construction_site_id))
with check (app_private.ap_scope_can_mutate(project_id, construction_site_id));

drop trigger if exists trg_audit_site_small_tool_records on public.site_small_tool_records;
create trigger trg_audit_site_small_tool_records
after insert or update or delete on public.site_small_tool_records
for each row execute function app_private.audit_supplier_ap_change();

revoke all on table public.site_small_tool_records from public, anon, authenticated;
grant select, insert, update, delete on table public.site_small_tool_records to authenticated;

revoke all on function public.sync_site_small_tools_from_site_direct_purchase(uuid) from public, anon;
grant execute on function public.sync_site_small_tools_from_site_direct_purchase(uuid) to authenticated;

notify pgrst, 'reload schema';
