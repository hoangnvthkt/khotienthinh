-- Run after the G2 allocation smoke in the same rollback-only Cloud transaction.

create temporary table g2_auth_ids(
  position_id uuid not null,
  price_reader_id uuid not null,
  edit_without_price_id uuid not null,
  inactive_id uuid not null
) on commit drop;
insert into g2_auth_ids values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid());

insert into public.users(id, name, email, username, role, is_active)
select price_reader_id, 'G2 Price Reader', 'g2-price-reader@example.invalid', price_reader_id::text, 'EMPLOYEE'::public.user_role, true
from g2_auth_ids
union all
select edit_without_price_id, 'G2 Edit Without Price', 'g2-edit-only@example.invalid', edit_without_price_id::text, 'EMPLOYEE'::public.user_role, true
from g2_auth_ids
union all
select inactive_id, 'G2 Inactive', 'g2-inactive@example.invalid', inactive_id::text, 'EMPLOYEE'::public.user_role, false
from g2_auth_ids;

insert into public.hrm_positions(id, name, level, code, is_active, sort_order, source, metadata)
select position_id, 'G2 authorization position', 1, 'G2-AUTH', true, 0, 'smoke', '{}'::jsonb
from g2_auth_ids;

insert into public.project_staff(id, project_id, construction_site_id, user_id, position_id, start_date, note)
select gen_random_uuid(), 'g2-allocation-project', 'g2-allocation-site', price_reader_id::text,
  position_id, current_date, 'price reader' from g2_auth_ids
union all
select gen_random_uuid(), 'g2-allocation-project', 'g2-allocation-site', edit_without_price_id::text,
  position_id, current_date, 'edit without price' from g2_auth_ids;

insert into public.project_permission_room_members(
  project_id, construction_site_id, room_code, project_staff_id, is_active
)
select 'g2-allocation-project', 'g2-allocation-site', room.code, staff.id, true
from public.project_staff staff
cross join (values ('material_request'), ('material_po')) room(code)
where staff.project_id = 'g2-allocation-project'
  and staff.user_id in (
    (select price_reader_id::text from g2_auth_ids),
    (select edit_without_price_id::text from g2_auth_ids)
  );

insert into public.project_permission_room_member_actions(room_member_id, action_code, is_active)
select member.id,
  case
    when member.room_code = 'material_request' then 'view'
    when staff.user_id = ids.price_reader_id::text then 'view'
    else 'edit'
  end,
  true
from public.project_permission_room_members member
join public.project_staff staff on staff.id = member.project_staff_id
cross join g2_auth_ids ids
where member.project_id = 'g2-allocation-project'
  and staff.user_id in (ids.price_reader_id::text, ids.edit_without_price_id::text);

do $$
declare ids g2_auth_ids%rowtype; v_price jsonb; v_edit jsonb;
begin
  select * into strict ids from g2_auth_ids;
  v_price := app_private.procurement_access_v1(
    ids.price_reader_id, 'g2-allocation-project', 'g2-allocation-site'
  );
  if v_price <> '{"canRead":true,"canViewPrice":true,"canAllocate":false}'::jsonb then
    raise exception 'G2_T5_PRICE_ONLY_ACCESS_FAILED: %', v_price;
  end if;
  v_edit := app_private.procurement_access_v1(
    ids.edit_without_price_id, 'g2-allocation-project', 'g2-allocation-site'
  );
  if coalesce((v_edit ->> 'canRead')::boolean, false) is not true
     or coalesce((v_edit ->> 'canViewPrice')::boolean, false) is true
     or coalesce((v_edit ->> 'canAllocate')::boolean, false) is true then
    raise exception 'G2_T5_EDIT_WITHOUT_PREREQUISITE_FAILED: %', v_edit;
  end if;
end $$;

select set_config('request.jwt.claims', '{"email":"g2-price-reader@example.invalid"}', true);

do $$
declare v_access jsonb; v_rows jsonb;
begin
  select public.get_procurement_access_v1('g2-allocation-project', 'g2-allocation-site') into v_access;
  if v_access <> '{"canRead":true,"canViewPrice":true,"canAllocate":false}'::jsonb then
    raise exception 'G2_T5_PUBLIC_ACCESS_FAILED: %', v_access;
  end if;
  select public.list_procurement_demand_balances_v1('g2-allocation-project', 'g2-allocation-site') into v_rows;
  if jsonb_array_length(v_rows) <> 1
     or v_rows -> 0 ->> 'availableToPlanQty' <> '40.000000'
     or (v_rows -> 0 ->> 'remainingKnown')::boolean is not true
     or (v_rows -> 0 ->> 'canViewPrice')::boolean is not true
     or (v_rows -> 0 ->> 'canAllocate')::boolean is true
     or v_rows -> 0 ? 'unitPrice' then
    raise exception 'G2_T5_SCOPED_READ_FAILED: %', v_rows;
  end if;
  begin
    perform public.list_procurement_demand_balances_v1('g2-other-project', null);
    raise exception 'G2_T5_CROSS_PROJECT_NOT_DENIED';
  exception when sqlstate '42501' then
    if sqlerrm <> 'PROCUREMENT_READ_DENIED' then raise; end if;
  end;
  begin
    perform public.save_procurement_allocation_v1(
      (select id from public.procurement_demand_lines limit 1),
      (select current_source_revision_id from public.procurement_demand_lines limit 1),
      (select execution_source_line_registry_id from public.procurement_supply_allocations limit 1),
      'po', 'committed', 0, 10, 'kg', 10, 'kg', 1, 1, 3,
      'Price-only actor cannot allocate', 'g2-auth-denied-allocation'
    );
    raise exception 'G2_T5_VIEW_ONLY_MUTATION_NOT_DENIED';
  exception when sqlstate '42501' then
    if sqlerrm <> 'PROCUREMENT_ACCESS_DENIED' then raise; end if;
  end;
end $$;

set local role authenticated;
do $$
begin
  begin
    insert into public.procurement_supply_allocations default values;
    raise exception 'G2_T5_DIRECT_DML_NOT_DENIED';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select set_config('request.jwt.claims', '{"email":"g2-inactive@example.invalid"}', true);
do $$
begin
  begin
    perform public.get_procurement_access_v1('g2-allocation-project', 'g2-allocation-site');
    raise exception 'G2_T5_INACTIVE_ACTOR_NOT_DENIED';
  exception when sqlstate '42501' then
    if sqlerrm <> 'PROCUREMENT_ACCESS_DENIED' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claims', '{"email":"g2-allocation@example.invalid"}', true);
update public.project_permission_room_member_actions action set is_active = false
from public.project_permission_room_members member
join public.project_staff staff on staff.id = member.project_staff_id
join g2_auth_ids ids on staff.user_id = ids.price_reader_id::text
where action.room_member_id = member.id and member.room_code = 'material_po'
  and action.action_code = 'view';

do $$
declare ids g2_auth_ids%rowtype; v_access jsonb;
begin
  select * into strict ids from g2_auth_ids;
  v_access := app_private.procurement_access_v1(
    ids.price_reader_id, 'g2-allocation-project', 'g2-allocation-site'
  );
  if coalesce((v_access ->> 'canRead')::boolean, false) is not true
     or coalesce((v_access ->> 'canViewPrice')::boolean, false) is true
     or coalesce((v_access ->> 'canAllocate')::boolean, false) is true then
    raise exception 'G2_T5_REVOKED_PERMISSION_FAILED: %', v_access;
  end if;
end $$;
