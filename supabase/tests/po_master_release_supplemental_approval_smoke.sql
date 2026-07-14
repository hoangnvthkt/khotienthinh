-- PO master/release supplemental approval smoke.
-- Run after po_master_release_supplemental_approval migration.

begin;

do $$
begin
  if to_regprocedure('public.approve_purchase_order_supplemental_approval(uuid,text,text)') is null then
    raise exception 'Missing approve_purchase_order_supplemental_approval RPC';
  end if;

  if to_regprocedure('public.reject_purchase_order_supplemental_approval(uuid,text,text)') is null then
    raise exception 'Missing reject_purchase_order_supplemental_approval RPC';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'purchase_orders'
      and column_name = 'approved_total_amount'
  ) then
    raise exception 'Missing purchase_orders.approved_total_amount';
  end if;
end $$;

create temp table po_master_release_smoke_ids (
  project_id text not null,
  site_id text not null,
  warehouse_id text not null,
  request_id text not null,
  position_id uuid not null,
  po_creator_id uuid not null,
  po_approver_id uuid not null,
  po_receiver_id uuid not null,
  po_id text not null,
  delivery_batch_id uuid not null,
  approval_id uuid not null
) on commit drop;

grant select, insert, update, delete on table po_master_release_smoke_ids to authenticated;

insert into po_master_release_smoke_ids
values (
  'po-master-release-smoke-' || gen_random_uuid()::text,
  'po-master-release-site-' || gen_random_uuid()::text,
  'po-master-release-wh-' || gen_random_uuid()::text,
  'po-master-release-mr-' || gen_random_uuid()::text,
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  'po-master-release-' || gen_random_uuid()::text,
  gen_random_uuid(),
  gen_random_uuid()
);

insert into public.users (id, name, email, username, role, is_active, allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules)
select user_id, label, user_id::text || '@vioo.local', label, 'EMPLOYEE'::public.user_role, true, '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from po_master_release_smoke_ids s
cross join lateral (
  values
    (s.po_creator_id, 'po-master-release-creator'),
    (s.po_approver_id, 'po-master-release-approver'),
    (s.po_receiver_id, 'po-master-release-receiver')
) as u(user_id, label);

insert into public.projects (id, code, name, source)
select project_id, 'PO-MASTER', 'PO Master Release Smoke', 'manual'
from po_master_release_smoke_ids;

insert into public.hrm_positions (id, name, level, code, is_active, sort_order, source, metadata)
select position_id, 'PO Master Release Position', 1, 'PO-MASTER', true, 0, 'smoke', '{"slice":"po_master_release"}'::jsonb
from po_master_release_smoke_ids;

insert into public.warehouses (id, name, address, type)
select warehouse_id, 'PO Master Release Warehouse', 'Smoke address', 'SITE'
from po_master_release_smoke_ids;

insert into public.project_staff (project_id, construction_site_id, user_id, position_id, start_date)
select s.project_id, s.site_id, u.user_id::text, s.position_id, current_date
from po_master_release_smoke_ids s
cross join lateral (
  values
    (s.po_creator_id),
    (s.po_approver_id),
    (s.po_receiver_id)
) as u(user_id);

insert into public.user_permission_grants (user_id, permission_code, scope_type, scope_id, is_active)
select po_creator_id, 'project.material_po.create', 'project', project_id, true from po_master_release_smoke_ids
union all select po_approver_id, 'project.material_po.approve', 'project', project_id, true from po_master_release_smoke_ids
union all select po_receiver_id, 'project.material_po.receive', 'project', project_id, true from po_master_release_smoke_ids;

insert into app_private.material_request_code_registry(code)
values ('MR-2026-9401')
on conflict (code) do nothing;

insert into app_private.purchase_order_number_registry(po_number)
values ('PO-20269401')
on conflict (po_number) do nothing;

insert into public.requests(
  id, code, site_warehouse_id, requester_id, status, items,
  created_date, expected_date, project_id, construction_site_id,
  request_origin, workflow_step, submitted_to_user_id
)
select request_id, 'MR-2026-9401', warehouse_id, po_creator_id, 'PENDING'::public.request_status, '[]'::jsonb,
       now(), now() + interval '1 day', project_id, site_id, 'project', 'site_manager_review', po_receiver_id::text
from po_master_release_smoke_ids;

insert into public.purchase_orders(
  id, project_id, construction_site_id, vendor_id, vendor_name, po_number, items,
  total_amount, approved_total_amount, supplemental_approval_status,
  order_date, status, source_mode, target_warehouse_id, created_by_id, created_at
)
select po_id, project_id, site_id, 'po-master-release-vendor', 'NCC Smoke', 'PO-20269401', '[]'::jsonb,
       100, 100, 'pending', current_date::text, 'confirmed', 'from_request', warehouse_id, po_creator_id::text, now()
from po_master_release_smoke_ids;

insert into public.purchase_order_delivery_batches(
  id, purchase_order_id, project_id, construction_site_id, delivery_no,
  planned_delivery_date, status, fulfillment_batch_ids, created_by
)
select delivery_batch_id, po_id, project_id, site_id, 1,
       current_date + interval '1 day', 'supplemental_pending', '{}'::text[], po_creator_id
from po_master_release_smoke_ids;

set role authenticated;

create or replace function pg_temp.po_master_release_smoke_set_user(p_user_id uuid)
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

select pg_temp.po_master_release_smoke_set_user(po_creator_id)
from po_master_release_smoke_ids;

insert into public.purchase_order_supplemental_approvals(
  id, purchase_order_id, delivery_batch_id, project_id, construction_site_id,
  previous_approved_amount, requested_total_amount, over_amount,
  status, requested_by, submitted_to_user_id, submitted_to_name, submitted_to_permission
)
select approval_id, po_id, delivery_batch_id, project_id, site_id,
       100, 120, 20,
       'pending', po_creator_id::text, po_approver_id::text, 'PO approver', 'project.material_po.approve'
from po_master_release_smoke_ids;

reset role;

do $$
begin
  if not exists (
    select 1
    from public.purchase_order_delivery_batches batch
    join po_master_release_smoke_ids ids on ids.delivery_batch_id = batch.id
    where batch.supplemental_approval_id = ids.approval_id
  ) then
    raise exception 'Supplemental approval did not link back to delivery batch.';
  end if;
end $$;

set role authenticated;

select pg_temp.po_master_release_smoke_set_user(po_receiver_id)
from po_master_release_smoke_ids;

do $$
begin
  begin
    insert into public.material_request_fulfillment_batches(
      project_id, construction_site_id, material_request_id, batch_no,
      source_warehouse_id, target_warehouse_id, source_type, status,
      po_delivery_batch_id, created_by
    )
    select project_id, site_id, request_id, 'PO-MASTER-BLOCKED',
           warehouse_id, warehouse_id, 'po_receipt', 'issued',
           delivery_batch_id, po_receiver_id
    from po_master_release_smoke_ids;

    raise exception 'Receiver created WMS before supplemental approval.';
  exception
    when insufficient_privilege then
      null;
  end;
end $$;

select pg_temp.po_master_release_smoke_set_user(po_approver_id)
from po_master_release_smoke_ids;

select public.approve_purchase_order_supplemental_approval(approval_id, po_approver_id::text, 'approved by smoke')
from po_master_release_smoke_ids;

reset role;

do $$
begin
  if not exists (
    select 1
    from public.purchase_orders po
    join po_master_release_smoke_ids ids on ids.po_id = po.id
    where po.approved_total_amount = 120
      and po.supplemental_approval_status = 'approved'
  ) then
    raise exception 'Supplemental approval did not raise PO approved ceiling.';
  end if;

  if not exists (
    select 1
    from public.purchase_order_delivery_batches batch
    join po_master_release_smoke_ids ids on ids.delivery_batch_id = batch.id
    where batch.status = 'planned'
  ) then
    raise exception 'Approved supplemental batch was not unlocked to planned.';
  end if;
end $$;

set role authenticated;

select pg_temp.po_master_release_smoke_set_user(po_receiver_id)
from po_master_release_smoke_ids;

insert into public.material_request_fulfillment_batches(
  project_id, construction_site_id, material_request_id, batch_no,
  source_warehouse_id, target_warehouse_id, source_type, status,
  po_delivery_batch_id, created_by
)
select project_id, site_id, request_id, 'PO-MASTER-ALLOWED',
       warehouse_id, warehouse_id, 'po_receipt', 'issued',
       delivery_batch_id, po_receiver_id
from po_master_release_smoke_ids;

select pg_temp.po_master_release_smoke_set_user(po_approver_id)
from po_master_release_smoke_ids;

do $$
begin
  begin
    update public.purchase_order_supplemental_approvals
    set status = 'rejected'
    where id = (select approval_id from po_master_release_smoke_ids);

    raise exception 'Direct supplemental status update was not blocked.';
  exception
    when insufficient_privilege then
      null;
  end;
end $$;

reset role;
rollback;
