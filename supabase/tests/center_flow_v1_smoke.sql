-- Dòng chảy công việc PR-1: vcc_flow_v1. Chạy cùng migration trong một giao dịch rollback:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> \
--   --migration supabase/migrations/20261013141500_center_flow_v1.sql \
--   --smoke supabase/tests/center_flow_v1_smoke.sql
-- Persona: boss (Admin) · exec (center.flow.view) · head (trưởng phòng A qua slot) · lead (giám đốc dự án P) · nobody (vào Center, không bậc nào) · nocenter.
-- Dữ liệu mẫu chèn với session_replication_role = replica (bỏ trigger/FK của module) vì chỉ kiểm cách RPC ĐỌC và CHIA PHẠM VI.
create temporary table flow_people(name text primary key, id uuid default gen_random_uuid(),
  email text default ('flow-test-'||gen_random_uuid()||'@invalid.local'), employee_id uuid default gen_random_uuid(), role text default 'EMPLOYEE', unit text);
insert into flow_people(name, role, unit) values ('boss','ADMIN','U2'),('exec','EMPLOYEE','U2'),('head','EMPLOYEE','U1'),('lead','EMPLOYEE','U2'),
  ('nobody','EMPLOYEE',null),('nocenter','EMPLOYEE',null),('staff1','EMPLOYEE','U1'),('staff2','EMPLOYEE','U2');
insert into public.users(id,name,username,email,role)
  select id,'Flow rollback '||name,'flow-'||id,email,role::public.user_role from flow_people;
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
  select id,'center.module.access','global','*','Flow rollback test' from flow_people where name <> 'nocenter';
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
  select id,'center.flow.view','global','*','Flow rollback test' from flow_people where name = 'exec';
insert into app_private.center_rollout_actors(user_id,expires_at,reason)
  select id, now()+interval '1 day', 'Thử PR-1 Dòng chảy' from flow_people where name <> 'nocenter';
grant select on flow_people to authenticated, anon;

create function pg_temp.p(p_name text) returns uuid language sql as $$ select id from flow_people where name = p_name $$;
create function pg_temp.flow_as(p_name text) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', (select jsonb_build_object('sub',gen_random_uuid(),'email',email,'role','authenticated')::text
    from flow_people where name = p_name), true);
end $$;
create function pg_temp.flow_assert(ok boolean, message text) returns void language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'Flow test failed: %', message; end if;
end $$;
create function pg_temp.person(r jsonb, p_key text, p_name text) returns jsonb language sql as $$
  select i from jsonb_array_elements(r -> p_key) i where i ->> 'name' = 'Flow rollback ' || p_name limit 1 $$;
create function pg_temp.wperson(r jsonb, p_name text) returns jsonb language sql as $$
  select i from jsonb_array_elements(r -> 'waiting' -> 'byPerson') i where i ->> 'name' = 'Flow rollback ' || p_name limit 1 $$;
create function pg_temp.src(r jsonb, p_source text) returns integer language sql as $$
  select coalesce((select (i ->> 'n')::int from jsonb_array_elements(r -> 'waiting' -> 'bySource') i where i ->> 'source' = p_source), 0) $$;

-- ── Dữ liệu mẫu ──────────────────────────────────────────────────────────────────────────────
create temporary table flow_refs as select
  gen_random_uuid() as u1, gen_random_uuid() as u2, gen_random_uuid() as slot1, gen_random_uuid() as tpl, gen_random_uuid() as inst, gen_random_uuid() as subj,
  coalesce((select id from public.hrm_positions limit 1), gen_random_uuid()) as position_id,
  'flow-test-project-' || gen_random_uuid() as project_id,
  (select id from public.warehouses where not is_archived order by created_at limit 1) as warehouse_id;
grant select on flow_refs to authenticated, anon;
set local session_replication_role = 'replica';
insert into public.org_units(id, name, type, is_active, source)
  select u1, 'Flow test phòng A', 'department', true, 'catalog' from flow_refs
  union all select u2, 'Flow test phòng B', 'department', true, 'catalog' from flow_refs;
insert into public.hrm_org_position_slots(id, code, org_unit_id, position_id, status) select slot1, 'FLOW-MGR-A', u1, position_id, 'ACTIVE' from flow_refs;
update public.org_units set manager_slot_id = (select slot1 from flow_refs) where id = (select fr.u1 from flow_refs fr);
insert into public.employees(id, full_name, user_id, org_unit_id, status)
  select p.employee_id, 'Flow rollback '||p.name, p.id, case p.unit when 'U1' then r.u1 when 'U2' then r.u2 end, 'Đang làm việc' from flow_people p, flow_refs r;
insert into public.hrm_employee_slot_assignments(employee_id, slot_id, status, effective_from)
  select p.employee_id, r.slot1, 'ACTIVE', current_date - 30 from flow_people p, flow_refs r where p.name = 'head';
insert into public.projects(id, code, name, status, manager_id)
  select project_id, 'FLOW-P', 'Flow test dự án', 'active', pg_temp.p('lead')::text from flow_refs;

-- Quy trình: boss (phòng B) giao 5 bước.
insert into public.workflow_templates(id, name, created_by) select tpl, 'Flow test quy trình', pg_temp.p('boss') from flow_refs;
insert into public.workflow_instances(id, template_id, code, title, created_by, status) select inst, tpl, 'FLOW-WF-1', 'Flow test phiếu', pg_temp.p('boss'), 'RUNNING' from flow_refs;
insert into public.workflow_subjects(id, workflow_instance_id, subject_type, subject_id, project_id, status, created_by)
  select subj, inst, 'request', 'flow-subject', project_id, 'RUNNING', pg_temp.p('boss') from flow_refs;
insert into public.workflow_step_assignments(workflow_subject_id, workflow_instance_id, assignee_user_id, assigned_by, status, assigned_at, acted_at, due_at, sla_hours)
  select subj, inst, pg_temp.p('staff1'), pg_temp.p('boss'), 'PENDING',  now() - interval '10 days', null,                    now() - interval '2 days', 24 from flow_refs   -- A1 B→A: đứng yên + quá hạn
  union all select subj, inst, pg_temp.p('staff2'), pg_temp.p('boss'), 'APPROVED', now() - interval '5 days',  now() - interval '4 days', now() - interval '3 days', 48 from flow_refs   -- A2 B→B: xong đúng hạn
  union all select subj, inst, pg_temp.p('head'),   pg_temp.p('boss'), 'PENDING',  now() - interval '40 days', null,                    null, null from flow_refs                          -- A3 B→A: phiếu chết, SLA mặc định
  union all select subj, inst, null,                pg_temp.p('boss'), 'PENDING',  now() - interval '1 hour',  null,                    null, null from flow_refs                          -- A4: chưa giao người
  union all select subj, inst, pg_temp.p('staff2'), pg_temp.p('staff1'), 'RETURNED', now() - interval '6 days', now() - interval '5 days', null, null from flow_refs;                     -- A5 A→B: trả lại

-- Đề xuất vật tư: 1 đường cũ (chờ head), 1 đã có bước quy trình đang chờ (không đếm hai lần).
insert into public.requests(id, code, site_warehouse_id, requester_id, status, items, created_date, expected_date, submitted_to_user_id, submitted_to_name, request_origin, title, content_hash, project_id)
  select 'flow-mr-legacy', 'MR-FLOW-1', warehouse_id, pg_temp.p('staff1'), 'PENDING'::public.request_status, '[]'::jsonb, now() - interval '2 days', now() + interval '3 days',
    pg_temp.p('head')::text, 'Flow rollback head', 'wms', 'Flow test đề xuất', encode(sha256('flow-1'::bytea), 'hex'), project_id from flow_refs
  union all select 'flow-mr-wf', 'MR-FLOW-2', warehouse_id, pg_temp.p('staff1'), 'PENDING'::public.request_status, '[]'::jsonb, now() - interval '2 days', now() + interval '3 days',
    null, null, 'wms', 'Flow test đề xuất có quy trình', encode(sha256('flow-2'::bytea), 'hex'), project_id from flow_refs;
update public.requests set workflow_subject_id = (select subj from flow_refs) where id = 'flow-mr-wf';

-- Vioo Work: boss giao staff2 (phòng B) một việc đang làm.
insert into public.work_tasks(id, task_code, title, scope_type, status, created_by, review_policy, deadline_at)
  values ('00000000-0000-4000-8000-00000000f001', 'VW-2026-900101', 'Flow test việc', 'direct', 'in_progress', pg_temp.p('boss'), 'creator_review', now() + interval '1 day');
insert into public.work_task_assignments(task_id, user_id, state, assigned_by, assigned_at)
  values ('00000000-0000-4000-8000-00000000f001', pg_temp.p('staff2'), 'in_progress', pg_temp.p('boss'), now() - interval '1 day');
set local session_replication_role = 'origin';

-- ── Kiểm cấu trúc ───────────────────────────────────────────────────────────────────────────
select pg_temp.flow_assert(p.prosecdef, 'vcc_flow_v1 checks access itself (SECURITY DEFINER)')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'vcc_flow_v1';
select pg_temp.flow_assert(not has_function_privilege('anon', 'public.vcc_flow_v1(integer,text,uuid,boolean)', 'execute'), 'anon cannot call');
select pg_temp.flow_assert(has_function_privilege('authenticated', 'public.vcc_flow_v1(integer,text,uuid,boolean)', 'execute'), 'signed-in users can call');
select pg_temp.flow_assert(exists (select 1 from public.permission_actions where permission_code = 'center.flow.view' and is_active), 'permission registered');
select pg_temp.flow_assert(exists (select 1 from public.user_permission_templates t, jsonb_array_elements(t.items) i where t.code = 'executive' and i ->> 'permissionCode' = 'center.flow.view'), 'executive template carries center.flow.view');
select pg_temp.flow_assert(app_private.vcc_flow_business_days(timestamptz '2026-10-09 10:00+07', timestamptz '2026-10-13 09:00+07', 6) = 3, 'business days Fri→Mon (6-day week) = 3');
select pg_temp.flow_assert(app_private.vcc_flow_business_days(timestamptz '2026-10-09 10:00+07', timestamptz '2026-10-13 09:00+07', 5) = 2, 'business days Fri→Mon (5-day week) = 2');
select pg_temp.flow_assert(app_private.vcc_flow_business_days(now(), now() - interval '1 day', 6) = 0, 'business days never negative');

set local role authenticated;

-- nocenter: không vào được Center → access false, không lỗi.
select pg_temp.flow_as('nocenter');
select pg_temp.flow_assert(public.vcc_flow_v1() ->> 'access' = 'false' and public.vcc_flow_v1() ->> 'reason' = 'no_center', 'nocenter sees access=false');

-- nobody: vào Center nhưng không thuộc bậc nào.
select pg_temp.flow_as('nobody');
select pg_temp.flow_assert(public.vcc_flow_v1() ->> 'reason' = 'no_scope', 'nobody has no scope');
select pg_temp.flow_assert(public.vcc_flow_v1(90, null, null, true) ->> 'access' = 'false', 'access-only agrees');

-- boss: toàn công ty.
select pg_temp.flow_as('boss');
do $$ declare r jsonb; t0 timestamptz := clock_timestamp(); ms numeric; u1 text := (select fr.u1::text from flow_refs fr); u2 text := (select fr.u2::text from flow_refs fr);
  pid text := (select fr.project_id from flow_refs fr); lk jsonb; s2 jsonb; w1 jsonb; pj jsonb; begin
  r := public.vcc_flow_v1();
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  raise notice 'boss company: waiting % (stuck %, overdue %, dead %, unassigned %) · links % · people % · % ms',
    r -> 'waiting' ->> 'total', r -> 'waiting' ->> 'stuck', r -> 'waiting' ->> 'overdue', r -> 'waiting' ->> 'dead', r -> 'waiting' ->> 'unassigned',
    jsonb_array_length(r -> 'links'), jsonb_array_length(r -> 'people'), round(ms);
  perform pg_temp.flow_assert(r ->> 'access' = 'true' and r -> 'scope' ->> 'kind' = 'company' and (r -> 'scope' ->> 'canCompany')::boolean, 'boss has company scope');
  perform pg_temp.flow_assert(ms < 3000, 'company call under 3 s: ' || round(ms) || ' ms');
  perform pg_temp.flow_assert(r -> 'thresholds' ->> 'stuckBusinessDays' = '3' and r -> 'thresholds' ->> 'slaDefaultHours' = '48', 'thresholds returned');
  perform pg_temp.flow_assert(jsonb_array_length(r -> 'daily') = 30, '30 daily buckets: ' || jsonb_array_length(r -> 'daily'));
  perform pg_temp.flow_assert(jsonb_array_length(r -> 'waiting' -> 'age') = 5, '5 age buckets');
  perform pg_temp.flow_assert(r -> 'notifications' is not null and r -> 'notifications' ? 'unread7d', 'company scope gets notification stats');
  perform pg_temp.flow_assert(exists (select 1 from jsonb_array_elements(r -> 'units') u where u ->> 'id' = u1 and (u ->> 'people')::int = 2), 'unit A listed with 2 people');
  perform pg_temp.flow_assert(exists (select 1 from jsonb_array_elements(r -> 'units') u where u ->> 'id' = 'unassigned'), 'pseudo unit "unassigned" present');
  select l into lk from jsonb_array_elements(r -> 'links') l where l ->> 'from' = u2 and l ->> 'to' = u1;
  perform pg_temp.flow_assert(lk is not null and (lk ->> 'n')::int = 2 and (lk ->> 'waiting')::int = 2, 'link B→A has 2 waiting assignments: ' || coalesce(lk::text, 'missing'));
  perform pg_temp.flow_assert(exists (select 1 from jsonb_array_elements(r -> 'links') l where l ->> 'from' = u1 and l ->> 'to' = u2 and (l ->> 'n')::int = 1), 'link A→B (returned) counted');
  perform pg_temp.flow_assert(exists (select 1 from jsonb_array_elements(r -> 'unitOutcomes') x where x ->> 'unit' = u1 and x ->> 'outcome' = 'waiting' and (x ->> 'n')::int = 2), 'unit A: 2 waiting outcomes');
  perform pg_temp.flow_assert(exists (select 1 from jsonb_array_elements(r -> 'unitOutcomes') x where x ->> 'unit' = u2 and x ->> 'outcome' = 'done' and (x ->> 'n')::int = 1), 'unit B: 1 done outcome');
  s2 := pg_temp.person(r, 'people', 'staff2');
  perform pg_temp.flow_assert(s2 is not null and (s2 ->> 'received')::int = 3 and (s2 ->> 'done')::int = 2 and (s2 ->> 'onTimePct')::int = 100
    and (s2 ->> 'returned')::int = 1 and (s2 ->> 'holding')::int = 1, 'staff2 stats: ' || coalesce(s2::text, 'missing'));
  perform pg_temp.flow_assert((pg_temp.person(r, 'people', 'staff2') ->> 'unitId') = u2, 'staff2 attributed to unit B');
  perform pg_temp.flow_assert((pg_temp.person(r, 'creators', 'boss') ->> 'n')::int = 4, 'boss created 4 assignments (3 wf + 1 work): ' || coalesce(pg_temp.person(r, 'creators', 'boss')::text, 'missing'));
  w1 := pg_temp.wperson(r, 'staff1');
  perform pg_temp.flow_assert(w1 is not null and (w1 ->> 'n')::int = 1 and (w1 ->> 'stuck')::int = 1 and (w1 ->> 'overdue')::int = 1 and (w1 ->> 'pile')::boolean = false, 'staff1 holds 1 stuck overdue item: ' || coalesce(w1::text, 'missing'));
  perform pg_temp.flow_assert((pg_temp.wperson(r, 'head') ->> 'n')::int = 2 and (pg_temp.wperson(r, 'head') ->> 'stuck')::int = 1, 'head holds A3 (stuck) + legacy MR (fresh)');
  perform pg_temp.flow_assert((r -> 'waiting' ->> 'unassigned')::int >= 1, 'unassigned counted');
  perform pg_temp.flow_assert((r -> 'waiting' ->> 'dead')::int >= 1, 'dead item counted');
  perform pg_temp.flow_assert((r -> 'waiting' ->> 'overdueByDefaultSla')::int >= 1, 'default SLA applied to A3');
  perform pg_temp.flow_assert(pg_temp.src(r, 'wf') >= 3 and pg_temp.src(r, 'mr') >= 1 and pg_temp.src(r, 'work') >= 1, 'sources wf/mr/work present: ' || (r -> 'waiting' -> 'bySource')::text);
  perform pg_temp.flow_assert(exists (select 1 from jsonb_array_elements(r -> 'waiting' -> 'byKind') k where k ->> 'name' = 'Flow test quy trình' and (k ->> 'n')::int = 3), 'kind "Flow test quy trình" has 3 waiting');
  select p into pj from jsonb_array_elements(r -> 'projects') p where p ->> 'id' = pid;
  perform pg_temp.flow_assert(pj is not null and (pj ->> 'waiting')::int = 4 and (pj ->> 'mrPending')::int = 2, 'project P: 4 waiting, 2 MR pending: ' || coalesce(pj::text, 'missing'));
  perform pg_temp.flow_assert((r -> 'gaps' ->> 'employeesWithoutUnit')::int >= 2, 'gaps count employees without unit (nobody, nocenter)');
  -- Lọc theo phòng A / dự án P với quyền toàn công ty.
  r := public.vcc_flow_v1(90, null, (select fr.u1 from flow_refs fr));
  perform pg_temp.flow_assert(r -> 'scope' ->> 'kind' = 'unit' and (r -> 'waiting' ->> 'total')::int = 3 and (r -> 'waiting' ->> 'stuck')::int = 2
    and (r -> 'waiting' ->> 'dead')::int = 1 and (r -> 'waiting' ->> 'overdue')::int = 2, 'boss filtered to unit A: ' || (r -> 'waiting')::text);
  r := public.vcc_flow_v1(90, pid, null);
  perform pg_temp.flow_assert(r -> 'scope' ->> 'kind' = 'project' and (r -> 'waiting' ->> 'total')::int = 4 and jsonb_array_length(r -> 'projects') = 1, 'boss filtered to project P: ' || (r -> 'waiting' ->> 'total'));
  r := public.vcc_flow_v1(7);
  perform pg_temp.flow_assert((r ->> 'rangeDays')::int = 7 and (pg_temp.person(r, 'people', 'staff2') ->> 'received')::int = 3, '7-day range still has staff2 rows (5, 6 days ago + work)');
  r := public.vcc_flow_v1(12);
  perform pg_temp.flow_assert((r ->> 'rangeDays')::int = 90, 'unknown range falls back to 90');
end $$;

-- exec: quyền center.flow.view = toàn công ty như Admin.
select pg_temp.flow_as('exec');
do $$ declare r jsonb; begin
  r := public.vcc_flow_v1();
  perform pg_temp.flow_assert(r -> 'scope' ->> 'kind' = 'company' and (r -> 'scope' ->> 'canCompany')::boolean, 'exec has company scope via center.flow.view');
end $$;

-- head: chỉ phòng A (+ dòng vào / ra); không lọc được phòng B hay dự án P.
select pg_temp.flow_as('head');
do $$ declare r jsonb; u1 text := (select fr.u1::text from flow_refs fr); u2 text := (select fr.u2::text from flow_refs fr); begin
  r := public.vcc_flow_v1();
  raise notice 'head unit: waiting % · links %', r -> 'waiting', r -> 'links';
  perform pg_temp.flow_assert(r -> 'scope' ->> 'kind' = 'unit' and r -> 'scope' -> 'unitIds' = jsonb_build_array(u1) and not (r -> 'scope' ->> 'canCompany')::boolean, 'head scope = unit A');
  perform pg_temp.flow_assert((r -> 'waiting' ->> 'total')::int = 3, 'head sees 3 waiting (A1, A3, legacy MR): ' || (r -> 'waiting' ->> 'total'));
  perform pg_temp.flow_assert((select bool_and(x ->> 'unit' = u1) from jsonb_array_elements(r -> 'waiting' -> 'byUnit') x), 'head byUnit only unit A');
  perform pg_temp.flow_assert(jsonb_array_length(r -> 'links') = 2 and (select bool_and(l ->> 'from' = u1 or l ->> 'to' = u1) from jsonb_array_elements(r -> 'links') l), 'head links touch unit A only');
  perform pg_temp.flow_assert(pg_temp.person(r, 'people', 'staff2') is not null and (pg_temp.person(r, 'people', 'staff2') ->> 'received')::int = 1, 'head sees staff2 only through the A→B return');
  perform pg_temp.flow_assert(jsonb_typeof(r -> 'notifications') = 'null', 'unit scope has no company notification stats');
  perform pg_temp.flow_assert(public.vcc_flow_v1(90, null, null, true) -> 'scope' ->> 'kind' = 'unit', 'access-only for head');
  begin perform public.vcc_flow_v1(90, null, (select fr.u2 from flow_refs fr)); raise exception 'Unexpected: head filtered unit B';
  exception when insufficient_privilege then null; end;
  begin perform public.vcc_flow_v1(90, (select fr.project_id from flow_refs fr), null); raise exception 'Unexpected: head filtered project P';
  exception when insufficient_privilege then null; end;
end $$;

-- lead: chỉ dự án P.
select pg_temp.flow_as('lead');
do $$ declare r jsonb; pid text := (select fr.project_id from flow_refs fr); begin
  r := public.vcc_flow_v1();
  raise notice 'lead project: waiting % · projects %', r -> 'waiting' ->> 'total', jsonb_array_length(r -> 'projects');
  perform pg_temp.flow_assert(r -> 'scope' ->> 'kind' = 'project' and r -> 'scope' -> 'projectIds' = jsonb_build_array(pid), 'lead scope = project P');
  perform pg_temp.flow_assert((r -> 'waiting' ->> 'total')::int = 4, 'lead sees 4 waiting on P: ' || (r -> 'waiting' ->> 'total'));
  perform pg_temp.flow_assert(jsonb_array_length(r -> 'projects') = 1 and r -> 'projects' -> 0 ->> 'id' = pid, 'lead projects = [P]');
  perform pg_temp.flow_assert(pg_temp.src(r, 'mr') = 1 and pg_temp.src(r, 'wf') = 3, 'no double count: 1 legacy MR + 3 wf steps: ' || (r -> 'waiting' -> 'bySource')::text);
  perform pg_temp.flow_assert(pg_temp.person(r, 'people', 'staff2') is not null and (pg_temp.person(r, 'people', 'staff2') ->> 'received')::int = 2, 'lead sees staff2 wf rows on P, not the work task');
  begin perform public.vcc_flow_v1(90, null, (select fr.u1 from flow_refs fr)); raise exception 'Unexpected: lead filtered unit A';
  exception when insufficient_privilege then null; end;
end $$;

-- ── Đo nhanh (in ra bảng kết quả): thời gian và cỡ JSON cho phạm vi toàn công ty trên dữ liệu thật + dữ liệu mẫu ──
create function pg_temp.flow_measure() returns table(company_ms numeric, unit_ms numeric, waiting_total int, links int, people int, json_bytes int)
language plpgsql as $$ declare t0 timestamptz; r jsonb; r2 jsonb; m1 numeric; m2 numeric; begin
  t0 := clock_timestamp(); r := public.vcc_flow_v1(); m1 := round(extract(epoch from clock_timestamp() - t0) * 1000);
  t0 := clock_timestamp(); r2 := public.vcc_flow_v1(90, null, (select fr.u1 from flow_refs fr)); m2 := round(extract(epoch from clock_timestamp() - t0) * 1000);
  return query select m1, m2, (r -> 'waiting' ->> 'total')::int, jsonb_array_length(r -> 'links'), jsonb_array_length(r -> 'people'), pg_column_size(r);
end $$;
select pg_temp.flow_as('boss');
select * from pg_temp.flow_measure();
