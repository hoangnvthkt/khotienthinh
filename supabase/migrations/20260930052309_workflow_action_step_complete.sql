-- "Hành động" (ACTION) steps are tasks that get completed, not decisions:
--   1. process_workflow_instance_fast refuses REJECTED on an ACTION step, and on
--      an APPROVAL step whose config sets allowReject = false.
--   2. The "step approved" notification says "đã hoàn thành" for ACTION steps.
-- Both functions are patched in place from their live definitions so every
-- other line stays exactly as deployed; each patch asserts its anchor exists.

do $migration$
declare
  v_def text;
  v_anchor text := E'  if not v_can_act then\n    raise exception ''user is not allowed to process current workflow step'';\n  end if;\n';
  v_guard text := E'\n  if p_action = ''REJECTED''::public.workflow_instance_action\n     and (\n       v_current_node.type = ''ACTION''::public.workflow_node_type\n       or coalesce(v_current_node.config ->> ''allowReject'', ''true'') = ''false''\n     ) then\n    raise exception ''WORKFLOW_REJECT_NOT_ALLOWED'' using errcode = ''22023'';\n  end if;\n';
begin
  v_def := pg_get_functiondef(
    'public.process_workflow_instance_fast(uuid, public.workflow_instance_action, uuid, text, uuid[])'::regprocedure
  );
  if strpos(v_def, 'WORKFLOW_REJECT_NOT_ALLOWED') > 0 then
    raise notice 'process_workflow_instance_fast already guarded';
  elsif strpos(v_def, v_anchor) = 0 then
    raise exception 'process_workflow_instance_fast anchor not found';
  else
    execute replace(v_def, v_anchor, v_anchor || v_guard);
  end if;
end
$migration$;

do $migration$
declare
  v_def text;
  v_anchor text := E'  v_message := case when o.event_type';
  v_patch text := E'  if o.event_type = ''workflow.step_approved'' and exists (\n    select 1 from public.workflow_nodes step_node\n    where step_node.id::text = o.payload ->> ''outgoingNodeId''\n      and step_node.type = ''ACTION''::public.workflow_node_type\n  ) then\n    v_action := ''Đã hoàn thành bước'';\n    v_phrase := ''đã hoàn thành một bước của'';\n  end if;\n';
begin
  v_def := pg_get_functiondef('app_private.workflow_notification_content(uuid)'::regprocedure);
  if strpos(v_def, 'Đã hoàn thành bước') > 0 then
    raise notice 'workflow_notification_content already patched';
  elsif strpos(v_def, v_anchor) = 0 then
    raise exception 'workflow_notification_content anchor not found';
  else
    execute replace(v_def, v_anchor, v_patch || v_anchor);
  end if;
end
$migration$;
