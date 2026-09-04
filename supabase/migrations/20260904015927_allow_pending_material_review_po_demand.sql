-- Phòng Vật tư may prepare a PO while a project MR is being reviewed by that
-- department.  Other pending workflow steps remain outside the PO demand pool.
create or replace function public.list_project_material_request_procurement_demand(
  p_project_id text,
  p_construction_site_id text default null
)
returns table (
  material_request_id text,
  request_code text,
  construction_site_id text,
  site_warehouse_id text,
  fulfillment_mode text,
  request_status text,
  created_date timestamptz,
  expected_date timestamptz,
  request_line_id text,
  item_id text,
  material_budget_item_id text,
  work_boq_item_id text,
  requested_qty numeric,
  approved_qty numeric,
  received_qty numeric,
  closed_qty numeric,
  open_qty numeric,
  needed_date timestamptz,
  item_name text,
  sku text,
  unit text,
  is_manual_item boolean
)
language sql stable security definer set search_path = '' as $$
  with authorized as (
    select app_private.current_actor_has_effective_room_action(
      p_project_id, nullif(p_construction_site_id, ''), 'material_po', 'view'
    ) allowed
  ), request_lines as (
    select request_row.*,
      line.value,
      coalesce(line.value ->> 'lineId', request_row.id || '-' || line.ordinality::text) line_id,
      coalesce(nullif(line.value ->> 'requestQty', '')::numeric, 0) request_qty
    from public.requests request_row
    cross join authorized
    cross join lateral jsonb_array_elements(coalesce(request_row.items, '[]'::jsonb))
      with ordinality line(value, ordinality)
    where authorized.allowed
      and request_row.request_origin = 'project'
      and request_row.project_id = p_project_id
      and (nullif(p_construction_site_id, '') is null
        or request_row.construction_site_id = p_construction_site_id)
      and (
        request_row.status::text in ('APPROVED', 'IN_TRANSIT')
        or (
          request_row.status::text = 'PENDING'
          and request_row.workflow_step = 'material_department_review'
        )
      )
  ), fulfillment as (
    select fulfillment_line.material_request_id, fulfillment_line.request_line_id,
      sum(coalesce(fulfillment_line.received_qty, 0)) received_qty
    from public.material_request_fulfillment_lines fulfillment_line
    join public.material_request_fulfillment_batches batch
      on batch.id = fulfillment_line.batch_id
      and batch.status not in ('cancelled', 'returned')
    group by fulfillment_line.material_request_id, fulfillment_line.request_line_id
  ), closures as (
    select closure.material_request_id, closure.request_line_id,
      sum(coalesce(closure.closed_qty, 0)) closed_qty
    from public.material_request_line_need_closures closure
    where closure.status = 'active'
    group by closure.material_request_id, closure.request_line_id
  )
  select lines.id, lines.code, lines.construction_site_id, lines.site_warehouse_id,
    lines.fulfillment_mode, lines.status::text, lines.created_date, lines.expected_date,
    lines.line_id, lines.value ->> 'itemId', lines.value ->> 'materialBudgetItemId',
    lines.value ->> 'workBoqItemId', lines.request_qty, lines.request_qty,
    coalesce(fulfillment.received_qty, 0), coalesce(closures.closed_qty, 0),
    greatest(0, lines.request_qty - coalesce(fulfillment.received_qty, 0)
      - coalesce(closures.closed_qty, 0)),
    nullif(lines.value ->> 'neededDate', '')::timestamptz,
    lines.value ->> 'itemNameSnapshot', lines.value ->> 'skuSnapshot',
    lines.value ->> 'unitSnapshot', coalesce((lines.value ->> 'isManualItem')::boolean, false)
  from request_lines lines
  left join fulfillment on fulfillment.material_request_id = lines.id
    and fulfillment.request_line_id = lines.line_id
  left join closures on closures.material_request_id = lines.id
    and closures.request_line_id = lines.line_id
  where greatest(0, lines.request_qty - coalesce(fulfillment.received_qty, 0)
    - coalesce(closures.closed_qty, 0)) > 0
  order by lines.created_date desc, lines.id, lines.line_id;
$$;

revoke all on function public.list_project_material_request_procurement_demand(text, text) from public, anon;
grant execute on function public.list_project_material_request_procurement_demand(text, text) to authenticated;
