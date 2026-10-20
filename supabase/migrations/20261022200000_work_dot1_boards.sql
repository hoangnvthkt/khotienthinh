-- Vioo Work · Đợt 1 PR-4 (chủ SP 20/10/2026): Phòng tôi (trưởng đơn vị) + Toàn công ty + Sổ chỉ đạo (BLĐ).
--   work_board_access_v1   tab nào người xem thấy: đơn vị mình làm trưởng (sơ đồ tổ chức), xem toàn công ty, số việc chờ mình duyệt / xác nhận.
--   work_review_queue_v1   việc đã nộp chờ chính mình duyệt (lần nộp, kết quả tóm tắt) → Duyệt / Trả lại một chạm bằng lệnh review sẵn có.
--   work_directives_v1     Sổ chỉ đạo: việc chỉ đạo + việc giao miệng (Trễ / Đang làm / Chờ xác nhận / Xong tháng này), theo quyền:
--                          BLĐ (xem toàn công ty) thấy hết; trưởng đơn vị thấy việc người trong đơn vị; người giao thấy việc mình được nêu tên.
--   work_task_claim_decide_v2  người giao xác nhận việc giao miệng, có thể sửa hạn cùng lúc (một chạm).
--   work_tasks_overview_v1 thêm trạng thái 'unack' (chưa nhận việc) cho ô số Phòng tôi.

create function public.work_board_access_v1() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id();
begin
  if v_actor is null or not app_private.has_permission(v_actor, 'work.module.access', 'global', '*') then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'myUnits', coalesce((select jsonb_agg(jsonb_build_object('id', ou.id, 'code', ou.code, 'name', ou.name) order by ou.name)
      from public.org_units ou where ou.id in (select h from app_private.work_direct_headed_units(v_actor) h)), '[]'::jsonb),
    'company', app_private.has_permission(v_actor, 'work.task.view_scope', 'global', '*'),
    'reviewsWaitingMe', (select count(*) from public.work_tasks t where t.status = 'awaiting_review' and t.reviewer_user_id = v_actor),
    'claimsWaitingMe', (select count(*) from public.work_task_origins o join public.work_tasks t on t.id = o.task_id
      where o.claimed_giver_user_id = v_actor and o.claim_status = 'pending' and t.status not in ('cancelled', 'draft')));
end $$;

create function public.work_review_queue_v1() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id();
begin
  if v_actor is null or not app_private.has_permission(v_actor, 'work.module.access', 'global', '*') then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(x order by x->>'submittedAt') from (
    select jsonb_build_object('id', t.id, 'code', t.task_code, 'title', t.title, 'level', app_private.work_level(t.priority),
      'deadlineAt', t.deadline_at, 'lockVersion', t.lock_version, 'progressPercent', t.progress_percent,
      'assignees', coalesce((select jsonb_agg(u.name order by a.assigned_at) from public.work_task_assignments a join public.users u on u.id = a.user_id
        where a.task_id = t.id and a.ended_at is null), '[]'::jsonb),
      'iteration', s.iteration, 'submittedAt', s.submitted_at, 'result', left(coalesce(s.result_text, ''), 300),
      'files', (select count(*) from public.work_task_attachments f where f.task_id = t.id and f.deleted_at is null and f.attachment_kind in ('result', 'evidence'))) as x
    from public.work_tasks t
    left join lateral (select * from public.work_task_submissions s where s.task_id = t.id order by s.iteration desc limit 1) s on true
    where t.status = 'awaiting_review' and t.reviewer_user_id = v_actor
    limit 100) q), '[]'::jsonb);
end $$;

create function public.work_directives_v1(p_org_unit_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id(); v_global boolean; v_units uuid[];
  v_month timestamptz := date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh';
  v_active constant text[] := array['pending_acknowledgement', 'clarification_requested', 'not_started', 'in_progress', 'blocked', 'awaiting_review', 'changes_requested'];
begin
  if v_actor is null or not app_private.has_permission(v_actor, 'work.module.access', 'global', '*') then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  v_global := app_private.has_permission(v_actor, 'work.task.view_scope', 'global', '*');
  -- Đơn vị lọc: BLĐ chọn bất kỳ; trưởng đơn vị chỉ đơn vị mình (và đơn vị con).
  if p_org_unit_id is not null and not v_global and p_org_unit_id not in (select h from app_private.work_headed_units(v_actor) h) then
    raise exception 'WORK_BOARD_DENIED' using errcode = '42501';
  end if;
  with recursive tree as (
    select ou.id from public.org_units ou where p_org_unit_id is not null and ou.id = p_org_unit_id
    union select c.id from public.org_units c join tree on c.parent_id = tree.id where coalesce(c.is_active, true)
  ) select array_agg(id) into v_units from tree;

  return coalesce((select jsonb_agg(x order by x->>'bucket', x->>'deadlineAt') from (
    select jsonb_build_object('id', t.id, 'code', t.task_code, 'title', t.title, 'level', app_private.work_level(t.priority), 'status', t.status,
      'deadlineAt', t.deadline_at, 'progressPercent', t.progress_percent, 'completedAt', t.completed_at, 'createdAt', t.created_at,
      'lastProgressAt', app_private.work_task_last_progress_at(t.id),
      'origin', o.origin, 'claimStatus', o.claim_status,
      'giver', (select jsonb_build_object('id', g.id, 'name', g.name) from public.users g where g.id = o.claimed_giver_user_id),
      'meeting', (select jsonb_build_object('title', m.title, 'heldOn', m.held_on) from public.work_meetings m where m.id = o.meeting_id),
      'assignees', coalesce((select jsonb_agg(jsonb_build_object('name', u.name, 'unit',
          (select ou.code from public.org_units ou where ou.id = app_private.work_user_org_unit(u.id))) order by a.assigned_at)
        from public.work_task_assignments a join public.users u on u.id = a.user_id where a.task_id = t.id and a.ended_at is null), '[]'::jsonb),
      'canDecide', o.origin = 'oral_claim' and o.claim_status = 'pending' and o.claimed_giver_user_id = v_actor,
      'bucket', case
        when o.origin = 'oral_claim' and o.claim_status = 'pending' then 'confirm'
        when t.status = 'completed' then 'done'
        when t.status = any(v_active) and t.deadline_at < now() then 'late'
        else 'doing' end) as x
    from public.work_task_origins o
    join public.work_tasks t on t.id = o.task_id
    where t.status <> 'cancelled' and t.status <> 'draft' and o.claim_status <> 'rejected'
      and (t.status = any(v_active) or (t.status = 'completed' and t.completed_at >= v_month))
      and (v_units is null or exists (select 1 from public.work_task_assignments a where a.task_id = t.id and a.ended_at is null
        and app_private.work_user_org_unit(a.user_id) = any(v_units)))
      and (v_global or o.claimed_giver_user_id = v_actor or app_private.work_task_actor_can_view(t.id))
    order by t.deadline_at nulls last
    limit 300) q), '[]'::jsonb);
end $$;

-- Người giao xác nhận việc giao miệng, sửa hạn cùng lúc nếu cần (người giao không phải người tạo việc nên không đổi lịch qua lệnh thường được).
create function public.work_task_claim_decide_v2(p_task_id uuid, p_decision text, p_note text default null, p_deadline_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_res jsonb; t public.work_tasks%rowtype; v_event uuid;
begin
  v_res := public.work_task_claim_decide_v1(p_task_id, p_decision, p_note);
  if p_decision = 'confirm' and p_deadline_at is not null then
    select * into strict t from public.work_tasks where id = p_task_id for update;
    if not isfinite(p_deadline_at) or p_deadline_at <= now() then raise exception 'WORK_DEADLINE_EXPIRED' using errcode = '22023'; end if;
    if t.deadline_at is distinct from p_deadline_at then
      update public.work_tasks set deadline_at = p_deadline_at, lock_version = lock_version + 1, updated_at = now() where id = p_task_id;
      insert into public.work_task_events(task_id, actor_user_id, event_type, payload)
        values (p_task_id, v_actor, 'task.schedule_updated', jsonb_build_object('deadlineAt', jsonb_build_object('from', t.deadline_at, 'to', p_deadline_at), 'reason', 'claim_confirm'))
        returning id into v_event;
      insert into app_private.work_notification_outbox(event_id, task_id, event_type, payload)
        values (v_event, p_task_id, 'task.schedule_updated', jsonb_build_object('taskId', p_task_id));
    end if;
    v_res := v_res || jsonb_build_object('deadlineAt', p_deadline_at);
  end if;
  return v_res;
end $$;


create or replace function public.work_tasks_overview_v1(p_assignee_user_id uuid default null, p_unit_query text default null,
  p_state text default 'open', p_due_before date default null, p_limit integer default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id(); v_q text; v_unit public.org_units%rowtype; v_units jsonb; v_n integer; v_due timestamptz;
  v_state text := coalesce(p_state, 'open'); v_result jsonb;
  v_active constant text[] := array['pending_acknowledgement', 'clarification_requested', 'not_started', 'in_progress', 'blocked', 'awaiting_review', 'changes_requested'];
  v_workable constant text[] := array['not_started', 'in_progress', 'blocked', 'changes_requested'];
begin
  if v_actor is null or not app_private.has_permission(v_actor, 'work.module.access', 'global', '*') then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  if v_state not in ('open', 'overdue', 'stale', 'review', 'unack', 'done_recent', 'all') then
    raise exception 'WORK_INVALID_COMMAND' using errcode = '22023';
  end if;
  v_q := nullif(lower(public.unaccent(btrim(coalesce(p_unit_query, '')))), '');
  if v_q is not null then
    -- Trùng mã thì lấy đúng đơn vị đó; không thì tìm theo tên / mã gần đúng, nhiều đơn vị khớp thì trả danh sách để hỏi lại.
    select * into v_unit from public.org_units ou where coalesce(ou.is_active, true) and lower(public.unaccent(coalesce(ou.code, ''))) = v_q limit 1;
    if v_unit.id is null then
      select count(*), jsonb_agg(jsonb_build_object('id', ou.id, 'code', ou.code, 'name', ou.name) order by ou.name) into v_n, v_units
        from public.org_units ou where coalesce(ou.is_active, true)
          and (lower(public.unaccent(ou.name)) like '%' || v_q || '%' or lower(public.unaccent(coalesce(ou.code, ''))) like '%' || v_q || '%');
      if v_n = 0 then return jsonb_build_object('code', 'UNIT_NOT_FOUND'); end if;
      if v_n > 1 then return jsonb_build_object('code', 'UNIT_AMBIGUOUS', 'units', v_units); end if;
      select * into v_unit from public.org_units ou where ou.id = (v_units->0->>'id')::uuid;
    end if;
  end if;
  v_due := case when p_due_before is null then null else (p_due_before + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh' end;

  with recursive sub as (
    select v_unit.id as id where v_unit.id is not null
    union all
    select ou.id from public.org_units ou join sub on ou.parent_id = sub.id
  ), cand as (
    select t.id, t.task_code, t.title, t.status, t.priority, t.deadline_at, t.progress_percent, t.privacy, t.created_by, t.created_at,
      app_private.work_task_last_progress_at(t.id) as last_at
    from public.work_tasks t
    where t.status <> 'draft'
      and (p_assignee_user_id is null or exists (select 1 from public.work_task_assignments a
        where a.task_id = t.id and a.user_id = p_assignee_user_id and a.ended_at is null))
      and (v_unit.id is null or exists (select 1 from public.work_task_assignments a
        where a.task_id = t.id and a.ended_at is null and app_private.work_user_org_unit(a.user_id) in (select s.id from sub s)))
      and (v_due is null or t.deadline_at < v_due)
      and case v_state
        when 'open' then t.status = any(v_active)
        when 'overdue' then t.status = any(v_active) and t.deadline_at < now()
        when 'stale' then t.status = any(v_workable)
        when 'review' then t.status = 'awaiting_review'
        when 'unack' then t.status = 'pending_acknowledgement'
        when 'done_recent' then t.status = 'completed' and t.completed_at >= now() - interval '14 days'
        else true end
      and app_private.work_task_actor_can_view(t.id)
  ), x as (
    select c.* from cand c where v_state <> 'stale' or c.last_at < now() - interval '48 hours'
  )
  select jsonb_build_object(
    'unit', case when v_unit.id is null then null else jsonb_build_object('id', v_unit.id, 'code', v_unit.code, 'name', v_unit.name) end,
    'total', (select count(*) from x),
    'overdue', (select count(*) from x where x.status = any(v_active) and x.deadline_at < now()),
    'stale', (select count(*) from x where x.status = any(v_workable) and x.last_at < now() - interval '48 hours'),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', y.id, 'code', y.task_code, 'title', y.title, 'status', y.status,
        'level', app_private.work_level(y.priority), 'deadlineAt', y.deadline_at, 'progressPercent', y.progress_percent, 'lastProgressAt', y.last_at,
        'overdue', y.status = any(v_active) and y.deadline_at < now(), 'restricted', y.privacy = 'restricted',
        'createdByName', (select u.name from public.users u where u.id = y.created_by),
        'assignees', coalesce((select jsonb_agg(jsonb_build_object('userId', a.user_id, 'name', u.name) order by a.assigned_at)
          from public.work_task_assignments a join public.users u on u.id = a.user_id where a.task_id = y.id and a.ended_at is null), '[]'::jsonb))
        order by y.ord)
      from (select x.*, row_number() over (order by x.deadline_at is null, x.deadline_at,
              case x.priority when 'urgent' then 0 when 'important' then 1 else 2 end, x.created_at desc) as ord
            from x order by ord limit greatest(1, least(coalesce(p_limit, 30), 100))) y), '[]'::jsonb))
  into v_result;
  return v_result;
end $$;

revoke all on function public.work_board_access_v1() from public, anon, authenticated;
revoke all on function public.work_review_queue_v1() from public, anon, authenticated;
revoke all on function public.work_directives_v1(uuid) from public, anon, authenticated;
revoke all on function public.work_task_claim_decide_v2(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.work_board_access_v1() to authenticated;
grant execute on function public.work_review_queue_v1() to authenticated;
grant execute on function public.work_directives_v1(uuid) to authenticated;
grant execute on function public.work_task_claim_decide_v2(uuid, text, text, timestamptz) to authenticated;
