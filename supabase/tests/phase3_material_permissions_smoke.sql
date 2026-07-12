-- Phase 3.3 Material permission behavior smoke.
-- Run transactionally after Phase 1, Phase 2, Phase 3 surface/org, and Daily Log migrations.

begin;

do $$
declare
  required_codes text[] := array[
    'project.material_request.view',
    'project.material_request.create',
    'project.material_request.edit_own',
    'project.material_request.edit_all',
    'project.material_request.submit',
    'project.material_request.return',
    'project.material_request.approve',
    'project.material_request.confirm_fulfillment',
    'project.material_request.view_available_stock',
    'project.material_boq.edit',
    'project.material_plan.edit',
    'project.material_po.create',
    'project.material_po.approve',
    'project.material_po.receive',
    'project.custom_material.create',
    'project.custom_material.approve',
    'project.material_waste.record',
    'project.material_waste.approve'
  ];
  v_permission_code text;
begin
  foreach v_permission_code in array required_codes loop
    if not exists (
      select 1
      from public.permission_actions pa
      where pa.permission_code = v_permission_code
        and coalesce(pa.is_active, true)
    ) then
      raise exception 'Missing Phase 3 Material permission action: %', v_permission_code;
    end if;
  end loop;

  if to_regprocedure('public.transition_project_material_request_status(text,text,text,text,text,text,text,jsonb)') is null then
    raise exception 'Missing transition_project_material_request_status RPC';
  end if;
  if to_regprocedure('public.transition_project_purchase_order_status(text,text,jsonb)') is null then
    raise exception 'Missing transition_project_purchase_order_status RPC';
  end if;
  if to_regprocedure('public.transition_custom_material_request_status(uuid,text,uuid,text)') is null then
    raise exception 'Missing transition_custom_material_request_status RPC';
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants g
    where g.table_schema = 'public'
      and g.table_name in ('requests', 'project_material_requests', 'purchase_orders', 'custom_material_requests')
      and g.grantee = 'anon'
      and g.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'anon still has Material table privileges';
  end if;
end $$;

create temp table phase3_material_smoke_ids (
  project_id text not null,
  no_staff_project_id text not null,
  site_id text not null,
  warehouse_id text not null,
  position_id uuid not null,
  viewer_id uuid not null,
  creator_id uuid not null,
  submitter_id uuid not null,
  approver_id uuid not null,
  fulfiller_id uuid not null,
  po_creator_id uuid not null,
  po_approver_id uuid not null,
  po_receiver_id uuid not null,
  custom_creator_id uuid not null,
  custom_approver_id uuid not null,
  nogrant_id uuid not null
) on commit drop;

grant select, insert, update, delete on table phase3_material_smoke_ids to authenticated;

insert into phase3_material_smoke_ids
values (
  'phase3-material-smoke-' || gen_random_uuid()::text,
  'phase3-material-nostaff-' || gen_random_uuid()::text,
  'phase3-material-site-' || gen_random_uuid()::text,
  'phase3-material-wh-' || gen_random_uuid()::text,
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid()
);

insert into public.users (id, name, email, username, role, is_active, allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules)
select user_id, label, user_id::text || '@vioo.local', label, 'EMPLOYEE'::public.user_role, true, '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase3_material_smoke_ids s
cross join lateral (
  values
    (s.viewer_id, 'phase3-material-viewer'),
    (s.creator_id, 'phase3-material-creator'),
    (s.submitter_id, 'phase3-material-submitter'),
    (s.approver_id, 'phase3-material-approver'),
    (s.fulfiller_id, 'phase3-material-fulfiller'),
    (s.po_creator_id, 'phase3-material-po-creator'),
    (s.po_approver_id, 'phase3-material-po-approver'),
    (s.po_receiver_id, 'phase3-material-po-receiver'),
    (s.custom_creator_id, 'phase3-material-custom-creator'),
    (s.custom_approver_id, 'phase3-material-custom-approver'),
    (s.nogrant_id, 'phase3-material-nogrant')
) as u(user_id, label);

insert into public.projects (id, code, name, source)
select project_id, 'PHASE3-MAT', 'Phase 3 Material Smoke', 'manual'
from phase3_material_smoke_ids
union all
select no_staff_project_id, 'PHASE3-MAT-NOSTAFF', 'Phase 3 Material No Staff Smoke', 'manual'
from phase3_material_smoke_ids;

insert into public.hrm_positions (id, name, level, code, is_active, sort_order, source, metadata)
select position_id, 'Phase 3 Material Smoke Position', 1, 'PHASE3-MAT', true, 0, 'smoke', '{"phase":"3.3","slice":"material"}'::jsonb
from phase3_material_smoke_ids;

insert into public.warehouses (id, name, address, type)
select warehouse_id, 'Phase 3 Material Smoke Warehouse', 'Smoke address', 'SITE'
from phase3_material_smoke_ids;

insert into public.project_staff (project_id, construction_site_id, user_id, position_id, start_date)
select s.project_id, s.site_id, u.user_id::text, s.position_id, current_date
from phase3_material_smoke_ids s
cross join lateral (
  values
    (s.viewer_id),
    (s.creator_id),
    (s.submitter_id),
    (s.approver_id),
    (s.fulfiller_id),
    (s.po_creator_id),
    (s.po_approver_id),
    (s.po_receiver_id),
    (s.custom_creator_id),
    (s.custom_approver_id),
    (s.nogrant_id)
) as u(user_id);

insert into public.user_permission_grants (user_id, permission_code, scope_type, scope_id, is_active)
select viewer_id, 'project.material_request.view', 'project', project_id, true from phase3_material_smoke_ids
union all select creator_id, 'project.material_request.create', 'project', project_id, true from phase3_material_smoke_ids
union all select submitter_id, 'project.material_request.create', 'project', project_id, true from phase3_material_smoke_ids
union all select submitter_id, 'project.material_request.edit_own', 'project', project_id, true from phase3_material_smoke_ids
union all select submitter_id, 'project.material_request.submit', 'project', project_id, true from phase3_material_smoke_ids
union all select approver_id, 'project.material_request.approve', 'project', project_id, true from phase3_material_smoke_ids
union all select fulfiller_id, 'project.material_request.confirm_fulfillment', 'project', project_id, true from phase3_material_smoke_ids
union all select po_creator_id, 'project.material_po.create', 'project', project_id, true from phase3_material_smoke_ids
union all select po_approver_id, 'project.material_po.approve', 'project', project_id, true from phase3_material_smoke_ids
union all select po_receiver_id, 'project.material_po.receive', 'project', project_id, true from phase3_material_smoke_ids
union all select custom_creator_id, 'project.custom_material.create', 'project', project_id, true from phase3_material_smoke_ids
union all select custom_approver_id, 'project.custom_material.approve', 'project', project_id, true from phase3_material_smoke_ids;

insert into app_private.material_request_code_registry(code)
values
  ('MR-2026-9301'),
  ('MR-2026-9302'),
  ('MR-2026-9303'),
  ('MR-2026-9304')
on conflict (code) do nothing;

insert into app_private.purchase_order_number_registry(po_number)
values
  ('PO-20269301'),
  ('PO-20269302')
on conflict (po_number) do nothing;

insert into public.requests(
  id, code, site_warehouse_id, requester_id, status, items,
  created_date, expected_date, project_id, construction_site_id,
  request_origin, workflow_step, submitted_to_user_id
)
select 'phase3-mat-submit-ok', 'MR-2026-9301', warehouse_id, submitter_id, 'DRAFT'::public.request_status, '[]'::jsonb,
       now(), now() + interval '1 day', project_id, site_id, 'project', 'draft', null
from phase3_material_smoke_ids
union all
select 'phase3-mat-create-only', 'MR-2026-9302', warehouse_id, creator_id, 'DRAFT'::public.request_status, '[]'::jsonb,
       now(), now() + interval '1 day', project_id, site_id, 'project', 'draft', null
from phase3_material_smoke_ids
union all
select 'phase3-mat-approve-ok', 'MR-2026-9303', warehouse_id, submitter_id, 'PENDING'::public.request_status, '[]'::jsonb,
       now(), now() + interval '1 day', project_id, site_id, 'project', 'site_manager_review', approver_id::text
from phase3_material_smoke_ids;

insert into public.purchase_orders(
  id, project_id, construction_site_id, vendor_id, vendor_name, po_number, items,
  total_amount, order_date, status, source_mode, target_warehouse_id, created_by_id, created_at
)
select 'phase3-po-approve', project_id, site_id, 'phase3-vendor', 'NCC Smoke', 'PO-20269301', '[]'::jsonb,
       0, current_date::text, 'draft', 'proactive_project', warehouse_id, po_creator_id::text, now()
from phase3_material_smoke_ids
union all
select 'phase3-po-receive', project_id, site_id, 'phase3-vendor', 'NCC Smoke', 'PO-20269302', '[]'::jsonb,
       0, current_date::text, 'confirmed', 'proactive_project', warehouse_id, po_creator_id::text, now()
from phase3_material_smoke_ids;

insert into public.custom_material_requests (
  id, code, title, project_id, construction_site_id, status, created_by, updated_by
)
select '11111111-1111-4111-8111-111111111111'::uuid, 'PHASE3-CMR-APPROVE', 'Phase 3 CMR', project_id, site_id, 'submitted', custom_creator_id, custom_creator_id
from phase3_material_smoke_ids;

set role authenticated;

create or replace function pg_temp.phase3_material_smoke_set_user(p_user_id uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claim.email', p_user_id::text || '@vioo.local', true);
  select set_config('request.jwt.claim.sub', p_user_id::text, true);
  select set_config(
    'request.jwt.claims',
    jsonb_build_object('email', p_user_id::text || '@vioo.local', 'sub', p_user_id::text)::text,
    true
  );
$$;

select pg_temp.phase3_material_smoke_set_user(viewer_id)
from phase3_material_smoke_ids;

do $$
begin
  begin
    insert into public.requests(id, code, site_warehouse_id, requester_id, status, items, created_date, expected_date, project_id, construction_site_id, request_origin, workflow_step)
    select 'phase3-viewer-create-deny', 'MR-2026-9304', warehouse_id, viewer_id, 'DRAFT'::public.request_status, '[]'::jsonb, now(), now(), project_id, site_id, 'project', 'draft'
    from phase3_material_smoke_ids;
    raise exception 'project.material_request.view incorrectly allowed create';
  exception
    when insufficient_privilege then null;
  end;
end $$;

select pg_temp.phase3_material_smoke_set_user(creator_id)
from phase3_material_smoke_ids;

do $$
begin
  begin
    perform public.transition_project_material_request_status(
      'phase3-mat-create-only',
      'PENDING',
      'SUBMITTED',
      (select creator_id::text from phase3_material_smoke_ids),
      (select approver_id::text from phase3_material_smoke_ids),
      'project.material_request.approve',
      null,
      jsonb_build_object('status','PENDING','logs','[]'::jsonb,'ever_submitted',true,'workflow_step','site_manager_review','submitted_to_user_id',(select approver_id::text from phase3_material_smoke_ids))
    );
    raise exception 'project.material_request.create incorrectly allowed submit';
  exception
    when insufficient_privilege then null;
  end;
end $$;

select pg_temp.phase3_material_smoke_set_user(submitter_id)
from phase3_material_smoke_ids;

select public.transition_project_material_request_status(
  'phase3-mat-submit-ok',
  'PENDING',
  'SUBMITTED',
  submitter_id::text,
  approver_id::text,
  'project.material_request.approve',
  null,
  jsonb_build_object(
    'status','PENDING',
    'logs','[]'::jsonb,
    'ever_submitted',true,
    'last_action_by',submitter_id::text,
    'last_action_at',now(),
    'workflow_step','site_manager_review',
    'submitted_to_user_id',approver_id::text,
    'submitted_to_permission','project.material_request.approve'
  )
)
from phase3_material_smoke_ids;

select pg_temp.phase3_material_smoke_set_user(approver_id)
from phase3_material_smoke_ids;

select public.transition_project_material_request_status(
  'phase3-mat-approve-ok',
  'APPROVED',
  'APPROVED',
  approver_id::text,
  fulfiller_id::text,
  'project.material_request.confirm_fulfillment',
  null,
  jsonb_build_object(
    'status','APPROVED',
    'logs','[]'::jsonb,
    'last_action_by',approver_id::text,
    'last_action_at',now(),
    'workflow_step','batch_planning',
    'submitted_to_user_id',fulfiller_id::text,
    'submitted_to_permission','project.material_request.confirm_fulfillment'
  )
)
from phase3_material_smoke_ids;

select pg_temp.phase3_material_smoke_set_user(po_approver_id)
from phase3_material_smoke_ids;

do $$
declare
  v_blocked boolean := false;
  v_updated integer := 0;
begin
  begin
    update public.purchase_orders
    set status = 'confirmed'
    where id = 'phase3-po-approve';
    get diagnostics v_updated = row_count;
  exception
    when others then
      v_blocked := true;
  end;
  if not v_blocked and v_updated > 0 then
    raise exception 'Direct PO status update was not blocked';
  end if;
end $$;

select public.transition_project_purchase_order_status(
  'phase3-po-approve',
  'confirmed',
  jsonb_build_object('status','confirmed')
);

do $$
begin
  begin
    select public.transition_project_purchase_order_status(
      'phase3-po-receive',
      'delivered',
      jsonb_build_object('status','delivered','received_transaction_ids',jsonb_build_array('phase3-tx'))
    );
    raise exception 'project.material_po.approve incorrectly allowed receive';
  exception
    when insufficient_privilege then null;
  end;
end $$;

select pg_temp.phase3_material_smoke_set_user(po_receiver_id)
from phase3_material_smoke_ids;

select public.transition_project_purchase_order_status(
  'phase3-po-receive',
  'delivered',
  jsonb_build_object('status','delivered','received_transaction_ids',jsonb_build_array('phase3-tx'))
);

select pg_temp.phase3_material_smoke_set_user(custom_approver_id)
from phase3_material_smoke_ids;

do $$
declare
  v_blocked boolean := false;
  v_updated integer := 0;
begin
  begin
    update public.custom_material_requests
    set status = 'approved'
    where id = '11111111-1111-4111-8111-111111111111'::uuid;
    get diagnostics v_updated = row_count;
  exception
    when others then
      v_blocked := true;
  end;
  if not v_blocked and v_updated > 0 then
    raise exception 'Direct Custom Material status update was not blocked';
  end if;
end $$;

select public.transition_custom_material_request_status(
  '11111111-1111-4111-8111-111111111111'::uuid,
  'approved',
  custom_approver_id,
  'Phase 3 smoke approve'
)
from phase3_material_smoke_ids;

select pg_temp.phase3_material_smoke_set_user(nogrant_id)
from phase3_material_smoke_ids;

do $$
begin
  begin
    insert into public.project_work_boq_items(id, project_id, name, unit)
    select 'phase3-nostaff-boq-deny', no_staff_project_id, 'No staff item', 'pcs'
    from phase3_material_smoke_ids;
    raise exception 'no-staff/no-PBAC fallback incorrectly allowed Material BOQ mutation';
  exception
    when insufficient_privilege then null;
  end;
end $$;

rollback;
