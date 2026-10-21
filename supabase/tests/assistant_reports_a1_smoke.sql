-- Báo cáo A1 cho Trợ lý: 3 RPC security invoker chạy dưới RLS — Admin thấy số; nhân viên mới không thuộc phiếu / kho / đơn nào thấy 0;
-- tham số sai → 22023; không đăng nhập → 42501.
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261021090000_assistant_reports_a1.sql --smoke supabase/tests/assistant_reports_a1_smoke.sql
begin;
create temp table lp(name text primary key, user_id uuid, email text, auth_id uuid) on commit drop;
grant select on lp to authenticated;
insert into lp select 'staff', gen_random_uuid(), 'lp-' || gen_random_uuid() || '@invalid.local', null;
insert into public.users(id, name, username, email, role, is_active, account_status)
  select user_id, 'LP staff', 'lp-' || user_id, email, 'EMPLOYEE'::public.user_role, true, 'ACTIVE' from lp;
insert into lp select 'admin', u.id, u.email, u.auth_id from public.users u where u.name = 'Admin Hoàng' and u.auth_id is not null limit 1;

do $$
begin
  begin perform public.assistant_report_workflow_v1(current_date - 90, current_date, 'month'); raise exception 'FAIL 0 không đăng nhập vẫn gọi được'; exception when insufficient_privilege then null; end;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', auth_id, 'email', email, 'role', 'authenticated')::text, true) from lp where name = 'admin';
do $$
declare w jsonb; i jsonb; p jsonb; it text;
begin
  w := public.assistant_report_workflow_v1(current_date - 90, current_date, 'month');
  if (w->>'total')::int <= 0 or jsonb_array_length(w->'buckets') < 3 then raise exception 'FAIL 1 Admin không thấy phiếu quy trình: %', w; end if;
  if (w->'byStatus') is null or jsonb_array_length(w->'byTemplate') = 0 then raise exception 'FAIL 1 thiếu theo mẫu / trạng thái: %', w; end if;
  w := public.assistant_report_workflow_v1(current_date - 20, current_date, 'week');
  if jsonb_array_length(w->'buckets') < 3 then raise exception 'FAIL 1 nhóm tuần: %', w->'buckets'; end if;

  i := public.assistant_report_inventory_v1(current_date - 90, current_date, 'month', null, null);
  if (i->>'totalInAmount')::numeric <= 0 or jsonb_array_length(i->'topOut') = 0 or jsonb_array_length(i->'warehouses') = 0 then raise exception 'FAIL 2 Admin không thấy sổ kho: %', i - 'buckets'; end if;
  select material_id into it from public.inventory_ledger_entries where movement_direction = 'in' and transaction_date >= current_date - 90 group by material_id order by sum(quantity_in) desc limit 1;
  i := public.assistant_report_inventory_v1(current_date - 90, current_date, 'month', null, it);
  if (i->'item') is null or (i->>'totalIn')::numeric <= 0 or jsonb_array_length(i->'stockNow') = 0 then raise exception 'FAIL 2 theo vật tư: %', i - 'buckets'; end if;
  i := public.assistant_report_inventory_v1(current_date - 90, current_date, 'month', 'kho-khong-ton-tai-xyz', null);
  if jsonb_array_length(i->'warehouses') <> 0 or (i->>'totalInAmount')::numeric <> 0 then raise exception 'FAIL 2 lọc kho lạ phải rỗng: %', i - 'buckets'; end if;

  p := public.assistant_report_procurement_v1(current_date - 90, current_date, 'month');
  if (p->>'total')::int <= 0 or (p->>'totalAmount')::numeric <= 0 or jsonb_array_length(p->'byVendor') = 0 then raise exception 'FAIL 3 Admin không thấy đơn mua: %', p - 'buckets'; end if;

  begin perform public.assistant_report_workflow_v1(current_date, current_date - 1, 'month'); raise exception 'FAIL 4 ngược ngày'; exception when invalid_parameter_value then null; end;
  begin perform public.assistant_report_procurement_v1(current_date - 10, current_date, 'day'); raise exception 'FAIL 4 nhóm lạ'; exception when invalid_parameter_value then null; end;
  begin perform public.assistant_report_inventory_v1(current_date - 500, current_date, 'month', null, null); raise exception 'FAIL 4 quá dài'; exception when invalid_parameter_value then null; end;
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'email', email, 'role', 'authenticated')::text, true) from lp where name = 'staff';
do $$
declare w jsonb; i jsonb; p jsonb;
begin
  -- Nhân viên mới không có tên trên phiếu nào, không được vào kho nào, không xem đơn nào → RLS cho số 0, không lỗi, không lộ.
  w := public.assistant_report_workflow_v1(current_date - 90, current_date, 'month');
  if (w->>'total')::int <> 0 or (w->>'runningNow')::int <> 0 then raise exception 'FAIL 5 nhân viên thấy phiếu người khác: %', w - 'buckets'; end if;
  i := public.assistant_report_inventory_v1(current_date - 90, current_date, 'month', null, null);
  if (i->>'totalInAmount')::numeric <> 0 or jsonb_array_length(i->'topOut') <> 0 then raise exception 'FAIL 5 nhân viên thấy sổ kho: %', i - 'buckets'; end if;
  p := public.assistant_report_procurement_v1(current_date - 90, current_date, 'month');
  if (p->>'total')::int <> 0 then raise exception 'FAIL 5 nhân viên thấy đơn mua: %', p - 'buckets'; end if;
end $$;
reset role;
rollback;
