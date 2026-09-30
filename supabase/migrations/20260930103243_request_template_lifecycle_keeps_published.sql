-- Editing a published request template must not hide it from creators.
--
-- request_templates.lifecycle_status now means "usable for new requests":
-- it stays PUBLISHED (or DEACTIVATED) while the next version is edited as a
-- DRAFT request_template_version. Only never-published templates are DRAFT.
-- Draft existence is exposed separately as request_template_summary.hasDraft.

create or replace function app_private.save_request_template_draft(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_template public.request_templates%rowtype;
  v_version public.request_template_versions%rowtype;
  v_template_id uuid;
  v_version_number integer;
  v_block jsonb;
  v_fixed_ids uuid[];
  v_expected_updated_at timestamptz;
  v_name text := nullif(trim(p_payload ->> 'name'), '');
  v_form_schema jsonb := coalesce(p_payload -> 'formSchema', '[]'::jsonb);
  v_usage_scope jsonb := coalesce(p_payload -> 'usageScope', '{}'::jsonb);
  v_blocks jsonb := coalesce(p_payload -> 'blocks', '[]'::jsonb);
  v_watcher_ids jsonb := coalesce(p_payload -> 'watcherUserIds', '[]'::jsonb);
begin
  if v_actor is null or not app_private.request_user_can_manage(v_actor) then
    raise exception using errcode = '42501', message = 'REQUEST_TEMPLATE_FORBIDDEN';
  end if;
  if v_name is null then
    raise exception using errcode = '22023', message = 'REQUEST_TEMPLATE_NAME_REQUIRED';
  end if;
  if jsonb_typeof(v_form_schema) <> 'array'
     or jsonb_typeof(v_usage_scope) <> 'object'
     or jsonb_typeof(v_blocks) <> 'array'
     or jsonb_typeof(v_watcher_ids) <> 'array' then
    raise exception using errcode = '22023', message = 'REQUEST_TEMPLATE_PAYLOAD_INVALID';
  end if;
  if coalesce(p_payload ->> 'flowMode', 'SEQUENTIAL') not in ('SEQUENTIAL', 'PARALLEL')
     or coalesce(p_payload ->> 'completionPolicy', 'ALL') not in ('ALL', 'ANY_ONE') then
    raise exception using errcode = '22023', message = 'REQUEST_TEMPLATE_POLICY_INVALID';
  end if;
  if jsonb_array_length(v_blocks) = 0 then
    raise exception using errcode = '22023', message = 'REQUEST_TEMPLATE_BLOCK_REQUIRED';
  end if;
  if coalesce(v_usage_scope ->> 'companyWide', 'false') not in ('true', 'false')
     or jsonb_typeof(coalesce(v_usage_scope -> 'orgUnitIds', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(v_usage_scope -> 'permissionCodes', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(v_usage_scope -> 'userIds', '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'REQUEST_TEMPLATE_SCOPE_INVALID';
  end if;
  if p_payload ? 'requestSlaHours'
     and nullif(p_payload ->> 'requestSlaHours', '')::numeric < 0 then
    raise exception using errcode = '22023', message = 'REQUEST_TEMPLATE_SLA_INVALID';
  end if;

  v_template_id := nullif(p_payload ->> 'templateId', '')::uuid;
  v_expected_updated_at := nullif(p_payload ->> 'expectedUpdatedAt', '')::timestamptz;

  if v_template_id is null then
    insert into public.request_templates(name, description, created_by)
    values (v_name, coalesce(p_payload ->> 'description', ''), v_actor)
    returning * into v_template;
  else
    select * into v_template
    from public.request_templates
    where id = v_template_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'REQUEST_TEMPLATE_NOT_FOUND';
    end if;
    if v_expected_updated_at is not null
       and v_template.updated_at <> v_expected_updated_at then
      raise exception using errcode = '40001', message = 'CONFLICT';
    end if;
    if v_template.lifecycle_status = 'DEACTIVATED' then
      raise exception using errcode = '22023', message = 'REQUEST_TEMPLATE_DEACTIVATED';
    end if;
    -- A published template keeps serving new requests while its next
    -- version is drafted.
    update public.request_templates
    set name = v_name,
        description = coalesce(p_payload ->> 'description', ''),
        lifecycle_status = case
          when v_template.current_version_id is null then 'DRAFT'
          else v_template.lifecycle_status
        end
    where id = v_template.id
    returning * into v_template;
  end if;

  select * into v_version
  from public.request_template_versions
  where request_template_id = v_template.id
    and status = 'DRAFT'
  order by version_number desc
  limit 1
  for update;

  if not found then
    select coalesce(max(version_number), 0) + 1
      into v_version_number
    from public.request_template_versions
    where request_template_id = v_template.id;
    insert into public.request_template_versions(
      request_template_id, version_number, form_schema, usage_scope,
      flow_mode, completion_policy, request_sla_hours, print_config,
      notification_config, status, created_by
    ) values (
      v_template.id, v_version_number, v_form_schema, v_usage_scope,
      coalesce(p_payload ->> 'flowMode', 'SEQUENTIAL'),
      coalesce(p_payload ->> 'completionPolicy', 'ALL'),
      nullif(p_payload ->> 'requestSlaHours', '')::numeric,
      coalesce(p_payload -> 'printConfig', '{}'::jsonb),
      coalesce(p_payload -> 'notificationConfig', '{}'::jsonb),
      'DRAFT', v_actor
    ) returning * into v_version;
  else
    update public.request_template_versions
    set form_schema = v_form_schema,
        usage_scope = v_usage_scope,
        flow_mode = coalesce(p_payload ->> 'flowMode', 'SEQUENTIAL'),
        completion_policy = coalesce(p_payload ->> 'completionPolicy', 'ALL'),
        request_sla_hours = nullif(p_payload ->> 'requestSlaHours', '')::numeric,
        print_config = coalesce(p_payload -> 'printConfig', '{}'::jsonb),
        notification_config = coalesce(p_payload -> 'notificationConfig', '{}'::jsonb),
        created_by = v_actor
    where id = v_version.id
    returning * into v_version;
    delete from public.request_approval_blocks
    where request_template_version_id = v_version.id;
    delete from public.request_template_watchers
    where request_template_version_id = v_version.id;
  end if;

  for v_block in select value from jsonb_array_elements(v_blocks)
  loop
    if nullif(trim(v_block ->> 'key'), '') is null
       or nullif(trim(v_block ->> 'name'), '') is null
       or coalesce(v_block ->> 'source', '') not in (
         'FIXED_SINGLE', 'FIXED_MULTI', 'DIRECT_MANAGER', 'DYNAMIC_CREATOR_SELECT'
       ) then
      raise exception using errcode = '22023', message = 'REQUEST_TEMPLATE_BLOCK_INVALID';
    end if;
    select coalesce(array_agg(value::uuid), '{}'::uuid[])
      into v_fixed_ids
    from jsonb_array_elements_text(coalesce(v_block -> 'fixedUserIds', '[]'::jsonb));
    if coalesce(v_block ->> 'source', '') in ('FIXED_SINGLE', 'FIXED_MULTI')
       and cardinality(v_fixed_ids) = 0 then
      raise exception using errcode = '22023', message = 'REQUEST_APPROVER_REQUIRED';
    end if;
    if exists (
      select 1
      from unnest(v_fixed_ids) as target_user(fixed_id)
      left join public.users app_user on app_user.id = target_user.fixed_id
      where app_user.id is null
         or not coalesce(app_user.is_active, true)
         or coalesce(app_user.account_status, 'ACTIVE') <> 'ACTIVE'
       ) then
      raise exception using errcode = '22023', message = 'REQUEST_APPROVER_INACTIVE';
    end if;
    if coalesce((v_block ->> 'sortOrder')::integer, 0) < 0
       or nullif(v_block ->> 'slaHours', '')::numeric < 0
       or nullif(v_block ->> 'minimumDynamicApprovers', '')::integer < 1 then
      raise exception using errcode = '22023', message = 'REQUEST_TEMPLATE_BLOCK_INVALID';
    end if;
    insert into public.request_approval_blocks(
      request_template_version_id, block_key, name, sort_order,
      approver_source, fixed_user_ids, minimum_dynamic_approvers, sla_hours
    ) values (
      v_version.id,
      trim(v_block ->> 'key'),
      trim(v_block ->> 'name'),
      coalesce((v_block ->> 'sortOrder')::integer, 0),
      v_block ->> 'source',
      v_fixed_ids,
      nullif(v_block ->> 'minimumDynamicApprovers', '')::integer,
      nullif(v_block ->> 'slaHours', '')::numeric
    );
  end loop;

  insert into public.request_template_watchers(request_template_version_id, user_id)
  select v_version.id, value::uuid
  from jsonb_array_elements_text(v_watcher_ids)
  on conflict do nothing;

  update public.request_templates
  set current_version_id = null,
      lifecycle_status = 'DRAFT'
  where id = v_template.id
    and current_version_id = v_version.id;
  select * into v_template
  from public.request_templates
  where id = v_template.id;

  return jsonb_build_object(
    'id', v_version.request_template_id,
    'status', v_version.status,
    'versionNumber', v_version.version_number,
    'updatedAt', v_template.updated_at,
    'payload', app_private.request_template_draft_payload(v_version.id)
  );
end;
$function$;

create or replace function app_private.create_request_template_draft_from_published(p_request_template_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_template public.request_templates%rowtype;
  v_published public.request_template_versions%rowtype;
  v_draft public.request_template_versions%rowtype;
  v_number integer;
begin
  if v_actor is null or not app_private.request_user_can_manage(v_actor) then
    raise exception using errcode = '42501', message = 'REQUEST_TEMPLATE_FORBIDDEN';
  end if;

  select * into v_template
  from public.request_templates
  where id = p_request_template_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'REQUEST_TEMPLATE_NOT_FOUND';
  end if;

  -- Continue the pending draft instead of stacking another version.
  select * into v_draft
  from public.request_template_versions
  where request_template_id = v_template.id
    and status = 'DRAFT'
  order by version_number desc
  limit 1;
  if found then
    return jsonb_build_object(
      'id', v_draft.request_template_id,
      'draftVersionId', v_draft.id,
      'status', v_draft.status,
      'versionNumber', v_draft.version_number,
      'updatedAt', v_template.updated_at,
      'payload', app_private.request_template_draft_payload(v_draft.id)
    );
  end if;

  select * into v_published
  from public.request_template_versions
  where request_template_id = v_template.id
    and status = 'PUBLISHED'
  order by version_number desc
  limit 1;
  if not found then
    raise exception using errcode = '22023', message = 'REQUEST_TEMPLATE_PUBLISHED_REQUIRED';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_number
  from public.request_template_versions
  where request_template_id = v_template.id;

  insert into public.request_template_versions(
    request_template_id, version_number, form_schema, usage_scope, flow_mode,
    completion_policy, request_sla_hours, print_config, notification_config,
    status, created_by
  ) values (
    v_template.id, v_number, v_published.form_schema, v_published.usage_scope,
    v_published.flow_mode, v_published.completion_policy, v_published.request_sla_hours,
    v_published.print_config, v_published.notification_config, 'DRAFT', v_actor
  ) returning * into v_draft;

  insert into public.request_approval_blocks(
    request_template_version_id, block_key, name, sort_order, approver_source,
    fixed_user_ids, minimum_dynamic_approvers, sla_hours, is_required
  )
  select v_draft.id, block_key, name, sort_order, approver_source,
    fixed_user_ids, minimum_dynamic_approvers, sla_hours, is_required
  from public.request_approval_blocks
  where request_template_version_id = v_published.id;

  insert into public.request_template_watchers(request_template_version_id, user_id)
  select v_draft.id, user_id
  from public.request_template_watchers
  where request_template_version_id = v_published.id
  on conflict do nothing;

  insert into public.request_print_templates(
    request_template_version_id, name, file_name, storage_path,
    validation_status, placeholder_schema
  )
  select v_draft.id, name, file_name, storage_path,
    validation_status, placeholder_schema
  from public.request_print_templates
  where request_template_version_id = v_published.id;

  return jsonb_build_object(
    'id', v_draft.request_template_id,
    'draftVersionId', v_draft.id,
    'status', v_draft.status,
    'versionNumber', v_draft.version_number,
    'updatedAt', v_template.updated_at,
    'payload', app_private.request_template_draft_payload(v_draft.id)
  );
end;
$function$;

create or replace function app_private.request_template_summary(p_template_id uuid)
returns jsonb
language sql
stable security definer
set search_path to ''
as $function$
  select jsonb_build_object(
    'id', template.id,
    'name', template.name,
    'status', template.lifecycle_status,
    'publishedVersionNumber', (
      select version.version_number
      from public.request_template_versions version
      where version.id = template.current_version_id
    ),
    'hasDraft', exists (
      select 1
      from public.request_template_versions draft_version
      where draft_version.request_template_id = template.id
        and draft_version.status = 'DRAFT'
    ),
    'usageScopeLabel', case
      when coalesce((current_version.usage_scope ->> 'companyWide')::boolean, false)
        then 'Toàn công ty'
      when jsonb_array_length(coalesce(current_version.usage_scope -> 'userIds', '[]'::jsonb)) > 0
        then 'Người dùng cụ thể'
      when jsonb_array_length(coalesce(current_version.usage_scope -> 'orgUnitIds', '[]'::jsonb)) > 0
        then 'Đơn vị/phòng ban'
      when jsonb_array_length(coalesce(current_version.usage_scope -> 'permissionCodes', '[]'::jsonb)) > 0
        then 'Nhóm quyền'
      else 'Chưa giới hạn'
    end,
    'updatedAt', template.updated_at
  )
  from public.request_templates template
  left join public.request_template_versions current_version
    on current_version.id = template.current_version_id
  where template.id = p_template_id
    and (
      app_private.request_user_can_manage(public.current_app_user_id())
      or app_private.request_template_can_select(
        template.id, public.current_app_user_id()
      )
    );
$function$;

create or replace function app_private.reactivate_request_template(
  p_request_template_id uuid,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_template public.request_templates%rowtype;
begin
  if v_actor is null or not app_private.request_user_can_manage(v_actor) then
    raise exception using errcode = '42501', message = 'REQUEST_TEMPLATE_FORBIDDEN';
  end if;
  if p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'REQUEST_TEMPLATE_EXPECTED_UPDATED_AT_REQUIRED';
  end if;
  select * into v_template from public.request_templates where id = p_request_template_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'REQUEST_TEMPLATE_NOT_FOUND'; end if;
  if v_template.updated_at <> p_expected_updated_at then
    raise exception using errcode = '40001', message = 'CONFLICT';
  end if;
  if v_template.lifecycle_status <> 'DEACTIVATED' or not exists (
    select 1 from public.request_template_versions version
    where version.id = v_template.current_version_id and version.status = 'PUBLISHED'
  ) then
    raise exception using errcode = '22023', message = 'REQUEST_TEMPLATE_PUBLISHED_REQUIRED';
  end if;
  update public.request_templates set lifecycle_status = 'PUBLISHED' where id = v_template.id;
  return app_private.request_template_summary(v_template.id);
end;
$function$;

create or replace function public.reactivate_request_template(
  p_request_template_id uuid,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
set search_path to ''
as $function$
begin
  return app_private.reactivate_request_template(
    p_request_template_id,
    p_expected_updated_at
  );
exception
  when serialization_failure then
    raise sqlstate 'PT409' using message = 'CONFLICT';
end;
$function$;

revoke all on function app_private.reactivate_request_template(uuid, timestamptz) from public, anon;
grant execute on function app_private.reactivate_request_template(uuid, timestamptz) to authenticated;
revoke all on function public.reactivate_request_template(uuid, timestamptz) from public, anon;
grant execute on function public.reactivate_request_template(uuid, timestamptz) to authenticated;

-- Restore templates hidden by the previous "edit published" behaviour.
update public.request_templates template
set lifecycle_status = 'PUBLISHED'
where template.lifecycle_status = 'DRAFT'
  and exists (
    select 1
    from public.request_template_versions version
    where version.id = template.current_version_id
      and version.status = 'PUBLISHED'
  );
