begin read only;

with target_sites as (
  select site.id
  from public.hrm_construction_sites site
  where lower(regexp_replace(btrim(site.name), '[[:space:]]+', ' ', 'g')) =
        lower('Công trường Sơn Miền Bắc')
),
target_projects as (
  select project.id, project.construction_site_id
  from public.projects project
  join target_sites site on site.id = project.construction_site_id
),
target_scope as (
  select min(project.id) as project_id,
         min(project.construction_site_id::text)::uuid as site_id
  from target_projects project
  having count(*) = 1 and (select count(*) from target_sites) = 1
),
duplicate_identities as (
  select normalized.value
  from public.safety_worker_profiles worker
  cross join lateral (
    select nullif(
      upper(regexp_replace(trim(worker.identity_number), '[^[:alnum:]]', '', 'g')),
      ''
    ) as value
  ) normalized
  where normalized.value is not null
  group by normalized.value
  having count(*) > 1
),
contractor_mapping as (
  select worker.id as worker_id,
         worker.team_name,
         matched.subcontractor_id,
         matched.match_count
  from public.safety_worker_profiles worker
  join public.safety_contractors legacy_contractor on legacy_contractor.id = worker.contractor_id
  left join target_scope scope on true
  cross join lateral (
    select min(subcontractor.id::text)::uuid as subcontractor_id,
           count(*)::integer as match_count
    from public.safety_subcontractors subcontractor
    where subcontractor.project_id = scope.project_id
      and subcontractor.construction_site_id = scope.site_id::text
      and lower(regexp_replace(btrim(subcontractor.name), '[[:space:]]+', ' ', 'g')) =
          lower(regexp_replace(btrim(legacy_contractor.name), '[[:space:]]+', ' ', 'g'))
  ) matched
),
team_mapping as (
  select contractor.worker_id,
         team_match.match_count
  from contractor_mapping contractor
  left join target_scope scope on true
  cross join lateral (
    select count(*)::integer as match_count
    from public.safety_teams team
    where team.project_id = scope.project_id
      and team.construction_site_id = scope.site_id::text
      and team.subcontractor_id = contractor.subcontractor_id
      and lower(regexp_replace(btrim(team.name), '[[:space:]]+', ' ', 'g')) =
          lower(regexp_replace(btrim(contractor.team_name), '[[:space:]]+', ' ', 'g'))
  ) team_match
  where contractor.match_count = 1
    and nullif(btrim(contractor.team_name), '') is not null
)
select
  (select count(*)::integer from target_sites) as site_count,
  (select count(*)::integer from target_projects) as project_count,
  (select count(*)::integer from public.safety_worker_profiles) as profile_count,
  (select count(*)::integer from duplicate_identities) as duplicate_identity_count,
  (select count(*)::integer from contractor_mapping where match_count <> 1) as unmapped_contractor_count,
  (select count(*)::integer from team_mapping where match_count > 1) as ambiguous_team_count,
  (
    select count(*)::integer
    from public.safety_project_assignments assignment
    left join target_scope scope on true
    where assignment.project_id is distinct from scope.project_id
       or assignment.construction_site_id is distinct from scope.site_id::text
  ) as assignment_outside_target_count;

commit;
