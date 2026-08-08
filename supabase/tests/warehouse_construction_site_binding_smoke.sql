-- Run after warehouse/construction-site binding migration.
-- Safe on Cloud: all fixture mappings, enforcement flags and inserted lines are rolled back.

begin;

create temp table warehouse_site_binding_fixture on commit drop as
select
  app_user.id as actor_id,
  app_user.auth_id,
  app_user.email,
  rico_site.id as rico_site_id,
  xin_hai_site.id as xin_hai_site_id,
  unbound_site.id as unbound_site_id,
  rico_warehouse.id as rico_warehouse_id,
  xin_hai_warehouse.id as xin_hai_warehouse_id,
  son_warehouse.id as son_warehouse_id,
  note.id as delivery_note_id,
  line.supplier_contract_id,
  line.item_id,
  line.item_name_snapshot
from public.users app_user
cross join lateral (
  select id from public.hrm_construction_sites where name = 'Công trường RICO' limit 1
) rico_site
cross join lateral (
  select id from public.hrm_construction_sites where name = 'Công trường Xin Hai Vina' limit 1
) xin_hai_site
cross join lateral (
  select id
  from public.hrm_construction_sites
  where id not in (rico_site.id, xin_hai_site.id)
  order by name
  limit 1
) unbound_site
cross join lateral (
  select id from public.warehouses where name = 'Kho RICO' limit 1
) rico_warehouse
cross join lateral (
  select id from public.warehouses where name = 'Kho Xin Hai Vina' limit 1
) xin_hai_warehouse
cross join lateral (
  select id from public.warehouses where name = 'Kho Sơn Miền Bắc' limit 1
) son_warehouse
cross join lateral (
  select id
  from public.supplier_direct_delivery_notes
  where code = 'GHHD-20260807-AB132E'
    and construction_site_id = xin_hai_site.id::text
  limit 1
) note
cross join lateral (
  select supplier_contract_id, item_id, item_name_snapshot
  from public.supplier_direct_delivery_lines
  where delivery_note_id = note.id
    and wms_flow_mode = 'direct_in_out'
  limit 1
) line
where app_user.role = 'ADMIN'
  and app_user.auth_id is not null
  and coalesce(app_user.is_active, true)
order by app_user.created_at
limit 1;

do $$
begin
  if not exists (select 1 from warehouse_site_binding_fixture) then
    raise exception 'Missing warehouse/site binding smoke fixture';
  end if;
end $$;

grant select on warehouse_site_binding_fixture to authenticated;

set local role authenticated;

select
  set_config('request.jwt.claim.sub', '', true),
  set_config('request.jwt.claim.email', '', true),
  set_config('request.jwt.claims', '{"role":"authenticated"}', true);

do $$
declare
  fixture warehouse_site_binding_fixture%rowtype;
  rpc_rejected boolean := false;
begin
  if app_private.can_manage_warehouse_site_bindings() then
    raise exception 'Warehouse/site binding permission unexpectedly granted without an authenticated app user';
  end if;

  select * into fixture from warehouse_site_binding_fixture;
  begin
    perform public.set_warehouse_construction_site_binding(
      fixture.rico_warehouse_id,
      fixture.rico_site_id,
      true
    );
  exception when others then
    rpc_rejected := sqlerrm like '%không có quyền%';
  end;

  if not rpc_rejected then
    raise exception 'Warehouse/site binding RPC accepted an unauthenticated app user';
  end if;
end $$;

select
  set_config('request.jwt.claim.sub', auth_id::text, true),
  set_config('request.jwt.claim.email', coalesce(email, ''), true),
  set_config('request.jwt.claims', jsonb_build_object(
    'sub', auth_id::text,
    'email', coalesce(email, ''),
    'role', 'authenticated'
  )::text, true)
from warehouse_site_binding_fixture;

do $$
declare
  fixture warehouse_site_binding_fixture%rowtype;
  valid_line_id uuid := gen_random_uuid();
  created_warehouse_id text := 'warehouse-site-smoke-' || gen_random_uuid()::text;
  next_line_no integer;
  invalid_activation_rejected boolean := false;
  duplicate_default_rejected boolean := false;
  reassignment_rejected boolean := false;
  wrong_warehouse_rejected boolean := false;
  missing_default_rejected boolean := false;
begin
  select * into fixture from warehouse_site_binding_fixture;

  perform public.create_warehouse_with_site_binding(
    created_warehouse_id,
    'Kho smoke test',
    'Rollback sau kiểm thử',
    'SITE',
    fixture.unbound_site_id,
    false
  );

  if not exists (
    select 1
    from public.warehouses
    where id = created_warehouse_id
      and construction_site_id = fixture.unbound_site_id
      and not is_default_for_site
  ) then
    raise exception 'Atomic warehouse create-and-bind RPC did not persist the requested binding';
  end if;

  perform public.set_warehouse_construction_site_binding(
    fixture.rico_warehouse_id,
    fixture.rico_site_id,
    true
  );

  perform public.set_warehouse_construction_site_binding(
    fixture.xin_hai_warehouse_id,
    fixture.xin_hai_site_id,
    true
  );

  perform public.set_warehouse_construction_site_binding(
    fixture.son_warehouse_id,
    fixture.xin_hai_site_id,
    false
  );
  perform public.set_warehouse_construction_site_binding(
    fixture.son_warehouse_id,
    fixture.xin_hai_site_id,
    true
  );
  perform public.set_warehouse_construction_site_binding(
    fixture.xin_hai_warehouse_id,
    fixture.xin_hai_site_id,
    true
  );

  begin
    perform public.set_construction_site_warehouse_enforcement(fixture.unbound_site_id, true);
  exception when others then
    invalid_activation_rejected := sqlerrm like '%kho mặc định%';
  end;

  if not invalid_activation_rejected then
    raise exception 'Enforcement without one valid default warehouse was accepted';
  end if;

  begin
    update public.warehouses
    set construction_site_id = fixture.xin_hai_site_id,
        is_default_for_site = true
    where id = fixture.son_warehouse_id;
  exception when unique_violation then
    duplicate_default_rejected := true;
  end;

  if not duplicate_default_rejected then
    raise exception 'Two default warehouses for one site were accepted';
  end if;

  begin
    update public.warehouses
    set construction_site_id = fixture.xin_hai_site_id
    where id = fixture.rico_warehouse_id;
  exception when others then
    reassignment_rejected := sqlerrm like '%đã phát sinh tồn kho/WMS%';
  end;

  if not reassignment_rejected then
    raise exception 'Used linked warehouse was reassigned to another site';
  end if;

  perform public.set_construction_site_warehouse_enforcement(fixture.xin_hai_site_id, true);
  perform public.set_construction_site_warehouse_enforcement(fixture.rico_site_id, true);

  begin
    update public.warehouses
    set is_default_for_site = false
    where id = fixture.xin_hai_warehouse_id;
    set constraints trg_validate_enforced_site_warehouse_default immediate;
  exception when others then
    missing_default_rejected := sqlerrm like '%đúng một kho mặc định%';
  end;
  set constraints trg_validate_enforced_site_warehouse_default deferred;

  if not missing_default_rejected then
    raise exception 'Locked site was allowed to lose its default warehouse';
  end if;

  select coalesce(max(line_no), 0) + 1000 into next_line_no
  from public.supplier_direct_delivery_lines
  where delivery_note_id = fixture.delivery_note_id;

  begin
    insert into public.supplier_direct_delivery_lines (
      delivery_note_id,
      supplier_contract_id,
      line_no,
      item_id,
      item_name_snapshot,
      quantity,
      wms_flow_mode,
      target_warehouse_id,
      wms_status
    ) values (
      fixture.delivery_note_id,
      fixture.supplier_contract_id,
      next_line_no,
      fixture.item_id,
      fixture.item_name_snapshot,
      1,
      'direct_in_out',
      fixture.rico_warehouse_id,
      'not_required'
    );
  exception when others then
    wrong_warehouse_rejected := sqlerrm like '%không thuộc công trường%';
  end;

  if not wrong_warehouse_rejected then
    raise exception 'Direct delivery accepted a warehouse from another site';
  end if;

  insert into public.supplier_direct_delivery_lines (
    id,
    delivery_note_id,
    supplier_contract_id,
    line_no,
    item_id,
    item_name_snapshot,
    quantity,
    wms_flow_mode,
    target_warehouse_id,
    wms_status
  ) values (
    valid_line_id,
    fixture.delivery_note_id,
    fixture.supplier_contract_id,
    next_line_no,
    fixture.item_id,
    fixture.item_name_snapshot,
    1,
    'direct_in_out',
    fixture.xin_hai_warehouse_id,
    'not_required'
  );

  if not exists (
    select 1
    from public.supplier_direct_delivery_lines
    where id = valid_line_id
      and target_warehouse_id = fixture.xin_hai_warehouse_id
  ) then
    raise exception 'Direct delivery rejected the valid warehouse from its own site';
  end if;

  if not exists (
    select 1
    from public.supplier_direct_delivery_notes note
    join public.supplier_direct_delivery_lines line on line.delivery_note_id = note.id
    where note.code = 'GHHD-20260807-AB132E'
      and line.target_warehouse_id = fixture.rico_warehouse_id
  ) then
    raise exception 'Historical cross-site delivery exception was changed';
  end if;
end $$;

reset role;

do $$
declare
  fixture warehouse_site_binding_fixture%rowtype;
  note_site_change_rejected boolean := false;
begin
  select * into fixture from warehouse_site_binding_fixture;

  begin
    update public.supplier_direct_delivery_notes
    set construction_site_id = fixture.rico_site_id::text
    where id = fixture.delivery_note_id;
  exception when others then
    note_site_change_rejected := sqlerrm like '%Không thể chuyển phiếu giao%';
  end;

  if not note_site_change_rejected then
    raise exception 'Delivery note site changed while retaining a warehouse from the previous site';
  end if;
end $$;

select 'warehouse_construction_site_binding_smoke_passed' as result;

rollback;
