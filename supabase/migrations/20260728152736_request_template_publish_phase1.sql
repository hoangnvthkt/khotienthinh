-- Request template draft/publish commands.
-- A request template owns one hidden shared-workflow template. Every publish
-- creates immutable request/workflow snapshots; runtime never reads draft rows.

alter table public.request_templates
  add column if not exists workflow_template_id uuid
  references public.workflow_templates(id) on delete set null;

create index if not exists idx_request_templates_workflow_template
  on public.request_templates(workflow_template_id)
  where workflow_template_id is not null;

create or replace function app_private.request_template_draft_payload(
  p_template_version_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'templateId', version.request_template_id,
    'name', template.name,
    'description', coalesce(template.description, ''),
    'formSchema', coalesce(version.form_schema, '[]'::jsonb),
    'usageScope', coalesce(version.usage_scope, '{}'::jsonb),
    'flowMode', version.flow_mode,
    'completionPolicy', version.completion_policy,
    'requestSlaHours', version.request_sla_hours,
    'blocks', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'key', block.block_key,
          'name', block.name,
          'source', block.approver_source,
          'fixedUserIds', to_jsonb(block.fixed_user_ids),
          'minimumDynamicApprovers', block.minimum_dynamic_approvers,
          'slaHours', block.sla_hours,
          'sortOrder', block.sort_order
        ) order by block.sort_order, block.block_key
      )
      from public.request_approval_blocks block
      where block.request_template_version_id = version.id
    ), '[]'::jsonb),
    'watcherUserIds', coalesce((
      select jsonb_agg(watcher.user_id order by watcher.user_id)
      from public.request_template_watchers watcher
      where watcher.request_template_version_id = version.id
    ), '[]'::jsonb),
    'printConfig', coalesce(version.print_config, '{}'::jsonb),
    'notificationConfig', coalesce(version.notification_config, '{}'::jsonb)
  )
  from public.request_template_versions version
  join public.request_templates template
    on template.id = version.request_template_id
  where version.id = p_template_version_id
    and (
      app_private.request_user_can_manage(public.current_app_user_id())
      or app_private.request_template_version_can_select(
        version.id, public.current_app_user_id()
      )
    );
$$;

create or replace function app_private.request_template_summary(
  p_template_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', template.id,
    'name', template.name,
    'status', template.lifecycle_status,
    'publishedVersionNumber', (
      select version.version_number
      from public.request_template_versions version
      where version.id = template.current_version_id
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
$$;

create or replace function app_private.save_request_template_draft(
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
    update public.request_templates
    set name = v_name,
        description = coalesce(p_payload ->> 'description', ''),
        lifecycle_status = 'DRAFT'
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
      from unnest(v_fixed_ids) id
      left join public.users app_user on app_user.id = id
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
$$;

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
         'text', 'textarea', 'number', 'date', 'select', 'user', 'file'
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

  -- Every publish receives a fresh hidden workflow graph. Keeping old graphs
  -- intact makes workflow snapshots immutable and prevents stale nodes from
  -- leaking into a later request submission.
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

create or replace function public.save_request_template_draft(p_payload jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select app_private.save_request_template_draft(p_payload); $$;

create or replace function public.publish_request_template_version(
  p_request_template_id uuid,
  p_expected_updated_at timestamptz
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.publish_request_template_version(
    p_request_template_id, p_expected_updated_at
  );
$$;

create or replace function public.get_request_template_draft(p_request_template_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select case
    when app_private.request_user_can_manage(public.current_app_user_id()) then
      jsonb_build_object(
        'id', version.request_template_id,
        'status', version.status,
        'versionNumber', version.version_number,
        'updatedAt', version.updated_at,
        'payload', app_private.request_template_draft_payload(version.id)
      )
    else null
  end
  from public.request_template_versions version
  where version.request_template_id = p_request_template_id
    and version.status = 'DRAFT'
  order by version.version_number desc
  limit 1;
$$;

create or replace function public.list_request_templates(p_filters jsonb default '{}'::jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select jsonb_build_object('items', coalesce(jsonb_agg(item order by item ->> 'updatedAt' desc), '[]'::jsonb))
  from (
    select app_private.request_template_summary(template.id) as item
    from public.request_templates template
    left join public.request_template_versions version
      on version.id = template.current_version_id
    where (
      app_private.request_user_can_manage(public.current_app_user_id())
      or (
        template.lifecycle_status = 'PUBLISHED'
        and version.status = 'PUBLISHED'
        and app_private.request_template_version_can_use(version.id, public.current_app_user_id())
      )
    )
    and (
      nullif(p_filters ->> 'status', '') is null
      or template.lifecycle_status = p_filters ->> 'status'
    )
    and (
      nullif(trim(p_filters ->> 'search'), '') is null
      or template.name ilike '%' || trim(p_filters ->> 'search') || '%'
    )
  ) listed;
$$;

create or replace function app_private.create_request_template_draft_from_published(
  p_request_template_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  select * into v_template from public.request_templates where id = p_request_template_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'REQUEST_TEMPLATE_NOT_FOUND'; end if;
  select * into v_published
  from public.request_template_versions
  where request_template_id = v_template.id and status = 'PUBLISHED'
  order by version_number desc limit 1;
  if not found then raise exception using errcode = '22023', message = 'REQUEST_TEMPLATE_PUBLISHED_REQUIRED'; end if;
  if exists (
    select 1
    from public.request_print_templates print_template
    where print_template.request_template_version_id = v_published.id
  ) then
    raise exception using errcode = '22023', message = 'REQUEST_PRINT_TEMPLATE_CLONE_DOCX_UNSUPPORTED';
  end if;
  select coalesce(max(version_number), 0) + 1 into v_number
  from public.request_template_versions where request_template_id = v_template.id;
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
  ) select v_draft.id, block_key, name, sort_order, approver_source, fixed_user_ids,
    minimum_dynamic_approvers, sla_hours, is_required
  from public.request_approval_blocks where request_template_version_id = v_published.id;
  insert into public.request_template_watchers(request_template_version_id, user_id)
  select v_draft.id, user_id from public.request_template_watchers
  where request_template_version_id = v_published.id;
  update public.request_templates
  set lifecycle_status = 'DRAFT'
  where id = v_template.id
  returning * into v_template;
  return jsonb_build_object(
    'id', v_draft.request_template_id,
    'status', v_draft.status,
    'versionNumber', v_draft.version_number,
    'updatedAt', v_template.updated_at,
    'payload', app_private.request_template_draft_payload(v_draft.id)
  );
end;
$$;

create or replace function app_private.deactivate_request_template(
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
  update public.request_templates set lifecycle_status = 'DEACTIVATED' where id = v_template.id;
  return app_private.request_template_summary(v_template.id);
end;
$$;

create or replace function app_private.preview_request_template_resolvers(
  p_payload jsonb,
  p_sample_creator_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_block jsonb;
  v_source text;
  v_ids uuid[];
  v_resolved uuid;
  v_result jsonb := '[]'::jsonb;
begin
  if v_actor is null or not app_private.request_user_can_manage(v_actor) then
    raise exception using errcode = '42501', message = 'REQUEST_TEMPLATE_FORBIDDEN';
  end if;
  for v_block in select value from jsonb_array_elements(coalesce(p_payload -> 'blocks', '[]'::jsonb))
  loop
    v_source := v_block ->> 'source';
    select coalesce(array_agg(value::uuid), '{}'::uuid[]) into v_ids
    from jsonb_array_elements_text(coalesce(v_block -> 'fixedUserIds', '[]'::jsonb));
    if v_source = 'DIRECT_MANAGER' then
      v_resolved := app_private.resolve_request_direct_manager(p_sample_creator_id);
      v_ids := case when v_resolved is null then '{}'::uuid[] else array[v_resolved] end;
    end if;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'blockKey', v_block ->> 'key',
      'source', v_source,
      'resolvedUserIds', to_jsonb(v_ids),
      'errorCode', case
        when cardinality(v_ids) = 0 and v_source = 'DIRECT_MANAGER'
          then 'REQUEST_DIRECT_MANAGER_MISSING'
        when exists (
          select 1 from unnest(v_ids) resolved_id
          left join public.users app_user on app_user.id = resolved_id
          where app_user.id is null
             or not coalesce(app_user.is_active, true)
             or coalesce(app_user.account_status, 'ACTIVE') <> 'ACTIVE'
        ) then 'REQUEST_APPROVER_INACTIVE'
        else null
      end
    ));
  end loop;
  return jsonb_build_object('sampleCreatorId', p_sample_creator_id, 'blocks', v_result);
end;
$$;

create or replace function public.create_request_template_draft_from_published(
  p_request_template_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.create_request_template_draft_from_published(p_request_template_id);
$$;

create or replace function public.deactivate_request_template(
  p_request_template_id uuid,
  p_expected_updated_at timestamptz
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.deactivate_request_template(
    p_request_template_id, p_expected_updated_at
  );
$$;

create or replace function public.preview_request_template_resolvers(
  p_payload jsonb,
  p_sample_creator_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.preview_request_template_resolvers(
    p_payload, p_sample_creator_id
  );
$$;

revoke all on function app_private.request_template_draft_payload(uuid)
  from public, anon, authenticated;
revoke all on function app_private.request_template_summary(uuid)
  from public, anon, authenticated;
revoke all on function app_private.save_request_template_draft(jsonb)
  from public, anon, authenticated;
revoke all on function app_private.publish_request_template_version(uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function app_private.create_request_template_draft_from_published(uuid)
  from public, anon, authenticated;
revoke all on function app_private.deactivate_request_template(uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function app_private.preview_request_template_resolvers(jsonb, uuid)
  from public, anon, authenticated;
grant execute on function app_private.request_template_draft_payload(uuid) to authenticated;
grant execute on function app_private.request_template_summary(uuid) to authenticated;
grant execute on function app_private.save_request_template_draft(jsonb) to authenticated;
grant execute on function app_private.publish_request_template_version(uuid, timestamptz) to authenticated;
grant execute on function app_private.create_request_template_draft_from_published(uuid) to authenticated;
grant execute on function app_private.deactivate_request_template(uuid, timestamptz) to authenticated;
grant execute on function app_private.preview_request_template_resolvers(jsonb, uuid) to authenticated;

revoke all on function public.save_request_template_draft(jsonb) from public, anon;
revoke all on function public.publish_request_template_version(uuid, timestamptz) from public, anon;
revoke all on function public.get_request_template_draft(uuid) from public, anon;
revoke all on function public.list_request_templates(jsonb) from public, anon;
revoke all on function public.create_request_template_draft_from_published(uuid) from public, anon;
revoke all on function public.deactivate_request_template(uuid, timestamptz) from public, anon;
revoke all on function public.preview_request_template_resolvers(jsonb, uuid) from public, anon;
grant execute on function public.save_request_template_draft(jsonb) to authenticated;
grant execute on function public.publish_request_template_version(uuid, timestamptz) to authenticated;
grant execute on function public.get_request_template_draft(uuid) to authenticated;
grant execute on function public.list_request_templates(jsonb) to authenticated;
grant execute on function public.create_request_template_draft_from_published(uuid) to authenticated;
grant execute on function public.deactivate_request_template(uuid, timestamptz) to authenticated;
grant execute on function public.preview_request_template_resolvers(jsonb, uuid) to authenticated;
