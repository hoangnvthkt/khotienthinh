-- Reconcile the action-specific WMS delete boundary against the exact legacy
-- predicate for every active actor, warehouse pair, status and relationship.
begin;

create temporary table wms_request_delete_reconciliation_actors
on commit drop as
with ranked_actors as (
  select id, auth_id, email, role::text as actor_role,
         mod(row_number() over (order by id) - 1, 4) as actor_shard
  from public.users
  where is_active
    and account_status = 'ACTIVE'
    and auth_id is not null
)
select id, auth_id, email, actor_role
from ranked_actors
where nullif(current_setting('app.task12_4_2_actor_shard', true), '') is null
   or actor_shard = current_setting('app.task12_4_2_actor_shard')::integer;

create temporary table wms_request_delete_reconciliation_warehouses
on commit drop as
select id
from public.warehouses;

create temporary table wms_request_delete_reconciliation_results (
  actor_role text not null,
  wrapper_kind text not null,
  change_kind text not null
) on commit drop;

create temporary table wms_request_delete_reconciliation_totals (
  actor_count bigint not null,
  warehouse_count bigint not null,
  decision_count bigint not null
) on commit drop;

grant select on wms_request_delete_reconciliation_actors to authenticated;
grant select on wms_request_delete_reconciliation_warehouses to authenticated;
grant insert, select on wms_request_delete_reconciliation_results to authenticated;
grant insert, select on wms_request_delete_reconciliation_totals to authenticated;
grant execute on function app_private.material_request_wms_can_delete(
  text, uuid, text, text, text
) to authenticated;
grant execute on function app_private.wms_has_canonical_action(
  text, text, text, uuid, uuid, uuid
) to authenticated;

set local role authenticated;

do $$
declare
  actor wms_request_delete_reconciliation_actors%rowtype;
  source_warehouse_id text;
  site_warehouse_id text;
  status_value text;
  relationship_kind text;
  requester_id uuid;
  submitted_to_user_id text;
  actor_is_admin boolean;
  actor_is_wms_admin boolean;
  actor_is_global_keeper boolean;
  actor_is_source_keeper boolean;
  actor_is_site_keeper boolean;
  legacy_allowed boolean;
  canonical_scope_allowed boolean;
  canonical_allowed boolean;
  expected_allowed boolean;
  helper_allowed boolean;
  checked_decisions bigint := 0;
begin
  for actor in
    select * from wms_request_delete_reconciliation_actors order by id
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

    actor_is_admin := public.is_admin();
    actor_is_wms_admin := public.is_module_admin('WMS');
    actor_is_global_keeper := app_private.current_user_is_global_wms_keeper();

    for source_warehouse_id in
      select id from wms_request_delete_reconciliation_warehouses order by id
    loop
      actor_is_source_keeper := app_private.current_user_is_wms_keeper_for(
        source_warehouse_id
      );
      for site_warehouse_id in
        select id from wms_request_delete_reconciliation_warehouses order by id
      loop
        actor_is_site_keeper := app_private.current_user_is_wms_keeper_for(
          site_warehouse_id
        );
        canonical_scope_allowed := app_private.wms_has_canonical_action(
          'wms.request.delete',
          source_warehouse_id,
          site_warehouse_id,
          null,
          null,
          public.current_app_user_id()
        );
        foreach status_value in array array['DRAFT', 'REJECTED', 'PENDING', 'APPROVED'] loop
          foreach relationship_kind in array array['unrelated', 'requester', 'submitted_to'] loop
            requester_id := case when relationship_kind = 'requester' then actor.id end;
            submitted_to_user_id := case
              when relationship_kind = 'submitted_to' then actor.id::text
            end;

            legacy_allowed := coalesce(
              actor_is_admin
              or actor_is_wms_admin
              or (
                status_value in ('DRAFT', 'REJECTED')
                and requester_id = public.current_app_user_id()
              )
              or actor_is_global_keeper
              or actor_is_source_keeper
              or actor_is_site_keeper
              or (
                submitted_to_user_id is not null
                and submitted_to_user_id = public.current_app_user_id()::text
              ),
              false
            );
            canonical_allowed := status_value in ('DRAFT', 'PENDING', 'REJECTED')
              and canonical_scope_allowed;
            expected_allowed := coalesce(legacy_allowed or canonical_allowed, false);
            helper_allowed := app_private.material_request_wms_can_delete(
              status_value,
              requester_id,
              submitted_to_user_id,
              source_warehouse_id,
              site_warehouse_id
            );
            checked_decisions := checked_decisions + 1;

            if helper_allowed is distinct from expected_allowed then
              insert into wms_request_delete_reconciliation_results
              values (actor.actor_role, 'action_helper', 'unexpected_helper_result');
            end if;
            if legacy_allowed and not expected_allowed then
              insert into wms_request_delete_reconciliation_results
              values (actor.actor_role, 'expected', 'unexpected_legacy_loss');
            elsif not legacy_allowed and expected_allowed and canonical_allowed then
              insert into wms_request_delete_reconciliation_results
              values (actor.actor_role, 'expected', 'canonical_allow_added');
            elsif legacy_allowed is distinct from expected_allowed
                  and not canonical_allowed then
              insert into wms_request_delete_reconciliation_results
              values (actor.actor_role, 'expected', 'unexpected_access_change');
            end if;
          end loop;
        end loop;
      end loop;
    end loop;
  end loop;

  insert into wms_request_delete_reconciliation_totals
  select
    (select count(*) from wms_request_delete_reconciliation_actors),
    (select count(*) from wms_request_delete_reconciliation_warehouses),
    checked_decisions;

  if exists (
    select 1
    from wms_request_delete_reconciliation_results
    where change_kind <> 'canonical_allow_added'
  ) then
    raise exception 'Dedicated WMS request-delete capability reconciliation failed';
  end if;
end $$;

reset role;

select actor_count, warehouse_count, decision_count,
       (select count(*) from wms_request_delete_reconciliation_results
        where change_kind = 'canonical_allow_added') as canonical_additions,
       (select count(*) from wms_request_delete_reconciliation_results
        where change_kind = 'unexpected_legacy_loss') as legacy_losses,
       (select count(*) from wms_request_delete_reconciliation_results
        where change_kind not in ('canonical_allow_added', 'unexpected_legacy_loss'))
         as unexpected_changes
from wms_request_delete_reconciliation_totals;

rollback;
