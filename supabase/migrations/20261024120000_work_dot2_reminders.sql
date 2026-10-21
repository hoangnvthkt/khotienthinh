-- Vioo Work · Đợt 2 PR-8: nhắc qua thông báo trong app + web push (chưa có kênh Zalo).
--   1) Nhắc chốt kỳ: cron 15 phút gọi app_private.work_send_close_reminders(). Mỗi phạm vi như bản tin PR-7 (toàn công ty ⇒ BLĐ;
--      đơn vị có trưởng + có người ⇒ trưởng đơn vị), lịch hiệu lực riêng → đơn vị cha gần nhất → công ty (như work_period_status_v1).
--      Giờ chốt của kỳ đang chạy (app_private.work_close_due): 'due' trong 1 ngày kể từ giờ chốt, 'late' trong ngày kế tiếp — chỉ khi kỳ
--      chưa có bản chốt 'closed'. Mỗi (phạm vi, kỳ, loại) đúng một lần (app_private.work_close_reminder_sends); không gửi bù kỳ cũ;
--      kỳ không có số (như bản tin) thì không gửi.
--   2) Nhắc chưa nhận việc lúc 08:00 (work-stale-reminders): phân công giao quá 24 giờ chưa nhận, việc còn 'pending_acknowledgement',
--      KHÔNG có hạn xác nhận (có hạn thì work_enqueue_reminders lo như cũ) ⇒ 'assignment.ack_overdue' (payload không có dueAt).
--      Người nhận như cũ: người được giao + người tạo + quản lý trực tiếp (resolve_strict_direct_manager). Mỗi phân công tối đa 1 tin / ngày.
--   3) Nhắc chờ duyệt lâu lúc 08:00: việc 'awaiting_review' có người duyệt, lần nộp mới nhất quá 24 giờ ⇒ 'task.review_waiting'
--      (mới), chỉ người duyệt nhận, tin bắt buộc (không bị tắt theo việc). Mỗi việc tối đa 1 tin / ngày.
--   Hàm thay (chép nguyên thân bản mới nhất ở 20261022090000_work_dot1_notify_quick.sql, khớp định nghĩa đang chạy trên Cloud, rồi thêm nhánh):
--   work_notification_content, work_notification_mandatory, work_enqueue_stale_reminders. work_process_notifications KHÔNG đổi —
--   vòng người nhận đã gồm người duyệt (t.reviewer_user_id) và quản lý trực tiếp cho ack_overdue; lọc đúng người ở work_notification_mandatory.
--   Không có CHECK giới hạn event_type (work_task_events chỉ kiểm độ dài 3–100; outbox / notifications không kiểm).

-- ── 1. Câu thông báo: thêm 'task.review_waiting' + ack_overdue không có hạn xác nhận ──────────────────
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
  v_hours integer;
  v_wait text;
begin
  select * into strict e from public.work_task_events where id=p_event_id;
  select * into strict t from public.work_tasks where id=e.task_id;
  select regexp_replace(btrim(u.name),'[[:space:]]+',' ','g') into v_actor_name
    from public.users u where u.id=e.actor_user_id;
  v_actor_name:=coalesce(nullif(v_actor_name,''),'Hệ thống');
  v_task_title:=left(regexp_replace(btrim(t.title),'[[:space:]]+',' ','g'),140);
  -- PR-8: số giờ đã chờ (nhắc chưa nhận việc / chờ duyệt lâu) — dưới 2 ngày ghi giờ, từ 2 ngày ghi ngày.
  v_hours:=case when e.payload->>'hours' ~ '^[0-9]+$' then (e.payload->>'hours')::integer end;
  v_wait:=case when v_hours is null then null when v_hours>=48 then (v_hours/24)||' ngày' else v_hours||' giờ' end;

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
    when 'task.review_waiting' then 'Kết quả chờ bạn duyệt'
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
    when e.event_type='assignment.ack_overdue' and e.payload->>'dueAt' is null then
      -- PR-8: nhắc 08:00 khi không có hạn xác nhận (giao quá 24 giờ).
      'Chưa nhận việc: “'||v_task_title||'” · giao '||
      coalesce(to_char((e.payload->>'assignedAt')::timestamptz at time zone 'Asia/Ho_Chi_Minh','HH24:MI DD/MM'),'?')||
      ' · đã '||coalesce(v_wait,'hơn 24 giờ')
    when e.event_type='task.review_waiting' then
      'Kết quả “'||v_task_title||'” đã chờ bạn duyệt '||coalesce(v_wait,'hơn 24 giờ')||'. Bấm để duyệt hoặc yêu cầu chỉnh sửa.'
    when e.event_type in ('task.deadline_soon','task.overdue','assignment.ack_overdue') then
      v_action||': “'||v_task_title||'” · '||
      to_char((e.payload->>'dueAt')::timestamptz at time zone 'Asia/Ho_Chi_Minh','HH24:MI DD/MM/YYYY')
    else v_actor_name||' '||v_phrase||' “'||v_task_title||'”.'
  end;

  return jsonb_build_object(
    'title',left(t.task_code||' · '||v_action
      ||case when e.event_type='task.review_waiting' and v_wait is not null then ' · '||v_wait else '' end,100),
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
revoke all on function app_private.work_notification_content(uuid) from public, anon, authenticated;

-- ── 2. Ai nhận (bắt buộc / thường / không): ack_overdue không hạn + task.review_waiting ─────────────────
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
    if e.payload ? 'dueAt' then
      if not exists(select 1 from public.work_task_assignments x where x.id=(e.payload->>'assignmentId')::uuid and x.task_id=t.id
        and x.ended_at is null and x.acknowledged_at is null and x.acknowledgement_due_at=(e.payload->>'dueAt')::timestamptz and x.acknowledgement_due_at<=now()) then return null; end if;
    else
      -- PR-8: nhắc 08:00 khi không có hạn xác nhận — chỉ còn hiệu lực khi phân công vẫn chưa nhận, vẫn không có hạn, việc còn chờ nhận.
      if t.status<>'pending_acknowledgement' or not exists(select 1 from public.work_task_assignments x where x.id=(e.payload->>'assignmentId')::uuid and x.task_id=t.id
        and x.ended_at is null and x.acknowledged_at is null and x.acknowledgement_due_at is null) then return null; end if;
    end if;
    v_target:=p_user_id=(e.payload->>'userId')::uuid;
    if not(v_target or t.created_by=p_user_id or coalesce(p_user_id=app_private.resolve_strict_direct_manager((e.payload->>'userId')::uuid),false)) then return null; end if;
    return true;
  elsif e.event_type='task.review_waiting' then
    -- PR-8: chờ duyệt lâu — chỉ người duyệt hiện tại, khi việc vẫn chờ duyệt đúng lần nộp đã nhắc.
    if t.status<>'awaiting_review' or t.reviewer_user_id is distinct from p_user_id
      or p_user_id is distinct from (e.payload->>'reviewerUserId')::uuid
      or not exists(select 1 from public.work_task_submissions x where x.id=(e.payload->>'submissionId')::uuid and x.task_id=t.id
        and x.status='pending_review') then return null; end if;
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
revoke all on function app_private.work_notification_mandatory(uuid, uuid) from public, anon, authenticated;

-- ── 3. Nhắc 08:00: lâu chưa cập nhật (Đợt 1, giữ nguyên) + chưa nhận việc 24 giờ + chờ duyệt 24 giờ ────────
create or replace function app_private.work_enqueue_stale_reminders(p_limit integer default 200) returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; v_key text; v_id uuid; v_count integer := 0; v_day text := ((now() at time zone 'Asia/Ho_Chi_Minh')::date)::text;
  v_limit integer := least(500, greatest(1, coalesce(p_limit, 200)));
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

  -- PR-8 · Chưa nhận việc: giao quá 24 giờ, không có hạn xác nhận (có hạn ⇒ work_enqueue_reminders nhắc theo hạn).
  -- Payload như work_enqueue_reminders (assignmentId, userId) nhưng không có dueAt; mỗi phân công tối đa một tin / ngày (giờ VN).
  for r in
    select a.id as assignment_id, a.task_id, a.user_id, a.assigned_at
    from public.work_task_assignments a
    join public.work_tasks t on t.id = a.task_id
    where t.status = 'pending_acknowledgement' and a.ended_at is null and a.acknowledged_at is null
      and a.acknowledgement_due_at is null and a.assigned_at < now() - interval '24 hours'
    order by a.assigned_at, a.id
    limit v_limit
  loop
    v_key := 'assignment.ack_overdue:' || r.task_id || ':' || r.assignment_id || ':no_due:' || v_day;
    insert into app_private.work_reminder_keys values (v_key, now()) on conflict do nothing;
    if not found then continue; end if;
    insert into public.work_task_events(task_id, event_type, source, payload)
      values (r.task_id, 'assignment.ack_overdue', 'system',
        jsonb_build_object('assignmentId', r.assignment_id, 'userId', r.user_id, 'assignedAt', r.assigned_at,
          'hours', floor(extract(epoch from now() - r.assigned_at) / 3600)::int))
      returning id into v_id;
    insert into app_private.work_notification_outbox(event_id, task_id, event_type, payload)
      values (v_id, r.task_id, 'assignment.ack_overdue', jsonb_build_object('taskId', r.task_id));
    v_count := v_count + 1;
  end loop;

  -- PR-8 · Chờ duyệt lâu: việc chờ duyệt có người duyệt, lần nộp mới nhất quá 24 giờ. Mỗi việc tối đa một tin / ngày (giờ VN).
  for r in
    select t.id as task_id, t.reviewer_user_id, s.id as submission_id, s.submitted_at
    from public.work_tasks t
    cross join lateral (select x.id, x.submitted_at from public.work_task_submissions x
      where x.task_id = t.id order by x.iteration desc limit 1) s
    where t.status = 'awaiting_review' and t.reviewer_user_id is not null and s.submitted_at < now() - interval '24 hours'
    order by s.submitted_at, t.id
    limit v_limit
  loop
    v_key := 'task.review_waiting:' || r.task_id || ':' || v_day;
    insert into app_private.work_reminder_keys values (v_key, now()) on conflict do nothing;
    if not found then continue; end if;
    insert into public.work_task_events(task_id, event_type, source, payload)
      values (r.task_id, 'task.review_waiting', 'system',
        jsonb_build_object('reviewerUserId', r.reviewer_user_id, 'submissionId', r.submission_id, 'submittedAt', r.submitted_at,
          'hours', floor(extract(epoch from now() - r.submitted_at) / 3600)::int))
      returning id into v_id;
    insert into app_private.work_notification_outbox(event_id, task_id, event_type, payload)
      values (v_id, r.task_id, 'task.review_waiting', jsonb_build_object('taskId', r.task_id));
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke all on function app_private.work_enqueue_stale_reminders(integer) from public, anon, authenticated;

-- ── 4. Nhắc chốt kỳ ─────────────────────────────────────────────────────────────────────────────────
create table app_private.work_close_reminder_sends (
  scope_key text not null check (scope_key = 'company' or scope_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  period_from date not null,
  period_to date not null,
  kind text not null check (kind in ('due', 'late')),
  sent_at timestamptz not null default now(),
  recipients integer not null default 0 check (recipients >= 0),
  primary key (scope_key, period_from, period_to, kind),
  check (period_to >= period_from)
);
alter table app_private.work_close_reminder_sends enable row level security;
revoke all on app_private.work_close_reminder_sends from public, anon, authenticated;

-- Lần chốt gần nhất ≤ p_now theo lịch (giờ VN) và kỳ ĐANG chốt (kỳ chứa ngày chốt).
--   week   : kỳ = tuần T2–CN chứa ngày close_dow; giờ chốt = ngày close_dow của tuần đó lúc close_time. "Tuần 43 · 19–25/10".
--   2weeks : chỉ tuần ISO chẵn; kỳ = tuần lẻ liền trước + tuần chẵn đó. "05/10 – 18/10".
--   month  : kỳ = tháng; giờ chốt = ngày close_dow CUỐI CÙNG của tháng lúc close_time. "Tháng 10/2026".
create function app_private.work_close_due(p_setting public.work_period_settings, p_now timestamptz)
returns table(due_at timestamptz, period_from date, period_to date, label text)
language plpgsql stable set search_path = '' as $$
declare
  v_local timestamp := p_now at time zone 'Asia/Ho_Chi_Minh';
  v_today date := (p_now at time zone 'Asia/Ho_Chi_Minh')::date;
  v_cadence text := coalesce(p_setting.cadence, 'week');
  v_dow integer := coalesce(p_setting.close_dow, 6);
  v_time time := coalesce(p_setting.close_time, '17:00'::time);
  v_iso integer := case when coalesce(p_setting.close_dow, 6) = 0 then 7 else coalesce(p_setting.close_dow, 6) end;
  v_day date; v_month date; v_last date; v_ws date;
begin
  if p_now is null then return; end if;
  if v_cadence = 'month' then
    v_month := date_trunc('month', v_local)::date;
    v_last := (v_month + interval '1 month')::date - 1;
    v_day := v_last - (extract(dow from v_last)::int - v_dow + 7) % 7;
    if v_day + v_time > v_local then
      v_month := (v_month - interval '1 month')::date;
      v_last := (v_month + interval '1 month')::date - 1;
      v_day := v_last - (extract(dow from v_last)::int - v_dow + 7) % 7;
    end if;
    due_at := (v_day + v_time) at time zone 'Asia/Ho_Chi_Minh';
    period_from := v_month;
    period_to := v_last;
    label := 'Tháng ' || extract(month from v_month)::int || '/' || extract(year from v_month)::int;
    return next;
    return;
  end if;
  v_day := v_today - (extract(isodow from v_today)::int - 1) + (v_iso - 1);
  if v_day + v_time > v_local then v_day := v_day - 7; end if;
  if v_cadence = '2weeks' then
    -- Tuần ISO chẵn gần nhất (năm 53 tuần: 52 → 53 → 1 → 2 cách nhau 3 tuần).
    while extract(week from v_day)::int % 2 <> 0 loop v_day := v_day - 7; end loop;
  end if;
  v_ws := v_day - (extract(isodow from v_day)::int - 1);
  due_at := (v_day + v_time) at time zone 'Asia/Ho_Chi_Minh';
  if v_cadence = '2weeks' then
    period_from := v_ws - 7;
    period_to := v_ws + 6;
    label := to_char(period_from::timestamp, 'DD/MM') || ' – ' || to_char(period_to::timestamp, 'DD/MM');
  else
    period_from := v_ws;
    period_to := v_ws + 6;
    label := 'Tuần ' || extract(week from period_from)::int || ' · ' || to_char(period_from::timestamp, 'DD') || '–' || to_char(period_to::timestamp, 'DD/MM');
  end if;
  return next;
end $$;
revoke all on function app_private.work_close_due(public.work_period_settings, timestamptz) from public, anon, authenticated;

-- Gửi nhắc chốt tới hạn. Trả số thông báo đã chèn. Cron 15 phút; lượt trước chưa xong thì bỏ qua.
create function app_private.work_send_close_reminders(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_today date := (coalesce(p_now, now()) at time zone 'Asia/Ho_Chi_Minh')::date;
  v_zero constant uuid := '00000000-0000-0000-0000-000000000000';
  v_company public.work_period_settings; v_setting public.work_period_settings;
  r record; p record; v_kind text; v_digest jsonb; v_missing integer; v_link text; v_title text; v_msg text;
  v_n integer; v_count integer := 0;
begin
  if not coalesce((select s.enabled from app_private.work_notification_settings s where s.singleton), false) then return 0; end if;
  if not pg_try_advisory_xact_lock(hashtext('cron:work_close_reminders')) then return 0; end if;

  select * into v_company from public.work_period_settings s where s.org_unit_id is null;
  if v_company.id is null then
    v_company.cadence := 'week'; v_company.close_dow := 6; v_company.close_time := '17:00';
  end if;

  -- Phạm vi như bản tin PR-7: toàn công ty + đơn vị có trưởng (đang giữ chức) và có người.
  for r in
    select null::uuid as unit_id, 'company'::text as scope_key, 'Toàn công ty'::text as scope_name, 0 as ord
    union all
    select ou.id, ou.id::text, ou.name, 1
    from public.org_units ou
    where coalesce(ou.is_active, true) and ou.manager_slot_id is not null
      and exists (select 1 from public.hrm_employee_slot_assignments sa join public.employees e on e.id = sa.employee_id
        where sa.slot_id = ou.manager_slot_id and sa.assignment_type in ('PRIMARY', 'ACTING') and sa.status = 'ACTIVE'
          and sa.effective_from <= v_today and (sa.effective_to is null or sa.effective_to >= v_today) and e.user_id is not null)
      and exists (select 1 from public.employees e where e.org_unit_id = ou.id and coalesce(e.status, '') <> 'Đã nghỉ việc')
    order by 4, 3
  loop
    begin
      -- Lịch hiệu lực: riêng → đơn vị cha gần nhất có cài → công ty.
      v_setting := null;
      if r.unit_id is not null then
        with recursive up as (
          select ou.id, ou.parent_id, 0 as depth from public.org_units ou where ou.id = r.unit_id
          union all
          select x.id, x.parent_id, up.depth + 1 from public.org_units x join up on x.id = up.parent_id where up.depth < 30
        ) select s.* into v_setting from up join public.work_period_settings s on s.org_unit_id = up.id order by up.depth limit 1;
      end if;
      if v_setting.id is null then v_setting := v_company; end if;

      select * into p from app_private.work_close_due(v_setting, v_now);
      if p.due_at is null then continue; end if;
      -- 'due' trong 1 ngày kể từ giờ chốt, 'late' trong ngày kế tiếp; ngoài đó không gửi (không gửi bù khi mới bật / lỡ lượt).
      v_kind := case when v_now >= p.due_at and v_now < p.due_at + interval '1 day' then 'due'
        when v_now >= p.due_at + interval '1 day' and v_now < p.due_at + interval '2 days' then 'late' end;
      if v_kind is null then continue; end if;
      -- Kỳ đã chốt thì thôi (cả 'due' lẫn 'late').
      if exists (select 1 from public.work_period_closes c
          where coalesce(c.org_unit_id, v_zero) = coalesce(r.unit_id, v_zero) and c.period_from = p.period_from
            and c.period_to = p.period_to and c.status = 'closed') then
        continue;
      end if;
      insert into app_private.work_close_reminder_sends(scope_key, period_from, period_to, kind, recipients)
        values (r.scope_key, p.period_from, p.period_to, v_kind, 0) on conflict do nothing;
      if not found then continue; end if;

      v_digest := app_private.work_period_digest(r.unit_id, p.period_from, p.period_to);
      -- Kỳ không có số nào thì không nhắc (vẫn ghi đã xử lý, 0 người nhận) — như bản tin.
      if (v_digest->>'due')::int = 0 and (v_digest->>'overdue')::int = 0 and (v_digest->>'stale')::int = 0
        and (v_digest->'directives'->>'open')::int = 0 and (v_digest->'directives'->>'done')::int = 0
        and (v_digest->'goals'->>'total')::int = 0 then
        continue;
      end if;
      -- Mục tiêu chưa đạt chưa có giải pháp (chốt sẽ bị chặn WORK_GOAL_SOLUTION_REQUIRED).
      select count(*) into v_missing from public.work_goals g
        where g.deleted_at is null and coalesce(g.org_unit_id, v_zero) = coalesce(r.unit_id, v_zero)
          and g.period_start <= p.period_to and app_private.work_goal_period_end(g.period_kind, g.period_start) >= p.period_from
          and nullif(btrim(coalesce(g.solution, '')), '') is null
          and app_private.work_goal_json(g.id)->>'status' = 'missed';

      v_link := case when r.unit_id is null
        then '/work/my?space=company&from=' || p.period_from || '&to=' || p.period_to
        else '/work/my?space=team&unit=' || r.unit_id || '&from=' || p.period_from || '&to=' || p.period_to end;
      v_title := case v_kind when 'due' then 'Đến giờ chốt ' else 'Chưa chốt ' end || p.label || ' · ' || r.scope_name;
      v_msg := case when (v_digest->>'due')::int > 0
          then format('Đúng hạn %s%% (%s/%s việc đến hạn)', v_digest->>'rate', v_digest->>'ontime', v_digest->>'due')
          else 'Chưa có việc đến hạn trong kỳ' end
        || format(' · Quá hạn: %s việc', v_digest->>'overdue')
        || case when v_missing > 0 then E'\n' || format('%s mục tiêu chưa đạt cần ghi giải pháp trước khi chốt', v_missing) else '' end;

      insert into public.notifications(user_id, type, category, module, title, message, body, severity, icon, link, action_url,
          source_type, source_id, entity_type, entity_id, priority, push_enabled, metadata, delivery_reason, delivery_mode)
        select x.user_id::text, case v_kind when 'due' then 'info' else 'warning' end, 'work', 'work', v_title, v_msg, v_msg,
          case v_kind when 'due' then 'info' else 'warning' end, case v_kind when 'due' then '🔒' else '⏰' end, v_link, '/#' || v_link,
          'work_close_reminder', r.scope_key || ':' || p.period_from || ':' || p.period_to || ':' || v_kind, 'work_close_reminder', r.unit_id,
          'normal', true,
          jsonb_build_object('eventType', 'work.period_close_reminder', 'kind', v_kind, 'scope', r.scope_key, 'orgUnitId', r.unit_id,
            'from', p.period_from, 'to', p.period_to, 'label', p.label, 'dueAt', p.due_at, 'goalsMissingSolution', v_missing),
          'system', 'instant'
        from (
          select u.id as user_id from public.users u
          where r.unit_id is null and u.is_active and u.account_status = 'ACTIVE'
            and app_private.has_permission(u.id, 'work.module.access', 'global', '*')
            and app_private.has_permission(u.id, 'work.task.view_scope', 'global', '*')
          union
          select u.id from public.org_units ou
          join public.hrm_employee_slot_assignments sa on sa.slot_id = ou.manager_slot_id
          join public.employees e on e.id = sa.employee_id
          join public.users u on u.id = e.user_id
          where r.unit_id is not null and ou.id = r.unit_id
            and sa.assignment_type in ('PRIMARY', 'ACTING') and sa.status = 'ACTIVE'
            and sa.effective_from <= v_today and (sa.effective_to is null or sa.effective_to >= v_today)
            and u.is_active and u.account_status = 'ACTIVE'
            and app_private.has_permission(u.id, 'work.module.access', 'global', '*')
        ) x;
      get diagnostics v_n = row_count;
      update app_private.work_close_reminder_sends set recipients = v_n, sent_at = now()
        where scope_key = r.scope_key and period_from = p.period_from and period_to = p.period_to and kind = v_kind;
      v_count := v_count + v_n;
    exception when others then
      -- Một phạm vi lỗi không chặn phạm vi khác; dòng đã gửi cũng hoàn tác ⇒ lượt sau (còn trong cửa sổ) thử lại.
      raise warning 'work_send_close_reminders %: % %', r.scope_key, sqlstate, sqlerrm;
    end;
  end loop;
  return v_count;
end $$;
revoke all on function app_private.work_send_close_reminders(timestamptz) from public, anon, authenticated;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'work-close-reminders') then perform cron.unschedule('work-close-reminders'); end if;
  perform cron.schedule('work-close-reminders', '*/15 * * * *', 'select app_private.work_send_close_reminders();');
end $$;
