-- Tìm kiếm toàn hệ thống v1: search_global_v1. Chạy cùng migration trong một giao dịch rollback:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> \
--   --migration supabase/migrations/20261010110000_global_search_v1.sql \
--   --smoke supabase/tests/global_search_v1_smoke.sql
-- Persona: boss (Admin) · nobody (nhân viên chưa có quyền nào). Kiểm: 20 nguồn chạy không lỗi, quyền theo RLS,
-- mã khớp đúng lên đầu, liệt kê theo loại khi chưa gõ, chuỗi lạ không lọt vào biểu thức chính quy.
create temporary table gs_test_people(name text primary key, id uuid default gen_random_uuid(),
  email text default ('gs-test-'||gen_random_uuid()||'@invalid.local'), role text);
insert into gs_test_people(name, role) values ('boss', 'ADMIN'), ('nobody', 'EMPLOYEE');
insert into public.users(id, name, username, email, role)
  select id, 'Search rollback '||name, 'gs-'||id, email, role::public.user_role from gs_test_people;
grant select on gs_test_people to authenticated, anon;

create temporary table gs_test_refs as select
  (select p.id from public.projects p where not coalesce(p.is_hidden, false) and btrim(p.name) <> '' order by p.created_at limit 1) as project_id,
  (select app_private.gs_fold(split_part(btrim(p.name), ' ', 1)) from public.projects p
     where not coalesce(p.is_hidden, false) and btrim(p.name) <> '' order by p.created_at limit 1) as project_word,
  (select po.po_number from public.purchase_orders po where po.archived_at is null and coalesce(po.po_number, '') ~ '[0-9]{3}' order by po.created_at desc limit 1) as po_number;
grant select on gs_test_refs to authenticated, anon;

create function pg_temp.gs_as(p_name text) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', (select jsonb_build_object('sub', gen_random_uuid(), 'email', email, 'role', 'authenticated')::text
    from gs_test_people where name = p_name), true);
end $$;
create function pg_temp.gs_assert(ok boolean, message text) returns void language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'Global search test failed: %', message; end if;
end $$;

-- Hàm phải chạy bằng quyền người gọi; anon không gọi được.
select pg_temp.gs_assert(not p.prosecdef, 'search_global_v1 must be SECURITY INVOKER')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'search_global_v1';
select pg_temp.gs_assert(not has_function_privilege('anon', 'public.search_global_v1(jsonb, text[], integer)', 'execute'), 'anon cannot search');
select pg_temp.gs_assert(app_private.gs_fold('Đề nghị THANH toán Đá') = 'de nghi thanh toan da', 'fold removes Vietnamese marks and đ');
select pg_temp.gs_assert(app_private.gs_initials('Nguyễn Văn Hoàng') = 'nvh', 'initials of a Vietnamese name');

set local role authenticated;

select pg_temp.gs_as('boss');
do $$ declare r jsonb; ref record; v_kinds text[]; begin
  select * into ref from gs_test_refs;
  perform pg_temp.gs_assert(ref.project_id is not null, 'need at least one project on this database');

  -- Mọi nguồn chạy (từ phổ biến "a" khớp đầu từ ở hầu hết bảng) — không nguồn nào lỗi.
  r := public.search_global_v1('[["a"]]'::jsonb, null, 3);
  raise notice 'boss search "a": % records, failed %, denied %', jsonb_array_length(r -> 'records'), r -> 'failed', r -> 'denied';
  perform pg_temp.gs_assert(r -> 'failed' = '[]'::jsonb, 'no source may fail for Admin: ' || (r -> 'failed')::text);

  -- Tìm dự án theo từ đầu tên (đã bỏ dấu).
  r := public.search_global_v1(jsonb_build_array(jsonb_build_array(ref.project_word)), array['project'], 25);
  perform pg_temp.gs_assert(exists (select 1 from jsonb_array_elements(r -> 'records') e where e ->> 'id' = ref.project_id),
    'project found by its first word ' || ref.project_word);
  perform pg_temp.gs_assert(not exists (select 1 from jsonb_array_elements(r -> 'records') e where e ->> 'kind' <> 'project'), 'kind filter respected');

  -- Từ chỉ loại: "du an" khớp mọi dự án (liệt kê), giới hạn số dòng.
  r := public.search_global_v1('[["da","du an"]]'::jsonb, array['project'], 4);
  perform pg_temp.gs_assert(jsonb_array_length(r -> 'records') between 1 and 4, 'kind word lists projects within the limit');

  -- Chưa gõ + có loại = mới nhất của loại đó; chưa gõ + không loại = rỗng.
  r := public.search_global_v1('[]'::jsonb, array['project'], 5);
  perform pg_temp.gs_assert(jsonb_array_length(r -> 'records') between 1 and 5, 'browse projects without terms');
  r := public.search_global_v1('[]'::jsonb, null, 5);
  perform pg_temp.gs_assert(jsonb_array_length(r -> 'records') = 0, 'nothing without terms or kinds');

  -- Mã PO gõ liền không gạch → đúng PO, hạng cao nhất.
  if ref.po_number is not null then
    r := public.search_global_v1(jsonb_build_array(jsonb_build_array(regexp_replace(lower(ref.po_number), '[^a-z0-9]+', '', 'g'))), array['purchase_order'], 5);
    perform pg_temp.gs_assert((r -> 'records' -> 0 ->> 'code') = ref.po_number and (r -> 'records' -> 0 ->> 'rank')::int = 100,
      'compact PO number ranks the PO first: ' || (r -> 'records')::text);
  end if;

  -- Chuỗi có ký tự biểu thức chính quy bị loại, không lỗi, không trả gì.
  r := public.search_global_v1('[["(.*)"], ["a|b"]]'::jsonb, null, 5);
  perform pg_temp.gs_assert(jsonb_array_length(r -> 'records') = 0 and r -> 'failed' = '[]'::jsonb, 'unsafe terms ignored');

  -- Loại lạ bị bỏ qua.
  r := public.search_global_v1('[["a"]]'::jsonb, array['nope', 'project'], 2);
  perform pg_temp.gs_assert(not exists (select 1 from jsonb_array_elements(r -> 'records') e where e ->> 'kind' <> 'project'), 'unknown kinds dropped');
end $$;

select pg_temp.gs_as('nobody');
do $$ declare r jsonb; ref record; begin
  select * into ref from gs_test_refs;
  r := public.search_global_v1(jsonb_build_array(jsonb_build_array(ref.project_word)), null, 10);
  raise notice 'nobody: % records, failed %, denied %', jsonb_array_length(r -> 'records'), r -> 'failed', r -> 'denied';
  perform pg_temp.gs_assert(r -> 'failed' = '[]'::jsonb, 'no source may fail for a plain employee: ' || (r -> 'failed')::text);
  perform pg_temp.gs_assert(not exists (select 1 from jsonb_array_elements(r -> 'records') e
    where e ->> 'kind' in ('project', 'purchase_order', 'payment_request', 'item', 'wms_tx', 'material_request', 'asset', 'office_doc', 'employee')),
    'employee without grants sees no project, PO, finance, stock, office or directory rows: ' || (r -> 'records')::text);
  perform pg_temp.gs_assert(r -> 'denied' ? 'employee', 'directory denied without hrm.employee.view_directory');
  r := public.search_global_v1('[["a"]]'::jsonb, array['project', 'purchase_order', 'payment_request'], 25);
  perform pg_temp.gs_assert(jsonb_array_length(r -> 'records') = 0, 'still nothing on a broad term');
end $$;
