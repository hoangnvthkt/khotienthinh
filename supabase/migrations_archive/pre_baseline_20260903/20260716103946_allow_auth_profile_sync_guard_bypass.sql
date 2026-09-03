-- Let trusted Supabase internals update public.users while preserving the
-- self-profile privilege guard for normal authenticated users.
--
-- Supabase Auth creates a user, then may update auth.users metadata in the
-- same flow. Our auth.users sync trigger updates public.users during that
-- internal update, so this guard must allow the supabase_auth_admin session.

create or replace function app_private.prevent_users_privilege_self_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid;
begin
  if session_user = 'supabase_auth_admin'
    or auth.role() = 'service_role'
  then
    return new;
  end if;

  if public.is_admin() then
    return new;
  end if;

  current_user_id := public.current_app_user_id();

  if current_user_id is null
    or old.id is distinct from current_user_id
    or new.id is distinct from current_user_id
  then
    raise exception 'Only admins can update other user rows'
      using errcode = '42501';
  end if;

  if old.role is distinct from new.role
    or old.auth_id is distinct from new.auth_id
    or old.email is distinct from new.email
    or old.username is distinct from new.username
    or old.assigned_warehouse_id is distinct from new.assigned_warehouse_id
    or old.allowed_modules is distinct from new.allowed_modules
    or old.admin_modules is distinct from new.admin_modules
    or old.allowed_sub_modules is distinct from new.allowed_sub_modules
    or old.admin_sub_modules is distinct from new.admin_sub_modules
    or old.is_active is distinct from new.is_active
  then
    raise exception 'Self profile updates cannot change protected permission fields'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function app_private.prevent_users_privilege_self_update() from public;
revoke all on function app_private.prevent_users_privilege_self_update() from anon;
revoke all on function app_private.prevent_users_privilege_self_update() from authenticated;
