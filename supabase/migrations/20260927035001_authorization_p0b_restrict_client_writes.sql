-- Authorization remediation P0-B (part 1): stop signed-in users from changing
-- data that is not theirs. Replaces write policies whose condition was `true`.
-- See docs/security/authorization-remediation-plan-2026-09-27.md (P0-B).

-- 1. Logs: the server records the real actor; clients cannot write request logs.
create or replace function app_private.stamp_client_log_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_name text;
begin
  -- Jobs without a user session keep the values they provide.
  if v_actor is null then return new; end if;
  select user_row.name into v_name from public.users user_row where user_row.id = v_actor;
  if tg_table_name = 'audit_trail' then
    new.user_id := v_actor::text;
  else
    new.user_id := v_actor;
  end if;
  new.user_name := coalesce(v_name, new.user_name);
  return new;
end;
$$;
revoke all on function app_private.stamp_client_log_actor() from public, anon, authenticated;

create trigger audit_trail_stamp_actor before insert on public.audit_trail
  for each row execute function app_private.stamp_client_log_actor();
create trigger activities_stamp_actor before insert on public.activities
  for each row execute function app_private.stamp_client_log_actor();

alter policy audit_trail_insert on public.audit_trail to authenticated;
alter policy activities_write on public.activities to authenticated;
-- process_request_step (SECURITY DEFINER) is the only writer.
drop policy rq_logs_write on public.request_logs;

-- 2. Rows owned by one user.
drop policy "Users can manage own signature" on public.user_signatures;
drop policy "Users can update own signature" on public.user_signatures;
drop policy "Users can delete own signature" on public.user_signatures;
create policy user_signatures_insert_own on public.user_signatures for insert to authenticated
  with check (user_id = public.current_app_user_id() or public.is_admin());
create policy user_signatures_update_own on public.user_signatures for update to authenticated
  using (user_id = public.current_app_user_id() or public.is_admin())
  with check (user_id = public.current_app_user_id() or public.is_admin());
create policy user_signatures_delete_own on public.user_signatures for delete to authenticated
  using (user_id = public.current_app_user_id() or public.is_admin());

drop policy dashboard_layouts_all_access on public.dashboard_layouts;
create policy dashboard_layouts_own on public.dashboard_layouts for all to authenticated
  using (user_id = public.current_app_user_id()::text or public.is_admin())
  with check (user_id = public.current_app_user_id()::text or public.is_admin());

-- XP is awarded by server RPCs only; everyone may read the leaderboard.
drop policy user_xp_all_access on public.user_xp;
create policy user_xp_select on public.user_xp for select to authenticated using (true);
drop policy xp_events_all_access on public.xp_events;
create policy xp_events_select on public.xp_events for select to authenticated using (true);

-- 3. HR configuration.
drop policy "Allow all for authenticated users" on public.salary_3p_settings;
create policy salary_3p_settings_select on public.salary_3p_settings for select to authenticated using (true);
create policy salary_3p_settings_admin_write on public.salary_3p_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy "Allow all for authenticated users" on public.kpi_periods;
create policy kpi_periods_select on public.kpi_periods for select to authenticated using (true);
create policy kpi_periods_admin_write on public.kpi_periods for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy "Allow all for authenticated users" on public.kpi_rating_configs;
create policy kpi_rating_configs_select on public.kpi_rating_configs for select to authenticated using (true);
create policy kpi_rating_configs_admin_write on public.kpi_rating_configs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy "Allow all for authenticated users" on public.kpi_scores;
create policy kpi_scores_select on public.kpi_scores for select to authenticated using (true);
create policy kpi_scores_admin_write on public.kpi_scores for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- The ranking screen opens only for the HR template holding view_sensitive.
drop policy ranking_criteria_select on public.ranking_criteria;
drop policy ranking_criteria_insert on public.ranking_criteria;
drop policy ranking_criteria_update on public.ranking_criteria;
drop policy ranking_criteria_delete on public.ranking_criteria;
create policy ranking_criteria_select on public.ranking_criteria for select to authenticated using (true);
create policy ranking_criteria_hr_write on public.ranking_criteria for all to authenticated
  using (public.is_admin() or app_private.current_user_has_hrm_template_permission('hrm.employee.view_sensitive'))
  with check (public.is_admin() or app_private.current_user_has_hrm_template_permission('hrm.employee.view_sensitive'));

-- 4. Workflow checklist and print templates.
drop policy "Allow read workflow_step_tasks" on public.workflow_step_tasks;
drop policy "Allow insert workflow_step_tasks" on public.workflow_step_tasks;
drop policy "Allow update workflow_step_tasks" on public.workflow_step_tasks;
drop policy "Allow delete workflow_step_tasks" on public.workflow_step_tasks;
create policy workflow_step_tasks_instance_access on public.workflow_step_tasks for all to authenticated
  using (app_private.workflow_instance_actor_can_select(instance_id))
  with check (app_private.workflow_instance_actor_can_select(instance_id));

drop policy authenticated_all on public.workflow_print_templates;
create policy workflow_print_templates_select on public.workflow_print_templates for select to authenticated using (true);
create policy workflow_print_templates_editor_write on public.workflow_print_templates for all to authenticated
  using (app_private.workflow_template_actor_can_edit(template_id, public.current_app_user_id()))
  with check (app_private.workflow_template_actor_can_edit(template_id, public.current_app_user_id()));

-- 5. Contracts and the cost library: same editors as the contract screens.
--    Legacy HD module admins stay until the HD cohort moves to capabilities (P1).
create or replace function app_private.contract_data_actor_can_manage(p_project_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or public.is_module_admin('HD')
    or exists (
      select 1 from unnest(array[
        'contract.customer.manage', 'contract.supplier.manage', 'contract.partner.manage',
        'contract.cost_library.manage', 'system.tender_ai.manage'
      ]) as code(permission_code)
      where app_private.has_permission(public.current_app_user_id(), code.permission_code, 'global', '*')
    )
    or (
      p_project_id is not null
      and exists (
        select 1 from unnest(array[
          'project.contract.manage', 'project.contract.edit_all',
          'project.contract_item.manage', 'project.contract_item.edit'
        ]) as code(permission_code)
        where app_private.has_permission(public.current_app_user_id(), code.permission_code, 'project', p_project_id)
      )
    );
$$;
revoke all on function app_private.contract_data_actor_can_manage(text) from public, anon;
grant execute on function app_private.contract_data_actor_can_manage(text) to authenticated;

-- Approved payment and quantity-acceptance steps update derived contract and
-- advance columns from the approver's session.
create or replace function app_private.project_finance_side_effect_actor(
  p_project_id text,
  p_construction_site_id text,
  p_include_acceptance boolean
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_project_id is not null and exists (
    select 1 from (values
      ('payment', 'confirm', false),
      ('payment', 'approve', false),
      ('quantity_acceptance', 'verify', true),
      ('quantity_acceptance', 'approve', true)
    ) as room_action(room_code, action_code, acceptance_only)
    where (p_include_acceptance or not room_action.acceptance_only)
      and app_private.project_actor_has_effective_room_action(
        public.current_app_user_id(), p_project_id, p_construction_site_id,
        room_action.room_code, room_action.action_code
      )
  )
  or (
    p_include_acceptance and p_project_id is not null
    and app_private.has_permission(public.current_app_user_id(), 'project.contract_variation.approve', 'project', p_project_id)
  );
$$;
revoke all on function app_private.project_finance_side_effect_actor(text, text, boolean) from public, anon;
grant execute on function app_private.project_finance_side_effect_actor(text, text, boolean) to authenticated;

drop policy contract_cost_items_access on public.contract_cost_items;
create policy contract_cost_items_select on public.contract_cost_items for select to authenticated using (true);
create policy contract_cost_items_manage on public.contract_cost_items for all to authenticated
  using (app_private.contract_data_actor_can_manage(null)) with check (app_private.contract_data_actor_can_manage(null));

drop policy contract_labor_catalogs_access on public.contract_labor_catalogs;
create policy contract_labor_catalogs_select on public.contract_labor_catalogs for select to authenticated using (true);
create policy contract_labor_catalogs_manage on public.contract_labor_catalogs for all to authenticated
  using (app_private.contract_data_actor_can_manage(null)) with check (app_private.contract_data_actor_can_manage(null));

drop policy contract_machine_catalogs_access on public.contract_machine_catalogs;
create policy contract_machine_catalogs_select on public.contract_machine_catalogs for select to authenticated using (true);
create policy contract_machine_catalogs_manage on public.contract_machine_catalogs for all to authenticated
  using (app_private.contract_data_actor_can_manage(null)) with check (app_private.contract_data_actor_can_manage(null));

drop policy contract_service_catalogs_access on public.contract_service_catalogs;
create policy contract_service_catalogs_select on public.contract_service_catalogs for select to authenticated using (true);
create policy contract_service_catalogs_manage on public.contract_service_catalogs for all to authenticated
  using (app_private.contract_data_actor_can_manage(null)) with check (app_private.contract_data_actor_can_manage(null));

drop policy contract_material_norms_access on public.contract_material_norms;
create policy contract_material_norms_select on public.contract_material_norms for select to authenticated using (true);
create policy contract_material_norms_manage on public.contract_material_norms for all to authenticated
  using (app_private.contract_data_actor_can_manage(null)) with check (app_private.contract_data_actor_can_manage(null));

drop policy contract_appendices_access on public.contract_appendices;
create policy contract_appendices_select on public.contract_appendices for select to authenticated using (true);
create policy contract_appendices_manage on public.contract_appendices for all to authenticated
  using (app_private.contract_data_actor_can_manage(project_id)) with check (app_private.contract_data_actor_can_manage(project_id));

drop policy contract_item_resources_access on public.contract_item_resources;
create policy contract_item_resources_select on public.contract_item_resources for select to authenticated using (true);
create policy contract_item_resources_manage on public.contract_item_resources for all to authenticated
  using (app_private.contract_data_actor_can_manage(
    (select item.project_id from public.contract_items item where item.id = contract_item_id)))
  with check (app_private.contract_data_actor_can_manage(
    (select item.project_id from public.contract_items item where item.id = contract_item_id)));

drop policy contract_items_insert on public.contract_items;
drop policy contract_items_update on public.contract_items;
drop policy contract_items_delete on public.contract_items;
create policy contract_items_insert on public.contract_items for insert to authenticated
  with check (app_private.contract_data_actor_can_manage(project_id));
create policy contract_items_update on public.contract_items for update to authenticated
  using (
    app_private.contract_data_actor_can_manage(project_id)
    or app_private.project_finance_side_effect_actor(project_id, construction_site_id::text, true)
  )
  with check (
    app_private.contract_data_actor_can_manage(project_id)
    or app_private.project_finance_side_effect_actor(project_id, construction_site_id::text, true)
  );
create policy contract_items_delete on public.contract_items for delete to authenticated
  using (app_private.contract_data_actor_can_manage(project_id));

create or replace function app_private.guard_contract_item_side_effect_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_derived text[] := array[
    'completed_quantity', 'completed_percent', 'is_locked', 'locked_at',
    'variation_quantity', 'variation_amount', 'revised_quantity',
    'revised_unit_price', 'revised_total_price'
  ];
begin
  if public.current_app_user_id() is null
    or app_private.contract_data_actor_can_manage(old.project_id) then
    return new;
  end if;
  if (to_jsonb(new) - v_derived) is distinct from (to_jsonb(old) - v_derived) then
    raise exception 'CONTRACT_ITEM_EDIT_REQUIRES_CONTRACT_MANAGER' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app_private.guard_contract_item_side_effect_update() from public, anon, authenticated;
create trigger contract_items_side_effect_guard before update on public.contract_items
  for each row execute function app_private.guard_contract_item_side_effect_update();

-- 6. Project finance: Admin only (owner decision 2026-09-27). Payment confirmers
--    may still record advance recovery from an approved payment certificate.
drop policy advance_payments_insert on public.advance_payments;
drop policy advance_payments_update on public.advance_payments;
drop policy advance_payments_delete on public.advance_payments;
create policy advance_payments_admin_insert on public.advance_payments for insert to authenticated
  with check (public.is_admin());
create policy advance_payments_update on public.advance_payments for update to authenticated
  using (public.is_admin() or app_private.project_finance_side_effect_actor(project_id, construction_site_id::text, false))
  with check (public.is_admin() or app_private.project_finance_side_effect_actor(project_id, construction_site_id::text, false));
create policy advance_payments_admin_delete on public.advance_payments for delete to authenticated
  using (public.is_admin());

create or replace function app_private.guard_advance_payment_recovery_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recovery text[] := array['recovered_amount', 'remaining_amount', 'status'];
begin
  if public.current_app_user_id() is null or public.is_admin() then return new; end if;
  if (to_jsonb(new) - v_recovery) is distinct from (to_jsonb(old) - v_recovery)
    or new.status not in ('active', 'fully_recovered') then
    raise exception 'ADVANCE_PAYMENT_EDIT_REQUIRES_ADMIN' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app_private.guard_advance_payment_recovery_update() from public, anon, authenticated;
create trigger advance_payments_recovery_guard before update on public.advance_payments
  for each row execute function app_private.guard_advance_payment_recovery_update();

drop policy cost_items_insert on public.project_cost_items;
drop policy cost_items_update on public.project_cost_items;
drop policy cost_items_delete on public.project_cost_items;
create policy project_cost_items_admin_write on public.project_cost_items for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy "Allow authenticated users to insert/update snapshots" on public.project_dashboard_snapshots;
create policy project_dashboard_snapshots_admin_write on public.project_dashboard_snapshots for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 7. Notifications: in-app links only, broadcasts from Admin or the system,
--    sender recorded server-side, and a per-user read state for broadcasts.
alter policy notifications_insert on public.notifications to authenticated
  with check (
    (user_id is not null or public.is_admin())
    and (link is null or (link like '/%' and link not like '//%'))
    and (action_url is null or (action_url like '/%' and action_url not like '//%'))
  );

create or replace function app_private.stamp_notification_sender()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
begin
  if v_actor is not null then
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object('sentByUserId', v_actor);
  end if;
  return new;
end;
$$;
revoke all on function app_private.stamp_notification_sender() from public, anon, authenticated;
create trigger notifications_stamp_sender before insert on public.notifications
  for each row execute function app_private.stamp_notification_sender();

create table public.notification_broadcast_receipts (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  read_at timestamptz,
  dismissed_at timestamptz,
  primary key (notification_id, user_id)
);
create index notification_broadcast_receipts_user_idx on public.notification_broadcast_receipts (user_id);
alter table public.notification_broadcast_receipts enable row level security;
revoke all on public.notification_broadcast_receipts from anon, authenticated;
grant select on public.notification_broadcast_receipts to authenticated;
create policy notification_broadcast_receipts_own on public.notification_broadcast_receipts
  for select to authenticated using (user_id = public.current_app_user_id());

create or replace function public.mark_my_notifications(
  p_action text,
  p_notification_ids uuid[] default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_own integer := 0;
  v_broadcast integer := 0;
begin
  if v_actor is null then
    raise exception 'ACTIVE_APP_USER_REQUIRED' using errcode = '42501';
  end if;
  if p_action not in ('read', 'dismiss') then
    raise exception 'NOTIFICATION_ACTION_INVALID' using errcode = '22023';
  end if;

  update public.notifications notification_row
  set is_read = true,
      is_dismissed = notification_row.is_dismissed or p_action = 'dismiss'
  where notification_row.user_id = v_actor::text
    and (p_notification_ids is null or notification_row.id = any(p_notification_ids))
    and (not notification_row.is_read or (p_action = 'dismiss' and not notification_row.is_dismissed));
  get diagnostics v_own = row_count;

  insert into public.notification_broadcast_receipts as receipt (notification_id, user_id, read_at, dismissed_at)
  select notification_row.id, v_actor, now(), case when p_action = 'dismiss' then now() end
  from public.notifications notification_row
  where notification_row.user_id is null
    and (p_notification_ids is null or notification_row.id = any(p_notification_ids))
  on conflict (notification_id, user_id) do update
    set read_at = coalesce(receipt.read_at, excluded.read_at),
        dismissed_at = coalesce(receipt.dismissed_at, excluded.dismissed_at);
  get diagnostics v_broadcast = row_count;

  return v_own + v_broadcast;
end;
$$;
revoke all on function public.mark_my_notifications(text, uuid[]) from public, anon;
grant execute on function public.mark_my_notifications(text, uuid[]) to authenticated;
