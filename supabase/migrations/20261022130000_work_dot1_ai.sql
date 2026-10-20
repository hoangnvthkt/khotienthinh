-- Vioo Work · Đợt 1 PR-3 (chủ SP 20/10/2026): bật 5 skill AI giao việc + công cụ Trợ lý. AI chỉ soạn nháp, người dùng bấm Giao / Gửi.
--   1) Skill Vioo Work chỉ cho người vào được Vioo Work (thí điểm 30 người), chung 20 lượt / người / ngày:
--      ai_skills thêm required_permission + quota_group, bảng ai_quota_groups; ai_gateway_begin_v1 kiểm hai cột (skill khác không đổi).
--   2) Thẻ Trợ lý loại work_task (assistant_commands.kind).
--   3) work_tasks_overview_v1: việc theo người / đơn vị / trạng thái theo quyền xem (Trợ lý · viec_giao; Phòng tôi PR-4 dùng lại).
--   4) work_learn_person_alias_v1: học cách gọi người ("Hà KH") từ việc đã giao thật, chỉ người giao của việc đó.

-- ── 1. Skill gắn quyền module + nhóm hạn mức ─────────────────────────────────────────────────────────
alter table public.ai_skills add column if not exists required_permission text, add column if not exists quota_group text;
create table public.ai_quota_groups (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  name text not null check (char_length(name) between 1 and 80),
  daily_limit integer not null check (daily_limit between 1 and 1000)
);
alter table public.ai_quota_groups enable row level security;
revoke all on table public.ai_quota_groups from anon, authenticated;
insert into public.ai_quota_groups (code, name, daily_limit) values ('work', 'Vioo Work', 20);

update public.ai_skills set enabled = true, required_permission = 'work.module.access', quota_group = 'work', daily_limit = 20
  where code in ('work_task_draft', 'work_meeting_tasks', 'work_update_draft', 'work_task_writer', 'work_task_brief');

CREATE OR REPLACE FUNCTION public.ai_gateway_begin_v1(p_skill text, p_context jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a uuid := public.current_app_user_id();
  s public.ai_skills; st public.ai_settings; g jsonb; u jsonb; v_pick text;
  v_ctx jsonb; v_day timestamptz; v_month timestamptz;
  used_today integer; used_month integer; cost_month numeric; used_minute integer; busy integer; r uuid;
  v_group_limit integer; used_group integer;
begin
  if a is null then raise exception 'AI_DENIED' using errcode = '42501'; end if;
  select * into s from public.ai_skills where code = p_skill;
  if s.code is null then return jsonb_build_object('code', 'AI_SKILL_UNKNOWN'); end if;
  select * into st from public.ai_settings where id = 1;
  v_ctx := case when jsonb_typeof(p_context) = 'object' then p_context else '{}'::jsonb end;
  if length(v_ctx::text) > 2000 then v_ctx := '{}'::jsonb; end if;

  if not app_private.ai_tier_allowed(s.tier, a) then
    insert into public.ai_runs (user_id, skill_code, status, context, error, finished_at) values (a, s.code, 'denied', v_ctx, 'AI_DENIED', now());
    return jsonb_build_object('code', 'AI_DENIED');
  end if;
  if not coalesce(st.enabled, true) or not s.enabled then
    insert into public.ai_runs (user_id, skill_code, status, context, error, finished_at)
      values (a, s.code, 'denied', v_ctx, case when coalesce(st.enabled, true) then 'AI_SKILL_OFF' else 'AI_OFF' end, now());
    return jsonb_build_object('code', case when coalesce(st.enabled, true) then 'AI_SKILL_OFF' else 'AI_OFF' end);
  end if;
  -- Vioo Work (20/10): skill gắn quyền module chỉ chạy cho người có quyền đó (thí điểm Vioo Work), kể cả Admin không có quyền module.
  if s.required_permission is not null and not app_private.has_permission(a, s.required_permission, 'global', '*') then
    insert into public.ai_runs (user_id, skill_code, status, context, error, finished_at) values (a, s.code, 'denied', v_ctx, 'AI_MODULE_DENIED', now());
    return jsonb_build_object('code', 'AI_DENIED', 'reason', 'module');
  end if;
  -- Trung tâm AI: skill "chỉ người được cấp" cần cấp phát đang bật có skill đó.
  g := app_private.ai_effective_grant(a);
  -- Model người dùng chọn ở ô hỏi: chỉ nhận khi nằm trong danh sách được cấp; không thì model mặc định.
  v_pick := case when (g->'models') ? (v_ctx->>'connectionId') then v_ctx->>'connectionId' else coalesce(g->'models'->>0, g->>'connectionId') end;
  if s.access = 'granted' and (g is null or not (g->>'enabled')::boolean or not (g->'skills') ? s.code) then
    insert into public.ai_runs (user_id, skill_code, status, context, error, finished_at) values (a, s.code, 'denied', v_ctx, 'AI_NOT_GRANTED', now());
    return jsonb_build_object('code', 'AI_DENIED', 'reason', 'not_granted');
  end if;

  -- Khóa theo người để hạn mức ngày / tháng / phút tính đúng khi gọi song song.
  perform pg_advisory_xact_lock(hashtextextended('ai-gateway-' || a::text, 0));
  if s.max_concurrent is not null then
    select count(*) into busy from public.ai_runs
      where user_id = a and skill_code = s.code and status = 'started' and created_at > now() - interval '2 minutes';
    if busy >= s.max_concurrent then
      insert into public.ai_runs (user_id, skill_code, status, context, error, finished_at) values (a, s.code, 'quota', v_ctx, 'AI_BUSY', now());
      return jsonb_build_object('code', 'AI_QUOTA', 'reason', 'busy');
    end if;
  end if;
  if s.per_minute_limit is not null then
    select count(*) into used_minute from public.ai_runs
      where user_id = a and skill_code = s.code and created_at > now() - interval '1 minute' and status in ('started', 'ok', 'error', 'refused');
    if used_minute >= s.per_minute_limit then
      insert into public.ai_runs (user_id, skill_code, status, context, error, finished_at) values (a, s.code, 'quota', v_ctx, 'AI_RATE', now());
      return jsonb_build_object('code', 'AI_QUOTA', 'reason', 'minute', 'perMinute', s.per_minute_limit);
    end if;
  end if;
  -- Trần theo người (người được cấp): câu / ngày và tiền / tháng, tính trên mọi lượt AI của người đó.
  if g is not null and (g->>'enabled')::boolean then
    u := app_private.ai_user_usage(a);
    if (g->>'dailyQuestionCap') is not null and (u->>'today')::int >= (g->>'dailyQuestionCap')::int then
      insert into public.ai_runs (user_id, skill_code, status, context, error, finished_at) values (a, s.code, 'quota', v_ctx, 'AI_USER_DAY', now());
      return jsonb_build_object('code', 'AI_QUOTA', 'reason', 'user_day', 'usedToday', (u->>'today')::int, 'dailyLimit', (g->>'dailyQuestionCap')::int);
    end if;
    if (g->>'monthlyCostCapUsd') is not null and (u->>'monthCostUsd')::numeric >= (g->>'monthlyCostCapUsd')::numeric then
      insert into public.ai_runs (user_id, skill_code, status, context, error, finished_at) values (a, s.code, 'quota', v_ctx, 'AI_USER_MONTH', now());
      return jsonb_build_object('code', 'AI_QUOTA', 'reason', 'user_month', 'monthCostUsd', (u->>'monthCostUsd')::numeric, 'monthlyCostCapUsd', (g->>'monthlyCostCapUsd')::numeric);
    end if;
  end if;
  v_day := date_trunc('day', now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh';
  v_month := date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh';
  select count(*) into used_today from public.ai_runs
    where user_id = a and skill_code = s.code and created_at >= v_day and status in ('started', 'ok', 'error', 'refused');
  if used_today >= s.daily_limit then
    insert into public.ai_runs (user_id, skill_code, status, context, error, finished_at) values (a, s.code, 'quota', v_ctx, 'AI_DAILY_LIMIT', now());
    return jsonb_build_object('code', 'AI_QUOTA', 'reason', 'day', 'usedToday', used_today, 'dailyLimit', s.daily_limit);
  end if;
  -- Nhóm hạn mức (Vioo Work: 20 lượt / người / ngày cho cả 5 skill).
  if s.quota_group is not null then
    select q.daily_limit into v_group_limit from public.ai_quota_groups q where q.code = s.quota_group;
    if v_group_limit is not null then
      select count(*) into used_group from public.ai_runs x join public.ai_skills k on k.code = x.skill_code
        where x.user_id = a and k.quota_group = s.quota_group and x.created_at >= v_day and x.status in ('started', 'ok', 'error', 'refused');
      if used_group >= v_group_limit then
        insert into public.ai_runs (user_id, skill_code, status, context, error, finished_at) values (a, s.code, 'quota', v_ctx, 'AI_GROUP_DAILY_LIMIT', now());
        return jsonb_build_object('code', 'AI_QUOTA', 'reason', 'day', 'usedToday', used_group, 'dailyLimit', v_group_limit);
      end if;
    end if;
  end if;
  select count(*), coalesce(sum(cost_usd), 0) into used_month, cost_month from public.ai_runs
    where created_at >= v_month and status in ('started', 'ok', 'error', 'refused');
  if used_month >= st.monthly_run_cap or (st.monthly_cost_cap_usd > 0 and cost_month >= st.monthly_cost_cap_usd) then
    insert into public.ai_runs (user_id, skill_code, status, context, error, finished_at) values (a, s.code, 'quota', v_ctx, 'AI_MONTHLY_CAP', now());
    return jsonb_build_object('code', 'AI_QUOTA', 'reason', 'month', 'usedMonth', used_month, 'monthlyRunCap', st.monthly_run_cap);
  end if;

  insert into public.ai_runs (user_id, skill_code, status, context) values (a, s.code, 'started', v_ctx) returning id into r;
  return jsonb_build_object('code', 'OK', 'runId', r,
    'skill', jsonb_build_object('code', s.code, 'name', s.name, 'tier', s.tier, 'mode', s.mode, 'modelClass', s.model_class),
    'usedToday', used_today, 'dailyLimit', s.daily_limit,
    -- Model riêng của người được cấp (skill "chỉ người được cấp"); null = kết nối gán theo tính năng như cũ.
    'connectionId', case when s.access = 'granted' then v_pick end);
end $function$;

-- ── 2. Thẻ Trợ lý giao việc ──────────────────────────────────────────────────────────────────────────
alter table public.assistant_commands drop constraint assistant_commands_kind_check;
alter table public.assistant_commands add constraint assistant_commands_kind_check
  check (kind in ('leave_request', 'material_request', 'purchase_order', 'daily_log', 'memory_note', 'work_task'));

-- ── 3. Việc theo người / đơn vị / trạng thái (theo quyền xem của người hỏi) ─────────────────────────
create function public.work_tasks_overview_v1(p_assignee_user_id uuid default null, p_unit_query text default null,
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
  if v_state not in ('open', 'overdue', 'stale', 'review', 'done_recent', 'all') then
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

-- ── 4. Học cách gọi người từ việc đã giao thật ───────────────────────────────────────────────────────
-- Chỉ người giao của việc, việc có đúng một người làm, cách gọi không trùng họ tên / tên gọi (tên gọi một chữ vẫn để máy hỏi lại).
create function public.work_learn_person_alias_v1(p_task_id uuid, p_alias text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id(); v_target uuid; v_name text; v_alias text; v_norm text; v_full text;
begin
  if v_actor is null or not app_private.work_task_actor_can_view(p_task_id) then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  if (select count(*) from public.work_task_assignments a where a.task_id = p_task_id and a.ended_at is null) <> 1 then
    return jsonb_build_object('saved', 0);
  end if;
  select a.user_id, u.name into v_target, v_name
    from public.work_tasks t join public.work_task_assignments a on a.task_id = t.id and a.ended_at is null join public.users u on u.id = a.user_id
    where t.id = p_task_id and t.created_by = v_actor;
  v_alias := left(regexp_replace(btrim(coalesce(p_alias, '')), '\s+', ' ', 'g'), 80);
  v_norm := left(app_private.ai_alias_norm(v_alias), 160);
  v_full := app_private.ai_alias_norm(coalesce(v_name, ''));
  if v_target is null or v_target = v_actor or char_length(v_norm) < 2 or v_norm = v_full
    or v_norm = app_private.ai_alias_norm(regexp_replace(coalesce(v_name, ''), '^.*\s', '')) then
    return jsonb_build_object('saved', 0);
  end if;
  insert into public.ai_memory_aliases (scope_type, scope_id, kind, alias_norm, alias_text, target_id, target_label, created_by, updated_by)
  values ('company', 'work', 'person', v_norm, v_alias, v_target::text, v_name, v_actor, v_actor)
  on conflict (scope_type, scope_id, kind, alias_norm, target_key) do update
    set hits = public.ai_memory_aliases.hits + 1, alias_text = excluded.alias_text, target_label = excluded.target_label,
        last_used_at = now(), updated_by = v_actor, updated_at = now();
  return jsonb_build_object('saved', 1);
end $$;

revoke all on function public.work_tasks_overview_v1(uuid, text, text, date, integer) from public, anon, authenticated;
revoke all on function public.work_learn_person_alias_v1(uuid, text) from public, anon, authenticated;
grant execute on function public.work_tasks_overview_v1(uuid, text, text, date, integer) to authenticated;
grant execute on function public.work_learn_person_alias_v1(uuid, text) to authenticated;
