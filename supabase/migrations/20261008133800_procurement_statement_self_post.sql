-- Bảng đối soát HĐ nguyên tắc: bỏ luật "người chốt không tự ghi công nợ" (chủ SP 03/10/2026, giai đoạn hiện tại).
-- Người có quyền ghi nợ (Admin, Tài chính — Ghi sổ, Room Thanh toán — Xác nhận của dự án) ghi được cả bảng do chính mình chốt.
-- Vẫn lưu người chốt (metadata.confirmedBy) và người ghi nợ (posted_by); sự kiện ghi nợ đánh dấu selfPost khi trùng người.
-- Phiếu nhập trực tiếp NCC (FINANCE_DIRECT_RECEIPT_SELF_POST) giữ nguyên.;

CREATE OR REPLACE FUNCTION public.transition_procurement_contract_statement_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_action text := p_input->>'action';
  v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_s public.supplier_delivery_statements%rowtype;
  v_name text := (select name from public.users where id = public.current_app_user_id());
  v_user record;
begin
  select * into v_s from public.supplier_delivery_statements where id = nullif(p_input->>'statementId', '')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'PROCUREMENT_STATEMENT_NOT_FOUND'; end if;

  if v_action in ('confirm', 'withdraw', 'delete') then
    if not app_private.procurement_can('manage') then
      raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  elsif v_action in ('post', 'return') then
    if not app_private.procurement_statement_accountant_ok(v_actor, v_s.project_id, v_s.construction_site_id) then
      raise exception using errcode = '42501', message = 'PROCUREMENT_STATEMENT_POST_DENIED'; end if;
  else
    raise exception using errcode = '22023', message = 'PROCUREMENT_ACTION_INVALID';
  end if;

  perform set_config('app.procurement_hub_context', 'on', true);
  if v_action = 'confirm' then
    if v_s.status <> 'draft' then raise exception using errcode = '22023', message = 'PROCUREMENT_STATEMENT_STATE'; end if;
    if coalesce(v_s.total_amount, 0) <= 0 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_PRICE_MISSING'; end if;
    update public.supplier_delivery_statements set status = 'confirmed',
      metadata = (metadata - 'returnReason') || jsonb_build_object('confirmedBy', v_actor, 'confirmedByName', v_name, 'confirmedAt', now())
    where id = v_s.id returning * into v_s;
    -- Tell the project's accountants (Room Thanh toán — Xác nhận).
    for v_user in select distinct s.user_id from public.project_staff s
      where s.project_id = v_s.project_id and s.user_id is not null and s.user_id <> v_actor::text
        and app_private.project_actor_has_effective_room_action(s.user_id::uuid, v_s.project_id, v_s.construction_site_id, 'payment', 'confirm')
    loop
      insert into public.notifications (user_id, type, category, title, message, body, severity, icon, link, source_type, source_id,
        priority, push_enabled, metadata, delivery_reason)
      values (v_user.user_id, 'info', 'procurement', 'Bảng đối soát HĐ chờ ghi công nợ',
        v_s.code || ' · ' || coalesce(v_s.supplier_name_snapshot, '') || ' — ' || to_char(v_s.total_amount, 'FM999G999G999G999') || ' đ',
        v_s.code || ' · ' || coalesce(v_s.supplier_name_snapshot, '') || ' — ' || to_char(v_s.total_amount, 'FM999G999G999G999') || ' đ',
        'info', '🧾', '/#/da?projectId=' || v_s.project_id || '&tab=material&materialTab=po', 'procurement_statement',
        'procurement_statement:' || v_s.id || ':' || gen_random_uuid(), 'normal', true, jsonb_build_object('statementId', v_s.id), 'responsible');
    end loop;
  elsif v_action = 'withdraw' then
    if v_s.status <> 'confirmed' then raise exception using errcode = '22023', message = 'PROCUREMENT_STATEMENT_STATE'; end if;
    update public.supplier_delivery_statements set status = 'draft' where id = v_s.id returning * into v_s;
  elsif v_action = 'delete' then
    if v_s.status <> 'draft' then raise exception using errcode = '22023', message = 'PROCUREMENT_STATEMENT_STATE'; end if;
    delete from public.supplier_delivery_statement_lines where statement_id = v_s.id;
    delete from public.supplier_delivery_statements where id = v_s.id;
  elsif v_action = 'return' then
    if v_s.status <> 'confirmed' then raise exception using errcode = '22023', message = 'PROCUREMENT_STATEMENT_STATE'; end if;
    if v_reason is null then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_RETURN_REASON_REQUIRED'; end if;
    update public.supplier_delivery_statements set status = 'draft', metadata = metadata || jsonb_build_object('returnReason', v_reason)
    where id = v_s.id returning * into v_s;
    if v_s.metadata->>'confirmedBy' is not null then
      insert into public.notifications (user_id, type, category, title, message, body, severity, icon, link, source_type, source_id,
        priority, push_enabled, metadata, delivery_reason)
      values (v_s.metadata->>'confirmedBy', 'info', 'procurement', 'Bảng đối soát bị trả lại', v_s.code || ': ' || v_reason,
        v_s.code || ': ' || v_reason, 'info', '🧾', '/#/procurement?contract=' || v_s.supplier_contract_id, 'procurement_statement',
        'procurement_statement:' || v_s.id || ':' || gen_random_uuid(), 'normal', true, jsonb_build_object('statementId', v_s.id), 'responsible');
    end if;
  elsif v_action = 'post' then
    if v_s.status <> 'confirmed' then raise exception using errcode = '22023', message = 'PROCUREMENT_STATEMENT_STATE'; end if;
    v_s := public.post_supplier_delivery_statement(v_s.id, v_actor);
  end if;
  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('need', 'statement:' || v_s.id, 'statement_' || v_action, v_actor, v_reason, jsonb_build_object('code', v_s.code)
    || case when v_action = 'post' and v_s.metadata->>'confirmedBy' = v_actor::text then jsonb_build_object('selfPost', true) else '{}'::jsonb end);
  perform set_config('app.procurement_hub_context', 'off', true);
  return jsonb_build_object('statementId', v_s.id, 'status', case when v_action = 'delete' then 'deleted' else v_s.status end);
end;
$$;

CREATE OR REPLACE FUNCTION public.get_procurement_contract_v1(p_contract_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_c public.supplier_contracts%rowtype; v_actor uuid := public.current_app_user_id(); v_buyer boolean := app_private.procurement_can('view');
begin
  select * into v_c from public.supplier_contracts where id = p_contract_id;
  if not found then raise exception using errcode = 'PT404', message = 'PROCUREMENT_CONTRACT_NOT_FOUND'; end if;
  if not app_private.procurement_contract_can_view(v_c) then
    raise exception using errcode = '42501', message = 'PROCUREMENT_VIEW_DENIED'; end if;
  return (
    with dl as materialized (
      select d.*, n.source_delivery_batch_id batch_id, n.purchase_order_id po_id, po.po_number,
        case when b.id is not null then case b.fulfillment_mode when 'DIRECT_CONSUMPTION' then 'direct' else 'stock' end
          when coalesce(l.wms_flow_mode, 'none') <> 'direct_in_out' then 'none'
          when l.wms_status = 'exported' then 'direct'
          when d.wms_ready then 'stock' else 'pending' end stock_state,
        w.name warehouse_name, pr.code project_code,
        (select cp.unit_price from app_private.procurement_contract_price(p_contract_id, d.item_id, d.delivery_date) cp) contract_price
      from app_private.procurement_contract_delivery_lines() d
      join public.supplier_direct_delivery_notes n on n.id = d.note_id
      join public.supplier_direct_delivery_lines l on l.id = d.line_id
      left join public.purchase_order_delivery_batches b on b.id = n.source_delivery_batch_id
      left join public.purchase_orders po on po.id = n.purchase_order_id
      left join public.warehouses w on w.id = l.target_warehouse_id
      left join public.projects pr on pr.id = d.project_id
      where d.contract_id = p_contract_id)
    select jsonb_build_object(
      'id', v_c.id, 'code', v_c.code, 'name', v_c.name, 'type', v_c.type, 'status', v_c.status, 'note', v_c.note,
      'supplierId', v_c.supplier_id, 'supplierName', v_c.supplier_name, 'projectId', v_c.project_id,
      'projectCode', (select code from public.projects where id = v_c.project_id), 'projectName', (select name from public.projects where id = v_c.project_id),
      'constructionSiteId', v_c.construction_site_id, 'value', v_c.value, 'paymentTerms', v_c.payment_terms, 'paymentTermDays', v_c.payment_term_days,
      'signedDate', v_c.signed_date, 'effectiveDate', v_c.effective_date, 'expiryDate', v_c.expiry_date,
      'canManage', app_private.procurement_can('manage'), 'isBuyer', v_buyer,
      'canOrder', app_private.procurement_contract_can_order(v_c.project_id, v_c.construction_site_id)
        and coalesce(v_c.status, '') not in ('cancelled', 'completed'),
      -- Người duyệt khi đơn gọi hàng vượt giá trị HĐ / hạn mức.
      'approvers', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.name)
        from public.users u where u.id <> v_actor and u.is_active and u.account_status = 'ACTIVE'
          and (u.role = 'ADMIN' or app_private.has_permission(u.id, 'system.procurement.manage'))), '[]'::jsonb),
      'priceLines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'lineNo', l.line_no, 'itemId', l.item_id,
          'sku', coalesce(l.sku_snapshot, i.sku), 'name', coalesce(i.name, l.item_name_snapshot), 'unit', coalesce(l.unit_snapshot, i.unit),
          'unitPrice', l.unit_price, 'vatRate', l.vat_rate, 'quantityLimit', l.quantity_limit, 'amountLimit', l.amount_limit,
          'effectiveFrom', l.effective_from, 'effectiveTo', l.effective_to, 'note', l.note,
          'used', exists (select 1 from public.supplier_direct_delivery_lines d where d.supplier_contract_line_id = l.id))
        order by coalesce(i.name, l.item_name_snapshot), l.effective_from nulls first)
        from public.supplier_contract_lines l left join public.items i on i.id = l.item_id where l.supplier_contract_id = p_contract_id), '[]'::jsonb),
      'usage', coalesce((select jsonb_agg(u order by u->>'name') from (
          select jsonb_build_object('itemId', d.item_id, 'name', max(d.item_name), 'unit', max(d.unit),
            'deliveredQty', sum(d.qty), 'deliveredValue', sum(d.amount), 'unpricedLines', count(*) filter (where d.price_source = 'missing'),
            'quantityLimit', (select max(l.quantity_limit) from public.supplier_contract_lines l where l.supplier_contract_id = p_contract_id and l.item_id = d.item_id),
            'amountLimit', (select max(l.amount_limit) from public.supplier_contract_lines l where l.supplier_contract_id = p_contract_id and l.item_id = d.item_id),
            'currentPrice', (select cp.unit_price from app_private.procurement_contract_price(p_contract_id, d.item_id, current_date) cp)) u
          from dl d group by d.item_id) z), '[]'::jsonb),
      'orders', coalesce((select jsonb_agg(jsonb_build_object('id', po.id, 'poNumber', po.po_number, 'status', po.status,
          'totalAmount', po.total_amount, 'vatRate', po.vat_rate, 'expectedDeliveryDate', po.expected_delivery_date,
          'fulfillmentMode', po.fulfillment_mode, 'warehouseName', w.name, 'projectCode', pr.code, 'rowVersion', po.row_version,
          'createdById', po.created_by_id, 'createdByName', (select name from public.users u where u.id::text = po.created_by_id),
          'submittedToName', po.submitted_to_name, 'returnReason', po.metadata->>'returnReason',
          'lines', jsonb_array_length(coalesce(po.items, '[]'::jsonb)),
          'items', po.items, 'targetWarehouseId', po.target_warehouse_id, 'note', po.note, 'purchaseMode', po.purchase_mode,
          'receivedValue', coalesce((select sum(coalesce(dl2.accepted_qty, 0) * coalesce(dl2.delivery_unit_price, 0))
            from public.purchase_order_delivery_lines dl2 join public.purchase_order_delivery_batches b2 on b2.id = dl2.delivery_batch_id
            where dl2.purchase_order_id = po.id and b2.status in ('received', 'received_short', 'received_over')), 0))
        order by po.created_at desc)
        from public.purchase_orders po left join public.warehouses w on w.id = po.target_warehouse_id left join public.projects pr on pr.id = po.project_id
        where po.supplier_contract_id = p_contract_id and po.archived_at is null
          and (v_buyer or po.created_by_id = v_actor::text or app_private.procurement_contract_can_order(po.project_id, po.construction_site_id))), '[]'::jsonb),
      'deliveries', coalesce((select jsonb_agg(jsonb_build_object('noteId', n.note_id, 'code', n.note_code, 'ticketNo', n.ticket_no,
          'date', n.delivery_date, 'purchaseOrderNo', n.po_number, 'projectCode', n.project_code, 'scopeKey', n.scope_key, 'lines', n.lines)
          order by n.delivery_date desc, n.note_code desc)
        from (select note_id, note_code, ticket_no, delivery_date, max(po_number) po_number, max(project_code) project_code,
                coalesce(max(project_id), '') || '|' || coalesce(max(site_id), '') scope_key,
                jsonb_agg(jsonb_build_object('lineId', line_id, 'itemId', item_id,
                'name', item_name, 'unit', unit, 'qty', qty, 'unitPrice', unit_price, 'vatRate', vat_rate, 'priceSource', price_source,
                'amount', amount, 'wmsReady', wms_ready, 'stockState', stock_state, 'warehouseName', warehouse_name,
                'contractPrice', contract_price, 'statementId', statement_id, 'statementCode', statement_code,
                'statementStatus', statement_status) order by item_name) lines
              from dl group by 1, 2, 3, 4 order by delivery_date desc limit 200) n), '[]'::jsonb),
      'statements', case when not v_buyer then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'periodMonth', s.period_month,
          'status', s.status, 'grossAmount', s.gross_amount, 'vatAmount', s.vat_amount, 'totalAmount', s.total_amount,
          'projectCode', (select code from public.projects where id = s.project_id),
          'lineCount', (select count(*) from public.supplier_delivery_statement_lines x where x.statement_id = s.id),
          'createdByName', (select name from public.users where id = s.created_by), 'postedAt', s.posted_at,
          'postedByName', (select name from public.users where id = s.posted_by),
          'confirmedByName', s.metadata->>'confirmedByName', 'confirmedAt', s.metadata->>'confirmedAt',
          'returnReason', s.metadata->>'returnReason', 'note', s.note,
          'canPost', s.status = 'confirmed' and app_private.procurement_statement_accountant_ok(v_actor, s.project_id, s.construction_site_id))
        order by s.period_month desc, s.created_at desc) from public.supplier_delivery_statements s where s.supplier_contract_id = p_contract_id), '[]'::jsonb) end
    )
  );
end;
$$;

CREATE OR REPLACE FUNCTION public.list_finance_pending_statements_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id();
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', st.id, 'code', st.code, 'supplierId', st.supplier_id,
      'supplierName', st.supplier_name_snapshot, 'contractCode', st.supplier_contract_code, 'projectId', st.project_id,
      'projectCode', (select code from public.projects where id = st.project_id), 'periodMonth', st.period_month,
      'statementDate', st.statement_date, 'grossAmount', st.gross_amount, 'vatAmount', st.vat_amount, 'totalAmount', st.total_amount,
      'createdByName', app_private.finance_user_name(st.created_by), 'confirmedByName', st.metadata->>'confirmedByName',
      'confirmedAt', st.metadata->>'confirmedAt',
      'canPost', app_private.procurement_statement_accountant_ok(v_actor, st.project_id, st.construction_site_id)) order by st.statement_date, st.code)
    from public.supplier_delivery_statements st where st.status = 'confirmed'), '[]'::jsonb);
end;
$$;

notify pgrst, 'reload schema';
