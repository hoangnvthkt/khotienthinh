-- The assignment-row loop only ever matched project material-request tickets,
-- which have their own SLA reminders and are never delivered from this outbox;
-- skip them instead of queueing suppressed rows every day.
do $migration$
declare
  v_def text;
  v_anchor text := E'and not exists(select 1 from public.workflow_subjects s where s.workflow_instance_id=i.id and s.subject_type=''request'')\n    order by a.due_at';
  v_replacement text := E'and not exists(select 1 from public.workflow_subjects s where s.workflow_instance_id=i.id)\n    order by a.due_at';
begin
  v_def := pg_get_functiondef('app_private.enqueue_workflow_notification_reminders(integer)'::regprocedure);
  if strpos(v_def, v_anchor) = 0 then
    raise notice 'assignment loop already excludes project tickets';
  else
    execute replace(v_def, v_anchor, v_replacement);
  end if;
end
$migration$;
