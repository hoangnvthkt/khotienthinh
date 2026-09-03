-- Make app-user profile rows durable and writable by real authenticated admins.
-- The frontend uses public.users for app roles, while Supabase Auth owns login.

alter table public.users
  add column if not exists auth_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_auth_id_fkey'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_auth_id_fkey
      foreign key (auth_id) references auth.users(id)
      on delete set null;
  end if;
end $$;

create unique index if not exists users_auth_id_unique
  on public.users (auth_id)
  where auth_id is not null;

alter table public.users
  add column if not exists is_active boolean;

update public.users
set is_active = true
where is_active is null;

alter table public.users
  alter column is_active set default true,
  alter column is_active set not null;

update public.users u
set auth_id = au.id
from auth.users au
where u.auth_id is null
  and lower(u.email) = lower(au.email);

create or replace function public.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from public.users u
  where u.auth_id = (select auth.uid())
     or (
       u.auth_id is null
       and lower(u.email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
     )
  order by case when u.auth_id = (select auth.uid()) then 0 else 1 end
  limit 1;
$$;

revoke all on function public.current_app_user_id() from public;
grant execute on function public.current_app_user_id() to authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users u
    where u.id = public.current_app_user_id()
      and u.role = 'ADMIN'
      and coalesce(u.is_active, true)
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create or replace function public.is_module_admin(p_module text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users u
    where u.id = public.current_app_user_id()
      and coalesce(u.is_active, true)
      and (
        u.role = 'ADMIN'
        or p_module = any(coalesce(u.admin_modules, '{}'::text[]))
        or coalesce(u.admin_sub_modules, '{}'::jsonb) ? p_module
      )
  );
$$;

revoke all on function public.is_module_admin(text) from public;
grant execute on function public.is_module_admin(text) to authenticated;

create or replace function public.lookup_login_email(p_username text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.email
  from public.users u
  where lower(u.username) = lower(p_username)
    and coalesce(u.is_active, true)
  limit 1;
$$;

revoke all on function public.lookup_login_email(text) from public;
grant execute on function public.lookup_login_email(text) to anon, authenticated;

alter table public.users enable row level security;

drop policy if exists users_select on public.users;
drop policy if exists users_insert on public.users;
drop policy if exists users_update on public.users;
drop policy if exists users_delete on public.users;
drop policy if exists users_write on public.users;

create policy users_select
on public.users for select
to authenticated
using (true);

create policy users_insert
on public.users for insert
to authenticated
with check (public.is_admin());

create policy users_update
on public.users for update
to authenticated
using (public.is_admin() or id = public.current_app_user_id())
with check (public.is_admin() or id = public.current_app_user_id());

create policy users_delete
on public.users for delete
to authenticated
using (public.is_admin() and id <> public.current_app_user_id());

grant select, insert, update, delete on public.users to authenticated;

notify pgrst, 'reload schema';
