-- "Tất cả phải duyệt" (approvalPolicy = 'ALL') for generic workflow stages, and
-- moving many templates between catalog groups in one command.
--
-- A stage with policy ALL and several assignees records each approval in
-- workflow_instances.step_approvals[<node id>] and only advances once every
-- current assignee has approved. The last approver picks the next stage's
-- handlers. Reject / revision by any assignee acts immediately. A WF admin or
-- template manager who is not one of the assignees overrides and advances.
-- Approvals reset whenever the ticket changes stage.

alter table public.workflow_instances
  add column if not exists step_approvals jsonb not null default '{}'::jsonb;

create or replace function app_private.reset_workflow_step_approvals()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if new.current_node_id is distinct from old.current_node_id then
    new.step_approvals := '{}'::jsonb;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reset_workflow_step_approvals on public.workflow_instances;
create trigger trg_reset_workflow_step_approvals
  before update of current_node_id on public.workflow_instances
  for each row execute function app_private.reset_workflow_step_approvals();

create or replace function public.process_workflow_instance_fast(p_instance_id uuid, p_action workflow_instance_action, p_user_id uuid, p_comment text, p_next_assignee_user_ids uuid[])
 returns table(id uuid, template_id uuid, code text, title text, created_by uuid, current_node_id uuid, status workflow_instance_status, watchers text[], step_assignees jsonb, created_at timestamp with time zone, updated_at timestamp with time zone)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
  v_required text[];
  v_approved text[];
  v_next_assignee_ids uuid[] := coalesce(
    array(
      select distinct assignee.assignee_id
      from unnest(coalesce(p_next_assignee_user_ids, '{}'::uuid[])) as assignee(assignee_id)
      where assignee.assignee_id is not null
    ),
    '{}'::uuid[]
  );
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

  if exists (
    select 1
    from public.request_instances request_instance
    where request_instance.workflow_instance_id = p_instance_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'REQUEST_WORKFLOW_USE_REQUEST_MODULE';
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
    or (
      jsonb_typeof(v_inst.step_assignees -> v_inst.current_node_id::text) = 'array'
      and exists (
        select 1
        from jsonb_array_elements_text(v_inst.step_assignees -> v_inst.current_node_id::text) assignee(user_id)
        where assignee.user_id = p_user_id::text
      )
    )
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

  if p_action = 'REJECTED'::public.workflow_instance_action
     and (
       v_current_node.type = 'ACTION'::public.workflow_node_type
       or coalesce(v_current_node.config ->> 'allowReject', 'true') = 'false'
     ) then
    raise exception 'WORKFLOW_REJECT_NOT_ALLOWED' using errcode = '22023';
  end if;

  -- "Tất cả phải duyệt": record this assignee's approval and hold the stage
  -- until every current assignee has approved.
  if p_action = 'APPROVED'::public.workflow_instance_action
     and coalesce(v_current_node.config ->> 'approvalPolicy', 'ANY_ONE') = 'ALL' then
    v_required := array(
      select distinct x.value
      from (
        select v_inst.step_assignees ->> v_inst.current_node_id::text as value
        where jsonb_typeof(v_inst.step_assignees -> v_inst.current_node_id::text) = 'string'
        union all
        select value from jsonb_array_elements_text(
          case when jsonb_typeof(v_inst.step_assignees -> v_inst.current_node_id::text) = 'array'
            then v_inst.step_assignees -> v_inst.current_node_id::text else '[]'::jsonb end
        )
      ) x
      where nullif(x.value, '') is not null
    );

    if cardinality(v_required) > 1 and p_user_id::text = any(v_required) then
      v_approved := array(
        select distinct a.value
        from jsonb_array_elements_text(
          case when jsonb_typeof(v_inst.step_approvals -> v_inst.current_node_id::text) = 'array'
            then v_inst.step_approvals -> v_inst.current_node_id::text else '[]'::jsonb end
        ) a(value)
        where a.value = any(v_required)
      );
      if p_user_id::text = any(v_approved) then
        raise exception 'WORKFLOW_ALREADY_APPROVED' using errcode = '22023';
      end if;
      v_approved := array_append(v_approved, p_user_id::text);

      if not (v_required <@ v_approved) then
        insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
        values (p_instance_id, v_inst.current_node_id, p_action, p_user_id, coalesce(p_comment, ''));

        update public.workflow_instances wi
        set step_approvals = coalesce(wi.step_approvals, '{}'::jsonb)
              || jsonb_build_object(v_inst.current_node_id::text, to_jsonb(v_approved)),
            updated_at = now()
        where wi.id = p_instance_id
        returning wi.* into v_inst;

        return query select
          v_inst.id, v_inst.template_id, v_inst.code, v_inst.title, v_inst.created_by,
          v_inst.current_node_id, v_inst.status, coalesce(v_inst.watchers, '{}'::text[]),
          coalesce(v_inst.step_assignees, '{}'::jsonb), v_inst.created_at, v_inst.updated_at;
        return;
      end if;
    end if;
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
          when v_next_node_type <> 'END'::public.workflow_node_type and cardinality(v_next_assignee_ids) > 0
          then coalesce(wi.step_assignees, '{}'::jsonb) || app_private.workflow_assignee_json(v_next_node_id, v_next_assignee_ids)
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
            when cardinality(v_next_assignee_ids) > 0
            then coalesce(wi.step_assignees, '{}'::jsonb) || app_private.workflow_assignee_json(v_prev_node_id, v_next_assignee_ids)
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
$function$;

-- Structure validation: accept ALL on generic templates only. Project
-- material-request workflows run on their own runtime, which has no ALL mode.
do $migration$
declare
  v_def text;
  v_anchor text := E'or coalesce(nullif(wn.config ->> ''approvalPolicy'', ''''), ''ANY_ONE'') <> ''ANY_ONE''';
  v_replacement text := E'or coalesce(nullif(wn.config ->> ''approvalPolicy'', ''''), ''ANY_ONE'') not in (''ANY_ONE'', ''ALL'')\n          or (\n            coalesce(nullif(wn.config ->> ''approvalPolicy'', ''''), ''ANY_ONE'') = ''ALL''\n            and (\n              exists (select 1 from public.workflow_templates scoped where scoped.id = p_template_id and scoped.owner_subject_type is not null)\n              or exists (select 1 from public.project_workflow_bindings binding where binding.workflow_template_id = p_template_id and binding.is_active)\n            )\n          )';
begin
  v_def := pg_get_functiondef('app_private.project_workflow_validate_template(uuid)'::regprocedure);
  if strpos(v_def, E'not in (''ANY_ONE'', ''ALL'')') > 0 then
    raise notice 'project_workflow_validate_template already accepts ALL';
  elsif strpos(v_def, v_anchor) = 0 then
    raise exception 'project_workflow_validate_template anchor not found';
  else
    execute replace(v_def, v_anchor, v_replacement);
  end if;
end
$migration$;

-- Move several templates to one catalog group (null = "Chưa phân nhóm").
create or replace function public.move_workflow_templates_to_category(p_template_ids uuid[], p_category_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_ids uuid[] := array(select distinct x from unnest(coalesce(p_template_ids, '{}'::uuid[])) x where x is not null);
  v_rows jsonb;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if cardinality(v_ids) = 0 then
    return jsonb_build_object('templates', '[]'::jsonb);
  end if;
  if cardinality(v_ids) > 200 then
    raise exception 'WORKFLOW_TEMPLATE_BATCH_TOO_LARGE' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(v_ids) x
    where not app_private.workflow_template_actor_can_edit(x, v_actor)
  ) then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
  end if;
  if p_category_id is not null
     and not exists (select 1 from public.workflow_template_categories where id = p_category_id) then
    raise exception 'WORKFLOW_CATEGORY_NOT_FOUND' using errcode = 'P0002';
  end if;

  with moved as (
    update public.workflow_templates t
    set category_id = p_category_id, updated_at = now()
    where t.id = any(v_ids)
    returning t.*
  )
  select coalesce(jsonb_agg(to_jsonb(moved)), '[]'::jsonb) into v_rows from moved;

  return jsonb_build_object('templates', v_rows);
end;
$$;

revoke all on function app_private.reset_workflow_step_approvals() from public;
revoke all on function public.move_workflow_templates_to_category(uuid[], uuid) from public, anon;
grant execute on function public.move_workflow_templates_to_category(uuid[], uuid) to authenticated;
