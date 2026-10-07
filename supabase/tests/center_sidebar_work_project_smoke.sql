-- Trung tâm điều hành: nhóm Công việc (phiếu Quy trình) + Dự án (sự cố An toàn) trong "Việc của tôi",
-- chọn dự án chỉ lấy dự án đang hoạt động. Chạy trong một giao dịch rollback:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> \
--   --migration supabase/migrations/20261008138005_center_sidebar_work_project.sql \
--   --smoke supabase/tests/center_sidebar_work_project_smoke.sql
-- Persona: creator (A, lập phiếu / ghi nhận sự cố) · approver (B, được giao bước / sự cố) · outsider (C, chỉ theo dõi).
-- Dữ liệu mẫu chèn thẳng với session_replication_role = replica (bỏ qua trigger/FK của module) vì chỉ kiểm cách RPC ĐỌC.
create temporary table center_test_people(name text primary key, id uuid default gen_random_uuid(),
  email text default ('center-test-'||gen_random_uuid()||'@invalid.local'));
insert into center_test_people(name) values ('creator'),('approver'),('outsider');
insert into public.users(id,name,username,email,role)
  select id,'Center rollback '||name,'center-'||id,email,'EMPLOYEE'::public.user_role from center_test_people;
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
  select id,'center.module.access','global','*','Center rollback test' from center_test_people;
insert into app_private.center_rollout_actors(user_id,expires_at,reason)
  select id, now()+interval '1 day', 'Thử nhóm Công việc / Dự án' from center_test_people;
grant select on center_test_people to authenticated, anon;

create function pg_temp.p(p_name text) returns uuid language sql as $$ select id from center_test_people where name = p_name $$;
create function pg_temp.center_as(p_name text) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', (select jsonb_build_object('sub',gen_random_uuid(),'email',email,'role','authenticated')::text
    from center_test_people where name = p_name), true);
end $$;
create function pg_temp.center_assert(ok boolean, message text) returns void language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'Center test failed: %', message; end if;
end $$;
create function pg_temp.count_of(p_result jsonb, p_source text) returns integer language sql as $$
  select coalesce((select (s->>'count')::int from jsonb_array_elements(p_result->'sources') s where s->>'source' = p_source), 0) $$;
create function pg_temp.kind_of(p_result jsonb, p_source text) returns text language sql as $$
  select string_agg(distinct i->>'kind', ',' order by i->>'kind') from jsonb_array_elements(p_result->'items') i where i->>'source' = p_source $$;
create function pg_temp.codes_of(p_result jsonb, p_source text) returns text language sql as $$
  select string_agg(i->>'code', ',' order by i->>'code') from jsonb_array_elements(p_result->'items') i where i->>'source' = p_source $$;

-- ── Dữ liệu mẫu ──────────────────────────────────────────────────────────────────────────────
create temporary table center_test_wf as
select gen_random_uuid() as tpl, gen_random_uuid() as tpl_material, gen_random_uuid() as tpl_request,
       gen_random_uuid() as n_start, gen_random_uuid() as n_first, gen_random_uuid() as n_approve, gen_random_uuid() as n_all,
       gen_random_uuid() as m_start, gen_random_uuid() as m_step, gen_random_uuid() as r_start, gen_random_uuid() as r_step,
       gen_random_uuid() as i_pending, gen_random_uuid() as i_revision, gen_random_uuid() as i_all_done, gen_random_uuid() as i_material,
       gen_random_uuid() as i_request, gen_random_uuid() as i_done,
       'prj-center-active-'||gen_random_uuid() as p_active, 'prj-center-planning-'||gen_random_uuid() as p_planning;
grant select on center_test_wf to authenticated, anon;
set local session_replication_role = 'replica';

-- Quy trình thường: Bắt đầu → Lập phiếu (ACTION) → Trưởng phòng duyệt (APPROVAL, giao B) → Tất cả duyệt (APPROVAL, ALL).
insert into public.workflow_templates(id, name, created_by, default_watchers)
  select tpl, 'Center test: Xin xe công trường', pg_temp.p('creator'), array[pg_temp.p('outsider')::text] from center_test_wf
  union all select tpl_material, 'Quy trình cấp vật tư công trường', pg_temp.p('creator'), '{}' from center_test_wf;
insert into public.workflow_templates(id, name, created_by, custom_fields)
  select tpl_request, '[Request] Center test', pg_temp.p('creator'), jsonb_build_array(jsonb_build_object('_requestTemplateId', 'rt-center-test')) from center_test_wf;
insert into public.workflow_nodes(id, template_id, type, label, config)
  select n_start, tpl, 'START'::public.workflow_node_type, 'Bắt đầu', '{}'::jsonb from center_test_wf
  union all select n_first, tpl, 'ACTION', 'Lập phiếu', jsonb_build_object('assigneeUserId', pg_temp.p('creator')) from center_test_wf
  union all select n_approve, tpl, 'APPROVAL', 'Trưởng phòng duyệt', jsonb_build_object('assigneeUserId', pg_temp.p('outsider'), 'slaHours', '24') from center_test_wf
  union all select n_all, tpl, 'APPROVAL', 'Tất cả duyệt', jsonb_build_object('approvalPolicy', 'ALL') from center_test_wf
  union all select m_start, tpl_material, 'START', 'Bắt đầu', '{}'::jsonb from center_test_wf
  union all select m_step, tpl_material, 'APPROVAL', 'Chỉ huy trưởng duyệt', jsonb_build_object('assigneeUserId', pg_temp.p('approver')) from center_test_wf
  union all select r_start, tpl_request, 'START', 'Bắt đầu', '{}'::jsonb from center_test_wf
  union all select r_step, tpl_request, 'APPROVAL', 'Duyệt đề xuất', jsonb_build_object('assigneeUserId', pg_temp.p('approver')) from center_test_wf;
insert into public.workflow_edges(template_id, source_node_id, target_node_id)
  select tpl, n_start, n_first from center_test_wf
  union all select tpl, n_first, n_approve from center_test_wf
  union all select tpl, n_approve, n_all from center_test_wf
  union all select tpl_material, m_start, m_step from center_test_wf
  union all select tpl_request, r_start, r_step from center_test_wf;
-- WF-CT-1: đang ở bước duyệt, giao riêng cho B (đè người mặc định C) · WF-CT-2: bị yêu cầu sửa, về bước đầu của A ·
-- WF-CT-3: bước "tất cả duyệt" B đã duyệt (chờ người khác) · WF-CT-4/5: cấp vật tư / phiếu Yêu cầu (đã có nhóm riêng) ·
-- WF-CT-6: đã xong.
insert into public.workflow_instances(id, template_id, code, title, created_by, current_node_id, status, step_assignees, step_approvals, watchers)
  select i_pending, tpl, 'WF-CT-1', 'Center test: xin xe đi Bắc Ninh', pg_temp.p('creator'), n_approve, 'RUNNING'::public.workflow_instance_status,
      jsonb_build_object(n_approve::text, jsonb_build_array(pg_temp.p('approver'))), '{}'::jsonb, '{}'::text[] from center_test_wf
  union all select i_revision, tpl, 'WF-CT-2', 'Center test: phiếu bị yêu cầu sửa', pg_temp.p('creator'), n_first, 'RUNNING',
      '{}'::jsonb, '{}'::jsonb, '{}'::text[] from center_test_wf
  union all select i_all_done, tpl, 'WF-CT-3', 'Center test: B đã duyệt, chờ người khác', pg_temp.p('creator'), n_all, 'RUNNING',
      jsonb_build_object(n_all::text, jsonb_build_array(pg_temp.p('approver'), pg_temp.p('outsider'))),
      jsonb_build_object(n_all::text, jsonb_build_array(pg_temp.p('approver'))), '{}'::text[] from center_test_wf
  union all select i_material, tpl_material, 'WF-CT-4', 'Center test: cấp vật tư', pg_temp.p('creator'), m_step, 'RUNNING',
      '{}'::jsonb, '{}'::jsonb, '{}'::text[] from center_test_wf
  union all select i_request, tpl_request, 'WF-CT-5', 'Center test: phiếu của module Yêu cầu', pg_temp.p('creator'), r_step, 'RUNNING',
      '{}'::jsonb, '{}'::jsonb, '{}'::text[] from center_test_wf
  union all select i_done, tpl, 'WF-CT-6', 'Center test: đã xong', pg_temp.p('creator'), n_approve, 'COMPLETED',
      jsonb_build_object(n_approve::text, jsonb_build_array(pg_temp.p('approver'))), '{}'::jsonb, '{}'::text[] from center_test_wf;
insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
  select i_revision, n_approve, 'REVISION_REQUESTED', pg_temp.p('outsider'), 'Bổ sung biển số xe' from center_test_wf;

-- An toàn: SC-CT-1 giao B đang xử lý · SC-CT-2 chờ xác nhận khắc phục (B, C không có quyền xác nhận) · SC-CT-3 đã đóng.
insert into public.safety_issues(code, title, severity, status, assigned_to_user_id, assigned_to_name, due_at, created_by, project_id)
  select 'SC-CT-1', 'Center test: lan can tầng 3 hở', 'high', 'assigned', pg_temp.p('approver')::text, 'Center rollback approver',
      now() + interval '1 day', pg_temp.p('creator')::text, p_active from center_test_wf
  union all select 'SC-CT-2', 'Center test: dây điện tạm', 'medium', 'waiting_verification', pg_temp.p('outsider')::text, 'Center rollback outsider',
      null, pg_temp.p('creator')::text, p_active from center_test_wf
  union all select 'SC-CT-3', 'Center test: đã đóng', 'low', 'closed', pg_temp.p('approver')::text, 'Center rollback approver',
      null, pg_temp.p('creator')::text, p_active from center_test_wf;

-- Dự án: A thuộc 1 dự án đang hoạt động và 1 dự án còn lập kế hoạch.
insert into public.projects(id, code, name, status)
  select p_active, 'CT-ACTIVE', 'Center test: đang thi công', 'active' from center_test_wf
  union all select p_planning, 'CT-PLANNING', 'Center test: đang lập kế hoạch', 'planning' from center_test_wf;
insert into public.project_staff(project_id, user_id, position_id)
  select p_active, pg_temp.p('creator')::text, gen_random_uuid() from center_test_wf
  union all select p_planning, pg_temp.p('creator')::text, gen_random_uuid() from center_test_wf;
set local session_replication_role = 'origin';

set local role authenticated;

-- B: chờ tôi = WF-CT-1 (duyệt) + sự cố được giao.
select pg_temp.center_as('approver');
do $$ declare r jsonb; item jsonb; t0 timestamptz := clock_timestamp(); ms numeric; begin
  r := public.vcc_my_work_items_v1('mine');
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  raise notice 'approver mine: % items in % ms · sources %', r->>'total', round(ms), r->'sources';
  perform pg_temp.center_assert(pg_temp.codes_of(r, 'wf') = 'WF-CT-1', 'B waits on exactly WF-CT-1 (not material / request / already-approved / done): '||coalesce(pg_temp.codes_of(r, 'wf'), '∅'));
  perform pg_temp.center_assert(pg_temp.kind_of(r, 'wf') = 'approve', 'approval step is "approve"');
  item := (select i from jsonb_array_elements(r->'items') i where i->>'source' = 'wf');
  perform pg_temp.center_assert(item->>'module' = 'workflow' and item->'ref'->>'instanceId' is not null and item->>'dueAt' is not null,
    'wf item has module workflow, instanceId and SLA due: '||item::text);
  perform pg_temp.center_assert(item->>'meta' = 'Center test: Xin xe công trường · Trưởng phòng duyệt', 'wf meta = template · step: '||coalesce(item->>'meta', '∅'));
  perform pg_temp.center_assert(pg_temp.codes_of(r, 'safety') = 'SC-CT-1' and pg_temp.kind_of(r, 'safety') = 'do', 'B fixes the assigned safety issue only: '||coalesce(pg_temp.codes_of(r, 'safety'), '∅'));
  item := (select i from jsonb_array_elements(r->'items') i where i->>'source' = 'safety');
  perform pg_temp.center_assert(item->>'module' = 'project' and item->'ref'->>'safetyId' is not null and item->'ref'->>'projectId' is not null,
    'safety item opens in the project: '||item::text);
  perform pg_temp.center_assert(ms < 3000, 'approver mine under 3 s: '||round(ms)||' ms');
  r := public.vcc_my_work_items_v1('sent');
  perform pg_temp.center_assert(pg_temp.count_of(r, 'wf') = 0 and pg_temp.count_of(r, 'safety') = 0, 'B sent nothing new');
end $$;

-- A: chờ tôi = phiếu bị yêu cầu sửa; tôi gửi = phiếu đang chờ người khác + sự cố đang xử lý.
select pg_temp.center_as('creator');
do $$ declare r jsonb; begin
  r := public.vcc_my_work_items_v1('mine');
  raise notice 'creator mine: % · %', r->>'total', r->'sources';
  perform pg_temp.center_assert(pg_temp.codes_of(r, 'wf') = 'WF-CT-2' and pg_temp.kind_of(r, 'wf') = 'do', 'A fixes the returned ticket: '||coalesce(pg_temp.codes_of(r, 'wf'), '∅'));
  perform pg_temp.center_assert((select i->>'who' from jsonb_array_elements(r->'items') i where i->>'source' = 'wf') = 'Bị yêu cầu sửa', 'returned ticket says so');
  perform pg_temp.center_assert(pg_temp.count_of(r, 'safety') = 0, 'A has no safety issue to fix');
  r := public.vcc_my_work_items_v1('sent');
  raise notice 'creator sent: % · %', r->>'total', r->'sources';
  perform pg_temp.center_assert(pg_temp.codes_of(r, 'wf') = 'WF-CT-1,WF-CT-3', 'A waits on own running tickets: '||coalesce(pg_temp.codes_of(r, 'wf'), '∅'));
  perform pg_temp.center_assert(pg_temp.codes_of(r, 'safety') = 'SC-CT-1,SC-CT-2', 'A follows reported open issues: '||coalesce(pg_temp.codes_of(r, 'safety'), '∅'));
  perform pg_temp.center_assert((select bool_and(i->>'kind' = 'wait') from jsonb_array_elements(r->'items') i where i->>'source' in ('wf', 'safety')), 'sent items are "wait"');
  r := public.vcc_my_work_items_v1('watch');
  perform pg_temp.center_assert(pg_temp.count_of(r, 'wf') = 0, 'A does not watch own tickets');
end $$;

-- C: người duyệt mặc định của bước đã bị giao đè → không chờ; theo dõi mặc định của mẫu; không có quyền xác nhận an toàn.
select pg_temp.center_as('outsider');
do $$ declare r jsonb; begin
  r := public.vcc_my_work_items_v1('mine');
  perform pg_temp.center_assert(pg_temp.codes_of(r, 'wf') = 'WF-CT-3', 'C still owes the "all must approve" step only: '||coalesce(pg_temp.codes_of(r, 'wf'), '∅'));
  perform pg_temp.center_assert(pg_temp.count_of(r, 'safety') = 0, 'C cannot verify safety fixes without the room action');
  r := public.vcc_my_work_items_v1('watch');
  perform pg_temp.center_assert(pg_temp.codes_of(r, 'wf') = 'WF-CT-1,WF-CT-2' and pg_temp.kind_of(r, 'wf') = 'watch',
    'C watches template tickets they are not assigned to: '||coalesce(pg_temp.codes_of(r, 'wf'), '∅'));
end $$;

-- Chọn dự án: chỉ dự án đang hoạt động, kể cả khi trình duyệt gửi id dự án đang lập kế hoạch.
select pg_temp.center_as('creator');
do $$ declare r jsonb; begin
  r := public.vcc_my_center_v1((select p_planning from center_test_wf));
  raise notice 'creator options: %', r->'projectOptions';
  perform pg_temp.center_assert((select string_agg(o->>'code', ',') from jsonb_array_elements(r->'projectOptions') o) = 'CT-ACTIVE',
    'only the active project is offered: '||(r->'projectOptions')::text);
  perform pg_temp.center_assert(r->'project'->>'code' = 'CT-ACTIVE' and r->'project'->>'source' <> 'selected',
    'a planning project id falls back to the active one: '||(r->'project')::text);
  perform pg_temp.center_assert((r->'widgets'->'project'->>'waiting')::int = 0, 'A has nothing waiting in the project');
end $$;
select 'center_sidebar_work_project_smoke ok' as result;
