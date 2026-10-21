-- V2 (một phần): chọn quy cách tay khi xuất kho (doc 13 mục 9.4, 16.3 — "chọn tay ở V2"; làm 10/10/2026).
--   * Xuất cấp thi công: mỗi dòng phiếu chọn quy cách (material_issue_lines.specification); bỏ trống = tự lấy quy cách
--     nhập trước như V1-3b. Một mã tách được nhiều dòng, mỗi dòng một quy cách. Phiếu kho mang quy cách xuống sổ kho.
--   * Xuất hủy: dòng phiếu kho mang quy cách người lập chọn (giao diện gửi kèm).
--   * Sổ kho: xuất có quy cách mà quy cách đó không đủ → lấy hết phần còn của quy cách đó, phần thiếu lấy quy cách nhập trước
--     (không làm âm tồn quy cách). Hàng trả lại từ công trình về đúng quy cách đã xuất của dòng phiếu xuất cấp.
--   * get_wms_spec_stock_v1: tồn theo quy cách của nhiều mã tại một kho (để chọn trên phiếu).
-- Chuyển kho chưa chọn tay (phiếu chuyển gộp dòng theo mã lúc gửi) — vẫn tự lấy quy cách nhập trước, kho nhận giữ đúng quy cách.

alter table public.material_issue_lines add column if not exists specification text;
comment on column public.material_issue_lines.specification is 'Quy cách người lập chọn khi xuất (trống = tự lấy quy cách nhập trước).';

-- Phân bổ quy cách cho một dòng sổ kho sắp ghi (thay bản V1-3b: thêm xuất chọn quy cách + hàng trả lại theo dòng xuất cấp).
create or replace function app_private.wms_spec_alloc_for_entry(p_inv_tx uuid, p_type text, p_dir text, p_material text, p_warehouse text,
  p_source_code text, p_qty numeric, p_metadata jsonb)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_spec text := nullif(btrim(coalesce(p_metadata->>'specification', '')), '');
  v_orig uuid := app_private.uuid_or_null(p_metadata->>'reversalOfInventoryTransactionId');
  v_issue_line text := nullif(p_metadata->>'materialIssueLineId', '');
  v_pool jsonb; v_have numeric; v_take numeric;
begin
  if v_orig is not null or (p_type = 'transfer_receipt' and nullif(p_source_code, '') is not null)
     or (p_dir = 'in' and v_spec is null and v_issue_line is not null) then
    -- Phiếu đảo / nhận chuyển kho / hàng trả lại từ công trình: lấy lại quy cách của phiếu gốc / phiếu xuất / dòng xuất cấp,
    -- trừ phần các dòng trước đã lấy.
    select coalesce(jsonb_agg(jsonb_build_object('specification', s, 'qty', q) order by k), '[]'::jsonb) into v_pool
    from (select app_private.spec_key(a->>'specification') k, max(nullif(btrim(coalesce(a->>'specification', '')), '')) s,
            sum(case when src then 1 else -1 end * coalesce(nullif(a->>'qty', '')::numeric, 0)) q
          from (select e.metadata, true src from public.inventory_ledger_entries e
                where e.material_id = p_material and jsonb_typeof(e.metadata->'specAllocations') = 'array'
                  and ((v_orig is not null and e.inventory_transaction_id = v_orig)
                    or (v_orig is null and p_type = 'transfer_receipt' and e.transaction_type = 'transfer_issue' and e.source_code = p_source_code)
                    or (v_orig is null and p_type <> 'transfer_receipt' and e.movement_direction = 'out' and e.metadata->>'materialIssueLineId' = v_issue_line))
                union all
                select e.metadata, false from public.inventory_ledger_entries e
                where e.material_id = p_material and jsonb_typeof(e.metadata->'specAllocations') = 'array'
                  and ((v_orig is not null and e.inventory_transaction_id = p_inv_tx)
                    or (v_orig is null and p_type = 'transfer_receipt' and e.transaction_type = 'transfer_receipt' and e.source_code = p_source_code)
                    or (v_orig is null and p_type <> 'transfer_receipt' and e.movement_direction = 'in' and e.metadata->>'materialIssueLineId' = v_issue_line
                      and e.metadata->>'reversalOfInventoryTransactionId' is null))) x
          cross join lateral jsonb_array_elements(x.metadata->'specAllocations') a
          group by 1 having sum(case when src then 1 else -1 end * coalesce(nullif(a->>'qty', '')::numeric, 0)) > 0.0000005) z;
    return app_private.wms_spec_take(v_pool, p_qty, v_spec);
  elsif p_dir = 'in' then
    return app_private.wms_spec_alloc_add('[]'::jsonb, v_spec, p_qty);
  end if;
  -- Xuất: quy cách ghi trên phiếu trước (tối đa phần còn của quy cách đó), phần còn lại lấy quy cách nhập trước.
  select coalesce(jsonb_agg(jsonb_build_object('specification', b.specification, 'qty', b.qty)
      order by (v_spec is not null and b.spec_key = app_private.spec_key(v_spec)) desc, b.first_in nulls last, b.spec_key), '[]'::jsonb),
    coalesce(sum(b.qty) filter (where v_spec is not null and b.spec_key = app_private.spec_key(v_spec)), 0)
  into v_pool, v_have from app_private.wms_spec_balances(p_material, p_warehouse) b where b.qty > 0.0000005;
  if v_spec is not null and v_have <= 0.0000005 and not exists (select 1 from jsonb_array_elements(v_pool)) then
    -- Không còn tồn theo quy cách nào (vd nhập–xuất thẳng chưa ghi sổ nhập): ghi đúng quy cách trên phiếu.
    return app_private.wms_spec_alloc_add('[]'::jsonb, v_spec, p_qty);
  end if;
  return app_private.wms_spec_take(v_pool, p_qty, v_spec);
end;
$$;

-- Tồn theo quy cách của nhiều mã tại một kho (thứ tự = thứ tự xuất tự động). Chỉ trả mã có quy cách đặt tên.
create or replace function public.get_wms_spec_stock_v1(p_warehouse_id text, p_item_ids text[])
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not (app_private.wms_has_action('wms.inventory.view', p_warehouse_id, p_warehouse_id) or app_private.wms_has_action('wms.inventory.edit', p_warehouse_id, p_warehouse_id)
      or app_private.wms_has_action('wms.transaction.create', p_warehouse_id, p_warehouse_id)) then
    raise exception using errcode = '42501', message = 'WMS_STOCK_VIEW_DENIED';
  end if;
  return coalesce((select jsonb_object_agg(x.id, x.specs) from (
    select i.id, (select jsonb_agg(jsonb_build_object('specification', b.specification, 'qty', b.qty) order by b.first_in nulls last, b.spec_key)
        from app_private.wms_spec_balances(i.id, p_warehouse_id) b where b.qty > 0.0000005) specs
    from unnest(p_item_ids) i(id)) x
    where x.specs is not null and exists (select 1 from jsonb_array_elements(x.specs) s where s->>'specification' is not null)), '{}'::jsonb);
end;
$$;

CREATE OR REPLACE FUNCTION public.create_material_issue_order(p_project_id text, p_construction_site_id text, p_source_warehouse_id text, p_recipient_type text, p_recipient_id text, p_recipient_name text, p_responsible_user_id uuid, p_subcontractor_contract_id text, p_material_request_id text, p_work_boq_item_id text, p_needed_date date, p_note text, p_lines jsonb, p_recipient_source_type text DEFAULT NULL::text, p_recipient_source_id text DEFAULT NULL::text)
 RETURNS public.material_issue_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      subcontractor_contract_id, note, specification
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
      nullif(trim(coalesce(v_line ->> 'note', '')), ''),
      left(nullif(btrim(regexp_replace(coalesce(v_line ->> 'specification', ''), '\s+', ' ', 'g')), ''), 80)
    );
  end loop;

  return v_order;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.submit_material_issue_order(p_order_id uuid, p_override_reason text DEFAULT NULL::text)
 RETURNS public.material_issue_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    ) || case when v_line.specification is not null then jsonb_build_object('specification', v_line.specification) else '{}'::jsonb end);
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
$function$
;


revoke all on function public.get_wms_spec_stock_v1(text, text[]) from public, anon;
grant execute on function public.get_wms_spec_stock_v1(text, text[]) to authenticated;

notify pgrst, 'reload schema';
