create function app_private.request_notification_canonicalize()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=public.current_app_user_id(); v_status text; v_action text:=upper(coalesce(new.payload->>'action',''));
begin
  if new.event_type='REQUEST_APPROVAL_REQUIRED' and coalesce((new.payload->>'reassigned')::boolean,false) then
    new.event_key:='request:'||new.request_id||':REASSIGN_ASSIGNMENT:'||coalesce((select a.id::text
      from public.workflow_step_assignments a join public.request_instances r on r.workflow_subject_id=a.workflow_subject_id
      where r.id=new.request_id and a.assignee_user_id=new.recipient_user_id and a.status='PENDING'
      order by a.assigned_at desc,a.id desc limit 1),new.recipient_user_id::text);
  end if;
  if new.event_type='REQUEST_'||'ACTION_APPLIED' then
    select status into v_status from public.request_instances where id=new.request_id;
    new.event_type:=case v_action
      when 'APPROVE' then case when v_status='APPROVED' then 'REQUEST_APPROVED' else 'REQUEST_STEP_APPROVED' end
      when 'REASSIGN' then 'REQUEST_REASSIGNED'
      when 'RETURN' then 'REQUEST_RETURNED'
      when 'RESUBMIT' then 'REQUEST_RESUBMITTED'
      when 'REJECT' then 'REQUEST_REJECTED'
      when 'CANCEL' then 'REQUEST_CANCELLED'
      else 'REQUEST_STEP_APPROVED' end;
  end if;
  new.payload:=jsonb_strip_nulls((coalesce(new.payload,'{}')-'comment')||jsonb_build_object('actorUserId',v_actor));
  if new.recipient_user_id=v_actor or not exists(select 1 from public.users u where u.id=new.recipient_user_id
    and u.is_active and u.account_status='ACTIVE') then return null; end if;
  return new;
end $$;
revoke all on function app_private.request_notification_canonicalize() from public,anon,authenticated,service_role;
create trigger request_notification_canonicalize before insert on app_private.request_notification_outbox
  for each row execute function app_private.request_notification_canonicalize();

create function app_private.enqueue_request_notification_event(
  p_request_id uuid,p_event_type text,p_actor_id uuid,p_event_key text,p_payload jsonb default '{}'
) returns integer language plpgsql security definer set search_path='' as $$
declare r public.request_instances%rowtype; v_user uuid; v_count integer:=0;
begin
  select * into strict r from public.request_instances where id=p_request_id;
  for v_user in
    select distinct q.user_id from(
      select r.created_by user_id
      union select p.user_id from public.workflow_participants p
        where p.workflow_subject_id=r.workflow_subject_id and p.role='WATCHER' and p.is_active
      union select a.assignee_user_id from public.workflow_step_assignments a
        where a.workflow_subject_id=r.workflow_subject_id and a.status='PENDING'
          and p_event_type in('REQUEST_SUBMITTED','REQUEST_APPROVAL_REQUIRED','REQUEST_STEP_APPROVED','REQUEST_REASSIGNED','REQUEST_RESUBMITTED')
    )q where q.user_id is not null and q.user_id is distinct from p_actor_id
      and q.user_id is distinct from nullif(p_payload->>'baseRecipientUserId','')::uuid
  loop
    insert into app_private.request_notification_outbox(event_key,request_id,recipient_user_id,event_type,payload)
    values(p_event_key||':participant:'||v_user,p_request_id,v_user,p_event_type,
      jsonb_strip_nulls((coalesce(p_payload,'{}')-'comment')||jsonb_build_object('actorUserId',p_actor_id,'participantFanout',true)))
    on conflict(event_key) do nothing;
    if found then v_count:=v_count+1; end if;
  end loop;
  return v_count;
end $$;
revoke all on function app_private.enqueue_request_notification_event(uuid,text,uuid,text,jsonb) from public,anon,authenticated,service_role;

create function app_private.request_notification_fanout()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if coalesce(new.payload->>'participantFanout','false')='true' then return new; end if;
  perform app_private.enqueue_request_notification_event(new.request_id,new.event_type,
    nullif(new.payload->>'actorUserId','')::uuid,new.event_key,
    new.payload||jsonb_build_object('baseRecipientUserId',new.recipient_user_id));
  return new;
end $$;
revoke all on function app_private.request_notification_fanout() from public,anon,authenticated,service_role;
create trigger request_notification_participant_fanout after insert on app_private.request_notification_outbox
  for each row execute function app_private.request_notification_fanout();

create or replace function app_private.deliver_request_notification(p_outbox_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o app_private.request_notification_outbox%rowtype; r public.request_instances%rowtype;
  v_actor uuid; v_actor_name text; v_action text; v_phrase text; v_title text; v_message text;
  v_block text; v_link text; v_notification uuid;
begin
  perform app_private.require_request_notification_worker();
  select * into o from app_private.request_notification_outbox where id=p_outbox_id for update;
  if o.id is null or o.status='DELIVERED' then return jsonb_build_object('delivered',false); end if;
  if o.status<>'PROCESSING' then raise exception 'REQUEST_NOTIFICATION_NOT_CLAIMED' using errcode='P0001'; end if;
  select * into strict r from public.request_instances where id=o.request_id;
  v_actor:=nullif(o.payload->>'actorUserId','')::uuid;
  if o.recipient_user_id=v_actor or not exists(select 1 from public.users u where u.id=o.recipient_user_id and u.is_active and u.account_status='ACTIVE')
    or not(r.created_by=o.recipient_user_id or exists(select 1 from public.workflow_participants p
      where p.workflow_subject_id=r.workflow_subject_id and p.user_id=o.recipient_user_id and p.is_active)
      or exists(select 1 from public.workflow_step_assignments a where a.workflow_subject_id=r.workflow_subject_id
        and a.assignee_user_id=o.recipient_user_id and a.status='PENDING')) then
    update app_private.request_notification_outbox set status='DELIVERED',delivered_at=now(),locked_at=null,last_error='ineligible' where id=o.id;
    return jsonb_build_object('delivered',false,'reason','ineligible');
  end if;
  select regexp_replace(btrim(u.name),'[[:space:]]+',' ','g') into v_actor_name from public.users u where u.id=v_actor;
  v_actor_name:=coalesce(nullif(v_actor_name,''),'Hệ thống'); v_title:=left(regexp_replace(btrim(r.title),'[[:space:]]+',' ','g'),140);
  v_action:=case o.event_type
    when 'REQUEST_SUBMITTED' then 'Đề xuất mới'
    when 'REQUEST_APPROVAL_REQUIRED' then 'Chờ bạn duyệt'
    when 'REQUEST_STEP_APPROVED' then 'Đã duyệt bước'
    when 'REQUEST_REASSIGNED' then 'Đã chuyển người duyệt'
    when 'REQUEST_RETURNED' then 'Đã trả lại'
    when 'REQUEST_RESUBMITTED' then 'Đã gửi lại'
    when 'REQUEST_APPROVED' then 'Đã chấp thuận'
    when 'REQUEST_REJECTED' then 'Đã từ chối'
    when 'REQUEST_CANCELLED' then 'Đã hủy'
    when 'REQUEST_DUE_SOON' then 'Sắp đến hạn'
    when 'REQUEST_OVERDUE' then 'Quá hạn'
    else 'Có cập nhật' end;
  v_phrase:=case o.event_type
    when 'REQUEST_SUBMITTED' then 'đã gửi'
    when 'REQUEST_APPROVAL_REQUIRED' then 'đã chuyển duyệt'
    when 'REQUEST_STEP_APPROVED' then 'đã duyệt một bước của'
    when 'REQUEST_REASSIGNED' then 'đã chuyển người duyệt của'
    when 'REQUEST_RETURNED' then 'đã trả lại'
    when 'REQUEST_RESUBMITTED' then 'đã gửi lại'
    when 'REQUEST_APPROVED' then 'đã chấp thuận'
    when 'REQUEST_REJECTED' then 'đã từ chối'
    when 'REQUEST_CANCELLED' then 'đã hủy'
    else 'đã cập nhật' end;
  v_block:=nullif(o.payload->>'blockKey','');
  v_message:=case when o.event_type in('REQUEST_DUE_SOON','REQUEST_OVERDUE') then
      v_action||': '||r.code||' · “'||v_title||'” · '||to_char((o.payload->>'dueAt')::timestamptz at time zone 'Asia/Ho_Chi_Minh','HH24:MI DD/MM/YYYY')
    else v_actor_name||' '||v_phrase||' '||r.code||' · “'||v_title||'”'||case when v_block is not null then ' · Bước '||left(v_block,60) else '' end||'.' end;
  v_link:='/rq/'||r.id::text||case when v_block is not null then '?block='||v_block||'&event='||o.id::text else '?event='||o.id::text end;
  insert into public.notifications(user_id,type,category,title,message,body,link,severity,source_type,source_id,priority,push_enabled,
    action_url,entity_type,entity_id,metadata)
  values(o.recipient_user_id::text,'info','request',left(r.code||' · '||v_action,100),left(v_message,220),left(v_message,220),v_link,
    'info','request_instance',r.id::text,'normal',true,'/#'||v_link,'request_instance',r.id,
    jsonb_strip_nulls(jsonb_build_object('requestInstanceId',r.id,'requestCode',r.code,'requestTitle',v_title,
      'eventType',o.event_type,'eventKey',o.event_key,'eventId',o.id,'actorUserId',v_actor,'actorName',case when v_actor is not null then v_actor_name end,
      'blockKey',v_block))) returning id into v_notification;
  update app_private.request_notification_outbox set status='DELIVERED',delivered_at=now(),locked_at=null,last_error=null where id=o.id;
  return jsonb_build_object('delivered',true,'notificationId',v_notification);
end $$;
revoke all on function app_private.deliver_request_notification(uuid) from public,anon,authenticated;
grant execute on function app_private.deliver_request_notification(uuid) to service_role;
