-- Vioo Work · Đợt 1 PR-2 (chủ SP duyệt 20/10/2026): bật thông báo + nhắc lâu chưa cập nhật + dữ liệu cho giao nhanh / chi tiết việc.
-- Kế hoạch: docs/work/2026-10-20-ke-hoach-dot-1-giao-viec-ai.md (mục 6, PR-2; câu 2 và 4 mục 9).
--   1) Câu thông báo cho sự kiện Đợt 1 (cập nhật tiến độ, việc giao miệng, chỉ đạo, lâu chưa cập nhật).
--   2) Ai nhận: việc giao miệng → bắt buộc báo người được nêu là người giao; nhắc lâu chưa cập nhật → người làm, quá 3 ngày thêm trưởng đơn vị.
--   3) Nhắc 08:00 thứ 2 – thứ 7 (giờ VN) việc A/B quá 2 ngày chưa cập nhật (pg_cron work-stale-reminders, 01:00 UTC).
--   4) Danh sách việc trả thêm last_progress_at; RPC list_work_task_updates_v1 cho dòng cập nhật.
--   5) BẬT thông báo Vioo Work; rollout_started_at = lúc áp → hàng chờ tồn trước đó bị bỏ qua (pre_rollout_backlog), không gửi tin cũ.

-- ── Trưởng đơn vị gần nhất của một người (đơn vị của người đó, không có thì đơn vị cha gần nhất) ──────────
create function app_private.work_heads_of_user(p_member uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  with recursive up as (
    select ou.id, ou.parent_id, ou.manager_slot_id, 0 as depth from public.org_units ou where ou.id = app_private.work_user_org_unit(p_member)
    union all
    select p.id, p.parent_id, p.manager_slot_id, up.depth + 1 from public.org_units p join up on p.id = up.parent_id where up.depth < 10
  ), heads as (
    select e.user_id, up.depth from up
    join public.hrm_employee_slot_assignments sa on sa.slot_id = up.manager_slot_id
    join public.employees e on e.id = sa.employee_id
    join public.users u on u.id = e.user_id
    where e.user_id <> p_member and u.is_active and u.account_status = 'ACTIVE'
      and sa.assignment_type in ('PRIMARY', 'ACTING') and sa.status = 'ACTIVE'
      and sa.effective_from <= current_date and (sa.effective_to is null or sa.effective_to >= current_date)
  )
  select distinct user_id from heads where depth = (select min(depth) from heads);
$$;
revoke all on function app_private.work_heads_of_user(uuid) from public, anon, authenticated;

-- Lần chuyển động gần nhất của một việc, chỉ khi người gọi xem được việc (dùng trong danh sách chạy bằng quyền người gọi).
create function app_private.work_task_last_progress_for_actor(p_task_id uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select case when app_private.work_task_actor_can_view(p_task_id) then app_private.work_task_last_progress_at(p_task_id) end;
$$;
revoke all on function app_private.work_task_last_progress_for_actor(uuid) from public, anon, authenticated;
grant execute on function app_private.work_task_last_progress_for_actor(uuid) to authenticated;

-- ── 1–2. Câu thông báo + người nhận ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_private.work_notification_content(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    when 'task.progress_reported' then 'Cập nhật tiến độ'
    when 'task.claim_recorded' then 'Chờ bạn xác nhận'
    when 'task.claim_confirmed' then 'Đã xác nhận giao việc'
    when 'task.claim_rejected' then 'Không xác nhận giao việc'
    when 'task.directive_recorded' then 'Chỉ đạo mới'
    when 'task.stale_reminder' then 'Lâu chưa cập nhật'
    when 'task.stale_escalated' then 'Lâu chưa cập nhật'
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
    when 'task.claim_confirmed' then 'đã xác nhận giao'
    when 'task.claim_rejected' then 'không xác nhận đã giao'
    when 'task.directive_recorded' then 'đã ghi chỉ đạo'
    else 'đã cập nhật'
  end;

  v_message:=case
    when e.event_type='task.progress_reported' then
      v_actor_name||' cập nhật '||coalesce(e.payload->>'after','?')||'% “'||v_task_title||'”'
      ||case when coalesce((e.payload->>'blocked')::boolean,false) then ' · có vướng' else '' end||'.'
    when e.event_type='task.claim_recorded' then
      v_actor_name||' ghi việc bạn giao trực tiếp: “'||v_task_title||'”. Bấm để xác nhận.'
    when e.event_type in ('task.stale_reminder','task.stale_escalated') then
      'Lâu chưa cập nhật: “'||v_task_title||'” · '||coalesce(e.payload->>'days','2')||' ngày'
      ||case when e.event_type='task.stale_escalated' then ' · đã báo trưởng đơn vị' else '' end
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
end $function$;

CREATE OR REPLACE FUNCTION app_private.work_notification_mandatory(p_event_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  elsif e.event_type in ('task.stale_reminder','task.stale_escalated') then
    -- Nhắc lâu chưa cập nhật (Đợt 1): người làm; quá 3 ngày thì thêm trưởng đơn vị theo sơ đồ. Đã có cập nhật mới thì thôi.
    if t.status not in ('not_started','in_progress','blocked','changes_requested')
      or app_private.work_task_last_progress_at(t.id) >= now() - interval '48 hours' then return null; end if;
    if a.id is not null and a.ended_at is null then return true; end if;
    if e.event_type = 'task.stale_escalated' and exists (select 1 from public.work_task_assignments x
        where x.task_id = t.id and x.ended_at is null and p_user_id in (select h from app_private.work_heads_of_user(x.user_id) h)) then
      return true;
    end if;
    return null;
  elsif e.event_type = 'task.claim_recorded' then
    -- Việc giao miệng: chỉ người được nêu là người giao, khi còn chờ xác nhận.
    if exists (select 1 from public.work_task_origins o where o.task_id = t.id and o.claimed_giver_user_id = p_user_id and o.claim_status = 'pending') then
      return true;
    end if;
    return null;
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
end $function$;

CREATE OR REPLACE FUNCTION app_private.work_process_notifications(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        union select h from public.work_task_assignments x cross join lateral app_private.work_heads_of_user(x.user_id) h
          where e.event_type='task.stale_escalated' and x.task_id=t.id and x.ended_at is null
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
end $function$;

CREATE OR REPLACE FUNCTION app_private.work_page_with_progress(p_page jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare v_items jsonb;
begin
  select coalesce(jsonb_agg(item.value || jsonb_build_object('progress_percent', task.progress_percent,
    'last_progress_at', app_private.work_task_last_progress_for_actor(task.id))
    order by item.ordinality), '[]'::jsonb) into v_items
  from jsonb_array_elements(coalesce(p_page->'items', '[]'::jsonb)) with ordinality item(value, ordinality)
  join public.work_tasks task on task.id = (item.value->>'id')::uuid;
  return jsonb_set(p_page, '{items}', v_items, true);
end $function$;

-- ── 3. Nhắc lâu chưa cập nhật (A/B, quá 48 giờ) — mỗi việc tối đa một tin / ngày (giờ VN) ─────────────────
create function app_private.work_enqueue_stale_reminders(p_limit integer default 200) returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; v_key text; v_id uuid; v_count integer := 0; v_day text := ((now() at time zone 'Asia/Ho_Chi_Minh')::date)::text;
begin
  if not coalesce((select enabled from app_private.work_notification_settings where singleton), false) then return 0; end if;
  for r in
    select q.* from (
      select t.id as task_id, app_private.work_task_last_progress_at(t.id) as last_at
      from public.work_tasks t
      where t.status in ('not_started', 'in_progress', 'blocked', 'changes_requested') and t.priority in ('urgent', 'important')
    ) q
    where q.last_at < now() - interval '48 hours'
    order by q.last_at, q.task_id
    limit least(500, greatest(1, coalesce(p_limit, 200)))
  loop
    v_key := case when r.last_at < now() - interval '72 hours' then 'task.stale_escalated' else 'task.stale_reminder' end
      || ':' || r.task_id || ':' || v_day;
    insert into app_private.work_reminder_keys values (v_key, now()) on conflict do nothing;
    if not found then continue; end if;
    insert into public.work_task_events(task_id, event_type, source, payload)
      values (r.task_id, split_part(v_key, ':', 1), 'system',
        jsonb_build_object('lastProgressAt', r.last_at, 'days', floor(extract(epoch from now() - r.last_at) / 86400)::int))
      returning id into v_id;
    insert into app_private.work_notification_outbox(event_id, task_id, event_type, payload)
      values (v_id, r.task_id, split_part(v_key, ':', 1), jsonb_build_object('taskId', r.task_id));
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke all on function app_private.work_enqueue_stale_reminders(integer) from public, anon, authenticated;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'work-stale-reminders') then perform cron.unschedule('work-stale-reminders'); end if;
  perform cron.schedule('work-stale-reminders', '0 1 * * 1-6', 'select app_private.work_enqueue_stale_reminders();');
end $$;

-- ── 4. Dòng cập nhật của một việc (mới nhất trước, phân trang theo thời điểm) ───────────────────────────
create function public.list_work_task_updates_v1(p_task_id uuid, p_before timestamptz default null, p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); n integer := least(50, greatest(1, coalesce(p_limit, 20))); v_rows jsonb;
begin
  if v_actor is null or not app_private.work_task_actor_can_view(p_task_id) then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(x order by x->>'at' desc, x->>'id' desc), '[]'::jsonb) into v_rows from (
    select jsonb_strip_nulls(jsonb_build_object('id', u.id, 'at', u.created_at, 'authorId', u.author_user_id, 'authorName', au.name,
      'done', u.done_text, 'doing', u.doing_text, 'next', u.next_text, 'blocked', u.blocked_text,
      'progressBefore', u.progress_before, 'progressAfter', u.progress_after, 'ai', u.ai_run_id is not null,
      'files', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.file_name, 'mime', f.mime_type, 'evidenceType', f.evidence_type) order by f.created_at)
        from public.work_task_attachments f where f.id = any(u.attachment_ids) and f.task_id = u.task_id and f.deleted_at is null), '[]'::jsonb))) x
    from public.work_task_updates u join public.users au on au.id = u.author_user_id
    where u.task_id = p_task_id and (p_before is null or u.created_at < p_before)
    order by u.created_at desc, u.id desc limit n + 1
  ) s;
  return jsonb_build_object('items', (select coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb) from jsonb_array_elements(v_rows) with ordinality where ordinality <= n),
    'nextBefore', case when jsonb_array_length(v_rows) > n then v_rows->(n - 1)->'at' else null end);
end $$;
revoke all on function public.list_work_task_updates_v1(uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.list_work_task_updates_v1(uuid, timestamptz, integer) to authenticated;

-- ── 5. Bật thông báo Vioo Work (câu 4 mục 9). Hàng chờ tạo trước lúc này bị bỏ qua, không gửi tin cũ. ────
update app_private.work_notification_settings set enabled = true, rollout_started_at = now() where singleton;
