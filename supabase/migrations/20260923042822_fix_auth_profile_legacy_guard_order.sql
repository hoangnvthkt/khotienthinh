-- The account-status compatibility trigger runs before the legacy-write guard
-- (Postgres orders same-kind triggers by name). Auth profile inserts must keep
-- the retired permission columns null; assigning empty values makes the guard
-- correctly reject the insert and causes GoTrue to return a 500.
create or replace function app_private.sync_user_account_status_compat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if session_user = 'supabase_auth_admin' then
      -- Auth metadata is profile input only. Authorization comes from V2 grants.
      new.role := 'EMPLOYEE';
      new.assigned_warehouse_id := null;
      new.allowed_modules := null;
      new.admin_modules := null;
      new.allowed_sub_modules := null;
      new.admin_sub_modules := null;
    end if;

    -- During compatibility, either explicit disabled signal must win over defaults.
    if new.account_status = 'DISABLED' or new.is_active = false then
      new.account_status := 'DISABLED';
      new.is_active := false;
    else
      new.account_status := 'ACTIVE';
      new.is_active := true;
    end if;
    return new;
  end if;

  if session_user = 'supabase_auth_admin' then
    new.role := old.role;
    new.assigned_warehouse_id := old.assigned_warehouse_id;
    new.allowed_modules := old.allowed_modules;
    new.admin_modules := old.admin_modules;
    new.allowed_sub_modules := old.allowed_sub_modules;
    new.admin_sub_modules := old.admin_sub_modules;
    new.account_status := old.account_status;
    new.is_active := old.is_active;
    return new;
  end if;

  if old.account_status is distinct from new.account_status
    or old.is_active is distinct from new.is_active
  then
    if coalesce(current_setting('app.account_lifecycle_command', true), '') <> 'on' then
      raise exception 'Account status can only be changed by the account lifecycle command'
        using errcode = '42501';
    end if;

    if old.account_status is distinct from new.account_status then
      new.is_active := new.account_status = 'ACTIVE';
    else
      new.account_status := case when new.is_active then 'ACTIVE' else 'DISABLED' end;
    end if;
  end if;

  return new;
end;
$$;

comment on function app_private.sync_user_account_status_compat() is
  'Keeps account status fields compatible while ensuring Auth profile sync never writes retired permission columns.';
