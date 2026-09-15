-- Compare the released supplier-return UI, the current RPC guard and the
-- tempting wms.transaction.create mapping. This is evidence-only: it must not
-- grant supplier-return access or persist any fixture.
begin;

create temporary table supplier_return_reconciliation_actors
on commit drop as
select id, auth_id, email, role::text as actor_role
from public.users
where is_active
  and account_status = 'ACTIVE'
  and auth_id is not null;

create temporary table supplier_return_reconciliation_contexts
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

create temporary table supplier_return_reconciliation_results (
  actor_role text not null,
  context_kind text not null,
  change_kind text not null
) on commit drop;

grant select on supplier_return_reconciliation_actors to authenticated;
grant select on supplier_return_reconciliation_contexts to authenticated;
grant insert, select on supplier_return_reconciliation_results to authenticated;
grant execute on function app_private.wms_has_canonical_action(
  text, text, text, uuid, uuid, uuid
) to authenticated;

set local role authenticated;

do $$
declare
  actor supplier_return_reconciliation_actors%rowtype;
  context_row supplier_return_reconciliation_contexts%rowtype;
  released_ui_allowed boolean;
  current_rpc_allowed boolean;
  canonical_create_allowed boolean;
  candidate_rpc_allowed boolean;
begin
  for actor in
    select * from supplier_return_reconciliation_actors order by id
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
      select * from supplier_return_reconciliation_contexts
      order by context_kind, project_id nulls first,
        construction_site_id nulls first, source_warehouse_id
    loop
      released_ui_allowed := coalesce(
        public.is_admin()
        or app_private.current_user_is_global_wms_keeper(),
        false
      );
      current_rpc_allowed := coalesce(
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
      canonical_create_allowed := app_private.wms_has_canonical_action(
        'wms.transaction.create',
        context_row.source_warehouse_id,
        null,
        null,
        null,
        public.current_app_user_id()
      );
      candidate_rpc_allowed := current_rpc_allowed or canonical_create_allowed;

      if current_rpc_allowed and not released_ui_allowed then
        insert into supplier_return_reconciliation_results
        values (actor.actor_role, context_row.context_kind, 'rpc_broader_than_ui');
      end if;
      if candidate_rpc_allowed and not current_rpc_allowed then
        insert into supplier_return_reconciliation_results
        values (actor.actor_role, context_row.context_kind, 'create_mapping_adds_rpc_access');
      end if;
      if canonical_create_allowed and not released_ui_allowed then
        insert into supplier_return_reconciliation_results
        values (actor.actor_role, context_row.context_kind, 'create_mapping_broader_than_ui');
      end if;
      if current_rpc_allowed and not candidate_rpc_allowed then
        insert into supplier_return_reconciliation_results
        values (actor.actor_role, context_row.context_kind, 'unexpected_legacy_loss');
      end if;
    end loop;
  end loop;

  if exists (
    select 1
    from supplier_return_reconciliation_results
    where change_kind = 'unexpected_legacy_loss'
  ) then
    raise exception 'Supplier-return create candidate lost current RPC access';
  end if;
end $$;

reset role;

select actor_role, context_kind, change_kind,
       count(*) as decision_count
from supplier_return_reconciliation_results
group by actor_role, context_kind, change_kind
order by actor_role, context_kind, change_kind;

select
  (select count(*) from supplier_return_reconciliation_actors) as actor_count,
  (select count(*) from supplier_return_reconciliation_contexts) as context_count,
  count(*) filter (where change_kind = 'rpc_broader_than_ui')
    as rpc_broader_than_ui_count,
  count(*) filter (where change_kind = 'create_mapping_adds_rpc_access')
    as create_mapping_adds_rpc_access_count,
  count(*) filter (where change_kind = 'create_mapping_broader_than_ui')
    as create_mapping_broader_than_ui_count,
  count(*) filter (where change_kind = 'unexpected_legacy_loss')
    as unexpected_legacy_loss_count
from supplier_return_reconciliation_results;

rollback;
