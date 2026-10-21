-- Báo cáo kho (21/10/2026): lỗi "canceling statement due to statement timeout" + bảng Nhập – Xuất – Tồn kiểu MISA.
--
-- 1. get_inventory_ledger_report (và hàm bên trong *_pre_reversal_20260905) gọi
--    app_private.can_read_inventory_scope(kho, người lập, người duyệt) cho TỪNG DÒNG sổ kho, mỗi lần kéo theo
--    wms_has_action + has_permission (vài chục ms). 921 dòng × 4 lượt quét ≈ 7,8 s với kế toán kho
--    (đo 21/10 dưới quyền chị Phương) → chạm statement_timeout 8 s của vai authenticated, màn Báo cáo rơi về
--    "Fallback từ transactions cũ" với số sai.
--    Sửa: tính tập phạm vi (token) MỘT lần mỗi lần gọi bằng đúng biểu thức của policy
--    inventory_ledger_entries_select đã chứng minh tương đương can_read_inventory_scope ở #267
--    (docs/performance/rls-initplan-wms-2026-10.md). Phần còn lại của hai hàm giữ nguyên văn bản production.
-- 2. Ngày lọc dạng 'YYYY-MM-DD' hiểu theo giờ Việt Nam (trước đây theo UTC nên lệch 7 giờ ở đầu / cuối kỳ).
--    Chuỗi có giờ (ISO) giữ cách hiểu cũ.
-- 3. get_inventory_nxt_report_v1: Tổng hợp tồn kho theo kho × vật tư, mỗi giai đoạn có Số lượng và Giá trị
--    (Đầu kỳ, Nhập kho, Xuất kho, Cuối kỳ) như MISA. Giá trị = tiền đã ghi trên sổ kho (amount, đã tính giá
--    xuất bình quân lúc ghi sổ) nên khớp cột "giá trị tồn sau giao dịch". Phiếu "Tồn đầu kỳ" (opening_balance)
--    trong kỳ được tính vào Đầu kỳ như PR VPP.

-- ---------------------------------------------------------------------------------------------------------
-- Ngày lọc theo giờ Việt Nam
create or replace function app_private.inventory_report_day_start(p_value text)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
    when nullif(trim(coalesce(p_value, '')), '') is null then null
    when trim(p_value) ~ '^\d{4}-\d{2}-\d{2}$' then (trim(p_value)::date)::timestamp at time zone 'Asia/Ho_Chi_Minh'
    else trim(p_value)::timestamptz
  end;
$$;

create or replace function app_private.inventory_report_day_end(p_value text)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
    when nullif(trim(coalesce(p_value, '')), '') is null then null
    when trim(p_value) ~ '^\d{4}-\d{2}-\d{2}$'
      then ((trim(p_value)::date + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh') - interval '1 millisecond'
    else date_trunc('day', trim(p_value)::timestamptz) + interval '1 day' - interval '1 millisecond'
  end;
$$;

revoke all on function app_private.inventory_report_day_start(text) from public, anon, authenticated;
revoke all on function app_private.inventory_report_day_end(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- 1. Hai hàm báo cáo cũ: thay kiểm quyền theo dòng bằng token tính một lần.
create or replace function public.get_inventory_ledger_report_pre_reversal_20260905(p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 500, p_cursor text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_actor uuid := public.current_app_user_id();
  -- Phạm vi đọc sổ kho tính MỘT lần mỗi lần gọi (cùng nghĩa policy inventory_ledger_entries_select, #267).
  v_view_tokens text[] := app_private.wms_action_scope_tokens(array['wms.inventory.view']);
  v_keeper_tokens text[] := app_private.permission_scope_tokens(array['wms.transaction.keeper']);
  v_limit int := greatest(1, least(coalesce(p_limit, 500), 1000));
  v_warehouse_id text := nullif(coalesce(p_filters ->> 'warehouseId', p_filters ->> 'warehouse_id'), '');
  v_material_id text := nullif(coalesce(p_filters ->> 'materialId', p_filters ->> 'material_id'), '');
  v_project_id text := nullif(coalesce(p_filters ->> 'projectId', p_filters ->> 'project_id'), '');
  v_construction_site_id text := nullif(coalesce(p_filters ->> 'constructionSiteId', p_filters ->> 'construction_site_id'), '');
  v_transaction_type text := nullif(coalesce(p_filters ->> 'transactionType', p_filters ->> 'transaction_type'), '');
  v_date_from timestamptz := app_private.inventory_report_day_start(coalesce(p_filters ->> 'dateFrom', p_filters ->> 'date_from'));
  v_date_to timestamptz := app_private.inventory_report_day_end(coalesce(p_filters ->> 'dateTo', p_filters ->> 'date_to'));
  v_search text := lower(trim(coalesce(p_filters ->> 'search', '')));
  v_cursor_date text := nullif(split_part(coalesce(p_cursor, ''), '|', 1), '');
  v_cursor_id text := nullif(split_part(coalesce(p_cursor, ''), '|', 2), '');
  v_summary jsonb := '{}'::jsonb;
  v_stock_rows jsonb := '[]'::jsonb;
  v_warehouse_rows jsonb := '[]'::jsonb;
  v_entries jsonb := '[]'::jsonb;
  v_next_cursor text := null;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  if v_warehouse_id = 'ALL' then v_warehouse_id := null; end if;
  if v_material_id = 'ALL' then v_material_id := null; end if;
  if v_transaction_type = 'all' then v_transaction_type := null; end if;

  with readable as (
    select e.*, i.sku, i.name as item_name, i.unit as item_unit, i.price_in, w.name as warehouse_name
    from public.inventory_ledger_entries e
    left join public.items i on i.id = e.material_id
    left join public.warehouses w on w.id = e.warehouse_id
    where (
        v_view_tokens && array[
          'global:*',
          case when e.warehouse_id is not null then 'warehouse:*' end,
          'warehouse:' || e.warehouse_id,
          case when e.created_by = v_actor then 'own:*' end,
          case when e.approved_by = v_actor then 'assigned:*' end
        ]
        or e.created_by = v_actor
        or e.approved_by = v_actor
        or v_keeper_tokens && array[
          'global:*',
          case when e.warehouse_id is not null then 'warehouse:*' end,
          'warehouse:' || e.warehouse_id
        ]
      )
      and (v_warehouse_id is null or e.warehouse_id = v_warehouse_id)
      and (v_material_id is null or e.material_id = v_material_id)
      and (v_project_id is null or e.project_id = v_project_id)
      and (v_construction_site_id is null or e.construction_site_id = v_construction_site_id)
      and (v_date_to is null or e.transaction_date <= v_date_to)
      and (
        v_search = ''
        or lower(
          coalesce(i.sku, '') || ' ' ||
          coalesce(i.name, '') || ' ' ||
          coalesce(e.document_code, '') || ' ' ||
          coalesce(e.source_code, '') || ' ' ||
          coalesce(e.description, '')
        ) like '%' || v_search || '%'
      )
  ),
  material_group as (
    select
      material_id,
      max(sku) as sku,
      max(item_name) as item_name,
      max(item_unit) as unit,
      max(price_in) as price_in,
      sum(case when v_date_from is not null and transaction_date < v_date_from then quantity_delta else 0 end) as opening,
      sum(case when (v_date_from is null or transaction_date >= v_date_from)
          and (v_transaction_type is null or transaction_type = v_transaction_type)
          and movement_direction = 'in' and transaction_type not in ('transfer_receipt', 'adjustment_in')
        then quantity_in else 0 end) as in_import,
      sum(case when (v_date_from is null or transaction_date >= v_date_from)
          and (v_transaction_type is null or transaction_type = v_transaction_type)
          and transaction_type = 'transfer_receipt'
        then quantity_in else 0 end) as in_transfer,
      sum(case when (v_date_from is null or transaction_date >= v_date_from)
          and (v_transaction_type is null or transaction_type = v_transaction_type)
          and transaction_type = 'adjustment_in'
        then quantity_in else 0 end) as in_adjustment,
      sum(case when (v_date_from is null or transaction_date >= v_date_from)
          and (v_transaction_type is null or transaction_type = v_transaction_type)
          and movement_direction = 'out' and transaction_type not in ('transfer_issue', 'loss_issue', 'adjustment_out')
        then quantity_out else 0 end) as out_export,
      sum(case when (v_date_from is null or transaction_date >= v_date_from)
          and (v_transaction_type is null or transaction_type = v_transaction_type)
          and transaction_type = 'transfer_issue'
        then quantity_out else 0 end) as out_transfer,
      sum(case when (v_date_from is null or transaction_date >= v_date_from)
          and (v_transaction_type is null or transaction_type = v_transaction_type)
          and transaction_type in ('loss_issue', 'adjustment_out')
        then quantity_out else 0 end) as out_liquidation
    from readable
    group by material_id
  ),
  stock as (
    select
      material_id as id,
      coalesce(max(sku), material_id) as sku,
      coalesce(max(item_name), material_id) as name,
      max(unit) as unit,
      coalesce(opening, 0) as opening,
      coalesce(in_import, 0) as in_import,
      coalesce(in_transfer, 0) as in_transfer,
      coalesce(in_adjustment, 0) as in_adjustment,
      coalesce(out_export, 0) as out_export,
      coalesce(out_transfer, 0) as out_transfer,
      coalesce(out_liquidation, 0) as out_liquidation,
      coalesce(in_import, 0) + coalesce(in_transfer, 0) + coalesce(in_adjustment, 0) as total_in,
      coalesce(out_export, 0) + coalesce(out_transfer, 0) + coalesce(out_liquidation, 0) as total_out,
      coalesce(opening, 0)
        + coalesce(in_import, 0) + coalesce(in_transfer, 0) + coalesce(in_adjustment, 0)
        - coalesce(out_export, 0) - coalesce(out_transfer, 0) - coalesce(out_liquidation, 0) as closing,
      (
        coalesce(opening, 0)
        + coalesce(in_import, 0) + coalesce(in_transfer, 0) + coalesce(in_adjustment, 0)
        - coalesce(out_export, 0) - coalesce(out_transfer, 0) - coalesce(out_liquidation, 0)
      ) * coalesce(max(price_in), 0) as value
    from material_group
    group by material_id, opening, in_import, in_transfer, in_adjustment, out_export, out_transfer, out_liquidation
  ),
  period_entries as (
    select *
    from readable
    where (v_date_from is null or transaction_date >= v_date_from)
      and (v_transaction_type is null or transaction_type = v_transaction_type)
  ),
  warehouse_group as (
    select
      warehouse_id,
      material_id,
      max(warehouse_name) as warehouse_name,
      max(sku) as sku,
      max(item_name) as material_name,
      max(item_unit) as unit,
      sum(quantity_in) as in_qty,
      sum(quantity_out) as out_qty,
      (array_agg(balance_after_qty order by transaction_date desc, id desc))[1] as balance_qty,
      max(transaction_date) as last_date
    from period_entries
    group by warehouse_id, material_id
  ),
  entry_page as (
    select *
    from period_entries
    where (
      v_cursor_date is null
      or transaction_date::text < v_cursor_date
      or (transaction_date::text = v_cursor_date and id::text < coalesce(v_cursor_id, ''))
    )
    order by transaction_date desc, id desc
    limit v_limit + 1
  ),
  entry_limited as (
    select *
    from entry_page
    order by transaction_date desc, id desc
    limit v_limit
  )
  select
    jsonb_build_object(
      'opening', coalesce(sum(opening), 0),
      'totalIn', coalesce(sum(total_in), 0),
      'totalOut', coalesce(sum(total_out), 0),
      'closing', coalesce(sum(closing), 0),
      'totalValue', coalesce(sum(value), 0)
    ),
    coalesce(jsonb_agg(to_jsonb(stock) order by stock.name), '[]'::jsonb)
  into v_summary, v_stock_rows
  from stock;

  with readable as (
    select e.*, i.sku, i.name as item_name, i.unit as item_unit, w.name as warehouse_name
    from public.inventory_ledger_entries e
    left join public.items i on i.id = e.material_id
    left join public.warehouses w on w.id = e.warehouse_id
    where (
        v_view_tokens && array[
          'global:*',
          case when e.warehouse_id is not null then 'warehouse:*' end,
          'warehouse:' || e.warehouse_id,
          case when e.created_by = v_actor then 'own:*' end,
          case when e.approved_by = v_actor then 'assigned:*' end
        ]
        or e.created_by = v_actor
        or e.approved_by = v_actor
        or v_keeper_tokens && array[
          'global:*',
          case when e.warehouse_id is not null then 'warehouse:*' end,
          'warehouse:' || e.warehouse_id
        ]
      )
      and (v_warehouse_id is null or e.warehouse_id = v_warehouse_id)
      and (v_material_id is null or e.material_id = v_material_id)
      and (v_project_id is null or e.project_id = v_project_id)
      and (v_construction_site_id is null or e.construction_site_id = v_construction_site_id)
      and (v_date_to is null or e.transaction_date <= v_date_to)
      and (v_date_from is null or e.transaction_date >= v_date_from)
      and (v_transaction_type is null or e.transaction_type = v_transaction_type)
      and (
        v_search = ''
        or lower(
          coalesce(i.sku, '') || ' ' ||
          coalesce(i.name, '') || ' ' ||
          coalesce(e.document_code, '') || ' ' ||
          coalesce(e.source_code, '') || ' ' ||
          coalesce(e.description, '')
        ) like '%' || v_search || '%'
      )
  ),
  warehouse_group as (
    select
      warehouse_id,
      material_id,
      max(warehouse_name) as warehouse_name,
      max(sku) as sku,
      max(item_name) as material_name,
      max(item_unit) as unit,
      sum(quantity_in) as in_qty,
      sum(quantity_out) as out_qty,
      (array_agg(balance_after_qty order by transaction_date desc, id desc))[1] as balance_qty,
      max(transaction_date) as last_date
    from readable
    group by warehouse_id, material_id
  )
  select coalesce(jsonb_agg(to_jsonb(warehouse_group) order by warehouse_name, material_name), '[]'::jsonb)
  into v_warehouse_rows
  from warehouse_group;

  with readable as (
    select e.*, i.sku, i.name as item_name, i.unit as item_unit, w.name as warehouse_name
    from public.inventory_ledger_entries e
    left join public.items i on i.id = e.material_id
    left join public.warehouses w on w.id = e.warehouse_id
    where (
        v_view_tokens && array[
          'global:*',
          case when e.warehouse_id is not null then 'warehouse:*' end,
          'warehouse:' || e.warehouse_id,
          case when e.created_by = v_actor then 'own:*' end,
          case when e.approved_by = v_actor then 'assigned:*' end
        ]
        or e.created_by = v_actor
        or e.approved_by = v_actor
        or v_keeper_tokens && array[
          'global:*',
          case when e.warehouse_id is not null then 'warehouse:*' end,
          'warehouse:' || e.warehouse_id
        ]
      )
      and (v_warehouse_id is null or e.warehouse_id = v_warehouse_id)
      and (v_material_id is null or e.material_id = v_material_id)
      and (v_project_id is null or e.project_id = v_project_id)
      and (v_construction_site_id is null or e.construction_site_id = v_construction_site_id)
      and (v_date_to is null or e.transaction_date <= v_date_to)
      and (v_date_from is null or e.transaction_date >= v_date_from)
      and (v_transaction_type is null or e.transaction_type = v_transaction_type)
      and (
        v_search = ''
        or lower(
          coalesce(i.sku, '') || ' ' ||
          coalesce(i.name, '') || ' ' ||
          coalesce(e.document_code, '') || ' ' ||
          coalesce(e.source_code, '') || ' ' ||
          coalesce(e.description, '')
        ) like '%' || v_search || '%'
      )
  ),
  entry_page as (
    select *
    from readable
    where (
      v_cursor_date is null
      or transaction_date::text < v_cursor_date
      or (transaction_date::text = v_cursor_date and id::text < coalesce(v_cursor_id, ''))
    )
    order by transaction_date desc, id desc
    limit v_limit + 1
  ),
  entry_limited as (
    select *
    from entry_page
    order by transaction_date desc, id desc
    limit v_limit
  )
  select
    coalesce(jsonb_agg(to_jsonb(entry_limited) order by transaction_date desc, id desc), '[]'::jsonb),
    case when (select count(*) from entry_page) > v_limit then (
      select e.transaction_date::text || '|' || e.id::text
      from entry_limited e
      order by e.transaction_date desc, e.id desc
      offset v_limit - 1
      limit 1
    ) else null end
  into v_entries, v_next_cursor
  from entry_limited;

  return jsonb_build_object(
    'filters', p_filters,
    'limit', v_limit,
    'cursor', p_cursor,
    'nextCursor', v_next_cursor,
    'summary', coalesce(v_summary, '{}'::jsonb),
    'stockRows', coalesce(v_stock_rows, '[]'::jsonb),
    'warehouseRows', coalesce(v_warehouse_rows, '[]'::jsonb),
    'entriesPage', coalesce(v_entries, '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_inventory_ledger_report(p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 500, p_cursor text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_actor uuid := public.current_app_user_id();
  -- Phạm vi đọc sổ kho tính MỘT lần mỗi lần gọi (cùng nghĩa policy inventory_ledger_entries_select, #267).
  v_view_tokens text[] := app_private.wms_action_scope_tokens(array['wms.inventory.view']);
  v_keeper_tokens text[] := app_private.permission_scope_tokens(array['wms.transaction.keeper']);
  v_result jsonb;
  v_stock_rows jsonb;
  v_reversal_by_material jsonb := '{}'::jsonb;
  v_warehouse_id text := nullif(coalesce(p_filters ->> 'warehouseId', p_filters ->> 'warehouse_id'), '');
  v_material_id text := nullif(coalesce(p_filters ->> 'materialId', p_filters ->> 'material_id'), '');
  v_project_id text := nullif(coalesce(p_filters ->> 'projectId', p_filters ->> 'project_id'), '');
  v_construction_site_id text := nullif(coalesce(p_filters ->> 'constructionSiteId', p_filters ->> 'construction_site_id'), '');
  v_transaction_type text := nullif(coalesce(p_filters ->> 'transactionType', p_filters ->> 'transaction_type'), '');
  v_date_from timestamptz := app_private.inventory_report_day_start(coalesce(p_filters ->> 'dateFrom', p_filters ->> 'date_from'));
  v_date_to timestamptz := app_private.inventory_report_day_end(coalesce(p_filters ->> 'dateTo', p_filters ->> 'date_to'));
  v_search text := lower(trim(coalesce(p_filters ->> 'search', '')));
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;

  if v_warehouse_id = 'ALL' then v_warehouse_id := null; end if;
  if v_material_id = 'ALL' then v_material_id := null; end if;
  if v_transaction_type = 'all' then v_transaction_type := null; end if;

  v_result := public.get_inventory_ledger_report_pre_reversal_20260905(
    p_filters,
    p_limit,
    p_cursor
  );

  select coalesce(jsonb_object_agg(grouped.material_id, grouped.quantity), '{}'::jsonb)
  into v_reversal_by_material
  from (
    select entry.material_id, sum(entry.quantity_in)::numeric as quantity
    from public.inventory_ledger_entries entry
    left join public.items item on item.id = entry.material_id
    where (
        v_view_tokens && array[
          'global:*',
          case when entry.warehouse_id is not null then 'warehouse:*' end,
          'warehouse:' || entry.warehouse_id,
          case when entry.created_by = v_actor then 'own:*' end,
          case when entry.approved_by = v_actor then 'assigned:*' end
        ]
        or entry.created_by = v_actor
        or entry.approved_by = v_actor
        or v_keeper_tokens && array[
          'global:*',
          case when entry.warehouse_id is not null then 'warehouse:*' end,
          'warehouse:' || entry.warehouse_id
        ]
      )
      and entry.transaction_type = 'reversal'
      and (v_transaction_type is null or v_transaction_type = 'reversal')
      and (v_warehouse_id is null or entry.warehouse_id = v_warehouse_id)
      and (v_material_id is null or entry.material_id = v_material_id)
      and (v_project_id is null or entry.project_id = v_project_id)
      and (v_construction_site_id is null or entry.construction_site_id = v_construction_site_id)
      and (v_date_from is null or entry.transaction_date >= v_date_from)
      and (v_date_to is null or entry.transaction_date <= v_date_to)
      and (
        v_search = ''
        or lower(
          coalesce(item.sku, '') || ' ' ||
          coalesce(item.name, '') || ' ' ||
          coalesce(entry.document_code, '') || ' ' ||
          coalesce(entry.source_code, '') || ' ' ||
          coalesce(entry.description, '')
        ) like '%' || v_search || '%'
      )
    group by entry.material_id
  ) grouped;

  select coalesce(jsonb_agg(
    stock.value || jsonb_build_object(
      'in_import', greatest(
        coalesce((stock.value ->> 'in_import')::numeric, 0) - quantities.in_reversal,
        0
      ),
      'in_reversal', quantities.in_reversal,
      'total_in',
        greatest(
          coalesce((stock.value ->> 'in_import')::numeric, 0) - quantities.in_reversal,
          0
        )
        + coalesce((stock.value ->> 'in_transfer')::numeric, 0)
        + coalesce((stock.value ->> 'in_adjustment')::numeric, 0)
        + quantities.in_reversal
    )
    order by stock.ordinality
  ), '[]'::jsonb)
  into v_stock_rows
  from jsonb_array_elements(coalesce(v_result -> 'stockRows', '[]'::jsonb))
    with ordinality stock(value, ordinality)
  cross join lateral (
    select coalesce(
      (v_reversal_by_material ->> (stock.value ->> 'id'))::numeric,
      0
    ) as in_reversal
  ) quantities;

  return jsonb_set(v_result, '{stockRows}', v_stock_rows, true);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 3. Nhập – Xuất – Tồn theo kho × vật tư (Số lượng + Giá trị).
create or replace function public.get_inventory_nxt_report_v1(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_view_tokens text[];
  v_keeper_tokens text[];
  v_warehouse_id text := nullif(nullif(coalesce(p_filters ->> 'warehouseId', ''), ''), 'ALL');
  v_material_id text := nullif(nullif(coalesce(p_filters ->> 'materialId', ''), ''), 'ALL');
  v_from timestamptz := app_private.inventory_report_day_start(p_filters ->> 'dateFrom');
  v_to timestamptz := app_private.inventory_report_day_end(p_filters ->> 'dateTo');
  v_search text := lower(trim(coalesce(p_filters ->> 'search', '')));
  v_rows jsonb;
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if v_from is null or v_to is null then
    raise exception 'Chọn Từ ngày và Đến ngày' using errcode = '22023';
  end if;
  if v_from > v_to then
    raise exception 'Từ ngày phải trước Đến ngày' using errcode = '22023';
  end if;

  v_view_tokens := app_private.wms_action_scope_tokens(array['wms.inventory.view']);
  v_keeper_tokens := app_private.permission_scope_tokens(array['wms.transaction.keeper']);

  with scoped as (
    select
      e.warehouse_id,
      e.material_id,
      (
        e.transaction_date < v_from
        or coalesce(e.business_event_type, e.metadata ->> 'businessEventType') = 'opening_balance'
      ) as is_opening,
      e.movement_direction,
      coalesce(e.quantity_in, 0) as quantity_in,
      coalesce(e.quantity_out, 0) as quantity_out,
      coalesce(e.quantity_delta, 0) as quantity_delta,
      coalesce(e.amount, 0) as amount
    from public.inventory_ledger_entries e
    left join public.items i on i.id = e.material_id
    where e.transaction_date <= v_to
      and (v_warehouse_id is null or e.warehouse_id = v_warehouse_id)
      and (v_material_id is null or e.material_id = v_material_id)
      and (
        v_search = ''
        or lower(coalesce(i.sku, '') || ' ' || coalesce(i.name, '')) like '%' || v_search || '%'
      )
      and (
        v_view_tokens && array[
          'global:*',
          case when e.warehouse_id is not null then 'warehouse:*' end,
          'warehouse:' || e.warehouse_id,
          case when e.created_by = v_actor then 'own:*' end,
          case when e.approved_by = v_actor then 'assigned:*' end
        ]
        or e.created_by = v_actor
        or e.approved_by = v_actor
        or v_keeper_tokens && array[
          'global:*',
          case when e.warehouse_id is not null then 'warehouse:*' end,
          'warehouse:' || e.warehouse_id
        ]
      )
  ),
  grouped as (
    select
      warehouse_id,
      material_id,
      coalesce(sum(quantity_delta) filter (where is_opening), 0) as opening_qty,
      coalesce(sum(amount) filter (where is_opening), 0) as opening_value,
      coalesce(sum(quantity_in) filter (where not is_opening), 0) as in_qty,
      coalesce(sum(amount) filter (where not is_opening and movement_direction = 'in'), 0) as in_value,
      coalesce(sum(quantity_out) filter (where not is_opening), 0) as out_qty,
      -coalesce(sum(amount) filter (where not is_opening and movement_direction = 'out'), 0) as out_value,
      count(*) filter (where not is_opening and movement_direction = 'in' and quantity_in > 0 and amount = 0) as unpriced_in_lines
    from scoped
    group by warehouse_id, material_id
  ),
  shaped as (
    select
      g.*,
      g.opening_qty + g.in_qty - g.out_qty as closing_qty,
      g.opening_value + g.in_value - g.out_value as closing_value,
      i.sku,
      i.name as material_name,
      i.unit,
      w.name as warehouse_name
    from grouped g
    left join public.items i on i.id = g.material_id
    left join public.warehouses w on w.id = g.warehouse_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'warehouseId', s.warehouse_id,
      'warehouseName', coalesce(s.warehouse_name, s.warehouse_id),
      'materialId', s.material_id,
      'sku', coalesce(s.sku, s.material_id),
      'name', coalesce(s.material_name, s.material_id),
      'unit', s.unit,
      'openingQty', round(s.opening_qty, 4),
      'openingValue', round(s.opening_value, 0),
      'inQty', round(s.in_qty, 4),
      'inValue', round(s.in_value, 0),
      'outQty', round(s.out_qty, 4),
      'outValue', round(s.out_value, 0),
      'closingQty', round(s.closing_qty, 4),
      'closingValue', round(s.closing_value, 0),
      'unpricedInLines', s.unpriced_in_lines,
      'itemMissing', s.material_name is null
    ) order by s.material_name is null, coalesce(s.sku, s.material_id), coalesce(s.warehouse_name, s.warehouse_id)), '[]'::jsonb)
  into v_rows
  from shaped s
  -- Bỏ dòng không có số liệu (như MISA "Không hiển thị dòng không có số liệu").
  where abs(s.opening_qty) >= 0.00005 or abs(s.opening_value) >= 0.5
     or s.in_qty <> 0 or s.out_qty <> 0
     or abs(s.closing_qty) >= 0.00005 or abs(s.closing_value) >= 0.5;

  return jsonb_build_object(
    'dateFrom', p_filters ->> 'dateFrom',
    'dateTo', p_filters ->> 'dateTo',
    'rows', v_rows
  );
end;
$$;

revoke all on function public.get_inventory_nxt_report_v1(jsonb) from public, anon;
grant execute on function public.get_inventory_nxt_report_v1(jsonb) to authenticated, service_role;
