-- P0-C step 3: project finance and customer-contract rows are readable only by
-- people the Admin switched on (per project or all projects), payment /
-- quantity-acceptance Room processors of that project, company contract
-- managers (contract domain) and Admin.
--
-- Out of scope on purpose (still readable by active users):
--   supplier_contracts, subcontractor_contracts: used by Safety, Material,
--   Supply chain and Subcontract screens.
--   payment_schedules, acceptance_records: governed by the Payment Room.

-- Finance ------------------------------------------------------------------

drop policy if exists project_tx_select on public.project_transactions;
create policy project_tx_select on public.project_transactions
  for select to authenticated
  using (
    (select app_private.sensitive_view_all('finance'))
    or project_id = any((select app_private.sensitive_view_project_ids('finance'))::text[])
    or construction_site_id = any((select app_private.sensitive_view_site_ids('finance'))::text[])
  );

drop policy if exists project_finances_select on public.project_finances;
create policy project_finances_select on public.project_finances
  for select to authenticated
  using (
    (select app_private.sensitive_view_all('finance'))
    or project_id = any((select app_private.sensitive_view_project_ids('finance'))::text[])
    or construction_site_id = any((select app_private.sensitive_view_site_ids('finance'))::text[])
  );

drop policy if exists cost_items_select on public.project_cost_items;
create policy cost_items_select on public.project_cost_items
  for select to authenticated
  using (
    (select app_private.sensitive_view_all('finance'))
    or project_id = any((select app_private.sensitive_view_project_ids('finance'))::text[])
    or construction_site_id::text = any((select app_private.sensitive_view_site_ids('finance'))::text[])
  );

drop policy if exists advance_payments_select on public.advance_payments;
create policy advance_payments_select on public.advance_payments
  for select to authenticated
  using (
    (select app_private.sensitive_view_all('finance'))
    or project_id = any((select app_private.sensitive_view_project_ids('finance'))::text[])
    or construction_site_id::text = any((select app_private.sensitive_view_site_ids('finance'))::text[])
  );

drop policy if exists "Allow authenticated users to read snapshots" on public.project_dashboard_snapshots;
create policy project_dashboard_snapshots_select on public.project_dashboard_snapshots
  for select to authenticated
  using (
    (select app_private.sensitive_view_all('finance'))
    or project_id::text = any((select app_private.sensitive_view_project_ids('finance'))::text[])
    or construction_site_id::text = any((select app_private.sensitive_view_site_ids('finance'))::text[])
  );

-- The old ALL policy let any active user write any scoped row.
drop policy if exists project_cost_actuals_project_access on public.project_cost_actuals;
create policy project_cost_actuals_select on public.project_cost_actuals
  for select to authenticated
  using (
    (select app_private.sensitive_view_all('finance'))
    or project_id = any((select app_private.sensitive_view_project_ids('finance'))::text[])
    or construction_site_id::text = any((select app_private.sensitive_view_site_ids('finance'))::text[])
  );
create policy project_cost_actuals_admin_write on public.project_cost_actuals
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Legacy "DA module admin" no longer grants finance writes (owner decision 3).
-- Payment / acceptance processors keep posting workflow transactions.
drop policy if exists project_tx_insert on public.project_transactions;
create policy project_tx_insert on public.project_transactions
  for insert to authenticated
  with check (
    public.is_admin()
    or app_private.project_user_has_permission(project_id, construction_site_id, 'edit', public.current_app_user_id())
    or app_private.project_finance_side_effect_actor(project_id, construction_site_id, true)
  );

drop policy if exists project_tx_update on public.project_transactions;
create policy project_tx_update on public.project_transactions
  for update to authenticated
  using (
    public.is_admin()
    or app_private.project_user_has_permission(project_id, construction_site_id, 'edit', public.current_app_user_id())
    or app_private.project_finance_side_effect_actor(project_id, construction_site_id, true)
  )
  with check (
    public.is_admin()
    or app_private.project_user_has_permission(project_id, construction_site_id, 'edit', public.current_app_user_id())
    or app_private.project_finance_side_effect_actor(project_id, construction_site_id, true)
  );

drop policy if exists project_tx_delete on public.project_transactions;
create policy project_tx_delete on public.project_transactions
  for delete to authenticated
  using (
    public.is_admin()
    or app_private.project_user_has_permission(project_id, construction_site_id, 'delete', public.current_app_user_id())
  );

drop policy if exists project_finances_insert on public.project_finances;
create policy project_finances_insert on public.project_finances
  for insert to authenticated
  with check (
    public.is_admin()
    or app_private.project_user_has_permission(project_id, construction_site_id, 'edit', public.current_app_user_id())
  );

drop policy if exists project_finances_update on public.project_finances;
create policy project_finances_update on public.project_finances
  for update to authenticated
  using (
    public.is_admin()
    or app_private.project_user_has_permission(project_id, construction_site_id, 'edit', public.current_app_user_id())
  )
  with check (
    public.is_admin()
    or app_private.project_user_has_permission(project_id, construction_site_id, 'edit', public.current_app_user_id())
  );

drop policy if exists project_finances_delete on public.project_finances;
create policy project_finances_delete on public.project_finances
  for delete to authenticated
  using (
    public.is_admin()
    or app_private.project_user_has_permission(project_id, construction_site_id, 'delete', public.current_app_user_id())
  );

-- Customer contracts ---------------------------------------------------------

drop policy if exists customer_contracts_select on public.customer_contracts;
create policy customer_contracts_select on public.customer_contracts
  for select to authenticated
  using (
    (select app_private.sensitive_view_all('contract'))
    or project_id = any((select app_private.sensitive_view_project_ids('contract'))::text[])
    or construction_site_id = any((select app_private.sensitive_view_site_ids('contract'))::text[])
  );

drop policy if exists project_contracts_select on public.project_contracts;
create policy project_contracts_select on public.project_contracts
  for select to authenticated
  using (
    (select app_private.sensitive_view_all('contract'))
    or project_id = any((select app_private.sensitive_view_project_ids('contract'))::text[])
    or construction_site_id = any((select app_private.sensitive_view_site_ids('contract'))::text[])
  );

-- Items and appendices of supplier / subcontractor contracts stay open.
drop policy if exists contract_items_select on public.contract_items;
create policy contract_items_select on public.contract_items
  for select to authenticated
  using (
    coalesce(contract_type, '') <> 'customer'
    or (select app_private.sensitive_view_all('contract'))
    or project_id = any((select app_private.sensitive_view_project_ids('contract'))::text[])
    or construction_site_id::text = any((select app_private.sensitive_view_site_ids('contract'))::text[])
  );

drop policy if exists contract_appendices_select on public.contract_appendices;
create policy contract_appendices_select on public.contract_appendices
  for select to authenticated
  using (
    coalesce(contract_type, '') <> 'customer'
    or (select app_private.sensitive_view_all('contract'))
    or project_id = any((select app_private.sensitive_view_project_ids('contract'))::text[])
    or construction_site_id::text = any((select app_private.sensitive_view_site_ids('contract'))::text[])
  );

-- A guarantee follows its parent contract (parent reads are RLS-filtered).
drop policy if exists contract_guarantees_select on public.contract_guarantees;
create policy contract_guarantees_select on public.contract_guarantees
  for select to authenticated
  using (
    (select app_private.sensitive_view_all('contract'))
    or exists (select 1 from public.customer_contracts parent where parent.id::text = contract_guarantees.contract_id)
    or exists (select 1 from public.supplier_contracts parent where parent.id::text = contract_guarantees.contract_id)
    or exists (select 1 from public.subcontractor_contracts parent where parent.id::text = contract_guarantees.contract_id)
  );

-- Scope of the signed-in user, for lists and exports across projects.
create or replace function public.get_my_sensitive_view_scope()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'finance', jsonb_build_object(
      'all', app_private.sensitive_view_all('finance'),
      'projectIds', to_jsonb(app_private.sensitive_view_project_ids('finance')),
      'siteIds', to_jsonb(app_private.sensitive_view_site_ids('finance'))
    ),
    'contract', jsonb_build_object(
      'all', app_private.sensitive_view_all('contract'),
      'projectIds', to_jsonb(app_private.sensitive_view_project_ids('contract')),
      'siteIds', to_jsonb(app_private.sensitive_view_site_ids('contract'))
    )
  );
$$;
revoke all on function public.get_my_sensitive_view_scope() from public, anon;
grant execute on function public.get_my_sensitive_view_scope() to authenticated;
