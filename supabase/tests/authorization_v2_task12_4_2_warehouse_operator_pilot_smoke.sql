-- E30: materialize and assign WAREHOUSE_OPERATOR through V2 commands.
-- All role/template/assignment/audit fixtures roll back.
begin;

create temporary table e30_actor(
  kind text primary key,
  id uuid,
  auth_id uuid,
  email text
) on commit drop;

insert into e30_actor
select kind, gen_random_uuid(), gen_random_uuid(),
       'e30-' || kind || '-' || gen_random_uuid()::text || '@vioo.local'
from (values ('permission_admin'), ('auditor'), ('warehouse_operator')) actor(kind);

insert into public.users(id, name, email, username, role, is_active, account_status)
select id, 'E30 ' || kind, email, email, 'EMPLOYEE'::public.user_role, true, 'ACTIVE'
from e30_actor;

insert into public.principal_role_assignments(
  principal_type, principal_id, role_template_id, scope_type, scope_id,
  status, assigned_by, assigned_reason
)
select 'user', actor.id, template_row.id, 'global', '*', 'ACTIVE', actor.id,
       'E30 rollback fixture authorization operator'
from e30_actor actor
join public.role_permission_templates template_row
  on template_row.code = case actor.kind
    when 'permission_admin' then 'PERMISSION_ADMIN'
    else 'AUDITOR'
  end
where actor.kind in ('permission_admin', 'auditor');

create temporary table e30_warehouse on commit drop as
select id::text, row_number() over(order by id) ordinal
from public.warehouses
order by id
limit 2;

do $$ begin
  if (select count(*) from e30_warehouse) <> 2 then
    raise exception 'E30 pilot requires two warehouses';
  end if;
end $$;

grant select on e30_actor, e30_warehouse to authenticated;

do $$
declare
  operator_row e30_actor%rowtype;
  auditor_row e30_actor%rowtype;
  target_row e30_actor%rowtype;
  warehouse_a text;
  warehouse_b text;
  item_payload jsonb;
  role_receipt jsonb;
  role_id uuid;
  preview_row jsonb;
  acceptances jsonb;
  assignment_receipt jsonb;
  blocked boolean := false;
begin
  select * into operator_row from e30_actor where kind = 'permission_admin';
  select * into auditor_row from e30_actor where kind = 'auditor';
  select * into target_row from e30_actor where kind = 'warehouse_operator';
  select id into warehouse_a from e30_warehouse where ordinal = 1;
  select id into warehouse_b from e30_warehouse where ordinal = 2;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', operator_row.auth_id,
    'email', operator_row.email,
    'role', 'authenticated'
  )::text, true);

  -- RPC calls must reject a declared manager capability even if a crafted client
  -- bypasses the wizard's catalog filter.
  begin
    perform public.save_business_role_v2(
      null, 0, 'E30_NOT_READY', 'E30 Not Ready', 'Rollback-only invalid role',
      jsonb_build_array(jsonb_build_object(
        'permission_code', 'wms.inventory.edit',
        'scope_type', 'warehouse',
        'scope_id', '*',
        'sort_order', 0
      )),
      'E30 declared action must be rejected'
    );
  exception when check_violation then
    blocked := sqlerrm = 'Business Role contains a permission that is not enforced or verified';
  end;
  if not blocked then
    raise exception 'E30 save command accepted a non-ready action';
  end if;

  select jsonb_agg(jsonb_build_object(
    'permission_code', permission_code,
    'scope_type', 'warehouse',
    'scope_id', '*',
    'sort_order', sort_order
  ) order by sort_order)
  into item_payload
  from (values
    ('wms.inventory.view', 10),
    ('wms.request.view', 20),
    ('wms.request.create', 30),
    ('wms.request.approve', 40),
    ('wms.request.export', 50),
    ('wms.request.receive', 60),
    ('wms.transaction.view', 70),
    ('wms.transaction.create', 80),
    ('wms.transaction.approve', 90),
    ('wms.transaction.complete', 100)
  ) item(permission_code, sort_order);

  role_receipt := public.save_business_role_v2(
    null, 0, 'WAREHOUSE_OPERATOR', 'Thủ kho',
    'Mẫu pilot 10 quyền vận hành tại đúng kho được gán.',
    item_payload,
    'E30 pilot materialization approved WAREHOUSE_OPERATOR blueprint'
  );
  role_id := (role_receipt->>'roleTemplateId')::uuid;

  if (role_receipt->>'version')::integer <> 1
     or (select count(*) from public.role_permission_template_items where template_id = role_id) <> 10
     or not exists (
       select 1 from public.permission_audit_events
       where actor_user_id = operator_row.id
         and event_type = 'business_role_created'
         and metadata->>'roleTemplateId' = role_id::text
     ) then
    raise exception 'E30 role materialization or creation audit is incomplete';
  end if;

  preview_row := public.preview_business_role_assignment_v2(
    target_row.id, role_id, 'warehouse', warehouse_a
  );
  if (preview_row->>'roleCode') <> 'WAREHOUSE_OPERATOR'
     or (preview_row->>'roleVersion')::integer <> 1
     or (preview_row->>'permissionCount')::integer <> 10
     or coalesce(preview_row->>'fingerprint', '') = ''
     or jsonb_array_length(coalesce(preview_row->'hardDenies', '[]'::jsonb)) <> 0
     or exists (
       select 1 from jsonb_array_elements(preview_row->'permissions') permission_row
       where permission_row->>'scopeType' <> 'warehouse'
          or permission_row->>'scopeId' <> warehouse_a
     ) then
    raise exception 'E30 preview did not preserve the ten-action concrete warehouse scope';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'ruleCode', warning->>'ruleCode',
    'scopeType', warning->>'scopeType',
    'scopeId', warning->>'scopeId',
    'reason', 'E30 warehouse operator pilot review',
    'controlOwnerUserId', auditor_row.id,
    'compensatingControls', 'Independent audit review during bounded pilot',
    'expiresAt', now() + interval '1 day'
  )), '[]'::jsonb)
  into acceptances
  from jsonb_array_elements(coalesce(preview_row->'warnings', '[]'::jsonb)) warning;

  assignment_receipt := public.assign_business_role_v2(
    target_row.id, role_id, 1, 'warehouse', warehouse_a,
    now(), now() + interval '1 day',
    'E30 bounded warehouse operator pilot assignment',
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
    raise exception 'E30 assignment receipt or audit event is missing';
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', target_row.auth_id,
    'email', target_row.email,
    'role', 'authenticated'
  )::text, true);

  if exists (
    select 1
    from jsonb_array_elements(item_payload) item
    where not app_private.has_permission(
      target_row.id, item->>'permission_code', 'warehouse', warehouse_a
    )
  ) then
    raise exception 'E30 assigned operator is missing an approved action at warehouse A';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(item_payload) item
    where app_private.has_permission(
      target_row.id, item->>'permission_code', 'warehouse', warehouse_b
    )
  ) then
    raise exception 'E30 operator assignment leaked into warehouse B';
  end if;

  if app_private.has_permission(target_row.id, 'wms.inventory.edit', 'warehouse', warehouse_a)
     or app_private.has_permission(target_row.id, 'wms.request.delete', 'warehouse', warehouse_a)
     or app_private.has_permission(target_row.id, 'wms.transaction.reverse', 'warehouse', warehouse_a)
     or app_private.has_permission(target_row.id, 'wms.master_data.manage', 'warehouse', warehouse_a) then
    raise exception 'E30 operator gained a manager-only capability';
  end if;
end;
$$;

select 'authorization_v2_task12_4_2_warehouse_operator_pilot_smoke_passed' result;
rollback;
