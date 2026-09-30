-- Stop daily "Quá hạn" reminders for long-abandoned Quy trình tickets: remind
-- only while a stage is at most 7 days overdue. The first rollout of stage
-- reminders (20260930082919) sent one overdue reminder for 8 tickets left
-- running since July–August; without this window they would repeat daily.
do $migration$
declare
  v_def text;
  v_anchor text := E'        <= now() + interval ''60 minutes''\n      and not exists(select 1 from public.request_instances r where r.workflow_instance_id=i.id)\n      and not exists(select 1 from public.workflow_subjects s where s.workflow_instance_id=i.id)';
  v_replacement text := E'        <= now() + interval ''60 minutes''\n      and coalesce(entered.at, i.created_at) + (n.config ->> ''slaHours'')::numeric * interval ''1 hour''\n        >= now() - interval ''7 days''\n      and not exists(select 1 from public.request_instances r where r.workflow_instance_id=i.id)\n      and not exists(select 1 from public.workflow_subjects s where s.workflow_instance_id=i.id)';
begin
  v_def := pg_get_functiondef('app_private.enqueue_workflow_notification_reminders(integer)'::regprocedure);
  if strpos(v_def, E'>= now() - interval ''7 days''') > 0 then
    raise notice 'reminder window already applied';
  elsif strpos(v_def, v_anchor) = 0 then
    raise exception 'enqueue_workflow_notification_reminders anchor not found';
  else
    execute replace(v_def, v_anchor, v_replacement);
  end if;
end
$migration$;
