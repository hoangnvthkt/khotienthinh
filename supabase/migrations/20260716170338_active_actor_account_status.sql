create schema if not exists app_private;

alter table public.users
  add column if not exists account_status text,
  add column if not exists disabled_at timestamptz,
  add column if not exists disabled_by uuid references public.users(id) on delete set null,
  add column if not exists disabled_reason text,
  add column if not exists reactivated_at timestamptz,
  add column if not exists reactivated_by uuid references public.users(id) on delete set null,
  add column if not exists reactivation_reason text;

-- The existing profile guard requires an app actor; this one-time owner backfill
-- has no JWT. The trigger state is transactional and is restored on any error.
alter table public.users
  disable trigger trg_users_prevent_privilege_self_update;

update public.users
set account_status = case when coalesce(is_active, true) then 'ACTIVE' else 'DISABLED' end
where account_status is null;

alter table public.users
  enable trigger trg_users_prevent_privilege_self_update;

alter table public.users
  alter column account_status set default 'ACTIVE',
  alter column account_status set not null;

alter table public.users
  drop constraint if exists users_account_status_check,
  drop constraint if exists users_account_status_consistency_check;

alter table public.users
  add constraint users_account_status_check
    check (account_status in ('ACTIVE', 'DISABLED')),
  add constraint users_account_status_consistency_check
    check (is_active = (account_status = 'ACTIVE'));

create or replace function app_private.sync_user_account_status_compat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if session_user = 'supabase_auth_admin' then
      -- Auth user metadata is identity/profile input, never authorization input.
      new.role := 'EMPLOYEE';
      new.assigned_warehouse_id := null;
      new.allowed_modules := '{}'::text[];
      new.admin_modules := '{}'::text[];
      new.allowed_sub_modules := '{}'::jsonb;
      new.admin_sub_modules := '{}'::jsonb;
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

revoke all on function app_private.sync_user_account_status_compat() from public, anon, authenticated;

drop trigger if exists trg_users_account_status_compat on public.users;
create trigger trg_users_account_status_compat
  before insert or update on public.users
  for each row
  execute function app_private.sync_user_account_status_compat();

create or replace function app_private.guard_user_account_lifecycle_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.account_status is distinct from new.account_status
    or old.disabled_at is distinct from new.disabled_at
    or old.disabled_by is distinct from new.disabled_by
    or old.disabled_reason is distinct from new.disabled_reason
    or old.reactivated_at is distinct from new.reactivated_at
    or old.reactivated_by is distinct from new.reactivated_by
    or old.reactivation_reason is distinct from new.reactivation_reason
  then
    if auth.role() = 'service_role'
      and coalesce(current_setting('app.account_lifecycle_command', true), '') = 'on'
    then
      return new;
    end if;

    raise exception 'Account lifecycle metadata can only be changed by the trusted command'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function app_private.guard_user_account_lifecycle_metadata()
  from public, anon, authenticated;

drop trigger if exists trg_users_guard_account_lifecycle_metadata on public.users;
create trigger trg_users_guard_account_lifecycle_metadata
  before update on public.users
  for each row
  execute function app_private.guard_user_account_lifecycle_metadata();

create or replace function public.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from public.users u
  where (
      u.auth_id = (select auth.uid())
      or (
        u.auth_id is null
        and lower(u.email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
      )
    )
    and u.is_active
    and u.account_status = 'ACTIVE'
  order by case when u.auth_id = (select auth.uid()) then 0 else 1 end
  limit 1;
$$;

revoke all on function public.current_app_user_id() from public, anon;
grant execute on function public.current_app_user_id() to authenticated, service_role;

create or replace function public.enforce_active_app_actor()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) = 'authenticated'
    and public.current_app_user_id() is null
  then
    raise exception 'Active application account required'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.enforce_active_app_actor() from public;
grant execute on function public.enforce_active_app_actor() to anon, authenticated, service_role;

alter role authenticator
  set pgrst.db_pre_request = 'public.enforce_active_app_actor';

-- Backfill every currently RLS-protected application table. Storage is a
-- Supabase-managed schema, so its supported RLS surface is handled separately.
do $$
declare
  target record;
  policy_name text;
begin
  for target in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p')
      and c.relrowsecurity
      and n.nspname = 'public'
  loop
    policy_name := left(target.table_name || '_active_actor_gate', 63);
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_name,
      target.schema_name,
      target.table_name
    );
    execute format(
      'create policy %I on %I.%I as restrictive for all to authenticated using ((select public.current_app_user_id()) is not null) with check ((select public.current_app_user_id()) is not null)',
      policy_name,
      target.schema_name,
      target.table_name
    );
  end loop;

  if to_regclass('storage.objects') is not null then
    drop policy if exists storage_objects_active_actor_gate on storage.objects;
    create policy storage_objects_active_actor_gate
      on storage.objects
      as restrictive
      for all
      to authenticated
      using ((select public.current_app_user_id()) is not null)
      with check ((select public.current_app_user_id()) is not null);
  end if;
end;
$$;

drop policy if exists users_delete on public.users;
revoke delete on public.users from authenticated;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
