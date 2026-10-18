-- Trợ lý · chọn model ngay ở ô hỏi (chủ SP 18/10/2026, học từ màn /ai cũ): Admin cấp cho mỗi người một model MẶC ĐỊNH + các model THÊM
-- (mẫu hoặc chỉnh riêng); người dùng chọn trong số đó ở ô hỏi. Mỗi model có tên dễ hiểu, mô tả ngắn, biểu tượng và cờ đọc ảnh — Admin sửa
-- ở Trung tâm AI → Model. Cổng AI chỉ dùng model người dùng chọn khi nằm trong danh sách được cấp; không thì model mặc định.

alter table public.integration_connections add column if not exists display_name text check (display_name is null or char_length(display_name) <= 60);
alter table public.integration_connections add column if not exists blurb text check (blurb is null or char_length(blurb) <= 140);
alter table public.integration_connections add column if not exists icon text check (icon is null or char_length(icon) <= 8);
alter table public.integration_connections add column if not exists vision boolean not null default true;
alter table public.ai_grant_templates add column if not exists extra_connection_ids uuid[] not null default '{}';
alter table public.ai_user_grants add column if not exists extra_connection_ids uuid[];

-- Mô tả sẵn cho 2 model đang có (Admin sửa được).
update public.integration_connections set display_name = coalesce(display_name, 'Claude Sonnet 5.5'), icon = coalesce(icon, '🧠'),
  blurb = coalesce(blurb, 'Hiểu sâu, đọc ảnh / PDF scan — hợp báo giá, phân tích'), vision = true where model = 'claude-sonnet-5-5';
update public.integration_connections set display_name = coalesce(display_name, 'DeepSeek Flash'), icon = coalesce(icon, '⚡'),
  blurb = coalesce(blurb, 'Nhanh, rẻ — câu hỏi thường, tra cứu nhanh'), vision = false where model like 'deepseek%';

create or replace function app_private.ai_effective_grant(p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('enabled', g.enabled, 'templateId', g.template_id, 'templateName', t.name,
    'connectionId', coalesce(g.connection_id, t.connection_id),
    'monthlyCostCapUsd', coalesce(g.monthly_cost_cap_usd, t.monthly_cost_cap_usd),
    'dailyQuestionCap', coalesce(g.daily_question_cap, t.daily_question_cap),
    'skills', to_jsonb(coalesce(g.skills, t.skills, '{}'::text[])),
    -- Model được chọn: mặc định trước, rồi model thêm (riêng ?? mẫu); chỉ kết nối đang bật.
    'models', coalesce((select jsonb_agg(c.id order by x.ord) from unnest(array[coalesce(g.connection_id, t.connection_id)] || coalesce(g.extra_connection_ids, t.extra_connection_ids, '{}'::uuid[]))
        with ordinality x(id, ord) join public.integration_connections c on c.id = x.id and c.enabled
        where x.ord = (select min(y.ord) from unnest(array[coalesce(g.connection_id, t.connection_id)] || coalesce(g.extra_connection_ids, t.extra_connection_ids, '{}'::uuid[])) with ordinality y(id, ord) where y.id = x.id)), '[]'::jsonb))
  from public.ai_user_grants g left join public.ai_grant_templates t on t.id = g.template_id
  where g.user_id = p_user;
$$;

create or replace function public.ai_gateway_begin_v1(p_skill text, p_context jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  a uuid := public.current_app_user_id();
  s public.ai_skills; st public.ai_settings; g jsonb; u jsonb; v_pick text;
  v_ctx jsonb; v_day timestamptz; v_month timestamptz;
  used_today integer; used_month integer; cost_month numeric; used_minute integer; busy integer; r uuid;
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
end $$;

create or replace function public.get_my_ai_access_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a uuid := public.current_app_user_id(); g jsonb; u jsonb;
begin
  if a is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  g := app_private.ai_effective_grant(a);
  u := app_private.ai_user_usage(a);
  return jsonb_build_object(
    'assistant', (select s.access = 'everyone' or (g is not null and (g->>'enabled')::boolean and (g->'skills') ? s.code) from public.ai_skills s where s.code = 'assistant_chat'),
    'dailyQuestionCap', case when (g->>'enabled')::boolean then (g->>'dailyQuestionCap')::int end,
    'monthlyCostCapUsd', case when (g->>'enabled')::boolean then (g->>'monthlyCostCapUsd')::numeric end,
    'usedToday', (u->>'today')::int, 'monthCostUsd', (u->>'monthCostUsd')::numeric,
    'models', case when (g->>'enabled')::boolean then coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', coalesce(nullif(c.display_name, ''), c.model, c.name),
        'model', c.model, 'blurb', c.blurb, 'icon', c.icon, 'vision', c.vision, 'default', m.ord = 1) order by m.ord)
      from jsonb_array_elements_text(g->'models') with ordinality m(id, ord) join public.integration_connections c on c.id::text = m.id), '[]'::jsonb) else '[]'::jsonb end,
    'admin', (select u2.name from public.users u2 where u2.id = (select owner_user_id from public.ai_skills where code = 'assistant_chat')));
end $$;

create or replace function public.get_ai_admin_overview_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'AI_ADMIN_REQUIRED' using errcode = '42501'; end if;
  return jsonb_build_object(
    'templates', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'connectionId', t.connection_id, 'monthlyCostCapUsd', t.monthly_cost_cap_usd,
        'dailyQuestionCap', t.daily_question_cap, 'skills', to_jsonb(t.skills), 'note', t.note, 'extraConnectionIds', to_jsonb(t.extra_connection_ids),
        'users', (select count(*) from public.ai_user_grants g where g.template_id = t.id)) order by t.name) from public.ai_grant_templates t), '[]'::jsonb),
    'grants', coalesce((select jsonb_agg(jsonb_build_object('userId', g.user_id, 'name', u.name, 'email', u.email, 'role', u.role, 'active', coalesce(u.is_active, true),
        'enabled', g.enabled, 'templateId', g.template_id, 'connectionId', g.connection_id, 'monthlyCostCapUsd', g.monthly_cost_cap_usd,
        'dailyQuestionCap', g.daily_question_cap, 'skills', to_jsonb(g.skills), 'note', g.note, 'updatedAt', g.updated_at, 'extraConnectionIds', to_jsonb(g.extra_connection_ids),
        'effective', app_private.ai_effective_grant(g.user_id), 'usage', app_private.ai_user_usage(g.user_id)) order by u.name)
      from public.ai_user_grants g join public.users u on u.id = g.user_id), '[]'::jsonb),
    'skills', coalesce((select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name, 'access', s.access, 'enabled', s.enabled, 'dailyLimit', s.daily_limit) order by s.name)
      from public.ai_skills s where s.code <> 'gateway_check'), '[]'::jsonb),
    'connections', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'model', c.model, 'enabled', c.enabled, 'pricePerCall', c.price_per_call,
        'displayName', c.display_name, 'blurb', c.blurb, 'icon', c.icon, 'vision', c.vision) order by c.name)
      from public.integration_connections c), '[]'::jsonb),
    'settings', (select jsonb_build_object('monthlyCostCapUsd', st.monthly_cost_cap_usd, 'monthlyRunCap', st.monthly_run_cap) from public.ai_settings st where st.id = 1),
    'month', (select jsonb_build_object('runs', count(*), 'costUsd', round(coalesce(sum(r.cost_usd), 0), 4)) from public.ai_runs r
      where r.created_at >= date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh' and r.status in ('started', 'ok', 'error', 'refused')));
end $$;

create or replace function public.ai_admin_grant_save_v1(p_user_ids uuid[], p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  a uuid := public.current_app_user_id(); v_user uuid; v_old public.ai_user_grants; v_new public.ai_user_grants; n integer := 0;
  v_skills text[] := case when jsonb_typeof(p->'skills') = 'array' then array(select jsonb_array_elements_text(p->'skills')) end;
  v_extra uuid[] := case when jsonb_typeof(p->'extraConnectionIds') = 'array' then array(select jsonb_array_elements_text(p->'extraConnectionIds')::uuid) end;
begin
  if not public.is_admin() then raise exception 'AI_ADMIN_REQUIRED' using errcode = '42501'; end if;
  if coalesce(array_length(p_user_ids, 1), 0) = 0 or array_length(p_user_ids, 1) > 100 then raise exception 'AI_GRANT_USERS_REQUIRED' using errcode = '22023'; end if;
  if v_skills is not null and exists (select 1 from unnest(v_skills) x where not exists (select 1 from public.ai_skills s where s.code = x)) then
    raise exception 'AI_GRANT_BAD_SKILL' using errcode = '22023';
  end if;
  foreach v_user in array p_user_ids loop
    select * into v_old from public.ai_user_grants where user_id = v_user;
    insert into public.ai_user_grants (user_id, enabled, template_id, connection_id, extra_connection_ids, monthly_cost_cap_usd, daily_question_cap, skills, note, created_by, updated_by)
    values (v_user, coalesce((p->>'enabled')::boolean, true), nullif(p->>'templateId', '')::uuid, nullif(p->>'connectionId', '')::uuid, v_extra,
      nullif(p->>'monthlyCostCapUsd', '')::numeric, nullif(p->>'dailyQuestionCap', '')::int, v_skills, nullif(left(btrim(coalesce(p->>'note', '')), 300), ''), a, a)
    on conflict (user_id) do update set enabled = excluded.enabled, template_id = excluded.template_id, connection_id = excluded.connection_id, extra_connection_ids = excluded.extra_connection_ids,
      monthly_cost_cap_usd = excluded.monthly_cost_cap_usd, daily_question_cap = excluded.daily_question_cap, skills = excluded.skills,
      note = excluded.note, updated_by = a, updated_at = now()
    returning * into v_new;
    perform app_private.ai_admin_audit(v_user::text, (select name from public.users where id = v_user), case when v_old.user_id is null then 'INSERT' else 'UPDATE' end,
      to_jsonb(v_old), to_jsonb(v_new), case when v_old.user_id is null then 'Cấp AI' when not v_new.enabled then 'Tắt AI' else 'Đổi cấp phát AI' end);
    n := n + 1;
  end loop;
  return jsonb_build_object('saved', n);
end $$;

create or replace function public.ai_admin_template_save_v1(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  a uuid := public.current_app_user_id(); v_id uuid := nullif(p->>'id', '')::uuid; t public.ai_grant_templates;
  v_skills text[] := case when jsonb_typeof(p->'skills') = 'array' then array(select jsonb_array_elements_text(p->'skills')) else '{}'::text[] end;
  v_extra uuid[] := case when jsonb_typeof(p->'extraConnectionIds') = 'array' then array(select jsonb_array_elements_text(p->'extraConnectionIds')::uuid) else '{}'::uuid[] end;
begin
  if not public.is_admin() then raise exception 'AI_ADMIN_REQUIRED' using errcode = '42501'; end if;
  if exists (select 1 from unnest(v_skills) x where not exists (select 1 from public.ai_skills s where s.code = x)) then raise exception 'AI_GRANT_BAD_SKILL' using errcode = '22023'; end if;
  if v_id is null then
    insert into public.ai_grant_templates (name, connection_id, extra_connection_ids, monthly_cost_cap_usd, daily_question_cap, skills, note, created_by, updated_by)
    values (btrim(p->>'name'), nullif(p->>'connectionId', '')::uuid, v_extra, nullif(p->>'monthlyCostCapUsd', '')::numeric, nullif(p->>'dailyQuestionCap', '')::int, v_skills,
      nullif(left(btrim(coalesce(p->>'note', '')), 300), ''), a, a) returning * into t;
  else
    update public.ai_grant_templates set name = btrim(p->>'name'), connection_id = nullif(p->>'connectionId', '')::uuid, extra_connection_ids = v_extra,
      monthly_cost_cap_usd = nullif(p->>'monthlyCostCapUsd', '')::numeric, daily_question_cap = nullif(p->>'dailyQuestionCap', '')::int, skills = v_skills,
      note = nullif(left(btrim(coalesce(p->>'note', '')), 300), ''), updated_by = a, updated_at = now()
    where id = v_id returning * into t;
    if t.id is null then raise exception 'AI_TEMPLATE_NOT_FOUND' using errcode = 'P0002'; end if;
  end if;
  perform app_private.ai_admin_audit('template:' || t.id, t.name, case when v_id is null then 'INSERT' else 'UPDATE' end, '{}'::jsonb, to_jsonb(t),
    case when v_id is null then 'Thêm mẫu cấp AI' else 'Sửa mẫu cấp AI' end);
  return jsonb_build_object('id', t.id);
exception when unique_violation then raise exception 'AI_TEMPLATE_NAME_TAKEN' using errcode = '23505';
end $$;

-- Admin sửa tên hiển thị / mô tả / biểu tượng / đọc ảnh của một model (khóa, giá ở Cài đặt → Kết nối).
create or replace function public.ai_admin_model_save_v1(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_old public.integration_connections; v_new public.integration_connections;
begin
  if not public.is_admin() then raise exception 'AI_ADMIN_REQUIRED' using errcode = '42501'; end if;
  select * into v_old from public.integration_connections where id = nullif(p->>'id', '')::uuid;
  if v_old.id is null then raise exception 'AI_MODEL_NOT_FOUND' using errcode = 'P0002'; end if;
  update public.integration_connections set display_name = nullif(left(btrim(coalesce(p->>'displayName', '')), 60), ''),
    blurb = nullif(left(btrim(coalesce(p->>'blurb', '')), 140), ''), icon = nullif(left(btrim(coalesce(p->>'icon', '')), 8), ''),
    vision = coalesce((p->>'vision')::boolean, v_old.vision), updated_at = now()
  where id = v_old.id returning * into v_new;
  perform app_private.ai_admin_audit('model:' || v_new.id, coalesce(v_new.display_name, v_new.name), 'UPDATE',
    jsonb_build_object('displayName', v_old.display_name, 'blurb', v_old.blurb, 'icon', v_old.icon, 'vision', v_old.vision),
    jsonb_build_object('displayName', v_new.display_name, 'blurb', v_new.blurb, 'icon', v_new.icon, 'vision', v_new.vision), 'Sửa mô tả model AI');
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.ai_admin_model_save_v1(jsonb) from public, anon;
grant execute on function public.ai_admin_model_save_v1(jsonb) to authenticated;
