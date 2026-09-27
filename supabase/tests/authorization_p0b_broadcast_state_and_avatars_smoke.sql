-- Run after authorization_p0b_broadcast_state_and_avatars. Rolls back.
begin;

do $$
begin
  if exists (select 1 from public.users where avatar ~* '(pravatar\.cc|ui-avatars\.com)')
    or exists (select 1 from public.employees where avatar_url ~* '(pravatar\.cc|ui-avatars\.com)')
    or exists (select 1 from public.activities where user_avatar ~* '(pravatar\.cc|ui-avatars\.com)')
  then
    raise exception 'third-party avatar URLs remain';
  end if;
  if pg_get_functiondef('public.sync_auth_user_profile()'::regprocedure) ~ 'pravatar' then
    raise exception 'profile sync still defaults to pravatar';
  end if;
end $$;

create temporary table p0b2_context (auth_id uuid, email text, broadcast_id uuid) on commit drop;
grant select on p0b2_context to authenticated;
insert into p0b2_context
select u.auth_id, u.email, (select id from public.notifications where user_id is null order by created_at desc limit 1)
from public.users u
where u.role = 'EMPLOYEE' and u.is_active and u.account_status = 'ACTIVE' and u.auth_id is not null
order by u.created_at, u.id limit 1;

set local role authenticated;
do $$
declare
  v_context p0b2_context%rowtype;
  v_rows integer;
begin
  select * into v_context from p0b2_context;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_context.auth_id, 'email', v_context.email, 'role', 'authenticated')::text, true);
  update public.notifications set is_read = true, is_dismissed = true where id = v_context.broadcast_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'employee still updates a shared broadcast'; end if;
end $$;

reset role;
rollback;
