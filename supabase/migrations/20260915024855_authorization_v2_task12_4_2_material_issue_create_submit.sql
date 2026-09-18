-- Separate canonical WMS grants from transition-era persona fallbacks so each
-- material-issue command can opt into one exact capability without widening
-- access through another legacy branch.
create or replace function app_private.wms_has_canonical_action(
  p_permission_code text,
  p_source_warehouse_id text default null,
  p_target_warehouse_id text default null,
  p_requester_id uuid default null,
  p_assigned_user_id uuid default null,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_user_id is not null and exists (
    select 1
    from public.permission_actions action_row
    where action_row.permission_code = p_permission_code
      and action_row.permission_code like 'wms.%'
      and action_row.is_active
  ) then coalesce((
    app_private.has_permission(p_user_id, p_permission_code, 'global', '*')
    or (
      p_source_warehouse_id is not null
      and app_private.has_permission(
        p_user_id, p_permission_code, 'warehouse', p_source_warehouse_id
      )
    )
    or (
      p_target_warehouse_id is not null
      and app_private.has_permission(
        p_user_id, p_permission_code, 'warehouse', p_target_warehouse_id
      )
    )
    or (
      p_requester_id = p_user_id
      and app_private.has_permission(
        p_user_id, p_permission_code, 'own', p_user_id::text
      )
    )
    or (
      p_assigned_user_id = p_user_id
      and app_private.has_permission(
        p_user_id, p_permission_code, 'assigned', p_user_id::text
      )
    )
  ), false) else false end;
$$;

create or replace function app_private.wms_has_action(
  p_permission_code text,
  p_source_warehouse_id text default null,
  p_target_warehouse_id text default null,
  p_requester_id uuid default null,
  p_assigned_user_id uuid default null,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_user_id is not null and exists (
    select 1
    from public.permission_actions action_row
    where action_row.permission_code = p_permission_code
      and action_row.permission_code like 'wms.%'
      and action_row.is_active
  ) then coalesce((
    app_private.wms_has_canonical_action(
      p_permission_code,
      p_source_warehouse_id,
      p_target_warehouse_id,
      p_requester_id,
      p_assigned_user_id,
      p_user_id
    )
    or (
      p_permission_code <> 'wms.transaction.reverse'
      and (
        public.is_module_admin('WMS')
        or app_private.current_user_is_global_wms_keeper()
        or app_private.current_user_is_wms_keeper_for(p_source_warehouse_id)
        or app_private.current_user_is_wms_keeper_for(p_target_warehouse_id)
      )
    )
  ), false) else false end;
$$;

create or replace function app_private.material_issue_can_create(
  p_project_id text,
  p_construction_site_id text,
  p_source_warehouse_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app_private.material_issue_can_manage_project(
      p_project_id,
      p_construction_site_id
    )
    or app_private.current_user_is_wms_keeper_for(p_source_warehouse_id)
    or app_private.wms_has_canonical_action(
      'wms.transaction.create',
      p_source_warehouse_id,
      null,
      null,
      null,
      public.current_app_user_id()
    ),
    false
  );
$$;

create or replace function app_private.material_issue_can_submit(
  p_project_id text,
  p_construction_site_id text,
  p_source_warehouse_id text,
  p_created_by uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_created_by = public.current_app_user_id()
    or app_private.material_issue_can_manage_project(
      p_project_id,
      p_construction_site_id
    )
    or app_private.wms_has_canonical_action(
      'wms.transaction.create',
      p_source_warehouse_id,
      null,
      p_created_by,
      null,
      public.current_app_user_id()
    ),
    false
  );
$$;

create or replace function public.create_material_issue_order(
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
  if not app_private.material_issue_can_create(
    p_project_id,
    p_construction_site_id,
    p_source_warehouse_id
  ) then
    raise exception 'Bạn không có quyền tạo phiếu xuất cấp cho dự án/công trường này.'
      using errcode = '42501';
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

  v_issue_no := 'MI-' || to_char(now(), 'YYYYMMDD') || '-'
    || upper(substr(replace(v_order_id::text, '-', ''), 1, 6));

  insert into public.material_issue_orders(
    id, issue_no, project_id, construction_site_id, source_warehouse_id,
    recipient_type, recipient_id, recipient_name, recipient_source_type,
    recipient_source_id, responsible_user_id, subcontractor_contract_id,
    material_request_id, work_boq_item_id, needed_date, status, note, created_by
  ) values (
    v_order_id, v_issue_no, nullif(p_project_id, ''),
    nullif(p_construction_site_id, ''), p_source_warehouse_id,
    p_recipient_type, nullif(p_recipient_id, ''), trim(p_recipient_name),
    p_recipient_source_type,
    nullif(trim(coalesce(p_recipient_source_id, '')), ''),
    p_responsible_user_id, nullif(p_subcontractor_contract_id, ''),
    nullif(p_material_request_id, ''), nullif(p_work_boq_item_id, ''),
    p_needed_date, 'draft', nullif(trim(coalesce(p_note, '')), ''), v_actor
  )
  returning * into v_order;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_qty := coalesce(nullif(v_line ->> 'quantity', '')::numeric, 0);
    if coalesce(v_line ->> 'itemId', '') = '' or v_qty <= 0 then
      raise exception 'Dòng vật tư không hợp lệ.';
    end if;

    select * into v_item
    from public.items
    where id = v_line ->> 'itemId';
    if not found then
      raise exception 'Không tìm thấy vật tư %.', v_line ->> 'itemId';
    end if;

    insert into public.material_issue_lines(
      issue_order_id, item_id, sku_snapshot, item_name_snapshot, unit,
      requested_qty, approved_qty, unit_price, material_budget_item_id,
      material_request_line_id, work_boq_item_id,
      subcontractor_contract_id, note
    ) values (
      v_order_id, v_item.id, v_item.sku, v_item.name,
      coalesce(nullif(v_line ->> 'unit', ''), v_item.unit),
      v_qty, v_qty,
      coalesce(nullif(v_line ->> 'unitPrice', '')::numeric, coalesce(v_item.price_in, 0)),
      nullif(v_line ->> 'materialBudgetItemId', ''),
      nullif(v_line ->> 'materialRequestLineId', ''),
      coalesce(nullif(v_line ->> 'workBoqItemId', ''), nullif(p_work_boq_item_id, '')),
      coalesce(
        nullif(v_line ->> 'subcontractorContractId', ''),
        nullif(p_subcontractor_contract_id, '')
      ),
      nullif(trim(coalesce(v_line ->> 'note', '')), '')
    );
  end loop;

  return v_order;
end;
$$;

create or replace function public.submit_material_issue_order(
  p_order_id uuid,
  p_override_reason text default null
)
returns public.material_issue_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_order public.material_issue_orders%rowtype;
  v_transaction_id text := 'tx-material-issue-'
    || replace(gen_random_uuid()::text, '-', '');
  v_items jsonb := '[]'::jsonb;
  v_line record;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  select * into v_order
  from public.material_issue_orders
  where id = p_order_id
  for update;
  if not found then raise exception 'Không tìm thấy phiếu xuất cấp.'; end if;
  if v_order.status not in ('draft', 'submitted') then
    raise exception 'Chỉ gửi duyệt phiếu ở trạng thái nháp.';
  end if;
  if not app_private.material_issue_can_submit(
    v_order.project_id,
    v_order.construction_site_id,
    v_order.source_warehouse_id,
    v_order.created_by
  ) then
    raise exception 'Bạn không có quyền gửi phiếu xuất cấp này.'
      using errcode = '42501';
  end if;

  for v_line in
    select *
    from public.material_issue_lines
    where issue_order_id = p_order_id
    order by created_at
  loop
    if v_line.approved_qty <= 0 then
      raise exception 'Phiếu có dòng số lượng không hợp lệ.';
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'itemId', v_line.item_id,
      'quantity', v_line.approved_qty,
      'price', v_line.unit_price,
      'materialIssueOrderId', v_order.id,
      'materialIssueLineId', v_line.id,
      'recipientType', v_order.recipient_type,
      'recipientNameSnapshot', v_order.recipient_name
    ));
  end loop;

  if jsonb_array_length(v_items) = 0 then
    raise exception 'Phiếu xuất cấp chưa có dòng vật tư.';
  end if;

  insert into public.transactions(
    id, type, date, items, source_warehouse_id, target_warehouse_id,
    requester_id, approver_id, status, note, related_request_id,
    pending_items
  ) values (
    v_transaction_id, 'EXPORT', now(), v_items, v_order.source_warehouse_id,
    null, v_actor, null, 'PENDING',
    coalesce(
      nullif(trim(v_order.note), ''),
      'Xuất cấp thi công ' || v_order.issue_no || ' cho '
        || v_order.recipient_name
    ),
    v_order.material_request_id, '[]'::jsonb
  );

  update public.material_issue_orders
  set status = 'wms_pending',
      transaction_id = v_transaction_id,
      submitted_by = v_actor,
      submitted_at = now(),
      override_reason = nullif(trim(coalesce(p_override_reason, '')), '')
  where id = p_order_id
  returning * into v_order;

  if to_regclass('public.project_document_links') is not null then
    if v_order.material_request_id is not null then
      insert into public.project_document_links(
        source_type, source_id, target_type, target_id, project_id,
        relation_type, status, metadata
      ) values (
        'material_request', v_order.material_request_id,
        'material_issue_order', v_order.id::text, v_order.project_id,
        'downstream', 'active',
        jsonb_build_object(
          'issueNo', v_order.issue_no,
          'transactionId', v_transaction_id
        )
      )
      on conflict (source_type, source_id, target_type, target_id, relation_type)
      do update set
        status = excluded.status,
        metadata = excluded.metadata,
        updated_at = now();
    end if;

    insert into public.project_document_links(
      source_type, source_id, target_type, target_id, project_id,
      relation_type, status, metadata
    ) values (
      'material_issue_order', v_order.id::text, 'transaction',
      v_transaction_id, v_order.project_id, 'downstream', 'active',
      jsonb_build_object('kind', 'external_issue')
    )
    on conflict (source_type, source_id, target_type, target_id, relation_type)
    do update set
      status = excluded.status,
      metadata = excluded.metadata,
      updated_at = now();

    if v_order.subcontractor_contract_id is not null then
      insert into public.project_document_links(
        source_type, source_id, target_type, target_id, project_id,
        relation_type, status, metadata
      ) values (
        'subcontractor_contract', v_order.subcontractor_contract_id,
        'material_issue_order', v_order.id::text, v_order.project_id,
        'downstream', 'active',
        jsonb_build_object('issueNo', v_order.issue_no)
      )
      on conflict (source_type, source_id, target_type, target_id, relation_type)
      do update set
        status = excluded.status,
        metadata = excluded.metadata,
        updated_at = now();
    end if;
  end if;

  return v_order;
end;
$$;

revoke all on function app_private.wms_has_canonical_action(
  text, text, text, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function app_private.wms_has_canonical_action(
  text, text, text, uuid, uuid, uuid
) to service_role;

revoke all on function app_private.material_issue_can_create(text, text, text)
  from public, anon, authenticated;
grant execute on function app_private.material_issue_can_create(text, text, text)
  to service_role;

revoke all on function app_private.material_issue_can_submit(
  text, text, text, uuid
) from public, anon, authenticated;
grant execute on function app_private.material_issue_can_submit(
  text, text, text, uuid
) to service_role;

notify pgrst, 'reload schema';
