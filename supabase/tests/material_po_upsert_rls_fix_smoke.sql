-- Run after the Material PO UPSERT RLS fix migration.
-- Safe on Cloud: the allocated PO number and diagnostic PO are rolled back.

begin;

do $$
declare
  v_select_qual text;
begin
  select policy.qual into v_select_qual
  from pg_policies policy
  where policy.schemaname = 'public'
    and policy.tablename = 'purchase_orders'
    and policy.policyname = 'purchase_orders_select';

  if v_select_qual like '%purchase_order_can_view(id)%'
    or v_select_qual not like '%current_actor_has_effective_room_action%'
  then
    raise exception 'purchase_orders SELECT is not UPSERT-safe and Room-authoritative';
  end if;
end $$;

create temp table material_po_upsert_rls_fixture on commit drop as
select
  user_row.id as user_id,
  user_row.email,
  member.project_id,
  member.construction_site_id,
  po.vendor_id,
  po.vendor_name,
  po.items,
  po.target_warehouse_id
from public.users user_row
join public.project_staff staff
  on staff.user_id = user_row.id::text
  and staff.end_date is null
join public.project_permission_room_members member
  on member.project_staff_id = staff.id
  and member.project_id = staff.project_id
  and member.room_code = 'material_po'
  and member.is_active
join public.purchase_orders po
  on po.project_id = member.project_id
  and po.archived_at is null
  and po.source_mode is distinct from 'company_consolidated'
  and (
    member.construction_site_id is null
    or po.construction_site_id = member.construction_site_id
  )
where user_row.role <> 'ADMIN'
  and coalesce(user_row.is_active, true)
  and exists (
    select 1
    from public.project_permission_room_member_actions action
    where action.room_member_id = member.id
      and action.action_code = 'view'
      and action.is_active
  )
  and exists (
    select 1
    from public.project_permission_room_member_actions action
    where action.room_member_id = member.id
      and action.action_code = 'edit'
      and action.is_active
  )
order by member.project_id, member.construction_site_id nulls first, user_row.id
limit 1;

do $$
begin
  if not exists (select 1 from material_po_upsert_rls_fixture) then
    raise exception 'No non-admin Room PO view/edit fixture with an existing PO is available';
  end if;
end $$;

grant select on material_po_upsert_rls_fixture to authenticated;

set local role authenticated;

select
  set_config('request.jwt.claim.sub', user_id::text, true),
  set_config('request.jwt.claim.email', coalesce(email, ''), true),
  set_config('request.jwt.claims', jsonb_build_object(
    'sub', user_id::text,
    'email', coalesce(email, ''),
    'role', 'authenticated'
  )::text, true)
from material_po_upsert_rls_fixture;

do $$
declare
  fixture material_po_upsert_rls_fixture%rowtype;
  v_po_id text := 'material-po-upsert-smoke-' || gen_random_uuid()::text;
  v_po_number text;
begin
  select * into fixture from material_po_upsert_rls_fixture;
  v_po_number := public.next_purchase_order_number_v2();

  insert into public.purchase_orders (
    id,
    project_id,
    construction_site_id,
    vendor_id,
    vendor_name,
    po_number,
    procurement_group_id,
    procurement_group_no,
    items,
    total_amount,
    approved_total_amount,
    vat_rate,
    order_date,
    expected_delivery_date,
    status,
    source_mode,
    target_warehouse_id,
    qr_token,
    received_transaction_ids,
    supplemental_approval_status,
    created_by_id
  ) values (
    v_po_id,
    fixture.project_id,
    fixture.construction_site_id,
    fixture.vendor_id,
    fixture.vendor_name,
    v_po_number,
    v_po_id,
    v_po_number,
    fixture.items,
    500,
    500,
    0,
    current_date::text,
    current_date::text,
    'draft',
    'from_request',
    fixture.target_warehouse_id,
    v_po_id,
    '[]'::jsonb,
    'none',
    fixture.user_id::text
  )
  on conflict (id) do update
  set po_number = excluded.po_number;

  if not exists (
    select 1
    from public.purchase_orders po
    where po.id = v_po_id
      and po.po_number = v_po_number
      and po.created_by_id = fixture.user_id::text
  ) then
    raise exception 'Room-authorized PO UPSERT did not produce a visible row';
  end if;
end $$;

reset role;

select 'material_po_upsert_rls_fix_smoke_passed' as result;

rollback;
