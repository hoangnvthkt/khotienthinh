-- Smoke Trung tâm phân quyền (luôn HOÀN TÁC):
--   psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/permission_center_smoke.sql
\set ON_ERROR_STOP 1
begin;
\ir ../migrations/20261030130000_permission_center.sql

create temp table p on commit drop as
select key, u.id, u.auth_id from (values ('admin', 'admin@khoviet.vn'), ('huong', 'huongnt@tienthinhjsc.vn'), ('tam', 'tamtt@tienthinhjsc.vn')) x(key, email)
join public.users u on u.email = x.email and u.is_active;
create function pg_temp.act_as(k text) returns text language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', auth_id, 'role', 'authenticated')::text, true) from p where key = k $$;

do $$ begin
  if (select count(*) from public.user_permission_templates where is_active and jsonb_array_length(summary) = 0) > 0 then
    raise exception 'SMOKE: còn mẫu đang dùng chưa có mô tả bằng lời'; end if;
  raise notice 'OK: 8 mẫu đang dùng đều có mô tả bằng lời';
end $$;

select pg_temp.act_as('huong') \g /dev/null
do $$ begin
  begin perform public.get_permission_center_v1(); raise exception 'SMOKE: người không quản lý phân quyền đọc được toàn cảnh';
  exception when insufficient_privilege then null; end;
  begin perform public.save_user_permission_template_summary_v1('accountant', '[]'::jsonb); raise exception 'SMOKE: người không phải Admin sửa được mô tả';
  exception when insufficient_privilege then null; end;
  raise notice 'OK: Nguyễn Thị Hương không đọc toàn cảnh, không sửa mô tả mẫu';
end $$;

select pg_temp.act_as('admin') \g /dev/null
do $$
declare v jsonb; tam jsonb;
begin
  v := public.get_permission_center_v1();
  if jsonb_array_length(v -> 'templates') <> 8 then raise exception 'SMOKE: không đủ 8 mẫu: %', jsonb_array_length(v -> 'templates'); end if;
  if exists (select 1 from jsonb_array_elements(v -> 'people') x where x ->> 'name' = 'Admin Hoàng') then raise exception 'SMOKE: Admin nằm trong danh sách'; end if;
  if exists (select 1 from jsonb_array_elements(v -> 'people') x where x ->> 'avatar' like 'data:%') then raise exception 'SMOKE: lộ ảnh base64'; end if;
  select x into tam from jsonb_array_elements(v -> 'people') x where x ->> 'name' = 'Bùi Thị Tâm';
  if tam ->> 'templateCode' <> 'accountant' or jsonb_array_length(tam -> 'conflicts') = 0 or tam -> 'conflicts' -> 0 ->> 'until' is null
     or not (tam -> 'warehouses') ? 'Kho Sơn Miền Bắc' then
    raise exception 'SMOKE: dữ liệu Bùi Thị Tâm sai: %', tam; end if;
  perform public.save_user_permission_template_summary_v1('accountant', '[{"ab":"TC","title":"Tài chính","text":"Công nợ, đề nghị chi"}]');
  if (select summary -> 0 ->> 'text' from public.user_permission_templates where code = 'accountant') <> 'Công nợ, đề nghị chi' then
    raise exception 'SMOKE: chưa lưu mô tả'; end if;
  begin perform public.save_user_permission_template_summary_v1('accountant', '[{"ab":"TC","title":"  "}]'); raise exception 'SMOKE: lưu dòng không tiêu đề';
  exception when sqlstate '22023' then null; end;
  raise notice 'OK: Admin đọc toàn cảnh (% người, 8 mẫu, Tâm: kế toán, kiêm nhiệm đã ghi nhận, thủ kho Kho SMB); sửa mô tả được, chặn dòng trống',
    jsonb_array_length(v -> 'people');
end $$;

rollback;
\echo 'SMOKE ĐẠT — đã hoàn tác, Cloud không đổi'
