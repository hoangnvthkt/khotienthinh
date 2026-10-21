-- Rào chắn + chi phí: trần 20 USD, người phụ trách skill = Admin Hoàng, giá theo kết nối (lưu / giữ / xóa, đích edge function có giá),
-- chống spam assistant_chat (một lượt đang chạy, 6 lượt / phút). Chạy rollback trên Cloud:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261018170000_ai_guardrails_costs.sql --smoke supabase/tests/ai_guardrails_costs_smoke.sql
begin;
create temp table g_people(name text primary key, user_id uuid, email text) on commit drop;
create temp table g_data(key text primary key, value text) on commit drop;
grant select on g_people to authenticated;
grant select, insert, update on g_data to authenticated;
insert into g_people select n, gen_random_uuid(), 'guard-' || gen_random_uuid() || '@invalid.local' from unnest(array['admin', 'user']) n;
insert into public.users(id, name, username, email, role, is_active, account_status)
  select user_id, 'Guard ' || name, 'guard-' || user_id, email, case when name = 'admin' then 'ADMIN' else 'EMPLOYEE' end::public.user_role, true, 'ACTIVE' from g_people;

do $$
begin
  if (select monthly_cost_cap_usd from public.ai_settings where id = 1) <> 20 then raise exception 'FAIL trần tháng phải 20 USD'; end if;
  if exists (select 1 from public.ai_skills s where s.owner_user_id is distinct from (select id from public.users where name = 'Admin Hoàng' and role::text = 'ADMIN' and is_active limit 1)) then
    raise exception 'FAIL còn skill chưa giao Admin Hoàng';
  end if;
  if (select per_minute_limit || '/' || max_concurrent from public.ai_skills where code = 'assistant_chat') <> '6/1' then raise exception 'FAIL hạn mức chống spam'; end if;
  if exists (select 1 from public.integration_connections where base_url like 'https://revidapi.com%' and model = 'claude-sonnet-5-5' and price_out_per_m is distinct from 1.6378) then
    raise exception 'FAIL giá RevidAPI claude-sonnet-5-5';
  end if;
end $$;

-- Admin: lưu kết nối có giá → giữ giá khi không gửi trường giá → xóa giá bằng chuỗi rỗng; đích edge function có giá.
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'email', email, 'role', 'authenticated')::text, true) from g_people where name = 'admin';
do $$
declare r jsonb; id uuid;
begin
  r := public.save_integration_connection_v1('{"kind":"openai_compatible","name":"Guard test","baseUrl":"https://example.invalid/v1","model":"m1","apiKey":"sk_guard_test_key","priceInPerM":"0.5","priceOutPerM":"2"}'::jsonb);
  id := (r->>'id')::uuid;
  if (r->>'priceInPerM')::numeric <> 0.5 or (r->>'priceOutPerM')::numeric <> 2 then raise exception 'FAIL lưu giá %', r; end if;
  r := public.save_integration_connection_v1(jsonb_build_object('id', id, 'kind', 'openai_compatible', 'name', 'Guard test 2', 'baseUrl', 'https://example.invalid/v1', 'model', 'm1'));
  if (r->>'priceOutPerM')::numeric <> 2 then raise exception 'FAIL không gửi giá thì phải giữ giá %', r; end if;
  r := public.save_integration_connection_v1(jsonb_build_object('id', id, 'kind', 'openai_compatible', 'name', 'Guard test 2', 'baseUrl', 'https://example.invalid/v1', 'model', 'm1', 'priceInPerM', '', 'priceOutPerM', '3'));
  if r->>'priceInPerM' is not null or (r->>'priceOutPerM')::numeric <> 3 then raise exception 'FAIL xóa / đổi giá %', r; end if;
  begin
    perform public.save_integration_connection_v1(jsonb_build_object('id', id, 'kind', 'openai_compatible', 'name', 'x', 'baseUrl', 'https://example.invalid/v1', 'priceInPerM', '-1'));
    raise exception 'FAIL nhận giá âm';
  exception when invalid_parameter_value then null;
  end;
  insert into g_data values ('conn', id::text);
end $$;
reset role;
do $$
declare row jsonb := app_private.integration_secret_v1((select value::uuid from g_data where key = 'conn'), null);
begin
  if (row->>'priceOutPerM')::numeric <> 3 or row ? 'priceInPerM' is false then raise exception 'FAIL đích edge function thiếu giá %', row - 'apiKey'; end if;
end $$;

-- Người dùng: đang trả lời câu trước → AI_BUSY; xong rồi tối đa 6 câu / phút → AI_RATE; skill khác không bị giới hạn phút.
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'email', email, 'role', 'authenticated')::text, true) from g_people where name = 'user';
do $$
declare r jsonb; i integer;
begin
  r := public.ai_gateway_begin_v1('assistant_chat', '{}'::jsonb);
  if r->>'code' <> 'OK' then raise exception 'FAIL lượt đầu %', r; end if;
  if public.ai_gateway_begin_v1('assistant_chat', '{}'::jsonb)->>'reason' <> 'busy' then raise exception 'FAIL phải chặn khi đang trả lời'; end if;
  perform public.ai_gateway_finish_v1((r->>'runId')::uuid, '{"status":"ok"}'::jsonb);
  for i in 2..6 loop
    r := public.ai_gateway_begin_v1('assistant_chat', '{}'::jsonb);
    if r->>'code' <> 'OK' then raise exception 'FAIL lượt % trong phút: %', i, r; end if;
    perform public.ai_gateway_finish_v1((r->>'runId')::uuid, '{"status":"ok"}'::jsonb);
  end loop;
  r := public.ai_gateway_begin_v1('assistant_chat', '{}'::jsonb);
  if r->>'code' <> 'AI_QUOTA' or r->>'reason' <> 'minute' or (r->>'perMinute')::int <> 6 then raise exception 'FAIL lượt 7 phải bị chặn: %', r; end if;
  for i in 1..7 loop
    r := public.ai_gateway_begin_v1('text_summary', '{}'::jsonb);
    if r->>'code' <> 'OK' then raise exception 'FAIL skill khác bị chặn phút: %', r; end if;
    perform public.ai_gateway_finish_v1((r->>'runId')::uuid, '{"status":"ok"}'::jsonb);
  end loop;
  raise notice 'ai_guardrails_costs_smoke OK';
end $$;
rollback;
