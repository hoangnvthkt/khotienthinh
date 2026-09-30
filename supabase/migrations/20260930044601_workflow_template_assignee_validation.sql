-- Block publishing (or saving an active) generic workflow template whose steps
-- have nobody who can be picked to handle them. Mirrors the client candidate
-- resolver (lib/workflowAssignmentResolver.ts resolveWorkflowStepAssigneeCandidates):
--   creator mode       -> ticket creator
--   previous_assignee  -> whoever approved the previous step (not valid on the first step)
--   assigneeUserId     -> that user
--   assignmentTargets  -> listed users + active employees of listed departments (filtered by assigneeRole if set)
--   assigneeRole only  -> active users with that role (legacy)
-- Project material-request and Request-module templates have their own
-- eligibility rules (project staff / permission codes) and are skipped.

create or replace function app_private.workflow_template_assignee_errors(p_template_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_template public.workflow_templates%rowtype;
  v_first_task_id uuid;
  v_node record;
  v_mode text;
  v_role text;
  v_fixed text;
  v_has_targets boolean;
  v_errors text[] := '{}'::text[];
begin
  select * into v_template from public.workflow_templates where id = p_template_id;
  if v_template.id is null then return v_errors; end if;

  if v_template.owner_subject_type is not null
     or exists (
       select 1 from public.project_workflow_bindings b
       where b.workflow_template_id = p_template_id and b.is_active
     )
     or exists (
       select 1 from jsonb_array_elements(coalesce(v_template.custom_fields, '[]'::jsonb)) field(value)
       where jsonb_typeof(field.value) = 'object'
         and nullif(btrim(coalesce(field.value ->> '_requestTemplateId', '')), '') is not null
     ) then
    return v_errors;
  end if;

  select e.target_node_id into v_first_task_id
  from public.workflow_nodes s
  join public.workflow_edges e on e.source_node_id = s.id
  where s.template_id = p_template_id
    and s.type = 'START'::public.workflow_node_type
    and coalesce((s.config ->> '__templateRemoved')::boolean, false) = false
  limit 1;

  for v_node in
    select wn.id, wn.label, wn.config
    from public.workflow_nodes wn
    where wn.template_id = p_template_id
      and wn.type not in ('START'::public.workflow_node_type, 'END'::public.workflow_node_type)
      and coalesce((wn.config ->> '__templateRemoved')::boolean, false) = false
    order by wn.position_y, wn.id
  loop
    v_mode := coalesce(nullif(v_node.config ->> 'assignmentMode', ''), 'select_on_transition');
    v_role := nullif(v_node.config ->> 'assigneeRole', '');
    v_fixed := nullif(v_node.config ->> 'assigneeUserId', '');

    if v_mode = 'creator' then
      continue;
    end if;

    if v_mode = 'previous_assignee' then
      if v_node.id = v_first_task_id then
        v_errors := array_append(v_errors, format(
          'Bước "%s" là bước đầu tiên nên không có "người đã xử lý bước trước".', v_node.label));
      end if;
      continue;
    end if;

    if v_fixed is not null then
      if not exists (
        select 1 from public.users u
        where u.id::text = v_fixed and u.is_active and u.account_status = 'ACTIVE'
      ) then
        v_errors := array_append(v_errors, format(
          'Bước "%s": người xử lý cố định đã nghỉ hoặc bị khóa tài khoản.', v_node.label));
      end if;
      continue;
    end if;

    v_has_targets := jsonb_typeof(v_node.config -> 'assignmentTargets') = 'array'
      and exists (
        select 1 from jsonb_array_elements(v_node.config -> 'assignmentTargets') target(value)
        where (target.value ->> 'type' = 'user' and nullif(target.value ->> 'userId', '') is not null)
           or (target.value ->> 'type' = 'department' and nullif(target.value ->> 'orgUnitId', '') is not null)
      );

    if v_has_targets then
      if not exists (
        select 1
        from public.users u
        where u.is_active and u.account_status = 'ACTIVE'
          and (v_role is null or u.role::text = v_role)
          and (
            exists (
              select 1 from jsonb_array_elements(v_node.config -> 'assignmentTargets') target(value)
              where target.value ->> 'type' = 'user' and target.value ->> 'userId' = u.id::text
            )
            or exists (
              select 1
              from jsonb_array_elements(v_node.config -> 'assignmentTargets') target(value)
              join public.employees e
                on e.department_id::text = target.value ->> 'orgUnitId'
                or e.org_unit_id::text = target.value ->> 'orgUnitId'
              where target.value ->> 'type' = 'department'
                and e.user_id::text = u.id::text
                and coalesce(e.status, 'Đang làm việc') = 'Đang làm việc'
            )
          )
      ) then
        v_errors := array_append(v_errors, format(
          'Bước "%s": danh sách người xử lý không còn ai đang làm việc.', v_node.label));
      end if;
      continue;
    end if;

    if v_role is not null then
      if not exists (
        select 1 from public.users u
        where u.role::text = v_role and u.is_active and u.account_status = 'ACTIVE'
      ) then
        v_errors := array_append(v_errors, format(
          'Bước "%s": không có ai thuộc vai trò được chỉ định.', v_node.label));
      end if;
      continue;
    end if;

    v_errors := array_append(v_errors, format('Bước "%s" chưa có người xử lý.', v_node.label));
  end loop;

  return v_errors;
end;
$$;

revoke all on function app_private.workflow_template_assignee_errors(uuid) from public;

create or replace function public.publish_workflow_template(p_template_id uuid, p_is_active boolean, p_idempotency_key uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid := app_private.workflow_notification_actor();
  v_cached jsonb;
  v_template public.workflow_templates%rowtype;
  v_validation jsonb;
  v_assignee_errors text[];
begin
  v_cached := app_private.workflow_command_begin(
    v_actor, p_idempotency_key, 'publish_workflow_template',
    jsonb_build_object('templateId', p_template_id, 'isActive', p_is_active)
  );
  if v_cached is not null then return v_cached; end if;
  if not app_private.workflow_template_actor_can_publish(p_template_id, v_actor) then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
  end if;
  if p_is_active then
    v_validation := app_private.project_workflow_validate_template(p_template_id);
    if not coalesce((v_validation ->> 'valid')::boolean, false) then
      raise exception 'WORKFLOW_TEMPLATE_INVALID' using errcode = '22023';
    end if;
    v_assignee_errors := app_private.workflow_template_assignee_errors(p_template_id);
    if cardinality(v_assignee_errors) > 0 then
      raise exception 'WORKFLOW_STEP_ASSIGNEE_MISSING'
        using errcode = '22023', detail = array_to_string(v_assignee_errors, E'\n');
    end if;
  end if;
  update public.workflow_templates
  set is_active = coalesce(p_is_active, is_active), updated_at = now()
  where id = p_template_id
  returning * into v_template;
  if v_template.id is null then raise exception 'WORKFLOW_TEMPLATE_NOT_FOUND' using errcode = 'P0002'; end if;
  return app_private.workflow_command_finish(
    v_actor, p_idempotency_key, jsonb_build_object('template', to_jsonb(v_template))
  );
end;
$$;

create or replace function public.save_workflow_template_structure(p_template_id uuid, p_template jsonb, p_nodes jsonb, p_edges jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_before public.workflow_templates%rowtype;
  v_validation jsonb;
  v_assignee_errors text[];
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  select * into v_before from public.workflow_templates where id = p_template_id for update;
  if v_before.id is null then raise exception 'workflow template not found' using errcode = 'P0002'; end if;
  if not app_private.workflow_template_actor_can_edit(p_template_id, v_actor) then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
  end if;
  if (p_template ? 'is_active')
     and (p_template ->> 'is_active')::boolean is distinct from v_before.is_active
     and not app_private.workflow_template_actor_can_publish(p_template_id, v_actor) then
    raise exception 'WORKFLOW_PUBLISH_REQUIRED' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_nodes, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_edges, '[]'::jsonb)) <> 'array' then
    raise exception 'nodes and edges must be arrays';
  end if;

  update public.workflow_templates
  set name = coalesce(nullif(p_template ->> 'name', ''), name),
      description = coalesce(p_template ->> 'description', description),
      is_active = coalesce((p_template ->> 'is_active')::boolean, is_active),
      custom_fields = coalesce(p_template -> 'custom_fields', custom_fields, '[]'::jsonb),
      managers = coalesce(array(select jsonb_array_elements_text(p_template -> 'managers')), managers, '{}'::text[]),
      default_watchers = coalesce(array(select jsonb_array_elements_text(p_template -> 'default_watchers')), default_watchers, '{}'::text[]),
      updated_at = now()
  where id = p_template_id;

  delete from public.workflow_edges where template_id = p_template_id;
  with input_node_ids as (
    select (node.value ->> 'id')::uuid as id
    from jsonb_array_elements(p_nodes) node(value)
    where nullif(node.value ->> 'id', '') is not null
  ), removed_nodes as (
    select wn.id from public.workflow_nodes wn
    where wn.template_id = p_template_id
      and not exists (select 1 from input_node_ids input_node where input_node.id = wn.id)
  ), hard_deleted as (
    delete from public.workflow_nodes wn using removed_nodes removed
    where wn.id = removed.id
      and not exists (select 1 from public.workflow_instances wi where wi.current_node_id = wn.id)
      and not exists (select 1 from public.workflow_subjects ws where ws.current_node_id = wn.id)
      and not exists (select 1 from public.workflow_instance_logs wil where wil.node_id = wn.id)
      and not exists (select 1 from public.workflow_step_assignments wsa where wsa.node_id = wn.id or wsa.return_to_node_id = wn.id)
      and not exists (select 1 from public.workflow_participants wp where wp.node_id = wn.id)
      and not exists (select 1 from public.workflow_instance_nodes win where win.template_node_id = wn.id)
    returning wn.id
  )
  update public.workflow_nodes wn
  set config = coalesce(wn.config, '{}'::jsonb) || jsonb_build_object('__templateRemoved', true)
  from removed_nodes removed
  where wn.id = removed.id
    and not exists (select 1 from hard_deleted deleted where deleted.id = wn.id);

  insert into public.workflow_nodes(id, template_id, type, label, config, position_x, position_y)
  select (node.value ->> 'id')::uuid, p_template_id,
    (node.value ->> 'type')::public.workflow_node_type, node.value ->> 'label',
    coalesce(node.value -> 'config', '{}'::jsonb) - '__templateRemoved',
    coalesce((node.value ->> 'position_x')::double precision, 0),
    coalesce((node.value ->> 'position_y')::double precision, 0)
  from jsonb_array_elements(p_nodes) node(value)
  on conflict (id) do update set type = excluded.type, label = excluded.label,
    config = excluded.config, position_x = excluded.position_x, position_y = excluded.position_y;

  insert into public.workflow_edges(id, template_id, source_node_id, target_node_id, label)
  select (edge.value ->> 'id')::uuid, p_template_id,
    (edge.value ->> 'source_node_id')::uuid, (edge.value ->> 'target_node_id')::uuid,
    coalesce(edge.value ->> 'label', '')
  from jsonb_array_elements(p_edges) edge(value);

  v_validation := app_private.project_workflow_validate_template(p_template_id);
  if (select is_active from public.workflow_templates where id = p_template_id) then
    if not coalesce((v_validation ->> 'valid')::boolean, false) then
      raise exception 'invalid workflow template structure: %', v_validation;
    end if;
    v_assignee_errors := app_private.workflow_template_assignee_errors(p_template_id);
    if cardinality(v_assignee_errors) > 0 then
      raise exception 'WORKFLOW_STEP_ASSIGNEE_MISSING'
        using errcode = '22023', detail = array_to_string(v_assignee_errors, E'\n');
    end if;
  end if;
  return v_validation || jsonb_build_object(
    'assigneeErrors', to_jsonb(coalesce(app_private.workflow_template_assignee_errors(p_template_id), '{}'::text[]))
  );
end;
$$;
