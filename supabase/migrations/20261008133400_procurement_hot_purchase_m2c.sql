-- Mua hàng M2c — Mua nóng / CCDC (việc 3, chủ SP duyệt mockup mc-v1 + 6 câu ngày 03/10/2026).
--
-- Luật nghiệp vụ:
-- 1. Ngưỡng duyệt (mặc định 5.000.000 đ, gồm VAT) sửa ở Thiết lập (procurement_settings). Phiếu chốt ngưỡng lúc gửi.
-- 2. Tổng phiếu ≥ ngưỡng, hoặc cộng dồn 7 ngày cùng NCC cùng dự án (phiếu đã gửi, chưa hủy/từ chối) ≥ ngưỡng
--    → gửi Chỉ huy trưởng duyệt TRƯỚC khi mua. Dưới ngưỡng → mua trước (bắt buộc số hóa đơn hoặc ảnh), báo CHT sau.
-- 3. Người duyệt = người có chức danh "Chỉ huy trưởng" trong Tổ chức dự án. Dự án chưa có CHT, hoặc CHT chính là
--    người lập → Admin / quản trị module Dự án duyệt. Người lập không tự duyệt phiếu của mình.
-- 4. Mua thực tế vượt số đã duyệt quá 10% → CHT xác nhận lại rồi mới nhận hàng / ghi chi phí, công nợ.
-- 5. Nhận hàng: dòng Nhập kho tạo phiếu nhập kho và hoàn tất bằng quyền WMS của người nhận (thủ kho kho nhận);
--    dòng CCDC vào sổ CCDC theo người giữ; dòng gắn đề xuất tính là đã nhận (đề xuất tự hoàn tất như việc 1).
-- 6. Nguồn tiền: Quỹ công trường / Nhân viên ứng trước → chờ bộ hoàn ứng cuối tháng (module có sẵn ghi chi phí);
--    Công ty chuyển khoản / NCC cho nợ → kế toán ghi công nợ NCC (chi phí dự án ghi cùng lúc) → Đề nghị chi.
-- 7. Không sửa đè: mọi bước ghi procurement_hub_events (entity 'hot_purchase'); hủy chỉ trước khi mua.

-- ---------------------------------------------------------------------------
-- Thiết lập ngưỡng + cột mới
-- ---------------------------------------------------------------------------
create table if not exists public.procurement_settings (
  id smallint primary key default 1 check (id = 1),
  hot_purchase_threshold numeric(18,2) not null default 5000000 check (hot_purchase_threshold > 0),
  row_version bigint not null default 1,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.procurement_settings (id) values (1) on conflict (id) do nothing;
alter table public.procurement_settings enable row level security;
revoke all on public.procurement_settings from public, anon, authenticated;

alter table public.site_direct_purchases
  add column if not exists hub_flow boolean not null default false,
  add column if not exists requires_approval boolean not null default false,
  add column if not exists approval_threshold numeric(18,2),
  add column if not exists cumulative_amount numeric(18,2),
  add column if not exists submitted_amount numeric(18,2),
  add column if not exists approver_user_id uuid references public.users(id) on delete set null,
  add column if not exists approved_amount numeric(18,2),
  add column if not exists approved_by uuid references public.users(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists return_reason text,
  add column if not exists overrun_status text check (overrun_status in ('pending', 'confirmed')),
  add column if not exists overrun_confirmed_by uuid references public.users(id) on delete set null,
  add column if not exists overrun_confirmed_at timestamptz,
  add column if not exists received_by uuid references public.users(id) on delete set null,
  add column if not exists received_at timestamptz;

alter table public.site_direct_purchase_lines
  add column if not exists material_request_id text references public.requests(id) on delete set null,
  add column if not exists request_line_id text;
create index if not exists idx_site_direct_purchase_lines_request
  on public.site_direct_purchase_lines (material_request_id, request_line_id) where material_request_id is not null;

alter table public.procurement_hub_events drop constraint if exists procurement_hub_events_entity_type_check;
alter table public.procurement_hub_events add constraint procurement_hub_events_entity_type_check
  check (entity_type = any (array['purchase_order', 'need', 'hot_purchase', 'settings']));

-- ---------------------------------------------------------------------------
-- Hàm phụ
-- ---------------------------------------------------------------------------
create or replace function app_private.hot_purchase_site_commander(p_project_id text, p_construction_site_id text)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select u.id from public.project_staff s
  join public.hrm_positions p on p.id::text = s.position_id::text and p.name = 'Chỉ huy trưởng'
  join public.users u on u.id::text = s.user_id::text and u.is_active and u.account_status = 'ACTIVE'
  where s.project_id = p_project_id and (s.end_date is null or s.end_date >= current_date)
    and (s.construction_site_id is null or p_construction_site_id is null or s.construction_site_id = p_construction_site_id)
  order by (s.construction_site_id is not distinct from p_construction_site_id) desc, s.start_date desc nulls last
  limit 1;
$$;

create or replace function app_private.hot_purchase_threshold()
returns numeric
language sql stable security definer set search_path = ''
as $$ select coalesce((select hot_purchase_threshold from public.procurement_settings where id = 1), 5000000); $$;

create or replace function app_private.hot_purchase_total(p_id uuid)
returns numeric
language sql stable security definer set search_path = ''
as $$
  select coalesce(round(sum(l.line_amount + l.vat_amount), 2), 0) from public.site_direct_purchase_lines l
  where l.direct_purchase_id = p_id and l.status <> 'rejected';
$$;

create or replace function app_private.hot_purchase_can_create(p_project_id text, p_construction_site_id text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.current_app_user_id() is not null and (app_private.procurement_can('manage')
    or app_private.material_flow_has_action_or_legacy(p_project_id, p_construction_site_id, 'project.material_direct_purchase.create'));
$$;

-- Người duyệt phiếu: CHT; không có CHT hoặc CHT là người lập → Admin / quản trị module Dự án. Người lập không tự duyệt.
create or replace function app_private.hot_purchase_can_approve(p_purchase public.site_direct_purchases)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare v_actor uuid := public.current_app_user_id();
  v_cmd uuid := app_private.hot_purchase_site_commander(p_purchase.project_id, p_purchase.construction_site_id);
begin
  if v_actor is null or v_actor = p_purchase.created_by then return false; end if;
  if v_cmd is not null and v_cmd is distinct from p_purchase.created_by then return v_actor = v_cmd; end if;
  return public.is_admin() or public.is_module_admin('DA');
end $$;

-- Thủ kho kho nhận (quyền hoàn tất phiếu kho ở kho đó) thấy và nhận được phiếu.
create or replace function app_private.hot_purchase_is_receiver(p_purchase public.site_direct_purchases)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_purchase.target_warehouse_id is not null and public.current_app_user_id() is not null
    and app_private.wms_has_action('wms.transaction.complete', p_purchase.target_warehouse_id, null, null, null, public.current_app_user_id());
$$;

create or replace function app_private.hot_purchase_can_view(p_purchase public.site_direct_purchases)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.current_app_user_id() is not null and (
    app_private.procurement_can('view')
    or app_private.has_permission(public.current_app_user_id(), 'system.finance.record')
    or p_purchase.created_by = public.current_app_user_id()
    or p_purchase.approver_user_id = public.current_app_user_id()
    or app_private.hot_purchase_site_commander(p_purchase.project_id, p_purchase.construction_site_id) = public.current_app_user_id()
    or app_private.material_flow_has_action_or_legacy(p_purchase.project_id, p_purchase.construction_site_id, 'project.material_direct_purchase.view')
    or app_private.material_flow_has_action_or_legacy(p_purchase.project_id, p_purchase.construction_site_id, 'project.material_direct_purchase.create')
    or app_private.hot_purchase_is_receiver(p_purchase));
$$;

create or replace function app_private.hot_purchase_can_edit(p_purchase public.site_direct_purchases)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.current_app_user_id() is not null and (p_purchase.created_by = public.current_app_user_id()
    or app_private.procurement_can('manage')
    or app_private.material_flow_has_action_or_legacy(p_purchase.project_id, p_purchase.construction_site_id, 'project.material_direct_purchase.edit'));
$$;

create or replace function app_private.hot_purchase_log(p_id uuid, p_action text, p_reason text, p_payload jsonb)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('hot_purchase', p_id::text, p_action, public.current_app_user_id(), p_reason, coalesce(p_payload, '{}'::jsonb));
$$;

create or replace function app_private.hot_purchase_notify(p_user uuid, p_title text, p_message text, p_purchase public.site_direct_purchases)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.notifications (user_id, type, category, title, message, body, severity, icon, link, source_type, source_id,
    priority, push_enabled, metadata, delivery_reason)
  select p_user::text, 'info', 'procurement', p_title, p_message, p_message, 'info', '🔥',
    '#/da?projectId=' || coalesce(p_purchase.project_id, '') || coalesce('&siteId=' || p_purchase.construction_site_id, '')
      || '&tab=material&materialTab=hot_purchase&hp=' || p_purchase.id::text,
    'hot_purchase', 'hot_purchase:' || p_purchase.id::text || ':' || md5(p_title), 'normal', true,
    jsonb_build_object('purchaseId', p_purchase.id, 'code', p_purchase.code), 'responsible'
  where p_user is not null and p_user is distinct from public.current_app_user_id();
$$;

revoke all on function app_private.hot_purchase_site_commander(text, text), app_private.hot_purchase_threshold(),
  app_private.hot_purchase_total(uuid), app_private.hot_purchase_can_create(text, text),
  app_private.hot_purchase_can_approve(public.site_direct_purchases), app_private.hot_purchase_can_view(public.site_direct_purchases),
  app_private.hot_purchase_can_edit(public.site_direct_purchases), app_private.hot_purchase_is_receiver(public.site_direct_purchases), app_private.hot_purchase_log(uuid, text, text, jsonb),
  app_private.hot_purchase_notify(uuid, text, text, public.site_direct_purchases) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Thiết lập ngưỡng
-- ---------------------------------------------------------------------------
create or replace function public.get_hot_purchase_settings_v1()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('threshold', s.hot_purchase_threshold, 'rowVersion', s.row_version, 'updatedAt', s.updated_at,
    'updatedByName', (select u.name from public.users u where u.id = s.updated_by),
    'canEdit', public.is_admin() or app_private.procurement_can('manage'))
  from public.procurement_settings s where s.id = 1 and public.current_app_user_id() is not null;
$$;

create or replace function public.save_hot_purchase_settings_v1(p_input jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_old numeric; v_new numeric; v_version bigint;
begin
  if not (public.is_admin() or app_private.procurement_can('manage')) then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  begin v_new := round((p_input->>'threshold')::numeric, 0);
  exception when others then raise exception using errcode = '22023', message = 'HOT_PURCHASE_THRESHOLD_INVALID'; end;
  if v_new is null or v_new <= 0 then raise exception using errcode = '22023', message = 'HOT_PURCHASE_THRESHOLD_INVALID'; end if;
  select hot_purchase_threshold, row_version into v_old, v_version from public.procurement_settings where id = 1 for update;
  if (p_input->>'expectedRowVersion')::bigint is distinct from v_version then
    raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
  update public.procurement_settings set hot_purchase_threshold = v_new, row_version = row_version + 1,
    updated_by = public.current_app_user_id(), updated_at = now() where id = 1;
  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('settings', 'hot_purchase_threshold', 'update', public.current_app_user_id(), null, jsonb_build_object('from', v_old, 'to', v_new));
  return public.get_hot_purchase_settings_v1();
end $$;

-- ---------------------------------------------------------------------------
-- Danh sách + chi tiết
-- ---------------------------------------------------------------------------
create or replace function app_private.hot_purchase_json(p public.site_direct_purchases)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id', p.id, 'code', p.code, 'status', p.status, 'projectId', p.project_id,
    'projectCode', (select pr.code from public.projects pr where pr.id = p.project_id),
    'projectName', (select pr.name from public.projects pr where pr.id = p.project_id),
    'constructionSiteId', p.construction_site_id, 'targetWarehouseId', p.target_warehouse_id,
    'warehouseName', (select w.name from public.warehouses w where w.id = p.target_warehouse_id),
    'supplierId', p.supplier_id, 'supplierName', p.supplier_name_snapshot, 'paymentSource', p.payment_source,
    'purchaseDate', p.purchase_date, 'invoiceNumber', p.invoice_number, 'invoiceDate', p.invoice_date, 'attachments', coalesce(p.attachments, '[]'::jsonb),
    'note', p.note, 'totalAmount', p.total_amount, 'requiresApproval', p.requires_approval, 'approvalThreshold', p.approval_threshold,
    'cumulativeAmount', p.cumulative_amount, 'submittedAmount', p.submitted_amount,
    'approverName', (select u.name from public.users u where u.id = coalesce(p.approved_by, p.approver_user_id)),
    'approvedAmount', p.approved_amount, 'approvedAt', p.approved_at, 'returnReason', p.return_reason,
    'overrunStatus', p.overrun_status, 'receivedAt', p.received_at, 'receivedByName', (select u.name from public.users u where u.id = p.received_by),
    'wmsTransactionId', p.wms_transaction_id, 'createdAt', p.created_at, 'createdById', p.created_by,
    'createdByName', (select u.name from public.users u where u.id = p.created_by),
    'lineCount', (select count(*) from public.site_direct_purchase_lines l where l.direct_purchase_id = p.id),
    'lineSummary', (select string_agg(l.item_name_snapshot, ', ' order by l.line_no) from public.site_direct_purchase_lines l where l.direct_purchase_id = p.id),
    'payable', (select jsonb_build_object('id', d.id, 'code', d.code, 'status', d.status, 'amount', d.recognized_amount)
      from public.supplier_payable_documents d where d.source_type = 'site_direct_purchase' and d.source_id = p.id::text),
    -- Chờ CHT: duyệt mua, hoặc xác nhận lại phần vượt quá 10%.
    'canApprove', coalesce((p.status = 'submitted' or (p.status = 'purchased' and p.overrun_status = 'pending')) and app_private.hot_purchase_can_approve(p), false));
$$;
revoke all on function app_private.hot_purchase_json(public.site_direct_purchases) from public, anon, authenticated;

create or replace function public.list_hot_purchases_v1(p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_filter jsonb := coalesce(p_filter, '{}'::jsonb);
begin
  if public.current_app_user_id() is null then raise exception using errcode = '42501', message = 'HOT_PURCHASE_DENIED'; end if;
  return (with rows as materialized (
      select p.* from public.site_direct_purchases p
      where p.hub_flow
        and (nullif(v_filter->>'projectId', '') is null or p.project_id = v_filter->>'projectId')
        and (nullif(v_filter->>'constructionSiteId', '') is null or p.construction_site_id = v_filter->>'constructionSiteId')
        and app_private.hot_purchase_can_view(p))
    select jsonb_build_object(
      'threshold', app_private.hot_purchase_threshold(),
      'canCreate', case when nullif(v_filter->>'projectId', '') is null then app_private.procurement_can('manage')
        else app_private.hot_purchase_can_create(v_filter->>'projectId', nullif(v_filter->>'constructionSiteId', '')) end,
      'purchases', coalesce((select jsonb_agg(app_private.hot_purchase_json(r) order by r.created_at desc) from rows r), '[]'::jsonb),
      -- Dự án + kho để lập phiếu: ở dự án chỉ dự án đó; ở Mua hàng mọi dự án có kho công trường.
      'projects', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'code', pr.code, 'name', pr.name,
          'warehouses', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'constructionSiteId', w.construction_site_id) order by w.name)
            from public.warehouses w where w.project_id = pr.id and not coalesce(w.is_archived, false)), '[]'::jsonb)) order by pr.code)
        from public.projects pr
        where (nullif(v_filter->>'projectId', '') is not null and pr.id = v_filter->>'projectId')
          or (nullif(v_filter->>'projectId', '') is null and app_private.procurement_can('manage')
            and exists (select 1 from public.warehouses w where w.project_id = pr.id and not coalesce(w.is_archived, false)))), '[]'::jsonb)));
end $$;

-- Tìm NCC cho người lập phiếu mua nóng (người ở công trường không cần quyền Mua hàng).
create or replace function public.search_hot_purchase_vendors_v1(p_project_id text, p_search text default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not (app_private.procurement_can('view') or app_private.hot_purchase_can_create(p_project_id, null)) then
    raise exception using errcode = '42501', message = 'HOT_PURCHASE_DENIED'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'taxCode', b.tax_code) order by b.n desc, b.name)
    from (select b.id, b.name, b.tax_code, (select count(*) from public.purchase_orders o where o.vendor_id = b.id)
        + (select count(*) from public.site_direct_purchases d where d.supplier_id = b.id) n
      from public.business_partners b
      where b.is_active and 'supplier' = any(b.classifications)
        and (nullif(btrim(p_search), '') is null or lower(concat_ws(' ', b.name, b.tax_code, b.code)) like '%' || lower(btrim(p_search)) || '%')
      order by n desc, b.name limit 30) b), '[]'::jsonb);
end $$;

create or replace function public.get_hot_purchase_v1(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare p public.site_direct_purchases%rowtype; v_edit boolean;
begin
  select * into p from public.site_direct_purchases where id = p_id and hub_flow;
  if not found or not app_private.hot_purchase_can_view(p) then
    raise exception using errcode = '42501', message = 'HOT_PURCHASE_NOT_FOUND'; end if;
  v_edit := app_private.hot_purchase_can_edit(p);
  return app_private.hot_purchase_json(p) || jsonb_build_object(
    'commanderName', (select u.name from public.users u where u.id = app_private.hot_purchase_site_commander(p.project_id, p.construction_site_id)),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'lineNo', l.line_no, 'lineType', l.line_type, 'itemId', l.item_id,
        'sku', l.sku_snapshot, 'name', l.item_name_snapshot, 'unit', l.unit_snapshot, 'qty', l.quantity, 'unitPrice', l.unit_price,
        'vatRate', l.vat_rate, 'amount', l.line_amount + l.vat_amount, 'holderType', l.small_tool_holder_type, 'holderName', l.small_tool_holder_name_snapshot,
        'materialRequestId', l.material_request_id, 'requestLineId', l.request_line_id,
        'requestCode', (select r.code from public.requests r where r.id = l.material_request_id), 'note', l.note) order by l.line_no)
      from public.site_direct_purchase_lines l where l.direct_purchase_id = p.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'reason', e.reason, 'at', e.created_at, 'payload', e.payload,
        'actorName', (select u.name from public.users u where u.id = e.actor_id)) order by e.created_at)
      from public.procurement_hub_events e where e.entity_type = 'hot_purchase' and e.entity_id = p.id::text), '[]'::jsonb),
    'permissions', jsonb_build_object(
      'canEdit', p.status = 'draft' and v_edit,
      -- Chỉ người lập hủy được (CHT trả lại chứ không hủy).
      'canCancel', p.status in ('draft', 'submitted', 'approved_to_buy') and p.created_by = public.current_app_user_id(),
      'canDecide', p.status = 'submitted' and app_private.hot_purchase_can_approve(p),
      'canMarkPurchased', p.status = 'approved_to_buy' and v_edit,
      'canConfirmOverrun', p.status = 'purchased' and p.overrun_status = 'pending' and app_private.hot_purchase_can_approve(p),
      'canReceive', p.status = 'purchased' and coalesce(p.overrun_status, 'confirmed') = 'confirmed'
        and (v_edit or app_private.hot_purchase_is_receiver(p)),
      'canPostPayable', p.status = 'finance_review' and p.payment_source in ('company_bank', 'supplier_credit')
        and app_private.has_permission(public.current_app_user_id(), 'system.finance.record')));
end $$;

-- ---------------------------------------------------------------------------
-- Lưu nháp (tạo / sửa), gửi
-- ---------------------------------------------------------------------------
create or replace function public.save_hot_purchase_v1(p_input jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := public.current_app_user_id(); p public.site_direct_purchases%rowtype; v_id uuid := nullif(p_input->>'id', '')::uuid;
  v_project text := nullif(p_input->>'projectId', ''); v_site text := nullif(p_input->>'constructionSiteId', '');
  v_wh text := nullif(p_input->>'targetWarehouseId', ''); v_pay text := coalesce(nullif(p_input->>'paymentSource', ''), 'site_cash');
  v_line jsonb; v_no integer := 0; v_item public.items%rowtype; v_req public.requests%rowtype; v_code text; v_type text; v_qty numeric; v_price numeric; v_vat numeric;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'HOT_PURCHASE_DENIED'; end if;
  if v_id is not null then
    select * into p from public.site_direct_purchases where id = v_id and hub_flow for update;
    if not found then raise exception using errcode = '22023', message = 'HOT_PURCHASE_NOT_FOUND'; end if;
    if p.status <> 'draft' then raise exception using errcode = '22023', message = 'HOT_PURCHASE_STATE'; end if;
    if not app_private.hot_purchase_can_edit(p) then raise exception using errcode = '42501', message = 'HOT_PURCHASE_DENIED'; end if;
    v_project := p.project_id; v_site := p.construction_site_id;
  else
    if v_project is null then raise exception using errcode = '22023', message = 'HOT_PURCHASE_PROJECT_REQUIRED'; end if;
    if not app_private.hot_purchase_can_create(v_project, v_site) then raise exception using errcode = '42501', message = 'HOT_PURCHASE_DENIED'; end if;
  end if;
  if v_pay not in ('site_cash', 'staff_paid', 'company_bank', 'supplier_credit') then
    raise exception using errcode = '22023', message = 'HOT_PURCHASE_PAYMENT_INVALID'; end if;
  if nullif(btrim(coalesce(p_input->>'supplierName', '')), '') is null then
    raise exception using errcode = '22023', message = 'HOT_PURCHASE_SUPPLIER_REQUIRED'; end if;
  if v_pay in ('company_bank', 'supplier_credit') and nullif(p_input->>'supplierId', '') is null then
    raise exception using errcode = '22023', message = 'HOT_PURCHASE_SUPPLIER_PARTNER_REQUIRED'; end if;
  if v_wh is not null and not exists (select 1 from public.warehouses w where w.id = v_wh and not coalesce(w.is_archived, false)) then
    raise exception using errcode = '22023', message = 'HOT_PURCHASE_WAREHOUSE_INVALID'; end if;
  if jsonb_typeof(p_input->'lines') is distinct from 'array' or jsonb_array_length(p_input->'lines') = 0 then
    raise exception using errcode = '22023', message = 'HOT_PURCHASE_LINES_REQUIRED'; end if;

  perform set_config('app.hot_purchase_command', 'on', true);
  if v_id is null then
    perform pg_advisory_xact_lock(hashtext('hot_purchase_code'));
    v_code := 'MN-' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYMM') || '-' || lpad((coalesce((select max(nullif(regexp_replace(code, '^MN-\d{4}-', ''), code)::int)
      from public.site_direct_purchases where code ~ ('^MN-' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYMM') || '-\d+$')), 0) + 1)::text, 3, '0');
    insert into public.site_direct_purchases (id, code, project_id, construction_site_id, supplier_id, supplier_name_snapshot, purchase_mode,
      payment_source, target_warehouse_id, status, purchase_date, invoice_number, invoice_date, attachments, note, created_by, hub_flow)
    values (gen_random_uuid(), v_code, v_project, v_site, nullif(p_input->>'supplierId', ''), btrim(p_input->>'supplierName'), 'immediate',
      v_pay, v_wh, 'draft', coalesce(nullif(p_input->>'purchaseDate', '')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date),
      nullif(btrim(coalesce(p_input->>'invoiceNumber', '')), ''), nullif(p_input->>'invoiceDate', '')::date,
      coalesce(p_input->'attachments', '[]'::jsonb), nullif(btrim(coalesce(p_input->>'note', '')), ''), v_actor, true)
    returning * into p;
  else
    update public.site_direct_purchases set supplier_id = nullif(p_input->>'supplierId', ''), supplier_name_snapshot = btrim(p_input->>'supplierName'),
      payment_source = v_pay, target_warehouse_id = v_wh,
      purchase_date = coalesce(nullif(p_input->>'purchaseDate', '')::date, purchase_date),
      invoice_number = nullif(btrim(coalesce(p_input->>'invoiceNumber', '')), ''), invoice_date = nullif(p_input->>'invoiceDate', '')::date,
      attachments = coalesce(p_input->'attachments', '[]'::jsonb), note = nullif(btrim(coalesce(p_input->>'note', '')), ''),
      last_action_by = v_actor::text, last_action_at = now()
    where id = p.id returning * into p;
    delete from public.site_direct_purchase_lines where direct_purchase_id = p.id;
  end if;

  for v_line in select value from jsonb_array_elements(p_input->'lines') loop
    v_no := v_no + 1;
    v_type := coalesce(nullif(v_line->>'lineType', ''), 'expense_only');
    if v_type not in ('stock_item', 'expense_only', 'small_tool') then raise exception using errcode = '22023', message = 'HOT_PURCHASE_LINE_INVALID'; end if;
    begin v_qty := (v_line->>'qty')::numeric; v_price := coalesce(nullif(v_line->>'unitPrice', '')::numeric, 0); v_vat := coalesce(nullif(v_line->>'vatRate', '')::numeric, 0);
    exception when others then raise exception using errcode = '22023', message = 'HOT_PURCHASE_LINE_INVALID'; end;
    if v_qty is null or v_qty <= 0 or v_price < 0 or v_vat < 0 or v_vat > 100 then raise exception using errcode = '22023', message = 'HOT_PURCHASE_LINE_INVALID'; end if;
    v_item := null;
    if nullif(v_line->>'itemId', '') is not null then
      select * into v_item from public.items where id = v_line->>'itemId';
      if not found then raise exception using errcode = '22023', message = 'HOT_PURCHASE_ITEM_NOT_FOUND'; end if;
    end if;
    if v_type = 'stock_item' and (v_item.id is null or v_wh is null) then
      raise exception using errcode = '22023', message = 'HOT_PURCHASE_STOCK_LINE_INVALID'; end if;
    if v_type = 'small_tool' and nullif(btrim(coalesce(v_line->>'holderName', '')), '') is null then
      raise exception using errcode = '22023', message = 'HOT_PURCHASE_TOOL_HOLDER_REQUIRED'; end if;
    if coalesce(v_item.name, nullif(btrim(coalesce(v_line->>'name', '')), '')) is null then
      raise exception using errcode = '22023', message = 'HOT_PURCHASE_LINE_INVALID'; end if;
    if nullif(v_line->>'materialRequestId', '') is not null then
      select * into v_req from public.requests where id = v_line->>'materialRequestId' and request_origin = 'project';
      if not found or v_req.project_id is distinct from v_project or v_req.status not in ('APPROVED', 'IN_TRANSIT')
        or not exists (select 1 from jsonb_array_elements(v_req.items) x where x.value->>'lineId' = v_line->>'requestLineId'
          and x.value->>'itemId' is not distinct from v_item.id) then
        raise exception using errcode = '22023', message = 'HOT_PURCHASE_REQUEST_LINE_INVALID'; end if;
    end if;
    insert into public.site_direct_purchase_lines (direct_purchase_id, line_no, line_type, item_id, sku_snapshot, item_name_snapshot, unit_snapshot,
      quantity, unit_price, vat_rate, status, small_tool_holder_type, small_tool_holder_name_snapshot, material_request_id, request_line_id, note)
    values (p.id, v_no, v_type, v_item.id, v_item.sku, coalesce(v_item.name, btrim(v_line->>'name')),
      coalesce(nullif(btrim(coalesce(v_line->>'unit', '')), ''), v_item.unit), v_qty, v_price, v_vat, 'pending',
      case when v_type = 'small_tool' then coalesce(nullif(v_line->>'holderType', ''), 'manual') end,
      case when v_type = 'small_tool' then btrim(v_line->>'holderName') end,
      nullif(v_line->>'materialRequestId', ''), nullif(v_line->>'requestLineId', ''), nullif(btrim(coalesce(v_line->>'note', '')), ''));
  end loop;
  perform app_private.hot_purchase_log(p.id, case when v_id is null then 'create' else 'update' end, null,
    jsonb_build_object('total', app_private.hot_purchase_total(p.id), 'lines', v_no));
  return jsonb_build_object('id', p.id, 'code', p.code, 'total', app_private.hot_purchase_total(p.id));
end $$;

create or replace function public.submit_hot_purchase_v1(p_input jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare p public.site_direct_purchases%rowtype; v_total numeric; v_thr numeric := app_private.hot_purchase_threshold(); v_cum numeric;
  v_needs boolean; v_cmd uuid;
begin
  select * into p from public.site_direct_purchases where id = (p_input->>'id')::uuid and hub_flow for update;
  if not found then raise exception using errcode = '22023', message = 'HOT_PURCHASE_NOT_FOUND'; end if;
  if p.status <> 'draft' then raise exception using errcode = '22023', message = 'HOT_PURCHASE_STATE'; end if;
  if not app_private.hot_purchase_can_edit(p) then raise exception using errcode = '42501', message = 'HOT_PURCHASE_DENIED'; end if;
  v_total := app_private.hot_purchase_total(p.id);
  if v_total <= 0 then raise exception using errcode = '22023', message = 'HOT_PURCHASE_AMOUNT_REQUIRED'; end if;
  -- Cộng dồn 7 ngày cùng NCC, cùng dự án (phiếu đã gửi, chưa hủy / từ chối) để không chia nhỏ phiếu né ngưỡng.
  select coalesce(sum(o.total_amount), 0) into v_cum from public.site_direct_purchases o
  where o.id <> p.id and o.hub_flow and o.project_id = p.project_id and o.status not in ('draft', 'rejected', 'cancelled')
    and (o.supplier_id = p.supplier_id or (p.supplier_id is null and lower(btrim(o.supplier_name_snapshot)) = lower(btrim(p.supplier_name_snapshot))))
    and coalesce(o.purchase_date, o.created_at::date) >= coalesce(p.purchase_date, current_date) - 6;
  v_needs := v_total >= v_thr or v_total + v_cum >= v_thr;
  v_cmd := app_private.hot_purchase_site_commander(p.project_id, p.construction_site_id);
  if not v_needs and nullif(btrim(coalesce(p.invoice_number, '')), '') is null and jsonb_array_length(coalesce(p.attachments, '[]'::jsonb)) = 0 then
    raise exception using errcode = '22023', message = 'HOT_PURCHASE_EVIDENCE_REQUIRED'; end if;
  perform set_config('app.hot_purchase_command', 'on', true);
  if not v_needs then
    update public.site_direct_purchase_lines set status = 'accepted', accepted_quantity = quantity, accepted_amount = line_amount + vat_amount
    where direct_purchase_id = p.id;
  end if;
  update public.site_direct_purchases set status = case when v_needs then 'submitted' else 'purchased' end,
    requires_approval = v_needs, approval_threshold = v_thr, cumulative_amount = v_cum, submitted_amount = v_total,
    approver_user_id = case when v_cmd is distinct from p.created_by then v_cmd end, return_reason = null, ever_submitted = true,
    last_action_by = public.current_app_user_id()::text, last_action_at = now()
  where id = p.id returning * into p;
  perform app_private.hot_purchase_log(p.id, case when v_needs then 'submit' else 'purchase_report' end, null,
    jsonb_build_object('total', v_total, 'threshold', v_thr, 'cumulative', v_cum));
  perform app_private.hot_purchase_notify(v_cmd,
    case when v_needs then 'Mua nóng chờ anh duyệt: ' || p.code else 'Mua nóng dưới ngưỡng đã mua: ' || p.code end,
    p.supplier_name_snapshot || ' · ' || to_char(v_total, 'FM999G999G999G999') || ' đ' ||
      case when v_needs then ' — cần duyệt trước khi mua.' else ' — báo để anh biết, không cần duyệt.' end, p);
  return jsonb_build_object('id', p.id, 'status', p.status, 'requiresApproval', v_needs, 'total', v_total, 'cumulative', v_cum, 'threshold', v_thr);
end $$;

-- ---------------------------------------------------------------------------
-- CHT duyệt / trả lại; ghi đã mua; xác nhận vượt; nhận hàng; ghi công nợ; hủy
-- ---------------------------------------------------------------------------
create or replace function public.decide_hot_purchase_v1(p_input jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare p public.site_direct_purchases%rowtype; v_action text := p_input->>'action'; v_reason text := nullif(btrim(coalesce(p_input->>'reason', '')), '');
begin
  select * into p from public.site_direct_purchases where id = (p_input->>'id')::uuid and hub_flow for update;
  if not found then raise exception using errcode = '22023', message = 'HOT_PURCHASE_NOT_FOUND'; end if;
  if p.status <> 'submitted' then raise exception using errcode = '22023', message = 'HOT_PURCHASE_STATE'; end if;
  if not app_private.hot_purchase_can_approve(p) then raise exception using errcode = '42501', message = 'HOT_PURCHASE_APPROVE_DENIED'; end if;
  if v_action not in ('approve', 'return') then raise exception using errcode = '22023', message = 'HOT_PURCHASE_ACTION_INVALID'; end if;
  if v_action = 'return' and v_reason is null then raise exception using errcode = '22023', message = 'HOT_PURCHASE_REASON_REQUIRED'; end if;
  perform set_config('app.hot_purchase_command', 'on', true);
  if v_action = 'approve' then
    update public.site_direct_purchases set status = 'approved_to_buy', approved_amount = app_private.hot_purchase_total(p.id),
      approved_by = public.current_app_user_id(), approved_at = now(), last_action_by = public.current_app_user_id()::text, last_action_at = now()
    where id = p.id returning * into p;
  else
    update public.site_direct_purchases set status = 'draft', return_reason = v_reason, last_action_by = public.current_app_user_id()::text, last_action_at = now()
    where id = p.id returning * into p;
  end if;
  perform app_private.hot_purchase_log(p.id, v_action, v_reason, jsonb_build_object('approvedAmount', p.approved_amount));
  perform app_private.hot_purchase_notify(p.created_by,
    case when v_action = 'approve' then 'Đã duyệt mua nóng ' || p.code else 'Mua nóng ' || p.code || ' bị trả lại' end,
    case when v_action = 'approve' then 'Được mua tối đa ' || to_char(p.approved_amount, 'FM999G999G999G999') || ' đ (vượt quá 10% phải xác nhận lại).'
      else 'Lý do: ' || v_reason end, p);
  return jsonb_build_object('id', p.id, 'status', p.status);
end $$;

create or replace function public.mark_hot_purchase_purchased_v1(p_input jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare p public.site_direct_purchases%rowtype; v_line jsonb; v_total numeric; v_over boolean;
begin
  select * into p from public.site_direct_purchases where id = (p_input->>'id')::uuid and hub_flow for update;
  if not found then raise exception using errcode = '22023', message = 'HOT_PURCHASE_NOT_FOUND'; end if;
  if p.status <> 'approved_to_buy' then raise exception using errcode = '22023', message = 'HOT_PURCHASE_STATE'; end if;
  if not app_private.hot_purchase_can_edit(p) then raise exception using errcode = '42501', message = 'HOT_PURCHASE_DENIED'; end if;
  if nullif(btrim(coalesce(p_input->>'invoiceNumber', '')), '') is null and jsonb_array_length(coalesce(p_input->'attachments', '[]'::jsonb)) = 0 then
    raise exception using errcode = '22023', message = 'HOT_PURCHASE_EVIDENCE_REQUIRED'; end if;
  perform set_config('app.hot_purchase_command', 'on', true);
  for v_line in select value from jsonb_array_elements(coalesce(p_input->'lines', '[]'::jsonb)) loop
    if coalesce(nullif(v_line->>'qty', '')::numeric, 0) <= 0 or coalesce(nullif(v_line->>'unitPrice', '')::numeric, -1) < 0 then
      raise exception using errcode = '22023', message = 'HOT_PURCHASE_LINE_INVALID'; end if;
    update public.site_direct_purchase_lines set quantity = (v_line->>'qty')::numeric, unit_price = (v_line->>'unitPrice')::numeric,
      vat_rate = coalesce(nullif(v_line->>'vatRate', '')::numeric, vat_rate)
    where id = (v_line->>'id')::uuid and direct_purchase_id = p.id;
    if not found then raise exception using errcode = '22023', message = 'HOT_PURCHASE_LINE_INVALID'; end if;
  end loop;
  update public.site_direct_purchase_lines set status = 'accepted', accepted_quantity = quantity, accepted_amount = line_amount + vat_amount
  where direct_purchase_id = p.id;
  v_total := app_private.hot_purchase_total(p.id);
  v_over := v_total > coalesce(p.approved_amount, 0) * 1.1;
  update public.site_direct_purchases set status = 'purchased', invoice_number = nullif(btrim(coalesce(p_input->>'invoiceNumber', '')), ''),
    invoice_date = nullif(p_input->>'invoiceDate', '')::date, attachments = coalesce(p_input->'attachments', attachments),
    purchase_date = coalesce(nullif(p_input->>'purchaseDate', '')::date, purchase_date),
    overrun_status = case when v_over then 'pending' end, last_action_by = public.current_app_user_id()::text, last_action_at = now()
  where id = p.id returning * into p;
  perform app_private.hot_purchase_log(p.id, 'purchased', null, jsonb_build_object('total', v_total, 'approvedAmount', p.approved_amount, 'overrun', v_over));
  if v_over then
    perform app_private.hot_purchase_notify(coalesce(p.approved_by, p.approver_user_id), 'Mua nóng ' || p.code || ' vượt số đã duyệt',
      'Thực tế ' || to_char(v_total, 'FM999G999G999G999') || ' đ, đã duyệt ' || to_char(p.approved_amount, 'FM999G999G999G999') || ' đ — cần anh xác nhận lại.', p);
  end if;
  return jsonb_build_object('id', p.id, 'status', p.status, 'total', v_total, 'overrun', v_over);
end $$;

create or replace function public.confirm_hot_purchase_overrun_v1(p_input jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare p public.site_direct_purchases%rowtype;
begin
  select * into p from public.site_direct_purchases where id = (p_input->>'id')::uuid and hub_flow for update;
  if not found then raise exception using errcode = '22023', message = 'HOT_PURCHASE_NOT_FOUND'; end if;
  if p.status <> 'purchased' or p.overrun_status is distinct from 'pending' then raise exception using errcode = '22023', message = 'HOT_PURCHASE_STATE'; end if;
  if not app_private.hot_purchase_can_approve(p) then raise exception using errcode = '42501', message = 'HOT_PURCHASE_APPROVE_DENIED'; end if;
  perform set_config('app.hot_purchase_command', 'on', true);
  update public.site_direct_purchases set overrun_status = 'confirmed', overrun_confirmed_by = public.current_app_user_id(), overrun_confirmed_at = now()
  where id = p.id returning * into p;
  perform app_private.hot_purchase_log(p.id, 'overrun_confirmed', nullif(btrim(coalesce(p_input->>'note', '')), ''),
    jsonb_build_object('total', app_private.hot_purchase_total(p.id), 'approvedAmount', p.approved_amount));
  perform app_private.hot_purchase_notify(p.created_by, 'Đã xác nhận phần vượt ' || p.code, 'Nhận hàng và ghi chứng từ như bình thường.', p);
  return jsonb_build_object('id', p.id, 'overrunStatus', p.overrun_status);
end $$;

create or replace function public.receive_hot_purchase_v1(p_input jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare p public.site_direct_purchases%rowtype; v_actor uuid := public.current_app_user_id(); v_tx text; v_items jsonb; v_req text;
begin
  select * into p from public.site_direct_purchases where id = (p_input->>'id')::uuid and hub_flow for update;
  if not found then raise exception using errcode = '22023', message = 'HOT_PURCHASE_NOT_FOUND'; end if;
  if p.status <> 'purchased' then raise exception using errcode = '22023', message = 'HOT_PURCHASE_STATE'; end if;
  if p.overrun_status = 'pending' then raise exception using errcode = '22023', message = 'HOT_PURCHASE_OVERRUN_PENDING'; end if;
  if not (app_private.hot_purchase_can_edit(p) or app_private.hot_purchase_is_receiver(p)) then
    raise exception using errcode = '42501', message = 'HOT_PURCHASE_DENIED'; end if;
  perform set_config('app.hot_purchase_command', 'on', true);
  select jsonb_agg(jsonb_build_object('itemId', l.item_id, 'quantity', l.accepted_quantity, 'price', l.unit_price, 'unit', l.unit_snapshot,
      'vatRate', l.vat_rate, 'directPurchaseLineId', l.id, 'materialRequestId', l.material_request_id, 'requestLineId', l.request_line_id) order by l.line_no)
    into v_items
  from public.site_direct_purchase_lines l where l.direct_purchase_id = p.id and l.line_type = 'stock_item' and l.status = 'accepted';
  if v_items is not null then
    -- Dòng nhập kho: phiếu nhập kho do người nhận hoàn tất bằng quyền WMS của họ (thủ kho kho nhận).
    v_tx := 'tx-hp-' || (extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(md5(p.id::text), 1, 5);
    insert into public.transactions (id, type, date, items, target_warehouse_id, requester_id, status, note, source_type, source_id,
      business_partner_id, business_partner_name_snapshot, business_event_type)
    values (v_tx, 'IMPORT'::public.transaction_type, now(), v_items, p.target_warehouse_id, v_actor, 'PENDING'::public.transaction_status,
      'Mua nóng ' || p.code || ' — ' || p.supplier_name_snapshot, 'site_direct_purchase', p.id::text, p.supplier_id, p.supplier_name_snapshot,
      'site_hot_purchase_receipt');
    begin
      perform public.process_transaction_status(v_tx, 'COMPLETED'::public.transaction_status, v_actor);
    exception when insufficient_privilege then
      raise exception using errcode = '42501', message = 'HOT_PURCHASE_RECEIVE_KEEPER_REQUIRED';
    end;
    update public.site_direct_purchases set wms_transaction_id = v_tx where id = p.id;
  end if;
  -- Dòng CCDC: sổ CCDC theo người giữ.
  insert into public.site_small_tool_records (code, project_id, construction_site_id, source_type, source_id, source_line_id, source_code,
    supplier_id, supplier_name_snapshot, item_name_snapshot, unit_snapshot, quantity, unit_cost, total_amount, purchase_date,
    holder_type, holder_name_snapshot, status, attachments, qr_token, created_by, note)
  select 'CCDC-' || p.code || '-' || lpad(l.line_no::text, 2, '0'), p.project_id, p.construction_site_id, 'site_direct_purchase', p.id::text, l.id, p.code,
    p.supplier_id, p.supplier_name_snapshot, l.item_name_snapshot, l.unit_snapshot, l.accepted_quantity,
    round(l.accepted_amount / nullif(l.accepted_quantity, 0), 2), l.accepted_amount, coalesce(p.purchase_date, current_date),
    coalesce(l.small_tool_holder_type, 'manual'), coalesce(l.small_tool_holder_name_snapshot, 'Công trường'), 'in_use',
    coalesce(p.attachments, '[]'::jsonb), 'qr_ccdc_' || replace(l.id::text, '-', ''), p.created_by, l.note
  from public.site_direct_purchase_lines l where l.direct_purchase_id = p.id and l.line_type = 'small_tool' and l.status = 'accepted'
  on conflict (source_type, source_line_id) do nothing;
  update public.site_direct_purchases set status = 'finance_review', received_by = v_actor, received_at = now(),
    last_action_by = v_actor::text, last_action_at = now()
  where id = p.id returning * into p;
  for v_req in select distinct l.material_request_id from public.site_direct_purchase_lines l
    where l.direct_purchase_id = p.id and l.material_request_id is not null loop
    perform app_private.refresh_material_request_supply_v1(v_req);
  end loop;
  perform app_private.hot_purchase_log(p.id, 'received', null, jsonb_build_object('wmsTransactionId', v_tx));
  return jsonb_build_object('id', p.id, 'status', p.status, 'wmsTransactionId', v_tx);
end $$;

create or replace function public.post_hot_purchase_payable_v1(p_input jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare p public.site_direct_purchases%rowtype; v_amount numeric; v_doc public.supplier_payable_documents%rowtype;
begin
  if not app_private.has_permission(public.current_app_user_id(), 'system.finance.record') then
    raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  select * into p from public.site_direct_purchases where id = (p_input->>'id')::uuid and hub_flow for update;
  if not found then raise exception using errcode = '22023', message = 'HOT_PURCHASE_NOT_FOUND'; end if;
  if p.status <> 'finance_review' or p.payment_source not in ('company_bank', 'supplier_credit') then
    raise exception using errcode = '22023', message = 'HOT_PURCHASE_STATE'; end if;
  if p.supplier_id is null then raise exception using errcode = '22023', message = 'HOT_PURCHASE_SUPPLIER_PARTNER_REQUIRED'; end if;
  v_amount := coalesce((select sum(l.accepted_amount) from public.site_direct_purchase_lines l where l.direct_purchase_id = p.id and l.status = 'accepted'), 0);
  if v_amount <= 0 then raise exception using errcode = '22023', message = 'HOT_PURCHASE_AMOUNT_REQUIRED'; end if;
  perform set_config('app.hot_purchase_command', 'on', true);
  perform set_config('app.direct_purchase_recording', 'on', true);
  insert into public.supplier_payable_documents (code, source_type, source_id, project_id, construction_site_id, supplier_id, supplier_name_snapshot,
    document_no, document_date, committed_amount, recognized_amount, credit_amount, status, qr_token, invoice_number, invoice_date, metadata, created_by)
  values ('AP-' || p.code, 'site_direct_purchase', p.id::text, p.project_id, p.construction_site_id, p.supplier_id, p.supplier_name_snapshot,
    p.code, coalesce(p.purchase_date, current_date), p.total_amount, v_amount, 0, 'open', 'ap_direct_' || replace(p.id::text, '-', ''),
    p.invoice_number, p.invoice_date, jsonb_build_object('paymentSource', p.payment_source, 'wmsTransactionId', p.wms_transaction_id,
      'hotPurchase', true, 'postedById', public.current_app_user_id(), 'postedAt', now()), public.current_app_user_id())
  returning * into v_doc;
  update public.site_direct_purchases set status = 'reconciled', last_action_by = public.current_app_user_id()::text, last_action_at = now()
  where id = p.id returning * into p;
  perform app_private.hot_purchase_log(p.id, 'payable_posted', null, jsonb_build_object('payableId', v_doc.id, 'amount', v_amount));
  return jsonb_build_object('id', p.id, 'status', p.status, 'payableId', v_doc.id, 'payableCode', v_doc.code, 'amount', v_amount);
end $$;

create or replace function public.cancel_hot_purchase_v1(p_input jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare p public.site_direct_purchases%rowtype; v_reason text := nullif(btrim(coalesce(p_input->>'reason', '')), '');
begin
  select * into p from public.site_direct_purchases where id = (p_input->>'id')::uuid and hub_flow for update;
  if not found then raise exception using errcode = '22023', message = 'HOT_PURCHASE_NOT_FOUND'; end if;
  if p.status not in ('draft', 'submitted', 'approved_to_buy') then raise exception using errcode = '22023', message = 'HOT_PURCHASE_STATE'; end if;
  if p.created_by is distinct from public.current_app_user_id() then raise exception using errcode = '42501', message = 'HOT_PURCHASE_CANCEL_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'HOT_PURCHASE_REASON_REQUIRED'; end if;
  perform set_config('app.hot_purchase_command', 'on', true);
  update public.site_direct_purchases set status = 'cancelled', last_action_by = public.current_app_user_id()::text, last_action_at = now()
  where id = p.id returning * into p;
  perform app_private.hot_purchase_log(p.id, 'cancel', v_reason, '{}'::jsonb);
  return jsonb_build_object('id', p.id, 'status', p.status);
end $$;

revoke all on function public.search_hot_purchase_vendors_v1(text, text) from public, anon;
grant execute on function public.search_hot_purchase_vendors_v1(text, text) to authenticated;
revoke all on function public.get_hot_purchase_settings_v1(), public.save_hot_purchase_settings_v1(jsonb), public.list_hot_purchases_v1(jsonb),
  public.get_hot_purchase_v1(uuid), public.save_hot_purchase_v1(jsonb), public.submit_hot_purchase_v1(jsonb), public.decide_hot_purchase_v1(jsonb),
  public.mark_hot_purchase_purchased_v1(jsonb), public.confirm_hot_purchase_overrun_v1(jsonb), public.receive_hot_purchase_v1(jsonb),
  public.post_hot_purchase_payable_v1(jsonb), public.cancel_hot_purchase_v1(jsonb) from public, anon;
grant execute on function public.get_hot_purchase_settings_v1(), public.save_hot_purchase_settings_v1(jsonb), public.list_hot_purchases_v1(jsonb),
  public.get_hot_purchase_v1(uuid), public.save_hot_purchase_v1(jsonb), public.submit_hot_purchase_v1(jsonb), public.decide_hot_purchase_v1(jsonb),
  public.mark_hot_purchase_purchased_v1(jsonb), public.confirm_hot_purchase_overrun_v1(jsonb), public.receive_hot_purchase_v1(jsonb),
  public.post_hot_purchase_payable_v1(jsonb), public.cancel_hot_purchase_v1(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Hàm có sẵn: khóa vòng đời phiếu mua nóng, ghi chi phí khi ghi nợ, tiến độ đề xuất tính cả mua nóng
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.guard_site_direct_purchase_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $$
declare
  v_payable_status text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'Phiếu mua nóng mới phải được tạo ở trạng thái Nháp.';
    end if;
    return new;
  end if;

  if new.status = old.status then
    if old.status <> 'draft'
      -- M2c: lệnh mua nóng ở Mua hàng (RPC) được ghi số thực tế / duyệt / nhận trên phiếu đã gửi.
      and coalesce(current_setting('app.hot_purchase_command', true), '') <> 'on'
      and (to_jsonb(new) - array['updated_at', 'wms_transaction_id', 'last_action_by', 'last_action_at'])
        <> (to_jsonb(old) - array['updated_at', 'wms_transaction_id', 'last_action_by', 'last_action_at']) then
      raise exception 'Chỉ sửa được phiếu mua nóng ở trạng thái Nháp.';
    end if;
    return new;
  end if;

  if not (
    (old.status = 'draft' and new.status = 'submitted')
    -- M2c: dưới ngưỡng mua trước báo sau (nháp → đã mua); hủy trước khi mua — chỉ qua RPC mua nóng.
    or (coalesce(current_setting('app.hot_purchase_command', true), '') = 'on'
      and ((old.status = 'draft' and new.status = 'purchased')
        or (old.status in ('draft', 'submitted', 'approved_to_buy') and new.status = 'cancelled')))
    or (old.status = 'submitted' and new.status in ('draft', 'approved_to_buy', 'rejected'))
    or (old.status = 'approved_to_buy' and new.status in ('submitted', 'purchased', 'rejected'))
    or (old.status in ('purchased', 'received', 'finance_review') and new.status in ('finance_review', 'reconciled', 'rejected'))
    or (old.status = 'reconciled' and new.status in ('finance_review', 'rejected', 'closed'))
    or (old.status = 'closed' and new.status = 'reconciled')
  ) then
    raise exception 'Chuyển trạng thái mua nóng không hợp lệ: % -> %.', old.status, new.status;
  end if;

  if new.status = 'reconciled' then
    select status into v_payable_status
    from public.supplier_payable_documents
    where source_type = 'site_direct_purchase'
      and source_id = new.id::text;

    if v_payable_status not in ('open', 'payable', 'partial') then
      raise exception 'Chỉ xác nhận công nợ khi phiếu có công nợ nhà cung cấp đang mở.';
    end if;
  end if;

  if new.status = 'closed' then
    select status into v_payable_status
    from public.supplier_payable_documents
    where source_type = 'site_direct_purchase'
      and source_id = new.id::text;

    if v_payable_status <> 'paid' then
      raise exception 'Chỉ đóng phiếu khi công nợ nhà cung cấp đã thanh toán đủ.';
    end if;
  end if;

  if new.status = 'rejected' then
    if exists (
      select 1
      from public.supplier_payable_documents payable
      where payable.source_type = 'site_direct_purchase'
        and payable.source_id = new.id::text
        and payable.status not in ('cancelled', 'reversed')
    ) then
      raise exception 'Phải hủy công nợ nhà cung cấp trước khi từ chối phiếu.';
    end if;
  end if;

  return new;
end;
$$;

CREATE OR REPLACE FUNCTION app_private.sync_supplier_payable_recognition_transaction()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_finance_id text := '';
  v_source_ref text;
  v_recognized_amount numeric(18,2);
begin
  if tg_op = 'DELETE' then
    if old.source_type in ('supplier_delivery_statement', 'direct_supplier_receipt') or (old.source_type = 'site_direct_purchase' and coalesce(old.metadata->>'hotPurchase', '') = 'true') then
      update public.project_transactions
      set
        amount = 0,
        description = 'Ngừng ghi nhận công nợ vật tư NCC ' || old.supplier_name_snapshot || ' - ' || old.code
      where source_ref = 'supplier_payable_document:' || old.id::text || ':recognition';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE'
     and old.source_type in ('supplier_delivery_statement', 'direct_supplier_receipt')
     and new.source_type not in ('supplier_delivery_statement', 'direct_supplier_receipt')
  then
    update public.project_transactions
    set
      amount = 0,
      description = 'Ngừng ghi nhận công nợ vật tư NCC ' || old.supplier_name_snapshot || ' - ' || old.code
    where source_ref = 'supplier_payable_document:' || old.id::text || ':recognition';
  end if;

  -- K3a-3: phiếu nhập trực tiếp NCC cũng ghi chi phí khi ghi nợ; kho không thuộc dự án (cấp công ty) thì không ghi chi phí.
  -- M2c: mua nóng trả qua công ty / NCC cho nợ ghi chi phí khi kế toán ghi nợ (nguồn quỹ / nhân viên ứng ghi ở bộ hoàn ứng).
  if (new.source_type not in ('supplier_delivery_statement', 'direct_supplier_receipt')
      and not (new.source_type = 'site_direct_purchase' and coalesce(new.metadata->>'hotPurchase', '') = 'true'))
    or (new.project_id is null and new.construction_site_id is null) then
    return new;
  end if;

  select finance.id into v_finance_id
  from public.project_finances finance
  where (new.project_id is not null and finance.project_id = new.project_id)
     or (new.construction_site_id is not null and finance.construction_site_id = new.construction_site_id)
  order by
    case when new.project_id is not null and finance.project_id = new.project_id then 0 else 1 end,
    finance.id
  limit 1;

  v_source_ref := 'supplier_payable_document:' || new.id::text || ':recognition';
  v_recognized_amount := case
    when new.status = 'cancelled' then 0
    else greatest(coalesce(new.recognized_amount, 0), 0)
  end;

  insert into public.project_transactions (
    id, "projectFinanceId", "constructionSiteId", project_id, project_finance_id, construction_site_id,
    type, category, amount, description, date, source, "sourceRef", source_ref,
    attachments, "createdBy", "createdAt", counterparty_name, counterparty_partner_id
  )
  values (
    'supplier-ap-recognition-' || new.id::text,
    coalesce(v_finance_id, ''),
    coalesce(new.construction_site_id, ''),
    new.project_id,
    nullif(v_finance_id, ''),
    new.construction_site_id,
    'expense',
    'materials',
    v_recognized_amount,
    'Ghi nhận công nợ vật tư NCC ' || new.supplier_name_snapshot || ' - ' || new.code,
    coalesce(new.document_date, current_date)::text,
    'workflow',
    v_source_ref,
    v_source_ref,
    '[]'::jsonb,
    coalesce(new.created_by::text, 'system'),
    coalesce(new.created_at, now()),
    new.supplier_name_snapshot,
    new.supplier_id
  )
  on conflict (source_ref) do update
  set
    "projectFinanceId" = excluded."projectFinanceId",
    "constructionSiteId" = excluded."constructionSiteId",
    project_id = excluded.project_id,
    project_finance_id = excluded.project_finance_id,
    construction_site_id = excluded.construction_site_id,
    type = excluded.type,
    category = excluded.category,
    amount = excluded.amount,
    description = excluded.description,
    date = excluded.date,
    source = excluded.source,
    "sourceRef" = excluded."sourceRef",
    counterparty_name = excluded.counterparty_name,
    counterparty_partner_id = excluded.counterparty_partner_id;

  return new;
end;
$$;

CREATE OR REPLACE FUNCTION app_private.material_request_supply_lines_v1(p_request_ids text[] DEFAULT NULL::text[])
 RETURNS TABLE(request_id text, line_id text, item_id text, item_name text, sku text, unit text, need_qty numeric, po_ordered_qty numeric, po_received_qty numeric, transfer_open_qty numeric, transfer_received_qty numeric, stock_batch_received_qty numeric, closed_qty numeric, sourced_qty numeric, received_qty numeric, line_state text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
  select s.*,
    case when s.need_qty > 0 and s.received_qty >= s.need_qty * 0.98 or s.need_qty <= 0 then 'done'
      when s.closed_qty > 0 then 'closed'
      when s.sourced_qty > 0 then 'waiting'
      else 'none' end
  from (
    select r.id, x.value->>'lineId', x.value->>'itemId',
      coalesce(i.name, x.value->>'itemNameSnapshot', x.value->>'itemName', x.value->>'itemId'), i.sku,
      coalesce(nullif(x.value->>'unitSnapshot', ''), i.unit),
      -- Đề xuất cũ duyệt giữ nguyên SL có approvedQty = 0.
      coalesce(nullif(nullif(x.value->>'approvedQty', '')::numeric, 0), nullif(x.value->>'requestQty', '')::numeric, 0) need,
      coalesce(po.ordered_qty, 0), coalesce(po.received_qty, 0), coalesce(tr.open_qty, 0), coalesce(tr.received_qty, 0),
      coalesce(bt.received_qty, 0), coalesce(cl.closed_qty, 0),
      coalesce(po.ordered_qty, 0) + coalesce(tr.open_qty, 0) + coalesce(tr.received_qty, 0) + coalesce(bt.received_qty, 0)
        + coalesce(hp.open_qty, 0) + coalesce(hp.received_qty, 0),
      coalesce(po.received_qty, 0) + coalesce(tr.received_qty, 0) + coalesce(bt.received_qty, 0) + coalesce(hp.received_qty, 0)
    from public.requests r
    cross join lateral jsonb_array_elements(case when jsonb_typeof(r.items) = 'array' then r.items else '[]'::jsonb end) x
    left join public.items i on i.id = x.value->>'itemId'
    left join lateral (
      select round(sum(l.ordered_qty - app_private.procurement_link_credited(o.id, l.purchase_order_line_id, l.ordered_qty)), 6) ordered_qty,
        sum(app_private.procurement_link_received(o.id, o.items, l.purchase_order_line_id, l.ordered_qty)) received_qty
      from public.purchase_order_request_lines l
      join public.purchase_orders o on o.id = l.purchase_order_id and o.status not in ('cancelled', 'returned') and o.archived_at is null
      where l.material_request_id = r.id and l.request_line_id = x.value->>'lineId'
    ) po on true
    left join lateral (
      -- Phiếu chuyển "Cấp từ kho": chưa xuất tính theo SL phiếu; đã xuất tính phần đang đi đường + đã nhận.
      select sum(case when w.id is null then case when t.status = 'PENDING'::public.transaction_status then (y.value->>'quantity')::numeric else 0 end
          else greatest(w.dispatched_qty - w.received_qty - w.returned_qty - w.lost_qty, 0) end) open_qty,
        sum(coalesce(w.received_qty, 0)) received_qty
      from public.transactions t
      cross join lateral jsonb_array_elements(t.items) y
      left join public.wms_transfer_lines w on w.transaction_id = t.id and w.line_key = y.value->>'requestLineId'
      where t.source_type = 'material_request_supply' and t.source_id = r.id and t.type = 'TRANSFER'::public.transaction_type
        and y.value->>'requestLineId' = x.value->>'lineId'
    ) tr on true
    left join lateral (
      -- Đợt cấp cũ lấy từ kho (nguồn PO đã tính ở phần PO).
      select sum(fl.received_qty) received_qty
      from public.material_request_fulfillment_lines fl
      join public.material_request_fulfillment_batches b on b.id = fl.batch_id and b.status = 'received' and b.source_type = 'stock'
      where fl.material_request_id = r.id and fl.request_line_id = x.value->>'lineId'
    ) bt on true
    left join lateral (
      -- M2c: mua nóng gắn dòng đề xuất — đã gửi/duyệt/mua tính là có nguồn, đã nhận tính là đã nhận.
      select sum(case when h.status in ('submitted', 'approved_to_buy', 'purchased') then hl.quantity else 0 end) open_qty,
        sum(case when h.status in ('received', 'finance_review', 'reconciled', 'closed') then coalesce(nullif(hl.accepted_quantity, 0), hl.quantity) else 0 end) received_qty
      from public.site_direct_purchase_lines hl
      join public.site_direct_purchases h on h.id = hl.direct_purchase_id and h.hub_flow
      where hl.material_request_id = r.id and hl.request_line_id = x.value->>'lineId' and hl.status <> 'rejected'
    ) hp on true
    left join lateral (
      select sum(c.closed_qty) closed_qty from public.material_request_line_need_closures c
      where c.material_request_id = r.id and c.request_line_id = x.value->>'lineId' and c.status = 'active'
    ) cl on true
    where r.request_origin = 'project'
      and (case when p_request_ids is null then r.status in ('APPROVED', 'IN_TRANSIT') else r.id = any(p_request_ids) end)
  ) s(request_id, line_id, item_id, item_name, sku, unit, need_qty, po_ordered_qty, po_received_qty, transfer_open_qty,
      transfer_received_qty, stock_batch_received_qty, closed_qty, sourced_qty, received_qty);
$$;

notify pgrst, 'reload schema';
