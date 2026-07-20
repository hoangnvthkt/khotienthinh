-- Keep Auth user-editable metadata limited to display-safe profile fields.
-- Authorization fields are finalized by the authenticated Admin through the
-- existing public.users RLS and protected-field trigger.
create or replace function public.sync_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
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
  v_avatar text := coalesce(
    nullif(new.raw_user_meta_data ->> 'avatar', ''),
    'https://i.pravatar.cc/150?u=' || coalesce(new.email, new.id::text)
  );
  v_existing_profile_id uuid;
begin
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
    allowed_modules,
    admin_modules,
    allowed_sub_modules,
    admin_sub_modules,
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
    v_avatar,
    null,
    '{}'::text[],
    '{}'::text[],
    '{}'::jsonb,
    '{}'::jsonb,
    true,
    'ACTIVE'
  )
  on conflict (id) do update
  set auth_id = coalesce(public.users.auth_id, excluded.auth_id),
      name = excluded.name,
      email = excluded.email,
      phone = excluded.phone,
      avatar = excluded.avatar,
      updated_at = now();

  return new;
end;
$function$;
