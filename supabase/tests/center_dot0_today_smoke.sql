-- Trung tâm điều hành PR-C: vcc_my_center_v1. Chạy cùng 3 migration trong một giao dịch rollback:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> \
--   --migration supabase/migrations/20261008138000_center_dot0_foundation.sql \
--   --migration supabase/migrations/20261008138001_center_dot0_work_items.sql \
--   --migration supabase/migrations/20261008138002_center_dot0_today.sql \
--   --smoke supabase/tests/center_dot0_today_smoke.sql
-- Persona: member (thuộc dự án qua project_staff, có 1 việc chờ) · assigned (điều động H2 tới công trường của dự án khác)
-- · loner (không thuộc dự án nào) · nocenter (chưa bật).
create temporary table center_test_people(name text primary key, id uuid default gen_random_uuid(),
  email text default ('center-test-'||gen_random_uuid()||'@invalid.local'), employee_id uuid default gen_random_uuid());
insert into center_test_people(name) values ('member'),('assigned'),('loner'),('nocenter');
insert into public.users(id,name,username,email,role)
  select id,'Center rollback '||name,'center-'||id,email,'EMPLOYEE'::public.user_role from center_test_people;
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
  select id,'center.module.access','global','*','Center rollback test' from center_test_people;
insert into app_private.center_rollout_actors(user_id,expires_at,reason)
  select id, now()+interval '1 day', 'Thử PR-C' from center_test_people where name <> 'nocenter';
grant select on center_test_people to authenticated, anon;

create function pg_temp.p(p_name text) returns uuid language sql as $$ select id from center_test_people where name = p_name $$;
create function pg_temp.emp(p_name text) returns uuid language sql as $$ select employee_id from center_test_people where name = p_name $$;
create function pg_temp.center_as(p_name text) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', (select jsonb_build_object('sub',gen_random_uuid(),'email',email,'role','authenticated')::text
    from center_test_people where name = p_name), true);
end $$;
create function pg_temp.center_assert(ok boolean, message text) returns void language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'Center test failed: %', message; end if;
end $$;

-- Hai dự án thật đang hoạt động (chỉ đọc), dự án B phải có công trường để thử điều động H2.
create temporary table center_test_refs as
select (select id from public.projects where coalesce(status, '') in ('planning', 'active') order by created_at limit 1) as project_a,
       (select id from public.projects p where coalesce(p.status, '') in ('planning', 'active') and p.construction_site_id is not null
          and p.id <> (select id from public.projects where coalesce(status, '') in ('planning', 'active') order by created_at limit 1)
          order by p.created_at limit 1) as project_b,
       (select id from public.hrm_positions order by created_at limit 1) as position_id;
grant select on center_test_refs to authenticated, anon;
set local session_replication_role = 'replica';
insert into public.employees(id, full_name, user_id) select employee_id, 'Center rollback '||name, id from center_test_people;
-- member: trong Tổ chức dự án A, có 1 kế hoạch tuần chờ duyệt ở A.
insert into public.project_staff(construction_site_id, user_id, position_id, project_id)
  select null, pg_temp.p('member')::text, position_id, project_a from center_test_refs;
insert into public.project_work_plans(project_id, period_type, period_start, period_end, code, status, created_by, submitted_by, submitted_at, submitted_to_user_id)
  select project_a, 'week', date_trunc('week', current_date)::date, date_trunc('week', current_date)::date + 6, 'KH-CT-C', 'submitted',
    pg_temp.p('loner'), pg_temp.p('loner'), now(), pg_temp.p('member') from center_test_refs;
-- assigned: điều động chính đã duyệt tới công trường của dự án B (đang hiệu lực).
insert into public.hrm_site_assignments(code, employee_id, site_id, kind, start_date, status, reason, created_by)
  select 'SA-CT-C', pg_temp.emp('assigned'), p.construction_site_id, 'primary', current_date - 3, 'approved', 'Thử nghiệm PR-C Center', pg_temp.p('member')
  from center_test_refs r join public.projects p on p.id = r.project_b;
set local session_replication_role = 'origin';

set local role authenticated;

select pg_temp.center_as('member');
do $$ declare r jsonb; w jsonb; t0 timestamptz := clock_timestamp(); ms numeric; a text; begin
  select project_a into a from center_test_refs;
  r := public.vcc_my_center_v1(null);
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  raise notice 'member center: % ms · project % (%) · options %', round(ms), r -> 'project' ->> 'code', r -> 'project' ->> 'source', r -> 'projectOptions';
  perform pg_temp.center_assert(r -> 'project' ->> 'id' = a and r -> 'project' ->> 'source' = 'most_work', 'member defaults to the project with waiting work: '||coalesce((r -> 'project')::text, 'null'));
  perform pg_temp.center_assert((select count(*) from jsonb_array_elements(r -> 'projectOptions') o where o ->> 'id' = a and (o ->> 'waiting')::int = 1) = 1, 'option carries the waiting count');
  w := r -> 'widgets';
  perform pg_temp.center_assert((w -> 'project' ->> 'waiting')::int = 1, 'project widget counts my waiting work');
  perform pg_temp.center_assert(w -> 'project' -> 'construction' ->> 'state' in ('ready', 'denied'), 'construction uses the today board or is denied: '||(w -> 'project' -> 'construction')::text);
  perform pg_temp.center_assert(w -> 'project' -> 'supply' ->> 'state' = 'denied' and w -> 'supply' -> 'orders' ->> 'state' = 'denied' and w -> 'supply' -> 'requests' ->> 'state' = 'denied',
    'no Room / procurement permission → PO and material requests are denied, not 0');
  perform pg_temp.center_assert(w -> 'project' -> 'progress' ->> 'state' in ('ready', 'empty') and (w -> 'project' -> 'progress' ->> 'total')::int >= 0, 'progress is computed for a member: '||(w -> 'project' -> 'progress')::text);
  perform pg_temp.center_assert(w -> 'hrm' ->> 'state' = 'ready' and w -> 'hrm' -> 'attendance' is not null and jsonb_typeof(w -> 'hrm' -> 'attendance') = 'null', 'no check-in today → attendance null, not 0');
  perform pg_temp.center_assert(w -> 'hrm' -> 'team' ->> 'state' in ('denied', 'empty'), 'team attendance needs site leader / HR: '||(w -> 'hrm' -> 'team')::text);
  perform pg_temp.center_assert((w -> 'work' ->> 'workEnabled')::boolean = false and jsonb_typeof(w -> 'work' -> 'assigned') = 'null', 'no Work access → assigned is null');
  perform pg_temp.center_assert((w -> 'work' -> 'requests' ->> 'pending')::int = 0, 'no requests sent');
  perform pg_temp.center_assert(w -> 'office' -> 'documents' ->> 'state' in ('ready', 'denied'), 'office documents state: '||(w -> 'office' -> 'documents')::text);
  perform pg_temp.center_assert(jsonb_typeof(w -> 'finance') = 'null', 'finance summary hidden without the project finance switch');
  perform pg_temp.center_assert(ms < 4000, 'member center under 4 s: '||round(ms)||' ms');
  -- Chọn tay dự án không thuộc danh sách → bỏ qua, về mặc định.
  r := public.vcc_my_center_v1('no-such-project');
  perform pg_temp.center_assert(r -> 'project' ->> 'id' = a, 'unknown project id falls back to the default');
end $$;

select pg_temp.center_as('assigned');
do $$ declare r jsonb; b text; begin
  select project_b into b from center_test_refs;
  r := public.vcc_my_center_v1(null);
  raise notice 'assigned center: project % (%)', r -> 'project' ->> 'code', r -> 'project' ->> 'source';
  perform pg_temp.center_assert(r -> 'project' ->> 'id' = b and r -> 'project' ->> 'source' = 'assignment', 'H2 assignment picks the site''s project: '||coalesce((r -> 'project')::text, 'null'));
  perform pg_temp.center_assert(r -> 'project' -> 'site' ->> 'id' is not null, 'site is returned for weather');
  perform pg_temp.center_assert((r -> 'widgets' -> 'project' ->> 'waiting')::int = 0, 'nothing waiting on this project');
end $$;

select pg_temp.center_as('loner');
do $$ declare r jsonb; begin
  r := public.vcc_my_center_v1(null);
  perform pg_temp.center_assert(jsonb_typeof(r -> 'project') = 'null' and jsonb_array_length(r -> 'projectOptions') = 0, 'no membership → no project, no options');
  perform pg_temp.center_assert(jsonb_typeof(r -> 'widgets' -> 'project') = 'null' and jsonb_typeof(r -> 'widgets' -> 'supply') = 'null' and jsonb_typeof(r -> 'widgets' -> 'finance') = 'null', 'project-bound widgets are null');
  perform pg_temp.center_assert(r -> 'widgets' -> 'hrm' ->> 'state' = 'ready', 'own HR numbers still load');
end $$;

select pg_temp.center_as('nocenter');
do $$ begin
  begin perform public.vcc_my_center_v1(null); raise exception 'Unexpected access outside rollout';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
select 'center_dot0_today_smoke ok' as result;
