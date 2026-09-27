-- P1.1: retire the legacy "Project module admin" (DA) flag (owner decision Q3).
-- From now on is_module_admin('DA') is true only for system Admins; project
-- work goes through Rooms and capabilities. The removed flags are kept in a
-- backup table so the change can be reverted.

create table if not exists app_private.legacy_da_admin_backup_20260927 (
  user_id uuid primary key,
  admin_modules text[],
  admin_sub_modules jsonb,
  backed_up_at timestamptz not null default now()
);
revoke all on table app_private.legacy_da_admin_backup_20260927 from public, anon, authenticated;

insert into app_private.legacy_da_admin_backup_20260927 (user_id, admin_modules, admin_sub_modules)
select id, admin_modules, admin_sub_modules
from public.users
where 'DA' = any(coalesce(admin_modules, '{}'::text[])) or coalesce(admin_sub_modules, '{}'::jsonb) ? 'DA'
on conflict (user_id) do nothing;

-- Legacy writes are closed; this is the documented migration path, audited below.
select set_config('app.authorization_legacy_migration', 'on', true);
alter table public.users disable trigger trg_users_prevent_privilege_self_update;
update public.users
set admin_modules = array_remove(admin_modules, 'DA'),
    admin_sub_modules = case when admin_sub_modules is null then null else admin_sub_modules - 'DA' end
where 'DA' = any(coalesce(admin_modules, '{}'::text[])) or coalesce(admin_sub_modules, '{}'::jsonb) ? 'DA';
alter table public.users enable trigger trg_users_prevent_privilege_self_update;
select set_config('app.authorization_legacy_migration', '', true);

insert into app_private.authorization_legacy_write_audit (actor_user_id, target_user_id, changed_columns, reason)
select null, b.user_id, array['admin_modules', 'admin_sub_modules'], 'P1.1 retire legacy DA module admin (owner decision Q3, 27/09/2026)'
from app_private.legacy_da_admin_backup_20260927 b;

-- A DA flag written later by any path has no effect.
create or replace function public.is_module_admin(p_module text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
    from public.users
    where auth_id = (select auth.uid())
      and (
        role = 'ADMIN'
        or (
          p_module <> 'DA'
          and (
            p_module = any(coalesce(admin_modules, '{}'::text[]))
            or coalesce(admin_sub_modules, '{}'::jsonb) ? p_module
          )
        )
      )
  );
$function$;
