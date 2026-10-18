-- Trợ lý T2c: lệnh nháp 'purchase_order' ghi được trong lượt AI của chính mình; danh sách người duyệt đơn mua chỉ cho người có quyền
-- quản lý Mua hàng (nhân viên thường bị chặn). Chạy rollback trên Cloud:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261019110000_assistant_po_commands.sql --smoke supabase/tests/assistant_po_commands_smoke.sql
begin;
create temp table po_people(name text primary key, user_id uuid, email text) on commit drop;
grant select on po_people to authenticated;
insert into po_people select n, gen_random_uuid(), 'po-' || gen_random_uuid() || '@invalid.local' from unnest(array['staff']) n;
insert into public.users(id, name, username, email, role, is_active, account_status)
  select user_id, 'PO ' || name, 'po-' || user_id, email, 'EMPLOYEE'::public.user_role, true, 'ACTIVE' from po_people;

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'email', email, 'role', 'authenticated')::text, true) from po_people where name = 'staff';
do $$
declare run uuid; c jsonb;
begin
  run := (public.ai_gateway_begin_v1('assistant_chat', '{}'::jsonb)->>'runId')::uuid;
  c := public.assistant_command_create_v1(run, 'purchase_order', 'Đơn mua HANAKA · SMB-2026',
    '{"projectId":"p-1","vendorQuery":"HANAKA","lines":[{"name":"Thép D16","qty":5,"unit":"tấn","price":15800000}]}'::jsonb, '{"lineCount":1}'::jsonb);
  if c->>'kind' <> 'purchase_order' or c->>'status' <> 'prepared' then raise exception 'FAIL tạo lệnh đơn mua %', c; end if;
  begin
    perform public.assistant_po_approvers_v1();
    raise exception 'FAIL nhân viên thường xem được người duyệt đơn mua';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Có quyền (chủ bảng): danh sách là mảng, không có người ngừng hoạt động.
reset role;
do $$
declare bad int;
begin
  select count(*) into bad from public.users u where not u.is_active and (u.role = 'ADMIN' or app_private.has_permission(u.id, 'system.procurement.manage'));
  if bad is null then raise exception 'FAIL đếm người duyệt'; end if;
end $$;
rollback;
