-- Request module phase 3: watchers chosen on the create form.
--
-- submit_request gains a defaulted p_options {watcherIds}; approval routing is
-- unchanged. Dynamic approvers stay template blocks (named by the admin, e.g.
-- "Giám đốc vật tư") that the creator fills per step, in template order.

drop function if exists public.submit_request(uuid, text, text, jsonb, jsonb, text);
drop function if exists app_private.submit_request(uuid, text, text, jsonb, jsonb, text);
create or replace function app_private.submit_request(p_request_template_version_id uuid, p_title text, p_description text, p_form_data jsonb, p_dynamic_approvers_by_block jsonb, p_idempotency_key text, p_options jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'extensions'
    AS $$
declare
  v_actor uuid := public.current_app_user_id();
  v_template public.request_templates%rowtype;
  v_version public.request_template_versions%rowtype;
  v_workflow_version public.workflow_template_versions%rowtype;
  v_request public.request_instances%rowtype;
  v_instance public.workflow_instances%rowtype;
  v_subject public.workflow_subjects%rowtype;
  v_existing app_private.request_command_idempotency%rowtype;
  v_block record;
  v_dynamic_ids uuid[];
  v_resolved_ids uuid[];
  v_current_user_ids uuid[] := '{}'::uuid[];
  v_watcher_ids uuid[] := '{}'::uuid[];
  v_step_assignees jsonb := '{}'::jsonb;
  v_block_users jsonb := '{}'::jsonb;
  v_result jsonb;
  v_payload_hash text;
  v_request_code text;
  v_first_block_key text;
  v_first_node_id uuid;
  v_first_instance_node_id uuid;
  v_node_id uuid;
  v_instance_node_id uuid;
  v_assignment_round_id uuid := gen_random_uuid();
  v_current_block_keys jsonb := '[]'::jsonb;
  v_request_due_at timestamptz;
  v_block_due_at timestamptz;
  v_min_sort integer;
  v_user_id uuid;
  v_options jsonb := coalesce(p_options, '{}'::jsonb);
  v_option_watcher_ids uuid[] := '{}'::uuid[];
begin
  if v_actor is null or not exists (
    select 1 from public.users app_user
    where app_user.id = v_actor
      and coalesce(app_user.is_active, true)
      and coalesce(app_user.account_status, 'ACTIVE') = 'ACTIVE'
  ) then
    raise exception using errcode = '42501', message = 'REQUEST_AUTHENTICATION_REQUIRED';
  end if;
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception using errcode = '22023', message = 'REQUEST_IDEMPOTENCY_KEY_REQUIRED';
  end if;
  if nullif(trim(coalesce(p_title, '')), '') is null then
    raise exception using errcode = '22023', message = 'REQUEST_TITLE_REQUIRED';
  end if;
  if jsonb_typeof(coalesce(p_form_data, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_dynamic_approvers_by_block, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(v_options) <> 'object'
     or jsonb_typeof(coalesce(v_options -> 'watcherIds', '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'REQUEST_PAYLOAD_INVALID';
  end if;
  select coalesce(array_agg(distinct value::uuid), '{}'::uuid[])
    into v_option_watcher_ids
  from jsonb_array_elements_text(coalesce(v_options -> 'watcherIds', '[]'::jsonb));
  if cardinality(v_option_watcher_ids) > 50 or exists (
    select 1 from unnest(v_option_watcher_ids) as watcher(watcher_id)
    left join public.users app_user on app_user.id = watcher.watcher_id
    where app_user.id is null
       or not coalesce(app_user.is_active, true)
       or coalesce(app_user.account_status, 'ACTIVE') <> 'ACTIVE'
  ) then
    raise exception using errcode = '22023', message = 'REQUEST_WATCHER_INVALID';
  end if;

  v_payload_hash := encode(
    digest(
      jsonb_build_object(
        'requestTemplateVersionId', p_request_template_version_id,
        'title', p_title,
        'description', coalesce(p_description, ''),
        'formData', coalesce(p_form_data, '{}'::jsonb),
        'dynamicApproversByBlock', coalesce(p_dynamic_approvers_by_block, '{}'::jsonb),
        'options', v_options
      )::text,
      'sha256'
    ),
    'hex'
  );

  insert into app_private.request_command_idempotency(
    actor_id, idempotency_key, command_name, payload_hash
  ) values (
    v_actor, p_idempotency_key, 'submit_request', v_payload_hash
  ) on conflict (actor_id, idempotency_key) do nothing;

  select * into v_existing
  from app_private.request_command_idempotency
  where actor_id = v_actor
    and idempotency_key = p_idempotency_key
  for update;
  if v_existing.payload_hash <> v_payload_hash
     or v_existing.command_name <> 'submit_request' then
    raise exception using errcode = '40001', message = 'REQUEST_IDEMPOTENCY_CONFLICT';
  end if;
  if v_existing.result is not null then
    return v_existing.result;
  end if;

  select * into v_version
  from public.request_template_versions
  where id = p_request_template_version_id
    and status = 'PUBLISHED'
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'REQUEST_TEMPLATE_VERSION_NOT_PUBLISHED';
  end if;
  select * into v_template
  from public.request_templates
  where id = v_version.request_template_id
    and lifecycle_status = 'PUBLISHED'
  for update;
  if not found or not app_private.request_template_version_can_use(v_version.id, v_actor) then
    raise exception using errcode = '42501', message = 'REQUEST_TEMPLATE_FORBIDDEN';
  end if;
  if v_version.workflow_template_version_id is null then
    raise exception using errcode = '22023', message = 'REQUEST_WORKFLOW_VERSION_MISSING';
  end if;
  select * into v_workflow_version
  from public.workflow_template_versions
  where id = v_version.workflow_template_version_id;
  if not found then
    raise exception using errcode = '22023', message = 'REQUEST_WORKFLOW_VERSION_MISSING';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(v_version.form_schema, '[]'::jsonb)) field
    where coalesce((field ->> 'required')::boolean, false)
      and (
        not (coalesce(p_form_data, '{}'::jsonb) ? (field ->> 'key'))
        or nullif(trim(coalesce(p_form_data ->> (field ->> 'key'), '')), '') is null
      )
  ) then
    raise exception using errcode = '22023', message = 'REQUEST_REQUIRED_FIELD_MISSING';
  end if;

  select min(sort_order) into v_min_sort
  from public.request_approval_blocks
  where request_template_version_id = v_version.id;
  if v_min_sort is null then
    raise exception using errcode = '22023', message = 'REQUEST_APPROVAL_BLOCK_REQUIRED';
  end if;

  for v_block in
    select block.*
    from public.request_approval_blocks block
    where block.request_template_version_id = v_version.id
    order by block.sort_order, block.block_key
  loop
    v_dynamic_ids := '{}'::uuid[];
    if jsonb_typeof(p_dynamic_approvers_by_block -> v_block.block_key) = 'array' then
      select coalesce(array_agg(value::uuid), '{}'::uuid[])
        into v_dynamic_ids
      from jsonb_array_elements_text(p_dynamic_approvers_by_block -> v_block.block_key);
    end if;
    v_resolved_ids := app_private.resolve_request_block_approvers(
      v_block.id, v_actor, v_dynamic_ids
    );
    v_block_users := v_block_users || jsonb_build_object(
      v_block.block_key, to_jsonb(v_resolved_ids)
    );
    v_current_block_keys := case
      when v_version.flow_mode = 'PARALLEL'
        then v_current_block_keys || jsonb_build_array(v_block.block_key)
      when v_block.sort_order = v_min_sort
        then jsonb_build_array(v_block.block_key)
      else v_current_block_keys
    end;

    v_node_id := null;
    select node.id into v_node_id
    from public.workflow_nodes node
    where node.template_id = v_workflow_version.template_id
      and node.type = 'APPROVAL'::public.workflow_node_type
      and node.config ->> 'requestBlockKey' = v_block.block_key
    order by node.position_x, node.id
    limit 1;
    if v_node_id is null then
      raise exception using errcode = '22023', message = 'REQUEST_WORKFLOW_BLOCK_NODE_MISSING';
    end if;

    v_step_assignees := v_step_assignees || case
      when v_version.flow_mode = 'PARALLEL' or v_block.sort_order = v_min_sort
        then jsonb_build_object(v_node_id::text, to_jsonb(v_resolved_ids))
      else '{}'::jsonb
    end;

    if v_version.flow_mode = 'PARALLEL' or v_block.sort_order = v_min_sort then
      foreach v_user_id in array v_resolved_ids loop
        if v_user_id <> all(coalesce(v_current_user_ids, '{}'::uuid[])) then
          v_current_user_ids := array_append(v_current_user_ids, v_user_id);
        end if;
      end loop;
    end if;
  end loop;

  select block.block_key, node.id
    into v_first_block_key, v_first_node_id
  from public.request_approval_blocks block
  join public.workflow_nodes node
    on node.template_id = v_workflow_version.template_id
   and node.type = 'APPROVAL'::public.workflow_node_type
   and node.config ->> 'requestBlockKey' = block.block_key
  where block.request_template_version_id = v_version.id
    and block.sort_order = v_min_sort
  order by block.block_key, node.id
  limit 1;
  if v_first_node_id is null or cardinality(v_current_user_ids) = 0 then
    raise exception using errcode = '22023', message = 'REQUEST_APPROVER_REQUIRED';
  end if;

  if v_version.request_sla_hours is not null then
    v_request_due_at := now() + make_interval(hours => v_version.request_sla_hours::integer);
  end if;
  v_request_code := app_private.next_request_code();

  insert into public.request_instances(
    category_id, code, title, description, form_data, created_by, status,
    request_template_id, request_template_version_id, workflow_template_version_id,
    form_schema_snapshot, approval_config_snapshot, print_config_snapshot,
    submitted_at, due_at
  ) values (
    null, v_request_code, trim(p_title), coalesce(p_description, ''),
    coalesce(p_form_data, '{}'::jsonb), v_actor, 'PENDING',
    v_template.id, v_version.id, v_version.workflow_template_version_id,
    coalesce(v_version.form_schema, '[]'::jsonb),
    jsonb_build_object(
      'flowMode', v_version.flow_mode,
      'completionPolicy', v_version.completion_policy,
      'blocks', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', block.id,
          'key', block.block_key,
          'name', block.name,
          'source', block.approver_source,
          'fixedUserIds', to_jsonb(block.fixed_user_ids),
          'slaHours', block.sla_hours,
          'resolvedUserIds', v_block_users -> block.block_key
        ) order by block.sort_order, block.block_key)
        from public.request_approval_blocks block
        where block.request_template_version_id = v_version.id
      ), '[]'::jsonb),
      'assignmentRoundId', v_assignment_round_id
    ),
    coalesce(v_version.print_config, '{}'::jsonb),
    now(), v_request_due_at
  ) returning * into v_request;

  insert into public.workflow_instances(
    template_id, code, title, created_by, current_node_id, status,
    form_data, watchers, step_assignees, template_version_id
  ) values (
    v_workflow_version.template_id, v_request.code, v_request.title, v_actor,
    v_first_node_id, 'RUNNING'::public.workflow_instance_status,
    jsonb_build_object('subjectType', 'request', 'subjectId', v_request.id, 'requestCode', v_request.code),
    coalesce(v_workflow_version.default_watchers, '{}'::text[]),
    v_step_assignees, v_version.workflow_template_version_id
  ) returning * into v_instance;

  perform app_private.project_workflow_snapshot_instance(
    v_instance.id, v_version.workflow_template_version_id, v_workflow_version.template_id
  );
  select instance_node.id into v_first_instance_node_id
  from public.workflow_instance_nodes instance_node
  where instance_node.workflow_instance_id = v_instance.id
    and instance_node.template_node_id = v_first_node_id
  limit 1;
  update public.workflow_instances
  set current_instance_node_id = v_first_instance_node_id,
      updated_at = now()
  where id = v_instance.id
  returning * into v_instance;

  insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
  values (v_instance.id, v_first_node_id, 'SUBMITTED'::public.workflow_instance_action, v_actor, null);

  insert into public.workflow_subjects(
    workflow_instance_id, subject_type, subject_id,
    current_assignee_user_id, current_assignee_user_ids,
    current_node_id, current_instance_node_id, template_version_id,
    status, created_by
  ) values (
    v_instance.id, 'request', v_request.id::text,
    v_current_user_ids[1], v_current_user_ids, v_first_node_id,
    v_first_instance_node_id, v_version.workflow_template_version_id,
    'RUNNING', v_actor
  ) returning * into v_subject;

  update public.request_instances
  set workflow_instance_id = v_instance.id,
      workflow_subject_id = v_subject.id
  where id = v_request.id
  returning * into v_request;

  perform app_private.project_workflow_register_participant(
    v_subject.id, v_instance.id, v_actor, 'CREATOR', 'request_creator', v_request.id::text,
    null, null, v_actor
  );
  select coalesce(array_agg(watcher.user_id order by watcher.user_id), '{}'::uuid[])
    into v_watcher_ids
  from public.request_template_watchers watcher
  where watcher.request_template_version_id = v_version.id;
  foreach v_user_id in array v_watcher_ids loop
    perform app_private.project_workflow_register_participant(
      v_subject.id, v_instance.id, v_user_id, 'WATCHER', 'request_template', v_version.id::text,
      null, null, v_actor
    );
  end loop;

  for v_block in
    select block.*
    from public.request_approval_blocks block
    where block.request_template_version_id = v_version.id
    order by block.sort_order, block.block_key
  loop
    if v_version.flow_mode <> 'PARALLEL' and v_block.sort_order <> v_min_sort then
      continue;
    end if;
    select node.id into v_node_id
    from public.workflow_nodes node
    where node.template_id = v_workflow_version.template_id
      and node.type = 'APPROVAL'::public.workflow_node_type
      and node.config ->> 'requestBlockKey' = v_block.block_key
    order by node.position_x, node.id
    limit 1;
    select instance_node.id into v_instance_node_id
    from public.workflow_instance_nodes instance_node
    where instance_node.workflow_instance_id = v_instance.id
      and instance_node.template_node_id = v_node_id
    limit 1;
    select coalesce(array_agg(value::uuid), '{}'::uuid[])
      into v_resolved_ids
    from jsonb_array_elements_text(
      coalesce(
        (select block_snapshot -> 'resolvedUserIds'
         from jsonb_array_elements(
           v_request.approval_config_snapshot -> 'blocks'
         ) block_snapshot
         where block_snapshot ->> 'key' = v_block.block_key),
        '[]'::jsonb
      )
    ) value;
    if v_block.sla_hours is not null then
      v_block_due_at := now() + make_interval(hours => v_block.sla_hours::integer);
    else
      v_block_due_at := null;
    end if;
    foreach v_user_id in array v_resolved_ids loop
      insert into public.workflow_step_assignments(
        workflow_subject_id, workflow_instance_id, node_id, instance_node_id,
        assignee_user_id, assigned_by, status, assigned_at, due_at, sla_hours,
        assignment_source, assignment_group_type, assignment_group_id,
        assignment_round_id, metadata
      ) values (
        v_subject.id, v_instance.id, v_node_id, v_instance_node_id,
        v_user_id, v_actor, 'PENDING', now(), v_block_due_at,
        v_block.sla_hours::integer, v_block.approver_source, 'REQUEST_BLOCK',
        v_block.block_key, v_assignment_round_id,
        jsonb_build_object('requestId', v_request.id, 'requestBlockKey', v_block.block_key)
      );
      perform app_private.project_workflow_register_participant(
        v_subject.id, v_instance.id, v_user_id, 'ASSIGNEE', 'request_block',
        v_block.block_key, v_node_id, v_instance_node_id, v_actor
      );
      insert into app_private.request_notification_outbox(
        event_key, request_id, recipient_user_id, event_type, payload
      ) values (
        'request:' || v_request.id::text || ':SUBMITTED:' || v_user_id::text,
        v_request.id, v_user_id, 'REQUEST_SUBMITTED',
        jsonb_build_object(
          'requestId', v_request.id,
          'requestCode', v_request.code,
          'title', v_request.title,
          'blockKey', v_block.block_key
        )
      ) on conflict (event_key) do nothing;
    end loop;
  end loop;

  foreach v_user_id in array v_option_watcher_ids loop
    if v_user_id = v_actor then
      continue;
    end if;
    perform app_private.project_workflow_register_participant(
      v_subject.id, v_instance.id, v_user_id, 'WATCHER', 'request_manual', v_actor::text,
      null, null, v_actor
    );
    insert into app_private.request_notification_outbox(
      event_key, request_id, recipient_user_id, event_type, payload
    ) values (
      'request:' || v_request.id::text || ':WATCHER:' || v_user_id::text || ':submit',
      v_request.id, v_user_id, 'REQUEST_WATCHER_ADDED',
      jsonb_build_object('requestId', v_request.id, 'requestCode', v_request.code, 'addedBy', v_actor)
    ) on conflict (event_key) do nothing;
  end loop;

  v_result := jsonb_build_object(
    'requestId', v_request.id,
    'requestCode', v_request.code,
    'status', v_request.status,
    'workflowInstanceId', v_instance.id,
    'workflowSubjectId', v_subject.id,
    'currentBlockKeys', v_current_block_keys,
    'updatedAt', v_request.updated_at
  );
  update app_private.request_command_idempotency
  set request_id = v_request.id, result = v_result
  where id = v_existing.id;
  return v_result;
end;
$$;

create or replace function public.submit_request(
  p_request_template_version_id uuid,
  p_title text,
  p_description text default ''::text,
  p_form_data jsonb default '{}'::jsonb,
  p_dynamic_approvers_by_block jsonb default '{}'::jsonb,
  p_idempotency_key text default null::text,
  p_options jsonb default '{}'::jsonb
)
returns jsonb
language sql
set search_path to ''
as $function$
  select app_private.submit_request(
    p_request_template_version_id,
    p_title,
    p_description,
    p_form_data,
    p_dynamic_approvers_by_block,
    p_idempotency_key,
    p_options
  );
$function$;

revoke all on function app_private.submit_request(uuid, text, text, jsonb, jsonb, text, jsonb) from public, anon;
grant execute on function app_private.submit_request(uuid, text, text, jsonb, jsonb, text, jsonb) to authenticated;
revoke all on function public.submit_request(uuid, text, text, jsonb, jsonb, text, jsonb) from public, anon;
grant execute on function public.submit_request(uuid, text, text, jsonb, jsonb, text, jsonb) to authenticated;

-- The create form shows the whole approval flow in template order: dynamic
-- steps get a picker, fixed steps show their approvers.
create or replace function app_private.list_usable_request_templates()
returns jsonb
language sql
stable security definer
set search_path to ''
as $function$
  select jsonb_build_object('items', coalesce(jsonb_agg(item order by item ->> 'name'), '[]'::jsonb))
  from (
    select jsonb_build_object(
      'templateId', template.id,
      'templateVersionId', version.id,
      'name', template.name,
      'description', template.description,
      'versionNumber', version.version_number,
      'formSchema', version.form_schema,
      'flowMode', version.flow_mode,
      'completionPolicy', version.completion_policy,
      'approvalBlocks', coalesce((
        select jsonb_agg(jsonb_build_object(
          'key', block.block_key,
          'name', block.name,
          'source', block.approver_source,
          'minimumDynamicApprovers', block.minimum_dynamic_approvers,
          'sortOrder', block.sort_order,
          'fixedApprovers', coalesce((
            select jsonb_agg(app_private.request_user_snapshot(fixed.user_id) order by fixed.position)
            from unnest(block.fixed_user_ids) with ordinality as fixed(user_id, position)
          ), '[]'::jsonb)
        ) order by block.sort_order)
        from public.request_approval_blocks block
        where block.request_template_version_id = version.id
      ), '[]'::jsonb)
    ) as item
    from public.request_templates template
    join public.request_template_versions version on version.id = template.current_version_id
    where template.lifecycle_status = 'PUBLISHED'
      and version.status = 'PUBLISHED'
      and app_private.request_template_version_can_use(
        version.id, public.current_app_user_id()
      )
  ) usable;
$function$;
