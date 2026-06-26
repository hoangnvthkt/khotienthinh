-- Restore app_private schema access accidentally removed by
-- 20260625091414_material_request_material_group_snapshots.sql.
--
-- Public RLS policies and RPC wrappers call private helper functions such as
-- app_private.employee_camera_checkin_v1(). Without schema USAGE, every
-- authenticated user gets a permission denied error before the HRM check-in
-- logic can run.

grant usage on schema app_private to authenticated;

create or replace function app_private.hrm_current_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(coalesce(
    (select auth.jwt() ->> 'email'),
    current_setting('request.jwt.claim.email', true),
    ''
  ));
$$;

create or replace function app_private.hrm_employee_is_current_user(p_employee_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with current_identity as (
    select
      (select auth.uid()) as auth_user_id,
      public.current_app_user_id() as app_user_id,
      app_private.hrm_current_email() as jwt_email
  ),
  current_user_row as (
    select
      u.id,
      u.auth_id,
      lower(coalesce(u.email, '')) as email
    from public.users u
    cross join current_identity ci
    where u.id = ci.app_user_id
       or (ci.auth_user_id is not null and u.auth_id = ci.auth_user_id)
       or (ci.jwt_email <> '' and lower(coalesce(u.email, '')) = ci.jwt_email)
    order by
      case
        when u.id = ci.app_user_id then 0
        when ci.auth_user_id is not null and u.auth_id = ci.auth_user_id then 1
        else 2
      end
    limit 1
  )
  select exists (
    select 1
    from public.employees e
    cross join current_identity ci
    left join current_user_row u on true
    where e.id::text = p_employee_id
      and (
        (ci.app_user_id is not null and e.user_id::text = ci.app_user_id::text)
        or (ci.auth_user_id is not null and e.user_id::text = ci.auth_user_id::text)
        or (u.id is not null and e.user_id::text = u.id::text)
        or (u.auth_id is not null and e.user_id::text = u.auth_id::text)
        or (ci.jwt_email <> '' and lower(coalesce(e.email, '')) = ci.jwt_email)
        or (u.email <> '' and lower(coalesce(e.email, '')) = u.email)
      )
  );
$$;

revoke all on function app_private.hrm_current_email() from public, anon;
revoke all on function app_private.hrm_employee_is_current_user(text) from public, anon;
grant execute on function app_private.hrm_current_email() to authenticated;
grant execute on function app_private.hrm_employee_is_current_user(text) to authenticated;

grant execute on function app_private.hrm_location_manager_id(text, text) to authenticated;
grant execute on function app_private.hrm_location_name(text, text, text) to authenticated;
grant execute on function app_private.hrm_is_location_manager(text, text) to authenticated;
grant execute on function app_private.employee_camera_checkin_v1(
  text,
  uuid,
  text,
  text,
  double precision,
  double precision,
  text,
  text,
  text,
  integer,
  boolean,
  text,
  jsonb
) to authenticated;
grant execute on function app_private.review_attendance_proposal_v1(uuid, text, text) to authenticated;
