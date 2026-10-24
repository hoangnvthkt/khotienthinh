-- Smoke Phân quyền kho qua luật kiêm nhiệm (luôn HOÀN TÁC):
--   psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/wms_access_sod_smoke.sql
\set ON_ERROR_STOP 1
begin;
-- 20261030180000_wms_access_sod.sql đã áp trên Cloud (24/10); chạy kèm bản vá.
\ir ../migrations/20261030190000_wms_access_sod_admin_fix.sql

create temp table p on commit drop as
select key, u.id, u.auth_id from (values ('admin', 'admin@khoviet.vn'), ('huong', 'huongnt@tienthinhjsc.vn'), ('chung', 'chungbq@tienthinhjsc.vn'),
  ('nhu', 'nhudx@tienthinhjsc.vn'), ('mo', 'mont@tienthinhjsc.vn')) x(key, email)
join public.users u on u.email = x.email and u.is_active;
create function pg_temp.uid(k text) returns uuid language sql stable as $$ select id from p where key = k $$;
create function pg_temp.act_as(k text) returns text language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', auth_id, 'role', 'authenticated')::text, true) from p where key = k $$;

-- Bộ việc kho hiện tại, giống accessFromGrants ở màn Phân quyền kho.
create function pg_temp.current_access() returns jsonb language sql stable as $$
  with g as (select g.user_id::text uid, g.permission_code code, g.scope_type st, g.scope_id sid from public.user_permission_grants g
    join public.users u on u.id = g.user_id and u.is_active and u.account_status = 'ACTIVE' where g.is_active and g.revoked_at is null),
  wh as (select id from public.warehouses where not coalesce(is_archived, false))
  select jsonb_build_object(
    'viewAll', coalesce((select jsonb_agg(distinct uid) from g where code = 'wms.inventory.view' and st = 'global'), '[]'),
    'viewWh', coalesce((select jsonb_object_agg(wh.id, coalesce((select jsonb_agg(distinct uid) from g where code = 'wms.inventory.view' and st = 'warehouse' and sid = wh.id), '[]')) from wh), '{}'),
    'propose', coalesce((select jsonb_agg(distinct uid) from g where code = 'wms.request.create' and st = 'global'), '[]'),
    'keepers', coalesce((select jsonb_object_agg(wh.id, coalesce((select jsonb_agg(distinct uid) from g where code = 'wms.transaction.keeper' and st = 'warehouse' and sid = wh.id), '[]')) from wh), '{}'),
    'code', coalesce((select jsonb_agg(distinct uid) from g where code = 'wms.master_data.issue_code' and st = 'global'), '[]'),
    'exception', coalesce((select jsonb_agg(distinct uid) from g where code = 'wms.transaction.exception_approve' and st = 'global'), '[]'),
    'accounting', coalesce((select jsonb_agg(distinct uid) from g where code = 'wms.accounting.manage' and st = 'global'), '[]'),
    'closer', (select min(uid) from g where code = 'wms.accounting.close_period' and st = 'global'),
    'whAdmin', coalesce((select jsonb_agg(distinct uid) from g where code in ('settings.warehouses.manage', 'wms.master_data.manage') and st = 'global'), '[]'),
    'revoke', '[]'::jsonb) $$;

select pg_temp.act_as('huong') \g /dev/null
do $$ begin
  begin perform public.preview_wms_access_v1(pg_temp.current_access()); raise exception 'SMOKE: Hương xem trước được phân quyền kho';
  exception when insufficient_privilege then null; end;
  raise notice 'OK: người không sửa phân quyền kho bị chặn';
end $$;

select pg_temp.act_as('admin') \g /dev/null
do $$
declare
  v_before text := (select md5(string_agg(id::text || is_active::text, ',' order by id)) from public.user_permission_grants);
  v jsonb := public.preview_wms_access_v1(pg_temp.current_access());
begin
  if v_before <> (select md5(string_agg(id::text || is_active::text, ',' order by id)) from public.user_permission_grants) then
    raise exception 'SMOKE: xem trước làm đổi quyền'; end if;
  if jsonb_array_length(v -> 'lines') <> (v ->> 'added')::int + (v ->> 'removed')::int then raise exception 'SMOKE: dòng xem trước lệch số: %', v; end if;
  raise notice 'OK: xem trước không ghi gì; máy chủ báo % dòng tự chuẩn hóa khi giữ nguyên (%)', jsonb_array_length(v -> 'lines'), v -> 'lines' ->> 0;
end $$;

-- Chung (Mua hàng) làm thủ kho một kho: chạm Mua hàng + Thủ kho.
do $$
declare
  v_wh text := (select id from public.warehouses where not coalesce(is_archived, false) order by name limit 1);
  v_p jsonb := pg_temp.current_access();
  v jsonb;
begin
  v_p := jsonb_set(v_p, array['keepers', v_wh], coalesce(v_p -> 'keepers' -> v_wh, '[]') || to_jsonb(pg_temp.uid('chung')::text));
  v := public.preview_wms_access_v1(v_p);
  if jsonb_array_length(v -> 'sod') <> 1 or (v -> 'sod' -> 0 ->> 'userId')::uuid <> pg_temp.uid('chung')
     or v -> 'sod' -> 0 -> 'warnings' -> 0 ->> 'ruleCode' <> 'PROCUREMENT_BUY_WAREHOUSE_KEEPER' then
    raise exception 'SMOKE: xem trước không báo kiêm nhiệm Mua hàng + Thủ kho: %', v; end if;
  begin
    perform public.save_wms_access_v1(v_p, 'Điều chuyển bộ phận');
    raise exception 'SMOKE: lưu được kiêm nhiệm khi chưa ghi nhận';
  exception when others then
    if sqlerrm not like '%acknowledgement required%' then raise; end if;
  end;
  if exists (select 1 from public.user_permission_grants where user_id = pg_temp.uid('chung') and is_active and permission_code = 'wms.transaction.keeper') then
    raise exception 'SMOKE: lưu dở dang'; end if;
  v := public.save_wms_access_v1(v_p, 'Điều chuyển bộ phận', jsonb_build_object('reason', 'Thủ kho tạm khi chị Nhung nghỉ phép', 'controlOwnerUserId', pg_temp.uid('mo'),
    'compensatingControls', 'Chị Mơ đối chiếu phiếu nhập với đơn mua hằng tuần', 'expiresAt', (now() + interval '90 days')::text));
  if (v ->> 'added')::int < 1 or not exists (select 1 from public.user_permission_grants where user_id = pg_temp.uid('chung') and is_active
      and permission_code = 'wms.transaction.keeper' and scope_id = v_wh) then raise exception 'SMOKE: chưa cấp thủ kho: %', v; end if;
  if not exists (select 1 from public.authorization_sod_warning_acceptances where target_user_id = pg_temp.uid('chung')
      and rule_code = 'PROCUREMENT_BUY_WAREHOUSE_KEEPER' and expires_at > now() + interval '80 days') then raise exception 'SMOKE: chưa lưu ghi nhận'; end if;
  if not exists (select 1 from public.permission_audit_events where event_type = 'wms_access_changed' and target_user_id = pg_temp.uid('chung')
      and metadata ->> 'reason' = 'Phân quyền kho: Điều chuyển bộ phận' and jsonb_array_length(metadata -> 'lines') >= 1) then
    raise exception 'SMOKE: thiếu nhật ký của Chung'; end if;
  if not exists (select 1 from public.permission_audit_events where event_type = 'wms_access_saved' and metadata ->> 'source' = 'wms_owners'
      and target_user_id = actor_user_id and (metadata -> 'lines' ->> 0) like '+ Bùi Quang Chung — Giao dịch kho: Thủ kho @ %') then
    raise exception 'SMOKE: thiếu dòng Lịch sử ở màn Phân quyền kho'; end if;
  raise notice 'OK: Chung làm thủ kho chạm Mua hàng + Thủ kho — chặn khi chưa ghi nhận, ghi nhận xong thì cấp, có nhật ký người + Lịch sử kho';
end $$;

-- Gỡ Xem mọi kho của Như (quyền có trong mẫu Cán bộ kho): mẫu ghi "bỏ riêng" để lần đồng bộ sau không cấp lại.
do $$
declare v_p jsonb := pg_temp.current_access(); v jsonb;
begin
  if not (v_p -> 'viewAll') ? pg_temp.uid('nhu')::text then raise exception 'SMOKE: Như không có Xem mọi kho để thử'; end if;
  v_p := jsonb_set(v_p, '{viewAll}', (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements(v_p -> 'viewAll') x where x #>> '{}' <> pg_temp.uid('nhu')::text));
  v := public.save_wms_access_v1(v_p, 'Theo chức danh');
  if exists (select 1 from public.user_permission_grants where user_id = pg_temp.uid('nhu') and is_active and permission_code = 'wms.inventory.view' and scope_type = 'global') then
    raise exception 'SMOKE: chưa gỡ Xem mọi kho của Như: %', v; end if;
  if (select template_code from public.user_template_assignments where user_id = pg_temp.uid('nhu')) = 'warehouse_manager'
     and not exists (select 1 from public.user_template_assignments a, jsonb_array_elements(a.excluded) x
       where a.user_id = pg_temp.uid('nhu') and x ->> 'permissionCode' = 'wms.inventory.view' and x ->> 'scopeType' = 'global') then
    raise exception 'SMOKE: mẫu chưa ghi Như bỏ riêng Xem mọi kho'; end if;
  raise notice 'OK: gỡ Xem mọi kho của Như — mẫu ghi bỏ riêng, đồng bộ mẫu sau không cấp lại';
end $$;

-- Đổi việc kho của chính Admin (bộ quyền có system.settings.manage chỉ cấp qua mẫu): xem trước / lưu không hỏng.
do $$
declare
  v_p jsonb := pg_temp.current_access();
  v jsonb;
begin
  v_p := jsonb_set(v_p, '{whAdmin}', (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements(v_p -> 'whAdmin') x where x #>> '{}' <> pg_temp.uid('admin')::text));
  v := public.preview_wms_access_v1(v_p);
  if not exists (select 1 from jsonb_array_elements_text(v -> 'lines') l where l like '− Admin Hoàng — %') then raise exception 'SMOKE: xem trước thiếu dòng của Admin: %', v; end if;
  perform public.save_wms_access_v1(v_p, 'Theo chức danh');
  raise notice 'OK: đổi việc kho của Admin — xem trước và lưu chạy, không xét kiêm nhiệm với ADMIN';
end $$;

do $$
declare v jsonb := public.list_permission_audit_v1(50, null, 'change', pg_temp.uid('chung'));
begin
  if not exists (select 1 from jsonb_array_elements(v -> 'rows') r where r ->> 'eventType' = 'wms_access_changed' and jsonb_array_length(r -> 'lines') >= 1) then
    raise exception 'SMOKE: Nhật ký phân quyền chưa đọc dòng đổi quyền kho: %', v; end if;
  if exists (select 1 from jsonb_array_elements(public.list_permission_audit_v1(100) -> 'rows') r where r ->> 'eventType' = 'wms_access_saved') then
    raise exception 'SMOKE: dòng tổng kho lọt vào Nhật ký phân quyền'; end if;
  raise notice 'OK: Nhật ký phân quyền có dòng đổi quyền kho từng người, không lặp dòng tổng';
end $$;

rollback;
\echo 'SMOKE ĐẠT — đã hoàn tác, Cloud không đổi'
