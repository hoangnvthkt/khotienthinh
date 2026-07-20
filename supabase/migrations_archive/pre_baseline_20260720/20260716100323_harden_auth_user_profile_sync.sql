-- Harden Auth -> app profile sync for admin-created login accounts.
--
-- Supabase Auth surfaces trigger failures as "Database error creating new user".
-- The previous function only handled conflict on public.users.id, but real app
-- profiles may already exist with the same email before an Auth account is
-- created. Link those profiles by auth_id/email first, and keep username
-- collisions from aborting auth.users insertion before the Edge Function can
-- return a useful profile error.

create or replace function public.sync_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_role text := coalesce(nullif(new.raw_user_meta_data ->> 'role', ''), 'EMPLOYEE');
  v_requested_username text := coalesce(
    nullif(new.raw_user_meta_data ->> 'username', ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    new.id::text
  );
  v_safe_username text := v_requested_username;
  v_name text := coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), v_requested_username);
  v_phone text := nullif(new.raw_user_meta_data ->> 'phone', '');
  v_avatar text := coalesce(
    nullif(new.raw_user_meta_data ->> 'avatar', ''),
    'https://i.pravatar.cc/150?u=' || coalesce(new.email, new.id::text)
  );
  v_existing_profile_id uuid;
begin
  if not exists (
    select 1
    from pg_catalog.pg_enum enum_row
    join pg_catalog.pg_type type_row on type_row.oid = enum_row.enumtypid
    join pg_catalog.pg_namespace namespace_row on namespace_row.oid = type_row.typnamespace
    where namespace_row.nspname = 'public'
      and type_row.typname = 'user_role'
      and enum_row.enumlabel = v_role
  ) then
    v_role := 'EMPLOYEE';
  end if;

  select u.id
    into v_existing_profile_id
  from public.users u
  where u.auth_id = new.id
     or (
       new.email is not null
       and lower(u.email) = lower(new.email)
     )
  order by
    case
      when u.auth_id = new.id then 0
      when new.email is not null and lower(u.email) = lower(new.email) then 1
      else 2
    end,
    u.created_at nulls last,
    u.id
  limit 1
  for update;

  if v_existing_profile_id is not null then
    update public.users
    set auth_id = case
          when public.users.auth_id is null or public.users.auth_id = new.id then new.id
          else public.users.auth_id
        end,
        name = coalesce(nullif(v_name, ''), public.users.name),
        email = coalesce(new.email, public.users.email),
        username = case
          when not exists (
            select 1
            from public.users username_owner
            where lower(username_owner.username) = lower(v_requested_username)
              and username_owner.id <> v_existing_profile_id
          ) then v_requested_username
          else public.users.username
        end,
        phone = coalesce(v_phone, public.users.phone),
        role = case
          when new.raw_user_meta_data ? 'role' then v_role::public.user_role
          else public.users.role
        end,
        avatar = coalesce(v_avatar, public.users.avatar),
        assigned_warehouse_id = case
          when new.raw_user_meta_data ? 'assignedWarehouseId' then nullif(new.raw_user_meta_data ->> 'assignedWarehouseId', '')
          else public.users.assigned_warehouse_id
        end,
        allowed_modules = case
          when new.raw_user_meta_data ? 'allowedModules' and v_role <> 'ADMIN'
            then array(select jsonb_array_elements_text(coalesce(new.raw_user_meta_data -> 'allowedModules', '[]'::jsonb)))
          when new.raw_user_meta_data ? 'allowedModules' and v_role = 'ADMIN'
            then null
          else public.users.allowed_modules
        end,
        admin_modules = case
          when new.raw_user_meta_data ? 'adminModules' and v_role <> 'ADMIN'
            then array(select jsonb_array_elements_text(coalesce(new.raw_user_meta_data -> 'adminModules', '[]'::jsonb)))
          when new.raw_user_meta_data ? 'adminModules' and v_role = 'ADMIN'
            then null
          else public.users.admin_modules
        end,
        allowed_sub_modules = case
          when new.raw_user_meta_data ? 'allowedSubModules' and v_role <> 'ADMIN'
            then coalesce(new.raw_user_meta_data -> 'allowedSubModules', '{}'::jsonb)
          when new.raw_user_meta_data ? 'allowedSubModules' and v_role = 'ADMIN'
            then null
          else public.users.allowed_sub_modules
        end,
        admin_sub_modules = case
          when new.raw_user_meta_data ? 'adminSubModules' and v_role <> 'ADMIN'
            then coalesce(new.raw_user_meta_data -> 'adminSubModules', '{}'::jsonb)
          when new.raw_user_meta_data ? 'adminSubModules' and v_role = 'ADMIN'
            then null
          else public.users.admin_sub_modules
        end,
        is_active = true,
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
    allowed_modules,
    admin_modules,
    allowed_sub_modules,
    admin_sub_modules,
    is_active
  )
  values (
    new.id,
    new.id,
    v_name,
    new.email,
    v_safe_username,
    v_phone,
    v_role::public.user_role,
    v_avatar,
    nullif(new.raw_user_meta_data ->> 'assignedWarehouseId', ''),
    case
      when v_role = 'ADMIN' then null
      else array(select jsonb_array_elements_text(coalesce(new.raw_user_meta_data -> 'allowedModules', '[]'::jsonb)))
    end,
    case
      when v_role = 'ADMIN' then null
      else array(select jsonb_array_elements_text(coalesce(new.raw_user_meta_data -> 'adminModules', '[]'::jsonb)))
    end,
    case
      when v_role = 'ADMIN' then null
      else coalesce(new.raw_user_meta_data -> 'allowedSubModules', '{}'::jsonb)
    end,
    case
      when v_role = 'ADMIN' then null
      else coalesce(new.raw_user_meta_data -> 'adminSubModules', '{}'::jsonb)
    end,
    true
  )
  on conflict (id) do update
  set auth_id = coalesce(public.users.auth_id, excluded.auth_id),
      name = excluded.name,
      email = excluded.email,
      username = excluded.username,
      phone = excluded.phone,
      role = excluded.role,
      avatar = excluded.avatar,
      assigned_warehouse_id = excluded.assigned_warehouse_id,
      allowed_modules = excluded.allowed_modules,
      admin_modules = excluded.admin_modules,
      allowed_sub_modules = excluded.allowed_sub_modules,
      admin_sub_modules = excluded.admin_sub_modules,
      is_active = excluded.is_active,
      updated_at = now();

  return new;
end;
$function$;
