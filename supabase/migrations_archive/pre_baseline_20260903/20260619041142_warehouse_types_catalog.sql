-- Warehouse type catalog for Settings > Kho bãi.
-- Keeps system codes stable while allowing admins to manage labels, colors, and active status.

create table if not exists public.warehouse_types (
  code text primary key,
  name text not null,
  description text,
  color text not null default 'slate',
  is_system boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint warehouse_types_code_format check (code = upper(code) and code ~ '^[A-Z0-9_-]+$'),
  constraint warehouse_types_name_not_blank check (length(trim(name)) > 0)
);

drop trigger if exists trg_warehouse_types_updated_at on public.warehouse_types;
create trigger trg_warehouse_types_updated_at
before update on public.warehouse_types
for each row execute function public.set_updated_at();

insert into public.warehouse_types (code, name, description, color, is_system, is_active, sort_order)
values
  ('GENERAL', 'Kho Tổng', 'Kho trung tâm dùng để nhập, điều phối và xuất vật tư.', 'blue', true, true, 1),
  ('SITE', 'Kho Công Trình', 'Kho gắn với công trình, dùng cho cấp phát và nhận vật tư thi công.', 'orange', true, true, 2),
  ('OFFICE', 'Kho Văn Phòng', 'Kho phục vụ hành chính, văn phòng phẩm hoặc công cụ nội bộ.', 'slate', true, true, 3)
on conflict (code) do update
set
  name = excluded.name,
  description = coalesce(public.warehouse_types.description, excluded.description),
  color = coalesce(public.warehouse_types.color, excluded.color),
  is_system = true,
  is_active = coalesce(public.warehouse_types.is_active, excluded.is_active),
  sort_order = excluded.sort_order,
  updated_at = now();

alter table public.warehouses
  alter column type drop default;

alter table public.warehouses
  alter column type type text using upper(nullif(trim(type::text), ''));

update public.warehouses
set type = 'SITE'
where type is null or trim(type) = '';

insert into public.warehouse_types (code, name, color, is_system, is_active, sort_order)
select distinct
  upper(trim(type)) as code,
  initcap(replace(lower(trim(type)), '_', ' ')) as name,
  'slate' as color,
  false as is_system,
  true as is_active,
  100 as sort_order
from public.warehouses
where nullif(trim(type), '') is not null
on conflict (code) do nothing;

alter table public.warehouses
  alter column type set default 'SITE',
  alter column type set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'warehouses_type_fkey'
      and conrelid = 'public.warehouses'::regclass
  ) then
    alter table public.warehouses
      add constraint warehouses_type_fkey
      foreign key (type)
      references public.warehouse_types(code)
      on update cascade
      on delete restrict;
  end if;
end $$;

alter table public.warehouse_types enable row level security;

grant select on table public.warehouse_types to authenticated;
grant insert, update, delete on table public.warehouse_types to authenticated;
grant select, insert, update, delete on table public.warehouse_types to service_role;

drop policy if exists warehouse_types_select on public.warehouse_types;
drop policy if exists warehouse_types_insert on public.warehouse_types;
drop policy if exists warehouse_types_update on public.warehouse_types;
drop policy if exists warehouse_types_delete on public.warehouse_types;

create policy warehouse_types_select
on public.warehouse_types
for select
to authenticated
using (true);

create policy warehouse_types_insert
on public.warehouse_types
for insert
to authenticated
with check (
  public.is_admin()
  or public.is_module_admin('WMS')
  or public.is_module_admin('SETTINGS')
);

create policy warehouse_types_update
on public.warehouse_types
for update
to authenticated
using (
  public.is_admin()
  or public.is_module_admin('WMS')
  or public.is_module_admin('SETTINGS')
)
with check (
  public.is_admin()
  or public.is_module_admin('WMS')
  or public.is_module_admin('SETTINGS')
);

create policy warehouse_types_delete
on public.warehouse_types
for delete
to authenticated
using (
  not is_system
  and (
    public.is_admin()
    or public.is_module_admin('WMS')
    or public.is_module_admin('SETTINGS')
  )
  and not exists (
    select 1
    from public.warehouses w
    where w.type = public.warehouse_types.code
  )
);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.warehouse_types;
    exception
      when duplicate_object then null;
    end;
  end if;
end $$;
