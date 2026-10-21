-- Chọn model ở ô hỏi: mẫu có model mặc định + model thêm; người dùng chọn model được cấp thì cổng trả đúng model đó, chọn model lạ thì về
-- mặc định; "quyền của tôi" liệt kê model kèm mô tả, mặc định đứng đầu; Admin sửa mô tả model (có audit), nhân viên không sửa được.
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261019230000_ai_model_choice.sql --smoke supabase/tests/ai_model_choice_smoke.sql
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
insert into ld select 'claude', id::text from public.integration_connections where model = 'claude-sonnet-5-5' and enabled order by created_at limit 1;
insert into ld select 'deep', id::text from public.integration_connections where model like 'deepseek%' and enabled order by created_at limit 1;

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', auth_id, 'email', email, 'role', 'authenticated')::text, true) from lp where name = 'admin';
do $$
declare o jsonb; staff uuid := (select user_id from lp where name = 'staff'); claude text := (select value from ld where key = 'claude'); deep text := (select value from ld where key = 'deep');
begin
  perform public.ai_admin_template_save_v1(jsonb_build_object('name', 'LP hai model', 'connectionId', claude, 'extraConnectionIds', jsonb_build_array(deep),
    'monthlyCostCapUsd', 5, 'dailyQuestionCap', 50, 'skills', jsonb_build_array('assistant_chat')));
  o := public.get_ai_admin_overview_v1();
  insert into ld select 'tpl', x->>'id' from jsonb_array_elements(o->'templates') x where x->>'name' = 'LP hai model';
  if (select jsonb_array_length(x->'extraConnectionIds') from jsonb_array_elements(o->'templates') x where x->>'name' = 'LP hai model') <> 1 then raise exception 'FAIL mẫu chưa lưu model thêm'; end if;
  if not exists (select 1 from jsonb_array_elements(o->'connections') c where c->>'id' = deep and c->>'displayName' = 'DeepSeek Flash' and not (c->>'vision')::boolean) then raise exception 'FAIL mô tả model sẵn %', o->'connections'; end if;
  perform public.ai_admin_grant_save_v1(array[staff], jsonb_build_object('templateId', (select value from ld where key = 'tpl')));
  perform public.ai_admin_model_save_v1(jsonb_build_object('id', deep, 'displayName', 'DeepSeek nhanh', 'blurb', 'Câu hỏi thường', 'icon', '⚡', 'vision', false));
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'email', email, 'role', 'authenticated')::text, true) from lp where name = 'staff';
do $$
declare r jsonb; m jsonb; claude text := (select value from ld where key = 'claude'); deep text := (select value from ld where key = 'deep');
begin
  m := public.get_my_ai_access_v1();
  if jsonb_array_length(m->'models') <> 2 or m->'models'->0->>'id' <> claude or not (m->'models'->0->>'default')::boolean or m->'models'->1->>'name' <> 'DeepSeek nhanh' then
    raise exception 'FAIL danh sách model của tôi %', m->'models';
  end if;
  r := public.ai_gateway_begin_v1('assistant_chat', jsonb_build_object('connectionId', deep));
  if r->>'connectionId' <> deep then raise exception 'FAIL chọn model được cấp %', r; end if;
  perform public.ai_gateway_finish_v1((r->>'runId')::uuid, '{"status":"ok"}'::jsonb);
  r := public.ai_gateway_begin_v1('assistant_chat', jsonb_build_object('connectionId', gen_random_uuid()));
  if r->>'connectionId' <> claude then raise exception 'FAIL model lạ phải về mặc định %', r; end if;
  perform public.ai_gateway_finish_v1((r->>'runId')::uuid, '{"status":"ok"}'::jsonb);
  r := public.ai_gateway_begin_v1('assistant_chat', '{}'::jsonb);
  if r->>'connectionId' <> claude then raise exception 'FAIL không chọn thì mặc định %', r; end if;
  begin perform public.ai_admin_model_save_v1(jsonb_build_object('id', deep, 'displayName', 'x')); raise exception 'FAIL nhân viên sửa model'; exception when insufficient_privilege then null; end;
end $$;

reset role;
do $$
begin
  if not exists (select 1 from public.audit_trail where record_id = 'model:' || (select value from ld where key = 'deep') and description = 'Sửa mô tả model AI') then raise exception 'FAIL thiếu audit model'; end if;
end $$;
rollback;
