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
select distinct * from with_prerequisite;

insert into public.project_permission_room_members (
  project_id, construction_site_id, room_code, project_staff_id,
  is_active, created_by, updated_at
)
select distinct project_id, construction_site_id, 'gantt', project_staff_id,
  true, granted_by, now()
from gantt_room_backfill_candidates
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
  request_id text not null,
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

notify pgrst, 'reload schema';
