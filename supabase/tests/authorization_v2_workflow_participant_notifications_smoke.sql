-- Cloud-only rollback smoke for participant continuity, notification eligibility,
-- and the server-authoritative Workflow notification contract.
begin;

do $$
declare
  v_instance_id uuid;
  v_creator_id uuid;
  v_prior_actor_id uuid;
  v_event_key text := 'workflow-participant-smoke:' || gen_random_uuid()::text;
  v_outbox_id uuid;
  v_recipients uuid[];
  v_distinct_recipients integer;
begin
  if not exists (
    select 1 from pg_class
    where oid = 'public.workflow_instance_participants'::regclass
      and relrowsecurity
  ) then
    raise exception 'Workflow participant ledger RLS is not enabled';
  end if;

  if has_table_privilege('anon', 'public.workflow_instance_participants', 'SELECT')
     or has_table_privilege('authenticated', 'public.workflow_instance_participants', 'SELECT')
     or has_table_privilege('service_role', 'public.workflow_instance_participants', 'SELECT') then
    raise exception 'Workflow participant ledger exposes direct table SELECT privileges';
  end if;

  if has_function_privilege('authenticated', 'app_private.upsert_workflow_instance_participant(uuid,uuid,text,text,timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'app_private.reconcile_workflow_instance_participants(uuid,text)', 'EXECUTE') then
    raise exception 'Workflow participant write helpers are callable by authenticated';
  end if;

  if exists (
    select 1
    from public.workflow_instance_participants
    group by instance_id, user_id, participant_role
    having count(*) > 1
  ) then
    raise exception 'Workflow participant primary key is not deduplicated';
  end if;

  if not exists (select 1 from pg_proc where oid = 'app_private.workflow_instance_user_can_select(uuid,uuid)'::regprocedure)
     or not exists (select 1 from pg_proc where oid = 'app_private.workflow_instance_actor_can_select(uuid)'::regprocedure) then
    raise exception 'Workflow participant selector functions are missing';
  end if;

  select wi.id, wi.created_by
    into v_instance_id, v_creator_id
  from public.workflow_instances wi
  where not exists (
    select 1 from public.workflow_subjects ws where ws.workflow_instance_id = wi.id
  )
  order by wi.created_at desc
  limit 1;

  if v_instance_id is null then
    return;
  end if;

  select il.acted_by
    into v_prior_actor_id
  from public.workflow_instance_logs il
  join public.users u on u.id = il.acted_by
    and u.is_active and u.account_status = 'ACTIVE'
  where il.instance_id = v_instance_id
    and il.action in ('APPROVED', 'REJECTED', 'REVISION_REQUESTED')
  order by il.created_at asc, il.id asc
  limit 1;

  if v_prior_actor_id is not null then
    if not exists (
      select 1
      from public.workflow_instance_participants p
      where p.instance_id = v_instance_id
        and p.user_id = v_prior_actor_id
        and p.participant_role = 'ASSIGNEE'
        and p.ended_at is null
    ) then
      raise exception 'Prior workflow actor is missing active ASSIGNEE continuity';
    end if;

    perform set_config('app.authorization_permission_command', 'on', true);
    insert into public.user_permission_grants(
      user_id, permission_code, scope_type, scope_id, is_active, grant_reason
    ) values (
      v_prior_actor_id, 'workflow.instance.view', 'assigned', v_prior_actor_id::text,
      true, 'rollback participant continuity smoke'
    ) on conflict (user_id, permission_code, scope_type, scope_id)
      do update set is_active = true;

    if not app_private.workflow_instance_user_can_select(v_instance_id, v_prior_actor_id) then
      raise exception 'Prior workflow actor cannot select the instance after participant backfill';
    end if;
  end if;

  if v_creator_id is not null then
    perform app_private.enqueue_workflow_notification_event(
      v_instance_id, 'workflow.participant_smoke', v_creator_id, v_event_key,
      jsonb_build_object('nodeId', null, 'commentId', null)
    );
    select id, recipient_user_ids into v_outbox_id, v_recipients
    from app_private.workflow_notification_outbox
    where event_key = v_event_key;
    if v_outbox_id is null then
      raise exception 'Workflow participant notification outbox event was not enqueued';
    end if;
    select count(distinct recipient_id)
      into v_distinct_recipients
    from unnest(coalesce(v_recipients, '{}'::uuid[])) recipient_id;
    if cardinality(coalesce(v_recipients, '{}'::uuid[])) <> v_distinct_recipients
       or (select payload ->> 'eventKey' from app_private.workflow_notification_outbox where id = v_outbox_id) <> v_event_key then
      raise exception 'Workflow participant notification recipients are not deduplicated';
    end if;
  end if;
end;
$$;

create temporary table workflow_participant_rls_context(
  instance_id uuid not null,
  prior_user_id uuid not null,
  prior_auth_id uuid not null,
  outsider_user_id uuid not null,
  outsider_auth_id uuid not null
) on commit drop;

insert into workflow_participant_rls_context
select prior_log.instance_id,
       prior_log.acted_by,
       prior_user.auth_id,
       outsider.id,
       outsider.auth_id
from public.workflow_instance_logs prior_log
join public.users prior_user on prior_user.id = prior_log.acted_by
  and prior_user.is_active and prior_user.account_status = 'ACTIVE'
  and prior_user.auth_id is not null
join public.workflow_instances instance_row on instance_row.id = prior_log.instance_id
left join public.workflow_subjects subject_row on subject_row.workflow_instance_id = instance_row.id
cross join lateral (
  select candidate.id, candidate.auth_id
  from public.users candidate
  where candidate.is_active
    and candidate.account_status = 'ACTIVE'
    and candidate.auth_id is not null
    and candidate.role::text not in ('ADMIN', 'SUPER_ADMIN')
    and candidate.id <> prior_log.acted_by
    and not exists (
      select 1
      from public.user_permission_grants global_grant
      where global_grant.user_id = candidate.id
        and global_grant.is_active
        and global_grant.scope_type = 'global'
        and global_grant.scope_id = '*'
        and global_grant.permission_code in ('workflow.instance.view', 'workflow.instance.administer')
    )
    and not exists (
      select 1 from public.workflow_instance_participants participant_row
      where participant_row.instance_id = instance_row.id
        and participant_row.user_id = candidate.id
        and participant_row.ended_at is null
    )
  order by candidate.created_at, candidate.id
  limit 1
) outsider
where subject_row.workflow_instance_id is null
  and prior_log.action in ('APPROVED', 'REJECTED', 'REVISION_REQUESTED')
  and exists (
    select 1 from public.workflow_instance_participants participant_row
    where participant_row.instance_id = prior_log.instance_id
      and participant_row.user_id = prior_log.acted_by
      and participant_row.participant_role = 'ASSIGNEE'
      and participant_row.ended_at is null
  )
order by prior_log.created_at, prior_log.id
limit 1;

select set_config('app.authorization_permission_command', 'on', true);
insert into public.user_permission_grants(
  user_id, permission_code, scope_type, scope_id, is_active, grant_reason
)
select prior_user_id, 'workflow.instance.view', 'assigned', prior_user_id::text,
       true, 'rollback participant RLS smoke'
from workflow_participant_rls_context
on conflict (user_id, permission_code, scope_type, scope_id)
  do update set is_active = true;
insert into public.user_permission_grants(
  user_id, permission_code, scope_type, scope_id, is_active, grant_reason
)
select outsider_user_id, 'workflow.instance.view', 'assigned', outsider_user_id::text,
       true, 'rollback participant RLS smoke'
from workflow_participant_rls_context
on conflict (user_id, permission_code, scope_type, scope_id)
  do update set is_active = true;

grant select on workflow_participant_rls_context to authenticated;
set local role authenticated;

do $$
declare
  context_row workflow_participant_rls_context%rowtype;
begin
  select * into context_row from workflow_participant_rls_context;
  if context_row.instance_id is null then
    return;
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', context_row.prior_auth_id, 'role', 'authenticated'
  )::text, true);
  if not exists (
    select 1 from public.workflow_instances where id = context_row.instance_id
  ) then
    raise exception 'Prior workflow participant cannot read the instance through RLS';
  end if;
  if not exists (
    select 1 from public.workflow_instance_logs where instance_id = context_row.instance_id
  ) then
    raise exception 'Prior workflow participant cannot read workflow logs through RLS';
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', context_row.outsider_auth_id, 'role', 'authenticated'
  )::text, true);
  if exists (
    select 1 from public.workflow_instances where id = context_row.instance_id
  ) then
    raise exception 'Outsider can read a workflow instance without participant relation';
  end if;
end;
$$;

reset role;

select 'authorization_v2_workflow_participant_notifications_smoke_passed' as result;
rollback;
