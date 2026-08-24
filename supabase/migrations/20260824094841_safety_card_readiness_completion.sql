begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function app_private.safety_workforce_has_canonical_identity_document(
  p_worker_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.safety_worker_documents document
    where document.worker_id = p_worker_id
      and document.document_type in ('identity_front', 'identity_back')
      and document.status not in ('missing', 'expired', 'rejected')
      and jsonb_array_length(coalesce(document.attachments, '[]'::jsonb)) > 0
  );
$$;

create or replace function app_private.safety_workforce_profile_readiness(
  p_worker_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when worker.id is null
      or worker.status <> 'active'
      or nullif(trim(worker.full_name), '') is null
      or nullif(trim(worker.worker_code), '') is null
      or worker.photo_attachment = 'null'::jsonb
      or worker.identity_number_normalized is null
      or (
        jsonb_array_length(coalesce(worker.identity_attachments, '[]'::jsonb)) = 0
        and not app_private.safety_workforce_has_canonical_identity_document(worker.id)
      )
    then 'missing'
    else 'valid'
  end
  from public.safety_worker_profiles worker
  where worker.id = p_worker_id;
$$;

create or replace function app_private.safety_assignment_eligibility_status(p_assignment_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_assignment public.safety_project_assignments%rowtype;
  v_worker public.safety_worker_profiles%rowtype;
  v_required_count integer := 0;
  v_missing_count integer := 0;
  v_expired_count integer := 0;
  v_required_document_missing_count integer := 0;
begin
  select * into v_assignment
  from public.safety_project_assignments assignment
  where assignment.id = p_assignment_id;

  if not found then return 'missing_profile'; end if;

  select * into v_worker
  from public.safety_worker_profiles worker
  where worker.id = v_assignment.worker_id;

  if not found then return 'missing_profile'; end if;
  if v_worker.status = 'suspended' or v_assignment.is_locked then return 'suspended'; end if;

  if v_worker.status <> 'active'
    or nullif(trim(v_worker.full_name), '') is null
    or nullif(trim(v_worker.worker_code), '') is null
    or v_worker.photo_attachment = 'null'::jsonb
    or nullif(trim(coalesce(v_worker.identity_number, '')), '') is null
    or (
      jsonb_array_length(coalesce(v_worker.identity_attachments, '[]'::jsonb)) = 0
      and not app_private.safety_workforce_has_canonical_identity_document(v_worker.id)
    )
  then return 'missing_profile'; end if;

  with required_documents(document_type) as (
    values ('health_check'), ('insurance')
  ), document_state as (
    select required_documents.document_type, document.id, document.status, document.expiry_date, document.attachments
    from required_documents
    left join lateral (
      select worker_document.*
      from public.safety_worker_documents worker_document
      where worker_document.worker_id = v_worker.id
        and worker_document.document_type = required_documents.document_type
        and worker_document.status <> 'rejected'
      order by worker_document.expiry_date desc nulls last, worker_document.created_at desc
      limit 1
    ) document on true
  )
  select count(*) into v_required_document_missing_count
  from document_state
  where id is null
    or status in ('missing', 'expired', 'rejected')
    or jsonb_array_length(coalesce(attachments, '[]'::jsonb)) = 0
    or (expiry_date is not null and expiry_date < current_date);

  if v_required_document_missing_count > 0 then return 'missing_profile'; end if;

  select count(*) into v_required_count
  from public.safety_certificate_types certificate_type
  where certificate_type.is_active
    and certificate_type.is_required_default
    and app_private.safety_required_certificate_type_applies(
      certificate_type.applies_to_roles,
      coalesce(v_assignment.role_name, v_worker.role_name)
    );

  if v_required_count > 0 then
    select
      count(*) filter (where certificate.id is null),
      count(*) filter (where certificate.id is not null and certificate.expiry_date is not null and certificate.expiry_date < current_date)
    into v_missing_count, v_expired_count
    from public.safety_certificate_types certificate_type
    left join lateral (
      select worker_certificate.*
      from public.safety_worker_certificates worker_certificate
      where worker_certificate.worker_id = v_worker.id
        and worker_certificate.certificate_type_id = certificate_type.id
        and worker_certificate.status in ('approved', 'submitted')
        and worker_certificate.status not in ('rejected', 'revoked')
      order by worker_certificate.expiry_date desc nulls last, worker_certificate.created_at desc
      limit 1
    ) certificate on true
    where certificate_type.is_active
      and certificate_type.is_required_default
      and app_private.safety_required_certificate_type_applies(
        certificate_type.applies_to_roles,
        coalesce(v_assignment.role_name, v_worker.role_name)
      );

    if v_missing_count > 0 then return 'missing_certificate'; end if;
    if v_expired_count > 0 then return 'expired_certificate'; end if;
  end if;

  if v_assignment.site_training_status <> 'completed'
    or v_assignment.commitment_status <> 'signed'
    or v_assignment.ppe_status <> 'complete'
    or v_assignment.toolbox_status <> 'completed'
  then return 'missing_site_requirement'; end if;

  return 'eligible';
end;
$$;

create or replace function app_private.list_safety_site_workforce_options(
  p_project_id text,
  p_construction_site_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.safety_workforce_assert_scope(p_project_id, p_construction_site_id);
  if not app_private.safety_workforce_can_view(p_project_id, p_construction_site_id) then
    raise exception 'SAFETY_SCOPE_MISMATCH: actor cannot view target site' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'subcontractors', coalesce((
      select jsonb_agg(jsonb_build_object('id', subcontractor.id, 'name', subcontractor.name, 'code', subcontractor.code, 'status', subcontractor.status) order by subcontractor.name, subcontractor.id)
      from public.safety_subcontractors subcontractor
      where subcontractor.project_id = p_project_id
        and subcontractor.construction_site_id = p_construction_site_id::text
        and subcontractor.status in ('approved', 'active')
    ), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object('id', team.id, 'name', team.name, 'code', team.code, 'status', team.status, 'subcontractorId', team.subcontractor_id) order by team.name, team.id)
      from public.safety_teams team
      where team.project_id = p_project_id
        and team.construction_site_id = p_construction_site_id::text
        and team.status = 'active'
    ), '[]'::jsonb),
    'certificateTypes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', certificate_type.id,
        'code', certificate_type.code,
        'name', certificate_type.name,
        'isRequiredDefault', certificate_type.is_required_default,
        'validityDays', certificate_type.validity_days,
        'appliesToRoles', certificate_type.applies_to_roles,
        'isActive', certificate_type.is_active,
        'sortOrder', certificate_type.sort_order
      ) order by certificate_type.sort_order, certificate_type.name, certificate_type.id)
      from public.safety_certificate_types certificate_type
      where certificate_type.is_active
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function app_private.upsert_safety_worker_certificate_for_site(
  p_membership_id uuid,
  p_certificate jsonb
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
  v_certificate_id uuid := nullif(p_certificate ->> 'id', '')::uuid;
  v_certificate_type_id uuid := nullif(p_certificate ->> 'certificateTypeId', '')::uuid;
  v_existing public.safety_worker_certificates%rowtype;
  v_attachments jsonb := coalesce(p_certificate -> 'attachments', '[]'::jsonb);
  v_assignment_id uuid;
begin
  if jsonb_typeof(coalesce(p_certificate, 'null'::jsonb)) <> 'object'
    or v_certificate_type_id is null
    or jsonb_typeof(v_attachments) <> 'array'
    or jsonb_array_length(v_attachments) = 0
  then
    raise exception 'SAFETY_INVALID_RPC_PAYLOAD: certificate type and attachment are required' using errcode = '22023';
  end if;
  if nullif(p_certificate ->> 'issueDate', '') is not null
    and nullif(p_certificate ->> 'expiryDate', '') is not null
    and (p_certificate ->> 'expiryDate')::date < (p_certificate ->> 'issueDate')::date
  then
    raise exception 'SAFETY_INVALID_RPC_PAYLOAD: certificate expiry cannot precede issue date' using errcode = '22023';
  end if;

  select membership into v_membership
  from public.safety_worker_site_memberships membership
  where membership.id = p_membership_id
  for update;

  if v_membership.id is null or v_actor is null
    or not app_private.safety_workforce_can_manage(v_membership.project_id, v_membership.construction_site_id)
  then
    raise exception 'SAFETY_SCOPE_MISMATCH: actor cannot update worker certificate' using errcode = '42501';
  end if;

  perform certificate_type.id
  from public.safety_certificate_types certificate_type
  where certificate_type.id = v_certificate_type_id and certificate_type.is_active;
  if not found then
    raise exception 'SAFETY_INVALID_RPC_PAYLOAD: certificate type is inactive or missing' using errcode = '22023';
  end if;

  if v_certificate_id is not null then
    select certificate into v_existing
    from public.safety_worker_certificates certificate
    where certificate.id = v_certificate_id
    for update;
    if v_existing.id is null or v_existing.worker_id <> v_membership.worker_id then
      raise exception 'SAFETY_SCOPE_MISMATCH: certificate is outside worker profile' using errcode = '42501';
    end if;
    update public.safety_worker_certificates certificate
    set certificate_type_id = v_certificate_type_id,
        certificate_no = nullif(trim(p_certificate ->> 'certificateNo'), ''),
        issue_date = nullif(p_certificate ->> 'issueDate', '')::date,
        expiry_date = nullif(p_certificate ->> 'expiryDate', '')::date,
        attachments = v_attachments,
        status = 'approved',
        verified_by = v_actor::text,
        verified_at = now(),
        note = nullif(trim(p_certificate ->> 'note'), ''),
        updated_at = now()
    where certificate.id = v_certificate_id;
  else
    insert into public.safety_worker_certificates (
      worker_id, certificate_type_id, certificate_no, issue_date, expiry_date,
      attachments, status, verified_by, verified_at, note, created_by
    ) values (
      v_membership.worker_id, v_certificate_type_id,
      nullif(trim(p_certificate ->> 'certificateNo'), ''),
      nullif(p_certificate ->> 'issueDate', '')::date,
      nullif(p_certificate ->> 'expiryDate', '')::date,
      v_attachments, 'approved', v_actor::text, now(),
      nullif(trim(p_certificate ->> 'note'), ''), v_actor::text
    ) returning id into v_certificate_id;
  end if;

  for v_assignment_id in
    select assignment.id from public.safety_project_assignments assignment
    where assignment.worker_id = v_membership.worker_id
  loop
    perform app_private.recompute_safety_assignment_eligibility(v_assignment_id);
  end loop;

  insert into public.safety_audit_logs (
    actor_user_id, action, target_type, target_id, project_id, construction_site_id, metadata
  ) values (
    v_actor::text, 'worker.certificate.upsert', 'safety_worker_certificates', v_certificate_id,
    v_membership.project_id, v_membership.construction_site_id::text,
    jsonb_build_object('membershipId', v_membership.id, 'workerId', v_membership.worker_id, 'certificateTypeId', v_certificate_type_id)
  );

  return app_private.safety_workforce_detail_for_membership(v_membership.id);
end;
$$;

create or replace function public.upsert_safety_worker_certificate_for_site(
  p_membership_id uuid,
  p_certificate jsonb
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.upsert_safety_worker_certificate_for_site(p_membership_id, p_certificate);
$$;

revoke all on function app_private.upsert_safety_worker_certificate_for_site(uuid, jsonb) from public, anon;
grant execute on function app_private.upsert_safety_worker_certificate_for_site(uuid, jsonb) to authenticated;
revoke all on function public.upsert_safety_worker_certificate_for_site(uuid, jsonb) from public, anon;
grant execute on function public.upsert_safety_worker_certificate_for_site(uuid, jsonb) to authenticated;

commit;
