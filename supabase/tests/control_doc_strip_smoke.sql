-- Dải cảnh báo trên chứng từ: lệch đang mở theo đơn mua / đề xuất, theo quyền xem (giao dịch tự hủy, dữ liệu thật).
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261030170000_control_doc_strip.sql --smoke supabase/tests/control_doc_strip_smoke.sql
begin;
create temp table ds(name text primary key, v text) on commit drop;
grant select on ds to authenticated;
insert into ds select 'po694', id from public.purchase_orders where po_number = 'PO-694';
insert into ds select 'po609', id from public.purchase_orders where po_number = 'PO-609';
insert into ds select 'mr9833', id from public.requests where code = 'MR-2026-9833';
insert into ds select 'staff_id', gen_random_uuid()::text;
insert into public.users(id, name, username, email, role, is_active, account_status)
  select v::uuid, 'DS staff', 'ds-' || v, 'ds-' || v || '@invalid.local', 'EMPLOYEE'::public.user_role, true, 'ACTIVE' from ds where name = 'staff_id';

select set_config('request.jwt.claims', jsonb_build_object('sub', auth_id, 'email', email, 'role', 'authenticated')::text, true)
from public.users where name = 'Admin Hoàng' and auth_id is not null limit 1;
set local role authenticated;
do $$ declare res jsonb; begin
  res := public.control_findings_for_doc_v1((select v from ds where name = 'po694'), null);
  if jsonb_array_length(res) <> 2 or exists (select 1 from jsonb_array_elements(res) x where x->>'rule' <> 'order_over_need') then raise exception 'FAIL 1 PO-694: %', res; end if;
  if (res->0->>'fixHint') is null then raise exception 'FAIL 1b thiếu cách sửa'; end if;
  res := public.control_findings_for_doc_v1((select v from ds where name = 'po609'), null);
  if not exists (select 1 from jsonb_array_elements(res) x where x->>'rule' = 'statement_price_no_reason') then raise exception 'FAIL 2 PO-609: %', res; end if;
  res := public.control_findings_for_doc_v1(null, (select v from ds where name = 'mr9833'));
  if not exists (select 1 from jsonb_array_elements(res) x where x->>'rule' = 'mr_ended_po_open') then raise exception 'FAIL 3 MR-2026-9833: %', res; end if;
  if jsonb_array_length(public.control_findings_for_doc_v1(null, null)) <> 0 then raise exception 'FAIL 4 không chứng từ mà ra lệch'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', jsonb_build_object('sub', v, 'email', 'ds-' || v || '@invalid.local', 'role', 'authenticated')::text, true) from ds where name = 'staff_id';
set local role authenticated;
do $$ begin
  if jsonb_array_length(public.control_findings_for_doc_v1((select v from ds where name = 'po694'), null)) <> 0 then raise exception 'FAIL 5 nhân viên ngoài thấy lệch'; end if;
end $$;
reset role;
select 'control doc strip smoke OK' ok;
rollback;
