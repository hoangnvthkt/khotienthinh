-- Trợ lý · quyen_cua_toi: Admin → la_admin, không liệt kê quyền, màn /procurement có phân hệ, việc "duyệt đơn mua" có kết quả;
-- nhân viên mới (không quyền) → quyen rỗng, việc cần trả về chưa có; không đăng nhập → 42501; tham số quá dài → 22023.
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261028090000_assistant_my_access.sql --smoke supabase/tests/assistant_my_access_smoke.sql
begin;
create temp table lp(name text primary key, user_id uuid, email text, auth_id uuid) on commit drop;
grant select on lp to authenticated;
insert into lp select 'staff', gen_random_uuid(), 'lp-' || gen_random_uuid() || '@invalid.local', null;
insert into public.users(id, name, username, email, role, is_active, account_status)
  select user_id, 'LP staff', 'lp-' || user_id, email, 'EMPLOYEE'::public.user_role, true, 'ACTIVE' from lp where name = 'staff';
insert into lp select 'admin', u.id, u.email, u.auth_id from public.users u where u.name = 'Admin Hoàng' and u.auth_id is not null limit 1;
insert into lp select 'member', u.id, u.email, u.auth_id from public.users u
  where u.role::text <> 'ADMIN' and u.is_active and u.account_status = 'ACTIVE' and u.auth_id is not null
    and exists (select 1 from public.user_permission_grants g where g.user_id = u.id and g.is_active)
  order by u.name limit 1;

do $$ begin
  begin perform public.assistant_my_access_v1(null, null); raise exception 'FAIL 0 không đăng nhập vẫn gọi được'; exception when insufficient_privilege then null; end;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', auth_id, 'email', email, 'role', 'authenticated')::text, true) from lp where name = 'admin';
do $$
declare v jsonb;
begin
  v := public.assistant_my_access_v1('/procurement?mode=orders', 'duyệt đơn mua hàng');
  if (v->>'la_admin')::boolean is not true then raise exception 'FAIL 1 admin: %', left(v::text, 300); end if;
  if jsonb_array_length(v->'quyen') <> 0 then raise exception 'FAIL 1b admin không cần liệt kê quyền'; end if;
  if v->'man_hinh' is null or jsonb_array_length(v->'man_hinh'->'phan_he') = 0 then raise exception 'FAIL 1c màn /procurement không khớp phân hệ: %', v->'man_hinh'; end if;
  if v->'viec_can' is null or jsonb_array_length(v->'viec_can') = 0 then raise exception 'FAIL 1d việc "duyệt đơn mua" không khớp: %', v->'viec_can'; end if;
  if jsonb_array_length(v->'nguoi_cap') = 0 then raise exception 'FAIL 1e không có người cấp'; end if;
  raise notice 'admin man_hinh=% viec_can=%', left((v->'man_hinh')::text, 300), left((v->'viec_can')::text, 400);
  begin perform public.assistant_my_access_v1(repeat('x', 301), null); raise exception 'FAIL 2 đường dẫn dài vẫn chạy'; exception when invalid_parameter_value then null; end;
end $$;

select set_config('request.jwt.claims', jsonb_build_object('sub', user_id, 'email', email, 'role', 'authenticated')::text, true) from lp where name = 'staff';
do $$
declare v jsonb;
begin
  v := public.assistant_my_access_v1('/procurement', 'duyệt đơn mua');
  if (v->>'la_admin')::boolean then raise exception 'FAIL 3 nhân viên mới thành admin'; end if;
  if v->'viec_can' is null or jsonb_array_length(v->'viec_can') = 0 then raise exception 'FAIL 3b việc cần rỗng: %', v; end if;
  if exists (select 1 from jsonb_array_elements(v->'viec_can') x where (x->>'da_co')::boolean) then raise exception 'FAIL 3c nhân viên mới lại có quyền duyệt: %', v->'viec_can'; end if;
  raise notice 'staff: %', left(v::text, 600);
end $$;

select set_config('request.jwt.claims', jsonb_build_object('sub', auth_id, 'email', email, 'role', 'authenticated')::text, true) from lp where name = 'member';
do $$
declare v jsonb;
begin
  v := public.assistant_my_access_v1('/inventory', null);
  if jsonb_array_length(v->'quyen') = 0 then raise exception 'FAIL 4 người có quyền mà quyen rỗng: %', left(v::text, 400); end if;
  raise notice 'member quyen=% nguon=% phong=% man=%', left((v->'quyen')::text, 500), v->'nguon', left((v->'phong_du_an')::text, 300), left((v->'man_hinh')::text, 300);
end $$;
reset role;
rollback;
