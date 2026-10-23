-- Smoke quyền Duyệt PO (luôn HOÀN TÁC):
--   psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/procurement_po_approve_permission_smoke.sql
-- Dữ liệu thật 23/10/2026: PO-695 đang chờ chị Mơ duyệt; chị Mơ đã bị gỡ Quản trị Mua hàng.
\set ON_ERROR_STOP 1
begin;
\ir ../migrations/20261029090000_procurement_po_approve_permission.sql

create temp table p on commit drop as
select key, u.id, u.auth_id from (values
  ('mo', 'mont@tienthinhjsc.vn'), ('ha', 'hadtt@tienthinhjsc.vn')
) x(key, email) join public.users u on u.email = x.email and u.is_active;
insert into p select 'buyer', u.id, u.auth_id from public.users u
where u.is_active and u.role <> 'ADMIN'
  and app_private.has_permission(u.id, 'system.procurement.manage')
  and not app_private.has_permission(u.id, 'system.procurement.approve')
order by u.name limit 1;

create function pg_temp.act_as(k text) returns text language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', auth_id, 'role', 'authenticated')::text, true) from p where key = k $$;
create function pg_temp.uid(k text) returns uuid language sql as $$ select id from p where key = k $$;

do $$ begin
  if app_private.has_permission(pg_temp.uid('mo'), 'system.procurement.manage') then
    raise exception 'SMOKE: chị Mơ còn Quản trị Mua hàng — ca kiểm không còn đúng'; end if;
  if not app_private.procurement_po_approver_ok(pg_temp.uid('mo')) or not app_private.procurement_po_approver_ok(pg_temp.uid('ha')) then
    raise exception 'SMOKE: chị Mơ / chị Hà chưa là người duyệt PO'; end if;
  if app_private.procurement_po_approver_ok(pg_temp.uid('buyer')) then
    raise exception 'SMOKE: người mua không có quyền Duyệt PO vẫn được chọn duyệt'; end if;
  raise notice 'OK: người duyệt PO = chị Mơ, chị Hà; người mua khác không';
end $$;

select pg_temp.act_as('mo');
do $$
declare v jsonb; v_names text;
begin
  v := public.get_procurement_order_v1((select id from public.purchase_orders where po_number = 'PO-695'));
  if not coalesce((v->'permissions'->>'canApprove')::boolean, false) then
    raise exception 'SMOKE: chị Mơ không thấy nút Duyệt PO-695'; end if;
  select string_agg(a->>'name', ', ') into v_names from jsonb_array_elements(v->'approvers') a;
  if v_names is distinct from 'Đặng Thị Thu Hà' then
    raise exception 'SMOKE: danh sách người duyệt (trừ mình) phải chỉ có chị Hà, đang là %', v_names; end if;
  raise notice 'OK: chị Mơ mở được PO-695, có nút Duyệt; danh sách chọn người duyệt = %', v_names;
end $$;

do $$
declare v_po public.purchase_orders%rowtype; v jsonb;
begin
  select * into v_po from public.purchase_orders where po_number = 'PO-695';
  v := public.transition_procurement_hub_po_v1(jsonb_build_object('action', 'approve', 'purchaseOrderId', v_po.id,
    'expectedRowVersion', v_po.row_version));
  if coalesce(v->>'status', '') not in ('confirmed', 'sent') then
    raise exception 'SMOKE: duyệt PO-695 trả về %', v; end if;
  raise notice 'OK: chị Mơ duyệt được PO-695 (status %, chờ duyệt vượt ngân sách: %)', v->>'status', coalesce(v->>'budgetPending', 'false');
end $$;

select pg_temp.act_as('buyer');
do $$
declare v_po public.purchase_orders%rowtype;
begin
  select * into v_po from public.purchase_orders where po_number = 'PO-696';
  begin
    perform public.transition_procurement_hub_po_v1(jsonb_build_object('action', 'approve', 'purchaseOrderId', v_po.id,
      'expectedRowVersion', v_po.row_version));
    raise exception 'SMOKE: người mua duyệt thay được PO-696';
  exception when insufficient_privilege then
    raise notice 'OK: người mua không duyệt thay được đơn gửi cho chị Mơ (%)', sqlerrm;
  end;
end $$;

rollback;
\echo 'SMOKE ĐẠT — đã hoàn tác, Cloud không đổi'
