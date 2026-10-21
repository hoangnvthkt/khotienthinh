-- Cổng AI chung: bảng, quyền theo bậc, hạn mức ngày / trần tháng, nhật ký. Chạy rollback trên Cloud (không ghi sổ):
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261013150000_ai_gateway.sql --smoke supabase/tests/ai_gateway_smoke.sql
do $$
declare v_admin record; v_user record; v_out jsonb; v_run uuid; v_n integer;
begin
  if to_regprocedure('public.ai_gateway_begin_v1(text,jsonb)') is null then raise exception 'FAIL 1 thiếu hàm begin'; end if;
  if (select count(*) from public.ai_skills where code in ('text_summary', 'gateway_check')) <> 2 then raise exception 'FAIL 1 thiếu skill mẫu'; end if;
  if (select count(*) from public.ai_settings where id = 1) <> 1 then raise exception 'FAIL 1 thiếu dòng cài đặt'; end if;

  -- 2. Không có người dùng: từ chối.
  begin
    perform public.ai_gateway_begin_v1('text_summary', '{}'::jsonb);
    raise exception 'FAIL 2 không có người dùng vẫn mở được lượt';
  exception when insufficient_privilege then null; end;
  begin
    perform public.get_ai_gateway_overview_v1(30);
    raise exception 'FAIL 2 không có người dùng vẫn xem được overview';
  exception when insufficient_privilege then null; end;

  -- 3. Giả lập Admin: mở lượt → ghi 'started' → kết thúc 'ok' → chấm nhận; overview thấy đủ khóa.
  select u.id, u.auth_id, u.email into v_admin from public.users u
    where u.role = 'ADMIN' and u.is_active and u.account_status = 'ACTIVE' and u.auth_id is not null order by u.created_at limit 1;
  if v_admin.id is null then raise exception 'FAIL 3 không có Admin hoạt động'; end if;
  perform set_config('request.jwt.claim.sub', v_admin.auth_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin.auth_id, 'role', 'authenticated', 'email', v_admin.email)::text, true);
  if not public.is_admin() then raise exception 'FAIL 3 giả lập Admin không nhận'; end if;

  v_out := public.ai_gateway_begin_v1('gateway_check', jsonb_build_object('from', 'smoke'));
  if v_out->>'code' <> 'OK' then raise exception 'FAIL 3 begin: %', v_out; end if;
  v_run := (v_out->>'runId')::uuid;
  if (select status from public.ai_runs where id = v_run) <> 'started' then raise exception 'FAIL 3 chưa ghi started'; end if;
  perform public.ai_gateway_finish_v1(v_run, jsonb_build_object('status', 'ok', 'provider', 'smoke', 'model', 'none', 'inputChars', 10, 'outputChars', 20,
    'tokensIn', 5, 'tokensOut', 7, 'durationMs', 12, 'summary', 'smoke'));
  if (select status || '/' || coalesce(tokens_in::text, '') from public.ai_runs where id = v_run) <> 'ok/5' then raise exception 'FAIL 3 finish không ghi'; end if;
  perform public.ai_gateway_feedback_v1(v_run, true);
  if (select accepted from public.ai_runs where id = v_run) is not true then raise exception 'FAIL 3 feedback không ghi'; end if;
  begin
    perform public.ai_gateway_finish_v1(v_run, '{"status":"ok"}'::jsonb);
    raise exception 'FAIL 3 kết thúc lượt đã xong mà vẫn được';
  exception when no_data_found then null; end;
  if public.ai_gateway_begin_v1('no_such_skill', '{}'::jsonb)->>'code' <> 'AI_SKILL_UNKNOWN' then raise exception 'FAIL 3 skill lạ'; end if;

  v_out := public.get_ai_gateway_overview_v1(30);
  if jsonb_typeof(v_out->'skills') <> 'array' or jsonb_typeof(v_out->'settings') <> 'object' or jsonb_typeof(v_out->'recent') <> 'array'
     or jsonb_typeof(v_out->'month'->'runs') <> 'number' then raise exception 'FAIL 3 overview sai hình: %', v_out; end if;
  if (select e->>'acceptedRate' from jsonb_array_elements(v_out->'skills') e where e->>'code' = 'gateway_check') <> '100' then raise exception 'FAIL 3 tỷ lệ chấp nhận sai'; end if;

  -- 4. Hạn mức ngày: đặt lượt/ngày = 1 cho text_summary → lượt thứ hai bị AI_QUOTA và ghi 'quota'.
  perform public.set_ai_skill_v1('text_summary', '{"dailyLimit": 1}'::jsonb);
  if public.ai_gateway_begin_v1('text_summary', '{}'::jsonb)->>'code' <> 'OK' then raise exception 'FAIL 4 lượt đầu phải OK'; end if;
  v_out := public.ai_gateway_begin_v1('text_summary', '{}'::jsonb);
  if v_out->>'code' <> 'AI_QUOTA' or v_out->>'reason' <> 'day' then raise exception 'FAIL 4 không chặn hạn mức ngày: %', v_out; end if;
  select count(*) into v_n from public.ai_runs where user_id = v_admin.id and skill_code = 'text_summary' and status = 'quota';
  if v_n < 1 then raise exception 'FAIL 4 không ghi lượt quota'; end if;

  -- 5. Công tắc chung tắt → AI_OFF; skill tắt → AI_SKILL_OFF.
  perform public.set_ai_settings_v1('{"enabled": false}'::jsonb);
  if public.ai_gateway_begin_v1('gateway_check', '{}'::jsonb)->>'code' <> 'AI_OFF' then raise exception 'FAIL 5 công tắc chung'; end if;
  perform public.set_ai_settings_v1('{"enabled": true}'::jsonb);
  perform public.set_ai_skill_v1('gateway_check', '{"enabled": false}'::jsonb);
  if public.ai_gateway_begin_v1('gateway_check', '{}'::jsonb)->>'code' <> 'AI_SKILL_OFF' then raise exception 'FAIL 5 công tắc skill'; end if;

  -- 6. Người thường (không phải Admin, không quyền ai.*): bậc nền được, bậc điều hành bị AI_DENIED.
  select u.id, u.auth_id, u.email into v_user from public.users u
    where u.role <> 'ADMIN' and u.is_active and u.account_status = 'ACTIVE' and u.auth_id is not null
      and not app_private.ai_has_action('ai.executive.view', u.id) order by u.created_at limit 1;
  if v_user.id is not null then
    perform set_config('request.jwt.claim.sub', v_user.auth_id::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user.auth_id, 'role', 'authenticated', 'email', v_user.email)::text, true);
    if public.is_admin() then raise exception 'FAIL 6 giả lập người thường vẫn là Admin'; end if;
    begin
      perform public.set_ai_skill_v1('gateway_check', '{"enabled": true}'::jsonb);
      raise exception 'FAIL 6 người thường sửa được skill';
    exception when insufficient_privilege then null; end;
    begin
      perform public.get_ai_gateway_overview_v1(30);
      raise exception 'FAIL 6 người thường xem được overview';
    exception when insufficient_privilege then null; end;
    if public.ai_gateway_begin_v1('text_summary', '{}'::jsonb)->>'code' not in ('OK', 'AI_QUOTA') then raise exception 'FAIL 6 người thường không dùng được bậc nền'; end if;
    -- Bậc điều hành kiểm trước công tắc skill: người thường bị AI_DENIED dù skill đang tắt.
    if public.ai_gateway_begin_v1('gateway_check', '{}'::jsonb)->>'code' <> 'AI_DENIED' then raise exception 'FAIL 6 người thường vào được bậc điều hành'; end if;
    if (select count(*) from public.ai_runs where user_id = v_user.id and status = 'denied') < 1 then raise exception 'FAIL 6 không ghi lượt denied'; end if;
    raise notice 'ai_gateway_smoke OK (người thường: %)', v_user.email;
  else
    raise notice 'ai_gateway_smoke OK (không có người thường để thử bậc)';
  end if;
end $$;
