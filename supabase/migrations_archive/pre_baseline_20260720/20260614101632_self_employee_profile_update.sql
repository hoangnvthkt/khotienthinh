-- Allow authenticated users to update only their own personal employee profile fields.
-- The exposed wrapper stays SECURITY INVOKER; privileged table writes live in app_private.

create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated;

create or replace function app_private.update_my_employee_profile_impl(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := public.current_app_user_id();
  v_employee public.employees%rowtype;
  v_gender text;
begin
  if v_user_id is null then
    raise exception 'employee profile actor not found for current auth session'
      using errcode = '28000';
  end if;

  p_patch := coalesce(p_patch, '{}'::jsonb);

  if p_patch ? 'gender' then
    v_gender := nullif(btrim(p_patch ->> 'gender'), '');
    if v_gender is not null and v_gender not in ('Nam', 'Nữ', 'Khác') then
      raise exception 'invalid employee gender: %', v_gender
        using errcode = '22023';
    end if;
  end if;

  update public.employees e
  set
    full_name = case
      when p_patch ? 'fullName' then coalesce(nullif(btrim(p_patch ->> 'fullName'), ''), e.full_name)
      else e.full_name
    end,
    gender = case
      when p_patch ? 'gender' then coalesce(v_gender, e.gender)
      else e.gender
    end,
    date_of_birth = case
      when p_patch ? 'dateOfBirth' then nullif(btrim(p_patch ->> 'dateOfBirth'), '')::date
      else e.date_of_birth
    end,
    marital_status = case
      when p_patch ? 'maritalStatus' then nullif(btrim(p_patch ->> 'maritalStatus'), '')
      else e.marital_status
    end,
    phone = case
      when p_patch ? 'phone' then nullif(btrim(p_patch ->> 'phone'), '')
      else e.phone
    end,
    email = case
      when p_patch ? 'email' then nullif(btrim(p_patch ->> 'email'), '')
      else e.email
    end,
    avatar_url = case
      when p_patch ? 'avatarUrl' then nullif(btrim(p_patch ->> 'avatarUrl'), '')
      else e.avatar_url
    end,
    updated_at = now()
  where e.user_id = v_user_id
  returning * into v_employee;

  if not found then
    raise exception 'employee profile not found for current user'
      using errcode = 'P0002';
  end if;

  update public.users u
  set
    name = case
      when p_patch ? 'fullName' then coalesce(nullif(btrim(p_patch ->> 'fullName'), ''), u.name)
      else u.name
    end,
    phone = case
      when p_patch ? 'phone' then nullif(btrim(p_patch ->> 'phone'), '')
      else u.phone
    end,
    avatar = case
      when p_patch ? 'avatarUrl' then nullif(btrim(p_patch ->> 'avatarUrl'), '')
      else u.avatar
    end
  where u.id = v_user_id;

  return to_jsonb(v_employee);
end;
$$;

revoke all on function app_private.update_my_employee_profile_impl(jsonb) from public;
grant execute on function app_private.update_my_employee_profile_impl(jsonb) to authenticated;

create or replace function public.update_my_employee_profile(p_patch jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.update_my_employee_profile_impl(p_patch);
$$;

revoke all on function public.update_my_employee_profile(jsonb) from public;
grant execute on function public.update_my_employee_profile(jsonb) to authenticated;

notify pgrst, 'reload schema';
