create table app_private.workflow_notification_command_keys (
  actor_user_id uuid not null references public.users(id) on delete restrict,
  idempotency_key uuid not null,
  command_name text not null,
  payload_hash text not null,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key(actor_user_id,idempotency_key)
);
alter table app_private.workflow_notification_command_keys enable row level security;
revoke all on app_private.workflow_notification_command_keys from public,anon,authenticated;

create function app_private.enqueue_workflow_notification_event(
  p_instance_id uuid,p_event_type text,p_actor_id uuid,p_event_key text,
  p_payload jsonb default '{}',p_recipient_user_ids uuid[] default null
) returns integer language plpgsql security definer set search_path='' as $$
declare i public.workflow_instances%rowtype; v_recipients uuid[]; v_node jsonb;
begin
  if exists(select 1 from public.request_instances r where r.workflow_instance_id=p_instance_id)
    or exists(select 1 from public.workflow_subjects s where s.workflow_instance_id=p_instance_id
      and s.subject_type='request') then return 0; end if;
  select * into strict i from public.workflow_instances where id=p_instance_id;
  if p_event_type='workflow.mentioned' then
    v_recipients:=coalesce(p_recipient_user_ids,'{}');
  else
    v_node:=i.step_assignees->i.current_node_id::text;
    select coalesce(array_agg(distinct q.user_id),'{}') into v_recipients from(
      select i.created_by user_id
      union select x::uuid from unnest(coalesce(i.watchers,'{}'::text[])) x where x~*'^[0-9a-f-]{36}$'
      union select case when jsonb_typeof(v_node)='string' then (v_node#>>'{}')::uuid end
      union select x::uuid from jsonb_array_elements_text(case when jsonb_typeof(v_node)='array' then v_node else '[]'::jsonb end)x
      union select x from unnest(coalesce(p_recipient_user_ids,'{}')) x
    )q where q.user_id is not null;
  end if;
  insert into app_private.workflow_notification_outbox(event_key,instance_id,event_type,actor_user_id,recipient_user_ids,payload)
    values(p_event_key,p_instance_id,p_event_type,p_actor_id,coalesce(v_recipients,'{}'),coalesce(p_payload,'{}'))
    on conflict(event_key) do nothing;
  return case when found then 1 else 0 end;
end $$;
revoke all on function app_private.enqueue_workflow_notification_event(uuid,text,uuid,text,jsonb,uuid[]) from public,anon,authenticated,service_role;

create or replace function app_private.notify_workflow_instance_comment_mentions()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_mentions uuid[];
begin
  select coalesce(array_agg((x->>'userId')::uuid),'{}') into v_mentions from jsonb_array_elements(new.mentions)x;
  perform app_private.enqueue_workflow_notification_event(new.instance_id,'workflow.commented',new.author_user_id,
    'workflow.comment:'||new.id,jsonb_build_object('commentId',new.id));
  if cardinality(v_mentions)>0 then
    perform app_private.enqueue_workflow_notification_event(new.instance_id,'workflow.mentioned',new.author_user_id,
      'workflow.mention:'||new.id,jsonb_build_object('commentId',new.id),v_mentions);
  end if;
  return new;
end $$;
revoke all on function app_private.notify_workflow_instance_comment_mentions() from public,anon,authenticated,service_role;

-- The lifecycle RPC writes its log before updating the instance. Deferring this
-- trigger until commit lets the resolver snapshot the final node and assignees.
create function app_private.enqueue_workflow_log_notification()
returns trigger language plpgsql security definer set search_path='' as $$
declare i public.workflow_instances%rowtype; v_event text; v_extra uuid[]:='{}'; v_current jsonb;
begin
  select * into strict i from public.workflow_instances where id=new.instance_id;
  v_current:=i.step_assignees->new.node_id::text;
  select coalesce(array_agg(distinct x),'{}') into v_extra from(
    select case when jsonb_typeof(v_current)='string' then (v_current#>>'{}')::uuid end x
    union select value::uuid from jsonb_array_elements_text(case when jsonb_typeof(v_current)='array' then v_current else '[]'::jsonb end)
  )q where x is not null;
  v_event:=case new.action
    when 'SUBMITTED' then 'workflow.submitted'
    when 'APPROVED' then 'workflow.step_approved'
    when 'REJECTED' then case when i.status='CANCELLED' then 'workflow.cancelled' else 'workflow.rejected' end
    when 'REVISION_REQUESTED' then 'workflow.revision_requested'
    when 'REOPENED' then 'workflow.reopened'
    else null end;
  if v_event is not null then
    perform app_private.enqueue_workflow_notification_event(i.id,v_event,new.acted_by,'workflow.log:'||new.id,
      jsonb_build_object('nodeId',coalesce(i.current_node_id,new.node_id),'outgoingNodeId',new.node_id),v_extra);
  end if;
  if new.action in ('APPROVED','REVISION_REQUESTED') and i.status='RUNNING' and i.current_node_id is distinct from new.node_id then
    perform app_private.enqueue_workflow_notification_event(i.id,'workflow.step_assigned',new.acted_by,'workflow.assigned:'||new.id,
      jsonb_build_object('nodeId',i.current_node_id,'outgoingNodeId',new.node_id),v_extra);
  elsif new.action='APPROVED' and i.status='COMPLETED' then
    perform app_private.enqueue_workflow_notification_event(i.id,'workflow.completed',new.acted_by,'workflow.completed:'||new.id,
      jsonb_build_object('nodeId',new.node_id),v_extra);
  end if;
  return new;
end $$;
revoke all on function app_private.enqueue_workflow_log_notification() from public,anon,authenticated,service_role;
create constraint trigger trg_enqueue_workflow_log_notification after insert on public.workflow_instance_logs
  deferrable initially deferred for each row execute function app_private.enqueue_workflow_log_notification();

create function app_private.workflow_notification_actor()
returns uuid language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=public.current_app_user_id();
begin
  if v_actor is null or not exists(select 1 from public.users u where u.id=v_actor and u.is_active and u.account_status='ACTIVE') then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode='42501';
  end if;
  return v_actor;
end $$;
revoke all on function app_private.workflow_notification_actor() from public,anon,authenticated,service_role;

create function app_private.workflow_command_begin(p_actor uuid,p_key uuid,p_command text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare k app_private.workflow_notification_command_keys%rowtype; v_hash text:=md5(coalesce(p_payload,'{}')::text);
begin
  if p_key is null then raise exception 'WORKFLOW_IDEMPOTENCY_REQUIRED' using errcode='22023'; end if;
  insert into app_private.workflow_notification_command_keys(actor_user_id,idempotency_key,command_name,payload_hash)
    values(p_actor,p_key,p_command,v_hash) on conflict do nothing;
  select * into strict k from app_private.workflow_notification_command_keys where actor_user_id=p_actor and idempotency_key=p_key for update;
  if k.command_name<>p_command or k.payload_hash<>v_hash then raise exception 'WORKFLOW_IDEMPOTENCY_CONFLICT' using errcode='23505'; end if;
  return k.result;
end $$;
revoke all on function app_private.workflow_command_begin(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;

create function app_private.workflow_command_finish(p_actor uuid,p_key uuid,p_result jsonb)
returns jsonb language sql security definer set search_path='' as $$
  update app_private.workflow_notification_command_keys set result=p_result
  where actor_user_id=p_actor and idempotency_key=p_key returning result;
$$;
revoke all on function app_private.workflow_command_finish(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function public.create_workflow_instance_v2(p_input jsonb,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=app_private.workflow_notification_actor(); v_cached jsonb; v_template public.workflow_templates%rowtype;
  v_instance public.workflow_instances%rowtype; v_log public.workflow_instance_logs%rowtype; v_node uuid; v_assignees uuid[]; v_watchers text[];
begin
  v_cached:=app_private.workflow_command_begin(v_actor,p_idempotency_key,'create_workflow_instance_v2',p_input);
  if v_cached is not null then return v_cached; end if;
  select * into v_template from public.workflow_templates where id=(p_input->>'templateId')::uuid and is_active for share;
  if v_template.id is null then raise exception 'WORKFLOW_TEMPLATE_NOT_FOUND' using errcode='P0002'; end if;
  v_node:=(p_input->>'firstNodeId')::uuid;
  if not exists(select 1 from public.workflow_nodes n where n.id=v_node and n.template_id=v_template.id) then
    raise exception 'WORKFLOW_NODE_NOT_FOUND' using errcode='P0002'; end if;
  select coalesce(array_agg(distinct value::uuid),'{}') into v_assignees
    from jsonb_array_elements_text(coalesce(p_input->'firstAssigneeUserIds','[]'));
  if cardinality(v_assignees)=0 or exists(select 1 from unnest(v_assignees)x
    where not exists(select 1 from public.users u where u.id=x and u.is_active and u.account_status='ACTIVE')) then
    raise exception 'WORKFLOW_ASSIGNEE_REQUIRED' using errcode='22023'; end if;
  select coalesce(array_agg(distinct x),'{}') into v_watchers from unnest(coalesce(v_template.default_watchers,'{}'))x
    join public.users u on u.id::text=x and u.is_active and u.account_status='ACTIVE';
  insert into public.workflow_instances(template_id,code,title,created_by,current_node_id,status,form_data,watchers,step_assignees)
  values(v_template.id,public.next_workflow_code(),btrim(p_input->>'title'),v_actor,v_node,'RUNNING',coalesce(p_input->'formData','{}'),
    v_watchers,jsonb_build_object(v_node::text,to_jsonb(v_assignees))) returning * into v_instance;
  insert into public.workflow_instance_logs(instance_id,node_id,action,acted_by,comment)
    values(v_instance.id,v_node,'SUBMITTED',v_actor,'') returning * into v_log;
  return app_private.workflow_command_finish(v_actor,p_idempotency_key,
    jsonb_build_object('instance',to_jsonb(v_instance),'log',to_jsonb(v_log)));
end $$;
revoke all on function public.create_workflow_instance_v2(jsonb,uuid) from public,anon;
grant execute on function public.create_workflow_instance_v2(jsonb,uuid) to authenticated;

create function public.update_workflow_instance_watchers(p_instance_id uuid,p_watcher_user_ids uuid[],p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=app_private.workflow_notification_actor(); v_cached jsonb; i public.workflow_instances%rowtype;
  v_new uuid[]; v_added uuid[]; v_removed uuid[]; v_result jsonb;
begin
  v_cached:=app_private.workflow_command_begin(v_actor,p_idempotency_key,'update_workflow_instance_watchers',
    jsonb_build_object('instanceId',p_instance_id,'watcherUserIds',p_watcher_user_ids));
  if v_cached is not null then return v_cached; end if;
  select * into i from public.workflow_instances where id=p_instance_id for update;
  if i.id is null or not(i.created_by=v_actor or public.is_module_admin('WF') or exists(
    select 1 from public.workflow_templates t where t.id=i.template_id and v_actor::text=any(coalesce(t.managers,'{}')))) then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode='42501'; end if;
  select coalesce(array_agg(distinct x),'{}') into v_new from unnest(coalesce(p_watcher_user_ids,'{}'))x
    join public.users u on u.id=x and u.is_active and u.account_status='ACTIVE';
  select coalesce(array_agg(x),'{}') into v_added from unnest(v_new)x where not(x::text=any(coalesce(i.watchers,'{}')));
  select coalesce(array_agg(x::uuid),'{}') into v_removed from unnest(coalesce(i.watchers,'{}'))x
    where x~*'^[0-9a-f-]{36}$' and not(x::uuid=any(v_new));
  update public.workflow_instances set watchers=array(select x::text from unnest(v_new)x),updated_at=now() where id=i.id returning * into i;
  if cardinality(v_added)>0 then perform app_private.enqueue_workflow_notification_event(i.id,'workflow.watchers_added',v_actor,
    'workflow.watchers_added:'||p_idempotency_key,jsonb_build_object('nodeId',i.current_node_id),v_added); end if;
  if cardinality(v_removed)>0 then perform app_private.enqueue_workflow_notification_event(i.id,'workflow.watchers_removed',v_actor,
    'workflow.watchers_removed:'||p_idempotency_key,jsonb_build_object('nodeId',i.current_node_id),v_removed); end if;
  v_result:=jsonb_build_object('instance',to_jsonb(i),'addedWatcherUserIds',to_jsonb(v_added),'removedWatcherUserIds',to_jsonb(v_removed));
  return app_private.workflow_command_finish(v_actor,p_idempotency_key,v_result);
end $$;
revoke all on function public.update_workflow_instance_watchers(uuid,uuid[],uuid) from public,anon;
grant execute on function public.update_workflow_instance_watchers(uuid,uuid[],uuid) to authenticated;

create function public.cancel_workflow_instance(p_instance_id uuid,p_comment text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=app_private.workflow_notification_actor(); v_cached jsonb; i public.workflow_instances%rowtype; l public.workflow_instance_logs%rowtype;
begin
  v_cached:=app_private.workflow_command_begin(v_actor,p_idempotency_key,'cancel_workflow_instance',jsonb_build_object('instanceId',p_instance_id,'comment',p_comment));
  if v_cached is not null then return v_cached; end if;
  select * into i from public.workflow_instances where id=p_instance_id for update;
  if i.id is null or i.status<>'RUNNING' or not(i.created_by=v_actor or public.is_module_admin('WF')) then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode='42501'; end if;
  update public.workflow_instances set status='CANCELLED',updated_at=now() where id=i.id returning * into i;
  insert into public.workflow_instance_logs(instance_id,node_id,action,acted_by,comment)
    values(i.id,i.current_node_id,'REJECTED',v_actor,coalesce(p_comment,'')) returning * into l;
  return app_private.workflow_command_finish(v_actor,p_idempotency_key,jsonb_build_object('instance',to_jsonb(i),'log',to_jsonb(l)));
end $$;
revoke all on function public.cancel_workflow_instance(uuid,text,uuid) from public,anon;
grant execute on function public.cancel_workflow_instance(uuid,text,uuid) to authenticated;

create function public.reopen_workflow_instance(p_instance_id uuid,p_target_node_id uuid,p_comment text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=app_private.workflow_notification_actor(); v_cached jsonb; i public.workflow_instances%rowtype; l public.workflow_instance_logs%rowtype;
begin
  v_cached:=app_private.workflow_command_begin(v_actor,p_idempotency_key,'reopen_workflow_instance',
    jsonb_build_object('instanceId',p_instance_id,'targetNodeId',p_target_node_id,'comment',p_comment));
  if v_cached is not null then return v_cached; end if;
  select * into i from public.workflow_instances where id=p_instance_id for update;
  if i.id is null or i.status not in('COMPLETED','REJECTED') or not(i.created_by=v_actor or public.is_module_admin('WF'))
    or not exists(select 1 from public.workflow_nodes n where n.id=p_target_node_id and n.template_id=i.template_id) then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode='42501'; end if;
  update public.workflow_instances set status='RUNNING',current_node_id=p_target_node_id,updated_at=now() where id=i.id returning * into i;
  insert into public.workflow_instance_logs(instance_id,node_id,action,acted_by,comment)
    values(i.id,p_target_node_id,'REOPENED',v_actor,coalesce(p_comment,'')) returning * into l;
  return app_private.workflow_command_finish(v_actor,p_idempotency_key,jsonb_build_object('instance',to_jsonb(i),'log',to_jsonb(l)));
end $$;
revoke all on function public.reopen_workflow_instance(uuid,uuid,text,uuid) from public,anon;
grant execute on function public.reopen_workflow_instance(uuid,uuid,text,uuid) to authenticated;

create or replace function app_private.workflow_notification_content(p_outbox_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o app_private.workflow_notification_outbox%rowtype; i public.workflow_instances%rowtype;
  v_actor text; v_action text; v_phrase text; v_title text; v_message text;
begin
  select * into strict o from app_private.workflow_notification_outbox where id=p_outbox_id;
  select * into strict i from public.workflow_instances where id=o.instance_id;
  select regexp_replace(btrim(u.name),'[[:space:]]+',' ','g') into v_actor from public.users u where u.id=o.actor_user_id;
  v_actor:=coalesce(nullif(v_actor,''),'Hệ thống'); v_title:=left(regexp_replace(btrim(i.title),'[[:space:]]+',' ','g'),140);
  v_action:=case o.event_type
    when 'workflow.submitted' then 'Quy trình mới'
    when 'workflow.step_approved' then 'Đã duyệt bước'
    when 'workflow.step_assigned' then 'Bước chờ xử lý'
    when 'workflow.rejected' then 'Đã từ chối'
    when 'workflow.revision_requested' then 'Cần chỉnh sửa'
    when 'workflow.completed' then 'Đã hoàn tất'
    when 'workflow.watchers_added' then 'Được thêm theo dõi'
    when 'workflow.watchers_removed' then 'Đã dừng theo dõi'
    when 'workflow.cancelled' then 'Đã hủy'
    when 'workflow.reopened' then 'Đã mở lại'
    when 'workflow.commented' then 'Bình luận mới'
    when 'workflow.mentioned' then 'Đã nhắc đến bạn'
    when 'workflow.step_due_soon' then 'Sắp đến hạn'
    when 'workflow.step_overdue' then 'Quá hạn'
    else 'Có cập nhật' end;
  v_phrase:=case o.event_type
    when 'workflow.submitted' then 'đã tạo'
    when 'workflow.step_approved' then 'đã duyệt một bước của'
    when 'workflow.step_assigned' then 'đã chuyển bước của'
    when 'workflow.rejected' then 'đã từ chối'
    when 'workflow.revision_requested' then 'đã yêu cầu chỉnh sửa'
    when 'workflow.completed' then 'đã hoàn tất'
    when 'workflow.watchers_added' then 'đã thêm người theo dõi vào'
    when 'workflow.watchers_removed' then 'đã gỡ người theo dõi khỏi'
    when 'workflow.cancelled' then 'đã hủy'
    when 'workflow.reopened' then 'đã mở lại'
    when 'workflow.commented' then 'đã bình luận trong'
    when 'workflow.mentioned' then 'đã nhắc đến bạn trong'
    else 'đã cập nhật' end;
  v_message:=case when o.event_type in('workflow.step_due_soon','workflow.step_overdue') then
    v_action||': “'||v_title||'” · '||to_char((o.payload->>'dueAt')::timestamptz at time zone 'Asia/Ho_Chi_Minh','HH24:MI DD/MM/YYYY')
    else v_actor||' '||v_phrase||' “'||v_title||'”.' end;
  return jsonb_build_object('title',left(i.code||' · '||v_action,100),'message',left(v_message,220),
    'metadata',jsonb_strip_nulls(jsonb_build_object('workflowEventKey',o.event_key,'eventType',o.event_type,
      'instanceId',i.id,'instanceCode',i.code,'instanceTitle',v_title,'actorUserId',o.actor_user_id,
      'actorName',case when o.actor_user_id is not null then v_actor end,'nodeId',o.payload->>'nodeId','commentId',o.payload->>'commentId')));
end $$;
revoke all on function app_private.workflow_notification_content(uuid) from public,anon,authenticated,service_role;

create or replace function app_private.deliver_workflow_notification(p_outbox_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o app_private.workflow_notification_outbox%rowtype; i public.workflow_instances%rowtype;
  v_user uuid; v_content jsonb; v_link text; v_delivery uuid; v_notification uuid; v_count integer:=0;
begin
  perform app_private.workflow_require_notification_worker();
  select * into o from app_private.workflow_notification_outbox where id=p_outbox_id for update;
  if o.id is null then raise exception 'WORKFLOW_NOTIFICATION_NOT_FOUND' using errcode='P0002'; end if;
  if o.status<>'PROCESSING' then return jsonb_build_object('status',o.status,'delivered',0); end if;
  if exists(select 1 from public.request_instances r where r.workflow_instance_id=o.instance_id)
    or exists(select 1 from public.workflow_subjects s where s.workflow_instance_id=o.instance_id
      and s.subject_type='request') then
    update app_private.workflow_notification_outbox set status='SUPPRESSED',last_error='request_owned',locked_at=null,updated_at=now() where id=o.id;
    return jsonb_build_object('status','SUPPRESSED','delivered',0);
  end if;
  select * into strict i from public.workflow_instances where id=o.instance_id;
  v_content:=app_private.workflow_notification_content(o.id);
  v_link:='/wf?instanceId='||i.id::text
    ||case when nullif(o.payload->>'nodeId','') is not null then '&nodeId='||(o.payload->>'nodeId') else '' end
    ||case when nullif(o.payload->>'commentId','') is not null then '&commentId='||(o.payload->>'commentId') else '' end;
  for v_user in
    select distinct candidate.user_id from unnest(o.recipient_user_ids) candidate(user_id)
    join public.users u on u.id=candidate.user_id and u.is_active and u.account_status='ACTIVE'
    where candidate.user_id is distinct from o.actor_user_id and (
      candidate.user_id=i.created_by or candidate.user_id::text=any(coalesce(i.watchers,'{}'::text[]))
      or coalesce(i.step_assignees->>i.current_node_id::text,'')=candidate.user_id::text
      or (jsonb_typeof(i.step_assignees->i.current_node_id::text)='array' and exists(
        select 1 from jsonb_array_elements_text(i.step_assignees->i.current_node_id::text)x(value) where x.value=candidate.user_id::text))
      or o.event_type in('workflow.step_approved','workflow.rejected','workflow.revision_requested','workflow.completed',
        'workflow.watchers_removed','workflow.cancelled','workflow.reopened','workflow.mentioned')
    )
  loop
    insert into app_private.workflow_notification_deliveries(outbox_id,user_id) values(o.id,v_user)
      on conflict(outbox_id,user_id) do nothing returning id into v_delivery;
    if v_delivery is null then continue; end if;
    insert into public.notifications(user_id,title,message,body,type,priority,module,category,severity,source_type,source_id,
      entity_type,entity_id,link,action_url,push_enabled,metadata)
    values(v_user::text,v_content->>'title',v_content->>'message',v_content->>'message','info','normal','WF','workflow','info',
      'workflow_instance',i.id::text,'workflow_instance',i.id,v_link,'/#'||v_link,true,v_content->'metadata') returning id into v_notification;
    update app_private.workflow_notification_deliveries set notification_id=v_notification where id=v_delivery; v_count:=v_count+1;
  end loop;
  update app_private.workflow_notification_outbox set status='DELIVERED',delivered_at=now(),locked_at=null,last_error=null,updated_at=now() where id=o.id;
  return jsonb_build_object('status','DELIVERED','delivered',v_count);
end $$;
revoke all on function app_private.deliver_workflow_notification(uuid) from public,anon,authenticated;
grant execute on function app_private.deliver_workflow_notification(uuid) to service_role;
