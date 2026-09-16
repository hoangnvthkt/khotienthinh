-- Close the remaining direct mutation path for running workflow instances.
-- Assigned actors may update only fields namespaced to the current step;
-- workflow instance administrators may update instance-level content.

create or replace function app_private.workflow_instance_actor_is_current_assignee(
  p_instance_id uuid,
  p_actor_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workflow_instances i
    join public.workflow_nodes n on n.id = i.current_node_id
    left join public.users u on u.id = p_actor_id
    where i.id = p_instance_id
      and i.status = 'RUNNING'
      and (
        coalesce(i.step_assignees ->> i.current_node_id::text, '') = p_actor_id::text
        or (
          jsonb_typeof(i.step_assignees -> i.current_node_id::text) = 'array'
          and exists (
            select 1
            from jsonb_array_elements_text(i.step_assignees -> i.current_node_id::text) assignee(user_id)
            where assignee.user_id = p_actor_id::text
          )
        )
        or coalesce(n.config ->> 'assigneeUserId', '') = p_actor_id::text
        or (
          u.id is not null
          and coalesce(n.config ->> 'assigneeRole', '') = u.role::text
        )
        or (
          i.created_by = p_actor_id
          and i.current_node_id = (
            select first_edge.target_node_id
            from public.workflow_nodes start_node
            join public.workflow_edges first_edge
              on first_edge.source_node_id = start_node.id
            where start_node.template_id = i.template_id
              and start_node.type = 'START'
            limit 1
          )
          and exists (
            select 1
            from public.workflow_instance_logs revision_log
            where revision_log.instance_id = i.id
              and revision_log.action = 'REVISION_REQUESTED'
          )
        )
      )
  );
$$;

revoke all on function app_private.workflow_instance_actor_is_current_assignee(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.update_workflow_instance_content(
  p_instance_id uuid,
  p_title text,
  p_form_data jsonb,
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
  i public.workflow_instances%rowtype;
  v_is_admin boolean;
  v_is_assigned boolean;
  v_step_prefix text;
  v_result jsonb;
begin
  v_cached := app_private.workflow_command_begin(
    v_actor,
    p_idempotency_key,
    'update_workflow_instance_content',
    jsonb_build_object(
      'instanceId', p_instance_id,
      'title', p_title,
      'formData', p_form_data
    )
  );
  if v_cached is not null then return v_cached; end if;

  select * into i
  from public.workflow_instances
  where id = p_instance_id
  for update;

  if i.id is null
     or i.status <> 'RUNNING'
     or exists (
       select 1 from public.request_instances request_instance
       where request_instance.workflow_instance_id = i.id
     )
     or exists (
       select 1 from public.workflow_subjects subject
       where subject.workflow_instance_id = i.id
     ) then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
  end if;

  v_is_admin := app_private.workflow_has_action(
    'workflow.instance.administer', i.created_by, null, v_actor
  );
  v_is_assigned := app_private.workflow_instance_actor_is_current_assignee(i.id, v_actor);

  if not v_is_admin and not v_is_assigned then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
  end if;

  if p_title is not null then
    if btrim(p_title) = '' then
      raise exception 'WORKFLOW_TITLE_REQUIRED' using errcode = '22023';
    end if;
    if p_title is distinct from i.title and not v_is_admin then
      raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
    end if;
  end if;

  if p_form_data is not null and jsonb_typeof(p_form_data) <> 'object' then
    raise exception 'WORKFLOW_FORM_DATA_INVALID' using errcode = '22023';
  end if;

  if p_form_data is not null
     and p_form_data is distinct from i.form_data
     and not v_is_admin then
    v_step_prefix := 'step_' || i.current_node_id::text || '_';
    if exists (
      select 1
      from (
        select jsonb_object_keys(coalesce(i.form_data, '{}'::jsonb)) as field_key
        union
        select jsonb_object_keys(p_form_data) as field_key
      ) fields
      where left(fields.field_key, length(v_step_prefix)) <> v_step_prefix
        and i.form_data -> fields.field_key is distinct from p_form_data -> fields.field_key
    ) then
      raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
    end if;
  end if;

  update public.workflow_instances
  set title = case when p_title is null then i.title else btrim(p_title) end,
      form_data = coalesce(p_form_data, i.form_data),
      updated_at = now()
  where id = i.id
  returning * into i;

  v_result := jsonb_build_object('instance', to_jsonb(i));
  return app_private.workflow_command_finish(v_actor, p_idempotency_key, v_result);
end;
$$;

revoke all on function public.update_workflow_instance_content(uuid, text, jsonb, uuid)
  from public, anon;
grant execute on function public.update_workflow_instance_content(uuid, text, jsonb, uuid)
  to authenticated;

-- All lifecycle/content mutation now goes through guarded security-definer RPCs.
revoke update, delete on public.workflow_instances from public, anon, authenticated;
revoke update, delete on public.workflow_instance_logs from public, anon, authenticated;

comment on function public.update_workflow_instance_content(uuid, text, jsonb, uuid) is
  'Updates RUNNING generic workflow content. Assigned actors may change only current-step namespaced form fields; workflow.instance.administer may change instance-level content.';
