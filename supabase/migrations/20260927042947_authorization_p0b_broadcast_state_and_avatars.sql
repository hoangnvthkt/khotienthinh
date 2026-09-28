-- Authorization remediation P0-B (part 2). Apply only after the frontend that
-- uses mark_my_notifications and /default-avatar.svg is live in production.

-- 1. Broadcast rows are shared: nobody but Admin updates them. Each user's
--    read/dismiss state lives in notification_broadcast_receipts.
alter policy notifications_update on public.notifications
  using (user_id = (public.current_app_user_id())::text or public.is_admin())
  with check (user_id = (public.current_app_user_id())::text or public.is_admin());

-- 2. Avatars no longer send emails or names to third-party services. The
--    default is served by the web app; an update keeps the current avatar.
create or replace function public.sync_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_requested_username text := coalesce(
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    new.id::text
  );
  v_safe_username text := v_requested_username;
  v_name text := coalesce(
    nullif(new.raw_user_meta_data ->> 'name', ''),
    v_requested_username
  );
  v_phone text := nullif(new.raw_user_meta_data ->> 'phone', '');
  v_avatar text := nullif(new.raw_user_meta_data ->> 'avatar', '');
  v_existing_profile_id uuid;
begin
  select user_row.id
    into v_existing_profile_id
  from public.users user_row
  where user_row.auth_id = new.id
     or (
       new.email is not null
       and lower(user_row.email) = lower(new.email)
     )
  order by
    case
      when user_row.auth_id = new.id then 0
      when new.email is not null and lower(user_row.email) = lower(new.email) then 1
      else 2
    end,
    user_row.created_at nulls last,
    user_row.id
  limit 1
  for update;

  if v_existing_profile_id is not null then
    update public.users
    set auth_id = case
          when public.users.auth_id is null or public.users.auth_id = new.id
            then new.id
          else public.users.auth_id
        end,
        name = coalesce(nullif(v_name, ''), public.users.name),
        email = coalesce(new.email, public.users.email),
        phone = coalesce(v_phone, public.users.phone),
        avatar = coalesce(v_avatar, public.users.avatar),
        updated_at = now()
    where id = v_existing_profile_id;

    return new;
  end if;

  if exists (
    select 1
    from public.users
    where lower(username) = lower(v_safe_username)
      and email is distinct from new.email
  ) then
    v_safe_username := v_safe_username || '-' || left(new.id::text, 8);
  end if;

  insert into public.users (
    id,
    auth_id,
    name,
    email,
    username,
    phone,
    role,
    avatar,
    assigned_warehouse_id,
    is_active,
    account_status
  )
  values (
    new.id,
    new.id,
    v_name,
    new.email,
    v_safe_username,
    v_phone,
    'EMPLOYEE'::public.user_role,
    coalesce(v_avatar, '/default-avatar.svg'),
    null,
    true,
    'ACTIVE'
  )
  on conflict (id) do update
  set auth_id = coalesce(public.users.auth_id, excluded.auth_id),
      name = excluded.name,
      email = excluded.email,
      phone = excluded.phone,
      avatar = coalesce(v_avatar, public.users.avatar),
      updated_at = now();

  return new;
end;
$function$;
revoke execute on function public.sync_auth_user_profile() from public, anon;

-- The self-update guard needs a signed-in actor; this data fix has none and
-- only touches avatar, which the guard does not protect. The table stays
-- locked for the whole migration, so no other write runs unguarded.
alter table public.users disable trigger trg_users_prevent_privilege_self_update;
update public.users
set avatar = '/default-avatar.svg'
where avatar ~* '(pravatar\.cc|ui-avatars\.com)';
alter table public.users enable trigger trg_users_prevent_privilege_self_update;

update public.employees
set avatar_url = '/default-avatar.svg'
where avatar_url ~* '(pravatar\.cc|ui-avatars\.com)';

update public.activities
set user_avatar = '/default-avatar.svg'
where user_avatar ~* '(pravatar\.cc|ui-avatars\.com)';
