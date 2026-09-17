-- E31: materialize and assign WAREHOUSE_MANAGER through V2 commands.
-- The role, assignment, stock correction and metadata updates all roll back.
begin;

create temporary table e31_pilot_actor(
  kind text primary key,
  id uuid,
  auth_id uuid,
  email text
) on commit drop;

insert into e31_pilot_actor
select kind, gen_random_uuid(), gen_random_uuid(),
       'e31-pilot-' || kind || '-' || gen_random_uuid()::text || '@vioo.local'
from (values ('permission_admin'), ('auditor'), ('warehouse_manager')) actor(kind);

insert into public.users(id, name, email, username, role, is_active, account_status)
select id, 'E31 Pilot ' || kind, email, email,
       'EMPLOYEE'::public.user_role, true, 'ACTIVE'
from e31_pilot_actor;

insert into public.principal_role_assignments(
  principal_type, principal_id, role_template_id, scope_type, scope_id,
  status, assigned_by, assigned_reason
)
select 'user', actor.id, template_row.id, 'global', '*', 'ACTIVE', actor.id,
       'E31 rollback fixture authorization operator'
from e31_pilot_actor actor
join public.role_permission_templates template_row
  on template_row.code = case actor.kind
    when 'permission_admin' then 'PERMISSION_ADMIN'
    else 'AUDITOR'
  end
where actor.kind in ('permission_admin', 'auditor');

create temporary table e31_pilot_resource on commit drop as
select
  max(id::text) filter (where ordinal = 1) warehouse_a,
  max(id::text) filter (where ordinal = 2) warehouse_b,
  ('e31-pilot-item-' || gen_random_uuid()::text) item_id
from (
  select id, row_number() over(order by id) ordinal
  from public.warehouses
  order by id
  limit 2
) warehouses;

do $$ begin
  if (select warehouse_a is null or warehouse_b is null from e31_pilot_resource) then
    raise exception 'E31 pilot requires two warehouses';
  end if;
end $$;

insert into public.items(
  id, sku, name, category, unit, price_in, price_out, min_stock, stock_by_warehouse
)
select item_id, item_id, 'E31 Pilot Item', 'E31', 'cai', 1, 1, 0,
       jsonb_build_object(warehouse_a, 10, warehouse_b, 20)
from e31_pilot_resource;

grant select on e31_pilot_actor, e31_pilot_resource to authenticated;

set local role authenticated;

do $$
declare
  operator_row e31_pilot_actor%rowtype;
  auditor_row e31_pilot_actor%rowtype;
  target_row e31_pilot_actor%rowtype;
  resource_row e31_pilot_resource%rowtype;
  item_payload jsonb;
  role_receipt jsonb;
  role_id uuid;
  preview_row jsonb;
  acceptances jsonb;
  assignment_receipt jsonb;
  adjustment_receipt jsonb;
  affected integer;
  blocked boolean := false;
begin
  select * into operator_row from e31_pilot_actor where kind = 'permission_admin';
  select * into auditor_row from e31_pilot_actor where kind = 'auditor';
  select * into target_row from e31_pilot_actor where kind = 'warehouse_manager';
  select * into resource_row from e31_pilot_resource;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', operator_row.auth_id,
    'email', operator_row.email,
    'role', 'authenticated'
  )::text, true);

  select jsonb_agg(jsonb_build_object(
    'permission_code', permission_code,
    'scope_type', 'warehouse',
    'scope_id', '*',
    'sort_order', sort_order
  ) order by sort_order)
  into item_payload
  from (values
    ('wms.inventory.view', 10),
    ('wms.inventory.edit', 20),
    ('wms.request.view', 30),
    ('wms.request.create', 40),
    ('wms.request.approve', 50),
    ('wms.request.export', 60),
    ('wms.request.receive', 70),
    ('wms.request.delete', 80),
    ('wms.transaction.view', 90),
    ('wms.transaction.create', 100),
    ('wms.transaction.approve', 110),
    ('wms.transaction.complete', 120),
    ('wms.transaction.reverse', 130),
    ('wms.material_issue.settle', 140),
    ('wms.material_issue.reverse_settlement', 150),
    ('wms.purchase_order.return_supplier', 160),
    ('wms.master_data.manage', 170)
  ) item(permission_code, sort_order);

  role_receipt := public.save_business_role_v2(
    null, 0, 'WAREHOUSE_MANAGER', 'Quản lý kho',
    'Mẫu pilot 17 quyền quản lý chỉ tại đúng kho được gán.',
    item_payload,
    'E31 owner-approved warehouse manager pilot materialization'
  );
  role_id := (role_receipt->>'roleTemplateId')::uuid;

  if (role_receipt->>'version')::integer <> 1
     or (select count(*) from public.role_permission_template_items where template_id = role_id) <> 17
     or not exists (
       select 1 from public.permission_audit_events
       where actor_user_id = operator_row.id
         and event_type = 'business_role_created'
         and metadata->>'roleTemplateId' = role_id::text
     ) then
    raise exception 'E31 manager role materialization or creation audit is incomplete';
  end if;

  preview_row := public.preview_business_role_assignment_v2(
    target_row.id, role_id, 'warehouse', resource_row.warehouse_a
  );
  if (preview_row->>'roleCode') <> 'WAREHOUSE_MANAGER'
     or (preview_row->>'roleVersion')::integer <> 1
     or (preview_row->>'permissionCount')::integer <> 17
     or coalesce(preview_row->>'fingerprint', '') = ''
     or jsonb_array_length(coalesce(preview_row->'hardDenies', '[]'::jsonb)) <> 0
     or exists (
       select 1 from jsonb_array_elements(preview_row->'permissions') permission_row
       where permission_row->>'scopeType' <> 'warehouse'
          or permission_row->>'scopeId' <> resource_row.warehouse_a
     ) then
    raise exception 'E31 preview did not preserve the 17-action concrete warehouse scope';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'ruleCode', warning->>'ruleCode',
    'scopeType', warning->>'scopeType',
    'scopeId', warning->>'scopeId',
    'reason', 'E31 warehouse manager rollback pilot review',
    'controlOwnerUserId', auditor_row.id,
    'compensatingControls', 'Independent audit review during bounded pilot',
    'expiresAt', now() + interval '1 day'
  )), '[]'::jsonb)
  into acceptances
  from jsonb_array_elements(coalesce(preview_row->'warnings', '[]'::jsonb)) warning;

  assignment_receipt := public.assign_business_role_v2(
    target_row.id, role_id, 1, 'warehouse', resource_row.warehouse_a,
    now(), now() + interval '1 day',
    'E31 bounded warehouse manager rollback pilot assignment',
    acceptances,
    preview_row->>'fingerprint'
  );

  if coalesce(assignment_receipt->>'assignmentId', '') = ''
     or not exists (
       select 1 from public.permission_audit_events
       where target_user_id = target_row.id
         and event_type = 'business_role_assigned'
         and metadata->>'roleTemplateId' = role_id::text
     ) then
    raise exception 'E31 manager assignment receipt or audit event is missing';
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', target_row.auth_id,
    'email', target_row.email,
    'role', 'authenticated'
  )::text, true);

  if exists (
    select 1 from jsonb_array_elements(item_payload) item
    where not app_private.has_permission(
      target_row.id, item->>'permission_code', 'warehouse', resource_row.warehouse_a
    )
  ) then
    raise exception 'E31 assigned manager is missing an approved action at warehouse A';
  end if;

  if exists (
    select 1 from jsonb_array_elements(item_payload) item
    where app_private.has_permission(
      target_row.id, item->>'permission_code', 'warehouse', resource_row.warehouse_b
    )
  ) then
    raise exception 'E31 manager assignment leaked into warehouse B';
  end if;

  adjustment_receipt := public.adjust_inventory_stock(
    resource_row.item_id, resource_row.warehouse_a, 15::numeric, 10::numeric,
    'E31 rollback pilot inventory correction'
  );
  if (adjustment_receipt->>'quantity')::numeric <> 15
     or not exists (
       select 1 from public.permission_audit_events
       where actor_user_id = target_row.id
         and event_type = 'wms_inventory_stock_adjusted'
         and metadata->>'scopeId' = resource_row.warehouse_a
     ) then
    raise exception 'E31 manager stock adjustment or audit is incomplete';
  end if;

  blocked := false;
  begin
    perform public.adjust_inventory_stock(
      resource_row.item_id, resource_row.warehouse_b, 25::numeric, 20::numeric,
      'E31 rollback pilot forbidden warehouse correction'
    );
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'E31 manager adjusted stock in warehouse B'; end if;

  update public.warehouses set address = address || ' E31 pilot'
  where id = resource_row.warehouse_a;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'E31 manager could not update assigned warehouse'; end if;

  update public.warehouses set address = address || ' E31 forbidden'
  where id = resource_row.warehouse_b;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'E31 manager updated warehouse B'; end if;

  update public.items set name = 'E31 forbidden global catalog mutation'
  where id = resource_row.item_id;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'E31 manager edited global item metadata'; end if;
end;
$$;

reset role;

select 'authorization_v2_task12_4_2_warehouse_manager_pilot_smoke_passed' result;
rollback;
