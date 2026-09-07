-- Task 3: guarded command/read API. No grants to business users or calendar seeds.
create function app_private.work_assert_create_scope(p_scope jsonb)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare a uuid := public.current_app_user_id(); s text := p_scope->>'type'; k text;
begin
  if a is null or not app_private.has_permission(a,'work.module.access','global','*') then
    raise exception 'WORK_ACCESS_DENIED' using errcode='42501'; end if;
  if s is null or s not in ('direct','department','project') or jsonb_typeof(p_scope) <> 'object'
    or (s='direct' and (p_scope ? 'departmentId' or p_scope ? 'projectId'))
    or (s='department' and (nullif(p_scope->>'departmentId','') is null or p_scope ? 'projectId'))
    or (s='project' and (nullif(p_scope->>'projectId','') is null or p_scope ? 'departmentId')) then
    raise exception 'WORK_INVALID_SCOPE' using errcode='22023'; end if;
  k := case s when 'department' then p_scope->>'departmentId' when 'project' then p_scope->>'projectId' else '*' end;
  if not app_private.has_permission(a,'work.task.create',case when s='direct' then 'own' else s end,k) then
    raise exception 'WORK_CREATE_DENIED' using errcode='42501'; end if;
  if (s='department' and not exists(select 1 from public.org_units where id::text=k))
    or (s='project' and not exists(select 1 from public.projects where id=k)) then
    raise exception 'WORK_INVALID_SCOPE' using errcode='22023'; end if;
  return a;
end $$;
revoke all on function app_private.work_assert_create_scope(jsonb) from public,anon,authenticated;

create function app_private.work_preview_recipients(p_sources jsonb,p_scope jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a uuid := app_private.work_assert_create_scope(p_scope); s text := p_scope->>'type';
  k text := coalesce(p_scope->>'departmentId',p_scope->>'projectId','*');
  sources jsonb; valid jsonb; invalid jsonb; result jsonb;
begin
  if jsonb_typeof(p_sources) is distinct from 'array' then raise exception 'WORK_INVALID_RECIPIENT_SOURCES' using errcode='22023'; end if;
  if jsonb_array_length(p_sources)>100 or exists(select 1 from jsonb_array_elements(p_sources) x
    where jsonb_typeof(x)<>'object' or coalesce(x->>'type','') not in ('user','work_group')
      or nullif(btrim(x->>'id'),'') is null or length(x->>'id')>200) then
    raise exception 'WORK_INVALID_RECIPIENT_SOURCES' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_sources) x where x->>'type'='user')
    and not app_private.has_permission(a,'work.task.assign_user',case when s='direct' then 'own' else s end,k) then
    raise exception 'WORK_ASSIGN_USER_DENIED' using errcode='42501'; end if;
  if exists(select 1 from jsonb_array_elements(p_sources) x where x->>'type'='work_group')
    and not app_private.has_permission(a,'work.task.assign_group',case when s='direct' then 'own' else s end,k) then
    raise exception 'WORK_ASSIGN_GROUP_DENIED' using errcode='42501'; end if;
  select coalesce(jsonb_agg(x order by x->>'type',x->>'id'),'[]') into sources
    from (select distinct jsonb_build_object('type',x->>'type','id',x->>'id') x from jsonb_array_elements(p_sources) x) q;
  with src as (select x->>'type' type,x->>'id' id from jsonb_array_elements(sources) x),
  expanded as (
    select src.type,src.id,src.id user_id,null::text reason from src where type='user'
    union all
    select src.type,src.id,m.user_id,
      case when g.id is null then 'GROUP_NOT_FOUND' when not g.is_active then 'GROUP_INACTIVE'
        when m.id is null then 'NO_ACTIVE_MEMBERS' end
    from src left join public.work_groups g on g.id::text=src.id
    left join public.work_group_members m on m.group_id=g.id and m.is_active and g.is_active where src.type='work_group'
  ), resolved as (
    select e.*,u.name,
      coalesce(e.reason,case when u.id is null then 'NO_APP_ACCOUNT' when not u.is_active then 'INACTIVE_USER'
        when u.account_status <> 'ACTIVE' then 'ACCOUNT_NOT_ACTIVE'
        when not app_private.has_permission(u.id,'work.module.access','global','*') then 'NO_MODULE_ACCESS' end) exclusion
    from expanded e left join public.users u on e.user_id=u.id::text
  ), grouped as (
    select user_id,max(name) name,exclusion,
      jsonb_agg(jsonb_build_object('type',type,'id',id) order by type,id) sources
    from resolved group by user_id,exclusion
  ) select
    coalesce(jsonb_agg(jsonb_build_object('userId',user_id,'name',name,'sources',grouped.sources) order by user_id) filter(where exclusion is null),'[]'),
    coalesce(jsonb_agg(jsonb_build_object('userId',user_id,'reason',exclusion,'sources',grouped.sources) order by user_id,exclusion) filter(where exclusion is not null),'[]')
    into valid,invalid from grouped;
  if jsonb_array_length(valid)>500 or jsonb_array_length(invalid)>1000 then raise exception 'WORK_RECIPIENT_LIMIT' using errcode='22023'; end if;
  result := jsonb_build_object('sources',sources,'validRecipients',valid,'invalidRecipients',invalid,
    'validCount',jsonb_array_length(valid),'invalidCount',jsonb_array_length(invalid));
  return result || jsonb_build_object('fingerprint',md5(jsonb_build_object('scope',p_scope,'preview',result)::text));
end $$;
revoke all on function app_private.work_preview_recipients(jsonb,jsonb) from public,anon,authenticated;
-- Public wrappers use invoker; only the corresponding guarded private entry is callable.
create function public.preview_work_task_recipients(p_sources jsonb,p_scope jsonb)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select app_private.work_preview_recipients(p_sources,p_scope);
$$;
revoke all on function public.preview_work_task_recipients(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.preview_work_task_recipients(jsonb,jsonb) to authenticated;
grant execute on function app_private.work_preview_recipients(jsonb,jsonb) to authenticated;

-- Small calendar dependency for Task 3; lifecycle/execution SLA follows in Task 4.
create function app_private.work_creation_calendar(p_scope jsonb)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid;
begin
  select c.id into v_id from public.work_sla_policies p join public.work_sla_calendars c on c.id=p.calendar_id
  where p.is_active and c.is_active and p.effective_from<=now() and (p.effective_to is null or p.effective_to>now())
    and (p.scope_type='global' or (p.scope_type=p_scope->>'type'
      and coalesce(p.department_id::text,p.project_id)=coalesce(p_scope->>'departmentId',p_scope->>'projectId')))
  order by (p.scope_type<>'global') desc,p.effective_from desc,p.id desc limit 1;
  if v_id is null then select id into v_id from public.work_sla_calendars where is_default and is_active; end if;
  if v_id is null then raise exception 'WORK_CALENDAR_NOT_CONFIGURED'; end if;
  if not exists(select 1 from public.work_sla_calendars c join pg_catalog.pg_timezone_names z on z.name=c.timezone where c.id=v_id) then
    raise exception 'WORK_CALENDAR_NOT_CONFIGURED'; end if;
  return v_id;
end $$;
revoke all on function app_private.work_creation_calendar(jsonb) from public,anon,authenticated;

create function app_private.work_creation_ack_due(p_calendar uuid,p_start timestamptz,p_priority text)
returns timestamptz language plpgsql stable security definer set search_path = '' as $$
declare c public.work_sla_calendars%rowtype; e public.work_sla_calendar_exceptions%rowtype;
  d date; t timestamptz; day_end timestamptz; remaining numeric; available numeric;
begin
  select * into strict c from public.work_sla_calendars where id=p_calendar and is_active;
  remaining := case p_priority when 'urgent' then 3600 when 'important' then 14400
    else extract(epoch from (c.workday_end-c.workday_start)) end;
  d := (p_start at time zone c.timezone)::date;
  for i in 0..3660 loop
    select * into e from public.work_sla_calendar_exceptions where calendar_id=c.id and exception_date=d;
    if coalesce(e.is_working_day,extract(dow from d)::smallint=any(c.working_weekdays)) then
      t:=greatest(p_start,(d+coalesce(e.workday_start,c.workday_start)) at time zone c.timezone);
      day_end := (d+coalesce(e.workday_end,c.workday_end)) at time zone c.timezone;
      available:=greatest(0,extract(epoch from day_end-t));
      if available>=remaining then return t+remaining*interval '1 second'; end if;
      remaining:=remaining-available;
    end if;
    d:=d+1;
  end loop;
  raise exception 'WORK_CALENDAR_NOT_CONFIGURED';
end $$;
revoke all on function app_private.work_creation_ack_due(uuid,timestamptz,text) from public,anon,authenticated;

-- R1A text schema deliberately admits only paragraphs/text and simple marks.
-- No HTML, images, arbitrary attributes or executable/link nodes are stored.
create function app_private.work_validate_document(p_document jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare paragraph jsonb; node jsonb; mark jsonb; parts text[] := '{}'; line text;
begin
  if jsonb_typeof(p_document) is distinct from 'object' or p_document->>'version' is distinct from '1'
    or p_document->>'type' is distinct from 'doc' or jsonb_typeof(p_document->'content') is distinct from 'array'
    or octet_length(p_document::text)>100000 or p_document- array['version','type','content'] <> '{}'::jsonb then
    raise exception 'WORK_INVALID_DOCUMENT' using errcode='22023'; end if;
  for paragraph in select value from jsonb_array_elements(p_document->'content') loop
    if paragraph->>'type' is distinct from 'paragraph' or jsonb_typeof(paragraph->'content') is distinct from 'array'
      or paragraph-array['type','content'] <> '{}'::jsonb then raise exception 'WORK_INVALID_DOCUMENT' using errcode='22023'; end if;
    line:='';
    for node in select value from jsonb_array_elements(paragraph->'content') loop
      if node->>'type' is distinct from 'text' or jsonb_typeof(node->'text') is distinct from 'string'
        or node-array['type','text','marks'] <> '{}'::jsonb
        or (node ? 'marks' and jsonb_typeof(node->'marks')<>'array') then raise exception 'WORK_INVALID_DOCUMENT' using errcode='22023'; end if;
      for mark in select value from jsonb_array_elements(coalesce(node->'marks','[]')) loop
        if coalesce(mark->>'type','') not in ('bold','italic','strike','code') or mark-'type'<>'{}'::jsonb then
          raise exception 'WORK_INVALID_DOCUMENT' using errcode='22023'; end if;
      end loop;
      line:=line || (node->>'text');
    end loop;
    parts:=array_append(parts,line);
  end loop;
  return array_to_string(parts,E'\n');
end $$;
revoke all on function app_private.work_validate_document(jsonb) from public,anon,authenticated;

create function app_private.work_create_task(p_input jsonb,p_idempotency_key uuid,p_recipient_fingerprint text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  a uuid := public.current_app_user_id(); v_scope jsonb := p_input->'scope';
  v_request_hash text := md5(jsonb_build_object('input',p_input,'fingerprint',p_recipient_fingerprint)::text);
  v_existing app_private.work_command_idempotency%rowtype; v_preview jsonb; v_task public.work_tasks%rowtype;
  v_calendar uuid; v_reviewer uuid; v_policy text; v_text text; v_event uuid;
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
  v_calendar:=app_private.work_creation_calendar(v_scope);
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
      case when v_uid=a then now() end,case when v_uid<>a then app_private.work_creation_ack_due(v_calendar,now(),v_task.priority) end);
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
revoke all on function app_private.work_create_task(jsonb,uuid,text) from public,anon,authenticated;
create function public.create_work_task(p_input jsonb,p_idempotency_key uuid,p_recipient_fingerprint text)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select app_private.work_create_task(p_input,p_idempotency_key,p_recipient_fingerprint);
$$;
revoke all on function public.create_work_task(jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.create_work_task(jsonb,uuid,text) to authenticated;
grant execute on function app_private.work_create_task(jsonb,uuid,text) to authenticated;

create function app_private.work_task_capabilities(p_task_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a uuid := public.current_app_user_id(); t public.work_tasks%rowtype; s text; k text; related boolean;
begin
  if not app_private.work_task_actor_can_view(p_task_id) then raise exception 'WORK_TASK_NOT_FOUND' using errcode='42501'; end if;
  select * into strict t from public.work_tasks where id=p_task_id;
  s:=case when t.scope_type='direct' then 'own' else t.scope_type end;
  k:=coalesce(t.department_id::text,t.project_id,'*');
  related:=exists(select 1 from public.work_task_assignments where task_id=t.id and user_id=a and ended_at is null)
    or exists(select 1 from public.work_task_participants where task_id=t.id and user_id=a and ended_at is null);
  return jsonb_build_object('canClone',app_private.has_permission(a,'work.task.create',s,k),
    'canViewHistory',app_private.has_permission(a,'work.task.audit_view',case when s='own' then 'global' else s end,k)
      or (t.created_by=a and app_private.has_permission(a,'work.task.audit_view','own','*'))
      or (related and app_private.has_permission(a,'work.task.audit_view','assigned','*')));
end $$;
revoke all on function app_private.work_task_capabilities(uuid) from public,anon,authenticated;

create function app_private.work_get_detail(p_task_ref text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare t public.work_tasks%rowtype;
begin
  select * into t from public.work_tasks where task_code=p_task_ref;
  if t.id is null and p_task_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into t from public.work_tasks where id=p_task_ref::uuid; end if;
  if t.id is null or not app_private.work_task_actor_can_view(t.id) then raise exception 'WORK_TASK_NOT_FOUND' using errcode='42501'; end if;
  return jsonb_build_object('task',to_jsonb(t),
    'assignments',coalesce((select jsonb_agg(to_jsonb(a) order by a.assigned_at,a.id) from public.work_task_assignments a where a.task_id=t.id and a.ended_at is null),'[]'),
    'participants',coalesce((select jsonb_agg(to_jsonb(p) order by p.participant_role,p.id) from public.work_task_participants p where p.task_id=t.id and p.ended_at is null),'[]'),
    'checklist',coalesce((select jsonb_agg(to_jsonb(c) order by c.sort_order,c.id) from public.work_task_checklist_items c where c.task_id=t.id),'[]'),
    'currentSubmission',(select to_jsonb(s) from public.work_task_submissions s where s.task_id=t.id order by s.iteration desc limit 1),
    'attachments',coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at,f.id) from public.work_task_attachments f where f.task_id=t.id and f.status='ready' and f.deleted_at is null),'[]'),
    'capabilities',app_private.work_task_capabilities(t.id));
end $$;
revoke all on function app_private.work_get_detail(text) from public,anon,authenticated;
create function public.get_work_task_detail(p_task_ref text)
returns jsonb language sql stable security invoker set search_path = '' as $$ select app_private.work_get_detail(p_task_ref); $$;
revoke all on function public.get_work_task_detail(text) from public,anon,authenticated;
grant execute on function public.get_work_task_detail(text) to authenticated;
grant execute on function app_private.work_get_detail(text) to authenticated;

create function app_private.work_get_clone_draft(p_task_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare t public.work_tasks%rowtype; draft jsonb; v_scope jsonb;
begin
  if not app_private.work_task_actor_can_view(p_task_id) then raise exception 'WORK_TASK_NOT_FOUND' using errcode='42501'; end if;
  select * into strict t from public.work_tasks where id=p_task_id;
  v_scope:=jsonb_strip_nulls(jsonb_build_object('type',t.scope_type,'departmentId',t.department_id,'projectId',t.project_id));
  perform app_private.work_assert_create_scope(v_scope);
  draft:=jsonb_strip_nulls(jsonb_build_object('title',t.title,'description',t.description_document,'scope',v_scope,
    'taskGroupId',t.task_group_id,'labels',t.labels,'priority',t.priority,'privacy',t.privacy,
    'recipientSources',coalesce((select jsonb_agg(jsonb_build_object('type',s.source_type,'id',s.source_id) order by s.sort_order,s.id)
      from public.work_task_recipient_specs s where s.task_id=t.id),'[]'),
    'watcherUserIds',coalesce((select jsonb_agg(p.user_id order by p.user_id) from public.work_task_participants p
      where p.task_id=t.id and p.participant_role='watcher' and p.ended_at is null),'[]'),
    'reviewerUserId',t.reviewer_user_id,'reviewPolicy',t.review_policy,
    'checklist',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('title',c.title,'assigneeUserId',c.assignee_user_id)) order by c.sort_order,c.id)
      from public.work_task_checklist_items c where c.task_id=t.id and c.completed_at is null),'[]'),
    'clonedFromTaskId',t.id,'deadlineAt',case when t.deadline_at>now() then t.deadline_at end));
  return jsonb_build_object('draft',draft,'requiresDeadlineConfirmation',coalesce(t.deadline_at<=now(),false),
    'recipientSnapshot',coalesce((select jsonb_agg(jsonb_build_object('userId',m.user_id) order by m.user_id)
      from public.work_task_recipient_members m where m.task_id=t.id),'[]'));
end $$;
revoke all on function app_private.work_get_clone_draft(uuid) from public,anon,authenticated;
create function public.get_work_task_clone_draft(p_task_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$ select app_private.work_get_clone_draft(p_task_id); $$;
revoke all on function public.get_work_task_clone_draft(uuid) from public,anon,authenticated;
grant execute on function public.get_work_task_clone_draft(uuid) to authenticated;
grant execute on function app_private.work_get_clone_draft(uuid) to authenticated;

create function app_private.work_list_tasks(p_view text,p_filters jsonb,p_cursor jsonb,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a uuid := public.current_app_user_id(); n integer := least(100,greatest(1,coalesce(p_limit,50)));
  rows jsonb; cursor_at timestamptz; cursor_id uuid; scope_filter jsonb := p_filters->'scope';
begin
  if a is null or not app_private.has_permission(a,'work.module.access','global','*') then raise exception 'WORK_ACCESS_DENIED' using errcode='42501'; end if;
  if p_view is null or p_view not in ('assigned_to_me','created_by_me','following','pinned')
    or jsonb_typeof(p_filters) is distinct from 'object'
    or p_filters-array['status','priority','scope','taskGroupId','deadlineFrom','deadlineTo','search']<>'{}'::jsonb
    or (p_filters ? 'status' and jsonb_typeof(p_filters->'status')<>'array')
    or (p_filters ? 'priority' and jsonb_typeof(p_filters->'priority')<>'array') then raise exception 'WORK_INVALID_FILTER' using errcode='22023'; end if;
  if p_cursor is not null then
    if jsonb_typeof(p_cursor) is distinct from 'object' or p_cursor->>'sortAt' is null or p_cursor->>'id' is null then
      raise exception 'WORK_INVALID_CURSOR' using errcode='22023'; end if;
    cursor_at:=(p_cursor->>'sortAt')::timestamptz; cursor_id:=(p_cursor->>'id')::uuid;
  end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.updated_at desc,q.id desc),'[]') into rows from (
    select t.id,t.task_code,t.title,t.status,t.priority,t.privacy,t.scope_type,t.department_id,t.project_id,
      t.task_group_id,t.deadline_at,t.created_by,t.reviewer_user_id,t.updated_at,t.lock_version
    from public.work_tasks t
    where (case p_view
      when 'created_by_me' then t.created_by=a
      when 'assigned_to_me' then exists(select 1 from public.work_task_assignments x where x.task_id=t.id and x.user_id=a and x.ended_at is null)
      when 'following' then exists(select 1 from public.work_task_participants x where x.task_id=t.id and x.user_id=a and x.participant_role='watcher' and x.ended_at is null)
      when 'pinned' then exists(select 1 from public.work_task_pins x where x.task_id=t.id and x.user_id=a) end)
    and (cursor_at is null or (t.updated_at,t.id)<(cursor_at,cursor_id))
    and (not p_filters ? 'status' or t.status in (select jsonb_array_elements_text(p_filters->'status')))
    and (not p_filters ? 'priority' or t.priority in (select jsonb_array_elements_text(p_filters->'priority')))
    and (scope_filter is null or (t.scope_type=scope_filter->>'type'
      and t.department_id is not distinct from (scope_filter->>'departmentId')::uuid
      and t.project_id is not distinct from scope_filter->>'projectId'))
    and (not p_filters ? 'taskGroupId' or t.task_group_id=(p_filters->>'taskGroupId')::uuid)
    and (not p_filters ? 'deadlineFrom' or t.deadline_at>=(p_filters->>'deadlineFrom')::timestamptz)
    and (not p_filters ? 'deadlineTo' or t.deadline_at<=(p_filters->>'deadlineTo')::timestamptz)
    and (nullif(btrim(p_filters->>'search'),'') is null or t.task_code=p_filters->>'search'
      or to_tsvector('simple',coalesce(t.title,'') || ' ' || coalesce(t.description_text,'')) @@ plainto_tsquery('simple',p_filters->>'search'))
    and app_private.work_task_actor_can_view(t.id)
    order by t.updated_at desc,t.id desc limit n+1
  ) q;
  return jsonb_build_object('items',(select coalesce(jsonb_agg(value order by ordinality),'[]') from jsonb_array_elements(rows) with ordinality where ordinality<=n),
    'nextCursor',case when jsonb_array_length(rows)>n then jsonb_build_object('sortAt',rows->(n-1)->'updated_at','id',rows->(n-1)->'id') else null end);
end $$;
revoke all on function app_private.work_list_tasks(text,jsonb,jsonb,integer) from public,anon,authenticated;
create function public.list_work_tasks(p_view text,p_filters jsonb default '{}',p_cursor jsonb default null,p_limit integer default 50)
returns jsonb language sql stable security invoker set search_path = '' as $$ select app_private.work_list_tasks(p_view,p_filters,p_cursor,p_limit); $$;
revoke all on function public.list_work_tasks(text,jsonb,jsonb,integer) from public,anon,authenticated;
grant execute on function public.list_work_tasks(text,jsonb,jsonb,integer) to authenticated;
grant execute on function app_private.work_list_tasks(text,jsonb,jsonb,integer) to authenticated;

create function app_private.work_list_groups(p_scope jsonb,p_cursor jsonb,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a uuid:=public.current_app_user_id(); rows jsonb; n integer:=least(100,greatest(1,coalesce(p_limit,50)));
  cursor_at timestamptz; cursor_id uuid;
begin
  if a is null or not app_private.has_permission(a,'work.module.access','global','*') then raise exception 'WORK_ACCESS_DENIED' using errcode='42501'; end if;
  if p_scope->>'type' is null or p_scope->>'type' not in ('direct','department','project') then raise exception 'WORK_INVALID_SCOPE' using errcode='22023'; end if;
  if p_cursor is not null then
    if jsonb_typeof(p_cursor) is distinct from 'object' or p_cursor->>'sortAt' is null or p_cursor->>'id' is null then raise exception 'WORK_INVALID_CURSOR' using errcode='22023'; end if;
    cursor_at:=(p_cursor->>'sortAt')::timestamptz; cursor_id:=(p_cursor->>'id')::uuid;
  end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id desc),'[]') into rows from (
    select g.id,g.name,g.description,g.scope_type,g.department_id,g.project_id,g.sort_order,g.created_at
    from public.work_task_groups g where g.is_active and g.scope_type=p_scope->>'type'
      and g.department_id is not distinct from (p_scope->>'departmentId')::uuid
      and g.project_id is not distinct from p_scope->>'projectId'
      and (cursor_at is null or (g.created_at,g.id)<(cursor_at,cursor_id))
      and app_private.work_task_group_actor_can_view(g.id)
    order by g.created_at desc,g.id desc limit n+1
  ) q;
  return jsonb_build_object('items',(select coalesce(jsonb_agg(value order by ordinality),'[]') from jsonb_array_elements(rows) with ordinality where ordinality<=n),
    'nextCursor',case when jsonb_array_length(rows)>n then jsonb_build_object('sortAt',rows->(n-1)->'created_at','id',rows->(n-1)->'id') else null end);
end $$;
revoke all on function app_private.work_list_groups(jsonb,jsonb,integer) from public,anon,authenticated;
create function public.list_work_task_groups(p_scope jsonb,p_cursor jsonb default null,p_limit integer default 50)
returns jsonb language sql stable security invoker set search_path = '' as $$ select app_private.work_list_groups(p_scope,p_cursor,p_limit); $$;
revoke all on function public.list_work_task_groups(jsonb,jsonb,integer) from public,anon,authenticated;
grant execute on function public.list_work_task_groups(jsonb,jsonb,integer) to authenticated;
grant execute on function app_private.work_list_groups(jsonb,jsonb,integer) to authenticated;
