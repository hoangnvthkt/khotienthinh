begin;

create or replace function app_private.hrm_can_access_employee_subject(
  p_employee_id uuid,
  p_permission_code text,
  p_actor_user_id uuid default public.current_app_user_id()
)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_request_user_id uuid := public.current_app_user_id();
  v_subject_user_id uuid;
begin
  if v_request_user_id is null
    or p_actor_user_id is distinct from v_request_user_id
    or p_employee_id is null
    or p_permission_code not like 'hrm.%'
  then return false;
  end if;
  if app_private.has_governed_hrm_permission(v_request_user_id, p_permission_code, 'global', '*') then
    return true;
  end if;
  select employee.user_id into v_subject_user_id
  from public.employees employee where employee.id = p_employee_id;
  if v_subject_user_id is null then return false; end if;
  return (v_subject_user_id = v_request_user_id
      and app_private.has_governed_hrm_permission(v_request_user_id, p_permission_code, 'own', '*'))
    or (
      app_private.has_governed_hrm_permission(v_request_user_id, p_permission_code, 'direct_reports', '*')
      and app_private.resolve_strict_direct_manager(v_subject_user_id) = v_request_user_id
    );
end;
$$;

revoke all on function app_private.hrm_can_access_employee_subject(uuid,text,uuid) from public,anon;
grant execute on function app_private.hrm_can_access_employee_subject(uuid,text,uuid) to authenticated,service_role;

notify pgrst, 'reload schema';
commit;
