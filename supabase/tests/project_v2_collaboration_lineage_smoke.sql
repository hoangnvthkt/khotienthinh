-- Rollback-only Cloud preview smoke for guarded collaboration and exact lineage.
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
end $$;

insert into public.project_v2_plans(id, workspace_id, plan_type, code, title, status,
  period_start, period_end, creator_user_id, approver_user_id, approved_at, content_hash)
select month_plan_id, w.id, 'month', 'M-1', 'Month source', 'approved',
  date '2026-10-01', date '2026-10-31', admin_id, reviewer_id, now(), 'month-hash'
from project_v2_smoke_ids ids join public.project_v2_workspaces w on w.project_id = ids.project_id;

insert into public.project_v2_plan_revisions(plan_id, revision_no, content_hash, approved_snapshot, approved_by)
select ids.month_plan_id, 1, 'month-hash', jsonb_build_object('plan',to_jsonb(p)), ids.reviewer_id
from project_v2_smoke_ids ids join public.project_v2_plans p on p.id=ids.month_plan_id;
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
insert into public.project_v2_plan_comments(plan_id,revision_no,author_user_id,body,created_at)
select month_plan_id,1,reviewer_id,'Bản cũ, đã rà soát',now()-interval '2 days'
from project_v2_smoke_ids;
insert into public.project_v2_plan_comments(plan_id,revision_no,author_user_id,body,created_at)
select month_plan_id,1,reviewer_id,'Cần đối chiếu, dòng 2',now()-interval '1 day'
from project_v2_smoke_ids;
insert into public.project_v2_plan_events(plan_id,revision_no,event_type,actor_user_id,
  reason,payload,occurred_at)
select month_plan_id,1,'approved',reviewer_id,'Đã xác nhận','{"source":"server"}'::jsonb,
  now()-interval '1 day' from project_v2_smoke_ids;

update public.project_v2_plans p set title='Month source revised'
from project_v2_smoke_ids ids where p.id=ids.month_plan_id;

do $$
declare ids project_v2_smoke_ids%rowtype := (select t from project_v2_smoke_ids t);
  page jsonb; older jsonb; history jsonb; sources jsonb; downstream jsonb;
  comment_result jsonb;
begin
  comment_result := public.add_project_v2_plan_comment_v1(ids.month_plan_id,1,
    'task12-comment-'||ids.month_plan_id::text,'Đã kiểm tra nguồn');
  if not exists(select 1 from public.project_v2_plan_comments
    where plan_id=ids.month_plan_id and body='Đã kiểm tra nguồn'
      and author_user_id=ids.admin_id) then
    raise exception 'TASK12_SERVER_ACTOR_NOT_PERSISTED';
  end if;
  page := public.list_project_v2_plan_collaboration_v1(ids.month_plan_id,'comments',2);
  if jsonb_array_length(page->'items')<>2 or page->'nextCursor'='null'::jsonb
    or page #>> '{items,0,authorUserId}' is null
    or page #>> '{items,0,createdAt}' is null then
    raise exception 'TASK12_COMMENT_PAGE_INVALID: %',page;
  end if;
  older := public.list_project_v2_plan_collaboration_v1(ids.month_plan_id,'comments',2,
    (page #>> '{nextCursor,at}')::timestamptz,
    (page #>> '{nextCursor,id}')::uuid);
  if jsonb_array_length(older->'items')<>1 or older->'nextCursor'<>'null'::jsonb then
    raise exception 'TASK12_COMMENT_CURSOR_INVALID: %',older;
  end if;
  history := public.list_project_v2_plan_collaboration_v1(ids.month_plan_id,'events',10);
  if not exists(select 1 from jsonb_array_elements(history->'items') event(value)
    where event.value->>'eventType'='approved'
      and event.value->'metadata'='{"source":"server"}'::jsonb) then
    raise exception 'TASK12_TYPED_ACTIVITY_MISSING: %',history;
  end if;
  sources := public.get_project_v2_plan_lineage_v1(ids.construction_plan_id,1);
  downstream := public.get_project_v2_plan_lineage_v1(ids.month_plan_id,1);
  if sources #>> '{sources,0,id}'<>ids.month_plan_id::text
    or sources #>> '{sources,0,revision}'<>'1'
    or downstream #>> '{downstream,0,id}'<>ids.construction_plan_id::text then
    raise exception 'TASK12_BIDIRECTIONAL_LINEAGE_INVALID: %, %',sources,downstream;
  end if;
  history := public.get_project_v2_plan_revision_v1(ids.month_plan_id,1);
  if history #>> '{plan,revision_no}'<>'1'
    or history #>> '{plan,status}'<>'approved'
    or history #>> '{plan,title}'<>'Month source'
    or jsonb_array_length(history->'lines')<>2
    or history #>> '{historical}'<>'true' then
    raise exception 'TASK12_EXACT_APPROVED_REVISION_INVALID: %',history;
  end if;
  if app_private.project_v2_link_payload_v1(ids.month_plan_id,1,ids.outsider_id)
    <> '{"canOpen":false}'::jsonb then
    raise exception 'TASK12_PROTECTED_REFERENCE_LEAK';
  end if;
  perform set_config('request.jwt.claims',
    '{"email":"project-v2-smoke-outsider@example.invalid"}',true);
  begin
    perform public.list_project_v2_plan_collaboration_v1(ids.month_plan_id,'comments',10);
    raise exception 'TASK12_DENIED_HISTORY_EXPOSED';
  exception when insufficient_privilege then
    if sqlerrm<>'PROJECT_V2_COMMAND_DENIED' and sqlerrm<>'PROJECT_V2_READ_DENIED' then raise; end if;
  end;
end $$;
rollback;
