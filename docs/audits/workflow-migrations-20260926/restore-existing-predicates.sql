-- Recovery reference: restores prior predicates; ownership columns and cloned data are retained.
CREATE OR REPLACE FUNCTION app_private.project_workflow_binding_can_manage(p_project_id text, p_construction_site_id text, p_template_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    public.is_admin()
    or public.is_module_admin('WF')
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
$function$
;
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
          not app_private.workflow_action_is_enforced('workflow.template.edit')
          and p_actor_id = public.current_app_user_id()
          and app_private.can_access_module('WF')
        )
      )
  );
$function$
;
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
$function$
;
CREATE OR REPLACE FUNCTION public.get_project_workflow_configuration(p_subject_type text, p_project_id text DEFAULT NULL::text, p_construction_site_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_binding public.project_workflow_bindings%rowtype;
  v_scope text;
  v_validation jsonb;
begin
  if public.current_app_user_id() is null then
    raise exception 'authentication required';
  end if;
  if p_subject_type <> 'material_request' then
    raise exception 'unsupported project workflow subject type: %', p_subject_type;
  end if;

  select pwb.*
    into v_binding
  from public.project_workflow_bindings pwb
  join public.workflow_templates wt on wt.id = pwb.workflow_template_id
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

  if not found then
    return jsonb_build_object(
      'subjectType', p_subject_type,
      'projectId', p_project_id,
      'constructionSiteId', p_construction_site_id,
      'binding', null,
      'scope', null,
      'valid', false,
      'errors', jsonb_build_array('Chưa cấu hình workflow cho đề xuất vật tư.'),
      'canManage', app_private.project_workflow_binding_can_manage(p_project_id, p_construction_site_id)
    );
  end if;

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
    )
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.set_project_workflow_binding(p_subject_type text, p_workflow_template_id uuid, p_project_id text DEFAULT NULL::text, p_construction_site_id text DEFAULT NULL::text)
 RETURNS project_workflow_bindings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_validation jsonb;
  v_binding public.project_workflow_bindings%rowtype;
begin
  if v_actor is null then
    raise exception 'authentication required';
  end if;
  if p_subject_type <> 'material_request' then
    raise exception 'unsupported project workflow subject type: %', p_subject_type;
  end if;
  if p_construction_site_id is not null and p_project_id is null then
    raise exception 'site binding requires project id';
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
$function$
;