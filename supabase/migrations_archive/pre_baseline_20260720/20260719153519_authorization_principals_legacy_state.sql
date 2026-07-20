drop function if exists public.list_authorization_principals();
drop function if exists app_private.list_authorization_principals_impl();

create or replace function app_private.list_authorization_principals_impl()
returns table (
  user_id uuid,
  name text,
  email text,
  account_status text,
  allowed_modules text[],
  allowed_sub_modules jsonb,
  admin_modules text[],
  admin_sub_modules jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := public.current_app_user_id();
begin
  if not app_private.has_permission(
    v_actor_user_id,
    'system.authorization.view',
    'global',
    '*'
  ) then
    raise exception 'Not allowed to view authorization principals'
      using errcode = '42501';
  end if;

  return query
  select
    user_row.id,
    user_row.name,
    user_row.email,
    user_row.account_status,
    coalesce(user_row.allowed_modules, '{}'::text[]),
    coalesce(user_row.allowed_sub_modules, '{}'::jsonb),
    coalesce(user_row.admin_modules, '{}'::text[]),
    coalesce(user_row.admin_sub_modules, '{}'::jsonb)
  from public.users user_row
  order by user_row.name, user_row.email, user_row.id;
end;
$$;

create or replace function public.list_authorization_principals()
returns table (
  user_id uuid,
  name text,
  email text,
  account_status text,
  allowed_modules text[],
  allowed_sub_modules jsonb,
  admin_modules text[],
  admin_sub_modules jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from app_private.list_authorization_principals_impl();
$$;

revoke all on function app_private.list_authorization_principals_impl()
  from public, anon;
grant execute on function app_private.list_authorization_principals_impl()
  to authenticated;
revoke all on function public.list_authorization_principals()
  from public, anon;
grant execute on function public.list_authorization_principals()
  to authenticated;
