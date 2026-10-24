-- Smoke Trung tâm phân quyền bước 3 — Hàng loạt, Sao chép, Nhật ký (luôn HOÀN TÁC):
--   psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/permission_center_bulk_copy_smoke.sql
\set ON_ERROR_STOP 1
begin;
\ir ../migrations/20261030160000_permission_center_bulk_copy_log.sql

create temp table p on commit drop as
select key, u.id, u.auth_id from (values ('admin', 'admin@khoviet.vn'), ('huong', 'huongnt@tienthinhjsc.vn'), ('tam', 'tamtt@tienthinhjsc.vn'),
  ('nhu', 'nhudx@tienthinhjsc.vn'), ('luat', 'luatnv@tienthinhjsc.vn'), ('quy', 'quydc@tienthinhjsc.vn'), ('ngoc', 'ngocntm@tienthinhjsc.vn'),
  ('duan', 'duanmd@tienthinhjsc.vn'), ('linh', 'linhbt@tienthinhjsc.vn'), ('mo', 'mont@tienthinhjsc.vn'), ('thinh', 'thinhdx@tienthinhjsc.vn')) x(key, email)
join public.users u on u.email = x.email and u.is_active;
create function pg_temp.uid(k text) returns uuid language sql stable as $$ select id from p where key = k $$;
create function pg_temp.act_as(k text) returns text language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', auth_id, 'role', 'authenticated')::text, true) from p where key = k $$;

do $$ begin
  if (select count(*) from p) <> 11 then raise exception 'SMOKE: thiếu người thử (%)', (select count(*) from p); end if;
end $$;

select pg_temp.act_as('huong') \g /dev/null
do $$ begin
  begin perform public.preview_bulk_permission_change_v1(array[pg_temp.uid('quy')], '{"kind":"template","templateCode":"site_staff"}');
    raise exception 'SMOKE: người không quản lý phân quyền xem trước hàng loạt được';
  exception when insufficient_privilege then null; end;
  begin perform public.apply_copy_permissions_v1(pg_temp.uid('luat'), array[pg_temp.uid('nhu')], '{"template":true}', 'Thử chép quyền');
    raise exception 'SMOKE: người không quản lý phân quyền chép quyền được';
  exception when insufficient_privilege then null; end;
  begin perform public.list_permission_audit_v1(); raise exception 'SMOKE: người không quản lý phân quyền đọc nhật ký';
  exception when insufficient_privilege then null; end;
  begin perform public.get_permission_expiry_overview_v1(); raise exception 'SMOKE: người không quản lý phân quyền xem hạn quyền';
  exception when insufficient_privilege then null; end;
  raise notice 'OK: Nguyễn Thị Hương không chạy hàng loạt / sao chép / đọc nhật ký';
end $$;

select pg_temp.act_as('admin') \g /dev/null

do $$
declare v jsonb := public.get_permission_expiry_overview_v1();
begin
  if (v ->> 'nextExpiry') is null or (v ->> 'nextExpiry')::timestamptz <= now() then raise exception 'SMOKE: hạn gần nhất sai: %', v; end if;
  raise notice 'OK: hạn quyền — gần nhất %, % quyền hết hạn trong 30 ngày', left(v ->> 'nextExpiry', 10), v ->> 'within30';
end $$;

-- Hàng loạt: gắn mẫu
do $$
declare v jsonb; r jsonb;
begin
  v := public.preview_bulk_permission_change_v1(array[pg_temp.uid('quy'), pg_temp.uid('ngoc'), pg_temp.uid('duan')],
    '{"kind":"template","templateCode":"site_staff"}');
  select x into r from jsonb_array_elements(v -> 'rows') x where (x ->> 'userId')::uuid = pg_temp.uid('quy');
  if not (r ->> 'skip')::boolean or r ->> 'note' <> 'Đã theo mẫu này' then raise exception 'SMOKE: Quý đã theo mẫu nhưng không bỏ qua: %', r; end if;
  select x into r from jsonb_array_elements(v -> 'rows') x where (x ->> 'userId')::uuid = pg_temp.uid('ngoc');
  if (r ->> 'skip')::boolean or (r ->> 'add')::int = 0 or r ->> 'fromTemplate' <> 'Nhân viên cơ bản' or r ->> 'toTemplate' <> 'Cán bộ công trường' then
    raise exception 'SMOKE: xem trước Ngọc sai: %', r; end if;
  begin perform public.apply_bulk_permission_change_v1(array[pg_temp.uid('ngoc')], '{"kind":"template","templateCode":"site_staff"}', 'ngắn');
    raise exception 'SMOKE: áp hàng loạt không cần lý do';
  exception when sqlstate '22023' then null; end;
  v := public.apply_bulk_permission_change_v1(array[pg_temp.uid('quy'), pg_temp.uid('ngoc'), pg_temp.uid('duan')],
    '{"kind":"template","templateCode":"site_staff"}', 'Theo chức danh (smoke)');
  if jsonb_array_length(v -> 'done') <> 2 or jsonb_array_length(v -> 'skipped') <> 1 or jsonb_array_length(v -> 'failed') <> 0 then
    raise exception 'SMOKE: kết quả gắn mẫu hàng loạt sai: %', v; end if;
  if (select count(*) from public.user_template_assignments where user_id in (pg_temp.uid('ngoc'), pg_temp.uid('duan')) and template_code = 'site_staff') <> 2 then
    raise exception 'SMOKE: chưa đổi mẫu'; end if;
  if (select count(*) from public.permission_audit_events where event_type = 'user_template_assignment_saved'
      and target_user_id in (pg_temp.uid('ngoc'), pg_temp.uid('duan')) and metadata ->> 'reason' = 'Theo chức danh (smoke)') <> 2 then
    raise exception 'SMOKE: thiếu nhật ký từng người'; end if;
  raise notice 'OK: gắn mẫu hàng loạt — Quý bỏ qua (đã theo mẫu), Ngọc + Duân sang Cán bộ công trường, mỗi người một dòng nhật ký';
end $$;

-- Hàng loạt: tích ô Duyệt PO (kiêm nhiệm cần ghi nhận)
do $$
declare v jsonb; r jsonb;
begin
  v := public.preview_bulk_permission_change_v1(array[pg_temp.uid('linh'), pg_temp.uid('ngoc')], '{"kind":"option","optionKey":"po_approver","on":true}');
  select x into r from jsonb_array_elements(v -> 'rows') x where (x ->> 'userId')::uuid = pg_temp.uid('ngoc');
  if not (r ->> 'skip')::boolean or r ->> 'note' not like '%không có ô này' then raise exception 'SMOKE: mẫu không có ô vẫn áp: %', r; end if;
  select x into r from jsonb_array_elements(v -> 'rows') x where (x ->> 'userId')::uuid = pg_temp.uid('linh');
  if (r ->> 'skip')::boolean or jsonb_array_length(r -> 'warnings') = 0 then raise exception 'SMOKE: Linh tích Duyệt PO không báo kiêm nhiệm: %', r; end if;
  v := public.apply_bulk_permission_change_v1(array[pg_temp.uid('linh')], '{"kind":"option","optionKey":"po_approver","on":true}', 'Chủ SP duyệt (smoke)');
  if jsonb_array_length(v -> 'failed') <> 1 or v -> 'failed' -> 0 ->> 'error' <> 'Chạm luật kiêm nhiệm — cần ghi nhận' then
    raise exception 'SMOKE: chưa chặn kiêm nhiệm khi không ghi nhận: %', v; end if;
  v := public.apply_bulk_permission_change_v1(array[pg_temp.uid('linh')], '{"kind":"option","optionKey":"po_approver","on":true}', 'Chủ SP duyệt (smoke)',
    jsonb_build_object('reason', 'Phó phòng duyệt PO khi trưởng phòng vắng', 'controlOwnerUserId', pg_temp.uid('mo'),
      'compensatingControls', 'Chị Mơ rà soát đơn đã duyệt hằng tuần', 'expiresAt', (now() + interval '180 days')::text));
  if jsonb_array_length(v -> 'done') <> 1 then raise exception 'SMOKE: ghi nhận rồi vẫn không áp được: %', v; end if;
  if not exists (select 1 from public.user_template_assignments where user_id = pg_temp.uid('linh') and 'po_approver' = any(options)) then
    raise exception 'SMOKE: chưa tích ô Duyệt PO'; end if;
  if not exists (select 1 from public.authorization_sod_warning_acceptances where target_user_id = pg_temp.uid('linh') and expires_at > now() + interval '170 days') then
    raise exception 'SMOKE: chưa lưu ghi nhận kiêm nhiệm'; end if;
  raise notice 'OK: tích Duyệt PO — mẫu không có ô thì bỏ qua; Linh chạm kiêm nhiệm: chặn khi chưa ghi nhận, ghi nhận xong thì áp';
end $$;

-- Hàng loạt: thêm một quyền, gia hạn
do $$
declare v jsonb;
begin
  v := public.apply_bulk_permission_change_v1(array[pg_temp.uid('ngoc'), pg_temp.uid('duan')],
    '{"kind":"add","permissionCode":"hrm.employee.edit_profile","scopeType":"global"}', 'Kiêm nhiệm tạm thời (smoke)');
  if jsonb_array_length(v -> 'done') <> 2 then raise exception 'SMOKE: thêm quyền hàng loạt sai: %', v; end if;
  if (select count(*) from public.user_permission_grants where user_id in (pg_temp.uid('ngoc'), pg_temp.uid('duan')) and is_active
      and permission_code = 'hrm.employee.edit_profile' and expires_at between now() + interval '364 days' and now() + interval '366 days') <> 2 then
    raise exception 'SMOKE: quyền thêm thiếu hạn 1 năm'; end if;
  v := public.preview_bulk_permission_change_v1(array[pg_temp.uid('ngoc')], '{"kind":"add","permissionCode":"hrm.employee.edit_profile","scopeType":"global"}');
  if v -> 'rows' -> 0 ->> 'note' <> 'Đã có quyền này' then raise exception 'SMOKE: thêm trùng không bỏ qua: %', v; end if;

  v := public.preview_bulk_permission_change_v1(array[pg_temp.uid('thinh')], '{"kind":"extend","withinDays":30}');
  if v -> 'rows' -> 0 ->> 'note' <> 'Không có quyền sắp hết hạn' then raise exception 'SMOKE: gia hạn 30 ngày sai: %', v; end if;
  v := public.apply_bulk_permission_change_v1(array[pg_temp.uid('thinh')], '{"kind":"extend","withinDays":400}', 'Chủ SP duyệt gia hạn (smoke)');
  if jsonb_array_length(v -> 'done') <> 1 or (v -> 'done' -> 0 ->> 'extended')::int < 1 then raise exception 'SMOKE: gia hạn sai: %', v; end if;
  if exists (select 1 from public.user_permission_grants where user_id = pg_temp.uid('thinh') and is_active and expires_at < now() + interval '364 days') then
    raise exception 'SMOKE: còn quyền chưa gia hạn'; end if;
  raise notice 'OK: thêm quyền hàng loạt (hạn 1 năm, trùng thì bỏ qua); gia hạn: 30 ngày không có gì, 400 ngày gia hạn % quyền của Thịnh',
    v -> 'done' -> 0 ->> 'extended';
end $$;

-- Sao chép: Luật → Như (mẫu, thủ kho, Room)
do $$
declare v jsonb; v_wh text; v_rooms int;
begin
  select scope_id into v_wh from public.user_permission_grants where user_id = pg_temp.uid('luat') and is_active and permission_code = 'wms.transaction.keeper';
  v := public.preview_copy_permissions_v1(pg_temp.uid('luat'), array[pg_temp.uid('nhu'), pg_temp.uid('luat')], '{"template":true,"warehouses":true,"room":true}');
  if jsonb_array_length(v -> 'rows') <> 1 then raise exception 'SMOKE: chép sang chính người nguồn: %', v; end if;
  if not exists (select 1 from jsonb_array_elements(v -> 'rows' -> 0 -> 'lines') l where l ->> 'text' like 'Room: thêm vào%') then
    raise exception 'SMOKE: xem trước thiếu Room: %', v; end if;
  v := public.apply_copy_permissions_v1(pg_temp.uid('luat'), array[pg_temp.uid('nhu')], '{"template":true,"warehouses":true,"room":true}', 'Điều chuyển bộ phận (smoke)');
  if jsonb_array_length(v -> 'done') <> 1 then raise exception 'SMOKE: chép quyền lỗi: %', v; end if;
  if not exists (select 1 from public.user_permission_grants where user_id = pg_temp.uid('nhu') and is_active and permission_code = 'wms.transaction.keeper' and scope_id = v_wh) then
    raise exception 'SMOKE: chưa chép thủ kho'; end if;
  select count(*) into v_rooms from public.project_permission_room_members m join public.project_staff s on s.id = m.project_staff_id
  where s.user_id = pg_temp.uid('nhu')::text and m.is_active;
  if v_rooms = 0 or (v -> 'done' -> 0 ->> 'rooms')::int = 0 then raise exception 'SMOKE: chưa chép Room: %', v; end if;
  raise notice 'OK: chép Luật → Như: thủ kho cùng kho, vào % Room, không chép sang chính người nguồn', v_rooms;
end $$;

-- Sao chép chạm kiêm nhiệm: Tâm (kế toán + mua hàng + thủ kho) → Duân
do $$
declare v jsonb;
begin
  v := public.preview_copy_permissions_v1(pg_temp.uid('tam'), array[pg_temp.uid('duan')], '{"template":true,"warehouses":true,"extra":true}');
  if jsonb_array_length(v -> 'rows' -> 0 -> 'warnings') = 0 then raise exception 'SMOKE: chép kế toán + thủ kho không báo kiêm nhiệm: %', v; end if;
  v := public.apply_copy_permissions_v1(pg_temp.uid('tam'), array[pg_temp.uid('duan')], '{"template":true,"warehouses":true,"extra":true}', 'Điều chuyển bộ phận (smoke)');
  if jsonb_array_length(v -> 'failed') <> 1 then raise exception 'SMOKE: chép kiêm nhiệm không ghi nhận vẫn qua: %', v; end if;
  if (select template_code from public.user_template_assignments where user_id = pg_temp.uid('duan')) <> 'site_staff' then
    raise exception 'SMOKE: người lỗi bị đổi dở dang'; end if;
  raise notice 'OK: chép Tâm → Duân chạm kiêm nhiệm: chặn, Duân giữ nguyên (không đổi dở)';
end $$;

-- Nhật ký
do $$
declare v jsonb; n int;
begin
  v := public.list_permission_audit_v1(300);
  if jsonb_array_length(v -> 'rows') = 0 or exists (select 1 from jsonb_array_elements(v -> 'rows') r where r ->> 'kind' is null) then
    raise exception 'SMOKE: nhật ký rỗng hoặc có dòng không phân loại'; end if;
  if not exists (select 1 from jsonb_array_elements(v -> 'rows') r where r ->> 'reason' = 'Kiêm nhiệm tạm thời (smoke)' and r ->> 'kind' = 'change') then
    raise exception 'SMOKE: nhật ký thiếu dòng thêm quyền hàng loạt'; end if;
  v := public.list_permission_audit_v1(50, null, 'all', pg_temp.uid('ngoc'));
  if exists (select 1 from jsonb_array_elements(v -> 'rows') r where r ->> 'eventType' = 'direct_permission_grants_changed' and r ->> 'reason' = 'Theo chức danh (smoke)') then
    raise exception 'SMOKE: nhật ký lặp dòng đổi quyền riêng cạnh dòng gắn mẫu'; end if;
  if not exists (select 1 from jsonb_array_elements(v -> 'rows') r where r ->> 'kind' = 'template' and r ->> 'template' = 'Cán bộ công trường') then
    raise exception 'SMOKE: nhật ký Ngọc thiếu dòng gắn mẫu: %', v; end if;
  v := public.list_permission_audit_v1(50, null, 'room');
  select count(*) into n from jsonb_array_elements(v -> 'rows') r where r ->> 'kind' <> 'room';
  if n > 0 or jsonb_array_length(v -> 'rows') = 0 then raise exception 'SMOKE: lọc Room sai'; end if;
  v := public.list_permission_audit_v1(20, null, 'sod');
  if not exists (select 1 from jsonb_array_elements(v -> 'rows') r where r ->> 'rule' is not null and r ->> 'controlOwner' is not null) then
    raise exception 'SMOKE: dòng kiêm nhiệm thiếu tên luật / người kiểm soát: %', v; end if;
  raise notice 'OK: nhật ký phân loại đủ, gộp dòng trùng, lọc Room / kiêm nhiệm đúng';
end $$;

rollback;
\echo 'SMOKE ĐẠT — đã hoàn tác, Cloud không đổi'
