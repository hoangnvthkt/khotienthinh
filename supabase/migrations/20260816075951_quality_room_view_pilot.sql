-- Stage 1: make Quality Room view effective while preserving exact-scope PBAC fallback.

insert into app_private.project_permission_room_action_bindings (
  room_code, action_code, legacy_permission_codes, enforcement_status,
  relationship_description, verified_at, verified_source, updated_at,
  pbac_fallback_enabled, prerequisite_action_codes
)
values (
  'quality', 'view', array['project.quality.view']::text[], 'pilot',
  'Xem hồ sơ và catalog hạng mục trong Room Chất lượng.', now(),
  'quality_room_view_pilot', now(), true, '{}'::text[]
)
on conflict (room_code, action_code) do update
set legacy_permission_codes = excluded.legacy_permission_codes,
    enforcement_status = excluded.enforcement_status,
    relationship_description = excluded.relationship_description,
    verified_at = excluded.verified_at,
    verified_source = excluded.verified_source,
    pbac_fallback_enabled = true,
    prerequisite_action_codes = excluded.prerequisite_action_codes,
    updated_at = now();

create temporary table quality_view_backfill_candidates on commit drop as
with candidates as (
  select
    grant_row.id as grant_id,
    grant_row.user_id,
    grant_row.granted_by,
    staff.id as project_staff_id,
    staff.project_id,
    case when grant_row.scope_type = 'construction_site'
      then staff.construction_site_id else null end as construction_site_id,
    count(*) over (partition by grant_row.id) as matching_staff_count
  from public.user_permission_grants grant_row
  join public.users user_row
    on user_row.id = grant_row.user_id and coalesce(user_row.is_active, true)
  join public.project_staff staff
    on staff.user_id = grant_row.user_id::text
    and staff.end_date is null
    and (
      (grant_row.scope_type = 'project' and grant_row.scope_id = staff.project_id
        and staff.construction_site_id is null)
      or (grant_row.scope_type = 'construction_site'
        and grant_row.scope_id = staff.construction_site_id)
    )
  where grant_row.permission_code = 'project.quality.view'
    and grant_row.is_active
    and (grant_row.expires_at is null or grant_row.expires_at > now())
    and grant_row.scope_type in ('project', 'construction_site')
)
select distinct user_id, granted_by, project_staff_id, project_id,
  construction_site_id, matching_staff_count
from candidates
where matching_staff_count = 1;

insert into public.project_permission_room_members (
  project_id, construction_site_id, room_code, project_staff_id,
  is_active, created_by, updated_at
)
select project_id, construction_site_id, 'quality', project_staff_id,
  true, granted_by, now()
from quality_view_backfill_candidates
on conflict (project_id, (coalesce(construction_site_id, '')), room_code, project_staff_id)
do update set is_active = true, updated_at = now();

insert into public.project_permission_room_member_actions (
  room_member_id, action_code, is_active, granted_by, granted_at, updated_at, grant_source
)
select member.id, 'view', true, candidate.granted_by, now(), now(), 'pbac_backfill'
from quality_view_backfill_candidates candidate
join public.project_permission_room_members member
  on member.project_id = candidate.project_id
  and member.construction_site_id is not distinct from candidate.construction_site_id
  and member.room_code = 'quality'
  and member.project_staff_id = candidate.project_staff_id
on conflict (room_member_id, action_code) do update
set is_active = true,
    -- Existing grant_source = 'manual_room' rows remain authoritative.
    granted_by = case
      when public.project_permission_room_member_actions.grant_source = 'manual_room'
        then public.project_permission_room_member_actions.granted_by
      else excluded.granted_by
    end,
    grant_source = case
      when public.project_permission_room_member_actions.grant_source = 'manual_room'
        then 'manual_room'
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
    'room_code', 'quality',
    'action_code', 'view'
  )), '[]'::jsonb),
  jsonb_build_object(
    'source', 'quality_room_view_pilot',
    'room_code', 'quality',
    'matching_staff_count', count(*)
  )
from quality_view_backfill_candidates candidate;

insert into public.permission_audit_events (
  actor_user_id, event_type, before_grants, after_grants, metadata
)
select null, 'project_room_pbac_backfill_unresolved',
  coalesce(jsonb_agg(jsonb_build_object(
    'grant_id', grant_row.id,
    'user_id', grant_row.user_id,
    'permission_code', grant_row.permission_code,
    'scope_type', grant_row.scope_type,
    'scope_id', grant_row.scope_id
  )), '[]'::jsonb), '[]'::jsonb,
  jsonb_build_object('source', 'quality_room_view_pilot', 'room_code', 'quality')
from public.user_permission_grants grant_row
where grant_row.permission_code = 'project.quality.view'
  and grant_row.is_active
  and (grant_row.expires_at is null or grant_row.expires_at > now())
  and not exists (
    select 1 from quality_view_backfill_candidates candidate
    where candidate.user_id = grant_row.user_id
      and (
        (grant_row.scope_type = 'project' and candidate.project_id = grant_row.scope_id)
        or (grant_row.scope_type = 'construction_site'
          and candidate.construction_site_id = grant_row.scope_id)
      )
  );

notify pgrst, 'reload schema';
