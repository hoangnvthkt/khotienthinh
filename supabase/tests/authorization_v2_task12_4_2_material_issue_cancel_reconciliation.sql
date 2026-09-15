-- Compare E15 cancellation with the pre-E15 predicate for every active actor,
-- warehouse and creator relationship. Canonical approve may add access; no old
-- allow may be lost.
begin;

create temporary table material_issue_cancel_reconciliation_actors
on commit drop as
select id, auth_id, role::text as actor_role
from public.users
where is_active
  and account_status = 'ACTIVE'
  and auth_id is not null;

create temporary table material_issue_cancel_reconciliation_results (
  actor_id uuid not null,
  actor_role text not null,
  relationship_kind text not null,
  change_kind text not null
) on commit drop;

grant select on material_issue_cancel_reconciliation_actors to authenticated;
grant insert, select on material_issue_cancel_reconciliation_results to authenticated;
grant execute on function app_private.material_issue_can_cancel(text, uuid)
  to authenticated;

set local role authenticated;

do $$
declare
  actor material_issue_cancel_reconciliation_actors%rowtype;
  warehouse_id text;
  relationship_kind text;
  created_by uuid;
  old_allowed boolean;
  new_allowed boolean;
begin
  for actor in
    select * from material_issue_cancel_reconciliation_actors order by id
  loop
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', actor.auth_id, 'role', 'authenticated')::text,
      true
    );
    for warehouse_id in select id from public.warehouses order by id loop
      foreach relationship_kind in array array['unrelated', 'creator'] loop
        created_by := case when relationship_kind = 'creator' then actor.id end;
        old_allowed := coalesce(
          public.is_admin()
          or public.is_module_admin('WMS')
          or created_by = public.current_app_user_id(),
          false
        );
        new_allowed := app_private.material_issue_can_cancel(
          warehouse_id,
          created_by
        );
        if old_allowed is distinct from new_allowed then
          insert into material_issue_cancel_reconciliation_results
          values (
            actor.id,
            actor.actor_role,
            relationship_kind,
            case
              when old_allowed and not new_allowed then 'unexpected_legacy_loss'
              else 'canonical_allow_added'
            end
          );
        end if;
      end loop;
    end loop;
  end loop;

  if exists (
    select 1
    from material_issue_cancel_reconciliation_results
    where change_kind = 'unexpected_legacy_loss'
  ) then
    raise exception 'E15 material-issue cancel reconciliation lost access';
  end if;
end $$;

reset role;

select actor_role, relationship_kind, change_kind,
       count(distinct actor_id) as actor_count,
       count(*) as warehouse_decision_count
from material_issue_cancel_reconciliation_results
group by actor_role, relationship_kind, change_kind
order by actor_role, relationship_kind, change_kind;

rollback;
