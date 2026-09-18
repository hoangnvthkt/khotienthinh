-- Reconcile every active actor and warehouse against the pre-E14 predicate.
-- Receipt/return may gain their reviewed canonical capability; no former allow
-- may be lost, and settlement/reversal must remain exact parity.
begin;

create temporary table material_issue_process_reconciliation_actors
on commit drop as
select id, auth_id, role::text as actor_role
from public.users
where is_active
  and account_status = 'ACTIVE'
  and auth_id is not null;

create temporary table material_issue_process_reconciliation_results (
  actor_id uuid not null,
  actor_role text not null,
  decision_kind text not null,
  relationship_kind text not null,
  change_kind text not null
) on commit drop;

grant select on material_issue_process_reconciliation_actors to authenticated;
grant insert, select on material_issue_process_reconciliation_results to authenticated;
grant execute on function app_private.material_issue_can_confirm_receipt(
  text, uuid, uuid, text, text
) to authenticated;
grant execute on function app_private.material_issue_can_create_return(
  text, uuid, uuid, text, text
) to authenticated;
grant execute on function app_private.material_issue_can_post_settlement(
  text, uuid, uuid, text, text
) to authenticated;
grant execute on function app_private.material_issue_can_reverse_settlement(
  text, uuid, uuid, text, text
) to authenticated;

set local role authenticated;

do $$
declare
  actor material_issue_process_reconciliation_actors%rowtype;
  warehouse_id text;
  relationship_kind text;
  created_by uuid;
  responsible_user_id uuid;
  recipient_type text;
  recipient_id text;
  old_allowed boolean;
  new_allowed boolean;
  decision_kind text;
begin
  for actor in
    select * from material_issue_process_reconciliation_actors order by id
  loop
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', actor.auth_id, 'role', 'authenticated')::text,
      true
    );

    for warehouse_id in select id from public.warehouses order by id loop
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
          'confirm_receipt', 'create_return', 'post_settlement',
          'reverse_settlement'
        ] loop
          new_allowed := case decision_kind
            when 'confirm_receipt' then
              app_private.material_issue_can_confirm_receipt(
                warehouse_id, created_by, responsible_user_id,
                recipient_type, recipient_id
              )
            when 'create_return' then
              app_private.material_issue_can_create_return(
                warehouse_id, created_by, responsible_user_id,
                recipient_type, recipient_id
              )
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

          if old_allowed is distinct from new_allowed then
            insert into material_issue_process_reconciliation_results
            values (
              actor.id,
              actor.actor_role,
              decision_kind,
              relationship_kind,
              case
                when old_allowed and not new_allowed then 'unexpected_legacy_loss'
                when decision_kind in ('confirm_receipt', 'create_return')
                  then 'canonical_allow_added'
                else 'unexpected_behavior_change'
              end
            );
          end if;
        end loop;
      end loop;
    end loop;
  end loop;

  if exists (
    select 1
    from material_issue_process_reconciliation_results
    where change_kind in ('unexpected_legacy_loss', 'unexpected_behavior_change')
  ) then
    raise exception 'E14 material-issue processing reconciliation failed';
  end if;
end $$;

reset role;

select actor_role, decision_kind, relationship_kind, change_kind,
       count(distinct actor_id) as actor_count,
       count(*) as warehouse_decision_count
from material_issue_process_reconciliation_results
group by actor_role, decision_kind, relationship_kind, change_kind
order by actor_role, decision_kind, relationship_kind, change_kind;

rollback;
