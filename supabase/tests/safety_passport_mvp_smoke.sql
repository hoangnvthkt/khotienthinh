do $$
declare
  v_contractor_id uuid;
  v_worker_id uuid;
  v_assignment_id uuid;
  v_type_id uuid;
  v_status text;
begin
  delete from public.safety_worker_profiles where worker_code = '__SMOKE_WORKER__';
  delete from public.safety_contractors where code = '__SMOKE_TEAM__';

  insert into public.safety_contractors (contractor_type, code, name)
  values ('team', '__SMOKE_TEAM__', '__Smoke Safety Team__')
  returning id into v_contractor_id;

  insert into public.safety_worker_profiles (
    worker_code,
    full_name,
    contractor_id,
    status,
    identity_type
  )
  values ('__SMOKE_WORKER__', '__Smoke Worker__', v_contractor_id, 'active', 'cccd')
  returning id into v_worker_id;

  insert into public.safety_project_assignments (
    worker_id,
    contractor_id,
    role_name,
    site_training_status,
    commitment_status,
    ppe_status,
    toolbox_status
  )
  values (
    v_worker_id,
    v_contractor_id,
    'Công nhân',
    'pending',
    'pending',
    'missing',
    'pending'
  )
  returning id into v_assignment_id;

  select eligibility_status into v_status
  from public.safety_project_assignments
  where id = v_assignment_id;
  if v_status <> 'missing_profile' then
    raise exception 'expected missing_profile, got %', v_status;
  end if;

  update public.safety_worker_profiles
  set photo_attachment = '{"name":"photo.jpg","url":"smoke/photo.jpg"}'::jsonb,
      identity_number = '001199900000',
      identity_attachments = '[{"name":"cccd.pdf","url":"smoke/cccd.pdf"}]'::jsonb
  where id = v_worker_id;

  select eligibility_status into v_status
  from public.safety_project_assignments
  where id = v_assignment_id;
  if v_status <> 'missing_profile' then
    raise exception 'expected missing_profile while health/insurance are missing, got %', v_status;
  end if;

  insert into public.safety_worker_documents (
    worker_id,
    document_type,
    name,
    expiry_date,
    attachments,
    status,
    is_required
  )
  values
    (
      v_worker_id,
      'health_check',
      '__SMOKE_HEALTH__',
      current_date + 365,
      '[{"name":"health.pdf","url":"smoke/health.pdf"}]'::jsonb,
      'submitted',
      true
    ),
    (
      v_worker_id,
      'insurance',
      '__SMOKE_INSURANCE__',
      current_date + 365,
      '[{"name":"insurance.pdf","url":"smoke/insurance.pdf"}]'::jsonb,
      'submitted',
      true
    );

  select eligibility_status into v_status
  from public.safety_project_assignments
  where id = v_assignment_id;
  if v_status <> 'missing_certificate' then
    raise exception 'expected missing_certificate, got %', v_status;
  end if;

  select id into v_type_id
  from public.safety_certificate_types
  where code = 'SAFETY_ORIENTATION';

  insert into public.safety_worker_certificates (
    worker_id,
    certificate_type_id,
    certificate_no,
    issue_date,
    expiry_date,
    status
  )
  values (
    v_worker_id,
    v_type_id,
    '__SMOKE_CERT__',
    current_date - 400,
    current_date - 1,
    'submitted'
  );

  select eligibility_status into v_status
  from public.safety_project_assignments
  where id = v_assignment_id;
  if v_status <> 'expired_certificate' then
    raise exception 'expected expired_certificate, got %', v_status;
  end if;

  update public.safety_worker_certificates
  set expiry_date = current_date + 365
  where worker_id = v_worker_id;

  update public.safety_project_assignments
  set site_training_status = 'completed',
      commitment_status = 'signed',
      ppe_status = 'complete',
      toolbox_status = 'completed'
  where id = v_assignment_id;

  select eligibility_status into v_status
  from public.safety_project_assignments
  where id = v_assignment_id;
  if v_status <> 'eligible' then
    raise exception 'expected eligible, got %', v_status;
  end if;

  delete from public.safety_contractors where id = v_contractor_id;
  delete from public.safety_worker_profiles where id = v_worker_id;
end $$;
