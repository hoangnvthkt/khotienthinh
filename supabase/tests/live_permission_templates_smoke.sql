-- Smoke Đợt 2b mẫu quyền sống (luôn HOÀN TÁC):
--   psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/live_permission_templates_smoke.sql
-- Dữ liệu thật 23/10/2026: chị Đặng Thị Thu Hà (Quyền phó phòng VTTB) theo mẫu "Quản lý kho" có ô Duyệt PO.
\set ON_ERROR_STOP 1
begin;
\ir ../migrations/20261029130000_live_permission_templates.sql

create temp table p on commit drop as
select key, u.id, u.auth_id from (values
  ('admin', 'admin@khoviet.vn'), ('ha', 'hadtt@tienthinhjsc.vn'), ('huong', 'huongnt@tienthinhjsc.vn')
) x(key, email) join public.users u on u.email = x.email and u.is_active;
create function pg_temp.act_as(k text) returns text language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', auth_id, 'role', 'authenticated')::text, true) from p where key = k $$;
create function pg_temp.uid(k text) returns uuid language sql as $$ select id from p where key = k $$;
create function pg_temp.has(k text, code text) returns boolean language sql as $$
  select exists (select 1 from public.user_permission_grants g where g.user_id = pg_temp.uid(k) and g.is_active
    and g.permission_code = code and g.scope_id = '*' and (g.expires_at is null or g.expires_at > now())) $$;

-- Một quyền riêng của chị Hà ngoài mẫu: không được đụng tới.
create temp table extra on commit drop as
select g.permission_code, g.scope_type from public.user_permission_grants g
join public.user_permission_templates t on t.code = 'warehouse_manager'
where g.user_id = (select id from p where key = 'ha') and g.is_active and g.scope_id = '*'
  and not exists (select 1 from jsonb_array_elements(t.items) i where i ->> 'permissionCode' = g.permission_code)
  and g.permission_code <> 'system.procurement.approve'
limit 1;

select pg_temp.act_as('huong');
do $$ begin
  begin
    perform public.save_user_template_assignment_v1(pg_temp.uid('ha'), 'warehouse_manager', array['po_approver'], 'smoke gắn mẫu 2b');
    raise exception 'SMOKE: người không có quyền phân quyền gắn được mẫu';
  exception when insufficient_privilege then null;
  end;
  raise notice 'OK: chị Hương (không quản lý phân quyền) không gắn được mẫu';
end $$;

select pg_temp.act_as('admin');
do $$
declare v jsonb; v_missing int;
begin
  v := public.preview_user_template_assignment_v1(pg_temp.uid('ha'), 'warehouse_manager', array['po_approver']);
  raise notice 'Xem trước gắn mẫu cho chị Hà: thêm % quyền, gỡ %', jsonb_array_length(v -> 'add'), jsonb_array_length(v -> 'remove');
  v := public.save_user_template_assignment_v1(pg_temp.uid('ha'), 'warehouse_manager', array['po_approver'], 'smoke gắn mẫu 2b');
  select count(*) into v_missing
  from jsonb_array_elements((select applied from public.user_template_assignments where user_id = pg_temp.uid('ha'))) a
  where not pg_temp.has('ha', a ->> 'permissionCode');
  if v_missing > 0 then raise exception 'SMOKE: còn % quyền mẫu chưa có hiệu lực', v_missing; end if;
  if not pg_temp.has('ha', 'system.procurement.approve') then raise exception 'SMOKE: tích Duyệt PO nhưng không có quyền'; end if;
  raise notice 'OK gắn mẫu: thêm %, gỡ %; đủ quyền mẫu + Duyệt PO', v ->> 'added', v ->> 'removed';
end $$;

-- Sửa mẫu: thêm "Kho tri thức — Xem" → xem trước báo chị Hà được thêm; lưu là chị Hà có ngay.
do $$
declare v_t public.user_permission_templates%rowtype; v jsonb; v_items jsonb;
begin
  select * into v_t from public.user_permission_templates where code = 'warehouse_manager';
  v_items := v_t.items || '[{"permissionCode": "kb.view", "scopeType": "global"}]'::jsonb;
  v := public.preview_permission_template_change_v1('warehouse_manager', v_items, v_t.options);
  if not exists (select 1 from jsonb_array_elements(v -> 'users') r
                 where (r ->> 'userId')::uuid = pg_temp.uid('ha') and r -> 'add' ? 'kb.view@global') then
    raise exception 'SMOKE: xem trước không báo chị Hà được thêm kb.view: %', v; end if;
  v := public.save_user_permission_template_v2(v_t.code, v_t.name, v_t.description, v_items, v_t.suggested_position_ids, v_t.is_active, v_t.options);
  if jsonb_array_length(v -> 'failed') > 0 then raise exception 'SMOKE: đồng bộ lỗi %', v -> 'failed'; end if;
  if not pg_temp.has('ha', 'kb.view') then raise exception 'SMOKE: sửa mẫu xong chị Hà chưa có kb.view'; end if;
  raise notice 'OK sửa mẫu: xem trước đúng, lưu xong chị Hà có thêm quyền mới (% người cập nhật)', jsonb_array_length(v -> 'synced');
end $$;

-- Admin bỏ riêng kb.view của chị Hà ở màn Người dùng → mẫu không cấp lại khi lưu mẫu lần nữa.
do $$
declare v_updated timestamptz; v_grants jsonb; v_t public.user_permission_templates%rowtype; v jsonb;
begin
  select updated_at into v_updated from public.users where id = pg_temp.uid('ha');
  select jsonb_agg(jsonb_build_object('permission_code', g.permission_code, 'scope_type', g.scope_type, 'scope_id', g.scope_id,
    'expires_at', g.expires_at, 'is_active', true)) into v_grants
  from public.user_permission_grants g where g.user_id = pg_temp.uid('ha') and g.is_active and g.permission_code <> 'kb.view';
  perform public.update_user_authorization_v2(pg_temp.uid('ha'), '{}'::jsonb, v_grants, 'smoke bỏ riêng kb.view', v_updated);
  if pg_temp.has('ha', 'kb.view') then raise exception 'SMOKE: chưa bỏ được kb.view'; end if;
  if not exists (select 1 from jsonb_array_elements((select excluded from public.user_template_assignments where user_id = pg_temp.uid('ha'))) e
                 where e ->> 'permissionCode' = 'kb.view') then
    raise exception 'SMOKE: chưa ghi nhận bỏ riêng kb.view'; end if;
  select * into v_t from public.user_permission_templates where code = 'warehouse_manager';
  v := public.save_user_permission_template_v2(v_t.code, v_t.name, v_t.description, v_t.items, v_t.suggested_position_ids, v_t.is_active, v_t.options);
  if pg_temp.has('ha', 'kb.view') then raise exception 'SMOKE: mẫu cấp lại quyền Admin đã bỏ riêng'; end if;
  raise notice 'OK chỉnh riêng: Admin bỏ kb.view cho chị Hà, lưu mẫu lại không cấp lại';
end $$;

-- Mẫu gỡ một quyền mẫu từng cấp → chị Hà mất quyền đó; quyền riêng ngoài mẫu vẫn còn.
do $$
declare v_t public.user_permission_templates%rowtype; v_drop text; v jsonb;
begin
  select * into v_t from public.user_permission_templates where code = 'warehouse_manager';
  select i ->> 'permissionCode' into v_drop from jsonb_array_elements(v_t.items) i
  where i ->> 'permissionCode' = 'settings.loss_norms.view' limit 1;
  if v_drop is null then raise exception 'SMOKE: mẫu không có settings.loss_norms.view để thử gỡ'; end if;
  v := public.save_user_permission_template_v2(v_t.code, v_t.name, v_t.description,
    (select jsonb_agg(i) from jsonb_array_elements(v_t.items) i where i ->> 'permissionCode' <> v_drop),
    v_t.suggested_position_ids, v_t.is_active, v_t.options);
  if pg_temp.has('ha', v_drop) then raise exception 'SMOKE: mẫu gỡ % nhưng chị Hà vẫn còn', v_drop; end if;
  if exists (select 1 from extra) and not (select pg_temp.has('ha', permission_code) from extra) then
    raise exception 'SMOKE: quyền riêng ngoài mẫu bị gỡ'; end if;
  raise notice 'OK mẫu gỡ %: chị Hà mất quyền đó, quyền riêng ngoài mẫu (%) vẫn còn', v_drop, coalesce((select permission_code from extra), 'không có');
end $$;

-- Bỏ tích Duyệt PO → mất quyền Duyệt PO; gỡ liên kết → giữ nguyên quyền còn lại.
do $$
declare v_before int; v_after int;
begin
  perform public.save_user_template_assignment_v1(pg_temp.uid('ha'), 'warehouse_manager', '{}', 'smoke bỏ tích Duyệt PO');
  if pg_temp.has('ha', 'system.procurement.approve') then raise exception 'SMOKE: bỏ tích nhưng còn Duyệt PO'; end if;
  select count(*) into v_before from public.user_permission_grants where user_id = pg_temp.uid('ha') and is_active;
  perform public.remove_user_template_assignment_v1(pg_temp.uid('ha'), 'smoke gỡ liên kết mẫu');
  select count(*) into v_after from public.user_permission_grants where user_id = pg_temp.uid('ha') and is_active;
  if v_before <> v_after or exists (select 1 from public.user_template_assignments where user_id = pg_temp.uid('ha')) then
    raise exception 'SMOKE: gỡ liên kết làm đổi quyền (% → %)', v_before, v_after; end if;
  raise notice 'OK: bỏ tích Duyệt PO thì mất quyền; gỡ liên kết giữ nguyên % quyền', v_after;
end $$;

rollback;
\echo 'SMOKE ĐẠT — đã hoàn tác, Cloud không đổi'
