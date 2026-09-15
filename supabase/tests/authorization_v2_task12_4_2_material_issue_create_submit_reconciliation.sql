-- Compare the former material-issue create/submit predicates with the
-- canonical-aware helpers across every active user and warehouse.
begin;

create temporary table material_issue_create_submit_reconciliation_actors
on commit drop as
select id, auth_id, role::text as actor_role, assigned_warehouse_id
from public.users
where is_active
  and account_status = 'ACTIVE'
  and auth_id is not null;

create temporary table material_issue_create_submit_reconciliation_results (
  actor_id uuid not null,
  actor_role text not null,
  decision_kind text not null,
  change_kind text not null
) on commit drop;

grant select on material_issue_create_submit_reconciliation_actors
  to authenticated;
grant insert, select on material_issue_create_submit_reconciliation_results
  to authenticated;
grant execute on function app_private.material_issue_can_create(text, text, text)
  to authenticated;
grant execute on function app_private.material_issue_can_submit(
  text, text, text, uuid
) to authenticated;

set local role authenticated;

do $$
declare
  actor material_issue_create_submit_reconciliation_actors%rowtype;
  warehouse_id text;
  old_create_allowed boolean;
  old_submit_allowed boolean;
  new_allowed boolean;
begin
  for actor in
    select *
    from material_issue_create_submit_reconciliation_actors
    order by id
  loop
    perform set_config('request.jwt.claim.sub', actor.auth_id::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object(
        'sub', actor.auth_id,
        'role', 'authenticated'
      )::text,
      true
    );

    for warehouse_id in select id from public.warehouses order by id loop
      old_create_allowed := coalesce(
        public.is_admin()
        or public.is_module_admin('WMS')
        or app_private.current_user_is_global_wms_keeper()
        or app_private.current_user_is_wms_keeper_for(warehouse_id),
        false
      );

      new_allowed := app_private.material_issue_can_create(
        null,
        null,
        warehouse_id
      );
      if old_create_allowed is distinct from new_allowed then
        insert into material_issue_create_submit_reconciliation_results
        values (
          actor.id,
          actor.actor_role,
          'create',
          case
            when new_allowed then 'canonical_allow_added'
            else 'unexpected_legacy_loss'
          end
        );
      end if;

      old_submit_allowed := coalesce(
        public.is_admin()
        or public.is_module_admin('WMS')
        or app_private.current_user_is_global_wms_keeper(),
        false
      );

      new_allowed := app_private.material_issue_can_submit(
        null,
        null,
        warehouse_id,
        null
      );
      if old_submit_allowed is distinct from new_allowed then
        insert into material_issue_create_submit_reconciliation_results
        values (
          actor.id,
          actor.actor_role,
          'submit_other',
          case
            when new_allowed then 'canonical_allow_added'
            else 'unexpected_legacy_loss'
          end
        );
      end if;

      if not app_private.material_issue_can_submit(
        null,
        null,
        warehouse_id,
        actor.id
      ) then
        insert into material_issue_create_submit_reconciliation_results
        values (
          actor.id,
          actor.actor_role,
          'submit_self',
          'unexpected_legacy_loss'
        );
      end if;
    end loop;
  end loop;

  if exists (
    select 1
    from material_issue_create_submit_reconciliation_results
    where change_kind = 'unexpected_legacy_loss'
  ) then
    raise exception 'Canonical material-issue helper removed a legacy allow';
  end if;
end $$;

reset role;

select actor_role, decision_kind, change_kind,
       count(distinct actor_id) as actor_count,
       count(*) as warehouse_decision_count
from material_issue_create_submit_reconciliation_results
group by actor_role, decision_kind, change_kind
order by actor_role, decision_kind, change_kind;

rollback;
