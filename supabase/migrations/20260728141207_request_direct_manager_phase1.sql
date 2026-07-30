alter table public.users
  add column if not exists manager_id uuid references public.users(id) on delete set null;

create index if not exists idx_users_manager_id
  on public.users(manager_id)
  where manager_id is not null;

create or replace function app_private.resolve_request_direct_manager(p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select manager.id
  from public.users employee
  join public.users manager on manager.id = employee.manager_id
  where employee.id = p_user_id
    and coalesce(manager.is_active, true)
    and coalesce(manager.account_status, 'ACTIVE') = 'ACTIVE';
$$;

revoke all on function app_private.resolve_request_direct_manager(uuid) from public, anon;
revoke all on function app_private.resolve_request_direct_manager(uuid) from authenticated;
