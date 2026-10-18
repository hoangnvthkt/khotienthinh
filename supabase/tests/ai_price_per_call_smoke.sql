-- Giá mỗi lượt gọi: RevidAPI claude điền sẵn 0,008; Admin lưu / giữ / xóa; đích edge function có giá; giá âm bị từ chối. Chạy rollback:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261018210000_ai_price_per_call.sql --smoke supabase/tests/ai_price_per_call_smoke.sql
begin;
create temp table pc_people(name text primary key, user_id uuid, email text) on commit drop;
create temp table pc_data(key text primary key, value text) on commit drop;
grant select on pc_people to authenticated;
grant select, insert on pc_data to authenticated;
insert into pc_people values ('admin', gen_random_uuid(), 'pc-' || gen_random_uuid() || '@invalid.local');
insert into public.users(id, name, username, email, role, is_active, account_status)
  select user_id, 'PC admin', 'pc-' || user_id, email, 'ADMIN'::public.user_role, true, 'ACTIVE' from pc_people;
do $$
begin
  if exists (select 1 from public.integration_connections where base_url like 'https://revidapi.com%' and model like 'claude-%' and price_per_call is distinct from 0.008) then
    raise exception 'FAIL RevidAPI claude phải có giá 0,008 mỗi lượt';
  end if;
  if exists (select 1 from public.integration_connections where model like 'deepseek%' and price_per_call is not null) then raise exception 'FAIL deepseek không đặt giá lượt'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'email', email, 'role', 'authenticated')::text, true) from pc_people;
do $$
declare r jsonb; id uuid;
begin
  r := public.save_integration_connection_v1('{"kind":"openai_compatible","name":"PC","baseUrl":"https://example.invalid/v1","model":"m","apiKey":"sk_pc_test","priceOutPerM":"2","pricePerCall":"0.01"}'::jsonb);
  id := (r->>'id')::uuid;
  if (r->>'pricePerCall')::numeric <> 0.01 then raise exception 'FAIL lưu giá lượt %', r; end if;
  r := public.save_integration_connection_v1(jsonb_build_object('id', id, 'kind', 'openai_compatible', 'name', 'PC', 'baseUrl', 'https://example.invalid/v1', 'model', 'm'));
  if (r->>'pricePerCall')::numeric <> 0.01 then raise exception 'FAIL không gửi thì phải giữ %', r; end if;
  begin
    perform public.save_integration_connection_v1(jsonb_build_object('id', id, 'kind', 'openai_compatible', 'name', 'PC', 'baseUrl', 'https://example.invalid/v1', 'pricePerCall', '-1'));
    raise exception 'FAIL nhận giá âm';
  exception when invalid_parameter_value then null;
  end;
  insert into pc_data values ('conn', id::text);
end $$;
reset role;
do $$
declare row jsonb := app_private.integration_secret_v1((select value::uuid from pc_data where key = 'conn'), null);
begin
  if (row->>'pricePerCall')::numeric <> 0.01 then raise exception 'FAIL đích edge function thiếu giá lượt %', row - 'apiKey'; end if;
  raise notice 'ai_price_per_call_smoke OK';
end $$;
rollback;
