create schema if not exists app_private;

insert into public.permission_modules (application_code, code, name, routes, legacy_module_key, sort_order)
values
  ('project', 'project.material_direct_purchase', 'Mua nóng công trường', array['/da/tabs/material','/da/tabs/material/po']::text[], 'DA', 82),
  ('project', 'project.material_supplier_delivery', 'Gọi hàng HĐ NCC', array['/da/tabs/material','/da/tabs/material/po']::text[], 'DA', 84)
on conflict (code) do update
set application_code = excluded.application_code,
    name = excluded.name,
    routes = excluded.routes,
    legacy_module_key = excluded.legacy_module_key,
    sort_order = excluded.sort_order,
    is_active = true,
    updated_at = now();

insert into public.permission_actions (
  module_code,
  action,
  permission_code,
  label,
  scope_modes,
  legacy_module_key,
  legacy_route,
  legacy_admin_only,
  sort_order,
  is_active
)
values
  ('project.material_direct_purchase', 'view', 'project.material_direct_purchase.view', 'Xem', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material', false, 10, true),
  ('project.material_direct_purchase', 'create', 'project.material_direct_purchase.create', 'Tạo', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material', true, 20, true),
  ('project.material_direct_purchase', 'edit', 'project.material_direct_purchase.edit', 'Sửa', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material', true, 30, true),
  ('project.material_direct_purchase', 'delete', 'project.material_direct_purchase.delete', 'Xóa', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material', true, 40, true),
  ('project.material_direct_purchase', 'record_ap', 'project.material_direct_purchase.record_ap', 'Ghi AP', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material', true, 50, true),
  ('project.material_supplier_delivery', 'view', 'project.material_supplier_delivery.view', 'Xem', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material', false, 10, true),
  ('project.material_supplier_delivery', 'create', 'project.material_supplier_delivery.create', 'Tạo', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material', true, 20, true),
  ('project.material_supplier_delivery', 'edit', 'project.material_supplier_delivery.edit', 'Sửa', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material', true, 30, true),
  ('project.material_supplier_delivery', 'delete', 'project.material_supplier_delivery.delete', 'Xóa', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material', true, 40, true),
  ('project.material_supplier_delivery', 'record', 'project.material_supplier_delivery.record', 'Ghi', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material', true, 50, true),
  ('project.material_supplier_delivery', 'unrecord', 'project.material_supplier_delivery.unrecord', 'Bỏ ghi', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material', true, 60, true),
  ('project.material_supplier_delivery', 'reconcile', 'project.material_supplier_delivery.reconcile', 'Đối soát AP', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material', true, 70, true)
on conflict (permission_code) do update
set module_code = excluded.module_code,
    action = excluded.action,
    label = excluded.label,
    scope_modes = excluded.scope_modes,
    legacy_module_key = excluded.legacy_module_key,
    legacy_route = excluded.legacy_route,
    legacy_admin_only = excluded.legacy_admin_only,
    sort_order = excluded.sort_order,
    is_active = true,
    updated_at = now();

alter table public.supplier_delivery_statement_lines
  add column if not exists unit_price_snapshot numeric(18,2) not null default 0,
  add column if not exists vat_rate_snapshot numeric(5,2) not null default 0;

create or replace function app_private.ap_scope_can_mutate(p_project_id text, p_construction_site_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.is_admin()
    or public.is_module_admin('DA')
    or app_private.company_procurement_can_manage()
    or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'edit')
    or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'submit')
    or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'approve')
    or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'confirm')
    or app_private.material_has_action(p_project_id, p_construction_site_id, 'project.material_direct_purchase.create', public.current_app_user_id())
    or app_private.material_has_action(p_project_id, p_construction_site_id, 'project.material_direct_purchase.edit', public.current_app_user_id())
    or app_private.material_has_action(p_project_id, p_construction_site_id, 'project.material_direct_purchase.delete', public.current_app_user_id())
    or app_private.material_has_action(p_project_id, p_construction_site_id, 'project.material_direct_purchase.record_ap', public.current_app_user_id())
    or app_private.material_has_action(p_project_id, p_construction_site_id, 'project.material_supplier_delivery.create', public.current_app_user_id())
    or app_private.material_has_action(p_project_id, p_construction_site_id, 'project.material_supplier_delivery.edit', public.current_app_user_id())
    or app_private.material_has_action(p_project_id, p_construction_site_id, 'project.material_supplier_delivery.delete', public.current_app_user_id())
    or app_private.material_has_action(p_project_id, p_construction_site_id, 'project.material_supplier_delivery.record', public.current_app_user_id())
    or app_private.material_has_action(p_project_id, p_construction_site_id, 'project.material_supplier_delivery.unrecord', public.current_app_user_id())
    or app_private.material_has_action(p_project_id, p_construction_site_id, 'project.material_supplier_delivery.reconcile', public.current_app_user_id()),
    false
  );
$$;

create or replace function app_private.material_flow_has_action_or_legacy(
  p_project_id text,
  p_construction_site_id text,
  p_permission_code text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.is_admin()
    or public.is_module_admin('DA')
    or app_private.company_procurement_can_manage()
    or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'edit')
    or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'submit')
    or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'approve')
    or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'confirm')
    or app_private.material_has_action(p_project_id, p_construction_site_id, p_permission_code, public.current_app_user_id()),
    false
  );
$$;

create or replace function public.upsert_site_direct_purchase_with_lines(
  p_purchase jsonb,
  p_lines jsonb default '[]'::jsonb
)
returns public.site_direct_purchases
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_purchase public.site_direct_purchases%rowtype;
  v_existing public.site_direct_purchases%rowtype;
  v_line jsonb;
  v_line_id uuid;
  v_line_amount numeric(18,2);
  v_vat_amount numeric(18,2);
  v_status text;
begin
  if p_purchase is null or nullif(p_purchase->>'id', '') is null then
    raise exception 'Thiếu id phiếu mua nóng.';
  end if;

  select * into v_existing
  from public.site_direct_purchases
  where id = (p_purchase->>'id')::uuid
  for update;

  if found and (
    v_existing.wms_transaction_id is not null
    or v_existing.site_cash_settlement_id is not null
    or exists (
      select 1
      from public.supplier_payable_documents ap
      where ap.source_type = 'site_direct_purchase'
        and ap.source_id = v_existing.id::text
        and ap.status not in ('cancelled', 'reversed')
    )
  ) then
    raise exception 'Không thể sửa phiếu mua nóng đã phát sinh WMS/AP/hoàn ứng.';
  end if;

  if not app_private.material_flow_has_action_or_legacy(
    p_purchase->>'project_id',
    p_purchase->>'construction_site_id',
    case when found then 'project.material_direct_purchase.edit' else 'project.material_direct_purchase.create' end
  ) then
    raise exception 'Bạn không có quyền lưu phiếu mua nóng.';
  end if;

  insert into public.site_direct_purchases (
    id, code, project_id, construction_site_id, supplier_id, supplier_name_snapshot,
    purchase_mode, payment_source, target_warehouse_id, status, purchase_date,
    invoice_number, invoice_date, gross_amount, vat_amount, total_amount, po_id,
    wms_transaction_id, site_cash_settlement_id, qr_token, attachments, created_by,
    created_at, updated_at, note
  )
  values (
    (p_purchase->>'id')::uuid,
    coalesce(nullif(p_purchase->>'code', ''), 'MN-' || to_char(now(), 'YYYYMMDDHH24MISS')),
    nullif(p_purchase->>'project_id', ''),
    nullif(p_purchase->>'construction_site_id', ''),
    nullif(p_purchase->>'supplier_id', ''),
    coalesce(nullif(p_purchase->>'supplier_name_snapshot', ''), 'Nhà cung cấp'),
    coalesce(nullif(p_purchase->>'purchase_mode', ''), 'immediate'),
    coalesce(nullif(p_purchase->>'payment_source', ''), 'supplier_credit'),
    nullif(p_purchase->>'target_warehouse_id', ''),
    coalesce(nullif(p_purchase->>'status', ''), 'purchased'),
    coalesce(nullif(p_purchase->>'purchase_date', '')::date, current_date),
    nullif(p_purchase->>'invoice_number', ''),
    nullif(p_purchase->>'invoice_date', '')::date,
    coalesce(nullif(p_purchase->>'gross_amount', '')::numeric, 0),
    coalesce(nullif(p_purchase->>'vat_amount', '')::numeric, 0),
    coalesce(nullif(p_purchase->>'total_amount', '')::numeric, 0),
    nullif(p_purchase->>'po_id', ''),
    nullif(p_purchase->>'wms_transaction_id', ''),
    nullif(p_purchase->>'site_cash_settlement_id', '')::uuid,
    nullif(p_purchase->>'qr_token', ''),
    coalesce(p_purchase->'attachments', '[]'::jsonb),
    coalesce(nullif(p_purchase->>'created_by', '')::uuid, public.current_app_user_id()),
    coalesce(nullif(p_purchase->>'created_at', '')::timestamptz, now()),
    now(),
    nullif(p_purchase->>'note', '')
  )
  on conflict (id) do update
  set code = excluded.code,
      project_id = excluded.project_id,
      construction_site_id = excluded.construction_site_id,
      supplier_id = excluded.supplier_id,
      supplier_name_snapshot = excluded.supplier_name_snapshot,
      purchase_mode = excluded.purchase_mode,
      payment_source = excluded.payment_source,
      target_warehouse_id = excluded.target_warehouse_id,
      status = excluded.status,
      purchase_date = excluded.purchase_date,
      invoice_number = excluded.invoice_number,
      invoice_date = excluded.invoice_date,
      gross_amount = excluded.gross_amount,
      vat_amount = excluded.vat_amount,
      total_amount = excluded.total_amount,
      po_id = excluded.po_id,
      qr_token = excluded.qr_token,
      attachments = excluded.attachments,
      updated_at = now(),
      note = excluded.note
  returning * into v_purchase;

  delete from public.site_direct_purchase_lines line
  where line.direct_purchase_id = v_purchase.id
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) item
      where (item.value->>'id')::uuid = line.id
    );

  for v_line in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    v_line_id := coalesce(nullif(v_line->>'id', '')::uuid, gen_random_uuid());
    v_line_amount := round(coalesce(nullif(v_line->>'quantity', '')::numeric, 0) * coalesce(nullif(v_line->>'unit_price', '')::numeric, 0), 2);
    v_vat_amount := round(v_line_amount * coalesce(nullif(v_line->>'vat_rate', '')::numeric, 0) / 100, 2);
    v_status := coalesce(nullif(v_line->>'status', ''), 'accepted');
    if v_status = 'pending' then
      v_status := 'accepted';
    end if;

    insert into public.site_direct_purchase_lines (
      id, direct_purchase_id, line_no, line_type, item_id, sku_snapshot,
      item_name_snapshot, unit_snapshot, quantity, unit_price, vat_rate,
      line_amount, vat_amount, accepted_quantity, accepted_amount, status,
      rejection_reason, work_boq_item_id, material_budget_item_id,
      small_tool_category, small_tool_holder_type, small_tool_holder_id,
      small_tool_holder_name_snapshot, small_tool_location_note, note
    )
    values (
      v_line_id,
      v_purchase.id,
      coalesce(nullif(v_line->>'line_no', '')::integer, 1),
      coalesce(nullif(v_line->>'line_type', ''), 'expense_only'),
      nullif(v_line->>'item_id', ''),
      nullif(v_line->>'sku_snapshot', ''),
      coalesce(nullif(v_line->>'item_name_snapshot', ''), 'Chi phí mua nóng'),
      nullif(v_line->>'unit_snapshot', ''),
      coalesce(nullif(v_line->>'quantity', '')::numeric, 0),
      coalesce(nullif(v_line->>'unit_price', '')::numeric, 0),
      coalesce(nullif(v_line->>'vat_rate', '')::numeric, 0),
      v_line_amount,
      v_vat_amount,
      case when v_status = 'rejected' then 0 else coalesce(nullif(v_line->>'accepted_quantity', '')::numeric, coalesce(nullif(v_line->>'quantity', '')::numeric, 0)) end,
      case when v_status = 'rejected' then 0 else coalesce(nullif(v_line->>'accepted_amount', '')::numeric, v_line_amount + v_vat_amount) end,
      v_status,
      nullif(v_line->>'rejection_reason', ''),
      nullif(v_line->>'work_boq_item_id', ''),
      nullif(v_line->>'material_budget_item_id', ''),
      nullif(v_line->>'small_tool_category', ''),
      nullif(v_line->>'small_tool_holder_type', ''),
      nullif(v_line->>'small_tool_holder_id', ''),
      nullif(v_line->>'small_tool_holder_name_snapshot', ''),
      nullif(v_line->>'small_tool_location_note', ''),
      nullif(v_line->>'note', '')
    )
    on conflict (id) do update
    set line_no = excluded.line_no,
        line_type = excluded.line_type,
        item_id = excluded.item_id,
        sku_snapshot = excluded.sku_snapshot,
        item_name_snapshot = excluded.item_name_snapshot,
        unit_snapshot = excluded.unit_snapshot,
        quantity = excluded.quantity,
        unit_price = excluded.unit_price,
        vat_rate = excluded.vat_rate,
        line_amount = excluded.line_amount,
        vat_amount = excluded.vat_amount,
        accepted_quantity = excluded.accepted_quantity,
        accepted_amount = excluded.accepted_amount,
        status = excluded.status,
        rejection_reason = excluded.rejection_reason,
        work_boq_item_id = excluded.work_boq_item_id,
        material_budget_item_id = excluded.material_budget_item_id,
        small_tool_category = excluded.small_tool_category,
        small_tool_holder_type = excluded.small_tool_holder_type,
        small_tool_holder_id = excluded.small_tool_holder_id,
        small_tool_holder_name_snapshot = excluded.small_tool_holder_name_snapshot,
        small_tool_location_note = excluded.small_tool_location_note,
        note = excluded.note,
        updated_at = now();
  end loop;

  select * into v_purchase
  from public.site_direct_purchases
  where id = v_purchase.id;

  return v_purchase;
end;
$$;

create or replace function public.delete_site_direct_purchase_v1(p_direct_purchase_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_purchase public.site_direct_purchases%rowtype;
begin
  select * into v_purchase
  from public.site_direct_purchases
  where id = p_direct_purchase_id
  for update;

  if not found then
    raise exception 'Không tìm thấy phiếu mua nóng %. ', p_direct_purchase_id;
  end if;

  if not app_private.material_flow_has_action_or_legacy(v_purchase.project_id, v_purchase.construction_site_id, 'project.material_direct_purchase.delete') then
    raise exception 'Bạn không có quyền xóa phiếu mua nóng.';
  end if;

  if v_purchase.wms_transaction_id is not null
    or v_purchase.site_cash_settlement_id is not null
    or exists (
      select 1
      from public.supplier_payable_documents ap
      where ap.source_type = 'site_direct_purchase'
        and ap.source_id = p_direct_purchase_id::text
        and ap.status not in ('cancelled', 'reversed')
    )
  then
    raise exception 'Không thể xóa phiếu mua nóng đã phát sinh WMS/AP/hoàn ứng.';
  end if;

  delete from public.site_direct_purchases
  where id = p_direct_purchase_id;
end;
$$;

create or replace function public.upsert_supplier_direct_delivery_note_with_lines(
  p_note jsonb,
  p_lines jsonb default '[]'::jsonb
)
returns public.supplier_direct_delivery_notes
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_note public.supplier_direct_delivery_notes%rowtype;
  v_existing public.supplier_direct_delivery_notes%rowtype;
  v_line jsonb;
  v_line_id uuid;
begin
  if p_note is null or nullif(p_note->>'id', '') is null then
    raise exception 'Thiếu id phiếu giao HĐ NCC.';
  end if;

  select * into v_existing
  from public.supplier_direct_delivery_notes
  where id = (p_note->>'id')::uuid
  for update;

  if found and v_existing.status not in ('draft', 'cancelled') then
    raise exception 'Chỉ sửa được phiếu giao HĐ NCC chưa ghi hoặc đã bỏ ghi.';
  end if;

  if found and exists (
    select 1
    from public.supplier_direct_delivery_lines line
    where line.delivery_note_id = v_existing.id
      and (
        line.statement_id is not null
        or line.wms_import_transaction_id is not null
        or line.wms_export_transaction_id is not null
      )
  ) then
    raise exception 'Không thể sửa phiếu giao HĐ NCC đã phát sinh WMS/đối soát.';
  end if;

  if not app_private.material_flow_has_action_or_legacy(
    p_note->>'project_id',
    p_note->>'construction_site_id',
    case when found then 'project.material_supplier_delivery.edit' else 'project.material_supplier_delivery.create' end
  ) then
    raise exception 'Bạn không có quyền lưu phiếu giao HĐ NCC.';
  end if;

  insert into public.supplier_direct_delivery_notes (
    id, code, project_id, construction_site_id, supplier_contract_id,
    supplier_contract_code, supplier_id, supplier_name_snapshot,
    delivery_ticket_no, delivery_date, vehicle_no, status, gross_amount,
    vat_amount, total_amount, attachments, qr_token, created_by,
    created_at, updated_at, note
  )
  values (
    (p_note->>'id')::uuid,
    coalesce(nullif(p_note->>'code', ''), 'GN-HDNCC-' || to_char(now(), 'YYYYMMDDHH24MISS')),
    nullif(p_note->>'project_id', ''),
    nullif(p_note->>'construction_site_id', ''),
    nullif(p_note->>'supplier_contract_id', ''),
    nullif(p_note->>'supplier_contract_code', ''),
    nullif(p_note->>'supplier_id', ''),
    coalesce(nullif(p_note->>'supplier_name_snapshot', ''), 'Nhà cung cấp'),
    coalesce(nullif(p_note->>'delivery_ticket_no', ''), 'BBG-' || to_char(now(), 'YYYYMMDDHH24MISS')),
    coalesce(nullif(p_note->>'delivery_date', '')::date, current_date),
    nullif(p_note->>'vehicle_no', ''),
    'draft',
    0,
    0,
    0,
    coalesce(p_note->'attachments', '[]'::jsonb),
    nullif(p_note->>'qr_token', ''),
    coalesce(nullif(p_note->>'created_by', '')::uuid, public.current_app_user_id()),
    coalesce(nullif(p_note->>'created_at', '')::timestamptz, now()),
    now(),
    nullif(p_note->>'note', '')
  )
  on conflict (id) do update
  set code = excluded.code,
      project_id = excluded.project_id,
      construction_site_id = excluded.construction_site_id,
      supplier_contract_id = excluded.supplier_contract_id,
      supplier_contract_code = excluded.supplier_contract_code,
      supplier_id = excluded.supplier_id,
      supplier_name_snapshot = excluded.supplier_name_snapshot,
      delivery_ticket_no = excluded.delivery_ticket_no,
      delivery_date = excluded.delivery_date,
      vehicle_no = excluded.vehicle_no,
      status = 'draft',
      gross_amount = 0,
      vat_amount = 0,
      total_amount = 0,
      attachments = excluded.attachments,
      qr_token = excluded.qr_token,
      updated_at = now(),
      note = excluded.note
  returning * into v_note;

  delete from public.supplier_direct_delivery_lines line
  where line.delivery_note_id = v_note.id
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) item
      where (item.value->>'id')::uuid = line.id
    );

  for v_line in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    v_line_id := coalesce(nullif(v_line->>'id', '')::uuid, gen_random_uuid());

    insert into public.supplier_direct_delivery_lines (
      id, delivery_note_id, supplier_contract_id, supplier_contract_line_id,
      line_no, item_id, sku_snapshot, item_name_snapshot, unit_snapshot,
      quantity, unit_price, vat_rate, line_amount, vat_amount, total_amount,
      accepted_quantity, accepted_amount, status, issue_reason,
      work_boq_item_id, material_budget_item_id, wms_flow_mode,
      target_warehouse_id, wms_status, rejection_reason, note
    )
    values (
      v_line_id,
      v_note.id,
      v_note.supplier_contract_id,
      nullif(v_line->>'supplier_contract_line_id', '')::uuid,
      coalesce(nullif(v_line->>'line_no', '')::integer, 1),
      nullif(v_line->>'item_id', ''),
      nullif(v_line->>'sku_snapshot', ''),
      coalesce(nullif(v_line->>'item_name_snapshot', ''), 'Vật tư HĐ NCC'),
      nullif(v_line->>'unit_snapshot', ''),
      coalesce(nullif(v_line->>'quantity', '')::numeric, 0),
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      'pending',
      nullif(v_line->>'issue_reason', ''),
      nullif(v_line->>'work_boq_item_id', ''),
      nullif(v_line->>'material_budget_item_id', ''),
      coalesce(nullif(v_line->>'wms_flow_mode', ''), 'none'),
      nullif(v_line->>'target_warehouse_id', ''),
      case when coalesce(nullif(v_line->>'wms_flow_mode', ''), 'none') = 'direct_in_out' then 'not_required' else 'not_required' end,
      nullif(v_line->>'rejection_reason', ''),
      nullif(v_line->>'note', '')
    )
    on conflict (id) do update
    set supplier_contract_id = excluded.supplier_contract_id,
        supplier_contract_line_id = excluded.supplier_contract_line_id,
        line_no = excluded.line_no,
        item_id = excluded.item_id,
        sku_snapshot = excluded.sku_snapshot,
        item_name_snapshot = excluded.item_name_snapshot,
        unit_snapshot = excluded.unit_snapshot,
        quantity = excluded.quantity,
        unit_price = 0,
        vat_rate = 0,
        line_amount = 0,
        vat_amount = 0,
        total_amount = 0,
        accepted_quantity = 0,
        accepted_amount = 0,
        status = 'pending',
        issue_reason = excluded.issue_reason,
        work_boq_item_id = excluded.work_boq_item_id,
        material_budget_item_id = excluded.material_budget_item_id,
        wms_flow_mode = excluded.wms_flow_mode,
        target_warehouse_id = excluded.target_warehouse_id,
        wms_status = excluded.wms_status,
        rejection_reason = excluded.rejection_reason,
        note = excluded.note,
        updated_at = now();
  end loop;

  select * into v_note
  from public.supplier_direct_delivery_notes
  where id = v_note.id;

  return v_note;
end;
$$;

create or replace function public.record_supplier_direct_delivery_note(
  p_note_id uuid,
  p_actor_id uuid default null
)
returns public.supplier_direct_delivery_notes
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_note public.supplier_direct_delivery_notes%rowtype;
  v_rows integer;
begin
  select * into v_note
  from public.supplier_direct_delivery_notes
  where id = p_note_id
  for update;

  if not found then
    raise exception 'Không tìm thấy phiếu giao HĐ NCC %. ', p_note_id;
  end if;

  if not app_private.material_flow_has_action_or_legacy(v_note.project_id, v_note.construction_site_id, 'project.material_supplier_delivery.record') then
    raise exception 'Bạn không có quyền ghi phiếu giao HĐ NCC.';
  end if;

  if v_note.status in ('statemented', 'cancelled', 'rejected') then
    raise exception 'Không thể ghi phiếu giao HĐ NCC ở trạng thái hiện tại.';
  end if;

  update public.supplier_direct_delivery_lines
  set status = 'accepted',
      accepted_quantity = quantity,
      accepted_amount = 0,
      unit_price = 0,
      vat_rate = 0,
      line_amount = 0,
      vat_amount = 0,
      total_amount = 0,
      rejection_reason = null,
      updated_at = now()
  where delivery_note_id = p_note_id
    and status <> 'rejected';

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'Chưa có dòng đã ghi trong phiếu giao HĐ NCC.';
  end if;

  update public.supplier_direct_delivery_notes
  set status = 'accepted',
      gross_amount = 0,
      vat_amount = 0,
      total_amount = 0,
      updated_at = now()
  where id = p_note_id
  returning * into v_note;

  return v_note;
end;
$$;

create or replace function public.unrecord_supplier_direct_delivery_note(p_note_id uuid)
returns public.supplier_direct_delivery_notes
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_note public.supplier_direct_delivery_notes%rowtype;
begin
  select * into v_note
  from public.supplier_direct_delivery_notes
  where id = p_note_id
  for update;

  if not found then
    raise exception 'Không tìm thấy phiếu giao HĐ NCC %. ', p_note_id;
  end if;

  if not app_private.material_flow_has_action_or_legacy(v_note.project_id, v_note.construction_site_id, 'project.material_supplier_delivery.unrecord') then
    raise exception 'Bạn không có quyền bỏ ghi phiếu giao HĐ NCC.';
  end if;

  if exists (
    select 1
    from public.supplier_direct_delivery_lines line
    where line.delivery_note_id = p_note_id
      and (
        line.statement_id is not null
        or line.wms_import_transaction_id is not null
        or line.wms_export_transaction_id is not null
      )
  ) then
    raise exception 'Không thể bỏ ghi phiếu giao HĐ NCC đã phát sinh WMS/đối soát/AP.';
  end if;

  update public.supplier_direct_delivery_lines
  set status = 'pending',
      accepted_quantity = 0,
      accepted_amount = 0,
      updated_at = now()
  where delivery_note_id = p_note_id;

  update public.supplier_direct_delivery_notes
  set status = 'draft',
      gross_amount = 0,
      vat_amount = 0,
      total_amount = 0,
      updated_at = now()
  where id = p_note_id
  returning * into v_note;

  return v_note;
end;
$$;

create or replace function public.delete_supplier_direct_delivery_note_v1(p_note_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_note public.supplier_direct_delivery_notes%rowtype;
begin
  select * into v_note
  from public.supplier_direct_delivery_notes
  where id = p_note_id
  for update;

  if not found then
    raise exception 'Không tìm thấy phiếu giao HĐ NCC %. ', p_note_id;
  end if;

  if not app_private.material_flow_has_action_or_legacy(v_note.project_id, v_note.construction_site_id, 'project.material_supplier_delivery.delete') then
    raise exception 'Bạn không có quyền xóa phiếu giao HĐ NCC.';
  end if;

  if v_note.status not in ('draft', 'cancelled') then
    raise exception 'Chỉ xóa được phiếu giao HĐ NCC chưa ghi hoặc đã hủy.';
  end if;

  if exists (
    select 1
    from public.supplier_direct_delivery_lines line
    where line.delivery_note_id = p_note_id
      and (
        line.statement_id is not null
        or line.wms_import_transaction_id is not null
        or line.wms_export_transaction_id is not null
      )
  ) then
    raise exception 'Không thể xóa phiếu giao HĐ NCC đã phát sinh WMS/đối soát/AP.';
  end if;

  delete from public.supplier_direct_delivery_notes
  where id = p_note_id;
end;
$$;

revoke all on function public.upsert_site_direct_purchase_with_lines(jsonb, jsonb) from public, anon;
revoke all on function public.delete_site_direct_purchase_v1(uuid) from public, anon;
revoke all on function public.upsert_supplier_direct_delivery_note_with_lines(jsonb, jsonb) from public, anon;
revoke all on function public.record_supplier_direct_delivery_note(uuid, uuid) from public, anon;
revoke all on function public.unrecord_supplier_direct_delivery_note(uuid) from public, anon;
revoke all on function public.delete_supplier_direct_delivery_note_v1(uuid) from public, anon;
revoke all on function app_private.material_flow_has_action_or_legacy(text, text, text) from public, anon;

grant execute on function public.upsert_site_direct_purchase_with_lines(jsonb, jsonb) to authenticated;
grant execute on function public.delete_site_direct_purchase_v1(uuid) to authenticated;
grant execute on function public.upsert_supplier_direct_delivery_note_with_lines(jsonb, jsonb) to authenticated;
grant execute on function public.record_supplier_direct_delivery_note(uuid, uuid) to authenticated;
grant execute on function public.unrecord_supplier_direct_delivery_note(uuid) to authenticated;
grant execute on function public.delete_supplier_direct_delivery_note_v1(uuid) to authenticated;
grant execute on function app_private.material_flow_has_action_or_legacy(text, text, text) to authenticated;

notify pgrst, 'reload schema';
