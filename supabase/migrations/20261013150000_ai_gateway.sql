-- Cổng AI chung (chủ SP 11–13/10/2026, doc audit mục 5–7): một cổng cho mọi skill AI, chạy bằng phiên người dùng, có nhật ký và hạn mức.
--   * ai_skills: danh sách skill — bậc (nền / nghiệp vụ / phân tích / điều hành → quyền ai.*), chế độ (đọc / nháp / tự chạy),
--     bật tắt, lượt mỗi người mỗi ngày, lớp model (nhanh / suy luận), người phụ trách.
--   * ai_settings: công tắc chung, trần lượt tháng, trần chi phí tháng (USD). Khóa API đặt ở secrets của edge function, không ở DB.
--   * ai_runs: nhật ký từng lượt — ai gọi, skill nào, trạng thái, token, chi phí, thời gian, người chấp nhận hay bỏ. Không lưu nội dung.
--   * ai_gateway_begin_v1 / finish_v1 / feedback_v1: edge function ai-gateway gọi bằng JWT người dùng. Admin: overview + set.
--   Chưa có khóa AI: lượt vẫn ghi 'no_provider' để thấy nhu cầu; form thường vẫn chạy.

create table if not exists public.ai_skills (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{2,40}$'),
  name text not null,
  description text not null default '',
  tier text not null default 'base' check (tier in ('base', 'ops', 'analysis', 'executive')),
  mode text not null default 'read' check (mode in ('read', 'draft', 'auto')),
  enabled boolean not null default true,
  daily_limit integer not null default 50 check (daily_limit between 0 and 10000),
  model_class text not null default 'fast' check (model_class in ('fast', 'reasoning')),
  owner_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.ai_skills is 'Cổng AI: danh sách skill, bậc quyền, chế độ, bật tắt, hạn mức ngày, lớp model, người phụ trách.';

create table if not exists public.ai_settings (
  id integer primary key check (id = 1),
  enabled boolean not null default true,
  monthly_run_cap integer not null default 3000 check (monthly_run_cap >= 0),
  monthly_cost_cap_usd numeric(10, 2) not null default 50 check (monthly_cost_cap_usd >= 0),
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
comment on table public.ai_settings is 'Cổng AI: công tắc chung và trần tháng (lượt, USD). Vượt trần thì AI tạm dừng, form thường vẫn chạy.';
insert into public.ai_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  skill_code text not null references public.ai_skills(code) on delete restrict,
  status text not null default 'started' check (status in ('started', 'ok', 'denied', 'quota', 'no_provider', 'refused', 'error')),
  provider text,
  model text,
  input_chars integer not null default 0 check (input_chars >= 0),
  output_chars integer not null default 0 check (output_chars >= 0),
  tokens_in integer,
  tokens_out integer,
  cost_usd numeric(10, 5),
  duration_ms integer,
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object'),
  summary text,
  error text,
  accepted boolean,
  feedback_at timestamptz,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
comment on table public.ai_runs is 'Cổng AI: nhật ký từng lượt (ai, skill, trạng thái, token, chi phí, chấp nhận). Chỉ id nguồn trong context, không lưu nội dung.';
create index if not exists ai_runs_skill_created_idx on public.ai_runs (skill_code, created_at desc);
create index if not exists ai_runs_user_created_idx on public.ai_runs (user_id, created_at desc);
create index if not exists ai_runs_created_idx on public.ai_runs (created_at desc);

alter table public.ai_skills enable row level security;
alter table public.ai_settings enable row level security;
alter table public.ai_runs enable row level security;
drop policy if exists ai_skills_select on public.ai_skills;
create policy ai_skills_select on public.ai_skills for select to authenticated using (true);
drop policy if exists ai_settings_select on public.ai_settings;
create policy ai_settings_select on public.ai_settings for select to authenticated using (public.is_admin());
drop policy if exists ai_runs_select on public.ai_runs;
create policy ai_runs_select on public.ai_runs for select to authenticated
  using (user_id = public.current_app_user_id() or public.is_admin());
grant select on public.ai_skills, public.ai_settings, public.ai_runs to authenticated;

insert into public.ai_skills (code, name, description, tier, mode, enabled, daily_limit, model_class) values
  ('text_summary', 'Tóm tắt văn bản', 'Tóm tắt đoạn văn bản người dùng đưa vào: ý chính, việc cần làm, thời hạn. Chỉ đọc.', 'base', 'read', true, 30, 'fast'),
  ('gateway_check', 'Kiểm tra kết nối', 'Admin gọi thử một câu ngắn để xác nhận khóa và model chạy được.', 'executive', 'read', true, 20, 'fast')
on conflict (code) do nothing;

-- Bậc skill → quyền: nền = mọi người đang hoạt động; nghiệp vụ = ai.assistant.use; phân tích = ai.report.generate; điều hành = ai.executive.view. Admin đi mọi bậc.
create or replace function app_private.ai_tier_allowed(p_tier text, p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user_id is not null and (
    public.is_admin()
    or case p_tier
      when 'base' then true
      when 'ops' then app_private.ai_has_action('ai.assistant.use', p_user_id)
      when 'analysis' then app_private.ai_has_action('ai.report.generate', p_user_id)
      when 'executive' then app_private.ai_has_action('ai.executive.view', p_user_id)
      else false end);
$$;
revoke all on function app_private.ai_tier_allowed(text, uuid) from public, anon;

-- Mở một lượt: kiểm quyền theo bậc, công tắc, hạn mức ngày (theo giờ VN) và trần tháng; ghi dòng nhật ký rồi trả runId.
create or replace function public.ai_gateway_begin_v1(p_skill text, p_context jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  a uuid := public.current_app_user_id();
  s public.ai_skills; st public.ai_settings;
  v_ctx jsonb; v_day timestamptz; v_month timestamptz;
  used_today integer; used_month integer; cost_month numeric; r uuid;
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

  -- Khóa theo người để hạn mức ngày / tháng tính đúng khi gọi song song.
  perform pg_advisory_xact_lock(hashtextextended('ai-gateway-' || a::text, 0));
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
    'usedToday', used_today, 'dailyLimit', s.daily_limit);
end $$;
comment on function public.ai_gateway_begin_v1(text, jsonb) is 'Cổng AI: mở một lượt (quyền theo bậc, công tắc, hạn mức ngày, trần tháng) và ghi nhật ký.';

-- Kết thúc lượt: chỉ chủ lượt, chỉ lượt đang 'started'. Nội dung không lưu — chỉ số ký tự, token, chi phí, một dòng tóm tắt ngắn.
create or replace function public.ai_gateway_finish_v1(p_run_id uuid, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare a uuid := public.current_app_user_id(); v_status text := coalesce(p->>'status', 'error');
begin
  if a is null then raise exception 'AI_DENIED' using errcode = '42501'; end if;
  if v_status not in ('ok', 'no_provider', 'refused', 'error') then v_status := 'error'; end if;
  update public.ai_runs set
    status = v_status,
    provider = left(p->>'provider', 40), model = left(p->>'model', 120),
    input_chars = greatest(coalesce((p->>'inputChars')::integer, 0), 0), output_chars = greatest(coalesce((p->>'outputChars')::integer, 0), 0),
    tokens_in = (p->>'tokensIn')::integer, tokens_out = (p->>'tokensOut')::integer,
    cost_usd = (p->>'costUsd')::numeric, duration_ms = (p->>'durationMs')::integer,
    summary = left(p->>'summary', 300), error = left(p->>'error', 500), finished_at = now()
  where id = p_run_id and user_id = a and status = 'started';
  if not found then raise exception 'AI_RUN_NOT_FOUND' using errcode = 'P0002'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- Người dùng cho biết dùng nguyên / bỏ kết quả — tỷ lệ chấp nhận theo skill (dưới 50% hai tuần thì xem lại).
create or replace function public.ai_gateway_feedback_v1(p_run_id uuid, p_accepted boolean)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare a uuid := public.current_app_user_id();
begin
  if a is null then raise exception 'AI_DENIED' using errcode = '42501'; end if;
  update public.ai_runs set accepted = p_accepted, feedback_at = now() where id = p_run_id and user_id = a and status = 'ok';
  if not found then raise exception 'AI_RUN_NOT_FOUND' using errcode = 'P0002'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- Admin: cài đặt, tháng này, từng skill (cấu hình + dùng trong N ngày), 20 lượt gần nhất.
create or replace function public.get_ai_gateway_overview_v1(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_days integer := least(greatest(coalesce(p_days, 30), 1), 365); v_from timestamptz; v_month timestamptz;
  v_settings jsonb; v_month_stats jsonb; v_skills jsonb; v_recent jsonb;
begin
  if not public.is_admin() then raise exception 'AI_ADMIN_REQUIRED' using errcode = '42501'; end if;
  v_from := now() - make_interval(days => v_days);
  v_month := date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh';

  select jsonb_build_object('enabled', st.enabled, 'monthlyRunCap', st.monthly_run_cap, 'monthlyCostCapUsd', st.monthly_cost_cap_usd,
      'updatedAt', st.updated_at, 'updatedByName', u.name)
    into v_settings from public.ai_settings st left join public.users u on u.id = st.updated_by where st.id = 1;

  select jsonb_build_object('runs', count(*) filter (where r.status in ('ok', 'error', 'refused', 'started')),
      'ok', count(*) filter (where r.status = 'ok'), 'errors', count(*) filter (where r.status in ('error', 'refused')),
      'noProvider', count(*) filter (where r.status = 'no_provider'), 'quota', count(*) filter (where r.status = 'quota'),
      'denied', count(*) filter (where r.status = 'denied'), 'users', count(distinct r.user_id),
      'costUsd', sum(r.cost_usd), 'costKnown', bool_or(r.cost_usd is not null))
    into v_month_stats from public.ai_runs r where r.created_at >= v_month;

  select coalesce(jsonb_agg(jsonb_build_object(
      'code', s.code, 'name', s.name, 'description', s.description, 'tier', s.tier, 'mode', s.mode, 'enabled', s.enabled,
      'dailyLimit', s.daily_limit, 'modelClass', s.model_class, 'ownerUserId', s.owner_user_id, 'ownerName', o.name,
      'runs', u.runs, 'ok', u.ok, 'errors', u.errors, 'noProvider', u.no_provider, 'quota', u.quota, 'denied', u.denied,
      'users', u.users, 'acceptedRate', u.accepted_rate, 'feedbacks', u.feedbacks, 'avgMs', u.avg_ms, 'lastAt', u.last_at)
    order by s.tier, s.code), '[]'::jsonb)
    into v_skills
  from public.ai_skills s
  left join public.users o on o.id = s.owner_user_id
  left join lateral (
    select count(*) filter (where r.status in ('ok', 'error', 'refused', 'started')) runs,
      count(*) filter (where r.status = 'ok') ok, count(*) filter (where r.status in ('error', 'refused')) errors,
      count(*) filter (where r.status = 'no_provider') no_provider, count(*) filter (where r.status = 'quota') quota,
      count(*) filter (where r.status = 'denied') denied, count(distinct r.user_id) users,
      count(*) filter (where r.accepted is not null) feedbacks,
      case when count(*) filter (where r.accepted is not null) > 0
        then round(100.0 * count(*) filter (where r.accepted) / count(*) filter (where r.accepted is not null)) end accepted_rate,
      round(avg(r.duration_ms) filter (where r.status = 'ok')) avg_ms, max(r.created_at) last_at
    from public.ai_runs r where r.skill_code = s.code and r.created_at >= v_from
  ) u on true;

  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'createdAt', r.created_at, 'userName', u.name, 'skillCode', r.skill_code,
      'status', r.status, 'provider', r.provider, 'model', r.model, 'durationMs', r.duration_ms, 'costUsd', r.cost_usd,
      'accepted', r.accepted, 'error', r.error) order by r.created_at desc), '[]'::jsonb)
    into v_recent
  from (select * from public.ai_runs order by created_at desc limit 20) r
  left join public.users u on u.id = r.user_id;

  return jsonb_build_object('days', v_days, 'from', v_from, 'settings', v_settings, 'month', v_month_stats, 'skills', v_skills, 'recent', v_recent);
end $$;

create or replace function public.set_ai_skill_v1(p_code text, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare s public.ai_skills;
begin
  if not public.is_admin() then raise exception 'AI_ADMIN_REQUIRED' using errcode = '42501'; end if;
  update public.ai_skills set
    enabled = coalesce((p->>'enabled')::boolean, enabled),
    daily_limit = coalesce((p->>'dailyLimit')::integer, daily_limit),
    model_class = coalesce(nullif(p->>'modelClass', ''), model_class),
    owner_user_id = case when p ? 'ownerUserId' then nullif(p->>'ownerUserId', '')::uuid else owner_user_id end,
    updated_at = now()
  where code = p_code returning * into s;
  if s.code is null then raise exception 'AI_SKILL_UNKNOWN' using errcode = 'P0002'; end if;
  return jsonb_build_object('code', s.code, 'enabled', s.enabled, 'dailyLimit', s.daily_limit, 'modelClass', s.model_class, 'ownerUserId', s.owner_user_id);
end $$;

create or replace function public.set_ai_settings_v1(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare st public.ai_settings;
begin
  if not public.is_admin() then raise exception 'AI_ADMIN_REQUIRED' using errcode = '42501'; end if;
  update public.ai_settings set
    enabled = coalesce((p->>'enabled')::boolean, enabled),
    monthly_run_cap = coalesce((p->>'monthlyRunCap')::integer, monthly_run_cap),
    monthly_cost_cap_usd = coalesce((p->>'monthlyCostCapUsd')::numeric, monthly_cost_cap_usd),
    updated_by = public.current_app_user_id(), updated_at = now()
  where id = 1 returning * into st;
  return jsonb_build_object('enabled', st.enabled, 'monthlyRunCap', st.monthly_run_cap, 'monthlyCostCapUsd', st.monthly_cost_cap_usd, 'updatedAt', st.updated_at);
end $$;

revoke all on function public.ai_gateway_begin_v1(text, jsonb), public.ai_gateway_finish_v1(uuid, jsonb), public.ai_gateway_feedback_v1(uuid, boolean),
  public.get_ai_gateway_overview_v1(integer), public.set_ai_skill_v1(text, jsonb), public.set_ai_settings_v1(jsonb) from public, anon;
grant execute on function public.ai_gateway_begin_v1(text, jsonb), public.ai_gateway_finish_v1(uuid, jsonb), public.ai_gateway_feedback_v1(uuid, boolean),
  public.get_ai_gateway_overview_v1(integer), public.set_ai_skill_v1(text, jsonb), public.set_ai_settings_v1(jsonb) to authenticated;
