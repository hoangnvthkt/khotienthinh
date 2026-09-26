-- Project-owned material request workflows.
--
-- A project can take a private copy of the workflow it currently uses and
-- change the approval steps without touching the shared Quy trình template.
-- Authority for the copy comes from the project room `material_request`
-- (action `edit`, plus `view`), not from the Workflow module catalog.
--
-- In-flight requests are unaffected: runtime reads the per-instance snapshot
-- (workflow_instance_nodes / workflow_instance_edges), never the template.

alter table public.workflow_templates
  add column if not exists owner_subject_type text,
  add column if not exists owner_project_id text,
  add column if not exists cloned_from_template_id uuid;

alter table public.workflow_templates
  drop constraint if exists workflow_templates_owner_subject_type_check;
alter table public.workflow_templates
  add constraint workflow_templates_owner_subject_type_check
  check (owner_subject_type is null or owner_subject_type = 'material_request');

alter table public.workflow_templates
  drop constraint if exists workflow_templates_owner_pair_check;
alter table public.workflow_templates
  add constraint workflow_templates_owner_pair_check
  check ((owner_subject_type is null) = (owner_project_id is null));

alter table public.workflow_templates
  drop constraint if exists workflow_templates_cloned_from_template_id_fkey;
alter table public.workflow_templates
  add constraint workflow_templates_cloned_from_template_id_fkey
  foreign key (cloned_from_template_id) references public.workflow_templates(id) on delete set null;

-- One live private copy per project and subject; also serialises clone races.
create unique index if not exists workflow_templates_one_active_project_owner_idx
  on public.workflow_templates(owner_subject_type, owner_project_id)
  where owner_project_id is not null and coalesce(is_active, true);

comment on column public.workflow_templates.owner_project_id is
  'Set when the template is a private copy owned by one project. Null = shared Quy trình template.';

-- Room check for a project-owned template. Shared templates always return false.
create or replace function app_private.project_owned_workflow_actor_has_room_action(
  p_template_id uuid,
  p_actor_id uuid,
  p_action_code text
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
      and template_row.owner_subject_type = 'material_request'
      and template_row.owner_project_id is not null
      and app_private.project_actor_has_effective_room_action(
        p_actor_id, template_row.owner_project_id, null, 'material_request', p_action_code
      )
  );
$$;

revoke all on function app_private.project_owned_workflow_actor_has_room_action(uuid, uuid, text)
  from public, anon, authenticated, service_role;

-- Template read/write predicates. Bodies are unchanged from
-- 20260917022452 apart from the project-owned branch at the end.
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
        or app_private.project_owned_workflow_actor_has_room_action(template_row.id, p_actor_id, 'view')
      )
  );
$$;

revoke all on function app_private.workflow_template_actor_can_view(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function app_private.workflow_template_actor_can_view(uuid, uuid) to authenticated;

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
        or (
          app_private.project_owned_workflow_actor_has_room_action(template_row.id, p_actor_id, 'edit')
          and app_private.project_owned_workflow_actor_has_room_action(template_row.id, p_actor_id, 'view')
        )
      )
  );
$$;

revoke all on function app_private.workflow_template_actor_can_edit(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function app_private.workflow_template_actor_can_edit(uuid, uuid) to authenticated;

-- Binding management. A project-owned template bound to its own project only
-- needs room `material_request: edit` + `view`; shared templates keep the
-- original, stricter test.
create or replace function app_private.project_workflow_binding_can_manage(
  p_project_id text,
  p_construction_site_id text,
  p_template_id uuid default null::uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.is_admin()
    or public.is_module_admin('WF')
    or (
      p_project_id is not null
      and p_construction_site_id is null
      and p_template_id is not null
      and exists (
        select 1
        from public.workflow_templates owned
        where owned.id = p_template_id
          and owned.owner_subject_type = 'material_request'
          and owned.owner_project_id = p_project_id
      )
      and app_private.project_actor_has_effective_room_action(
        public.current_app_user_id(), p_project_id, null, 'material_request', 'edit'
      )
      and app_private.project_actor_has_effective_room_action(
        public.current_app_user_id(), p_project_id, null, 'material_request', 'view'
      )
    )
    or (
      p_project_id is not null
      and app_private.project_user_has_permission(
        p_project_id, p_construction_site_id, 'edit', public.current_app_user_id()
      )
      and (
        public.is_module_admin('DA')
        or (
          (
            (p_template_id is not null and app_private.project_workflow_template_manager(p_template_id, public.current_app_user_id()))
            or (
              p_template_id is null
              and exists (
                select 1
                from public.workflow_templates wt
                where public.current_app_user_id()::text = any(coalesce(wt.managers, '{}'::text[]))
              )
            )
          )
        )
      )
    ),
    false
  );
$$;

revoke all on function app_private.project_workflow_binding_can_manage(text, text, uuid)
  from public, anon;

-- Binding RPC: unchanged from baseline except that a project-owned template
-- can only be bound at project scope of the project that owns it.
create or replace function public.set_project_workflow_binding(
  p_subject_type text,
  p_workflow_template_id uuid,
  p_project_id text default null::text,
  p_construction_site_id text default null::text
)
returns public.project_workflow_bindings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_validation jsonb;
  v_binding public.project_workflow_bindings%rowtype;
  v_owner_project_id text;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;
  if p_subject_type is distinct from 'material_request' then
    raise exception 'unsupported project workflow subject type: %', p_subject_type;
  end if;
  if p_construction_site_id is not null and p_project_id is null then
    raise exception 'site binding requires project id';
  end if;

  select wt.owner_project_id
    into v_owner_project_id
  from public.workflow_templates wt
  where wt.id = p_workflow_template_id;
  if v_owner_project_id is not null
     and (p_project_id is distinct from v_owner_project_id or p_construction_site_id is not null) then
    raise exception 'WORKFLOW_TEMPLATE_OWNED_BY_OTHER_SCOPE' using errcode = '42501';
  end if;

  if not app_private.project_workflow_binding_can_manage(p_project_id, p_construction_site_id, p_workflow_template_id) then
    raise exception 'user cannot manage this project workflow binding';
  end if;

  v_validation := app_private.project_workflow_validate_template(p_workflow_template_id);
  if not coalesce((v_validation ->> 'valid')::boolean, false) then
    raise exception 'workflow template is invalid: %', v_validation;
  end if;

  update public.project_workflow_bindings pwb
  set is_active = false,
      updated_at = now()
  where pwb.subject_type = p_subject_type
    and pwb.is_default
    and pwb.is_active
    and pwb.project_id is not distinct from p_project_id
    and pwb.construction_site_id is not distinct from p_construction_site_id;

  insert into public.project_workflow_bindings(
    subject_type, project_id, construction_site_id, workflow_template_id,
    is_default, is_active, created_by
  )
  values (
    p_subject_type, p_project_id, p_construction_site_id, p_workflow_template_id,
    true, true, v_actor
  )
  returning * into v_binding;

  return v_binding;
end;
$$;

revoke all on function public.set_project_workflow_binding(text, uuid, text, text) from public, anon;
grant execute on function public.set_project_workflow_binding(text, uuid, text, text) to authenticated, service_role;

-- Give a project its own editable copy of the workflow it currently uses.
--
-- Idempotent: when the project is already bound to its own live copy, that
-- copy is returned untouched. A copy left behind after "Xóa cấu hình riêng" is
-- retired (is_active = false, kept for history) and a fresh copy is taken
-- from whatever the project now resolves to.
create or replace function public.clone_project_workflow_template(
  p_subject_type text,
  p_project_id text,
  p_source_template_id uuid default null::uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_project_code text;
  v_existing public.workflow_templates%rowtype;
  v_resolved_id uuid;
  v_source public.workflow_templates%rowtype;
  v_template public.workflow_templates%rowtype;
  v_binding public.project_workflow_bindings%rowtype;
  v_validation jsonb;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;
  if p_subject_type is distinct from 'material_request' then
    raise exception 'unsupported project workflow subject type: %', p_subject_type;
  end if;
  if nullif(btrim(coalesce(p_project_id, '')), '') is null then
    raise exception 'WORKFLOW_PROJECT_REQUIRED' using errcode = '22023';
  end if;

  select p.code into v_project_code from public.projects p where p.id = p_project_id;
  if not found then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  if not (
    app_private.project_actor_has_effective_room_action(v_actor, p_project_id, null, 'material_request', 'edit')
    and app_private.project_actor_has_effective_room_action(v_actor, p_project_id, null, 'material_request', 'view')
  ) then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
  end if;

  -- Serialise concurrent clones for the same project.
  perform pg_advisory_xact_lock(hashtextextended('project_owned_workflow:material_request:' || p_project_id, 0));

  v_resolved_id := app_private.project_workflow_resolve_template(p_subject_type, p_project_id, null);

  select wt.* into v_existing
  from public.workflow_templates wt
  where wt.owner_subject_type = p_subject_type
    and wt.owner_project_id = p_project_id
    and coalesce(wt.is_active, true)
  limit 1;

  if v_existing.id is not null then
    if v_existing.id = v_resolved_id then
      select pwb.* into v_binding
      from public.project_workflow_bindings pwb
      where pwb.subject_type = p_subject_type
        and pwb.project_id = p_project_id
        and pwb.construction_site_id is null
        and pwb.is_active
        and pwb.is_default
        and pwb.workflow_template_id = v_existing.id
      order by pwb.updated_at desc
      limit 1;
      return jsonb_build_object(
        'template', to_jsonb(v_existing),
        'binding', to_jsonb(v_binding),
        'validation', app_private.project_workflow_validate_template(v_existing.id),
        'cloned', false
      );
    end if;
    update public.workflow_templates
    set is_active = false, updated_at = now()
    where id = v_existing.id;
  end if;

  select wt.* into v_source
  from public.workflow_templates wt
  where wt.id = coalesce(p_source_template_id, v_resolved_id);
  if v_source.id is null then
    raise exception 'WORKFLOW_SOURCE_TEMPLATE_REQUIRED' using errcode = 'P0002';
  end if;
  -- An explicit source must be one the actor could already read.
  if p_source_template_id is not null
     and p_source_template_id is distinct from v_resolved_id
     and not app_private.workflow_template_actor_can_view(p_source_template_id, v_actor) then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
  end if;
  if v_source.owner_project_id is not null and v_source.owner_project_id <> p_project_id then
    raise exception 'WORKFLOW_TEMPLATE_OWNED_BY_OTHER_SCOPE' using errcode = '42501';
  end if;

  insert into public.workflow_templates(
    name, description, created_by, is_active, custom_fields, managers, default_watchers,
    owner_subject_type, owner_project_id, cloned_from_template_id
  )
  values (
    format(
      '%s (riêng dự án %s)',
      regexp_replace(v_source.name, ' \(riêng dự án [^)]*\)$', ''),
      v_project_code
    ),
    coalesce(v_source.description, ''),
    v_actor,
    true,
    coalesce(v_source.custom_fields, '[]'::jsonb),
    -- Authority over the copy comes from the project room, not the manager list.
    '{}'::text[],
    coalesce(v_source.default_watchers, '{}'::text[]),
    p_subject_type,
    p_project_id,
    v_source.id
  )
  returning * into v_template;

  -- Copy live steps; soft-removed steps stay with the source. New ids are
  -- derived from (copy, source node) so edges can be remapped in a second pass.
  insert into public.workflow_nodes(id, template_id, type, label, config, position_x, position_y)
  select md5(v_template.id::text || ':' || wn.id::text)::uuid, v_template.id, wn.type, wn.label,
    coalesce(wn.config, '{}'::jsonb) - '__templateRemoved',
    wn.position_x, wn.position_y
  from public.workflow_nodes wn
  where wn.template_id = v_source.id
    and coalesce((wn.config ->> '__templateRemoved')::boolean, false) = false;

  insert into public.workflow_edges(template_id, source_node_id, target_node_id, label)
  select v_template.id,
    md5(v_template.id::text || ':' || we.source_node_id::text)::uuid,
    md5(v_template.id::text || ':' || we.target_node_id::text)::uuid,
    coalesce(we.label, '')
  from public.workflow_edges we
  join public.workflow_nodes source_node on source_node.id = we.source_node_id
  join public.workflow_nodes target_node on target_node.id = we.target_node_id
  where we.template_id = v_source.id
    and coalesce((source_node.config ->> '__templateRemoved')::boolean, false) = false
    and coalesce((target_node.config ->> '__templateRemoved')::boolean, false) = false;

  v_validation := app_private.project_workflow_validate_template(v_template.id);
  if not coalesce((v_validation ->> 'valid')::boolean, false) then
    raise exception 'workflow template is invalid: %', v_validation;
  end if;

  v_binding := public.set_project_workflow_binding(p_subject_type, v_template.id, p_project_id, null);

  return jsonb_build_object(
    'template', to_jsonb(v_template),
    'binding', to_jsonb(v_binding),
    'validation', v_validation,
    'cloned', true
  );
end;
$$;

revoke all on function public.clone_project_workflow_template(text, text, uuid) from public, anon;
grant execute on function public.clone_project_workflow_template(text, text, uuid) to authenticated;

-- Configuration read: unchanged from baseline, plus the fields the project
-- editor needs (template name, ownership, whether the actor may customise).
create or replace function public.get_project_workflow_configuration(
  p_subject_type text,
  p_project_id text default null::text,
  p_construction_site_id text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_binding public.project_workflow_bindings%rowtype;
  v_template public.workflow_templates%rowtype;
  v_scope text;
  v_validation jsonb;
  v_can_customize boolean := false;
  v_can_read_project boolean := false;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;
  if p_subject_type is distinct from 'material_request' then
    raise exception 'unsupported project workflow subject type: %', p_subject_type;
  end if;

  if p_project_id is not null then
    v_can_read_project := app_private.project_actor_has_effective_room_action(
      v_actor, p_project_id, p_construction_site_id, 'material_request', 'view'
    );
    v_can_customize := app_private.project_actor_has_effective_room_action(
        v_actor, p_project_id, null, 'material_request', 'edit'
      )
      and app_private.project_actor_has_effective_room_action(
        v_actor, p_project_id, null, 'material_request', 'view'
      );
  end if;

  select pwb.*
    into v_binding
  from public.project_workflow_bindings pwb
  join public.workflow_templates wt on wt.id = pwb.workflow_template_id
    and coalesce(wt.is_active, true)
  where pwb.subject_type = p_subject_type
    and pwb.is_active
    and pwb.is_default
    and (
      (p_construction_site_id is not null and pwb.project_id is not distinct from p_project_id and pwb.construction_site_id = p_construction_site_id)
      or (p_project_id is not null and pwb.project_id = p_project_id and pwb.construction_site_id is null)
      or (pwb.project_id is null and pwb.construction_site_id is null)
    )
  order by
    case
      when p_construction_site_id is not null and pwb.construction_site_id = p_construction_site_id then 1
      when p_project_id is not null and pwb.project_id = p_project_id and pwb.construction_site_id is null then 2
      else 3
    end
  limit 1;

  if not (
    v_can_read_project
    or app_private.project_workflow_binding_can_manage(p_project_id, p_construction_site_id, v_binding.workflow_template_id)
    or (v_binding.workflow_template_id is not null
      and app_private.workflow_template_actor_can_view(v_binding.workflow_template_id, v_actor))
  ) then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
  end if;

  if v_binding.id is null then
    return jsonb_build_object(
      'subjectType', p_subject_type,
      'projectId', p_project_id,
      'constructionSiteId', p_construction_site_id,
      'binding', null,
      'scope', null,
      'valid', false,
      'errors', jsonb_build_array('Chưa cấu hình workflow cho đề xuất vật tư.'),
      'canManage', app_private.project_workflow_binding_can_manage(p_project_id, p_construction_site_id),
      'canCustomize', v_can_customize
    );
  end if;

  select wt.* into v_template from public.workflow_templates wt where wt.id = v_binding.workflow_template_id;

  v_scope := case
    when v_binding.construction_site_id is not null then 'site'
    when v_binding.project_id is not null then 'project'
    else 'global'
  end;
  v_validation := app_private.project_workflow_validate_template(v_binding.workflow_template_id);

  return jsonb_build_object(
    'subjectType', p_subject_type,
    'projectId', p_project_id,
    'constructionSiteId', p_construction_site_id,
    'binding', to_jsonb(v_binding),
    'scope', v_scope,
    'valid', coalesce((v_validation ->> 'valid')::boolean, false),
    'errors', coalesce(v_validation -> 'errors', '[]'::jsonb),
    'validation', v_validation,
    'canManage', app_private.project_workflow_binding_can_manage(
      p_project_id, p_construction_site_id, v_binding.workflow_template_id
    ),
    'canCustomize', v_can_customize,
    -- Room viewers may not pass template RLS; the name is all they need.
    'templateName', case
      when v_can_read_project
        or app_private.workflow_template_actor_can_view(v_template.id, v_actor)
      then v_template.name
    end,
    'templateOwnedByProject', v_template.owner_project_id is not null
      and v_template.owner_project_id = p_project_id,
    'clonedFromTemplateId', v_template.cloned_from_template_id
  );
end;
$$;

revoke all on function public.get_project_workflow_configuration(text, text, text) from public, anon;
grant execute on function public.get_project_workflow_configuration(text, text, text) to authenticated, service_role;
