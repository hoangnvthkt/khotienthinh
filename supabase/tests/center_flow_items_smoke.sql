-- Dòng chảy công việc PR-3: vcc_flow_items_v1 + vcc_flow_remind_v1. Chạy cùng migration trong một giao dịch rollback (PR-1 đã trên prod):
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> \
--   --migration supabase/migrations/20261013180000_center_flow_items_v1.sql \
--   --smoke supabase/tests/center_flow_items_smoke.sql
-- Cùng persona và dữ liệu mẫu với center_flow_v1_smoke.sql: boss (Admin) · exec · head (trưởng phòng A) · lead (giám đốc dự án P) · nobody · nocenter;
-- A1 B→A đứng yên + quá hạn (staff1) · A2 xong · A3 phiếu chết (head) · A4 chưa giao người · A5 trả lại · MR đường cũ chờ head · việc Vioo Work staff2.
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
select pg_temp.flow_assert(p.prosecdef, 'vcc_flow_items_v1 is SECURITY DEFINER') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'vcc_flow_items_v1';
select pg_temp.flow_assert(p.prosecdef and p.provolatile = 'v', 'vcc_flow_remind_v1 is SECURITY DEFINER and volatile') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'vcc_flow_remind_v1';
select pg_temp.flow_assert(not has_function_privilege('anon', 'public.vcc_flow_items_v1(jsonb,integer,integer)', 'execute') and not has_function_privilege('anon', 'public.vcc_flow_remind_v1(jsonb,text)', 'execute'), 'anon cannot call');
select pg_temp.flow_assert(has_function_privilege('authenticated', 'public.vcc_flow_items_v1(jsonb,integer,integer)', 'execute') and has_function_privilege('authenticated', 'public.vcc_flow_remind_v1(jsonb,text)', 'execute'), 'signed-in users can call');

create function pg_temp.items(p_filter jsonb, p_limit integer default 50, p_offset integer default 0) returns jsonb language sql as $$ select public.vcc_flow_items_v1(p_filter, p_limit, p_offset) $$;
create function pg_temp.first_item(r jsonb) returns jsonb language sql as $$ select r -> 'items' -> 0 $$;

set local role authenticated;

select pg_temp.flow_as('nocenter');
select pg_temp.flow_assert(pg_temp.items('{}') ->> 'reason' = 'no_center' and public.vcc_flow_remind_v1('{}') ->> 'reason' = 'no_center', 'nocenter: access false, no error');
select pg_temp.flow_as('nobody');
select pg_temp.flow_assert(pg_temp.items('{}') ->> 'reason' = 'no_scope' and public.vcc_flow_remind_v1('{}') ->> 'reason' = 'no_scope', 'nobody: no scope');

-- boss: toàn công ty — danh sách, lọc, phân trang, khuôn vcc_item.
select pg_temp.flow_as('boss');
do $$ declare r jsonb; i jsonb; t0 timestamptz := clock_timestamp(); ms numeric;
  u1 text := (select fr.u1::text from flow_refs fr); inst text := (select fr.inst::text from flow_refs fr); pid text := (select fr.project_id from flow_refs fr); begin
  r := pg_temp.items('{}');
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  raise notice 'boss items: total % · % ms', r ->> 'total', round(ms);
  perform pg_temp.flow_assert(r ->> 'access' = 'true' and (r ->> 'total')::int >= 5 and r -> 'scope' ->> 'kind' = 'company', 'boss lists company-wide items: ' || (r ->> 'total'));
  perform pg_temp.flow_assert(ms < 3000, 'items under 3 s: ' || round(ms) || ' ms');
  perform pg_temp.flow_assert((select bool_and(x ? 'id' and x ? 'code' and x ? 'title' and x ? 'module' and x ? 'kind' and x ? 'ref' and x ? 'holder' and x ? 'since' and x ? 'stuck') from jsonb_array_elements(r -> 'items') x), 'every item has vcc_item keys + flow extras');
  perform pg_temp.flow_assert((select bool_and(x ->> 'kind' = 'watch') from jsonb_array_elements(r -> 'items') x), 'viewer kind is watch');
  -- Lọc theo người giữ: A1 của staff1 — phiếu quy trình chung (chủ thể không phải Yêu cầu / Đề xuất vật tư).
  r := pg_temp.items(jsonb_build_object('holderUserId', pg_temp.p('staff1')::text)); i := pg_temp.first_item(r);
  perform pg_temp.flow_assert((r ->> 'total')::int = 1 and i ->> 'source' = 'wf' and i ->> 'module' = 'workflow' and i ->> 'code' = 'FLOW-WF-1'
    and i -> 'ref' ->> 'instanceId' = inst and i -> 'holder' ->> 'name' = 'Flow rollback staff1' and i -> 'holder' ->> 'unitId' = u1
    and (i ->> 'stuck')::boolean and (i ->> 'overdue')::boolean and not (i ->> 'dead')::boolean and i ->> 'who' = 'Flow rollback staff1 đang giữ'
    and i -> 'sender' ->> 'name' = 'Flow rollback boss' and i ->> 'kindName' = 'Flow test quy trình' and i ->> 'projectId' = pid,
    'staff1 item shape: ' || coalesce(i::text, 'missing'));
  -- Chưa giao người / phiếu chết / đề xuất vật tư đường cũ.
  r := pg_temp.items('{"status":"unassigned"}');
  perform pg_temp.flow_assert((r ->> 'total')::int >= 1 and exists (select 1 from jsonb_array_elements(r -> 'items') x where x ->> 'code' = 'FLOW-WF-1' and x -> 'holder' = 'null'::jsonb and x ->> 'who' = 'Chưa giao người'), 'unassigned filter finds A4');
  r := pg_temp.items('{"status":"dead"}');
  perform pg_temp.flow_assert(exists (select 1 from jsonb_array_elements(r -> 'items') x where x -> 'holder' ->> 'name' = 'Flow rollback head' and (x ->> 'dead')::boolean), 'dead filter finds A3 held by head');
  r := pg_temp.items(jsonb_build_object('source', 'mr', 'holderUserId', pg_temp.p('head')::text)); i := pg_temp.first_item(r);
  perform pg_temp.flow_assert((r ->> 'total')::int = 1 and i ->> 'code' = 'MR-FLOW-1' and i -> 'ref' ->> 'requestId' = 'flow-mr-legacy' and i -> 'ref' ->> 'requestOrigin' = 'wms'
    and (i ->> 'slaDefault')::boolean = false and not (i ->> 'stuck')::boolean, 'legacy MR item: ' || coalesce(i::text, 'missing'));
  r := pg_temp.items(jsonb_build_object('holderUnit', u1));
  perform pg_temp.flow_assert((r ->> 'total')::int = 3, 'holderUnit A: 3 items (A1, A3, MR): ' || (r ->> 'total'));
  r := pg_temp.items(jsonb_build_object('project', pid));
  perform pg_temp.flow_assert((r ->> 'total')::int = 4, 'project P: 4 items: ' || (r ->> 'total'));
  r := pg_temp.items(jsonb_build_object('kindName', 'Flow test quy trình'));
  perform pg_temp.flow_assert((r ->> 'total')::int = 3, 'kindName filter: 3 wf steps: ' || (r ->> 'total'));
  r := pg_temp.items(jsonb_build_object('source', 'work')); i := pg_temp.first_item(r);
  perform pg_temp.flow_assert((r ->> 'total')::int >= 1 and exists (select 1 from jsonb_array_elements(r -> 'items') x where x ->> 'code' = 'VW-2026-900101' and x -> 'ref' ->> 'taskCode' = 'VW-2026-900101'), 'work item with taskCode ref');
  -- Phân trang + kẹp giới hạn; thứ tự: phiếu chết → đứng yên → quá hạn → cũ nhất.
  r := pg_temp.items(jsonb_build_object('project', pid), 2, 0);
  perform pg_temp.flow_assert(jsonb_array_length(r -> 'items') = 2 and (r ->> 'total')::int = 4 and (r ->> 'limit')::int = 2, 'page 1 of project P');
  perform pg_temp.flow_assert((pg_temp.first_item(r) ->> 'dead')::boolean, 'dead item sorts first');
  r := pg_temp.items(jsonb_build_object('project', pid), 2, 2);
  perform pg_temp.flow_assert(jsonb_array_length(r -> 'items') = 2 and (r ->> 'offset')::int = 2, 'page 2 of project P');
  perform pg_temp.flow_assert((pg_temp.items('{}', 1000) ->> 'limit')::int = 200, 'limit clamped to 200');
  -- Lọc phạm vi phòng / dự án như vcc_flow_v1.
  perform pg_temp.flow_assert((pg_temp.items(jsonb_build_object('unitId', u1)) ->> 'total')::int = 3 and (pg_temp.items(jsonb_build_object('projectId', pid)) ->> 'total')::int = 4, 'scope filters agree with vcc_flow_v1');
end $$;

-- boss nhắc: thông báo + audit, chống nhắc dồn 24 giờ, ghi chú vào thân thông báo.
do $$ declare r jsonb; n record; begin
  r := public.vcc_flow_remind_v1(jsonb_build_object('holderUserId', pg_temp.p('staff1')::text), 'Ưu tiên xong trước thứ Sáu');
  perform pg_temp.flow_assert((r ->> 'sent')::int = 1 and (r ->> 'skipped')::int = 0 and r -> 'holders' -> 0 ->> 'status' = 'sent', 'boss reminds staff1: ' || r::text);
  select * into n from public.notifications nt where nt.user_id = pg_temp.p('staff1')::text and nt.entity_type = 'flow_reminder' order by nt.created_at desc limit 1;
  perform pg_temp.flow_assert(n.title = 'Nhắc: 1 việc đang chờ bạn xử lý' and n.body like '%FLOW-WF-1%' and n.body like '%Ưu tiên xong trước thứ Sáu%'
    and n.link = '/center' and n.push_enabled and n.module = 'CENTER' and n.metadata ->> 'by' = pg_temp.p('boss')::text and n.priority = 'high',
    'reminder notification content: ' || coalesce(n.body, 'missing'));
  perform pg_temp.flow_assert(exists (select 1 from public.audit_trail a where a.table_name = 'notifications' and a.record_id = pg_temp.p('staff1')::text and a.action = 'INSERT' and a.module = 'CENTER'), 'audit row written');
  r := public.vcc_flow_remind_v1(jsonb_build_object('holderUserId', pg_temp.p('staff1')::text));
  perform pg_temp.flow_assert((r ->> 'sent')::int = 0 and (r ->> 'skipped')::int = 1 and r -> 'holders' -> 0 ->> 'status' = 'skipped', 'second reminder within 24 h is skipped');
  perform pg_temp.flow_assert((select count(*) from public.notifications nt where nt.user_id = pg_temp.p('staff1')::text and nt.entity_type = 'flow_reminder') = 1, 'only one notification');
  r := public.vcc_flow_remind_v1(jsonb_build_object('holderUnit', (select fr.u1::text from flow_refs fr)));
  perform pg_temp.flow_assert((r ->> 'sent')::int = 1 and (r ->> 'skipped')::int = 1, 'unit A: head reminded (2 items), staff1 skipped: ' || r::text);
  select * into n from public.notifications nt where nt.user_id = pg_temp.p('head')::text and nt.entity_type = 'flow_reminder' order by nt.created_at desc limit 1;
  perform pg_temp.flow_assert(n.title = 'Nhắc: 2 việc đang chờ bạn xử lý' and n.body like '%MR-FLOW-1%' and n.body like '%FLOW-WF-1%', 'head gets both codes: ' || coalesce(n.body, 'missing'));
  r := public.vcc_flow_remind_v1('{"status":"unassigned"}');
  perform pg_temp.flow_assert((r ->> 'sent')::int = 0, 'nothing to remind for unassigned items');
end $$;

-- head: chỉ phòng A; không lọc được phòng B; nhắc không tự nhắc mình, người nhắc khác nhau không bị throttle chung.
select pg_temp.flow_as('head');
do $$ declare r jsonb; begin
  r := pg_temp.items('{}');
  perform pg_temp.flow_assert((r ->> 'total')::int = 3 and r -> 'scope' ->> 'kind' = 'unit', 'head sees 3 items of unit A: ' || (r ->> 'total'));
  perform pg_temp.flow_assert((pg_temp.items(jsonb_build_object('holderUserId', pg_temp.p('staff2')::text)) ->> 'total')::int = 0, 'head cannot list staff2 (unit B)');
  begin perform pg_temp.items(jsonb_build_object('unitId', (select fr.u2 from flow_refs fr))); raise exception 'Unexpected: head filtered unit B';
  exception when insufficient_privilege then null; end;
  r := public.vcc_flow_remind_v1('{}');
  perform pg_temp.flow_assert((r ->> 'sent')::int = 1 and (r ->> 'skipped')::int = 1
    and exists (select 1 from jsonb_array_elements(r -> 'holders') h where h ->> 'status' = 'self'), 'head reminds staff1, skips self: ' || r::text);
end $$;

-- lead: chỉ dự án P.
select pg_temp.flow_as('lead');
do $$ declare r jsonb; begin
  r := pg_temp.items('{}');
  perform pg_temp.flow_assert((r ->> 'total')::int = 4 and r -> 'scope' ->> 'kind' = 'project', 'lead sees 4 items of project P: ' || (r ->> 'total'));
  begin perform pg_temp.items(jsonb_build_object('unitId', (select fr.u1 from flow_refs fr))); raise exception 'Unexpected: lead filtered unit A';
  exception when insufficient_privilege then null; end;
  r := public.vcc_flow_remind_v1('{}');
  perform pg_temp.flow_assert((r ->> 'sent')::int = 2 and (r ->> 'skipped')::int = 0, 'lead reminds staff1 and head (own throttle): ' || r::text);
end $$;
