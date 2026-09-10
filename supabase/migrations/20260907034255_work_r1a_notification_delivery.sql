-- Work notification delivery remains disabled until the named pilot checkpoint.
create table app_private.work_notification_settings (
  singleton boolean primary key default true check(singleton), enabled boolean not null default false,
  due_soon_minutes integer not null default 60 check(due_soon_minutes between 1 and 1440),
  cooldown_minutes integer not null default 5 check(cooldown_minutes between 0 and 60)
);
insert into app_private.work_notification_settings(singleton) values(true);
alter table app_private.work_notification_settings enable row level security;
revoke all on app_private.work_notification_settings from public,anon,authenticated;
alter table app_private.work_notification_outbox add column dead_at timestamptz;
alter table app_private.work_notification_deliveries add column notification_id uuid references public.notifications(id) on delete set null;
alter table app_private.work_notification_deliveries add column mandatory boolean not null default false;
create index work_deliveries_notification_idx on app_private.work_notification_deliveries(notification_id) where notification_id is not null;
alter table public.notifications add column work_delivery_id uuid references app_private.work_notification_deliveries(id) on delete restrict;
create unique index notifications_work_delivery_key on public.notifications(work_delivery_id) where work_delivery_id is not null;
alter table public.notifications add constraint notifications_work_identity_check check(work_delivery_id is null or
  (source_type='work_task' and entity_type='work_task' and entity_id is not null and user_id is not null and module='work' and not push_enabled));

create table app_private.work_push_jobs (
  id uuid primary key default gen_random_uuid(), delivery_id uuid not null references app_private.work_notification_deliveries(id) on delete restrict,
  subscription_id uuid references public.web_push_subscriptions(id) on delete set null,
  status text not null default 'pending' check(status in ('pending','processing','delivered','failed','suppressed')),
  attempt_count integer not null default 0 check(attempt_count>=0), available_at timestamptz not null default now(),
  lease_token uuid, locked_at timestamptz, finished_at timestamptz, last_error text,
  unique(delivery_id,subscription_id)
);
create index work_push_claim_idx on app_private.work_push_jobs(available_at,id) where finished_at is null;
create index work_push_subscription_idx on app_private.work_push_jobs(subscription_id) where subscription_id is not null;
alter table app_private.work_push_jobs enable row level security;
revoke all on app_private.work_push_jobs from public,anon,authenticated;
create table app_private.work_reminder_keys (reminder_key text primary key,created_at timestamptz not null default now());
alter table app_private.work_reminder_keys enable row level security;
revoke all on app_private.work_reminder_keys from public,anon,authenticated;

-- Shared notifications must not bypass Work privacy, including technical admins.
create policy notifications_work_boundary on public.notifications as restrictive for all to authenticated
using(work_delivery_id is null or (user_id=public.current_app_user_id()::text and app_private.work_task_actor_can_view(entity_id)))
with check(work_delivery_id is null or (user_id=public.current_app_user_id()::text and app_private.work_task_actor_can_view(entity_id)));
create function app_private.work_guard_notification() returns trigger language plpgsql set search_path='' as $$
begin
  if current_user in ('postgres','service_role','supabase_admin') then return new; end if;
  if tg_op='UPDATE' and old.work_delivery_id is not null then
    if (to_jsonb(new)-array['read_at','is_read','is_dismissed']) is distinct from (to_jsonb(old)-array['read_at','is_read','is_dismissed']) then
      raise exception 'WORK_NOTIFICATION_IMMUTABLE' using errcode='42501'; end if;
  elsif new.work_delivery_id is not null or new.source_type='work_task' or new.entity_type='work_task' or new.module='work' or new.category='work' then
    raise exception 'WORK_NOTIFICATION_WORKER_ONLY' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function app_private.work_guard_notification() from public,anon,authenticated;
create trigger work_notification_guard before insert or update on public.notifications for each row execute function app_private.work_guard_notification();

-- Realtime carries only invalidation metadata, never audit/comment content.
create table public.work_task_revisions (
  task_id uuid primary key references public.work_tasks(id) on delete restrict,
  revision bigint not null default 1, changed_at timestamptz not null default now()
);
alter table public.work_task_revisions enable row level security;
revoke all on public.work_task_revisions from public,anon,authenticated;
grant select on public.work_task_revisions to authenticated;
create policy work_task_revisions_select on public.work_task_revisions for select to authenticated using(app_private.work_task_actor_can_view(task_id));
create function app_private.work_signal_revision() returns trigger language plpgsql security definer set search_path='' as $$ begin
  insert into public.work_task_revisions(task_id) values(new.task_id) on conflict(task_id) do update set revision=public.work_task_revisions.revision+1,changed_at=now();
  return new;
end $$;
revoke all on function app_private.work_signal_revision() from public,anon,authenticated;
create trigger work_event_revision after insert on public.work_task_events for each row execute function app_private.work_signal_revision();
insert into public.work_task_revisions(task_id) select id from public.work_tasks;
alter publication supabase_realtime add table public.work_task_revisions;

create function app_private.work_require_notification_worker() returns void language plpgsql set search_path='' as $$ begin
  if auth.role() is distinct from 'service_role' then raise exception 'WORK_NOTIFICATION_WORKER_ONLY' using errcode='42501'; end if;
end $$;
revoke all on function app_private.work_require_notification_worker() from public,anon,authenticated;

-- Returns NULL for an ineligible/stale recipient, otherwise whether mute may be bypassed.
create function app_private.work_notification_mandatory(p_event_id uuid,p_user_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare e public.work_task_events%rowtype; t public.work_tasks%rowtype; a public.work_task_assignments%rowtype;
  v_related boolean; v_mandatory boolean:=false; v_target boolean;
begin
  select * into e from public.work_task_events where id=p_event_id;
  if e.id is null or not app_private.work_task_user_can_view(e.task_id,p_user_id) then return null; end if;
  select * into strict t from public.work_tasks where id=e.task_id;
  select * into a from public.work_task_assignments where task_id=t.id and user_id=p_user_id and (ended_at is null or (t.status='completed' and state='completed') or (t.status='cancelled' and state='cancelled'));
  v_related:=t.created_by=p_user_id or a.id is not null or exists(select 1 from public.work_task_participants where task_id=t.id and user_id=p_user_id and ended_at is null)
    or (e.event_type='assignment.transferred' and e.actor_user_id=p_user_id);
  if e.event_type='comment.mentioned' then
    if not coalesce(e.payload->'recipientUserIds' @> jsonb_build_array(p_user_id),false) then return null; end if;
    return true;
  elsif e.event_type='assignment.ack_overdue' then
    if not exists(select 1 from public.work_task_assignments x where x.id=(e.payload->>'assignmentId')::uuid and x.task_id=t.id
      and x.ended_at is null and x.acknowledged_at is null and x.acknowledgement_due_at=(e.payload->>'dueAt')::timestamptz and x.acknowledgement_due_at<=now()) then return null; end if;
    v_target:=p_user_id=(e.payload->>'userId')::uuid;
    if not (v_target or t.created_by=p_user_id or coalesce(p_user_id=app_private.resolve_strict_direct_manager((e.payload->>'userId')::uuid),false)) then return null; end if;
    return true;
  elsif e.event_type in ('task.deadline_soon','task.overdue') then
    if t.status in ('completed','cancelled') or t.deadline_at is distinct from (e.payload->>'dueAt')::timestamptz
      or (e.event_type='task.deadline_soon' and t.deadline_at<=now()) then return null; end if;
    if t.created_by<>p_user_id and a.id is null then return null; end if;
    return true;
  end if;
  if not v_related then return null; end if;
  -- The companion mention event is the sole notification for explicitly mentioned users.
  if e.event_type in ('comment.created','comment.edited') and coalesce(e.payload->'after'->'mentionedUserIds' @> jsonb_build_array(p_user_id),false) then return null; end if;
  v_mandatory:= (e.event_type='task.created' and a.id is not null and a.ended_at is null and a.acknowledged_at is null)
    or (e.event_type='assignment.transferred' and e.payload->>'toUserId'=p_user_id::text and a.id is not null and a.ended_at is null and a.acknowledged_at is null)
    or (e.event_type='assignment.co_assignees_added' and coalesce(e.payload->'userIds' @> jsonb_build_array(p_user_id),false) and a.id is not null and a.ended_at is null and a.acknowledged_at is null)
    or (e.event_type='task.review_submitted' and t.status='awaiting_review' and t.reviewer_user_id=p_user_id and (app_private.has_permission(p_user_id,'work.task.review','assigned','*') or (t.scope_type<>'direct' and app_private.has_permission(p_user_id,'work.task.review',t.scope_type,coalesce(t.department_id::text,t.project_id)))))
    or (e.event_type='task.changes_requested' and a.id is not null and a.acknowledged_at is not null and t.status='changes_requested')
    or e.event_type like 'security.%';
  v_mandatory:=coalesce(v_mandatory,false);
  if e.actor_user_id=p_user_id and not v_mandatory then return null; end if;
  return v_mandatory;
end $$;
revoke all on function app_private.work_notification_mandatory(uuid,uuid) from public,anon,authenticated;

create function app_private.work_enqueue_reminders(p_limit integer) returns integer language plpgsql security definer set search_path='' as $$
declare r record; v_key text; v_id uuid; v_count integer:=0; v_minutes integer;
begin
  select due_soon_minutes into v_minutes from app_private.work_notification_settings where singleton;
  for r in
    select * from (
      select t.id task_id,case when t.deadline_at<=now() then 'task.overdue' else 'task.deadline_soon' end kind,
        t.deadline_at due_at,null::uuid assignment_id,null::uuid user_id
      from public.work_tasks t where t.status not in ('completed','cancelled') and t.deadline_at<=now()+make_interval(mins=>v_minutes)
      union all
      select a.task_id,'assignment.ack_overdue',a.acknowledgement_due_at,a.id,a.user_id from public.work_task_assignments a
      join public.work_tasks t on t.id=a.task_id where a.ended_at is null and a.acknowledged_at is null and a.acknowledgement_due_at<=now() and t.status not in ('completed','cancelled')
    ) q where not exists(select 1 from app_private.work_reminder_keys k where k.reminder_key=q.kind||':'||q.task_id||':'||coalesce(q.assignment_id::text,'')||':'||extract(epoch from q.due_at)::text||':'||(now() at time zone 'UTC')::date::text)
    order by q.due_at,q.task_id,q.assignment_id limit least(100,greatest(1,p_limit))
  loop
    v_key:=r.kind||':'||r.task_id||':'||coalesce(r.assignment_id::text,'')||':'||extract(epoch from r.due_at)::text||':'||(now() at time zone 'UTC')::date::text;
    insert into app_private.work_reminder_keys values(v_key,now()) on conflict do nothing;
    if not found then continue; end if;
    insert into public.work_task_events(task_id,event_type,source,payload) values(r.task_id,r.kind,'system',jsonb_strip_nulls(jsonb_build_object('dueAt',r.due_at,'assignmentId',r.assignment_id,'userId',r.user_id))) returning id into v_id;
    insert into app_private.work_notification_outbox(event_id,task_id,event_type,payload) values(v_id,r.task_id,r.kind,jsonb_build_object('taskId',r.task_id));
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$;
revoke all on function app_private.work_enqueue_reminders(integer) from public,anon,authenticated;

create function app_private.work_process_notifications(p_limit integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare o app_private.work_notification_outbox%rowtype; e public.work_task_events%rowtype; t public.work_tasks%rowtype;
  v_user uuid; v_mandatory boolean; v_reason text; v_delivery uuid; v_notification uuid; v_push uuid; v_url text; v_comment text;
  v_count integer:=0; v_failed integer:=0; v_reminders integer; v_cooldown integer; v_subscriptions uuid[];
begin
  perform app_private.work_require_notification_worker();
  if not (select enabled from app_private.work_notification_settings where singleton) then return jsonb_build_object('enabled',false,'processed',0); end if;
  v_reminders:=app_private.work_enqueue_reminders(p_limit);
  select cooldown_minutes into v_cooldown from app_private.work_notification_settings where singleton;
  for o in select * from app_private.work_notification_outbox where processed_at is null and dead_at is null and available_at<=now()
    order by available_at,id limit least(50,greatest(1,coalesce(p_limit,20))) for update skip locked
  loop
    begin
      select * into strict e from public.work_task_events where id=o.event_id;
      -- Do not hold task locks in opposing order across concurrent batches.
      select * into t from public.work_tasks where id=o.task_id for update skip locked;
      if not found then continue; end if;
      v_comment:=case when e.event_type like 'comment.%' then coalesce(e.payload->>'commentId',e.payload->'after'->>'id') end;
      v_url:='/work/tasks/'||t.task_code||case when v_comment is not null then '?comment='||v_comment else '' end;
      for v_user in
        select t.created_by union select user_id from public.work_task_assignments where task_id=t.id and (ended_at is null or (t.status='completed' and state='completed') or (t.status='cancelled' and state='cancelled'))
        union select user_id from public.work_task_participants where task_id=t.id and ended_at is null
        union select x::uuid from jsonb_array_elements_text(case when e.event_type='comment.mentioned' then e.payload->'recipientUserIds' else '[]'::jsonb end) x
        union select e.actor_user_id where e.event_type='assignment.transferred'
        union select app_private.resolve_strict_direct_manager((e.payload->>'userId')::uuid) where e.event_type='assignment.ack_overdue'
      loop
        if v_user is null then continue; end if;
        v_mandatory:=app_private.work_notification_mandatory(e.id,v_user); v_reason:=null;
        if v_mandatory is null then v_reason:='ineligible';
        elsif not v_mandatory and exists(select 1 from public.work_task_notification_preferences where task_id=t.id and user_id=v_user and not notifications_enabled) then v_reason:='muted';
        elsif not v_mandatory and (e.event_type like 'comment.%' or e.event_type like 'checklist.%' or e.event_type like 'attachment.%')
          and exists(select 1 from app_private.work_notification_deliveries d join app_private.work_notification_outbox x on x.id=d.outbox_id
            where d.user_id=v_user and x.task_id=t.id and d.channel='in_app' and d.status='delivered' and not d.mandatory
              and (x.event_type like 'comment.%' or x.event_type like 'checklist.%' or x.event_type like 'attachment.%')
              and d.delivered_at>now()-make_interval(mins=>v_cooldown)) then v_reason:='cooldown'; end if;
        insert into app_private.work_notification_deliveries(outbox_id,user_id,channel,status,delivery_key,mandatory,last_error)
          values(o.id,v_user,'in_app',case when v_reason is null then 'pending' else 'suppressed' end,e.id||':'||v_user||':in_app',coalesce(v_mandatory,false),v_reason)
          on conflict(outbox_id,user_id,channel) do nothing returning id into v_delivery;
        if v_delivery is null or v_reason is not null then continue; end if;
        insert into public.notifications(user_id,title,message,body,module,category,source_type,source_id,entity_type,entity_id,link,action_url,priority,push_enabled,metadata,work_delivery_id)
          values(v_user::text,case when v_mandatory then 'Công việc cần bạn chú ý' else 'Cập nhật công việc' end,
            'Mở Vioo để xem công việc.','Mở Vioo để xem công việc.','work','work','work_task',t.id::text,'work_task',t.id,v_url,'/#'||v_url,
            case when t.priority='urgent' then 'urgent' else 'normal' end,false,
            jsonb_strip_nulls(jsonb_build_object('workTaskId',t.id,'taskCode',t.task_code,'commentId',v_comment,'eventType',e.event_type,'mandatory',v_mandatory)),v_delivery)
          returning id into v_notification;
        update app_private.work_notification_deliveries set status='delivered',notification_id=v_notification,delivered_at=now(),attempt_count=1,updated_at=now() where id=v_delivery;
        insert into app_private.work_notification_deliveries(outbox_id,user_id,channel,delivery_key,mandatory,notification_id)
          values(o.id,v_user,'web_push',e.id||':'||v_user||':web_push',v_mandatory,v_notification) returning id into v_push;
        select coalesce(array_agg(q.id),'{}') into v_subscriptions from (select id from public.web_push_subscriptions where user_id=v_user and is_active order by id limit 1001) q;
        if cardinality(v_subscriptions)>1000 then
          update app_private.work_notification_deliveries set status='failed',last_error='subscription_limit',updated_at=now() where id=v_push;
        elsif cardinality(v_subscriptions)=0 then
          update app_private.work_notification_deliveries set status='suppressed',last_error='no_active_subscription',updated_at=now() where id=v_push;
        else
          insert into app_private.work_push_jobs(delivery_id,subscription_id) select v_push,x from unnest(v_subscriptions) x;
        end if;
      end loop;
      update app_private.work_notification_outbox set processed_at=now(),attempt_count=attempt_count+1,last_error=null where id=o.id;
      v_count:=v_count+1;
    exception when others then
      update app_private.work_notification_outbox set attempt_count=attempt_count+1,last_error=sqlstate,
        available_at=now()+make_interval(secs=>least(3600,30*power(2,least(attempt_count,7)))::integer),
        dead_at=case when attempt_count+1>=8 then now() end where id=o.id;
      v_failed:=v_failed+1;
    end;
  end loop;
  return jsonb_build_object('enabled',true,'processed',v_count,'failed',v_failed,'reminders',v_reminders);
end $$;
revoke all on function app_private.work_process_notifications(integer) from public,anon,authenticated;
grant execute on function app_private.work_process_notifications(integer) to service_role;
create function public.process_work_notifications(p_limit integer default 20) returns jsonb language sql security invoker set search_path='' as $$ select app_private.work_process_notifications(p_limit); $$;
revoke all on function public.process_work_notifications(integer) from public,anon,authenticated;
grant execute on function public.process_work_notifications(integer) to service_role;

create function app_private.work_refresh_push_delivery(p_delivery_id uuid) returns void language sql security definer set search_path='' as $$
  update app_private.work_notification_deliveries d set
    status=case when exists(select 1 from app_private.work_push_jobs where delivery_id=d.id and finished_at is null) then 'processing'
      when exists(select 1 from app_private.work_push_jobs where delivery_id=d.id and status='failed') then 'failed'
      when exists(select 1 from app_private.work_push_jobs where delivery_id=d.id and status='delivered') then 'delivered' else 'suppressed' end,
    delivered_at=case when not exists(select 1 from app_private.work_push_jobs where delivery_id=d.id and (finished_at is null or status='failed')) and exists(select 1 from app_private.work_push_jobs where delivery_id=d.id and status='delivered') then (select max(finished_at) from app_private.work_push_jobs where delivery_id=d.id and status='delivered') end,
    attempt_count=coalesce((select max(attempt_count) from app_private.work_push_jobs where delivery_id=d.id),0),updated_at=now()
  where d.id=p_delivery_id;
$$;
revoke all on function app_private.work_refresh_push_delivery(uuid) from public,anon,authenticated;
create function app_private.work_claim_push(p_limit integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare j app_private.work_push_jobs%rowtype; d app_private.work_notification_deliveries%rowtype;
  o app_private.work_notification_outbox%rowtype; s public.web_push_subscriptions%rowtype; n public.notifications%rowtype;
  v_token uuid; v_mandatory boolean; v_reason text; v_rows jsonb:='[]';
begin
  perform app_private.work_require_notification_worker();
  if not (select enabled from app_private.work_notification_settings where singleton) then return v_rows; end if;
  -- Serialize the short claim transaction; network delivery remains concurrent.
  if not pg_try_advisory_xact_lock(hashtext('vioo_work_push_claim'),0) then return v_rows; end if;
  for j in select * from app_private.work_push_jobs where finished_at is null and available_at<=now()
    and (status<>'processing' or locked_at<now()-interval '2 minutes')
    order by available_at,id limit least(50,greatest(1,coalesce(p_limit,20))) for update skip locked
  loop
    select * into strict d from app_private.work_notification_deliveries where id=j.delivery_id;
    select * into strict o from app_private.work_notification_outbox where id=d.outbox_id;
    select * into s from public.web_push_subscriptions where id=j.subscription_id and user_id=d.user_id and is_active;
    select * into n from public.notifications where id=d.notification_id;
    v_mandatory:=app_private.work_notification_mandatory(o.event_id,d.user_id); v_reason:=null;
    if j.attempt_count>=8 then v_reason:='retry_exhausted';
    elsif s.id is null then v_reason:='subscription_inactive';
    elsif n.id is null then v_reason:='notification_removed';
    elsif v_mandatory is null then v_reason:='access_or_relationship_changed';
    elsif not v_mandatory and exists(select 1 from public.work_task_notification_preferences where task_id=o.task_id and user_id=d.user_id and not notifications_enabled) then v_reason:='muted'; end if;
    if v_reason is not null then
      update app_private.work_push_jobs set status=case when v_reason='retry_exhausted' then 'failed' else 'suppressed' end,finished_at=now(),last_error=v_reason,lease_token=null,locked_at=null where id=j.id;
      perform app_private.work_refresh_push_delivery(d.id); continue;
    end if;
    v_token:=gen_random_uuid();
    update app_private.work_push_jobs set status='processing',attempt_count=attempt_count+1,lease_token=v_token,locked_at=now() where id=j.id;
    v_rows:=v_rows||jsonb_build_array(jsonb_build_object('id',j.id,'leaseToken',v_token,'subscription',jsonb_build_object('endpoint',s.endpoint,'keys',jsonb_build_object('p256dh',s.p256dh,'auth',s.auth)),
      'payload',jsonb_build_object('title',n.title,'body',n.message,'url',n.action_url,'tag',n.id,'notificationId',n.id,'priority',n.priority,'renotify',false)));
    perform app_private.work_refresh_push_delivery(d.id);
  end loop;
  return v_rows;
end $$;
revoke all on function app_private.work_claim_push(integer) from public,anon,authenticated;
grant execute on function app_private.work_claim_push(integer) to service_role;
create function public.claim_work_push(p_limit integer default 20) returns jsonb language sql security invoker set search_path='' as $$ select app_private.work_claim_push(p_limit); $$;
revoke all on function public.claim_work_push(integer) from public,anon,authenticated;
grant execute on function public.claim_work_push(integer) to service_role;

create function app_private.work_finish_push(p_job_id uuid,p_lease_token uuid,p_outcome text) returns boolean language plpgsql security definer set search_path='' as $$
declare j app_private.work_push_jobs%rowtype;
begin
  perform app_private.work_require_notification_worker();
  if p_outcome is null or p_outcome not in ('sent','retry','gone','failed') then raise exception 'WORK_INVALID_PUSH_OUTCOME' using errcode='22023'; end if;
  select * into j from app_private.work_push_jobs where id=p_job_id for update;
  if j.id is null or j.status<>'processing' or j.lease_token is distinct from p_lease_token or p_lease_token is null then return false; end if;
  update app_private.work_push_jobs set status=case when p_outcome='sent' then 'delivered' when p_outcome='gone' then 'suppressed' when p_outcome='retry' and attempt_count<8 then 'pending' else 'failed' end,
    finished_at=case when p_outcome<>'retry' or attempt_count>=8 then now() end,
    available_at=now()+make_interval(secs=>least(3600,30*power(2,least(attempt_count-1,7)))::integer),
    lease_token=null,locked_at=null,last_error=case when p_outcome<>'sent' then p_outcome end where id=j.id;
  if p_outcome='gone' then update public.web_push_subscriptions set is_active=false,updated_at=now() where id=j.subscription_id; end if;
  perform app_private.work_refresh_push_delivery(j.delivery_id);
  return true;
end $$;
revoke all on function app_private.work_finish_push(uuid,uuid,text) from public,anon,authenticated;
grant execute on function app_private.work_finish_push(uuid,uuid,text) to service_role;
create function public.finish_work_push(p_job_id uuid,p_lease_token uuid,p_outcome text) returns boolean language sql security invoker set search_path='' as $$ select app_private.work_finish_push(p_job_id,p_lease_token,p_outcome); $$;
revoke all on function public.finish_work_push(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.finish_work_push(uuid,uuid,text) to service_role;

create function app_private.work_notification_tick() returns bigint language plpgsql security definer set search_path='' as $$
declare v_secret text; v_request bigint;
begin
  if not (select enabled from app_private.work_notification_settings where singleton) then return null; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='send_web_push_secret' limit 1;
  if nullif(v_secret,'') is null then raise exception 'WORK_NOTIFICATION_SECRET_MISSING'; end if;
  select net.http_post(url:='https://ftciqmqhmfvjtwoycswe.supabase.co/functions/v1/process-work-notifications',
    headers:=jsonb_build_object('Content-Type','application/json','x-web-push-secret',v_secret),body:='{}'::jsonb,timeout_milliseconds:=60000) into v_request;
  return v_request;
end $$;
revoke all on function app_private.work_notification_tick() from public,anon,authenticated;
select cron.schedule('work-notification-outbox','* * * * *','select app_private.work_notification_tick();');
