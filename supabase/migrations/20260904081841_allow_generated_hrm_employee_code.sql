create or replace function public.create_hrm_employee_core(
  p_employee_id uuid, p_employee_code text, p_full_name text,
  p_gender text, p_phone text, p_email text, p_date_of_birth date,
  p_start_date date, p_official_date date, p_status text,
  p_linked_user_id uuid, p_area_id uuid, p_office_id uuid,
  p_employee_type_id uuid, p_work_schedule_id uuid,
  p_marital_status text, p_avatar_url text, p_reason text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_employee public.employees%rowtype;
begin
  if not app_private.has_hrm_template_permission(v_actor_id, 'hrm.employee.edit_profile') then
    raise exception using errcode = '42501', message = 'HRM_PROFILE_EDIT_REQUIRED';
  end if;
  perform app_private.assert_hrm_mutation_context(p_reason, 'employee-create');
  if length(trim(coalesce(p_full_name, ''))) = 0 then
    raise exception using errcode = '22023', message = 'HRM_EMPLOYEE_CORE_REQUIRED';
  end if;
  insert into public.employees(
    id, employee_code, full_name, gender, phone, email, date_of_birth,
    start_date, official_date, status, user_id, area_id, office_id,
    employee_type_id, work_schedule_id, marital_status, avatar_url
  ) values (
    coalesce(p_employee_id, gen_random_uuid()), nullif(trim(p_employee_code), ''), trim(p_full_name),
    nullif(trim(p_gender), ''), nullif(trim(p_phone), ''), nullif(trim(p_email), ''),
    p_date_of_birth, p_start_date, p_official_date,
    coalesce(nullif(trim(p_status), ''), 'Đang làm việc'), p_linked_user_id,
    p_area_id, p_office_id, p_employee_type_id, p_work_schedule_id,
    nullif(trim(p_marital_status), ''), nullif(trim(p_avatar_url), '')
  ) returning * into v_employee;
  perform app_private.audit_hrm_profile_command(
    v_employee.id, 'HRM_EMPLOYEE_PROFILE', v_employee.id::text, 'INSERT', p_reason,
    array['employee_code','full_name','profile_fields']
  );
  return to_jsonb(v_employee);
end;
$$;
