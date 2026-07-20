-- Safety Passport worker list/detail extensions.
-- Adds worker identity fields, project access fields, canonical documents,
-- and extends eligibility checks with health check + insurance documents.

alter table public.safety_worker_profiles
  add column if not exists date_of_birth date,
  add column if not exists identity_issue_place text,
  add column if not exists permanent_address text;

alter table public.safety_project_assignments
  add column if not exists site_access_card_code text,
  add column if not exists work_type text;

create unique index if not exists idx_safety_worker_documents_canonical_unique
  on public.safety_worker_documents(worker_id, document_type)
  where document_type in ('identity_front', 'identity_back', 'health_check', 'insurance', 'safety_card');

create index if not exists idx_safety_worker_documents_type_expiry
  on public.safety_worker_documents(document_type, expiry_date)
  where document_type in ('health_check', 'insurance', 'safety_card');

create index if not exists idx_safety_project_assignments_access_card
  on public.safety_project_assignments(site_access_card_code)
  where site_access_card_code is not null;

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
  from public.safety_project_assignments
  where id = p_assignment_id;

  if not found then
    return 'missing_profile';
  end if;

  select * into v_worker
  from public.safety_worker_profiles
  where id = v_assignment.worker_id;

  if not found then
    return 'missing_profile';
  end if;

  if v_worker.status = 'suspended' or v_assignment.is_locked then
    return 'suspended';
  end if;

  if v_worker.status <> 'active'
    or nullif(trim(v_worker.full_name), '') is null
    or nullif(trim(v_worker.worker_code), '') is null
    or v_worker.photo_attachment = 'null'::jsonb
    or nullif(trim(coalesce(v_worker.identity_number, '')), '') is null
    or jsonb_array_length(coalesce(v_worker.identity_attachments, '[]'::jsonb)) = 0
  then
    return 'missing_profile';
  end if;

  with required_documents(document_type) as (
    values ('health_check'), ('insurance')
  ),
  document_state as (
    select rd.document_type,
           swd.id,
           swd.status,
           swd.expiry_date,
           swd.attachments
    from required_documents rd
    left join lateral (
      select d.*
      from public.safety_worker_documents d
      where d.worker_id = v_worker.id
        and d.document_type = rd.document_type
        and d.status <> 'rejected'
      order by d.expiry_date desc nulls last, d.created_at desc
      limit 1
    ) swd on true
  )
  select count(*)
    into v_required_document_missing_count
  from document_state
  where id is null
    or status in ('missing', 'expired', 'rejected')
    or jsonb_array_length(coalesce(attachments, '[]'::jsonb)) = 0
    or (expiry_date is not null and expiry_date < current_date);

  if v_required_document_missing_count > 0 then
    return 'missing_profile';
  end if;

  select count(*)
    into v_required_count
  from public.safety_certificate_types sct
  where sct.is_active
    and sct.is_required_default
    and app_private.safety_required_certificate_type_applies(sct.applies_to_roles, coalesce(v_assignment.role_name, v_worker.role_name));

  if v_required_count > 0 then
    select
      count(*) filter (where swc.id is null),
      count(*) filter (where swc.id is not null and coalesce(swc.status, 'submitted') <> 'rejected' and swc.expiry_date is not null and swc.expiry_date < current_date)
      into v_missing_count, v_expired_count
    from public.safety_certificate_types sct
    left join lateral (
      select c.*
      from public.safety_worker_certificates c
      where c.worker_id = v_worker.id
        and c.certificate_type_id = sct.id
        and c.status <> 'rejected'
      order by c.expiry_date desc nulls last, c.created_at desc
      limit 1
    ) swc on true
    where sct.is_active
      and sct.is_required_default
      and app_private.safety_required_certificate_type_applies(sct.applies_to_roles, coalesce(v_assignment.role_name, v_worker.role_name));

    if v_missing_count > 0 then
      return 'missing_certificate';
    end if;
    if v_expired_count > 0 then
      return 'expired_certificate';
    end if;
  end if;

  if v_assignment.site_training_status <> 'completed'
    or v_assignment.commitment_status <> 'signed'
    or v_assignment.ppe_status <> 'complete'
    or v_assignment.toolbox_status <> 'completed'
  then
    return 'missing_site_requirement';
  end if;

  return 'eligible';
end;
$$;

drop trigger if exists trg_safety_assignment_recompute on public.safety_project_assignments;
create trigger trg_safety_assignment_recompute
after insert or update of worker_id, role_name, work_type, site_training_status, commitment_status, ppe_status, toolbox_status, is_locked
on public.safety_project_assignments
for each row execute function app_private.touch_safety_assignment_eligibility();

drop trigger if exists trg_safety_worker_profile_recompute on public.safety_worker_profiles;
create trigger trg_safety_worker_profile_recompute
after update of full_name, worker_code, photo_attachment, identity_number, identity_attachments, date_of_birth, identity_issue_place, permanent_address, status, role_name
on public.safety_worker_profiles
for each row execute function app_private.touch_safety_worker_assignment_eligibility();

drop trigger if exists trg_safety_worker_document_recompute on public.safety_worker_documents;
create trigger trg_safety_worker_document_recompute
after insert or update or delete on public.safety_worker_documents
for each row execute function app_private.touch_safety_worker_assignment_eligibility();
