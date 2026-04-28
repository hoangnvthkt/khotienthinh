create or replace function public.process_workflow_instance(
  p_instance_id uuid,
  p_action public.workflow_instance_action,
  p_user_id uuid,
  p_comment text default ''
)
returns public.workflow_instances
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inst public.workflow_instances%rowtype;
  v_current_user uuid := public.current_app_user_id();
  v_next_node_id uuid;
  v_next_node_type public.workflow_node_type;
  v_prev_node_id uuid;
  v_prev_node_type public.workflow_node_type;
begin
  if v_current_user is null then
    raise exception 'authentication required';
  end if;
  if p_user_id is distinct from v_current_user and not public.is_module_admin('WF') then
    raise exception 'cannot act as another user';
  end if;

  select * into v_inst
  from public.workflow_instances
  where id = p_instance_id
  for update;
  if not found then
    raise exception 'workflow instance not found: %', p_instance_id;
  end if;
  if v_inst.status <> 'RUNNING'::public.workflow_instance_status then
    raise exception 'workflow instance is not running';
  end if;
  if v_inst.current_node_id is null then
    raise exception 'workflow instance has no current node';
  end if;

  insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
  values (p_instance_id, v_inst.current_node_id, p_action, p_user_id, coalesce(p_comment, ''));

  if p_action = 'APPROVED'::public.workflow_instance_action then
    select e.target_node_id, n.type
      into v_next_node_id, v_next_node_type
    from public.workflow_edges e
    join public.workflow_nodes n on n.id = e.target_node_id
    where e.source_node_id = v_inst.current_node_id
    limit 1;

    if v_next_node_id is null then
      raise exception 'no next workflow node found';
    end if;

    update public.workflow_instances
    set current_node_id = v_next_node_id,
        status = case
          when v_next_node_type = 'END'::public.workflow_node_type
          then 'COMPLETED'::public.workflow_instance_status
          else status
        end,
        updated_at = now()
    where id = p_instance_id
    returning * into v_inst;
  elsif p_action = 'REJECTED'::public.workflow_instance_action then
    update public.workflow_instances
    set status = 'REJECTED'::public.workflow_instance_status,
        updated_at = now()
    where id = p_instance_id
    returning * into v_inst;
  elsif p_action = 'REVISION_REQUESTED'::public.workflow_instance_action then
    select e.source_node_id, n.type
      into v_prev_node_id, v_prev_node_type
    from public.workflow_edges e
    join public.workflow_nodes n on n.id = e.source_node_id
    where e.target_node_id = v_inst.current_node_id
    limit 1;

    if v_prev_node_id is not null and v_prev_node_type = 'START'::public.workflow_node_type then
      select e.target_node_id
        into v_prev_node_id
      from public.workflow_edges e
      where e.source_node_id = v_prev_node_id
      limit 1;
    end if;

    if v_prev_node_id is not null then
      update public.workflow_instances
      set current_node_id = v_prev_node_id,
          updated_at = now()
      where id = p_instance_id
      returning * into v_inst;
    end if;
  end if;

  return v_inst;
end;
$$;

revoke execute on function public.process_workflow_instance(uuid, public.workflow_instance_action, uuid, text) from anon;
grant execute on function public.process_workflow_instance(uuid, public.workflow_instance_action, uuid, text) to authenticated;

notify pgrst, 'reload schema';
