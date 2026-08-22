begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function app_private.safety_workforce_mask_identity(p_worker_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when worker.identity_number_normalized is null then '-'
    when length(worker.identity_number_normalized) <= 4 then repeat('*', length(worker.identity_number_normalized))
    else repeat('*', length(worker.identity_number_normalized) - 4) || right(worker.identity_number_normalized, 4)
  end
  from public.safety_worker_profiles worker
  where worker.id = p_worker_id;
$$;

create or replace function app_private.safety_workforce_profile_readiness(p_worker_id uuid)
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
      or jsonb_array_length(coalesce(worker.identity_attachments, '[]'::jsonb)) = 0
    then 'missing'
    else 'valid'
  end
  from public.safety_worker_profiles worker
  where worker.id = p_worker_id;
$$;

create or replace function app_private.safety_workforce_document_readiness(
  p_worker_id uuid,
  p_document_type text
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when document.status = 'rejected' then 'rejected'
      when document.status in ('missing', 'expired') then document.status
      when document.expiry_date is not null and document.expiry_date < current_date then 'expired'
      when jsonb_array_length(coalesce(document.attachments, '[]'::jsonb)) = 0 then 'missing'
      else 'valid'
    end
    from public.safety_worker_documents document
    where document.worker_id = p_worker_id
      and document.document_type = p_document_type
    order by document.expiry_date desc nulls last, document.created_at desc, document.id desc
    limit 1
  ), 'missing');
$$;

create or replace function app_private.safety_workforce_assignment_json(
  p_assignment public.safety_project_assignments
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'id', (p_assignment).id,
    'workerId', (p_assignment).worker_id,
    'membershipId', (p_assignment).membership_id,
    'projectId', (p_assignment).project_id,
    'constructionSiteId', (p_assignment).construction_site_id,
    'contractorId', (p_assignment).contractor_id,
    'subcontractorId', (p_assignment).subcontractor_id,
    'teamId', (p_assignment).team_id,
    'teamName', (p_assignment).team_name,
    'roleName', (p_assignment).role_name,
    'workType', (p_assignment).work_type,
    'siteAccessCardCode', (p_assignment).site_access_card_code,
    'startDate', (p_assignment).start_date,
    'endDate', (p_assignment).end_date,
    'assignmentStatus', (p_assignment).assignment_status,
    'startedAt', (p_assignment).started_at,
    'endedAt', (p_assignment).ended_at,
    'endedBy', (p_assignment).ended_by,
    'endedReason', (p_assignment).ended_reason,
    'source', (p_assignment).source,
    'siteTrainingStatus', (p_assignment).site_training_status,
    'commitmentStatus', (p_assignment).commitment_status,
    'ppeStatus', (p_assignment).ppe_status,
    'toolboxStatus', (p_assignment).toolbox_status,
    'isLocked', (p_assignment).is_locked,
    'lockReason', (p_assignment).lock_reason,
    'eligibilityStatus', (p_assignment).eligibility_status,
    'eligibilityCheckedAt', (p_assignment).eligibility_checked_at,
    'createdBy', (p_assignment).created_by,
    'createdAt', (p_assignment).created_at,
    'updatedAt', (p_assignment).updated_at
  );
$$;

create or replace function app_private.safety_workforce_card_json(p_card public.safety_cards)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'id', (p_card).id,
    'assignmentId', (p_card).assignment_id,
    'workerId', (p_card).worker_id,
    'projectId', (p_card).project_id,
    'constructionSiteId', (p_card).construction_site_id,
    'contractorId', (p_card).contractor_id,
    'templateId', (p_card).template_id,
    'cardCode', (p_card).card_code,
    'qrToken', (p_card).qr_token,
    'issuedAt', (p_card).issued_at,
    'expiresAt', (p_card).expires_at,
    'status', (p_card).status,
    'printedCount', (p_card).printed_count,
    'revokedReason', (p_card).revoked_reason,
    'createdBy', (p_card).created_by,
    'createdAt', (p_card).created_at,
    'updatedAt', (p_card).updated_at
  );
$$;

create or replace function app_private.safety_workforce_capabilities(
  p_project_id text,
  p_construction_site_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'canViewBasic', app_private.safety_workforce_can_view(p_project_id, p_construction_site_id),
    'canManageWorker', app_private.safety_workforce_can_manage(p_project_id, p_construction_site_id),
    'canVerifyDocuments', app_private.safety_workforce_can_view_sensitive(p_project_id, p_construction_site_id)
  );
$$;

create or replace function app_private.get_safety_passport_dashboard(
  p_project_id text,
  p_construction_site_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform app_private.safety_workforce_assert_scope(p_project_id, p_construction_site_id);
  if not app_private.safety_workforce_can_view(p_project_id, p_construction_site_id) then
    raise exception 'SAFETY_SCOPE_MISMATCH: actor cannot view target site'
      using errcode = '42501';
  end if;

  with scoped_memberships as materialized (
    select membership.id, membership.worker_id
    from public.safety_worker_site_memberships membership
    where membership.project_id = p_project_id
      and membership.construction_site_id = p_construction_site_id
  ),
  active_assignments as materialized (
    select assignment.id,
           assignment.worker_id,
           assignment.subcontractor_id,
           assignment.eligibility_status
    from public.safety_project_assignments assignment
    join scoped_memberships membership on membership.id = assignment.membership_id
    where assignment.assignment_status = 'active'
  ),
  certificate_metrics as (
    select
      count(*) filter (
        where certificate.expiry_date between current_date and current_date + 7
          and certificate.status not in ('rejected', 'revoked')
      ) as expiring_7,
      count(*) filter (
        where certificate.expiry_date between current_date and current_date + 30
          and certificate.status not in ('rejected', 'revoked')
      ) as expiring_30,
      count(*) filter (
        where certificate.expiry_date < current_date
          and certificate.status not in ('rejected', 'revoked')
      ) as expired
    from public.safety_worker_certificates certificate
    join scoped_memberships membership on membership.worker_id = certificate.worker_id
  ),
  card_metrics as (
    select count(*) filter (
      where card.status = 'active'
        and card.expires_at between current_date and current_date + 30
    ) as expiring_30
    from public.safety_cards card
    join active_assignments assignment on assignment.id = card.assignment_id
  ),
  problematic_subcontractors as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', issue.id,
      'name', issue.name,
      'issueCount', issue.issue_count
    ) order by issue.issue_count desc, issue.name), '[]'::jsonb) as items
    from (
      select subcontractor.id,
             subcontractor.name,
             count(*)::integer as issue_count
      from active_assignments assignment
      join public.safety_subcontractors subcontractor on subcontractor.id = assignment.subcontractor_id
      where assignment.eligibility_status <> 'eligible'
      group by subcontractor.id, subcontractor.name
      order by count(*) desc, subcontractor.name
      limit 10
    ) issue
  )
  select jsonb_build_object(
    'totalWorkers', (select count(*) from scoped_memberships),
    'activeAssignments', (select count(*) from active_assignments),
    'eligibleAssignments', (select count(*) from active_assignments where eligibility_status = 'eligible'),
    'missingProfile', (select count(*) from active_assignments where eligibility_status = 'missing_profile'),
    'missingCertificate', (select count(*) from active_assignments where eligibility_status = 'missing_certificate'),
    'expiredCertificate', (select count(*) from active_assignments where eligibility_status = 'expired_certificate'),
    'missingSiteRequirement', (select count(*) from active_assignments where eligibility_status = 'missing_site_requirement'),
    'suspendedAssignments', (select count(*) from active_assignments where eligibility_status = 'suspended'),
    'expiringCertificates7Days', coalesce(certificate_metrics.expiring_7, 0),
    'expiringCertificates30Days', coalesce(certificate_metrics.expiring_30, 0),
    'expiredCertificates', coalesce(certificate_metrics.expired, 0),
    'expiringCards30Days', coalesce(card_metrics.expiring_30, 0),
    'problematicSubcontractors', problematic_subcontractors.items
  )
  into v_result
  from certificate_metrics
  cross join card_metrics
  cross join problematic_subcontractors;

  return v_result;
end;
$$;

create or replace function app_private.list_safety_site_worker_roster(
  p_project_id text,
  p_construction_site_id uuid,
  p_search text default null,
  p_membership_status text default null,
  p_assignment_status text default null,
  p_eligibility_status text default null,
  p_document_status text default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_result jsonb;
begin
  perform app_private.safety_workforce_assert_scope(p_project_id, p_construction_site_id);
  if not app_private.safety_workforce_can_view(p_project_id, p_construction_site_id) then
    raise exception 'SAFETY_SCOPE_MISMATCH: actor cannot view target site'
      using errcode = '42501';
  end if;

  if p_membership_status is not null and p_membership_status not in ('candidate', 'active', 'inactive') then
    raise exception 'SAFETY_INVALID_RPC_PAYLOAD: invalid membership status' using errcode = '22023';
  end if;
  if p_assignment_status is not null and p_assignment_status not in ('active', 'ended', 'suspended', 'cancelled') then
    raise exception 'SAFETY_INVALID_RPC_PAYLOAD: invalid assignment status' using errcode = '22023';
  end if;
  if p_eligibility_status is not null and p_eligibility_status not in ('eligible', 'missing_profile', 'missing_certificate', 'expired_certificate', 'missing_site_requirement', 'suspended') then
    raise exception 'SAFETY_INVALID_RPC_PAYLOAD: invalid eligibility status' using errcode = '22023';
  end if;
  if p_document_status is not null and p_document_status not in ('missing', 'expired') then
    raise exception 'SAFETY_INVALID_RPC_PAYLOAD: invalid document status' using errcode = '22023';
  end if;
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then
    raise exception 'SAFETY_INVALID_RPC_PAYLOAD: cursor timestamp and id are both required' using errcode = '22023';
  end if;

  with filtered as materialized (
    select membership.id as membership_id,
           membership.created_at as membership_created_at,
           jsonb_build_object(
             'id', membership.id,
             'workerId', membership.worker_id,
             'projectId', membership.project_id,
             'constructionSiteId', membership.construction_site_id,
             'defaultSubcontractorId', membership.default_subcontractor_id,
             'defaultTeamId', membership.default_team_id,
             'status', membership.status,
             'firstJoinedAt', membership.first_joined_at,
             'lastLeftAt', membership.last_left_at,
             'source', membership.source
           ) as membership_json,
           jsonb_build_object(
             'id', worker.id,
             'workerCode', worker.worker_code,
             'fullName', worker.full_name,
             'workerKind', worker.worker_kind,
             'phone', worker.phone,
             'status', worker.status,
             'photoStoragePath', coalesce(
               worker.photo_attachment ->> 'storagePath',
               worker.photo_attachment ->> 'storage_path',
               case
                 when coalesce(worker.photo_attachment ->> 'url', '') !~* '^https?://' then worker.photo_attachment ->> 'url'
                 else null
               end
             )
           ) as worker_json,
           case when subcontractor.id is null then null else jsonb_build_object(
             'id', subcontractor.id,
             'name', subcontractor.name,
             'code', subcontractor.code,
             'status', subcontractor.status
           ) end as subcontractor_json,
           case when team.id is null then null else jsonb_build_object(
             'id', team.id,
             'name', team.name,
             'code', team.code,
             'status', team.status
           ) end as team_json,
           case when (active_assignment.value).id is null then null
             else app_private.safety_workforce_assignment_json(active_assignment.value)
           end as assignment_json,
           case when (active_card.value).id is null then null
             else app_private.safety_workforce_card_json(active_card.value)
           end as card_json,
           coalesce(app_private.safety_workforce_mask_identity(worker.id), '-') as masked_identity,
           coalesce(app_private.safety_workforce_profile_readiness(worker.id), 'missing') as profile_readiness,
           app_private.safety_workforce_document_readiness(worker.id, 'health_check') as health_readiness,
           app_private.safety_workforce_document_readiness(worker.id, 'insurance') as insurance_readiness
    from public.safety_worker_site_memberships membership
    join public.safety_worker_profiles worker on worker.id = membership.worker_id
    left join public.safety_subcontractors subcontractor on subcontractor.id = membership.default_subcontractor_id
    left join public.safety_teams team on team.id = membership.default_team_id
    left join lateral (
      select assignment_row as value
      from public.safety_project_assignments assignment_row
      where assignment_row.membership_id = membership.id
        and assignment_row.assignment_status = 'active'
      order by assignment_row.started_at desc, assignment_row.id desc
      limit 1
    ) active_assignment on true
    left join lateral (
      select card_row as value
      from public.safety_cards card_row
      where card_row.assignment_id = (active_assignment.value).id
        and card_row.status = 'active'
      order by card_row.issued_at desc, card_row.id desc
      limit 1
    ) active_card on true
    where membership.project_id = p_project_id
      and membership.construction_site_id = p_construction_site_id
      and (p_membership_status is null or membership.status = p_membership_status)
      and (
        p_assignment_status is null
        or exists (
          select 1
          from public.safety_project_assignments assignment_filter
          where assignment_filter.membership_id = membership.id
            and assignment_filter.assignment_status = p_assignment_status
        )
      )
      and (p_eligibility_status is null or (active_assignment.value).eligibility_status = p_eligibility_status)
      and (
        p_document_status is null
        or app_private.safety_workforce_document_readiness(worker.id, 'health_check') = p_document_status
        or app_private.safety_workforce_document_readiness(worker.id, 'insurance') = p_document_status
      )
      and (
        nullif(trim(p_search), '') is null
        or worker.worker_code ilike '%' || trim(p_search) || '%'
        or worker.full_name ilike '%' || trim(p_search) || '%'
        or worker.phone ilike '%' || trim(p_search) || '%'
      )
      and (
        p_cursor_created_at is null
        or p_cursor_id is null
        or (membership.created_at, membership.id) < (p_cursor_created_at, p_cursor_id)
      )
    order by membership.created_at desc, membership.id desc
    limit v_limit + 1
  ),
  page as materialized (
    select filtered.membership_id,
           filtered.membership_created_at,
           filtered.membership_json,
           filtered.worker_json,
           filtered.subcontractor_json,
           filtered.team_json,
           filtered.assignment_json,
           filtered.card_json,
           filtered.masked_identity,
           filtered.profile_readiness,
           filtered.health_readiness,
           filtered.insurance_readiness
    from filtered
    order by filtered.membership_created_at desc, filtered.membership_id desc
    limit v_limit
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'membership', page.membership_json,
        'worker', page.worker_json,
        'subcontractor', page.subcontractor_json,
        'team', page.team_json,
        'activeAssignment', page.assignment_json,
        'activeCard', page.card_json,
        'identityNumberMasked', page.masked_identity,
        'profileStatus', page.profile_readiness,
        'healthStatus', page.health_readiness,
        'insuranceStatus', page.insurance_readiness
      ) order by page.membership_created_at desc, page.membership_id desc)
      from page
    ), '[]'::jsonb),
    'nextCursor', case when (select count(*) from filtered) > v_limit then (
      select jsonb_build_object(
        'createdAt', page.membership_created_at,
        'id', page.membership_id
      )
      from page
      order by page.membership_created_at, page.membership_id
      limit 1
    ) else null end,
    'capabilities', app_private.safety_workforce_capabilities(p_project_id, p_construction_site_id)
  )
  into v_result;

  return v_result;
end;
$$;

create or replace function app_private.get_safety_site_worker_detail(
  p_project_id text,
  p_construction_site_id uuid,
  p_membership_id uuid,
  p_include_sensitive boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_membership public.safety_worker_site_memberships%rowtype;
  v_worker public.safety_worker_profiles%rowtype;
  v_result jsonb;
begin
  perform app_private.safety_workforce_assert_scope(p_project_id, p_construction_site_id);
  if not app_private.safety_workforce_can_view(p_project_id, p_construction_site_id) then
    raise exception 'SAFETY_SCOPE_MISMATCH: actor cannot view target site'
      using errcode = '42501';
  end if;
  if p_include_sensitive and not app_private.safety_workforce_can_view_sensitive(p_project_id, p_construction_site_id) then
    raise exception 'SAFETY_SCOPE_MISMATCH: actor cannot view sensitive worker detail'
      using errcode = '42501';
  end if;

  select membership
  into v_membership
  from public.safety_worker_site_memberships membership
  where membership.id = p_membership_id
    and membership.project_id = p_project_id
    and membership.construction_site_id = p_construction_site_id;

  if not found then
    raise exception 'SAFETY_SCOPE_MISMATCH: membership is outside target site'
      using errcode = '42501';
  end if;

  select worker
  into v_worker
  from public.safety_worker_profiles worker
  where worker.id = v_membership.worker_id;

  with active_assignment as materialized (
    select assignment as value
    from public.safety_project_assignments assignment
    where assignment.membership_id = v_membership.id
      and assignment.assignment_status = 'active'
    order by assignment.started_at desc, assignment.id desc
    limit 1
  ),
  active_card as materialized (
    select card as value
    from public.safety_cards card
    join active_assignment active_assignment_row
      on (active_assignment_row.value).id = card.assignment_id
    where card.status = 'active'
    order by card.issued_at desc, card.id desc
    limit 1
  )
  select jsonb_build_object(
    'rosterItem', jsonb_build_object(
      'membership', jsonb_build_object(
        'id', v_membership.id,
        'workerId', v_membership.worker_id,
        'projectId', v_membership.project_id,
        'constructionSiteId', v_membership.construction_site_id,
        'defaultSubcontractorId', v_membership.default_subcontractor_id,
        'defaultTeamId', v_membership.default_team_id,
        'status', v_membership.status,
        'firstJoinedAt', v_membership.first_joined_at,
        'lastLeftAt', v_membership.last_left_at,
        'source', v_membership.source
      ),
      'worker', jsonb_build_object(
        'id', v_worker.id,
        'workerCode', v_worker.worker_code,
        'fullName', v_worker.full_name,
        'workerKind', v_worker.worker_kind,
        'phone', v_worker.phone,
        'status', v_worker.status,
        'photoStoragePath', coalesce(
          v_worker.photo_attachment ->> 'storagePath',
          v_worker.photo_attachment ->> 'storage_path',
          case
            when coalesce(v_worker.photo_attachment ->> 'url', '') !~* '^https?://' then v_worker.photo_attachment ->> 'url'
            else null
          end
        )
      ),
      'subcontractor', case when subcontractor.id is null then null else jsonb_build_object(
        'id', subcontractor.id,
        'name', subcontractor.name,
        'code', subcontractor.code,
        'status', subcontractor.status
      ) end,
      'team', case when team.id is null then null else jsonb_build_object(
        'id', team.id,
        'name', team.name,
        'code', team.code,
        'status', team.status
      ) end,
      'activeAssignment', case when (active_assignment_row.value).id is null then null
        else app_private.safety_workforce_assignment_json(active_assignment_row.value)
      end,
      'activeCard', case when (active_card_row.value).id is null then null
        else app_private.safety_workforce_card_json(active_card_row.value)
      end,
      'identityNumberMasked', coalesce(app_private.safety_workforce_mask_identity(v_worker.id), '-'),
      'profileStatus', coalesce(app_private.safety_workforce_profile_readiness(v_worker.id), 'missing'),
      'healthStatus', app_private.safety_workforce_document_readiness(v_worker.id, 'health_check'),
      'insuranceStatus', app_private.safety_workforce_document_readiness(v_worker.id, 'insurance')
    ),
    'profile', jsonb_build_object(
      'id', v_worker.id,
      'workerCode', v_worker.worker_code,
      'fullName', v_worker.full_name,
      'workerKind', v_worker.worker_kind,
      'phone', v_worker.phone,
      'dateOfBirth', v_worker.date_of_birth,
      'roleName', v_worker.role_name,
      'status', v_worker.status,
      'photoAttachment', v_worker.photo_attachment
    ) || case when p_include_sensitive then jsonb_build_object(
      'identityType', v_worker.identity_type,
      'identityNumber', v_worker.identity_number,
      'identityIssueDate', v_worker.identity_issue_date,
      'identityIssuePlace', v_worker.identity_issue_place,
      'permanentAddress', v_worker.permanent_address
    ) else '{}'::jsonb end,
    'documents', case when p_include_sensitive then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', document.id,
        'workerId', document.worker_id,
        'documentType', document.document_type,
        'name', document.name,
        'issueDate', document.issue_date,
        'expiryDate', document.expiry_date,
        'attachments', document.attachments,
        'status', document.status,
        'isRequired', document.is_required,
        'note', document.note,
        'createdBy', document.created_by,
        'createdAt', document.created_at,
        'updatedAt', document.updated_at
      ) order by document.document_type, document.created_at desc)
      from public.safety_worker_documents document
      where document.worker_id = v_worker.id
    ), '[]'::jsonb) else '[]'::jsonb end,
    'certificates', case when p_include_sensitive then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', certificate.id,
        'workerId', certificate.worker_id,
        'certificateTypeId', certificate.certificate_type_id,
        'certificateNo', certificate.certificate_no,
        'issueDate', certificate.issue_date,
        'expiryDate', certificate.expiry_date,
        'attachments', certificate.attachments,
        'status', certificate.status,
        'computedStatus', case
          when certificate.status = 'rejected' then 'rejected'
          when certificate.status = 'revoked' then 'revoked'
          when certificate.expiry_date < current_date then 'expired'
          when certificate.expiry_date <= current_date + 30 then 'expiring_soon'
          else 'valid'
        end,
        'verifiedBy', certificate.verified_by,
        'verifiedAt', certificate.verified_at,
        'note', certificate.note,
        'createdBy', certificate.created_by,
        'createdAt', certificate.created_at,
        'updatedAt', certificate.updated_at
      ) order by certificate.expiry_date desc nulls last, certificate.created_at desc)
      from public.safety_worker_certificates certificate
      where certificate.worker_id = v_worker.id
    ), '[]'::jsonb) else '[]'::jsonb end,
    'assignments', coalesce((
      select jsonb_agg(app_private.safety_workforce_assignment_json(assignment_history)
        order by assignment_history.started_at desc, assignment_history.id desc)
      from public.safety_project_assignments assignment_history
      where assignment_history.membership_id = v_membership.id
    ), '[]'::jsonb),
    'cards', coalesce((
      select jsonb_agg(app_private.safety_workforce_card_json(card_history)
        order by card_history.issued_at desc, card_history.id desc)
      from public.safety_cards card_history
      join public.safety_project_assignments assignment_history
        on assignment_history.id = card_history.assignment_id
      where assignment_history.membership_id = v_membership.id
    ), '[]'::jsonb),
    'capabilities', app_private.safety_workforce_capabilities(p_project_id, p_construction_site_id),
    'sensitiveLoaded', p_include_sensitive
  )
  into v_result
  from (select 1) anchor
  left join public.safety_subcontractors subcontractor on subcontractor.id = v_membership.default_subcontractor_id
  left join public.safety_teams team on team.id = v_membership.default_team_id
  left join active_assignment active_assignment_row on true
  left join active_card active_card_row on true;

  return v_result;
end;
$$;

create or replace function app_private.lookup_safety_worker_exact(
  p_project_id text,
  p_construction_site_id uuid,
  p_worker_code text default null,
  p_identity_type text default null,
  p_identity_number text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_worker public.safety_worker_profiles%rowtype;
  v_membership public.safety_worker_site_memberships%rowtype;
  v_assignment public.safety_project_assignments%rowtype;
  v_active_site_name text;
  v_match_type text;
  v_result jsonb;
begin
  perform app_private.safety_workforce_assert_scope(p_project_id, p_construction_site_id);
  if not app_private.safety_workforce_can_manage(p_project_id, p_construction_site_id) then
    raise exception 'SAFETY_SCOPE_MISMATCH: actor cannot search global worker profiles'
      using errcode = '42501';
  end if;

  if nullif(trim(p_worker_code), '') is not null then
    v_match_type := 'worker_code';
    select worker
    into v_worker
    from public.safety_worker_profiles worker
    where lower(worker.worker_code) = lower(trim(p_worker_code))
    limit 1;
  elsif p_identity_type in ('cccd', 'passport', 'other')
    and app_private.safety_workforce_normalize_identity(p_identity_number) is not null
  then
    v_match_type := 'identity';
    select worker
    into v_worker
    from public.safety_worker_profiles worker
    where worker.identity_type = p_identity_type
      and worker.identity_number_normalized = app_private.safety_workforce_normalize_identity(p_identity_number)
    limit 1;
  else
    raise exception 'SAFETY_INVALID_RPC_PAYLOAD: exact worker code or identity is required'
      using errcode = '22023';
  end if;

  if v_worker.id is null then
    insert into public.safety_audit_logs (
      actor_user_id, action, target_type, project_id, construction_site_id, metadata
    ) values (
      public.current_app_user_id()::text,
      'worker.exact_lookup',
      'safety_worker_profiles',
      p_project_id,
      p_construction_site_id::text,
      jsonb_build_object('matchType', v_match_type, 'found', false)
    );
    return null;
  end if;

  select membership
  into v_membership
  from public.safety_worker_site_memberships membership
  where membership.worker_id = v_worker.id
    and membership.project_id = p_project_id
    and membership.construction_site_id = p_construction_site_id
  limit 1;

  select assignment
  into v_assignment
  from public.safety_project_assignments assignment
  where assignment.worker_id = v_worker.id
    and assignment.assignment_status = 'active'
  order by assignment.started_at desc, assignment.id desc
  limit 1;

  if v_assignment.id is not null then
    select site.name
    into v_active_site_name
    from public.safety_worker_site_memberships active_membership
    join public.hrm_construction_sites site on site.id = active_membership.construction_site_id
    where active_membership.id = v_assignment.membership_id;
  end if;

  v_result := jsonb_build_object(
    'workerId', v_worker.id,
    'workerCode', v_worker.worker_code,
    'fullName', v_worker.full_name,
    'identityNumberMasked', coalesce(app_private.safety_workforce_mask_identity(v_worker.id), '-'),
    'targetMembershipId', v_membership.id,
    'activeAssignmentId', v_assignment.id,
    'activeSiteName', v_active_site_name,
    'canTransfer', case
      when v_assignment.id is null then false
      when v_assignment.membership_id = v_membership.id then false
      else exists (
        select 1
        from public.safety_worker_site_memberships active_membership
        where active_membership.id = v_assignment.membership_id
          and app_private.safety_workforce_can_manage(
            active_membership.project_id,
            active_membership.construction_site_id
          )
      )
    end
  );

  insert into public.safety_audit_logs (
    actor_user_id, action, target_type, target_id, project_id, construction_site_id, metadata
  ) values (
    public.current_app_user_id()::text,
    'worker.exact_lookup',
    'safety_worker_profiles',
    v_worker.id,
    p_project_id,
    p_construction_site_id::text,
    jsonb_build_object('matchType', v_match_type, 'found', true)
  );

  return v_result;
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
    raise exception 'SAFETY_SCOPE_MISMATCH: actor cannot view target site'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'subcontractors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', subcontractor.id,
        'name', subcontractor.name,
        'code', subcontractor.code,
        'status', subcontractor.status
      ) order by subcontractor.name, subcontractor.id)
      from public.safety_subcontractors subcontractor
      where subcontractor.project_id = p_project_id
        and subcontractor.construction_site_id = p_construction_site_id::text
        and subcontractor.status in ('approved', 'active')
    ), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', team.id,
        'name', team.name,
        'code', team.code,
        'status', team.status,
        'subcontractorId', team.subcontractor_id
      ) order by team.name, team.id)
      from public.safety_teams team
      where team.project_id = p_project_id
        and team.construction_site_id = p_construction_site_id::text
        and team.status = 'active'
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function app_private.get_safety_card_by_qr(p_qr_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if public.current_app_user_id() is null or nullif(trim(p_qr_token), '') is null then
    return null;
  end if;

  select app_private.safety_workforce_card_json(card)
    || jsonb_build_object(
      'worker', jsonb_build_object(
        'id', worker.id,
        'workerCode', worker.worker_code,
        'fullName', worker.full_name,
        'workerKind', worker.worker_kind,
        'phone', worker.phone,
        'status', worker.status,
        'photoAttachment', worker.photo_attachment
      ),
      'assignment', app_private.safety_workforce_assignment_json(assignment),
      'contractor', case when subcontractor.id is null then null else jsonb_build_object(
        'id', subcontractor.id,
        'name', subcontractor.name,
        'code', subcontractor.code,
        'status', subcontractor.status
      ) end
    )
  into v_result
  from public.safety_cards card
  join public.safety_project_assignments assignment on assignment.id = card.assignment_id
  join public.safety_worker_site_memberships membership on membership.id = assignment.membership_id
  join public.safety_worker_profiles worker on worker.id = membership.worker_id
  left join public.safety_subcontractors subcontractor on subcontractor.id = assignment.subcontractor_id
  where card.qr_token = trim(p_qr_token)
    and app_private.safety_workforce_can_view(membership.project_id, membership.construction_site_id)
  limit 1;

  return v_result;
end;
$$;

create or replace function public.get_safety_passport_dashboard(
  p_project_id text,
  p_construction_site_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.get_safety_passport_dashboard(p_project_id, p_construction_site_id);
$$;

create or replace function public.list_safety_site_worker_roster(
  p_project_id text,
  p_construction_site_id uuid,
  p_search text default null,
  p_membership_status text default null,
  p_assignment_status text default null,
  p_eligibility_status text default null,
  p_document_status text default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.list_safety_site_worker_roster(
    p_project_id,
    p_construction_site_id,
    p_search,
    p_membership_status,
    p_assignment_status,
    p_eligibility_status,
    p_document_status,
    p_cursor_created_at,
    p_cursor_id,
    p_limit
  );
$$;

create or replace function public.get_safety_site_worker_detail(
  p_project_id text,
  p_construction_site_id uuid,
  p_membership_id uuid,
  p_include_sensitive boolean default false
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.get_safety_site_worker_detail(
    p_project_id,
    p_construction_site_id,
    p_membership_id,
    p_include_sensitive
  );
$$;

create or replace function public.lookup_safety_worker_exact(
  p_project_id text,
  p_construction_site_id uuid,
  p_worker_code text default null,
  p_identity_type text default null,
  p_identity_number text default null
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.lookup_safety_worker_exact(
    p_project_id,
    p_construction_site_id,
    p_worker_code,
    p_identity_type,
    p_identity_number
  );
$$;

create or replace function public.list_safety_site_workforce_options(
  p_project_id text,
  p_construction_site_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.list_safety_site_workforce_options(p_project_id, p_construction_site_id);
$$;

create or replace function public.get_safety_card_by_qr(p_qr_token text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.get_safety_card_by_qr(p_qr_token);
$$;

revoke all on function app_private.safety_workforce_mask_identity(uuid) from public, anon;
revoke all on function app_private.safety_workforce_profile_readiness(uuid) from public, anon;
revoke all on function app_private.safety_workforce_document_readiness(uuid, text) from public, anon;
revoke all on function app_private.safety_workforce_assignment_json(public.safety_project_assignments) from public, anon;
revoke all on function app_private.safety_workforce_card_json(public.safety_cards) from public, anon;
revoke all on function app_private.safety_workforce_capabilities(text, uuid) from public, anon;
revoke all on function app_private.get_safety_passport_dashboard(text, uuid) from public, anon;
revoke all on function app_private.list_safety_site_worker_roster(text, uuid, text, text, text, text, text, timestamptz, uuid, integer) from public, anon;
revoke all on function app_private.get_safety_site_worker_detail(text, uuid, uuid, boolean) from public, anon;
revoke all on function app_private.lookup_safety_worker_exact(text, uuid, text, text, text) from public, anon;
revoke all on function app_private.list_safety_site_workforce_options(text, uuid) from public, anon;
revoke all on function app_private.get_safety_card_by_qr(text) from public, anon;

grant execute on function app_private.safety_workforce_mask_identity(uuid) to authenticated;
grant execute on function app_private.safety_workforce_profile_readiness(uuid) to authenticated;
grant execute on function app_private.safety_workforce_document_readiness(uuid, text) to authenticated;
grant execute on function app_private.safety_workforce_assignment_json(public.safety_project_assignments) to authenticated;
grant execute on function app_private.safety_workforce_card_json(public.safety_cards) to authenticated;
grant execute on function app_private.safety_workforce_capabilities(text, uuid) to authenticated;
grant execute on function app_private.get_safety_passport_dashboard(text, uuid) to authenticated;
grant execute on function app_private.list_safety_site_worker_roster(text, uuid, text, text, text, text, text, timestamptz, uuid, integer) to authenticated;
grant execute on function app_private.get_safety_site_worker_detail(text, uuid, uuid, boolean) to authenticated;
grant execute on function app_private.lookup_safety_worker_exact(text, uuid, text, text, text) to authenticated;
grant execute on function app_private.list_safety_site_workforce_options(text, uuid) to authenticated;
grant execute on function app_private.get_safety_card_by_qr(text) to authenticated;

revoke all on function public.get_safety_passport_dashboard(text, uuid) from public, anon;
revoke all on function public.list_safety_site_worker_roster(text, uuid, text, text, text, text, text, timestamptz, uuid, integer) from public, anon;
revoke all on function public.get_safety_site_worker_detail(text, uuid, uuid, boolean) from public, anon;
revoke all on function public.lookup_safety_worker_exact(text, uuid, text, text, text) from public, anon;
revoke all on function public.list_safety_site_workforce_options(text, uuid) from public, anon;
revoke all on function public.get_safety_card_by_qr(text) from public, anon;

grant execute on function public.get_safety_passport_dashboard(text, uuid) to authenticated;
grant execute on function public.list_safety_site_worker_roster(text, uuid, text, text, text, text, text, timestamptz, uuid, integer) to authenticated;
grant execute on function public.get_safety_site_worker_detail(text, uuid, uuid, boolean) to authenticated;
grant execute on function public.lookup_safety_worker_exact(text, uuid, text, text, text) to authenticated;
grant execute on function public.list_safety_site_workforce_options(text, uuid) to authenticated;
grant execute on function public.get_safety_card_by_qr(text) to authenticated;

notify pgrst, 'reload schema';

commit;
