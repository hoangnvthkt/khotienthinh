-- Trợ lý T4a: dislike có lý do (chỉ chủ lượt AI, lý do lạ bị chặn); nhân viên chưa có quyền không đọc / dạy được trí nhớ vật tư, NCC;
-- người quản lý Mua hàng (Admin Hoàng) dạy được cặp có thật, cặp trỏ tới đích không có thật bị bỏ qua. Chạy rollback trên Cloud:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261019170000_ai_learning_v1.sql --smoke supabase/tests/ai_learning_v1_smoke.sql
begin;
create temp table lp(name text primary key, user_id uuid, email text, auth_id uuid) on commit drop;
create temp table ld(key text primary key, value text) on commit drop;
grant select on lp to authenticated;
grant select, insert on ld to authenticated;
insert into lp select 'staff', gen_random_uuid(), 'lp-' || gen_random_uuid() || '@invalid.local', null;
insert into public.users(id, name, username, email, role, is_active, account_status)
  select user_id, 'LP staff', 'lp-' || user_id, email, 'EMPLOYEE'::public.user_role, true, 'ACTIVE' from lp;
insert into lp select 'admin', u.id, u.email, u.auth_id from public.users u where u.name = 'Admin Hoàng' and u.auth_id is not null limit 1;
insert into ld select 'item', id from public.items where coalesce(status, 'active') <> 'retired' order by name limit 1;
insert into ld select 'vendor', id::text from public.business_partners order by id limit 1;

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'email', email, 'role', 'authenticated')::text, true) from lp where name = 'staff';
do $$
declare run uuid; r jsonb;
begin
  run := (public.ai_gateway_begin_v1('assistant_chat', '{}'::jsonb)->>'runId')::uuid;
  perform public.ai_gateway_finish_v1(run, '{"status":"ok"}'::jsonb);
  r := public.ai_gateway_feedback_v2(run, false, 'wrong_data', '  Sai tổng tiền  ');
  begin
    perform public.ai_gateway_feedback_v2(run, false, 'boring', null);
    raise exception 'FAIL nhận lý do lạ';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.get_ai_aliases_v2('purchase_order', null);
    raise exception 'FAIL nhân viên đọc được trí nhớ mua hàng';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.learn_ai_aliases_v2('purchase_order', null, '[{"kind":"vendor","alias":"Hòa Phát","targetId":"x","targetLabel":"x"}]'::jsonb);
    raise exception 'FAIL nhân viên dạy được trí nhớ mua hàng';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.get_ai_feedback_v1(30);
    raise exception 'FAIL nhân viên xem được phản hồi';
  exception when insufficient_privilege then null;
  end;
  insert into ld values ('run', run::text);
end $$;

reset role;
do $$
begin
  if (select feedback_reason || '|' || feedback_note from public.ai_runs where id = (select value::uuid from ld where key = 'run')) <> 'wrong_data|Sai tổng tiền' then
    raise exception 'FAIL không ghi lý do dislike';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', auth_id, 'email', email, 'role', 'authenticated')::text, true) from lp where name = 'admin';
do $$
declare r jsonb; g jsonb; item text := (select value from ld where key = 'item'); vendor text := (select value from ld where key = 'vendor');
begin
  r := public.learn_ai_aliases_v2('purchase_order', null, jsonb_build_array(
    jsonb_build_object('kind', 'item', 'alias', 'Thép vằn D16 CB400 (test)', 'targetId', item, 'targetLabel', 'Mã thử'),
    jsonb_build_object('kind', 'vendor', 'alias', 'HANAKA (test)', 'targetId', vendor, 'targetLabel', 'NCC thử'),
    jsonb_build_object('kind', 'item', 'alias', 'Mã không có', 'targetId', 'khong-co-ma', 'targetLabel', 'x')));
  if (r->>'saved')::int <> 2 then raise exception 'FAIL dạy trí nhớ mua hàng %', r; end if;
  g := public.get_ai_aliases_v2('purchase_order', null);
  if not exists (select 1 from jsonb_array_elements(g) x where x->>'aliasNorm' = 'hanaka test' and x->>'kind' = 'vendor') then raise exception 'FAIL đọc trí nhớ NCC %', g; end if;
  if jsonb_typeof(public.get_ai_feedback_v1(30)->'skills') <> 'array' then raise exception 'FAIL thống kê phản hồi'; end if;
end $$;
rollback;
