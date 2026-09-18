create table public.workflow_instance_participants (
  instance_id uuid not null references public.workflow_instances(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  participant_role text not null check (participant_role in ('CREATOR', 'ASSIGNEE', 'WATCHER')),
  source_ref text,
  joined_at timestamptz not null default now(),
  last_confirmed_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (instance_id, user_id, participant_role)
);

create index workflow_instance_participants_user_instance_idx
  on public.workflow_instance_participants(user_id, instance_id);
create index workflow_instance_participants_instance_role_idx
  on public.workflow_instance_participants(instance_id, participant_role, ended_at);
create index workflow_instance_participants_active_watcher_idx
  on public.workflow_instance_participants(instance_id, user_id)
  where participant_role = 'WATCHER' and ended_at is null;

alter table public.workflow_instance_participants enable row level security;
revoke all on public.workflow_instance_participants from public, anon, authenticated, service_role;

create or replace function app_private.upsert_workflow_instance_participant(
  p_instance_id uuid,
  p_user_id uuid,
  p_participant_role text,
  p_source_ref text default null,
  p_ended_at timestamptz default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_participant_role not in ('CREATOR', 'ASSIGNEE', 'WATCHER') then
    raise exception 'WORKFLOW_PARTICIPANT_ROLE_INVALID' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.workflow_subjects
    where workflow_instance_id = p_instance_id
  ) then
    return;
  end if;

  if not exists (
    select 1 from public.workflow_instances where id = p_instance_id
  ) then
    raise exception 'WORKFLOW_INSTANCE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.users
    where id = p_user_id and is_active and account_status = 'ACTIVE'
  ) then
    raise exception 'WORKFLOW_PARTICIPANT_USER_INVALID' using errcode = '22023';
  end if;

  insert into public.workflow_instance_participants(
    instance_id, user_id, participant_role, source_ref, joined_at, last_confirmed_at, ended_at
  ) values (
    p_instance_id, p_user_id, p_participant_role, p_source_ref, now(), now(),
    case when p_participant_role = 'WATCHER' then p_ended_at else null end
  )
  on conflict (instance_id, user_id, participant_role) do update
  set source_ref = coalesce(excluded.source_ref, public.workflow_instance_participants.source_ref),
      last_confirmed_at = now(),
      ended_at = case
        when public.workflow_instance_participants.participant_role = 'WATCHER' then excluded.ended_at
        else null
      end,
      updated_at = now();
end;
$$;

revoke all on function app_private.upsert_workflow_instance_participant(uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function app_private.reconcile_workflow_instance_participants(
  p_instance_id uuid,
  p_source_ref text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_instance public.workflow_instances%rowtype;
  v_user_id uuid;
  v_watcher_ids uuid[] := '{}';
begin
  select * into v_instance from public.workflow_instances where id = p_instance_id;
  if v_instance.id is null or exists (
    select 1 from public.workflow_subjects where workflow_instance_id = p_instance_id
  ) then
    return;
  end if;

  if exists (
    select 1 from public.users
    where id = v_instance.created_by and is_active and account_status = 'ACTIVE'
  ) then
    perform app_private.upsert_workflow_instance_participant(
      v_instance.id, v_instance.created_by, 'CREATOR', coalesce(p_source_ref, 'instance:' || v_instance.id::text)
    );
  end if;

  for v_user_id in
    select distinct x.value::uuid
    from unnest(coalesce(v_instance.watchers, '{}'::text[])) x(value)
    join public.users u on u.id::text = x.value and u.is_active and u.account_status = 'ACTIVE'
    where x.value ~* '^[0-9a-f-]{36}$'
  loop
    v_watcher_ids := array_append(v_watcher_ids, v_user_id);
    perform app_private.upsert_workflow_instance_participant(
      v_instance.id, v_user_id, 'WATCHER', coalesce(p_source_ref, 'watchers:' || v_instance.id::text)
    );
  end loop;

  update public.workflow_instance_participants
  set ended_at = now(), updated_at = now()
  where instance_id = v_instance.id
    and participant_role = 'WATCHER'
    and ended_at is null
    and not (user_id = any(v_watcher_ids));

  for v_user_id in
    select distinct x.value::uuid
    from jsonb_each(coalesce(v_instance.step_assignees, '{}'::jsonb)) step_entry
    cross join lateral (
      select step_entry.value #>> '{}' as value
      where jsonb_typeof(step_entry.value) = 'string'
      union all
      select value
      from jsonb_array_elements_text(step_entry.value)
      where jsonb_typeof(step_entry.value) = 'array'
    ) x
    join public.users u on u.id::text = x.value and u.is_active and u.account_status = 'ACTIVE'
    where x.value ~* '^[0-9a-f-]{36}$'
  loop
    perform app_private.upsert_workflow_instance_participant(
      v_instance.id, v_user_id, 'ASSIGNEE', coalesce(p_source_ref, 'step_assignees:' || v_instance.id::text)
    );
  end loop;
end;
$$;

revoke all on function app_private.reconcile_workflow_instance_participants(uuid, text)
  from public, anon, authenticated, service_role;

create or replace function app_private.sync_workflow_instance_participants()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.reconcile_workflow_instance_participants(NEW.id, 'instance:' || NEW.id::text);
  return NEW;
end;
$$;

revoke all on function app_private.sync_workflow_instance_participants()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_sync_workflow_instance_participants on public.workflow_instances;
create trigger trg_sync_workflow_instance_participants
after insert or update of created_by, watchers, step_assignees on public.workflow_instances
for each row execute function app_private.sync_workflow_instance_participants();

create or replace function app_private.record_workflow_log_participant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if NEW.action in ('APPROVED', 'REJECTED', 'REVISION_REQUESTED')
    and NEW.acted_by is not null
    and not exists (
      select 1 from public.workflow_subjects where workflow_instance_id = NEW.instance_id
    ) then
    perform app_private.upsert_workflow_instance_participant(
      NEW.instance_id, NEW.acted_by, 'ASSIGNEE', 'log:' || NEW.id::text
    );
  end if;
  return NEW;
end;
$$;

revoke all on function app_private.record_workflow_log_participant()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_record_workflow_log_participant on public.workflow_instance_logs;
create trigger trg_record_workflow_log_participant
after insert on public.workflow_instance_logs
for each row execute function app_private.record_workflow_log_participant();

create or replace function app_private.workflow_instance_user_can_select(
  p_instance_id uuid,
  p_user_id uuid
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workflow_instances instance_row
    join public.users user_row on user_row.id = p_user_id
      and user_row.is_active
      and user_row.account_status = 'ACTIVE'
    where instance_row.id = p_instance_id
      and not exists (
        select 1 from public.workflow_subjects subject_row
        where subject_row.workflow_instance_id = instance_row.id
      )
      and (
        app_private.has_permission(p_user_id, 'workflow.instance.view', 'global', '*')
        or app_private.has_permission(p_user_id, 'workflow.instance.administer', 'global', '*')
        or (
          (
            app_private.has_permission(p_user_id, 'workflow.instance.view', 'own', p_user_id::text)
            or app_private.has_permission(p_user_id, 'workflow.instance.view', 'assigned', p_user_id::text)
          )
          and exists (
            select 1
            from public.workflow_instance_participants participant_row
            where participant_row.instance_id = instance_row.id
              and participant_row.user_id = p_user_id
              and participant_row.ended_at is null
          )
        )
      )
  );
$$;

revoke all on function app_private.workflow_instance_user_can_select(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function app_private.workflow_instance_actor_can_select(p_instance_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workflow_instances instance_row
    where instance_row.id = p_instance_id
      and (
        (
          exists (
            select 1 from public.workflow_subjects subject_row
            where subject_row.workflow_instance_id = instance_row.id
              and app_private.project_workflow_actor_can_select(subject_row.id)
          )
        )
        or (
          not exists (
            select 1 from public.workflow_subjects subject_row
            where subject_row.workflow_instance_id = instance_row.id
          )
          and (
            app_private.workflow_instance_user_can_select(instance_row.id, public.current_app_user_id())
            or public.is_admin()
            or public.is_module_admin('WF')
          )
        )
      )
  );
$$;

revoke all on function app_private.workflow_instance_actor_can_select(uuid)
  from public, anon, service_role;
grant execute on function app_private.workflow_instance_actor_can_select(uuid) to authenticated;

do $$
declare
  instance_row record;
  log_row record;
begin
  for instance_row in
    select wi.id
    from public.workflow_instances wi
    where not exists (
      select 1 from public.workflow_subjects subject_row
      where subject_row.workflow_instance_id = wi.id
    )
  loop
    perform app_private.reconcile_workflow_instance_participants(instance_row.id, 'backfill:' || instance_row.id::text);
    for log_row in
      select il.id, il.acted_by
      from public.workflow_instance_logs il
      where il.instance_id = instance_row.id
        and il.action in ('APPROVED', 'REJECTED', 'REVISION_REQUESTED')
        and il.acted_by is not null
    loop
      begin
        perform app_private.upsert_workflow_instance_participant(
          instance_row.id, log_row.acted_by, 'ASSIGNEE', 'backfill-log:' || log_row.id::text
        );
      exception when sqlstate '22023' then
        null;
      end;
    end loop;
  end loop;
end;
$$;
