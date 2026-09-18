create table app_private.workflow_notification_settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  due_soon_minutes integer not null default 60 check(due_soon_minutes between 1 and 1440),
  rollout_started_at timestamptz
);
insert into app_private.workflow_notification_settings(singleton) values(true);
alter table app_private.workflow_notification_settings enable row level security;
revoke all on app_private.workflow_notification_settings from public,anon,authenticated;

create table app_private.workflow_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  instance_id uuid not null references public.workflow_instances(id) on delete restrict,
  event_type text not null,
  actor_user_id uuid references public.users(id) on delete restrict,
  recipient_user_ids uuid[] not null default '{}',
  payload jsonb not null default '{}',
  status text not null default 'PENDING' check(status in ('PENDING','PROCESSING','DELIVERED','FAILED','SUPPRESSED')),
  attempt_count integer not null default 0 check(attempt_count between 0 and 10),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(jsonb_typeof(payload)='object')
);
create index workflow_notification_claim_idx on app_private.workflow_notification_outbox(available_at,created_at,id)
  where status in ('PENDING','PROCESSING');
alter table app_private.workflow_notification_outbox enable row level security;
revoke all on app_private.workflow_notification_outbox from public,anon,authenticated;

create table app_private.workflow_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references app_private.workflow_notification_outbox(id) on delete restrict,
  user_id uuid not null references public.users(id) on delete restrict,
  notification_id uuid references public.notifications(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(outbox_id,user_id)
);
alter table app_private.workflow_notification_deliveries enable row level security;
revoke all on app_private.workflow_notification_deliveries from public,anon,authenticated;

create function app_private.workflow_require_notification_worker()
returns void language plpgsql stable security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'WORKFLOW_NOTIFICATION_WORKER_ONLY' using errcode='42501';
  end if;
end $$;
revoke all on function app_private.workflow_require_notification_worker() from public,anon,authenticated;

create function app_private.workflow_notification_content(p_outbox_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o app_private.workflow_notification_outbox%rowtype; i public.workflow_instances%rowtype;
  v_actor text; v_action text; v_phrase text; v_title text; v_message text;
begin
  select * into strict o from app_private.workflow_notification_outbox where id=p_outbox_id;
  select * into strict i from public.workflow_instances where id=o.instance_id;
  select regexp_replace(btrim(u.name),'[[:space:]]+',' ','g') into v_actor from public.users u where u.id=o.actor_user_id;
  v_actor:=coalesce(nullif(v_actor,''),'Hệ thống');
  v_title:=left(regexp_replace(btrim(i.title),'[[:space:]]+',' ','g'),140);
  v_action:=case o.event_type
    when 'INSTANCE_SUBMITTED' then 'Quy trình mới'
    when 'STEP_ASSIGNED' then 'Bước chờ xử lý'
    when 'STEP_APPROVED' then 'Đã duyệt bước'
    when 'STEP_REJECTED' then 'Đã từ chối'
    when 'REVISION_REQUESTED' then 'Cần chỉnh sửa'
    when 'INSTANCE_COMPLETED' then 'Đã hoàn tất'
    when 'INSTANCE_CANCELLED' then 'Đã hủy'
    when 'INSTANCE_REOPENED' then 'Đã mở lại'
    when 'COMMENT_MENTIONED' then 'Đã nhắc đến bạn'
    when 'STEP_DUE_SOON' then 'Sắp đến hạn'
    when 'STEP_OVERDUE' then 'Quá hạn'
    else 'Có cập nhật'
  end;
  v_phrase:=case o.event_type
    when 'INSTANCE_SUBMITTED' then 'đã tạo'
    when 'STEP_ASSIGNED' then 'đã chuyển bước của'
    when 'STEP_APPROVED' then 'đã duyệt một bước của'
    when 'STEP_REJECTED' then 'đã từ chối'
    when 'REVISION_REQUESTED' then 'đã yêu cầu chỉnh sửa'
    when 'INSTANCE_COMPLETED' then 'đã hoàn tất'
    when 'INSTANCE_CANCELLED' then 'đã hủy'
    when 'INSTANCE_REOPENED' then 'đã mở lại'
    when 'COMMENT_MENTIONED' then 'đã nhắc đến bạn trong'
    else 'đã cập nhật'
  end;
  v_message:=case when o.event_type in ('STEP_DUE_SOON','STEP_OVERDUE') then
      v_action||': “'||v_title||'” · '||to_char((o.payload->>'dueAt')::timestamptz at time zone 'Asia/Ho_Chi_Minh','HH24:MI DD/MM/YYYY')
    else v_actor||' '||v_phrase||' “'||v_title||'”.' end;
  return jsonb_build_object('title',left(i.code||' · '||v_action,100),'message',left(v_message,220),
    'metadata',jsonb_strip_nulls(jsonb_build_object('workflowEventKey',o.event_key,'eventType',o.event_type,
      'instanceId',i.id,'instanceCode',i.code,'instanceTitle',v_title,'actorUserId',o.actor_user_id,
      'actorName',case when o.actor_user_id is not null then v_actor end,
      'nodeId',o.payload->>'nodeId','commentId',o.payload->>'commentId')));
end $$;
revoke all on function app_private.workflow_notification_content(uuid) from public,anon,authenticated;

create function app_private.claim_workflow_notification_outbox(p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r record; v_items jsonb:='[]'; v_limit integer:=least(greatest(coalesce(p_limit,50),1),50); v_rollout timestamptz;
begin
  perform app_private.workflow_require_notification_worker();
  select rollout_started_at into v_rollout from app_private.workflow_notification_settings where singleton;
  if v_rollout is not null then
    update app_private.workflow_notification_outbox set status='SUPPRESSED',last_error='pre_rollout_backlog',updated_at=now()
      where status='PENDING' and created_at<v_rollout;
  end if;
  if not (select enabled from app_private.workflow_notification_settings where singleton) then
    return jsonb_build_object('enabled',false,'items','[]'::jsonb);
  end if;
  update app_private.workflow_notification_outbox set status='PENDING',locked_at=null,updated_at=now()
    where status='PROCESSING' and locked_at<now()-interval '2 minutes' and attempt_count<10;
  update app_private.workflow_notification_outbox set status='FAILED',last_error='retry_exhausted',locked_at=null,updated_at=now()
    where status in ('PENDING','PROCESSING') and attempt_count>=10;
  for r in
    select id from app_private.workflow_notification_outbox
    where status='PENDING' and attempt_count<10 and available_at<=now()
    order by available_at,created_at,id limit v_limit for update skip locked
  loop
    update app_private.workflow_notification_outbox set status='PROCESSING',attempt_count=attempt_count+1,
      locked_at=now(),last_error=null,updated_at=now() where id=r.id;
    v_items:=v_items||jsonb_build_array(jsonb_build_object('id',r.id));
  end loop;
  return jsonb_build_object('enabled',true,'items',v_items);
end $$;
revoke all on function app_private.claim_workflow_notification_outbox(integer) from public,anon,authenticated;
grant execute on function app_private.claim_workflow_notification_outbox(integer) to service_role;

create function public.claim_workflow_notification_outbox(p_limit integer default 50)
returns jsonb language sql security invoker set search_path='' as $$
  select app_private.claim_workflow_notification_outbox(p_limit);
$$;
revoke all on function public.claim_workflow_notification_outbox(integer) from public,anon,authenticated;
grant execute on function public.claim_workflow_notification_outbox(integer) to service_role;

create function app_private.deliver_workflow_notification(p_outbox_id uuid)
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
      candidate.user_id=i.created_by
      or candidate.user_id::text=any(coalesce(i.watchers,'{}'::text[]))
      or coalesce(i.step_assignees->>i.current_node_id::text,'')=candidate.user_id::text
      or (jsonb_typeof(i.step_assignees->i.current_node_id::text)='array' and exists(
        select 1 from jsonb_array_elements_text(i.step_assignees->i.current_node_id::text) x(value)
        where x.value=candidate.user_id::text))
      or o.event_type='COMMENT_MENTIONED'
    )
  loop
    insert into app_private.workflow_notification_deliveries(outbox_id,user_id)
      values(o.id,v_user) on conflict(outbox_id,user_id) do nothing returning id into v_delivery;
    if v_delivery is null then continue; end if;
    insert into public.notifications(user_id,title,message,body,type,priority,module,category,severity,source_type,source_id,
      entity_type,entity_id,link,action_url,push_enabled,metadata)
    values(v_user::text,v_content->>'title',v_content->>'message',v_content->>'message','info','normal','WF','workflow','info',
      'workflow_instance',i.id::text,'workflow_instance',i.id,v_link,'/#'||v_link,true,v_content->'metadata') returning id into v_notification;
    update app_private.workflow_notification_deliveries set notification_id=v_notification where id=v_delivery;
    v_count:=v_count+1;
  end loop;
  update app_private.workflow_notification_outbox set status='DELIVERED',delivered_at=now(),locked_at=null,last_error=null,updated_at=now() where id=o.id;
  return jsonb_build_object('status','DELIVERED','delivered',v_count);
end $$;
revoke all on function app_private.deliver_workflow_notification(uuid) from public,anon,authenticated;
grant execute on function app_private.deliver_workflow_notification(uuid) to service_role;

create function public.deliver_workflow_notification(p_outbox_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select app_private.deliver_workflow_notification(p_outbox_id);
$$;
revoke all on function public.deliver_workflow_notification(uuid) from public,anon,authenticated;
grant execute on function public.deliver_workflow_notification(uuid) to service_role;

create function app_private.fail_workflow_notification_outbox(p_outbox_id uuid,p_error_message text)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform app_private.workflow_require_notification_worker();
  update app_private.workflow_notification_outbox set
    status=case when attempt_count>=10 then 'FAILED' else 'PENDING' end,
    available_at=now()+make_interval(secs=>least(3600,30*power(2,least(greatest(attempt_count-1,0),7)))::integer),
    locked_at=null,last_error=case when attempt_count>=10 then 'retry_exhausted' else 'delivery_failed' end,updated_at=now()
  where id=p_outbox_id and status='PROCESSING';
end $$;
revoke all on function app_private.fail_workflow_notification_outbox(uuid,text) from public,anon,authenticated;
grant execute on function app_private.fail_workflow_notification_outbox(uuid,text) to service_role;

create function public.fail_workflow_notification_outbox(p_outbox_id uuid,p_error_message text)
returns void language sql security invoker set search_path='' as $$
  select app_private.fail_workflow_notification_outbox(p_outbox_id,p_error_message);
$$;
revoke all on function public.fail_workflow_notification_outbox(uuid,text) from public,anon,authenticated;
grant execute on function public.fail_workflow_notification_outbox(uuid,text) to service_role;

create function app_private.workflow_notification_tick()
returns bigint language plpgsql security definer set search_path='' as $$
declare v_key text; v_request bigint;
begin
  if not (select enabled from app_private.workflow_notification_settings where singleton) then return null; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name='workflow_notification_worker_service_key';
  if nullif(v_key,'') is null then return null; end if;
  select net.http_post(
    url:='https://ftciqmqhmfvjtwoycswe.supabase.co/functions/v1/process-workflow-notifications',
    headers:=jsonb_build_object('Content-Type','application/json','apikey',v_key),
    body:=jsonb_build_object('limit',50),timeout_milliseconds:=10000
  ) into v_request;
  return v_request;
end $$;
revoke all on function app_private.workflow_notification_tick() from public,anon,authenticated;

select cron.schedule(
  'process-workflow-notifications-every-minute','* * * * *',
  'select app_private.workflow_notification_tick();'
);
