-- Trung tâm điều hành PR-D: vcc_my_actions_v1. Chạy cùng 4 migration trong một giao dịch rollback:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> \
--   --migration supabase/migrations/20261008138000_center_dot0_foundation.sql \
--   --migration supabase/migrations/20261008138001_center_dot0_work_items.sql \
--   --migration supabase/migrations/20261008138002_center_dot0_today.sql \
--   --migration supabase/migrations/20261008138003_center_dot0_actions.sql \
--   --smoke supabase/tests/center_dot0_actions_smoke.sql
-- Persona: staff (có hồ sơ NV, quyền Office + tạo yêu cầu, không Room dự án) · ghost (không hồ sơ NV, không quyền) · nocenter.
create temporary table center_test_people(name text primary key, id uuid default gen_random_uuid(),
  email text default ('center-test-'||gen_random_uuid()||'@invalid.local'), employee_id uuid default gen_random_uuid());
insert into center_test_people(name) values ('staff'),('ghost'),('nocenter');
insert into public.users(id,name,username,email,role)
  select id,'Center rollback '||name,'center-'||id,email,'EMPLOYEE'::public.user_role from center_test_people;
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
  select id,'center.module.access','global','*','Center rollback test' from center_test_people;
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
  select id, code, 'global', '*', 'Center rollback test' from center_test_people, unnest(array['office.module.access','office.document.create','request.instance.create']) code
  where name = 'staff';
insert into app_private.center_rollout_actors(user_id,expires_at,reason)
  select id, now()+interval '1 day', 'Thử PR-D' from center_test_people where name <> 'nocenter';
grant select on center_test_people to authenticated, anon;
create temporary table center_test_refs as
  select (select id from public.projects where coalesce(status, '') in ('planning', 'active') order by created_at limit 1) as project_a;
grant select on center_test_refs to authenticated, anon;

create function pg_temp.center_as(p_name text) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', (select jsonb_build_object('sub',gen_random_uuid(),'email',email,'role','authenticated')::text
    from center_test_people where name = p_name), true);
end $$;
create function pg_temp.center_assert(ok boolean, message text) returns void language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'Center test failed: %', message; end if;
end $$;

set local session_replication_role = 'replica';
insert into public.employees(id, full_name, user_id) select employee_id, 'Center rollback '||name, id from center_test_people where name = 'staff';
set local session_replication_role = 'origin';

set local role authenticated;

select pg_temp.center_as('staff');
do $$ declare r jsonb; a text; begin
  select project_a into a from center_test_refs;
  r := public.vcc_my_actions_v1(a);
  raise notice 'staff actions: %', r;
  perform pg_temp.center_assert(r ->> 'projectId' = a, 'project echoed');
  perform pg_temp.center_assert((r ->> 'employee')::boolean and (r -> 'hrm' ->> 'checkin')::boolean and (r -> 'hrm' ->> 'leave')::boolean
    and (r -> 'hrm' ->> 'makeup')::boolean and (r -> 'hrm' ->> 'timesheet')::boolean, 'own HR actions follow the employee record');
  perform pg_temp.center_assert(not (r -> 'hrm' ->> 'assignment')::boolean, 'no HR Manage → no assignment');
  perform pg_temp.center_assert((r -> 'office' ->> 'compose')::boolean and (r -> 'office' ->> 'incoming')::boolean and (r -> 'office' ->> 'booking')::boolean, 'office create/incoming/booking');
  perform pg_temp.center_assert((r -> 'work' ->> 'request')::boolean and not (r -> 'work' ->> 'workflow')::boolean
    and not (r -> 'work' ->> 'po')::boolean and not (r -> 'work' ->> 'task')::boolean, 'request create only: '||(r -> 'work')::text);
  perform pg_temp.center_assert(not (r -> 'project' ->> 'materialRequest')::boolean and not (r -> 'project' ->> 'dailyLog')::boolean
    and not (r -> 'project' ->> 'workPlan')::boolean, 'no Room → no project actions');
  perform pg_temp.center_assert(not (r -> 'supply' ->> 'hot')::boolean and not (r -> 'supply' ->> 'inbox')::boolean
    and not (r -> 'supply' ->> 'receive')::boolean and not (r -> 'supply' ->> 'count')::boolean, 'no procurement / warehouse actions');
  perform pg_temp.center_assert(not (r -> 'finance' ->> 'siteFund')::boolean and not (r -> 'finance' ->> 'paymentRequest')::boolean
    and not (r -> 'finance' ->> 'projectFinance')::boolean, 'no finance actions');
  r := public.vcc_my_actions_v1(null);
  perform pg_temp.center_assert(jsonb_typeof(r -> 'project') = 'null' and jsonb_typeof(r -> 'supply') = 'null' and jsonb_typeof(r -> 'finance') = 'null', 'no project → project-bound groups null');
  r := public.vcc_my_actions_v1('no-such-project');
  perform pg_temp.center_assert(jsonb_typeof(r -> 'project') = 'null', 'unknown project → null, no error');
end $$;

select pg_temp.center_as('ghost');
do $$ declare r jsonb; begin
  r := public.vcc_my_actions_v1(null);
  perform pg_temp.center_assert(not (r ->> 'employee')::boolean and not (r -> 'hrm' ->> 'checkin')::boolean and not (r -> 'hrm' ->> 'leave')::boolean, 'no employee record → own HR actions off');
  perform pg_temp.center_assert(not (r -> 'office' ->> 'compose')::boolean and not (r -> 'office' ->> 'incoming')::boolean and (r -> 'office' ->> 'booking')::boolean, 'booking stays open to everyone');
  perform pg_temp.center_assert(not (r -> 'work' ->> 'request')::boolean, 'no request permission');
end $$;

select pg_temp.center_as('nocenter');
do $$ begin
  begin perform public.vcc_my_actions_v1(null); raise exception 'Unexpected access outside rollout';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
select 'center_dot0_actions_smoke ok' as result;
