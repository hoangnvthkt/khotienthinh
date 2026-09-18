-- Read-only reconciliation: every currently valid Request lifecycle decision
-- must remain allowed by the exact-or-compatibility E26 resolver.
begin;
with pending_assignments as (
  select request_row.id request_id,assignment.assignee_user_id actor_id
  from public.request_instances request_row
  join public.workflow_step_assignments assignment
    on assignment.workflow_subject_id=request_row.workflow_subject_id
  where assignment.status='PENDING'
), assigned_decisions as (
  select request_id,actor_id,action_name,
    app_private.request_actor_has_lifecycle_action(request_id,actor_id,action_name) new_allowed
  from pending_assignments
  cross join (values('APPROVE'),('REJECT'),('RETURN')) action(action_name)
), owner_decisions as (
  select request_row.id request_id,request_row.created_by actor_id,action_name,
    app_private.request_actor_has_lifecycle_action(request_row.id,request_row.created_by,action_name) new_allowed
  from public.request_instances request_row
  cross join lateral (values
    ('EDIT_CONTENT'),
    (case when request_row.status='RETURNED' then 'RESUBMIT' end),
    (case when request_row.status not in ('APPROVED','REJECTED','CANCELLED') then 'CANCEL' end)
  ) action(action_name)
  where action_name is not null
), combined as (
  select * from assigned_decisions union all select * from owner_decisions
)
select count(*) total_legacy_allowed,
       count(*) filter(where new_allowed) retained,
       count(*) filter(where not new_allowed) unexpected_losses
from combined;

do $$
begin
  if exists (
    with pending_assignments as (
      select request_row.id request_id,assignment.assignee_user_id actor_id
      from public.request_instances request_row
      join public.workflow_step_assignments assignment
        on assignment.workflow_subject_id=request_row.workflow_subject_id
      where assignment.status='PENDING'
    )
    select 1 from pending_assignments pending
    cross join (values('APPROVE'),('REJECT'),('RETURN')) action(action_name)
    where not app_private.request_actor_has_lifecycle_action(
      pending.request_id,pending.actor_id,action.action_name
    )
  ) then raise exception 'E26 Request assigned-action compatibility loss'; end if;

  if exists (
    select 1 from public.request_instances request_row
    where request_row.status in ('PENDING','RETURNED')
      and not app_private.request_actor_has_lifecycle_action(
        request_row.id,request_row.created_by,'EDIT_CONTENT'
      )
  ) then raise exception 'E26 Request owner-edit compatibility loss'; end if;
end;
$$;
rollback;
