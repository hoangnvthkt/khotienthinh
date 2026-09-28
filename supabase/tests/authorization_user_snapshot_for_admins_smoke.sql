-- Run after authorization_user_snapshot_for_admins. Read-only; rolls back.
begin;
create temporary table aus_ctx on commit drop as
select
  (select auth_id from public.users where role = 'ADMIN' and is_active and auth_id is not null limit 1) admin_auth,
  (select email from public.users where role = 'ADMIN' and is_active and auth_id is not null limit 1) admin_email,
  target.id target_id, target.auth_id target_auth, target.email target_email,
  (select u.auth_id from public.users u where u.role <> 'ADMIN' and u.is_active and u.auth_id is not null and u.id <> target.id
     and not app_private.has_permission(u.id, 'system.authorization.manage_grants', 'global', '*') limit 1) staff_auth,
  (select u.email from public.users u where u.role <> 'ADMIN' and u.is_active and u.auth_id is not null and u.id <> target.id
     and not app_private.has_permission(u.id, 'system.authorization.manage_grants', 'global', '*') limit 1) staff_email
from public.users target
where target.role <> 'ADMIN' and target.is_active and target.auth_id is not null
  and exists (select 1 from public.project_permission_room_members m
              join public.project_staff s on s.id = m.project_staff_id and s.end_date is null
              where s.user_id = target.id::text and m.is_active)
limit 1;
create temporary table aus_out (k text, v jsonb) on commit drop;
grant select on aus_ctx to authenticated;
grant all on aus_out to authenticated;

-- The target's own view.
select set_config('request.jwt.claims', jsonb_build_object('sub', target_auth, 'email', target_email, 'role', 'authenticated')::text, true) from aus_ctx;
set local role authenticated;
insert into aus_out select 'self', public.get_my_authorization_snapshot();
reset role;

-- Admin reads the same snapshot for that person.
select set_config('request.jwt.claims', jsonb_build_object('sub', admin_auth, 'email', admin_email, 'role', 'authenticated')::text, true) from aus_ctx;
set local role authenticated;
insert into aus_out select 'admin', public.get_user_authorization_snapshot((select target_id from aus_ctx));
reset role;

-- A regular employee cannot read someone else's.
select set_config('request.jwt.claims', jsonb_build_object('sub', staff_auth, 'email', staff_email, 'role', 'authenticated')::text, true) from aus_ctx;
set local role authenticated;
do $$
begin
  perform public.get_user_authorization_snapshot((select target_id from aus_ctx));
  raise exception 'employee read another person''s snapshot';
exception when insufficient_privilege then null;
end $$;
reset role;

do $$
declare v_self jsonb := (select v from aus_out where k = 'self'); v_admin jsonb := (select v from aus_out where k = 'admin');
begin
  if (select target_id from aus_ctx) is null then raise exception 'no Room member to test with'; end if;
  if jsonb_array_length(coalesce(v_admin -> 'roomActions', '[]')) = 0 then raise exception 'admin sees no Room actions for a Room member'; end if;
  if (v_self -> 'roomActions') is distinct from (v_admin -> 'roomActions')
     or (v_self -> 'sources') is distinct from (v_admin -> 'sources') then
    raise exception 'admin view differs from the person''s own snapshot';
  end if;
end $$;
rollback;
