-- Validate a template only after switching it on. project_workflow_validate_template
-- reports an inactive template as invalid, so validating first made every
-- switched-off template impossible to switch back on. Failures roll back the switch.

create or replace function public.publish_workflow_template(p_template_id uuid, p_is_active boolean, p_idempotency_key uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid := app_private.workflow_notification_actor();
  v_cached jsonb;
  v_template public.workflow_templates%rowtype;
  v_validation jsonb;
  v_assignee_errors text[];
begin
  v_cached := app_private.workflow_command_begin(
    v_actor, p_idempotency_key, 'publish_workflow_template',
    jsonb_build_object('templateId', p_template_id, 'isActive', p_is_active)
  );
  if v_cached is not null then return v_cached; end if;
  if not app_private.workflow_template_actor_can_publish(p_template_id, v_actor) then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
  end if;
  -- Switch first, then validate: the structure check reports an inactive
  -- template as invalid, so validating before the switch could never pass.
  -- Any failure below rolls the switch back.
  update public.workflow_templates
  set is_active = coalesce(p_is_active, is_active), updated_at = now()
  where id = p_template_id
  returning * into v_template;
  if v_template.id is null then raise exception 'WORKFLOW_TEMPLATE_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_is_active then
    v_validation := app_private.project_workflow_validate_template(p_template_id);
    if not coalesce((v_validation ->> 'valid')::boolean, false) then
      raise exception 'WORKFLOW_TEMPLATE_INVALID'
        using errcode = '22023', detail = array_to_string(array(select jsonb_array_elements_text(v_validation -> 'errors')), E'\n');
    end if;
    v_assignee_errors := app_private.workflow_template_assignee_errors(p_template_id);
    if cardinality(v_assignee_errors) > 0 then
      raise exception 'WORKFLOW_STEP_ASSIGNEE_MISSING'
        using errcode = '22023', detail = array_to_string(v_assignee_errors, E'\n');
    end if;
  end if;
  return app_private.workflow_command_finish(
    v_actor, p_idempotency_key, jsonb_build_object('template', to_jsonb(v_template))
  );
end;
$$;

