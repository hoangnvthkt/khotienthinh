-- Workflow boundary hardening: canonical capability gates for template and
-- generic-instance reads/writes. Project/Request workflow subjects retain
-- their existing subject-level visibility through the compatibility branch.

create or replace function app_private.workflow_action_is_enforced(p_permission_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select grant_readiness in ('enforced', 'verified')
     from public.permission_actions
     where permission_code = p_permission_code
       and is_active),
    false
  );
$$;

revoke all on function app_private.workflow_action_is_enforced(text)
  from public, anon, authenticated, service_role;

create or replace function app_private.workflow_template_actor_can_view(
  p_template_id uuid,
  p_actor_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workflow_templates template_row
    where template_row.id = p_template_id
      and p_actor_id is not null
      and (
        public.is_admin()
        or app_private.workflow_has_action(
          'workflow.template.view', template_row.created_by, null, p_actor_id
        )
        or (
          p_actor_id::text = any(coalesce(template_row.managers, '{}'::text[]))
          and app_private.has_permission(
            p_actor_id, 'workflow.template.view', 'assigned', p_actor_id::text
          )
        )
        or (
          not app_private.workflow_action_is_enforced('workflow.template.view')
          and p_actor_id = public.current_app_user_id()
          and app_private.can_access_module('WF')
        )
        or exists (
          select 1
          from public.workflow_subjects subject_row
          where subject_row.workflow_instance_id in (
            select instance_row.id
            from public.workflow_instances instance_row
            where instance_row.template_id = template_row.id
          )
            and app_private.project_workflow_actor_can_select(subject_row.id)
        )
      )
  );
$$;

revoke all on function app_private.workflow_template_actor_can_view(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function app_private.workflow_template_actor_can_edit(
  p_template_id uuid,
  p_actor_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workflow_templates template_row
    where template_row.id = p_template_id
      and p_actor_id is not null
      and (
        public.is_admin()
        or app_private.workflow_has_action(
          'workflow.template.edit', template_row.created_by, null, p_actor_id
        )
        or (
          p_actor_id::text = any(coalesce(template_row.managers, '{}'::text[]))
          and app_private.has_permission(
            p_actor_id, 'workflow.template.edit', 'assigned', p_actor_id::text
          )
        )
        or (
          not app_private.workflow_action_is_enforced('workflow.template.edit')
          and p_actor_id = public.current_app_user_id()
          and app_private.can_access_module('WF')
        )
      )
  );
$$;

revoke all on function app_private.workflow_template_actor_can_edit(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function app_private.workflow_template_actor_can_publish(
  p_template_id uuid,
  p_actor_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_actor_id is not null
    and (
      public.is_admin()
      or app_private.workflow_has_action(
        'workflow.template.publish', null, null, p_actor_id
      )
      or (
        not app_private.workflow_action_is_enforced('workflow.template.publish')
        and p_actor_id = public.current_app_user_id()
        and app_private.can_access_module('WF')
      )
    )
    and exists (
      select 1 from public.workflow_templates
      where id = p_template_id
    );
$$;

revoke all on function app_private.workflow_template_actor_can_publish(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function app_private.workflow_instance_actor_can_select(p_instance_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workflow_instances instance_row
    where instance_row.id = p_instance_id
      and (
        exists (
          select 1
          from public.workflow_subjects subject_row
          where subject_row.workflow_instance_id = instance_row.id
            and app_private.project_workflow_actor_can_select(subject_row.id)
        )
        or (
          not exists (
            select 1 from public.workflow_subjects subject_row
            where subject_row.workflow_instance_id = instance_row.id
          )
          and (
            app_private.workflow_has_action(
              'workflow.instance.view', instance_row.created_by, null,
              public.current_app_user_id()
            )
            or (
              app_private.has_permission(
                public.current_app_user_id(), 'workflow.instance.view',
                'assigned', public.current_app_user_id()::text
              )
              and (
                coalesce(instance_row.step_assignees ->> instance_row.current_node_id::text, '')
                  = public.current_app_user_id()::text
                or (
                  jsonb_typeof(instance_row.step_assignees -> instance_row.current_node_id::text) = 'array'
                  and exists (
                    select 1
                    from jsonb_array_elements_text(
                      instance_row.step_assignees -> instance_row.current_node_id::text
                    ) assignee(user_id)
                    where assignee.user_id = public.current_app_user_id()::text
                  )
                )
              )
            )
            or app_private.workflow_has_action(
              'workflow.instance.administer', instance_row.created_by, null,
              public.current_app_user_id()
            )
          )
        )
      )
  );
$$;

revoke all on function app_private.workflow_instance_actor_can_select(uuid)
  from public, anon, authenticated, service_role;

create or replace function app_private.workflow_instance_actor_can_process(
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
    from public.workflow_instances instance_row
    join public.workflow_nodes node_row on node_row.id = instance_row.current_node_id
    left join public.users actor_row on actor_row.id = p_actor_id
    where instance_row.id = p_instance_id
      and instance_row.status = 'RUNNING'
      and p_actor_id is not null
      and (
        app_private.workflow_has_action(
          'workflow.instance.act_assigned', instance_row.created_by,
          p_actor_id, p_actor_id
        )
        or app_private.workflow_has_action(
          'workflow.instance.administer', instance_row.created_by, null, p_actor_id
        )
        or (
          not app_private.workflow_action_is_enforced('workflow.instance.act_assigned')
          and (
            coalesce(instance_row.step_assignees ->> instance_row.current_node_id::text, '') = p_actor_id::text
            or (
              jsonb_typeof(instance_row.step_assignees -> instance_row.current_node_id::text) = 'array'
              and exists (
                select 1
                from jsonb_array_elements_text(
                  instance_row.step_assignees -> instance_row.current_node_id::text
                ) assignee(user_id)
                where assignee.user_id = p_actor_id::text
              )
            )
            or coalesce(node_row.config ->> 'assigneeUserId', '') = p_actor_id::text
            or (actor_row.id is not null and coalesce(node_row.config ->> 'assigneeRole', '') = actor_row.role::text)
            or p_actor_id::text = any(coalesce((select managers from public.workflow_templates where id = instance_row.template_id), '{}'::text[]))
            or (
              instance_row.created_by = p_actor_id
              and exists (
                select 1 from public.workflow_instance_logs revision_log
                where revision_log.instance_id = instance_row.id
                  and revision_log.action = 'REVISION_REQUESTED'
              )
            )
          )
        )
      )
  );
$$;

revoke all on function app_private.workflow_instance_actor_can_process(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function app_private.workflow_actor_can_create_instance(p_actor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_actor_id is not null
    and (
      app_private.workflow_has_action(
        'workflow.instance.create', null, null, p_actor_id
      )
      or app_private.has_permission(
        p_actor_id, 'workflow.instance.create', 'own', p_actor_id::text
      )
      or (
        not app_private.workflow_action_is_enforced('workflow.instance.create')
        and p_actor_id = public.current_app_user_id()
        and app_private.can_access_module('WF')
      )
    );
$$;

revoke all on function app_private.workflow_actor_can_create_instance(uuid)
  from public, anon, authenticated, service_role;

-- A trigger closes the legacy process function's assignment-only branch without
-- duplicating its large state-transition implementation.
create or replace function app_private.guard_generic_workflow_process_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_generic boolean;
begin
  if new.action in ('APPROVED', 'REJECTED', 'REVISION_REQUESTED') then
    select not exists (
      select 1 from public.request_instances request_row
      where request_row.workflow_instance_id = new.instance_id
    ) and not exists (
      select 1 from public.workflow_subjects subject_row
      where subject_row.workflow_instance_id = new.instance_id
    )
    into v_generic;
    if v_generic
       and current_setting('app.workflow_command', true) <> 'cancel'
       and not app_private.workflow_instance_actor_can_process(new.instance_id, new.acted_by) then
      raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- Mark the cancellation log insert so the process trigger does not conflate
-- the dedicated cancel capability with step approval/rejection.
create or replace function public.cancel_workflow_instance(
  p_instance_id uuid,
  p_comment text,
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
begin
  v_cached := app_private.workflow_command_begin(
    v_actor, p_idempotency_key, 'cancel_workflow_instance',
    jsonb_build_object('instanceId', p_instance_id, 'comment', p_comment)
  );
  if v_cached is not null then return v_cached; end if;
  select * into v_instance from public.workflow_instances where id = p_instance_id for update;
  if v_instance.id is null
     or v_instance.status <> 'RUNNING'
     or not app_private.workflow_has_action('workflow.instance.cancel', v_instance.created_by, null, v_actor) then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
  end if;
  perform set_config('app.workflow_command', 'cancel', true);
  update public.workflow_instances
  set status = 'CANCELLED', updated_at = now()
  where id = v_instance.id
  returning * into v_instance;
  insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
  values (v_instance.id, v_instance.current_node_id, 'REJECTED', v_actor, coalesce(p_comment, ''))
  returning * into v_log;
  return app_private.workflow_command_finish(
    v_actor, p_idempotency_key,
    jsonb_build_object('instance', to_jsonb(v_instance), 'log', to_jsonb(v_log))
  );
end;
$$;

revoke all on function app_private.guard_generic_workflow_process_log()
  from public, anon, authenticated, service_role;
drop trigger if exists trg_guard_generic_workflow_process_log on public.workflow_instance_logs;
create trigger trg_guard_generic_workflow_process_log
before insert on public.workflow_instance_logs
for each row execute function app_private.guard_generic_workflow_process_log();

-- Template lifecycle commands.
create or replace function public.create_workflow_template(
  p_name text,
  p_description text default '',
  p_idempotency_key uuid default null
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
begin
  v_cached := app_private.workflow_command_begin(
    v_actor, p_idempotency_key, 'create_workflow_template',
    jsonb_build_object('name', p_name, 'description', p_description)
  );
  if v_cached is not null then return v_cached; end if;
  if not app_private.workflow_has_action('workflow.template.create', null, null, v_actor) then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'WORKFLOW_TEMPLATE_NAME_REQUIRED' using errcode = '22023';
  end if;
  insert into public.workflow_templates(name, description, created_by, is_active, custom_fields, managers, default_watchers)
  values (btrim(p_name), coalesce(p_description, ''), v_actor, true, '[]'::jsonb, '{}'::text[], '{}'::text[])
  returning * into v_template;
  return app_private.workflow_command_finish(
    v_actor, p_idempotency_key, jsonb_build_object('template', to_jsonb(v_template))
  );
end;
$$;

create or replace function public.update_workflow_template_metadata(
  p_template_id uuid,
  p_name text,
  p_description text,
  p_custom_fields jsonb,
  p_managers text[],
  p_default_watchers text[],
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
begin
  v_cached := app_private.workflow_command_begin(
    v_actor, p_idempotency_key, 'update_workflow_template_metadata',
    jsonb_build_object('templateId', p_template_id, 'name', p_name, 'description', p_description,
      'customFields', p_custom_fields, 'managers', p_managers, 'defaultWatchers', p_default_watchers)
  );
  if v_cached is not null then return v_cached; end if;
  if not app_private.workflow_template_actor_can_edit(p_template_id, v_actor) then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
  end if;
  if p_name is not null and nullif(btrim(p_name), '') is null then
    raise exception 'WORKFLOW_TEMPLATE_NAME_REQUIRED' using errcode = '22023';
  end if;
  if p_custom_fields is not null and jsonb_typeof(p_custom_fields) <> 'array' then
    raise exception 'WORKFLOW_CUSTOM_FIELDS_INVALID' using errcode = '22023';
  end if;
  update public.workflow_templates
  set name = coalesce(nullif(btrim(p_name), ''), name),
      description = coalesce(p_description, description),
      custom_fields = coalesce(p_custom_fields, custom_fields, '[]'::jsonb),
      managers = coalesce(p_managers, managers, '{}'::text[]),
      default_watchers = coalesce(p_default_watchers, default_watchers, '{}'::text[]),
      updated_at = now()
  where id = p_template_id
  returning * into v_template;
  if v_template.id is null then raise exception 'WORKFLOW_TEMPLATE_NOT_FOUND' using errcode = 'P0002'; end if;
  return app_private.workflow_command_finish(
    v_actor, p_idempotency_key, jsonb_build_object('template', to_jsonb(v_template))
  );
end;
$$;

create or replace function public.publish_workflow_template(
  p_template_id uuid,
  p_is_active boolean,
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
  v_validation jsonb;
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

create or replace function public.delete_workflow_template(
  p_template_id uuid,
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
begin
  v_cached := app_private.workflow_command_begin(
    v_actor, p_idempotency_key, 'delete_workflow_template',
    jsonb_build_object('templateId', p_template_id)
  );
  if v_cached is not null then return v_cached; end if;
  if not app_private.workflow_template_actor_can_edit(p_template_id, v_actor) then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
  end if;
  delete from public.workflow_templates where id = p_template_id;
  if not found then raise exception 'WORKFLOW_TEMPLATE_NOT_FOUND' using errcode = 'P0002'; end if;
  return app_private.workflow_command_finish(
    v_actor, p_idempotency_key, jsonb_build_object('deletedTemplateId', p_template_id)
  );
end;
$$;

revoke all on function public.create_workflow_template(text, text, uuid) from public, anon;
grant execute on function public.create_workflow_template(text, text, uuid) to authenticated;
revoke all on function public.update_workflow_template_metadata(uuid, text, text, jsonb, text[], text[], uuid) from public, anon;
grant execute on function public.update_workflow_template_metadata(uuid, text, text, jsonb, text[], text[], uuid) to authenticated;
revoke all on function public.publish_workflow_template(uuid, boolean, uuid) from public, anon;
grant execute on function public.publish_workflow_template(uuid, boolean, uuid) to authenticated;
revoke all on function public.delete_workflow_template(uuid, uuid) from public, anon;
grant execute on function public.delete_workflow_template(uuid, uuid) to authenticated;

-- Existing structure RPC remains the single node/edge write boundary. Its
-- manager check is upgraded and publication is separated from edit.
create or replace function public.save_workflow_template_structure(
  p_template_id uuid, p_template jsonb, p_nodes jsonb, p_edges jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_before public.workflow_templates%rowtype;
  v_validation jsonb;
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
  if (select is_active from public.workflow_templates where id = p_template_id)
     and not coalesce((v_validation ->> 'valid')::boolean, false) then
    raise exception 'invalid workflow template structure: %', v_validation;
  end if;
  return v_validation;
end;
$$;

create or replace function app_private.project_workflow_template_manager(
  p_template_id uuid,
  p_actor uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.workflow_template_actor_can_edit(p_template_id, p_actor);
$$;

-- RLS and SQL privileges: all exposed table writes flow through commands.
drop policy if exists workflow_templates_select on public.workflow_templates;
create policy workflow_templates_select on public.workflow_templates
for select to authenticated
using (app_private.workflow_template_actor_can_view(id, public.current_app_user_id()));
drop policy if exists workflow_templates_insert on public.workflow_templates;
create policy workflow_templates_insert on public.workflow_templates
for insert to authenticated with check (false);
drop policy if exists workflow_templates_update on public.workflow_templates;
create policy workflow_templates_update on public.workflow_templates
for update to authenticated
using (app_private.workflow_template_actor_can_edit(id, public.current_app_user_id()))
with check (app_private.workflow_template_actor_can_edit(id, public.current_app_user_id()));
drop policy if exists workflow_templates_delete on public.workflow_templates;
create policy workflow_templates_delete on public.workflow_templates
for delete to authenticated using (app_private.workflow_template_actor_can_edit(id, public.current_app_user_id()));

drop policy if exists workflow_nodes_select on public.workflow_nodes;
create policy workflow_nodes_select on public.workflow_nodes
for select to authenticated
using (app_private.workflow_template_actor_can_view(template_id, public.current_app_user_id()));
drop policy if exists workflow_nodes_insert on public.workflow_nodes;
create policy workflow_nodes_insert on public.workflow_nodes
for insert to authenticated with check (false);
drop policy if exists workflow_nodes_update on public.workflow_nodes;
create policy workflow_nodes_update on public.workflow_nodes
for update to authenticated
using (app_private.workflow_template_actor_can_edit(template_id, public.current_app_user_id()))
with check (app_private.workflow_template_actor_can_edit(template_id, public.current_app_user_id()));
drop policy if exists workflow_nodes_delete on public.workflow_nodes;
create policy workflow_nodes_delete on public.workflow_nodes
for delete to authenticated using (app_private.workflow_template_actor_can_edit(template_id, public.current_app_user_id()));

drop policy if exists workflow_edges_select on public.workflow_edges;
create policy workflow_edges_select on public.workflow_edges
for select to authenticated
using (app_private.workflow_template_actor_can_view(template_id, public.current_app_user_id()));
drop policy if exists workflow_edges_insert on public.workflow_edges;
create policy workflow_edges_insert on public.workflow_edges
for insert to authenticated with check (false);
drop policy if exists workflow_edges_update on public.workflow_edges;
create policy workflow_edges_update on public.workflow_edges
for update to authenticated
using (app_private.workflow_template_actor_can_edit(template_id, public.current_app_user_id()))
with check (app_private.workflow_template_actor_can_edit(template_id, public.current_app_user_id()));
drop policy if exists workflow_edges_delete on public.workflow_edges;
create policy workflow_edges_delete on public.workflow_edges
for delete to authenticated using (app_private.workflow_template_actor_can_edit(template_id, public.current_app_user_id()));

drop policy if exists workflow_instances_select on public.workflow_instances;
create policy workflow_instances_select on public.workflow_instances
for select to authenticated
using (app_private.workflow_instance_actor_can_select(id));

revoke insert, update, delete on public.workflow_templates from public, anon, authenticated;
revoke insert, update, delete on public.workflow_nodes from public, anon, authenticated;
revoke insert, update, delete on public.workflow_edges from public, anon, authenticated;

-- The owner-approved Workflow catalog is now technically ready for pilot.
update public.permission_actions
set grant_readiness = 'enforced', direct_grant_allowed = true, updated_at = now()
where permission_code in (
  'workflow.instance.view', 'workflow.instance.create',
  'workflow.instance.act_assigned', 'workflow.template.view',
  'workflow.template.create', 'workflow.template.edit',
  'workflow.template.publish'
);
