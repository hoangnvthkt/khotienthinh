-- Run after the supplier-direct-delivery WMS business-event/permission remediation migration.
-- Read-only assertions wrapped in a transaction make this safe on Supabase Cloud.
begin;

set local statement_timeout = '30s';

do $$
declare
  v_active_action_count integer;
  v_unclassified_export_count integer;
begin
  if app_private.classify_wms_business_event(
    'EXPORT',
    'supplier_direct_delivery_note',
    'supplier-direct-delivery:00000000-0000-0000-0000-000000000001',
    '[{"supplierDirectDeliveryNoteId":"00000000-0000-0000-0000-000000000001"}]'::jsonb
  ) is distinct from 'construction_issue' then
    raise exception 'Supplier direct-delivery export classification failed';
  end if;

  select count(*)
  into v_active_action_count
  from public.permission_actions action_row
  where action_row.module_code = 'project.material_supplier_delivery'
    and action_row.permission_code in (
      'project.material_supplier_delivery.view',
      'project.material_supplier_delivery.create',
      'project.material_supplier_delivery.edit',
      'project.material_supplier_delivery.delete',
      'project.material_supplier_delivery.record',
      'project.material_supplier_delivery.unrecord',
      'project.material_supplier_delivery.reconcile'
    )
    and action_row.is_active;

  if v_active_action_count <> 7 then
    raise exception 'Expected 7 active supplier-delivery actions, found %', v_active_action_count;
  end if;

  select count(*)
  into v_unclassified_export_count
  from public.transactions transaction_row
  where transaction_row.type::text = 'EXPORT'
    and transaction_row.business_event_type is null
    and (
      lower(coalesce(transaction_row.source_type, '')) = 'supplier_direct_delivery_note'
      or exists (
        select 1
        from jsonb_array_elements(coalesce(transaction_row.items, '[]'::jsonb)) line
        where nullif(line->>'supplierDirectDeliveryNoteId', '') is not null
      )
    );

  if v_unclassified_export_count <> 0 then
    raise exception '% supplier direct-delivery exports remain unclassified', v_unclassified_export_count;
  end if;
end;
$$;

rollback;
