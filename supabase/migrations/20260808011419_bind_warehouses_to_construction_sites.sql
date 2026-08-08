alter table public.warehouses
  add column if not exists construction_site_id uuid,
  add column if not exists is_default_for_site boolean not null default false;

alter table public.hrm_construction_sites
  add column if not exists warehouse_binding_enforced boolean not null default false;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'warehouses_construction_site_id_fkey'
      and conrelid = 'public.warehouses'::regclass
  ) then
    alter table public.warehouses
      add constraint warehouses_construction_site_id_fkey
      foreign key (construction_site_id)
      references public.hrm_construction_sites(id)
      on delete restrict;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'warehouses_default_for_site_check'
      and conrelid = 'public.warehouses'::regclass
  ) then
    alter table public.warehouses
      add constraint warehouses_default_for_site_check
      check (
        not is_default_for_site
        or (
          construction_site_id is not null
          and type = 'SITE'
          and not coalesce(is_archived, false)
        )
      );
  end if;
end $$;

create index if not exists idx_warehouses_construction_site_id
  on public.warehouses(construction_site_id)
  where construction_site_id is not null;

create unique index if not exists idx_warehouses_one_default_per_site
  on public.warehouses(construction_site_id)
  where is_default_for_site;

comment on column public.warehouses.construction_site_id is
  'Công trường sở hữu kho. Một kho chỉ được liên kết với tối đa một công trường.';
comment on column public.warehouses.is_default_for_site is
  'Kho SITE active được tự chọn khi tạo phiếu giao HĐ NCC tại công trường.';
comment on column public.hrm_construction_sites.warehouse_binding_enforced is
  'Khi bật, phiếu giao HĐ NCC chỉ nhận kho SITE active thuộc công trường này.';

create or replace function app_private.can_manage_warehouse_site_bindings()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_admin()
    or public.is_module_admin('WMS')
    or public.is_module_admin('SETTINGS')
    or app_private.wms_has_action('wms.master_data.manage');
$$;

revoke all on function app_private.can_manage_warehouse_site_bindings() from public, anon;
grant execute on function app_private.can_manage_warehouse_site_bindings() to authenticated, service_role;

drop policy if exists warehouses_phase4_select on public.warehouses;
create policy warehouses_phase4_select
on public.warehouses
for select
to authenticated
using (
  (select app_private.can_manage_warehouse_site_bindings())
  or (select app_private.wms_has_action('wms.inventory.view'))
);

create or replace function app_private.guard_used_warehouse_site_reassignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.construction_site_id is null
     or new.construction_site_id is not distinct from old.construction_site_id
  then
    return new;
  end if;

  if exists (
    select 1
    from public.inventory_balances balance
    where balance.warehouse_id = old.id
      and coalesce(balance.on_hand_qty, 0) <> 0
  ) or exists (
    select 1
    from public.transactions transaction_row
    where transaction_row.source_warehouse_id = old.id
       or transaction_row.target_warehouse_id = old.id
  ) or exists (
    select 1
    from public.supplier_direct_delivery_lines delivery_line
    where delivery_line.target_warehouse_id = old.id
      and (
        delivery_line.wms_import_transaction_id is not null
        or delivery_line.wms_export_transaction_id is not null
      )
  ) then
    raise exception 'Kho % đã phát sinh tồn kho/WMS nên không thể chuyển sang công trường khác. Hãy tạo kho mới hoặc dùng quy trình sửa dữ liệu có kiểm soát.', old.name;
  end if;

  return new;
end;
$$;

revoke all on function app_private.guard_used_warehouse_site_reassignment() from public, anon, authenticated;

drop trigger if exists trg_guard_used_warehouse_site_reassignment on public.warehouses;
create trigger trg_guard_used_warehouse_site_reassignment
before update of construction_site_id on public.warehouses
for each row
execute function app_private.guard_used_warehouse_site_reassignment();

create or replace function app_private.validate_site_warehouse_enforcement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_eligible_count integer;
  v_default_count integer;
begin
  if not new.warehouse_binding_enforced
     or new.warehouse_binding_enforced is not distinct from old.warehouse_binding_enforced
  then
    return new;
  end if;

  select
    count(*) filter (
      where warehouse.type = 'SITE'
        and not coalesce(warehouse.is_archived, false)
    ),
    count(*) filter (
      where warehouse.type = 'SITE'
        and not coalesce(warehouse.is_archived, false)
        and warehouse.is_default_for_site
    )
  into v_eligible_count, v_default_count
  from public.warehouses warehouse
  where warehouse.construction_site_id = new.id;

  if v_eligible_count < 1 or v_default_count <> 1 then
    raise exception 'Công trường % phải có ít nhất một kho SITE đang hoạt động và đúng một kho mặc định trước khi bật khóa kho.', new.name;
  end if;

  return new;
end;
$$;

revoke all on function app_private.validate_site_warehouse_enforcement() from public, anon, authenticated;

drop trigger if exists trg_validate_site_warehouse_enforcement on public.hrm_construction_sites;
create trigger trg_validate_site_warehouse_enforcement
before update of warehouse_binding_enforced on public.hrm_construction_sites
for each row
execute function app_private.validate_site_warehouse_enforcement();

create or replace function public.set_construction_site_warehouse_enforcement(
  p_construction_site_id uuid,
  p_enforced boolean
)
returns public.hrm_construction_sites
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site public.hrm_construction_sites%rowtype;
begin
  if not app_private.can_manage_warehouse_site_bindings() then
    raise exception 'Bạn không có quyền bật/tắt khóa kho cho công trường.';
  end if;

  update public.hrm_construction_sites
  set warehouse_binding_enforced = coalesce(p_enforced, false)
  where id = p_construction_site_id
  returning * into v_site;

  if not found then
    raise exception 'Không tìm thấy công trường %. ', p_construction_site_id;
  end if;

  return v_site;
end;
$$;

revoke all on function public.set_construction_site_warehouse_enforcement(uuid, boolean) from public, anon;
grant execute on function public.set_construction_site_warehouse_enforcement(uuid, boolean) to authenticated;

create or replace function public.create_warehouse_with_site_binding(
  p_warehouse_id text,
  p_name text,
  p_address text,
  p_type text,
  p_construction_site_id uuid default null,
  p_is_default_for_site boolean default false
)
returns public.warehouses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_warehouse public.warehouses%rowtype;
begin
  if not app_private.can_manage_warehouse_site_bindings() then
    raise exception 'Bạn không có quyền tạo và gán kho vào công trường.';
  end if;

  if nullif(btrim(p_warehouse_id), '') is null
     or nullif(btrim(p_name), '') is null
     or nullif(btrim(p_type), '') is null
  then
    raise exception 'Kho mới phải có mã, tên và loại kho.';
  end if;

  if coalesce(p_is_default_for_site, false)
     and (p_construction_site_id is null or p_type <> 'SITE')
  then
    raise exception 'Kho mặc định phải là kho SITE đang hoạt động và đã liên kết công trường.';
  end if;

  if exists (select 1 from public.warehouses where id = p_warehouse_id) then
    raise exception 'Mã kho % đã tồn tại.', p_warehouse_id;
  end if;

  if coalesce(p_is_default_for_site, false) then
    update public.warehouses
    set is_default_for_site = false
    where construction_site_id = p_construction_site_id
      and is_default_for_site;
  end if;

  insert into public.warehouses (
    id, name, address, type, is_archived, construction_site_id, is_default_for_site
  ) values (
    p_warehouse_id,
    btrim(p_name),
    coalesce(p_address, ''),
    btrim(p_type),
    false,
    p_construction_site_id,
    coalesce(p_is_default_for_site, false)
  )
  returning * into v_warehouse;

  return v_warehouse;
end;
$$;

revoke all on function public.create_warehouse_with_site_binding(text, text, text, text, uuid, boolean) from public, anon;
grant execute on function public.create_warehouse_with_site_binding(text, text, text, text, uuid, boolean) to authenticated;

create or replace function public.set_warehouse_construction_site_binding(
  p_warehouse_id text,
  p_construction_site_id uuid,
  p_is_default_for_site boolean default false,
  p_name text default null,
  p_address text default null,
  p_type text default null
)
returns public.warehouses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_warehouse public.warehouses%rowtype;
begin
  if not app_private.can_manage_warehouse_site_bindings() then
    raise exception 'Bạn không có quyền gán kho vào công trường.';
  end if;

  select * into v_warehouse
  from public.warehouses
  where id = p_warehouse_id
  for update;

  if not found then
    raise exception 'Không tìm thấy kho %. ', p_warehouse_id;
  end if;

  if coalesce(p_is_default_for_site, false)
     and (
       p_construction_site_id is null
       or coalesce(nullif(btrim(p_type), ''), v_warehouse.type) <> 'SITE'
       or coalesce(v_warehouse.is_archived, false)
     )
  then
    raise exception 'Kho mặc định phải là kho SITE đang hoạt động và đã liên kết công trường.';
  end if;

  if coalesce(p_is_default_for_site, false) then
    update public.warehouses
    set is_default_for_site = false
    where construction_site_id = p_construction_site_id
      and id <> p_warehouse_id
      and is_default_for_site;
  end if;

  update public.warehouses
  set
    name = coalesce(nullif(btrim(p_name), ''), name),
    address = coalesce(p_address, address),
    type = coalesce(nullif(btrim(p_type), ''), type),
    construction_site_id = p_construction_site_id,
    is_default_for_site = coalesce(p_is_default_for_site, false)
  where id = p_warehouse_id;

  select * into v_warehouse
  from public.warehouses
  where id = p_warehouse_id;

  return v_warehouse;
end;
$$;

revoke all on function public.set_warehouse_construction_site_binding(text, uuid, boolean, text, text, text) from public, anon;
grant execute on function public.set_warehouse_construction_site_binding(text, uuid, boolean, text, text, text) to authenticated;

create or replace function app_private.validate_enforced_site_warehouse_default()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_site_name text;
  v_default_count integer;
begin
  for v_site_id in
    select distinct affected.site_id
    from (
      select case when tg_op <> 'INSERT' then old.construction_site_id end as site_id
      union all
      select case when tg_op <> 'DELETE' then new.construction_site_id end as site_id
    ) affected
    where affected.site_id is not null
  loop
    select site.name into v_site_name
    from public.hrm_construction_sites site
    where site.id = v_site_id
      and site.warehouse_binding_enforced;

    if not found then
      continue;
    end if;

    select count(*) into v_default_count
    from public.warehouses warehouse
    where warehouse.construction_site_id = v_site_id
      and warehouse.type = 'SITE'
      and not coalesce(warehouse.is_archived, false)
      and warehouse.is_default_for_site;

    if v_default_count <> 1 then
      raise exception 'Công trường % đã khóa kho và phải luôn có đúng một kho mặc định đang hoạt động.', v_site_name;
    end if;
  end loop;

  return null;
end;
$$;

revoke all on function app_private.validate_enforced_site_warehouse_default() from public, anon, authenticated;

drop trigger if exists trg_validate_enforced_site_warehouse_default on public.warehouses;
create constraint trigger trg_validate_enforced_site_warehouse_default
after insert or update or delete on public.warehouses
deferrable initially deferred
for each row
execute function app_private.validate_enforced_site_warehouse_default();

create or replace function app_private.guard_supplier_delivery_note_site_binding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site public.hrm_construction_sites%rowtype;
begin
  if new.construction_site_id is not distinct from old.construction_site_id then
    return new;
  end if;

  select * into v_site
  from public.hrm_construction_sites site
  where site.id::text = new.construction_site_id;

  if not found or not v_site.warehouse_binding_enforced then
    return new;
  end if;

  if exists (
    select 1
    from public.supplier_direct_delivery_lines delivery_line
    left join public.warehouses warehouse on warehouse.id = delivery_line.target_warehouse_id
    where delivery_line.delivery_note_id = new.id
      and coalesce(delivery_line.wms_flow_mode, 'none') = 'direct_in_out'
      and (
        warehouse.id is null
        or coalesce(warehouse.is_archived, false)
        or warehouse.type <> 'SITE'
        or warehouse.construction_site_id is distinct from v_site.id
      )
  ) then
    raise exception 'Không thể chuyển phiếu giao sang công trường % vì kho nhận hiện tại không thuộc công trường này.', v_site.name;
  end if;

  return new;
end;
$$;

revoke all on function app_private.guard_supplier_delivery_note_site_binding() from public, anon, authenticated;

drop trigger if exists trg_guard_supplier_delivery_note_site_binding
on public.supplier_direct_delivery_notes;
create trigger trg_guard_supplier_delivery_note_site_binding
before update of construction_site_id
on public.supplier_direct_delivery_notes
for each row
execute function app_private.guard_supplier_delivery_note_site_binding();

create or replace function app_private.guard_supplier_delivery_warehouse_site_binding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note public.supplier_direct_delivery_notes%rowtype;
  v_site public.hrm_construction_sites%rowtype;
  v_warehouse public.warehouses%rowtype;
begin
  if tg_op = 'UPDATE'
     and new.delivery_note_id is not distinct from old.delivery_note_id
     and new.wms_flow_mode is not distinct from old.wms_flow_mode
     and new.target_warehouse_id is not distinct from old.target_warehouse_id
  then
    return new;
  end if;

  if coalesce(new.wms_flow_mode, 'none') <> 'direct_in_out' then
    return new;
  end if;

  select * into v_note
  from public.supplier_direct_delivery_notes
  where id = new.delivery_note_id;

  if not found or v_note.construction_site_id is null then
    return new;
  end if;

  select * into v_site
  from public.hrm_construction_sites
  where id = v_note.construction_site_id::uuid;

  if not found or not v_site.warehouse_binding_enforced then
    return new;
  end if;

  select * into v_warehouse
  from public.warehouses
  where id = new.target_warehouse_id;

  if not found
     or coalesce(v_warehouse.is_archived, false)
     or v_warehouse.type <> 'SITE'
     or v_warehouse.construction_site_id is distinct from v_site.id
  then
    raise exception 'Kho nhận không thuộc công trường % hoặc không còn là kho SITE đang hoạt động.', v_site.name;
  end if;

  return new;
end;
$$;

revoke all on function app_private.guard_supplier_delivery_warehouse_site_binding() from public, anon, authenticated;

drop trigger if exists trg_guard_supplier_delivery_warehouse_site_binding
on public.supplier_direct_delivery_lines;
create trigger trg_guard_supplier_delivery_warehouse_site_binding
before insert or update of delivery_note_id, wms_flow_mode, target_warehouse_id
on public.supplier_direct_delivery_lines
for each row
execute function app_private.guard_supplier_delivery_warehouse_site_binding();

notify pgrst, 'reload schema';
