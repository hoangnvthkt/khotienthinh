-- Reconcile generic Workflow creation access before direct INSERT is revoked.
-- UI-reachable parity must stay exact; the previously callable raw-table path
-- for users without WF access is an approved security loss.
begin;

with active_users as materialized (
  select
    u.id,
    (
      u.role = 'ADMIN'::public.user_role
      or 'WF' = any(coalesce(u.allowed_modules, '{}'::text[]))
      or 'WF' = any(coalesce(u.admin_modules, '{}'::text[]))
      or coalesce(u.allowed_sub_modules, '{}'::jsonb) ? 'WF'
      or coalesce(u.admin_sub_modules, '{}'::jsonb) ? 'WF'
    ) as old_ui_create,
    (
      app_private.has_permission(u.id, 'workflow.instance.create', 'global', '*')
      or app_private.has_permission(u.id, 'workflow.instance.create', 'own', u.id::text)
    ) as canonical_create
  from public.users u
  where u.is_active and u.account_status = 'ACTIVE'
), decisions as (
  select
    *,
    (old_ui_create or canonical_create) as new_command_create,
    true as old_raw_table_create
  from active_users
)
select
  count(*) as active_users,
  count(*) filter (where old_ui_create) as old_ui_create_users,
  count(*) filter (where new_command_create) as new_command_create_users,
  count(*) filter (where old_ui_create and not new_command_create) as unexpected_ui_losses,
  count(*) filter (where new_command_create and not old_ui_create) as unexpected_ui_gains,
  count(*) filter (where old_raw_table_create and not new_command_create)
    as approved_raw_table_access_losses
from decisions;

do $$
declare
  unexpected_count bigint;
begin
  with active_users as materialized (
    select
      u.id,
      (
        u.role = 'ADMIN'::public.user_role
        or 'WF' = any(coalesce(u.allowed_modules, '{}'::text[]))
        or 'WF' = any(coalesce(u.admin_modules, '{}'::text[]))
        or coalesce(u.allowed_sub_modules, '{}'::jsonb) ? 'WF'
        or coalesce(u.admin_sub_modules, '{}'::jsonb) ? 'WF'
      ) as old_ui_create,
      (
        app_private.has_permission(u.id, 'workflow.instance.create', 'global', '*')
        or app_private.has_permission(u.id, 'workflow.instance.create', 'own', u.id::text)
      ) as canonical_create
    from public.users u
    where u.is_active and u.account_status = 'ACTIVE'
  )
  select count(*) into unexpected_count
  from active_users
  where old_ui_create is distinct from (old_ui_create or canonical_create);

  if unexpected_count <> 0 then
    raise exception 'Workflow draft create reconciliation found % UI parity changes', unexpected_count;
  end if;

  if exists (
    select 1 from public.workflow_instances where status = 'DRAFT'
  ) then
    raise exception 'Unexpected persisted Workflow drafts before feature rollout';
  end if;
end;
$$;

rollback;
