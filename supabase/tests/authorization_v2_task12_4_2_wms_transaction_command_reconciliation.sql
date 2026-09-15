-- Summarize authorization changes for live non-terminal WMS transaction shapes.
-- The report contains no account identifiers and performs no persistent writes.
begin;

create temporary table wms_command_reconciliation_actors on commit drop as
select id, auth_id, role::text as actor_role, assigned_warehouse_id
from public.users
where is_active
  and account_status = 'ACTIVE'
  and auth_id is not null;

create temporary table wms_command_reconciliation_resources on commit drop as
select distinct
  type,
  source_warehouse_id,
  target_warehouse_id,
  requester_id,
  approver_id
from public.transactions
where status in ('PENDING'::public.transaction_status, 'APPROVED'::public.transaction_status);

create temporary table wms_command_reconciliation_results (
  actor_id uuid not null,
  action_name text not null,
  change_kind text not null,
  actor_role text not null
) on commit drop;

grant select on wms_command_reconciliation_actors,
  wms_command_reconciliation_resources to authenticated;
grant insert, select on wms_command_reconciliation_results to authenticated;

set local role authenticated;

do $$
declare
  actor wms_command_reconciliation_actors%rowtype;
  resource wms_command_reconciliation_resources%rowtype;
  legacy_admin boolean;
  old_allowed boolean;
  new_allowed boolean;
begin
  for actor in select * from wms_command_reconciliation_actors order by id loop
    perform set_config('request.jwt.claim.sub', actor.auth_id::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', actor.auth_id, 'role', 'authenticated')::text,
      true
    );
    legacy_admin := public.is_module_admin('WMS');

    for resource in select * from wms_command_reconciliation_resources loop
      old_allowed := legacy_admin or resource.requester_id is not distinct from actor.id;
      new_allowed := app_private.wms_has_action(
        'wms.transaction.approve',
        resource.source_warehouse_id,
        resource.target_warehouse_id,
        resource.requester_id,
        resource.approver_id,
        actor.id
      );
      if old_allowed is distinct from new_allowed then
        insert into wms_command_reconciliation_results
        values (
          actor.id,
          'approve',
          case when new_allowed then 'canonical_or_keeper_allow' else 'requester_bypass_removed' end,
          actor.actor_role
        );
      end if;

      old_allowed := legacy_admin
        or actor.assigned_warehouse_id is not distinct from resource.target_warehouse_id
        or actor.assigned_warehouse_id is not distinct from resource.source_warehouse_id;
      new_allowed := app_private.wms_has_action(
        'wms.transaction.complete',
        resource.source_warehouse_id,
        resource.target_warehouse_id,
        resource.requester_id,
        resource.approver_id,
        actor.id
      );
      if old_allowed is distinct from new_allowed then
        insert into wms_command_reconciliation_results
        values (
          actor.id,
          'complete',
          case when new_allowed then 'canonical_or_keeper_allow' else 'assigned_employee_bypass_removed' end,
          actor.actor_role
        );
      end if;
    end loop;
  end loop;
end $$;

reset role;

select action_name, change_kind, actor_role,
       count(distinct actor_id) as actor_count,
       count(*) as decision_tuple_count
from wms_command_reconciliation_results
group by action_name, change_kind, actor_role
order by action_name, change_kind, actor_role;

rollback;
