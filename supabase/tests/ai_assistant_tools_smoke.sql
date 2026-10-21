-- Trợ lý T1: ai_stock_by_items_v1 (SECURITY INVOKER — RLS sẵn có của kho quyết định): thủ kho công trường không thấy kho khác,
-- nhân viên không quyền kho không thấy;
-- cộng các dòng tồn cùng kho; bỏ kho lưu trữ và dòng bằng 0. Lưu nguồn dạng hồ sơ. Chạy rollback trên Cloud:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261018190000_ai_assistant_tools.sql --smoke supabase/tests/ai_assistant_tools_smoke.sql
begin;
create temp table t1_people(name text primary key, user_id uuid, email text) on commit drop;
create temp table t1_ids(key text primary key, value text) on commit drop;
grant select on t1_people, t1_ids to authenticated;
insert into t1_ids values ('item', 'ai-t1-item-' || gen_random_uuid()), ('w1', 'ai-t1-w1-' || gen_random_uuid()), ('w2', 'ai-t1-w2-' || gen_random_uuid()),
  ('w3', 'ai-t1-w3-' || gen_random_uuid()), ('zero', 'ai-t1-zero-' || gen_random_uuid());
insert into t1_people select n, gen_random_uuid(), 't1-' || gen_random_uuid() || '@invalid.local' from unnest(array['keeper', 'user']) n;
insert into public.users(id, name, username, email, role, is_active, account_status, assigned_warehouse_id)
  select user_id, 'T1 ' || name, 't1-' || user_id, email,
    case when name = 'keeper' then 'WAREHOUSE_KEEPER' else 'EMPLOYEE' end::public.user_role, true, 'ACTIVE',
    case when name = 'keeper' then (select value from t1_ids where key = 'w1') end
  from t1_people;
insert into public.items (id, sku, name, category, unit, price_in, price_out, min_stock)
  select value, 'T1-' || right(value, 8), 'Thép thử T1', 'Thép', 'tấn', 0, 0, 0 from t1_ids where key in ('item', 'zero');
insert into public.warehouses (id, name, address, type, is_archived)
  select value, 'Kho ' || key, '-', 'GENERAL', key = 'w3' from t1_ids where key like 'w%';
insert into public.inventory_balances (material_id, warehouse_id, project_id, on_hand_qty)
  select (select value from t1_ids where key = 'item'), (select value from t1_ids where key = w), p, q
  from (values ('w1', null, 10), ('w1', 'p-t1', 2.5), ('w2', null, 5), ('w3', null, 7)) v(w, p, q);
insert into public.inventory_balances (material_id, warehouse_id, on_hand_qty)
  select (select value from t1_ids where key = 'zero'), (select value from t1_ids where key = 'w1'), 0;

-- Cộng số liệu (chạy bằng chủ bảng, bỏ qua RLS): cộng các dòng cùng kho, bỏ kho lưu trữ và dòng bằng 0.
do $$
declare r jsonb := public.ai_stock_by_items_v1(array[(select value from t1_ids where key = 'item'), (select value from t1_ids where key = 'zero')]);
begin
  if jsonb_array_length(r) <> 2 then raise exception 'FAIL phải còn 2 kho (bỏ kho lưu trữ, bỏ dòng 0): %', r; end if;
  if (select (e->>'qty')::numeric from jsonb_array_elements(r) e where e->>'warehouseId' = (select value from t1_ids where key = 'w1')) <> 12.5 then
    raise exception 'FAIL phải cộng các dòng cùng kho: %', r;
  end if;
  if r->0->>'unit' <> 'tấn' or r->0->>'name' <> 'Thép thử T1' then raise exception 'FAIL thiếu tên / đơn vị: %', r; end if;
  if (select prosecdef from pg_proc where oid = 'public.ai_stock_by_items_v1(text[])'::regprocedure) then raise exception 'FAIL phải SECURITY INVOKER (theo RLS người hỏi)'; end if;
end $$;

-- Theo quyền người hỏi: thủ kho công trường không thấy kho khác; nhân viên không quyền kho không thấy gì.
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'email', email, 'role', 'authenticated')::text, true) from t1_people where name = 'keeper';
do $$
declare r jsonb := public.ai_stock_by_items_v1(array[(select value from t1_ids where key = 'item')]);
begin
  if exists (select 1 from jsonb_array_elements(r) e where e->>'warehouseId' <> (select value from t1_ids where key = 'w1')) then
    raise exception 'FAIL thủ kho thấy kho khác: %', r;
  end if;
end $$;

select set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'email', email, 'role', 'authenticated')::text, true) from t1_people where name = 'user';
do $$
declare s jsonb; src jsonb;
begin
  if jsonb_array_length(public.ai_stock_by_items_v1(array[(select value from t1_ids where key = 'item')])) <> 0 then raise exception 'FAIL nhân viên không quyền thấy tồn'; end if;
  src := jsonb_build_array('item.po.po-116', jsonb_build_object('ref', 'h1', 'type', 'record', 'record',
    jsonb_build_object('kind', 'purchase_order', 'id', 'po-1', 'code', 'PO-646', 'title', repeat('Thép ', 200))));
  s := public.ai_thread_save_turn_v1(null, jsonb_build_object('question', 'PO-646?', 'answer', 'PO-646 còn thiếu [[h1]]', 'sources', src));
  if jsonb_array_length(public.get_ai_thread_v1((s->>'threadId')::uuid)->'messages'->1->'sources') <> 2 then raise exception 'FAIL không lưu nguồn hồ sơ'; end if;
  raise notice 'ai_assistant_tools_smoke OK';
end $$;
rollback;
