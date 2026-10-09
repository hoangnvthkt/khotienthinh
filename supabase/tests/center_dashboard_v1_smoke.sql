-- Bảng điều khiển Trung tâm v1: get_center_dashboard_v1. Chạy cùng migration trong một giao dịch rollback:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> \
--   --migration supabase/migrations/20261010120000_center_dashboard_v1.sql \
--   --smoke supabase/tests/center_dashboard_v1_smoke.sql
-- Persona: boss (Admin) · accountant (Tài chính — Xem) · buyer (Mua hàng — Xem) · lead (giám đốc 1 dự án) · nobody (chưa có quyền). Kiểm: quyền gọi, bảng theo vai trò, đủ trường cho giao diện,
-- tiền không lọt khi không được xem, chi phí = tổng theo nhóm, chạy dưới 8 giây.
create temporary table cdb_test_people(name text primary key, id uuid default gen_random_uuid(),
  email text default ('cdb-test-'||gen_random_uuid()||'@invalid.local'), role text);
insert into cdb_test_people(name, role) values ('boss', 'ADMIN'), ('accountant', 'EMPLOYEE'), ('buyer', 'EMPLOYEE'), ('lead', 'EMPLOYEE'), ('nobody', 'EMPLOYEE');
insert into public.users(id, name, username, email, role)
  select id, 'Dashboard rollback '||name, 'cdb-'||id, email, role::public.user_role from cdb_test_people;
grant select on cdb_test_people to authenticated, anon;
insert into public.user_permission_grants (user_id, permission_code, scope_type, scope_id, is_active, granted_at)
  select id, 'system.finance.view', 'global', '*', true, now() from cdb_test_people where name = 'accountant'
  union all select id, 'system.procurement.view', 'global', '*', true, now() from cdb_test_people where name = 'buyer';

create temporary table cdb_test_refs as select
  (select count(*) from public.projects p where app_private.cdb_in_scope(p.id, p.status, p.is_hidden)) as active_projects,
  (select p.id from public.projects p where app_private.cdb_in_scope(p.id, p.status, p.is_hidden) order by p.created_at limit 1) as lead_project;
update public.projects set manager_id = (select id::text from cdb_test_people where name = 'lead') where id = (select lead_project from cdb_test_refs);
grant select on cdb_test_refs to authenticated, anon;

create function pg_temp.cdb_as(p_name text) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', (select jsonb_build_object('sub', gen_random_uuid(), 'email', email, 'role', 'authenticated')::text
    from cdb_test_people where name = p_name), true);
end $$;
create function pg_temp.cdb_assert(ok boolean, message text) returns void language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'Center dashboard test failed: %', message; end if;
end $$;

select pg_temp.cdb_assert(p.prosecdef, 'get_center_dashboard_v1 checks access itself (SECURITY DEFINER)')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'get_center_dashboard_v1';
select pg_temp.cdb_assert(not has_function_privilege('anon', 'public.get_center_dashboard_v1(boolean)', 'execute'), 'anon cannot read dashboards');
select pg_temp.cdb_assert(has_function_privilege('authenticated', 'public.get_center_dashboard_v1(boolean)', 'execute'), 'signed-in users can call');

set local role authenticated;

-- Nhân viên chưa có quyền gì: không có bảng, không có dự án.
select pg_temp.cdb_as('nobody');
do $$ declare r jsonb; begin
  r := public.get_center_dashboard_v1();
  perform pg_temp.cdb_assert(r -> 'access' = '[]'::jsonb, 'no boards without permissions: ' || (r -> 'access')::text);
  perform pg_temp.cdb_assert(r -> 'projects' = '[]'::jsonb and r -> 'needs' = '[]'::jsonb, 'no data without permissions');
  perform pg_temp.cdb_assert(public.get_center_dashboard_v1(true) -> 'access' = '[]'::jsonb, 'access check agrees');
end $$;

-- Admin: đủ 4 bảng, mọi dự án đang chạy, đủ tiền.
select pg_temp.cdb_as('boss');
do $$ declare r jsonb; t0 timestamptz := clock_timestamp(); ms numeric; ref record; p jsonb; m jsonb; bad text; begin
  select * into ref from cdb_test_refs;
  r := public.get_center_dashboard_v1();
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  perform pg_temp.cdb_assert(ms < 3000, 'dashboard must load under 3 s, took ' || round(ms) || ' ms');
  perform pg_temp.cdb_assert(r -> 'access' = '["portfolio", "cashflow", "materials", "debt"]'::jsonb, 'Admin sees all four boards in order');
  perform pg_temp.cdb_assert(jsonb_array_length(r -> 'projects') = ref.active_projects, 'every active project is listed');
  perform pg_temp.cdb_assert(not exists (select 1 from jsonb_array_elements(r -> 'projects') x join public.projects p on p.id = x.value ->> 'id'
    where p.status = 'planning' and not exists (select 1 from public.project_tasks t where t.project_id = p.id)
      and not exists (select 1 from public.customer_contracts c where c.project_id = p.id and coalesce(c.status, '') not in ('cancelled', 'draft'))
      and not exists (select 1 from public.project_transactions t where t.project_id = p.id and t.type = 'expense')), 'empty planning projects stay out');
  perform pg_temp.cdb_assert(public.get_center_dashboard_v1(true) -> 'access' = r -> 'access'
    and public.get_center_dashboard_v1(true) -> 'projects' = '[]'::jsonb, 'access-only call lists the same boards without data');
  perform pg_temp.cdb_assert((r ->> 'today') ~ '^\d{4}-\d{2}-\d{2}$', 'today is a civil date');
  for p in select value from jsonb_array_elements(r -> 'projects') loop
    perform pg_temp.cdb_assert(p ? 'id' and p ? 'code' and p ? 'name' and p ? 'site' and p ? 'plannedProgress' and p ? 'actualProgress'
      and jsonb_typeof(p -> 'gaps') = 'array', 'project shape: ' || (p ->> 'id'));
    perform pg_temp.cdb_assert(jsonb_typeof(p -> 'finance') = 'object' and jsonb_typeof(p -> 'materials') = 'object', 'Admin sees money: ' || (p ->> 'id'));
    perform pg_temp.cdb_assert(abs((p -> 'finance' ->> 'cost')::numeric
        - coalesce((select sum(value::numeric) from jsonb_each_text(p -> 'finance' -> 'costByCategory')), 0)) < 1,
      'cost equals the sum of its groups: ' || (p ->> 'id'));
    perform pg_temp.cdb_assert(coalesce((p ->> 'plannedProgress')::numeric, 0) between 0 and 100
      and coalesce((p ->> 'actualProgress')::numeric, 0) between 0 and 100, 'progress within 0–100: ' || (p ->> 'id'));
    perform pg_temp.cdb_assert(p -> 'finance' -> 'ar' ? 'flow' and p -> 'finance' -> 'ap' ? 'paid', 'receivable flow and payable paid present: ' || (p ->> 'id'));
    perform pg_temp.cdb_assert(jsonb_typeof(p -> 'finance' -> 'records') = 'object' and (p -> 'materials' ->> 'estimated')::numeric >= 0
      and (p -> 'materials' ->> 'estimated')::numeric <= (p -> 'materials' ->> 'imported')::numeric + (p -> 'materials' ->> 'exported')::numeric + 1,
      'record counts and stock estimate present: ' || (p ->> 'id'));
  end loop;
  select string_agg(value ->> 'month', ',') into bad from jsonb_array_elements(r -> 'months') where (value ->> 'month') !~ '^\d{4}-\d{2}$';
  perform pg_temp.cdb_assert(bad is null, 'months are yyyy-mm: ' || coalesce(bad, ''));
  perform pg_temp.cdb_assert(not exists (select 1 from jsonb_array_elements(r -> 'months') x
    where (x.value ->> 'month') < to_char(date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh') - interval '11 months', 'YYYY-MM')), 'only the last 12 months');
  perform pg_temp.cdb_assert(not exists (select 1 from jsonb_array_elements(r -> 'needs') x where (x.value ->> 'qty')::numeric <= 0), 'needs have a positive quantity');
  perform pg_temp.cdb_assert(jsonb_array_length(r -> 'needs') <= 300, 'needs are capped');
  for m in select value from jsonb_array_elements(r -> 'materialItems') loop
    perform pg_temp.cdb_assert((m ->> 'budget')::numeric > 0, 'top materials have a budget');
  end loop;
end $$;

-- Kế toán: tiền trước, mọi dự án có tài chính, không có bảng Vật tư.
select pg_temp.cdb_as('accountant');
do $$ declare r jsonb; ref record; begin
  select * into ref from cdb_test_refs;
  r := public.get_center_dashboard_v1();
  perform pg_temp.cdb_assert(r -> 'access' = '["cashflow", "debt", "portfolio"]'::jsonb, 'accountant boards: ' || (r -> 'access')::text);
  perform pg_temp.cdb_assert(jsonb_array_length(r -> 'projects') = ref.active_projects, 'accountant sees every active project');
  perform pg_temp.cdb_assert(not exists (select 1 from jsonb_array_elements(r -> 'projects') x where jsonb_typeof(x.value -> 'finance') <> 'object'), 'accountant sees money');
  perform pg_temp.cdb_assert(not exists (select 1 from jsonb_array_elements(r -> 'projects') x where jsonb_typeof(x.value -> 'materials') = 'object')
    and r -> 'needs' = '[]'::jsonb and r -> 'materialItems' = '[]'::jsonb, 'no material data without the Materials board');
end $$;

-- Mua hàng: chỉ bảng Vật tư, không lọt tiền dự án.
select pg_temp.cdb_as('buyer');
do $$ declare r jsonb; begin
  r := public.get_center_dashboard_v1();
  perform pg_temp.cdb_assert(r -> 'access' = '["materials"]'::jsonb, 'buyer boards: ' || (r -> 'access')::text);
  perform pg_temp.cdb_assert(not exists (select 1 from jsonb_array_elements(r -> 'projects') x where x.value -> 'finance' <> 'null'::jsonb), 'buyer never sees project money');
  perform pg_temp.cdb_assert(not exists (select 1 from jsonb_array_elements(r -> 'months') x
    where (x.value ->> 'revenue')::numeric <> 0 or (x.value ->> 'cost')::numeric <> 0 or (x.value ->> 'cashIn')::numeric <> 0 or (x.value ->> 'cashOut')::numeric <> 0),
    'buyer months carry no money flows');
  perform pg_temp.cdb_assert(not exists (select 1 from jsonb_array_elements(r -> 'projects') x, jsonb_array_elements_text(x.value -> 'gaps') g
    where g.value in ('contract', 'budget', 'unclassified', 'ar_due', 'ap_due')), 'buyer gets no finance gaps');
end $$;

-- Giám đốc một dự án: tiến độ + vật tư của đúng dự án đó, không có tiền khi chưa bật công tắc.
select pg_temp.cdb_as('lead');
do $$ declare r jsonb; ref record; begin
  select * into ref from cdb_test_refs;
  r := public.get_center_dashboard_v1();
  perform pg_temp.cdb_assert(r -> 'access' = '["portfolio", "materials"]'::jsonb, 'lead boards: ' || (r -> 'access')::text);
  perform pg_temp.cdb_assert(jsonb_array_length(r -> 'projects') = 1 and r -> 'projects' -> 0 ->> 'id' = ref.lead_project, 'lead sees only the own project');
  perform pg_temp.cdb_assert(r -> 'projects' -> 0 -> 'finance' = 'null'::jsonb, 'no money without the finance switch');
  perform pg_temp.cdb_assert(r -> 'projects' -> 0 ->> 'director' = 'Dashboard rollback lead', 'director comes from the project manager');
end $$;
