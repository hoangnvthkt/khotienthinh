-- B4 bản tin Admin tuần: tín hiệu + 3 việc dựng được từ số thật; chạy thử (không gửi) không tạo thông báo; gửi tạo thông báo cho mọi Admin
-- (push_enabled) và không gửi trùng; nhân viên thường bị chặn 42501; cron có lịch. Rollback.
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261027120000_ai_admin_weekly_digest.sql --smoke supabase/tests/ai_admin_weekly_digest_smoke.sql
begin;
create temp table lp(name text primary key, user_id uuid, email text, auth_id uuid) on commit drop;
grant select on lp to authenticated;
insert into lp select 'staff', gen_random_uuid(), 'lp-' || gen_random_uuid() || '@invalid.local', null;
insert into public.users(id, name, username, email, role, is_active, account_status)
  select user_id, 'LP staff', 'lp-' || user_id, email, 'EMPLOYEE'::public.user_role, true, 'ACTIVE' from lp;
insert into lp select 'admin', u.id, u.email, u.auth_id from public.users u where u.name = 'Admin Hoàng' and u.auth_id is not null limit 1;

do $$
declare s jsonb; p jsonb; n int;
begin
  s := app_private.ai_admin_digest_signals(current_date - 7, current_date);
  if (s->'assistant'->>'runs') is null or (s->'feedback'->>'open') is null or (s->'stale'->>'wfRunningStale7d') is null then raise exception 'FAIL 1 tín hiệu thiếu: %', left(s::text, 300); end if;
  p := app_private.ai_admin_digest_picks(s);
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 3 then raise exception 'FAIL 2 picks: %', p; end if;
  p := app_private.ai_admin_digest_picks('{"assistant":{"errors":5,"errorCodes":[{"code":"AI_TIMEOUT","n":5}],"dislikes":2,"dislikeReasons":[{"reason":"wrong_data","n":2}],"idleCount":10,"granted":16,"idle":["A","B"],"slow":4,"slowSkills":[{"skill":"assistant_chat","n":4,"p95":58000}],"jev":{"auto":20,"autoAgree":14}},"feedback":{"new":3,"fromAssistant":1,"open":5,"oldestOpenDays":40,"urgentOpen":1},"stale":{"leavePending3d":4,"wfRunningStale7d":37,"requestPending3d":2,"captureUnreceived3d":1,"poDraft7d":9,"requestDraft7d":9,"dailyLogDraft3d":50}}'::jsonb);
  if jsonb_array_length(p) <> 3 then raise exception 'FAIL 3 phải đúng 3 việc: %', p; end if;
  if p->0->>'key' <> 'approvals_stale' or p->1->>'key' <> 'feedback_new' or p->2->>'key' <> 'ai_errors' then raise exception 'FAIL 4 thứ tự: %', (select string_agg(x->>'key', ',') from jsonb_array_elements(p) x); end if;
  if p->1->>'title' !~ '3 góp ý' or p->1->>'title' !~ '1 khẩn' then raise exception 'FAIL 5 tiêu đề: %', p->1->>'title'; end if;
  if jsonb_array_length(app_private.ai_admin_digest_picks('{}'::jsonb)) <> 0 then raise exception 'FAIL 6 rỗng phải 0 việc'; end if;
  if not exists (select 1 from cron.job where jobname = 'ai-admin-weekly-digest' and schedule = '0 0 * * 1') then raise exception 'FAIL 7 cron chưa có'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', user_id, 'email', email, 'role', 'authenticated')::text, true) from lp where name = 'staff';
do $$ begin
  begin perform public.ai_admin_digest_run_v1(null, false); raise exception 'FAIL 8 nhân viên chạy được bản tin'; exception when insufficient_privilege then null; end;
  if public.ai_admin_digest_list_v1(5) is not null then raise exception 'FAIL 9 nhân viên đọc được danh sách'; end if;
end $$;

select set_config('request.jwt.claims', jsonb_build_object('sub', auth_id, 'email', email, 'role', 'authenticated')::text, true) from lp where name = 'admin';
do $$
declare r jsonb; v_before int; v_after int; v_admins int; v_start date := date_trunc('week', (now() at time zone 'Asia/Ho_Chi_Minh')::date)::date - 7;
begin
  select count(*) into v_before from public.notifications where source_type = 'ai_admin_digest';
  r := public.ai_admin_digest_run_v1(v_start, false);
  if (r->>'week_start')::date <> v_start or r->>'sent_at' is not null or (r->>'recipients')::int <> 0 then raise exception 'FAIL 10 chạy thử: %', left(r::text, 300); end if;
  select count(*) into v_after from public.notifications where source_type = 'ai_admin_digest';
  if v_after <> v_before then raise exception 'FAIL 11 chạy thử mà có thông báo'; end if;
  if jsonb_array_length(public.ai_admin_digest_list_v1(5)) < 1 then raise exception 'FAIL 12 danh sách rỗng'; end if;
  begin perform public.ai_admin_digest_run_v1(v_start + 1, false); raise exception 'FAIL 13 không phải Thứ Hai vẫn chạy'; exception when invalid_parameter_value then null; end;
  r := public.ai_admin_digest_run_v1(v_start, true);
  select count(*) into v_admins from public.users u where u.role = 'ADMIN' and u.is_active and u.account_status = 'ACTIVE';
  if r->>'sent_at' is null or (r->>'recipients')::int <> v_admins then raise exception 'FAIL 14 gửi: recipients % / admin %', r->>'recipients', v_admins; end if;
  select count(*) into v_after from public.notifications where source_type = 'ai_admin_digest' and push_enabled;
  if v_after - v_before <> v_admins then raise exception 'FAIL 15 thông báo push: % mới', v_after - v_before; end if;
  r := public.ai_admin_digest_run_v1(v_start, true);
  select count(*) into v_after from public.notifications where source_type = 'ai_admin_digest';
  if v_after - v_before <> v_admins then raise exception 'FAIL 16 gửi trùng'; end if;
end $$;

reset role;
do $$ begin
  -- Cron (chạy bằng chủ DB): tuần vừa qua đã gửi ở trên → không gửi lại.
  if app_private.ai_admin_send_digest(now()) <> 0 then raise exception 'FAIL 17 cron gửi lại tuần đã gửi'; end if;
  raise notice 'SMOKE OK';
end $$;
rollback;
