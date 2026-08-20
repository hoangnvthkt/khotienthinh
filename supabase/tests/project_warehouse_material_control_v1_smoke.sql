-- Run after 20260820025355_project_warehouse_material_control_v1.sql.
-- The transaction makes this safe to execute against Supabase Cloud.
begin;

do $$
declare
  v_count integer;
begin
  if to_regprocedure('public.post_material_issue_settlement_v1(uuid,text,date,jsonb,text,text,jsonb)') is null then
    raise exception 'Missing post_material_issue_settlement_v1 RPC';
  end if;
  if to_regprocedure('public.reverse_material_issue_settlement_v1(uuid,text,text)') is null then
    raise exception 'Missing reverse_material_issue_settlement_v1 RPC';
  end if;
  if to_regprocedure('public.get_project_material_boq_reconciliation(text,text,date,numeric)') is null then
    raise exception 'Missing project material reconciliation RPC';
  end if;

  if app_private.classify_wms_business_event('IMPORT', 'po_delivery_batch', 'request-1',
       '[{"purchaseOrderLineId":"line-1"}]'::jsonb) <> 'request_po_receipt' then
    raise exception 'Request/PO receipt classification failed';
  end if;
  if app_private.classify_wms_business_event('IMPORT', 'po_delivery_batch', null,
       '[{"purchaseOrderLineId":"line-1"}]'::jsonb) <> 'proactive_po_receipt' then
    raise exception 'Proactive PO receipt classification failed';
  end if;
  if app_private.classify_wms_business_event('IMPORT', 'site_direct_purchase', null, '[]'::jsonb)
       <> 'site_hot_purchase_receipt' then
    raise exception 'Site hot-purchase classification failed';
  end if;
  if app_private.classify_wms_business_event('IMPORT', 'supplier_direct_delivery_note', null, '[]'::jsonb)
       <> 'direct_supplier_receipt' then
    raise exception 'Direct supplier receipt classification failed';
  end if;

  select count(*) into v_count
  from public.warehouses warehouse
  where warehouse.type = 'SITE'
    and not coalesce(warehouse.is_archived, false)
    and (warehouse.project_id is null or warehouse.construction_site_id is null);
  if v_count <> 0 then
    raise exception '% active SITE warehouses remain outside project/site scope', v_count;
  end if;

  select count(*) into v_count
  from public.warehouses warehouse
  join public.projects project on project.id = warehouse.project_id
  where project.code = 'PRJ-240AC280';
  if v_count <> 0 then
    raise exception 'Removed project PRJ-240AC280 is still attached to a warehouse';
  end if;

  select count(*) into v_count
  from public.inventory_ledger_entries entry
  join public.warehouses warehouse on warehouse.id = entry.warehouse_id
  where warehouse.type = 'SITE'
    and not coalesce(warehouse.is_archived, false)
    and (entry.project_id is distinct from warehouse.project_id
      or entry.construction_site_id is distinct from warehouse.construction_site_id::text);
  if v_count <> 0 then
    raise exception '% SITE ledger entries do not match warehouse scope', v_count;
  end if;

  select count(*) into v_count
  from public.material_issue_lines issue_line
  where coalesce(issue_line.consumed_qty, 0) < 0
     or coalesce(issue_line.returned_qty, 0) < 0
     or coalesce(issue_line.lost_qty, 0) < 0
     or coalesce(issue_line.consumed_qty, 0)
        + coalesce(issue_line.returned_qty, 0)
        + coalesce(issue_line.lost_qty, 0) > coalesce(issue_line.issued_qty, 0);
  if v_count <> 0 then
    raise exception '% issue lines violate the settlement quantity equation', v_count;
  end if;
end $$;

do $$
declare
  v_actor_id uuid;
  v_actor_auth_id uuid;
  v_actor_email text;
  v_warehouse_id text;
  v_project_id text;
  v_site_id text;
  v_item_id text;
  v_item_name text;
  v_item_unit text;
  v_prefix text := 'v1-smoke-' || replace(gen_random_uuid()::text, '-', '');
  v_order_id uuid := gen_random_uuid();
  v_line_id uuid := gen_random_uuid();
  v_consume_settlement_id uuid;
  v_loss_settlement_id uuid;
  v_baseline_gross numeric := 0;
  v_after_gross numeric := 0;
  v_baseline_request numeric := 0;
  v_baseline_proactive numeric := 0;
  v_baseline_hot numeric := 0;
  v_baseline_supplier numeric := 0;
  v_after_request numeric := 0;
  v_after_proactive numeric := 0;
  v_after_hot numeric := 0;
  v_after_supplier numeric := 0;
  v_baseline_used numeric := 0;
  v_baseline_loss numeric := 0;
  v_after_used numeric := 0;
  v_after_loss numeric := 0;
  v_consumed numeric;
  v_lost numeric;
  v_open numeric;
  v_count integer;
  v_rejected boolean := false;
begin
  select app_user.id, app_user.auth_id, app_user.email
  into v_actor_id, v_actor_auth_id, v_actor_email
  from public.users app_user
  where app_user.auth_id is not null
    and app_user.role::text ilike 'admin'
    and coalesce(app_user.is_active, true)
  order by app_user.created_at
  limit 1;
  if v_actor_id is null then raise exception 'Smoke test needs one active authenticated admin'; end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_actor_auth_id::text,
      'email', v_actor_email,
      'role', 'authenticated'
    )::text,
    true
  );

  select warehouse.id, warehouse.project_id, warehouse.construction_site_id::text
  into v_warehouse_id, v_project_id, v_site_id
  from public.warehouses warehouse
  where warehouse.type = 'SITE'
    and not coalesce(warehouse.is_archived, false)
  order by warehouse.id
  limit 1;
  if v_warehouse_id is null then raise exception 'Smoke test needs one active SITE warehouse'; end if;

  select item.id, item.name, item.unit
  into v_item_id, v_item_name, v_item_unit
  from public.items item
  order by item.id
  limit 1;
  if v_item_id is null then raise exception 'Smoke test needs one inventory item'; end if;

  select
    coalesce(report.gross_received_qty, 0),
    coalesce(report.request_po_receipt_qty, 0),
    coalesce(report.proactive_po_receipt_qty, 0),
    coalesce(report.site_hot_purchase_receipt_qty, 0),
    coalesce(report.direct_supplier_receipt_qty, 0),
    coalesce(report.confirmed_used_qty, 0),
    coalesce(report.loss_after_issue_qty, 0)
  into
    v_baseline_gross, v_baseline_request, v_baseline_proactive,
    v_baseline_hot, v_baseline_supplier, v_baseline_used, v_baseline_loss
  from public.get_project_material_boq_reconciliation(
    v_project_id, v_site_id, current_date, 50
  ) report
  where report.inventory_item_id = v_item_id;

  insert into public.transactions(
    id, type, date, items, target_warehouse_id, requester_id, approver_id,
    status, note, source_type, source_id
  ) values
  (
    v_prefix || '-request', 'IMPORT', now(),
    jsonb_build_array(jsonb_build_object(
      'itemId', v_item_id, 'quantity', 1,
      'purchaseOrderLineId', v_prefix || '-po-line',
      'materialRequestId', v_prefix || '-request'
    )),
    v_warehouse_id, v_actor_id, v_actor_id, 'COMPLETED',
    'V1 smoke request/PO receipt', 'po_delivery_batch', v_prefix || '-batch-request'
  ),
  (
    v_prefix || '-proactive', 'IMPORT', now(),
    jsonb_build_array(jsonb_build_object(
      'itemId', v_item_id, 'quantity', 1,
      'purchaseOrderLineId', v_prefix || '-po-line-proactive'
    )),
    v_warehouse_id, v_actor_id, v_actor_id, 'COMPLETED',
    'V1 smoke proactive PO receipt', 'po_delivery_batch', v_prefix || '-batch-proactive'
  ),
  (
    v_prefix || '-hot', 'IMPORT', now(),
    jsonb_build_array(jsonb_build_object('itemId', v_item_id, 'quantity', 1)),
    v_warehouse_id, v_actor_id, v_actor_id, 'COMPLETED',
    'V1 smoke site hot-purchase receipt', 'site_direct_purchase', v_prefix || '-hot-source'
  ),
  (
    v_prefix || '-supplier', 'IMPORT', now(),
    jsonb_build_array(jsonb_build_object('itemId', v_item_id, 'quantity', 1)),
    v_warehouse_id, v_actor_id, v_actor_id, 'COMPLETED',
    'V1 smoke direct supplier receipt', 'supplier_direct_delivery_note', v_prefix || '-supplier-source'
  );

  select count(*) into v_count
  from public.inventory_ledger_entries entry
  where entry.source_type = 'wms_transaction'
    and entry.source_id like v_prefix || '-%'
    and entry.project_id = v_project_id
    and entry.construction_site_id = v_site_id
    and entry.business_event_type in (
      'request_po_receipt', 'proactive_po_receipt',
      'site_hot_purchase_receipt', 'direct_supplier_receipt'
    );
  if v_count <> 4 then
    raise exception 'Expected four scoped receipt ledger entries, found %', v_count;
  end if;

  select
    coalesce(report.gross_received_qty, 0),
    coalesce(report.request_po_receipt_qty, 0),
    coalesce(report.proactive_po_receipt_qty, 0),
    coalesce(report.site_hot_purchase_receipt_qty, 0),
    coalesce(report.direct_supplier_receipt_qty, 0)
  into
    v_after_gross, v_after_request, v_after_proactive,
    v_after_hot, v_after_supplier
  from public.get_project_material_boq_reconciliation(
    v_project_id, v_site_id, current_date, 50
  ) report
  where report.inventory_item_id = v_item_id;
  if v_after_gross - v_baseline_gross <> 4
     or v_after_request - v_baseline_request <> 1
     or v_after_proactive - v_baseline_proactive <> 1
     or v_after_hot - v_baseline_hot <> 1
     or v_after_supplier - v_baseline_supplier <> 1 then
    raise exception 'Reconciliation receipt drill-down does not equal smoke movements';
  end if;

  begin
    insert into public.transactions(
      id, type, date, items, target_warehouse_id, requester_id, approver_id,
      status, note, business_event_type, business_event_reason
    ) values (
      v_prefix || '-wrong-scope', 'IMPORT', now(),
      jsonb_build_array(jsonb_build_object(
        'itemId', v_item_id, 'quantity', 1,
        'projectId', 'scope-that-must-not-match'
      )),
      v_warehouse_id, v_actor_id, v_actor_id, 'COMPLETED',
      'V1 smoke invalid scope', 'direct_manual_receipt', 'V1 smoke invalid scope'
    );
  exception when others then
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'Cross-scope completed movement was accepted'; end if;

  insert into public.material_issue_orders(
    id, issue_no, project_id, construction_site_id, source_warehouse_id,
    recipient_type, recipient_name, responsible_user_id, status, created_by
  ) values (
    v_order_id, upper(v_prefix), v_project_id, v_site_id, v_warehouse_id,
    'manual', 'V1 smoke recipient', v_actor_id, 'issued', v_actor_id
  );
  insert into public.material_issue_lines(
    id, issue_order_id, item_id, sku_snapshot, item_name_snapshot, unit,
    requested_qty, approved_qty, issued_qty, received_qty
  )
  select v_line_id, v_order_id, item.id, item.sku, item.name, item.unit, 10, 10, 10, 10
  from public.items item where item.id = v_item_id;
  insert into public.material_party_ledger(
    issue_order_id, issue_line_id, source_document_type, source_document_id,
    ledger_type, project_id, construction_site_id, recipient_type,
    recipient_name, item_id, item_name_snapshot, unit, quantity_delta,
    reason, created_by
  ) values (
    v_order_id, v_line_id, 'material_issue_order', v_order_id::text,
    'issue', v_project_id, v_site_id, 'manual', 'V1 smoke recipient',
    v_item_id, v_item_name, v_item_unit, 10, 'V1 smoke issue', v_actor_id
  );

  select settlement.id into v_consume_settlement_id
  from public.post_material_issue_settlement_v1(
    v_order_id, 'consume', current_date,
    jsonb_build_array(jsonb_build_object('issueLineId', v_line_id, 'quantity', 4)),
    'V1 smoke consumed', v_prefix || '-consume', '[]'::jsonb
  ) settlement;
  select settlement.id into v_loss_settlement_id
  from public.post_material_issue_settlement_v1(
    v_order_id, 'loss', current_date,
    jsonb_build_array(jsonb_build_object('issueLineId', v_line_id, 'quantity', 1)),
    'V1 smoke loss', v_prefix || '-loss', '[]'::jsonb
  ) settlement;

  select issue_line.consumed_qty, issue_line.lost_qty,
    issue_line.issued_qty - issue_line.returned_qty
      - issue_line.consumed_qty - issue_line.lost_qty
  into v_consumed, v_lost, v_open
  from public.material_issue_lines issue_line where issue_line.id = v_line_id;
  if v_consumed <> 4 or v_lost <> 1 or v_open <> 5 then
    raise exception 'Settlement equation failed after consume/loss posting';
  end if;

  select coalesce(report.confirmed_used_qty, 0), coalesce(report.loss_after_issue_qty, 0)
  into v_after_used, v_after_loss
  from public.get_project_material_boq_reconciliation(
    v_project_id, v_site_id, current_date, 50
  ) report
  where report.inventory_item_id = v_item_id;
  if v_after_used - v_baseline_used <> 4 or v_after_loss - v_baseline_loss <> 1 then
    raise exception 'Reconciliation settlement drill-down does not match posted documents';
  end if;

  perform public.reverse_material_issue_settlement_v1(
    v_consume_settlement_id, 'V1 smoke reversal', v_prefix || '-reverse-consume'
  );
  select issue_line.consumed_qty, issue_line.lost_qty,
    issue_line.issued_qty - issue_line.returned_qty
      - issue_line.consumed_qty - issue_line.lost_qty
  into v_consumed, v_lost, v_open
  from public.material_issue_lines issue_line where issue_line.id = v_line_id;
  if v_consumed <> 0 or v_lost <> 1 or v_open <> 9 then
    raise exception 'Settlement reversal equation failed';
  end if;
  if v_loss_settlement_id is null then raise exception 'Loss settlement was not created'; end if;
end $$;

rollback;
