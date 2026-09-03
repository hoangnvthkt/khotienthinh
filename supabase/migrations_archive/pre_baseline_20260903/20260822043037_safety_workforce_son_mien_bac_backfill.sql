begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  v_expected_profile_count constant integer := 54;
  v_expected_backfill_assignment_count constant integer := 53;
  v_target_site_id uuid;
  v_target_project_id text;
  v_site_count integer;
  v_project_count integer;
  v_profile_count integer;
  v_error_count integer;
  v_membership_count integer;
  v_active_assignment_count integer;
  v_backfill_assignment_count integer;
  v_assignment_id uuid;
begin
  select count(*)::integer, min(site.id::text)::uuid
  into v_site_count, v_target_site_id
  from public.hrm_construction_sites site
  where lower(regexp_replace(btrim(site.name), '[[:space:]]+', ' ', 'g')) =
        lower('Công trường Sơn Miền Bắc');

  if v_site_count <> 1 then
    raise exception 'SAFETY_BACKFILL_SITE_COUNT_CHANGED: expected 1 target site, found %', v_site_count
      using errcode = 'P0001';
  end if;

  select count(*)::integer, min(project.id)
  into v_project_count, v_target_project_id
  from public.projects project
  where project.construction_site_id = v_target_site_id;

  if v_project_count <> 1 then
    raise exception 'SAFETY_BACKFILL_PROJECT_COUNT_CHANGED: expected 1 linked project, found %', v_project_count
      using errcode = 'P0001';
  end if;

  select count(*)::integer
  into v_profile_count
  from public.safety_worker_profiles;

  if v_profile_count <> v_expected_profile_count then
    raise exception 'SAFETY_BACKFILL_PROFILE_COUNT_CHANGED: expected %, found %',
      v_expected_profile_count, v_profile_count
      using errcode = 'P0001';
  end if;

  select count(*)::integer
  into v_error_count
  from (
    select normalized.value
    from public.safety_worker_profiles worker
    cross join lateral (
      select app_private.safety_workforce_normalize_identity(worker.identity_number) as value
    ) normalized
    where normalized.value is not null
    group by normalized.value
    having count(*) > 1
  ) duplicates;

  if v_error_count <> 0 then
    raise exception 'SAFETY_BACKFILL_DUPLICATE_IDENTITY: found % duplicate normalized identities', v_error_count
      using errcode = '23505';
  end if;

  select count(*)::integer
  into v_error_count
  from public.safety_project_assignments assignment
  where assignment.project_id is distinct from v_target_project_id
     or assignment.construction_site_id is distinct from v_target_site_id::text;

  if v_error_count <> 0 then
    raise exception 'SAFETY_BACKFILL_ASSIGNMENT_OUTSIDE_TARGET: found % assignments outside target scope', v_error_count
      using errcode = 'P0001';
  end if;

  drop table if exists pg_temp.safety_worker_backfill_map;
  create temporary table safety_worker_backfill_map
  on commit drop
  as
  select
    worker.id as worker_id,
    case when subcontractor_match.match_count = 1 then subcontractor_match.id end as subcontractor_id,
    case when team_match.match_count = 1 then team_match.id end as team_id,
    subcontractor_match.match_count as subcontractor_match_count,
    team_match.match_count as team_match_count
  from public.safety_worker_profiles worker
  left join public.safety_contractors legacy_contractor
    on legacy_contractor.id = worker.contractor_id
  cross join lateral (
    select min(subcontractor.id::text)::uuid as id,
           count(*)::integer as match_count
    from public.safety_subcontractors subcontractor
    where subcontractor.project_id = v_target_project_id
      and subcontractor.construction_site_id = v_target_site_id::text
      and lower(regexp_replace(btrim(subcontractor.name), '[[:space:]]+', ' ', 'g')) =
          lower(regexp_replace(btrim(legacy_contractor.name), '[[:space:]]+', ' ', 'g'))
  ) subcontractor_match
  cross join lateral (
    select min(team.id::text)::uuid as id,
           count(*)::integer as match_count
    from public.safety_teams team
    where team.project_id = v_target_project_id
      and team.construction_site_id = v_target_site_id::text
      and team.subcontractor_id = subcontractor_match.id
      and nullif(btrim(worker.team_name), '') is not null
      and lower(regexp_replace(btrim(team.name), '[[:space:]]+', ' ', 'g')) =
          lower(regexp_replace(btrim(worker.team_name), '[[:space:]]+', ' ', 'g'))
  ) team_match;

  create unique index safety_worker_backfill_map_worker_idx
    on pg_temp.safety_worker_backfill_map(worker_id);

  select count(*)::integer
  into v_error_count
  from public.safety_worker_profiles worker
  join pg_temp.safety_worker_backfill_map mapped on mapped.worker_id = worker.id
  where worker.contractor_id is not null
    and mapped.subcontractor_match_count <> 1;

  if v_error_count <> 0 then
    raise exception 'SAFETY_BACKFILL_UNMAPPED_CONTRACTOR: found % profiles without one target subcontractor', v_error_count
      using errcode = 'P0001';
  end if;

  select count(*)::integer
  into v_error_count
  from public.safety_worker_profiles worker
  join pg_temp.safety_worker_backfill_map mapped on mapped.worker_id = worker.id
  where nullif(btrim(worker.team_name), '') is not null
    and mapped.team_match_count > 1;

  if v_error_count <> 0 then
    raise exception 'SAFETY_BACKFILL_AMBIGUOUS_TEAM: found % profiles with multiple target teams', v_error_count
      using errcode = 'P0001';
  end if;

  update public.safety_worker_profiles worker
  set worker_kind = case
        when worker.contractor_id is null then 'company_staff'
        else 'contractor_worker'
      end,
      identity_number_normalized = app_private.safety_workforce_normalize_identity(worker.identity_number),
      updated_at = now();

  insert into public.safety_worker_site_memberships (
    worker_id,
    project_id,
    construction_site_id,
    default_subcontractor_id,
    default_team_id,
    status,
    first_joined_at,
    source
  )
  select
    worker.id,
    v_target_project_id,
    v_target_site_id,
    mapped.subcontractor_id,
    mapped.team_id,
    'active',
    now(),
    'son_mien_bac_backfill_v1'
  from public.safety_worker_profiles worker
  join pg_temp.safety_worker_backfill_map mapped on mapped.worker_id = worker.id
  on conflict (worker_id, construction_site_id) do update
  set project_id = excluded.project_id,
      default_subcontractor_id = excluded.default_subcontractor_id,
      default_team_id = excluded.default_team_id,
      status = 'active',
      source = case
        when safety_worker_site_memberships.source = 'manual'
          then safety_worker_site_memberships.source
        else excluded.source
      end,
      last_left_at = null,
      updated_at = now();

  update public.safety_project_assignments assignment
  set membership_id = membership.id,
      assignment_status = 'active',
      started_at = coalesce(
        assignment.started_at,
        assignment.start_date::timestamp at time zone 'Asia/Ho_Chi_Minh'
      ),
      ended_at = null,
      end_date = null,
      ended_by = null,
      ended_reason = null,
      subcontractor_id = mapped.subcontractor_id,
      team_id = mapped.team_id,
      source = coalesce(assignment.source, 'legacy'),
      updated_at = now()
  from public.safety_worker_site_memberships membership
  join pg_temp.safety_worker_backfill_map mapped on mapped.worker_id = membership.worker_id
  where assignment.worker_id = membership.worker_id
    and membership.construction_site_id = v_target_site_id;

  insert into public.safety_project_assignments (
    worker_id,
    project_id,
    construction_site_id,
    role_name,
    start_date,
    membership_id,
    assignment_status,
    started_at,
    subcontractor_id,
    team_id,
    source
  )
  select
    worker.id,
    v_target_project_id,
    v_target_site_id::text,
    worker.role_name,
    current_date,
    membership.id,
    'active',
    now(),
    mapped.subcontractor_id,
    mapped.team_id,
    'son_mien_bac_backfill_v1'
  from public.safety_worker_profiles worker
  join public.safety_worker_site_memberships membership
    on membership.worker_id = worker.id
   and membership.construction_site_id = v_target_site_id
  join pg_temp.safety_worker_backfill_map mapped on mapped.worker_id = worker.id
  where not exists (
    select 1
    from public.safety_project_assignments existing
    where existing.worker_id = worker.id
  );

  for v_assignment_id in
    select assignment.id
    from public.safety_project_assignments assignment
    where assignment.project_id = v_target_project_id
      and assignment.construction_site_id = v_target_site_id::text
    order by assignment.id
  loop
    perform app_private.recompute_safety_assignment_eligibility(v_assignment_id);
  end loop;

  select count(*)::integer
  into v_membership_count
  from public.safety_worker_site_memberships membership
  where membership.construction_site_id = v_target_site_id;

  if v_membership_count <> v_expected_profile_count then
    raise exception 'SAFETY_BACKFILL_MEMBERSHIP_COUNT_INVALID: expected %, found %',
      v_expected_profile_count, v_membership_count
      using errcode = 'P0001';
  end if;

  select count(*)::integer
  into v_active_assignment_count
  from public.safety_project_assignments assignment
  where assignment.assignment_status = 'active'
    and assignment.project_id = v_target_project_id
    and assignment.construction_site_id = v_target_site_id::text;

  if v_active_assignment_count <> v_expected_profile_count then
    raise exception 'SAFETY_BACKFILL_ACTIVE_ASSIGNMENT_COUNT_INVALID: expected %, found %',
      v_expected_profile_count, v_active_assignment_count
      using errcode = 'P0001';
  end if;

  select count(*)::integer
  into v_backfill_assignment_count
  from public.safety_project_assignments assignment
  where assignment.source = 'son_mien_bac_backfill_v1';

  if v_backfill_assignment_count <> v_expected_backfill_assignment_count then
    raise exception 'SAFETY_BACKFILL_SOURCE_COUNT_INVALID: expected %, found %',
      v_expected_backfill_assignment_count, v_backfill_assignment_count
      using errcode = 'P0001';
  end if;
end;
$$;

alter table public.safety_project_assignments
  drop constraint if exists safety_project_assignments_active_unique;

alter table public.safety_worker_profiles
  alter column worker_kind set not null;

alter table public.safety_project_assignments
  alter column membership_id set not null,
  alter column assignment_status set not null,
  alter column started_at set not null,
  alter column source set not null;

notify pgrst, 'reload schema';

commit;
