-- Real generic Workflow draft lifecycle. Request/Project workflows continue to
-- use their dedicated commands and are excluded from draft mutation commands.

update public.permission_actions
set grant_readiness = 'enforced',
    direct_grant_allowed = true,
    updated_at = now()
where permission_code in (
  'workflow.instance.edit_own_draft',
  'workflow.instance.delete_own_draft'
);

create or replace function app_private.workflow_actor_can_create_instance(p_actor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_actor_id is not null
    and (
      app_private.has_permission(
        p_actor_id, 'workflow.instance.create', 'global', '*'
      )
      or app_private.has_permission(
        p_actor_id, 'workflow.instance.create', 'own', p_actor_id::text
      )
      or (
        p_actor_id = public.current_app_user_id()
        and app_private.can_access_module('WF')
      )
    );
$$;

revoke all on function app_private.workflow_actor_can_create_instance(uuid)
  from public, anon, authenticated, service_role;

create or replace function app_private.workflow_actor_can_mutate_own_draft(
  p_instance_id uuid,
  p_permission_code text,
  p_actor_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_permission_code in (
      'workflow.instance.edit_own_draft',
      'workflow.instance.delete_own_draft'
    )
    and exists (
      select 1
      from public.workflow_instances instance_row
      where instance_row.id = p_instance_id
        and instance_row.status = 'DRAFT'
        and instance_row.created_by = p_actor_id
        and not exists (
          select 1 from public.request_instances request_instance
          where request_instance.workflow_instance_id = instance_row.id
        )
        and not exists (
          select 1 from public.workflow_subjects subject
          where subject.workflow_instance_id = instance_row.id
        )
        and (
          app_private.has_permission(
            p_actor_id, p_permission_code, 'own', p_actor_id::text
          )
          or (
            p_actor_id = public.current_app_user_id()
            and app_private.can_access_module('WF')
          )
        )
    );
$$;

revoke all on function app_private.workflow_actor_can_mutate_own_draft(uuid, text, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.create_workflow_instance_draft(
  p_input jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.workflow_notification_actor();
  v_cached jsonb;
  v_template public.workflow_templates%rowtype;
  v_instance public.workflow_instances%rowtype;
  v_start_node_id uuid;
  v_first_node_id uuid;
  v_assignee_ids uuid[];
  v_watchers text[];
  v_title text := btrim(coalesce(p_input ->> 'title', ''));
  v_form_data jsonb := coalesce(p_input -> 'formData', '{}'::jsonb);
begin
  v_cached := app_private.workflow_command_begin(
    v_actor, p_idempotency_key, 'create_workflow_instance_draft', p_input
  );
  if v_cached is not null then return v_cached; end if;

  if not app_private.workflow_actor_can_create_instance(v_actor) then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
  end if;
  if v_title = '' then
    raise exception 'WORKFLOW_TITLE_REQUIRED' using errcode = '22023';
  end if;
  if jsonb_typeof(v_form_data) <> 'object' then
    raise exception 'WORKFLOW_FORM_DATA_INVALID' using errcode = '22023';
  end if;

  select * into v_template
  from public.workflow_templates template_row
  where template_row.id = (p_input ->> 'templateId')::uuid
    and template_row.is_active
  for share;
  if v_template.id is null then
    raise exception 'WORKFLOW_TEMPLATE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select start_node.id into v_start_node_id
  from public.workflow_nodes start_node
  where start_node.template_id = v_template.id
    and start_node.type = 'START'
  limit 1;
  select first_edge.target_node_id into v_first_node_id
  from public.workflow_edges first_edge
  where first_edge.source_node_id = v_start_node_id
  limit 1;

  select coalesce(array_agg(distinct candidate_id), '{}'::uuid[])
  into v_assignee_ids
  from jsonb_array_elements_text(
    coalesce(p_input -> 'initialAssigneeUserIds', '[]'::jsonb)
  ) candidate(candidate_text)
  cross join lateral (select candidate.candidate_text::uuid as candidate_id) normalized
  join public.users user_row
    on user_row.id = normalized.candidate_id
   and user_row.is_active
   and user_row.account_status = 'ACTIVE';

  select coalesce(array_agg(distinct watcher_id), '{}'::text[])
  into v_watchers
  from unnest(coalesce(v_template.default_watchers, '{}'::text[])) watcher_id
  join public.users watcher
    on watcher.id::text = watcher_id
   and watcher.is_active
   and watcher.account_status = 'ACTIVE';

  insert into public.workflow_instances (
    template_id, code, title, created_by, current_node_id, status,
    form_data, watchers, step_assignees
  ) values (
    v_template.id,
    public.next_workflow_code(),
    v_title,
    v_actor,
    null,
    'DRAFT',
    v_form_data,
    v_watchers,
    case
      when v_first_node_id is null or cardinality(v_assignee_ids) = 0
        then '{}'::jsonb
      else app_private.workflow_assignee_json(v_first_node_id, v_assignee_ids)
    end
  ) returning * into v_instance;

  return app_private.workflow_command_finish(
    v_actor, p_idempotency_key,
    jsonb_build_object('instance', to_jsonb(v_instance))
  );
end;
$$;

create or replace function public.update_workflow_instance_draft(
  p_instance_id uuid,
  p_title text,
  p_form_data jsonb,
  p_initial_assignee_user_ids uuid[],
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.workflow_notification_actor();
  v_cached jsonb;
  v_instance public.workflow_instances%rowtype;
  v_start_node_id uuid;
  v_first_node_id uuid;
  v_assignee_ids uuid[];
begin
  v_cached := app_private.workflow_command_begin(
    v_actor, p_idempotency_key, 'update_workflow_instance_draft',
    jsonb_build_object(
      'instanceId', p_instance_id,
      'title', p_title,
      'formData', p_form_data,
      'initialAssigneeUserIds', p_initial_assignee_user_ids
    )
  );
  if v_cached is not null then return v_cached; end if;

  select * into v_instance
  from public.workflow_instances
  where id = p_instance_id
  for update;
  if v_instance.id is null
     or not app_private.workflow_actor_can_mutate_own_draft(
       v_instance.id, 'workflow.instance.edit_own_draft', v_actor
     ) then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
  end if;
  if p_title is not null and btrim(p_title) = '' then
    raise exception 'WORKFLOW_TITLE_REQUIRED' using errcode = '22023';
  end if;
  if p_form_data is not null and jsonb_typeof(p_form_data) <> 'object' then
    raise exception 'WORKFLOW_FORM_DATA_INVALID' using errcode = '22023';
  end if;

  select start_node.id into v_start_node_id
  from public.workflow_nodes start_node
  where start_node.template_id = v_instance.template_id
    and start_node.type = 'START'
  limit 1;
  select first_edge.target_node_id into v_first_node_id
  from public.workflow_edges first_edge
  where first_edge.source_node_id = v_start_node_id
  limit 1;

  if p_initial_assignee_user_ids is null then
    v_assignee_ids := null;
  else
    select coalesce(array_agg(distinct candidate_id), '{}'::uuid[])
    into v_assignee_ids
    from unnest(p_initial_assignee_user_ids) candidate_id
    join public.users user_row
      on user_row.id = candidate_id
     and user_row.is_active
     and user_row.account_status = 'ACTIVE';
    if cardinality(v_assignee_ids) <> cardinality(p_initial_assignee_user_ids) then
      raise exception 'WORKFLOW_ASSIGNEE_INVALID' using errcode = '22023';
    end if;
  end if;

  update public.workflow_instances
  set title = case when p_title is null then v_instance.title else btrim(p_title) end,
      form_data = coalesce(p_form_data, v_instance.form_data),
      step_assignees = case
        when p_initial_assignee_user_ids is null then v_instance.step_assignees
        when v_first_node_id is null or cardinality(v_assignee_ids) = 0 then '{}'::jsonb
        else app_private.workflow_assignee_json(v_first_node_id, v_assignee_ids)
      end,
      updated_at = now()
  where id = v_instance.id
  returning * into v_instance;

  return app_private.workflow_command_finish(
    v_actor, p_idempotency_key,
    jsonb_build_object('instance', to_jsonb(v_instance))
  );
end;
$$;

create or replace function public.delete_workflow_instance_draft(
  p_instance_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.workflow_notification_actor();
  v_cached jsonb;
  v_instance public.workflow_instances%rowtype;
  v_result jsonb;
begin
  v_cached := app_private.workflow_command_begin(
    v_actor, p_idempotency_key, 'delete_workflow_instance_draft',
    jsonb_build_object('instanceId', p_instance_id)
  );
  if v_cached is not null then return v_cached; end if;

  select * into v_instance
  from public.workflow_instances
  where id = p_instance_id
  for update;
  if v_instance.id is null
     or not app_private.workflow_actor_can_mutate_own_draft(
       v_instance.id, 'workflow.instance.delete_own_draft', v_actor
     ) then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
  end if;

  delete from public.workflow_instances where id = v_instance.id;
  v_result := jsonb_build_object('deletedInstanceId', v_instance.id);
  return app_private.workflow_command_finish(v_actor, p_idempotency_key, v_result);
end;
$$;

create or replace function public.submit_workflow_instance_draft(
  p_instance_id uuid,
  p_initial_assignee_user_ids uuid[],
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.workflow_notification_actor();
  v_cached jsonb;
  v_instance public.workflow_instances%rowtype;
  v_log public.workflow_instance_logs%rowtype;
  v_start_node_id uuid;
  v_first_node_id uuid;
  v_first_node_type public.workflow_node_type;
  v_assignee_ids uuid[];
begin
  v_cached := app_private.workflow_command_begin(
    v_actor, p_idempotency_key, 'submit_workflow_instance_draft',
    jsonb_build_object(
      'instanceId', p_instance_id,
      'initialAssigneeUserIds', p_initial_assignee_user_ids
    )
  );
  if v_cached is not null then return v_cached; end if;

  select * into v_instance
  from public.workflow_instances
  where id = p_instance_id
  for update;
  if v_instance.id is null
     or v_instance.status <> 'DRAFT'
     or v_instance.created_by <> v_actor
     or not app_private.workflow_actor_can_create_instance(v_actor)
     or exists (
       select 1 from public.request_instances request_instance
       where request_instance.workflow_instance_id = v_instance.id
     )
     or exists (
       select 1 from public.workflow_subjects subject
       where subject.workflow_instance_id = v_instance.id
     ) then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
  end if;

  select start_node.id into v_start_node_id
  from public.workflow_nodes start_node
  join public.workflow_templates template_row
    on template_row.id = start_node.template_id
   and template_row.is_active
  where start_node.template_id = v_instance.template_id
    and start_node.type = 'START'
  limit 1;
  select first_edge.target_node_id, first_node.type
  into v_first_node_id, v_first_node_type
  from public.workflow_edges first_edge
  join public.workflow_nodes first_node on first_node.id = first_edge.target_node_id
  where first_edge.source_node_id = v_start_node_id
  limit 1;
  if v_start_node_id is null or v_first_node_id is null then
    raise exception 'WORKFLOW_TEMPLATE_INCOMPLETE' using errcode = '22023';
  end if;

  if p_initial_assignee_user_ids is null or cardinality(p_initial_assignee_user_ids) = 0 then
    select coalesce(array_agg(value::uuid), '{}'::uuid[])
    into v_assignee_ids
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(v_instance.step_assignees -> v_first_node_id::text) = 'array'
          then v_instance.step_assignees -> v_first_node_id::text
        when jsonb_typeof(v_instance.step_assignees -> v_first_node_id::text) = 'string'
          then jsonb_build_array(v_instance.step_assignees ->> v_first_node_id::text)
        else '[]'::jsonb
      end
    ) saved(value);
  else
    select coalesce(array_agg(distinct candidate_id), '{}'::uuid[])
    into v_assignee_ids
    from unnest(p_initial_assignee_user_ids) candidate_id
    join public.users user_row
      on user_row.id = candidate_id
     and user_row.is_active
     and user_row.account_status = 'ACTIVE';
    if cardinality(v_assignee_ids) <> cardinality(p_initial_assignee_user_ids) then
      raise exception 'WORKFLOW_ASSIGNEE_INVALID' using errcode = '22023';
    end if;
  end if;

  if v_first_node_type <> 'END' and cardinality(v_assignee_ids) = 0 then
    raise exception 'WORKFLOW_ASSIGNEE_REQUIRED' using errcode = '22023';
  end if;

  update public.workflow_instances
  set status = 'RUNNING',
      current_node_id = v_first_node_id,
      step_assignees = case
        when v_first_node_type = 'END' then '{}'::jsonb
        else app_private.workflow_assignee_json(v_first_node_id, v_assignee_ids)
      end,
      updated_at = now()
  where id = v_instance.id
  returning * into v_instance;

  insert into public.workflow_instance_logs (
    instance_id, node_id, action, acted_by, comment
  ) values (
    v_instance.id, v_start_node_id, 'SUBMITTED', v_actor, 'Phiếu nháp được gửi xử lý'
  ) returning * into v_log;

  return app_private.workflow_command_finish(
    v_actor, p_idempotency_key,
    jsonb_build_object('instance', to_jsonb(v_instance), 'log', to_jsonb(v_log))
  );
end;
$$;

-- Add the missing creation guard to the existing immediate-submit command.
create or replace function public.create_workflow_instance_v2(
  p_input jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.workflow_notification_actor();
  v_cached jsonb;
  v_template public.workflow_templates%rowtype;
  v_instance public.workflow_instances%rowtype;
  v_log public.workflow_instance_logs%rowtype;
  v_node uuid;
  v_node_type public.workflow_node_type;
  v_assignees uuid[];
  v_watchers text[];
begin
  v_cached := app_private.workflow_command_begin(
    v_actor, p_idempotency_key, 'create_workflow_instance_v2', p_input
  );
  if v_cached is not null then return v_cached; end if;
  if not app_private.workflow_actor_can_create_instance(v_actor) then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_template
  from public.workflow_templates
  where id = (p_input ->> 'templateId')::uuid and is_active
  for share;
  if v_template.id is null then
    raise exception 'WORKFLOW_TEMPLATE_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_node := (p_input ->> 'firstNodeId')::uuid;
  select n.type into v_node_type
  from public.workflow_nodes n
  where n.id = v_node and n.template_id = v_template.id;
  if v_node_type is null then
    raise exception 'WORKFLOW_NODE_NOT_FOUND' using errcode = 'P0002';
  end if;
  select coalesce(array_agg(distinct value::uuid), '{}'::uuid[])
  into v_assignees
  from jsonb_array_elements_text(
    coalesce(p_input -> 'firstAssigneeUserIds', '[]'::jsonb)
  );
  if (v_node_type <> 'END' and cardinality(v_assignees) = 0) or exists (
    select 1 from unnest(v_assignees) candidate_id
    where not exists (
      select 1 from public.users u
      where u.id = candidate_id and u.is_active and u.account_status = 'ACTIVE'
    )
  ) then
    raise exception 'WORKFLOW_ASSIGNEE_REQUIRED' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct watcher_id), '{}'::text[])
  into v_watchers
  from unnest(coalesce(v_template.default_watchers, '{}'::text[])) watcher_id
  join public.users watcher
    on watcher.id::text = watcher_id
   and watcher.is_active
   and watcher.account_status = 'ACTIVE';
  insert into public.workflow_instances (
    template_id, code, title, created_by, current_node_id, status,
    form_data, watchers, step_assignees
  ) values (
    v_template.id,
    public.next_workflow_code(),
    btrim(p_input ->> 'title'),
    v_actor,
    v_node,
    'RUNNING',
    coalesce(p_input -> 'formData', '{}'::jsonb),
    v_watchers,
    jsonb_build_object(v_node::text, to_jsonb(v_assignees))
  ) returning * into v_instance;
  insert into public.workflow_instance_logs (
    instance_id, node_id, action, acted_by, comment
  ) values (
    v_instance.id, v_node, 'SUBMITTED', v_actor, ''
  ) returning * into v_log;
  return app_private.workflow_command_finish(
    v_actor, p_idempotency_key,
    jsonb_build_object('instance', to_jsonb(v_instance), 'log', to_jsonb(v_log))
  );
end;
$$;

revoke all on function public.create_workflow_instance_draft(jsonb, uuid)
  from public, anon;
grant execute on function public.create_workflow_instance_draft(jsonb, uuid)
  to authenticated;
revoke all on function public.update_workflow_instance_draft(uuid, text, jsonb, uuid[], uuid)
  from public, anon;
grant execute on function public.update_workflow_instance_draft(uuid, text, jsonb, uuid[], uuid)
  to authenticated;
revoke all on function public.delete_workflow_instance_draft(uuid, uuid)
  from public, anon;
grant execute on function public.delete_workflow_instance_draft(uuid, uuid)
  to authenticated;
revoke all on function public.submit_workflow_instance_draft(uuid, uuid[], uuid)
  from public, anon;
grant execute on function public.submit_workflow_instance_draft(uuid, uuid[], uuid)
  to authenticated;

-- Instance/log creation now has guarded command coverage as well.
revoke insert on public.workflow_instances from public, anon, authenticated;
revoke insert on public.workflow_instance_logs from public, anon, authenticated;

comment on function public.create_workflow_instance_draft(jsonb, uuid) is
  'Creates a generic Workflow DRAFT owned by the authenticated actor without starting processing.';
comment on function public.submit_workflow_instance_draft(uuid, uuid[], uuid) is
  'Atomically validates and submits an owned generic Workflow DRAFT to its first runtime step.';
