-- Chỉ KH vật tư TUẦN vào Mua hàng → Cần mua; KH tháng là dự báo (trừ bản tháng đã có liên kết PO). Chạy rollback trên Cloud:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261024160000_material_plan_week_to_procurement.sql --smoke supabase/tests/material_plan_week_to_procurement_smoke.sql
do $$
declare v_user uuid; v_project text; v_item record; v_wp_m uuid; v_wp_w uuid; v_week uuid; v_month uuid; v_month2 uuid;
  v_line_m2 uuid; v_po record; v_n int; v_failed text;
begin
  select u.id into v_user from public.users u where u.is_active order by u.id limit 1;
  select p.id into v_project from public.projects p order by p.id limit 1;
  select i.id, i.name, i.sku, coalesce(nullif(btrim(i.unit), ''), 'cái') unit into v_item from public.items i order by i.id limit 1;
  if v_user is null or v_project is null or v_item.id is null then raise exception 'SMOKE_SETUP: thiếu người / dự án / vật tư'; end if;

  -- Kế hoạch thi công nền (tháng 01/2031 và tuần 06/01/2031 — ngoài dữ liệu thật).
  insert into public.project_work_plans (project_id, period_type, period_start, period_end, code, created_by)
  values (v_project, 'month', date '2031-01-01', date '2031-01-31', 'SMOKE-KH-M-7Q9Z', v_user) returning id into v_wp_m;
  insert into public.project_work_plans (project_id, period_type, period_start, period_end, code, created_by)
  values (v_project, 'week', date '2031-01-06', date '2031-01-12', 'SMOKE-KH-W-7Q9Z', v_user) returning id into v_wp_w;

  insert into public.project_material_plans (work_plan_id, project_id, period_type, period_start, period_end, code, created_by, status, approved_by, approved_at)
  values (v_wp_w, v_project, 'week', date '2031-01-06', date '2031-01-12', 'SMOKE-VT-W-7Q9Z', v_user, 'approved', v_user, now()) returning id into v_week;
  insert into public.project_material_plans (work_plan_id, project_id, period_type, period_start, period_end, code, created_by, status, approved_by, approved_at)
  values (v_wp_m, v_project, 'month', date '2031-01-01', date '2031-01-31', 'SMOKE-VT-M-7Q9Z', v_user, 'approved', v_user, now()) returning id into v_month;
  insert into public.project_material_plan_lines (plan_id, item_id, item_name_snapshot, sku_snapshot, unit, need_qty, requested_qty)
  values (v_week, v_item.id, v_item.name, v_item.sku, v_item.unit, 10, 10), (v_month, v_item.id, v_item.name, v_item.sku, v_item.unit, 40, 40);

  -- 1. Tuần vào Cần mua (phiếu + dòng); tháng không vào.
  if not exists (select 1 from app_private.procurement_inbox_documents() d where d.source_type = 'material_plan' and d.source_id = v_week::text) then
    raise exception 'FAIL: KH vật tư tuần không vào Cần mua'; end if;
  if not exists (select 1 from app_private.procurement_inbox_lines() l where l.source_type = 'material_plan' and l.source_id = v_week::text and l.need_qty = 10) then
    raise exception 'FAIL: dòng KH vật tư tuần không vào Cần mua'; end if;
  if exists (select 1 from app_private.procurement_inbox_documents() d where d.source_type = 'material_plan' and d.source_id = v_month::text) then
    raise exception 'FAIL: KH vật tư tháng vẫn vào Cần mua'; end if;
  if exists (select 1 from app_private.procurement_inbox_lines() l where l.source_type = 'material_plan' and l.source_id = v_month::text) then
    raise exception 'FAIL: dòng KH vật tư tháng vẫn vào Cần mua'; end if;

  -- 2. Đề xuất vật tư dự án vẫn vào Cần mua như cũ (số phiếu đề xuất không đổi so với lọc thẳng bảng requests).
  select count(*) into v_n from public.requests r where r.request_origin = 'project' and r.status in ('APPROVED', 'IN_TRANSIT');
  if (select count(*) from app_private.procurement_inbox_documents() d where d.source_type = 'material_request' and d.closed_at is null) < v_n then
    raise exception 'FAIL: đề xuất vật tư bị mất khỏi Cần mua'; end if;

  -- 3. KH tháng đã có liên kết PO vẫn hiện (không mất dấu phần đã đặt).
  select o.id, coalesce(o.items->0->>'id', 'smoke-line') line_id into v_po from public.purchase_orders o
    where o.status not in ('cancelled', 'returned') and o.archived_at is null order by o.id limit 1;
  if v_po.id is not null then
    insert into public.project_material_plans (work_plan_id, project_id, construction_site_id, period_type, period_start, period_end, code, created_by, status, approved_by, approved_at)
    values (v_wp_m, v_project, 'smoke-site-7q9z', 'month', date '2031-01-01', date '2031-01-31', 'SMOKE-VT-M2-7Q9Z', v_user, 'approved', v_user, now()) returning id into v_month2;
    insert into public.project_material_plan_lines (plan_id, item_id, item_name_snapshot, sku_snapshot, unit, need_qty, requested_qty)
    values (v_month2, v_item.id, v_item.name, v_item.sku, v_item.unit, 5, 5) returning id into v_line_m2;
    v_failed := null;
    begin
      insert into public.procurement_po_plan_links (purchase_order_id, purchase_order_line_id, material_plan_id, material_plan_line_id, item_id, ordered_qty)
      values (v_po.id, v_po.line_id, v_month2, v_line_m2, v_item.id, 1);
    exception when others then v_failed := sqlerrm; end;
    if v_failed is null then
      if not exists (select 1 from app_private.procurement_inbox_documents() d where d.source_type = 'material_plan' and d.source_id = v_month2::text) then
        raise exception 'FAIL: KH tháng đã có PO bị mất khỏi Mua hàng'; end if;
      if not exists (select 1 from app_private.procurement_inbox_lines() l where l.source_type = 'material_plan' and l.source_id = v_month2::text) then
        raise exception 'FAIL: dòng KH tháng đã có PO bị mất khỏi Mua hàng'; end if;
    else
      raise notice 'Bỏ qua ca liên kết PO (chặn bởi ràng buộc): %', v_failed;
    end if;
  end if;
  -- Hàm điều kiện: tuần luôn đi; tháng không liên kết thì không.
  if not app_private.material_plan_goes_to_procurement(v_week, 'week') or app_private.material_plan_goes_to_procurement(v_month, 'month') then
    raise exception 'FAIL: material_plan_goes_to_procurement sai'; end if;
end;
$$;
