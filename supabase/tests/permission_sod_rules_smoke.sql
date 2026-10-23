-- Smoke Đợt 2c luật kiêm nhiệm (luôn HOÀN TÁC):
--   psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/permission_sod_rules_smoke.sql
-- Dữ liệu thật 23/10/2026: chị Hà có sẵn Mua hàng + Duyệt PO; anh Chung chỉ có Quản trị Mua hàng;
-- chị Đặng Thị Hương là thủ kho ở 2 kho; chị Hương (TCKT) và anh Chuẩn có Xác nhận chi.
\set ON_ERROR_STOP 1
begin;
\ir ../migrations/20261029160000_permission_sod_rules.sql

create temp table p on commit drop as
select key, u.id, u.auth_id, u.updated_at from (values
  ('admin', 'admin@khoviet.vn'), ('ha', 'hadtt@tienthinhjsc.vn'), ('chung', 'chungbq@tienthinhjsc.vn'),
  ('keeper', 'huongdt@tienthinhjsc.vn'), ('thinh', 'thinhdx@tienthinhjsc.vn'),
  ('huong', 'huongnt@tienthinhjsc.vn'), ('chuan', 'chuanhd@tienthinhjsc.vn')
) x(key, email) join public.users u on u.email = x.email and u.is_active;
create function pg_temp.act_as(k text) returns text language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', auth_id, 'role', 'authenticated')::text, true) from p where key = k $$;
create function pg_temp.uid(k text) returns uuid language sql as $$ select id from p where key = k $$;
create function pg_temp.has(k text, code text) returns boolean language sql as $$
  select exists (select 1 from public.user_permission_grants g where g.user_id = pg_temp.uid(k) and g.is_active
    and g.permission_code = code and (g.expires_at is null or g.expires_at > now())) $$;
-- Quyền riêng đang có của một người (dạng payload màn Người dùng), cộng thêm quyền tùy chọn.
create function pg_temp.grants_plus(k text, extra jsonb) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('permission_code', g.permission_code, 'scope_type', g.scope_type,
    'scope_id', g.scope_id, 'expires_at', g.expires_at, 'is_active', true)), '[]'::jsonb) || coalesce(extra, '[]'::jsonb)
  from public.user_permission_grants g where g.user_id = pg_temp.uid(k) and g.is_active $$;
create function pg_temp.save(k text, grants jsonb, acceptances jsonb) returns jsonb language sql as $$
  select public.update_user_authorization_v2(pg_temp.uid(k), '{}'::jsonb, grants, 'smoke luật kiêm nhiệm 2c',
    (select updated_at from public.users where id = pg_temp.uid(k)), acceptances) $$;
create function pg_temp.ack(rule text, scope_type text, scope_id text) returns jsonb language sql as $$
  select jsonb_build_object('ruleCode', rule, 'scopeType', scope_type, 'scopeId', scope_id,
    'reason', 'Thiếu người, anh Chung kiêm duyệt đơn', 'compensatingControls', 'Ban lãnh đạo xem lại đơn mua lớn hằng tuần',
    'controlOwnerUserId', pg_temp.uid('thinh'), 'expiresAt', now() + interval '6 months') $$;

do $$ begin
  if (select count(*) from public.authorization_sod_rules where is_active and rule_code in
      ('PROCUREMENT_BUY_APPROVE_PO', 'PROCUREMENT_BUY_WAREHOUSE_KEEPER', 'FINANCE_CONFIRM_MANAGE', 'FINANCE_CONFIRMER_SELF_REVERSE')) <> 4 then
    raise exception 'SMOKE: thiếu luật kiêm nhiệm'; end if;
  raise notice 'OK: 4 luật kiêm nhiệm có hiệu lực';
end $$;

select pg_temp.act_as('huong');
do $$ begin
  begin
    perform public.preview_user_authorization_sod_v1(pg_temp.uid('chung'), '[]'::jsonb);
    raise exception 'SMOKE: người không quản lý phân quyền xem được cảnh báo';
  exception when insufficient_privilege then null; end;
  begin
    perform public.list_user_sod_conflicts_v1(null);
    raise exception 'SMOKE: người không quản lý phân quyền xem được danh sách kiêm nhiệm';
  exception when insufficient_privilege then null; end;
  raise notice 'OK: chị Hương (không quản lý phân quyền) không xem được cảnh báo / danh sách';
end $$;

select pg_temp.act_as('admin');

-- Người kiêm nhiệm sẵn: sửa quyền khác không bị đòi ghi nhận.
do $$
declare v jsonb;
begin
  v := public.preview_user_authorization_sod_v1(pg_temp.uid('ha'), pg_temp.grants_plus('ha', '[{"permission_code": "kb.view", "scope_type": "global", "scope_id": "*", "is_active": true}]'));
  if jsonb_array_length(v -> 'warnings') > 0 then raise exception 'SMOKE: chị Hà kiêm nhiệm sẵn vẫn bị cảnh báo: %', v; end if;
  perform pg_temp.save('ha', pg_temp.grants_plus('ha', '[{"permission_code": "kb.view", "scope_type": "global", "scope_id": "*", "is_active": true}]'), '[]');
  if not pg_temp.has('ha', 'kb.view') then raise exception 'SMOKE: chưa lưu được quyền mới cho chị Hà'; end if;
  raise notice 'OK: chị Hà (Mua hàng + Duyệt PO sẵn) thêm quyền khác không cần ghi nhận';
end $$;

-- Kiêm nhiệm mới: anh Chung thêm Duyệt PO.
do $$
declare v jsonb; v_extra jsonb := jsonb_build_array(jsonb_build_object('permission_code', 'system.procurement.approve',
  'scope_type', 'global', 'scope_id', '*', 'expires_at', now() + interval '180 days', 'is_active', true));
begin
  v := public.preview_user_authorization_sod_v1(pg_temp.uid('chung'), pg_temp.grants_plus('chung', v_extra));
  if v -> 'warnings' -> 0 ->> 'ruleCode' is distinct from 'PROCUREMENT_BUY_APPROVE_PO'
     or jsonb_array_length(v -> 'warnings' -> 0 -> 'controls') = 0
     or jsonb_array_length(v -> 'warnings' -> 0 -> 'permissions') <> 2 then
    raise exception 'SMOKE: xem trước không báo Mua hàng + Duyệt PO đúng: %', v; end if;
  begin
    perform pg_temp.save('chung', pg_temp.grants_plus('chung', v_extra), '[]');
    raise exception 'SMOKE: lưu kiêm nhiệm mới không cần ghi nhận';
  exception when sqlstate '22023' then
    if sqlerrm !~ 'SoD warning acknowledgement required' then raise; end if;
  end;
  begin
    perform pg_temp.save('chung', pg_temp.grants_plus('chung', v_extra),
      jsonb_build_array(pg_temp.ack('PROCUREMENT_BUY_APPROVE_PO', 'global', '*') || jsonb_build_object('controlOwnerUserId', pg_temp.uid('admin'))));
    raise exception 'SMOKE: người cấp tự làm người kiểm soát';
  exception when sqlstate '22023' then
    if sqlerrm !~ 'Invalid SoD warning control evidence' then raise; end if;
  end;
  perform pg_temp.save('chung', pg_temp.grants_plus('chung', v_extra), jsonb_build_array(pg_temp.ack('PROCUREMENT_BUY_APPROVE_PO', 'global', '*')));
  if not pg_temp.has('chung', 'system.procurement.approve') then raise exception 'SMOKE: ghi nhận xong vẫn chưa có Duyệt PO'; end if;
  if not exists (select 1 from public.authorization_sod_warning_acceptances where target_user_id = pg_temp.uid('chung')
                 and rule_code = 'PROCUREMENT_BUY_APPROVE_PO' and control_owner_user_id = pg_temp.uid('thinh')) then
    raise exception 'SMOKE: không lưu ghi nhận ngoại lệ'; end if;
  v := public.list_user_sod_conflicts_v1(pg_temp.uid('chung'));
  if v -> 0 -> 'conflicts' -> 0 -> 'acceptance' ->> 'controlOwnerName' is null then
    raise exception 'SMOKE: danh sách kiêm nhiệm không hiện ghi nhận: %', v; end if;
  raise notice 'OK: anh Chung thêm Duyệt PO → cảnh báo; thiếu ghi nhận bị chặn; tự kiểm soát bị chặn; ghi nhận (anh Thịnh kiểm soát) thì lưu được';
end $$;

-- Thủ kho theo kho: cảnh báo đúng từng kho.
do $$
declare v jsonb;
begin
  v := public.preview_user_authorization_sod_v1(pg_temp.uid('keeper'), pg_temp.grants_plus('keeper',
    '[{"permission_code": "system.procurement.manage", "scope_type": "global", "scope_id": "*", "is_active": true}]'));
  if (select count(*) from jsonb_array_elements(v -> 'warnings') w
      where w ->> 'ruleCode' = 'PROCUREMENT_BUY_WAREHOUSE_KEEPER' and w ->> 'scopeType' = 'warehouse' and w ->> 'scopeLabel' is not null) <> 2 then
    raise exception 'SMOKE: thủ kho 2 kho không ra 2 cảnh báo có tên kho: %', v; end if;
  raise notice 'OK: chị Đặng Thị Hương (thủ kho 2 kho) thêm Quản trị Mua hàng → 2 cảnh báo theo kho: %',
    (select string_agg(w ->> 'scopeLabel', ', ') from jsonb_array_elements(v -> 'warnings') w);
end $$;

-- Gắn mẫu Mua hàng có Duyệt PO cho người mới: xem trước báo kiêm nhiệm, thiếu ghi nhận bị chặn.
do $$
declare v jsonb; v_user uuid := pg_temp.uid('keeper');
begin
  v := public.preview_user_template_assignment_v1(v_user, 'material_staff', array['po_approver']);
  if not exists (select 1 from jsonb_array_elements(v -> 'sod' -> 'warnings') w where w ->> 'ruleCode' = 'PROCUREMENT_BUY_APPROVE_PO') then
    raise exception 'SMOKE: xem trước gắn mẫu không báo kiêm nhiệm: %', v -> 'sod'; end if;
  begin
    perform public.save_user_template_assignment_v1(v_user, 'material_staff', array['po_approver'], 'smoke gắn mẫu 2c');
    raise exception 'SMOKE: gắn mẫu tạo kiêm nhiệm mà không cần ghi nhận';
  exception when sqlstate '22023' then
    if sqlerrm !~ 'SoD warning acknowledgement required' then raise; end if;
  end;
  perform public.save_user_template_assignment_v1(v_user, 'material_staff', array['po_approver'], 'smoke gắn mẫu 2c',
    (select jsonb_agg(pg_temp.ack(w ->> 'ruleCode', w ->> 'scopeType', w ->> 'scopeId')) from jsonb_array_elements(v -> 'sod' -> 'warnings') w));
  if not pg_temp.has('keeper', 'system.procurement.approve') then raise exception 'SMOKE: gắn mẫu có ghi nhận nhưng chưa có Duyệt PO'; end if;
  raise notice 'OK: gắn mẫu Mua hàng + Duyệt PO cho thủ kho → % cảnh báo, ghi nhận xong mới gắn được', jsonb_array_length(v -> 'sod' -> 'warnings');
end $$;

do $$
declare v jsonb;
begin
  v := public.list_user_sod_conflicts_v1(null);
  raise notice 'Danh sách kiêm nhiệm (trong giao dịch thử): %',
    (select string_agg((r ->> 'name') || ': ' || (select string_agg(c ->> 'name', '; ') from jsonb_array_elements(r -> 'conflicts') c), ' | ')
     from jsonb_array_elements(v) r);
  if (select count(*) from jsonb_array_elements(v) r where r ->> 'email' in
      ('hadtt@tienthinhjsc.vn', 'tamtt@tienthinhjsc.vn', 'thuypt@tienthinhjsc.vn', 'phuongvth@tienthinhjsc.vn')) <> 4 then
    raise exception 'SMOKE: danh sách thiếu 4 người kiêm nhiệm sẵn'; end if;
  if exists (select 1 from jsonb_array_elements(v) r where r ->> 'email' = 'admin@khoviet.vn') then
    raise exception 'SMOKE: Admin không thuộc danh sách kiêm nhiệm'; end if;
  raise notice 'OK: danh sách có đủ chị Hà, Tâm, Thủy, Phương; không có Admin';
end $$;

-- Người xác nhận không tự đảo phiếu.
insert into public.finance_payment_requests (id, code, supplier_name, method, planned_date, amount, status, threshold_amount, route,
  created_by, kind, paid)
values ('00000000-0000-4000-8000-0000000002c1', 'SMOKE-2C-PC', 'Smoke', 'cash', current_date, 1000, 'paid', 0, '[]'::jsonb,
  pg_temp.uid('chuan'), 'expense', jsonb_build_object('by', pg_temp.uid('huong'), 'batches', '[]'::jsonb));
insert into public.finance_cash_movements (id, code, kind, category, to_account_id, amount, movement_date, description, status, created_by, decided_by)
select '00000000-0000-4000-8000-0000000002c2', 'SMOKE-2C-Q', 'receipt', 'other', f.id, 1000, current_date, 'Smoke 2c', 'confirmed',
  pg_temp.uid('chuan'), pg_temp.uid('huong')
from public.cash_funds f limit 1;

select pg_temp.act_as('huong');
do $$
declare v jsonb;
begin
  begin
    perform public.reverse_finance_payment_request_v1(jsonb_build_object('requestId', '00000000-0000-4000-8000-0000000002c1',
      'expectedRowVersion', 1, 'reason', 'smoke tự đảo'));
    raise exception 'SMOKE: người xác nhận tự đảo được phiếu chi';
  exception when insufficient_privilege then
    if sqlerrm <> 'FINANCE_SELF_REVERSE' then raise; end if;
  end;
  v := public.list_finance_payment_requests_v1('{"stage": "paid"}');
  if (jsonb_path_query_first(v, '$.requests[*] ? (@.code == "SMOKE-2C-PC")') ->> 'canReverse')::boolean then
    raise exception 'SMOKE: người xác nhận vẫn thấy nút Đảo phiếu chi'; end if;
  if exists (select 1 from public.finance_cash_movements where code = 'SMOKE-2C-Q') then
    begin
      perform public.decide_finance_cash_movement_v1(jsonb_build_object('id', '00000000-0000-4000-8000-0000000002c2',
        'expectedRowVersion', 1, 'action', 'reverse', 'reason', 'smoke tự đảo'));
      raise exception 'SMOKE: người xác nhận tự đảo được phiếu quỹ';
    exception when insufficient_privilege then
      if sqlerrm <> 'FINANCE_SELF_REVERSE' then raise; end if;
    end;
    v := public.get_finance_cash_v1('{}');
    if (jsonb_path_query_first(v, '$.** ? (@.code == "SMOKE-2C-Q")') ->> 'canReverse')::boolean then
      raise exception 'SMOKE: người xác nhận vẫn thấy nút Đảo phiếu quỹ'; end if;
  end if;
  raise notice 'OK: chị Hương xác nhận chi thì không tự đảo được phiếu chi / phiếu quỹ, không thấy nút Đảo';
end $$;

select pg_temp.act_as('chuan');
do $$
declare v jsonb;
begin
  begin
    perform public.reverse_finance_payment_request_v1(jsonb_build_object('requestId', '00000000-0000-4000-8000-0000000002c1',
      'expectedRowVersion', 1, 'reason', ''));
    raise exception 'SMOKE: thiếu lý do mà vẫn đảo';
  exception when sqlstate '22023' then
    if sqlerrm <> 'FINANCE_REASON_REQUIRED' then raise; end if;
  end;
  v := public.list_finance_payment_requests_v1('{"stage": "paid"}');
  if not (jsonb_path_query_first(v, '$.requests[*] ? (@.code == "SMOKE-2C-PC")') ->> 'canReverse')::boolean then
    raise exception 'SMOKE: người xác nhận khác không thấy nút Đảo phiếu chi'; end if;
  raise notice 'OK: anh Chuẩn (người xác nhận khác) qua được chốt chặn, thấy nút Đảo';
end $$;

rollback;
\echo 'SMOKE ĐẠT — đã hoàn tác, Cloud không đổi'
