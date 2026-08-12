-- Asset action permissions: align registry, remove broad actor write gates,
-- and enforce operation-specific Asset permissions in RLS/RPCs.

alter table public.permission_actions
  add column if not exists grant_readiness text not null default 'declared';

alter table public.assets
  add column if not exists managed_by_user_id text,
  add column if not exists managing_dept_id text,
  add column if not exists construction_site_id text,
  add column if not exists supplier_id text,
  add column if not exists is_leased boolean not null default false,
  add column if not exists leased_from text,
  add column if not exists lease_end_date text;

do $$
begin
  alter type public.asset_status add value if not exists 'PARTIAL' after 'AVAILABLE';
exception
  when duplicate_object then null;
end $$;

insert into public.permission_actions (
  module_code, action, permission_code, label, description, scope_modes,
  legacy_module_key, legacy_route, legacy_admin_only, sort_order, is_active,
  grant_readiness, risk_level, is_business_action
)
values
  ('asset.catalog', 'view', 'asset.catalog.view', 'Xem', 'Xem danh mục tài sản', array['global','warehouse','department','assigned']::text[], 'TS', '/ts/catalog', false, 10, true, 'enforced', 'normal', false),
  ('asset.catalog', 'create', 'asset.catalog.create', 'Tạo', 'Tạo tài sản', array['global','warehouse','department','assigned']::text[], 'TS', '/ts/catalog', true, 20, true, 'enforced', 'normal', true),
  ('asset.catalog', 'edit', 'asset.catalog.edit', 'Sửa', 'Sửa thông tin tài sản', array['global','warehouse','department','assigned']::text[], 'TS', '/ts/catalog', true, 30, true, 'enforced', 'normal', true),
  ('asset.catalog', 'delete', 'asset.catalog.delete', 'Xóa', 'Xóa tài sản', array['global','warehouse','department','assigned']::text[], 'TS', '/ts/catalog', true, 40, true, 'enforced', 'sensitive', true),
  ('asset.catalog', 'dispose', 'asset.catalog.dispose', 'Xuất hủy', 'Thanh lý/xuất hủy tài sản', array['global','warehouse','department','assigned']::text[], 'TS', '/ts/catalog', true, 50, true, 'enforced', 'sensitive', true),
  ('asset.catalog', 'import', 'asset.catalog.import', 'Import', 'Import tài sản từ file', array['global','warehouse','department','assigned']::text[], 'TS', '/ts/catalog', true, 60, true, 'enforced', 'normal', true),
  ('asset.catalog', 'transfer_stock', 'asset.catalog.transfer_stock', 'Điều chuyển tồn', 'Điều chuyển tồn tài sản theo kho/phòng ban/người nhận', array['global','warehouse','department','assigned']::text[], 'TS', '/ts/catalog', true, 70, true, 'enforced', 'sensitive', true),
  ('asset.assignment', 'view', 'asset.assignment.view', 'Xem', 'Xem cấp phát tài sản', array['global','warehouse','department','assigned']::text[], 'TS', '/ts/assignment', false, 10, true, 'enforced', 'normal', false),
  ('asset.assignment', 'assign', 'asset.assignment.assign', 'Cấp phát', 'Cấp phát tài sản cho người dùng', array['global','warehouse','department','assigned']::text[], 'TS', '/ts/assignment', true, 20, true, 'enforced', 'normal', true),
  ('asset.assignment', 'return', 'asset.assignment.return', 'Thu hồi', 'Thu hồi tài sản đã cấp phát', array['global','warehouse','department','assigned']::text[], 'TS', '/ts/assignment', true, 30, true, 'enforced', 'normal', true),
  ('asset.assignment', 'transfer', 'asset.assignment.transfer', 'Luân chuyển', 'Luân chuyển tài sản giữa người dùng', array['global','warehouse','department','assigned']::text[], 'TS', '/ts/assignment', true, 40, true, 'enforced', 'normal', true),
  ('asset.maintenance', 'view', 'asset.maintenance.view', 'Xem', 'Xem bảo trì tài sản', array['global','warehouse','department','assigned']::text[], 'TS', '/ts/maintenance', false, 10, true, 'enforced', 'normal', false),
  ('asset.maintenance', 'create', 'asset.maintenance.create', 'Tạo', 'Tạo phiếu bảo trì tài sản', array['global','warehouse','department','assigned']::text[], 'TS', '/ts/maintenance', true, 20, true, 'enforced', 'normal', true),
  ('asset.maintenance', 'complete', 'asset.maintenance.complete', 'Hoàn tất', 'Hoàn tất bảo trì tài sản', array['global','warehouse','department','assigned']::text[], 'TS', '/ts/maintenance', true, 30, true, 'enforced', 'normal', true),
  ('asset.maintenance', 'import', 'asset.maintenance.import', 'Import', 'Import bảo trì tài sản', array['global','warehouse','department','assigned']::text[], 'TS', '/ts/maintenance', true, 40, true, 'enforced', 'normal', true),
  ('asset.audit', 'view', 'asset.audit.view', 'Xem', 'Xem kiểm kê/báo cáo tài sản', array['global','warehouse','department','assigned']::text[], 'TS', '/ts/audit', false, 10, true, 'enforced', 'normal', false),
  ('asset.audit', 'perform', 'asset.audit.perform', 'Kiểm kê', 'Thực hiện kiểm kê tài sản', array['global','warehouse','department','assigned']::text[], 'TS', '/ts/audit', true, 20, true, 'declared', 'normal', true),
  ('asset.audit', 'export', 'asset.audit.export', 'Xuất báo cáo', 'Xuất kiểm kê/báo cáo tài sản', array['global','warehouse','department','assigned']::text[], 'TS', '/ts/reports', true, 30, true, 'declared', 'normal', true)
on conflict (permission_code) do update
set module_code = excluded.module_code,
    action = excluded.action,
    label = excluded.label,
    description = excluded.description,
    scope_modes = excluded.scope_modes,
    legacy_module_key = excluded.legacy_module_key,
    legacy_route = excluded.legacy_route,
    legacy_admin_only = excluded.legacy_admin_only,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active,
    grant_readiness = excluded.grant_readiness,
    risk_level = excluded.risk_level,
    is_business_action = excluded.is_business_action,
    updated_at = now();

update public.permission_actions
set grant_readiness = 'legacy',
    updated_at = now()
where permission_code in (
  'asset.catalog.manage',
  'asset.assignment.create',
  'asset.assignment.approve',
  'asset.maintenance.manage'
);

update public.permission_actions
set grant_readiness = 'enforced',
    updated_at = now()
where permission_code = any(array[
  'asset.catalog.view',
  'asset.catalog.create',
  'asset.catalog.edit',
  'asset.catalog.delete',
  'asset.catalog.dispose',
  'asset.catalog.import',
  'asset.catalog.transfer_stock',
  'asset.assignment.view',
  'asset.assignment.assign',
  'asset.assignment.return',
  'asset.assignment.transfer',
  'asset.maintenance.view',
  'asset.maintenance.create',
  'asset.maintenance.complete',
  'asset.maintenance.import',
  'asset.audit.view'
]::text[]);

create or replace function app_private.uuid_or_null(p_value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if nullif(btrim(coalesce(p_value, '')), '') is null then
    return null;
  end if;

  if p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return p_value::uuid;
  end if;

  return null;
end;
$$;

revoke all on function app_private.uuid_or_null(text) from public, anon;
grant execute on function app_private.uuid_or_null(text) to authenticated;

create or replace function app_private.asset_has_action(
  p_permission_code text,
  p_warehouse_id text default null,
  p_department_id text default null,
  p_assigned_user_id uuid default null,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_permission_code like 'asset.%'
  and p_user_id is not null
  and (
    app_private.has_permission(p_user_id, p_permission_code, 'global', '*')
    or (
      p_warehouse_id is not null
      and app_private.has_permission(p_user_id, p_permission_code, 'warehouse', p_warehouse_id)
    )
    or (
      p_department_id is not null
      and app_private.has_permission(p_user_id, p_permission_code, 'department', p_department_id)
    )
    or (
      p_assigned_user_id = p_user_id
      and app_private.has_permission(p_user_id, p_permission_code, 'assigned', p_user_id::text)
    )
  );
$$;

revoke all on function app_private.asset_has_action(text, text, text, uuid, uuid) from public, anon;
grant execute on function app_private.asset_has_action(text, text, text, uuid, uuid) to authenticated;

create or replace function app_private.asset_has_any_action(
  p_permission_code text,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_permission_code like 'asset.%'
  and p_user_id is not null
  and exists (
    select 1
    from app_private.resolve_effective_permission_sources(
      p_user_id, p_permission_code, null, null, now()
    )
  );
$$;

revoke all on function app_private.asset_has_any_action(text, uuid) from public, anon;
grant execute on function app_private.asset_has_any_action(text, uuid) to authenticated;

create or replace function app_private.asset_record_has_action(
  p_permission_code text,
  p_asset_id text,
  p_department_id text default null,
  p_assigned_user_id text default null,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.assets asset_row
    where asset_row.id = p_asset_id
      and app_private.asset_has_action(
        p_permission_code,
        asset_row.warehouse_id,
        coalesce(nullif(p_department_id, ''), asset_row.managing_dept_id),
        app_private.uuid_or_null(coalesce(nullif(p_assigned_user_id, ''), asset_row.assigned_to_user_id)),
        p_user_id
      )
  );
$$;

revoke all on function app_private.asset_record_has_action(text, text, text, text, uuid) from public, anon;
grant execute on function app_private.asset_record_has_action(text, text, text, text, uuid) to authenticated;

alter table public.assets enable row level security;
alter table public.asset_categories enable row level security;
alter table public.asset_assignments enable row level security;
alter table public.asset_maintenances enable row level security;
alter table public.asset_location_stocks enable row level security;
alter table public.asset_transfers enable row level security;

drop policy if exists assets_active_actor_gate on public.assets;
drop policy if exists asset_categories_active_actor_gate on public.asset_categories;
drop policy if exists asset_assignments_active_actor_gate on public.asset_assignments;
drop policy if exists asset_maintenances_active_actor_gate on public.asset_maintenances;
drop policy if exists asset_location_stocks_active_actor_gate on public.asset_location_stocks;
drop policy if exists asset_transfers_active_actor_gate on public.asset_transfers;

drop policy if exists assets_select on public.assets;
drop policy if exists assets_write on public.assets;
drop policy if exists assets_update on public.assets;
drop policy if exists assets_delete on public.assets;
drop policy if exists asset_categories_select on public.asset_categories;
drop policy if exists asset_categories_write on public.asset_categories;
drop policy if exists asset_categories_update on public.asset_categories;
drop policy if exists asset_categories_delete on public.asset_categories;
drop policy if exists asset_assignments_select on public.asset_assignments;
drop policy if exists asset_assignments_write on public.asset_assignments;
drop policy if exists asset_assignments_update on public.asset_assignments;
drop policy if exists asset_assignments_delete on public.asset_assignments;
drop policy if exists asset_maintenances_select on public.asset_maintenances;
drop policy if exists asset_maintenances_write on public.asset_maintenances;
drop policy if exists asset_maintenances_update on public.asset_maintenances;
drop policy if exists asset_maintenances_delete on public.asset_maintenances;
drop policy if exists asset_location_stocks_select on public.asset_location_stocks;
drop policy if exists asset_location_stocks_insert on public.asset_location_stocks;
drop policy if exists asset_location_stocks_update on public.asset_location_stocks;
drop policy if exists asset_location_stocks_delete on public.asset_location_stocks;
drop policy if exists asset_transfers_select on public.asset_transfers;
drop policy if exists asset_transfers_insert on public.asset_transfers;
drop policy if exists asset_transfers_update on public.asset_transfers;
drop policy if exists asset_transfers_delete on public.asset_transfers;

create policy assets_select_action
on public.assets for select
to authenticated
using (
  app_private.asset_has_action('asset.catalog.view', warehouse_id, managing_dept_id, app_private.uuid_or_null(assigned_to_user_id))
  or app_private.asset_has_action('asset.assignment.view', warehouse_id, managing_dept_id, app_private.uuid_or_null(assigned_to_user_id))
  or app_private.asset_has_action('asset.maintenance.view', warehouse_id, managing_dept_id, app_private.uuid_or_null(assigned_to_user_id))
  or app_private.asset_has_action('asset.audit.view', warehouse_id, managing_dept_id, app_private.uuid_or_null(assigned_to_user_id))
);

create policy assets_insert_action
on public.assets for insert
to authenticated
with check (
  status <> 'DISPOSED'::public.asset_status
  and app_private.asset_has_action('asset.catalog.create', warehouse_id, managing_dept_id, app_private.uuid_or_null(assigned_to_user_id))
);

create policy assets_update_action
on public.assets for update
to authenticated
using (
  app_private.asset_has_action('asset.catalog.edit', warehouse_id, managing_dept_id, app_private.uuid_or_null(assigned_to_user_id))
)
with check (
  status <> 'DISPOSED'::public.asset_status
  and app_private.asset_has_action('asset.catalog.edit', warehouse_id, managing_dept_id, app_private.uuid_or_null(assigned_to_user_id))
);

create policy assets_delete_action
on public.assets for delete
to authenticated
using (
  app_private.asset_has_action('asset.catalog.delete', warehouse_id, managing_dept_id, app_private.uuid_or_null(assigned_to_user_id))
);

create policy asset_categories_select_action
on public.asset_categories for select
to authenticated
using (
  app_private.asset_has_any_action('asset.catalog.view')
  or app_private.asset_has_any_action('asset.assignment.view')
  or app_private.asset_has_any_action('asset.maintenance.view')
  or app_private.asset_has_any_action('asset.audit.view')
);

create policy asset_categories_insert_action
on public.asset_categories for insert
to authenticated
with check (app_private.asset_has_any_action('asset.catalog.edit'));

create policy asset_categories_update_action
on public.asset_categories for update
to authenticated
using (app_private.asset_has_any_action('asset.catalog.edit'))
with check (app_private.asset_has_any_action('asset.catalog.edit'));

create policy asset_categories_delete_action
on public.asset_categories for delete
to authenticated
using (app_private.asset_has_any_action('asset.catalog.edit'));

create policy asset_location_stocks_select_action
on public.asset_location_stocks for select
to authenticated
using (
  app_private.asset_has_action('asset.catalog.view', warehouse_id, dept_id, app_private.uuid_or_null(assigned_to_user_id))
  or app_private.asset_record_has_action('asset.catalog.view', asset_id, dept_id, assigned_to_user_id)
);

create policy asset_location_stocks_insert_action
on public.asset_location_stocks for insert
to authenticated
with check (
  app_private.asset_has_action('asset.catalog.transfer_stock', warehouse_id, dept_id, app_private.uuid_or_null(assigned_to_user_id))
  or app_private.asset_has_action('asset.catalog.create', warehouse_id, dept_id, app_private.uuid_or_null(assigned_to_user_id))
);

create policy asset_location_stocks_update_action
on public.asset_location_stocks for update
to authenticated
using (
  app_private.asset_has_action('asset.catalog.transfer_stock', warehouse_id, dept_id, app_private.uuid_or_null(assigned_to_user_id))
)
with check (
  app_private.asset_has_action('asset.catalog.transfer_stock', warehouse_id, dept_id, app_private.uuid_or_null(assigned_to_user_id))
);

create policy asset_location_stocks_delete_action
on public.asset_location_stocks for delete
to authenticated
using (
  app_private.asset_has_action('asset.catalog.transfer_stock', warehouse_id, dept_id, app_private.uuid_or_null(assigned_to_user_id))
);

create policy asset_transfers_select_action
on public.asset_transfers for select
to authenticated
using (
  app_private.asset_record_has_action('asset.catalog.view', asset_id, from_dept_id, received_by_user_id)
  or app_private.asset_has_action('asset.catalog.view', from_warehouse_id, from_dept_id, null)
  or app_private.asset_has_action('asset.catalog.view', to_warehouse_id, to_dept_id, app_private.uuid_or_null(received_by_user_id))
);

create policy asset_transfers_insert_action
on public.asset_transfers for insert
to authenticated
with check (
  app_private.asset_has_action('asset.catalog.transfer_stock', from_warehouse_id, from_dept_id, null)
  and app_private.asset_has_action('asset.catalog.transfer_stock', to_warehouse_id, to_dept_id, app_private.uuid_or_null(received_by_user_id))
);

create policy asset_transfers_update_action
on public.asset_transfers for update
to authenticated
using (
  app_private.asset_has_action('asset.catalog.transfer_stock', from_warehouse_id, from_dept_id, null)
  and app_private.asset_has_action('asset.catalog.transfer_stock', to_warehouse_id, to_dept_id, app_private.uuid_or_null(received_by_user_id))
)
with check (
  app_private.asset_has_action('asset.catalog.transfer_stock', from_warehouse_id, from_dept_id, null)
  and app_private.asset_has_action('asset.catalog.transfer_stock', to_warehouse_id, to_dept_id, app_private.uuid_or_null(received_by_user_id))
);

create policy asset_transfers_delete_action
on public.asset_transfers for delete
to authenticated
using (
  app_private.asset_has_action('asset.catalog.transfer_stock', from_warehouse_id, from_dept_id, null)
  and app_private.asset_has_action('asset.catalog.transfer_stock', to_warehouse_id, to_dept_id, app_private.uuid_or_null(received_by_user_id))
);

create policy asset_assignments_select_action
on public.asset_assignments for select
to authenticated
using (
  app_private.asset_record_has_action('asset.assignment.view', asset_id, null, user_id)
  or app_private.asset_record_has_action('asset.assignment.view', asset_id, null, from_user_id)
);

create policy asset_assignments_insert_action
on public.asset_assignments for insert
to authenticated
with check (
  case
    when "type" = 'assign'::public.asset_assignment_type then app_private.asset_record_has_action('asset.assignment.assign', asset_id, null, user_id)
    when "type" = 'return'::public.asset_assignment_type then app_private.asset_record_has_action('asset.assignment.return', asset_id, null, coalesce(from_user_id, user_id))
    when "type" = 'transfer'::public.asset_assignment_type then
      app_private.asset_record_has_action('asset.assignment.transfer', asset_id, null, coalesce(from_user_id, user_id))
      and app_private.asset_record_has_action('asset.assignment.transfer', asset_id, null, user_id)
    else false
  end
);

create policy asset_assignments_update_action
on public.asset_assignments for update
to authenticated
using (false)
with check (false);

create policy asset_assignments_delete_action
on public.asset_assignments for delete
to authenticated
using (false);

create policy asset_maintenances_select_action
on public.asset_maintenances for select
to authenticated
using (app_private.asset_record_has_action('asset.maintenance.view', asset_id));

create policy asset_maintenances_insert_action
on public.asset_maintenances for insert
to authenticated
with check (
  status <> 'completed'::public.maintenance_status
  and app_private.asset_record_has_action('asset.maintenance.create', asset_id)
);

create policy asset_maintenances_update_action
on public.asset_maintenances for update
to authenticated
using (false)
with check (false);

create policy asset_maintenances_delete_action
on public.asset_maintenances for delete
to authenticated
using (false);

create or replace function public.create_asset_with_initial_stock(p_asset jsonb)
returns public.assets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.assets%rowtype;
  v_stock_id text;
  v_qty integer;
  v_warehouse_id text := nullif(p_asset->>'warehouse_id', '');
  v_department_id text := nullif(p_asset->>'managing_dept_id', '');
  v_assigned_user_id uuid := app_private.uuid_or_null(p_asset->>'assigned_to_user_id');
begin
  if not app_private.asset_has_action('asset.catalog.create', v_warehouse_id, v_department_id, v_assigned_user_id) then
    raise exception 'insufficient privilege to create asset' using errcode = '42501';
  end if;

  if coalesce(nullif(p_asset->>'status', ''), 'AVAILABLE') = 'DISPOSED' then
    raise exception 'use dispose_asset for disposed assets' using errcode = '42501';
  end if;

  v_qty := greatest(1, coalesce(nullif(p_asset->>'quantity', '')::integer, 1));
  if coalesce(nullif(p_asset->>'asset_type', ''), 'single') <> 'batch' then
    v_qty := 1;
  end if;

  insert into public.assets (
    id, code, name, category_id, brand, model, serial_number, status,
    original_value, purchase_date, depreciation_years, warranty_months,
    residual_value, warehouse_id, location_note, assigned_to_user_id,
    assigned_to_name, assigned_date, disposal_date, disposal_value,
    disposal_note, image_url, note, created_at, updated_at,
    asset_type, quantity, unit, parent_id, child_index, is_bundle,
    asset_origin, is_fixed_asset, contract_number, invoice_number,
    warranty_condition, warranty_provider, warranty_contact,
    managed_by_user_id, managing_dept_id, construction_site_id,
    supplier_id, is_leased, leased_from, lease_end_date
  )
  values (
    p_asset->>'id',
    p_asset->>'code',
    p_asset->>'name',
    nullif(p_asset->>'category_id', ''),
    nullif(p_asset->>'brand', ''),
    nullif(p_asset->>'model', ''),
    nullif(p_asset->>'serial_number', ''),
    coalesce(nullif(p_asset->>'status', ''), 'AVAILABLE')::public.asset_status,
    coalesce(nullif(p_asset->>'original_value', '')::numeric, 0),
    coalesce(nullif(p_asset->>'purchase_date', ''), now()::date::text),
    coalesce(nullif(p_asset->>'depreciation_years', '')::integer, 5),
    coalesce(nullif(p_asset->>'warranty_months', '')::integer, 0),
    coalesce(nullif(p_asset->>'residual_value', '')::numeric, 0),
    v_warehouse_id,
    nullif(p_asset->>'location_note', ''),
    nullif(p_asset->>'assigned_to_user_id', ''),
    nullif(p_asset->>'assigned_to_name', ''),
    nullif(p_asset->>'assigned_date', ''),
    nullif(p_asset->>'disposal_date', ''),
    nullif(p_asset->>'disposal_value', '')::numeric,
    nullif(p_asset->>'disposal_note', ''),
    nullif(p_asset->>'image_url', ''),
    nullif(p_asset->>'note', ''),
    coalesce(nullif(p_asset->>'created_at', '')::timestamptz, now()),
    coalesce(nullif(p_asset->>'updated_at', '')::timestamptz, now()),
    coalesce(nullif(p_asset->>'asset_type', ''), 'single'),
    v_qty,
    nullif(p_asset->>'unit', ''),
    nullif(p_asset->>'parent_id', ''),
    nullif(p_asset->>'child_index', '')::integer,
    coalesce(nullif(p_asset->>'is_bundle', '')::boolean, false),
    coalesce(nullif(p_asset->>'asset_origin', ''), 'purchase'),
    coalesce(nullif(p_asset->>'is_fixed_asset', '')::boolean, true),
    nullif(p_asset->>'contract_number', ''),
    nullif(p_asset->>'invoice_number', ''),
    nullif(p_asset->>'warranty_condition', ''),
    nullif(p_asset->>'warranty_provider', ''),
    nullif(p_asset->>'warranty_contact', ''),
    nullif(p_asset->>'managed_by_user_id', ''),
    v_department_id,
    nullif(p_asset->>'construction_site_id', ''),
    nullif(p_asset->>'supplier_id', ''),
    coalesce(nullif(p_asset->>'is_leased', '')::boolean, false),
    nullif(p_asset->>'leased_from', ''),
    nullif(p_asset->>'lease_end_date', '')
  )
  returning * into v_asset;

  if v_warehouse_id is not null then
    select id into v_stock_id
    from public.asset_location_stocks
    where asset_id = v_asset.id
      and warehouse_id is not distinct from v_warehouse_id
      and dept_id is not distinct from v_department_id
      and assigned_to_user_id is null
    limit 1
    for update;

    if v_stock_id is null then
      insert into public.asset_location_stocks (
        asset_id, warehouse_id, dept_id, qty, note, updated_at
      )
      values (
        v_asset.id, v_warehouse_id, v_department_id, v_qty,
        nullif(p_asset->>'location_note', ''), now()
      );
    else
      update public.asset_location_stocks
      set qty = qty + v_qty,
          note = coalesce(nullif(p_asset->>'location_note', ''), note),
          updated_at = now()
      where id = v_stock_id;
    end if;
  end if;

  return v_asset;
end;
$$;

create or replace function public.dispose_asset(
  p_asset_id text,
  p_disposal_date text default null,
  p_disposal_value numeric default null,
  p_disposal_note text default null
)
returns public.assets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.assets%rowtype;
begin
  select * into v_asset
  from public.assets
  where id = p_asset_id
  for update;

  if not found then
    raise exception 'asset not found' using errcode = 'P0002';
  end if;

  if not app_private.asset_has_action('asset.catalog.dispose',
    v_asset.warehouse_id,
    v_asset.managing_dept_id,
    app_private.uuid_or_null(v_asset.assigned_to_user_id)
  ) then
    raise exception 'insufficient privilege to dispose asset' using errcode = '42501';
  end if;

  update public.assets
  set status = 'DISPOSED'::public.asset_status,
      disposal_date = coalesce(nullif(p_disposal_date, ''), now()::date::text),
      disposal_value = p_disposal_value,
      disposal_note = nullif(p_disposal_note, ''),
      updated_at = now()
  where id = p_asset_id
  returning * into v_asset;

  return v_asset;
end;
$$;

create or replace function public.record_asset_assignment(p_assignment jsonb)
returns public.asset_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.asset_assignments%rowtype;
  v_asset public.assets%rowtype;
  v_type public.asset_assignment_type := coalesce(nullif(p_assignment->>'type', ''), 'assign')::public.asset_assignment_type;
  v_asset_id text := p_assignment->>'asset_id';
  v_user_id text := p_assignment->>'user_id';
  v_from_user_id text := nullif(p_assignment->>'from_user_id', '');
  v_permission_code text;
begin
  select * into v_asset
  from public.assets
  where id = v_asset_id
  for update;

  if not found then
    raise exception 'asset not found' using errcode = 'P0002';
  end if;

  if v_type = 'assign'::public.asset_assignment_type then
    v_permission_code := 'asset.assignment.assign';
    if not app_private.asset_record_has_action(v_permission_code, v_asset_id, null, v_user_id) then
      raise exception 'insufficient privilege to assign asset' using errcode = '42501';
    end if;
  elsif v_type = 'return'::public.asset_assignment_type then
    v_permission_code := 'asset.assignment.return';
    if not app_private.asset_record_has_action(v_permission_code, v_asset_id, null, coalesce(v_from_user_id, v_user_id, v_asset.assigned_to_user_id)) then
      raise exception 'insufficient privilege to return asset' using errcode = '42501';
    end if;
  else
    v_permission_code := 'asset.assignment.transfer';
    if not app_private.asset_record_has_action(v_permission_code, v_asset_id, null, coalesce(v_from_user_id, v_asset.assigned_to_user_id))
       or not app_private.asset_record_has_action(v_permission_code, v_asset_id, null, v_user_id) then
      raise exception 'insufficient privilege to transfer asset assignment' using errcode = '42501';
    end if;
  end if;

  insert into public.asset_assignments (
    id, asset_id, type, user_id, user_name, from_user_id, from_user_name,
    date, note, performed_by, performed_by_name, created_at,
    dept_name, site_name, qty
  )
  values (
    coalesce(nullif(p_assignment->>'id', ''), gen_random_uuid()::text),
    v_asset_id,
    v_type,
    v_user_id,
    coalesce(nullif(p_assignment->>'user_name', ''), ''),
    v_from_user_id,
    nullif(p_assignment->>'from_user_name', ''),
    coalesce(nullif(p_assignment->>'date', ''), now()::date::text),
    nullif(p_assignment->>'note', ''),
    coalesce(nullif(p_assignment->>'performed_by', ''), public.current_app_user_id()::text),
    coalesce(nullif(p_assignment->>'performed_by_name', ''), ''),
    now(),
    nullif(p_assignment->>'dept_name', ''),
    nullif(p_assignment->>'site_name', ''),
    nullif(p_assignment->>'qty', '')::integer
  )
  returning * into v_assignment;

  if v_type = 'return'::public.asset_assignment_type then
    update public.assets
    set status = 'AVAILABLE'::public.asset_status,
        assigned_to_user_id = null,
        assigned_to_name = null,
        assigned_date = null,
        updated_at = now()
    where id = v_asset_id;
  else
    update public.assets
    set status = 'IN_USE'::public.asset_status,
        assigned_to_user_id = v_user_id,
        assigned_to_name = v_assignment.user_name,
        assigned_date = v_assignment.date,
        updated_at = now()
    where id = v_asset_id;
  end if;

  return v_assignment;
end;
$$;

create or replace function public.record_asset_maintenance(
  p_maintenance jsonb,
  p_operation text default 'create'
)
returns public.asset_maintenances
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_maintenance public.asset_maintenances%rowtype;
  v_asset public.assets%rowtype;
  v_asset_id text := p_maintenance->>'asset_id';
  v_attachments jsonb := '[]'::jsonb;
begin
  select * into v_asset
  from public.assets
  where id = v_asset_id
  for update;

  if not found then
    raise exception 'asset not found' using errcode = 'P0002';
  end if;

  if not app_private.asset_record_has_action('asset.maintenance.create', v_asset_id) then
    raise exception 'insufficient privilege to create maintenance' using errcode = '42501';
  end if;

  if coalesce(nullif(p_operation, ''), 'create') = 'import'
     and not app_private.asset_record_has_action('asset.maintenance.import', v_asset_id) then
    raise exception 'insufficient privilege to import maintenance' using errcode = '42501';
  end if;

  if coalesce(nullif(p_maintenance->>'status', ''), 'planned') = 'completed'
     and coalesce(nullif(p_operation, ''), 'create') <> 'import' then
    raise exception 'use complete_asset_maintenance to complete maintenance' using errcode = '42501';
  end if;

  if p_maintenance ? 'attachments' then
    if jsonb_typeof(p_maintenance->'attachments') = 'array' then
      v_attachments := p_maintenance->'attachments';
    elsif jsonb_typeof(p_maintenance->'attachments') = 'string'
      and nullif(p_maintenance->>'attachments', '') is not null then
      v_attachments := (p_maintenance->>'attachments')::jsonb;
    end if;
  end if;

  insert into public.asset_maintenances (
    id, asset_id, type, description, cost, estimated_cost, actual_cost,
    vendor, invoice_number, start_date, end_date, status,
    performed_by, performed_by_name, note, attachments, created_at
  )
  values (
    coalesce(nullif(p_maintenance->>'id', ''), gen_random_uuid()::text),
    v_asset_id,
    coalesce(nullif(p_maintenance->>'type', ''), 'scheduled')::public.maintenance_type,
    coalesce(nullif(p_maintenance->>'description', ''), ''),
    coalesce(nullif(p_maintenance->>'cost', '')::numeric, 0),
    nullif(p_maintenance->>'estimated_cost', '')::numeric,
    nullif(p_maintenance->>'actual_cost', '')::numeric,
    nullif(p_maintenance->>'vendor', ''),
    nullif(p_maintenance->>'invoice_number', ''),
    coalesce(nullif(p_maintenance->>'start_date', ''), now()::date::text),
    nullif(p_maintenance->>'end_date', ''),
    coalesce(nullif(p_maintenance->>'status', ''), 'planned')::public.maintenance_status,
    coalesce(nullif(p_maintenance->>'performed_by', ''), public.current_app_user_id()::text),
    nullif(p_maintenance->>'performed_by_name', ''),
    nullif(p_maintenance->>'note', ''),
    v_attachments,
    now()
  )
  returning * into v_maintenance;

  if v_maintenance.status = 'in_progress'::public.maintenance_status then
    update public.assets
    set status = 'MAINTENANCE'::public.asset_status,
        updated_at = now()
    where id = v_asset_id;
  end if;

  return v_maintenance;
end;
$$;

create or replace function public.complete_asset_maintenance(
  p_maintenance_id text,
  p_end_date text default null,
  p_actual_cost numeric default null,
  p_note text default null
)
returns public.asset_maintenances
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_maintenance public.asset_maintenances%rowtype;
  v_asset public.assets%rowtype;
begin
  select * into v_maintenance
  from public.asset_maintenances
  where id = p_maintenance_id
  for update;

  if not found then
    raise exception 'maintenance not found' using errcode = 'P0002';
  end if;

  select * into v_asset
  from public.assets
  where id = v_maintenance.asset_id
  for update;

  if not app_private.asset_has_action('asset.maintenance.complete',
    v_asset.warehouse_id,
    v_asset.managing_dept_id,
    app_private.uuid_or_null(v_asset.assigned_to_user_id)
  ) then
    raise exception 'insufficient privilege to complete maintenance' using errcode = '42501';
  end if;

  update public.asset_maintenances
  set status = 'completed'::public.maintenance_status,
      end_date = coalesce(nullif(p_end_date, ''), now()::date::text),
      actual_cost = coalesce(p_actual_cost, actual_cost),
      note = coalesce(nullif(p_note, ''), note)
  where id = p_maintenance_id
  returning * into v_maintenance;

  if v_asset.status = 'MAINTENANCE'::public.asset_status then
    update public.assets
    set status = case
          when nullif(assigned_to_user_id, '') is null then 'AVAILABLE'::public.asset_status
          else 'IN_USE'::public.asset_status
        end,
        updated_at = now()
    where id = v_asset.id;
  end if;

  return v_maintenance;
end;
$$;

drop function if exists public.transfer_asset_stock(text, text, integer, text, text, text, text);

create or replace function public.transfer_asset_stock(
  p_asset_id text,
  p_from_stock_id text,
  p_qty integer,
  p_to_warehouse_id text default null,
  p_to_user_id text default null,
  p_reason text default null,
  p_date text default null,
  p_to_dept_id text default null
)
returns public.asset_transfers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from public.asset_location_stocks%rowtype;
  v_target_id text;
  v_asset public.assets%rowtype;
  v_transfer public.asset_transfers%rowtype;
  v_user public.users%rowtype;
  v_to_user_name text;
  v_from_label text;
  v_to_label text;
begin
  if p_qty <= 0 then
    raise exception 'transfer quantity must be positive' using errcode = '22023';
  end if;

  if nullif(p_to_warehouse_id, '') is null
     and nullif(p_to_user_id, '') is null
     and nullif(p_to_dept_id, '') is null then
    raise exception 'destination is required' using errcode = '22023';
  end if;

  select * into v_from
  from public.asset_location_stocks
  where id = p_from_stock_id and asset_id = p_asset_id
  for update;

  if not found then
    raise exception 'source stock not found' using errcode = 'P0002';
  end if;

  if not app_private.asset_has_action('asset.catalog.transfer_stock', v_from.warehouse_id, v_from.dept_id, app_private.uuid_or_null(v_from.assigned_to_user_id)) then
    raise exception 'insufficient privilege to transfer asset stock from source' using errcode = '42501';
  end if;

  if not app_private.asset_has_action('asset.catalog.transfer_stock', nullif(p_to_warehouse_id, ''), nullif(p_to_dept_id, ''), app_private.uuid_or_null(p_to_user_id)) then
    raise exception 'insufficient privilege to transfer asset stock to destination' using errcode = '42501';
  end if;

  if v_from.qty < p_qty then
    raise exception 'insufficient asset stock: available %, requested %', v_from.qty, p_qty using errcode = '22023';
  end if;

  select * into v_asset from public.assets where id = p_asset_id;
  if not found then
    raise exception 'asset not found' using errcode = 'P0002';
  end if;

  select * into v_user from public.users where id = public.current_app_user_id();
  select name into v_to_user_name from public.users where id::text = nullif(p_to_user_id, '');

  update public.asset_location_stocks
  set qty = qty - p_qty,
      updated_at = now()
  where id = p_from_stock_id;

  select id into v_target_id
  from public.asset_location_stocks
  where asset_id = p_asset_id
    and warehouse_id is not distinct from nullif(p_to_warehouse_id, '')
    and dept_id is not distinct from nullif(p_to_dept_id, '')
    and assigned_to_user_id is not distinct from nullif(p_to_user_id, '')
  limit 1
  for update;

  if v_target_id is null then
    insert into public.asset_location_stocks (
      asset_id, warehouse_id, dept_id, qty, assigned_to_user_id,
      assigned_to_name, updated_at
    )
    values (
      p_asset_id, nullif(p_to_warehouse_id, ''), nullif(p_to_dept_id, ''),
      p_qty, nullif(p_to_user_id, ''), v_to_user_name, now()
    );
  else
    update public.asset_location_stocks
    set qty = qty + p_qty,
        assigned_to_name = coalesce(v_to_user_name, assigned_to_name),
        updated_at = now()
    where id = v_target_id;
  end if;

  select coalesce(v_from.assigned_to_name, w.name, 'Không xác định')
    into v_from_label
  from (select 1) s
  left join public.warehouses w on w.id = v_from.warehouse_id;

  select coalesce(v_to_user_name, w.name, 'Không xác định')
    into v_to_label
  from (select 1) s
  left join public.warehouses w on w.id = nullif(p_to_warehouse_id, '');

  insert into public.asset_transfers (
    code, asset_id, asset_code, asset_name, qty,
    from_warehouse_id, from_site_id, from_dept_id, from_location_label,
    to_warehouse_id, to_dept_id, to_location_label,
    received_by_user_id, received_by_name,
    date, reason, status, performed_by, performed_by_name, created_at
  )
  values (
    public.next_asset_transfer_code(), p_asset_id, v_asset.code, v_asset.name, p_qty,
    v_from.warehouse_id, v_from.construction_site_id, v_from.dept_id, v_from_label,
    nullif(p_to_warehouse_id, ''), nullif(p_to_dept_id, ''), v_to_label,
    nullif(p_to_user_id, ''), v_to_user_name,
    coalesce(nullif(p_date, ''), now()::date::text), p_reason, 'completed',
    public.current_app_user_id()::text, coalesce(v_user.name, v_user.username), now()
  )
  returning * into v_transfer;

  return v_transfer;
end;
$$;

revoke all on function public.create_asset_with_initial_stock(jsonb) from public, anon;
revoke all on function public.dispose_asset(text, text, numeric, text) from public, anon;
revoke all on function public.record_asset_assignment(jsonb) from public, anon;
revoke all on function public.record_asset_maintenance(jsonb, text) from public, anon;
revoke all on function public.complete_asset_maintenance(text, text, numeric, text) from public, anon;
revoke all on function public.transfer_asset_stock(text, text, integer, text, text, text, text, text) from public, anon;

grant execute on function public.create_asset_with_initial_stock(jsonb) to authenticated;
grant execute on function public.dispose_asset(text, text, numeric, text) to authenticated;
grant execute on function public.record_asset_assignment(jsonb) to authenticated;
grant execute on function public.record_asset_maintenance(jsonb, text) to authenticated;
grant execute on function public.complete_asset_maintenance(text, text, numeric, text) to authenticated;
grant execute on function public.transfer_asset_stock(text, text, integer, text, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
