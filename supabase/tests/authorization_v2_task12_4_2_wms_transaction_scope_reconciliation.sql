-- Compare the former two-sided warehouse lookup with the UI-aligned action
-- warehouse for a standard transfer. Output is aggregated and contains no IDs.
begin;

create temporary table wms_transaction_scope_reconciliation_actors on commit drop as
select id, auth_id, role::text as actor_role
from public.users
where is_active
  and account_status = 'ACTIVE'
  and auth_id is not null;

create temporary table wms_transaction_scope_reconciliation_warehouses on commit drop as
select
  source.id as source_warehouse_id,
  target.id as target_warehouse_id
from public.warehouses source
cross join public.warehouses target
where source.id <> target.id;

create temporary table wms_transaction_scope_reconciliation_results (
  actor_id uuid not null,
  actor_role text not null,
  action_name text not null,
  change_kind text not null
) on commit drop;

grant select on wms_transaction_scope_reconciliation_actors,
  wms_transaction_scope_reconciliation_warehouses to authenticated;
grant insert, select on wms_transaction_scope_reconciliation_results to authenticated;
grant execute on function app_private.wms_transaction_has_action(
  text, public.transaction_type, text, text, jsonb, uuid, uuid, uuid
) to authenticated;

set local role authenticated;

do $$
declare
  actor wms_transaction_scope_reconciliation_actors%rowtype;
  resource wms_transaction_scope_reconciliation_warehouses%rowtype;
  old_allowed boolean;
  new_allowed boolean;
begin
  if not exists (select 1 from wms_transaction_scope_reconciliation_warehouses) then
    raise exception 'Two warehouses are required for WMS transfer scope reconciliation';
  end if;

  for actor in select * from wms_transaction_scope_reconciliation_actors order by id loop
    perform set_config('request.jwt.claim.sub', actor.auth_id::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', actor.auth_id, 'role', 'authenticated')::text,
      true
    );

    for resource in select * from wms_transaction_scope_reconciliation_warehouses loop
      old_allowed := app_private.wms_has_action(
        'wms.transaction.approve',
        resource.source_warehouse_id,
        resource.target_warehouse_id,
        null,
        null,
        actor.id
      );
      new_allowed := app_private.wms_transaction_has_action(
        'wms.transaction.approve',
        'TRANSFER'::public.transaction_type,
        resource.source_warehouse_id,
        resource.target_warehouse_id,
        '[]'::jsonb,
        null,
        null,
        actor.id
      );
      if old_allowed is distinct from new_allowed then
        insert into wms_transaction_scope_reconciliation_results
        values (
          actor.id,
          actor.actor_role,
          'approve',
          case when new_allowed then 'unexpected_allow' else 'wrong_side_allow_removed' end
        );
      end if;

      old_allowed := app_private.wms_has_action(
        'wms.transaction.complete',
        resource.source_warehouse_id,
        resource.target_warehouse_id,
        null,
        null,
        actor.id
      );
      new_allowed := app_private.wms_transaction_has_action(
        'wms.transaction.complete',
        'TRANSFER'::public.transaction_type,
        resource.source_warehouse_id,
        resource.target_warehouse_id,
        '[]'::jsonb,
        null,
        null,
        actor.id
      );
      if old_allowed is distinct from new_allowed then
        insert into wms_transaction_scope_reconciliation_results
        values (
          actor.id,
          actor.actor_role,
          'complete',
          case when new_allowed then 'unexpected_allow' else 'wrong_side_allow_removed' end
        );
      end if;
    end loop;
  end loop;

  if exists (
    select 1
    from wms_transaction_scope_reconciliation_results
    where change_kind = 'unexpected_allow'
  ) then
    raise exception 'UI-aligned transfer scope unexpectedly widened authorization';
  end if;
end $$;

reset role;

select actor_role, action_name, change_kind,
       count(distinct actor_id) as actor_count,
       count(*) as decision_tuple_count
from wms_transaction_scope_reconciliation_results
group by actor_role, action_name, change_kind
order by actor_role, action_name, change_kind;

rollback;
