-- Allow WF module/sub-module admins to create workflow templates and make
-- template structure saves stable when removed nodes are still referenced by
-- historical workflow instances/logs.

drop policy if exists workflow_templates_insert on public.workflow_templates;
create policy workflow_templates_insert
  on public.workflow_templates for insert to authenticated
  with check (public.is_admin() or public.is_module_admin('WF'));

create or replace function app_private.project_workflow_validate_template(p_template_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_template_active boolean := false;
  v_start_count integer := 0;
  v_end_count integer := 0;
  v_task_count integer := 0;
  v_path_reaches_end boolean := false;
  v_invalid_step_count integer := 0;
  v_errors text[] := '{}'::text[];
begin
  select coalesce(wt.is_active, true)
    into v_template_active
  from public.workflow_templates wt
  where wt.id = p_template_id;

  if not found then
    return jsonb_build_object('valid', false, 'errors', jsonb_build_array('Không tìm thấy mẫu workflow.'));
  end if;

  if not v_template_active then
    v_errors := array_append(v_errors, 'Mẫu workflow đang ngừng hoạt động.');
  end if;

  select
    count(*) filter (where wn.type = 'START'::public.workflow_node_type),
    count(*) filter (where wn.type = 'END'::public.workflow_node_type),
    count(*) filter (where wn.type not in ('START'::public.workflow_node_type, 'END'::public.workflow_node_type)),
    count(*) filter (
      where wn.type not in ('START'::public.workflow_node_type, 'END'::public.workflow_node_type)
        and (
          coalesce(nullif(wn.label, ''), '') = ''
          or coalesce(nullif(wn.config ->> 'approvalPolicy', ''), 'ANY_ONE') <> 'ANY_ONE'
        )
    )
  into v_start_count, v_end_count, v_task_count, v_invalid_step_count
  from public.workflow_nodes wn
  where wn.template_id = p_template_id
    and coalesce((wn.config ->> '__templateRemoved')::boolean, false) = false;

  if v_start_count <> 1 then
    v_errors := array_append(v_errors, 'Workflow phải có đúng một bước Bắt đầu.');
  end if;
  if v_end_count <> 1 then
    v_errors := array_append(v_errors, 'Workflow phải có đúng một bước Kết thúc.');
  end if;
  if v_task_count < 1 then
    v_errors := array_append(v_errors, 'Workflow phải có ít nhất một bước xử lý.');
  end if;
  if v_invalid_step_count > 0 then
    v_errors := array_append(v_errors, 'Có bước xử lý thiếu tên hoặc dùng approval policy chưa được hỗ trợ.');
  end if;

  with recursive walk(node_id, visited) as (
    select wn.id, array[wn.id]
    from public.workflow_nodes wn
    where wn.template_id = p_template_id
      and wn.type = 'START'::public.workflow_node_type
      and coalesce((wn.config ->> '__templateRemoved')::boolean, false) = false
    union all
    select we.target_node_id, walk.visited || we.target_node_id
    from walk
    join public.workflow_edges we on we.source_node_id = walk.node_id
    join public.workflow_nodes target_node on target_node.id = we.target_node_id
    where not (we.target_node_id = any(walk.visited))
      and coalesce((target_node.config ->> '__templateRemoved')::boolean, false) = false
  )
  select exists (
    select 1
    from walk
    join public.workflow_nodes wn on wn.id = walk.node_id
    where wn.type = 'END'::public.workflow_node_type
      and coalesce((wn.config ->> '__templateRemoved')::boolean, false) = false
  ) into v_path_reaches_end;

  if not v_path_reaches_end then
    v_errors := array_append(v_errors, 'Không có đường đi hợp lệ từ Bắt đầu tới Kết thúc.');
  end if;

  return jsonb_build_object(
    'valid', coalesce(array_length(v_errors, 1), 0) = 0,
    'errors', to_jsonb(v_errors),
    'startCount', v_start_count,
    'endCount', v_end_count,
    'taskCount', v_task_count
  );
end;
$$;

create or replace function public.save_workflow_template_structure(
  p_template_id uuid,
  p_template jsonb,
  p_nodes jsonb,
  p_edges jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_validation jsonb;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if not app_private.project_workflow_template_manager(p_template_id, v_actor) then
    raise exception 'user cannot edit this workflow template';
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
  if not found then raise exception 'workflow template not found'; end if;

  delete from public.workflow_edges we where we.template_id = p_template_id;

  with input_node_ids as (
    select (node.value ->> 'id')::uuid as id
    from jsonb_array_elements(p_nodes) node(value)
    where nullif(node.value ->> 'id', '') is not null
  ),
  removed_nodes as (
    select wn.id
    from public.workflow_nodes wn
    where wn.template_id = p_template_id
      and not exists (select 1 from input_node_ids input_node where input_node.id = wn.id)
  ),
  hard_deleted as (
    delete from public.workflow_nodes wn
    using removed_nodes removed
    where wn.id = removed.id
      and not exists (select 1 from public.workflow_instances wi where wi.current_node_id = wn.id)
      and not exists (select 1 from public.workflow_subjects ws where ws.current_node_id = wn.id)
      and not exists (select 1 from public.workflow_instance_logs wil where wil.node_id = wn.id)
      and not exists (
        select 1
        from public.workflow_step_assignments wsa
        where wsa.node_id = wn.id or wsa.return_to_node_id = wn.id
      )
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
  select
    (node.value ->> 'id')::uuid,
    p_template_id,
    (node.value ->> 'type')::public.workflow_node_type,
    node.value ->> 'label',
    coalesce(node.value -> 'config', '{}'::jsonb) - '__templateRemoved',
    coalesce((node.value ->> 'position_x')::double precision, 0),
    coalesce((node.value ->> 'position_y')::double precision, 0)
  from jsonb_array_elements(p_nodes) node(value)
  on conflict (id) do update
  set type = excluded.type,
      label = excluded.label,
      config = excluded.config,
      position_x = excluded.position_x,
      position_y = excluded.position_y;

  insert into public.workflow_edges(id, template_id, source_node_id, target_node_id, label)
  select
    (edge.value ->> 'id')::uuid,
    p_template_id,
    (edge.value ->> 'source_node_id')::uuid,
    (edge.value ->> 'target_node_id')::uuid,
    coalesce(edge.value ->> 'label', '')
  from jsonb_array_elements(p_edges) edge(value);

  v_validation := app_private.project_workflow_validate_template(p_template_id);
  if not coalesce((v_validation ->> 'valid')::boolean, false) then
    raise exception 'invalid workflow template structure: %', v_validation;
  end if;
  return v_validation;
end;
$$;

revoke execute on function public.save_workflow_template_structure(uuid, jsonb, jsonb, jsonb) from public;
revoke execute on function public.save_workflow_template_structure(uuid, jsonb, jsonb, jsonb) from anon;
grant execute on function public.save_workflow_template_structure(uuid, jsonb, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
