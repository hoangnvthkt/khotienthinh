-- Emergency rollback for authorization_p1_retire_legacy_da_admin.
begin;
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
        or p_module = any(coalesce(admin_modules, '{}'::text[]))
        or coalesce(admin_sub_modules, '{}'::jsonb) ? p_module
      )
  );
$function$;

select set_config('app.authorization_legacy_migration', 'on', true);
alter table public.users disable trigger trg_users_prevent_privilege_self_update;
update public.users u
set admin_modules = b.admin_modules, admin_sub_modules = b.admin_sub_modules
from app_private.legacy_da_admin_backup_20260927 b
where b.user_id = u.id;
alter table public.users enable trigger trg_users_prevent_privilege_self_update;
select set_config('app.authorization_legacy_migration', '', true);
commit;
