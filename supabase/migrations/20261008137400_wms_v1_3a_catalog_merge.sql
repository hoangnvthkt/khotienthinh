-- V1-3a Module Vật tư: Gộp mã trùng. Chủ sản phẩm chốt 04/10/2026 (docs/designs/project-closed-loop-2026-09-30/13-module-vat-tu-ra-soat.md mục 16, câu 28–29):
--  1. Không sửa lịch sử: sổ kho, phiếu, đơn mua đã có của mã phụ giữ nguyên; thẻ kho mã giữ hiện kèm, ghi "từ mã …".
--  2. Tồn của mã phụ chuyển sang mã giữ bằng phiếu điều chỉnh (ghi sổ) từng kho, giữ nguyên giá trị.
--  3. Kế hoạch chuyển sang mã giữ: dòng ngân sách vật tư / BOQ, dòng kế hoạch vật tư, quy tắc kế hoạch.
--  4. Chặn gộp khi mã phụ còn: đơn mua chưa xong, đề xuất chưa xong, phiếu kho chờ, hợp đồng nguyên tắc chưa xong, tồn âm / giá trị treo,
--     hoặc cùng một kế hoạch đã có cả hai mã. Khác số kích thước → không gộp. Khác ĐVT → người Cấp mã phải xác nhận cùng vật tư.
--  5. Mã phụ thành "Đã gộp vào …" (ngừng dùng + merged_into_id). "Không phải trùng" ghi lý do, không hiện lại.
--  6. Chỉ người Cấp mã / Admin.

alter table public.items add column if not exists merged_into_id text references public.items(id) on delete restrict;
alter table public.items add constraint items_merged_retired_check check (merged_into_id is null or status = 'retired');
create index if not exists items_merged_into_idx on public.items (merged_into_id) where merged_into_id is not null;

create table public.catalog_duplicate_dismissals (
  id uuid primary key default gen_random_uuid(),
  item_ids text[] not null,
  pair_key text not null unique,
  reason text not null,
  actor_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.catalog_duplicate_dismissals enable row level security;
create policy catalog_duplicate_dismissals_select on public.catalog_duplicate_dismissals for select to authenticated
  using (app_private.wms_has_action('wms.inventory.view') or app_private.wms_can_issue_code());
revoke all on public.catalog_duplicate_dismissals from anon;
grant select on public.catalog_duplicate_dismissals to authenticated;

alter table public.item_catalog_events drop constraint item_catalog_events_action_check;
alter table public.item_catalog_events add constraint item_catalog_events_action_check
  check (action in ('issue', 'update', 'rename', 'retire', 'reactivate', 'mode', 'use_existing', 'reject', 'merge', 'merge_into'));

-- Danh mục vật tư là dữ liệu chung toàn công ty: ai xem được kho (mọi kho hoặc một kho), thủ kho, người Cấp mã đều xem được.
create function app_private.wms_can_view_catalog()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_app_user_id() is not null and (public.is_admin() or app_private.wms_can_issue_code()
    or app_private.wms_has_action('wms.inventory.view')
    or exists (select 1 from public.user_permission_grants g where g.user_id = public.current_app_user_id() and g.is_active and g.revoked_at is null
      and (g.expires_at is null or g.expires_at > now()) and g.permission_code in ('wms.inventory.view', 'wms.transaction.keeper')));
$$;
-- Đề xuất mã mới: ô Đề xuất mã (mọi phạm vi), thủ kho (kho bất kỳ), người Cấp mã.
create function app_private.wms_can_propose_code(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user_id is not null and (
    exists (select 1 from public.users u where u.id = p_user_id and u.role = 'ADMIN' and coalesce(u.is_active, true))
    or app_private.has_permission(p_user_id, 'wms.request.create', 'global', '*')
    or app_private.has_permission(p_user_id, 'wms.master_data.issue_code', 'global', '*')
    or exists (select 1 from public.user_permission_grants g where g.user_id = p_user_id and g.is_active and g.revoked_at is null
      and (g.expires_at is null or g.expires_at > now()) and g.permission_code in ('wms.request.create', 'wms.transaction.keeper')));
$$;
alter policy material_code_requests_insert on public.material_code_requests
  with check (requested_by_user_id = public.current_app_user_id() and app_private.wms_can_propose_code(requested_by_user_id));

CREATE OR REPLACE FUNCTION app_private.guard_items_catalog()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('app.catalog_command', true), '') <> 'delete' then
      raise exception using errcode = 'P0001', message = 'ITEM_DELETE_FORBIDDEN: Không xóa vật tư. Dùng "Ngừng dùng" trong Danh mục vật tư.';
    end if;
    return old;
  end if;
  if (new.sku, new.name, new.unit, new.category, new.purchase_unit, new.purchase_conversion_factor, new.status, new.inventory_mode, new.merged_into_id)
     is distinct from (old.sku, old.name, old.unit, old.category, old.purchase_unit, old.purchase_conversion_factor, old.status, old.inventory_mode, old.merged_into_id)
     and coalesce(current_setting('app.catalog_command', true), '') <> 'on' then
    raise exception using errcode = 'P0001', message = 'ITEM_CATALOG_VIA_RPC: Sửa mã, tên, ĐVT, nhóm, quy đổi, trạng thái ở Danh mục vật tư.';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION app_private.catalog_item_json(p_item items)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object('id', p_item.id, 'sku', p_item.sku, 'name', p_item.name, 'unit', p_item.unit, 'category', p_item.category,
    'purchaseUnit', p_item.purchase_unit, 'purchaseConversionFactor', p_item.purchase_conversion_factor, 'minStock', p_item.min_stock,
    'accountingCode', p_item.accounting_code, 'status', p_item.status, 'inventoryMode', p_item.inventory_mode,
    'retiredAt', p_item.retired_at, 'mergedIntoId', p_item.merged_into_id, 'retiredReason', p_item.retired_reason, 'createdAt', p_item.created_at);
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
        'fromSku', case when e.material_id <> p_item_id then (select m.sku from public.items m where m.id = e.material_id) end)
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

CREATE OR REPLACE FUNCTION public.get_catalog_overview_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not app_private.wms_can_view_catalog() then -- V1-3a: ai xem được kho / thủ kho đều xem danh mục
    raise exception using errcode = '42501', message = 'CATALOG_VIEW_DENIED';
  end if;
  return jsonb_build_object(
    'can', jsonb_build_object('issueCode', app_private.wms_can_issue_code(), 'request', app_private.wms_can_propose_code(public.current_app_user_id())),
    'usage', coalesce((select jsonb_object_agg(x.material_id, jsonb_build_array(x.ledger, x.qty)) from (
        select e.material_id, count(*) ledger, coalesce((select sum(b.on_hand_qty) from public.inventory_balances b where b.material_id = e.material_id), 0) qty
        from public.inventory_ledger_entries e group by e.material_id) x), '{}'::jsonb),
    'openPoItems', coalesce((select jsonb_agg(distinct x->>'itemId') from public.purchase_orders po, jsonb_array_elements(po.items) x
        where po.status::text not in ('closed', 'cancelled', 'delivered')), '[]'::jsonb),
    'renames', coalesce((select jsonb_agg(jsonb_build_object('itemId', a.record_id, 'at', a.created_at, 'by', a.user_name,
        'old', a.old_data->>'name', 'new', a.new_data->>'name', 'usage', app_private.catalog_item_usage(a.record_id),
        'usedBefore', app_private.catalog_item_used_before(a.record_id, a.created_at)) order by a.created_at desc)
      from public.audit_trail a where a.table_name = 'items' and a.action = 'UPDATE' and 'name' = any(a.changed_fields)), '[]'::jsonb)
      || coalesce((select jsonb_agg(jsonb_build_object('itemId', c.item_id, 'at', c.created_at, 'by', (select name from public.users where id = c.actor_id),
        'old', c.before->>'name', 'new', c.after->>'name', 'reason', c.reason, 'usage', app_private.catalog_item_usage(c.item_id),
        'usedBefore', app_private.catalog_item_used_before(c.item_id, c.created_at)) order by c.created_at desc)
      from public.item_catalog_events c where c.action = 'rename'), '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.get_catalog_item_v1(p_item_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_item public.items%rowtype;
begin
  if not app_private.wms_can_view_catalog() then -- V1-3a: ai xem được kho / thủ kho đều xem danh mục
    raise exception using errcode = '42501', message = 'CATALOG_VIEW_DENIED';
  end if;
  select * into v_item from public.items where id = p_item_id;
  if not found then raise exception using errcode = 'P0002', message = 'ITEM_NOT_FOUND'; end if;
  return jsonb_build_object(
    'item', app_private.catalog_item_json(v_item),
    'usage', app_private.catalog_item_usage(v_item.id),
    'stock', coalesce((select jsonb_agg(s.j order by s.n) from (
        select w.name n, jsonb_build_object('warehouseId', b.warehouse_id, 'warehouseName', w.name, 'qty', round(sum(b.on_hand_qty), 6),
          'value', round(sum(b.total_value)), 'lastMove', max(b.last_transaction_date)) j
        from public.inventory_balances b join public.warehouses w on w.id = b.warehouse_id
        where b.material_id = v_item.id group by b.warehouse_id, w.name having sum(b.on_hand_qty) <> 0 or abs(sum(b.total_value)) > 1) s), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(x.e order by x.at desc) from (
        select y.e, y.at from (
          select jsonb_build_object('at', c.created_at, 'by', (select name from public.users where id = c.actor_id), 'action', c.action,
            'reason', c.reason, 'before', c.before, 'after', c.after) e, c.created_at at from public.item_catalog_events c where c.item_id = v_item.id
          union all
          select jsonb_build_object('at', a.created_at, 'by', a.user_name, 'action', lower(a.action), 'fields', a.changed_fields,
            'before', jsonb_build_object('name', a.old_data->>'name'), 'after', jsonb_build_object('name', a.new_data->>'name')), a.created_at
          from public.audit_trail a where a.table_name = 'items' and a.record_id = v_item.id and a.action in ('INSERT', 'UPDATE')) y
        order by y.at desc limit 40) x), '[]'::jsonb));
end $function$;


-- Tồn theo kho của một mã (gộp các phạm vi dự án / lô).
create function app_private.catalog_item_stock(p_item_id text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('warehouseId', x.warehouse_id, 'warehouseName', w.name, 'qty', round(x.q, 6), 'value', round(x.v, 2)) order by w.name), '[]'::jsonb)
  from (select b.warehouse_id, sum(b.on_hand_qty) q, sum(b.total_value) v from public.inventory_balances b where b.material_id = p_item_id
    group by b.warehouse_id having sum(b.on_hand_qty) <> 0 or abs(sum(b.total_value)) > 1) x
  join public.warehouses w on w.id = x.warehouse_id;
$$;

-- Lý do chưa gộp được mã phụ vào mã giữ (rỗng = gộp được).
create function app_private.catalog_merge_blockers(p_item_id text, p_keep_id text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(b) filter (where b is not null), '[]'::jsonb) from (values
    ((select 'đang nằm trong ' || count(*) || ' đơn mua chưa xong' from public.purchase_orders po
      where po.items @> jsonb_build_array(jsonb_build_object('itemId', p_item_id)) and po.status::text not in ('closed', 'cancelled', 'delivered') having count(*) > 0)),
    ((select 'đang nằm trong ' || count(*) || ' đề xuất vật tư chưa xong' from public.requests r
      where r.items @> jsonb_build_array(jsonb_build_object('itemId', p_item_id)) and r.status::text in ('DRAFT', 'PENDING', 'APPROVED', 'IN_TRANSIT') having count(*) > 0)),
    ((select count(*) || ' phiếu kho chờ duyệt / đang chuyển' from public.transactions t
      where t.items @> jsonb_build_array(jsonb_build_object('itemId', p_item_id)) and t.status::text in ('PENDING', 'APPROVED', 'IN_TRANSIT') having count(*) > 0)),
    ((select count(*) || ' dòng hợp đồng nguyên tắc NCC chưa xong' from public.supplier_contract_lines l join public.supplier_contracts c on c.id = l.supplier_contract_id
      where l.item_id = p_item_id and c.status::text <> 'completed' having count(*) > 0)),
    ((select 'tồn âm hoặc còn giá trị treo ở ' || string_agg(x->>'warehouseName', ', ') || ' — kiểm kê / kế toán xử lý trước'
      from jsonb_array_elements(app_private.catalog_item_stock(p_item_id)) x where (x->>'qty')::numeric <= 0 having count(*) > 0)),
    ((select 'cùng một kế hoạch vật tư đã có cả hai mã' from public.project_material_plan_lines a join public.project_material_plan_lines k
      on k.plan_id = a.plan_id and k.unit = a.unit and k.item_id = p_keep_id where a.item_id = p_item_id having count(*) > 0)),
    ((select 'cùng một quy tắc kế hoạch đã có cả hai mã' from public.material_planning_rules a join public.material_planning_rules k
      on k.scope_key = a.scope_key and k.inventory_item_id = p_keep_id where a.inventory_item_id = p_item_id having count(*) > 0))
  ) v(b);
$$;

-- Nhóm mã có tên giống nhau sau khi bỏ dấu, hoa thường, dấu cách, "*" / "x". Phân loại do giao diện làm; người Cấp mã quyết định.
create function public.get_catalog_duplicates_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.wms_can_view_catalog() then
    raise exception using errcode = '42501', message = 'CATALOG_VIEW_DENIED';
  end if;
  return jsonb_build_object(
    'can', jsonb_build_object('merge', app_private.wms_can_issue_code()),
    'groups', coalesce((select jsonb_agg(g.j order by g.k) from (
      select x.k, jsonb_build_object('key', x.k, 'items', jsonb_agg(jsonb_build_object('id', i.id, 'sku', i.sku, 'name', i.name, 'unit', i.unit,
          'numbers', app_private.catalog_name_numbers(i.name), 'usage', app_private.catalog_item_usage(i.id), 'stock', app_private.catalog_item_stock(i.id),
          'plan', (select count(*) from public.material_budget_items m where m.inventory_item_id = i.id)
            + (select count(*) from public.project_material_plan_lines m where m.item_id = i.id),
          'pending', (select count(*) from public.transactions t where t.status::text in ('PENDING', 'APPROVED', 'IN_TRANSIT')
            and t.items @> jsonb_build_array(jsonb_build_object('itemId', i.id))),
          'lastUsed', (select max(le.transaction_date) from public.inventory_ledger_entries le where le.material_id = i.id)) order by i.sku)) j
      from (select app_private.catalog_name_key(it.name) k, it.id from public.items it where it.status = 'active') x
      join public.items i on i.id = x.id
      group by x.k having count(*) > 1
        and not exists (select 1 from public.catalog_duplicate_dismissals d where d.pair_key = (select string_agg(y.id, '|' order by y.id)
          from (select it2.id from public.items it2 where it2.status = 'active' and app_private.catalog_name_key(it2.name) = x.k) y))) g), '[]'::jsonb),
    'merged', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'sku', i.sku, 'name', i.name, 'intoId', i.merged_into_id,
        'intoSku', (select sku from public.items where id = i.merged_into_id), 'at', i.retired_at) order by i.retired_at desc)
      from public.items i where i.merged_into_id is not null), '[]'::jsonb),
    'dismissed', coalesce((select jsonb_agg(jsonb_build_object('itemIds', d.item_ids, 'reason', d.reason, 'at', d.created_at,
        'by', (select name from public.users where id = d.actor_id)) order by d.created_at desc) from public.catalog_duplicate_dismissals d), '[]'::jsonb));
end $$;

-- Xem trước khi gộp: lý do chặn của từng mã phụ.
create function public.preview_catalog_merge_v1(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.wms_can_view_catalog() then
    raise exception using errcode = '42501', message = 'CATALOG_VIEW_DENIED';
  end if;
  return coalesce((select jsonb_object_agg(m.id, app_private.catalog_merge_blockers(m.id, p->>'keepId'))
    from jsonb_array_elements_text(coalesce(p->'mergeIds', '[]'::jsonb)) m(id)), '{}'::jsonb);
end $$;

-- p = { keepId, mergeIds: [itemId], unitConfirmed: bool, note }
create function public.merge_catalog_items_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_keep public.items%rowtype;
  v_old public.items%rowtype;
  v_new public.items%rowtype;
  v_ids text[];
  v_id text;
  v_block jsonb;
  v_note text := nullif(btrim(coalesce(p->>'note', '')), '');
  v_reason text;
  v_tx_ids text[] := '{}';
  v_tx_id text;
  v_lines jsonb;
  w record;
  v_moved int := 0;
  v_plan int := 0;
begin
  if not app_private.wms_can_issue_code() then raise exception using errcode = '42501', message = 'CATALOG_ISSUE_DENIED'; end if;
  select * into v_keep from public.items where id = p->>'keepId' for update;
  if not found then raise exception using errcode = 'P0002', message = 'ITEM_NOT_FOUND'; end if;
  if v_keep.status <> 'active' then raise exception using errcode = '22023', message = 'MERGE_KEEP_NOT_ACTIVE'; end if;
  select array_agg(distinct x) into v_ids from jsonb_array_elements_text(coalesce(p->'mergeIds', '[]'::jsonb)) x where x <> v_keep.id;
  if v_ids is null or cardinality(v_ids) = 0 then raise exception using errcode = '22023', message = 'MERGE_NOTHING'; end if;
  v_reason := 'Gộp vào ' || v_keep.sku || ' ' || v_keep.name || coalesce(' — ' || v_note, '');

  foreach v_id in array v_ids loop
    select * into v_old from public.items where id = v_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'ITEM_NOT_FOUND'; end if;
    if v_old.status <> 'active' then raise exception using errcode = '22023', message = 'MERGE_ITEM_NOT_ACTIVE: ' || v_old.sku; end if;
    if app_private.catalog_name_numbers(v_old.name) is distinct from app_private.catalog_name_numbers(v_keep.name) then
      raise exception using errcode = '22023', message = 'MERGE_SIZE_DIFF: ' || v_old.sku || ' khác số kích thước với ' || v_keep.sku || ' — là vật tư khác.';
    end if;
    if lower(btrim(v_old.unit)) is distinct from lower(btrim(v_keep.unit)) and not coalesce((p->>'unitConfirmed')::boolean, false) then
      raise exception using errcode = '22023', message = 'MERGE_UNIT_CONFIRM: ' || v_old.sku || ' (' || v_old.unit || ') khác ĐVT với ' || v_keep.sku || ' (' || v_keep.unit || ').';
    end if;
    v_block := app_private.catalog_merge_blockers(v_old.id, v_keep.id);
    if jsonb_array_length(v_block) > 0 then
      raise exception using errcode = '22023', message = 'MERGE_BLOCKED: ' || v_old.sku || ': ' || (select string_agg(b, '; ') from jsonb_array_elements_text(v_block) b);
    end if;
  end loop;

  -- 1) Chuyển tồn: mỗi kho một phiếu điều chỉnh (xuất mã phụ, nhập mã giữ, cùng giá bình quân của mã phụ → giữ nguyên giá trị).
  for w in select b.warehouse_id from public.inventory_balances b where b.material_id = any(v_ids)
    group by b.warehouse_id having sum(b.on_hand_qty) <> 0 order by b.warehouse_id
  loop
    select jsonb_agg(l order by o) into v_lines from (
      select 1 o, jsonb_build_object('itemId', x.material_id, 'quantity', -x.q, 'price', case when x.q > 0 then x.v / x.q else 0 end, 'catalogMergeInto', v_keep.id) l
      from (select b.material_id, sum(b.on_hand_qty) q, sum(b.total_value) v from public.inventory_balances b
        where b.material_id = any(v_ids) and b.warehouse_id = w.warehouse_id group by b.material_id having sum(b.on_hand_qty) <> 0) x
      union all
      select 2, jsonb_build_object('itemId', v_keep.id, 'quantity', x.q, 'price', case when x.q > 0 then x.v / x.q else 0 end, 'catalogMergeFrom', x.material_id)
      from (select b.material_id, sum(b.on_hand_qty) q, sum(b.total_value) v from public.inventory_balances b
        where b.material_id = any(v_ids) and b.warehouse_id = w.warehouse_id group by b.material_id having sum(b.on_hand_qty) <> 0) x) z;
    v_tx_id := 'tx-catalog-merge-' || v_keep.id || '-' || w.warehouse_id || '-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
    insert into public.transactions (id, type, date, items, target_warehouse_id, requester_id, approver_id, approved_at, status, note, business_event_type, business_event_reason)
    values (v_tx_id, 'ADJUSTMENT', now(), v_lines, w.warehouse_id, v_actor, v_actor, now(), 'COMPLETED', v_reason, 'inventory_adjustment', 'Gộp mã trùng');
    v_tx_ids := v_tx_ids || v_tx_id;
    v_moved := v_moved + 1;
  end loop;

  -- 2) Kế hoạch sang mã giữ.
  update public.material_budget_items set inventory_item_id = v_keep.id where inventory_item_id = any(v_ids);
  get diagnostics v_plan = row_count;
  update public.project_material_plan_lines set item_id = v_keep.id where item_id = any(v_ids);
  update public.material_planning_rules set inventory_item_id = v_keep.id where inventory_item_id = any(v_ids);

  -- 3) Mã phụ: Đã gộp vào mã giữ.
  perform set_config('app.catalog_command', 'on', true);
  foreach v_id in array v_ids loop
    select * into v_old from public.items where id = v_id;
    update public.items set status = 'retired', merged_into_id = v_keep.id, retired_at = now(), retired_by = v_actor, retired_reason = v_reason
    where id = v_id returning * into v_new;
    perform app_private.catalog_log(v_id, 'merge', app_private.catalog_item_json(v_old), app_private.catalog_item_json(v_new), v_reason);
  end loop;
  perform set_config('app.catalog_command', '', true);
  perform app_private.catalog_log(v_keep.id, 'merge_into', null,
    jsonb_build_object('mergedIds', to_jsonb(v_ids), 'mergedSkus', (select jsonb_agg(sku) from public.items where id = any(v_ids)), 'transactions', to_jsonb(v_tx_ids)), v_reason);
  return jsonb_build_object('keepId', v_keep.id, 'mergedIds', to_jsonb(v_ids), 'transactions', to_jsonb(v_tx_ids), 'warehouses', v_moved, 'budgetLines', v_plan);
end $$;

-- p = { itemIds: [itemId], reason }
create function public.dismiss_catalog_duplicate_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ids text[]; v_reason text := nullif(btrim(coalesce(p->>'reason', '')), '');
begin
  if not app_private.wms_can_issue_code() then raise exception using errcode = '42501', message = 'CATALOG_ISSUE_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'CATALOG_REASON_REQUIRED'; end if;
  select array_agg(distinct x order by x) into v_ids from jsonb_array_elements_text(coalesce(p->'itemIds', '[]'::jsonb)) x;
  if v_ids is null or cardinality(v_ids) < 2 then raise exception using errcode = '22023', message = 'MERGE_NOTHING'; end if;
  insert into public.catalog_duplicate_dismissals (item_ids, pair_key, reason, actor_id)
  values (v_ids, array_to_string(v_ids, '|'), v_reason, public.current_app_user_id())
  on conflict (pair_key) do update set reason = excluded.reason, actor_id = excluded.actor_id, created_at = now();
  return jsonb_build_object('itemIds', to_jsonb(v_ids));
end $$;

revoke all on function app_private.catalog_item_stock(text), app_private.catalog_merge_blockers(text, text), app_private.wms_can_view_catalog(), app_private.wms_can_propose_code(uuid) from public, anon;
grant execute on function app_private.wms_can_view_catalog(), app_private.wms_can_propose_code(uuid) to authenticated;
revoke all on function public.get_catalog_duplicates_v1(), public.preview_catalog_merge_v1(jsonb), public.merge_catalog_items_v1(jsonb), public.dismiss_catalog_duplicate_v1(jsonb) from public, anon;
grant execute on function public.get_catalog_duplicates_v1(), public.preview_catalog_merge_v1(jsonb), public.merge_catalog_items_v1(jsonb), public.dismiss_catalog_duplicate_v1(jsonb) to authenticated;

notify pgrst, 'reload schema';
