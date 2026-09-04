-- Classify the WMS EXPORT automatically created after a direct supplier
-- delivery IMPORT as a construction issue. The V1 classifier handled the
-- receipt side only, leaving the matching export without a business purpose.
create or replace function app_private.classify_wms_business_event(
  p_type text,
  p_source_type text,
  p_related_request_id text,
  p_items jsonb
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_type = 'TRANSFER' then 'warehouse_transfer'
    when p_type = 'LIQUIDATION' then 'warehouse_loss'
    when p_type = 'ADJUSTMENT' then 'inventory_adjustment'
    when p_type = 'IMPORT' and exists (
      select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) line
      where nullif(line->>'materialIssueReturnId', '') is not null
    ) then 'project_return_receipt'
    when p_type = 'IMPORT' and lower(coalesce(p_source_type, '')) = 'site_direct_purchase'
      then 'site_hot_purchase_receipt'
    when p_type = 'IMPORT' and (
      lower(coalesce(p_source_type, '')) in ('supplier_direct_delivery_note', 'supplier_contract')
      or exists (
        select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) line
        where nullif(line->>'supplierDirectDeliveryNoteId', '') is not null
      )
    ) then 'direct_supplier_receipt'
    when p_type = 'IMPORT' and (
      lower(coalesce(p_source_type, '')) in ('po_delivery_batch', 'po_receipt')
      or exists (
        select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) line
        where nullif(line->>'purchaseOrderLineId', '') is not null
      )
    ) and (
      p_related_request_id is not null
      or exists (
        select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) line
        where nullif(line->>'materialRequestId', '') is not null
           or nullif(line->>'requestLineId', '') is not null
      )
    ) then 'request_po_receipt'
    when p_type = 'IMPORT' and lower(coalesce(p_source_type, '')) in ('po_delivery_batch', 'po_receipt')
      then 'proactive_po_receipt'
    when p_type = 'EXPORT' and (
      lower(coalesce(p_source_type, '')) = 'supplier_direct_delivery_note'
      or exists (
        select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) line
        where nullif(line->>'supplierDirectDeliveryNoteId', '') is not null
          and coalesce(line->>'supplierDeliveryWmsFlow', '') = 'direct_in_out'
      )
    ) then 'construction_issue'
    when p_type = 'EXPORT' and exists (
      select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) line
      where nullif(line->>'materialIssueOrderId', '') is not null
        and nullif(line->>'materialIssueReturnId', '') is null
    ) then 'construction_issue'
    when p_type = 'EXPORT' and (
      lower(coalesce(p_source_type, '')) in ('supplier_return', 'purchase_order_supplier_return')
      or exists (
        select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) line
        where nullif(line->>'supplierReturnId', '') is not null
      )
    ) then 'supplier_return'
    else null
  end;
$$;

-- Repair pending/historical direct-delivery exports produced before the
-- classifier understood this source. Updating the business-event column also
-- passes through the existing scope guard trigger.
update public.transactions transaction_row
set business_event_type = app_private.classify_wms_business_event(
      transaction_row.type::text,
      transaction_row.source_type,
      transaction_row.related_request_id,
      transaction_row.items
    )
where transaction_row.type::text = 'EXPORT'
  and transaction_row.business_event_type is null
  and app_private.classify_wms_business_event(
        transaction_row.type::text,
        transaction_row.source_type,
        transaction_row.related_request_id,
        transaction_row.items
      ) = 'construction_issue';

-- Publish the existing permission catalog namespace now that the client
-- registry exposes it in the user permission matrix.
update public.permission_modules
set is_active = true,
    updated_at = now()
where code = 'project.material_supplier_delivery';

update public.permission_actions
set is_active = true,
    access_application_code = 'project',
    updated_at = now()
where module_code = 'project.material_supplier_delivery'
  and permission_code in (
    'project.material_supplier_delivery.view',
    'project.material_supplier_delivery.create',
    'project.material_supplier_delivery.edit',
    'project.material_supplier_delivery.delete',
    'project.material_supplier_delivery.record',
    'project.material_supplier_delivery.unrecord',
    'project.material_supplier_delivery.reconcile'
  );

notify pgrst, 'reload schema';
