begin;
set local statement_timeout = '30s';

do $$
declare
  v_actor_user_id uuid;
  v_actor_auth_id uuid;
  v_actor_email text;
  v_target_project_id text;
  v_target_site_id uuid;
  v_other_project_id text;
  v_other_site_id uuid;
  v_worker_id uuid;
  v_source_membership_id uuid;
  v_source_assignment_id uuid;
  v_ineligible_assignment_id uuid;
  v_temp_membership_id uuid;
  v_roster jsonb;
  v_count integer;
  v_membership_count_before bigint;
  v_assignment_count_before bigint;
  v_card_count_before bigint;
  v_print_count_before bigint;
  v_audit_count_before bigint;
begin
  select app_user.id, app_user.auth_id, app_user.email
  into v_actor_user_id, v_actor_auth_id, v_actor_email
  from public.users app_user
  where app_user.role = 'ADMIN'
    and app_user.is_active
    and app_user.account_status = 'ACTIVE'
    and app_user.auth_id is not null
  order by app_user.created_at, app_user.id
  limit 1;

  if v_actor_user_id is null then
    raise exception 'SAFETY_SMOKE_SETUP: active authenticated admin not found';
  end if;

  perform set_config('request.jwt.claim.sub', v_actor_auth_id::text, true);
  perform set_config('request.jwt.claim.email', v_actor_email, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_actor_auth_id,
      'email', v_actor_email,
      'role', 'authenticated'
    )::text,
    true
  );

  if public.current_app_user_id() is distinct from v_actor_user_id then
    raise exception 'SAFETY_SMOKE_SETUP: JWT actor did not resolve to app user';
  end if;

  select project.id, site.id
  into v_target_project_id, v_target_site_id
  from public.hrm_construction_sites site
  join public.projects project on project.construction_site_id = site.id
  where lower(regexp_replace(btrim(site.name), '[[:space:]]+', ' ', 'g')) =
        lower('Công trường Sơn Miền Bắc');

  if v_target_project_id is null then
    raise exception 'SAFETY_SMOKE_SETUP: Sơn Miền Bắc scope not found';
  end if;

  select project.id, project.construction_site_id
  into v_other_project_id, v_other_site_id
  from public.projects project
  where project.construction_site_id is not null
    and project.construction_site_id <> v_target_site_id
  order by project.id
  limit 1;

  if v_other_project_id is null then
    raise exception 'SAFETY_SMOKE_SETUP: a second linked project/site is required';
  end if;

  select assignment.worker_id, assignment.membership_id, assignment.id
  into v_worker_id, v_source_membership_id, v_source_assignment_id
  from public.safety_project_assignments assignment
  join public.safety_worker_profiles worker on worker.id = assignment.worker_id
  where assignment.project_id = v_target_project_id
    and assignment.construction_site_id = v_target_site_id::text
    and assignment.assignment_status = 'active'
    and worker.worker_kind = 'company_staff'
  order by assignment.started_at, assignment.id
  limit 1;

  if v_source_assignment_id is null then
    raise exception 'SAFETY_SMOKE_SETUP: active company staff assignment not found';
  end if;

  select assignment.id
  into v_ineligible_assignment_id
  from public.safety_project_assignments assignment
  where assignment.project_id = v_target_project_id
    and assignment.construction_site_id = v_target_site_id::text
    and assignment.assignment_status = 'active'
    and assignment.eligibility_status <> 'eligible'
  order by assignment.started_at, assignment.id
  limit 1;

  if v_ineligible_assignment_id is null then
    raise exception 'SAFETY_SMOKE_SETUP: an ineligible assignment is required';
  end if;

  select count(*) into v_membership_count_before from public.safety_worker_site_memberships;
  select count(*) into v_assignment_count_before from public.safety_project_assignments;
  select count(*) into v_card_count_before from public.safety_cards;
  select count(*) into v_print_count_before from public.safety_card_print_logs;
  select count(*) into v_audit_count_before from public.safety_audit_logs;

  v_roster := public.list_safety_site_worker_roster(
    v_target_project_id,
    v_target_site_id,
    p_limit => 100
  );
  if jsonb_array_length(coalesce(v_roster -> 'items', '[]'::jsonb)) <> 54 then
    raise exception 'SAFETY_SMOKE_ROSTER_COUNT: expected 54 target workers';
  end if;

  v_roster := public.list_safety_site_worker_roster(
    v_other_project_id,
    v_other_site_id,
    p_limit => 100
  );
  select count(*)::integer
  into v_count
  from jsonb_array_elements(coalesce(v_roster -> 'items', '[]'::jsonb)) item
  where item #>> '{membership,constructionSiteId}' = v_target_site_id::text;
  if v_count <> 0 then
    raise exception 'SAFETY_SMOKE_SCOPE_LEAK: target memberships appeared in another site roster';
  end if;

  begin
    insert into public.safety_worker_site_memberships (
      worker_id, project_id, construction_site_id, status, source, created_by, updated_by
    ) values (
      v_worker_id, v_other_project_id, v_other_site_id, 'candidate', 'manual',
      v_actor_user_id, v_actor_user_id
    )
    on conflict (worker_id, construction_site_id) do update
    set project_id = excluded.project_id,
        status = 'candidate',
        updated_by = excluded.updated_by,
        updated_at = now()
    returning id into v_temp_membership_id;

    insert into public.safety_project_assignments (
      worker_id, project_id, construction_site_id, membership_id,
      assignment_status, started_at, start_date, source, created_by
    ) values (
      v_worker_id, v_other_project_id, v_other_site_id::text, v_temp_membership_id,
      'active', now(), current_date, 'manual', v_actor_user_id::text
    );

    raise exception 'SAFETY_SMOKE_EXPECTED_UNIQUE_VIOLATION';
  exception
    when unique_violation then null;
  end;

  begin
    insert into public.safety_worker_site_memberships (
      worker_id, project_id, construction_site_id, status, source, created_by, updated_by
    ) values (
      v_worker_id, v_other_project_id, v_other_site_id, 'candidate', 'manual',
      v_actor_user_id, v_actor_user_id
    )
    on conflict (worker_id, construction_site_id) do update
    set project_id = excluded.project_id,
        status = 'candidate',
        updated_by = excluded.updated_by,
        updated_at = now()
    returning id into v_temp_membership_id;

    perform public.assign_safety_worker_to_site(
      v_temp_membership_id,
      now(),
      null,
      null,
      '{}'::jsonb
    );
    raise exception 'SAFETY_SMOKE_EXPECTED_ACTIVE_ELSEWHERE';
  exception
    when others then
      if sqlerrm not like '%SAFETY_WORKER_ACTIVE_ELSEWHERE%' then
        raise;
      end if;
  end;

  begin
    perform public.update_safety_worker_assignment(
      v_source_assignment_id,
      jsonb_build_object('subcontractorId', gen_random_uuid())
    );
    raise exception 'SAFETY_SMOKE_EXPECTED_CONTRACTOR_SCOPE_ERROR';
  exception
    when others then
      if sqlerrm not like '%SAFETY_CONTRACTOR_SCOPE_MISMATCH%' then
        raise;
      end if;
  end;

  begin
    perform public.end_safety_worker_assignment(
      v_source_assignment_id,
      now(),
      'Safety smoke forced rollback'
    );
    raise exception 'SAFETY_SMOKE_FORCE_END_ROLLBACK';
  exception
    when others then
      if sqlerrm <> 'SAFETY_SMOKE_FORCE_END_ROLLBACK' then
        raise;
      end if;
  end;

  if not exists (
    select 1
    from public.safety_project_assignments assignment
    where assignment.id = v_source_assignment_id
      and assignment.assignment_status = 'active'
      and assignment.ended_at is null
  ) then
    raise exception 'SAFETY_SMOKE_END_ROLLBACK_FAILED: source assignment changed';
  end if;

  begin
    perform public.transfer_safety_worker_site(
      v_source_assignment_id,
      v_other_project_id,
      v_other_site_id,
      now(),
      null,
      null
    );
    raise exception 'SAFETY_SMOKE_FORCE_TRANSFER_ROLLBACK';
  exception
    when others then
      if sqlerrm <> 'SAFETY_SMOKE_FORCE_TRANSFER_ROLLBACK' then
        raise;
      end if;
  end;

  if not exists (
    select 1
    from public.safety_project_assignments assignment
    where assignment.id = v_source_assignment_id
      and assignment.assignment_status = 'active'
      and assignment.ended_at is null
  ) or exists (
    select 1
    from public.safety_project_assignments assignment
    where assignment.worker_id = v_worker_id
      and assignment.construction_site_id = v_other_site_id::text
      and assignment.assignment_status = 'active'
  ) then
    raise exception 'SAFETY_SMOKE_TRANSFER_ROLLBACK_FAILED: transfer state leaked';
  end if;

  begin
    perform public.issue_safety_assignment_card(
      v_ineligible_assignment_id,
      current_date + 30,
      null
    );
    raise exception 'SAFETY_SMOKE_EXPECTED_INELIGIBLE_CARD_ERROR';
  exception
    when others then
      if sqlerrm not like '%SAFETY_ASSIGNMENT_NOT_ELIGIBLE%' then
        raise;
      end if;
  end;

  if (select count(*) from public.safety_worker_site_memberships) <> v_membership_count_before
    or (select count(*) from public.safety_project_assignments) <> v_assignment_count_before
    or (select count(*) from public.safety_cards) <> v_card_count_before
    or (select count(*) from public.safety_card_print_logs) <> v_print_count_before
    or (select count(*) from public.safety_audit_logs) <> v_audit_count_before
  then
    raise exception 'SAFETY_SMOKE_ROLLBACK_COUNT_MISMATCH: smoke subtransactions leaked rows';
  end if;

  if not exists (
    select 1
    from public.safety_worker_site_memberships membership
    where membership.id = v_source_membership_id
      and membership.status = 'active'
  ) then
    raise exception 'SAFETY_SMOKE_SOURCE_MEMBERSHIP_CHANGED';
  end if;
end;
$$;

rollback;
