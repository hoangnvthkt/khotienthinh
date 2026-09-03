-- Project opening balance automation is temporarily dormant. Keep its data for
-- later use, but treat status as informational text and remove the one-lock-per-
-- scope rule.

drop index if exists public.idx_project_opening_balances_locked_scope;

alter table if exists public.project_opening_balances
  drop constraint if exists project_opening_balances_status_check;

comment on column public.project_opening_balances.status is
  'Informational text only while opening-balance automation is disabled.';

-- Align project finance/transaction writes with the DA permissions exposed by
-- the UI. The previous policies only allowed global admins, so DA module admins
-- could see optimistic client state while Supabase rejected the write.

alter table public.project_finances enable row level security;
alter table public.project_transactions enable row level security;

revoke all on table public.project_finances from anon;
revoke all on table public.project_finances from public;
revoke all on table public.project_finances from authenticated;
grant select, insert, update, delete on table public.project_finances to authenticated;

drop policy if exists project_finances_select on public.project_finances;
drop policy if exists project_finances_write on public.project_finances;
drop policy if exists project_finances_insert on public.project_finances;
drop policy if exists project_finances_update on public.project_finances;
drop policy if exists project_finances_delete on public.project_finances;

create policy project_finances_select
  on public.project_finances
  for select
  to authenticated
  using (true);

create policy project_finances_insert
  on public.project_finances
  for insert
  to authenticated
  with check (
    public.is_module_admin('DA')
    or app_private.project_user_has_permission(
      project_id,
      construction_site_id,
      'edit',
      public.current_app_user_id()
    )
  );

create policy project_finances_update
  on public.project_finances
  for update
  to authenticated
  using (
    public.is_module_admin('DA')
    or app_private.project_user_has_permission(
      project_id,
      construction_site_id,
      'edit',
      public.current_app_user_id()
    )
  )
  with check (
    public.is_module_admin('DA')
    or app_private.project_user_has_permission(
      project_id,
      construction_site_id,
      'edit',
      public.current_app_user_id()
    )
  );

create policy project_finances_delete
  on public.project_finances
  for delete
  to authenticated
  using (
    public.is_module_admin('DA')
    or app_private.project_user_has_permission(
      project_id,
      construction_site_id,
      'delete',
      public.current_app_user_id()
    )
  );

revoke all on table public.project_transactions from anon;
revoke all on table public.project_transactions from public;
revoke all on table public.project_transactions from authenticated;
grant select, insert, update, delete on table public.project_transactions to authenticated;

drop policy if exists project_tx_select on public.project_transactions;
drop policy if exists project_tx_write on public.project_transactions;
drop policy if exists project_tx_insert on public.project_transactions;
drop policy if exists project_tx_update on public.project_transactions;
drop policy if exists project_tx_delete on public.project_transactions;

create policy project_tx_select
  on public.project_transactions
  for select
  to authenticated
  using (true);

create policy project_tx_insert
  on public.project_transactions
  for insert
  to authenticated
  with check (
    public.is_module_admin('DA')
    or app_private.project_user_has_permission(
      project_id,
      construction_site_id,
      'edit',
      public.current_app_user_id()
    )
  );

create policy project_tx_update
  on public.project_transactions
  for update
  to authenticated
  using (
    public.is_module_admin('DA')
    or app_private.project_user_has_permission(
      project_id,
      construction_site_id,
      'edit',
      public.current_app_user_id()
    )
  )
  with check (
    public.is_module_admin('DA')
    or app_private.project_user_has_permission(
      project_id,
      construction_site_id,
      'edit',
      public.current_app_user_id()
    )
  );

create policy project_tx_delete
  on public.project_transactions
  for delete
  to authenticated
  using (
    public.is_module_admin('DA')
    or app_private.project_user_has_permission(
      project_id,
      construction_site_id,
      'delete',
      public.current_app_user_id()
    )
  );

notify pgrst, 'reload schema';
