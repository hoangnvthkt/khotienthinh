-- Run after authorization_p1_6_private_checkin_photos. Rolls back.
begin;
create temporary table p16_context on commit drop as
select o.name, o.owner_id, split_part(o.name, '/', 1) folder,
  (select auth_id from public.users where role = 'ADMIN' and is_active and account_status = 'ACTIVE' and auth_id is not null order by created_at limit 1) admin_auth,
  (select email from public.users where role = 'ADMIN' and is_active and account_status = 'ACTIVE' and auth_id is not null order by created_at limit 1) admin_email,
  owner_user.auth_id owner_auth, owner_user.email owner_email
from storage.objects o
join public.users owner_user on owner_user.auth_id::text = o.owner_id
where o.bucket_id = 'checkin-photos'
order by o.created_at desc limit 1;
alter table p16_context add column stranger_auth uuid, add column stranger_email text;
update p16_context c set (stranger_auth, stranger_email) = (
  select u.auth_id, u.email from public.users u
  where u.role = 'EMPLOYEE' and u.is_active and u.account_status = 'ACTIVE' and u.auth_id is not null
    and u.auth_id::text <> c.owner_id
    and not app_private.has_permission(u.id, 'hrm.attendance.view', 'global', '*')
    and not exists (select 1 from public.user_permission_grants g where g.user_id = u.id and g.is_active and g.permission_code like 'hrm.attendance.%')
  order by u.created_at limit 1);
grant select on p16_context to authenticated;

do $$ begin
  if (select public from storage.buckets where id = 'checkin-photos') then raise exception 'bucket still public'; end if;
  if (select count(*) from p16_context) <> 1 then raise exception 'no photo fixture'; end if;
end $$;

set local role authenticated;
do $$
declare v_c p16_context%rowtype;
begin
  select * into v_c from p16_context;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c.owner_auth, 'email', v_c.owner_email, 'role', 'authenticated')::text, true);
  if not exists (select 1 from storage.objects where bucket_id = 'checkin-photos' and name = v_c.name) then raise exception 'owner cannot read own photo'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c.admin_auth, 'email', v_c.admin_email, 'role', 'authenticated')::text, true);
  if not exists (select 1 from storage.objects where bucket_id = 'checkin-photos' and name = v_c.name) then raise exception 'admin cannot read photo'; end if;
  if v_c.stranger_auth is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c.stranger_auth, 'email', v_c.stranger_email, 'role', 'authenticated')::text, true);
    if exists (select 1 from storage.objects where bucket_id = 'checkin-photos' and name = v_c.name
               and v_c.folder not in (select employee_id::text from app_private.current_actor_hrm_visible_employee_ids('hrm.attendance.view') x(employee_id))) then
      raise exception 'unrelated employee can read the photo';
    end if;
  end if;
end $$;
reset role;
rollback;
