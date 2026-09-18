-- Reconcile the dedicated supplier-return capability against the deployed RPC
-- predicate and the released UI across every active actor/context pair.
begin;

create temporary table supplier_return_dedicated_reconciliation_actors
on commit drop as
select id, auth_id, email, role::text as actor_role
from public.users
where is_active
  and account_status = 'ACTIVE'
  and auth_id is not null;

create temporary table supplier_return_dedicated_reconciliation_contexts
on commit drop as
select distinct
  'eligible_po'::text as context_kind,
  po.project_id::text as project_id,
  po.construction_site_id::text as construction_site_id,
  warehouse.id::text as source_warehouse_id
from public.purchase_orders po
cross join public.warehouses warehouse
where lower(coalesce(po.status::text, '')) in ('partial', 'delivered', 'closed')
union
select
  'isolated_wms'::text,
  null::text,
  null::text,
  warehouse.id::text
from public.warehouses warehouse;

create temporary table supplier_return_dedicated_reconciliation_results (
  actor_role text not null,
  context_kind text not null,
  change_kind text not null
) on commit drop;

create temporary table supplier_return_dedicated_reconciliation_totals (
  actor_count bigint not null,
  context_count bigint not null,
  decision_count bigint not null
) on commit drop;

grant select on supplier_return_dedicated_reconciliation_actors to authenticated;
grant select on supplier_return_dedicated_reconciliation_contexts to authenticated;
grant insert, select on supplier_return_dedicated_reconciliation_results to authenticated;
grant insert, select on supplier_return_dedicated_reconciliation_totals to authenticated;
grant execute on function app_private.purchase_order_supplier_return_can_create(
  text, text, text
) to authenticated;
grant execute on function app_private.wms_has_canonical_action(
  text, text, text, uuid, uuid, uuid
) to authenticated;

set local role authenticated;

do $$
declare
  actor supplier_return_dedicated_reconciliation_actors%rowtype;
  context_row supplier_return_dedicated_reconciliation_contexts%rowtype;
  old_rpc_allowed boolean;
  new_rpc_allowed boolean;
  canonical_allowed boolean;
  released_ui_allowed boolean;
  checked_decisions bigint := 0;
begin
  for actor in
    select * from supplier_return_dedicated_reconciliation_actors order by id
  loop
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object(
        'sub', actor.auth_id,
        'email', actor.email,
        'role', 'authenticated'
      )::text,
      true
    );

    for context_row in
      select * from supplier_return_dedicated_reconciliation_contexts
      order by context_kind, project_id nulls first,
        construction_site_id nulls first, source_warehouse_id
    loop
      old_rpc_allowed := coalesce(
        public.is_admin()
        or public.is_module_admin('WMS')
        or app_private.current_user_is_global_wms_keeper()
        or app_private.material_has_action(
          context_row.project_id,
          context_row.construction_site_id,
          'project.material_po.manage',
          public.current_app_user_id()
        ),
        false
      );
      canonical_allowed := app_private.wms_has_canonical_action(
        'wms.purchase_order.return_supplier',
        context_row.source_warehouse_id,
        null,
        null,
        null,
        public.current_app_user_id()
      );
      new_rpc_allowed := app_private.purchase_order_supplier_return_can_create(
        context_row.project_id,
        context_row.construction_site_id,
        context_row.source_warehouse_id
      );
      released_ui_allowed := coalesce(
        public.is_admin()
        or app_private.current_user_is_global_wms_keeper()
        or canonical_allowed,
        false
      );
      checked_decisions := checked_decisions + 1;

      if old_rpc_allowed is distinct from new_rpc_allowed then
        insert into supplier_return_dedicated_reconciliation_results
        values (
          actor.actor_role,
          context_row.context_kind,
          case
            when old_rpc_allowed and not new_rpc_allowed
              then 'unexpected_legacy_loss'
            when not old_rpc_allowed and new_rpc_allowed and canonical_allowed
              then 'canonical_allow_added'
            else 'unexpected_behavior_change'
          end
        );
      end if;
      if new_rpc_allowed and not released_ui_allowed then
        insert into supplier_return_dedicated_reconciliation_results
        values (
          actor.actor_role,
          context_row.context_kind,
          'compatibility_rpc_broader_than_ui'
        );
      end if;
      if canonical_allowed and not new_rpc_allowed then
        insert into supplier_return_dedicated_reconciliation_results
        values (
          actor.actor_role,
          context_row.context_kind,
          'unexpected_canonical_denial'
        );
      end if;
    end loop;
  end loop;

  insert into supplier_return_dedicated_reconciliation_totals
  select
    (select count(*) from supplier_return_dedicated_reconciliation_actors),
    (select count(*) from supplier_return_dedicated_reconciliation_contexts),
    checked_decisions;

  if exists (
    select 1
    from supplier_return_dedicated_reconciliation_results
    where change_kind in (
      'unexpected_legacy_loss',
      'unexpected_behavior_change',
      'unexpected_canonical_denial'
    )
  ) then
    raise exception 'Dedicated supplier-return capability reconciliation failed';
  end if;
end $$;

reset role;

select actor_count, context_count, decision_count,
       (select count(*) from supplier_return_dedicated_reconciliation_results
        where change_kind = 'canonical_allow_added') as canonical_additions,
       (select count(*) from supplier_return_dedicated_reconciliation_results
        where change_kind = 'compatibility_rpc_broader_than_ui')
         as compatibility_rpc_broader_than_ui,
       (select count(*) from supplier_return_dedicated_reconciliation_results
        where change_kind = 'unexpected_legacy_loss') as legacy_losses,
       (select count(*) from supplier_return_dedicated_reconciliation_results
        where change_kind in ('unexpected_behavior_change', 'unexpected_canonical_denial'))
         as unexpected_changes
from supplier_return_dedicated_reconciliation_totals;

rollback;
