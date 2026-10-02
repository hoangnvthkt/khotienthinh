-- Task 13, step 1: nothing decides access from the four legacy module columns any more.
-- * 10 shared catalogs (project types/groups/sectors, inspection templates, work groups): read by
--   every active account (the restrictive *_active_actor_gate still requires one). Writes unchanged.
-- * projects: an active member of the project's staff can read that project (before, Room members
--   without a project grant could not); the legacy "DA" module branch is removed.
-- * workflow / work-workspace helpers: legacy "WF"/"DA" branches removed (dead or unused, see log).
-- * can_access_module: no caller left; now Admin-only and no longer reads the legacy columns.
-- The columns themselves are dropped later, after the observation window (runbook).

create or replace function app_private.project_actor_is_active_staff(p_project_id text, p_user_id uuid default public.current_app_user_id())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_staff staff
    join public.users u on u.id::text = staff.user_id
    where staff.project_id = p_project_id
      and staff.user_id = p_user_id::text
      and staff.end_date is null
      and coalesce(u.is_active, false)
  );
$$;
revoke all on function app_private.project_actor_is_active_staff(text, uuid) from public, anon;
grant execute on function app_private.project_actor_is_active_staff(text, uuid) to authenticated;

drop policy if exists inspection_categories_phase0_select on public.inspection_categories;
create policy inspection_categories_reference_select on public.inspection_categories for select to authenticated using (true);

drop policy if exists inspection_template_items_phase0_select on public.inspection_template_items;
create policy inspection_template_items_reference_select on public.inspection_template_items for select to authenticated using (true);

drop policy if exists inspection_templates_phase0_select on public.inspection_templates;
create policy inspection_templates_reference_select on public.inspection_templates for select to authenticated using (true);

drop policy if exists inspection_work_types_phase0_select on public.inspection_work_types;
create policy inspection_work_types_reference_select on public.inspection_work_types for select to authenticated using (true);

drop policy if exists template_sections_phase0_select on public.template_sections;
create policy template_sections_reference_select on public.template_sections for select to authenticated using (true);

drop policy if exists project_groups_phase3_select on public.project_groups;
create policy project_groups_reference_select on public.project_groups for select to authenticated using (true);

drop policy if exists project_sectors_phase3_select on public.project_sectors;
create policy project_sectors_reference_select on public.project_sectors for select to authenticated using (true);

drop policy if exists project_types_phase3_select on public.project_types;
create policy project_types_reference_select on public.project_types for select to authenticated using (true);

drop policy if exists work_groups_phase3_select on public.work_groups;
create policy work_groups_reference_select on public.work_groups for select to authenticated using (true);

drop policy if exists work_group_members_phase3_select on public.work_group_members;
create policy work_group_members_reference_select on public.work_group_members for select to authenticated using (true);

drop policy if exists projects_phase3_select on public.projects;
create policy projects_member_select on public.projects for select to authenticated
  using (
    app_private.project_scope_has_any_grant_v2(id, construction_site_id::text, public.current_app_user_id())
    or app_private.project_actor_is_active_staff(id)
  );

CREATE OR REPLACE FUNCTION app_private.workflow_actor_can_create_instance(p_actor_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_actor_id is not null
    and (
      app_private.workflow_has_action(
        'workflow.instance.create', null, null, p_actor_id
      )
      or app_private.has_permission(
        p_actor_id, 'workflow.instance.create', 'own', p_actor_id::text
      )
    );
$function$;

CREATE OR REPLACE FUNCTION app_private.workflow_actor_can_mutate_own_draft(p_instance_id uuid, p_permission_code text, p_actor_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        )
    );
$function$;

CREATE OR REPLACE FUNCTION app_private.workflow_template_actor_can_edit(p_template_id uuid, p_actor_id uuid DEFAULT current_app_user_id())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
          app_private.project_owned_workflow_actor_has_room_action(template_row.id, p_actor_id, 'edit')
          and app_private.project_owned_workflow_actor_has_room_action(template_row.id, p_actor_id, 'view')
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION app_private.workflow_template_actor_can_publish(p_template_id uuid, p_actor_id uuid DEFAULT current_app_user_id())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_actor_id is not null
    and (
      public.is_admin()
      or app_private.workflow_has_action(
        'workflow.template.publish', null, null, p_actor_id
      )
    )
    and exists (
      select 1 from public.workflow_templates
      where id = p_template_id
    );
$function$;

CREATE OR REPLACE FUNCTION app_private.workflow_template_actor_can_view(p_template_id uuid, p_actor_id uuid DEFAULT current_app_user_id())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        or exists (
          select 1
          from public.workflow_instances instance_row
          join public.workflow_instance_participants participant_row
            on participant_row.instance_id = instance_row.id
           and participant_row.user_id = p_actor_id
           and participant_row.ended_at is null
          where instance_row.template_id = template_row.id
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION app_private.work_workspace_create(p_input jsonb, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := app_private.work_workspace_active_actor();
  v_existing app_private.work_command_idempotency%rowtype;
  v_hash text;
  v_kind text;
  v_name text;
  v_description text;
  v_icon text;
  v_color text;
  v_cover text;
  v_department uuid;
  v_project text;
  v_scope_id text;
  v_workspace public.work_workspaces%rowtype;
  v_member public.work_workspace_members%rowtype;
  v_result jsonb;
  v_constraint text;
begin
  if p_idempotency_key is null or jsonb_typeof(p_input) is distinct from 'object' then
    raise exception 'WORK_INVALID_COMMAND' using errcode = '22023';
  end if;
  v_hash := md5(jsonb_build_object('command','create_work_workspace','input',p_input)::text);
  insert into app_private.work_command_idempotency(actor_user_id,idempotency_key,command_name,request_hash)
    values(v_actor,p_idempotency_key,'create_work_workspace',v_hash)
    on conflict (actor_user_id,idempotency_key) do nothing;
  select * into strict v_existing
  from app_private.work_command_idempotency
  where actor_user_id=v_actor and idempotency_key=p_idempotency_key
  for update;
  if v_existing.command_name <> 'create_work_workspace' or v_existing.request_hash <> v_hash then
    raise exception 'WORK_IDEMPOTENCY_CONFLICT';
  end if;
  if v_existing.response_payload is not null then
    if app_private.work_workspace_member_role((v_existing.response_payload->>'id')::uuid,v_actor) is null then
      raise exception 'WORK_ACCESS_DENIED' using errcode = '42501';
    end if;
    return v_existing.response_payload;
  end if;

  if p_input - array['kind','name','description','iconKey','colorKey','coverKey','departmentId','projectId']
       <> '{}'::jsonb
     or jsonb_typeof(p_input->'kind') is distinct from 'string'
     or jsonb_typeof(p_input->'name') is distinct from 'string'
     or (p_input ? 'description' and jsonb_typeof(p_input->'description') not in ('string','null'))
     or jsonb_typeof(p_input->'iconKey') is distinct from 'string'
     or jsonb_typeof(p_input->'colorKey') is distinct from 'string'
     or jsonb_typeof(p_input->'coverKey') is distinct from 'string' then
    raise exception 'WORK_INVALID_COMMAND' using errcode = '22023';
  end if;
  v_kind := p_input->>'kind';
  v_name := btrim(p_input->>'name');
  v_description := case when p_input ? 'description' then p_input->>'description' end;
  v_icon := p_input->>'iconKey';
  v_color := p_input->>'colorKey';
  v_cover := p_input->>'coverKey';
  if v_kind not in ('department','project','collaboration')
     or char_length(v_name) not between 2 and 160
     or (v_description is not null and char_length(v_description)>2000)
     or v_icon not in ('folder','building','briefcase','users','rocket','target','layers','calendar')
     or v_color not in ('slate','blue','teal','green','amber','orange','rose','violet')
     or v_cover not in ('plain','grid','waves','dots','blueprint','sunrise') then
    raise exception 'WORK_INVALID_COMMAND' using errcode = '22023';
  end if;

  if v_kind = 'department' then
    if (p_input ? 'projectId') or nullif(btrim(p_input->>'departmentId'),'') is null then
      raise exception 'WORK_INVALID_SCOPE' using errcode = '22023';
    end if;
    begin v_department := (p_input->>'departmentId')::uuid;
    exception when others then raise exception 'WORK_INVALID_SCOPE' using errcode = '22023'; end;
    v_scope_id := v_department::text;
  elsif v_kind = 'project' then
    if (p_input ? 'departmentId') or nullif(btrim(p_input->>'projectId'),'') is null then
      raise exception 'WORK_INVALID_SCOPE' using errcode = '22023';
    end if;
    v_project := btrim(p_input->>'projectId');
    v_scope_id := v_project;
  else
    if p_input ? 'departmentId' or p_input ? 'projectId' then
      raise exception 'WORK_INVALID_SCOPE' using errcode = '22023';
    end if;
    v_scope_id := '*';
  end if;
  if not app_private.has_permission(v_actor,'work.workspace.create',case when v_kind='collaboration' then 'global' else v_kind end,v_scope_id) then
    raise exception 'WORK_WORKSPACE_CREATE_DENIED' using errcode = '42501';
  end if;
  -- Match the existing source SELECT policies after checking create authority.
  -- Missing/invisible projects share one response; their status is not probed.
  if v_kind='project' then
    if not exists(select 1 from public.projects p where p.id=v_project
      and (app_private.project_scope_has_any_grant_v2(p.id,p.construction_site_id::text,v_actor))) then
      raise exception 'WORK_SOURCE_VIEW_DENIED' using errcode='42501';
    end if;
    if not exists(select 1 from public.projects p where p.id=v_project
      and p.status in ('planning','active','paused') and not p.is_hidden) then
      raise exception 'WORK_SOURCE_NOT_ACTIVE' using errcode='42501';
    end if;
  elsif v_kind='department' and not exists(select 1 from public.org_units d where d.id=v_department and d.is_active) then
    raise exception 'WORK_SOURCE_NOT_ACTIVE' using errcode='42501';
  end if;

  -- A new Workspace must not hide legacy source data.  WS5 will provide the
  -- explicit backfill path for these rows.
  if v_kind='department' and (
      exists(select 1 from public.work_tasks t where t.scope_type='department' and t.department_id=v_department and t.workspace_id is null)
      or exists(select 1 from public.work_task_groups g where g.scope_type='department' and g.department_id=v_department and g.workspace_id is null)
      or exists(select 1 from public.work_sla_policies p where p.scope_type='department' and p.department_id=v_department and p.workspace_id is null)
      or exists(select 1 from public.work_sla_calendars c
        where c.workspace_id is null and c.scope_type='department' and c.department_id=v_department)
    ) then
    raise exception 'WORK_WORKSPACE_MIGRATION_REQUIRED' using errcode = '55000';
  end if;
  if v_kind='project' and (
      exists(select 1 from public.work_tasks t where t.scope_type='project' and t.project_id=v_project and t.workspace_id is null)
      or exists(select 1 from public.work_task_groups g where g.scope_type='project' and g.project_id=v_project and g.workspace_id is null)
      or exists(select 1 from public.work_sla_policies p where p.scope_type='project' and p.project_id=v_project and p.workspace_id is null)
      or exists(select 1 from public.work_sla_calendars c
        where c.workspace_id is null and c.scope_type='project' and c.project_id=v_project)
    ) then
    raise exception 'WORK_WORKSPACE_MIGRATION_REQUIRED' using errcode = '55000';
  end if;

  begin
    insert into public.work_workspaces(
      kind,department_id,project_id,name,description,icon_key,color_key,cover_key,
      status,access_mode,lock_version,created_by
    ) values (
      v_kind,v_department,v_project,v_name,v_description,v_icon,v_color,v_cover,
      'active','workspace',1,v_actor
    ) returning * into v_workspace;
  exception when unique_violation then
    get stacked diagnostics v_constraint = CONSTRAINT_NAME;
    if v_constraint in ('work_workspace_department_unique','work_workspace_project_unique') then
      raise exception 'WORK_WORKSPACE_SOURCE_EXISTS' using errcode = '23505';
    end if;
    raise;
  end;
  insert into public.work_workspace_members(
    workspace_id,user_id,role,status,starts_at,added_by,origin,lock_version
  ) values(v_workspace.id,v_actor,'admin','active',now(),v_actor,'manual',1)
  returning * into v_member;
  insert into app_private.work_workspace_events(
    actor_user_id,workspace_id,kind,before_value,after_value,reason,idempotency_key
  ) values(
    v_actor,v_workspace.id,'workspace.created',null,
    jsonb_build_object('workspace',to_jsonb(v_workspace),'member',to_jsonb(v_member)),
    'Workspace created',p_idempotency_key
  );
  v_result := app_private.work_workspace_summary(v_workspace.id,v_actor);
  update app_private.work_command_idempotency
  set response_payload=v_result,completed_at=now()
  where actor_user_id=v_actor and idempotency_key=p_idempotency_key;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.work_workspace_list_sources(p_kind text, p_search text DEFAULT ''::text, p_cursor jsonb DEFAULT NULL::jsonb, p_limit integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := app_private.work_workspace_active_actor();
  v_search text := btrim(coalesce(p_search,''));
  v_limit integer := coalesce(p_limit,30);
  v_cursor_at timestamptz;
  v_cursor_id text;
  v_rows jsonb;
begin
  if p_kind is null or p_kind not in ('department','project','collaboration')
     or char_length(v_search) > 100 then
    raise exception 'WORK_INVALID_FILTER' using errcode = '22023';
  end if;
  if v_limit < 1 or v_limit > 50 then
    raise exception 'WORK_INVALID_LIMIT' using errcode = '22023';
  end if;
  if p_cursor is not null then
    if jsonb_typeof(p_cursor) is distinct from 'object'
       or p_cursor->>'sortAt' is null
       or p_cursor->>'id' is null
       or (select count(*) from jsonb_object_keys(p_cursor)) <> 2 then
      raise exception 'WORK_INVALID_CURSOR' using errcode = '22023';
    end if;
    begin
      v_cursor_at := (p_cursor->>'sortAt')::timestamptz;
    exception when others then
      raise exception 'WORK_INVALID_CURSOR' using errcode = '22023';
    end;
    v_cursor_id := p_cursor->>'id';
  end if;

  -- Collaboration has no organization/project source.  It is still a valid
  -- source kind for the create screen and requires the global capability.
  if p_kind = 'collaboration' then
    if not app_private.has_permission(v_actor,'work.workspace.create','global','*') then
      raise exception 'WORK_WORKSPACE_CREATE_DENIED' using errcode = '42501';
    end if;
    return jsonb_build_object('items','[]'::jsonb,'nextCursor',null);
  end if;

  with source_rows as (
    select d.id::text as source_id, d.name, 'department'::text as source_kind,
      coalesce(d.created_at,'-infinity'::timestamptz) as created_at
    from public.org_units d
    where p_kind = 'department'
      and d.is_active
      and app_private.has_permission(v_actor,'work.workspace.create','department',d.id::text)
    union all
    select p.id::text, p.name, 'project'::text,coalesce(p.created_at,'-infinity'::timestamptz)
    from public.projects p
      where p_kind = 'project'
      and p.status in ('planning','active','paused')
      and not p.is_hidden
      and app_private.has_permission(v_actor,'work.workspace.create','project',p.id)
      and (app_private.project_scope_has_any_grant_v2(p.id,p.construction_site_id::text,v_actor))
  ), visible_rows as (
    select s.source_id, s.name, s.source_kind,s.created_at,
      w.id as existing_workspace_id
    from source_rows s
    left join public.work_workspaces w
      on (s.source_kind='department' and w.department_id::text=s.source_id)
      or (s.source_kind='project' and w.project_id=s.source_id)
    where (v_search='' or lower(s.name) like '%'||lower(v_search)||'%')
      and (v_cursor_at is null or (s.created_at,s.source_id) < (v_cursor_at,v_cursor_id))
  ), page_rows as (
    select v.source_id, v.name, v.source_kind,v.created_at,
      case when v.existing_workspace_id is not null
        and app_private.work_workspace_member_role(v.existing_workspace_id,v_actor) is not null
        then v.existing_workspace_id end as existing_workspace_id
    from visible_rows v
    order by v.created_at desc,v.source_id desc
    limit v_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',p.source_id,
      'name',p.name,
      'kind',p.source_kind,
      'existingWorkspaceId',p.existing_workspace_id,
      '__sortAt',p.created_at
    ) order by p.created_at desc,p.source_id desc),'[]'::jsonb)
    into v_rows
  from page_rows p;

  return jsonb_build_object(
    'items',(select coalesce(jsonb_agg(x.value - '__sortAt' order by x.ordinality),'[]'::jsonb)
             from jsonb_array_elements(v_rows) with ordinality x(value,ordinality)
             where x.ordinality <= v_limit),
    'nextCursor',case when jsonb_array_length(v_rows)>v_limit then
      jsonb_build_object('sortAt',v_rows->(v_limit-1)->>'__sortAt','id',v_rows->(v_limit-1)->>'id')
      else null end
  );
end;
$function$;

create or replace function app_private.can_access_module(p_module text)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  -- Deprecated (Task 13): no caller left. Kept Admin-only until the legacy columns are dropped.
  select exists (
    select 1 from public.users u
    where u.id = public.current_app_user_id() and coalesce(u.is_active, false) and u.role = 'ADMIN'
  );
$function$;
