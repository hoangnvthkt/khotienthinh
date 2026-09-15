-- Reconcile both settlement commands against their pre-E18 compatibility
-- predicate across every active actor, warehouse and supported relationship.
begin;

create temporary table material_issue_settlement_reconciliation_actors
on commit drop as
select id, auth_id, role::text as actor_role
from public.users
where is_active
  and account_status = 'ACTIVE'
  and auth_id is not null;

create temporary table material_issue_settlement_reconciliation_warehouses
on commit drop as
select id
from public.warehouses;

create temporary table material_issue_settlement_reconciliation_results (
  actor_id uuid not null,
  actor_role text not null,
  decision_kind text not null,
  relationship_kind text not null,
  change_kind text not null
) on commit drop;

create temporary table material_issue_settlement_reconciliation_totals (
  actor_count bigint not null,
  warehouse_count bigint not null,
  decision_count bigint not null
) on commit drop;

grant select on material_issue_settlement_reconciliation_actors to authenticated;
grant select on material_issue_settlement_reconciliation_warehouses to authenticated;
grant insert, select on material_issue_settlement_reconciliation_results to authenticated;
grant insert, select on material_issue_settlement_reconciliation_totals to authenticated;
grant execute on function app_private.material_issue_can_post_settlement(
  text, uuid, uuid, text, text
) to authenticated;
grant execute on function app_private.material_issue_can_reverse_settlement(
  text, uuid, uuid, text, text
) to authenticated;
grant execute on function app_private.wms_has_canonical_action(
  text, text, text, uuid, uuid, uuid
) to authenticated;

set local role authenticated;

do $$
declare
  actor material_issue_settlement_reconciliation_actors%rowtype;
  warehouse_id text;
  relationship_kind text;
  created_by uuid;
  responsible_user_id uuid;
  recipient_type text;
  recipient_id text;
  old_allowed boolean;
  new_allowed boolean;
  canonical_allowed boolean;
  decision_kind text;
  checked_decisions bigint := 0;
begin
  for actor in
    select * from material_issue_settlement_reconciliation_actors order by id
  loop
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', actor.auth_id, 'role', 'authenticated')::text,
      true
    );

    for warehouse_id in
      select id from material_issue_settlement_reconciliation_warehouses order by id
    loop
      foreach relationship_kind in array array[
        'unrelated', 'creator', 'responsible', 'employee_recipient'
      ] loop
        created_by := case when relationship_kind = 'creator' then actor.id end;
        responsible_user_id := case
          when relationship_kind = 'responsible' then actor.id
        end;
        recipient_type := case
          when relationship_kind = 'employee_recipient' then 'employee'
          else 'manual'
        end;
        recipient_id := case
          when relationship_kind = 'employee_recipient' then actor.id::text
        end;

        old_allowed := coalesce(
          public.is_admin()
          or public.is_module_admin('WMS')
          or app_private.current_user_is_global_wms_keeper()
          or app_private.current_user_is_wms_keeper_for(warehouse_id)
          or created_by = public.current_app_user_id()
          or responsible_user_id = public.current_app_user_id()
          or (
            recipient_type = 'employee'
            and recipient_id = public.current_app_user_id()::text
          ),
          false
        );

        foreach decision_kind in array array[
          'post_settlement', 'reverse_settlement'
        ] loop
          new_allowed := case decision_kind
            when 'post_settlement' then
              app_private.material_issue_can_post_settlement(
                warehouse_id, created_by, responsible_user_id,
                recipient_type, recipient_id
              )
            when 'reverse_settlement' then
              app_private.material_issue_can_reverse_settlement(
                warehouse_id, created_by, responsible_user_id,
                recipient_type, recipient_id
              )
          end;
          canonical_allowed := app_private.wms_has_canonical_action(
            case decision_kind
              when 'post_settlement' then 'wms.material_issue.settle'
              else 'wms.material_issue.reverse_settlement'
            end,
            warehouse_id,
            null,
            null,
            null,
            public.current_app_user_id()
          );
          checked_decisions := checked_decisions + 1;

          if old_allowed is distinct from new_allowed then
            insert into material_issue_settlement_reconciliation_results
            values (
              actor.id,
              actor.actor_role,
              decision_kind,
              relationship_kind,
              case
                when old_allowed and not new_allowed then 'unexpected_legacy_loss'
                when not old_allowed and new_allowed and canonical_allowed
                  then 'canonical_allow_added'
                else 'unexpected_behavior_change'
              end
            );
          end if;
        end loop;
      end loop;
    end loop;
  end loop;

  insert into material_issue_settlement_reconciliation_totals
  select
    (select count(*) from material_issue_settlement_reconciliation_actors),
    (select count(*) from material_issue_settlement_reconciliation_warehouses),
    checked_decisions;

  if exists (
    select 1
    from material_issue_settlement_reconciliation_results
    where change_kind in ('unexpected_legacy_loss', 'unexpected_behavior_change')
  ) then
    raise exception 'E18 material-issue settlement reconciliation failed';
  end if;
end $$;

reset role;

select actor_count, warehouse_count, decision_count,
       (select count(*) from material_issue_settlement_reconciliation_results
        where change_kind = 'canonical_allow_added') as canonical_additions,
       (select count(*) from material_issue_settlement_reconciliation_results
        where change_kind = 'unexpected_legacy_loss') as legacy_losses,
       (select count(*) from material_issue_settlement_reconciliation_results
        where change_kind = 'unexpected_behavior_change') as unexpected_changes
from material_issue_settlement_reconciliation_totals;

rollback;
