-- Gợi ý in mờ, đợt cuối (chủ SP 13/10/2026): vật tư đã mua của NCC lên đầu ô thêm vật tư; bảng đo tỷ lệ nhận gợi ý cho Admin.
--   * get_procurement_vendor_prefill_v1: mỗi dòng gợi ý thêm tên, mã vật tư và số đơn 90 ngày có mã đó — màn Lập đơn xếp mã hay mua lên đầu.
--   * get_ui_suggestion_stats_v1(ngày): Admin xem theo màn / ô: lượt gợi ý, dùng / sửa / bỏ, số dòng tự điền, số người dùng.
--     Chỉ đọc; chỉ Admin (cùng phạm vi với chính sách select của ui_suggestion_events).

create or replace function public.get_procurement_vendor_prefill_v1(p_vendor_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_order jsonb; v_lines jsonb;
begin
  if not app_private.procurement_can('view') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_VIEW_DENIED'; end if;
  if coalesce(btrim(p_vendor_id), '') = '' then return jsonb_build_object('order', null, 'lines', '[]'::jsonb); end if;

  select jsonb_build_object('poNumber', o.po_number, 'title', nullif(btrim(o.approval_request_title), ''), 'orderDate', o.order_date, 'vatRate', o.vat_rate, 'purchaseMode', o.purchase_mode,
      'projectId', o.project_id, 'constructionSiteId', o.construction_site_id, 'targetWarehouseId', o.target_warehouse_id)
    into v_order
  from public.purchase_orders o
  where o.vendor_id = p_vendor_id and o.archived_at is null and coalesce(o.status, '') not in ('draft', 'cancelled', 'returned')
  order by o.order_date desc nulls last, o.created_at desc
  limit 1;

  with raw as (
    select o.id order_id, o.po_number, nullif(btrim(o.approval_request_title), '') title, o.order_date, o.created_at,
      x.value->>'itemId' item_id, coalesce(x.value->>'specification', '') specification,
      coalesce(nullif(x.value->>'purchaseUnitSnapshot', ''), x.value->>'unit') unit,
      coalesce(nullif(x.value->>'stockUnitSnapshot', ''), x.value->>'unit') stock_unit,
      coalesce(nullif(x.value->>'purchaseConversionFactor', '')::numeric, 1) factor,
      coalesce(nullif(x.value->>'unitPrice', '')::numeric, 0) unit_price
    from public.purchase_orders o
    cross join lateral jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) x
    where o.vendor_id = p_vendor_id and o.archived_at is null and coalesce(o.status, '') not in ('draft', 'cancelled', 'returned')
      and o.created_at >= now() - interval '90 days'
      and nullif(x.value->>'itemId', '') is not null
      and coalesce(nullif(x.value->>'unitPrice', '')::numeric, 0) > 0
  ), per_item as (
    select r.item_id, count(distinct r.order_id) orders from raw r group by r.item_id
  ), latest as (
    select distinct on (r.item_id, lower(btrim(r.specification))) r.*
    from raw r
    order by r.item_id, lower(btrim(r.specification)), r.order_date desc nulls last, r.created_at desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'itemId', l.item_id, 'itemName', i.name, 'sku', i.sku, 'orders', p.orders,
      'specification', l.specification, 'unit', l.unit, 'stockUnit', l.stock_unit, 'factor', l.factor, 'unitPrice', l.unit_price,
      'poNumber', l.po_number, 'title', l.title, 'orderDate', l.order_date)
    order by l.order_date desc nulls last, l.created_at desc), '[]'::jsonb)
  into v_lines
  from latest l
  join per_item p on p.item_id = l.item_id
  left join public.items i on i.id::text = l.item_id;

  return jsonb_build_object('order', v_order, 'lines', v_lines);
end $$;
comment on function public.get_procurement_vendor_prefill_v1(text) is 'Gợi ý in mờ Lập đơn: đầu đơn gần nhất + dòng mua gần nhất (90 ngày) của NCC, kèm tên / mã vật tư và số đơn có mã. Chỉ đọc.';

create or replace function public.get_ui_suggestion_stats_v1(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 365);
  v_from timestamptz;
  v_rows jsonb; v_screens jsonb; v_total jsonb;
begin
  if not public.is_admin() then
    raise exception 'SUGGESTION_STATS_ADMIN_REQUIRED' using errcode = '42501';
  end if;
  v_from := now() - make_interval(days => v_days);

  select coalesce(jsonb_agg(jsonb_build_object(
      'screen', s.screen, 'field', s.field, 'events', s.events, 'accepted', s.accepted, 'edited', s.edited, 'dismissed', s.dismissed,
      'suggestedRows', s.suggested_rows, 'acceptedRows', s.accepted_rows, 'users', s.users, 'lastAt', s.last_at)
    order by s.screen, s.events desc, s.field), '[]'::jsonb)
  into v_rows
  from (
    select e.screen, e.field, count(*) events,
      count(*) filter (where e.outcome = 'accepted') accepted,
      count(*) filter (where e.outcome = 'edited') edited,
      count(*) filter (where e.outcome = 'dismissed') dismissed,
      coalesce(sum(e.suggested), 0) suggested_rows, coalesce(sum(e.accepted), 0) accepted_rows,
      count(distinct e.user_id) users, max(e.created_at) last_at
    from public.ui_suggestion_events e
    where e.created_at >= v_from
    group by e.screen, e.field
  ) s;

  select coalesce(jsonb_agg(jsonb_build_object('screen', s.screen, 'events', s.events, 'users', s.users) order by s.events desc, s.screen), '[]'::jsonb)
  into v_screens
  from (
    select e.screen, count(*) events, count(distinct e.user_id) users
    from public.ui_suggestion_events e
    where e.created_at >= v_from
    group by e.screen
  ) s;

  select jsonb_build_object('events', count(*), 'users', count(distinct e.user_id), 'firstAt', min(e.created_at), 'lastAt', max(e.created_at))
  into v_total
  from public.ui_suggestion_events e
  where e.created_at >= v_from;

  return jsonb_build_object('days', v_days, 'from', v_from, 'total', v_total, 'screens', v_screens, 'rows', v_rows);
end $$;
comment on function public.get_ui_suggestion_stats_v1(integer) is 'Gợi ý in mờ: tỷ lệ dùng / sửa / bỏ theo màn và ô trong N ngày (Admin, chỉ đọc).';
revoke all on function public.get_ui_suggestion_stats_v1(integer) from public, anon;
grant execute on function public.get_ui_suggestion_stats_v1(integer) to authenticated;
