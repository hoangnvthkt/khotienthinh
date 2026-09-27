-- Emergency rollback for 20260927..._authorization_p0c_enforce_sensitive_reads.
-- Restores the previous open read policies and the legacy DA write path.
begin;

drop policy if exists project_tx_select on public.project_transactions;
create policy project_tx_select on public.project_transactions for select to authenticated using (true);
drop policy if exists project_finances_select on public.project_finances;
create policy project_finances_select on public.project_finances for select to authenticated using (true);
drop policy if exists cost_items_select on public.project_cost_items;
create policy cost_items_select on public.project_cost_items for select to authenticated using (true);
drop policy if exists advance_payments_select on public.advance_payments;
create policy advance_payments_select on public.advance_payments for select to authenticated using (true);
drop policy if exists project_dashboard_snapshots_select on public.project_dashboard_snapshots;
create policy "Allow authenticated users to read snapshots" on public.project_dashboard_snapshots for select to authenticated using (true);

drop policy if exists project_cost_actuals_select on public.project_cost_actuals;
drop policy if exists project_cost_actuals_admin_write on public.project_cost_actuals;
create policy project_cost_actuals_project_access on public.project_cost_actuals for all to authenticated
  using (project_id is not null or construction_site_id is not null)
  with check (project_id is not null or construction_site_id is not null);

drop policy if exists project_tx_insert on public.project_transactions;
create policy project_tx_insert on public.project_transactions for insert to authenticated
  with check (is_module_admin('DA') or app_private.project_user_has_permission(project_id, construction_site_id, 'edit', current_app_user_id()));
drop policy if exists project_tx_update on public.project_transactions;
create policy project_tx_update on public.project_transactions for update to authenticated
  using (is_module_admin('DA') or app_private.project_user_has_permission(project_id, construction_site_id, 'edit', current_app_user_id()))
  with check (is_module_admin('DA') or app_private.project_user_has_permission(project_id, construction_site_id, 'edit', current_app_user_id()));
drop policy if exists project_tx_delete on public.project_transactions;
create policy project_tx_delete on public.project_transactions for delete to authenticated
  using (is_module_admin('DA') or app_private.project_user_has_permission(project_id, construction_site_id, 'delete', current_app_user_id()));

drop policy if exists project_finances_insert on public.project_finances;
create policy project_finances_insert on public.project_finances for insert to authenticated
  with check (is_module_admin('DA') or app_private.project_user_has_permission(project_id, construction_site_id, 'edit', current_app_user_id()));
drop policy if exists project_finances_update on public.project_finances;
create policy project_finances_update on public.project_finances for update to authenticated
  using (is_module_admin('DA') or app_private.project_user_has_permission(project_id, construction_site_id, 'edit', current_app_user_id()))
  with check (is_module_admin('DA') or app_private.project_user_has_permission(project_id, construction_site_id, 'edit', current_app_user_id()));
drop policy if exists project_finances_delete on public.project_finances;
create policy project_finances_delete on public.project_finances for delete to authenticated
  using (is_module_admin('DA') or app_private.project_user_has_permission(project_id, construction_site_id, 'delete', current_app_user_id()));

drop policy if exists customer_contracts_select on public.customer_contracts;
create policy customer_contracts_select on public.customer_contracts for select to authenticated using (true);
drop policy if exists project_contracts_select on public.project_contracts;
create policy project_contracts_select on public.project_contracts for select to authenticated using (true);
drop policy if exists contract_items_select on public.contract_items;
create policy contract_items_select on public.contract_items for select to authenticated using (true);
drop policy if exists contract_appendices_select on public.contract_appendices;
create policy contract_appendices_select on public.contract_appendices for select to authenticated using (true);
drop policy if exists contract_guarantees_select on public.contract_guarantees;
create policy contract_guarantees_select on public.contract_guarantees for select to authenticated using (true);

drop function if exists public.get_my_sensitive_view_scope();

commit;
