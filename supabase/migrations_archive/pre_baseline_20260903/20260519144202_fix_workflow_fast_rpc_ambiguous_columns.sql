-- Fix workflow processing RPC ambiguity introduced by RETURNS TABLE output names.
-- This is cloud-only: apply with `npx supabase db query --linked -f ...`.

alter type public.workflow_instance_action add value if not exists 'REOPENED';

create or replace function public.process_workflow_instance_fast(
  p_instance_id uuid,
  p_action public.workflow_instance_action,
  p_user_id uuid,
  p_comment text default '',
  p_next_assignee_user_id uuid default null
)
returns table (
  id uuid,
  template_id uuid,
  code text,
  title text,
  created_by uuid,
  current_node_id uuid,
  status public.workflow_instance_status,
  watchers text[],
  step_assignees jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inst public.workflow_instances%rowtype;
  v_current_user uuid := public.current_app_user_id();
  v_actor public.users%rowtype;
  v_template public.workflow_templates%rowtype;
  v_current_node public.workflow_nodes%rowtype;
  v_next_node_id uuid;
  v_next_node_type public.workflow_node_type;
  v_prev_node_id uuid;
  v_prev_node_type public.workflow_node_type;
  v_start_node_id uuid;
  v_first_task_node_id uuid;
  v_can_act boolean := false;
begin
  if v_current_user is null then
    raise exception 'authentication required';
  end if;

  if p_user_id is distinct from v_current_user and not public.is_module_admin('WF') then
    raise exception 'cannot act as another user';
  end if;

  select u.* into v_actor
  from public.users u
  where u.id = p_user_id;

  select wi.* into v_inst
  from public.workflow_instances wi
  where wi.id = p_instance_id
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

  select wn.* into v_current_node
  from public.workflow_nodes wn
  where wn.id = v_inst.current_node_id;

  if not found then
    raise exception 'workflow current node not found: %', v_inst.current_node_id;
  end if;

  select wt.* into v_template
  from public.workflow_templates wt
  where wt.id = v_inst.template_id;

  if not found then
    raise exception 'workflow template not found: %', v_inst.template_id;
  end if;

  select n.id into v_start_node_id
  from public.workflow_nodes n
  where n.template_id = v_inst.template_id
    and n.type = 'START'::public.workflow_node_type
  limit 1;

  select e.target_node_id into v_first_task_node_id
  from public.workflow_edges e
  where e.source_node_id = v_start_node_id
  limit 1;

  v_can_act :=
    public.is_module_admin('WF')
    or coalesce(v_inst.step_assignees ->> v_inst.current_node_id::text, '') = p_user_id::text
    or coalesce(v_current_node.config ->> 'assigneeUserId', '') = p_user_id::text
    or (
      v_actor.id is not null
      and coalesce(v_current_node.config ->> 'assigneeRole', '') = v_actor.role::text
    )
    or p_user_id::text = any(coalesce(v_template.managers, '{}'::text[]))
    or (
      v_inst.created_by = p_user_id
      and v_inst.current_node_id = v_first_task_node_id
      and exists (
        select 1
        from public.workflow_instance_logs wil
        where wil.instance_id = p_instance_id
          and wil.action = 'REVISION_REQUESTED'::public.workflow_instance_action
      )
    );

  if not v_can_act then
    raise exception 'user is not allowed to process current workflow step';
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

    update public.workflow_instances wi
    set current_node_id = v_next_node_id,
        status = case
          when v_next_node_type = 'END'::public.workflow_node_type
          then 'COMPLETED'::public.workflow_instance_status
          else wi.status
        end,
        step_assignees = case
          when p_next_assignee_user_id is not null and v_next_node_type <> 'END'::public.workflow_node_type
          then coalesce(wi.step_assignees, '{}'::jsonb) || jsonb_build_object(v_next_node_id::text, p_next_assignee_user_id::text)
          else coalesce(wi.step_assignees, '{}'::jsonb)
        end,
        updated_at = now()
    where wi.id = p_instance_id
    returning wi.* into v_inst;
  elsif p_action = 'REJECTED'::public.workflow_instance_action then
    update public.workflow_instances wi
    set status = 'REJECTED'::public.workflow_instance_status,
        updated_at = now()
    where wi.id = p_instance_id
    returning wi.* into v_inst;
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
      update public.workflow_instances wi
      set current_node_id = v_prev_node_id,
          step_assignees = case
            when p_next_assignee_user_id is not null
            then coalesce(wi.step_assignees, '{}'::jsonb) || jsonb_build_object(v_prev_node_id::text, p_next_assignee_user_id::text)
            else coalesce(wi.step_assignees, '{}'::jsonb)
          end,
          updated_at = now()
      where wi.id = p_instance_id
      returning wi.* into v_inst;
    end if;
  end if;

  return query select
    v_inst.id,
    v_inst.template_id,
    v_inst.code,
    v_inst.title,
    v_inst.created_by,
    v_inst.current_node_id,
    v_inst.status,
    coalesce(v_inst.watchers, '{}'::text[]),
    coalesce(v_inst.step_assignees, '{}'::jsonb),
    v_inst.created_at,
    v_inst.updated_at;
end;
$$;

revoke execute on function public.process_workflow_instance_fast(uuid, public.workflow_instance_action, uuid, text, uuid) from anon;
revoke execute on function public.process_workflow_instance_fast(uuid, public.workflow_instance_action, uuid, text, uuid) from public;
grant execute on function public.process_workflow_instance_fast(uuid, public.workflow_instance_action, uuid, text, uuid) to authenticated;

notify pgrst, 'reload schema';
