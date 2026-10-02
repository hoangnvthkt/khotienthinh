-- Contracts module: writes follow the permissions shown in the app (contract.*.manage), not only
-- Admin or the retired "HD module admin". Admin and system.hd.manage keep working.
--   Partners -> contract.partner.manage; customer contracts -> contract.customer.manage;
--   supplier and subcontractor contracts -> contract.supplier.manage; guarantees -> either;
--   contract types/templates -> contract.template.manage;
--   cost library -> contract.cost_library.manage or system.tender_ai.manage.
-- No non-admin holds a contract.*.manage grant today, so nobody gains access by this alone.

create or replace function app_private.contract_actor_can_manage(p_codes text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or public.is_module_admin('HD')
    or exists (
      select 1 from unnest(p_codes) as code(permission_code)
      where app_private.has_permission(public.current_app_user_id(), code.permission_code, 'global', '*')
    );
$$;
revoke all on function app_private.contract_actor_can_manage(text[]) from public, anon;
grant execute on function app_private.contract_actor_can_manage(text[]) to authenticated;

alter policy business_partners_delete on public.business_partners using ((select app_private.contract_actor_can_manage(array['contract.partner.manage'])));
alter policy business_partners_insert on public.business_partners with check ((select app_private.contract_actor_can_manage(array['contract.partner.manage'])));
alter policy business_partners_update on public.business_partners using ((select app_private.contract_actor_can_manage(array['contract.partner.manage']))) with check ((select app_private.contract_actor_can_manage(array['contract.partner.manage'])));
alter policy contract_form_templates_delete on public.contract_form_templates using ((select app_private.contract_actor_can_manage(array['contract.template.manage'])));
alter policy contract_form_templates_insert on public.contract_form_templates with check ((select app_private.contract_actor_can_manage(array['contract.template.manage'])));
alter policy contract_form_templates_update on public.contract_form_templates using ((select app_private.contract_actor_can_manage(array['contract.template.manage']))) with check ((select app_private.contract_actor_can_manage(array['contract.template.manage'])));
alter policy contract_guarantees_delete on public.contract_guarantees using ((select app_private.contract_actor_can_manage(array['contract.customer.manage', 'contract.supplier.manage'])));
alter policy contract_guarantees_insert on public.contract_guarantees with check ((select app_private.contract_actor_can_manage(array['contract.customer.manage', 'contract.supplier.manage'])));
alter policy contract_guarantees_update on public.contract_guarantees using ((select app_private.contract_actor_can_manage(array['contract.customer.manage', 'contract.supplier.manage']))) with check ((select app_private.contract_actor_can_manage(array['contract.customer.manage', 'contract.supplier.manage'])));
alter policy contract_template_fields_delete on public.contract_template_fields using ((select app_private.contract_actor_can_manage(array['contract.template.manage'])));
alter policy contract_template_fields_insert on public.contract_template_fields with check ((select app_private.contract_actor_can_manage(array['contract.template.manage'])));
alter policy contract_template_fields_update on public.contract_template_fields using ((select app_private.contract_actor_can_manage(array['contract.template.manage']))) with check ((select app_private.contract_actor_can_manage(array['contract.template.manage'])));
alter policy contract_template_sections_delete on public.contract_template_sections using ((select app_private.contract_actor_can_manage(array['contract.template.manage'])));
alter policy contract_template_sections_insert on public.contract_template_sections with check ((select app_private.contract_actor_can_manage(array['contract.template.manage'])));
alter policy contract_template_sections_update on public.contract_template_sections using ((select app_private.contract_actor_can_manage(array['contract.template.manage']))) with check ((select app_private.contract_actor_can_manage(array['contract.template.manage'])));
alter policy contract_type_metadata_delete on public.contract_type_metadata using ((select app_private.contract_actor_can_manage(array['contract.template.manage'])));
alter policy contract_type_metadata_insert on public.contract_type_metadata with check ((select app_private.contract_actor_can_manage(array['contract.template.manage'])));
alter policy contract_type_metadata_update on public.contract_type_metadata using ((select app_private.contract_actor_can_manage(array['contract.template.manage']))) with check ((select app_private.contract_actor_can_manage(array['contract.template.manage'])));
alter policy cost_norm_import_batches_manage on public.cost_norm_import_batches using ((select app_private.contract_actor_can_manage(array['contract.cost_library.manage', 'system.tender_ai.manage']))) with check ((select app_private.contract_actor_can_manage(array['contract.cost_library.manage', 'system.tender_ai.manage'])));
alter policy cost_template_items_manage on public.cost_template_items using ((select app_private.contract_actor_can_manage(array['contract.cost_library.manage', 'system.tender_ai.manage']))) with check ((select app_private.contract_actor_can_manage(array['contract.cost_library.manage', 'system.tender_ai.manage'])));
alter policy cost_template_parameters_manage on public.cost_template_parameters using ((select app_private.contract_actor_can_manage(array['contract.cost_library.manage', 'system.tender_ai.manage']))) with check ((select app_private.contract_actor_can_manage(array['contract.cost_library.manage', 'system.tender_ai.manage'])));
alter policy cost_template_sections_manage on public.cost_template_sections using ((select app_private.contract_actor_can_manage(array['contract.cost_library.manage', 'system.tender_ai.manage']))) with check ((select app_private.contract_actor_can_manage(array['contract.cost_library.manage', 'system.tender_ai.manage'])));
alter policy cost_templates_manage on public.cost_templates using ((select app_private.contract_actor_can_manage(array['contract.cost_library.manage', 'system.tender_ai.manage']))) with check ((select app_private.contract_actor_can_manage(array['contract.cost_library.manage', 'system.tender_ai.manage'])));
alter policy customer_contracts_delete on public.customer_contracts using ((select app_private.contract_actor_can_manage(array['contract.customer.manage'])));
alter policy customer_contracts_insert on public.customer_contracts with check ((select app_private.contract_actor_can_manage(array['contract.customer.manage'])));
alter policy customer_contracts_update on public.customer_contracts using ((select app_private.contract_actor_can_manage(array['contract.customer.manage']))) with check ((select app_private.contract_actor_can_manage(array['contract.customer.manage'])));
alter policy internal_norms_manage on public.internal_norms using ((select app_private.contract_actor_can_manage(array['contract.cost_library.manage', 'system.tender_ai.manage']))) with check ((select app_private.contract_actor_can_manage(array['contract.cost_library.manage', 'system.tender_ai.manage'])));
alter policy internal_price_book_manage on public.internal_price_book using ((select app_private.contract_actor_can_manage(array['contract.cost_library.manage', 'system.tender_ai.manage']))) with check ((select app_private.contract_actor_can_manage(array['contract.cost_library.manage', 'system.tender_ai.manage'])));
alter policy subcontractor_contracts_delete on public.subcontractor_contracts using ((select app_private.contract_actor_can_manage(array['contract.supplier.manage'])));
alter policy subcontractor_contracts_insert on public.subcontractor_contracts with check ((select app_private.contract_actor_can_manage(array['contract.supplier.manage'])));
alter policy subcontractor_contracts_update on public.subcontractor_contracts using ((select app_private.contract_actor_can_manage(array['contract.supplier.manage']))) with check ((select app_private.contract_actor_can_manage(array['contract.supplier.manage'])));
alter policy supplier_contracts_delete on public.supplier_contracts using ((select app_private.contract_actor_can_manage(array['contract.supplier.manage'])));
alter policy supplier_contracts_insert on public.supplier_contracts with check ((select app_private.contract_actor_can_manage(array['contract.supplier.manage'])));
alter policy supplier_contracts_update on public.supplier_contracts using ((select app_private.contract_actor_can_manage(array['contract.supplier.manage']))) with check ((select app_private.contract_actor_can_manage(array['contract.supplier.manage'])));

-- The Admin-only write guard made the policies above irrelevant for subcontracts.
drop trigger if exists authorization_v2_admin_write_guard on public.subcontractor_contracts;

