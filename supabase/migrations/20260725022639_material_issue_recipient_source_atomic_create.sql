drop function if exists public.create_material_issue_order(
  text, text, text, text, text, text, uuid, text, text, text, date, text, jsonb
);

create function public.create_material_issue_order(
  p_project_id text,
  p_construction_site_id text,
  p_source_warehouse_id text,
  p_recipient_type text,
  p_recipient_id text,
  p_recipient_name text,
  p_responsible_user_id uuid,
  p_subcontractor_contract_id text,
  p_material_request_id text,
  p_work_boq_item_id text,
  p_needed_date date,
  p_note text,
  p_lines jsonb,
  p_recipient_source_type text default null,
  p_recipient_source_id text default null
)
returns public.material_issue_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_order public.material_issue_orders%rowtype;
  v_order_id uuid := gen_random_uuid();
  v_issue_no text;
  v_line jsonb;
  v_item public.items%rowtype;
  v_qty numeric;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if not (
    app_private.material_issue_can_manage_project(p_project_id, p_construction_site_id)
    or app_private.current_user_is_wms_keeper_for(p_source_warehouse_id)
  ) then
    raise exception 'Bạn không có quyền tạo phiếu xuất cấp cho dự án/công trường này.';
  end if;
  if coalesce(p_source_warehouse_id, '') = '' then raise exception 'Chưa chọn kho xuất.'; end if;
  if p_recipient_type not in ('employee', 'work_group', 'subcontractor', 'partner', 'manual') then
    raise exception 'Loại bên nhận không hợp lệ.';
  end if;
  if coalesce(trim(p_recipient_name), '') = '' then raise exception 'Chưa nhập tên bên nhận.'; end if;
  if p_recipient_source_type is not null
     and p_recipient_source_type not in ('supplier_contract', 'business_partner') then
    raise exception 'Nguồn bên nhận không hợp lệ.';
  end if;
  if (p_recipient_source_type is null)
     <> (nullif(trim(coalesce(p_recipient_source_id, '')), '') is null) then
    raise exception 'Nguồn bên nhận phải có đủ loại và mã tham chiếu.';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Phiếu xuất cấp chưa có dòng vật tư.';
  end if;

  v_issue_no := 'MI-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(v_order_id::text, '-', ''), 1, 6));

  insert into public.material_issue_orders(
    id, issue_no, project_id, construction_site_id, source_warehouse_id,
    recipient_type, recipient_id, recipient_name, recipient_source_type, recipient_source_id,
    responsible_user_id, subcontractor_contract_id, material_request_id, work_boq_item_id,
    needed_date, status, note, created_by
  ) values (
    v_order_id, v_issue_no, nullif(p_project_id, ''), nullif(p_construction_site_id, ''), p_source_warehouse_id,
    p_recipient_type, nullif(p_recipient_id, ''), trim(p_recipient_name),
    p_recipient_source_type, nullif(trim(coalesce(p_recipient_source_id, '')), ''),
    p_responsible_user_id, nullif(p_subcontractor_contract_id, ''), nullif(p_material_request_id, ''), nullif(p_work_boq_item_id, ''),
    p_needed_date, 'draft', nullif(trim(coalesce(p_note, '')), ''), v_actor
  )
  returning * into v_order;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_qty := coalesce(nullif(v_line ->> 'quantity', '')::numeric, 0);
    if coalesce(v_line ->> 'itemId', '') = '' or v_qty <= 0 then
      raise exception 'Dòng vật tư không hợp lệ.';
    end if;

    select * into v_item from public.items where id = v_line ->> 'itemId';
    if not found then raise exception 'Không tìm thấy vật tư %.', v_line ->> 'itemId'; end if;

    insert into public.material_issue_lines(
      issue_order_id, item_id, sku_snapshot, item_name_snapshot, unit,
      requested_qty, approved_qty, unit_price,
      material_budget_item_id, material_request_line_id, work_boq_item_id,
      subcontractor_contract_id, note
    ) values (
      v_order_id, v_item.id, v_item.sku, v_item.name, coalesce(nullif(v_line ->> 'unit', ''), v_item.unit),
      v_qty, v_qty, coalesce(nullif(v_line ->> 'unitPrice', '')::numeric, coalesce(v_item.price_in, 0)),
      nullif(v_line ->> 'materialBudgetItemId', ''),
      nullif(v_line ->> 'materialRequestLineId', ''),
      coalesce(nullif(v_line ->> 'workBoqItemId', ''), nullif(p_work_boq_item_id, '')),
      coalesce(nullif(v_line ->> 'subcontractorContractId', ''), nullif(p_subcontractor_contract_id, '')),
      nullif(trim(coalesce(v_line ->> 'note', '')), '')
    );
  end loop;

  return v_order;
end;
$$;

revoke all on function public.create_material_issue_order(
  text, text, text, text, text, text, uuid, text, text, text, date, text, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.create_material_issue_order(
  text, text, text, text, text, text, uuid, text, text, text, date, text, jsonb, text, text
) to authenticated;

notify pgrst, 'reload schema';
