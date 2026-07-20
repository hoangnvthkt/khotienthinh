create table if not exists public.material_code_requests (
  id text primary key,
  code text not null unique,
  requested_by_user_id uuid references public.users(id) on delete set null,
  requested_by_name text,
  proposed_name text not null,
  proposed_unit text not null,
  proposed_category text,
  proposed_specification text,
  proposed_supplier_id text,
  reason text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  approved_sku text,
  approved_item_id text references public.items(id) on delete set null,
  approved_by_user_id uuid references public.users(id) on delete set null,
  approved_by_name text,
  approved_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index if not exists material_code_requests_status_idx
  on public.material_code_requests(status);

create index if not exists material_code_requests_requested_by_idx
  on public.material_code_requests(requested_by_user_id);

create index if not exists material_code_requests_created_at_idx
  on public.material_code_requests(created_at desc);

alter table public.material_code_requests enable row level security;

drop policy if exists material_code_requests_select on public.material_code_requests;
create policy material_code_requests_select
on public.material_code_requests
for select
to authenticated
using (
  public.is_module_admin('WMS')
  or requested_by_user_id = public.current_app_user_id()
  or exists (
    select 1
    from public.users u
    where u.id = public.current_app_user_id()
      and u.role = 'WAREHOUSE_KEEPER'
      and u.assigned_warehouse_id is null
      and coalesce(u.is_active, true)
  )
);

drop policy if exists material_code_requests_insert on public.material_code_requests;
create policy material_code_requests_insert
on public.material_code_requests
for insert
to authenticated
with check (
  requested_by_user_id = public.current_app_user_id()
  or public.is_module_admin('WMS')
);

drop policy if exists material_code_requests_update on public.material_code_requests;
create policy material_code_requests_update
on public.material_code_requests
for update
to authenticated
using (
  public.is_module_admin('WMS')
  or exists (
    select 1
    from public.users u
    where u.id = public.current_app_user_id()
      and u.role = 'WAREHOUSE_KEEPER'
      and u.assigned_warehouse_id is null
      and coalesce(u.is_active, true)
  )
)
with check (
  public.is_module_admin('WMS')
  or exists (
    select 1
    from public.users u
    where u.id = public.current_app_user_id()
      and u.role = 'WAREHOUSE_KEEPER'
      and u.assigned_warehouse_id is null
      and coalesce(u.is_active, true)
  )
);

drop policy if exists material_code_requests_delete on public.material_code_requests;
create policy material_code_requests_delete
on public.material_code_requests
for delete
to authenticated
using (public.is_module_admin('WMS'));

revoke all on public.material_code_requests from public;
revoke all on public.material_code_requests from anon;
grant select, insert, update, delete on public.material_code_requests to authenticated;

notify pgrst, 'reload schema';
