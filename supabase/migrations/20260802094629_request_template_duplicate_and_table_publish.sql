-- Keep request-template publish validation aligned with the editor schema.
-- In particular, table fields are first-class request fields.
create or replace function app_private.publish_request_template_version(
  p_request_template_id uuid,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_template public.request_templates%rowtype;
  v_draft public.request_template_versions%rowtype;
  v_old_version public.request_template_versions%rowtype;
  v_workflow_template_id uuid;
  v_workflow_version_id uuid;
  v_start_node_id uuid := gen_random_uuid();
  v_end_node_id uuid := gen_random_uuid();
  v_node_id uuid;
  v_next_node_id uuid;
  v_block record;
  v_block_ids uuid[] := '{}'::uuid[];
  v_number integer;
  v_snapshot jsonb;
  v_docx_path text;
begin
  if v_actor is null or not app_private.request_user_can_manage(v_actor) then
    raise exception using errcode = '42501', message = 'REQUEST_TEMPLATE_FORBIDDEN';
  end if;
  if p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'REQUEST_TEMPLATE_EXPECTED_UPDATED_AT_REQUIRED';
  end if;
  select * into v_template
  from public.request_templates
  where id = p_request_template_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'REQUEST_TEMPLATE_NOT_FOUND';
  end if;
  if v_template.updated_at <> p_expected_updated_at then
    raise exception using errcode = '40001', message = 'CONFLICT';
  end if;
  select * into v_draft
  from public.request_template_versions
  where request_template_id = v_template.id
    and status = 'DRAFT'
  order by version_number desc
  limit 1
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'REQUEST_TEMPLATE_DRAFT_REQUIRED';
  end if;
  if jsonb_typeof(v_draft.form_schema) <> 'array'
     or jsonb_array_length(v_draft.form_schema) = 0
     or not exists (
       select 1 from public.request_approval_blocks block
       where block.request_template_version_id = v_draft.id
     ) then
    raise exception using errcode = '22023', message = 'REQUEST_FORM_SCHEMA_INVALID';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_draft.form_schema) field
    where jsonb_typeof(field) <> 'object'
       or nullif(trim(field ->> 'key'), '') is null
       or nullif(trim(field ->> 'label'), '') is null
       or coalesce(field ->> 'fieldType', '') not in (
         'text', 'textarea', 'number', 'date', 'select', 'table', 'user', 'file'
       )
  ) or exists (
    select field ->> 'key'
    from jsonb_array_elements(v_draft.form_schema) field
    group by field ->> 'key'
    having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'REQUEST_FORM_SCHEMA_INVALID';
  end if;
  if exists (
    select 1
    from public.request_approval_blocks block
    left join public.users app_user
      on app_user.id = any(block.fixed_user_ids)
    where block.request_template_version_id = v_draft.id
      and block.approver_source in ('FIXED_SINGLE', 'FIXED_MULTI')
      and (
        cardinality(block.fixed_user_ids) = 0
        or exists (
          select 1
          from unnest(block.fixed_user_ids) fixed_id
          left join public.users fixed_user on fixed_user.id = fixed_id
          where fixed_user.id is null
             or not coalesce(fixed_user.is_active, true)
             or coalesce(fixed_user.account_status, 'ACTIVE') <> 'ACTIVE'
        )
      )
  ) then
    raise exception using errcode = '22023', message = 'REQUEST_APPROVER_INACTIVE';
  end if;

  v_docx_path := v_draft.print_config ->> 'docxStoragePath';
  if v_docx_path is not null and v_docx_path <> '' then
    if not exists (
      select 1
      from public.request_print_templates print_template
      where print_template.request_template_version_id = v_draft.id
        and print_template.storage_path = v_docx_path
        and print_template.validation_status = 'VALID'
    ) then
      raise exception using errcode = '22023', message = 'REQUEST_PRINT_TEMPLATE_INVALID';
    end if;
    if exists (
      select 1
      from public.request_print_templates print_template
      cross join lateral jsonb_object_keys(
        case
          when jsonb_typeof(print_template.placeholder_schema) = 'object'
            then print_template.placeholder_schema
          else '{}'::jsonb
        end
      ) placeholder_key
      where print_template.request_template_version_id = v_draft.id
        and print_template.storage_path = v_docx_path
        and print_template.validation_status = 'VALID'
        and placeholder_key not in (
          select field ->> 'key'
          from jsonb_array_elements(v_draft.form_schema) field
          union all
          select value from jsonb_array_elements_text(
            '["title","description","requestCode","createdAt","createdBy"]'::jsonb
          )
        )
    ) then
      raise exception using errcode = '22023', message = 'REQUEST_PRINT_PLACEHOLDER_UNKNOWN';
    end if;
    if exists (
      select 1
      from public.request_print_templates print_template
      where print_template.request_template_version_id = v_draft.id
        and print_template.storage_path = v_docx_path
        and jsonb_typeof(print_template.placeholder_schema) <> 'object'
    ) then
      raise exception using errcode = '22023', message = 'REQUEST_PRINT_PLACEHOLDER_INVALID';
    end if;
  end if;

  v_workflow_template_id := gen_random_uuid();
  insert into public.workflow_templates(
    id, name, description, created_by, is_active, custom_fields,
    managers, default_watchers
  ) values (
    v_workflow_template_id,
    '[Request] ' || v_template.name,
    coalesce(v_template.description, ''),
    v_actor,
    true,
    jsonb_build_array(jsonb_build_object('_requestTemplateId', v_template.id)),
    '{}'::text[],
    '{}'::text[]
  );
  update public.request_templates
  set workflow_template_id = v_workflow_template_id
  where id = v_template.id;

  insert into public.workflow_nodes(id, template_id, type, label, config, position_x, position_y)
  values (
    v_start_node_id, v_workflow_template_id, 'START'::public.workflow_node_type,
    'Bắt đầu đề xuất', jsonb_build_object('executionPolicy', 'AUTO_ADVANCE_APPROVAL'), 0, 0
  );

  for v_block in
    select *
    from public.request_approval_blocks
    where request_template_version_id = v_draft.id
    order by sort_order, block_key
  loop
    v_node_id := gen_random_uuid();
    v_block_ids := array_append(v_block_ids, v_node_id);
    insert into public.workflow_nodes(
      id, template_id, type, label, config, position_x, position_y
    ) values (
      v_node_id,
      v_workflow_template_id,
      'APPROVAL'::public.workflow_node_type,
      v_block.name,
      jsonb_build_object(
        'executionPolicy', 'AUTO_ADVANCE_APPROVAL',
        'requestBlockKey', v_block.block_key,
        'approverSource', v_block.approver_source,
        'fixedUserIds', to_jsonb(v_block.fixed_user_ids),
        'minimumDynamicApprovers', v_block.minimum_dynamic_approvers,
        'flowMode', v_draft.flow_mode,
        'completionPolicy', v_draft.completion_policy,
        'slaHours', v_block.sla_hours
      ),
      v_block.sort_order * 240 + 180,
      v_block.sort_order * 120
    );
  end loop;

  insert into public.workflow_nodes(id, template_id, type, label, config, position_x, position_y)
  values (
    v_end_node_id, v_workflow_template_id, 'END'::public.workflow_node_type,
    'Hoàn thành đề xuất', jsonb_build_object('executionPolicy', 'AUTO_ADVANCE_APPROVAL'),
    (coalesce(array_length(v_block_ids, 1), 0) + 1) * 240, 0
  );

  if v_draft.flow_mode = 'PARALLEL' then
    for v_number in 1..coalesce(array_length(v_block_ids, 1), 0) loop
      insert into public.workflow_edges(template_id, source_node_id, target_node_id, label)
      values (v_workflow_template_id, v_start_node_id, v_block_ids[v_number], 'Bước duyệt');
      insert into public.workflow_edges(template_id, source_node_id, target_node_id, label)
      values (v_workflow_template_id, v_block_ids[v_number], v_end_node_id, 'Hoàn tất');
    end loop;
  else
    v_next_node_id := v_start_node_id;
    for v_number in 1..coalesce(array_length(v_block_ids, 1), 0) loop
      insert into public.workflow_edges(template_id, source_node_id, target_node_id, label)
      values (v_workflow_template_id, v_next_node_id, v_block_ids[v_number], 'Bước kế tiếp');
      v_next_node_id := v_block_ids[v_number];
    end loop;
    insert into public.workflow_edges(template_id, source_node_id, target_node_id, label)
    values (v_workflow_template_id, v_next_node_id, v_end_node_id, 'Hoàn tất');
  end if;

  select coalesce(max(version_number), 0) + 1
    into v_number
  from public.workflow_template_versions
  where template_id = v_workflow_template_id;
  v_snapshot := jsonb_build_object(
    'template', (select to_jsonb(template) from public.workflow_templates template where template.id = v_workflow_template_id),
    'nodes', coalesce((
      select jsonb_agg(to_jsonb(node) order by node.position_y, node.position_x, node.id)
      from public.workflow_nodes node
      where node.template_id = v_workflow_template_id
    ), '[]'::jsonb),
    'edges', coalesce((
      select jsonb_agg(to_jsonb(edge) order by edge.id)
      from public.workflow_edges edge
      where edge.template_id = v_workflow_template_id
    ), '[]'::jsonb)
  );
  insert into public.workflow_template_versions(
    template_id, version_number, name, description, custom_fields,
    managers, default_watchers, snapshot, created_by
  )
  select workflow_template.id, v_number, workflow_template.name,
    workflow_template.description, workflow_template.custom_fields,
    workflow_template.managers, workflow_template.default_watchers,
    v_snapshot, v_actor
  from public.workflow_templates workflow_template
  where workflow_template.id = v_workflow_template_id
  returning id into v_workflow_version_id;

  select * into v_old_version
  from public.request_template_versions
  where request_template_id = v_template.id
    and status = 'PUBLISHED'
  order by version_number desc
  limit 1
  for update;
  if found then
    update public.request_template_versions
    set status = 'SUPERSEDED'
    where id = v_old_version.id;
  end if;
  update public.request_template_versions
  set status = 'PUBLISHED',
      workflow_template_version_id = v_workflow_version_id,
      published_by = v_actor,
      published_at = now()
  where id = v_draft.id;
  update public.request_templates
  set lifecycle_status = 'PUBLISHED', current_version_id = v_draft.id
  where id = v_template.id;

  return jsonb_build_object(
    'requestTemplateId', v_template.id,
    'requestTemplateVersionId', v_draft.id,
    'versionNumber', v_draft.version_number,
    'workflowTemplateId', v_workflow_template_id,
    'workflowTemplateVersionId', v_workflow_version_id
  );
end;
$$;

-- A copy is a new template lineage. The source version remains immutable and
-- the target starts as version 1 in DRAFT state.
create or replace function app_private.duplicate_request_template(
  p_request_template_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_source_template public.request_templates%rowtype;
  v_source_version public.request_template_versions%rowtype;
  v_target_template public.request_templates%rowtype;
  v_target_version public.request_template_versions%rowtype;
  v_base_name text;
  v_copy_name text;
  v_suffix integer := 1;
begin
  if v_actor is null or not app_private.request_user_can_manage(v_actor) then
    raise exception using errcode = '42501', message = 'REQUEST_TEMPLATE_FORBIDDEN';
  end if;

  select * into v_source_template
  from public.request_templates
  where id = p_request_template_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'REQUEST_TEMPLATE_NOT_FOUND';
  end if;

  select * into v_source_version
  from public.request_template_versions version
  where version.request_template_id = v_source_template.id
  order by
    case version.status
      when 'DRAFT' then 1
      when 'PUBLISHED' then 2
      when 'SUPERSEDED' then 3
      else 4
    end,
    version.version_number desc
  limit 1;
  if not found then
    raise exception using errcode = '22023', message = 'REQUEST_TEMPLATE_VERSION_REQUIRED';
  end if;

  v_base_name := v_source_template.name || ' - Bản sao';
  v_copy_name := v_base_name;
  while exists (
    select 1
    from public.request_templates existing_template
    where lower(existing_template.name) = lower(v_copy_name)
  ) loop
    v_suffix := v_suffix + 1;
    v_copy_name := format('%s (%s)', v_base_name, v_suffix);
  end loop;

  insert into public.request_templates(
    name, description, lifecycle_status, current_version_id, created_by
  ) values (
    v_copy_name,
    coalesce(v_source_template.description, ''),
    'DRAFT',
    null,
    v_actor
  ) returning * into v_target_template;

  insert into public.request_template_versions(
    request_template_id, version_number, form_schema, usage_scope,
    flow_mode, completion_policy, request_sla_hours, print_config,
    notification_config, status, created_by
  ) values (
    v_target_template.id,
    1,
    v_source_version.form_schema,
    v_source_version.usage_scope,
    v_source_version.flow_mode,
    v_source_version.completion_policy,
    v_source_version.request_sla_hours,
    v_source_version.print_config,
    v_source_version.notification_config,
    'DRAFT',
    v_actor
  ) returning * into v_target_version;

  insert into public.request_approval_blocks(
    request_template_version_id, block_key, name, sort_order, approver_source,
    fixed_user_ids, minimum_dynamic_approvers, sla_hours, is_required
  )
  select v_target_version.id, block_key, name, sort_order, approver_source,
    fixed_user_ids, minimum_dynamic_approvers, sla_hours, is_required
  from public.request_approval_blocks
  where request_template_version_id = v_source_version.id;

  insert into public.request_template_watchers(request_template_version_id, user_id)
  select v_target_version.id, user_id
  from public.request_template_watchers
  where request_template_version_id = v_source_version.id
  on conflict do nothing;

  insert into public.request_print_templates(
    request_template_version_id, name, file_name, storage_path,
    validation_status, placeholder_schema
  )
  select v_target_version.id, name, file_name, storage_path,
    validation_status, placeholder_schema
  from public.request_print_templates
  where request_template_version_id = v_source_version.id;

  return jsonb_build_object(
    'id', v_target_template.id,
    'draftVersionId', v_target_version.id,
    'status', v_target_version.status,
    'versionNumber', v_target_version.version_number,
    'updatedAt', v_target_template.updated_at,
    'payload', app_private.request_template_draft_payload(v_target_version.id)
  );
end;
$$;

create or replace function public.duplicate_request_template(
  p_request_template_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.duplicate_request_template(p_request_template_id);
$$;

revoke all on function app_private.duplicate_request_template(uuid)
  from public, anon, authenticated;
grant execute on function app_private.duplicate_request_template(uuid) to authenticated;
revoke all on function public.duplicate_request_template(uuid) from public, anon;
grant execute on function public.duplicate_request_template(uuid) to authenticated;
