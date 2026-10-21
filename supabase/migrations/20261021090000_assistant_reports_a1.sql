-- Trợ lý · báo cáo đợt A1 (chủ SP 20/10/2026: ưu tiên báo cáo / biểu đồ trước): 3 RPC tổng hợp cho công cụ bao_cao.
--   * SECURITY INVOKER: chạy dưới RLS của chính người hỏi → mỗi người chỉ thấy số trong phạm vi mình được xem (phiếu quy trình có tên
--     mình / mẫu mình quản lý, kho mình được vào, đơn hàng mình được xem). Ngoài quyền thì số là 0 / rỗng, không lộ.
--   * Không ghi gì. Khoảng tối đa ~13 tháng; nhóm theo tuần hoặc tháng.
--   * Hoàn thành / trả lại phiếu quy trình tính theo ngày cập nhật cuối (bảng không có cột ngày hoàn thành) — công cụ ghi chú rõ.

create or replace function public.assistant_report_workflow_v1(p_from date, p_to date, p_group text default 'month')
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_step interval;
begin
  if public.current_app_user_id() is null then raise exception using errcode = '42501', message = 'AI_DENIED'; end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception using errcode = '22023', message = 'REPORT_RANGE_INVALID'; end if;
  if p_group not in ('week', 'month') then raise exception using errcode = '22023', message = 'REPORT_GROUP_INVALID'; end if;
  if p_to - p_from > 400 then raise exception using errcode = '22023', message = 'REPORT_RANGE_TOO_LONG'; end if;
  v_step := ('1 ' || p_group)::interval;
  return (
    with wf as (
      select i.id, i.status::text as status, i.created_at, i.updated_at, i.template_id
      from public.workflow_instances i
      where i.created_at >= p_from and i.created_at < p_to + 1
    ),
    buckets as (select b::date as b_start from generate_series(date_trunc(p_group, p_from::timestamp)::date, p_to, v_step) b)
    select jsonb_build_object(
      'from', p_from, 'to', p_to, 'group', p_group,
      'buckets', (select coalesce(jsonb_agg(jsonb_build_object(
          'start', b.b_start,
          'created', (select count(*) from wf where wf.created_at >= b.b_start and wf.created_at < b.b_start + v_step),
          'completed', (select count(*) from public.workflow_instances i where i.status::text = 'COMPLETED' and i.updated_at >= b.b_start and i.updated_at < b.b_start + v_step),
          'returned', (select count(*) from public.workflow_instances i where i.status::text in ('REJECTED', 'CANCELLED') and i.updated_at >= b.b_start and i.updated_at < b.b_start + v_step)
        ) order by b.b_start), '[]'::jsonb) from buckets b),
      'byStatus', (select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb) from (select status, count(*) n from wf group by status) s),
      'byTemplate', (select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(t.name, 'Mẫu khác'), 'count', c.n) order by c.n desc), '[]'::jsonb)
        from (select template_id, count(*) n from wf group by template_id order by n desc limit 8) c left join public.workflow_templates t on t.id = c.template_id),
      'total', (select count(*) from wf),
      'runningNow', (select count(*) from public.workflow_instances i where i.status::text = 'RUNNING'),
      'runningStale', (select count(*) from public.workflow_instances i where i.status::text = 'RUNNING' and i.updated_at < now() - interval '7 days')
    ));
end $$;
revoke all on function public.assistant_report_workflow_v1(date, date, text) from public, anon;
grant execute on function public.assistant_report_workflow_v1(date, date, text) to authenticated;

create or replace function public.assistant_report_inventory_v1(p_from date, p_to date, p_group text default 'month', p_warehouse text default null, p_item_id text default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_step interval;
begin
  if public.current_app_user_id() is null then raise exception using errcode = '42501', message = 'AI_DENIED'; end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception using errcode = '22023', message = 'REPORT_RANGE_INVALID'; end if;
  if p_group not in ('week', 'month') then raise exception using errcode = '22023', message = 'REPORT_GROUP_INVALID'; end if;
  if p_to - p_from > 400 then raise exception using errcode = '22023', message = 'REPORT_RANGE_TOO_LONG'; end if;
  v_step := ('1 ' || p_group)::interval;
  return (
    with wh as (
      select w.id, w.name from public.warehouses w
      where p_warehouse is null or w.id = p_warehouse or w.name ilike '%' || p_warehouse || '%'
    ),
    led as (
      select e.transaction_date, e.movement_direction, e.transaction_type, e.material_id, e.warehouse_id, e.quantity_in, e.quantity_out, e.amount, e.unit, e.inventory_transaction_id
      from public.inventory_ledger_entries e join wh on wh.id = e.warehouse_id
      where e.transaction_date >= p_from and e.transaction_date < p_to + 1 and (p_item_id is null or e.material_id = p_item_id)
    ),
    buckets as (select b::date as b_start from generate_series(date_trunc(p_group, p_from::timestamp)::date, p_to, v_step) b)
    select jsonb_build_object(
      'from', p_from, 'to', p_to, 'group', p_group,
      'warehouses', (select coalesce(jsonb_agg(wh.name order by wh.name), '[]'::jsonb) from wh),
      'item', case when p_item_id is null then null else (select jsonb_build_object('id', it.id, 'sku', it.sku, 'name', it.name, 'unit', it.unit) from public.items it where it.id = p_item_id) end,
      'buckets', (select coalesce(jsonb_agg(jsonb_build_object(
          'start', b.b_start,
          'inQty', (select coalesce(sum(quantity_in), 0) from led where movement_direction = 'in' and transaction_date >= b.b_start and transaction_date < b.b_start + v_step),
          'outQty', (select coalesce(sum(quantity_out), 0) from led where movement_direction = 'out' and transaction_date >= b.b_start and transaction_date < b.b_start + v_step),
          'inAmount', (select coalesce(sum(amount), 0) from led where movement_direction = 'in' and transaction_date >= b.b_start and transaction_date < b.b_start + v_step),
          'outAmount', (select coalesce(sum(amount), 0) from led where movement_direction = 'out' and transaction_date >= b.b_start and transaction_date < b.b_start + v_step),
          'docsIn', (select count(distinct inventory_transaction_id) from led where movement_direction = 'in' and transaction_date >= b.b_start and transaction_date < b.b_start + v_step),
          'docsOut', (select count(distinct inventory_transaction_id) from led where movement_direction = 'out' and transaction_date >= b.b_start and transaction_date < b.b_start + v_step)
        ) order by b.b_start), '[]'::jsonb) from buckets b),
      'byType', (select coalesce(jsonb_object_agg(t.transaction_type, t.amt), '{}'::jsonb) from (select transaction_type, coalesce(sum(amount), 0) amt from led group by transaction_type) t),
      'topOut', case when p_item_id is not null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(it.name, x.material_id), 'unit', coalesce(it.unit, x.unit), 'qty', x.qty, 'amount', x.amt) order by x.amt desc), '[]'::jsonb)
        from (select material_id, min(unit) unit, sum(quantity_out) qty, coalesce(sum(amount), 0) amt from led where movement_direction = 'out' group by material_id order by amt desc limit 8) x
        left join public.items it on it.id = x.material_id) end,
      'stockNow', case when p_item_id is null then null else (select coalesce(jsonb_agg(jsonb_build_object('warehouse', wh.name, 'qty', s.qty) order by wh.name), '[]'::jsonb)
        from (select distinct on (e.warehouse_id) e.warehouse_id, e.balance_after_qty qty from public.inventory_ledger_entries e where e.material_id = p_item_id order by e.warehouse_id, e.transaction_date desc, e.entry_no desc) s join wh on wh.id = s.warehouse_id) end,
      'totalIn', (select coalesce(sum(quantity_in), 0) from led where movement_direction = 'in'),
      'totalOut', (select coalesce(sum(quantity_out), 0) from led where movement_direction = 'out'),
      'totalInAmount', (select coalesce(sum(amount), 0) from led where movement_direction = 'in'),
      'totalOutAmount', (select coalesce(sum(amount), 0) from led where movement_direction = 'out')
    ));
end $$;
revoke all on function public.assistant_report_inventory_v1(date, date, text, text, text) from public, anon;
grant execute on function public.assistant_report_inventory_v1(date, date, text, text, text) to authenticated;

create or replace function public.assistant_report_procurement_v1(p_from date, p_to date, p_group text default 'month')
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_step interval;
begin
  if public.current_app_user_id() is null then raise exception using errcode = '42501', message = 'AI_DENIED'; end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception using errcode = '22023', message = 'REPORT_RANGE_INVALID'; end if;
  if p_group not in ('week', 'month') then raise exception using errcode = '22023', message = 'REPORT_GROUP_INVALID'; end if;
  if p_to - p_from > 400 then raise exception using errcode = '22023', message = 'REPORT_RANGE_TOO_LONG'; end if;
  v_step := ('1 ' || p_group)::interval;
  return (
    with po as (
      select p.id, p.status::text as status, coalesce(p.order_date::timestamptz, p.created_at) as d, coalesce(p.total_amount, 0) as amount, p.vendor_name, p.project_id
      from public.purchase_orders p
      where coalesce(p.order_date::timestamptz, p.created_at) >= p_from and coalesce(p.order_date::timestamptz, p.created_at) < p_to + 1
        and p.archived_at is null and p.status::text <> 'draft'
    ),
    buckets as (select b::date as b_start from generate_series(date_trunc(p_group, p_from::timestamp)::date, p_to, v_step) b)
    select jsonb_build_object(
      'from', p_from, 'to', p_to, 'group', p_group,
      'buckets', (select coalesce(jsonb_agg(jsonb_build_object(
          'start', b.b_start,
          'count', (select count(*) from po where po.d >= b.b_start and po.d < b.b_start + v_step),
          'amount', (select coalesce(sum(amount), 0) from po where po.d >= b.b_start and po.d < b.b_start + v_step)
        ) order by b.b_start), '[]'::jsonb) from buckets b),
      'byStatus', (select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb) from (select status, count(*) n from po group by status) s),
      'byVendor', (select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(v.vendor_name, 'Chưa ghi NCC'), 'count', v.n, 'amount', v.amt) order by v.amt desc), '[]'::jsonb)
        from (select vendor_name, count(*) n, sum(amount) amt from po group by vendor_name order by amt desc limit 8) v),
      'byProject', (select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(pr.code, pr.name, 'Chưa gắn dự án'), 'count', x.n, 'amount', x.amt) order by x.amt desc), '[]'::jsonb)
        from (select project_id, count(*) n, sum(amount) amt from po group by project_id order by amt desc limit 8) x left join public.projects pr on pr.id = x.project_id),
      'total', (select count(*) from po), 'totalAmount', (select coalesce(sum(amount), 0) from po)
    ));
end $$;
revoke all on function public.assistant_report_procurement_v1(date, date, text) from public, anon;
grant execute on function public.assistant_report_procurement_v1(date, date, text) to authenticated;
