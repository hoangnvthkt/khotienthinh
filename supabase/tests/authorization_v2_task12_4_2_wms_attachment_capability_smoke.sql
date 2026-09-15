-- WMS attachment reads and mutations must use separate canonical capabilities.
-- All fixture writes are rolled back.
begin;

do $$
begin
  if to_regprocedure('app_private.wms_transaction_attachment_can_read(text)') is null then
    raise exception 'Missing WMS attachment read helper';
  end if;
  if to_regprocedure('app_private.wms_transaction_attachment_can_mutate(text)') is null then
    raise exception 'Missing WMS attachment mutation helper';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'wms_transaction_attachments_select'
      and qual like '%wms_transaction_attachment_can_read%'
  ) then
    raise exception 'WMS attachment SELECT policy is not bound to the read helper';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'wms_transaction_attachments_insert'
      and with_check like '%wms_transaction_attachment_can_mutate%'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'wms_transaction_attachments_delete'
      and qual like '%wms_transaction_attachment_can_mutate%'
  ) then
    raise exception 'WMS attachment write policies are not bound to the mutation helper';
  end if;
end $$;

create temporary table wms_attachment_parity_actors on commit drop as
select id, auth_id
from public.users
where account_status = 'ACTIVE' and auth_id is not null;

create temporary table wms_attachment_parity_objects on commit drop as
select distinct on (type, source_warehouse_id, target_warehouse_id, requester_id)
  id::text || '/parity-fixture.pdf' as object_name
from public.transactions
order by type, source_warehouse_id, target_warehouse_id, requester_id, id;

grant select on wms_attachment_parity_actors, wms_attachment_parity_objects to authenticated;

set local role authenticated;
do $$
declare
  actor record;
  attachment record;
  legacy_allowed boolean;
  read_allowed boolean;
  mutate_allowed boolean;
begin
  for actor in select * from wms_attachment_parity_actors order by id loop
    perform set_config('request.jwt.claim.sub', actor.auth_id::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    for attachment in select * from wms_attachment_parity_objects loop
      legacy_allowed := app_private.wms_transaction_attachment_can_access(attachment.object_name);
      read_allowed := app_private.wms_transaction_attachment_can_read(attachment.object_name);
      mutate_allowed := app_private.wms_transaction_attachment_can_mutate(attachment.object_name);
      if legacy_allowed and (not read_allowed or not mutate_allowed) then
        raise exception 'WMS attachment helper removed existing access';
      end if;
    end loop;
  end loop;
end $$;
reset role;

create temporary table wms_attachment_actor on commit drop as
select
  actor.id,
  actor.auth_id,
  tx.id::text as transaction_id
from public.users actor
cross join lateral (
  select transaction_row.id, transaction_row.requester_id
  from public.transactions transaction_row
  where transaction_row.requester_id is distinct from actor.id
  order by transaction_row.id
  limit 1
) tx
where actor.role::text = 'EMPLOYEE'
  and actor.is_active
  and actor.account_status = 'ACTIVE'
  and actor.auth_id is not null
  and not ('WMS' = any(coalesce(actor.allowed_modules, '{}'::text[])))
  and not ('WMS' = any(coalesce(actor.admin_modules, '{}'::text[])))
  and not (coalesce(actor.allowed_sub_modules, '{}'::jsonb) ? 'WMS')
  and not (coalesce(actor.admin_sub_modules, '{}'::jsonb) ? 'WMS')
  and not exists (
    select 1 from public.user_permission_grants grant_row
    where grant_row.user_id = actor.id
      and grant_row.permission_code in ('wms.transaction.view', 'wms.transaction.approve')
      and grant_row.scope_type = 'global'
      and grant_row.scope_id = '*'
  )
order by actor.id
limit 1;

do $$
begin
  if not exists (select 1 from wms_attachment_actor) then
    raise exception 'WMS attachment smoke requires an isolated employee and transaction';
  end if;
end $$;

grant select on wms_attachment_actor to authenticated;

select set_config('app.authorization_permission_command', 'on', true);
insert into public.user_permission_grants(
  user_id, permission_code, scope_type, scope_id, is_active, grant_reason
)
select id, 'wms.transaction.view', 'global', '*', true,
       'Task 12.4.2 WMS attachment read fixture'
from wms_attachment_actor;

select set_config('request.jwt.claim.sub', auth_id::text, true) from wms_attachment_actor;
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare actor wms_attachment_actor%rowtype;
begin
  select * into actor from wms_attachment_actor;
  if not app_private.wms_transaction_attachment_can_read(actor.transaction_id || '/fixture.pdf') then
    raise exception 'Canonical transaction view did not authorize attachment read';
  end if;
  if app_private.wms_transaction_attachment_can_mutate(actor.transaction_id || '/fixture.pdf') then
    raise exception 'Canonical transaction view incorrectly authorized attachment mutation';
  end if;
end $$;

reset role;
select set_config('app.authorization_permission_command', 'on', true);
insert into public.user_permission_grants(
  user_id, permission_code, scope_type, scope_id, is_active, expires_at, grant_reason
)
select id, 'wms.transaction.approve', 'global', '*', true, now() + interval '1 day',
       'Task 12.4.2 WMS attachment mutation fixture'
from wms_attachment_actor;

set local role authenticated;
do $$
declare actor wms_attachment_actor%rowtype;
begin
  select * into actor from wms_attachment_actor;
  if not app_private.wms_transaction_attachment_can_mutate(actor.transaction_id || '/fixture.pdf') then
    raise exception 'Canonical transaction approve did not authorize attachment mutation';
  end if;
end $$;

reset role;
rollback;
