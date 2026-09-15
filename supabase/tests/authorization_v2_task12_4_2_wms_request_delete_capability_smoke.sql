-- A dedicated WMS request-delete capability may delete only eligible requests
-- linked to its warehouse. Generic request actions must not imply deletion.
begin;

create temporary table wms_request_delete_capability_context (
  source_warehouse_id text not null,
  site_warehouse_id text not null,
  other_warehouse_id text not null,
  allowed_request_id text not null,
  wrong_scope_request_id text not null,
  generic_action_request_id text not null,
  locked_request_id text not null
) on commit drop;

insert into wms_request_delete_capability_context
values (
  'task12-4-2-delete-source-' || gen_random_uuid()::text,
  'task12-4-2-delete-site-' || gen_random_uuid()::text,
  'task12-4-2-delete-other-' || gen_random_uuid()::text,
  'task12-4-2-delete-allowed-' || gen_random_uuid()::text,
  'task12-4-2-delete-wrong-' || gen_random_uuid()::text,
  'task12-4-2-delete-generic-' || gen_random_uuid()::text,
  'task12-4-2-delete-locked-' || gen_random_uuid()::text
);

create temporary table wms_request_delete_capability_actor (
  actor_kind text primary key,
  actor_id uuid not null,
  auth_id uuid not null,
  email text not null
) on commit drop;

insert into wms_request_delete_capability_actor
select actor_kind, gen_random_uuid(), gen_random_uuid(),
       'task12-4-2-wms-delete-' || actor_kind || '-'
         || gen_random_uuid()::text || '@vioo.local'
from (values
  ('delete_capability'),
  ('wrong_scope'),
  ('generic_approve'),
  ('request_owner')
) actor(actor_kind);

insert into public.warehouses (id, name, address, type)
select warehouse_id, label, 'Smoke', 'GENERAL'::public.warehouse_type
from wms_request_delete_capability_context context_row
cross join lateral (values
  (context_row.source_warehouse_id, 'Task 12.4.2 delete source warehouse'),
  (context_row.site_warehouse_id, 'Task 12.4.2 delete site warehouse'),
  (context_row.other_warehouse_id, 'Task 12.4.2 delete other warehouse')
) warehouse_row(warehouse_id, label);

insert into public.users (
  id, name, email, username, role, is_active, account_status
)
select actor_id, 'Task 12.4.2 WMS delete ' || actor_kind, email, email,
       'EMPLOYEE'::public.user_role, true, 'ACTIVE'
from wms_request_delete_capability_actor;

do $$
begin
  if not exists (
    select 1
    from public.permission_actions
    where permission_code = 'wms.request.delete'
      and module_code = 'wms.request'
      and is_active
      and scope_modes = array['global', 'warehouse']::text[]
      and grant_readiness = 'enforced'
      and direct_grant_allowed
  ) then
    raise exception 'Missing dedicated WMS request-delete capability';
  end if;
end $$;

select set_config('app.authorization_permission_command', 'on', true);
insert into public.user_permission_grants (
  user_id, permission_code, scope_type, scope_id, is_active, grant_reason
)
select actor.actor_id, grant_row.permission_code, 'warehouse', grant_row.scope_id,
       true, 'Task 12.4.2 WMS request-delete capability fixture'
from wms_request_delete_capability_actor actor
join wms_request_delete_capability_context context_row on true
cross join lateral (
  values
    ('delete_capability', 'wms.request.delete', context_row.site_warehouse_id),
    ('delete_capability', 'wms.request.view', context_row.site_warehouse_id),
    ('wrong_scope', 'wms.request.delete', context_row.other_warehouse_id),
    ('wrong_scope', 'wms.request.view', context_row.site_warehouse_id),
    ('generic_approve', 'wms.request.approve', context_row.source_warehouse_id),
    ('generic_approve', 'wms.request.view', context_row.site_warehouse_id)
) grant_row(actor_kind, permission_code, scope_id)
where grant_row.actor_kind = actor.actor_kind;

insert into public.requests (
  id, code, site_warehouse_id, source_warehouse_id, requester_id, status,
  items, created_date, expected_date, request_origin, title
)
select request_row.request_id,
       public.next_material_request_code_v1(),
       context_row.site_warehouse_id,
       context_row.source_warehouse_id,
       owner.actor_id,
       request_row.status::public.request_status,
       '[]'::jsonb,
       now(),
       now() + interval '1 day',
       'wms',
       'Task 12.4.2 WMS request delete smoke'
from wms_request_delete_capability_context context_row
join wms_request_delete_capability_actor owner
  on owner.actor_kind = 'request_owner'
cross join lateral (values
  (context_row.allowed_request_id, 'PENDING'),
  (context_row.wrong_scope_request_id, 'PENDING'),
  (context_row.generic_action_request_id, 'PENDING'),
  (context_row.locked_request_id, 'APPROVED')
) request_row(request_id, status);

grant select on wms_request_delete_capability_context to authenticated;
grant select on wms_request_delete_capability_actor to authenticated;

set local role authenticated;

do $$
declare
  context_row wms_request_delete_capability_context%rowtype;
  actor wms_request_delete_capability_actor%rowtype;
  affected_rows bigint;
begin
  select * into context_row from wms_request_delete_capability_context;

  select * into actor from wms_request_delete_capability_actor
  where actor_kind = 'delete_capability';
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', actor.auth_id, 'email', actor.email, 'role', 'authenticated'
  )::text, true);
  delete from public.requests where id = context_row.allowed_request_id;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'Dedicated WMS delete capability did not delete eligible request';
  end if;
  delete from public.requests where id = context_row.locked_request_id;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'Dedicated WMS delete capability deleted an approved request';
  end if;

  select * into actor from wms_request_delete_capability_actor
  where actor_kind = 'wrong_scope';
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', actor.auth_id, 'email', actor.email, 'role', 'authenticated'
  )::text, true);
  delete from public.requests where id = context_row.wrong_scope_request_id;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'Wrong-scope WMS delete capability deleted request';
  end if;

  select * into actor from wms_request_delete_capability_actor
  where actor_kind = 'generic_approve';
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', actor.auth_id, 'email', actor.email, 'role', 'authenticated'
  )::text, true);
  delete from public.requests where id = context_row.generic_action_request_id;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'Generic WMS approve unexpectedly implied request deletion';
  end if;
end $$;

reset role;

do $$
declare
  context_row wms_request_delete_capability_context%rowtype;
begin
  select * into context_row from wms_request_delete_capability_context;
  if exists (select 1 from public.requests where id = context_row.allowed_request_id)
     or not exists (select 1 from public.requests where id = context_row.locked_request_id)
     or not exists (select 1 from public.requests where id = context_row.wrong_scope_request_id)
     or not exists (select 1 from public.requests where id = context_row.generic_action_request_id) then
    raise exception 'WMS request-delete capability persisted an unexpected delete set';
  end if;
end $$;

rollback;
