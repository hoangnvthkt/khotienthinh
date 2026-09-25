-- Run only on an approved Supabase Cloud preview branch, as postgres.
-- This fixture owns its rows and always rolls them back.
begin;

create temp table project_v2_smoke_ids on commit drop as
select gen_random_uuid() admin_id, gen_random_uuid() reviewer_id,
  gen_random_uuid() outsider_id, gen_random_uuid() workspace_id,
  gen_random_uuid() month_plan_id, gen_random_uuid() construction_plan_id,
  gen_random_uuid() material_plan_id, gen_random_uuid() month_line_id,
  gen_random_uuid() command_month_line_id,
  gen_random_uuid() construction_line_id, gen_random_uuid() material_line_id,
  ('project-v2-smoke-' || gen_random_uuid()::text) project_id;

insert into public.users(id, name, email, username, role)
select admin_id, 'Project V2 smoke admin', 'project-v2-smoke-admin@example.invalid',
  'project-v2-smoke-admin-' || left(admin_id::text, 8), 'ADMIN' from project_v2_smoke_ids;
insert into public.users(id, name, email, username, role)
select reviewer_id, 'Project V2 smoke reviewer', 'project-v2-smoke-reviewer@example.invalid',
  'project-v2-smoke-reviewer-' || left(reviewer_id::text, 8), 'EMPLOYEE' from project_v2_smoke_ids;
insert into public.users(id, name, email, username, role)
select outsider_id, 'Project V2 smoke outsider', 'project-v2-smoke-outsider@example.invalid',
  'project-v2-smoke-outsider-' || left(outsider_id::text, 8), 'EMPLOYEE' from project_v2_smoke_ids;
insert into public.projects(id, code, name)
select project_id, 'PV2-' || left(admin_id::text, 8), 'Project V2 smoke' from project_v2_smoke_ids;
insert into public.items(id, sku, name, category, unit, price_in, price_out, min_stock)
select 'project-v2-smoke-item-' || left(admin_id::text, 8),
  'PV2-SMOKE-' || left(admin_id::text, 8), 'Project V2 smoke material',
  'material', 'kg', 0, 0, 0 from project_v2_smoke_ids;

create temp table project_v2_smoke_before on commit drop as
select (select count(*) from public.projects) project_count,
  (select count(*) from public.purchase_orders) purchase_order_count,
  (select count(*) from public.inventory_transactions) inventory_transaction_count,
  (select count(*) from public.procurement_demands) procurement_demand_count;

select set_config('request.jwt.claims', '{"email":"project-v2-smoke-admin@example.invalid"}', true);

do $$
declare v_result jsonb;
begin
  select public.activate_project_v2_workspace_v1(project_id, null, 'activate-1')
  into v_result from project_v2_smoke_ids;
  if v_result ->> 'lifecycle' <> 'pilot' then raise exception 'PROJECT_V2_ACTIVATION_FAILED'; end if;
  select public.activate_project_v2_workspace_v1(project_id, null, 'activate-1')
  into v_result from project_v2_smoke_ids;
  if (select count(*) from public.project_v2_workspaces w
      join project_v2_smoke_ids ids on ids.project_id = w.project_id) <> 1 then
    raise exception 'PROJECT_V2_ACTIVATION_NOT_REPEAT_SAFE';
  end if;
  if jsonb_array_length(public.list_project_v2_workspaces_v1() -> 'workspaces') <> 1 then
    raise exception 'PROJECT_V2_WORKSPACE_READ_FAILED';
  end if;
  if not ((public.list_project_v2_cohort_ids_v1(null) -> 'projectIds')
    ? (select project_id from project_v2_smoke_ids)) then
    raise exception 'PROJECT_V2_VISIBLE_COHORT_MISSING';
  end if;
end $$;

select set_config('request.jwt.claims', '{"email":"project-v2-smoke-outsider@example.invalid"}', true);
do $$
declare v_project_id text := (select project_id from project_v2_smoke_ids);
begin
  if public.list_project_v2_cohort_ids_v1(null) -> 'projectIds' <> '[]'::jsonb
    or public.list_project_v2_cohort_ids_v1(array[v_project_id]) -> 'projectIds' <> '[]'::jsonb then
    raise exception 'PROJECT_V2_COHORT_ID_DISCLOSED_TO_OUTSIDER';
  end if;
end $$;
select set_config('request.jwt.claims', '{"email":"project-v2-smoke-admin@example.invalid"}', true);

insert into public.project_v2_plans(id, workspace_id, plan_type, code, title, status,
  period_start, period_end, creator_user_id, approver_user_id, approved_at, content_hash)
select month_plan_id, w.id, 'month', 'M-1', 'Month source', 'approved',
  date '2026-10-01', date '2026-10-31', admin_id, reviewer_id, now(), 'month-hash'
from project_v2_smoke_ids ids join public.project_v2_workspaces w on w.project_id = ids.project_id;

insert into public.project_v2_plan_revisions(plan_id, revision_no, content_hash, approved_snapshot, approved_by)
select month_plan_id, 1, 'month-hash', '{}'::jsonb, reviewer_id from project_v2_smoke_ids;
update public.project_v2_plans p set effective_revision_no = 1
from project_v2_smoke_ids ids where p.id = ids.month_plan_id;

insert into public.project_v2_plan_lines(id, plan_id, revision_no, plan_type,
  baseline_revision, unit, quantity)
select month_line_id, month_plan_id, 1, 'month', 'baseline-smoke', 'm3', 12.500001
from project_v2_smoke_ids;
insert into public.project_v2_plan_lines(id, plan_id, revision_no, plan_type,
  baseline_revision, unit, quantity)
select command_month_line_id, month_plan_id, 1, 'month', 'baseline-command', 'm3', 100.000000
from project_v2_smoke_ids;

insert into public.project_v2_plans(id, workspace_id, plan_type, code, title, status,
  period_start, period_end, creator_user_id, approver_user_id, approved_at, content_hash)
select construction_plan_id, w.id, 'construction', 'C-1', 'Construction', 'approved',
  date '2026-10-01', date '2026-10-07', admin_id, reviewer_id, now(), 'construction-hash'
from project_v2_smoke_ids ids join public.project_v2_workspaces w on w.project_id = ids.project_id;
insert into public.project_v2_plan_revisions(plan_id, revision_no, content_hash, approved_snapshot, approved_by)
select construction_plan_id, 1, 'construction-hash', '{}'::jsonb, reviewer_id from project_v2_smoke_ids;
update public.project_v2_plans p set effective_revision_no = 1
from project_v2_smoke_ids ids where p.id = ids.construction_plan_id;
insert into public.project_v2_plan_lines(id, plan_id, revision_no, plan_type,
  work_item_id, unit, quantity, work_start, work_end)
select construction_line_id, construction_plan_id, 1, 'construction',
  'work-smoke', 'm3', 12.500001, date '2026-10-01', date '2026-10-07'
from project_v2_smoke_ids;
insert into public.project_v2_plan_line_sources(target_line_id, source_plan_id,
  source_plan_revision_no, source_plan_line_id, source_plan_hash, source_work_quantity, source_unit)
select construction_line_id, month_plan_id, 1, month_line_id, 'month-hash', 12.500001, 'm3'
from project_v2_smoke_ids;

insert into public.project_v2_plans(id, workspace_id, plan_type, code, title, status,
  period_start, period_end, creator_user_id)
select material_plan_id, w.id, 'material', 'V-1', 'Material', 'draft',
  date '2026-10-01', date '2026-10-31', admin_id
from project_v2_smoke_ids ids join public.project_v2_workspaces w on w.project_id = ids.project_id;
insert into public.project_v2_plan_lines(id, plan_id, revision_no, plan_type,
  inventory_item_id, unit, quantity, needed_date, destination_id)
select material_line_id, material_plan_id, 1, 'material',
  'project-v2-smoke-item-' || left(admin_id::text, 8), 'kg',
  100.000008, date '2026-10-08', 'site-smoke' from project_v2_smoke_ids;
insert into public.project_v2_plan_line_sources(target_line_id, source_plan_id,
  source_plan_revision_no, source_plan_line_id, source_plan_hash, source_work_quantity,
  source_unit, norm_resource_id, norm_revision, norm_factor, coefficient,
  conversion_numerator, conversion_denominator, derived_quantity)
select material_line_id, construction_plan_id, 1, construction_line_id, 'construction-hash', 12.500001,
  'm3', 'norm-smoke', '1', 8.000000, 1.000000, 1.000000, 1.000000, 100.000008
from project_v2_smoke_ids;

do $$
declare v_detail jsonb;
begin
  select public.get_project_v2_plan_v1(construction_plan_id) into v_detail from project_v2_smoke_ids;
  if v_detail -> 'sources' -> 0 ->> 'source_plan_revision_no' <> '1'
    or v_detail -> 'sources' -> 0 ->> 'source_plan_line_id' is null then
    raise exception 'PROJECT_V2_LINEAGE_LOST';
  end if;
  if (select quantity from public.project_v2_plan_lines l
    join project_v2_smoke_ids ids on ids.month_line_id = l.id) <> 12.500001 then
    raise exception 'PROJECT_V2_QUANTITY_PRECISION_LOST';
  end if;
  begin
    update public.project_v2_plan_revisions r set content_hash = 'changed'
    from project_v2_smoke_ids ids where r.plan_id = ids.month_plan_id;
    raise exception 'PROJECT_V2_REVISION_UPDATE_ALLOWED';
  exception when sqlstate '23514' then null;
  end;
  begin
    delete from public.project_v2_plan_revisions r using project_v2_smoke_ids ids
    where r.plan_id = ids.month_plan_id;
    raise exception 'PROJECT_V2_REVISION_DELETE_ALLOWED';
  exception when sqlstate '23514' then null;
  end;
end $$;

-- Command path: only the session actor writes audit metadata; an independent
-- reviewer approves. The source is an exact approved month revision/line.
do $$
declare
  v_ids record;
  v_result jsonb;
  v_plan_id uuid;
begin
  select * into v_ids from project_v2_smoke_ids;
  update public.users set role = 'ADMIN' where id = v_ids.reviewer_id;
  select public.save_project_v2_plan_v1(w.id, null, null, 'smoke-save-1',
    'construction', 'C-COMMAND', 'Command construction', date '2026-10-01',
    date '2026-10-07', jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'workItemId', 'work-smoke-command',
      'unit', 'm3', 'quantity', '10.000000', 'workStart', '2026-10-01',
      'workEnd', '2026-10-07', 'sources', jsonb_build_array(jsonb_build_object(
        'sourcePlanId', v_ids.month_plan_id, 'sourceRevision', 1,
        'sourceLineId', v_ids.command_month_line_id, 'sourcePlanHash', 'month-hash',
        'sourceQuantity', '10.000000', 'sourceUnit', 'm3')))))
  into v_result from public.project_v2_workspaces w where w.project_id = v_ids.project_id;
  v_plan_id := (v_result ->> 'planId')::uuid;
  if v_plan_id is null or v_result ->> 'status' <> 'draft' then
    raise exception 'PROJECT_V2_SAVE_FAILED';
  end if;
  v_result := public.submit_project_v2_plan_v1(v_plan_id, 1, 'smoke-submit-1', 'Đủ hồ sơ');
  if v_result ->> 'status' <> 'pending_approval' then
    raise exception 'PROJECT_V2_SUBMIT_FAILED';
  end if;
  begin
    perform public.approve_project_v2_plan_v1(v_plan_id, 2, 'smoke-approve-self');
    raise exception 'PROJECT_V2_SELF_APPROVAL_ALLOWED';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims',
    '{"email":"project-v2-smoke-reviewer@example.invalid"}', true);
  v_result := public.approve_project_v2_plan_v1(v_plan_id, 2, 'smoke-approve-1');
  if v_result ->> 'status' <> 'approved'
    or (select count(*) from public.project_v2_plan_revisions where plan_id = v_plan_id) <> 1 then
    raise exception 'PROJECT_V2_APPROVAL_FAILED';
  end if;
  v_result := public.approve_project_v2_plan_v1(v_plan_id, 2, 'smoke-approve-1');
  if v_result ->> 'planId' <> v_plan_id::text then
    raise exception 'PROJECT_V2_IDEMPOTENT_REPLAY_FAILED';
  end if;
  begin
    perform public.approve_project_v2_plan_v1(v_plan_id, 999, 'smoke-approve-1');
    raise exception 'PROJECT_V2_IDEMPOTENCY_PAYLOAD_CHANGE_ALLOWED';
  exception when unique_violation then null;
  end;
  begin
    perform public.create_project_v2_plan_revision_v1(v_plan_id, 2, 'smoke-revise-stale');
    raise exception 'PROJECT_V2_STALE_VERSION_ALLOWED';
  exception when serialization_failure then null;
  end;
  perform set_config('request.jwt.claims',
    '{"email":"project-v2-smoke-admin@example.invalid"}', true);
  v_result := public.create_project_v2_plan_revision_v1(v_plan_id, 3, 'smoke-revise-1');
  if v_result ->> 'status' <> 'draft'
    or (v_result ->> 'revision')::integer <> 2
    or (select effective_revision_no from public.project_v2_plans where id = v_plan_id) <> 1
    or (select count(*) from public.project_v2_plan_line_sources s
      join public.project_v2_plan_lines l on l.id = s.target_line_id
      where l.plan_id = v_plan_id and l.revision_no = 2) <> 1 then
    raise exception 'PROJECT_V2_REVISION_LINEAGE_LOST';
  end if;
end $$;

-- Direct authenticated DML is forbidden even for a valid account.
set local role authenticated;
do $$
begin
  begin
    insert into public.project_v2_plans(workspace_id, plan_type, code, title,
      period_start, period_end, creator_user_id)
    values (gen_random_uuid(), 'month', 'forbidden', 'Forbidden', current_date,
      current_date, gen_random_uuid());
    raise exception 'PROJECT_V2_DIRECT_DML_ALLOWED';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select set_config('request.jwt.claims', '{"email":"project-v2-smoke-outsider@example.invalid"}', true);
do $$
begin
  begin
    perform public.get_project_v2_plan_v1(month_plan_id) from project_v2_smoke_ids;
    raise exception 'PROJECT_V2_CROSS_PROJECT_READ_ALLOWED';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('app.account_lifecycle_command', 'on', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
update public.users set is_active = false, account_status = 'DISABLED'
where email = 'project-v2-smoke-outsider@example.invalid';
select set_config('app.account_lifecycle_command', '', true);
select set_config('request.jwt.claims', '{"email":"project-v2-smoke-outsider@example.invalid"}', true);
do $$
begin
  begin
    perform public.get_project_v2_plan_v1(month_plan_id) from project_v2_smoke_ids;
    raise exception 'PROJECT_V2_INACTIVE_READ_ALLOWED';
  exception when insufficient_privilege then null;
  end;
end $$;

do $$
begin
  if exists (select 1 from project_v2_smoke_before b
    where b.project_count <> (select count(*) from public.projects)
      or b.purchase_order_count <> (select count(*) from public.purchase_orders)
      or b.inventory_transaction_count <> (select count(*) from public.inventory_transactions)
      or b.procurement_demand_count <> (select count(*) from public.procurement_demands)) then
    raise exception 'PROJECT_V2_FOUNDATION_MUTATED_DOWNSTREAM';
  end if;
end $$;

-- The transaction is rolled back: no project, PO, inventory or finance row persists.
rollback;
