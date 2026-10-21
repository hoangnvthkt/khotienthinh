-- Trung tâm AI: Trợ lý chỉ cho người được cấp (skill khác vẫn mọi người), cấp theo mẫu + chỉnh riêng, trần câu / ngày theo người,
-- model của người trả về cổng, tắt cấp phát thì chặn, Admin khóa skill, mẫu đang dùng không xóa được, nhân viên không vào được quản trị.
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261019210000_ai_admin_center.sql --smoke supabase/tests/ai_admin_center_smoke.sql
begin;
create temp table lp(name text primary key, user_id uuid, email text, auth_id uuid) on commit drop;
create temp table ld(key text primary key, value text) on commit drop;
grant select on lp to authenticated;
grant select, insert on ld to authenticated;
insert into lp select 'staff', gen_random_uuid(), 'lp-' || gen_random_uuid() || '@invalid.local', null;
insert into public.users(id, name, username, email, role, is_active, account_status)
  select user_id, 'LP staff', 'lp-' || user_id, email, 'EMPLOYEE'::public.user_role, true, 'ACTIVE' from lp;
insert into lp select 'admin', u.id, u.email, u.auth_id from public.users u where u.name = 'Admin Hoàng' and u.auth_id is not null limit 1;
-- Không vướng trần chung của tháng khi chạy thử.
update public.ai_settings set monthly_run_cap = 1000000, monthly_cost_cap_usd = 0 where id = 1;
update public.ai_skills set daily_limit = 1000, per_minute_limit = null, max_concurrent = null where code in ('assistant_chat', 'text_summary');

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'email', email, 'role', 'authenticated')::text, true) from lp where name = 'staff';
do $$
declare r jsonb;
begin
  r := public.ai_gateway_begin_v1('assistant_chat', '{}'::jsonb);
  if r->>'code' <> 'AI_DENIED' or r->>'reason' <> 'not_granted' then raise exception 'FAIL chưa cấp mà dùng được Trợ lý %', r; end if;
  r := public.ai_gateway_begin_v1('text_summary', '{}'::jsonb);
  if r->>'code' <> 'OK' then raise exception 'FAIL skill mọi người bị chặn %', r; end if;
  perform public.ai_gateway_finish_v1((r->>'runId')::uuid, '{"status":"ok"}'::jsonb);
  if (public.get_my_ai_access_v1()->>'assistant')::boolean then raise exception 'FAIL báo đã cấp'; end if;
  begin perform public.get_ai_admin_overview_v1(); raise exception 'FAIL nhân viên xem quản trị AI'; exception when insufficient_privilege then null; end;
  begin perform public.ai_admin_grant_save_v1(array[public.current_app_user_id()], '{}'::jsonb); raise exception 'FAIL nhân viên tự cấp'; exception when insufficient_privilege then null; end;
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', auth_id, 'email', email, 'role', 'authenticated')::text, true) from lp where name = 'admin';
do $$
declare o jsonb; tpl text; staff uuid := (select user_id from lp where name = 'staff');
begin
  o := public.get_ai_admin_overview_v1();
  select x->>'id' into tpl from jsonb_array_elements(o->'templates') x where x->>'name' = 'Tiêu chuẩn';
  if tpl is null then raise exception 'FAIL thiếu mẫu Tiêu chuẩn %', o->'templates'; end if;
  if not exists (select 1 from jsonb_array_elements(o->'grants') g where g->>'name' = 'Admin Hoàng' and (g->>'enabled')::boolean) then raise exception 'FAIL Admin Hoàng chưa được cấp'; end if;
  if (select x->>'access' from jsonb_array_elements(o->'skills') x where x->>'code' = 'assistant_chat') <> 'granted' then raise exception 'FAIL Trợ lý chưa chỉ cho người được cấp'; end if;
  if not exists (select 1 from jsonb_array_elements(public.ai_admin_people_v1('LP staff')) x where (x->>'id')::uuid = staff and not (x->>'granted')::boolean) then raise exception 'FAIL tìm người'; end if;
  -- Theo mẫu, chỉnh riêng 2 câu / ngày (đã dùng 1 lượt tóm tắt — trần tính mọi lượt AI của người đó).
  perform public.ai_admin_grant_save_v1(array[staff], jsonb_build_object('templateId', tpl, 'dailyQuestionCap', 2));
  insert into ld values ('tpl', tpl);
  insert into ld select 'conn', x->>'connectionId' from jsonb_array_elements(o->'templates') x where x->>'id' = tpl;
  begin perform public.ai_admin_template_delete_v1(tpl::uuid); raise exception 'FAIL xóa được mẫu đang dùng'; exception when foreign_key_violation then null; end;
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'email', email, 'role', 'authenticated')::text, true) from lp where name = 'staff';
do $$
declare r jsonb; m jsonb;
begin
  r := public.ai_gateway_begin_v1('assistant_chat', '{}'::jsonb);
  if r->>'code' <> 'OK' then raise exception 'FAIL đã cấp mà bị chặn %', r; end if;
  if r->>'connectionId' is distinct from (select value from ld where key = 'conn') then raise exception 'FAIL model theo mẫu %', r; end if;
  perform public.ai_gateway_finish_v1((r->>'runId')::uuid, '{"status":"ok"}'::jsonb);
  m := public.get_my_ai_access_v1();
  if not (m->>'assistant')::boolean or (m->>'dailyQuestionCap')::int <> 2 or (m->>'usedToday')::int < 2 then raise exception 'FAIL quyền của tôi %', m; end if;
  r := public.ai_gateway_begin_v1('assistant_chat', '{}'::jsonb);
  if r->>'code' <> 'AI_QUOTA' or r->>'reason' <> 'user_day' then raise exception 'FAIL trần câu / ngày %', r; end if;
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', auth_id, 'email', email, 'role', 'authenticated')::text, true) from lp where name = 'admin';
do $$
declare staff uuid := (select user_id from lp where name = 'staff');
begin
  perform public.ai_admin_grant_save_v1(array[staff], jsonb_build_object('enabled', false, 'templateId', (select value from ld where key = 'tpl')));
  perform public.ai_admin_skill_access_v1('text_summary', 'granted');
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'email', email, 'role', 'authenticated')::text, true) from lp where name = 'staff';
do $$
declare r jsonb;
begin
  r := public.ai_gateway_begin_v1('assistant_chat', '{}'::jsonb);
  if r->>'reason' is distinct from 'not_granted' then raise exception 'FAIL tắt cấp phát vẫn dùng được %', r; end if;
  r := public.ai_gateway_begin_v1('text_summary', '{}'::jsonb);
  if r->>'reason' is distinct from 'not_granted' then raise exception 'FAIL khóa skill không có tác dụng %', r; end if;
end $$;

reset role;
do $$
begin
  if (select count(*) from public.audit_trail where table_name = 'ai_user_grants' and record_id = (select user_id::text from lp where name = 'staff')) <> 2 then
    raise exception 'FAIL thiếu audit cấp phát';
  end if;
end $$;
rollback;
