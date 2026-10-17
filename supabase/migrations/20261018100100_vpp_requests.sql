-- Văn phòng phẩm (17/10/2026): Đề xuất → Duyệt (trưởng phòng, duyệt thay, vượt ngưỡng) → Cấp phát ở Kho VPP.
-- Mọi nhân viên đề xuất; báo cáo theo người + phòng ban (chụp phòng ban lúc gửi).
-- Ghi sổ đi chung sổ kho: cấp = phiếu XUẤT office_supply_issue, trả lại = NHẬP office_supply_return,
-- mua về = NHẬP office_supply_receipt (thủ kho nhập kèm ảnh hóa đơn). Giá xuất = bình quân gia quyền của kho lúc cấp.
-- Quyền: người đề xuất / người duyệt theo dữ liệu (không cần cấp quyền); thủ kho = wms.transaction.keeper ở kho;
-- wms.office_supply.manage (thiết lập, duyệt thay mọi phiếu); wms.office_supply.report (xem mọi phiếu, báo cáo).

-- ---------------------------------------------------------------------------
-- Quyền
-- ---------------------------------------------------------------------------
insert into public.permission_modules (application_code, code, name, description, routes, legacy_module_key, sort_order, is_active)
values ('wms', 'wms.office_supply', 'Văn phòng phẩm', 'Đề xuất, duyệt, cấp phát VPP', '{}', 'WMS', 50, true)
on conflict (code) do nothing;

insert into public.permission_actions (module_code, action, permission_code, label, description, scope_modes, legacy_module_key,
  legacy_route, legacy_admin_only, sort_order, is_active, risk_level, is_business_action, is_business_approval,
  direct_grant_requires_expiry, grant_readiness, access_application_code, direct_grant_allowed)
values
  ('wms.office_supply', 'manage', 'wms.office_supply.manage', 'Quản trị VPP', 'Đặt người duyệt từng phòng, ngưỡng tiền, duyệt thay mọi phiếu VPP',
    array['global'], 'WMS', '/vpp', false, 10, true, 'important', true, true, false, 'enforced', 'wms', true),
  ('wms.office_supply', 'report', 'wms.office_supply.report', 'Xem báo cáo VPP', 'Xem mọi phiếu VPP, báo cáo theo người và phòng ban',
    array['global'], 'WMS', '/vpp', false, 20, true, 'normal', false, false, false, 'enforced', 'wms', true)
on conflict (permission_code) do nothing;

-- Mục đích nghiệp vụ mới của phiếu kho.
alter table public.transactions drop constraint transactions_business_event_type_check;
alter table public.transactions add constraint transactions_business_event_type_check check (business_event_type is null or business_event_type = any (array[
  'request_po_receipt', 'proactive_po_receipt', 'site_hot_purchase_receipt', 'direct_supplier_receipt', 'direct_manual_receipt',
  'project_return_receipt', 'warehouse_transfer', 'construction_issue', 'supplier_return', 'warehouse_loss', 'inventory_adjustment',
  'opening_balance', 'reversal', 'legacy_direct_receipt', 'legacy_direct_issue',
  'office_supply_issue', 'office_supply_return', 'office_supply_receipt']));

-- ---------------------------------------------------------------------------
-- Bảng
-- ---------------------------------------------------------------------------
create table public.office_supply_settings (
  warehouse_id text primary key references public.warehouses(id),
  threshold_amount numeric not null default 5000000 check (threshold_amount >= 0),
  threshold_approver_id uuid references public.users(id),
  fallback_approver_id uuid references public.users(id),
  row_version integer not null default 1,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);

create table public.office_supply_approvers (
  org_unit_id uuid primary key references public.org_units(id),
  approver_id uuid not null references public.users(id),
  deputy_id uuid references public.users(id),
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now(),
  check (deputy_id is distinct from approver_id)
);

create table public.office_supply_requests (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  warehouse_id text not null references public.warehouses(id),
  requester_id uuid not null references public.users(id),
  org_unit_id uuid references public.org_units(id),
  org_unit_name text,
  note text,
  status text not null check (status in ('pending', 'pending_threshold', 'returned', 'approved', 'partial', 'issued', 'closed', 'rejected', 'cancelled')),
  approver_id uuid references public.users(id),
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  threshold_required boolean not null default false,
  threshold_approved_by uuid references public.users(id),
  threshold_approved_at timestamptz,
  estimated_amount numeric not null default 0,
  submitted_at timestamptz not null default now(),
  closed_reason text,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index office_supply_requests_requester_idx on public.office_supply_requests (requester_id, created_at desc);
create index office_supply_requests_status_idx on public.office_supply_requests (status, warehouse_id);
create index office_supply_requests_approver_idx on public.office_supply_requests (approver_id) where status in ('pending', 'pending_threshold');
create index office_supply_requests_org_idx on public.office_supply_requests (org_unit_id, created_at desc);

create table public.office_supply_request_lines (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.office_supply_requests(id) on delete cascade,
  line_no integer not null,
  item_id text references public.items(id),
  item_name text not null,
  unit text not null,
  requested_qty numeric not null check (requested_qty > 0),
  approved_qty numeric check (approved_qty >= 0),
  issued_qty numeric not null default 0 check (issued_qty >= 0),
  returned_qty numeric not null default 0 check (returned_qty >= 0 and returned_qty <= issued_qty),
  note text,
  unique (request_id, line_no)
);
create index office_supply_request_lines_item_idx on public.office_supply_request_lines (item_id);

create table public.office_supply_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.office_supply_requests(id) on delete cascade,
  action text not null,
  actor_id uuid references public.users(id),
  on_behalf_of uuid references public.users(id),
  note text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index office_supply_events_request_idx on public.office_supply_events (request_id, created_at);

alter table public.office_supply_settings enable row level security;
alter table public.office_supply_approvers enable row level security;
alter table public.office_supply_requests enable row level security;
alter table public.office_supply_request_lines enable row level security;
alter table public.office_supply_events enable row level security;
revoke all on public.office_supply_settings, public.office_supply_approvers, public.office_supply_requests,
  public.office_supply_request_lines, public.office_supply_events from anon, authenticated;

-- Kho VPP Hưng Yên là kho VPP mặc định (chỉ có trên Cloud).
insert into public.office_supply_settings (warehouse_id)
select w.id from public.warehouses w where w.id = 'wh-1782120782470-7ey83'
on conflict (warehouse_id) do nothing;

-- ---------------------------------------------------------------------------
-- Hàm nội bộ
-- ---------------------------------------------------------------------------
create or replace function app_private.vpp_is_manager(p_user uuid default public.current_app_user_id())
returns boolean language sql stable security definer set search_path = ''
as $$
  select p_user is not null and (public.is_admin()
    or app_private.has_permission(p_user, 'wms.office_supply.manage', 'global', '*'));
$$;

create or replace function app_private.vpp_can_report(p_user uuid default public.current_app_user_id())
returns boolean language sql stable security definer set search_path = ''
as $$
  select app_private.vpp_is_manager(p_user) or (p_user is not null
    and app_private.has_permission(p_user, 'wms.office_supply.report', 'global', '*'));
$$;

create or replace function app_private.vpp_is_keeper(p_warehouse_id text, p_user uuid default public.current_app_user_id())
returns boolean language sql stable security definer set search_path = ''
as $$
  select p_user is not null and p_warehouse_id is not null
    and app_private.wms_has_action('wms.transaction.keeper', p_warehouse_id, p_warehouse_id, null, null, p_user);
$$;

create or replace function app_private.vpp_org_unit(p_user uuid)
returns uuid language sql stable security definer set search_path = ''
as $$
  select e.org_unit_id from public.employees e
  where e.user_id = p_user and e.org_unit_id is not null and coalesce(e.status, '') <> 'Đã nghỉ việc'
  order by e.updated_at desc nulls last limit 1;
$$;

create or replace function app_private.vpp_active_user(p_user uuid)
returns uuid language sql stable security definer set search_path = ''
as $$
  select u.id from public.users u where u.id = p_user and coalesce(u.is_active, true) and coalesce(u.account_status, 'ACTIVE') = 'ACTIVE';
$$;

-- Người duyệt bước 1: người duyệt của phòng → quản lý trực tiếp (khi người đề xuất chính là người duyệt phòng / phòng chưa đặt)
-- → người duyệt thay chung. Không bao giờ là chính người đề xuất.
create or replace function app_private.vpp_resolve_approver(p_requester uuid, p_org_unit uuid, p_warehouse_id text)
returns uuid language plpgsql stable security definer set search_path = ''
as $$
declare v uuid;
begin
  select app_private.vpp_active_user(a.approver_id) into v from public.office_supply_approvers a where a.org_unit_id = p_org_unit;
  if v is not null and v <> p_requester then return v; end if;
  v := app_private.resolve_request_direct_manager(p_requester);
  if v is not null and v <> p_requester then return v; end if;
  select app_private.vpp_active_user(s.fallback_approver_id) into v from public.office_supply_settings s where s.warehouse_id = p_warehouse_id;
  if v is not null and v <> p_requester then return v; end if;
  return null;
end $$;

-- Ai được duyệt bước hiện tại (trả về 'self' = người được giao, 'behalf' = duyệt thay, null = không).
create or replace function app_private.vpp_approve_role(p_req public.office_supply_requests, p_user uuid default public.current_app_user_id())
returns text language plpgsql stable security definer set search_path = ''
as $$
declare v_set public.office_supply_settings%rowtype;
begin
  if p_user is null or p_user = p_req.requester_id or p_req.status not in ('pending', 'pending_threshold') then return null; end if;
  if p_req.approver_id = p_user then return 'self'; end if;
  select * into v_set from public.office_supply_settings where warehouse_id = p_req.warehouse_id;
  if p_req.status = 'pending' and (
      exists (select 1 from public.office_supply_approvers a where a.org_unit_id = p_req.org_unit_id and a.deputy_id = p_user)
      or v_set.fallback_approver_id = p_user) then
    return 'behalf';
  end if;
  if app_private.vpp_is_manager(p_user) then return 'behalf'; end if;
  return null;
end $$;

create or replace function app_private.vpp_can_view(p_req public.office_supply_requests, p_user uuid default public.current_app_user_id())
returns boolean language sql stable security definer set search_path = ''
as $$
  select p_user is not null and (p_req.requester_id = p_user or p_req.approver_id = p_user or p_req.approved_by = p_user
    or p_req.threshold_approved_by = p_user or app_private.vpp_approve_role(p_req, p_user) is not null
    or app_private.vpp_can_report(p_user) or app_private.vpp_is_keeper(p_req.warehouse_id, p_user)
    or exists (select 1 from public.office_supply_approvers a where a.org_unit_id = p_req.org_unit_id and p_user in (a.approver_id, a.deputy_id)));
$$;

create or replace function app_private.vpp_unit_cost(p_item text, p_warehouse_id text)
returns numeric language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select case when sum(b.on_hand_qty) > 0 then sum(b.total_value) / sum(b.on_hand_qty) end
       from public.inventory_balances b where b.material_id = p_item and b.warehouse_id = p_warehouse_id),
    (select nullif(i.price_in, 0) from public.items i where i.id = p_item), 0);
$$;

create or replace function app_private.vpp_stock(p_item text, p_warehouse_id text)
returns numeric language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(b.on_hand_qty), 0) from public.inventory_balances b where b.material_id = p_item and b.warehouse_id = p_warehouse_id;
$$;

create or replace function app_private.vpp_estimate(p_request uuid)
returns numeric language sql stable security definer set search_path = ''
as $$
  select coalesce(round(sum(coalesce(l.approved_qty, l.requested_qty) * app_private.vpp_unit_cost(l.item_id, r.warehouse_id))), 0)
  from public.office_supply_request_lines l join public.office_supply_requests r on r.id = l.request_id
  where l.request_id = p_request and l.item_id is not null;
$$;

create or replace function app_private.vpp_log(p_request uuid, p_action text, p_note text, p_payload jsonb, p_on_behalf_of uuid default null)
returns void language sql security definer set search_path = ''
as $$
  insert into public.office_supply_events (request_id, action, actor_id, on_behalf_of, note, payload)
  values (p_request, p_action, public.current_app_user_id(), p_on_behalf_of, nullif(btrim(coalesce(p_note, '')), ''), coalesce(p_payload, '{}'::jsonb));
$$;

create or replace function app_private.vpp_notify(p_user uuid, p_title text, p_message text, p_req public.office_supply_requests)
returns void language sql security definer set search_path = ''
as $$
  insert into public.notifications (user_id, type, category, title, message, body, severity, icon, link, source_type, source_id,
    priority, push_enabled, metadata, delivery_reason)
  select p_user::text, 'info', 'wms', p_title, p_message, p_message, 'info', '📎', '#/vpp?r=' || p_req.id::text,
    'office_supply_request', 'office_supply_request:' || p_req.id::text || ':' || md5(p_title || coalesce(p_message, '')), 'normal', true,
    jsonb_build_object('requestId', p_req.id, 'code', p_req.code), 'responsible'
  where p_user is not null and p_user is distinct from public.current_app_user_id();
$$;

create or replace function app_private.vpp_keepers(p_warehouse_id text)
returns setof uuid language sql stable security definer set search_path = ''
as $$
  select distinct g.user_id from public.user_permission_grants g
  where g.permission_code = 'wms.transaction.keeper' and g.scope_type = 'warehouse' and g.scope_id = p_warehouse_id
    and app_private.vpp_active_user(g.user_id) is not null;
$$;

create or replace function app_private.vpp_next_code()
returns text language plpgsql security definer set search_path = ''
as $$
declare v_prefix text := 'DX-VPP-' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYMM') || '-'; v_n integer;
begin
  perform pg_advisory_xact_lock(hashtext('office_supply_request_code'));
  select coalesce(max(substr(code, length(v_prefix) + 1)::integer), 0) + 1 into v_n
  from public.office_supply_requests where code like v_prefix || '%' and substr(code, length(v_prefix) + 1) ~ '^[0-9]+$';
  return v_prefix || lpad(v_n::text, 3, '0');
end $$;

-- Mã VPP mới cho hàng mua về chưa có mã: VPP083, VPP084…
create or replace function app_private.vpp_next_sku()
returns text language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  perform pg_advisory_xact_lock(hashtext('office_supply_item_sku'));
  select coalesce(max(substr(sku, 4)::integer), 0) + 1 into v_n from public.items where sku ~ '^VPP[0-9]{3,4}$';
  return 'VPP' || lpad(v_n::text, 3, '0');
end $$;

create or replace function app_private.vpp_sync_item_cache(p_items text[], p_warehouse_id text)
returns void language sql security definer set search_path = ''
as $$
  update public.items i
  set stock_by_warehouse = jsonb_set(coalesce(i.stock_by_warehouse, '{}'::jsonb), array[p_warehouse_id],
    to_jsonb(app_private.stock_count_ledger_qty(i.id, p_warehouse_id)), true)
  where i.id = any(p_items);
$$;

create or replace function app_private.vpp_status_after_issue(p_request uuid)
returns text language sql stable security definer set search_path = ''
as $$
  select case
    when not exists (select 1 from public.office_supply_request_lines l where l.request_id = p_request and l.issued_qty > 0) then 'approved'
    when exists (select 1 from public.office_supply_request_lines l where l.request_id = p_request and l.issued_qty < coalesce(l.approved_qty, 0)) then 'partial'
    else 'issued' end;
$$;

create or replace function app_private.vpp_detail(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  r public.office_supply_requests%rowtype;
  v_actor uuid := public.current_app_user_id();
  v_role text; v_keeper boolean; v_price boolean;
begin
  select * into r from public.office_supply_requests where id = p_id;
  if not found or not app_private.vpp_can_view(r, v_actor) then
    raise exception using errcode = '42501', message = 'VPP_REQUEST_NOT_FOUND'; end if;
  v_role := app_private.vpp_approve_role(r, v_actor);
  v_keeper := app_private.vpp_is_keeper(r.warehouse_id, v_actor);
  -- Người đề xuất không cần giá; người duyệt / thủ kho / báo cáo thấy giá trị ước tính.
  v_price := v_actor is distinct from r.requester_id or v_role is not null or v_keeper or app_private.vpp_can_report(v_actor);
  return jsonb_build_object(
    'id', r.id, 'code', r.code, 'status', r.status, 'note', r.note, 'rowVersion', r.row_version,
    'warehouseId', r.warehouse_id, 'warehouseName', (select w.name from public.warehouses w where w.id = r.warehouse_id),
    'requesterId', r.requester_id, 'requesterName', (select u.name from public.users u where u.id = r.requester_id),
    'orgUnitId', r.org_unit_id, 'orgUnitName', r.org_unit_name,
    'approverId', r.approver_id, 'approverName', (select u.name from public.users u where u.id = r.approver_id),
    'approvedByName', (select u.name from public.users u where u.id = r.approved_by), 'approvedAt', r.approved_at,
    'thresholdRequired', r.threshold_required,
    'thresholdApprovedByName', (select u.name from public.users u where u.id = r.threshold_approved_by), 'thresholdApprovedAt', r.threshold_approved_at,
    'estimatedAmount', case when v_price then r.estimated_amount end,
    'submittedAt', r.submitted_at, 'updatedAt', r.updated_at, 'closedReason', r.closed_reason,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'lineNo', l.line_no, 'itemId', l.item_id,
        'sku', (select i.sku from public.items i where i.id = l.item_id), 'name', l.item_name, 'unit', l.unit,
        'requestedQty', l.requested_qty, 'approvedQty', l.approved_qty, 'issuedQty', l.issued_qty, 'returnedQty', l.returned_qty, 'note', l.note,
        'stock', case when l.item_id is not null and (v_keeper or v_role is not null) then app_private.vpp_stock(l.item_id, r.warehouse_id) end,
        'unitCost', case when l.item_id is not null and v_price then round(app_private.vpp_unit_cost(l.item_id, r.warehouse_id)) end)
      order by l.line_no) from public.office_supply_request_lines l where l.request_id = r.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'at', e.created_at, 'note', e.note, 'payload', e.payload,
        'actorName', (select u.name from public.users u where u.id = e.actor_id),
        'onBehalfOfName', (select u.name from public.users u where u.id = e.on_behalf_of)) order by e.created_at)
      from public.office_supply_events e where e.request_id = r.id), '[]'::jsonb),
    'moves', coalesce((select jsonb_agg(jsonb_build_object('transactionId', t.id, 'type', t.type::text, 'event', t.business_event_type, 'date', t.date,
        'code', (select it.code from public.inventory_transactions it where it.source_type = 'wms_transaction' and it.source_id = t.id limit 1),
        'reason', t.business_event_reason) order by t.date)
      from public.transactions t where t.source_type = 'office_supply_request' and t.source_id = r.id::text and t.status::text = 'COMPLETED'), '[]'::jsonb),
    'can', jsonb_build_object(
      'approve', v_role is not null, 'onBehalf', v_role = 'behalf',
      'edit', v_actor = r.requester_id and r.status in ('pending', 'returned') and r.approved_by is null,
      'cancel', v_actor = r.requester_id and r.status in ('pending', 'pending_threshold', 'returned', 'approved'),
      'issue', v_keeper and r.status in ('approved', 'partial'),
      'close', (v_keeper and r.status in ('approved', 'partial')) or (v_actor = r.requester_id and r.status = 'partial'),
      'return', v_keeper and exists (select 1 from public.office_supply_request_lines l where l.request_id = r.id and l.issued_qty > l.returned_qty)));
end $$;

-- ---------------------------------------------------------------------------
-- Màn chính: ai đang dùng, danh mục để chọn, các danh sách
-- ---------------------------------------------------------------------------
create or replace function public.get_office_supply_home_v1()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_wh text; v_ou uuid; v_manager boolean; v_report boolean; v_keeper boolean;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  select s.warehouse_id into v_wh from public.office_supply_settings s join public.warehouses w on w.id = s.warehouse_id
  where not coalesce(w.is_archived, false) order by s.warehouse_id limit 1;
  v_ou := app_private.vpp_org_unit(v_actor);
  v_manager := app_private.vpp_is_manager(v_actor);
  v_report := app_private.vpp_can_report(v_actor);
  v_keeper := app_private.vpp_is_keeper(v_wh, v_actor);
  return jsonb_build_object(
    'warehouseId', v_wh, 'warehouseName', (select w.name from public.warehouses w where w.id = v_wh),
    'me', jsonb_build_object('id', v_actor, 'name', (select u.name from public.users u where u.id = v_actor),
      'orgUnitId', v_ou, 'orgUnitName', (select o.name from public.org_units o where o.id = v_ou),
      'approverName', (select u.name from public.users u where u.id = app_private.vpp_resolve_approver(v_actor, v_ou, v_wh))),
    'can', jsonb_build_object('manage', v_manager, 'report', v_report, 'keeper', v_keeper,
      'approve', v_manager or exists (select 1 from public.office_supply_approvers a where v_actor in (a.approver_id, a.deputy_id))
        or exists (select 1 from public.office_supply_settings s where v_actor in (s.fallback_approver_id, s.threshold_approver_id))
        or exists (select 1 from public.office_supply_requests r where r.approver_id = v_actor)),
    -- Danh mục chọn: mã VPP đang dùng (không gửi giá) + tên đã từng đề xuất mà chưa có mã.
    'catalog', coalesce((select jsonb_agg(jsonb_build_object('itemId', i.id, 'sku', i.sku, 'name', i.name, 'unit', i.unit,
        'inStock', app_private.vpp_stock(i.id, v_wh) > 0) order by i.name)
      from public.items i where i.category = 'VPP' and i.status = 'active'), '[]'::jsonb),
    'uncoded', coalesce((select jsonb_agg(jsonb_build_object('name', x.item_name, 'unit', x.unit, 'times', x.n) order by x.n desc, x.item_name)
      from (select l.item_name, l.unit, count(*) n from public.office_supply_request_lines l
            join public.office_supply_requests r on r.id = l.request_id
            where l.item_id is null and r.created_at > now() - interval '365 days'
            group by l.item_name, l.unit limit 200) x), '[]'::jsonb));
end $$;

create or replace function public.list_office_supply_requests_v1(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_view text := coalesce(nullif(p->>'view', ''), 'mine');
  v_limit integer := least(greatest(coalesce(nullif(p->>'limit', '')::integer, 300), 1), 1000);
  v_report boolean;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  v_report := app_private.vpp_can_report(v_actor);
  return jsonb_build_object(
    'counts', jsonb_build_object(
      'mine', (select count(*) from public.office_supply_requests r where r.requester_id = v_actor and r.status in ('pending', 'pending_threshold', 'returned', 'approved', 'partial')),
      'approve', (select count(*) from public.office_supply_requests r where r.status in ('pending', 'pending_threshold') and app_private.vpp_approve_role(r, v_actor) is not null),
      'issue', (select count(*) from public.office_supply_requests r where r.status in ('approved', 'partial') and app_private.vpp_is_keeper(r.warehouse_id, v_actor))),
    'rows', coalesce((select jsonb_agg(x.j order by x.sort_at desc) from (
      select r.submitted_at sort_at, jsonb_build_object('id', r.id, 'code', r.code, 'status', r.status,
        'requesterName', (select u.name from public.users u where u.id = r.requester_id), 'requesterId', r.requester_id,
        'orgUnitName', r.org_unit_name, 'approverName', (select u.name from public.users u where u.id = r.approver_id),
        'submittedAt', r.submitted_at, 'updatedAt', r.updated_at, 'note', r.note, 'thresholdRequired', r.threshold_required,
        'estimatedAmount', case when r.requester_id <> v_actor or v_report then r.estimated_amount end,
        'myTurn', case when r.status in ('pending', 'pending_threshold') then app_private.vpp_approve_role(r, v_actor) is not null
                       when r.status in ('approved', 'partial') then app_private.vpp_is_keeper(r.warehouse_id, v_actor)
                       when r.status = 'returned' then r.requester_id = v_actor else false end,
        'lineCount', (select count(*) from public.office_supply_request_lines l where l.request_id = r.id),
        'summary', (select string_agg(l.item_name || ' ×' || trim(to_char(coalesce(l.approved_qty, l.requested_qty), 'FM999999990.##')), ', ' order by l.line_no)
                    from public.office_supply_request_lines l where l.request_id = r.id)) j
      from public.office_supply_requests r
      where case v_view
        when 'mine' then r.requester_id = v_actor
        when 'approve' then (r.status in ('pending', 'pending_threshold') and app_private.vpp_approve_role(r, v_actor) is not null)
          or ((r.approved_by = v_actor or r.threshold_approved_by = v_actor) and r.updated_at > now() - interval '30 days')
        when 'issue' then app_private.vpp_is_keeper(r.warehouse_id, v_actor)
          and (r.status in ('approved', 'partial') or (r.status in ('issued', 'closed') and r.updated_at > now() - interval '30 days'))
        when 'all' then app_private.vpp_can_view(r, v_actor)
        else false end
      order by r.submitted_at desc limit v_limit) x), '[]'::jsonb));
end $$;

create or replace function public.get_office_supply_request_v1(p_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$ select app_private.vpp_detail(p_id); $$;

-- ---------------------------------------------------------------------------
-- Gửi / sửa đề xuất
-- p: { id?, expectedRowVersion?, note?, lines: [{ itemId? | name, unit?, qty, note? }] }
-- ---------------------------------------------------------------------------
create or replace function public.save_office_supply_request_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  r public.office_supply_requests%rowtype;
  v_wh text; v_ou uuid; v_line jsonb; v_no integer := 0; v_item public.items%rowtype;
  v_name text; v_unit text; v_qty numeric; v_new boolean := nullif(p->>'id', '') is null;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  if jsonb_typeof(p->'lines') <> 'array' or jsonb_array_length(p->'lines') = 0 then
    raise exception using errcode = '22023', message = 'VPP_LINES_REQUIRED'; end if;
  if jsonb_array_length(p->'lines') > 60 then raise exception using errcode = '22023', message = 'VPP_TOO_MANY_LINES'; end if;

  if v_new then
    select s.warehouse_id into v_wh from public.office_supply_settings s join public.warehouses w on w.id = s.warehouse_id
    where not coalesce(w.is_archived, false) order by s.warehouse_id limit 1;
    if v_wh is null then raise exception using errcode = '22023', message = 'VPP_WAREHOUSE_MISSING'; end if;
    v_ou := app_private.vpp_org_unit(v_actor);
    insert into public.office_supply_requests (code, warehouse_id, requester_id, org_unit_id, org_unit_name, note, status, approver_id)
    values (app_private.vpp_next_code(), v_wh, v_actor, v_ou, (select o.name from public.org_units o where o.id = v_ou),
      nullif(btrim(coalesce(p->>'note', '')), ''), 'pending', app_private.vpp_resolve_approver(v_actor, v_ou, v_wh))
    returning * into r;
  else
    select * into r from public.office_supply_requests where id = (p->>'id')::uuid for update;
    if not found or r.requester_id <> v_actor then raise exception using errcode = '42501', message = 'VPP_REQUEST_NOT_FOUND'; end if;
    if r.status not in ('pending', 'returned') or r.approved_by is not null then
      raise exception using errcode = '22023', message = 'VPP_REQUEST_LOCKED'; end if;
    if nullif(p->>'expectedRowVersion', '') is not null and (p->>'expectedRowVersion')::integer <> r.row_version then
      raise exception using errcode = 'PT409', message = 'ROW_VERSION_CONFLICT'; end if;
    delete from public.office_supply_request_lines where request_id = r.id;
  end if;

  for v_line in select value from jsonb_array_elements(p->'lines') loop
    begin v_qty := nullif(v_line->>'qty', '')::numeric;
    exception when others then raise exception using errcode = '22023', message = 'VPP_LINE_INVALID'; end;
    if v_qty is null or v_qty <= 0 or v_qty > 100000 then raise exception using errcode = '22023', message = 'VPP_LINE_INVALID'; end if;
    if nullif(v_line->>'itemId', '') is not null then
      select * into v_item from public.items where id = v_line->>'itemId' and status = 'active';
      if not found then raise exception using errcode = '22023', message = 'VPP_ITEM_NOT_FOUND'; end if;
      v_name := v_item.name; v_unit := v_item.unit;
    else
      v_name := nullif(btrim(regexp_replace(coalesce(v_line->>'name', ''), '\s+', ' ', 'g')), '');
      v_unit := coalesce(nullif(btrim(coalesce(v_line->>'unit', '')), ''), 'Cái');
      if v_name is null or length(v_name) > 200 then raise exception using errcode = '22023', message = 'VPP_LINE_INVALID'; end if;
      v_item := null;
    end if;
    v_no := v_no + 1;
    insert into public.office_supply_request_lines (request_id, line_no, item_id, item_name, unit, requested_qty, note)
    values (r.id, v_no, v_item.id, v_name, v_unit, v_qty, nullif(btrim(coalesce(v_line->>'note', '')), ''));
  end loop;

  update public.office_supply_requests
  set note = case when v_new then note else nullif(btrim(coalesce(p->>'note', '')), '') end,
    status = 'pending', approver_id = case when v_new then approver_id else app_private.vpp_resolve_approver(requester_id, org_unit_id, warehouse_id) end,
    threshold_required = false, estimated_amount = app_private.vpp_estimate(r.id),
    submitted_at = now(), row_version = case when v_new then row_version else row_version + 1 end, updated_at = now()
  where id = r.id returning * into r;

  perform app_private.vpp_log(r.id, case when v_new then 'submit' else 'resubmit' end, null,
    jsonb_build_object('lines', v_no, 'approverId', r.approver_id));
  perform app_private.vpp_notify(r.approver_id, 'Đề xuất VPP chờ duyệt: ' || r.code,
    (select u.name from public.users u where u.id = r.requester_id) || coalesce(' · ' || r.org_unit_name, '') || ' · ' || v_no || ' món', r);
  if r.approver_id is null then
    -- Chưa có người duyệt: báo quản trị VPP để duyệt thay.
    perform app_private.vpp_notify(g.user_id, 'Đề xuất VPP chưa có người duyệt: ' || r.code,
      coalesce(r.org_unit_name, 'Chưa có phòng ban') || ' — cần đặt người duyệt ở Thiết lập VPP', r)
    from (select distinct g.user_id from public.user_permission_grants g where g.permission_code = 'wms.office_supply.manage') g;
  end if;
  return app_private.vpp_detail(r.id);
end $$;

-- ---------------------------------------------------------------------------
-- Duyệt / từ chối / trả lại / hủy / đóng phần còn lại
-- p: { id, action, expectedRowVersion, reason?, lines?: [{ lineId, approvedQty }] }
-- ---------------------------------------------------------------------------
create or replace function public.act_office_supply_request_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  r public.office_supply_requests%rowtype;
  v_set public.office_supply_settings%rowtype;
  v_action text := p->>'action';
  v_reason text := nullif(btrim(coalesce(p->>'reason', '')), '');
  v_role text; v_line jsonb; v_qty numeric; v_requester text; v_behalf uuid; v_next uuid;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  select * into r from public.office_supply_requests where id = (p->>'id')::uuid for update;
  if not found or not app_private.vpp_can_view(r, v_actor) then raise exception using errcode = '42501', message = 'VPP_REQUEST_NOT_FOUND'; end if;
  if nullif(p->>'expectedRowVersion', '') is not null and (p->>'expectedRowVersion')::integer <> r.row_version then
    raise exception using errcode = 'PT409', message = 'ROW_VERSION_CONFLICT'; end if;
  select * into v_set from public.office_supply_settings where warehouse_id = r.warehouse_id;
  v_requester := (select u.name from public.users u where u.id = r.requester_id);

  if v_action in ('approve', 'reject', 'return') then
    v_role := app_private.vpp_approve_role(r, v_actor);
    if v_role is null then raise exception using errcode = '42501', message = 'VPP_APPROVE_DENIED'; end if;
    v_behalf := case when v_role = 'behalf' then r.approver_id end;
    if v_action in ('reject', 'return') and v_reason is null then raise exception using errcode = '22023', message = 'VPP_REASON_REQUIRED'; end if;
  end if;

  if v_action = 'approve' then
    if r.status = 'pending' then
      -- Bước 1 được sửa số duyệt từng dòng (0 = không duyệt dòng đó).
      if jsonb_typeof(p->'lines') = 'array' then
        for v_line in select value from jsonb_array_elements(p->'lines') loop
          begin v_qty := (v_line->>'approvedQty')::numeric;
          exception when others then raise exception using errcode = '22023', message = 'VPP_LINE_INVALID'; end;
          update public.office_supply_request_lines set approved_qty = v_qty
          where id = (v_line->>'lineId')::uuid and request_id = r.id and v_qty >= 0 and v_qty <= requested_qty;
          if not found then raise exception using errcode = '22023', message = 'VPP_LINE_INVALID'; end if;
        end loop;
      end if;
      update public.office_supply_request_lines set approved_qty = requested_qty where request_id = r.id and approved_qty is null;
      if not exists (select 1 from public.office_supply_request_lines where request_id = r.id and approved_qty > 0) then
        raise exception using errcode = '22023', message = 'VPP_APPROVE_EMPTY'; end if;
      r.estimated_amount := app_private.vpp_estimate(r.id);
      v_next := app_private.vpp_active_user(v_set.threshold_approver_id);
      r.threshold_required := coalesce(r.estimated_amount > v_set.threshold_amount, false);
      update public.office_supply_requests
      set approved_by = v_actor, approved_at = now(), estimated_amount = r.estimated_amount, threshold_required = r.threshold_required,
        status = case when r.threshold_required and v_next is distinct from v_actor then 'pending_threshold' else 'approved' end,
        approver_id = case when r.threshold_required and v_next is distinct from v_actor then v_next else approver_id end,
        threshold_approved_by = case when r.threshold_required and v_next = v_actor then v_actor end,
        threshold_approved_at = case when r.threshold_required and v_next = v_actor then now() end,
        row_version = row_version + 1, updated_at = now()
      where id = r.id returning * into r;
      perform app_private.vpp_log(r.id, 'approve', v_reason, jsonb_build_object('estimatedAmount', r.estimated_amount,
        'threshold', v_set.threshold_amount, 'thresholdRequired', r.threshold_required,
        'lines', (select jsonb_agg(jsonb_build_object('name', l.item_name, 'requested', l.requested_qty, 'approved', l.approved_qty) order by l.line_no)
                  from public.office_supply_request_lines l where l.request_id = r.id and l.approved_qty <> l.requested_qty)), v_behalf);
    elsif r.status = 'pending_threshold' then
      update public.office_supply_requests
      set status = 'approved', threshold_approved_by = v_actor, threshold_approved_at = now(), row_version = row_version + 1, updated_at = now()
      where id = r.id returning * into r;
      perform app_private.vpp_log(r.id, 'approve_threshold', v_reason, jsonb_build_object('estimatedAmount', r.estimated_amount), v_behalf);
    end if;
    if r.status = 'pending_threshold' then
      perform app_private.vpp_notify(r.approver_id, 'Đề xuất VPP vượt ngưỡng chờ duyệt: ' || r.code,
        v_requester || coalesce(' · ' || r.org_unit_name, '') || ' · ' || trim(to_char(r.estimated_amount, 'FM999G999G999G990')) || ' đ', r);
    else
      perform app_private.vpp_notify(r.requester_id, 'Đề xuất VPP đã duyệt: ' || r.code, 'Chờ kho cấp', r);
      perform app_private.vpp_notify(k, 'VPP chờ cấp: ' || r.code, v_requester || coalesce(' · ' || r.org_unit_name, ''), r)
      from app_private.vpp_keepers(r.warehouse_id) k;
    end if;

  elsif v_action = 'reject' then
    update public.office_supply_requests set status = 'rejected', closed_reason = v_reason, row_version = row_version + 1, updated_at = now()
    where id = r.id returning * into r;
    perform app_private.vpp_log(r.id, 'reject', v_reason, '{}'::jsonb, v_behalf);
    perform app_private.vpp_notify(r.requester_id, 'Đề xuất VPP bị từ chối: ' || r.code, v_reason, r);

  elsif v_action = 'return' then
    update public.office_supply_requests
    set status = 'returned', approved_by = null, approved_at = null, threshold_required = false,
      row_version = row_version + 1, updated_at = now()
    where id = r.id returning * into r;
    update public.office_supply_request_lines set approved_qty = null where request_id = r.id;
    perform app_private.vpp_log(r.id, 'return', v_reason, '{}'::jsonb, v_behalf);
    perform app_private.vpp_notify(r.requester_id, 'Đề xuất VPP cần sửa: ' || r.code, v_reason, r);

  elsif v_action = 'cancel' then
    if r.requester_id <> v_actor or r.status not in ('pending', 'pending_threshold', 'returned', 'approved') then
      raise exception using errcode = '42501', message = 'VPP_CANCEL_DENIED'; end if;
    update public.office_supply_requests set status = 'cancelled', closed_reason = v_reason, row_version = row_version + 1, updated_at = now()
    where id = r.id returning * into r;
    perform app_private.vpp_log(r.id, 'cancel', v_reason, '{}'::jsonb);
    perform app_private.vpp_notify(r.approver_id, 'Đề xuất VPP đã hủy: ' || r.code, v_requester, r);

  elsif v_action = 'close' then
    -- Cấp thiếu rồi kết thúc phần còn lại (hết hàng, không mua nữa…).
    if r.status not in ('approved', 'partial') or not (app_private.vpp_is_keeper(r.warehouse_id, v_actor) or r.requester_id = v_actor) then
      raise exception using errcode = '42501', message = 'VPP_CLOSE_DENIED'; end if;
    if v_reason is null then raise exception using errcode = '22023', message = 'VPP_REASON_REQUIRED'; end if;
    update public.office_supply_requests
    set status = case when r.status = 'approved' then 'cancelled' else 'closed' end, closed_reason = v_reason,
      row_version = row_version + 1, updated_at = now()
    where id = r.id returning * into r;
    perform app_private.vpp_log(r.id, 'close', v_reason, jsonb_build_object('lines',
      (select jsonb_agg(jsonb_build_object('name', l.item_name, 'approved', l.approved_qty, 'issued', l.issued_qty) order by l.line_no)
       from public.office_supply_request_lines l where l.request_id = r.id and l.issued_qty < coalesce(l.approved_qty, 0))));
    perform app_private.vpp_notify(case when v_actor = r.requester_id then null else r.requester_id end,
      'Đề xuất VPP đã đóng: ' || r.code, v_reason, r);
  else
    raise exception using errcode = '22023', message = 'VPP_ACTION_INVALID';
  end if;
  return app_private.vpp_detail(r.id);
end $$;

-- ---------------------------------------------------------------------------
-- Cấp phát (thủ kho): một lần cấp = một phiếu xuất; cấp thiếu được, phần còn lại vẫn chờ.
-- p: { id, expectedRowVersion, date?, lines: [{ lineId, qty, itemId? (gán mã cho dòng chưa có mã) }] }
-- ---------------------------------------------------------------------------
create or replace function public.issue_office_supply_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  r public.office_supply_requests%rowtype;
  l public.office_supply_request_lines%rowtype;
  v_line jsonb; v_qty numeric; v_item public.items%rowtype; v_items jsonb := '[]'::jsonb; v_ids text[] := '{}';
  v_tx text := 'tx-vpp-issue-' || replace(gen_random_uuid()::text, '-', '');
  v_date timestamptz := coalesce((nullif(p->>'date', '')::date + (now() at time zone 'Asia/Ho_Chi_Minh')::time) at time zone 'Asia/Ho_Chi_Minh', now());
  v_requester text;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  select * into r from public.office_supply_requests where id = (p->>'id')::uuid for update;
  if not found then raise exception using errcode = '42501', message = 'VPP_REQUEST_NOT_FOUND'; end if;
  if not app_private.vpp_is_keeper(r.warehouse_id, v_actor) then raise exception using errcode = '42501', message = 'VPP_ISSUE_DENIED'; end if;
  if r.status not in ('approved', 'partial') then raise exception using errcode = '22023', message = 'VPP_REQUEST_STATE'; end if;
  if nullif(p->>'expectedRowVersion', '') is not null and (p->>'expectedRowVersion')::integer <> r.row_version then
    raise exception using errcode = 'PT409', message = 'ROW_VERSION_CONFLICT'; end if;
  if v_date > now() + interval '1 day' then raise exception using errcode = '22023', message = 'VPP_DATE_FUTURE'; end if;
  if jsonb_typeof(p->'lines') <> 'array' then raise exception using errcode = '22023', message = 'VPP_LINES_REQUIRED'; end if;
  v_requester := (select u.name from public.users u where u.id = r.requester_id);

  for v_line in select value from jsonb_array_elements(p->'lines') loop
    begin v_qty := (v_line->>'qty')::numeric;
    exception when others then raise exception using errcode = '22023', message = 'VPP_LINE_INVALID'; end;
    if v_qty is null or v_qty = 0 then continue; end if;
    select * into l from public.office_supply_request_lines where id = (v_line->>'lineId')::uuid and request_id = r.id for update;
    if not found or v_qty < 0 or v_qty > coalesce(l.approved_qty, 0) - l.issued_qty then
      raise exception using errcode = '22023', message = 'VPP_ISSUE_QTY_INVALID'; end if;
    if l.item_id is null then
      -- Dòng chưa có mã: thủ kho gán mã có sẵn trước khi cấp.
      select * into v_item from public.items where id = nullif(v_line->>'itemId', '') and status = 'active';
      if not found then raise exception using errcode = '22023', message = 'VPP_ITEM_REQUIRED'; end if;
      update public.office_supply_request_lines set item_id = v_item.id, unit = v_item.unit where id = l.id;
      perform app_private.vpp_log(r.id, 'map_item', null, jsonb_build_object('name', l.item_name, 'itemId', v_item.id, 'sku', v_item.sku));
      l.item_id := v_item.id; l.unit := v_item.unit;
    end if;
    if app_private.vpp_stock(l.item_id, r.warehouse_id) < v_qty then
      raise exception using errcode = '22023', message = 'VPP_STOCK_SHORT',
        detail = (select i.sku || ' ' || i.name from public.items i where i.id = l.item_id); end if;
    update public.office_supply_request_lines set issued_qty = issued_qty + v_qty where id = l.id;
    -- Sổ kho chỉ tự lấy bình quân cho chuyển kho; phiếu cấp VPP ghi giá vốn bình quân của kho tại lúc cấp.
    v_items := v_items || jsonb_build_array(jsonb_build_object('itemId', l.item_id, 'quantity', v_qty, 'unit', l.unit,
      'price', round(app_private.vpp_unit_cost(l.item_id, r.warehouse_id), 6), 'requestLineId', l.id, 'officeSupplyRequestId', r.id));
    v_ids := v_ids || l.item_id;
  end loop;
  if jsonb_array_length(v_items) = 0 then raise exception using errcode = '22023', message = 'VPP_LINES_REQUIRED'; end if;

  insert into public.transactions (id, type, date, items, source_warehouse_id, requester_id, approver_id, approved_at, status, note,
    pending_items, source_type, source_id, business_event_type, business_event_reason)
  values (v_tx, 'EXPORT', v_date, v_items, r.warehouse_id, r.requester_id, v_actor, now(), 'COMPLETED',
    'Cấp VPP ' || r.code || ' · ' || v_requester || coalesce(' · ' || r.org_unit_name, ''), '[]'::jsonb,
    'office_supply_request', r.id::text, 'office_supply_issue', 'Cấp VPP theo đề xuất ' || r.code);
  perform app_private.vpp_sync_item_cache(v_ids, r.warehouse_id);

  update public.office_supply_requests set status = app_private.vpp_status_after_issue(r.id), row_version = row_version + 1, updated_at = now()
  where id = r.id returning * into r;
  perform app_private.vpp_log(r.id, 'issue', null, jsonb_build_object('transactionId', v_tx, 'lines', v_items));
  perform app_private.vpp_notify(r.requester_id, case when r.status = 'issued' then 'Đã cấp đủ VPP: ' else 'Đã cấp một phần VPP: ' end || r.code,
    'Nhận tại ' || (select w.name from public.warehouses w where w.id = r.warehouse_id), r);
  return app_private.vpp_detail(r.id);
end $$;

-- ---------------------------------------------------------------------------
-- Nhận trả lại kho (cấp nhầm / dùng không hết). Giá nhập lại = giá đã xuất của dòng.
-- p: { id, reason, lines: [{ lineId, qty }] }
-- ---------------------------------------------------------------------------
create or replace function public.return_office_supply_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  r public.office_supply_requests%rowtype;
  l public.office_supply_request_lines%rowtype;
  v_reason text := nullif(btrim(coalesce(p->>'reason', '')), '');
  v_line jsonb; v_qty numeric; v_items jsonb := '[]'::jsonb; v_ids text[] := '{}'; v_price numeric;
  v_tx text := 'tx-vpp-return-' || replace(gen_random_uuid()::text, '-', '');
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  select * into r from public.office_supply_requests where id = (p->>'id')::uuid for update;
  if not found then raise exception using errcode = '42501', message = 'VPP_REQUEST_NOT_FOUND'; end if;
  if not app_private.vpp_is_keeper(r.warehouse_id, v_actor) then raise exception using errcode = '42501', message = 'VPP_RETURN_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'VPP_REASON_REQUIRED'; end if;
  if jsonb_typeof(p->'lines') <> 'array' then raise exception using errcode = '22023', message = 'VPP_LINES_REQUIRED'; end if;

  for v_line in select value from jsonb_array_elements(p->'lines') loop
    begin v_qty := (v_line->>'qty')::numeric;
    exception when others then raise exception using errcode = '22023', message = 'VPP_LINE_INVALID'; end;
    if v_qty is null or v_qty = 0 then continue; end if;
    select * into l from public.office_supply_request_lines where id = (v_line->>'lineId')::uuid and request_id = r.id for update;
    if not found or v_qty < 0 or v_qty > l.issued_qty - l.returned_qty then
      raise exception using errcode = '22023', message = 'VPP_RETURN_QTY_INVALID'; end if;
    select case when sum(e.quantity_out) > 0 then round(sum(e.quantity_out * e.unit_price) / sum(e.quantity_out), 6) end into v_price
    from public.inventory_ledger_entries e
    where e.source_type = 'wms_transaction' and e.source_line_id = l.id::text and e.quantity_out > 0;
    update public.office_supply_request_lines set returned_qty = returned_qty + v_qty where id = l.id;
    v_items := v_items || jsonb_build_array(jsonb_build_object('itemId', l.item_id, 'quantity', v_qty, 'unit', l.unit,
      'price', coalesce(v_price, app_private.vpp_unit_cost(l.item_id, r.warehouse_id)), 'requestLineId', l.id, 'officeSupplyRequestId', r.id));
    v_ids := v_ids || l.item_id;
  end loop;
  if jsonb_array_length(v_items) = 0 then raise exception using errcode = '22023', message = 'VPP_LINES_REQUIRED'; end if;

  insert into public.transactions (id, type, date, items, target_warehouse_id, requester_id, approver_id, approved_at, status, note,
    pending_items, source_type, source_id, business_event_type, business_event_reason)
  values (v_tx, 'IMPORT', now(), v_items, r.warehouse_id, r.requester_id, v_actor, now(), 'COMPLETED',
    'Trả lại VPP ' || r.code || ' · ' || (select u.name from public.users u where u.id = r.requester_id), '[]'::jsonb,
    'office_supply_request', r.id::text, 'office_supply_return', v_reason);
  perform app_private.vpp_sync_item_cache(v_ids, r.warehouse_id);
  update public.office_supply_requests set row_version = row_version + 1, updated_at = now() where id = r.id returning * into r;
  perform app_private.vpp_log(r.id, 'return_stock', v_reason, jsonb_build_object('transactionId', v_tx, 'lines', v_items));
  return app_private.vpp_detail(r.id);
end $$;

-- ---------------------------------------------------------------------------
-- Nhập VPP mua về (thủ kho nhập trực tiếp, ảnh hóa đơn đính kèm ngay sau khi lưu).
-- p: { warehouseId?, date?, supplierName?, invoiceNo?, note?, lines: [{ itemId? | name + unit, qty, price }] }
-- Hàng chưa có mã → tạo mã VPPnnn (nhóm VPP).
-- ---------------------------------------------------------------------------
create or replace function public.receive_office_supply_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_wh text := nullif(p->>'warehouseId', '');
  v_line jsonb; v_qty numeric; v_price numeric; v_item public.items%rowtype; v_name text; v_unit text;
  v_items jsonb := '[]'::jsonb; v_ids text[] := '{}'; v_new jsonb := '[]'::jsonb; v_sku text;
  v_tx text := 'tx-vpp-in-' || replace(gen_random_uuid()::text, '-', '');
  v_date timestamptz := coalesce((nullif(p->>'date', '')::date + (now() at time zone 'Asia/Ho_Chi_Minh')::time) at time zone 'Asia/Ho_Chi_Minh', now());
  v_supplier text := nullif(btrim(coalesce(p->>'supplierName', '')), '');
  v_invoice text := nullif(btrim(coalesce(p->>'invoiceNo', '')), '');
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  if v_wh is null then
    select s.warehouse_id into v_wh from public.office_supply_settings s order by s.warehouse_id limit 1; end if;
  if not exists (select 1 from public.office_supply_settings where warehouse_id = v_wh) then
    raise exception using errcode = '22023', message = 'VPP_WAREHOUSE_MISSING'; end if;
  if not app_private.vpp_is_keeper(v_wh, v_actor) then raise exception using errcode = '42501', message = 'VPP_RECEIVE_DENIED'; end if;
  if v_date > now() + interval '1 day' then raise exception using errcode = '22023', message = 'VPP_DATE_FUTURE'; end if;
  if jsonb_typeof(p->'lines') <> 'array' or jsonb_array_length(p->'lines') = 0 then
    raise exception using errcode = '22023', message = 'VPP_LINES_REQUIRED'; end if;

  for v_line in select value from jsonb_array_elements(p->'lines') loop
    begin v_qty := (v_line->>'qty')::numeric; v_price := coalesce(nullif(v_line->>'price', '')::numeric, 0);
    exception when others then raise exception using errcode = '22023', message = 'VPP_LINE_INVALID'; end;
    if v_qty is null or v_qty <= 0 or v_price < 0 then raise exception using errcode = '22023', message = 'VPP_LINE_INVALID'; end if;
    if nullif(v_line->>'itemId', '') is not null then
      select * into v_item from public.items where id = v_line->>'itemId' and status = 'active';
      if not found then raise exception using errcode = '22023', message = 'VPP_ITEM_NOT_FOUND'; end if;
    else
      v_name := nullif(btrim(regexp_replace(coalesce(v_line->>'name', ''), '\s+', ' ', 'g')), '');
      v_unit := coalesce(nullif(btrim(coalesce(v_line->>'unit', '')), ''), 'Cái');
      if v_name is null or length(v_name) > 200 then raise exception using errcode = '22023', message = 'VPP_LINE_INVALID'; end if;
      select * into v_item from public.items where category = 'VPP' and status = 'active' and lower(name) = lower(v_name) limit 1;
      if not found then
        v_sku := app_private.vpp_next_sku();
        insert into public.items (id, sku, name, category, unit, price_in, price_out, min_stock, stock_by_warehouse, status, inventory_mode, purchase_conversion_factor)
        values ('it-vpp-' || lower(v_sku), v_sku, v_name, 'VPP', v_unit, v_price, 0, 0, '{}'::jsonb, 'active', 'stock', 1)
        returning * into v_item;
        insert into public.item_catalog_events (item_id, action, after, reason, actor_id)
        values (v_item.id, 'issue', jsonb_build_object('sku', v_item.sku, 'name', v_item.name, 'unit', v_item.unit, 'category', 'VPP'),
          'Mã VPP mới khi nhập kho VPP', v_actor);
        v_new := v_new || jsonb_build_array(jsonb_build_object('itemId', v_item.id, 'sku', v_item.sku, 'name', v_item.name));
      end if;
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object('itemId', v_item.id, 'quantity', v_qty, 'unit', v_item.unit, 'price', v_price,
      'accountingQty', v_qty, 'accountingUnit', v_item.unit, 'accountingPrice', v_price));
    v_ids := v_ids || v_item.id;
  end loop;

  insert into public.transactions (id, type, date, items, target_warehouse_id, requester_id, approver_id, approved_at, status, note,
    pending_items, source_type, source_id, business_event_type, business_event_reason, business_partner_name_snapshot)
  values (v_tx, 'IMPORT', v_date, v_items, v_wh, v_actor, v_actor, now(), 'COMPLETED',
    concat_ws(' · ', 'Nhập VPP', v_supplier, case when v_invoice is not null then 'HĐ ' || v_invoice end, nullif(btrim(coalesce(p->>'note', '')), '')),
    '[]'::jsonb, 'office_supply_receipt', v_invoice, 'office_supply_receipt', 'Mua VPP nhập kho', v_supplier);
  perform app_private.vpp_sync_item_cache(v_ids, v_wh);
  insert into public.office_supply_events (request_id, action, actor_id, note, payload)
  values (null, 'receive', v_actor, v_supplier, jsonb_build_object('transactionId', v_tx, 'invoiceNo', v_invoice, 'lines', v_items, 'newItems', v_new));
  return jsonb_build_object('transactionId', v_tx, 'newItems', v_new,
    'code', (select it.code from public.inventory_transactions it where it.source_type = 'wms_transaction' and it.source_id = v_tx limit 1));
end $$;

-- Ảnh hóa đơn: client tải tệp vào wms-transaction-attachments/<transactionId>/… rồi gọi hàm này.
create or replace function public.attach_office_supply_receipt_files_v1(p_transaction_id text, p_attachments jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_tx public.transactions%rowtype;
begin
  select * into v_tx from public.transactions where id = p_transaction_id and source_type = 'office_supply_receipt' for update;
  if not found or not app_private.vpp_is_keeper(v_tx.target_warehouse_id) then
    raise exception using errcode = '42501', message = 'VPP_RECEIVE_DENIED'; end if;
  if jsonb_typeof(p_attachments) <> 'array' or exists (select 1 from jsonb_array_elements(p_attachments) a
      where coalesce(a->>'storagePath', '') not like p_transaction_id || '/%') then
    raise exception using errcode = '22023', message = 'VPP_ATTACHMENT_INVALID'; end if;
  update public.transactions set attachments = coalesce(attachments, '[]'::jsonb) || p_attachments where id = v_tx.id;
  return jsonb_build_object('transactionId', v_tx.id, 'count', jsonb_array_length(coalesce(v_tx.attachments, '[]'::jsonb)) + jsonb_array_length(p_attachments));
end $$;

-- Phiếu nhập VPP gần đây (thủ kho / báo cáo).
create or replace function public.list_office_supply_receipts_v1(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_actor uuid := public.current_app_user_id();
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  return coalesce((select jsonb_agg(x.j order by x.d desc) from (
    select t.date d, jsonb_build_object('transactionId', t.id, 'date', t.date, 'supplierName', t.business_partner_name_snapshot,
      'invoiceNo', t.source_id, 'note', t.note, 'attachments', jsonb_array_length(coalesce(t.attachments, '[]'::jsonb)),
      'code', (select it.code from public.inventory_transactions it where it.source_type = 'wms_transaction' and it.source_id = t.id limit 1),
      'amount', (select round(sum((x->>'quantity')::numeric * (x->>'price')::numeric)) from jsonb_array_elements(t.items) x),
      'lines', (select jsonb_agg(jsonb_build_object('name', i.name, 'sku', i.sku, 'unit', x->>'unit', 'qty', (x->>'quantity')::numeric, 'price', (x->>'price')::numeric))
                from jsonb_array_elements(t.items) x left join public.items i on i.id = x->>'itemId'),
      'byName', (select u.name from public.users u where u.id = t.requester_id)) j
    from public.transactions t
    where t.source_type = 'office_supply_receipt' and t.status::text = 'COMPLETED'
      and (app_private.vpp_is_keeper(t.target_warehouse_id, v_actor) or app_private.vpp_can_report(v_actor))
    order by t.date desc limit least(greatest(coalesce(nullif(p->>'limit', '')::integer, 100), 1), 500)) x), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Thiết lập (quản trị VPP)
-- ---------------------------------------------------------------------------
create or replace function public.get_office_supply_settings_v1()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_actor uuid := public.current_app_user_id(); v_set public.office_supply_settings%rowtype;
begin
  if not app_private.vpp_is_manager(v_actor) then raise exception using errcode = '42501', message = 'VPP_MANAGE_DENIED'; end if;
  select * into v_set from public.office_supply_settings order by warehouse_id limit 1;
  return jsonb_build_object(
    'warehouseId', v_set.warehouse_id, 'thresholdAmount', v_set.threshold_amount, 'rowVersion', v_set.row_version,
    'thresholdApproverId', v_set.threshold_approver_id, 'fallbackApproverId', v_set.fallback_approver_id,
    'departments', coalesce((select jsonb_agg(d.j order by d.members desc, d.name) from (
      select o.name, count(e.id) members, jsonb_build_object('orgUnitId', o.id, 'code', o.code, 'name', o.name, 'members', count(e.id),
        'approverId', a.approver_id, 'deputyId', a.deputy_id,
        -- Gợi ý: người được nhiều thành viên phòng nhận làm quản lý trực tiếp nhất.
        'suggestedId', (select m.mgr from (select app_private.resolve_request_direct_manager(e2.user_id) mgr from public.employees e2
            where e2.org_unit_id = o.id and e2.user_id is not null and coalesce(e2.status, '') <> 'Đã nghỉ việc') m
          where m.mgr is not null group by m.mgr order by count(*) desc limit 1)) j
      from public.org_units o
      left join public.employees e on e.org_unit_id = o.id and e.user_id is not null and coalesce(e.status, '') <> 'Đã nghỉ việc'
      left join public.office_supply_approvers a on a.org_unit_id = o.id
      where coalesce(o.is_active, true) and o.type not in ('company', 'custom')
      group by o.id, o.name, o.code, a.approver_id, a.deputy_id) d), '[]'::jsonb),
    'people', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.name)
      from public.users u where coalesce(u.is_active, true) and coalesce(u.account_status, 'ACTIVE') = 'ACTIVE'), '[]'::jsonb));
end $$;

-- p: { expectedRowVersion, thresholdAmount, thresholdApproverId, fallbackApproverId, approvers: [{ orgUnitId, approverId, deputyId }] }
create or replace function public.save_office_supply_settings_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := public.current_app_user_id(); v_set public.office_supply_settings%rowtype; v_a jsonb; v_amount numeric;
begin
  if not app_private.vpp_is_manager(v_actor) then raise exception using errcode = '42501', message = 'VPP_MANAGE_DENIED'; end if;
  select * into v_set from public.office_supply_settings order by warehouse_id limit 1 for update;
  if not found then raise exception using errcode = '22023', message = 'VPP_WAREHOUSE_MISSING'; end if;
  if nullif(p->>'expectedRowVersion', '') is not null and (p->>'expectedRowVersion')::integer <> v_set.row_version then
    raise exception using errcode = 'PT409', message = 'ROW_VERSION_CONFLICT'; end if;
  begin v_amount := (p->>'thresholdAmount')::numeric;
  exception when others then raise exception using errcode = '22023', message = 'VPP_THRESHOLD_INVALID'; end;
  if v_amount is null or v_amount < 0 then raise exception using errcode = '22023', message = 'VPP_THRESHOLD_INVALID'; end if;

  update public.office_supply_settings
  set threshold_amount = v_amount, threshold_approver_id = nullif(p->>'thresholdApproverId', '')::uuid,
    fallback_approver_id = nullif(p->>'fallbackApproverId', '')::uuid,
    row_version = row_version + 1, updated_by = v_actor, updated_at = now()
  where warehouse_id = v_set.warehouse_id;

  if jsonb_typeof(p->'approvers') = 'array' then
    for v_a in select value from jsonb_array_elements(p->'approvers') loop
      if nullif(v_a->>'approverId', '') is null then
        delete from public.office_supply_approvers where org_unit_id = (v_a->>'orgUnitId')::uuid;
      else
        if nullif(v_a->>'deputyId', '') = v_a->>'approverId' then raise exception using errcode = '22023', message = 'VPP_DEPUTY_SAME'; end if;
        insert into public.office_supply_approvers (org_unit_id, approver_id, deputy_id, updated_by, updated_at)
        values ((v_a->>'orgUnitId')::uuid, (v_a->>'approverId')::uuid, nullif(v_a->>'deputyId', '')::uuid, v_actor, now())
        on conflict (org_unit_id) do update set approver_id = excluded.approver_id, deputy_id = excluded.deputy_id,
          updated_by = excluded.updated_by, updated_at = excluded.updated_at
        where (office_supply_approvers.approver_id, office_supply_approvers.deputy_id) is distinct from (excluded.approver_id, excluded.deputy_id);
      end if;
    end loop;
  end if;

  -- Phiếu đang chờ bước 1 đi theo người duyệt mới.
  update public.office_supply_requests r
  set approver_id = app_private.vpp_resolve_approver(r.requester_id, r.org_unit_id, r.warehouse_id), updated_at = now()
  where r.status = 'pending' and r.approver_id is distinct from app_private.vpp_resolve_approver(r.requester_id, r.org_unit_id, r.warehouse_id);
  update public.office_supply_requests r
  set approver_id = app_private.vpp_active_user(nullif(p->>'thresholdApproverId', '')::uuid), updated_at = now()
  where r.status = 'pending_threshold' and nullif(p->>'thresholdApproverId', '') is not null
    and r.approver_id is distinct from nullif(p->>'thresholdApproverId', '')::uuid;

  insert into public.office_supply_events (request_id, action, actor_id, payload)
  values (null, 'settings', v_actor, p - 'expectedRowVersion');
  return public.get_office_supply_settings_v1();
end $$;

-- ---------------------------------------------------------------------------
-- Quyền gọi
-- ---------------------------------------------------------------------------
revoke all on function app_private.vpp_is_manager(uuid), app_private.vpp_can_report(uuid), app_private.vpp_is_keeper(text, uuid),
  app_private.vpp_org_unit(uuid), app_private.vpp_active_user(uuid), app_private.vpp_resolve_approver(uuid, uuid, text),
  app_private.vpp_approve_role(public.office_supply_requests, uuid), app_private.vpp_can_view(public.office_supply_requests, uuid),
  app_private.vpp_unit_cost(text, text), app_private.vpp_stock(text, text), app_private.vpp_estimate(uuid),
  app_private.vpp_log(uuid, text, text, jsonb, uuid), app_private.vpp_notify(uuid, text, text, public.office_supply_requests),
  app_private.vpp_keepers(text), app_private.vpp_next_code(), app_private.vpp_next_sku(),
  app_private.vpp_sync_item_cache(text[], text), app_private.vpp_status_after_issue(uuid), app_private.vpp_detail(uuid)
  from public, anon, authenticated;

revoke all on function public.get_office_supply_home_v1(), public.list_office_supply_requests_v1(jsonb), public.get_office_supply_request_v1(uuid),
  public.save_office_supply_request_v1(jsonb), public.act_office_supply_request_v1(jsonb), public.issue_office_supply_v1(jsonb),
  public.return_office_supply_v1(jsonb), public.receive_office_supply_v1(jsonb), public.attach_office_supply_receipt_files_v1(text, jsonb),
  public.list_office_supply_receipts_v1(jsonb), public.get_office_supply_settings_v1(), public.save_office_supply_settings_v1(jsonb)
  from public, anon;
grant execute on function public.get_office_supply_home_v1(), public.list_office_supply_requests_v1(jsonb), public.get_office_supply_request_v1(uuid),
  public.save_office_supply_request_v1(jsonb), public.act_office_supply_request_v1(jsonb), public.issue_office_supply_v1(jsonb),
  public.return_office_supply_v1(jsonb), public.receive_office_supply_v1(jsonb), public.attach_office_supply_receipt_files_v1(text, jsonb),
  public.list_office_supply_receipts_v1(jsonb), public.get_office_supply_settings_v1(), public.save_office_supply_settings_v1(jsonb)
  to authenticated;

notify pgrst, 'reload schema';
