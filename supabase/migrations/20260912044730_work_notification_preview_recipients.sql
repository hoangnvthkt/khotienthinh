alter table app_private.work_notification_settings
  add column rollout_started_at timestamptz;

-- Build a short preview from structured task/event data only. Event payload text
-- (comments, reasons, forms and attachment names) is deliberately never copied.
create function app_private.work_notification_content(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  e public.work_task_events%rowtype;
  t public.work_tasks%rowtype;
  v_actor_name text;
  v_task_title text;
  v_action text;
  v_phrase text;
  v_message text;
begin
  select * into strict e from public.work_task_events where id=p_event_id;
  select * into strict t from public.work_tasks where id=e.task_id;
  select regexp_replace(btrim(u.name),'[[:space:]]+',' ','g') into v_actor_name
    from public.users u where u.id=e.actor_user_id;
  v_actor_name:=coalesce(nullif(v_actor_name,''),'Hệ thống');
  v_task_title:=left(regexp_replace(btrim(t.title),'[[:space:]]+',' ','g'),140);

  v_action:=case e.event_type
    when 'task.created' then 'Công việc mới'
    when 'assignment.acknowledged' then 'Đã nhận việc'
    when 'assignment.clarification_requested' then 'Yêu cầu làm rõ'
    when 'assignment.transferred' then 'Đã chuyển giao'
    when 'assignment.co_assignees_added' then 'Được thêm thực hiện'
    when 'assignment.ack_overdue' then 'Chưa xác nhận'
    when 'task.started' then 'Đã bắt đầu'
    when 'task.blocked' then 'Đang bị chặn'
    when 'task.unblocked' then 'Đã tiếp tục'
    when 'task.review_submitted' then 'Chờ duyệt'
    when 'task.changes_requested' then 'Cần chỉnh sửa'
    when 'task.completed' then 'Đã hoàn tất'
    when 'task.cancelled' then 'Đã hủy'
    when 'task.deadline_soon' then 'Sắp đến hạn'
    when 'task.overdue' then 'Quá hạn'
    when 'task.schedule_updated' then 'Đổi lịch công việc'
    when 'task.watchers_updated' then 'Đổi người theo dõi'
    when 'task.description_updated' then 'Cập nhật mô tả'
    when 'task.result_draft_updated' then 'Cập nhật kết quả'
    when 'task.progress_updated' then 'Cập nhật tiến độ'
    when 'comment.mentioned' then 'Đã nhắc đến bạn'
    when 'comment.created' then 'Bình luận mới'
    when 'comment.edited' then 'Đã sửa bình luận'
    when 'checklist.created' then 'Thêm mục công việc'
    when 'checklist.updated' then 'Cập nhật mục công việc'
    when 'checklist.completed' then 'Hoàn tất mục công việc'
    when 'checklist.reopened' then 'Mở lại mục công việc'
    when 'checklist.deleted' then 'Xóa mục công việc'
    when 'attachment.added' then 'Thêm tệp đính kèm'
    when 'attachment.deleted' then 'Xóa tệp đính kèm'
    else 'Có cập nhật'
  end;
  v_phrase:=case e.event_type
    when 'task.created' then 'đã giao'
    when 'assignment.acknowledged' then 'đã nhận'
    when 'assignment.clarification_requested' then 'yêu cầu làm rõ'
    when 'assignment.transferred' then 'đã chuyển giao'
    when 'assignment.co_assignees_added' then 'đã thêm người thực hiện vào'
    when 'task.started' then 'đã bắt đầu'
    when 'task.blocked' then 'đã đánh dấu bị chặn'
    when 'task.unblocked' then 'đã tiếp tục'
    when 'task.review_submitted' then 'đã gửi duyệt'
    when 'task.changes_requested' then 'đã yêu cầu chỉnh sửa'
    when 'task.completed' then 'đã hoàn tất'
    when 'task.cancelled' then 'đã hủy'
    when 'task.schedule_updated' then 'đã đổi lịch'
    when 'task.watchers_updated' then 'đã đổi người theo dõi của'
    when 'task.description_updated' then 'đã cập nhật mô tả'
    when 'task.result_draft_updated' then 'đã cập nhật kết quả'
    when 'task.progress_updated' then 'đã cập nhật tiến độ'
    when 'comment.mentioned' then 'đã nhắc đến bạn trong'
    when 'comment.created' then 'đã bình luận trong'
    when 'comment.edited' then 'đã sửa bình luận trong'
    when 'checklist.created' then 'đã thêm mục vào'
    when 'checklist.updated' then 'đã cập nhật một mục trong'
    when 'checklist.completed' then 'đã hoàn tất một mục trong'
    when 'checklist.reopened' then 'đã mở lại một mục trong'
    when 'checklist.deleted' then 'đã xóa một mục trong'
    when 'attachment.added' then 'đã thêm tệp vào'
    when 'attachment.deleted' then 'đã xóa tệp khỏi'
    else 'đã cập nhật'
  end;

  v_message:=case
    when e.event_type in ('task.deadline_soon','task.overdue','assignment.ack_overdue') then
      v_action||': “'||v_task_title||'” · '||
      to_char((e.payload->>'dueAt')::timestamptz at time zone 'Asia/Ho_Chi_Minh','HH24:MI DD/MM/YYYY')
    else v_actor_name||' '||v_phrase||' “'||v_task_title||'”.'
  end;

  return jsonb_build_object(
    'title',left(t.task_code||' · '||v_action,100),
    'message',left(v_message,220),
    'metadata',jsonb_strip_nulls(jsonb_build_object(
      'eventType',e.event_type,
      'eventKey',e.id,
      'workTaskId',t.id,
      'taskCode',t.task_code,
      'taskTitle',v_task_title,
      'actorUserId',e.actor_user_id,
      'actorName',case when e.actor_user_id is not null then v_actor_name end
    ))
  );
end $$;
revoke all on function app_private.work_notification_content(uuid) from public,anon,authenticated;

-- Returns NULL for an ineligible/stale recipient, otherwise whether mute may be bypassed.
create or replace function app_private.work_notification_mandatory(p_event_id uuid,p_user_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare e public.work_task_events%rowtype; t public.work_tasks%rowtype; a public.work_task_assignments%rowtype;
  v_related boolean; v_mandatory boolean:=false; v_target boolean; s record;
begin
  select * into e from public.work_task_events where id=p_event_id;
  if e.id is null or not app_private.work_task_user_can_view(e.task_id,p_user_id) then return null; end if;
  select * into strict t from public.work_tasks where id=e.task_id;
  select * into strict s from app_private.work_task_permission_scope(t.id);
  if s.workspace_id is not null and s.workspace_status<>'active' then return null; end if;
  select * into a from public.work_task_assignments where task_id=t.id and user_id=p_user_id
    and (ended_at is null or (t.status='completed' and state='completed') or (t.status='cancelled' and state='cancelled'));
  v_related:=t.created_by=p_user_id or a.id is not null
    or exists(select 1 from public.work_task_participants where task_id=t.id and user_id=p_user_id and ended_at is null)
    or (e.event_type='assignment.transferred' and e.actor_user_id=p_user_id);
  if e.event_type='comment.mentioned' then
    if not coalesce(e.payload->'recipientUserIds'@>jsonb_build_array(p_user_id),false) then return null; end if;
    return true;
  elsif e.event_type='assignment.ack_overdue' then
    if not exists(select 1 from public.work_task_assignments x where x.id=(e.payload->>'assignmentId')::uuid and x.task_id=t.id
      and x.ended_at is null and x.acknowledged_at is null and x.acknowledgement_due_at=(e.payload->>'dueAt')::timestamptz and x.acknowledgement_due_at<=now()) then return null; end if;
    v_target:=p_user_id=(e.payload->>'userId')::uuid;
    if not(v_target or t.created_by=p_user_id or coalesce(p_user_id=app_private.resolve_strict_direct_manager((e.payload->>'userId')::uuid),false)) then return null; end if;
    return true;
  elsif e.event_type in ('task.deadline_soon','task.overdue') then
    if t.status in('completed','cancelled') or t.deadline_at is distinct from (e.payload->>'dueAt')::timestamptz
      or (e.event_type='task.deadline_soon' and t.deadline_at<=now()) then return null; end if;
    if t.created_by<>p_user_id and a.id is null and not exists(
      select 1 from public.work_task_participants p where p.task_id=t.id and p.user_id=p_user_id and p.ended_at is null
    ) then return null; end if;
    return true;
  end if;
  if not v_related then return null; end if;
  if e.event_type in('comment.created','comment.edited')
    and coalesce(e.payload->'after'->'mentionedUserIds'@>jsonb_build_array(p_user_id),false) then return null; end if;
  v_mandatory:=(e.event_type='task.created' and a.id is not null and a.ended_at is null and a.acknowledged_at is null)
    or (e.event_type='assignment.transferred' and e.payload->>'toUserId'=p_user_id::text and a.id is not null and a.ended_at is null and a.acknowledged_at is null)
    or (e.event_type='assignment.co_assignees_added' and coalesce(e.payload->'userIds'@>jsonb_build_array(p_user_id),false) and a.id is not null and a.ended_at is null and a.acknowledged_at is null)
    or (e.event_type='task.review_submitted' and t.status='awaiting_review' and t.reviewer_user_id=p_user_id
      and (app_private.has_permission(p_user_id,'work.task.review','assigned','*')
        or app_private.has_permission(p_user_id,'work.task.review',s.scope_type,s.scope_id)))
    or (e.event_type='task.changes_requested' and a.id is not null and a.acknowledged_at is not null and t.status='changes_requested')
    or e.event_type like 'security.%';
  v_mandatory:=coalesce(v_mandatory,false);
  if e.actor_user_id=p_user_id and not v_mandatory then return null; end if;
  return v_mandatory;
end $$;
revoke all on function app_private.work_notification_mandatory(uuid,uuid) from public,anon,authenticated;

create or replace function app_private.work_process_notifications(p_limit integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare o app_private.work_notification_outbox%rowtype; e public.work_task_events%rowtype; t public.work_tasks%rowtype;
  v_user uuid; v_mandatory boolean; v_reason text; v_delivery uuid; v_notification uuid; v_push uuid; v_url text; v_comment text;
  v_count integer:=0; v_failed integer:=0; v_reminders integer; v_subscriptions uuid[]; v_content jsonb; v_rollout timestamptz;
begin
  perform app_private.work_require_notification_worker();
  select rollout_started_at into v_rollout from app_private.work_notification_settings where singleton;
  if v_rollout is not null then
    update app_private.work_notification_outbox set dead_at=now(),last_error='pre_rollout_backlog'
      where processed_at is null and dead_at is null and created_at<v_rollout;
  end if;
  if not (select enabled from app_private.work_notification_settings where singleton) then return jsonb_build_object('enabled',false,'processed',0); end if;
  v_reminders:=app_private.work_enqueue_reminders(p_limit);
  for o in select * from app_private.work_notification_outbox where processed_at is null and dead_at is null and available_at<=now()
    order by available_at,id limit least(50,greatest(1,coalesce(p_limit,20))) for update skip locked
  loop
    begin
      select * into strict e from public.work_task_events where id=o.event_id;
      select * into t from public.work_tasks where id=o.task_id for update skip locked;
      if not found then continue; end if;
      v_content:=app_private.work_notification_content(e.id);
      v_comment:=case when e.event_type like 'comment.%' then coalesce(e.payload->>'commentId',e.payload->'after'->>'id') end;
      v_url:='/work/tasks/'||t.task_code||case when v_comment is not null then '?comment='||v_comment else '' end;
      for v_user in
        select t.created_by union select user_id from public.work_task_assignments where task_id=t.id and (ended_at is null or (t.status='completed' and state='completed') or (t.status='cancelled' and state='cancelled'))
        union select user_id from public.work_task_participants where task_id=t.id and ended_at is null
        union select t.reviewer_user_id where t.reviewer_user_id is not null
        union select x::uuid from jsonb_array_elements_text(case when e.event_type='comment.mentioned' then e.payload->'recipientUserIds' else '[]'::jsonb end) x
        union select e.actor_user_id where e.event_type='assignment.transferred'
        union select app_private.resolve_strict_direct_manager((e.payload->>'userId')::uuid) where e.event_type='assignment.ack_overdue'
      loop
        if v_user is null then continue; end if;
        v_mandatory:=app_private.work_notification_mandatory(e.id,v_user); v_reason:=null;
        if v_mandatory is null then v_reason:='ineligible';
        elsif not v_mandatory and exists(select 1 from public.work_task_notification_preferences where task_id=t.id and user_id=v_user and not notifications_enabled) then v_reason:='muted'; end if;
        insert into app_private.work_notification_deliveries(outbox_id,user_id,channel,status,delivery_key,mandatory,last_error)
          values(o.id,v_user,'in_app',case when v_reason is null then 'pending' else 'suppressed' end,e.id||':'||v_user||':in_app',coalesce(v_mandatory,false),v_reason)
          on conflict(outbox_id,user_id,channel) do nothing returning id into v_delivery;
        if v_delivery is null or v_reason is not null then continue; end if;
        insert into public.notifications(user_id,title,message,body,module,category,source_type,source_id,entity_type,entity_id,link,action_url,priority,push_enabled,metadata,work_delivery_id)
          values(v_user::text,v_content->>'title',v_content->>'message',v_content->>'message','work','work','work_task',t.id::text,'work_task',t.id,v_url,'/#'||v_url,
            case when t.priority='urgent' then 'urgent' else 'normal' end,false,
            (v_content->'metadata')||jsonb_strip_nulls(jsonb_build_object('commentId',v_comment,'mandatory',v_mandatory)),v_delivery)
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
