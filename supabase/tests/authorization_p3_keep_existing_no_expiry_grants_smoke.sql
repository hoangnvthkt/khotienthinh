-- Run after authorization_p3_keep_existing_no_expiry_grants. Rolls back.
begin;

create temporary table p3_expiry_context (
  admin_id uuid, admin_auth uuid, admin_email text,
  target_id uuid, kept_code text, kept_scope text, kept_scope_id text,
  new_code text
) on commit drop;
grant select on p3_expiry_context to authenticated;

-- Target: an active non-admin user that holds an active grant without an expiry,
-- for a permission that requires an expiry.
insert into p3_expiry_context (admin_id, admin_auth, admin_email, target_id, kept_code, kept_scope, kept_scope_id)
select a.id, a.auth_id, a.email, g.user_id, g.permission_code, g.scope_type, g.scope_id
from (select * from public.users where role = 'ADMIN' and is_active and account_status = 'ACTIVE' and auth_id is not null order by created_at limit 1) a,
     lateral (
       select ug.* from public.user_permission_grants ug
       join public.permission_actions pa on pa.permission_code = ug.permission_code and pa.is_active
       join public.users u on u.id = ug.user_id and u.is_active and u.account_status = 'ACTIVE'
       where pa.direct_grant_requires_expiry and pa.direct_grant_allowed
         and ug.is_active and ug.revoked_at is null and ug.expires_at is null
         and ug.user_id <> a.id
       order by ug.created_at limit 1
     ) g;

-- A permission that requires an expiry and that the target does not hold at global scope.
update p3_expiry_context c set new_code = (
  select pa.permission_code from public.permission_actions pa
  where pa.is_active and pa.direct_grant_allowed and pa.direct_grant_requires_expiry
    and 'global' = any(pa.scope_modes)
    and not exists (select 1 from public.user_permission_grants ug
      where ug.user_id = c.target_id and ug.permission_code = pa.permission_code and ug.scope_type = 'global')
  order by pa.permission_code limit 1);

do $$
declare v_c p3_expiry_context%rowtype;
begin
  select * into v_c from p3_expiry_context;
  if v_c.target_id is null then raise exception 'fixture missing: no active grant without expiry'; end if;
  if v_c.new_code is null then raise exception 'fixture missing: no expiry-required permission to try'; end if;
end $$;

set local role authenticated;

-- 1. Keeping the existing grant unchanged (no expiry) is accepted.
do $$
declare v_c p3_expiry_context%rowtype; v_result jsonb;
begin
  select * into v_c from p3_expiry_context;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c.admin_auth, 'email', v_c.admin_email, 'role', 'authenticated')::text, true);
  v_result := public.preview_direct_grant_replacement(
    v_c.target_id,
    jsonb_build_array(jsonb_build_object(
      'permission_code', v_c.kept_code, 'scope_type', v_c.kept_scope, 'scope_id', v_c.kept_scope_id, 'is_active', true)));
  if v_result is null then raise exception 'unchanged grant was not evaluated'; end if;
end $$;

-- 2. A new grant that requires an expiry is still refused without one.
do $$
declare v_c p3_expiry_context%rowtype; v_code text := null;
begin
  select * into v_c from p3_expiry_context;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c.admin_auth, 'email', v_c.admin_email, 'role', 'authenticated')::text, true);
  begin
    perform public.preview_direct_grant_replacement(
      v_c.target_id,
      jsonb_build_array(jsonb_build_object(
        'permission_code', v_c.new_code, 'scope_type', 'global', 'scope_id', '*', 'is_active', true)));
  exception when check_violation then
    get stacked diagnostics v_code = pg_exception_detail;
  end;
  if v_code is null or v_code::jsonb ->> 'code' <> 'expiry_required' then
    raise exception 'new grant without expiry was not refused: %', v_code;
  end if;
end $$;

-- 3. The same permission at a different scope is a new grant and still needs an expiry.
do $$
declare v_c p3_expiry_context%rowtype; v_code text := null; v_other text;
begin
  select * into v_c from p3_expiry_context;
  select scope_type into v_other from (
    select unnest(pa.scope_modes) scope_type from public.permission_actions pa where pa.permission_code = v_c.kept_code
  ) s where scope_type in ('global', 'own', 'assigned') and scope_type <> v_c.kept_scope limit 1;
  if v_other is null then return; end if; -- action only supports the held scope; nothing to compare
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c.admin_auth, 'email', v_c.admin_email, 'role', 'authenticated')::text, true);
  begin
    perform public.preview_direct_grant_replacement(
      v_c.target_id,
      jsonb_build_array(jsonb_build_object(
        'permission_code', v_c.kept_code, 'scope_type', v_other, 'scope_id', '*', 'is_active', true)));
  exception when check_violation then
    get stacked diagnostics v_code = pg_exception_detail;
  end;
  if v_code is null or v_code::jsonb ->> 'code' <> 'expiry_required' then
    raise exception 'other-scope grant without expiry was not refused: %', v_code;
  end if;
end $$;

-- 4. A grant that was revoked no longer counts as "existing".
do $$
declare v_c p3_expiry_context%rowtype; v_code text := null;
begin
  select * into v_c from p3_expiry_context;
  execute 'reset role';
  update public.user_permission_grants
     set is_active = false, revoked_at = now()
   where user_id = v_c.target_id and permission_code = v_c.kept_code
     and scope_type = v_c.kept_scope and scope_id = v_c.kept_scope_id;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_c.admin_auth, 'email', v_c.admin_email, 'role', 'authenticated')::text, true);
  begin
    perform public.preview_direct_grant_replacement(
      v_c.target_id,
      jsonb_build_array(jsonb_build_object(
        'permission_code', v_c.kept_code, 'scope_type', v_c.kept_scope, 'scope_id', v_c.kept_scope_id, 'is_active', true)));
  exception when check_violation then
    get stacked diagnostics v_code = pg_exception_detail;
  end;
  if v_code is null or v_code::jsonb ->> 'code' <> 'expiry_required' then
    raise exception 'revoked grant was treated as existing: %', v_code;
  end if;
end $$;

rollback;
