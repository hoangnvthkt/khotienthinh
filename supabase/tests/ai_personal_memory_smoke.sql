-- Trợ lý T4b: ghi nhớ cá nhân (trùng chữ không nhân đôi, chỉ chủ thấy / quên), thói quen chỉ nhận khóa cho phép, thẻ "nhớ giúp" (memory_note);
-- cách gọi chung: người quản lý Mua hàng thấy + quên được, nhân viên không có quyền thì không thấy, không quên được. Chạy rollback trên Cloud:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261019190000_ai_personal_memory.sql --smoke supabase/tests/ai_personal_memory_smoke.sql
begin;
create temp table lp(name text primary key, user_id uuid, email text, auth_id uuid) on commit drop;
create temp table ld(key text primary key, value text) on commit drop;
grant select on lp to authenticated;
grant select, insert on ld to authenticated;
insert into lp select 'staff', gen_random_uuid(), 'lp-' || gen_random_uuid() || '@invalid.local', null;
insert into public.users(id, name, username, email, role, is_active, account_status)
  select user_id, 'LP staff', 'lp-' || user_id, email, 'EMPLOYEE'::public.user_role, true, 'ACTIVE' from lp;
insert into lp select 'admin', u.id, u.email, u.auth_id from public.users u where u.name = 'Admin Hoàng' and u.auth_id is not null limit 1;
insert into ld select 'vendor', id::text from public.business_partners order by id limit 1;

-- Admin (quản lý Mua hàng) dạy một cách gọi NCC + lưu ghi nhớ riêng.
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', auth_id, 'email', email, 'role', 'authenticated')::text, true) from lp where name = 'admin';
do $$
declare g jsonb; alias_id text;
begin
  perform public.learn_ai_aliases_v2('purchase_order', null, jsonb_build_array(
    jsonb_build_object('kind', 'vendor', 'alias', 'Smoke NCC T4b', 'targetId', (select value from ld where key = 'vendor'), 'targetLabel', 'NCC thử')));
  g := public.get_ai_memory_overview_v1();
  select x->>'id' into alias_id from jsonb_array_elements(g) grp, jsonb_array_elements(grp->'items') x
    where grp->>'key' = 'company:procurement:po' and x->>'alias' = 'Smoke NCC T4b';
  if alias_id is null then raise exception 'FAIL tổng quan không có cách gọi Mua hàng %', g; end if;
  insert into ld values ('alias', alias_id);
  insert into ld values ('admin_note', public.ai_user_note_save_v1('Ghi nhớ riêng của admin', 'user')->>'id');
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'email', email, 'role', 'authenticated')::text, true) from lp where name = 'staff';
do $$
declare r jsonb; m jsonb; run uuid; c jsonb;
begin
  r := public.ai_user_note_save_v1('Anh phụ trách SMB-2026 và DA29');
  if r->>'created' <> 'true' then raise exception 'FAIL lưu ghi nhớ %', r; end if;
  if public.ai_user_note_save_v1('  anh phụ trách   SMB-2026 và DA29 ', 'assistant')->>'id' <> r->>'id' then raise exception 'FAIL ghi nhớ trùng bị nhân đôi'; end if;
  begin perform public.ai_user_note_save_v1('ok'); raise exception 'FAIL nhận ghi nhớ quá ngắn'; exception when invalid_parameter_value then null; end;
  begin perform public.ai_user_note_save_v1('Ghi nhớ hợp lệ', 'action'); raise exception 'FAIL nhận nguồn lạ'; exception when invalid_parameter_value then null; end;
  if (public.learn_ai_user_habits_v1('[{"key":"po.approver","value":"u-1","label":"Hà Đức Chuẩn"},{"key":"evil","value":"x"},{"key":"mr.approvers:p 1","value":"x"}]'::jsonb)->>'saved')::int <> 1 then
    raise exception 'FAIL nhận khóa thói quen lạ';
  end if;
  perform public.learn_ai_user_habits_v1('[{"key":"po.approver","value":"u-1","label":"Hà Đức Chuẩn"}]'::jsonb);
  m := public.get_ai_user_memory_v1();
  if jsonb_array_length(m->'notes') <> 1 or (m->'habits'->0->>'hits')::int <> 2 or m->'habits'->0->>'scopeLabel' <> 'Mua hàng' then raise exception 'FAIL đọc trí nhớ cá nhân %', m; end if;
  if exists (select 1 from jsonb_array_elements(public.get_ai_memory_overview_v1()) g where g->>'key' = 'company:procurement:po') then raise exception 'FAIL nhân viên thấy cách gọi Mua hàng'; end if;
  begin perform public.forget_ai_memory_v1('shared', (select value::uuid from ld where key = 'alias')); raise exception 'FAIL nhân viên quên được cách gọi chung';
  exception when insufficient_privilege then null; end;
  begin perform public.forget_ai_memory_v1('personal', (select value::uuid from ld where key = 'admin_note')); raise exception 'FAIL quên được ghi nhớ người khác';
  exception when no_data_found then null; end;
  perform public.forget_ai_memory_v1('personal', (r->>'id')::uuid);
  if jsonb_array_length(public.get_ai_user_memory_v1()->'notes') <> 0 then raise exception 'FAIL chưa quên ghi nhớ'; end if;
  run := (public.ai_gateway_begin_v1('assistant_chat', '{}'::jsonb)->>'runId')::uuid;
  c := public.assistant_command_create_v1(run, 'memory_note', 'Ghi nhớ', '{"text":"Báo cáo ngắn gọn"}'::jsonb, '{}'::jsonb);
  if c->>'kind' <> 'memory_note' then raise exception 'FAIL thẻ ghi nhớ %', c; end if;
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', auth_id, 'email', email, 'role', 'authenticated')::text, true) from lp where name = 'admin';
do $$
begin
  if exists (select 1 from jsonb_array_elements(public.get_ai_user_memory_v1()->'notes') n where n->>'text' like 'Anh phụ trách%') then raise exception 'FAIL thấy ghi nhớ người khác'; end if;
  perform public.forget_ai_memory_v1('shared', (select value::uuid from ld where key = 'alias'));
end $$;
reset role;
do $$
begin
  if exists (select 1 from public.ai_memory_aliases where id = (select value::uuid from ld where key = 'alias')) then raise exception 'FAIL chưa quên cách gọi chung'; end if;
end $$;
rollback;
