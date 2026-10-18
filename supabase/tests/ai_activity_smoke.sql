-- Trung tâm AI · Hoạt động: chủ đề theo công cụ đã gọi; Admin xem được số tổng / theo ngày / chủ đề / thẻ / người / model / 👎; nhân viên không xem được.
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261020090000_ai_activity.sql --smoke supabase/tests/ai_activity_smoke.sql
begin;
do $$
begin
  if app_private.ai_chat_topic('hội thoại: 0 tin trước, 40 dòng số liệu, tra tim_ho_so chuan_bi_don_mua, 2 lượt gọi → 1 ký tự', null) <> 'purchase_order' then raise exception 'FAIL chủ đề đơn mua'; end if;
  if app_private.ai_chat_topic('hội thoại: 0 tin trước, tra ton_kho, 2 lượt gọi → 1 ký tự', null) <> 'lookup' then raise exception 'FAIL chủ đề tra cứu'; end if;
  if app_private.ai_chat_topic('hội thoại: 0 tin trước → từ chối (ngoai_cong_viec)', null) <> 'refused' then raise exception 'FAIL chủ đề từ chối'; end if;
  if app_private.ai_chat_topic('hội thoại: 0 tin trước → 120 ký tự, 2 nguồn', null) <> 'chat' then raise exception 'FAIL chủ đề hỏi đáp'; end if;
end $$;
create temp table lp(name text primary key, user_id uuid, email text, auth_id uuid) on commit drop;
grant select on lp to authenticated;
insert into lp select 'staff', gen_random_uuid(), 'lp-' || gen_random_uuid() || '@invalid.local', null;
insert into public.users(id, name, username, email, role, is_active, account_status)
  select user_id, 'LP staff', 'lp-' || user_id, email, 'EMPLOYEE'::public.user_role, true, 'ACTIVE' from lp;
insert into lp select 'admin', u.id, u.email, u.auth_id from public.users u where u.name = 'Admin Hoàng' and u.auth_id is not null limit 1;

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'email', email, 'role', 'authenticated')::text, true) from lp where name = 'staff';
do $$ begin perform public.get_ai_activity_v1(14); raise exception 'FAIL nhân viên xem hoạt động'; exception when insufficient_privilege then null; end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', auth_id, 'email', email, 'role', 'authenticated')::text, true) from lp where name = 'admin';
do $$
declare a jsonb := public.get_ai_activity_v1(30);
begin
  if (a->>'days')::int <> 30 or jsonb_typeof(a->'totals') <> 'object' or jsonb_typeof(a->'daily') <> 'array' or jsonb_typeof(a->'topics') <> 'array'
     or jsonb_typeof(a->'commands') <> 'array' or jsonb_typeof(a->'people') <> 'array' or jsonb_typeof(a->'models') <> 'array' or jsonb_typeof(a->'dislikes') <> 'array' then
    raise exception 'FAIL cấu trúc %', left(a::text, 400);
  end if;
  if (a->>'granted')::int < 15 then raise exception 'FAIL số người được cấp %', a->>'granted'; end if;
  if not exists (select 1 from jsonb_array_elements(a->'people') p where p->>'name' = 'Đoàn Văn Dương' and (p->>'granted')::boolean) then raise exception 'FAIL thiếu người được cấp chưa dùng'; end if;
  if (select coalesce(sum((c->>'prepared')::int), 0) from jsonb_array_elements(a->'commands') c) < 1 then raise exception 'FAIL thẻ nháp'; end if;
end $$;
rollback;
