create table app_private.request_notification_reminder_keys (
  reminder_key text primary key,created_at timestamptz not null default now()
);
alter table app_private.request_notification_reminder_keys enable row level security;
revoke all on app_private.request_notification_reminder_keys from public,anon,authenticated;

create table app_private.workflow_notification_reminder_keys (
  reminder_key text primary key,created_at timestamptz not null default now()
);
alter table app_private.workflow_notification_reminder_keys enable row level security;
revoke all on app_private.workflow_notification_reminder_keys from public,anon,authenticated;

create index if not exists request_instances_notification_due_idx on public.request_instances(due_at,id)
  where status in('PENDING','IN_PROGRESS','RETURNED') and due_at is not null;
create index if not exists workflow_step_assignments_notification_due_idx on public.workflow_step_assignments(due_at,workflow_instance_id,id)
  where status='PENDING' and due_at is not null;

create function app_private.enqueue_request_notification_reminders(p_limit integer)
returns integer language plpgsql security definer set search_path='' as $$
declare c record; v_kind text; v_key text; v_count integer:=0;
begin
  perform app_private.require_request_notification_worker();
  for c in
    select distinct on(q.request_id,q.due_at) q.* from(
      select r.id request_id,r.due_at,null::uuid node_id,null::text block_key
      from public.request_instances r
      where r.status in('PENDING','IN_PROGRESS','RETURNED') and r.due_at is not null and r.due_at<=now()+interval '60 minutes'
      union all
      select r.id,a.due_at,a.node_id,a.metadata->>'requestBlockKey'
      from public.workflow_step_assignments a join public.request_instances r on r.workflow_subject_id=a.workflow_subject_id
      where a.status='PENDING' and a.due_at is not null and a.due_at<=now()+interval '60 minutes'
        and r.status in('PENDING','IN_PROGRESS','RETURNED')
    )q order by q.request_id,q.due_at,q.block_key nulls first
    limit least(100,greatest(1,coalesce(p_limit,50)))
  loop
    v_kind:=case when c.due_at<=now() then 'REQUEST_OVERDUE' else 'REQUEST_DUE_SOON' end;
    v_key:='request-reminder:'||c.request_id||':'||v_kind||':'||extract(epoch from c.due_at)::bigint
      ||case when v_kind='REQUEST_OVERDUE' then ':'||(now() at time zone 'Asia/Ho_Chi_Minh')::date else '' end;
    insert into app_private.request_notification_reminder_keys values(v_key,now()) on conflict do nothing;
    if not found then continue; end if;
    perform app_private.enqueue_request_notification_event(c.request_id,v_kind,null,v_key,
      jsonb_strip_nulls(jsonb_build_object('dueAt',c.due_at,'nodeId',c.node_id,'blockKey',c.block_key)));
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$;
revoke all on function app_private.enqueue_request_notification_reminders(integer) from public,anon,authenticated;
grant execute on function app_private.enqueue_request_notification_reminders(integer) to service_role;
create function public.enqueue_request_notification_reminders(p_limit integer default 50)
returns integer language sql security invoker set search_path='' as $$
  select app_private.enqueue_request_notification_reminders(p_limit);
$$;
revoke all on function public.enqueue_request_notification_reminders(integer) from public,anon,authenticated;
grant execute on function public.enqueue_request_notification_reminders(integer) to service_role;

create function app_private.enqueue_workflow_notification_reminders(p_limit integer)
returns integer language plpgsql security definer set search_path='' as $$
declare c record; v_kind text; v_key text; v_count integer:=0;
begin
  perform app_private.workflow_require_notification_worker();
  if not(select enabled from app_private.workflow_notification_settings where singleton) then return 0; end if;
  for c in
    select a.id assignment_id,a.workflow_instance_id instance_id,a.node_id,a.assignee_user_id,a.due_at
    from public.workflow_step_assignments a join public.workflow_instances i on i.id=a.workflow_instance_id
    where a.status='PENDING' and a.due_at is not null and a.due_at<=now()+interval '60 minutes'
      and i.status='RUNNING'
      and not exists(select 1 from public.request_instances r where r.workflow_instance_id=i.id)
      and not exists(select 1 from public.workflow_subjects s where s.workflow_instance_id=i.id and s.subject_type='request')
    order by a.due_at,a.id limit least(100,greatest(1,coalesce(p_limit,50)))
  loop
    v_kind:=case when c.due_at<=now() then 'workflow.step_overdue' else 'workflow.step_due_soon' end;
    v_key:='workflow-reminder:'||c.assignment_id||':'||v_kind||':'||extract(epoch from c.due_at)::bigint
      ||case when v_kind='workflow.step_overdue' then ':'||(now() at time zone 'Asia/Ho_Chi_Minh')::date else '' end;
    insert into app_private.workflow_notification_reminder_keys values(v_key,now()) on conflict do nothing;
    if not found then continue; end if;
    perform app_private.enqueue_workflow_notification_event(c.instance_id,v_kind,null,v_key,
      jsonb_build_object('dueAt',c.due_at,'nodeId',c.node_id),array[c.assignee_user_id]);
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$;
revoke all on function app_private.enqueue_workflow_notification_reminders(integer) from public,anon,authenticated;
grant execute on function app_private.enqueue_workflow_notification_reminders(integer) to service_role;
create function public.enqueue_workflow_notification_reminders(p_limit integer default 50)
returns integer language sql security invoker set search_path='' as $$
  select app_private.enqueue_workflow_notification_reminders(p_limit);
$$;
revoke all on function public.enqueue_workflow_notification_reminders(integer) from public,anon,authenticated;
grant execute on function public.enqueue_workflow_notification_reminders(integer) to service_role;
