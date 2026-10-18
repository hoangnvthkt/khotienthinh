-- J1 Jev chạy bóng: kết nối loại typesafe lưu được + gán tính năng ai.decisions; service lấy khóa theo tính năng; Trung tâm AI không liệt kê
-- kết nối typesafe làm model hội thoại; cổng ghi ai_decisions cho lượt của mình (một dòng / lượt), lượt lạ bị từ chối; Admin xem tổng kết,
-- nhân viên không xem được bảng lẫn tổng kết.
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261020110000_jev_shadow_route.sql --smoke supabase/tests/jev_shadow_route_smoke.sql
begin;
create temp table lp(name text primary key, user_id uuid, email text, auth_id uuid) on commit drop;
create temp table ld(key text primary key, value text) on commit drop;
grant select on lp to authenticated;
grant select, insert on ld to authenticated;
insert into lp select 'staff', gen_random_uuid(), 'lp-' || gen_random_uuid() || '@invalid.local', null;
insert into public.users(id, name, username, email, role, is_active, account_status)
  select user_id, 'LP staff', 'lp-' || user_id, email, 'EMPLOYEE'::public.user_role, true, 'ACTIVE' from lp;
insert into lp select 'admin', u.id, u.email, u.auth_id from public.users u where u.name = 'Admin Hoàng' and u.auth_id is not null limit 1;
update public.ai_settings set monthly_run_cap = 1000000, monthly_cost_cap_usd = 0 where id = 1;
update public.ai_skills set daily_limit = 1000, per_minute_limit = null, max_concurrent = null where code = 'assistant_chat';

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', auth_id, 'email', email, 'role', 'authenticated')::text, true) from lp where name = 'admin';
do $$
declare v_row jsonb; v_id uuid; o jsonb; r jsonb; d jsonb; s jsonb;
begin
  -- 1. Kết nối typesafe + gán ai.decisions.
  v_row := public.save_integration_connection_v1('{"kind":"typesafe","name":"TypeSafe Jev thử","baseUrl":"https://api.typesafe.ai/","apiKey":"ts-smoke-key-00Zz","model":"jev-1.14.0"}'::jsonb);
  v_id := (v_row->>'id')::uuid;
  if v_row->>'kind' <> 'typesafe' or v_row->>'keyHint' <> '00Zz' then raise exception 'FAIL 1 lưu kết nối typesafe: %', v_row; end if;
  insert into ld values ('conn', v_id::text);
  perform public.set_integration_assignment_v1('ai.decisions', v_id);
  begin perform public.set_integration_assignment_v1('ai.bay_bong', v_id); raise exception 'FAIL 1 tính năng lạ vẫn gán được'; exception when check_violation or no_data_found or others then null; end;
  -- 2. Trung tâm AI không đưa typesafe vào danh sách model.
  o := public.get_ai_admin_overview_v1();
  if exists (select 1 from jsonb_array_elements(o->'connections') c where c->>'id' = v_id::text) then raise exception 'FAIL 2 typesafe lọt vào danh sách model Trung tâm AI'; end if;
  if not exists (select 1 from jsonb_array_elements(o->'connections') c) then raise exception 'FAIL 2 danh sách model rỗng'; end if;
  -- 3. Cổng ghi quyết định cho lượt của mình; lượt thứ hai cùng loại → duplicate; lượt lạ → không tìm thấy.
  r := public.ai_gateway_begin_v1('assistant_chat', '{}'::jsonb);
  if r->>'code' <> 'OK' then raise exception 'FAIL 3 begin %', r; end if;
  insert into ld values ('run', r->>'runId');
  d := public.ai_decision_log_v1((r->>'runId')::uuid, jsonb_build_object('kind', 'intent_route', 'status', 'ok', 'model', 'jev-1.14.0', 'durationMs', 231, 'tokensIn', 410,
    'predicted', jsonb_build_object('intent', 'don_mua', 'confidence', 0.93, 'cam', 0.04, 'tier', 'auto', 'probabilities', jsonb_build_object('don_mua', 0.95)),
    'actual', jsonb_build_object('intent', 'don_mua', 'tools', jsonb_build_array('chuan_bi_don_mua'), 'refusal', null), 'agree', true));
  if (d->>'ok')::boolean is not true or d->>'id' is null then raise exception 'FAIL 3 ghi quyết định %', d; end if;
  d := public.ai_decision_log_v1((r->>'runId')::uuid, '{"kind":"intent_route","status":"error","error":"JEV_HTTP_429"}'::jsonb);
  if (d->>'duplicate')::boolean is not true then raise exception 'FAIL 3 lượt ghi hai lần phải báo duplicate %', d; end if;
  begin perform public.ai_decision_log_v1(gen_random_uuid(), '{"status":"ok"}'::jsonb); raise exception 'FAIL 3 lượt lạ vẫn ghi được'; exception when no_data_found then null; end;
  begin perform public.ai_decision_log_v1((r->>'runId')::uuid, '{"kind":"khac_loai","status":"ok"}'::jsonb); raise exception 'FAIL 3 loại lạ vẫn ghi được'; exception when invalid_parameter_value then null; end;
  perform public.ai_gateway_finish_v1((r->>'runId')::uuid, '{"status":"ok"}'::jsonb);
  -- 4. Admin xem tổng kết.
  s := public.get_ai_decisions_summary_v1(1);
  if (s->>'runs')::int < 1 or (s->>'agree')::int < 1 or (s->'tiers'->'auto'->>'runs')::int < 1 or not (s->'models') ? 'jev-1.14.0' then raise exception 'FAIL 4 tổng kết %', s; end if;
  if (select count(*) from public.ai_decisions where run_id = (r->>'runId')::uuid) <> 1 then raise exception 'FAIL 4 Admin không đọc được bảng'; end if;
end $$;

reset role;
-- 5. service_role lấy khóa theo tính năng ai.decisions → đúng kết nối typesafe.
do $$
declare v jsonb;
begin
  v := app_private.integration_secret_v1(null, 'ai.decisions');
  if v->>'kind' <> 'typesafe' or v->>'apiKey' <> 'ts-smoke-key-00Zz' or v->>'model' <> 'jev-1.14.0' then raise exception 'FAIL 5 secret theo tính năng %', v - 'apiKey'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'email', email, 'role', 'authenticated')::text, true) from lp where name = 'staff';
do $$
begin
  -- 6. Nhân viên: không xem tổng kết, bảng trả 0 dòng (RLS), không ghi vào lượt người khác.
  begin perform public.get_ai_decisions_summary_v1(7); raise exception 'FAIL 6 nhân viên xem được tổng kết'; exception when insufficient_privilege then null; end;
  if (select count(*) from public.ai_decisions) <> 0 then raise exception 'FAIL 6 RLS hở'; end if;
  begin perform public.ai_decision_log_v1((select value from ld where key = 'run')::uuid, '{"status":"ok"}'::jsonb); raise exception 'FAIL 6 ghi vào lượt người khác'; exception when no_data_found then null; end;
end $$;
reset role;
rollback;
