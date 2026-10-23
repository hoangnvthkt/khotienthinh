-- Kiểm soát viên K1: giao người xử lý cho mọi lệch đang mở; luật chưa bật thì người xử lý không thấy; bật "Báo người xử lý" thì
-- P0 có thông báo ngay (một lần), Việc của tôi có nguồn 'control', bản tin 07:00 mỗi người một tin (chạy lại không gửi trùng);
-- người xử lý không tự chấp nhận được, Admin được; người ngoài không thấy; Trợ lý tra theo mã thấy đúng phạm vi.
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261029200000_control_k1_routing.sql --smoke supabase/tests/control_k1_routing_smoke.sql
begin;
create temp table lp(name text primary key, user_id uuid, email text, auth_id uuid, finding uuid) on commit drop;
grant select on lp to authenticated;
insert into lp select 'staff', gen_random_uuid(), 'lp-' || gen_random_uuid() || '@invalid.local', null, null;
insert into public.users(id, name, username, email, role, is_active, account_status)
  select user_id, 'LP staff', 'lp-' || user_id, email, 'EMPLOYEE'::public.user_role, true, 'ACTIVE' from lp where name = 'staff';
insert into lp select 'admin', u.id, u.email, u.auth_id, null from public.users u where u.name = 'Admin Hoàng' and u.auth_id is not null limit 1;

do $$
declare v jsonb; n int; f public.control_findings; v_owner uuid;
begin
  v := app_private.control_run(null, 'smoke');
  if jsonb_array_length(v->'errors') > 0 then raise exception 'FAIL 1 lỗi: %', v->'errors'; end if;
  if exists (select 1 from public.control_findings where status = 'open' and cardinality(assignee_ids) = 0) then raise exception 'FAIL 2 còn lệch chưa giao người'; end if;
  select * into f from public.control_findings where rule_code = 'statement_price_no_reason' and status = 'open' and object_code like 'PO-609%';
  if f.id is null then raise exception 'FAIL 3 không thấy PO-609'; end if;
  if (select count(*) from public.notifications where source_type = 'control_finding') > 0 then raise exception 'FAIL 4 luật chạy thử mà đã báo'; end if;
  -- Bật báo người xử lý cho luật giá đối soát + đề xuất kết thúc khi PO mở.
  update public.control_rules set mode = 'live' where code in ('statement_price_no_reason', 'mr_ended_po_open');
  perform app_private.control_run(null, 'smoke');
  select count(*) into n from public.notifications where source_type = 'control_finding' and source_id = f.id::text;
  if n = 0 then raise exception 'FAIL 5 P0 không có thông báo'; end if;
  perform app_private.control_run(null, 'smoke');
  if (select count(*) from public.notifications where source_type = 'control_finding' and source_id = f.id::text) <> n then raise exception 'FAIL 5b báo trùng'; end if;
  if (select count(*) from public.notifications where source_type = 'control_finding' and source_id in (select id::text from public.control_findings where rule_code = 'mr_ended_po_open')) > 0 then raise exception 'FAIL 5c P1 không được báo ngay'; end if;
  n := app_private.control_daily_digest();
  if n = 0 then raise exception 'FAIL 6 bản tin không gửi ai'; end if;
  if app_private.control_daily_digest() <> 0 then raise exception 'FAIL 6b bản tin gửi trùng trong ngày'; end if;
  select assignee_ids[1] into v_owner from public.control_findings where id = f.id;
  insert into lp select 'owner', u.id, u.email, u.auth_id, f.id from public.users u where u.id = v_owner;
  raise notice 'người xử lý PO-609: % · leo thang: %', (select string_agg(name, ', ') from public.users where id = any(f.assignee_ids)),
    (select string_agg(u.name, ', ') from public.control_findings x cross join unnest(x.escalate_ids) e join public.users u on u.id = e where x.id = f.id);
end $$;

set local role authenticated;
-- Người xử lý: thấy lệch của mình ở danh sách + Việc của tôi + Trợ lý; không thấy luật chạy thử; không tự chấp nhận (trừ khi là trưởng / quản trị).
select set_config('request.jwt.claims', jsonb_build_object('sub', coalesce(auth_id, user_id), 'email', email, 'role', 'authenticated')::text, true) from lp where name = 'owner';
do $$
declare v jsonb; v_id uuid := (select finding from lp where name = 'owner');
begin
  v := public.control_findings_v1(null, 'open', null, 100);
  if not exists (select 1 from jsonb_array_elements(v) x where (x->>'id')::uuid = v_id) then raise exception 'FAIL 7 người xử lý không thấy lệch của mình'; end if;
  if exists (select 1 from jsonb_array_elements(v) x where x->>'rule' not in ('statement_price_no_reason', 'mr_ended_po_open')) then raise exception 'FAIL 7b thấy luật chạy thử'; end if;
  if (public.control_overview_v1()->>'isAdmin')::boolean then raise exception 'FAIL 7c người xử lý thành Admin'; end if;
  v := public.vcc_my_work_items_v1('mine');
  if not exists (select 1 from jsonb_array_elements(v->'items') i where i->>'source' = 'control' and i->>'id' = v_id::text) then raise exception 'FAIL 8 Việc của tôi không có lệch'; end if;
  v := public.control_findings_for_code_v1('PO-609');
  if jsonb_array_length(v) = 0 then raise exception 'FAIL 9 Trợ lý tra PO-609 rỗng'; end if;
  begin perform public.control_rule_set_mode_v1('po_total_mismatch', 'live'); raise exception 'FAIL 10 người xử lý đổi được chế độ luật'; exception when insufficient_privilege then null; end;
end $$;

-- Người ngoài: không thấy gì.
select set_config('request.jwt.claims', jsonb_build_object('sub', user_id, 'email', email, 'role', 'authenticated')::text, true) from lp where name = 'staff';
do $$ begin
  if jsonb_array_length(public.control_findings_v1(null, 'open', null, 100)) <> 0 then raise exception 'FAIL 11 người ngoài thấy lệch'; end if;
  if jsonb_array_length(public.control_findings_for_code_v1('PO-609')) <> 0 then raise exception 'FAIL 11b người ngoài tra được PO-609'; end if;
  if (select count(*) from public.control_findings) <> 0 then raise exception 'FAIL 11c người ngoài đọc thẳng bảng'; end if;
  begin perform public.control_finding_accept_v1((select finding from lp where name = 'owner'), 'Lý do đủ dài để thử'); raise exception 'FAIL 12 người ngoài chấp nhận được'; exception when insufficient_privilege then null; end;
end $$;

-- Admin: thấy hết, đổi chế độ, chấp nhận.
select set_config('request.jwt.claims', jsonb_build_object('sub', auth_id, 'email', email, 'role', 'authenticated')::text, true) from lp where name = 'admin';
do $$ declare v jsonb; begin
  v := public.control_overview_v1();
  if not (v->>'isAdmin')::boolean or jsonb_array_length(v->'rules') < 18 then raise exception 'FAIL 13 admin tổng quan: %', left(v::text, 200); end if;
  v := public.control_rule_set_mode_v1('po_total_mismatch', 'live');
  v := public.control_finding_accept_v1((select finding from lp where name = 'owner'), 'Kế toán xác nhận giá phụ lục hợp đồng');
  if v->>'status' <> 'accepted' then raise exception 'FAIL 14 admin chấp nhận: %', v; end if;
end $$;
reset role;

select r.code, r.mode, count(f.id) filter (where f.status <> 'resolved') mo, min(cardinality(f.assignee_ids)) it_nhat_nguoi,
  (select string_agg(distinct u.name, ', ') from public.control_findings x cross join unnest(x.assignee_ids) a join public.users u on u.id = a where x.rule_code = r.code and x.status <> 'resolved') nguoi_xu_ly
from public.control_rules r left join public.control_findings f on f.rule_code = r.code
group by r.code, r.mode, r.sort_order order by r.sort_order;
rollback;
