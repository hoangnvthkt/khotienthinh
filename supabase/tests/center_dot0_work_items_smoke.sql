-- Trung tâm điều hành PR-B: vcc_my_work_items_v1. Chạy cùng 2 migration trong một giao dịch rollback:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> \
--   --migration supabase/migrations/20261008138000_center_dot0_foundation.sql \
--   --migration supabase/migrations/20261008138001_center_dot0_work_items.sql \
--   --smoke supabase/tests/center_dot0_work_items_smoke.sql
-- Persona: creator (A, lập hồ sơ) · approver (B, được giao duyệt) · outsider (C, chỉ theo dõi 1 yêu cầu) · nocenter (D, chưa bật).
-- Dữ liệu mẫu chèn thẳng với session_replication_role = replica (bỏ qua trigger/FK của module) vì chỉ kiểm cách RPC ĐỌC.
create temporary table center_test_people(name text primary key, id uuid default gen_random_uuid(),
  email text default ('center-test-'||gen_random_uuid()||'@invalid.local'), employee_id uuid default gen_random_uuid());
insert into center_test_people(name) values ('creator'),('approver'),('outsider'),('nocenter');
insert into public.users(id,name,username,email,role)
  select id,'Center rollback '||name,'center-'||id,email,'EMPLOYEE'::public.user_role from center_test_people;
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
  select id,'center.module.access','global','*','Center rollback test' from center_test_people;
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
  select id,'work.module.access','global','*','Center rollback test' from center_test_people where name in ('creator','approver');
insert into app_private.center_rollout_actors(user_id,expires_at,reason)
  select id, now()+interval '1 day', 'Thử PR-B' from center_test_people where name <> 'nocenter';
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
create function pg_temp.count_of(p_result jsonb, p_source text) returns integer language sql as $$
  select coalesce((select (s->>'count')::int from jsonb_array_elements(p_result->'sources') s where s->>'source' = p_source), 0) $$;
create function pg_temp.kind_of(p_result jsonb, p_source text) returns text language sql as $$
  select string_agg(distinct i->>'kind', ',' order by i->>'kind') from jsonb_array_elements(p_result->'items') i where i->>'source' = p_source $$;

-- ── Dữ liệu mẫu (A lập → B duyệt) ────────────────────────────────────────────────────────────
create temporary table center_test_refs as
select (select id from public.warehouses where not is_archived order by created_at limit 1) as warehouse_id,
       (select id from public.projects order by created_at limit 1) as project_id,
       (select id::text from public.hrm_construction_sites order by created_at limit 1) as site_id,
       (select id from public.suppliers order by created_at limit 1) as supplier_id,
       gen_random_uuid() as subject_pending, gen_random_uuid() as subject_returned;
set local session_replication_role = 'replica';
insert into public.employees(id, full_name, user_id) select employee_id, 'Center rollback '||name, id from center_test_people;

-- Yêu cầu (RQ): 1 chờ B duyệt (C theo dõi), 1 bị trả lại cho A sửa.
insert into public.workflow_subjects(id, subject_type, subject_id, status, created_by)
  select subject_pending, 'request', gen_random_uuid()::text, 'RUNNING', pg_temp.p('creator') from center_test_refs
  union all select subject_returned, 'request', gen_random_uuid()::text, 'RETURNED', pg_temp.p('creator') from center_test_refs;
insert into public.request_instances(code, title, created_by, status, workflow_subject_id, due_at)
  select 'RQ-CT-PENDING', 'Center test: bổ sung 2 kỹ sư', pg_temp.p('creator'), 'PENDING', subject_pending, now()+interval '2 day' from center_test_refs
  union all select 'RQ-CT-RETURNED', 'Center test: yêu cầu bị trả', pg_temp.p('creator'), 'RETURNED', subject_returned, null from center_test_refs;
insert into public.workflow_step_assignments(workflow_subject_id, assignee_user_id, status)
  select subject_pending, pg_temp.p('approver'), 'PENDING' from center_test_refs;
insert into public.workflow_participants(workflow_subject_id, user_id, role, is_active)
  select subject_pending, pg_temp.p('outsider'), 'WATCHER', true from center_test_refs;

-- Đề xuất vật tư (đường cũ: submitted_to_user_id).
insert into public.requests(id, code, site_warehouse_id, requester_id, status, items, created_date, expected_date, submitted_to_user_id, submitted_to_name, request_origin, title, content_hash)
  select 'req-center-test', 'MR-CT-1', warehouse_id, pg_temp.p('creator'), 'PENDING', '[{"itemId":"x","quantity":1}]'::jsonb, now(), now()+interval '3 day',
    pg_temp.p('approver')::text, 'Center rollback approver', 'wms', 'Center test: thép D16', encode(sha256('center-test'::bytea), 'hex') from center_test_refs;

-- Nhật ký (A gửi B duyệt) + phiếu kỹ sư bị trả lại cho A.
insert into public.daily_logs(id, date, created_by, created_by_id, submitted_by_id, submitted_to_user_id, submitted_to_name, status, construction_site_id, project_id, worker_count)
  select 'dl-center-test', to_char(current_date, 'YYYY-MM-DD'), 'Center rollback creator', pg_temp.p('creator')::text, pg_temp.p('creator')::text,
    pg_temp.p('approver')::text, 'Center rollback approver', 'submitted', site_id, project_id, 12 from center_test_refs;
insert into public.daily_log_contributions(project_id, construction_site_id, date, author_user_id, status, returned_by_name, return_reason, content)
  select project_id, site_id, current_date, pg_temp.p('creator')::text, 'returned', 'Center rollback approver', 'Thiếu ảnh hiện trường', 'Xây tường trục 3' from center_test_refs;

-- Kế hoạch tuần.
insert into public.project_work_plans(project_id, period_type, period_start, period_end, code, status, created_by, submitted_by, submitted_at, submitted_to_user_id)
  select project_id, 'week', date_trunc('week', current_date)::date, date_trunc('week', current_date)::date + 6, 'KH-CT-1', 'submitted',
    pg_temp.p('creator'), pg_temp.p('creator'), now(), pg_temp.p('approver') from center_test_refs;

-- Đơn hàng chờ duyệt + đợt giao chờ duyệt.
insert into public.purchase_orders(id, vendor_id, vendor_name, po_number, items, total_amount, order_date, status, submitted_to_user_id, submitted_to_name, created_by_id, project_id)
  select 'po-center-test', supplier_id, 'NCC thử nghiệm', 'PO-CT-1', '[{"itemId":"x"},{"itemId":"y"}]'::jsonb, 12000000, to_char(current_date, 'YYYY-MM-DD'), 'sent',
    pg_temp.p('approver')::text, 'Center rollback approver', pg_temp.p('creator')::text, project_id from center_test_refs;
insert into public.purchase_order_delivery_batches(purchase_order_id, project_id, delivery_no, planned_delivery_date, status, approval_status, approval_assignee_user_id, created_by)
  select 'po-center-test', project_id, 1, current_date + 5, 'planned', 'pending_approval', pg_temp.p('approver'), pg_temp.p('creator') from center_test_refs;

-- Mua nóng.
insert into public.site_direct_purchases(code, project_id, construction_site_id, supplier_name_snapshot, purchase_mode, payment_source, status, purchase_date, total_amount, created_by, submitted_to_user_id, submitted_to_name)
  select 'MN-CT-1', project_id, site_id, 'Cửa hàng thử nghiệm', 'immediate', 'site_cash', 'submitted', current_date, 850000,
    pg_temp.p('creator'), pg_temp.p('approver')::text, 'Center rollback approver' from center_test_refs;

-- Đề nghị chi: B nằm trong eligibleIds của bước hiện tại.
insert into public.finance_payment_requests(code, supplier_id, supplier_name, method, planned_date, amount, status, threshold_amount, route, current_step, created_by)
  select 'DNC-CT-1', supplier_id, 'NCC thử nghiệm', 'bank_transfer', current_date + 2, 5000000, 'pending', 0,
    jsonb_build_array(jsonb_build_object('label', 'Kế toán trưởng', 'approverIds', jsonb_build_array(pg_temp.p('approver')), 'eligibleIds', jsonb_build_array(pg_temp.p('approver')))),
    0, pg_temp.p('creator') from center_test_refs;

-- Nghỉ phép (bước 1 giao đích danh B) + chấm công bù (gửi B).
insert into public.hrm_leave_requests("employeeId", type, "startDate", "endDate", "totalDays", reason, status, approvers, current_step, code)
  values (pg_temp.emp('creator'), 'annual', to_char(current_date + 3, 'YYYY-MM-DD'), to_char(current_date + 3, 'YYYY-MM-DD'), 1, 'Việc gia đình', 'pending',
    jsonb_build_array(jsonb_build_object('order', 1, 'kind', 'manager', 'userId', pg_temp.p('approver'), 'label', 'Quản lý trực tiếp', 'name', 'Center rollback approver', 'status', 'waiting')), 1, 'NP-CT-1');
insert into public.hrm_attendance_proposals("proposerEmployeeId", "targetEmployeeId", date, reason, "submittedToUserId", "submittedToName", "proposalStatus")
  values (pg_temp.emp('creator')::text, pg_temp.emp('creator')::text, current_date - 1, 'Quên chấm ra', pg_temp.p('approver')::text, 'Center rollback approver', 'pending');

-- Điều động + hồ sơ: A gửi (B không phải HR nên chỉ kiểm tab "Tôi gửi").
insert into public.hrm_site_assignments(code, employee_id, site_id, kind, start_date, status, reason, created_by)
  select 'SA-CT-1', pg_temp.emp('creator'), site_id::uuid, 'primary', current_date + 7, 'pending', 'Thử nghiệm PR-B Center', pg_temp.p('creator') from center_test_refs;
insert into public.hrm_profile_change_requests(employee_id, requested_by, kind, payload, note)
  values (pg_temp.emp('creator'), pg_temp.p('creator'), 'address', '{}'::jsonb, 'Đổi địa chỉ thường trú');

-- Vioo Work: 1 việc B đang làm, 1 việc chờ B duyệt kết quả.
insert into public.work_tasks(id, task_code, title, scope_type, status, created_by, review_policy, reviewer_user_id, deadline_at)
  values ('00000000-0000-4000-8000-00000000c001', 'VW-2026-900001', 'Center test: biên bản nghiệm thu móng A3', 'direct', 'in_progress', pg_temp.p('creator'), 'creator_review', null, now() + interval '1 day'),
         ('00000000-0000-4000-8000-00000000c002', 'VW-2026-900002', 'Center test: hồ sơ hoàn công', 'direct', 'awaiting_review', pg_temp.p('creator'), 'reviewer_review', pg_temp.p('approver'), null);
insert into public.work_task_assignments(task_id, user_id, state, assigned_by, completed_at, ended_at)
  values ('00000000-0000-4000-8000-00000000c001', pg_temp.p('approver'), 'in_progress', pg_temp.p('creator'), null, null),
         ('00000000-0000-4000-8000-00000000c002', pg_temp.p('outsider'), 'completed', pg_temp.p('creator'), now(), now());
set local session_replication_role = 'origin';

set local role authenticated;

-- B: chờ tôi.
select pg_temp.center_as('approver');
do $$ declare r jsonb; t0 timestamptz := clock_timestamp(); ms numeric; begin
  r := public.vcc_my_work_items_v1('mine');
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  raise notice 'approver mine: % items in % ms · sources %', r->>'total', round(ms), r->'sources';
  perform pg_temp.center_assert(pg_temp.count_of(r, 'rq') = 1 and pg_temp.kind_of(r, 'rq') = 'approve', 'B sees the pending request to approve');
  perform pg_temp.center_assert(pg_temp.count_of(r, 'mr') = 1, 'B sees the material request');
  perform pg_temp.center_assert(pg_temp.count_of(r, 'daily_log') = 1, 'B sees the submitted daily log');
  perform pg_temp.center_assert(pg_temp.count_of(r, 'daily_slip') = 0, 'B does not see A''s returned slip');
  perform pg_temp.center_assert(pg_temp.count_of(r, 'work_plan') = 1, 'B sees the work plan');
  perform pg_temp.center_assert(pg_temp.count_of(r, 'po') = 1 and pg_temp.count_of(r, 'po_delivery') = 1, 'B sees PO and delivery batch');
  perform pg_temp.center_assert(pg_temp.count_of(r, 'hot') = 1, 'B sees the hot purchase');
  perform pg_temp.center_assert(pg_temp.count_of(r, 'fin_payment') = 1 and pg_temp.kind_of(r, 'fin_payment') = 'approve', 'B is eligible approver of the payment request');
  perform pg_temp.center_assert(pg_temp.count_of(r, 'leave') = 1, 'B sees the leave request at step 1');
  perform pg_temp.center_assert(pg_temp.count_of(r, 'makeup') = 1, 'B sees the make-up proposal');
  perform pg_temp.center_assert(pg_temp.count_of(r, 'work') = 2 and pg_temp.kind_of(r, 'work') = 'approve,do', 'B sees one task to do and one to review');
  perform pg_temp.center_assert(pg_temp.count_of(r, 'site_assignment') = 0 and pg_temp.count_of(r, 'profile_change') = 0, 'B is not HR');
  perform pg_temp.center_assert(jsonb_array_length(r->'truncatedSources') = 0, 'nothing truncated');
  perform pg_temp.center_assert((select bool_and(i ? 'id' and i ? 'code' and i ? 'title' and i ? 'module' and i ? 'kind' and i ? 'ref') from jsonb_array_elements(r->'items') i), 'every item has id/code/title/module/kind/ref');
  perform pg_temp.center_assert((select bool_and(i->>'module' in ('project','request','work','office','procurement','finance','warehouse','hrm','vehicle')) from jsonb_array_elements(r->'items') i), 'module keys are known');
  perform pg_temp.center_assert((select i->>'title' from jsonb_array_elements(r->'items') i where i->>'source' = 'po') = 'NCC thử nghiệm · 12 tr', 'money formatting: '||(select i->>'title' from jsonb_array_elements(r->'items') i where i->>'source' = 'po'));
  perform pg_temp.center_assert((select i->>'who' from jsonb_array_elements(r->'items') i where i->>'source' = 'leave') = 'Center rollback creator gửi', 'leave shows employee name');
  perform pg_temp.center_assert(ms < 3000, 'approver mine under 3 s: '||round(ms)||' ms');
  r := public.vcc_my_work_items_v1('sent');
  perform pg_temp.center_assert((r->>'total')::int = 0, 'B sent nothing: '||(r->>'total'));
  begin perform public.vcc_my_work_items_v1('bogus'); raise exception 'Unexpected bogus tab';
  exception when invalid_parameter_value then null; end;
end $$;

-- A: việc của tôi = 2 thứ bị trả lại; tôi gửi = mọi hồ sơ đang chờ người khác.
select pg_temp.center_as('creator');
do $$ declare r jsonb; begin
  r := public.vcc_my_work_items_v1('mine');
  raise notice 'creator mine: % · %', r->>'total', r->'sources';
  perform pg_temp.center_assert((r->>'total')::int = 2, 'A has exactly the returned request and the returned slip: '||(r->>'total'));
  perform pg_temp.center_assert(pg_temp.kind_of(r, 'rq') = 'do' and pg_temp.kind_of(r, 'daily_slip') = 'do', 'returned items are "do"');
  r := public.vcc_my_work_items_v1('sent');
  raise notice 'creator sent: % · %', r->>'total', r->'sources';
  perform pg_temp.center_assert(pg_temp.count_of(r, 'rq') = 1 and pg_temp.count_of(r, 'mr') = 1 and pg_temp.count_of(r, 'daily_log') = 1
    and pg_temp.count_of(r, 'work_plan') = 1 and pg_temp.count_of(r, 'po') = 1 and pg_temp.count_of(r, 'po_delivery') = 1 and pg_temp.count_of(r, 'hot') = 1
    and pg_temp.count_of(r, 'fin_payment') = 1 and pg_temp.count_of(r, 'leave') = 1 and pg_temp.count_of(r, 'makeup') = 1
    and pg_temp.count_of(r, 'site_assignment') = 1 and pg_temp.count_of(r, 'profile_change') = 1 and pg_temp.count_of(r, 'work') = 2,
    'A sees everything they sent: '||(r->'sources')::text);
  perform pg_temp.center_assert((select bool_and(i->>'kind' = 'wait') from jsonb_array_elements(r->'items') i), 'sent items are "wait"');
  perform pg_temp.center_assert(pg_temp.count_of(r, 'daily_slip') = 0, 'returned slip is not "sent"');
  r := public.vcc_my_work_items_v1('watch');
  perform pg_temp.center_assert((r->>'total')::int = 0, 'A watches nothing: '||(r->>'total'));
end $$;

-- C: không được giao gì; chỉ theo dõi 1 yêu cầu.
select pg_temp.center_as('outsider');
do $$ declare r jsonb; begin
  r := public.vcc_my_work_items_v1('mine');
  perform pg_temp.center_assert((r->>'total')::int = 0, 'C has no work: '||(r->'sources')::text);
  r := public.vcc_my_work_items_v1('sent');
  perform pg_temp.center_assert((r->>'total')::int = 0, 'C sent nothing');
  r := public.vcc_my_work_items_v1('watch');
  perform pg_temp.center_assert(pg_temp.count_of(r, 'rq') = 1 and pg_temp.kind_of(r, 'rq') = 'watch' and (r->>'total')::int = 1, 'C watches exactly the pending request: '||(r->'sources')::text);
end $$;

-- D: có quyền nhưng chưa bật → từ chối ở máy chủ.
select pg_temp.center_as('nocenter');
do $$ begin
  begin perform public.vcc_my_work_items_v1('mine'); raise exception 'Unexpected access outside rollout';
  exception when insufficient_privilege then null; end;
end $$;

set local role anon;
do $$ begin
  begin perform public.vcc_my_work_items_v1('mine'); raise exception 'Unexpected anonymous access';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
select 'center_dot0_work_items_smoke ok' as result;
