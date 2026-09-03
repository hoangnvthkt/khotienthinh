-- Authoritative Gantt Room foundation. Historical completion evidence stays in
-- place, but is no longer exposed to product roles or accepted as a progress mode.

-- Fail before changing data when scope identity cannot be converted safely.
do $$
declare
  v_duplicates jsonb;
begin
  select jsonb_agg(item)
  into v_duplicates
  from (
    select project_id, construction_site_id, lower(btrim(wbs_code)) as wbs_code,
      array_agg(id order by id) as task_ids
    from public.project_tasks
    where nullif(btrim(coalesce(wbs_code, '')), '') is not null
    group by project_id, construction_site_id, lower(btrim(wbs_code))
    having count(*) > 1
    order by project_id, construction_site_id, lower(btrim(wbs_code))
    limit 50
  ) item;

  if v_duplicates is not null then
    raise exception 'GANTT_DUPLICATE_WBS: %', v_duplicates::text using errcode = '23505';
  end if;
end;
$$;

delete from public.project_permission_room_member_actions action
using public.project_permission_room_members member
where action.room_member_id = member.id
  and member.room_code = 'gantt'
  and action.action_code in ('submit', 'verify', 'approve');

delete from app_private.project_permission_room_action_bindings
where room_code = 'gantt'
  and action_code in ('submit', 'verify', 'approve');

update public.project_permission_rooms
set description = 'Quản lý hạng mục và tiến độ thi công.',
    allowed_actions = array['view', 'edit', 'delete']::text[],
    required_actions = '{}'::text[],
    updated_at = now()
where code = 'gantt';

insert into app_private.project_permission_room_action_bindings (
  room_code, action_code, legacy_permission_codes, enforcement_status,
  relationship_description, verified_at, verified_source, updated_at,
  pbac_fallback_enabled, prerequisite_action_codes
)
values
  (
    'gantt', 'view', array['project.gantt.view']::text[], 'pilot',
    'Xem tiến độ trong đúng project/site.', now(),
    'gantt_room_authoritative_cutover_2026_08_13', now(), false, '{}'::text[]
  ),
  (
    'gantt', 'edit', array[
      'project.gantt.create_task', 'project.gantt.edit_task',
      'project.gantt.assign_task', 'project.gantt.edit'
    ]::text[], 'pilot',
    'Tạo và sửa hạng mục, baseline, delay, forecast và liên kết BOQ.', now(),
    'gantt_room_authoritative_cutover_2026_08_13', now(), false, array['view']::text[]
  ),
  (
    'gantt', 'delete', '{}'::text[], 'pilot',
    'Xóa cây hạng mục khi không có chứng từ nghiệp vụ phụ thuộc.', now(),
    'gantt_room_authoritative_cutover_2026_08_13', now(), false, array['view']::text[]
  )
on conflict (room_code, action_code) do update
set legacy_permission_codes = excluded.legacy_permission_codes,
    enforcement_status = excluded.enforcement_status,
    relationship_description = excluded.relationship_description,
    verified_at = excluded.verified_at,
    verified_source = excluded.verified_source,
    updated_at = excluded.updated_at,
    pbac_fallback_enabled = false,
    prerequisite_action_codes = excluded.prerequisite_action_codes;

-- Keep this migration self-contained for linked environments whose migration
-- history predates the registry-driven prerequisite implementation.
create or replace function app_private.project_actor_has_effective_room_action(
  p_user_id uuid,
  p_project_id text,
  p_construction_site_id text,
  p_room_code text,
  p_action_code text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with binding as (
    select item.enforcement_status, item.legacy_permission_codes,
      item.pbac_fallback_enabled, item.prerequisite_action_codes
    from app_private.project_permission_room_action_bindings item
    where item.room_code = p_room_code
      and item.action_code = p_action_code
  ), actor as (
    select user_row.id, user_row.role
    from public.users user_row
    where user_row.id = p_user_id
      and coalesce(user_row.is_active, true)
  ), scoped_actor as (
    select actor.id, actor.role
    from actor
    where actor.role = 'ADMIN'
      or exists (
        select 1
        from public.project_staff staff
        where staff.user_id = actor.id::text
          and staff.project_id = p_project_id
          and staff.end_date is null
          and (
            nullif(p_construction_site_id, '') is null
            or staff.construction_site_id is null
            or staff.construction_site_id = p_construction_site_id
          )
      )
  )
  select exists (
    select 1
    from binding
    cross join scoped_actor
    where scoped_actor.role = 'ADMIN'
      or (
        binding.enforcement_status in ('pilot', 'enforced')
        and app_private.project_user_has_room_action(
          scoped_actor.id,
          p_project_id,
          nullif(p_construction_site_id, ''),
          p_room_code,
          p_action_code
        )
        and not exists (
          select 1
          from unnest(binding.prerequisite_action_codes) required(action_code)
          where not app_private.project_user_has_room_action(
            scoped_actor.id,
            p_project_id,
            nullif(p_construction_site_id, ''),
            p_room_code,
            required.action_code
          )
        )
      )
      or (
        binding.pbac_fallback_enabled
        and app_private.permission_hardening_flag('project_room_pbac_fallback_enabled')
        and exists (
          select 1
          from unnest(binding.legacy_permission_codes) legacy(permission_code)
          where app_private.project_has_permission_v2(
            p_project_id,
            nullif(p_construction_site_id, ''),
            legacy.permission_code,
            scoped_actor.id
          )
        )
      )
  );
$$;

revoke all on function app_private.project_actor_has_effective_room_action(
  uuid, text, text, text, text
) from public, anon, authenticated;

-- Resolve each PBAC grant to exactly one active staff scope. Ambiguous grants
-- are reported instead of being broadened or silently discarded.
create temporary table gantt_room_pbac_candidates on commit drop as
with permission_mapping(permission_code, action_code) as (
  values
    ('project.gantt.view', 'view'),
    ('project.gantt.create_task', 'edit'),
    ('project.gantt.edit_task', 'edit'),
    ('project.gantt.assign_task', 'edit'),
    ('project.gantt.edit', 'edit')
), candidates as (
  select grant_row.id as grant_id, grant_row.user_id, grant_row.granted_by,
    staff.id as project_staff_id, staff.project_id,
    case when grant_row.scope_type = 'construction_site'
      then staff.construction_site_id else null end as construction_site_id,
    mapping.action_code,
    count(*) over (partition by grant_row.id, mapping.action_code) as matching_staff_count
  from public.user_permission_grants grant_row
  join permission_mapping mapping on mapping.permission_code = grant_row.permission_code
  join public.users user_row on user_row.id = grant_row.user_id
    and coalesce(user_row.is_active, true) and user_row.role <> 'ADMIN'
  join public.project_staff staff
    on staff.user_id = grant_row.user_id::text
    and staff.end_date is null
    and (
      (grant_row.scope_type = 'project'
        and grant_row.scope_id = staff.project_id
        and staff.construction_site_id is null)
      or (grant_row.scope_type = 'construction_site'
        and grant_row.scope_id = staff.construction_site_id)
    )
  where grant_row.is_active
    and (grant_row.expires_at is null or grant_row.expires_at > now())
    and grant_row.scope_type in ('project', 'construction_site')
)
select * from candidates;

do $$
declare
  v_ambiguous jsonb;
begin
  select jsonb_agg(item)
  into v_ambiguous
  from (
    select grant_id, user_id, action_code, matching_staff_count
    from gantt_room_pbac_candidates
    where matching_staff_count <> 1
    group by grant_id, user_id, action_code, matching_staff_count
    order by grant_id
    limit 50
  ) item;

  if v_ambiguous is not null then
    raise exception 'GANTT_AMBIGUOUS_GRANT: %', v_ambiguous::text using errcode = '23514';
  end if;
end;
$$;

create temporary table gantt_room_backfill_candidates on commit drop as
with pbac as (
  select distinct user_id, granted_by, project_staff_id, project_id,
    construction_site_id, action_code
  from gantt_room_pbac_candidates
  where matching_staff_count = 1
), legacy_staff as (
  select user_row.id as user_id, null::uuid as granted_by,
    staff.id as project_staff_id, staff.project_id, staff.construction_site_id,
    permission_type.code as action_code
  from public.project_staff staff
  join public.users user_row on user_row.id::text = staff.user_id
    and coalesce(user_row.is_active, true) and user_row.role <> 'ADMIN'
  join public.project_staff_permissions staff_permission
    on staff_permission.staff_id = staff.id and coalesce(staff_permission.is_active, false)
  join public.project_permission_types permission_type
    on permission_type.id = staff_permission.permission_type_id
    and coalesce(permission_type.is_active, true)
    and permission_type.code in ('view', 'edit', 'delete')
  where staff.end_date is null
), explicit_candidates as (
  select * from pbac
  union
  select * from legacy_staff
), with_prerequisite as (
  select * from explicit_candidates
  union
  select user_id, granted_by, project_staff_id, project_id,
    construction_site_id, 'view' as action_code
  from explicit_candidates
  where action_code in ('edit', 'delete')
)
select
  max(user_id::text)::uuid as user_id,
  max(granted_by::text)::uuid as granted_by,
  project_staff_id,
  project_id,
  construction_site_id,
  action_code
from with_prerequisite
group by project_staff_id, project_id, construction_site_id, action_code;

insert into public.project_permission_room_members (
  project_id, construction_site_id, room_code, project_staff_id,
  is_active, created_by, updated_at
)
select project_id, construction_site_id, 'gantt', project_staff_id,
  true, max(granted_by::text)::uuid, now()
from gantt_room_backfill_candidates
group by project_id, construction_site_id, project_staff_id
on conflict (project_id, (coalesce(construction_site_id, '')), room_code, project_staff_id)
do update set is_active = true, updated_at = now();

insert into public.project_permission_room_member_actions (
  room_member_id, action_code, is_active, granted_by, granted_at, updated_at, grant_source
)
select distinct member.id, candidate.action_code, true, candidate.granted_by,
  now(), now(), 'pbac_backfill'
from gantt_room_backfill_candidates candidate
join public.project_permission_room_members member
  on member.project_id = candidate.project_id
  and member.construction_site_id is not distinct from candidate.construction_site_id
  and member.room_code = 'gantt'
  and member.project_staff_id = candidate.project_staff_id
on conflict (room_member_id, action_code) do update
set is_active = true,
    granted_by = case
      when public.project_permission_room_member_actions.grant_source = 'manual_room'
        then public.project_permission_room_member_actions.granted_by
      else excluded.granted_by
    end,
    grant_source = case
      when public.project_permission_room_member_actions.grant_source = 'manual_room'
        then public.project_permission_room_member_actions.grant_source
      else 'pbac_backfill'
    end,
    updated_at = now();

insert into public.permission_audit_events (
  actor_user_id, event_type, before_grants, after_grants, metadata
)
select null, 'project_room_pbac_backfill', '[]'::jsonb,
  coalesce(jsonb_agg(jsonb_build_object(
    'user_id', candidate.user_id,
    'project_staff_id', candidate.project_staff_id,
    'project_id', candidate.project_id,
    'construction_site_id', candidate.construction_site_id,
    'room_code', 'gantt',
    'action_code', candidate.action_code
  )), '[]'::jsonb),
  jsonb_build_object(
    'source', 'project_room_pbac_backfill',
    'room_code', 'gantt',
    'row_count', count(*)
  )
from gantt_room_backfill_candidates candidate;

alter table public.project_tasks
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists row_version bigint not null default 1;

alter table public.project_tasks
  drop constraint if exists project_tasks_row_version_check;
alter table public.project_tasks
  add constraint project_tasks_row_version_check check (row_version > 0);

create or replace function app_private.bump_project_task_gantt_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.row_version := old.row_version + 1;
  return new;
end;
$$;

revoke all on function app_private.bump_project_task_gantt_version()
  from public, anon, authenticated;

drop trigger if exists trg_project_tasks_gantt_version on public.project_tasks;
create trigger trg_project_tasks_gantt_version
  before update on public.project_tasks
  for each row execute function app_private.bump_project_task_gantt_version();

create table if not exists app_private.project_gantt_command_requests (
  id bigint generated always as identity primary key,
  actor_user_id uuid not null,
  request_id uuid not null,
  command_name text not null,
  payload_hash text not null,
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (actor_user_id, request_id)
);

revoke all privileges on table app_private.project_gantt_command_requests
  from public, anon, authenticated;

update public.project_tasks
set progress_mode = 'manual'
where progress_mode = 'completion_request';

do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.project_tasks'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%progress_mode%'
  loop
    execute format('alter table public.project_tasks drop constraint %I', c.conname);
  end loop;
end;
$$;

alter table public.project_tasks
  add constraint project_tasks_progress_mode_check
  check (progress_mode in (
    'manual', 'derived_from_acceptance', 'daily_log', 'children_auto', 'weekly_report'
  ));

drop policy if exists project_task_completion_requests_project_access
  on public.project_task_completion_requests;
drop policy if exists project_task_completion_requests_select
  on public.project_task_completion_requests;
drop policy if exists project_task_completion_requests_insert
  on public.project_task_completion_requests;
drop policy if exists project_task_completion_requests_update
  on public.project_task_completion_requests;
drop policy if exists project_task_completion_requests_delete
  on public.project_task_completion_requests;

do $$
declare
  policy_row record;
begin
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'project_task_completion_requests'
  loop
    execute format(
      'drop policy if exists %I on public.project_task_completion_requests',
      policy_row.policyname
    );
  end loop;
end;
$$;

revoke all on table public.project_task_completion_requests
  from public, anon, authenticated;

create or replace function app_private.assert_project_gantt_action(
  p_project_id text,
  p_construction_site_id text,
  p_action_code text
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := public.current_app_user_id();
  v_site_id text := nullif(btrim(coalesce(p_construction_site_id, '')), '');
begin
  if v_actor_user_id is null then
    raise exception 'GANTT_PERMISSION_DENIED' using errcode = '42501';
  end if;

  if nullif(btrim(coalesce(p_project_id, '')), '') is null
    or not exists (
      select 1 from public.projects project
      where project.id = p_project_id
        and (
          v_site_id is null
          or project.construction_site_id::text = v_site_id
        )
    ) then
    raise exception 'GANTT_SCOPE_MISMATCH' using errcode = '23514';
  end if;

  if p_action_code not in ('view', 'edit', 'delete')
    or not app_private.project_actor_has_effective_room_action(
      v_actor_user_id, p_project_id, v_site_id, 'gantt', p_action_code
    ) then
    raise exception 'GANTT_PERMISSION_DENIED' using errcode = '42501';
  end if;

  return v_actor_user_id;
end;
$$;

revoke all on function app_private.assert_project_gantt_action(text, text, text)
  from public, anon;
grant execute on function app_private.assert_project_gantt_action(text, text, text)
  to authenticated;

create or replace function app_private.begin_project_gantt_command(
  p_actor_user_id uuid,
  p_request_id uuid,
  p_command_name text,
  p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request app_private.project_gantt_command_requests%rowtype;
begin
  if p_request_id is null then
    raise exception 'GANTT_REQUEST_ID_REQUIRED' using errcode = '23514';
  end if;

  insert into app_private.project_gantt_command_requests (
    actor_user_id, request_id, command_name, payload_hash
  ) values (
    p_actor_user_id, p_request_id, p_command_name, p_payload_hash
  )
  on conflict (actor_user_id, request_id) do nothing;

  if found then
    return null;
  end if;

  select request.* into v_request
  from app_private.project_gantt_command_requests request
  where request.actor_user_id = p_actor_user_id
    and request.request_id = p_request_id
  for update;

  if v_request.command_name is distinct from p_command_name
    or v_request.payload_hash is distinct from p_payload_hash then
    raise exception 'GANTT_REQUEST_ID_REUSED' using errcode = '23514';
  end if;

  if v_request.result is null then
    raise exception 'GANTT_REQUEST_IN_PROGRESS' using errcode = '55000';
  end if;

  return v_request.result || jsonb_build_object('replayed', true);
end;
$$;

revoke all on function app_private.begin_project_gantt_command(uuid, uuid, text, text)
  from public, anon;
grant execute on function app_private.begin_project_gantt_command(uuid, uuid, text, text)
  to authenticated;

create or replace function app_private.finish_project_gantt_command(
  p_actor_user_id uuid,
  p_request_id uuid,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update app_private.project_gantt_command_requests request
  set result = p_result, completed_at = now()
  where request.actor_user_id = p_actor_user_id
    and request.request_id = p_request_id;
  return p_result;
end;
$$;

revoke all on function app_private.finish_project_gantt_command(uuid, uuid, jsonb)
  from public, anon;
grant execute on function app_private.finish_project_gantt_command(uuid, uuid, jsonb)
  to authenticated;

create or replace function app_private.save_project_gantt_tasks_impl(
  p_request_id uuid,
  p_project_id text,
  p_construction_site_id text,
  p_changes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_site_id text := nullif(btrim(coalesce(p_construction_site_id, '')), '');
  v_payload_hash text;
  v_replay jsonb;
  v_result jsonb;
  v_ids text[];
begin
  v_actor_user_id := app_private.assert_project_gantt_action(p_project_id, v_site_id, 'edit');

  if jsonb_typeof(coalesce(p_changes, 'null'::jsonb)) <> 'array'
    or jsonb_array_length(p_changes) = 0 then
    raise exception 'GANTT_INVALID_PAYLOAD' using errcode = '22023';
  end if;

  v_payload_hash := md5(jsonb_build_object(
    'projectId', p_project_id,
    'constructionSiteId', v_site_id,
    'changes', p_changes
  )::text);
  v_replay := app_private.begin_project_gantt_command(
    v_actor_user_id, p_request_id, 'save_project_gantt_tasks', v_payload_hash
  );
  if v_replay is not null then return v_replay; end if;

  select array_agg(change ->> 'id' order by change ->> 'id')
  into v_ids
  from jsonb_array_elements(p_changes) change;

  if exists (
    select 1 from unnest(v_ids) id
    where nullif(btrim(coalesce(id, '')), '') is null
  ) or cardinality(v_ids) <> (select count(distinct id) from unnest(v_ids) id) then
    raise exception 'GANTT_INVALID_PAYLOAD' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_changes) change
    where change ?| array[
      'gate_status', 'gate_approved_by', 'gate_approved_at',
      'code', 'quantity', 'unit', 'unit_price', 'total_price',
      'completed_quantity', 'contract_item_id', 'created_at',
      'updated_at', 'row_version', 'project_id', 'construction_site_id'
    ]
      or exists (
        select 1 from jsonb_array_elements(coalesce(change -> 'dependencies', '[]'::jsonb)) dependency
        where dependency ? 'requires_gate_approval'
      )
  ) then
    raise exception 'GANTT_GATE_METADATA_IMMUTABLE' using errcode = '23514';
  end if;

  perform task.id
  from public.project_tasks task
  where task.id = any(v_ids)
  order by task.id
  for update;

  if exists (
    select 1 from public.project_tasks task
    where task.id = any(v_ids)
      and (
        task.project_id is distinct from p_project_id
        or task.construction_site_id is distinct from v_site_id
      )
  ) then
    raise exception 'GANTT_SCOPE_MISMATCH' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_changes) change
    join public.project_tasks task on task.id = change ->> 'id'
    where nullif(change ->> 'expected_row_version', '') is null
      or (change ->> 'expected_row_version')::bigint <> task.row_version
  ) then
    raise exception 'GANTT_STALE_VERSION' using errcode = '40001';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_changes) change
    left join public.project_tasks task on task.id = change ->> 'id'
    where task.id is null
      and coalesce((change ->> 'expected_row_version')::bigint, 0) <> 0
  ) then
    raise exception 'GANTT_STALE_VERSION' using errcode = '40001';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_changes) change
    where nullif(btrim(coalesce(change ->> 'name', '')), '') is null
      or coalesce(change ->> 'start_date', '') !~ '^\d{4}-\d{2}-\d{2}$'
      or coalesce(change ->> 'end_date', '') !~ '^\d{4}-\d{2}-\d{2}$'
      or case
        when coalesce(change ->> 'start_date', '') ~ '^\d{4}-\d{2}-\d{2}$'
          and coalesce(change ->> 'end_date', '') ~ '^\d{4}-\d{2}-\d{2}$'
        then (change ->> 'start_date')::date > (change ->> 'end_date')::date
        else false
      end
      or coalesce((change ->> 'duration')::integer, 0) < 0
      or coalesce((change ->> 'progress')::numeric, 0) < 0
      or coalesce(change ->> 'progress_mode', 'manual') not in (
        'manual', 'derived_from_acceptance', 'daily_log', 'children_auto', 'weekly_report'
      )
  ) then
    raise exception 'GANTT_INVALID_DATES' using errcode = '22007';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_changes) change
    where nullif(change ->> 'parent_id', '') = change ->> 'id'
      or (
        nullif(change ->> 'parent_id', '') is not null
        and not (nullif(change ->> 'parent_id', '') = any(v_ids))
        and not exists (
          select 1 from public.project_tasks parent
          where parent.id = nullif(change ->> 'parent_id', '')
            and parent.project_id = p_project_id
            and parent.construction_site_id is not distinct from v_site_id
        )
      )
  ) then
    raise exception 'GANTT_HIERARCHY_INVALID' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_changes) change
    cross join lateral jsonb_array_elements(coalesce(change -> 'dependencies', '[]'::jsonb)) dependency
    where nullif(dependency ->> 'task_id', '') is null
      or dependency ->> 'task_id' = change ->> 'id'
      or coalesce(dependency ->> 'type', '') not in ('FS', 'SS', 'FF', 'SF')
      or (
        not (dependency ->> 'task_id' = any(v_ids))
        and not exists (
          select 1 from public.project_tasks predecessor
          where predecessor.id = dependency ->> 'task_id'
            and predecessor.project_id = p_project_id
            and predecessor.construction_site_id is not distinct from v_site_id
        )
      )
  ) then
    raise exception 'GANTT_DEPENDENCY_INVALID' using errcode = '23514';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_changes) change
    cross join lateral unnest(
      array_remove(
        coalesce(array(select jsonb_array_elements_text(change -> 'watchers')), '{}'::text[])
          || array[nullif(change ->> 'assignee_user_id', '')],
        null
      )
    ) actor_user_id
    where not exists (
      select 1
      from public.users user_row
      join public.project_staff staff on staff.user_id = user_row.id::text
      where user_row.id::text = actor_user_id
        and coalesce(user_row.is_active, true)
        and staff.project_id = p_project_id
        and staff.end_date is null
        and (
          v_site_id is null
          or staff.construction_site_id is null
          or staff.construction_site_id = v_site_id
        )
    )
  ) then
    raise exception 'GANTT_INVALID_ASSIGNEE' using errcode = '23514';
  end if;

  insert into public.project_tasks (
    id, project_id, construction_site_id, parent_id, name, start_date, end_date,
    duration, progress, progress_mode, assignee, assignee_user_id, dependencies,
    is_milestone, color, notes, sort_order, lag_time, float_days, is_critical,
    baseline_start, baseline_end, baseline_locked, resource_count, resource_type,
    estimated_cost_per_day, delay_reason, delay_category, baseline_version,
    baseline_change_reason, actual_start_date, actual_end_date, wbs_code,
    fallback_unit, provisional_quantity, watchers
  )
  select
    change ->> 'id', p_project_id, v_site_id, nullif(change ->> 'parent_id', ''),
    btrim(change ->> 'name'), change ->> 'start_date', change ->> 'end_date',
    coalesce((change ->> 'duration')::integer, 1),
    coalesce((change ->> 'progress')::integer, 0),
    coalesce(change ->> 'progress_mode', 'manual'),
    nullif(change ->> 'assignee', ''), nullif(change ->> 'assignee_user_id', ''),
    coalesce(change -> 'dependencies', '[]'::jsonb),
    coalesce((change ->> 'is_milestone')::boolean, false),
    nullif(change ->> 'color', ''), nullif(change ->> 'notes', ''),
    coalesce((change ->> 'sort_order')::integer, 0),
    coalesce((change ->> 'lag_time')::integer, 0),
    coalesce((change ->> 'float_days')::integer, 0),
    coalesce((change ->> 'is_critical')::boolean, false),
    nullif(change ->> 'baseline_start', ''), nullif(change ->> 'baseline_end', ''),
    coalesce((change ->> 'baseline_locked')::boolean, false),
    greatest(coalesce((change ->> 'resource_count')::integer, 1), 0),
    coalesce(nullif(change ->> 'resource_type', ''), 'worker'),
    greatest(coalesce((change ->> 'estimated_cost_per_day')::numeric, 0), 0),
    nullif(change ->> 'delay_reason', ''), nullif(change ->> 'delay_category', ''),
    nullif(change ->> 'baseline_version', ''),
    nullif(change ->> 'baseline_change_reason', ''),
    nullif(change ->> 'actual_start_date', '')::date,
    nullif(change ->> 'actual_end_date', '')::date,
    nullif(btrim(coalesce(change ->> 'wbs_code', '')), ''),
    nullif(btrim(coalesce(change ->> 'fallback_unit', '')), ''),
    greatest(coalesce((change ->> 'provisional_quantity')::numeric, 0), 0),
    coalesce(array(select jsonb_array_elements_text(change -> 'watchers')), '{}'::text[])
  from jsonb_array_elements(p_changes) change
  on conflict (id) do update
  set parent_id = excluded.parent_id,
      name = excluded.name,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      duration = excluded.duration,
      progress = excluded.progress,
      progress_mode = excluded.progress_mode,
      assignee = excluded.assignee,
      assignee_user_id = excluded.assignee_user_id,
      dependencies = excluded.dependencies,
      is_milestone = excluded.is_milestone,
      color = excluded.color,
      notes = excluded.notes,
      sort_order = excluded.sort_order,
      lag_time = excluded.lag_time,
      float_days = excluded.float_days,
      is_critical = excluded.is_critical,
      baseline_start = excluded.baseline_start,
      baseline_end = excluded.baseline_end,
      baseline_locked = excluded.baseline_locked,
      resource_count = excluded.resource_count,
      resource_type = excluded.resource_type,
      estimated_cost_per_day = excluded.estimated_cost_per_day,
      delay_reason = excluded.delay_reason,
      delay_category = excluded.delay_category,
      baseline_version = excluded.baseline_version,
      baseline_change_reason = excluded.baseline_change_reason,
      actual_start_date = excluded.actual_start_date,
      actual_end_date = excluded.actual_end_date,
      wbs_code = excluded.wbs_code,
      fallback_unit = excluded.fallback_unit,
      provisional_quantity = excluded.provisional_quantity,
      watchers = excluded.watchers;

  if exists (
    with recursive ancestry as (
      select task.id as origin_id, task.parent_id, array[task.id]::text[] as path
      from public.project_tasks task
      where task.project_id = p_project_id
        and task.construction_site_id is not distinct from v_site_id
      union all
      select ancestry.origin_id, parent.parent_id, ancestry.path || parent.id
      from ancestry
      join public.project_tasks parent on parent.id = ancestry.parent_id
      where not parent.id = any(ancestry.path)
    )
    select 1 from ancestry
    where parent_id = any(path)
  ) then
    raise exception 'GANTT_HIERARCHY_CYCLE' using errcode = '23514';
  end if;

  if exists (
    with recursive dependency_graph as (
      select task.id as origin_id,
        dependency ->> 'task_id' as current_id,
        array[task.id]::text[] as path
      from public.project_tasks task
      cross join lateral jsonb_array_elements(coalesce(task.dependencies, '[]'::jsonb)) dependency
      where task.project_id = p_project_id
        and task.construction_site_id is not distinct from v_site_id
      union all
      select graph.origin_id,
        dependency ->> 'task_id',
        graph.path || graph.current_id
      from dependency_graph graph
      join public.project_tasks task on task.id = graph.current_id
      cross join lateral jsonb_array_elements(coalesce(task.dependencies, '[]'::jsonb)) dependency
      where not graph.current_id = any(graph.path)
    )
    select 1 from dependency_graph where current_id = origin_id
  ) then
    raise exception 'GANTT_DEPENDENCY_CYCLE' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.project_tasks task
    where task.project_id = p_project_id
      and task.construction_site_id is not distinct from v_site_id
      and task.wbs_code is not null
    group by lower(btrim(task.wbs_code))
    having count(*) > 1
  ) then
    raise exception 'GANTT_DUPLICATE_WBS' using errcode = '23505';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_changes) change
    cross join lateral jsonb_array_elements_text(coalesce(change -> 'contract_item_ids', '[]'::jsonb)) link(contract_item_id)
    where change ? 'contract_item_ids'
      and not exists (
        select 1 from public.contract_items contract_item
        where contract_item.id = link.contract_item_id::uuid
          and contract_item.project_id = p_project_id
          and contract_item.construction_site_id::text is not distinct from v_site_id
      )
  ) then
    raise exception 'GANTT_SCOPE_MISMATCH' using errcode = '23514';
  end if;

  delete from public.task_contract_items link
  using jsonb_array_elements(p_changes) change
  where change ? 'contract_item_ids'
    and link.task_id = change ->> 'id';

  insert into public.task_contract_items (
    task_id, contract_item_id, project_id, construction_site_id
  )
  select distinct change ->> 'id', link.contract_item_id::uuid, p_project_id, v_site_id
  from jsonb_array_elements(p_changes) change
  cross join lateral jsonb_array_elements_text(coalesce(change -> 'contract_item_ids', '[]'::jsonb)) link(contract_item_id)
  where change ? 'contract_item_ids'
  on conflict (task_id, contract_item_id) do nothing;

  select jsonb_build_object(
    'ok', true,
    'requestId', p_request_id,
    'replayed', false,
    'tasks', coalesce(jsonb_agg(to_jsonb(task) order by task.sort_order, task.id), '[]'::jsonb)
  ) into v_result
  from public.project_tasks task
  where task.id = any(v_ids);

  return app_private.finish_project_gantt_command(v_actor_user_id, p_request_id, v_result);
end;
$$;

revoke all on function app_private.save_project_gantt_tasks_impl(uuid, text, text, jsonb)
  from public, anon;
grant execute on function app_private.save_project_gantt_tasks_impl(uuid, text, text, jsonb)
  to authenticated;

create or replace function public.save_project_gantt_tasks(
  p_request_id uuid,
  p_project_id text,
  p_construction_site_id text,
  p_changes jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.save_project_gantt_tasks_impl(
    p_request_id, p_project_id, nullif(p_construction_site_id, ''), p_changes
  );
$$;

revoke all on function public.save_project_gantt_tasks(uuid, text, text, jsonb)
  from public, anon;
grant execute on function public.save_project_gantt_tasks(uuid, text, text, jsonb)
  to authenticated;

create or replace function app_private.delete_project_gantt_task_tree_impl(
  p_request_id uuid,
  p_project_id text,
  p_construction_site_id text,
  p_task_id text,
  p_expected_row_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_site_id text := nullif(btrim(coalesce(p_construction_site_id, '')), '');
  v_payload_hash text;
  v_replay jsonb;
  v_result jsonb;
  v_task_ids text[];
  v_blockers jsonb;
begin
  v_actor_user_id := app_private.assert_project_gantt_action(p_project_id, v_site_id, 'delete');
  v_payload_hash := md5(jsonb_build_object(
    'projectId', p_project_id,
    'constructionSiteId', v_site_id,
    'taskId', p_task_id,
    'expectedRowVersion', p_expected_row_version
  )::text);
  v_replay := app_private.begin_project_gantt_command(
    v_actor_user_id, p_request_id, 'delete_project_gantt_task_tree', v_payload_hash
  );
  if v_replay is not null then return v_replay; end if;

  if not exists (
    select 1 from public.project_tasks task
    where task.id = p_task_id
      and task.project_id = p_project_id
      and task.construction_site_id is not distinct from v_site_id
  ) then
    if exists (select 1 from public.project_tasks task where task.id = p_task_id) then
      raise exception 'GANTT_SCOPE_MISMATCH' using errcode = '23514';
    end if;
    raise exception 'GANTT_TASK_NOT_FOUND' using errcode = 'P0002';
  end if;

  with recursive tree as (
    select task.id from public.project_tasks task where task.id = p_task_id
    union all
    select child.id from public.project_tasks child
    join tree parent on child.parent_id = parent.id
    where child.project_id = p_project_id
      and child.construction_site_id is not distinct from v_site_id
  )
  select array_agg(tree.id order by tree.id) into v_task_ids from tree;

  perform task.id
  from public.project_tasks task
  where task.id = any(v_task_ids)
  order by task.id
  for update;

  if not exists (
    select 1 from public.project_tasks task
    where task.id = p_task_id and task.row_version = p_expected_row_version
  ) then
    raise exception 'GANTT_STALE_VERSION' using errcode = '40001';
  end if;

  select jsonb_strip_nulls(jsonb_build_object(
    'completionRequests', nullif((select count(*) from public.project_task_completion_requests item where item.task_id = any(v_task_ids)), 0),
    'dailyProgress', nullif((select count(*) from public.project_daily_task_progress item where item.task_id = any(v_task_ids)), 0),
    'weeklyProgress', nullif((select count(*) from public.project_weekly_task_progress item where item.task_id = any(v_task_ids)), 0),
    'dailyLogVolumes', nullif((select count(*) from public.daily_log_volumes item where item.task_id = any(v_task_ids)), 0),
    'delayEvents', nullif((select count(*) from public.project_delay_events item where item.task_id = any(v_task_ids)), 0),
    'quantityAcceptances', nullif((select count(*) from public.quantity_acceptance_items item where item.task_id = any(v_task_ids)), 0)
  )) into v_blockers;

  if v_blockers <> '{}'::jsonb then
    insert into public.permission_audit_events (
      actor_user_id, event_type, before_grants, after_grants, metadata
    ) values (
      v_actor_user_id, 'gantt_delete_blocked', '[]'::jsonb, '[]'::jsonb,
      jsonb_build_object(
        'room_code', 'gantt', 'project_id', p_project_id,
        'construction_site_id', v_site_id, 'task_id', p_task_id,
        'task_ids', to_jsonb(v_task_ids), 'blockers', v_blockers
      )
    );

    v_result := jsonb_build_object(
      'ok', false,
      'requestId', p_request_id,
      'replayed', false,
      'errorCode', 'GANTT_DELETE_BLOCKED',
      'blockers', v_blockers
    );
    return app_private.finish_project_gantt_command(v_actor_user_id, p_request_id, v_result);
  end if;

  update public.project_tasks task
  set dependencies = coalesce((
    select jsonb_agg(dependency)
    from jsonb_array_elements(coalesce(task.dependencies, '[]'::jsonb)) dependency
    where not (dependency ->> 'taskId' = any(v_task_ids))
      and not (dependency ->> 'task_id' = any(v_task_ids))
  ), '[]'::jsonb)
  where task.project_id = p_project_id
    and task.construction_site_id is not distinct from v_site_id
    and not task.id = any(v_task_ids)
    and exists (
      select 1 from jsonb_array_elements(coalesce(task.dependencies, '[]'::jsonb)) dependency
      where dependency ->> 'taskId' = any(v_task_ids)
        or dependency ->> 'task_id' = any(v_task_ids)
    );

  delete from public.task_contract_items link where link.task_id = any(v_task_ids);
  delete from public.project_tasks task where task.id = any(v_task_ids);

  v_result := jsonb_build_object(
    'ok', true,
    'requestId', p_request_id,
    'replayed', false,
    'deletedTaskIds', to_jsonb(v_task_ids)
  );
  return app_private.finish_project_gantt_command(v_actor_user_id, p_request_id, v_result);
end;
$$;

revoke all on function app_private.delete_project_gantt_task_tree_impl(uuid, text, text, text, bigint)
  from public, anon;
grant execute on function app_private.delete_project_gantt_task_tree_impl(uuid, text, text, text, bigint)
  to authenticated;

create or replace function public.delete_project_gantt_task_tree(
  p_request_id uuid,
  p_project_id text,
  p_construction_site_id text,
  p_task_id text,
  p_expected_row_version bigint
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.delete_project_gantt_task_tree_impl(
    p_request_id, p_project_id, nullif(p_construction_site_id, ''),
    p_task_id, p_expected_row_version
  );
$$;

revoke all on function public.delete_project_gantt_task_tree(uuid, text, text, text, bigint)
  from public, anon;
grant execute on function public.delete_project_gantt_task_tree(uuid, text, text, text, bigint)
  to authenticated;

create or replace function app_private.replace_project_gantt_task_contract_items_impl(
  p_request_id uuid,
  p_project_id text,
  p_construction_site_id text,
  p_task_id text,
  p_expected_row_version bigint,
  p_contract_item_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_site_id text := nullif(btrim(coalesce(p_construction_site_id, '')), '');
  v_ids uuid[] := array(select distinct unnest(coalesce(p_contract_item_ids, '{}'::uuid[])) order by 1);
  v_replay jsonb;
  v_result jsonb;
begin
  v_actor_user_id := app_private.assert_project_gantt_action(p_project_id, v_site_id, 'edit');
  v_replay := app_private.begin_project_gantt_command(
    v_actor_user_id, p_request_id, 'replace_project_gantt_task_contract_items',
    md5(jsonb_build_object('projectId', p_project_id, 'constructionSiteId', v_site_id,
      'taskId', p_task_id, 'expectedRowVersion', p_expected_row_version,
      'contractItemIds', to_jsonb(v_ids))::text)
  );
  if v_replay is not null then return v_replay; end if;

  perform task.id from public.project_tasks task where task.id = p_task_id for update;
  if not found or exists (
    select 1 from public.project_tasks task
    where task.id = p_task_id and (
      task.project_id is distinct from p_project_id
      or task.construction_site_id is distinct from v_site_id
    )
  ) then
    raise exception 'GANTT_SCOPE_MISMATCH' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.project_tasks task
    where task.id = p_task_id and task.row_version = p_expected_row_version
  ) then
    raise exception 'GANTT_STALE_VERSION' using errcode = '40001';
  end if;
  if exists (
    select 1 from unnest(v_ids) contract_item_id
    where not exists (
      select 1 from public.contract_items item
      where item.id = contract_item_id
        and item.project_id = p_project_id
        and item.construction_site_id::text is not distinct from v_site_id
    )
  ) then
    raise exception 'GANTT_SCOPE_MISMATCH' using errcode = '23514';
  end if;

  delete from public.task_contract_items link where link.task_id = p_task_id;
  insert into public.task_contract_items (
    task_id, contract_item_id, project_id, construction_site_id
  )
  select p_task_id, contract_item_id, p_project_id, v_site_id from unnest(v_ids) contract_item_id;

  v_result := jsonb_build_object(
    'ok', true, 'requestId', p_request_id, 'replayed', false,
    'taskId', p_task_id, 'rowVersion', p_expected_row_version,
    'contractItemIds', to_jsonb(v_ids)
  );
  return app_private.finish_project_gantt_command(v_actor_user_id, p_request_id, v_result);
end;
$$;

revoke all on function app_private.replace_project_gantt_task_contract_items_impl(uuid, text, text, text, bigint, uuid[])
  from public, anon;
grant execute on function app_private.replace_project_gantt_task_contract_items_impl(uuid, text, text, text, bigint, uuid[])
  to authenticated;

create or replace function public.replace_project_gantt_task_contract_items(
  p_request_id uuid,
  p_project_id text,
  p_construction_site_id text,
  p_task_id text,
  p_expected_row_version bigint,
  p_contract_item_ids uuid[]
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.replace_project_gantt_task_contract_items_impl(
    p_request_id, p_project_id, nullif(p_construction_site_id, ''),
    p_task_id, p_expected_row_version, p_contract_item_ids
  );
$$;

revoke all on function public.replace_project_gantt_task_contract_items(uuid, text, text, text, bigint, uuid[])
  from public, anon;
grant execute on function public.replace_project_gantt_task_contract_items(uuid, text, text, text, bigint, uuid[])
  to authenticated;

create or replace function app_private.create_project_gantt_baseline_impl(
  p_request_id uuid,
  p_project_id text,
  p_construction_site_id text,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_site_id text := nullif(btrim(coalesce(p_construction_site_id, '')), '');
  v_replay jsonb;
  v_baseline public.project_baselines%rowtype;
  v_result jsonb;
begin
  v_actor_user_id := app_private.assert_project_gantt_action(p_project_id, v_site_id, 'edit');
  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'GANTT_INVALID_PAYLOAD' using errcode = '22023';
  end if;
  v_replay := app_private.begin_project_gantt_command(
    v_actor_user_id, p_request_id, 'create_project_gantt_baseline',
    md5(jsonb_build_object('projectId', p_project_id,
      'constructionSiteId', v_site_id, 'name', btrim(p_name))::text)
  );
  if v_replay is not null then return v_replay; end if;

  insert into public.project_baselines (
    id, project_id, construction_site_id, name, locked_at, locked_by, tasks_snapshot
  )
  select gen_random_uuid()::text, p_project_id, v_site_id, btrim(p_name), now(),
    v_actor_user_id::text,
    coalesce(jsonb_agg(to_jsonb(task) order by task.sort_order, task.id), '[]'::jsonb)
  from public.project_tasks task
  where task.project_id = p_project_id
    and task.construction_site_id is not distinct from v_site_id
  returning * into v_baseline;

  v_result := jsonb_build_object(
    'ok', true, 'requestId', p_request_id, 'replayed', false,
    'baseline', to_jsonb(v_baseline)
  );
  return app_private.finish_project_gantt_command(v_actor_user_id, p_request_id, v_result);
end;
$$;

revoke all on function app_private.create_project_gantt_baseline_impl(uuid, text, text, text)
  from public, anon;
grant execute on function app_private.create_project_gantt_baseline_impl(uuid, text, text, text)
  to authenticated;

create or replace function public.create_project_gantt_baseline(
  p_request_id uuid,
  p_project_id text,
  p_construction_site_id text,
  p_name text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.create_project_gantt_baseline_impl(
    p_request_id, p_project_id, nullif(p_construction_site_id, ''), p_name
  );
$$;

revoke all on function public.create_project_gantt_baseline(uuid, text, text, text)
  from public, anon;
grant execute on function public.create_project_gantt_baseline(uuid, text, text, text)
  to authenticated;

create or replace function app_private.transition_project_gantt_delay_event_impl(
  p_request_id uuid,
  p_project_id text,
  p_construction_site_id text,
  p_event_id text,
  p_status text,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_site_id text := nullif(btrim(coalesce(p_construction_site_id, '')), '');
  v_replay jsonb;
  v_event public.project_delay_events%rowtype;
  v_result jsonb;
begin
  v_actor_user_id := app_private.assert_project_gantt_action(p_project_id, v_site_id, 'edit');
  v_replay := app_private.begin_project_gantt_command(
    v_actor_user_id, p_request_id, 'transition_project_gantt_delay_event',
    md5(jsonb_build_object('projectId', p_project_id, 'constructionSiteId', v_site_id,
      'eventId', p_event_id, 'status', p_status,
      'expectedUpdatedAt', p_expected_updated_at)::text)
  );
  if v_replay is not null then return v_replay; end if;

  select event.* into v_event
  from public.project_delay_events event
  where event.id = p_event_id
  for update;
  if not found or v_event.project_id is distinct from p_project_id
    or v_event.construction_site_id is distinct from v_site_id then
    raise exception 'GANTT_SCOPE_MISMATCH' using errcode = '23514';
  end if;
  if p_expected_updated_at is null or v_event.updated_at is distinct from p_expected_updated_at then
    raise exception 'GANTT_STALE_VERSION' using errcode = '40001';
  end if;
  if p_status not in ('accepted', 'resolved', 'void')
    or (p_status = 'accepted' and v_event.status <> 'reported')
    or (p_status in ('resolved', 'void') and v_event.status not in ('reported', 'accepted')) then
    raise exception 'GANTT_INVALID_TRANSITION' using errcode = '23514';
  end if;

  update public.project_delay_events event
  set status = p_status,
      accepted_by = case when p_status = 'accepted' then v_actor_user_id::text else event.accepted_by end,
      accepted_at = case when p_status = 'accepted' then now() else event.accepted_at end,
      resolved_at = case when p_status in ('resolved', 'void') then now() else null end
  where event.id = p_event_id
  returning * into v_event;

  v_result := jsonb_build_object(
    'ok', true, 'requestId', p_request_id, 'replayed', false,
    'delayEvent', to_jsonb(v_event)
  );
  return app_private.finish_project_gantt_command(v_actor_user_id, p_request_id, v_result);
end;
$$;

revoke all on function app_private.transition_project_gantt_delay_event_impl(uuid, text, text, text, text, timestamptz)
  from public, anon;
grant execute on function app_private.transition_project_gantt_delay_event_impl(uuid, text, text, text, text, timestamptz)
  to authenticated;

create or replace function public.transition_project_gantt_delay_event(
  p_request_id uuid,
  p_project_id text,
  p_construction_site_id text,
  p_event_id text,
  p_status text,
  p_expected_updated_at timestamptz
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.transition_project_gantt_delay_event_impl(
    p_request_id, p_project_id, nullif(p_construction_site_id, ''),
    p_event_id, p_status, p_expected_updated_at
  );
$$;

revoke all on function public.transition_project_gantt_delay_event(uuid, text, text, text, text, timestamptz)
  from public, anon;
grant execute on function public.transition_project_gantt_delay_event(uuid, text, text, text, text, timestamptz)
  to authenticated;

create or replace function app_private.apply_project_gantt_forecast_impl(
  p_request_id uuid,
  p_project_id text,
  p_construction_site_id text,
  p_revision jsonb,
  p_revision_tasks jsonb,
  p_task_changes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_site_id text := nullif(btrim(coalesce(p_construction_site_id, '')), '');
  v_replay jsonb;
  v_revision public.project_schedule_revisions%rowtype;
  v_task_ids text[];
  v_event_ids text[];
  v_result jsonb;
begin
  v_actor_user_id := app_private.assert_project_gantt_action(p_project_id, v_site_id, 'edit');
  if jsonb_typeof(coalesce(p_revision_tasks, 'null'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_task_changes, 'null'::jsonb)) <> 'array'
    or jsonb_array_length(p_task_changes) = 0 then
    raise exception 'GANTT_INVALID_PAYLOAD' using errcode = '22023';
  end if;
  v_replay := app_private.begin_project_gantt_command(
    v_actor_user_id, p_request_id, 'apply_project_gantt_forecast',
    md5(jsonb_build_object('projectId', p_project_id, 'constructionSiteId', v_site_id,
      'revision', p_revision, 'revisionTasks', p_revision_tasks,
      'taskChanges', p_task_changes)::text)
  );
  if v_replay is not null then return v_replay; end if;

  select array_agg(change ->> 'id' order by change ->> 'id') into v_task_ids
  from jsonb_array_elements(p_task_changes) change;
  select coalesce(array_agg(event_id order by event_id), '{}'::text[]) into v_event_ids
  from jsonb_array_elements_text(coalesce(p_revision -> 'source_delay_event_ids', '[]'::jsonb)) event_id;

  perform task.id from public.project_tasks task
  where task.id = any(v_task_ids) order by task.id for update;
  perform event.id from public.project_delay_events event
  where event.id = any(v_event_ids) order by event.id for update;

  if cardinality(v_task_ids) <> (select count(*) from public.project_tasks task
      where task.id = any(v_task_ids) and task.project_id = p_project_id
        and task.construction_site_id is not distinct from v_site_id)
    or exists (
      select 1 from jsonb_array_elements(p_task_changes) change
      join public.project_tasks task on task.id = change ->> 'id'
      where nullif(change ->> 'expected_row_version', '') is null
        or task.row_version <> (change ->> 'expected_row_version')::bigint
    ) then
    raise exception 'GANTT_STALE_VERSION' using errcode = '40001';
  end if;
  if cardinality(v_event_ids) <> (select count(*) from public.project_delay_events event
      where event.id = any(v_event_ids) and event.project_id = p_project_id
        and event.construction_site_id is not distinct from v_site_id
        and event.status in ('reported', 'accepted')) then
    raise exception 'GANTT_SCOPE_MISMATCH' using errcode = '23514';
  end if;

  insert into public.project_schedule_revisions (
    id, project_id, construction_site_id, reason, source_delay_event_ids,
    applied_by, applied_at
  ) values (
    coalesce(nullif(p_revision ->> 'id', ''), gen_random_uuid()::text),
    p_project_id, v_site_id, nullif(p_revision ->> 'reason', ''), v_event_ids,
    v_actor_user_id::text, now()
  ) returning * into v_revision;

  insert into public.project_schedule_revision_tasks (
    id, revision_id, task_id, task_name_snapshot, before_start, before_end,
    before_duration, after_start, after_end, after_duration, delta_days,
    was_critical, float_before
  )
  select coalesce(nullif(item ->> 'id', ''), gen_random_uuid()::text),
    v_revision.id, nullif(item ->> 'task_id', ''),
    coalesce(item ->> 'task_name_snapshot', ''), item ->> 'before_start',
    item ->> 'before_end', coalesce((item ->> 'before_duration')::integer, 0),
    item ->> 'after_start', item ->> 'after_end',
    coalesce((item ->> 'after_duration')::integer, 0),
    coalesce((item ->> 'delta_days')::integer, 0),
    coalesce((item ->> 'was_critical')::boolean, false),
    coalesce((item ->> 'float_before')::integer, 0)
  from jsonb_array_elements(p_revision_tasks) item;

  update public.project_tasks task
  set start_date = change ->> 'start_date',
      end_date = change ->> 'end_date',
      duration = (change ->> 'duration')::integer
  from jsonb_array_elements(p_task_changes) change
  where task.id = change ->> 'id';

  update public.project_delay_events event
  set status = 'applied', resolved_at = now()
  where event.id = any(v_event_ids);

  v_result := jsonb_build_object(
    'ok', true, 'requestId', p_request_id, 'replayed', false,
    'revision', to_jsonb(v_revision),
    'tasks', (select coalesce(jsonb_agg(to_jsonb(task) order by task.id), '[]'::jsonb)
      from public.project_tasks task where task.id = any(v_task_ids)),
    'delayEvents', (select coalesce(jsonb_agg(to_jsonb(event) order by event.id), '[]'::jsonb)
      from public.project_delay_events event where event.id = any(v_event_ids))
  );
  return app_private.finish_project_gantt_command(v_actor_user_id, p_request_id, v_result);
end;
$$;

revoke all on function app_private.apply_project_gantt_forecast_impl(uuid, text, text, jsonb, jsonb, jsonb)
  from public, anon;
grant execute on function app_private.apply_project_gantt_forecast_impl(uuid, text, text, jsonb, jsonb, jsonb)
  to authenticated;

create or replace function public.apply_project_gantt_forecast(
  p_request_id uuid,
  p_project_id text,
  p_construction_site_id text,
  p_revision jsonb,
  p_revision_tasks jsonb,
  p_task_changes jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.apply_project_gantt_forecast_impl(
    p_request_id, p_project_id, nullif(p_construction_site_id, ''),
    p_revision, p_revision_tasks, p_task_changes
  );
$$;

revoke all on function public.apply_project_gantt_forecast(uuid, text, text, jsonb, jsonb, jsonb)
  from public, anon;
grant execute on function public.apply_project_gantt_forecast(uuid, text, text, jsonb, jsonb, jsonb)
  to authenticated;

create or replace function app_private.project_gantt_can_view(
  p_project_id text,
  p_construction_site_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.project_actor_has_effective_room_action(
    public.current_app_user_id(), p_project_id,
    nullif(p_construction_site_id, ''), 'gantt', 'view'
  );
$$;

revoke all on function app_private.project_gantt_can_view(text, text) from public, anon;
grant execute on function app_private.project_gantt_can_view(text, text) to authenticated;

do $$
declare
  item record;
begin
  for item in
    select policy.schemaname, policy.tablename, policy.policyname
    from pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename in (
        'project_tasks', 'project_baselines', 'project_delay_events',
        'project_schedule_revisions', 'project_schedule_revision_tasks',
        'task_contract_items'
      )
  loop
    execute format('drop policy if exists %I on %I.%I',
      item.policyname, item.schemaname, item.tablename);
  end loop;
end;
$$;

create policy project_tasks_gantt_view on public.project_tasks
  for select to authenticated
  using (app_private.project_gantt_can_view(project_id, construction_site_id));

create policy project_baselines_gantt_view on public.project_baselines
  for select to authenticated
  using (app_private.project_gantt_can_view(project_id, construction_site_id));

create policy project_delay_events_gantt_view on public.project_delay_events
  for select to authenticated
  using (app_private.project_gantt_can_view(project_id, construction_site_id));

create policy project_schedule_revisions_gantt_view on public.project_schedule_revisions
  for select to authenticated
  using (app_private.project_gantt_can_view(project_id, construction_site_id));

create policy project_schedule_revision_tasks_gantt_view
  on public.project_schedule_revision_tasks
  for select to authenticated
  using (exists (
    select 1 from public.project_schedule_revisions revision
    where revision.id = revision_id
      and app_private.project_gantt_can_view(
        revision.project_id, revision.construction_site_id
      )
  ));

create policy task_contract_items_gantt_view on public.task_contract_items
  for select to authenticated
  using (app_private.project_gantt_can_view(project_id, construction_site_id));

revoke insert, update, delete on table public.project_tasks from authenticated;
revoke insert, update, delete on table public.project_baselines from authenticated;
revoke insert, update, delete on table public.project_delay_events from authenticated;
revoke insert, update, delete on table public.project_schedule_revisions from authenticated;
revoke insert, update, delete on table public.project_schedule_revision_tasks from authenticated;
revoke insert, update, delete on table public.task_contract_items from authenticated;

revoke all on table public.project_tasks from anon;
revoke all on table public.project_baselines from anon;
revoke all on table public.project_delay_events from anon;
revoke all on table public.project_schedule_revisions from anon;
revoke all on table public.project_schedule_revision_tasks from anon;
revoke all on table public.task_contract_items from anon;

grant select on table public.project_tasks to authenticated;
grant select on table public.project_baselines to authenticated;
grant select on table public.project_delay_events to authenticated;
grant select on table public.project_schedule_revisions to authenticated;
grant select on table public.project_schedule_revision_tasks to authenticated;
grant select on table public.task_contract_items to authenticated;

create or replace function app_private.get_project_gantt_catalog_impl(
  p_project_id text,
  p_construction_site_id text,
  p_consumer_room text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := public.current_app_user_id();
  v_site_id text := nullif(btrim(coalesce(p_construction_site_id, '')), '');
  v_result jsonb;
begin
  if p_consumer_room not in (
    'daily_log', 'weekly_progress', 'material_planning',
    'quantity_acceptance', 'quality', 'payment'
  ) or not app_private.project_actor_has_effective_room_action(
    v_actor_user_id, p_project_id, v_site_id, p_consumer_room, 'view'
  ) then
    raise exception 'GANTT_PERMISSION_DENIED' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', task.id,
    'projectId', task.project_id,
    'constructionSiteId', task.construction_site_id,
    'parentId', task.parent_id,
    'name', task.name,
    'wbsCode', task.wbs_code,
    'startDate', task.start_date,
    'endDate', task.end_date,
    'actualStartDate', task.actual_start_date,
    'actualEndDate', task.actual_end_date,
    'duration', task.duration,
    'progress', task.progress,
    'progressMode', task.progress_mode,
    'isMilestone', task.is_milestone,
    'order', task.sort_order,
    'quantity', task.quantity,
    'unit', task.unit,
    'fallbackUnit', task.fallback_unit,
    'provisionalQuantity', task.provisional_quantity,
    'completedQuantity', task.completed_quantity,
    'rowVersion', task.row_version,
    'updatedAt', task.updated_at,
    'contractItemIds', coalesce((
      select jsonb_agg(link.contract_item_id order by link.contract_item_id)
      from public.task_contract_items link where link.task_id = task.id
    ), '[]'::jsonb)
  ) order by task.sort_order, task.id), '[]'::jsonb)
  into v_result
  from public.project_tasks task
  where task.project_id = p_project_id
    and task.construction_site_id is not distinct from v_site_id;

  return v_result;
end;
$$;

revoke all on function app_private.get_project_gantt_catalog_impl(text, text, text)
  from public, anon;
grant execute on function app_private.get_project_gantt_catalog_impl(text, text, text)
  to authenticated;

create or replace function public.get_project_gantt_catalog(
  p_project_id text,
  p_construction_site_id text,
  p_consumer_room text
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.get_project_gantt_catalog_impl(
    p_project_id, nullif(p_construction_site_id, ''), p_consumer_room
  );
$$;

revoke all on function public.get_project_gantt_catalog(text, text, text)
  from public, anon;
grant execute on function public.get_project_gantt_catalog(text, text, text)
  to authenticated;

notify pgrst, 'reload schema';
