-- Smoke VPP báo cáo + chi phí sang Tài chính (Cloud đã có 2 migration VPP), chạy trong transaction ROLLBACK:
--   node scripts/run-supabase-cloud-transaction.mjs --expected-ref ftciqmqhmfvjtwoycswe \
--     --migration supabase/migrations/20261024170000_vpp_report_finance.sql --smoke supabase/tests/vpp_report_finance_smoke.sql
-- Nhập 15/09 + cấp 30/09 (tháng đã qua để chốt được), trả lại hôm nay → tháng 09 chốt 142.500 đ, tháng hiện tại có trả lại.
begin;

insert into public.users (id, name, email, username, role, is_active, account_status) values
  ('7a000000-0000-4000-8000-000000000001', 'VPP Smoke Requester', 'vpp-smoke-req@example.test', 'vpp-smoke-req', 'EMPLOYEE', true, 'ACTIVE'),
  ('7a000000-0000-4000-8000-000000000002', 'VPP Smoke Admin', 'vpp-smoke-admin@example.test', 'vpp-smoke-admin', 'ADMIN', true, 'ACTIVE');
insert into public.user_permission_grants (user_id, permission_code, scope_type, scope_id, is_active, granted_at) values
  ('7a000000-0000-4000-8000-000000000002', 'wms.transaction.keeper', 'warehouse', 'wh-1782120782470-7ey83', true, now());
-- Phân bổ tháng 09 nháp: chốt / đảo chi phí VPP phải dựng lại dòng Chi phí chung.
insert into public.finance_allocation_runs (code, period_month, created_by) values ('PB-VPP-SMOKE', '2026-09-01', '7a000000-0000-4000-8000-000000000002');
create temp table vpp_smoke (k text primary key, v jsonb) on commit drop;
grant all on vpp_smoke to authenticated;

-- Người đề xuất (không có quyền báo cáo).
select set_config('request.jwt.claims', jsonb_build_object('sub', '7a000000-0000-4000-8000-0000000000a1',
  'email', 'vpp-smoke-req@example.test', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into vpp_smoke select 'req', public.save_office_supply_request_v1(jsonb_build_object('lines', jsonb_build_array(
  jsonb_build_object('itemId', 'it-vpp-vpp001', 'qty', 2), jsonb_build_object('itemId', 'it-vpp-vpp005', 'qty', 5))));
do $$ begin
  perform public.get_office_supply_report_v1('{}'::jsonb);
  raise exception 'requester must not read report';
exception when insufficient_privilege then null; end $$;

-- Admin: nhập mua 15/09, duyệt, cấp ngày 30/09, trả lại 1 cây bút hôm nay.
select set_config('request.jwt.claims', jsonb_build_object('sub', '7a000000-0000-4000-8000-0000000000a2',
  'email', 'vpp-smoke-admin@example.test', 'role', 'authenticated')::text, true);
insert into vpp_smoke select 'receipt', public.receive_office_supply_v1(jsonb_build_object('date', '2026-09-15', 'supplierName', 'Smoke',
  'lines', jsonb_build_array(jsonb_build_object('itemId', 'it-vpp-vpp001', 'qty', 2, 'price', 62500), jsonb_build_object('itemId', 'it-vpp-vpp005', 'qty', 5, 'price', 3500))));
insert into vpp_smoke select 'approved', public.act_office_supply_request_v1(jsonb_build_object('id', (select v->>'id' from vpp_smoke where k = 'req'),
  'action', 'approve', 'expectedRowVersion', (select (v->>'rowVersion')::int from vpp_smoke where k = 'req')));
insert into vpp_smoke select 'issued', public.issue_office_supply_v1(jsonb_build_object('id', (select v->>'id' from vpp_smoke where k = 'req'),
  'expectedRowVersion', (select (v->>'rowVersion')::int from vpp_smoke where k = 'approved'), 'date', '2026-09-30',
  'lines', (select jsonb_agg(jsonb_build_object('lineId', l->>'id', 'qty', l->>'approvedQty')) from vpp_smoke s, jsonb_array_elements(s.v->'lines') l where s.k = 'approved')));
insert into vpp_smoke select 'returned', public.return_office_supply_v1(jsonb_build_object('id', (select v->>'id' from vpp_smoke where k = 'req'),
  'reason', 'smoke', 'lines', (select jsonb_agg(jsonb_build_object('lineId', l->>'id', 'qty', 1)) from vpp_smoke s, jsonb_array_elements(s.v->'lines') l
    where s.k = 'issued' and l->>'sku' = 'VPP005')));

insert into vpp_smoke select 'sep', public.get_office_supply_report_v1('{"month":"2026-09"}');
insert into vpp_smoke select 'now', public.get_office_supply_report_v1('{}');

do $$
declare s jsonb := (select v from vpp_smoke where k = 'sep'); n jsonb := (select v from vpp_smoke where k = 'now');
  a jsonb; b jsonb; me jsonb;
begin
  -- Giá cấp = giá bình quân (62.500 / 3.500), không còn 0 đ.
  if (s->'totals'->>'cost')::numeric <> 142500 then raise exception 'sep cost %', s->'totals'; end if;
  select x into a from jsonb_array_elements(s->'xnt') x where x->>'sku' = 'VPP001';
  if (a->>'inQty')::numeric <> 2 or (a->>'outQty')::numeric <> 2 or (a->>'outValue')::numeric <> 125000 or a->>'note' not like 'VPP Smoke Requester 2%' then raise exception 'sep VPP001 %', a; end if;
  select x into me from jsonb_array_elements(s->'people') x where x->>'name' = 'VPP Smoke Requester';
  if (me->>'value')::numeric <> 142500 or (me->>'issuedQty')::numeric <> 7 then raise exception 'sep person %', me; end if;
  if not exists (select 1 from jsonb_array_elements(s->'departments') d where d->>'name' = 'Chưa có phòng ban' and (d->>'value')::numeric = 142500) then
    raise exception 'sep dept %', s->'departments'; end if;
  -- Tháng hiện tại: tồn đầu VPP001 = 2 − 2 (tháng 09) + 10 (đầu kỳ) = 10; trả lại 1 bút = nhập 1, chi phí âm 3.500.
  select x into b from jsonb_array_elements(n->'xnt') x where x->>'sku' = 'VPP001';
  if (b->>'openQty')::numeric <> 10 or (b->>'closeQty')::numeric <> 10 then raise exception 'now VPP001 %', b; end if;
  select x into b from jsonb_array_elements(n->'xnt') x where x->>'sku' = 'VPP005';
  if (b->>'openQty')::numeric <> 86 or (b->>'inQty')::numeric <> 1 or (b->>'inValue')::numeric <> 3500 then raise exception 'now VPP005 %', b; end if;
  if (n->'totals'->>'returned')::numeric <> 3500 or (n->'totals'->>'cost')::numeric <> -3500 then raise exception 'now totals %', n->'totals'; end if;
  if (n->'posting'->>'closed')::boolean then raise exception 'current month must be open'; end if;
end $$;

-- Chốt tháng 09 → 142.500 đ; chốt lại phải có lý do; tháng hiện tại không chốt được; đảo.
insert into vpp_smoke select 'post', public.post_office_supply_costs_v1('{"month":"2026-09","expectedTotal":142500}');
do $$ begin
  perform public.post_office_supply_costs_v1('{"month":"2026-09","expectedTotal":142500}');
  raise exception 'repost without reason must fail';
exception when sqlstate '22023' then if sqlerrm <> 'VPP_REASON_REQUIRED' then raise; end if; end $$;
do $$ begin
  perform public.post_office_supply_costs_v1('{"month":"2026-09","expectedTotal":1}');
  raise exception 'stale total must fail';
exception when sqlstate 'PT409' then null; end $$;
do $$ begin
  perform public.post_office_supply_costs_v1(jsonb_build_object('month', to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM'), 'expectedTotal', -3500));
  raise exception 'open month must fail';
exception when sqlstate '22023' then if sqlerrm <> 'VPP_MONTH_OPEN' then raise; end if; end $$;
insert into vpp_smoke select 'repost', public.post_office_supply_costs_v1('{"month":"2026-09","expectedTotal":142500,"reason":"smoke chốt lại"}');
insert into vpp_smoke select 'pool', (select jsonb_agg(jsonb_build_object('amount', p.amount, 'included', p.included))
  from public.finance_allocation_pool p join public.finance_allocation_runs r on r.id = p.run_id where r.code = 'PB-VPP-SMOKE' and p.source_type = 'office_supply');
insert into vpp_smoke select 'readiness', public.get_finance_allocation_v1(date '2026-09-01')->'readiness';
insert into vpp_smoke select 'reverse', public.reverse_office_supply_costs_v1('{"month":"2026-09","reason":"smoke đảo"}');
insert into vpp_smoke select 'poolAfter', to_jsonb((select count(*) from public.finance_allocation_pool p join public.finance_allocation_runs r on r.id = p.run_id
  where r.code = 'PB-VPP-SMOKE' and p.source_type = 'office_supply'));

do $$
declare p jsonb := (select v from vpp_smoke where k = 'post'); r jsonb := (select v from vpp_smoke where k = 'repost');
  rd jsonb := (select v from vpp_smoke where k = 'readiness'); rv jsonb := (select v from vpp_smoke where k = 'reverse');
begin
  if (p->'posted'->>'total')::numeric <> 142500 or p->'posted'->>'code' <> 'CPVPP-2609' then raise exception 'post %', p; end if;
  if r->'posted'->>'code' <> 'CPVPP-2609-2' or jsonb_array_length(r->'history') <> 1 then raise exception 'repost %', r; end if;
  if (select v from vpp_smoke where k = 'pool') <> '[{"amount": 142500.00, "included": true}]'::jsonb then raise exception 'pool %', (select v from vpp_smoke where k = 'pool'); end if;
  if (select v from vpp_smoke where k = 'poolAfter') <> '0'::jsonb then raise exception 'pool after reverse'; end if;
  if (rd->'officeSupply'->>'postedTotal')::numeric <> 142500 then raise exception 'readiness %', rd; end if;
  if rv->'posted' is not null and rv->'posted' <> 'null'::jsonb then raise exception 'reverse %', rv; end if;
end $$;

select jsonb_build_object('sepTotals', (select v->'totals' from vpp_smoke where k = 'sep'), 'nowTotals', (select v->'totals' from vpp_smoke where k = 'now'),
  'posting', (select v->'posted'->>'code' from vpp_smoke where k = 'repost'), 'smoke', 'ok') result;

rollback;
