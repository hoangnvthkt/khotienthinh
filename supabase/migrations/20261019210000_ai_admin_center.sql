-- Trung tâm quản lý AI (chủ SP chốt 18/10/2026). Admin (Quản trị AI = Admin Hoàng) cấp AI tới từng người: ai được dùng, model nào,
-- trần tiền / tháng + số câu / ngày, skill nào. Cấp nhanh bằng MẪU rồi chỉnh riêng từng người.
--   * ai_skills.access: 'everyone' (như cũ — ai có quyền màn nghiệp vụ là dùng được) | 'granted' (chỉ người được cấp, có skill trong danh sách).
--     Trợ lý · hội thoại chuyển sang 'granted' (mở cho nhóm nhỏ trước); skill khác giữ 'everyone', Admin khóa được từng skill.
--   * ai_grant_templates + ai_user_grants: giá trị riêng của người (khác null) đè lên mẫu.
--   * ai_gateway_begin_v1: kiểm cấp phát + trần theo người (mọi lượt AI của người đó) + trả kết nối (model) của người cho skill được cấp.
--   * Mọi thay đổi cấp phát ghi audit_trail (module AI).

alter table public.ai_skills add column if not exists access text not null default 'everyone' check (access in ('everyone', 'granted'));
update public.ai_skills set access = 'granted' where code = 'assistant_chat';

create table if not exists public.ai_grant_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(btrim(name)) between 1 and 80),
  connection_id uuid references public.integration_connections(id) on delete set null,
  monthly_cost_cap_usd numeric(10, 2) check (monthly_cost_cap_usd is null or monthly_cost_cap_usd >= 0),
  daily_question_cap integer check (daily_question_cap is null or daily_question_cap between 1 and 1000),
  skills text[] not null default '{}',
  note text check (note is null or char_length(note) <= 300),
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.ai_user_grants (
  user_id uuid primary key references public.users(id) on delete cascade,
  enabled boolean not null default true,
  template_id uuid references public.ai_grant_templates(id) on delete set null,
  connection_id uuid references public.integration_connections(id) on delete set null,
  monthly_cost_cap_usd numeric(10, 2) check (monthly_cost_cap_usd is null or monthly_cost_cap_usd >= 0),
  daily_question_cap integer check (daily_question_cap is null or daily_question_cap between 1 and 1000),
  skills text[],
  note text check (note is null or char_length(note) <= 300),
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_user_grants_template on public.ai_user_grants (template_id);
create index if not exists ai_runs_user_created on public.ai_runs (user_id, created_at desc);
alter table public.ai_grant_templates enable row level security;
alter table public.ai_user_grants enable row level security;
revoke all on public.ai_grant_templates, public.ai_user_grants from public, anon, authenticated;
comment on table public.ai_user_grants is 'Cấp AI theo người (Trung tâm AI): bật / tắt, mẫu, model, trần tiền tháng, câu / ngày, skill. Giá trị riêng đè lên mẫu. Chỉ qua RPC.';

-- Cấp phát hiệu lực của một người: riêng ?? mẫu. null = chưa được cấp.
create or replace function app_private.ai_effective_grant(p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('enabled', g.enabled, 'templateId', g.template_id, 'templateName', t.name,
    'connectionId', coalesce(g.connection_id, t.connection_id),
    'monthlyCostCapUsd', coalesce(g.monthly_cost_cap_usd, t.monthly_cost_cap_usd),
    'dailyQuestionCap', coalesce(g.daily_question_cap, t.daily_question_cap),
    'skills', to_jsonb(coalesce(g.skills, t.skills, '{}'::text[])))
  from public.ai_user_grants g left join public.ai_grant_templates t on t.id = g.template_id
  where g.user_id = p_user;
$$;
revoke all on function app_private.ai_effective_grant(uuid) from public, anon, authenticated;

-- Dùng của một người: câu hôm nay (mọi skill) + tiền tháng này (giờ VN).
create or replace function app_private.ai_user_usage(p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'today', count(*) filter (where r.created_at >= date_trunc('day', now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh'),
    'monthRuns', count(*),
    'monthCostUsd', round(coalesce(sum(r.cost_usd), 0), 4),
    'lastAt', max(r.created_at))
  from public.ai_runs r
  where r.user_id = p_user and r.created_at >= date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh'
    and r.status in ('started', 'ok', 'error', 'refused');
$$;
revoke all on function app_private.ai_user_usage(uuid) from public, anon, authenticated;

-- Mẫu ban đầu (Admin sửa / thêm được): đều dùng kết nối "Trợ lý · hội thoại" hiện tại.
insert into public.ai_grant_templates (name, connection_id, monthly_cost_cap_usd, daily_question_cap, skills, note)
select v.name, (select a.connection_id from public.integration_assignments a where a.feature = 'ai.assistant'), v.cap, v.q, array['assistant_chat'], v.note
from (values ('Tiêu chuẩn', 3.00::numeric, 30, 'Cán bộ dùng Trợ lý hằng ngày'), ('Nâng cao', 10.00::numeric, 80, 'Quản lý, mua hàng — hỏi nhiều, gửi ảnh / Excel')) v(name, cap, q, note)
on conflict (name) do nothing;
-- Admin Hoàng (Quản trị AI) giữ quyền dùng Trợ lý như hiện tại.
insert into public.ai_user_grants (user_id, enabled, template_id, note)
select u.id, true, (select id from public.ai_grant_templates where name = 'Nâng cao'), 'Quản trị AI'
from public.users u where u.name = 'Admin Hoàng' and u.role = 'ADMIN'
on conflict (user_id) do nothing;

create or replace function public.ai_gateway_begin_v1(p_skill text, p_context jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  a uuid := public.current_app_user_id();
  s public.ai_skills; st public.ai_settings; g jsonb; u jsonb;
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
    'connectionId', case when s.access = 'granted' then g->>'connectionId' end);
end $$;

-- Người dùng xem quyền AI của chính mình (Trợ lý báo "chưa được cấp" / còn bao nhiêu câu hôm nay).
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
    'admin', (select u2.name from public.users u2 where u2.id = (select owner_user_id from public.ai_skills where code = 'assistant_chat')));
end $$;

-- ── Quản trị (Admin) ─────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function app_private.ai_admin_audit(p_record text, p_label text, p_action text, p_old jsonb, p_new jsonb, p_desc text)
returns void language sql volatile security definer set search_path = '' as $$
  insert into public.audit_trail(table_name, record_id, record_label, action, old_data, new_data, user_id, user_name, module, description, impact_level, context)
  values ('ai_user_grants', p_record, p_label, p_action, coalesce(p_old, '{}'::jsonb), coalesce(p_new, '{}'::jsonb), public.current_app_user_id()::text,
    (select name from public.users where id = public.current_app_user_id()), 'AI', p_desc, 'normal', '{}'::jsonb);
$$;
revoke all on function app_private.ai_admin_audit(text, text, text, jsonb, jsonb, text) from public, anon, authenticated;

create or replace function public.get_ai_admin_overview_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'AI_ADMIN_REQUIRED' using errcode = '42501'; end if;
  return jsonb_build_object(
    'templates', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'connectionId', t.connection_id, 'monthlyCostCapUsd', t.monthly_cost_cap_usd,
        'dailyQuestionCap', t.daily_question_cap, 'skills', to_jsonb(t.skills), 'note', t.note,
        'users', (select count(*) from public.ai_user_grants g where g.template_id = t.id)) order by t.name) from public.ai_grant_templates t), '[]'::jsonb),
    'grants', coalesce((select jsonb_agg(jsonb_build_object('userId', g.user_id, 'name', u.name, 'email', u.email, 'role', u.role, 'active', coalesce(u.is_active, true),
        'enabled', g.enabled, 'templateId', g.template_id, 'connectionId', g.connection_id, 'monthlyCostCapUsd', g.monthly_cost_cap_usd,
        'dailyQuestionCap', g.daily_question_cap, 'skills', to_jsonb(g.skills), 'note', g.note, 'updatedAt', g.updated_at,
        'effective', app_private.ai_effective_grant(g.user_id), 'usage', app_private.ai_user_usage(g.user_id)) order by u.name)
      from public.ai_user_grants g join public.users u on u.id = g.user_id), '[]'::jsonb),
    'skills', coalesce((select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name, 'access', s.access, 'enabled', s.enabled, 'dailyLimit', s.daily_limit) order by s.name)
      from public.ai_skills s where s.code <> 'gateway_check'), '[]'::jsonb),
    'connections', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'model', c.model, 'enabled', c.enabled, 'pricePerCall', c.price_per_call) order by c.name)
      from public.integration_connections c), '[]'::jsonb),
    'settings', (select jsonb_build_object('monthlyCostCapUsd', st.monthly_cost_cap_usd, 'monthlyRunCap', st.monthly_run_cap) from public.ai_settings st where st.id = 1),
    'month', (select jsonb_build_object('runs', count(*), 'costUsd', round(coalesce(sum(r.cost_usd), 0), 4)) from public.ai_runs r
      where r.created_at >= date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh' and r.status in ('started', 'ok', 'error', 'refused')));
end $$;

-- Tìm người để cấp (đang làm việc), kèm đã được cấp chưa.
create or replace function public.ai_admin_people_v1(p_search text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare q text := lower(btrim(coalesce(p_search, '')));
begin
  if not public.is_admin() then raise exception 'AI_ADMIN_REQUIRED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'email', u.email, 'role', u.role,
      'granted', exists (select 1 from public.ai_user_grants g where g.user_id = u.id)) order by u.name)
    from (select * from public.users u where coalesce(u.is_active, true) and coalesce(u.account_status, 'ACTIVE') = 'ACTIVE'
            and (q = '' or lower(u.name) like '%' || q || '%' or lower(coalesce(u.email, '')) like '%' || q || '%')
          order by u.name limit 30) u), '[]'::jsonb);
end $$;

-- Cấp / sửa cho một hoặc nhiều người: mọi trường trong p ghi đè (null = theo mẫu).
create or replace function public.ai_admin_grant_save_v1(p_user_ids uuid[], p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  a uuid := public.current_app_user_id(); v_user uuid; v_old public.ai_user_grants; v_new public.ai_user_grants; n integer := 0;
  v_skills text[] := case when jsonb_typeof(p->'skills') = 'array' then array(select jsonb_array_elements_text(p->'skills')) end;
begin
  if not public.is_admin() then raise exception 'AI_ADMIN_REQUIRED' using errcode = '42501'; end if;
  if coalesce(array_length(p_user_ids, 1), 0) = 0 or array_length(p_user_ids, 1) > 100 then raise exception 'AI_GRANT_USERS_REQUIRED' using errcode = '22023'; end if;
  if v_skills is not null and exists (select 1 from unnest(v_skills) x where not exists (select 1 from public.ai_skills s where s.code = x)) then
    raise exception 'AI_GRANT_BAD_SKILL' using errcode = '22023';
  end if;
  foreach v_user in array p_user_ids loop
    select * into v_old from public.ai_user_grants where user_id = v_user;
    insert into public.ai_user_grants (user_id, enabled, template_id, connection_id, monthly_cost_cap_usd, daily_question_cap, skills, note, created_by, updated_by)
    values (v_user, coalesce((p->>'enabled')::boolean, true), nullif(p->>'templateId', '')::uuid, nullif(p->>'connectionId', '')::uuid,
      nullif(p->>'monthlyCostCapUsd', '')::numeric, nullif(p->>'dailyQuestionCap', '')::int, v_skills, nullif(left(btrim(coalesce(p->>'note', '')), 300), ''), a, a)
    on conflict (user_id) do update set enabled = excluded.enabled, template_id = excluded.template_id, connection_id = excluded.connection_id,
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
begin
  if not public.is_admin() then raise exception 'AI_ADMIN_REQUIRED' using errcode = '42501'; end if;
  if exists (select 1 from unnest(v_skills) x where not exists (select 1 from public.ai_skills s where s.code = x)) then raise exception 'AI_GRANT_BAD_SKILL' using errcode = '22023'; end if;
  if v_id is null then
    insert into public.ai_grant_templates (name, connection_id, monthly_cost_cap_usd, daily_question_cap, skills, note, created_by, updated_by)
    values (btrim(p->>'name'), nullif(p->>'connectionId', '')::uuid, nullif(p->>'monthlyCostCapUsd', '')::numeric, nullif(p->>'dailyQuestionCap', '')::int, v_skills,
      nullif(left(btrim(coalesce(p->>'note', '')), 300), ''), a, a) returning * into t;
  else
    update public.ai_grant_templates set name = btrim(p->>'name'), connection_id = nullif(p->>'connectionId', '')::uuid,
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

create or replace function public.ai_admin_template_delete_v1(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare t public.ai_grant_templates;
begin
  if not public.is_admin() then raise exception 'AI_ADMIN_REQUIRED' using errcode = '42501'; end if;
  if exists (select 1 from public.ai_user_grants where template_id = p_id) then raise exception 'AI_TEMPLATE_IN_USE' using errcode = '23503'; end if;
  delete from public.ai_grant_templates where id = p_id returning * into t;
  if t.id is null then raise exception 'AI_TEMPLATE_NOT_FOUND' using errcode = 'P0002'; end if;
  perform app_private.ai_admin_audit('template:' || t.id, t.name, 'DELETE', to_jsonb(t), '{}'::jsonb, 'Xóa mẫu cấp AI');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.ai_admin_skill_access_v1(p_code text, p_access text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_old text;
begin
  if not public.is_admin() then raise exception 'AI_ADMIN_REQUIRED' using errcode = '42501'; end if;
  if p_access not in ('everyone', 'granted') then raise exception 'AI_BAD_ACCESS' using errcode = '22023'; end if;
  select access into v_old from public.ai_skills where code = p_code;
  if v_old is null then raise exception 'AI_SKILL_UNKNOWN' using errcode = 'P0002'; end if;
  update public.ai_skills set access = p_access, updated_at = now() where code = p_code;
  perform app_private.ai_admin_audit('skill:' || p_code, p_code, 'UPDATE', jsonb_build_object('access', v_old), jsonb_build_object('access', p_access),
    case when p_access = 'granted' then 'Skill AI chỉ cho người được cấp' else 'Skill AI cho mọi người' end);
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.get_my_ai_access_v1(), public.get_ai_admin_overview_v1(), public.ai_admin_people_v1(text), public.ai_admin_grant_save_v1(uuid[], jsonb),
  public.ai_admin_template_save_v1(jsonb), public.ai_admin_template_delete_v1(uuid), public.ai_admin_skill_access_v1(text, text) from public, anon;
grant execute on function public.get_my_ai_access_v1(), public.get_ai_admin_overview_v1(), public.ai_admin_people_v1(text), public.ai_admin_grant_save_v1(uuid[], jsonb),
  public.ai_admin_template_save_v1(jsonb), public.ai_admin_template_delete_v1(uuid), public.ai_admin_skill_access_v1(text, text) to authenticated;
