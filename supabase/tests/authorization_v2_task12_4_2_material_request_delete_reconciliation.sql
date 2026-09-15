-- Compare the pre-E17 WMS predicate with the isolated compatibility helper and
-- both legacy wrappers for every active actor, warehouse pair, status and
-- actor relationship. All grants are temporary and the transaction rolls back.
begin;

create temporary table material_request_delete_reconciliation_actors
on commit drop as
select id, auth_id, email, role::text as actor_role
from public.users
where is_active
  and account_status = 'ACTIVE'
  and auth_id is not null;

create temporary table material_request_delete_reconciliation_results (
  actor_role text not null,
  wrapper_kind text not null,
  change_kind text not null
) on commit drop;

grant select on material_request_delete_reconciliation_actors to authenticated;
grant insert, select on material_request_delete_reconciliation_results to authenticated;
grant execute on function app_private.material_request_wms_can_delete_compatibility(
  text, uuid, text, text, text
) to authenticated;
grant execute on function app_private.material_request_can_delete(
  text, text, text, boolean, uuid, text, text, text
) to authenticated;
grant execute on function app_private.material_request_can_delete_v2(
  text, text, text, boolean, uuid, text, text, text, text
) to authenticated;

set local role authenticated;

do $$
declare
  actor material_request_delete_reconciliation_actors%rowtype;
  source_warehouse_id text;
  site_warehouse_id text;
  status_value text;
  relationship_kind text;
  requester_id uuid;
  submitted_to_user_id text;
  old_allowed boolean;
  helper_allowed boolean;
  v1_allowed boolean;
  v2_allowed boolean;
begin
  for actor in
    select * from material_request_delete_reconciliation_actors order by id
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

    for source_warehouse_id in select id from public.warehouses order by id loop
      for site_warehouse_id in select id from public.warehouses order by id loop
        foreach status_value in array array['DRAFT', 'REJECTED', 'SUBMITTED', 'APPROVED'] loop
          foreach relationship_kind in array array['unrelated', 'requester', 'submitted_to'] loop
            requester_id := case when relationship_kind = 'requester' then actor.id end;
            submitted_to_user_id := case
              when relationship_kind = 'submitted_to' then actor.id::text
            end;

            old_allowed := coalesce(
              public.is_admin()
              or public.is_module_admin('WMS')
              or (
                status_value in ('DRAFT', 'REJECTED')
                and requester_id = public.current_app_user_id()
              )
              or app_private.current_user_is_global_wms_keeper()
              or app_private.current_user_is_wms_keeper_for(source_warehouse_id)
              or app_private.current_user_is_wms_keeper_for(site_warehouse_id)
              or (
                submitted_to_user_id is not null
                and submitted_to_user_id = public.current_app_user_id()::text
              ),
              false
            );
            helper_allowed := app_private.material_request_wms_can_delete_compatibility(
              status_value,
              requester_id,
              submitted_to_user_id,
              source_warehouse_id,
              site_warehouse_id
            );
            v1_allowed := app_private.material_request_can_delete(
              'wms', null, status_value, false, requester_id,
              submitted_to_user_id, source_warehouse_id, site_warehouse_id
            );
            v2_allowed := app_private.material_request_can_delete_v2(
              'wms', null, status_value, false, requester_id,
              submitted_to_user_id, source_warehouse_id, site_warehouse_id, null
            );

            if helper_allowed is distinct from old_allowed then
              insert into material_request_delete_reconciliation_results
              values (actor.actor_role, 'compatibility_helper',
                case when old_allowed and not helper_allowed
                  then 'unexpected_legacy_loss' else 'unexpected_access_change' end);
            end if;
            if coalesce(v1_allowed, false) is distinct from old_allowed then
              insert into material_request_delete_reconciliation_results
              values (actor.actor_role, 'v1',
                case when old_allowed and not coalesce(v1_allowed, false)
                  then 'unexpected_legacy_loss' else 'unexpected_access_change' end);
            end if;
            if coalesce(v2_allowed, false) is distinct from old_allowed then
              insert into material_request_delete_reconciliation_results
              values (actor.actor_role, 'v2',
                case when old_allowed and not coalesce(v2_allowed, false)
                  then 'unexpected_legacy_loss' else 'unexpected_access_change' end);
            end if;
          end loop;
        end loop;
      end loop;
    end loop;
  end loop;

  if exists (select 1 from material_request_delete_reconciliation_results) then
    raise exception 'E17 material-request delete compatibility changed WMS access';
  end if;
end $$;

reset role;

select
  (select count(*) from material_request_delete_reconciliation_actors) as actor_count,
  (select count(*) from public.warehouses) as warehouse_count,
  (select count(*) from material_request_delete_reconciliation_actors)
    * (select count(*) from public.warehouses)
    * (select count(*) from public.warehouses)
    * 4 * 3 as decision_count,
  count(*) filter (where change_kind = 'unexpected_legacy_loss')
    as unexpected_legacy_loss_count,
  count(*) filter (where change_kind = 'unexpected_access_change')
    as unexpected_access_change_count
from material_request_delete_reconciliation_results;

rollback;
