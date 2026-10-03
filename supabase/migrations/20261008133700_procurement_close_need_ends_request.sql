-- "Đóng nhu cầu" ở Mua hàng tự Kết thúc đề xuất vật tư (chủ SP đồng ý 03/10/2026, câu 3 sau PR #74).
--
-- * Mua hàng đóng nhu cầu của một đề xuất vật tư đang cung ứng → đề xuất bên dự án chuyển "Kết thúc" như CHT bấm
--   Kết thúc (việc 1): dòng chưa có nguồn ghi đóng (material_request_line_need_closures) kèm lý do; dòng đã đặt PO /
--   đang chuyển kho vẫn giao, hàng về thành tồn kho công trường. Lịch sử đề xuất ghi "Mua hàng đóng nhu cầu: <lý do>".
-- * Mở lại nhu cầu → gỡ các dòng đóng do lần đóng đó, đề xuất về "Đang cung ứng" (hoặc tự hoàn tất nếu đã nhận đủ).
-- * Phiếu kết thúc do Mua hàng đóng vẫn hiện ở tab "Đã đóng" để mở lại được. Kế hoạch vật tư giữ như cũ (chỉ đóng nhu cầu).

-- Kết thúc đề xuất khi Mua hàng đóng nhu cầu (p_at = thời điểm đóng, dùng để mở lại đúng các dòng đã đóng).
create or replace function app_private.procurement_close_end_request(p_request_id text, p_reason text, p_actor uuid, p_at timestamptz)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_req public.requests%rowtype; v_closed integer;
begin
  select * into v_req from public.requests where id = p_request_id and request_origin = 'project' for update;
  -- null = đề xuất không còn đang cung ứng (không kết thúc).
  if not found or v_req.status not in ('APPROVED', 'IN_TRANSIT') then return null; end if;
  insert into public.material_request_line_need_closures (project_id, construction_site_id, material_request_id, request_line_id,
    item_id, work_boq_item_id, material_budget_item_id, closed_qty, actual_received_qty_snapshot, reason, status, closed_by, closed_at)
  select v_req.project_id, v_req.construction_site_id, v_req.id, s.line_id, s.item_id,
    (select b.id from public.project_work_boq_items b where b.id::text = x.value->>'workBoqItemId'),
    (select m.id from public.material_budget_items m where m.id::text = x.value->>'materialBudgetItemId'),
    greatest(s.need_qty - s.received_qty, 0), greatest(s.received_qty, 0), 'Mua hàng đóng nhu cầu: ' || p_reason, 'active', p_actor, p_at
  from app_private.material_request_supply_lines_v1(array[v_req.id]) s
  join lateral jsonb_array_elements(v_req.items) x on x.value->>'lineId' = s.line_id
  where s.line_state in ('waiting', 'none') and s.item_id is not null;
  get diagnostics v_closed = row_count;
  update public.requests
  set status = 'COMPLETED'::public.request_status, workflow_step = 'ended', workflow_step_started_at = now(),
    workflow_step_due_at = null, workflow_step_sla_hours = null, workflow_step_actor_user_id = p_actor::text,
    submitted_to_user_id = null, submitted_to_name = null, submitted_to_permission = null,
    last_action_by = p_actor, last_action_at = now()
  where id = v_req.id;
  insert into public.material_request_events (request_id, project_id, from_step, to_step, action, actor_user_id, note, metadata)
  values (v_req.id, v_req.project_id, v_req.workflow_step, 'ended', 'SUPPLY_ENDED', p_actor::text, 'Mua hàng đóng nhu cầu: ' || p_reason,
    jsonb_build_object('closedLines', v_closed, 'fromStatus', v_req.status, 'by', 'procurement_close', 'closedAt', p_at));
  return v_closed;
end;
$$;

-- Mở lại nhu cầu: chỉ gỡ phần kết thúc do chính lần đóng đó (không đụng Kết thúc của CHT).
create or replace function app_private.procurement_close_reopen_request(p_request_id text, p_closed_at timestamptz, p_actor uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_req public.requests%rowtype; v_last public.material_request_events%rowtype;
begin
  select * into v_req from public.requests where id = p_request_id and request_origin = 'project' for update;
  if not found or v_req.status <> 'COMPLETED' or v_req.workflow_step is distinct from 'ended' then return; end if;
  select * into v_last from public.material_request_events e where e.request_id = p_request_id and e.action = 'SUPPLY_ENDED'
  order by e.created_at desc limit 1;
  if not found or coalesce(v_last.metadata->>'by', '') <> 'procurement_close' then return; end if;
  update public.material_request_line_need_closures
  set status = 'cancelled', cancelled_by = p_actor, cancelled_at = now(), cancel_reason = 'Mua hàng mở lại nhu cầu', updated_at = now()
  where material_request_id = p_request_id and status = 'active' and closed_at = p_closed_at;
  update public.requests
  set status = 'IN_TRANSIT'::public.request_status, workflow_step = 'batch_planning', workflow_step_started_at = now(),
    workflow_step_actor_user_id = p_actor::text, last_action_by = p_actor, last_action_at = now()
  where id = p_request_id;
  insert into public.material_request_events (request_id, project_id, from_step, to_step, action, actor_user_id, note, metadata)
  values (p_request_id, v_req.project_id, 'ended', 'batch_planning', 'SUPPLY_REOPENED', p_actor::text, 'Mua hàng mở lại nhu cầu',
    jsonb_build_object('by', 'procurement_close'));
  -- Đã nhận đủ hết thì tự hoàn tất ngay.
  perform app_private.refresh_material_request_supply_v1(p_request_id);
end;
$$;

revoke all on function app_private.procurement_close_end_request(text, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function app_private.procurement_close_reopen_request(text, timestamptz, uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.close_procurement_need_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_action text := coalesce(p_input->>'action', 'close');
  v_reason text := nullif(btrim(p_input->>'reason'), ''); v_n integer := 0; s jsonb; v_at timestamptz; v_ended integer := 0;
begin
  if not app_private.procurement_can('manage') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  if jsonb_typeof(p_input->'sources') is distinct from 'array' or jsonb_array_length(p_input->'sources') = 0 then
    raise exception using errcode = '22023', message = 'PROCUREMENT_SOURCES_REQUIRED'; end if;
  if v_action not in ('close', 'reopen') then
    raise exception using errcode = '22023', message = 'PROCUREMENT_ACTION_INVALID'; end if;
  if v_action = 'close' and v_reason is null then
    raise exception using errcode = '22023', message = 'PROCUREMENT_CLOSE_REASON_REQUIRED'; end if;
  for s in select value from jsonb_array_elements(p_input->'sources') loop
    if not exists (select 1 from app_private.procurement_inbox_documents() d
        where d.source_type = s->>'sourceType' and d.source_id = s->>'sourceId') then
      raise exception using errcode = '22023', message = 'PROCUREMENT_SOURCE_NOT_FOUND'; end if;
    v_at := null;
    if v_action = 'close' then
      insert into public.procurement_need_closures (source_type, source_id, reason, closed_by)
      values (s->>'sourceType', s->>'sourceId', v_reason, v_actor)
      on conflict (source_type, source_id) do nothing
      returning closed_at into v_at;
    else
      delete from public.procurement_need_closures where source_type = s->>'sourceType' and source_id = s->>'sourceId'
      returning closed_at into v_at;
    end if;
    if v_at is not null then
      -- Đề xuất vật tư: đóng nhu cầu = Kết thúc đề xuất; mở lại = gỡ phần kết thúc đó.
      if s->>'sourceType' = 'material_request' then
        if v_action = 'close' then
          if app_private.procurement_close_end_request(s->>'sourceId', v_reason, v_actor, v_at) is not null then
            v_ended := v_ended + 1;
          end if;
        else
          perform app_private.procurement_close_reopen_request(s->>'sourceId', v_at, v_actor);
        end if;
      end if;
      v_n := v_n + 1;
      insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
      values ('need', (s->>'sourceType') || ':' || (s->>'sourceId'), v_action, v_actor, v_reason, s);
    end if;
  end loop;
  return jsonb_build_object('changed', v_n, 'endedRequests', v_ended);
end;
$$;

CREATE OR REPLACE FUNCTION app_private.procurement_inbox_documents()
returns table (source_type text, source_id text, code text, title text, project_id text, construction_site_id text,
  warehouse_id text, needed_date date, requester_name text, approved_at timestamptz, approved_by_name text, created_at timestamptz,
  period_type text, period_start date, closed_at timestamptz, close_reason text, closed_by_name text)
language sql stable security definer set search_path = '' as $$
  select d.*, c.closed_at, c.reason, (select u.name from public.users u where u.id = c.closed_by)
  from (
    select 'material_request' source_type, r.id source_id, r.code, r.title, r.project_id, r.construction_site_id,
      r.site_warehouse_id warehouse_id, r.expected_date::date needed_date, (select u.name from public.users u where u.id = r.requester_id) requester_name,
      null::timestamptz approved_at, null::text approved_by_name, coalesce(r.created_date, r.created_at) created_at, null::text period_type, null::date period_start
    from public.requests r
    where r.request_origin = 'project' and (r.status in ('APPROVED', 'IN_TRANSIT')
      -- Kết thúc do Mua hàng đóng nhu cầu: vẫn ở tab "Đã đóng" để mở lại được.
      or (r.status = 'COMPLETED' and r.workflow_step = 'ended' and exists (select 1 from public.procurement_need_closures nc
        where nc.source_type = 'material_request' and nc.source_id = r.id)))
    union all
    select 'material_plan', p.id::text, p.code,
      'Kế hoạch vật tư ' || case p.period_type when 'month' then 'tháng ' || to_char(p.period_start, 'MM/YYYY')
        else 'tuần ' || to_char(p.period_start, 'DD/MM') || '–' || to_char(p.period_end, 'DD/MM/YYYY') end,
      p.project_id, p.construction_site_id, p.destination_warehouse_id, coalesce(p.needed_date, p.period_start),
      (select u.name from public.users u where u.id = p.created_by), p.approved_at,
      (select u.name from public.users u where u.id = p.approved_by), p.created_at, p.period_type, p.period_start
    from public.project_material_plans p where p.status = 'approved'
  ) d
  left join public.procurement_need_closures c on c.source_type = d.source_type and c.source_id = d.source_id;
$$;

CREATE OR REPLACE FUNCTION app_private.procurement_inbox_lines()
 RETURNS TABLE(source_type text, source_id text, line_id text, item_id text, item_name text, sku text, unit text, need_qty numeric, ordered_qty numeric, received_qty numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
  -- Việc 1: số đã đặt gồm PO + phiếu chuyển "Cấp từ kho" + đợt cấp cũ từ kho; số đã nhận theo đơn vị kho.
  select 'material_request', s.request_id, s.line_id, s.item_id, s.item_name, s.sku, s.unit, s.need_qty, s.sourced_qty, s.received_qty
  from app_private.material_request_supply_lines_v1(null) s
  union all
  select 'material_request', s.request_id, s.line_id, s.item_id, s.item_name, s.sku, s.unit, s.need_qty, s.sourced_qty, s.received_qty
  from app_private.material_request_supply_lines_v1(coalesce((select array_agg(r.id) from public.requests r
    join public.procurement_need_closures nc on nc.source_type = 'material_request' and nc.source_id = r.id
    where r.request_origin = 'project' and r.status = 'COMPLETED' and r.workflow_step = 'ended'), '{}'::text[])) s
  union all
  select 'material_plan', p.id::text, l.id::text, l.item_id, l.item_name_snapshot, l.sku_snapshot, l.unit,
    l.requested_qty, coalesce(po.ordered_qty, 0), coalesce(po.received_qty, 0)
  from public.project_material_plans p
  join public.project_material_plan_lines l on l.plan_id = p.id and l.requested_qty > 0
  left join lateral (
    select round(sum(k.ordered_qty - app_private.procurement_link_credited_v2(o.id, k.purchase_order_line_id, k.ordered_qty, k.id)), 6) ordered_qty,
      sum(app_private.procurement_link_received_v2(o.id, o.items, k.purchase_order_line_id, k.ordered_qty, k.id)) received_qty
    from public.procurement_po_plan_links k
    join public.purchase_orders o on o.id = k.purchase_order_id and o.status not in ('cancelled', 'returned') and o.archived_at is null
    where k.material_plan_line_id = l.id
  ) po on true
  where p.status = 'approved';
$$;

notify pgrst, 'reload schema';
