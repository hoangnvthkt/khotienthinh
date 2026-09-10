-- Task 4A: configured business intervals, priority policies and assignment SLA.
-- No production calendar or policy is seeded by this migration.
alter table public.work_sla_calendars add column working_intervals jsonb not null default '[]';
alter table public.work_sla_calendar_exceptions add column working_intervals jsonb not null default '[]';
alter table public.work_sla_policies add column priority text;
alter table public.work_sla_policies add column execution_minutes integer;
alter table public.work_sla_policies add constraint work_sla_policy_priority_check check (priority in ('normal','important','urgent'));
alter table public.work_sla_policies add constraint work_sla_execution_duration_check check (execution_minutes between 1 and 525600);
alter table public.work_sla_policies add constraint work_sla_ack_duration_bound check (acknowledgement_minutes<=525600);
drop index public.work_sla_policies_active_global_idx;
drop index public.work_sla_policies_active_department_idx;
drop index public.work_sla_policies_active_project_idx;
create unique index work_sla_policies_active_global_priority_idx on public.work_sla_policies(coalesce(priority,'*'))
  where scope_type='global' and is_active and effective_to is null;
create unique index work_sla_policies_active_department_priority_idx on public.work_sla_policies(department_id,coalesce(priority,'*'))
  where scope_type='department' and is_active and effective_to is null;
create unique index work_sla_policies_active_project_priority_idx on public.work_sla_policies(project_id,coalesce(priority,'*'))
  where scope_type='project' and is_active and effective_to is null;
alter table public.work_task_assignments add column execution_sla_started_at timestamptz;
alter table public.work_task_assignments add column execution_sla_due_at timestamptz;
alter table public.work_task_assignments add column sla_snapshot jsonb not null default '{}';
alter table public.work_task_assignments add constraint work_assignment_execution_sla_check check (
  (execution_sla_due_at is null or execution_sla_started_at is not null)
  and (execution_sla_started_at is null or acknowledged_at is not null)
  and jsonb_typeof(sla_snapshot)='object');
create index work_task_assignments_ack_due_idx on public.work_task_assignments(acknowledgement_due_at,id)
  where ended_at is null and acknowledged_at is null;
create index work_task_assignments_execution_due_idx on public.work_task_assignments(execution_sla_due_at,id)
  where ended_at is null and completed_at is null;

create function app_private.work_valid_intervals(p_intervals jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare x jsonb; previous_end time; first_time time; last_time time;
begin
  if jsonb_typeof(p_intervals) is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_intervals)>8 then return false; end if;
  for x in select value from jsonb_array_elements(p_intervals) loop
    if jsonb_typeof(x) is distinct from 'object' or x-array['start','end']<>'{}'::jsonb
      or x->>'start' is null or x->>'end' is null then return false; end if;
    first_time:=(x->>'start')::time; last_time:=(x->>'end')::time;
    if first_time>=last_time or (previous_end is not null and first_time<previous_end) then return false; end if;
    previous_end:=last_time;
  end loop;
  return true;
exception when invalid_datetime_format or datetime_field_overflow then return false;
end $$;
revoke all on function app_private.work_valid_intervals(jsonb) from public,anon,authenticated;
alter table public.work_sla_calendars add constraint work_calendar_intervals_check check (app_private.work_valid_intervals(working_intervals));
alter table public.work_sla_calendar_exceptions add constraint work_calendar_exception_intervals_check check (
  app_private.work_valid_intervals(working_intervals) and (is_working_day or working_intervals='[]'::jsonb));

create function app_private.work_add_business_minutes(p_calendar_id uuid,p_start timestamptz,p_minutes integer)
returns timestamptz language plpgsql stable security definer set search_path = '' as $$
declare c public.work_sla_calendars%rowtype; e public.work_sla_calendar_exceptions%rowtype;
  d date; intervals jsonb; x jsonb; t timestamptz; day_end timestamptz;
  remaining numeric:=p_minutes*60::numeric; available numeric;
begin
  if p_start is null or p_minutes is null or p_minutes not between 1 and 525600 then raise exception 'WORK_INVALID_SLA_DURATION' using errcode='22023'; end if;
  select * into c from public.work_sla_calendars where id=p_calendar_id and is_active;
  if c.id is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=c.timezone) then raise exception 'WORK_CALENDAR_NOT_CONFIGURED'; end if;
  d:=(p_start at time zone c.timezone)::date;
  for i in 0..3660 loop
    select * into e from public.work_sla_calendar_exceptions where calendar_id=c.id and exception_date=d;
    if coalesce(e.is_working_day,extract(dow from d)::smallint=any(c.working_weekdays)) then
      intervals:=case when e.id is not null then case when e.working_intervals='[]'::jsonb
        then jsonb_build_array(jsonb_build_object('start',e.workday_start,'end',e.workday_end)) else e.working_intervals end
        when c.working_intervals='[]'::jsonb then jsonb_build_array(jsonb_build_object('start',c.workday_start,'end',c.workday_end))
        else c.working_intervals end;
      for x in select value from jsonb_array_elements(intervals) loop
        t:=greatest(p_start,(d+(x->>'start')::time) at time zone c.timezone);
        day_end:=(d+(x->>'end')::time) at time zone c.timezone;
        available:=greatest(0,extract(epoch from day_end-t));
        if available>=remaining then return t+remaining*interval '1 second'; end if;
        remaining:=remaining-available;
      end loop;
    end if;
    d:=d+1;
  end loop;
  raise exception 'WORK_CALENDAR_NOT_CONFIGURED';
end $$;
revoke all on function app_private.work_add_business_minutes(uuid,timestamptz,integer) from public,anon,authenticated;

create function app_private.work_resolve_sla(p_scope jsonb,p_priority text,p_at timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare p public.work_sla_policies%rowtype; c public.work_sla_calendars%rowtype; minutes integer;
begin
  if p_at is null or p_priority is null or p_priority not in ('normal','important','urgent') then raise exception 'WORK_INVALID_SLA_PRIORITY' using errcode='22023'; end if;
  select policy.* into p from public.work_sla_policies policy join public.work_sla_calendars calendar on calendar.id=policy.calendar_id and calendar.is_active
  where policy.is_active and policy.effective_from<=p_at and (policy.effective_to is null or policy.effective_to>p_at)
    and (policy.priority is null or policy.priority=p_priority)
    and (policy.scope_type='global' or (policy.scope_type=p_scope->>'type'
      and coalesce(policy.department_id::text,policy.project_id)=coalesce(p_scope->>'departmentId',p_scope->>'projectId')))
  order by (policy.scope_type<>'global') desc,(policy.priority is not null) desc,policy.effective_from desc,policy.id desc limit 1;
  if p.id is not null then select * into c from public.work_sla_calendars where id=p.calendar_id;
  else select * into c from public.work_sla_calendars where is_default and is_active; end if;
  if c.id is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=c.timezone) then raise exception 'WORK_CALENDAR_NOT_CONFIGURED'; end if;
  if p.id is not null then minutes:=p.acknowledgement_minutes;
  elsif p_priority='urgent' then minutes:=60;
  elsif p_priority='important' then minutes:=240;
  elsif c.working_intervals='[]'::jsonb then minutes:=extract(epoch from (c.workday_end-c.workday_start))::integer/60;
  else select sum(extract(epoch from ((x->>'end')::time-(x->>'start')::time))/60)::integer into minutes from jsonb_array_elements(c.working_intervals) x; end if;
  if minutes not between 1 and 525600 then raise exception 'WORK_CALENDAR_NOT_CONFIGURED'; end if;
  return jsonb_build_object('calendarId',c.id,'calendar',to_jsonb(c),'policyId',p.id,'priority',p_priority,
    'acknowledgementMinutes',minutes,'executionMinutes',p.execution_minutes,'resolvedAt',p_at);
end $$;
revoke all on function app_private.work_resolve_sla(jsonb,text,timestamptz) from public,anon,authenticated;

create function app_private.work_apply_assignment_sla(p_assignment_id uuid,p_include_ack boolean)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare a public.work_task_assignments%rowtype; t public.work_tasks%rowtype; scope jsonb; config jsonb;
  ack_due timestamptz; execution_due timestamptz; snapshot jsonb; v_at timestamptz;
begin
  select * into strict a from public.work_task_assignments where id=p_assignment_id;
  select * into strict t from public.work_tasks where id=a.task_id;
  scope:=jsonb_strip_nulls(jsonb_build_object('type',t.scope_type,'departmentId',t.department_id,'projectId',t.project_id));
  snapshot:=a.sla_snapshot; ack_due:=a.acknowledgement_due_at;
  if p_include_ack then
    config:=app_private.work_resolve_sla(scope,t.priority,a.assigned_at);
    if a.acknowledged_at is null then ack_due:=app_private.work_add_business_minutes((config->>'calendarId')::uuid,a.assigned_at,(config->>'acknowledgementMinutes')::integer); end if;
    config:=config||jsonb_build_object('exceptions',coalesce((select jsonb_agg(to_jsonb(e) order by e.exception_date)
      from public.work_sla_calendar_exceptions e where e.calendar_id=(config->>'calendarId')::uuid
        and e.exception_date between (a.assigned_at at time zone (config->'calendar'->>'timezone'))::date
          and (coalesce(ack_due,a.assigned_at) at time zone (config->'calendar'->>'timezone'))::date),'[]'));
    snapshot:=snapshot||jsonb_build_object('acknowledgement',config);
  end if;
  if a.acknowledged_at is not null then
    v_at:=a.acknowledged_at;
    config:=app_private.work_resolve_sla(scope,t.priority,v_at);
    if config->>'executionMinutes' is not null then execution_due:=app_private.work_add_business_minutes((config->>'calendarId')::uuid,v_at,(config->>'executionMinutes')::integer); end if;
    config:=config||jsonb_build_object('exceptions',coalesce((select jsonb_agg(to_jsonb(e) order by e.exception_date)
      from public.work_sla_calendar_exceptions e where e.calendar_id=(config->>'calendarId')::uuid
        and e.exception_date between (v_at at time zone (config->'calendar'->>'timezone'))::date
          and (coalesce(execution_due,v_at) at time zone (config->'calendar'->>'timezone'))::date),'[]'));
    snapshot:=snapshot||jsonb_build_object('execution',config);
  end if;
  update public.work_task_assignments set acknowledgement_due_at=ack_due,execution_sla_started_at=a.acknowledged_at,
    execution_sla_due_at=execution_due,sla_snapshot=snapshot where id=a.id;
end $$;
revoke all on function app_private.work_apply_assignment_sla(uuid,boolean) from public,anon,authenticated;

-- Forward replacement preserves the Task 3 command contract and idempotency.
create or replace function app_private.work_create_task(p_input jsonb,p_idempotency_key uuid,p_recipient_fingerprint text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  a uuid := public.current_app_user_id(); v_scope jsonb := p_input->'scope';
  v_request_hash text := md5(jsonb_build_object('input',p_input,'fingerprint',p_recipient_fingerprint)::text);
  v_existing app_private.work_command_idempotency%rowtype; v_preview jsonb; v_task public.work_tasks%rowtype;
  v_sla_config jsonb; v_assignment_id uuid; v_reviewer uuid; v_policy text; v_text text; v_event uuid;
  v_recipient jsonb; v_source jsonb; v_item jsonb; v_member uuid; v_uid uuid;
  v_self_only boolean; v_has_self boolean; v_result jsonb; v_s text; v_k text; v_i integer := 0;
begin
  if a is null or not app_private.has_permission(a,'work.module.access','global','*') then raise exception 'WORK_ACCESS_DENIED' using errcode='42501'; end if;
  if p_idempotency_key is null or p_recipient_fingerprint is null or jsonb_typeof(p_input) is distinct from 'object' then
    raise exception 'WORK_INVALID_COMMAND' using errcode='22023'; end if;
  -- Serializes same actor/key, including concurrent retries; conflicts never overwrite history.
  insert into app_private.work_command_idempotency(actor_user_id,idempotency_key,command_name,request_hash)
    values(a,p_idempotency_key,'create_work_task',v_request_hash) on conflict do nothing;
  select * into strict v_existing from app_private.work_command_idempotency
    where actor_user_id=a and idempotency_key=p_idempotency_key for update;
  if v_existing.command_name<>'create_work_task' or v_existing.request_hash<>v_request_hash then raise exception 'WORK_IDEMPOTENCY_CONFLICT'; end if;
  if v_existing.response_payload is not null then
    if not app_private.work_task_actor_can_view((v_existing.response_payload->>'taskId')::uuid) then raise exception 'WORK_ACCESS_DENIED' using errcode='42501'; end if;
    return v_existing.response_payload;
  end if;
  perform app_private.work_assert_create_scope(v_scope);
  v_s:=case when v_scope->>'type'='direct' then 'own' else v_scope->>'type' end;
  v_k:=coalesce(v_scope->>'departmentId',v_scope->>'projectId','*');
  if p_input-array['title','description','scope','taskGroupId','recipientSources','watcherUserIds','reviewerUserId','reviewPolicy',
    'deadlineAt','priority','privacy','labels','checklist','clonedFromTaskId']<>'{}'::jsonb
    or jsonb_typeof(p_input->'title') is distinct from 'string' or length(btrim(p_input->>'title')) not between 2 and 300
    or coalesce(p_input->>'priority','') not in ('normal','important','urgent')
    or coalesce(p_input->>'privacy','') not in ('standard','restricted')
    or jsonb_typeof(p_input->'watcherUserIds') is distinct from 'array'
    or jsonb_typeof(p_input->'labels') is distinct from 'array'
    or jsonb_typeof(p_input->'checklist') is distinct from 'array' then raise exception 'WORK_INVALID_COMMAND' using errcode='22023'; end if;
  if jsonb_array_length(p_input->'watcherUserIds')>100 or jsonb_array_length(p_input->'labels')>20 or jsonb_array_length(p_input->'checklist')>200
    or exists(select 1 from jsonb_array_elements(p_input->'labels') x where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 80) then
    raise exception 'WORK_INVALID_COMMAND' using errcode='22023'; end if;
  v_text:=app_private.work_validate_document(p_input->'description');
  v_preview:=app_private.work_preview_recipients(p_input->'recipientSources',v_scope);
  if v_preview->>'fingerprint'<>p_recipient_fingerprint then raise exception 'WORK_RECIPIENT_PREVIEW_STALE'; end if;
  if (v_preview->>'validCount')::int=0 then raise exception 'WORK_NO_VALID_RECIPIENTS'; end if;
  if p_input->>'taskGroupId' is not null and not exists(select 1 from public.work_task_groups g
    where g.id=(p_input->>'taskGroupId')::uuid and g.is_active and g.scope_type=v_scope->>'type'
      and g.department_id is not distinct from (v_scope->>'departmentId')::uuid
      and g.project_id is not distinct from v_scope->>'projectId') then raise exception 'WORK_TASK_GROUP_SCOPE_MISMATCH' using errcode='42501'; end if;
  if p_input->>'clonedFromTaskId' is not null and not app_private.work_task_actor_can_view((p_input->>'clonedFromTaskId')::uuid) then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode='42501'; end if;
  if p_input->>'deadlineAt' is not null and (p_input->>'deadlineAt')::timestamptz<=now() then raise exception 'WORK_DEADLINE_EXPIRED' using errcode='22023'; end if;
  select exists(select 1 from jsonb_array_elements(v_preview->'validRecipients') x where x->>'userId'=a::text) into v_has_self;
  v_self_only:=v_has_self and (v_preview->>'validCount')::int=1 and v_scope->>'type'='direct';
  v_policy:=coalesce(p_input->>'reviewPolicy',case when p_input->>'reviewerUserId' is not null and (p_input->>'reviewerUserId')::uuid<>a then 'reviewer_review'
    when v_self_only then 'auto_complete' else 'creator_review' end);
  if v_policy not in ('auto_complete','creator_review','reviewer_review') or (v_policy='auto_complete' and not v_self_only) then
    raise exception 'WORK_REVIEW_POLICY_DENIED' using errcode='42501'; end if;
  v_reviewer:=case v_policy when 'auto_complete' then null when 'creator_review' then a else (p_input->>'reviewerUserId')::uuid end;
  if (v_policy='reviewer_review' and (v_reviewer is null or not app_private.has_permission(a,'work.task.manage_scope',
      case when v_s='own' then 'global' else v_s end,v_k)))
    or (v_policy='auto_complete' and p_input->>'reviewerUserId' is not null)
    or (v_policy='creator_review' and p_input->>'reviewerUserId' is not null and (p_input->>'reviewerUserId')::uuid<>a) then
    raise exception 'WORK_REVIEW_POLICY_DENIED' using errcode='42501'; end if;
  if v_reviewer is not null and (not exists(select 1 from public.users where id=v_reviewer and is_active and account_status='ACTIVE')
    or not app_private.has_permission(v_reviewer,'work.module.access','global','*')
    or not (app_private.has_permission(v_reviewer,'work.task.review','assigned','*')
      or (v_s<>'own' and app_private.has_permission(v_reviewer,'work.task.review',v_s,v_k)))) then
    raise exception 'WORK_REVIEWER_INELIGIBLE' using errcode='42501'; end if;
  for v_uid in select distinct value::uuid from jsonb_array_elements_text(p_input->'watcherUserIds') loop
    if v_uid is null or not exists(select 1 from public.users where id=v_uid and is_active and account_status='ACTIVE')
      or not app_private.has_permission(v_uid,'work.module.access','global','*')
      or not (app_private.has_permission(v_uid,'work.task.view_related','assigned','*')
        or (v_s<>'own' and app_private.has_permission(v_uid,'work.task.view_related',v_s,v_k))) then
      raise exception 'WORK_WATCHER_INELIGIBLE' using errcode='42501'; end if;
  end loop;
  v_sla_config:=app_private.work_resolve_sla(v_scope,p_input->>'priority',now());
  insert into public.work_tasks(task_code,title,description_document,description_text,scope_type,department_id,project_id,task_group_id,
    recipient_snapshot_fingerprint,status,priority,privacy,labels,deadline_at,review_policy,reviewer_user_id,created_by,cloned_from_task_id)
  values(app_private.next_work_task_code(),btrim(p_input->>'title'),p_input->'description',v_text,v_scope->>'type',(v_scope->>'departmentId')::uuid,
    v_scope->>'projectId',(p_input->>'taskGroupId')::uuid,p_recipient_fingerprint,case when v_has_self then 'not_started' else 'pending_acknowledgement' end,
    p_input->>'priority',p_input->>'privacy',array(select jsonb_array_elements_text(p_input->'labels')),(p_input->>'deadlineAt')::timestamptz,
    v_policy,v_reviewer,a,(p_input->>'clonedFromTaskId')::uuid) returning * into v_task;
  insert into public.work_task_recipient_specs(task_id,source_type,source_id,source_name_snapshot)
    select v_task.id,x->>'type',x->>'id',case when x->>'type'='user' then (select name from public.users where id::text=x->>'id')
      else (select name from public.work_groups where id::text=x->>'id') end from jsonb_array_elements(v_preview->'sources') x;
  for v_recipient in select value from jsonb_array_elements(v_preview->'validRecipients') loop
    v_uid:=(v_recipient->>'userId')::uuid;
    insert into public.work_task_recipient_members(task_id,user_id) values(v_task.id,v_uid) returning id into v_member;
    insert into public.work_task_recipient_member_sources(task_id,recipient_member_id,recipient_spec_id)
      select v_task.id,v_member,s.id from jsonb_array_elements(v_recipient->'sources') x join public.work_task_recipient_specs s
      on s.task_id=v_task.id and s.source_type=x->>'type' and s.source_id=x->>'id';
    insert into public.work_task_assignments(task_id,user_id,assigned_by,state,acknowledged_at,acknowledgement_due_at)
    values(v_task.id,v_uid,a,case when v_uid=a then 'not_started' else 'pending_acknowledgement' end,
      case when v_uid=a then now() end,null) returning id into v_assignment_id;
    perform app_private.work_apply_assignment_sla(v_assignment_id,true);
  end loop;
  insert into public.work_task_participants(task_id,user_id,participant_role,added_by)
    select distinct v_task.id,value::uuid,'watcher',a from jsonb_array_elements_text(p_input->'watcherUserIds');
  if v_reviewer is not null then insert into public.work_task_participants(task_id,user_id,participant_role,added_by)
    values(v_task.id,v_reviewer,'reviewer',a); end if;
  for v_item in select value from jsonb_array_elements(p_input->'checklist') loop
    if jsonb_typeof(v_item) is distinct from 'object' or v_item-array['title','assigneeUserId']<>'{}'::jsonb
      or jsonb_typeof(v_item->'title') is distinct from 'string' or length(btrim(v_item->>'title')) not between 1 and 300
      or (v_item->>'assigneeUserId' is not null and not exists(select 1 from public.work_task_assignments
        where task_id=v_task.id and user_id=(v_item->>'assigneeUserId')::uuid)) then raise exception 'WORK_INVALID_CHECKLIST' using errcode='22023'; end if;
    insert into public.work_task_checklist_items(task_id,title,assignee_user_id,sort_order,created_by)
      values(v_task.id,btrim(v_item->>'title'),(v_item->>'assigneeUserId')::uuid,v_i,a);
    v_i:=v_i+1;
  end loop;
  if not app_private.work_task_actor_can_view(v_task.id) then raise exception 'WORK_ACCESS_DENIED' using errcode='42501'; end if;
  insert into public.work_task_versions(task_id,version,snapshot,actor_user_id,idempotency_key)
    values(v_task.id,1,jsonb_build_object('task',to_jsonb(v_task),'recipientPreview',v_preview,'checklist',p_input->'checklist'),a,p_idempotency_key);
  insert into public.work_task_events(task_id,event_type,actor_user_id,idempotency_key,payload)
    values(v_task.id,'task.created',a,p_idempotency_key,jsonb_build_object('taskId',v_task.id,'assignmentCount',(v_preview->>'validCount')::int)) returning id into v_event;
  insert into app_private.work_notification_outbox(event_id,task_id,event_type,payload)
    values(v_event,v_task.id,'task.created',jsonb_build_object('taskId',v_task.id));
  v_result:=jsonb_build_object('taskId',v_task.id,'taskCode',v_task.task_code,'lockVersion',v_task.lock_version,'status',v_task.status);
  update app_private.work_command_idempotency set response_payload=v_result,completed_at=now() where actor_user_id=a and idempotency_key=p_idempotency_key;
  return v_result;
end $$;
