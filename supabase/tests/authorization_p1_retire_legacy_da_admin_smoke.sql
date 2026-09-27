-- Run after authorization_p1_retire_legacy_da_admin. Rolls back.
begin;

do $$ begin
  if exists (select 1 from public.users where 'DA' = any(coalesce(admin_modules, '{}'::text[])) or coalesce(admin_sub_modules, '{}'::jsonb) ? 'DA') then
    raise exception 'DA legacy flags remain';
  end if;
  if (select count(*) from app_private.legacy_da_admin_backup_20260927) = 0 then
    raise exception 'backup is empty';
  end if;
end $$;

create temporary table p1_context (former_auth uuid, former_email text, admin_auth uuid, admin_email text, hd_auth uuid, hd_email text) on commit drop;
grant select on p1_context to authenticated;
insert into p1_context
select f.auth_id, f.email, a.auth_id, a.email,
  (select auth_id from public.users where role <> 'ADMIN' and is_active and auth_id is not null and ('HD' = any(coalesce(admin_modules, '{}'::text[])) or coalesce(admin_sub_modules, '{}'::jsonb) ? 'HD') order by created_at limit 1),
  (select email from public.users where role <> 'ADMIN' and is_active and auth_id is not null and ('HD' = any(coalesce(admin_modules, '{}'::text[])) or coalesce(admin_sub_modules, '{}'::jsonb) ? 'HD') order by created_at limit 1)
from (select u.* from public.users u join app_private.legacy_da_admin_backup_20260927 b on b.user_id = u.id
      where u.role <> 'ADMIN' and u.is_active and u.auth_id is not null order by u.created_at limit 1) f,
     (select * from public.users where role = 'ADMIN' and is_active and auth_id is not null order by created_at limit 1) a;

set local role authenticated;
do $$
declare v_c p1_context%rowtype;
begin
  select * into v_c from p1_context;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c.former_auth, 'email', v_c.former_email, 'role', 'authenticated')::text, true);
  if public.is_module_admin('DA') then raise exception 'former DA admin still passes'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c.admin_auth, 'email', v_c.admin_email, 'role', 'authenticated')::text, true);
  if not public.is_module_admin('DA') then raise exception 'admin lost DA'; end if;
  if v_c.hd_auth is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c.hd_auth, 'email', v_c.hd_email, 'role', 'authenticated')::text, true);
    if not public.is_module_admin('HD') then raise exception 'HD legacy admin changed'; end if;
  end if;
end $$;
reset role;

-- A DA flag written directly has no effect.
do $$
declare v_c p1_context%rowtype;
begin
  select * into v_c from p1_context;
  perform set_config('app.authorization_legacy_migration', 'on', true);
  alter table public.users disable trigger trg_users_prevent_privilege_self_update;
  update public.users set admin_modules = array_append(coalesce(admin_modules, '{}'), 'DA') where auth_id = v_c.former_auth;
  alter table public.users enable trigger trg_users_prevent_privilege_self_update;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c.former_auth, 'email', v_c.former_email, 'role', 'authenticated')::text, true);
  if public.is_module_admin('DA') then raise exception 'rewritten DA flag is effective'; end if;
end $$;

rollback;
