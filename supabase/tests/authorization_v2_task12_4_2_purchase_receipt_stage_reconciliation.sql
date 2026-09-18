-- Compare the former purchase-receipt helper with the canonical-aware helper.
-- Results are aggregated and all temporary grants/data roll back.
begin;

create temporary table purchase_receipt_stage_reconciliation_actors on commit drop as
select id, auth_id, role::text as actor_role, assigned_warehouse_id
from public.users
where is_active
  and account_status = 'ACTIVE'
  and auth_id is not null;

create temporary table purchase_receipt_stage_reconciliation_results (
  actor_id uuid not null,
  actor_role text not null,
  change_kind text not null
) on commit drop;

grant select on purchase_receipt_stage_reconciliation_actors to authenticated;
grant insert, select on purchase_receipt_stage_reconciliation_results to authenticated;
grant execute on function app_private.current_user_can_receive_purchase_batch_v2(uuid, text)
  to authenticated;

set local role authenticated;

do $$
declare
  actor purchase_receipt_stage_reconciliation_actors%rowtype;
  warehouse_id text;
  old_allowed boolean;
  new_allowed boolean;
begin
  for actor in select * from purchase_receipt_stage_reconciliation_actors order by id loop
    perform set_config('request.jwt.claim.sub', actor.auth_id::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', actor.auth_id, 'role', 'authenticated')::text,
      true
    );

    for warehouse_id in select id from public.warehouses order by id loop
      old_allowed := coalesce(
        public.is_admin()
        or public.is_module_admin('WMS')
        or app_private.current_user_is_global_wms_keeper()
        or app_private.current_user_is_wms_keeper_for(warehouse_id)
        or (
          actor.actor_role in ('ADMIN', 'WAREHOUSE_KEEPER', 'KEEPER')
          and (
            actor.assigned_warehouse_id is null
            or actor.assigned_warehouse_id = warehouse_id
          )
        ),
        false
      );

      new_allowed := app_private.current_user_can_receive_purchase_batch_v2(
        actor.id,
        warehouse_id
      );

      if old_allowed is distinct from new_allowed then
        insert into purchase_receipt_stage_reconciliation_results
        values (
          actor.id,
          actor.actor_role,
          case when new_allowed then 'canonical_allow_added' else 'unexpected_legacy_loss' end
        );
      end if;
    end loop;
  end loop;

  if exists (
    select 1
    from purchase_receipt_stage_reconciliation_results
    where change_kind = 'unexpected_legacy_loss'
  ) then
    raise exception 'Canonical purchase receipt helper removed a legacy allow';
  end if;
end $$;

reset role;

select actor_role, change_kind,
       count(distinct actor_id) as actor_count,
       count(*) as warehouse_decision_count
from purchase_receipt_stage_reconciliation_results
group by actor_role, change_kind
order by actor_role, change_kind;

rollback;
