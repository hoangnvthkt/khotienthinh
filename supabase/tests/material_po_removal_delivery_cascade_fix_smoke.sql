-- Run after the Material PO removal delivery cascade fix migration.
-- Safe on Cloud: all attempted deletes are rolled back.

begin;

create temp table material_po_removal_fixture on commit drop as
select
  po.id as po_id,
  po.po_number,
  po.created_by_id::uuid as creator_id,
  creator.email as creator_email,
  (select count(*) from public.purchase_order_delivery_batches batch
    where batch.purchase_order_id = po.id) as batch_count,
  (select count(*) from public.purchase_order_delivery_groups delivery_group
    where delivery_group.purchase_order_id = po.id) as group_count
from public.purchase_orders po
join public.users creator
  on creator.id::text = po.created_by_id
where po.archived_at is null
  and po.status in ('draft', 'returned')
  and creator.role <> 'ADMIN'
  and coalesce(creator.is_active, true)
  and (
    exists (
      select 1
      from public.purchase_order_delivery_batches batch
      where batch.purchase_order_id = po.id
    )
    or exists (
      select 1
      from public.purchase_order_delivery_groups delivery_group
      where delivery_group.purchase_order_id = po.id
    )
  )
  and not app_private.project_po_has_pending_work_v1(po.id::text)
  and not app_private.project_po_has_stock_impact_v1(
    po.id::text,
    po.received_transaction_ids,
    po.items
  )
  and app_private.project_actor_has_effective_room_action(
    creator.id,
    po.project_id,
    po.construction_site_id,
    'material_po',
    'view'
  )
  and app_private.project_actor_has_effective_room_action(
    creator.id,
    po.project_id,
    po.construction_site_id,
    'material_po',
    'edit'
  )
  and app_private.project_actor_has_effective_room_action(
    creator.id,
    po.project_id,
    po.construction_site_id,
    'material_po',
    'delete'
  )
order by (po.po_number = 'PO-313') desc, po.created_at desc
limit 1;

do $$
begin
  if not exists (select 1 from material_po_removal_fixture) then
    raise exception 'No safe non-admin creator-owned PO removal fixture is available';
  end if;
end $$;

create temp table material_po_removal_negative_actor (
  user_id uuid not null,
  email text
) on commit drop;

do $$
declare
  fixture material_po_removal_fixture%rowtype;
  candidate record;
begin
  select * into fixture from material_po_removal_fixture;

  for candidate in
    select user_row.id, user_row.email
    from public.users user_row
    where user_row.id <> fixture.creator_id
      and user_row.role <> 'ADMIN'
      and coalesce(user_row.is_active, true)
    order by user_row.id
  loop
    perform set_config('request.jwt.claim.sub', candidate.id::text, true);
    perform set_config('request.jwt.claim.email', coalesce(candidate.email, ''), true);
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', candidate.id::text,
      'email', coalesce(candidate.email, ''),
      'role', 'authenticated'
    )::text, true);

    if not app_private.purchase_order_delivery_can_mutate(fixture.po_id) then
      insert into material_po_removal_negative_actor(user_id, email)
      values (candidate.id, candidate.email);
      exit;
    end if;
  end loop;

  if not exists (select 1 from material_po_removal_negative_actor) then
    raise exception 'No unauthorized delivery mutation actor is available';
  end if;
end $$;

grant select on material_po_removal_fixture to authenticated;
grant select on material_po_removal_negative_actor to authenticated;

set local role authenticated;

select
  set_config('request.jwt.claim.sub', user_id::text, true),
  set_config('request.jwt.claim.email', coalesce(email, ''), true),
  set_config('request.jwt.claims', jsonb_build_object(
    'sub', user_id::text,
    'email', coalesce(email, ''),
    'role', 'authenticated'
  )::text, true)
from material_po_removal_negative_actor;

do $$
declare
  fixture material_po_removal_fixture%rowtype;
  v_deleted_count integer := 0;
begin
  select * into fixture from material_po_removal_fixture;

  if app_private.purchase_order_delivery_can_mutate(fixture.po_id) then
    raise exception 'Negative actor unexpectedly has delivery mutation authority';
  end if;

  delete from public.purchase_order_delivery_batches batch
  where batch.purchase_order_id = fixture.po_id;
  get diagnostics v_deleted_count = row_count;

  if v_deleted_count <> 0 then
    raise exception 'Unauthorized actor deleted % delivery batches', v_deleted_count;
  end if;
end $$;

reset role;

do $$
declare
  fixture material_po_removal_fixture%rowtype;
  v_batch_count bigint;
  v_group_count bigint;
begin
  select * into fixture from material_po_removal_fixture;

  select count(*) into v_batch_count
  from public.purchase_order_delivery_batches batch
  where batch.purchase_order_id = fixture.po_id;

  select count(*) into v_group_count
  from public.purchase_order_delivery_groups delivery_group
  where delivery_group.purchase_order_id = fixture.po_id;

  if v_batch_count <> fixture.batch_count or v_group_count <> fixture.group_count then
    raise exception 'Unauthorized child delete changed fixture counts';
  end if;
end $$;

set local role authenticated;

select
  set_config('request.jwt.claim.sub', creator_id::text, true),
  set_config('request.jwt.claim.email', coalesce(creator_email, ''), true),
  set_config('request.jwt.claims', jsonb_build_object(
    'sub', creator_id::text,
    'email', coalesce(creator_email, ''),
    'role', 'authenticated'
  )::text, true)
from material_po_removal_fixture;

do $$
declare
  fixture material_po_removal_fixture%rowtype;
  v_action text;
begin
  select * into fixture from material_po_removal_fixture;

  if not app_private.purchase_order_delivery_can_mutate(fixture.po_id) then
    raise exception 'Authorized creator cannot mutate delivery children before PO removal';
  end if;

  select result.action
    into v_action
  from public.remove_purchase_order_v1(fixture.po_id) result;

  if v_action <> 'deleted' then
    raise exception 'PO removal returned action %, expected deleted', v_action;
  end if;
end $$;

reset role;

do $$
declare
  fixture material_po_removal_fixture%rowtype;
begin
  select * into fixture from material_po_removal_fixture;

  if exists (select 1 from public.purchase_orders po where po.id = fixture.po_id) then
    raise exception 'PO parent still exists after successful removal';
  end if;

  if exists (
    select 1 from public.purchase_order_delivery_batches batch
    where batch.purchase_order_id = fixture.po_id
  ) then
    raise exception 'PO delivery batches still exist after successful removal';
  end if;

  if exists (
    select 1 from public.purchase_order_delivery_groups delivery_group
    where delivery_group.purchase_order_id = fixture.po_id
  ) then
    raise exception 'PO delivery groups still exist after successful removal';
  end if;
end $$;

select
  'material_po_removal_delivery_cascade_fix_smoke_passed' as result,
  po_number
from material_po_removal_fixture;

rollback;
