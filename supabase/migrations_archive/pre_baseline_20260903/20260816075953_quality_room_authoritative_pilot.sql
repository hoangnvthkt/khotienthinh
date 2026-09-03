-- Stage 2: make Quality runtime writes authoritative through scoped Room commands.
-- Unresolved review list: project.quality.create, project.quality.checklist_create,
-- project.quality.edit_own, project.quality.checklist_edit_own,
-- project.quality.delete_own. These permissions are never auto-backfilled.

update public.project_permission_rooms
set description = 'Quản lý hồ sơ, kiểm tra và phê duyệt chất lượng theo dự án/công trường.',
    allowed_actions = array['view', 'edit', 'delete', 'submit', 'verify', 'approve']::text[],
    required_actions = array['approve']::text[],
    updated_at = now()
where code = 'quality';

insert into app_private.project_permission_room_action_bindings (
  room_code, action_code, legacy_permission_codes, enforcement_status,
  relationship_description, verified_at, verified_source, updated_at,
  pbac_fallback_enabled, prerequisite_action_codes
)
values
  ('quality', 'view', array['project.quality.view']::text[], 'pilot',
    'Xem catalog và hồ sơ chất lượng trong đúng project/site.', now(),
    'quality_room_authoritative_pilot', now(), true, '{}'::text[]),
  ('quality', 'edit', array[
      'project.quality.edit_all', 'project.quality.checklist_edit_all',
      'project.quality.manage'
    ]::text[], 'pilot',
    'Tạo và sửa mọi hồ sơ draft/returned trong đúng project/site.', now(),
    'quality_room_authoritative_pilot', now(), true, array['view']::text[]),
  ('quality', 'delete', array[
      'project.quality.delete', 'project.quality.delete_all', 'project.quality.manage'
    ]::text[], 'pilot',
    'Xóa hồ sơ draft trong đúng project/site.', now(),
    'quality_room_authoritative_pilot', now(), true, array['view']::text[]),
  ('quality', 'submit', array[
      'project.quality.submit', 'project.quality.manage'
    ]::text[], 'pilot',
    'Gửi hồ sơ cho một approver hợp lệ trong đúng project/site.', now(),
    'quality_room_authoritative_pilot', now(), true, array['view', 'edit']::text[]),
  ('quality', 'verify', array[
      'project.quality.verify', 'project.quality.manage'
    ]::text[], 'pilot',
    'Dự phòng cho bước xác minh; chưa tham gia workflow hiện tại.', now(),
    'quality_room_authoritative_pilot', now(), true, array['view']::text[]),
  ('quality', 'approve', array[
      'project.quality.approve', 'project.quality.return', 'project.quality.manage'
    ]::text[], 'pilot',
    'Phê duyệt, trả lại hoặc hủy hồ sơ trong đúng project/site.', now(),
    'quality_room_authoritative_pilot', now(), true, array['view']::text[])
on conflict (room_code, action_code) do update
set legacy_permission_codes = excluded.legacy_permission_codes,
    enforcement_status = excluded.enforcement_status,
    relationship_description = excluded.relationship_description,
    verified_at = excluded.verified_at,
    verified_source = excluded.verified_source,
    updated_at = now(),
    pbac_fallback_enabled = true,
    prerequisite_action_codes = excluded.prerequisite_action_codes;

create temporary table quality_runtime_before_snapshot on commit drop as
select coalesce(jsonb_agg(jsonb_build_object(
  'member_id', member.id,
  'project_staff_id', member.project_staff_id,
  'project_id', member.project_id,
  'construction_site_id', member.construction_site_id,
  'action_code', action.action_code,
  'grant_source', action.grant_source,
  'is_active', action.is_active
) order by member.id, action.action_code), '[]'::jsonb) as grants
from public.project_permission_room_members member
left join public.project_permission_room_member_actions action
  on action.room_member_id = member.id
where member.room_code = 'quality';

create temporary table quality_runtime_pbac_candidates on commit drop as
with permission_mapping(permission_code, action_code) as (
  values
    ('project.quality.view', 'view'),
    ('project.quality.edit_all', 'edit'),
    ('project.quality.checklist_edit_all', 'edit'),
    ('project.quality.manage', 'edit'),
    ('project.quality.delete', 'delete'),
    ('project.quality.delete_all', 'delete'),
    ('project.quality.manage', 'delete'),
    ('project.quality.submit', 'submit'),
    ('project.quality.manage', 'submit'),
    ('project.quality.verify', 'verify'),
    ('project.quality.manage', 'verify'),
    ('project.quality.approve', 'approve'),
    ('project.quality.return', 'approve'),
    ('project.quality.manage', 'approve')
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
    and coalesce(user_row.is_active, true)
  join public.project_staff staff
    on staff.user_id = grant_row.user_id::text
    and staff.end_date is null
    and (
      (grant_row.scope_type = 'project' and grant_row.scope_id = staff.project_id
        and staff.construction_site_id is null)
      or (grant_row.scope_type = 'construction_site'
        and grant_row.scope_id = staff.construction_site_id)
    )
  where grant_row.is_active
    and (grant_row.expires_at is null or grant_row.expires_at > now())
    and grant_row.scope_type in ('project', 'construction_site')
)
select * from candidates;

create temporary table quality_runtime_backfill_candidates on commit drop as
with exact_candidates as (
  select distinct user_id, granted_by, project_staff_id, project_id,
    construction_site_id, action_code
  from quality_runtime_pbac_candidates
  where matching_staff_count = 1
), with_prerequisites as (
  select * from exact_candidates
  union
  select user_id, granted_by, project_staff_id, project_id,
    construction_site_id, 'view' as action_code
  from exact_candidates
  where action_code in ('edit', 'delete', 'submit', 'verify', 'approve')
)
select max(user_id::text)::uuid as user_id,
  max(granted_by::text)::uuid as granted_by,
  project_staff_id, project_id, construction_site_id, action_code
from with_prerequisites
group by project_staff_id, project_id, construction_site_id, action_code;

insert into public.project_permission_room_members (
  project_id, construction_site_id, room_code, project_staff_id,
  is_active, created_by, updated_at
)
select project_id, construction_site_id, 'quality', project_staff_id,
  true, max(granted_by::text)::uuid, now()
from quality_runtime_backfill_candidates
group by project_id, construction_site_id, project_staff_id
on conflict (project_id, (coalesce(construction_site_id, '')), room_code, project_staff_id)
do update set is_active = true, updated_at = now();

insert into public.project_permission_room_member_actions (
  room_member_id, action_code, is_active, granted_by, granted_at, updated_at, grant_source
)
select distinct member.id, candidate.action_code, true, candidate.granted_by,
  now(), now(), 'pbac_backfill'
from quality_runtime_backfill_candidates candidate
join public.project_permission_room_members member
  on member.project_id = candidate.project_id
  and member.construction_site_id is not distinct from candidate.construction_site_id
  and member.room_code = 'quality'
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
        then 'manual_room'
      else 'pbac_backfill'
    end,
    updated_at = now();

insert into public.permission_audit_events (
  actor_user_id, event_type, before_grants, after_grants, metadata
)
select null, 'quality_room_runtime_pbac_backfill', before_snapshot.grants,
  coalesce((select jsonb_agg(jsonb_build_object(
    'member_id', member.id,
    'project_staff_id', member.project_staff_id,
    'project_id', member.project_id,
    'construction_site_id', member.construction_site_id,
    'action_code', action.action_code,
    'grant_source', action.grant_source,
    'is_active', action.is_active
  ) order by member.id, action.action_code)
  from public.project_permission_room_members member
  join public.project_permission_room_member_actions action
    on action.room_member_id = member.id
  where member.room_code = 'quality'), '[]'::jsonb),
  jsonb_build_object(
    'source', 'quality_room_authoritative_pilot',
    'room_code', 'quality',
    'backfilled_action_count', (select count(*) from quality_runtime_backfill_candidates)
  )
from quality_runtime_before_snapshot before_snapshot;

-- Record ambiguous safe mappings and all owner/create permissions as unresolved.
insert into public.permission_audit_events (
  actor_user_id, event_type, before_grants, after_grants, metadata
)
select null, 'quality_room_runtime_unresolved',
  coalesce(jsonb_agg(item), '[]'::jsonb), '[]'::jsonb,
  jsonb_build_object('source', 'quality_room_authoritative_pilot', 'room_code', 'quality')
from (
  select distinct jsonb_build_object(
    'grant_id', candidate.grant_id,
    'user_id', candidate.user_id,
    'permission_code', grant_row.permission_code,
    'scope_type', grant_row.scope_type,
    'scope_id', grant_row.scope_id,
    'reason', 'ambiguous_scope',
    'matching_staff_count', candidate.matching_staff_count
  ) as item
  from quality_runtime_pbac_candidates candidate
  join public.user_permission_grants grant_row on grant_row.id = candidate.grant_id
  where candidate.matching_staff_count <> 1
  union all
  select jsonb_build_object(
    'grant_id', grant_row.id,
    'user_id', grant_row.user_id,
    'permission_code', grant_row.permission_code,
    'scope_type', grant_row.scope_type,
    'scope_id', grant_row.scope_id,
    'reason', 'requires_admin_review'
  )
  from public.user_permission_grants grant_row
  where grant_row.permission_code in (
      'project.quality.create', 'project.quality.checklist_create',
      'project.quality.edit_own', 'project.quality.checklist_edit_own',
      'project.quality.delete_own'
    )
    and grant_row.is_active
    and (grant_row.expires_at is null or grant_row.expires_at > now())
) unresolved;

create table if not exists app_private.quality_command_requests (
  id bigint generated always as identity primary key,
  actor_user_id uuid not null,
  request_id uuid not null,
  command_name text not null,
  payload_hash text not null,
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (actor_user_id, request_id)
);

revoke all privileges on table app_private.quality_command_requests
  from public, anon, authenticated;

create or replace function app_private.assert_quality_action(
  p_project_id text,
  p_construction_site_id text,
  p_action_code text
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := public.current_app_user_id();
  v_site_id text := nullif(btrim(coalesce(p_construction_site_id, '')), '');
begin
  if v_actor_user_id is null then
    raise exception 'QUALITY_PERMISSION_DENIED' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_project_id, '')), '') is null
    or v_site_id is null
    or not exists (
      select 1 from public.projects project
      where project.id::text = p_project_id
        and project.construction_site_id::text = v_site_id
    ) then
    raise exception 'QUALITY_SCOPE_MISMATCH' using errcode = '23514';
  end if;
  if p_action_code not in ('view', 'edit', 'delete', 'submit', 'verify', 'approve')
    or not app_private.project_actor_has_effective_room_action(
      v_actor_user_id, p_project_id, v_site_id, 'quality', p_action_code
    ) then
    raise exception 'QUALITY_PERMISSION_DENIED' using errcode = '42501';
  end if;
  return v_actor_user_id;
end;
$$;

revoke all on function app_private.assert_quality_action(text, text, text)
  from public, anon, authenticated;

create or replace function app_private.begin_quality_command(
  p_actor_user_id uuid,
  p_request_id uuid,
  p_command_name text,
  p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request app_private.quality_command_requests%rowtype;
begin
  if p_request_id is null then
    raise exception 'QUALITY_REQUEST_ID_REUSED: request id is required' using errcode = '23514';
  end if;
  insert into app_private.quality_command_requests (
    actor_user_id, request_id, command_name, payload_hash
  ) values (p_actor_user_id, p_request_id, p_command_name, p_payload_hash)
  on conflict (actor_user_id, request_id) do nothing;
  if found then return null; end if;

  select request.* into v_request
  from app_private.quality_command_requests request
  where request.actor_user_id = p_actor_user_id
    and request.request_id = p_request_id
  for update;
  if v_request.command_name is distinct from p_command_name
    or v_request.payload_hash is distinct from p_payload_hash then
    raise exception 'QUALITY_REQUEST_ID_REUSED' using errcode = '23514';
  end if;
  if v_request.result is null then
    raise exception 'QUALITY_REQUEST_ID_REUSED: request is still in progress' using errcode = '55000';
  end if;
  return v_request.result || jsonb_build_object('replayed', true);
end;
$$;

create or replace function app_private.finish_quality_command(
  p_actor_user_id uuid,
  p_request_id uuid,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update app_private.quality_command_requests request
  set result = p_result, completed_at = now()
  where request.actor_user_id = p_actor_user_id
    and request.request_id = p_request_id;
  return p_result;
end;
$$;

revoke all on function app_private.begin_quality_command(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function app_private.finish_quality_command(uuid, uuid, jsonb)
  from public, anon, authenticated;

create or replace function app_private.assert_quality_recipient(
  p_user_id uuid,
  p_project_id text,
  p_construction_site_id text
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_user_id is null
    or not app_private.project_actor_has_effective_room_action(
      p_user_id, p_project_id, p_construction_site_id, 'quality', 'approve'
    ) then
    raise exception 'QUALITY_RECIPIENT_INVALID' using errcode = '42501';
  end if;
end;
$$;

revoke all on function app_private.assert_quality_recipient(uuid, text, text)
  from public, anon, authenticated;

create or replace function app_private.quality_current_actor_has_action(
  p_project_id text,
  p_construction_site_id text,
  p_action_code text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.project_actor_has_effective_room_action(
    public.current_app_user_id(), p_project_id, p_construction_site_id,
    'quality', p_action_code
  );
$$;

revoke all on function app_private.quality_current_actor_has_action(text, text, text)
  from public, anon;
grant execute on function app_private.quality_current_actor_has_action(text, text, text)
  to authenticated;

create or replace function app_private.create_quality_checklist_impl(
  p_request_id uuid,
  p_project_id text,
  p_construction_site_id text,
  p_payload jsonb,
  p_submission_target jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_target uuid := nullif(p_submission_target ->> 'user_id', '')::uuid;
  v_replay jsonb;
  v_result jsonb;
  v_row public.quality_checklists%rowtype;
  v_target_name text;
begin
  v_actor := app_private.assert_quality_action(p_project_id, p_construction_site_id, 'edit');
  if jsonb_typeof(coalesce(p_payload, 'null'::jsonb)) <> 'object'
    or nullif(btrim(coalesce(p_payload ->> 'title', '')), '') is null then
    raise exception 'QUALITY_INVALID_TRANSITION: invalid payload' using errcode = '22023';
  end if;
  if v_target is not null then
    perform app_private.assert_quality_action(p_project_id, p_construction_site_id, 'submit');
    perform app_private.assert_quality_recipient(v_target, p_project_id, p_construction_site_id);
    select user_row.name into v_target_name from public.users user_row where user_row.id = v_target;
  end if;
  v_replay := app_private.begin_quality_command(v_actor, p_request_id,
    'create_quality_checklist', md5(jsonb_build_object(
      'projectId', p_project_id, 'constructionSiteId', p_construction_site_id,
      'payload', p_payload, 'submissionTarget', p_submission_target
    )::text));
  if v_replay is not null then return v_replay; end if;

  insert into public.quality_checklists (
    project_id, construction_site_id, task_id, contract_item_id, daily_log_id,
    template_id, work_type_id, code, title, template_code, template_name,
    template_version, standard_reference, work_description, work_location,
    work_date, work_supervisor, checklist_data, site_photos, attachments,
    conclusion, conclusion_result, conditions, inspector_name, inspector_sign_url,
    approver_name, approver_sign_url, inspection_result, total_criteria,
    passed_criteria, failed_criteria, current_attempt, note, drawing_url,
    drawing_markers, target_completion_date, signers_data, status, created_by,
    submitted_by, submitted_at, submitted_to_user_id, submitted_to_name,
    submitted_to_permission, submission_note, ever_submitted, last_action_by,
    last_action_at, created_at, updated_at
  ) values (
    p_project_id::uuid, p_construction_site_id::uuid,
    nullif(p_payload ->> 'task_id', '')::uuid,
    nullif(p_payload ->> 'contract_item_id', '')::uuid,
    nullif(p_payload ->> 'daily_log_id', '')::uuid,
    nullif(p_payload ->> 'template_id', '')::uuid,
    nullif(p_payload ->> 'work_type_id', '')::uuid,
    coalesce(nullif(btrim(p_payload ->> 'code'), ''),
      'QC-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS')),
    btrim(p_payload ->> 'title'), nullif(p_payload ->> 'template_code', ''),
    nullif(p_payload ->> 'template_name', ''),
    nullif(p_payload ->> 'template_version', '')::integer,
    nullif(p_payload ->> 'standard_reference', ''),
    nullif(p_payload ->> 'work_description', ''),
    nullif(p_payload ->> 'work_location', ''),
    nullif(p_payload ->> 'work_date', '')::date,
    nullif(p_payload ->> 'work_supervisor', ''),
    coalesce(p_payload -> 'checklist_data', '[]'::jsonb),
    coalesce(p_payload -> 'site_photos', '[]'::jsonb),
    coalesce(p_payload -> 'attachments', '[]'::jsonb),
    nullif(p_payload ->> 'conclusion', ''),
    nullif(p_payload ->> 'conclusion_result', ''),
    nullif(p_payload ->> 'conditions', ''), nullif(p_payload ->> 'inspector_name', ''),
    nullif(p_payload ->> 'inspector_sign_url', ''), nullif(p_payload ->> 'approver_name', ''),
    nullif(p_payload ->> 'approver_sign_url', ''), nullif(p_payload ->> 'inspection_result', ''),
    coalesce((p_payload ->> 'total_criteria')::integer, 0),
    coalesce((p_payload ->> 'passed_criteria')::integer, 0),
    coalesce((p_payload ->> 'failed_criteria')::integer, 0),
    greatest(coalesce((p_payload ->> 'current_attempt')::integer, 1), 1),
    nullif(p_payload ->> 'note', ''), nullif(p_payload ->> 'drawing_url', ''),
    coalesce(p_payload -> 'drawing_markers', '[]'::jsonb),
    nullif(p_payload ->> 'target_completion_date', '')::date,
    coalesce(p_payload -> 'signers_data', '[]'::jsonb),
    case when v_target is null then 'draft' else 'submitted' end,
    v_actor::text,
    case when v_target is null then null else v_actor::text end,
    case when v_target is null then null else now() end,
    v_target::text, v_target_name,
    case when v_target is null then null else 'approve' end,
    nullif(p_submission_target ->> 'note', ''), v_target is not null,
    v_actor::text, now(), now(), now()
  ) returning * into v_row;

  if v_target is not null then
    insert into public.notifications (
      user_id, title, body, message, type, category, severity, module, link,
      source_type, source_id, construction_site_id, metadata
    ) values (
      v_target::text, 'Hồ sơ chất lượng ' || v_row.code || ' chờ duyệt',
      'Bạn được chọn phê duyệt hồ sơ chất lượng ' || v_row.title || '.',
      'Bạn được chọn phê duyệt hồ sơ chất lượng ' || v_row.title || '.',
      'info', 'quality', 'info', 'DA', '/da', 'quality_checklist', v_row.id::text,
      p_construction_site_id, jsonb_build_object(
        'projectId', p_project_id, 'constructionSiteId', p_construction_site_id,
        'submittedToUserId', v_target
      )
    );
  end if;

  insert into public.audit_trail (
    table_name, record_id, action, new_data, user_id, user_name,
    module, description, context
  ) values (
    'quality_checklists', v_row.id::text, 'INSERT', to_jsonb(v_row),
    v_actor::text, v_actor::text, 'quality',
    case when v_target is null then 'Tạo hồ sơ chất lượng'
      else 'Tạo và gửi duyệt hồ sơ chất lượng' end,
    jsonb_build_object('requestId', p_request_id, 'roomCode', 'quality')
  );

  v_result := jsonb_build_object('ok', true, 'requestId', p_request_id,
    'replayed', false, 'checklist', to_jsonb(v_row));
  return app_private.finish_quality_command(v_actor, p_request_id, v_result);
end;
$$;

create or replace function app_private.update_quality_checklist_impl(
  p_request_id uuid,
  p_project_id text,
  p_construction_site_id text,
  p_checklist_id uuid,
  p_expected_updated_at timestamptz,
  p_changes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_old public.quality_checklists%rowtype;
  v_row public.quality_checklists%rowtype;
  v_replay jsonb;
  v_result jsonb;
begin
  v_actor := app_private.assert_quality_action(p_project_id, p_construction_site_id, 'edit');
  v_replay := app_private.begin_quality_command(v_actor, p_request_id,
    'update_quality_checklist', md5(jsonb_build_object(
      'projectId', p_project_id, 'constructionSiteId', p_construction_site_id,
      'checklistId', p_checklist_id, 'expectedUpdatedAt', p_expected_updated_at,
      'changes', p_changes
    )::text));
  if v_replay is not null then return v_replay; end if;

  select * into v_old from public.quality_checklists item
  where item.id = p_checklist_id for update;
  if not found or v_old.project_id::text is distinct from p_project_id
    or v_old.construction_site_id::text is distinct from p_construction_site_id then
    raise exception 'QUALITY_SCOPE_MISMATCH' using errcode = '23514';
  end if;
  if v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'QUALITY_STALE_VERSION' using errcode = '40001';
  end if;
  if v_old.status not in ('draft', 'returned') then
    raise exception 'QUALITY_INVALID_TRANSITION' using errcode = '23514';
  end if;

  update public.quality_checklists item set
    title = case when p_changes ? 'title' then btrim(p_changes ->> 'title') else item.title end,
    work_description = case when p_changes ? 'work_description' then nullif(p_changes ->> 'work_description', '') else item.work_description end,
    work_location = case when p_changes ? 'work_location' then nullif(p_changes ->> 'work_location', '') else item.work_location end,
    work_date = case when p_changes ? 'work_date' then nullif(p_changes ->> 'work_date', '')::date else item.work_date end,
    work_supervisor = case when p_changes ? 'work_supervisor' then nullif(p_changes ->> 'work_supervisor', '') else item.work_supervisor end,
    checklist_data = case when p_changes ? 'checklist_data' then coalesce(p_changes -> 'checklist_data', '[]'::jsonb) else item.checklist_data end,
    site_photos = case when p_changes ? 'site_photos' then coalesce(p_changes -> 'site_photos', '[]'::jsonb) else item.site_photos end,
    attachments = case when p_changes ? 'attachments' then coalesce(p_changes -> 'attachments', '[]'::jsonb) else item.attachments end,
    conclusion = case when p_changes ? 'conclusion' then nullif(p_changes ->> 'conclusion', '') else item.conclusion end,
    conclusion_result = case when p_changes ? 'conclusion_result' then nullif(p_changes ->> 'conclusion_result', '') else item.conclusion_result end,
    conditions = case when p_changes ? 'conditions' then nullif(p_changes ->> 'conditions', '') else item.conditions end,
    inspector_name = case when p_changes ? 'inspector_name' then nullif(p_changes ->> 'inspector_name', '') else item.inspector_name end,
    inspector_sign_url = case when p_changes ? 'inspector_sign_url' then nullif(p_changes ->> 'inspector_sign_url', '') else item.inspector_sign_url end,
    approver_name = case when p_changes ? 'approver_name' then nullif(p_changes ->> 'approver_name', '') else item.approver_name end,
    approver_sign_url = case when p_changes ? 'approver_sign_url' then nullif(p_changes ->> 'approver_sign_url', '') else item.approver_sign_url end,
    inspection_result = case when p_changes ? 'inspection_result' then nullif(p_changes ->> 'inspection_result', '') else item.inspection_result end,
    total_criteria = case when p_changes ? 'total_criteria' then coalesce((p_changes ->> 'total_criteria')::integer, 0) else item.total_criteria end,
    passed_criteria = case when p_changes ? 'passed_criteria' then coalesce((p_changes ->> 'passed_criteria')::integer, 0) else item.passed_criteria end,
    failed_criteria = case when p_changes ? 'failed_criteria' then coalesce((p_changes ->> 'failed_criteria')::integer, 0) else item.failed_criteria end,
    note = case when p_changes ? 'note' then nullif(p_changes ->> 'note', '') else item.note end,
    drawing_url = case when p_changes ? 'drawing_url' then nullif(p_changes ->> 'drawing_url', '') else item.drawing_url end,
    drawing_markers = case when p_changes ? 'drawing_markers' then coalesce(p_changes -> 'drawing_markers', '[]'::jsonb) else item.drawing_markers end,
    target_completion_date = case when p_changes ? 'target_completion_date' then nullif(p_changes ->> 'target_completion_date', '')::date else item.target_completion_date end,
    signers_data = case when p_changes ? 'signers_data' then coalesce(p_changes -> 'signers_data', '[]'::jsonb) else item.signers_data end,
    standard_reference = case when p_changes ? 'standard_reference' then nullif(p_changes ->> 'standard_reference', '') else item.standard_reference end,
    last_action_by = v_actor::text,
    last_action_at = now(),
    updated_at = now()
  where item.id = p_checklist_id
  returning * into v_row;

  if nullif(btrim(v_row.title), '') is null then
    raise exception 'QUALITY_INVALID_TRANSITION: title is required' using errcode = '22023';
  end if;
  insert into public.audit_trail (
    table_name, record_id, action, old_data, new_data, user_id, user_name,
    module, description, context
  ) values (
    'quality_checklists', v_row.id::text, 'UPDATE', to_jsonb(v_old), to_jsonb(v_row),
    v_actor::text, v_actor::text, 'quality', 'Cập nhật hồ sơ chất lượng',
    jsonb_build_object('requestId', p_request_id, 'roomCode', 'quality')
  );
  v_result := jsonb_build_object('ok', true, 'requestId', p_request_id,
    'replayed', false, 'checklist', to_jsonb(v_row));
  return app_private.finish_quality_command(v_actor, p_request_id, v_result);
end;
$$;

create or replace function app_private.transition_quality_checklist_impl(
  p_request_id uuid,
  p_project_id text,
  p_construction_site_id text,
  p_checklist_id uuid,
  p_expected_updated_at timestamptz,
  p_status text,
  p_submission_target jsonb default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_target uuid := nullif(p_submission_target ->> 'user_id', '')::uuid;
  v_old public.quality_checklists%rowtype;
  v_row public.quality_checklists%rowtype;
  v_replay jsonb;
  v_result jsonb;
  v_target_name text;
begin
  if p_status = 'submitted' then
    v_actor := app_private.assert_quality_action(p_project_id, p_construction_site_id, 'submit');
    perform app_private.assert_quality_action(p_project_id, p_construction_site_id, 'edit');
    perform app_private.assert_quality_recipient(v_target, p_project_id, p_construction_site_id);
    select user_row.name into v_target_name from public.users user_row where user_row.id = v_target;
  elsif p_status in ('approved', 'returned', 'cancelled', 'draft') then
    v_actor := app_private.assert_quality_action(p_project_id, p_construction_site_id, 'approve');
  else
    raise exception 'QUALITY_INVALID_TRANSITION' using errcode = '23514';
  end if;
  v_replay := app_private.begin_quality_command(v_actor, p_request_id,
    'transition_quality_checklist', md5(jsonb_build_object(
      'projectId', p_project_id, 'constructionSiteId', p_construction_site_id,
      'checklistId', p_checklist_id, 'expectedUpdatedAt', p_expected_updated_at,
      'status', p_status, 'submissionTarget', p_submission_target, 'reason', p_reason
    )::text));
  if v_replay is not null then return v_replay; end if;

  select * into v_old from public.quality_checklists item
  where item.id = p_checklist_id for update;
  if not found or v_old.project_id::text is distinct from p_project_id
    or v_old.construction_site_id::text is distinct from p_construction_site_id then
    raise exception 'QUALITY_SCOPE_MISMATCH' using errcode = '23514';
  end if;
  if v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'QUALITY_STALE_VERSION' using errcode = '40001';
  end if;
  if not (
    (p_status = 'submitted' and v_old.status in ('draft', 'returned'))
    or (p_status in ('approved', 'returned') and v_old.status = 'submitted')
    or (p_status = 'cancelled' and v_old.status <> 'cancelled')
    or (p_status = 'draft' and v_old.status = 'approved')
  ) then
    raise exception 'QUALITY_INVALID_TRANSITION' using errcode = '23514';
  end if;
  if p_status in ('returned', 'cancelled') and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'QUALITY_INVALID_TRANSITION: reason is required' using errcode = '23514';
  end if;

  update public.quality_checklists item set
    status = p_status,
    submitted_by = case when p_status = 'submitted' then v_actor::text when p_status = 'draft' then null else item.submitted_by end,
    submitted_at = case when p_status = 'submitted' then now() when p_status = 'draft' then null else item.submitted_at end,
    submitted_to_user_id = case
      when p_status = 'submitted' then v_target::text
      when p_status = 'returned' then coalesce(item.submitted_by, item.created_by)
      else null end,
    submitted_to_name = case when p_status = 'submitted' then v_target_name else null end,
    submitted_to_permission = case when p_status = 'submitted' then 'approve'
      when p_status = 'returned' then 'edit' else null end,
    submission_note = case when p_status = 'submitted' then nullif(p_submission_target ->> 'note', '')
      when p_status = 'returned' then btrim(p_reason) else null end,
    approved_by = case when p_status = 'approved' then v_actor::text when p_status = 'draft' then null else item.approved_by end,
    approved_at = case when p_status = 'approved' then now() when p_status = 'draft' then null else item.approved_at end,
    returned_by = case when p_status = 'returned' then v_actor::text when p_status = 'draft' then null else item.returned_by end,
    returned_at = case when p_status = 'returned' then now() when p_status = 'draft' then null else item.returned_at end,
    return_reason = case when p_status = 'returned' then btrim(p_reason) when p_status = 'draft' then null else item.return_reason end,
    ever_submitted = item.ever_submitted or p_status = 'submitted',
    last_action_by = v_actor::text,
    last_action_at = now(),
    updated_at = now()
  where item.id = p_checklist_id
  returning * into v_row;

  if p_status = 'submitted' then
    insert into public.notifications (
      user_id, title, body, message, type, category, severity, module, link,
      source_type, source_id, construction_site_id, metadata
    ) values (
      v_target::text, 'Hồ sơ chất lượng ' || v_row.code || ' chờ duyệt',
      'Bạn được chọn phê duyệt hồ sơ chất lượng ' || v_row.title || '.',
      'Bạn được chọn phê duyệt hồ sơ chất lượng ' || v_row.title || '.',
      'info', 'quality', 'info', 'DA', '/da', 'quality_checklist', v_row.id::text,
      p_construction_site_id, jsonb_build_object(
        'projectId', p_project_id, 'constructionSiteId', p_construction_site_id,
        'submittedToUserId', v_target
      )
    );
  elsif p_status = 'returned' and coalesce(v_old.submitted_by, v_old.created_by) is not null then
    insert into public.notifications (
      user_id, title, body, message, type, category, severity, module, link,
      source_type, source_id, construction_site_id, metadata
    ) values (
      coalesce(v_old.submitted_by, v_old.created_by),
      'Hồ sơ chất lượng ' || v_row.code || ' được trả lại', btrim(p_reason),
      btrim(p_reason), 'warning', 'quality', 'warning', 'DA', '/da',
      'quality_checklist', v_row.id::text, p_construction_site_id,
      jsonb_build_object('projectId', p_project_id, 'constructionSiteId', p_construction_site_id)
    );
  end if;

  insert into public.audit_trail (
    table_name, record_id, action, old_data, new_data, user_id, user_name,
    module, description, context
  ) values (
    'quality_checklists', v_row.id::text, 'UPDATE', to_jsonb(v_old), to_jsonb(v_row),
    v_actor::text, v_actor::text, 'quality', 'Chuyển trạng thái hồ sơ chất lượng sang ' || p_status,
    jsonb_build_object('requestId', p_request_id, 'roomCode', 'quality', 'reason', p_reason)
  );
  v_result := jsonb_build_object('ok', true, 'requestId', p_request_id,
    'replayed', false, 'checklist', to_jsonb(v_row));
  return app_private.finish_quality_command(v_actor, p_request_id, v_result);
end;
$$;

create or replace function app_private.delete_quality_checklist_impl(
  p_request_id uuid,
  p_project_id text,
  p_construction_site_id text,
  p_checklist_id uuid,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_old public.quality_checklists%rowtype;
  v_replay jsonb;
  v_result jsonb;
begin
  v_actor := app_private.assert_quality_action(p_project_id, p_construction_site_id, 'delete');
  v_replay := app_private.begin_quality_command(v_actor, p_request_id,
    'delete_quality_checklist', md5(jsonb_build_object(
      'projectId', p_project_id, 'constructionSiteId', p_construction_site_id,
      'checklistId', p_checklist_id, 'expectedUpdatedAt', p_expected_updated_at
    )::text));
  if v_replay is not null then return v_replay; end if;
  select * into v_old from public.quality_checklists item
  where item.id = p_checklist_id for update;
  if not found or v_old.project_id::text is distinct from p_project_id
    or v_old.construction_site_id::text is distinct from p_construction_site_id then
    raise exception 'QUALITY_SCOPE_MISMATCH' using errcode = '23514';
  end if;
  if v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'QUALITY_STALE_VERSION' using errcode = '40001';
  end if;
  if v_old.status <> 'draft' then
    raise exception 'QUALITY_INVALID_TRANSITION' using errcode = '23514';
  end if;
  insert into public.audit_trail (
    table_name, record_id, action, old_data, user_id, user_name,
    module, description, context
  ) values (
    'quality_checklists', v_old.id::text, 'DELETE', to_jsonb(v_old),
    v_actor::text, v_actor::text, 'quality', 'Xóa hồ sơ chất lượng',
    jsonb_build_object('requestId', p_request_id, 'roomCode', 'quality')
  );
  delete from public.quality_checklists item where item.id = p_checklist_id;
  v_result := jsonb_build_object('ok', true, 'requestId', p_request_id,
    'replayed', false, 'checklist', null);
  return app_private.finish_quality_command(v_actor, p_request_id, v_result);
end;
$$;

create or replace function app_private.create_quality_inspection_attempt_impl(
  p_request_id uuid,
  p_project_id text,
  p_construction_site_id text,
  p_checklist_id uuid,
  p_expected_updated_at timestamptz,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_old public.quality_checklists%rowtype;
  v_row public.quality_checklists%rowtype;
  v_attempt public.quality_inspection_attempts%rowtype;
  v_replay jsonb;
  v_result jsonb;
begin
  v_actor := app_private.assert_quality_action(p_project_id, p_construction_site_id, 'edit');
  v_replay := app_private.begin_quality_command(v_actor, p_request_id,
    'create_quality_inspection_attempt', md5(jsonb_build_object(
      'projectId', p_project_id, 'constructionSiteId', p_construction_site_id,
      'checklistId', p_checklist_id, 'expectedUpdatedAt', p_expected_updated_at,
      'payload', p_payload
    )::text));
  if v_replay is not null then return v_replay; end if;
  select * into v_old from public.quality_checklists item
  where item.id = p_checklist_id for update;
  if not found or v_old.project_id::text is distinct from p_project_id
    or v_old.construction_site_id::text is distinct from p_construction_site_id then
    raise exception 'QUALITY_SCOPE_MISMATCH' using errcode = '23514';
  end if;
  if v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'QUALITY_STALE_VERSION' using errcode = '40001';
  end if;
  if v_old.status not in ('draft', 'returned')
    or coalesce(p_payload ->> 'result', '') not in ('PASSED', 'FAILED') then
    raise exception 'QUALITY_INVALID_TRANSITION' using errcode = '23514';
  end if;

  insert into public.quality_inspection_attempts (
    checklist_id, attempt_number, inspection_date, inspector_name,
    items_data, result, conclusion, signature_url, created_by
  ) values (
    p_checklist_id,
    coalesce((p_payload ->> 'attempt_number')::integer, v_old.current_attempt),
    coalesce(nullif(p_payload ->> 'inspection_date', '')::date, current_date),
    nullif(p_payload ->> 'inspector_name', ''),
    coalesce(p_payload -> 'items_data', '[]'::jsonb), p_payload ->> 'result',
    nullif(p_payload ->> 'conclusion', ''), nullif(p_payload ->> 'signature_url', ''),
    v_actor::text
  ) returning * into v_attempt;
  update public.quality_checklists item
  set current_attempt = greatest(item.current_attempt, v_attempt.attempt_number + 1),
      last_action_by = v_actor::text, last_action_at = now(), updated_at = now()
  where item.id = p_checklist_id
  returning * into v_row;

  insert into public.audit_trail (
    table_name, record_id, action, new_data, user_id, user_name,
    module, description, context
  ) values (
    'quality_inspection_attempts', v_attempt.id::text, 'INSERT', to_jsonb(v_attempt),
    v_actor::text, v_actor::text, 'quality', 'Tạo lần kiểm tra chất lượng',
    jsonb_build_object('requestId', p_request_id, 'roomCode', 'quality',
      'checklistId', p_checklist_id)
  );
  v_result := jsonb_build_object('ok', true, 'requestId', p_request_id,
    'replayed', false, 'checklist', to_jsonb(v_row), 'attempt', to_jsonb(v_attempt));
  return app_private.finish_quality_command(v_actor, p_request_id, v_result);
end;
$$;

revoke all on function app_private.create_quality_checklist_impl(uuid, text, text, jsonb, jsonb) from public, anon;
revoke all on function app_private.update_quality_checklist_impl(uuid, text, text, uuid, timestamptz, jsonb) from public, anon;
revoke all on function app_private.transition_quality_checklist_impl(uuid, text, text, uuid, timestamptz, text, jsonb, text) from public, anon;
revoke all on function app_private.delete_quality_checklist_impl(uuid, text, text, uuid, timestamptz) from public, anon;
revoke all on function app_private.create_quality_inspection_attempt_impl(uuid, text, text, uuid, timestamptz, jsonb) from public, anon;
grant execute on function app_private.create_quality_checklist_impl(uuid, text, text, jsonb, jsonb) to authenticated;
grant execute on function app_private.update_quality_checklist_impl(uuid, text, text, uuid, timestamptz, jsonb) to authenticated;
grant execute on function app_private.transition_quality_checklist_impl(uuid, text, text, uuid, timestamptz, text, jsonb, text) to authenticated;
grant execute on function app_private.delete_quality_checklist_impl(uuid, text, text, uuid, timestamptz) to authenticated;
grant execute on function app_private.create_quality_inspection_attempt_impl(uuid, text, text, uuid, timestamptz, jsonb) to authenticated;

create or replace function public.create_quality_checklist(
  p_request_id uuid, p_project_id text, p_construction_site_id text,
  p_payload jsonb, p_submission_target jsonb default null
)
returns jsonb language sql security invoker set search_path = '' as $$
  select app_private.create_quality_checklist_impl(
    p_request_id, p_project_id, p_construction_site_id, p_payload, p_submission_target
  );
$$;

create or replace function public.update_quality_checklist(
  p_request_id uuid, p_project_id text, p_construction_site_id text,
  p_checklist_id uuid, p_expected_updated_at timestamptz, p_changes jsonb
)
returns jsonb language sql security invoker set search_path = '' as $$
  select app_private.update_quality_checklist_impl(
    p_request_id, p_project_id, p_construction_site_id, p_checklist_id,
    p_expected_updated_at, p_changes
  );
$$;

create or replace function public.transition_quality_checklist(
  p_request_id uuid, p_project_id text, p_construction_site_id text,
  p_checklist_id uuid, p_expected_updated_at timestamptz, p_status text,
  p_submission_target jsonb default null, p_reason text default null
)
returns jsonb language sql security invoker set search_path = '' as $$
  select app_private.transition_quality_checklist_impl(
    p_request_id, p_project_id, p_construction_site_id, p_checklist_id,
    p_expected_updated_at, p_status, p_submission_target, p_reason
  );
$$;

create or replace function public.delete_quality_checklist(
  p_request_id uuid, p_project_id text, p_construction_site_id text,
  p_checklist_id uuid, p_expected_updated_at timestamptz
)
returns jsonb language sql security invoker set search_path = '' as $$
  select app_private.delete_quality_checklist_impl(
    p_request_id, p_project_id, p_construction_site_id, p_checklist_id,
    p_expected_updated_at
  );
$$;

create or replace function public.create_quality_inspection_attempt(
  p_request_id uuid, p_project_id text, p_construction_site_id text,
  p_checklist_id uuid, p_expected_updated_at timestamptz, p_payload jsonb
)
returns jsonb language sql security invoker set search_path = '' as $$
  select app_private.create_quality_inspection_attempt_impl(
    p_request_id, p_project_id, p_construction_site_id, p_checklist_id,
    p_expected_updated_at, p_payload
  );
$$;

revoke all on function public.create_quality_checklist(uuid, text, text, jsonb, jsonb) from public, anon;
revoke all on function public.update_quality_checklist(uuid, text, text, uuid, timestamptz, jsonb) from public, anon;
revoke all on function public.transition_quality_checklist(uuid, text, text, uuid, timestamptz, text, jsonb, text) from public, anon;
revoke all on function public.delete_quality_checklist(uuid, text, text, uuid, timestamptz) from public, anon;
revoke all on function public.create_quality_inspection_attempt(uuid, text, text, uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.create_quality_checklist(uuid, text, text, jsonb, jsonb) to authenticated;
grant execute on function public.update_quality_checklist(uuid, text, text, uuid, timestamptz, jsonb) to authenticated;
grant execute on function public.transition_quality_checklist(uuid, text, text, uuid, timestamptz, text, jsonb, text) to authenticated;
grant execute on function public.delete_quality_checklist(uuid, text, text, uuid, timestamptz) to authenticated;
grant execute on function public.create_quality_inspection_attempt(uuid, text, text, uuid, timestamptz, jsonb) to authenticated;

-- The trigger remains a defense for service-role/internal writers, but uses effective Room actions.
create or replace function app_private.enforce_quality_checklist_room_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_action text;
begin
  if new.status is not distinct from old.status then return new; end if;
  v_action := case when new.status = 'submitted' then 'submit'
    when new.status in ('approved', 'returned', 'cancelled', 'draft') then 'approve'
    else null end;
  if v_action is null then return new; end if;
  if v_actor is null or not app_private.project_actor_has_effective_room_action(
    v_actor, new.project_id::text, new.construction_site_id::text, 'quality', v_action
  ) then
    raise exception 'QUALITY_PERMISSION_DENIED' using errcode = '42501';
  end if;
  if new.status = 'submitted' then
    perform app_private.assert_quality_recipient(
      nullif(new.submitted_to_user_id, '')::uuid,
      new.project_id::text, new.construction_site_id::text
    );
  end if;
  return new;
end;
$$;

drop policy if exists quality_checklists_phase0_select on public.quality_checklists;
drop policy if exists quality_checklists_phase0_insert on public.quality_checklists;
drop policy if exists quality_checklists_phase0_update on public.quality_checklists;
drop policy if exists quality_checklists_phase0_delete on public.quality_checklists;
drop policy if exists quality_checklists_room_select on public.quality_checklists;
create policy quality_checklists_room_select on public.quality_checklists
for select to authenticated using (
  app_private.quality_current_actor_has_action(
    project_id::text, construction_site_id::text, 'view'
  )
);

drop policy if exists quality_inspection_attempts_phase0_select on public.quality_inspection_attempts;
drop policy if exists quality_inspection_attempts_phase0_insert on public.quality_inspection_attempts;
drop policy if exists quality_inspection_attempts_phase0_update on public.quality_inspection_attempts;
drop policy if exists quality_inspection_attempts_phase0_delete on public.quality_inspection_attempts;
drop policy if exists quality_inspection_attempts_room_select on public.quality_inspection_attempts;
create policy quality_inspection_attempts_room_select on public.quality_inspection_attempts
for select to authenticated using (
  exists (
    select 1 from public.quality_checklists checklist
    where checklist.id = quality_inspection_attempts.checklist_id
      and app_private.quality_current_actor_has_action(
        checklist.project_id::text, checklist.construction_site_id::text, 'view'
      )
  )
);

revoke insert, update, delete on public.quality_checklists from authenticated;
revoke insert, update, delete on public.quality_inspection_attempts from authenticated;
grant select on public.quality_checklists to authenticated;
grant select on public.quality_inspection_attempts to authenticated;

create or replace function app_private.quality_storage_can_mutate(name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select split_part(name, '/', 1) = 'quality'
    and nullif(split_part(name, '/', 2), '') is not null
    and nullif(split_part(name, '/', 3), '') is not null
    and nullif(split_part(name, '/', 4), '') is not null
    and app_private.project_actor_has_effective_room_action(
      public.current_app_user_id(), split_part(name, '/', 2),
      split_part(name, '/', 3), 'quality', 'edit'
    );
$$;

revoke all on function app_private.quality_storage_can_mutate(text) from public, anon;
grant execute on function app_private.quality_storage_can_mutate(text) to authenticated;

drop policy if exists "Allow upload to project-attachments" on storage.objects;
create policy "Allow upload to project-attachments" on storage.objects
for insert to public with check (
  bucket_id = 'project-attachments'
  and split_part(name, '/', 1) <> 'quality'
);
drop policy if exists "Allow update in project-attachments" on storage.objects;
create policy "Allow update in project-attachments" on storage.objects
for update to public using (
  bucket_id = 'project-attachments'
  and split_part(name, '/', 1) <> 'quality'
) with check (
  bucket_id = 'project-attachments'
  and split_part(name, '/', 1) <> 'quality'
);
drop policy if exists "Allow delete from project-attachments" on storage.objects;
create policy "Allow delete from project-attachments" on storage.objects
for delete to public using (
  bucket_id = 'project-attachments'
  and split_part(name, '/', 1) <> 'quality'
);

drop policy if exists quality_project_attachments_insert on storage.objects;
create policy quality_project_attachments_insert on storage.objects
for insert to authenticated with check (
  bucket_id = 'project-attachments'
  and app_private.quality_storage_can_mutate(name)
);
drop policy if exists quality_project_attachments_update on storage.objects;
create policy quality_project_attachments_update on storage.objects
for update to authenticated using (
  bucket_id = 'project-attachments'
  and app_private.quality_storage_can_mutate(name)
) with check (
  bucket_id = 'project-attachments'
  and app_private.quality_storage_can_mutate(name)
);
drop policy if exists quality_project_attachments_delete on storage.objects;
create policy quality_project_attachments_delete on storage.objects
for delete to authenticated using (
  bucket_id = 'project-attachments'
  and app_private.quality_storage_can_mutate(name)
);

notify pgrst, 'reload schema';
