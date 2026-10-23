-- Kiểm soát viên K0: chạy mọi luật trên dữ liệu thật (không luật nào lỗi), chạy lần 2 không mở trùng, hết lệch thì tự đóng;
-- Admin xem / chấp nhận (cần lý do ≥ 10 ký tự) / mở lại; nhân viên thường bị chặn 42501; cuối cùng in số lệch từng luật.
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261028190000_control_findings_k0.sql --smoke supabase/tests/control_findings_k0_smoke.sql
begin;
create temp table lp(name text primary key, user_id uuid, email text, auth_id uuid) on commit drop;
grant select on lp to authenticated;
insert into lp select 'staff', gen_random_uuid(), 'lp-' || gen_random_uuid() || '@invalid.local', null;
insert into public.users(id, name, username, email, role, is_active, account_status)
  select user_id, 'LP staff', 'lp-' || user_id, email, 'EMPLOYEE'::public.user_role, true, 'ACTIVE' from lp where name = 'staff';
insert into lp select 'admin', u.id, u.email, u.auth_id from public.users u where u.name = 'Admin Hoàng' and u.auth_id is not null limit 1;

do $$
declare v jsonb; v2 jsonb; n_open int; n_after int; f public.control_findings;
begin
  v := app_private.control_run(null, 'smoke');
  if jsonb_array_length(v->'errors') > 0 then raise exception 'FAIL 1 luật lỗi: %', v->'errors'; end if;
  if (v->>'rules')::int <> (select count(*) from public.control_rules where mode <> 'off') then raise exception 'FAIL 1b chạy thiếu luật: %', v; end if;
  if (v->>'opened')::int = 0 then raise exception 'FAIL 1c dữ liệu thật mà không ra lệch nào: %', v; end if;
  -- Ca chủ SP thấy 22/10 phải có mặt.
  if not exists (select 1 from public.control_findings where rule_code = 'statement_price_no_reason' and object_code like 'PO-609%') then raise exception 'FAIL 2 thiếu PO-609 giá đối soát'; end if;
  if not exists (select 1 from public.control_findings where rule_code = 'mr_ended_po_open' and object_code = 'MR-2026-9833') then raise exception 'FAIL 2b thiếu MR-2026-9833'; end if;
  if (select count(*) from public.control_findings where rule_code = 'batch_wms_status' and object_code ~ '^PO-(116|163|181) ') < 3 then raise exception 'FAIL 2c thiếu PO-116/163/181'; end if;
  select count(*) into n_open from public.control_findings where status = 'open';
  v2 := app_private.control_run(null, 'smoke');
  if (v2->>'opened')::int <> 0 or (v2->>'resolved')::int <> 0 then raise exception 'FAIL 3 chạy lần 2 mở / đóng thêm: %', v2; end if;
  -- Hết lệch → tự đóng: giả một hồ sơ không còn trong luật.
  insert into public.control_findings(rule_code, object_key, object_type, title) values ('po_total_mismatch', 'po:khong-con-lech', 'purchase_order', 'giả') returning * into f;
  perform app_private.control_run('po_total_mismatch', 'smoke');
  if (select status from public.control_findings where id = f.id) <> 'resolved' then raise exception 'FAIL 4 không tự đóng'; end if;
  select count(*) into n_after from public.control_findings where status = 'open';
  if n_after <> n_open then raise exception 'FAIL 4b số mở đổi % → %', n_open, n_after; end if;
end $$;

do $$ begin
  begin perform public.control_overview_v1(); raise exception 'FAIL 5 không đăng nhập vẫn xem được'; exception when insufficient_privilege then null; end;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', user_id, 'email', email, 'role', 'authenticated')::text, true) from lp where name = 'staff';
do $$ begin
  begin perform public.control_overview_v1(); raise exception 'FAIL 6 nhân viên xem được'; exception when insufficient_privilege then null; end;
  begin perform public.control_run_now_v1(null); raise exception 'FAIL 6b nhân viên chạy được'; exception when insufficient_privilege then null; end;
  if (select count(*) from public.control_findings) <> 0 then raise exception 'FAIL 6c nhân viên đọc thẳng bảng được'; end if;
end $$;

select set_config('request.jwt.claims', jsonb_build_object('sub', auth_id, 'email', email, 'role', 'authenticated')::text, true) from lp where name = 'admin';
do $$
declare v jsonb; v_id uuid;
begin
  v := public.control_overview_v1();
  if jsonb_array_length(v->'rules') < 18 or v->'lastRun' is null then raise exception 'FAIL 7 tổng quan: %', left(v::text, 300); end if;
  v := public.control_findings_v1('statement_price_no_reason', 'open', null, 50);
  if jsonb_array_length(v) = 0 then raise exception 'FAIL 8 danh sách rỗng'; end if;
  v_id := (v->0->>'id')::uuid;
  begin perform public.control_finding_accept_v1(v_id, 'ngắn'); raise exception 'FAIL 9 lý do ngắn vẫn chấp nhận'; exception when invalid_parameter_value then null; end;
  v := public.control_finding_accept_v1(v_id, 'Kế toán xác nhận giá hợp đồng mới từ tháng 10');
  if v->>'status' <> 'accepted' then raise exception 'FAIL 9b chấp nhận: %', v; end if;
  if not exists (select 1 from public.audit_trail where table_name = 'control_findings' and record_id = v_id::text) then raise exception 'FAIL 9c không ghi nhật ký thay đổi'; end if;
  v := public.control_finding_reopen_v1(v_id);
  if v->>'status' <> 'open' then raise exception 'FAIL 10 mở lại: %', v; end if;
end $$;
reset role;

-- Số lệch từng luật trên dữ liệu thật (mới = từ 01/10, cũ = trước 01/10).
select r.code, r.severity, count(f.id) filter (where f.status = 'open' and not f.legacy) moi, count(f.id) filter (where f.status = 'open' and f.legacy) cu,
  round(sum(abs(f.amount)) filter (where f.status = 'open')) tien, (array_agg(f.title order by f.happened_on desc nulls last))[1] vi_du
from public.control_rules r left join public.control_findings f on f.rule_code = r.code
group by r.code, r.severity, r.sort_order order by r.sort_order;
rollback;
