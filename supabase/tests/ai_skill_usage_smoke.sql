-- Trung tâm AI · tab Skill: Admin xem lượt dùng theo skill / công cụ / thẻ; nhân viên bị chặn 42501; công cụ tách đúng từ summary.
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261020150000_ai_skill_usage.sql --smoke supabase/tests/ai_skill_usage_smoke.sql
begin;
create temp table su(name text primary key, user_id uuid, email text, auth_id uuid) on commit drop;
grant select on su to authenticated;
insert into su select 'staff', gen_random_uuid(), 'su-' || gen_random_uuid() || '@invalid.local', null;
insert into public.users(id, name, username, email, role, is_active, account_status)
  select user_id, 'SU staff', 'su-' || user_id, email, 'EMPLOYEE'::public.user_role, true, 'ACTIVE' from su;
insert into su select 'admin', u.id, u.email, u.auth_id from public.users u where u.name = 'Admin Hoàng' and u.auth_id is not null limit 1;

-- Hai lượt Trợ lý thử (của nhân viên thử): một lượt tra 2 công cụ, một lượt gọi lại công cụ biểu đồ.
insert into public.ai_runs(user_id, skill_code, status, summary, cost_usd, accepted, created_at)
select user_id, 'assistant_chat', 'ok', 'hội thoại: 0 tin trước, 40 dòng số liệu, tra bien_dong_nhan_su tim_ho_so, 2 lượt gọi → 120 ký tự, 1 nguồn', 0.008, true, now() from su where name = 'staff'
union all
select user_id, 'assistant_chat', 'ok', 'hội thoại: 2 tin trước, tra bien_dong_nhan_su bien_dong_nhan_su → 80 ký tự, 0 nguồn', 0.008, false, now() from su where name = 'staff';

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'email', email, 'role', 'authenticated')::text, true) from su where name = 'staff';
do $$ begin perform public.get_ai_skill_usage_v1(7); raise exception 'FAIL nhân viên xem lượt dùng skill'; exception when insufficient_privilege then null; end $$;
reset role;

select set_config('request.jwt.claims', jsonb_build_object('sub', auth_id, 'email', email, 'role', 'authenticated')::text, true) from su where name = 'admin';
set local role authenticated;
do $$
declare
  a jsonb := public.get_ai_skill_usage_v1(7);
  chat jsonb;
  chart jsonb;
begin
  if (a->>'days')::int <> 7 or jsonb_typeof(a->'skills') <> 'array' or jsonb_typeof(a->'tools') <> 'array' or jsonb_typeof(a->'commands') <> 'array' then
    raise exception 'FAIL cấu trúc %', left(a::text, 300);
  end if;
  select s into chat from jsonb_array_elements(a->'skills') s where s->>'code' = 'assistant_chat';
  if chat is null or (chat->>'runs')::int < 2 or chat->>'access' is null or chat->>'description' is null or (chat->>'dislikes')::int < 1 then
    raise exception 'FAIL dòng Trợ lý %', chat;
  end if;
  select t into chart from jsonb_array_elements(a->'tools') t where t->>'tool' = 'bien_dong_nhan_su';
  -- Hai lượt có công cụ biểu đồ (một lượt gọi 2 lần vẫn tính 1).
  if chart is null or (chart->>'runs')::int < 2 then raise exception 'FAIL công cụ biểu đồ %', a->'tools'; end if;
  if exists (select 1 from jsonb_array_elements(a->'tools') t where t->>'tool' !~ '^[a-z_]+$') then raise exception 'FAIL tên công cụ lạ %', a->'tools'; end if;
  if (public.get_ai_skill_usage_v1(500)->>'days')::int <> 90 then raise exception 'FAIL trần 90 ngày'; end if;
end $$;
rollback;
