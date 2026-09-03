begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create sequence if not exists public.safety_card_code_seq;

do $$
declare
  v_max_code bigint;
begin
  select max((regexp_match(card.card_code, '^SAFE-CARD-([0-9]+)$'))[1]::bigint)
  into v_max_code
  from public.safety_cards card
  where card.card_code ~ '^SAFE-CARD-[0-9]+$';

  if v_max_code is null then
    perform setval('public.safety_card_code_seq', 1, false);
  else
    perform setval('public.safety_card_code_seq', greatest(v_max_code, 1), true);
  end if;
end;
$$;

create unique index if not exists safety_cards_one_active_per_assignment_idx
  on public.safety_cards(assignment_id)
  where status = 'active';

create or replace function app_private.safety_workforce_detail_for_membership(p_membership_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_membership public.safety_worker_site_memberships%rowtype;
begin
  select membership
  into v_membership
  from public.safety_worker_site_memberships membership
  where membership.id = p_membership_id;

  if v_membership.id is null then
    raise exception 'SAFETY_SCOPE_MISMATCH: membership not found'
      using errcode = '42501';
  end if;

  return app_private.get_safety_site_worker_detail(
    v_membership.project_id,
    v_membership.construction_site_id,
    v_membership.id,
    true
  );
end;
$$;

create or replace function app_private.create_safety_worker_profile_for_site(
  p_project_id text,
  p_construction_site_id uuid,
  p_worker_kind text,
  p_profile jsonb,
  p_subcontractor_id uuid default null,
  p_team_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_worker public.safety_worker_profiles%rowtype;
  v_worker_by_code uuid;
  v_worker_by_identity uuid;
  v_membership public.safety_worker_site_memberships%rowtype;
  v_worker_code text := nullif(trim(p_profile ->> 'workerCode'), '');
  v_full_name text := nullif(trim(p_profile ->> 'fullName'), '');
  v_identity_type text := coalesce(nullif(trim(p_profile ->> 'identityType'), ''), 'cccd');
  v_identity_number text := nullif(trim(p_profile ->> 'identityNumber'), '');
  v_identity_normalized text;
begin
  perform app_private.safety_workforce_assert_scope(p_project_id, p_construction_site_id);
  if v_actor is null or not app_private.safety_workforce_can_manage(p_project_id, p_construction_site_id) then
    raise exception 'SAFETY_SCOPE_MISMATCH: actor cannot create worker at target site'
      using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_profile, 'null'::jsonb)) <> 'object' or v_full_name is null then
    raise exception 'SAFETY_INVALID_RPC_PAYLOAD: full name is required'
      using errcode = '22023';
  end if;
  if v_identity_type not in ('cccd', 'passport', 'other') then
    raise exception 'SAFETY_INVALID_RPC_PAYLOAD: invalid identity type'
      using errcode = '22023';
  end if;

  perform app_private.safety_workforce_assert_subcontractor_team(
    p_project_id,
    p_construction_site_id,
    p_subcontractor_id,
    p_team_id,
    p_worker_kind
  );

  v_identity_normalized := app_private.safety_workforce_normalize_identity(v_identity_number);

  if v_worker_code is not null then
    select worker.id
    into v_worker_by_code
    from public.safety_worker_profiles worker
    where lower(worker.worker_code) = lower(v_worker_code)
    limit 1;
  end if;

  if v_identity_normalized is not null then
    select worker.id
    into v_worker_by_identity
    from public.safety_worker_profiles worker
    where worker.identity_type = v_identity_type
      and worker.identity_number_normalized = v_identity_normalized
    limit 1;
  end if;

  if v_worker_by_code is not null
    and v_worker_by_identity is not null
    and v_worker_by_code <> v_worker_by_identity
  then
    raise exception 'SAFETY_INVALID_RPC_PAYLOAD: worker code and identity belong to different profiles'
      using errcode = '23505';
  end if;

  if coalesce(v_worker_by_code, v_worker_by_identity) is not null then
    select worker
    into v_worker
    from public.safety_worker_profiles worker
    where worker.id = coalesce(v_worker_by_code, v_worker_by_identity)
    for update;

    if v_worker.worker_kind is not null and v_worker.worker_kind <> p_worker_kind then
      raise exception 'SAFETY_INVALID_RPC_PAYLOAD: worker kind conflicts with existing profile'
        using errcode = '22023';
    end if;

    update public.safety_worker_profiles worker
    set worker_kind = coalesce(worker.worker_kind, p_worker_kind),
        updated_by = v_actor::text,
        updated_at = now()
    where worker.id = v_worker.id
    returning * into v_worker;
  else
    insert into public.safety_worker_profiles (
      worker_code,
      full_name,
      worker_kind,
      identity_type,
      identity_number,
      identity_issue_date,
      identity_issue_place,
      date_of_birth,
      permanent_address,
      phone,
      role_name,
      status,
      identity_attachments,
      created_by,
      updated_by
    ) values (
      coalesce(v_worker_code, 'SW-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
      v_full_name,
      p_worker_kind,
      v_identity_type,
      v_identity_number,
      nullif(p_profile ->> 'identityIssueDate', '')::date,
      nullif(trim(p_profile ->> 'identityIssuePlace'), ''),
      nullif(p_profile ->> 'dateOfBirth', '')::date,
      nullif(trim(p_profile ->> 'permanentAddress'), ''),
      nullif(trim(p_profile ->> 'phone'), ''),
      nullif(trim(p_profile ->> 'roleName'), ''),
      'active',
      '[]'::jsonb,
      v_actor::text,
      v_actor::text
    )
    returning * into v_worker;
  end if;

  insert into public.safety_worker_site_memberships (
    worker_id,
    project_id,
    construction_site_id,
    default_subcontractor_id,
    default_team_id,
    status,
    source,
    created_by,
    updated_by
  ) values (
    v_worker.id,
    p_project_id,
    p_construction_site_id,
    case when p_worker_kind = 'company_staff' then null else p_subcontractor_id end,
    case when p_worker_kind = 'company_staff' then null else p_team_id end,
    'candidate',
    'manual',
    v_actor,
    v_actor
  )
  on conflict (worker_id, construction_site_id) do update
  set project_id = excluded.project_id,
      default_subcontractor_id = excluded.default_subcontractor_id,
      default_team_id = excluded.default_team_id,
      status = case
        when safety_worker_site_memberships.status = 'active' then 'active'
        else 'candidate'
      end,
      updated_by = excluded.updated_by,
      updated_at = now()
  returning * into v_membership;

  insert into public.safety_audit_logs (
    actor_user_id, action, target_type, target_id, project_id, construction_site_id, metadata
  ) values (
    v_actor::text,
    'worker.profile_for_site.create',
    'safety_worker_profiles',
    v_worker.id,
    p_project_id,
    p_construction_site_id::text,
    jsonb_build_object('membershipId', v_membership.id, 'workerKind', p_worker_kind)
  );

  return app_private.safety_workforce_detail_for_membership(v_membership.id);
end;
$$;

create or replace function app_private.update_safety_worker_profile_for_site(
  p_membership_id uuid,
  p_profile jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_membership public.safety_worker_site_memberships%rowtype;
  v_worker public.safety_worker_profiles%rowtype;
begin
  if jsonb_typeof(coalesce(p_profile, 'null'::jsonb)) <> 'object' then
    raise exception 'SAFETY_INVALID_RPC_PAYLOAD: profile patch must be an object'
      using errcode = '22023';
  end if;

  select membership
  into v_membership
  from public.safety_worker_site_memberships membership
  where membership.id = p_membership_id;

  if v_membership.id is null
    or v_actor is null
    or not app_private.safety_workforce_can_manage(v_membership.project_id, v_membership.construction_site_id)
  then
    raise exception 'SAFETY_SCOPE_MISMATCH: actor cannot update worker profile'
      using errcode = '42501';
  end if;

  select worker
  into v_worker
  from public.safety_worker_profiles worker
  where worker.id = v_membership.worker_id
  for update;

  perform membership.id
  from public.safety_worker_site_memberships membership
  where membership.id = v_membership.id
  for update;

  if p_profile ? 'fullName' and nullif(trim(p_profile ->> 'fullName'), '') is null then
    raise exception 'SAFETY_INVALID_RPC_PAYLOAD: full name cannot be empty'
      using errcode = '22023';
  end if;
  if p_profile ? 'identityType' and (p_profile ->> 'identityType') not in ('cccd', 'passport', 'other') then
    raise exception 'SAFETY_INVALID_RPC_PAYLOAD: invalid identity type'
      using errcode = '22023';
  end if;

  update public.safety_worker_profiles worker
  set worker_code = case when p_profile ? 'workerCode' then nullif(trim(p_profile ->> 'workerCode'), '') else worker.worker_code end,
      full_name = case when p_profile ? 'fullName' then trim(p_profile ->> 'fullName') else worker.full_name end,
      phone = case when p_profile ? 'phone' then nullif(trim(p_profile ->> 'phone'), '') else worker.phone end,
      date_of_birth = case when p_profile ? 'dateOfBirth' then nullif(p_profile ->> 'dateOfBirth', '')::date else worker.date_of_birth end,
      identity_type = case when p_profile ? 'identityType' then p_profile ->> 'identityType' else worker.identity_type end,
      identity_number = case when p_profile ? 'identityNumber' then nullif(trim(p_profile ->> 'identityNumber'), '') else worker.identity_number end,
      identity_issue_date = case when p_profile ? 'identityIssueDate' then nullif(p_profile ->> 'identityIssueDate', '')::date else worker.identity_issue_date end,
      identity_issue_place = case when p_profile ? 'identityIssuePlace' then nullif(trim(p_profile ->> 'identityIssuePlace'), '') else worker.identity_issue_place end,
      permanent_address = case when p_profile ? 'permanentAddress' then nullif(trim(p_profile ->> 'permanentAddress'), '') else worker.permanent_address end,
      role_name = case when p_profile ? 'roleName' then nullif(trim(p_profile ->> 'roleName'), '') else worker.role_name end,
      photo_attachment = case when p_profile ? 'photoAttachment' then p_profile -> 'photoAttachment' else worker.photo_attachment end,
      updated_by = v_actor::text,
      updated_at = now()
  where worker.id = v_worker.id;

  insert into public.safety_audit_logs (
    actor_user_id, action, target_type, target_id, project_id, construction_site_id, metadata
  ) values (
    v_actor::text,
    'worker.profile.update',
    'safety_worker_profiles',
    v_worker.id,
    v_membership.project_id,
    v_membership.construction_site_id::text,
    jsonb_build_object(
      'membershipId', v_membership.id,
      'fields', (select jsonb_agg(fields.field_name) from jsonb_object_keys(p_profile) as fields(field_name))
    )
  );

  return app_private.safety_workforce_detail_for_membership(v_membership.id);
end;
$$;

create or replace function app_private.upsert_safety_worker_documents_for_site(
  p_membership_id uuid,
  p_documents jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_membership public.safety_worker_site_memberships%rowtype;
  v_document jsonb;
  v_document_id uuid;
begin
  if jsonb_typeof(coalesce(p_documents, 'null'::jsonb)) <> 'array' then
    raise exception 'SAFETY_INVALID_RPC_PAYLOAD: documents must be an array'
      using errcode = '22023';
  end if;

  select membership
  into v_membership
  from public.safety_worker_site_memberships membership
  where membership.id = p_membership_id
  for update;

  if v_membership.id is null
    or v_actor is null
    or not app_private.safety_workforce_can_view_sensitive(v_membership.project_id, v_membership.construction_site_id)
  then
    raise exception 'SAFETY_SCOPE_MISMATCH: actor cannot update worker documents'
      using errcode = '42501';
  end if;

  for v_document in select value from jsonb_array_elements(p_documents)
  loop
    if jsonb_typeof(v_document) <> 'object'
      or nullif(trim(v_document ->> 'documentType'), '') is null
      or nullif(trim(v_document ->> 'name'), '') is null
    then
      raise exception 'SAFETY_INVALID_RPC_PAYLOAD: document type and name are required'
        using errcode = '22023';
    end if;
    if jsonb_typeof(coalesce(v_document -> 'attachments', '[]'::jsonb)) <> 'array' then
      raise exception 'SAFETY_INVALID_RPC_PAYLOAD: attachments must be an array'
        using errcode = '22023';
    end if;

    v_document_id := nullif(v_document ->> 'id', '')::uuid;
    if v_document_id is null
      and (v_document ->> 'documentType') in ('identity_front', 'identity_back', 'health_check', 'insurance', 'safety_card')
    then
      select document.id
      into v_document_id
      from public.safety_worker_documents document
      where document.worker_id = v_membership.worker_id
        and document.document_type = v_document ->> 'documentType'
      order by document.created_at desc, document.id desc
      limit 1;
    end if;

    if v_document_id is not null then
      update public.safety_worker_documents document
      set document_type = v_document ->> 'documentType',
          name = trim(v_document ->> 'name'),
          issue_date = nullif(v_document ->> 'issueDate', '')::date,
          expiry_date = nullif(v_document ->> 'expiryDate', '')::date,
          attachments = coalesce(v_document -> 'attachments', '[]'::jsonb),
          status = coalesce(nullif(v_document ->> 'status', ''), document.status),
          is_required = coalesce((v_document ->> 'isRequired')::boolean, document.is_required),
          updated_at = now()
      where document.id = v_document_id
        and document.worker_id = v_membership.worker_id;

      if not found then
        raise exception 'SAFETY_SCOPE_MISMATCH: document is outside worker profile'
          using errcode = '42501';
      end if;
    else
      insert into public.safety_worker_documents (
        worker_id, document_type, name, issue_date, expiry_date,
        attachments, status, is_required, created_by
      ) values (
        v_membership.worker_id,
        v_document ->> 'documentType',
        trim(v_document ->> 'name'),
        nullif(v_document ->> 'issueDate', '')::date,
        nullif(v_document ->> 'expiryDate', '')::date,
        coalesce(v_document -> 'attachments', '[]'::jsonb),
        coalesce(nullif(v_document ->> 'status', ''), 'submitted'),
        coalesce((v_document ->> 'isRequired')::boolean, false),
        v_actor::text
      );
    end if;
  end loop;

  insert into public.safety_audit_logs (
    actor_user_id, action, target_type, target_id, project_id, construction_site_id, metadata
  ) values (
    v_actor::text,
    'worker.documents.upsert',
    'safety_worker_profiles',
    v_membership.worker_id,
    v_membership.project_id,
    v_membership.construction_site_id::text,
    jsonb_build_object('membershipId', v_membership.id, 'count', jsonb_array_length(p_documents))
  );

  return app_private.safety_workforce_detail_for_membership(v_membership.id);
end;
$$;

create or replace function app_private.assign_safety_worker_to_site(
  p_membership_id uuid,
  p_started_at timestamptz,
  p_subcontractor_id uuid default null,
  p_team_id uuid default null,
  p_assignment jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_membership public.safety_worker_site_memberships%rowtype;
  v_worker public.safety_worker_profiles%rowtype;
  v_existing_assignment uuid;
  v_assignment_id uuid;
begin
  if p_started_at is null or jsonb_typeof(coalesce(p_assignment, 'null'::jsonb)) <> 'object' then
    raise exception 'SAFETY_INVALID_RPC_PAYLOAD: start time and assignment object are required'
      using errcode = '22023';
  end if;

  select membership
  into v_membership
  from public.safety_worker_site_memberships membership
  where membership.id = p_membership_id;

  if v_membership.id is null
    or v_actor is null
    or not app_private.safety_workforce_can_manage(v_membership.project_id, v_membership.construction_site_id)
  then
    raise exception 'SAFETY_SCOPE_MISMATCH: actor cannot assign worker to target site'
      using errcode = '42501';
  end if;

  select worker
  into v_worker
  from public.safety_worker_profiles worker
  where worker.id = v_membership.worker_id
  for update;

  perform membership.id
  from public.safety_worker_site_memberships membership
  where membership.id = v_membership.id
  for update;

  perform app_private.safety_workforce_assert_subcontractor_team(
    v_membership.project_id,
    v_membership.construction_site_id,
    p_subcontractor_id,
    p_team_id,
    v_worker.worker_kind
  );

  select assignment.id
  into v_existing_assignment
  from public.safety_project_assignments assignment
  where assignment.worker_id = v_worker.id
    and assignment.assignment_status = 'active'
  limit 1;

  if v_existing_assignment is not null then
    raise exception 'SAFETY_WORKER_ACTIVE_ELSEWHERE: worker already has an active assignment'
      using errcode = '23505';
  end if;

  update public.safety_worker_site_memberships membership
  set status = 'active',
      default_subcontractor_id = case when v_worker.worker_kind = 'company_staff' then null else p_subcontractor_id end,
      default_team_id = case when v_worker.worker_kind = 'company_staff' then null else p_team_id end,
      last_left_at = null,
      updated_by = v_actor,
      updated_at = now()
  where membership.id = v_membership.id;

  insert into public.safety_project_assignments (
    worker_id, project_id, construction_site_id, membership_id,
    assignment_status, started_at, start_date,
    subcontractor_id, team_id, role_name, work_type,
    site_training_status, commitment_status, ppe_status, toolbox_status,
    eligibility_status, source, created_by
  ) values (
    v_worker.id,
    v_membership.project_id,
    v_membership.construction_site_id::text,
    v_membership.id,
    'active',
    p_started_at,
    (p_started_at at time zone 'Asia/Ho_Chi_Minh')::date,
    case when v_worker.worker_kind = 'company_staff' then null else p_subcontractor_id end,
    case when v_worker.worker_kind = 'company_staff' then null else p_team_id end,
    nullif(trim(p_assignment ->> 'roleName'), ''),
    nullif(trim(p_assignment ->> 'workType'), ''),
    'pending', 'pending', 'missing', 'pending',
    'missing_profile', 'manual', v_actor::text
  )
  returning id into v_assignment_id;

  insert into public.safety_audit_logs (
    actor_user_id, action, target_type, target_id, project_id, construction_site_id, metadata
  ) values (
    v_actor::text,
    'assignment.create',
    'safety_project_assignments',
    v_assignment_id,
    v_membership.project_id,
    v_membership.construction_site_id::text,
    jsonb_build_object('membershipId', v_membership.id, 'workerId', v_worker.id)
  );

  return app_private.safety_workforce_detail_for_membership(v_membership.id);
end;
$$;

create or replace function app_private.update_safety_worker_assignment(
  p_assignment_id uuid,
  p_patch jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_assignment public.safety_project_assignments%rowtype;
  v_membership public.safety_worker_site_memberships%rowtype;
  v_worker public.safety_worker_profiles%rowtype;
  v_subcontractor_id uuid;
  v_team_id uuid;
begin
  if jsonb_typeof(coalesce(p_patch, 'null'::jsonb)) <> 'object' then
    raise exception 'SAFETY_INVALID_RPC_PAYLOAD: assignment patch must be an object'
      using errcode = '22023';
  end if;

  select assignment
  into v_assignment
  from public.safety_project_assignments assignment
  where assignment.id = p_assignment_id;

  select membership
  into v_membership
  from public.safety_worker_site_memberships membership
  where membership.id = v_assignment.membership_id;

  if v_assignment.id is null
    or v_membership.id is null
    or v_actor is null
    or not app_private.safety_workforce_can_manage(v_membership.project_id, v_membership.construction_site_id)
  then
    raise exception 'SAFETY_SCOPE_MISMATCH: actor cannot update assignment'
      using errcode = '42501';
  end if;

  select worker
  into v_worker
  from public.safety_worker_profiles worker
  where worker.id = v_assignment.worker_id
  for update;

  perform assignment.id
  from public.safety_project_assignments assignment
  where assignment.id = v_assignment.id
  for update;

  perform membership.id
  from public.safety_worker_site_memberships membership
  where membership.id = v_membership.id
  for update;

  v_subcontractor_id := case
    when p_patch ? 'subcontractorId' then nullif(p_patch ->> 'subcontractorId', '')::uuid
    else v_assignment.subcontractor_id
  end;
  v_team_id := case
    when p_patch ? 'teamId' then nullif(p_patch ->> 'teamId', '')::uuid
    else v_assignment.team_id
  end;

  perform app_private.safety_workforce_assert_subcontractor_team(
    v_membership.project_id,
    v_membership.construction_site_id,
    v_subcontractor_id,
    v_team_id,
    v_worker.worker_kind
  );

  update public.safety_project_assignments assignment
  set subcontractor_id = case when v_worker.worker_kind = 'company_staff' then null else v_subcontractor_id end,
      team_id = case when v_worker.worker_kind = 'company_staff' then null else v_team_id end,
      role_name = case when p_patch ? 'roleName' then nullif(trim(p_patch ->> 'roleName'), '') else assignment.role_name end,
      work_type = case when p_patch ? 'workType' then nullif(trim(p_patch ->> 'workType'), '') else assignment.work_type end,
      site_training_status = case when p_patch ? 'siteTrainingStatus' then p_patch ->> 'siteTrainingStatus' else assignment.site_training_status end,
      commitment_status = case when p_patch ? 'commitmentStatus' then p_patch ->> 'commitmentStatus' else assignment.commitment_status end,
      ppe_status = case when p_patch ? 'ppeStatus' then p_patch ->> 'ppeStatus' else assignment.ppe_status end,
      toolbox_status = case when p_patch ? 'toolboxStatus' then p_patch ->> 'toolboxStatus' else assignment.toolbox_status end,
      is_locked = case when p_patch ? 'isLocked' then (p_patch ->> 'isLocked')::boolean else assignment.is_locked end,
      lock_reason = case when p_patch ? 'lockReason' then nullif(trim(p_patch ->> 'lockReason'), '') else assignment.lock_reason end,
      updated_at = now()
  where assignment.id = v_assignment.id;

  update public.safety_worker_site_memberships membership
  set default_subcontractor_id = case when v_worker.worker_kind = 'company_staff' then null else v_subcontractor_id end,
      default_team_id = case when v_worker.worker_kind = 'company_staff' then null else v_team_id end,
      updated_by = v_actor,
      updated_at = now()
  where membership.id = v_membership.id;

  insert into public.safety_audit_logs (
    actor_user_id, action, target_type, target_id, project_id, construction_site_id, metadata
  ) values (
    v_actor::text,
    'assignment.update',
    'safety_project_assignments',
    v_assignment.id,
    v_membership.project_id,
    v_membership.construction_site_id::text,
    jsonb_build_object(
      'membershipId', v_membership.id,
      'fields', (select jsonb_agg(fields.field_name) from jsonb_object_keys(p_patch) as fields(field_name))
    )
  );

  return app_private.safety_workforce_detail_for_membership(v_membership.id);
end;
$$;

create or replace function app_private.end_safety_worker_assignment(
  p_assignment_id uuid,
  p_ended_at timestamptz,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_assignment public.safety_project_assignments%rowtype;
  v_membership public.safety_worker_site_memberships%rowtype;
  v_worker public.safety_worker_profiles%rowtype;
begin
  if p_ended_at is null or nullif(trim(p_reason), '') is null then
    raise exception 'SAFETY_INVALID_RPC_PAYLOAD: end time and reason are required'
      using errcode = '22023';
  end if;

  select assignment
  into v_assignment
  from public.safety_project_assignments assignment
  where assignment.id = p_assignment_id;

  select membership
  into v_membership
  from public.safety_worker_site_memberships membership
  where membership.id = v_assignment.membership_id;

  if v_assignment.id is null
    or v_assignment.assignment_status <> 'active'
    or v_membership.id is null
    or v_actor is null
    or not app_private.safety_workforce_can_manage(v_membership.project_id, v_membership.construction_site_id)
  then
    raise exception 'SAFETY_SCOPE_MISMATCH: assignment is not active or manageable'
      using errcode = '42501';
  end if;
  if p_ended_at < v_assignment.started_at then
    raise exception 'SAFETY_INVALID_RPC_PAYLOAD: end time precedes start time'
      using errcode = '22023';
  end if;

  select worker
  into v_worker
  from public.safety_worker_profiles worker
  where worker.id = v_assignment.worker_id
  for update;

  perform assignment.id
  from public.safety_project_assignments assignment
  where assignment.id = v_assignment.id
  for update;

  perform membership.id
  from public.safety_worker_site_memberships membership
  where membership.id = v_membership.id
  for update;

  update public.safety_project_assignments assignment
  set assignment_status = 'ended',
      ended_at = p_ended_at,
      end_date = (p_ended_at at time zone 'Asia/Ho_Chi_Minh')::date,
      ended_by = v_actor,
      ended_reason = trim(p_reason),
      updated_at = now()
  where assignment.id = v_assignment.id;

  update public.safety_cards card
  set status = 'revoked',
      revoked_reason = 'Assignment ended: ' || trim(p_reason),
      updated_at = now()
  where card.assignment_id = v_assignment.id
    and card.status = 'active';

  update public.safety_worker_site_memberships membership
  set status = 'inactive',
      last_left_at = p_ended_at,
      updated_by = v_actor,
      updated_at = now()
  where membership.id = v_membership.id;

  insert into public.safety_audit_logs (
    actor_user_id, action, target_type, target_id, project_id, construction_site_id, metadata
  ) values (
    v_actor::text,
    'assignment.end',
    'safety_project_assignments',
    v_assignment.id,
    v_membership.project_id,
    v_membership.construction_site_id::text,
    jsonb_build_object('membershipId', v_membership.id, 'reason', trim(p_reason))
  );

  return app_private.safety_workforce_detail_for_membership(v_membership.id);
end;
$$;

create or replace function app_private.transfer_safety_worker_site(
  p_assignment_id uuid,
  p_target_project_id text,
  p_target_construction_site_id uuid,
  p_started_at timestamptz,
  p_subcontractor_id uuid default null,
  p_team_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_assignment public.safety_project_assignments%rowtype;
  v_source_membership public.safety_worker_site_memberships%rowtype;
  v_target_membership public.safety_worker_site_memberships%rowtype;
  v_worker public.safety_worker_profiles%rowtype;
  v_target_assignment_id uuid;
begin
  perform app_private.safety_workforce_assert_scope(p_target_project_id, p_target_construction_site_id);
  if p_started_at is null then
    raise exception 'SAFETY_INVALID_RPC_PAYLOAD: transfer start time is required'
      using errcode = '22023';
  end if;

  select assignment
  into v_assignment
  from public.safety_project_assignments assignment
  where assignment.id = p_assignment_id;

  if v_assignment.id is null or v_assignment.assignment_status <> 'active' then
    raise exception 'SAFETY_SCOPE_MISMATCH: active source assignment not found'
      using errcode = '42501';
  end if;

  select worker
  into v_worker
  from public.safety_worker_profiles worker
  where worker.id = v_assignment.worker_id
  for update;

  select membership
  into v_source_membership
  from public.safety_worker_site_memberships membership
  where membership.id = v_assignment.membership_id;

  if v_actor is null
    or not app_private.safety_workforce_can_manage(v_source_membership.project_id, v_source_membership.construction_site_id)
    or not app_private.safety_workforce_can_manage(p_target_project_id, p_target_construction_site_id)
  then
    raise exception 'SAFETY_TRANSFER_PERMISSION_REQUIRED: manage permission is required on source and target sites'
      using errcode = '42501';
  end if;
  if p_started_at < v_assignment.started_at then
    raise exception 'SAFETY_INVALID_RPC_PAYLOAD: transfer time precedes assignment start'
      using errcode = '22023';
  end if;

  perform app_private.safety_workforce_assert_subcontractor_team(
    p_target_project_id,
    p_target_construction_site_id,
    p_subcontractor_id,
    p_team_id,
    v_worker.worker_kind
  );

  insert into public.safety_worker_site_memberships (
    worker_id, project_id, construction_site_id,
    default_subcontractor_id, default_team_id,
    status, first_joined_at, source, created_by, updated_by
  ) values (
    v_worker.id,
    p_target_project_id,
    p_target_construction_site_id,
    case when v_worker.worker_kind = 'company_staff' then null else p_subcontractor_id end,
    case when v_worker.worker_kind = 'company_staff' then null else p_team_id end,
    'candidate',
    p_started_at,
    'transfer',
    v_actor,
    v_actor
  )
  on conflict (worker_id, construction_site_id) do update
  set project_id = excluded.project_id,
      default_subcontractor_id = excluded.default_subcontractor_id,
      default_team_id = excluded.default_team_id,
      updated_by = excluded.updated_by,
      updated_at = now()
  returning * into v_target_membership;

  if v_source_membership.id = v_target_membership.id then
    raise exception 'SAFETY_SCOPE_MISMATCH: source and target memberships are identical'
      using errcode = '22023';
  end if;

  perform membership.id
  from public.safety_worker_site_memberships membership
  where membership.id in (v_source_membership.id, v_target_membership.id)
  order by membership.id for update;

  select assignment
  into v_assignment
  from public.safety_project_assignments assignment
  where assignment.id = p_assignment_id
  for update;

  if v_assignment.assignment_status <> 'active' then
    raise exception 'SAFETY_WORKER_ACTIVE_ELSEWHERE: source assignment changed during transfer'
      using errcode = '40001';
  end if;

  update public.safety_project_assignments assignment
  set assignment_status = 'ended',
      ended_at = p_started_at,
      end_date = (p_started_at at time zone 'Asia/Ho_Chi_Minh')::date,
      ended_by = v_actor,
      ended_reason = 'Transferred to another construction site',
      updated_at = now()
  where assignment.id = v_assignment.id;

  update public.safety_cards card
  set status = 'revoked',
      revoked_reason = 'Assignment transferred to another construction site',
      updated_at = now()
  where card.assignment_id = v_assignment.id
    and card.status = 'active';

  update public.safety_worker_site_memberships membership
  set status = 'inactive',
      last_left_at = p_started_at,
      updated_by = v_actor,
      updated_at = now()
  where membership.id = v_source_membership.id;

  update public.safety_worker_site_memberships membership
  set status = 'active',
      last_left_at = null,
      default_subcontractor_id = case when v_worker.worker_kind = 'company_staff' then null else p_subcontractor_id end,
      default_team_id = case when v_worker.worker_kind = 'company_staff' then null else p_team_id end,
      updated_by = v_actor,
      updated_at = now()
  where membership.id = v_target_membership.id;

  insert into public.safety_project_assignments (
    worker_id, project_id, construction_site_id, membership_id,
    assignment_status, started_at, start_date,
    subcontractor_id, team_id, role_name, work_type,
    site_training_status, commitment_status, ppe_status, toolbox_status,
    eligibility_status, source, created_by
  ) values (
    v_worker.id,
    p_target_project_id,
    p_target_construction_site_id::text,
    v_target_membership.id,
    'active',
    p_started_at,
    (p_started_at at time zone 'Asia/Ho_Chi_Minh')::date,
    case when v_worker.worker_kind = 'company_staff' then null else p_subcontractor_id end,
    case when v_worker.worker_kind = 'company_staff' then null else p_team_id end,
    v_assignment.role_name,
    v_assignment.work_type,
    'pending', 'pending', 'missing', 'pending',
    'missing_profile', 'transfer', v_actor::text
  )
  returning id into v_target_assignment_id;

  insert into public.safety_audit_logs (
    actor_user_id, action, target_type, target_id, project_id, construction_site_id, metadata
  ) values (
    v_actor::text,
    'assignment.transfer',
    'safety_project_assignments',
    v_target_assignment_id,
    p_target_project_id,
    p_target_construction_site_id::text,
    jsonb_build_object(
      'sourceAssignmentId', v_assignment.id,
      'sourceMembershipId', v_source_membership.id,
      'targetMembershipId', v_target_membership.id
    )
  );

  return app_private.safety_workforce_detail_for_membership(v_target_membership.id);
end;
$$;

create or replace function app_private.issue_safety_assignment_card(
  p_assignment_id uuid,
  p_expires_at date,
  p_template_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_assignment public.safety_project_assignments%rowtype;
  v_membership public.safety_worker_site_memberships%rowtype;
  v_worker public.safety_worker_profiles%rowtype;
  v_existing_card uuid;
  v_card_id uuid;
  v_card_code text;
begin
  if p_expires_at is null or p_expires_at <= current_date then
    raise exception 'SAFETY_INVALID_RPC_PAYLOAD: card expiry must be in the future'
      using errcode = '22023';
  end if;

  select assignment
  into v_assignment
  from public.safety_project_assignments assignment
  where assignment.id = p_assignment_id;

  select membership
  into v_membership
  from public.safety_worker_site_memberships membership
  where membership.id = v_assignment.membership_id;

  if v_assignment.id is null
    or v_assignment.assignment_status <> 'active'
    or v_membership.id is null
    or v_actor is null
    or not app_private.safety_workforce_can_manage(v_membership.project_id, v_membership.construction_site_id)
  then
    raise exception 'SAFETY_SCOPE_MISMATCH: active assignment is not manageable'
      using errcode = '42501';
  end if;

  select worker
  into v_worker
  from public.safety_worker_profiles worker
  where worker.id = v_assignment.worker_id
  for update;

  select assignment
  into v_assignment
  from public.safety_project_assignments assignment
  where assignment.id = p_assignment_id
  for update;

  perform membership.id
  from public.safety_worker_site_memberships membership
  where membership.id = v_membership.id
  for update;

  if v_assignment.eligibility_status <> 'eligible' then
    raise exception 'SAFETY_ASSIGNMENT_NOT_ELIGIBLE: assignment must be eligible before card issue'
      using errcode = '22023';
  end if;

  select card.id
  into v_existing_card
  from public.safety_cards card
  where card.assignment_id = v_assignment.id
    and card.status = 'active'
  limit 1;

  if v_existing_card is not null then
    raise exception 'SAFETY_ACTIVE_CARD_EXISTS: assignment already has an active card'
      using errcode = '23505';
  end if;

  if p_template_id is not null and not exists (
    select 1
    from public.safety_card_templates template
    where template.id = p_template_id
      and template.is_active
  ) then
    raise exception 'SAFETY_INVALID_RPC_PAYLOAD: active card template not found'
      using errcode = '22023';
  end if;

  v_card_code := 'SAFE-CARD-' || lpad(nextval('public.safety_card_code_seq')::text, 5, '0');

  insert into public.safety_cards (
    assignment_id, worker_id, project_id, construction_site_id,
    template_id, card_code, expires_at, status, created_by
  ) values (
    v_assignment.id,
    v_worker.id,
    v_membership.project_id,
    v_membership.construction_site_id::text,
    p_template_id,
    v_card_code,
    p_expires_at,
    'active',
    v_actor::text
  )
  returning id into v_card_id;

  insert into public.safety_audit_logs (
    actor_user_id, action, target_type, target_id, project_id, construction_site_id, metadata
  ) values (
    v_actor::text,
    'card.issue',
    'safety_cards',
    v_card_id,
    v_membership.project_id,
    v_membership.construction_site_id::text,
    jsonb_build_object('assignmentId', v_assignment.id, 'expiresAt', p_expires_at)
  );

  return app_private.safety_workforce_detail_for_membership(v_membership.id);
end;
$$;

create or replace function app_private.renew_safety_assignment_card(
  p_card_id uuid,
  p_expires_at date
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_card public.safety_cards%rowtype;
  v_assignment public.safety_project_assignments%rowtype;
  v_membership public.safety_worker_site_memberships%rowtype;
  v_old_expiry date;
begin
  if p_expires_at is null or p_expires_at <= current_date then
    raise exception 'SAFETY_INVALID_RPC_PAYLOAD: renewed expiry must be in the future'
      using errcode = '22023';
  end if;

  select card
  into v_card
  from public.safety_cards card
  where card.id = p_card_id
  for update;

  select assignment
  into v_assignment
  from public.safety_project_assignments assignment
  where assignment.id = v_card.assignment_id;

  select membership
  into v_membership
  from public.safety_worker_site_memberships membership
  where membership.id = v_assignment.membership_id;

  if v_card.id is null
    or v_card.status <> 'active'
    or v_assignment.assignment_status <> 'active'
    or v_actor is null
    or not app_private.safety_workforce_can_manage(v_membership.project_id, v_membership.construction_site_id)
  then
    raise exception 'SAFETY_SCOPE_MISMATCH: active card is not renewable'
      using errcode = '42501';
  end if;

  v_old_expiry := v_card.expires_at;
  update public.safety_cards card
  set expires_at = p_expires_at,
      updated_at = now()
  where card.id = v_card.id;

  insert into public.safety_audit_logs (
    actor_user_id, action, target_type, target_id, project_id, construction_site_id, metadata
  ) values (
    v_actor::text,
    'card.renew',
    'safety_cards',
    v_card.id,
    v_membership.project_id,
    v_membership.construction_site_id::text,
    jsonb_build_object('oldExpiry', v_old_expiry, 'newExpiry', p_expires_at)
  );

  return app_private.safety_workforce_detail_for_membership(v_membership.id);
end;
$$;

create or replace function app_private.revoke_safety_assignment_card(
  p_card_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_card public.safety_cards%rowtype;
  v_assignment public.safety_project_assignments%rowtype;
  v_membership public.safety_worker_site_memberships%rowtype;
begin
  if nullif(trim(p_reason), '') is null then
    raise exception 'SAFETY_INVALID_RPC_PAYLOAD: revoke reason is required'
      using errcode = '22023';
  end if;

  select card
  into v_card
  from public.safety_cards card
  where card.id = p_card_id
  for update;

  select assignment
  into v_assignment
  from public.safety_project_assignments assignment
  where assignment.id = v_card.assignment_id;

  select membership
  into v_membership
  from public.safety_worker_site_memberships membership
  where membership.id = v_assignment.membership_id;

  if v_card.id is null
    or v_card.status <> 'active'
    or v_actor is null
    or not app_private.safety_workforce_can_manage(v_membership.project_id, v_membership.construction_site_id)
  then
    raise exception 'SAFETY_SCOPE_MISMATCH: active card is not revocable'
      using errcode = '42501';
  end if;

  update public.safety_cards card
  set status = 'revoked',
      revoked_reason = trim(p_reason),
      updated_at = now()
  where card.id = v_card.id;

  insert into public.safety_audit_logs (
    actor_user_id, action, target_type, target_id, project_id, construction_site_id, metadata
  ) values (
    v_actor::text,
    'card.revoke',
    'safety_cards',
    v_card.id,
    v_membership.project_id,
    v_membership.construction_site_id::text,
    jsonb_build_object('reason', trim(p_reason))
  );

  return app_private.safety_workforce_detail_for_membership(v_membership.id);
end;
$$;

create or replace function app_private.log_safety_card_print(p_card_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_card public.safety_cards%rowtype;
  v_assignment public.safety_project_assignments%rowtype;
  v_membership public.safety_worker_site_memberships%rowtype;
  v_template_snapshot jsonb := '{}'::jsonb;
begin
  select card
  into v_card
  from public.safety_cards card
  where card.id = p_card_id
  for update;

  select assignment
  into v_assignment
  from public.safety_project_assignments assignment
  where assignment.id = v_card.assignment_id;

  select membership
  into v_membership
  from public.safety_worker_site_memberships membership
  where membership.id = v_assignment.membership_id;

  if v_card.id is null
    or v_actor is null
    or not app_private.safety_workforce_can_manage(v_membership.project_id, v_membership.construction_site_id)
  then
    raise exception 'SAFETY_SCOPE_MISMATCH: card is not printable'
      using errcode = '42501';
  end if;

  if v_card.template_id is not null then
    select jsonb_build_object(
      'id', template.id,
      'name', template.name,
      'layoutJson', template.layout_json,
      'backgroundAttachment', template.background_attachment
    )
    into v_template_snapshot
    from public.safety_card_templates template
    where template.id = v_card.template_id;
  end if;

  insert into public.safety_card_print_logs (
    card_id, printed_by, template_snapshot, metadata
  ) values (
    v_card.id,
    v_actor::text,
    coalesce(v_template_snapshot, '{}'::jsonb),
    jsonb_build_object('membershipId', v_membership.id)
  );

  update public.safety_cards as card
  set printed_count = card.printed_count + 1,
      updated_at = now()
  where card.id = v_card.id;

  insert into public.safety_audit_logs (
    actor_user_id, action, target_type, target_id, project_id, construction_site_id, metadata
  ) values (
    v_actor::text,
    'card.print',
    'safety_cards',
    v_card.id,
    v_membership.project_id,
    v_membership.construction_site_id::text,
    jsonb_build_object('assignmentId', v_assignment.id)
  );

  return app_private.safety_workforce_detail_for_membership(v_membership.id);
end;
$$;

create or replace function public.create_safety_worker_profile_for_site(
  p_project_id text,
  p_construction_site_id uuid,
  p_worker_kind text,
  p_profile jsonb,
  p_subcontractor_id uuid default null,
  p_team_id uuid default null
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.create_safety_worker_profile_for_site(
    p_project_id, p_construction_site_id, p_worker_kind, p_profile,
    p_subcontractor_id, p_team_id
  );
$$;

create or replace function public.update_safety_worker_profile_for_site(
  p_membership_id uuid,
  p_profile jsonb
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.update_safety_worker_profile_for_site(p_membership_id, p_profile);
$$;

create or replace function public.upsert_safety_worker_documents_for_site(
  p_membership_id uuid,
  p_documents jsonb
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.upsert_safety_worker_documents_for_site(p_membership_id, p_documents);
$$;

create or replace function public.assign_safety_worker_to_site(
  p_membership_id uuid,
  p_started_at timestamptz,
  p_subcontractor_id uuid default null,
  p_team_id uuid default null,
  p_assignment jsonb default '{}'::jsonb
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.assign_safety_worker_to_site(
    p_membership_id, p_started_at, p_subcontractor_id, p_team_id, p_assignment
  );
$$;

create or replace function public.update_safety_worker_assignment(
  p_assignment_id uuid,
  p_patch jsonb
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.update_safety_worker_assignment(p_assignment_id, p_patch);
$$;

create or replace function public.end_safety_worker_assignment(
  p_assignment_id uuid,
  p_ended_at timestamptz,
  p_reason text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.end_safety_worker_assignment(p_assignment_id, p_ended_at, p_reason);
$$;

create or replace function public.transfer_safety_worker_site(
  p_assignment_id uuid,
  p_target_project_id text,
  p_target_construction_site_id uuid,
  p_started_at timestamptz,
  p_subcontractor_id uuid default null,
  p_team_id uuid default null
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.transfer_safety_worker_site(
    p_assignment_id, p_target_project_id, p_target_construction_site_id,
    p_started_at, p_subcontractor_id, p_team_id
  );
$$;

create or replace function public.issue_safety_assignment_card(
  p_assignment_id uuid,
  p_expires_at date,
  p_template_id uuid default null
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.issue_safety_assignment_card(p_assignment_id, p_expires_at, p_template_id);
$$;

create or replace function public.renew_safety_assignment_card(
  p_card_id uuid,
  p_expires_at date
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.renew_safety_assignment_card(p_card_id, p_expires_at);
$$;

create or replace function public.revoke_safety_assignment_card(
  p_card_id uuid,
  p_reason text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.revoke_safety_assignment_card(p_card_id, p_reason);
$$;

create or replace function public.log_safety_card_print(p_card_id uuid)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.log_safety_card_print(p_card_id);
$$;

revoke all on function app_private.safety_workforce_detail_for_membership(uuid) from public, anon;
revoke all on function app_private.create_safety_worker_profile_for_site(text, uuid, text, jsonb, uuid, uuid) from public, anon;
revoke all on function app_private.update_safety_worker_profile_for_site(uuid, jsonb) from public, anon;
revoke all on function app_private.upsert_safety_worker_documents_for_site(uuid, jsonb) from public, anon;
revoke all on function app_private.assign_safety_worker_to_site(uuid, timestamptz, uuid, uuid, jsonb) from public, anon;
revoke all on function app_private.update_safety_worker_assignment(uuid, jsonb) from public, anon;
revoke all on function app_private.end_safety_worker_assignment(uuid, timestamptz, text) from public, anon;
revoke all on function app_private.transfer_safety_worker_site(uuid, text, uuid, timestamptz, uuid, uuid) from public, anon;
revoke all on function app_private.issue_safety_assignment_card(uuid, date, uuid) from public, anon;
revoke all on function app_private.renew_safety_assignment_card(uuid, date) from public, anon;
revoke all on function app_private.revoke_safety_assignment_card(uuid, text) from public, anon;
revoke all on function app_private.log_safety_card_print(uuid) from public, anon;

grant execute on function app_private.safety_workforce_detail_for_membership(uuid) to authenticated;
grant execute on function app_private.create_safety_worker_profile_for_site(text, uuid, text, jsonb, uuid, uuid) to authenticated;
grant execute on function app_private.update_safety_worker_profile_for_site(uuid, jsonb) to authenticated;
grant execute on function app_private.upsert_safety_worker_documents_for_site(uuid, jsonb) to authenticated;
grant execute on function app_private.assign_safety_worker_to_site(uuid, timestamptz, uuid, uuid, jsonb) to authenticated;
grant execute on function app_private.update_safety_worker_assignment(uuid, jsonb) to authenticated;
grant execute on function app_private.end_safety_worker_assignment(uuid, timestamptz, text) to authenticated;
grant execute on function app_private.transfer_safety_worker_site(uuid, text, uuid, timestamptz, uuid, uuid) to authenticated;
grant execute on function app_private.issue_safety_assignment_card(uuid, date, uuid) to authenticated;
grant execute on function app_private.renew_safety_assignment_card(uuid, date) to authenticated;
grant execute on function app_private.revoke_safety_assignment_card(uuid, text) to authenticated;
grant execute on function app_private.log_safety_card_print(uuid) to authenticated;

revoke all on function public.create_safety_worker_profile_for_site(text, uuid, text, jsonb, uuid, uuid) from public, anon;
revoke all on function public.update_safety_worker_profile_for_site(uuid, jsonb) from public, anon;
revoke all on function public.upsert_safety_worker_documents_for_site(uuid, jsonb) from public, anon;
revoke all on function public.assign_safety_worker_to_site(uuid, timestamptz, uuid, uuid, jsonb) from public, anon;
revoke all on function public.update_safety_worker_assignment(uuid, jsonb) from public, anon;
revoke all on function public.end_safety_worker_assignment(uuid, timestamptz, text) from public, anon;
revoke all on function public.transfer_safety_worker_site(uuid, text, uuid, timestamptz, uuid, uuid) from public, anon;
revoke all on function public.issue_safety_assignment_card(uuid, date, uuid) from public, anon;
revoke all on function public.renew_safety_assignment_card(uuid, date) from public, anon;
revoke all on function public.revoke_safety_assignment_card(uuid, text) from public, anon;
revoke all on function public.log_safety_card_print(uuid) from public, anon;

grant execute on function public.create_safety_worker_profile_for_site(text, uuid, text, jsonb, uuid, uuid) to authenticated;
grant execute on function public.update_safety_worker_profile_for_site(uuid, jsonb) to authenticated;
grant execute on function public.upsert_safety_worker_documents_for_site(uuid, jsonb) to authenticated;
grant execute on function public.assign_safety_worker_to_site(uuid, timestamptz, uuid, uuid, jsonb) to authenticated;
grant execute on function public.update_safety_worker_assignment(uuid, jsonb) to authenticated;
grant execute on function public.end_safety_worker_assignment(uuid, timestamptz, text) to authenticated;
grant execute on function public.transfer_safety_worker_site(uuid, text, uuid, timestamptz, uuid, uuid) to authenticated;
grant execute on function public.issue_safety_assignment_card(uuid, date, uuid) to authenticated;
grant execute on function public.renew_safety_assignment_card(uuid, date) to authenticated;
grant execute on function public.revoke_safety_assignment_card(uuid, text) to authenticated;
grant execute on function public.log_safety_card_print(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
