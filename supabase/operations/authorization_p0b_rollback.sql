-- Rollback for authorization P0-B part 1 (restrict client writes).
-- Restores the pre-P0-B write policies captured on 2026-09-27. Operator use
-- only: it re-opens the write exposures described in the audit.
-- Part 2 (broadcast state and avatars) is rolled back by reverting
-- notifications_update to include `user_id IS NULL`; avatar URLs are not restored.
begin;

drop trigger if exists audit_trail_stamp_actor on public.audit_trail;
drop trigger if exists activities_stamp_actor on public.activities;
drop function if exists app_private.stamp_client_log_actor();
alter policy audit_trail_insert on public.audit_trail to public;
alter policy activities_write on public.activities to public;
create policy rq_logs_write on public.request_logs for insert to public with check (true);

drop policy if exists user_signatures_insert_own on public.user_signatures;
drop policy if exists user_signatures_update_own on public.user_signatures;
drop policy if exists user_signatures_delete_own on public.user_signatures;
create policy "Users can manage own signature" on public.user_signatures for insert to authenticated with check (true);
create policy "Users can update own signature" on public.user_signatures for update to authenticated using (true);
create policy "Users can delete own signature" on public.user_signatures for delete to authenticated using (true);

drop policy if exists dashboard_layouts_own on public.dashboard_layouts;
create policy dashboard_layouts_all_access on public.dashboard_layouts for all to public using (true) with check (true);
drop policy if exists user_xp_select on public.user_xp;
create policy user_xp_all_access on public.user_xp for all to public using (true) with check (true);
drop policy if exists xp_events_select on public.xp_events;
create policy xp_events_all_access on public.xp_events for all to public using (true) with check (true);

drop policy if exists salary_3p_settings_select on public.salary_3p_settings;
drop policy if exists salary_3p_settings_admin_write on public.salary_3p_settings;
create policy "Allow all for authenticated users" on public.salary_3p_settings for all to public using (true) with check (true);
drop policy if exists kpi_periods_select on public.kpi_periods;
drop policy if exists kpi_periods_admin_write on public.kpi_periods;
create policy "Allow all for authenticated users" on public.kpi_periods for all to public using (true) with check (true);
drop policy if exists kpi_rating_configs_select on public.kpi_rating_configs;
drop policy if exists kpi_rating_configs_admin_write on public.kpi_rating_configs;
create policy "Allow all for authenticated users" on public.kpi_rating_configs for all to public using (true) with check (true);
drop policy if exists kpi_scores_select on public.kpi_scores;
drop policy if exists kpi_scores_admin_write on public.kpi_scores;
create policy "Allow all for authenticated users" on public.kpi_scores for all to public using (true) with check (true);

drop policy if exists ranking_criteria_select on public.ranking_criteria;
drop policy if exists ranking_criteria_hr_write on public.ranking_criteria;
create policy ranking_criteria_select on public.ranking_criteria for select to anon, authenticated using (true);
create policy ranking_criteria_insert on public.ranking_criteria for insert to anon, authenticated with check (true);
create policy ranking_criteria_update on public.ranking_criteria for update to anon, authenticated using (true);
create policy ranking_criteria_delete on public.ranking_criteria for delete to anon, authenticated using (true);

drop policy if exists workflow_step_tasks_instance_access on public.workflow_step_tasks;
create policy "Allow read workflow_step_tasks" on public.workflow_step_tasks for select to public using (true);
create policy "Allow insert workflow_step_tasks" on public.workflow_step_tasks for insert to public with check (true);
create policy "Allow update workflow_step_tasks" on public.workflow_step_tasks for update to public using (true);
create policy "Allow delete workflow_step_tasks" on public.workflow_step_tasks for delete to public using (true);
drop policy if exists workflow_print_templates_select on public.workflow_print_templates;
drop policy if exists workflow_print_templates_editor_write on public.workflow_print_templates;
create policy authenticated_all on public.workflow_print_templates for all to authenticated using (true) with check (true);

drop policy if exists contract_cost_items_select on public.contract_cost_items;
drop policy if exists contract_cost_items_manage on public.contract_cost_items;
create policy contract_cost_items_access on public.contract_cost_items for all to authenticated using (true) with check (true);
drop policy if exists contract_labor_catalogs_select on public.contract_labor_catalogs;
drop policy if exists contract_labor_catalogs_manage on public.contract_labor_catalogs;
create policy contract_labor_catalogs_access on public.contract_labor_catalogs for all to authenticated using (true) with check (true);
drop policy if exists contract_machine_catalogs_select on public.contract_machine_catalogs;
drop policy if exists contract_machine_catalogs_manage on public.contract_machine_catalogs;
create policy contract_machine_catalogs_access on public.contract_machine_catalogs for all to authenticated using (true) with check (true);
drop policy if exists contract_service_catalogs_select on public.contract_service_catalogs;
drop policy if exists contract_service_catalogs_manage on public.contract_service_catalogs;
create policy contract_service_catalogs_access on public.contract_service_catalogs for all to authenticated using (true) with check (true);
drop policy if exists contract_material_norms_select on public.contract_material_norms;
drop policy if exists contract_material_norms_manage on public.contract_material_norms;
create policy contract_material_norms_access on public.contract_material_norms for all to authenticated using (true) with check (true);
drop policy if exists contract_appendices_select on public.contract_appendices;
drop policy if exists contract_appendices_manage on public.contract_appendices;
create policy contract_appendices_access on public.contract_appendices for all to authenticated using (true) with check (true);
drop policy if exists contract_item_resources_select on public.contract_item_resources;
drop policy if exists contract_item_resources_manage on public.contract_item_resources;
create policy contract_item_resources_access on public.contract_item_resources for all to authenticated using (true) with check (true);

drop trigger if exists contract_items_side_effect_guard on public.contract_items;
drop function if exists app_private.guard_contract_item_side_effect_update();
drop policy if exists contract_items_insert on public.contract_items;
drop policy if exists contract_items_update on public.contract_items;
drop policy if exists contract_items_delete on public.contract_items;
create policy contract_items_insert on public.contract_items for insert to authenticated with check (true);
create policy contract_items_update on public.contract_items for update to authenticated using (true);
create policy contract_items_delete on public.contract_items for delete to authenticated using (true);

drop trigger if exists advance_payments_recovery_guard on public.advance_payments;
drop function if exists app_private.guard_advance_payment_recovery_update();
drop policy if exists advance_payments_admin_insert on public.advance_payments;
drop policy if exists advance_payments_update on public.advance_payments;
drop policy if exists advance_payments_admin_delete on public.advance_payments;
create policy advance_payments_insert on public.advance_payments for insert to authenticated with check (true);
create policy advance_payments_update on public.advance_payments for update to authenticated using (true);
create policy advance_payments_delete on public.advance_payments for delete to authenticated using (true);

drop policy if exists project_cost_items_admin_write on public.project_cost_items;
create policy cost_items_insert on public.project_cost_items for insert to authenticated with check (true);
create policy cost_items_update on public.project_cost_items for update to authenticated using (true);
create policy cost_items_delete on public.project_cost_items for delete to authenticated using (true);

drop policy if exists project_dashboard_snapshots_admin_write on public.project_dashboard_snapshots;
create policy "Allow authenticated users to insert/update snapshots" on public.project_dashboard_snapshots
  for all to authenticated using (true) with check (true);

drop function if exists app_private.contract_data_actor_can_manage(text);
drop function if exists app_private.project_finance_side_effect_actor(text, text, boolean);

alter policy notifications_insert on public.notifications to public with check (true);
drop trigger if exists notifications_stamp_sender on public.notifications;
drop function if exists app_private.stamp_notification_sender();
-- Keep notification_broadcast_receipts and mark_my_notifications: the deployed
-- frontend reads them. Drop them only together with a frontend rollback.

commit;
