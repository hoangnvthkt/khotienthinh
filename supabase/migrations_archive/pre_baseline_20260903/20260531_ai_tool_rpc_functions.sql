-- ═══════════════════════════════════════════════════════════════
--  Agentic AI Tool-calling RPC Functions
--  12 functions organized by domain, callable only by service_role
--  via the ai-assistant Edge Function.
-- ═══════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────
--  DOMAIN 1: CONSTRUCTION / DỰ ÁN
-- ───────────────────────────────────────────────────────────────

-- 1. ai_tool_project_list — Danh sách dự án/công trường
create or replace function public.ai_tool_project_list(
  p_status text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'total', count(*),
    'projects', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'address', s.address,
        'status', coalesce(s.status, 'active')
      )
      order by s.created_at desc
    ) filter (where s.id is not null), '[]'::jsonb)
  )
  into v_result
  from (
    select h.id, h.name, h.address, h.status, h.created_at
    from hrm_construction_sites h
    where (p_status is null or h.status = p_status)
    limit 50
  ) s;

  return v_result;
end;
$$;

-- 2. ai_tool_project_summary — Tổng quan 1 dự án
create or replace function public.ai_tool_project_summary(
  p_project_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_site jsonb;
  v_finance jsonb;
  v_task_summary jsonb;
begin
  -- Site info
  select jsonb_build_object(
    'id', h.id,
    'name', h.name,
    'address', h.address,
    'status', coalesce(h.status, 'active')
  )
  into v_site
  from hrm_construction_sites h
  where h.id = p_project_id;

  if v_site is null then
    return jsonb_build_object('error', 'Không tìm thấy dự án với ID: ' || coalesce(p_project_id, 'null'));
  end if;

  -- Finance summary
  select jsonb_build_object(
    'contract_value', coalesce(pf."contractValue", 0),
    'progress_percent', coalesce(pf."progressPercent", 0),
    'budget_materials', coalesce(pf."budgetMaterials", 0),
    'budget_labor', coalesce(pf."budgetLabor", 0),
    'revenue_received', coalesce(pf."revenueReceived", 0),
    'finance_status', coalesce(pf.status, 'N/A')
  )
  into v_finance
  from project_finances pf
  where pf."constructionSiteId" = p_project_id
  limit 1;

  -- Task progress summary
  select jsonb_build_object(
    'total_tasks', count(*),
    'completed_tasks', count(*) filter (where pt.progress >= 100),
    'in_progress_tasks', count(*) filter (where pt.progress > 0 and pt.progress < 100),
    'not_started_tasks', count(*) filter (where pt.progress = 0 or pt.progress is null),
    'avg_progress', round(coalesce(avg(pt.progress), 0), 1)
  )
  into v_task_summary
  from project_tasks pt
  where pt.construction_site_id = p_project_id;

  return jsonb_build_object(
    'site', v_site,
    'finance', coalesce(v_finance, '{}'::jsonb),
    'tasks', coalesce(v_task_summary, '{}'::jsonb)
  );
end;
$$;

-- 3. ai_tool_project_progress — Chi tiết tiến độ tasks
create or replace function public.ai_tool_project_progress(
  p_project_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'project_id', p_project_id,
    'total_tasks', count(*),
    'avg_progress', round(coalesce(avg(t.progress), 0), 1),
    'completed', count(*) filter (where t.progress >= 100),
    'in_progress', count(*) filter (where t.progress > 0 and t.progress < 100),
    'not_started', count(*) filter (where t.progress = 0 or t.progress is null),
    'tasks', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'progress', coalesce(t.progress, 0),
        'gate_status', t.gate_status,
        'start_date', t.start_date,
        'end_date', t.end_date,
        'parent_id', t.parent_id
      )
      order by t.start_date asc nulls last
    ) filter (where t.id is not null), '[]'::jsonb)
  )
  into v_result
  from project_tasks t
  where t.construction_site_id = p_project_id;

  return v_result;
end;
$$;

-- 4. ai_tool_daily_log_summary — Tổng hợp daily logs
create or replace function public.ai_tool_daily_log_summary(
  p_project_id text,
  p_from_date date default null,
  p_to_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'project_id', p_project_id,
    'total_logs', count(*),
    'status_breakdown', coalesce(
      jsonb_object_agg(s.status, s.cnt) filter (where s.status is not null),
      '{}'::jsonb
    ),
    'recent_logs', coalesce(r.logs, '[]'::jsonb)
  )
  into v_result
  from (
    select dl.status, count(*) as cnt
    from daily_logs dl
    where dl.construction_site_id = p_project_id
      and (p_from_date is null or dl.log_date::date >= p_from_date)
      and (p_to_date is null or dl.log_date::date <= p_to_date)
    group by dl.status
  ) s
  cross join lateral (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', dl2.id,
        'log_date', dl2.log_date,
        'status', dl2.status,
        'weather', dl2.weather,
        'created_at', dl2.created_at
      )
      order by dl2.log_date desc
    ), '[]'::jsonb) as logs
    from daily_logs dl2
    where dl2.construction_site_id = p_project_id
      and (p_from_date is null or dl2.log_date::date >= p_from_date)
      and (p_to_date is null or dl2.log_date::date <= p_to_date)
    limit 10
  ) r;

  -- Handle case where no logs exist
  if v_result is null then
    return jsonb_build_object(
      'project_id', p_project_id,
      'total_logs', 0,
      'status_breakdown', '{}'::jsonb,
      'recent_logs', '[]'::jsonb
    );
  end if;

  return v_result;
end;
$$;


-- ───────────────────────────────────────────────────────────────
--  DOMAIN 2: INVENTORY / KHO VẬT TƯ
-- ───────────────────────────────────────────────────────────────

-- 5. ai_tool_inventory_summary — Tổng quan tồn kho
create or replace function public.ai_tool_inventory_summary(
  p_warehouse_id text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  with item_stocks as (
    select
      i.id,
      i.min_stock,
      i.price_in,
      case
        when p_warehouse_id is not null then
          coalesce((i.stock_by_warehouse ->> p_warehouse_id)::numeric, 0)
        else
          coalesce(
            (select sum(val.value::numeric)
             from jsonb_each_text(coalesce(i.stock_by_warehouse, '{}'::jsonb)) as val),
            0
          )
      end as total_stock
    from items i
  )
  select jsonb_build_object(
    'total_items', count(*),
    'total_stock', coalesce(sum(total_stock), 0),
    'low_stock_items', count(*) filter (
      where total_stock < coalesce(min_stock, 0)
        and coalesce(min_stock, 0) > 0
    ),
    'total_value', round(coalesce(sum(coalesce(price_in, 0) * total_stock), 0), 0),
    'warehouse_filter', coalesce(p_warehouse_id, 'all'),
    'warehouses', (
      select coalesce(jsonb_agg(
        jsonb_build_object('id', w.id, 'name', w.name)
        order by w.name
      ), '[]'::jsonb)
      from warehouses w
    )
  )
  into v_result
  from item_stocks;

  return v_result;
end;
$$;

-- 6. ai_tool_material_search — Tìm kiếm vật tư
create or replace function public.ai_tool_material_search(
  p_keyword text,
  p_warehouse_id text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_kw text := '%' || lower(trim(coalesce(p_keyword, ''))) || '%';
begin
  select jsonb_build_object(
    'keyword', trim(coalesce(p_keyword, '')),
    'total_found', count(*),
    'items', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'sku', s.sku,
        'name', s.name,
        'category', s.category,
        'unit', s.unit,
        'price_in', s.price_in,
        'price_out', s.price_out,
        'total_stock', s.total_stock,
        'min_stock', s.min_stock,
        'supplier_id', s.supplier_id
      )
      order by s.name
    ), '[]'::jsonb)
  )
  into v_result
  from (
    select
      i.id, i.sku, i.name, i.category, i.unit,
      i.price_in, i.price_out, i.min_stock, i.supplier_id,
      case
        when p_warehouse_id is not null then
          coalesce((i.stock_by_warehouse ->> p_warehouse_id)::numeric, 0)
        else
          coalesce(
            (select sum(val.value::numeric)
             from jsonb_each_text(coalesce(i.stock_by_warehouse, '{}'::jsonb)) as val),
            0
          )
      end as total_stock
    from items i
    where lower(coalesce(i.name, '')) like v_kw
       or lower(coalesce(i.sku, '')) like v_kw
    limit 30
  ) s;

  return v_result;
end;
$$;

-- 7. ai_tool_material_request_status — Trạng thái đề xuất vật tư
create or replace function public.ai_tool_material_request_status(
  p_project_id text default null,
  p_status text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'total', count(*),
    'status_breakdown', coalesce(
      jsonb_object_agg(sb.status, sb.cnt),
      '{}'::jsonb
    ),
    'recent_requests', coalesce(r.reqs, '[]'::jsonb)
  )
  into v_result
  from (
    select mr.status, count(*) as cnt
    from project_material_requests mr
    where (p_project_id is null or mr.construction_site_id = p_project_id)
      and (p_status is null or mr.status = p_status)
    group by mr.status
  ) sb
  cross join lateral (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', mr2.id,
        'code', mr2.code,
        'status', mr2.status,
        'requester', coalesce(
          (select u.name from users u where u.id = mr2.created_by::text limit 1),
          mr2.created_by::text
        ),
        'created_at', mr2.created_at,
        'item_count', coalesce(jsonb_array_length(mr2.items), 0)
      )
      order by mr2.created_at desc
    ), '[]'::jsonb) as reqs
    from project_material_requests mr2
    where (p_project_id is null or mr2.construction_site_id = p_project_id)
      and (p_status is null or mr2.status = p_status)
    limit 20
  ) r;

  if v_result is null then
    return jsonb_build_object(
      'total', 0,
      'status_breakdown', '{}'::jsonb,
      'recent_requests', '[]'::jsonb
    );
  end if;

  return v_result;
end;
$$;

-- 8. ai_tool_purchase_order_summary — Tổng hợp đơn mua hàng
create or replace function public.ai_tool_purchase_order_summary(
  p_project_id text default null,
  p_status text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'total', count(*),
    'total_value', coalesce(sum(po.total_amount), 0),
    'status_breakdown', coalesce(
      jsonb_object_agg(sb.status, sb.cnt),
      '{}'::jsonb
    ),
    'recent_orders', coalesce(r.orders, '[]'::jsonb)
  )
  into v_result
  from purchase_orders po
  left join lateral (
    select po2.status, count(*) as cnt
    from purchase_orders po2
    where (p_project_id is null or po2.construction_site_id = p_project_id)
      and (p_status is null or po2.status = p_status)
    group by po2.status
  ) sb on true
  cross join lateral (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', po3.id,
        'code', po3.code,
        'status', po3.status,
        'total_amount', coalesce(po3.total_amount, 0),
        'vendor', coalesce(
          (select pv.name from project_vendors pv where pv.id = po3.vendor_id limit 1),
          'N/A'
        ),
        'created_at', po3.created_at
      )
      order by po3.created_at desc
    ), '[]'::jsonb) as orders
    from purchase_orders po3
    where (p_project_id is null or po3.construction_site_id = p_project_id)
      and (p_status is null or po3.status = p_status)
    limit 20
  ) r
  where (p_project_id is null or po.construction_site_id = p_project_id)
    and (p_status is null or po.status = p_status);

  if v_result is null then
    return jsonb_build_object(
      'total', 0,
      'total_value', 0,
      'status_breakdown', '{}'::jsonb,
      'recent_orders', '[]'::jsonb
    );
  end if;

  return v_result;
end;
$$;


-- ───────────────────────────────────────────────────────────────
--  DOMAIN 3: FINANCE & HR
-- ───────────────────────────────────────────────────────────────

-- 9. ai_tool_project_finance — Tài chính dự án
create or replace function public.ai_tool_project_finance(
  p_project_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'project_id', p_project_id,
    'project_name', coalesce(
      (select h.name from hrm_construction_sites h where h.id = p_project_id limit 1),
      'N/A'
    ),
    'budget', jsonb_build_object(
      'contract_value', coalesce(pf."contractValue", 0),
      'budget_materials', coalesce(pf."budgetMaterials", 0),
      'budget_labor', coalesce(pf."budgetLabor", 0),
      'revenue_received', coalesce(pf."revenueReceived", 0),
      'progress_percent', coalesce(pf."progressPercent", 0)
    ),
    'transactions_summary', (
      select jsonb_build_object(
        'total_income', coalesce(sum(case when pt.type = 'income' then pt.amount else 0 end), 0),
        'total_expense', coalesce(sum(case when pt.type = 'expense' then pt.amount else 0 end), 0),
        'net', coalesce(
          sum(case when pt.type = 'income' then pt.amount else 0 end) -
          sum(case when pt.type = 'expense' then pt.amount else 0 end),
          0
        ),
        'transaction_count', count(*)
      )
      from project_transactions pt
      where pt."constructionSiteId" = p_project_id
    )
  )
  into v_result
  from project_finances pf
  where pf."constructionSiteId" = p_project_id
  limit 1;

  if v_result is null then
    return jsonb_build_object(
      'project_id', p_project_id,
      'error', 'Chưa có dữ liệu tài chính cho dự án này.'
    );
  end if;

  return v_result;
end;
$$;

-- 10. ai_tool_employee_summary — Tổng hợp nhân viên
create or replace function public.ai_tool_employee_summary(
  p_department_id text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'total_employees', count(*),
    'active', count(*) filter (where e.status = 'active' or e.status is null),
    'inactive', count(*) filter (where e.status = 'inactive'),
    'resigned', count(*) filter (where e.status = 'resigned'),
    'by_department', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'department', coalesce(ou.name, 'Chưa phân phòng'),
          'count', d.cnt
        )
        order by d.cnt desc
      ), '[]'::jsonb)
      from (
        select e2.org_unit_id, count(*) as cnt
        from employees e2
        where (p_department_id is null or e2.org_unit_id::text = p_department_id)
        group by e2.org_unit_id
      ) d
      left join org_units ou on ou.id = d.org_unit_id
    ),
    'recent_employees', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'employee_code', e.employee_code,
        'full_name', e.full_name,
        'status', coalesce(e.status, 'active'),
        'org_unit_id', e.org_unit_id
      )
      order by e.created_at desc nulls last
    ) filter (where e.id is not null), '[]'::jsonb)
  )
  into v_result
  from (
    select *
    from employees
    where (p_department_id is null or org_unit_id::text = p_department_id)
    limit 50
  ) e;

  return v_result;
end;
$$;

-- 11. ai_tool_attendance_report — Báo cáo chấm công
create or replace function public.ai_tool_attendance_report(
  p_date date default current_date,
  p_site_id text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'date', p_date,
    'total_records', count(*),
    'checked_in', count(*) filter (where a."checkIn" is not null and a."checkIn" != ''),
    'checked_out', count(*) filter (where a."checkOut" is not null and a."checkOut" != ''),
    'absent', count(*) filter (where a.status = 'absent'),
    'late', count(*) filter (where a.status = 'late'),
    'on_time', count(*) filter (where a.status = 'on_time' or a.status = 'present'),
    'site_filter', coalesce(p_site_id, 'all'),
    'records', coalesce(jsonb_agg(
      jsonb_build_object(
        'employee_name', coalesce(
          (select emp.full_name from employees emp where emp.id = a."employeeId" limit 1),
          a."employeeId"::text
        ),
        'check_in', a."checkIn",
        'check_out', a."checkOut",
        'status', a.status
      )
      order by a."checkIn" asc nulls last
    ) filter (where a.id is not null), '[]'::jsonb)
  )
  into v_result
  from (
    select *
    from hrm_attendance
    where date = p_date::text
      and (p_site_id is null or "constructionSiteId" = p_site_id)
    limit 50
  ) a;

  return v_result;
end;
$$;


-- ───────────────────────────────────────────────────────────────
--  CROSS-DOMAIN: EXECUTIVE DASHBOARD
-- ───────────────────────────────────────────────────────────────

-- 12. ai_tool_executive_dashboard — KPIs tổng hợp cho BGĐ
create or replace function public.ai_tool_executive_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_inv jsonb;
  v_proj jsonb;
  v_hr jsonb;
  v_mr jsonb;
  v_po jsonb;
  v_fin jsonb;
begin
  -- Inventory KPIs
  select jsonb_build_object(
    'total_items', count(*),
    'total_stock', coalesce(sum(
      (select sum(val.value::numeric)
       from jsonb_each_text(coalesce(i.stock_by_warehouse, '{}'::jsonb)) as val)
    ), 0),
    'low_stock_count', count(*) filter (
      where (select sum(val.value::numeric)
             from jsonb_each_text(coalesce(i.stock_by_warehouse, '{}'::jsonb)) val)
            < coalesce(i.min_stock, 0)
        and coalesce(i.min_stock, 0) > 0
    )
  ) into v_inv from items i;

  -- Project KPIs
  select jsonb_build_object(
    'total_projects', count(*),
    'active_projects', count(*) filter (where h.status = 'active' or h.status is null)
  ) into v_proj from hrm_construction_sites h;

  -- HR KPIs
  select jsonb_build_object(
    'total_employees', count(*),
    'active_employees', count(*) filter (where e.status = 'active' or e.status is null)
  ) into v_hr from employees e;

  -- MR pending
  select jsonb_build_object(
    'total_mr', count(*),
    'pending_mr', count(*) filter (where mr.status in ('pending', 'submitted', 'draft'))
  ) into v_mr from project_material_requests mr;

  -- PO pending
  select jsonb_build_object(
    'total_po', count(*),
    'pending_po', count(*) filter (where po.status in ('pending', 'submitted', 'draft')),
    'total_po_value', coalesce(sum(po.total_amount), 0)
  ) into v_po from purchase_orders po;

  -- Finance this month
  select jsonb_build_object(
    'income_this_month', coalesce(sum(case when pt.type = 'income' then pt.amount else 0 end), 0),
    'expense_this_month', coalesce(sum(case when pt.type = 'expense' then pt.amount else 0 end), 0)
  ) into v_fin
  from project_transactions pt
  where pt.date::date >= date_trunc('month', current_date)::date;

  return jsonb_build_object(
    'generated_at', now(),
    'inventory', v_inv,
    'projects', v_proj,
    'employees', v_hr,
    'material_requests', v_mr,
    'purchase_orders', v_po,
    'finance_this_month', v_fin
  );
end;
$$;


-- ───────────────────────────────────────────────────────────────
--  SECURITY: Revoke public, grant service_role only
-- ───────────────────────────────────────────────────────────────

-- Construction domain
revoke all on function public.ai_tool_project_list(text) from public, anon, authenticated;
revoke all on function public.ai_tool_project_summary(text) from public, anon, authenticated;
revoke all on function public.ai_tool_project_progress(text) from public, anon, authenticated;
revoke all on function public.ai_tool_daily_log_summary(text, date, date) from public, anon, authenticated;

grant execute on function public.ai_tool_project_list(text) to service_role;
grant execute on function public.ai_tool_project_summary(text) to service_role;
grant execute on function public.ai_tool_project_progress(text) to service_role;
grant execute on function public.ai_tool_daily_log_summary(text, date, date) to service_role;

-- Inventory domain
revoke all on function public.ai_tool_inventory_summary(text) from public, anon, authenticated;
revoke all on function public.ai_tool_material_search(text, text) from public, anon, authenticated;
revoke all on function public.ai_tool_material_request_status(text, text) from public, anon, authenticated;
revoke all on function public.ai_tool_purchase_order_summary(text, text) from public, anon, authenticated;

grant execute on function public.ai_tool_inventory_summary(text) to service_role;
grant execute on function public.ai_tool_material_search(text, text) to service_role;
grant execute on function public.ai_tool_material_request_status(text, text) to service_role;
grant execute on function public.ai_tool_purchase_order_summary(text, text) to service_role;

-- Finance & HR domain
revoke all on function public.ai_tool_project_finance(text) from public, anon, authenticated;
revoke all on function public.ai_tool_employee_summary(text) from public, anon, authenticated;
revoke all on function public.ai_tool_attendance_report(date, text) from public, anon, authenticated;

grant execute on function public.ai_tool_project_finance(text) to service_role;
grant execute on function public.ai_tool_employee_summary(text) to service_role;
grant execute on function public.ai_tool_attendance_report(date, text) to service_role;

-- Cross-domain
revoke all on function public.ai_tool_executive_dashboard() from public, anon, authenticated;
grant execute on function public.ai_tool_executive_dashboard() to service_role;

-- Notify PostgREST to reload schema
notify pgrst, 'reload schema';
