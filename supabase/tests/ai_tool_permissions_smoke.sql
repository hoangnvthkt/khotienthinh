-- Rà soát quyền 9 lệnh máy chủ mà 6 công cụ đọc của Trợ lý gọi (18/10/2026, docs/command-center/10-ra-soat-quyen-cong-cu-tro-ly-2026-10-18.md)
-- + 3 RPC hồ sơ nhân viên của chi_tiet_ho_so (19/10: get_hrm_employee_overview / _work_organization / _contract_employment).
-- Giả lập JWT của 3 người THẬT (Admin Hoàng · một người HR có hrm.employee.view_sensitive · một nhân viên thường không thuộc dự án
-- của PO thử) rồi gọi từng RPC, ghi kết quả / mã lỗi vào bảng tạm. CHỈ ĐỌC, toàn bộ trong giao dịch rollback:
--   CLOUD_SQL_ENV=/Users/admin/khotienthinh/.env node scripts/cloud-sql.mjs --file supabase/tests/ai_tool_permissions_smoke.sql --rollback
-- (tệp kết bằng rollback; cờ --rollback chỉ để dùng endpoint chạy được set role; bảng kết quả là câu select cuối).
begin;
set local statement_timeout = '120s';
create temp table ap_people(name text primary key, user_id uuid, display text, email text, auth_id uuid, employee_id uuid) on commit drop;
create temp table ap_fix(key text primary key, value text) on commit drop;
create temp table ap_out(vai text, rpc text, ket_qua text) on commit drop;
grant select on ap_people, ap_fix to authenticated;
grant insert on ap_out to authenticated;

-- Admin Hoàng
insert into ap_people select 'admin', u.id, u.name, u.email, u.auth_id, e.id from public.users u left join public.employees e on e.user_id = u.id and e.status = 'Đang làm việc'
  where u.name = 'Admin Hoàng' and u.auth_id is not null limit 1;
-- HR: không phải Admin, có hrm.employee.view_sensitive
insert into ap_people select 'hr', u.id, u.name, u.email, u.auth_id, e.id from public.users u left join public.employees e on e.user_id = u.id and e.status = 'Đang làm việc'
  where u.is_active and u.account_status = 'ACTIVE' and u.auth_id is not null and u.role <> 'ADMIN'
    and app_private.has_hrm_template_permission(u.id, 'hrm.employee.view_sensitive') order by u.name limit 1;
-- PO thử: đơn mới nhất có dự án, đã gửi
insert into ap_fix select 'po', po.id from public.purchase_orders po where po.archived_at is null and po.project_id is not null and po.status not in ('draft', 'cancelled') order by po.created_at desc limit 1;
insert into ap_fix select 'po_no', po.po_number from public.purchase_orders po where po.id = (select value from ap_fix where key = 'po');
insert into ap_fix select 'po_project', po.project_id from public.purchase_orders po where po.id = (select value from ap_fix where key = 'po');
insert into ap_fix select 'mr', r.id from public.requests r where r.request_origin = 'project' and r.status in ('APPROVED', 'IN_TRANSIT', 'COMPLETED') order by r.created_date desc limit 1;
insert into ap_fix select 'mr_code', r.code from public.requests r where r.id = (select value from ap_fix where key = 'mr');
insert into ap_fix select 'item', i.id from public.items i where exists (select 1 from public.inventory_balances b where b.material_id = i.id and b.on_hand_qty > 0) order by i.name limit 1;
insert into ap_fix select 'item_word', app_private.gs_fold(split_part(btrim(i.name), ' ', 1)) from public.items i where i.id = (select value from ap_fix where key = 'item');
insert into ap_fix select 'huong', e.id::text from public.employees e where e.full_name = 'Nguyễn Thị Hương' and e.status = 'Đang làm việc' order by e.created_at limit 1;
insert into ap_fix values ('year', extract(year from (now() at time zone 'Asia/Ho_Chi_Minh'))::text);
-- Nhân viên thường: EMPLOYEE, đang trong thí điểm Trung tâm (để vcc_ chạy được), không HR nhạy cảm, không quyền Mua hàng,
-- không thuộc dự án của PO thử, có hồ sơ nhân sự.
insert into ap_people select 'staff', u.id, u.name, u.email, u.auth_id, e.id from public.users u join public.employees e on e.user_id = u.id and e.status = 'Đang làm việc'
  where u.is_active and u.account_status = 'ACTIVE' and u.auth_id is not null and u.role = 'EMPLOYEE'
    and exists (select 1 from app_private.center_rollout_actors r where r.user_id = u.id and r.expires_at > now())
    and not app_private.has_hrm_template_permission(u.id, 'hrm.employee.view_sensitive')
    and not app_private.has_permission(u.id, 'system.procurement.view', 'global', '*')
    and not app_private.has_permission(u.id, 'system.procurement.manage', 'global', '*')
    and not app_private.has_permission(u.id, 'system.finance.view', 'global', '*')
    and not exists (select 1 from public.project_staff s where s.user_id = u.id::text and s.project_id = (select value from ap_fix where key = 'po_project') and s.end_date is null)
    and u.id <> (select user_id from ap_people where name = 'hr')
  order by u.name limit 1;

-- Thông tin nền (chạy bằng postgres): ai là ai, quyền danh bạ.
insert into ap_out select p.name, '_nguoi', p.display || ' · danh bạ=' || app_private.has_governed_hrm_permission(p.user_id, 'hrm.employee.view_directory')
  || ' · wms.inventory.view=' || app_private.has_permission(p.user_id, 'wms.inventory.view', 'global', '*')
  || ' · procurement.view=' || app_private.has_permission(p.user_id, 'system.procurement.view', 'global', '*') from ap_people p;
insert into ap_out select '_', '_fixture', string_agg(key || '=' || coalesce(value, 'NULL'), ' · ' order by key) from ap_fix where key in ('po_no', 'mr_code', 'item_word', 'year');
insert into ap_out select '_', '_secdef', string_agg(p.proname || '=' || case when p.prosecdef then 'DEFINER' else 'INVOKER' end, ' · ' order by p.proname)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('search_global_v1', 'ai_stock_by_items_v1', 'get_procurement_order_v1',
    'get_procurement_po_payment_status_v1', 'get_material_request_supply_v1', 'vcc_my_work_items_v1', 'list_hrm_employee_directory', 'get_hrm_leave_ledger', 'list_hrm_leave_balances');

-- Một lượt gọi: ghi "ok …" hoặc "LOI <sqlstate> <message>".
create function pg_temp.ap_try(p_name text, p_rpc text, p_sql text) returns void language plpgsql as $$
declare v jsonb; begin
  execute p_sql into v;
  insert into ap_out values (p_name, p_rpc, 'ok ' || coalesce(v::text, 'NULL'));
exception when others then
  insert into ap_out values (p_name, p_rpc, 'LOI ' || sqlstate || ' ' || left(sqlerrm, 80));
end $$;
-- Một người: 12 lượt.
create function pg_temp.ap_run(p_name text) returns void language plpgsql as $$
declare f record; me uuid; own uuid := (select employee_id from ap_people where name = p_name);
begin
  select * into f from (select
    (select value from ap_fix where key = 'po') po, (select value from ap_fix where key = 'po_no') po_no, (select value from ap_fix where key = 'mr') mr,
    (select value from ap_fix where key = 'item') item, (select value from ap_fix where key = 'item_word') item_word,
    (select value from ap_fix where key = 'huong')::uuid huong, (select value from ap_fix where key = 'year')::int yr) x;
  me := public.current_app_user_id();
  insert into ap_out values (p_name, 'current_app_user_id', case when me = (select user_id from ap_people where name = p_name) then 'ok đúng người' else 'LOI khác người: ' || coalesce(me::text, 'NULL') end);
  perform pg_temp.ap_try(p_name, 'search_global_v1(PO)', format($q$select jsonb_build_object('records', (select count(*) from jsonb_array_elements(r->'records') e where e->>'code' = %L), 'denied', r->'denied', 'failed', r->'failed')
    from public.search_global_v1(%L::jsonb, array['purchase_order'], 8) r$q$, f.po_no, jsonb_build_array(jsonb_build_array(lower(f.po_no)))::text));
  perform pg_temp.ap_try(p_name, 'search_global_v1(employee)', $q$select jsonb_build_object('records', jsonb_array_length(r->'records'), 'denied', r->'denied', 'failed', r->'failed') from public.search_global_v1('[["huong"]]'::jsonb, array['employee'], 8) r$q$);
  perform pg_temp.ap_try(p_name, 'search_global_v1(item)', format($q$select jsonb_build_object('records', jsonb_array_length(r->'records'), 'denied', r->'denied', 'failed', r->'failed') from public.search_global_v1(%L::jsonb, array['item'], 6) r$q$, jsonb_build_array(jsonb_build_array(f.item_word))::text));
  perform pg_temp.ap_try(p_name, 'ai_stock_by_items_v1', format($q$select jsonb_build_object('kho', jsonb_array_length(public.ai_stock_by_items_v1(array[%L])))$q$, f.item));
  perform pg_temp.ap_try(p_name, 'get_procurement_order_v1', format($q$select jsonb_build_object('po', r->>'poNumber', 'lines', jsonb_array_length(r->'lines'), 'total', r->'totalAmount') from public.get_procurement_order_v1(%L) r$q$, f.po));
  perform pg_temp.ap_try(p_name, 'get_procurement_po_payment_status_v1', format($q$select jsonb_build_object('keys', (select count(*) from jsonb_object_keys(public.get_procurement_po_payment_status_v1(array[%L]))))$q$, f.po));
  perform pg_temp.ap_try(p_name, 'get_material_request_supply_v1', format($q$select jsonb_build_object('status', r->>'status', 'lines', jsonb_array_length(r->'lines')) from public.get_material_request_supply_v1(%L) r$q$, f.mr));
  perform pg_temp.ap_try(p_name, 'vcc_my_work_items_v1', $q$select jsonb_build_object('items', jsonb_array_length(r->'items')) from public.vcc_my_work_items_v1('mine') r$q$);
  perform pg_temp.ap_try(p_name, 'list_hrm_employee_directory', $q$select jsonb_build_object('nv', jsonb_array_length(public.list_hrm_employee_directory()))$q$);
  perform pg_temp.ap_try(p_name, 'get_hrm_leave_ledger(Hương)', format($q$select jsonb_build_object('available', r->'balance'->'availableDays', 'entries', jsonb_array_length(r->'entries')) from public.get_hrm_leave_ledger(%L::uuid, %s) r$q$, f.huong, f.yr));
  if own is not null then
    perform pg_temp.ap_try(p_name, 'get_hrm_leave_ledger(chính mình)', format($q$select jsonb_build_object('available', r->'balance'->'availableDays') from public.get_hrm_leave_ledger(%L::uuid, %s) r$q$, own, f.yr));
  else
    insert into ap_out values (p_name, 'get_hrm_leave_ledger(chính mình)', 'bỏ qua: không có hồ sơ nhân sự');
  end if;
  perform pg_temp.ap_try(p_name, 'list_hrm_leave_balances', format($q$select jsonb_build_object('nv', jsonb_array_length(public.list_hrm_leave_balances(%s)))$q$, f.yr));
  -- chi_tiet_ho_so (19/10): mức xem + phần thấy được; hợp đồng chỉ gọi khi visibleSections cho phép (ở đây gọi thẳng để thấy RPC chặn ai).
  perform pg_temp.ap_try(p_name, 'get_hrm_employee_overview(Hương)', format($q$select jsonb_build_object('level', r->>'accessLevel', 'sections', jsonb_array_length(r->'visibleSections'), 'title', r->>'title', 'contract', r->'summary'->>'currentContractNumber') from public.get_hrm_employee_overview(%L::uuid) r$q$, f.huong));
  perform pg_temp.ap_try(p_name, 'get_hrm_employee_work_organization(Hương)', format($q$select jsonb_build_object('orgUnit', r->'orgUnit'->>'name', 'manager', r->'directManager'->>'fullName') from public.get_hrm_employee_work_organization(%L::uuid) r$q$, f.huong));
  perform pg_temp.ap_try(p_name, 'get_hrm_employee_contract_employment(Hương)', format($q$select jsonb_build_object('contracts', jsonb_array_length(r->'contracts'), 'events', jsonb_array_length(r->'employmentEvents')) from public.get_hrm_employee_contract_employment(%L::uuid) r$q$, f.huong));
end $$;
grant execute on function pg_temp.ap_try(text, text, text) to authenticated;
grant execute on function pg_temp.ap_run(text) to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', auth_id, 'email', email, 'role', 'authenticated')::text, true) from ap_people where name = 'admin';
select pg_temp.ap_run('admin');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', auth_id, 'email', email, 'role', 'authenticated')::text, true) from ap_people where name = 'hr';
select pg_temp.ap_run('hr');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', auth_id, 'email', email, 'role', 'authenticated')::text, true) from ap_people where name = 'staff';
select pg_temp.ap_run('staff');
reset role;

select vai, rpc, ket_qua from ap_out order by case vai when '_' then 0 when 'admin' then 1 when 'hr' then 2 else 3 end, rpc;
rollback;
