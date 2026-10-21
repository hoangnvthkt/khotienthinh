-- Trợ lý v2 · rào chắn + chi phí (chủ SP 18/10/2026, câu 6 mục 9 doc Vioo AI):
--
-- 1. Quản trị AI = Admin Hoàng: người phụ trách mọi skill AI chưa có người phụ trách. Trần chi phí tháng 20 USD.
-- 2. Trần chỉ có hiệu lực khi biết chi phí từng lượt: giá USD mỗi 1 triệu token theo từng kết nối (Cài đặt → Kết nối).
--    Điền sẵn RevidAPI theo bảng giá revidapi.com (gói Starter 99.000đ / 1.500 credit), quy USD theo 26.000đ (Vietcombank bán ra
--    ~26.090đ ngày 15/10/2026): claude-sonnet-5-5 vào 8.514đ ≈ 0,3275 · ra 42.583đ ≈ 1,6378; deepseek-v4.1-flash vào / ra 2.500đ ≈ 0,0962.
-- 3. Chống spam Trợ lý: mỗi người tối đa 6 câu / phút và chỉ một câu đang trả lời một lúc (lượt "đang chạy" quá 2 phút không tính).
--    Bị chặn vẫn ghi nhật ký (quota · AI_RATE / AI_BUSY) để Quản trị AI thấy.

alter table public.integration_connections
  add column if not exists price_in_per_m numeric(10, 4) check (price_in_per_m is null or price_in_per_m between 0 and 1000),
  add column if not exists price_out_per_m numeric(10, 4) check (price_out_per_m is null or price_out_per_m between 0 and 1000);
comment on column public.integration_connections.price_in_per_m is 'USD mỗi 1 triệu token đầu vào — để tính chi phí từng lượt AI và trần tháng.';
comment on column public.integration_connections.price_out_per_m is 'USD mỗi 1 triệu token đầu ra.';

update public.integration_connections set price_in_per_m = 0.3275, price_out_per_m = 1.6378
  where base_url like 'https://revidapi.com%' and model = 'claude-sonnet-5-5' and price_in_per_m is null and price_out_per_m is null;
update public.integration_connections set price_in_per_m = 0.0962, price_out_per_m = 0.0962
  where base_url like 'https://revidapi.com%' and model = 'deepseek-v4.1-flash' and price_in_per_m is null and price_out_per_m is null;

update public.ai_settings set monthly_cost_cap_usd = 20, updated_at = now() where id = 1;
update public.ai_skills set owner_user_id = (select u.id from public.users u where u.name = 'Admin Hoàng' and u.role::text = 'ADMIN' and u.is_active limit 1), updated_at = now()
  where owner_user_id is null;

alter table public.ai_skills
  add column if not exists per_minute_limit integer check (per_minute_limit is null or per_minute_limit between 1 and 600),
  add column if not exists max_concurrent integer check (max_concurrent is null or max_concurrent between 1 and 20);
comment on column public.ai_skills.per_minute_limit is 'Tối đa lượt mỗi người mỗi phút (null = không giới hạn) — chống gửi dồn dập.';
comment on column public.ai_skills.max_concurrent is 'Tối đa lượt đang chạy cùng lúc mỗi người (null = không giới hạn).';
update public.ai_skills set per_minute_limit = 6, max_concurrent = 1 where code = 'assistant_chat';

-- Kết nối: thêm giá vào dòng trả về màn hình và đích của edge function.
create or replace function app_private.integration_row(c public.integration_connections)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'kind', c.kind, 'name', c.name, 'baseUrl', c.base_url, 'model', c.model,
    'hasKey', c.secret_id is not null, 'keyHint', c.key_hint, 'enabled', c.enabled, 'status', c.status,
    'lastTestedAt', c.last_tested_at, 'lastTest', c.last_test, 'updatedAt', c.updated_at,
    'priceInPerM', c.price_in_per_m, 'priceOutPerM', c.price_out_per_m,
    'updatedByName', (select u.name from public.users u where u.id = c.updated_by));
$$;

create or replace function app_private.integration_secret_v1(p_id uuid default null, p_feature text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.integration_connections; v_key text;
begin
  if p_id is null and p_feature is not null then
    select x.* into c from public.integration_assignments a join public.integration_connections x on x.id = a.connection_id
      where a.feature = p_feature and x.enabled;
  else
    select * into c from public.integration_connections where id = p_id;
  end if;
  if c.id is null then return null; end if;
  select s.decrypted_secret into v_key from vault.decrypted_secrets s where s.id = c.secret_id;
  return jsonb_build_object('id', c.id, 'kind', c.kind, 'name', c.name, 'baseUrl', c.base_url, 'model', c.model, 'enabled', c.enabled, 'apiKey', v_key,
    'priceInPerM', c.price_in_per_m, 'priceOutPerM', c.price_out_per_m);
end $$;
revoke all on function app_private.integration_secret_v1(uuid, text) from public, anon, authenticated;
grant execute on function app_private.integration_secret_v1(uuid, text) to service_role;

-- Admin thêm / sửa kết nối: như cũ + giá (chỉ đổi khi màn hình gửi trường giá; chuỗi rỗng = xóa giá).
create or replace function public.save_integration_connection_v1(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  a uuid := public.current_app_user_id();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_key text := nullif(btrim(coalesce(p->>'apiKey', '')), '');
  v_kind text := coalesce(nullif(p->>'kind', ''), 'openai_compatible');
  v_name text := btrim(coalesce(p->>'name', ''));
  v_url text := rtrim(btrim(coalesce(p->>'baseUrl', '')), '/');
  v_model text := nullif(btrim(coalesce(p->>'model', '')), '');
  v_price_in numeric := nullif(btrim(coalesce(p->>'priceInPerM', '')), '')::numeric;
  v_price_out numeric := nullif(btrim(coalesce(p->>'priceOutPerM', '')), '')::numeric;
  c public.integration_connections;
  v_secret uuid;
  v_changed boolean;
begin
  if not public.is_admin() then raise exception 'INTEGRATIONS_ADMIN_REQUIRED' using errcode = '42501'; end if;
  if v_key is not null and length(v_key) > 4000 then raise exception 'INTEGRATIONS_KEY_TOO_LONG' using errcode = '22023'; end if;
  if (v_price_in is not null and (v_price_in < 0 or v_price_in > 1000)) or (v_price_out is not null and (v_price_out < 0 or v_price_out > 1000)) then
    raise exception 'INTEGRATIONS_BAD_PRICE' using errcode = '22023';
  end if;
  if v_id is null then
    if v_key is null then raise exception 'INTEGRATIONS_KEY_REQUIRED' using errcode = '22023'; end if;
    insert into public.integration_connections (kind, name, base_url, model, enabled, price_in_per_m, price_out_per_m, created_by, updated_by)
      values (v_kind, v_name, v_url, v_model, coalesce((p->>'enabled')::boolean, true), v_price_in, v_price_out, a, a) returning * into c;
    v_secret := vault.create_secret(v_key, 'integration:' || c.id::text, 'Kết nối ' || v_name);
    update public.integration_connections set secret_id = v_secret, key_hint = right(v_key, 4) where id = c.id returning * into c;
    perform app_private.integration_audit(c.id::text, c.name, 'INSERT', 'Thêm kết nối',
      jsonb_build_object('kind', c.kind, 'baseUrl', c.base_url, 'model', c.model, 'priceInPerM', c.price_in_per_m, 'priceOutPerM', c.price_out_per_m));
  else
    select * into c from public.integration_connections where id = v_id for update;
    if c.id is null then raise exception 'INTEGRATIONS_NOT_FOUND' using errcode = 'P0002'; end if;
    v_changed := v_key is not null or v_url <> c.base_url or v_kind <> c.kind;
    if v_key is not null then
      if c.secret_id is null then
        v_secret := vault.create_secret(v_key, 'integration:' || c.id::text, 'Kết nối ' || v_name);
      else
        perform vault.update_secret(c.secret_id, v_key);
        v_secret := c.secret_id;
      end if;
    else
      v_secret := c.secret_id;
    end if;
    update public.integration_connections set
      kind = v_kind, name = v_name, base_url = v_url, model = v_model,
      enabled = coalesce((p->>'enabled')::boolean, enabled),
      price_in_per_m = case when p ? 'priceInPerM' then v_price_in else price_in_per_m end,
      price_out_per_m = case when p ? 'priceOutPerM' then v_price_out else price_out_per_m end,
      secret_id = v_secret, key_hint = case when v_key is not null then right(v_key, 4) else key_hint end,
      status = case when v_changed then 'untested' else status end,
      last_test = case when v_changed then '{}'::jsonb else last_test end,
      updated_by = a, updated_at = now()
    where id = c.id returning * into c;
    perform app_private.integration_audit(c.id::text, c.name, 'UPDATE', case when v_key is not null then 'Thay khóa kết nối' else 'Sửa kết nối' end,
      jsonb_build_object('kind', c.kind, 'baseUrl', c.base_url, 'model', c.model, 'enabled', c.enabled, 'keyChanged', v_key is not null,
        'priceInPerM', c.price_in_per_m, 'priceOutPerM', c.price_out_per_m));
  end if;
  return app_private.integration_row(c);
end $$;

-- Mở một lượt: như cũ + chống gửi dồn dập (một lượt đang chạy / mỗi phút) theo cấu hình từng skill.
create or replace function public.ai_gateway_begin_v1(p_skill text, p_context jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  a uuid := public.current_app_user_id();
  s public.ai_skills; st public.ai_settings;
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
comment on function public.ai_gateway_begin_v1(text, jsonb) is 'Cổng AI: mở một lượt (quyền theo bậc, công tắc, một lượt đang chạy, hạn mức phút / ngày, trần tháng) và ghi nhật ký.';
