insert into app_private.permission_hardening_settings (key, value)
values ('legacy_permission_writes_disabled', 'false'::jsonb)
on conflict (key) do nothing;

create table if not exists app_private.authorization_legacy_write_audit (
  id bigint generated always as identity primary key,
  actor_user_id uuid references public.users(id) on delete set null,
  target_user_id uuid not null references public.users(id) on delete restrict,
  changed_columns text[] not null,
  reason text not null,
  occurred_at timestamp with time zone not null default now(),
  constraint authorization_legacy_write_audit_changed_columns_check
    check (cardinality(changed_columns) > 0),
  constraint authorization_legacy_write_audit_reason_check
    check (char_length(btrim(reason)) > 0)
);

create index if not exists authorization_legacy_write_audit_target_occurred_idx
  on app_private.authorization_legacy_write_audit (target_user_id, occurred_at desc);

create or replace function app_private.guard_and_audit_legacy_permission_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed_columns text[] := array_remove(array[
    case when old.allowed_modules is distinct from new.allowed_modules then 'allowed_modules' end,
    case when old.allowed_sub_modules is distinct from new.allowed_sub_modules then 'allowed_sub_modules' end,
    case when old.admin_modules is distinct from new.admin_modules then 'admin_modules' end,
    case when old.admin_sub_modules is distinct from new.admin_sub_modules then 'admin_sub_modules' end
  ], null);
  v_reason text := nullif(btrim(coalesce(
    current_setting('app.authorization_legacy_write_reason', true),
    ''
  )), '');
begin
  if cardinality(v_changed_columns) = 0 then
    return new;
  end if;

  if coalesce(current_setting('app.authorization_legacy_migration', true), '') = 'on' then
    return new;
  end if;

  if app_private.permission_hardening_flag('legacy_permission_writes_disabled') then
    raise exception 'Legacy permission writes are disabled'
      using errcode = '42501';
  end if;

  insert into app_private.authorization_legacy_write_audit (
    actor_user_id,
    target_user_id,
    changed_columns,
    reason
  ) values (
    public.current_app_user_id(),
    new.id,
    v_changed_columns,
    coalesce(v_reason, 'legacy_permission_write')
  );

  return new;
end;
$$;

drop trigger if exists trg_users_guard_legacy_permission_writes on public.users;
create trigger trg_users_guard_legacy_permission_writes
before update of allowed_modules, allowed_sub_modules, admin_modules, admin_sub_modules on public.users
for each row execute function app_private.guard_and_audit_legacy_permission_write();

revoke all on table app_private.authorization_legacy_write_audit from public;
revoke all on table app_private.authorization_legacy_write_audit from anon;
revoke all on table app_private.authorization_legacy_write_audit from authenticated;
revoke all on function app_private.guard_and_audit_legacy_permission_write() from public;
revoke all on function app_private.guard_and_audit_legacy_permission_write() from anon;
revoke all on function app_private.guard_and_audit_legacy_permission_write() from authenticated;
