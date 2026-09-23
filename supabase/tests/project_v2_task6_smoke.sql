-- Run only on a schema-only Supabase Cloud preview branch as postgres.
-- All fixture rows roll back.
begin;

create temp table project_v2_task6_ids on commit drop as
select gen_random_uuid() admin_id, gen_random_uuid() reviewer_id,
  gen_random_uuid() workspace_id, gen_random_uuid() contract_item_id,
  gen_random_uuid() crew_id,
  ('project-v2-task6-' || gen_random_uuid()::text) project_id;

insert into public.users(id, name, email, username, role)
select admin_id, 'Task 6 admin', 'project-v2-task6-admin@example.invalid',
  'v2-task6-admin-' || left(admin_id::text, 8), 'ADMIN' from project_v2_task6_ids;
insert into public.users(id, name, email, username, role)
select reviewer_id, 'Task 6 reviewer', 'project-v2-task6-reviewer@example.invalid',
  'v2-task6-reviewer-' || left(reviewer_id::text, 8), 'ADMIN' from project_v2_task6_ids;
insert into public.projects(id, code, name)
select project_id, 'PV2-T6-' || left(admin_id::text, 8), 'Task 6 project' from project_v2_task6_ids;
insert into public.project_v2_workspaces(id, project_id, enrolled_by)
select workspace_id, project_id, admin_id from project_v2_task6_ids;
insert into public.project_v2_crews(id, workspace_id, name)
select crew_id, workspace_id, 'Tổ thi công A' from project_v2_task6_ids;
insert into public.contract_items(id, contract_id, contract_type, project_id,
  code, name, unit, quantity, unit_price, is_locked, locked_at)
select contract_item_id, gen_random_uuid(), 'customer', project_id,
  'BOQ-01', 'Đào móng', 'm3', 100, 250000, true,
  timestamptz '2026-09-01 00:00:00+00' from project_v2_task6_ids;

select set_config('request.jwt.claims', '{"email":"project-v2-task6-admin@example.invalid"}', true);

do $$
declare
  v_ids record;
  v_month_candidate jsonb;
  v_result jsonb;
  v_month_id uuid;
  v_construction_candidate jsonb;
  v_construction_id uuid;
  v_exception_id uuid;
begin
  select * into v_ids from project_v2_task6_ids;
  v_month_candidate := public.list_project_v2_source_candidates_v1(v_ids.workspace_id, 'month') -> 'items' -> 0;
  if v_month_candidate ->> 'baselineState' <> 'verified'
    or (v_month_candidate ->> 'availableQuantity')::numeric <> 100
    or v_month_candidate ->> 'priceVisible' <> 'true' then
    raise exception 'TASK6_MONTH_CANDIDATE_INVALID: %', v_month_candidate;
  end if;
  v_result := public.save_project_v2_plan_v1(v_ids.workspace_id, null, null,
    'task6-month-save', 'month', 'M-T6', 'Tháng thử nghiệm',
    date '2026-09-01', date '2026-09-30', jsonb_build_array(jsonb_build_object(
      'contractItemId', v_ids.contract_item_id,
      'baselineRevision', v_month_candidate ->> 'baselineRevision',
      'unit', 'm3', 'quantity', '60.000000')));
  v_month_id := (v_result ->> 'planId')::uuid;
  if (select unit_price_snapshot from public.project_v2_plan_lines
      where plan_id = v_month_id) <> 250000 then
    raise exception 'TASK6_PRICE_NOT_SERVER_SNAPSHOT';
  end if;
  v_result := public.submit_project_v2_plan_v1(v_month_id, 1, 'task6-month-submit', '');
  if v_result ->> 'status' <> 'pending_approval' then raise exception 'TASK6_MONTH_NOT_PENDING'; end if;
  perform set_config('request.jwt.claims', '{"email":"project-v2-task6-reviewer@example.invalid"}', true);
  v_result := public.approve_project_v2_plan_v1(v_month_id, 2, 'task6-month-approve');
  if v_result ->> 'status' <> 'approved' then raise exception 'TASK6_MONTH_NOT_APPROVED'; end if;
  perform set_config('request.jwt.claims', '{"email":"project-v2-task6-admin@example.invalid"}', true);
  v_construction_candidate := public.list_project_v2_source_candidates_v1(
    v_ids.workspace_id, 'construction') -> 'items' -> 0;
  if (v_construction_candidate ->> 'availableQuantity')::numeric <> 60
    or v_construction_candidate ->> 'sourceStatus' <> 'approved' then
    raise exception 'TASK6_CONSTRUCTION_SOURCE_INVALID: %', v_construction_candidate;
  end if;
  v_result := public.save_project_v2_plan_v1(v_ids.workspace_id, null, null,
    'task6-construction-save', 'construction', 'C-T6', 'Thi công thử nghiệm',
    date '2026-09-01', date '2026-09-07', jsonb_build_array(jsonb_build_object(
      'workItemId', v_ids.contract_item_id::text, 'unit', 'm3', 'quantity', '40.000000',
      'workStart', '2026-09-02', 'workEnd', '2026-09-05', 'crewId', v_ids.crew_id,
      'sources', jsonb_build_array(jsonb_build_object(
        'sourcePlanId', v_construction_candidate ->> 'sourcePlanId',
        'sourceRevision', (v_construction_candidate ->> 'sourceRevision')::integer,
        'sourcePlanHash', v_construction_candidate ->> 'sourcePlanHash',
        'sourceLineId', v_construction_candidate ->> 'sourceLineId',
        'sourceQuantity', '40.000000')))));
  v_construction_id := (v_result ->> 'planId')::uuid;
  perform public.submit_project_v2_plan_v1(v_construction_id, 1, 'task6-construction-submit', '');
  if (public.list_project_v2_source_candidates_v1(v_ids.workspace_id, 'construction')
      -> 'items' -> 0 ->> 'availableQuantity')::numeric <> 20 then
    raise exception 'TASK6_RESERVATION_NOT_SUBTRACTED';
  end if;
  perform set_config('request.jwt.claims', '{"email":"project-v2-task6-reviewer@example.invalid"}', true);
  perform public.approve_project_v2_plan_v1(v_construction_id, 2, 'task6-construction-approve');
  perform set_config('request.jwt.claims', '{"email":"project-v2-task6-admin@example.invalid"}', true);
  perform public.create_project_v2_plan_revision_v1(v_construction_id, 3, 'task6-construction-revise');
  v_result := public.save_project_v2_plan_v1(v_ids.workspace_id, v_construction_id, 4,
    'task6-construction-revision-save', 'construction', 'C-T6', 'Thi công điều chỉnh',
    date '2026-09-01', date '2026-09-07', jsonb_build_array(jsonb_build_object(
      'workItemId', v_ids.contract_item_id::text, 'unit', 'm3', 'quantity', '20.000000',
      'workStart', '2026-09-02', 'workEnd', '2026-09-05', 'crewId', v_ids.crew_id,
      'sources', jsonb_build_array(jsonb_build_object(
        'sourcePlanId', v_construction_candidate ->> 'sourcePlanId',
        'sourceRevision', (v_construction_candidate ->> 'sourceRevision')::integer,
        'sourcePlanHash', v_construction_candidate ->> 'sourcePlanHash',
        'sourceLineId', v_construction_candidate ->> 'sourceLineId',
        'sourceQuantity', '20.000000')))));
  perform public.submit_project_v2_plan_v1(v_construction_id, 5, 'task6-construction-revision-submit', '');
  if (public.list_project_v2_source_candidates_v1(v_ids.workspace_id, 'construction')
      -> 'items' -> 0 ->> 'availableQuantity')::numeric <> 20 then
    raise exception 'TASK6_REVISION_DOUBLE_RESERVED';
  end if;
  begin
    perform public.save_project_v2_plan_v1(v_ids.workspace_id, null, null,
      'task6-bad-crew', 'construction', 'C-BAD-CREW', 'Bad crew',
      date '2026-09-01', date '2026-09-07', jsonb_build_array(jsonb_build_object(
        'workItemId', v_ids.contract_item_id::text, 'unit', 'm3', 'quantity', '1.000000',
        'workStart', '2026-09-02', 'workEnd', '2026-09-05', 'crewId', gen_random_uuid())));
    raise exception 'TASK6_CROSS_WORKSPACE_CREW_ACCEPTED';
  exception when sqlstate '42501' then null;
  end;
  v_result := public.save_project_v2_plan_v1(v_ids.workspace_id, null, null,
    'task6-exception-save', 'construction', 'C-EXCEPTION', 'Ngoại lệ baseline',
    date '2026-09-01', date '2026-09-07', jsonb_build_array(jsonb_build_object(
      'workItemId', v_ids.contract_item_id::text,
      'baselineRevision', v_month_candidate ->> 'baselineRevision',
      'baselineExceptionReason', 'Thi công trước lịch tháng',
      'unit', 'm3', 'quantity', '10.000000',
      'workStart', '2026-09-02', 'workEnd', '2026-09-05', 'crewId', v_ids.crew_id,
      'sources', '[]'::jsonb)));
  v_exception_id := (v_result ->> 'planId')::uuid;
  v_result := public.submit_project_v2_plan_v1(v_exception_id, 1, 'task6-exception-submit', '');
  if v_result ->> 'status' <> 'pending_approval' then raise exception 'TASK6_EXCEPTION_NOT_PENDING'; end if;
  if jsonb_array_length(public.get_project_v2_plan_discussion_v1(v_exception_id) -> 'events') < 2 then
    raise exception 'TASK6_DISCUSSION_EVENTS_MISSING';
  end if;
end $$;

rollback;
