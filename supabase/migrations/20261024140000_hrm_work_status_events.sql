-- Ngày nghỉ việc / đi làm lại (19/10/2026). Trước đây chuyển "Đã nghỉ việc" chỉ đổi cột status, không ghi ngày ở đâu,
-- nên biểu đồ biến động nhân sự không có số nghỉ việc. Ngày nghỉ lấy từ sự kiện quá trình công tác NGHI_VIEC.
--   1. "Đang làm việc" → "Đã nghỉ việc": bắt buộc ngày nghỉ (không sau hôm nay giờ VN, không trước ngày vào làm hay
--      ngày đi làm lại gần nhất) và lý do ngắn; ghi sự kiện NGHI_VIEC trong cùng giao dịch với đổi trạng thái.
--   2. "Đã nghỉ việc" → "Đang làm việc": bắt buộc ngày đi làm lại (không sau hôm nay, sau ngày nghỉ gần nhất);
--      ghi sự kiện TIEP_NHAN. Không xóa sự kiện cũ, ngày vào làm giữ nguyên.
--   3. Người đã nghỉ mà chưa có ngày nghỉ: bổ sung ghi NGHI_VIEC, trạng thái giữ nguyên. Đã có rồi thì sửa sự kiện
--      nghỉ gần nhất (không tạo thêm bản ghi).
--   4. Không còn đường đổi trạng thái thiếu ngày: form sửa hồ sơ đi qua luật 1–2, archive_hrm_employee báo cần ngày,
--      tạo mới chỉ tạo người đang làm việc.
--   5. Danh bạ trả thêm exit_date = ngày NGHI_VIEC gần nhất của người đang nghỉ (cùng cách biểu đồ đọc).
--   6. Bổ sung ngày vào làm cho người chưa có (không ghi đè ngày đã có).
-- Quyền như sửa hồ sơ: hrm.employee.edit_profile. Mọi lệnh ghi audit_trail.

create or replace function app_private.hrm_apply_work_status(
  p_employee_id uuid, p_status text, p_effective_date date, p_note text, p_source_reference text, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_status text := nullif(trim(p_status), '');
  v_employee public.employees%rowtype;
  v_last_exit date;
  v_last_exit_code text;
  v_last_return date;
  v_type text;
  v_code text;
begin
  if v_status is null or v_status not in ('Đang làm việc', 'Đã nghỉ việc') then
    raise exception using errcode = '22023', message = 'HRM_WORK_STATUS_INVALID';
  end if;
  select * into v_employee from public.employees where id = p_employee_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'HRM_EMPLOYEE_NOT_FOUND';
  end if;
  if p_effective_date is null then
    raise exception using errcode = '22023', message = 'HRM_WORK_STATUS_DATE_REQUIRED';
  end if;
  if p_effective_date > v_today then
    raise exception using errcode = '22023', message = 'HRM_WORK_STATUS_DATE_IN_FUTURE';
  end if;
  if length(trim(coalesce(p_note, ''))) < 2 then
    raise exception using errcode = '22023', message = 'HRM_WORK_STATUS_NOTE_REQUIRED';
  end if;

  select event.event_date, event.record_code into v_last_exit, v_last_exit_code
  from public.hrm_employee_employment_events event
  where event.employee_id = p_employee_id and event.event_type_code = 'NGHI_VIEC' and event.status = 'ACTIVE'
  order by event.event_date desc, event.created_at desc limit 1;
  select max(event.event_date) into v_last_return
  from public.hrm_employee_employment_events event
  where event.employee_id = p_employee_id and event.event_type_code = 'TIEP_NHAN' and event.status = 'ACTIVE';

  if v_status = 'Đã nghỉ việc' then
    v_type := 'NGHI_VIEC';
    if p_effective_date < greatest(v_employee.start_date, v_last_return) then
      raise exception using errcode = '22023', message = 'HRM_WORK_STATUS_DATE_BEFORE_START';
    end if;
    -- Already resigned with a recorded date after the last return: this is a correction of that record.
    if v_employee.status = 'Đã nghỉ việc' and v_last_exit is not null
      and (v_last_return is null or v_last_exit >= v_last_return) then
      v_code := v_last_exit_code;
    else
      v_code := 'NGHI_VIEC-' || to_char(p_effective_date, 'YYYYMMDD');
    end if;
  else
    v_type := 'TIEP_NHAN';
    if v_employee.status = 'Đang làm việc' then
      raise exception using errcode = '22023', message = 'HRM_WORK_STATUS_UNCHANGED';
    end if;
    if v_last_exit is not null and p_effective_date <= v_last_exit then
      raise exception using errcode = '22023', message = 'HRM_WORK_STATUS_DATE_BEFORE_EXIT';
    end if;
    if p_effective_date < v_employee.start_date then
      raise exception using errcode = '22023', message = 'HRM_WORK_STATUS_DATE_BEFORE_START';
    end if;
    v_code := 'TIEP_NHAN-' || to_char(p_effective_date, 'YYYYMMDD');
  end if;

  -- A correction without a decision number keeps the one already recorded.
  insert into public.hrm_employee_employment_events as event(
    employee_id, record_code, event_type_code, event_date, org_unit_id, position_id,
    title_snapshot, reason, source_reference, created_by, updated_by
  ) values (
    p_employee_id, v_code, v_type, p_effective_date, v_employee.org_unit_id, v_employee.position_id,
    nullif(trim(v_employee.title), ''), trim(p_note),
    coalesce(nullif(trim(p_source_reference), ''), 'Đổi trạng thái trên hồ sơ'), v_actor_id, v_actor_id
  ) on conflict (employee_id, record_code) do update set
    event_type_code = excluded.event_type_code, event_date = excluded.event_date, reason = excluded.reason,
    source_reference = case when nullif(trim(p_source_reference), '') is null then event.source_reference
      else excluded.source_reference end,
    status = 'ACTIVE', updated_by = v_actor_id, updated_at = now();

  if v_employee.status is distinct from v_status then
    update public.employees set status = v_status, updated_at = now() where id = p_employee_id;
  end if;

  perform app_private.audit_hrm_profile_command(
    p_employee_id, 'HRM_EMPLOYMENT_EVENT', v_code, 'UPSERT', p_reason,
    case when v_employee.status is distinct from v_status
      then array['status','event_type_code','event_date','reason','source_reference']
      else array['event_type_code','event_date','reason','source_reference'] end
  );

  return jsonb_build_object(
    'employeeId', p_employee_id, 'status', v_status, 'eventType', v_type, 'eventDate', p_effective_date,
    'recordCode', v_code, 'exitDate', case when v_status = 'Đã nghỉ việc' then p_effective_date end
  );
end;
$function$;

revoke all on function app_private.hrm_apply_work_status(uuid, text, date, text, text, text) from public, anon, authenticated;

-- Đổi trạng thái / bổ sung ngày nghỉ từ hộp thoại (danh bạ, dải "Thiếu ngày công tác").
create or replace function public.set_hrm_employee_work_status(
  p_employee_id uuid, p_status text, p_effective_date date, p_note text, p_source_reference text, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not app_private.has_hrm_template_permission(public.current_app_user_id(), 'hrm.employee.edit_profile') then
    raise exception using errcode = '42501', message = 'HRM_PROFILE_EDIT_REQUIRED';
  end if;
  perform app_private.assert_hrm_mutation_context(p_reason, 'work-status');
  return app_private.hrm_apply_work_status(p_employee_id, p_status, p_effective_date, p_note, p_source_reference, p_reason);
end;
$function$;

revoke all on function public.set_hrm_employee_work_status(uuid, text, date, text, text, text) from public, anon;
grant execute on function public.set_hrm_employee_work_status(uuid, text, date, text, text, text) to authenticated;

-- Bổ sung ngày vào làm cho người chưa có.
create or replace function public.set_hrm_employee_start_date(p_employee_id uuid, p_start_date date, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_employee public.employees%rowtype;
  v_exit date;
begin
  if not app_private.has_hrm_template_permission(public.current_app_user_id(), 'hrm.employee.edit_profile') then
    raise exception using errcode = '42501', message = 'HRM_PROFILE_EDIT_REQUIRED';
  end if;
  perform app_private.assert_hrm_mutation_context(p_reason, 'start-date');
  if p_start_date is null then
    raise exception using errcode = '22023', message = 'HRM_WORK_STATUS_DATE_REQUIRED';
  end if;
  if p_start_date > (now() at time zone 'Asia/Ho_Chi_Minh')::date then
    raise exception using errcode = '22023', message = 'HRM_WORK_STATUS_DATE_IN_FUTURE';
  end if;
  select * into v_employee from public.employees where id = p_employee_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'HRM_EMPLOYEE_NOT_FOUND';
  end if;
  if v_employee.start_date is not null then
    raise exception using errcode = '22023', message = 'HRM_START_DATE_ALREADY_SET';
  end if;
  select min(event.event_date) into v_exit from public.hrm_employee_employment_events event
  where event.employee_id = p_employee_id and event.event_type_code = 'NGHI_VIEC' and event.status = 'ACTIVE';
  if p_start_date > v_exit then
    raise exception using errcode = '22023', message = 'HRM_START_DATE_AFTER_EXIT';
  end if;
  update public.employees set start_date = p_start_date, updated_at = now() where id = p_employee_id;
  perform app_private.audit_hrm_profile_command(
    p_employee_id, 'HRM_EMPLOYEE_PROFILE', p_employee_id::text, 'UPDATE', p_reason, array['start_date']
  );
  return jsonb_build_object('employeeId', p_employee_id, 'startDate', p_start_date);
end;
$function$;

revoke all on function public.set_hrm_employee_start_date(uuid, date, text) from public, anon;
grant execute on function public.set_hrm_employee_start_date(uuid, date, text) to authenticated;

-- Form sửa hồ sơ: đổi trạng thái phải kèm ngày + lý do, cùng giao dịch với các ô khác.
drop function if exists public.update_hrm_employee_core_profile(
  uuid, text, text, text, text, date, date, date, text, uuid, uuid, uuid, uuid, uuid, text, text, text
);

create or replace function public.update_hrm_employee_core_profile(
  p_employee_id uuid, p_full_name text, p_gender text, p_phone text, p_email text, p_date_of_birth date,
  p_start_date date, p_official_date date, p_status text, p_linked_user_id uuid, p_area_id uuid, p_office_id uuid,
  p_employee_type_id uuid, p_work_schedule_id uuid, p_marital_status text, p_avatar_url text, p_reason text,
  p_status_date date default null, p_status_note text default null, p_status_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_old_status text;
begin
  if not app_private.has_hrm_template_permission(v_actor_id, 'hrm.employee.edit_profile') then
    raise exception using errcode = '42501', message = 'HRM_PROFILE_EDIT_REQUIRED';
  end if;
  perform app_private.assert_hrm_mutation_context(p_reason, 'profile-command');
  if length(trim(coalesce(p_full_name, ''))) = 0 then
    raise exception using errcode = '22023', message = 'HRM_EMPLOYEE_FULL_NAME_REQUIRED';
  end if;
  select status into v_old_status from public.employees where id = p_employee_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'HRM_EMPLOYEE_NOT_FOUND';
  end if;

  update public.employees
  set full_name = trim(p_full_name),
      gender = nullif(trim(p_gender), ''),
      phone = nullif(trim(p_phone), ''),
      email = nullif(trim(p_email), ''),
      date_of_birth = p_date_of_birth,
      start_date = p_start_date,
      official_date = p_official_date,
      user_id = p_linked_user_id,
      area_id = p_area_id,
      office_id = p_office_id,
      employee_type_id = p_employee_type_id,
      work_schedule_id = p_work_schedule_id,
      marital_status = nullif(trim(p_marital_status), ''),
      avatar_url = nullif(trim(p_avatar_url), ''),
      updated_at = now()
  where id = p_employee_id;

  perform app_private.audit_hrm_profile_command(
    p_employee_id, 'HRM_EMPLOYEE_PROFILE', p_employee_id::text, 'UPDATE', p_reason,
    array[
      'full_name','gender','phone','email','date_of_birth','start_date','official_date',
      'user_id','area_id','office_id','employee_type_id','work_schedule_id',
      'marital_status','avatar_url'
    ]
  );
  if nullif(trim(p_status), '') is not null and trim(p_status) is distinct from v_old_status then
    perform app_private.hrm_apply_work_status(
      p_employee_id, p_status, p_status_date, p_status_note, p_status_reference, p_reason
    );
  end if;
  return app_private.get_hrm_employee_overview(p_employee_id);
end;
$function$;

revoke all on function public.update_hrm_employee_core_profile(
  uuid, text, text, text, text, date, date, date, text, uuid, uuid, uuid, uuid, uuid, text, text, text, date, text, text
) from public, anon;
grant execute on function public.update_hrm_employee_core_profile(
  uuid, text, text, text, text, date, date, date, text, uuid, uuid, uuid, uuid, uuid, text, text, text, date, text, text
) to authenticated;

-- Nút cũ "Lưu nghỉ việc" không có ngày: giờ đi qua set_hrm_employee_work_status.
create or replace function public.archive_hrm_employee(p_employee_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not app_private.has_hrm_template_permission(public.current_app_user_id(), 'hrm.employee.edit_profile') then
    raise exception using errcode = '42501', message = 'HRM_PROFILE_EDIT_REQUIRED';
  end if;
  raise exception using errcode = '22023', message = 'HRM_WORK_STATUS_DATE_REQUIRED';
end;
$function$;

-- Tạo mới chỉ tạo người đang làm việc; nghỉ việc ghi sau, kèm ngày.
create or replace function public.create_hrm_employee_core(p_employee_id uuid, p_employee_code text, p_full_name text, p_gender text, p_phone text, p_email text, p_date_of_birth date, p_start_date date, p_official_date date, p_status text, p_linked_user_id uuid, p_area_id uuid, p_office_id uuid, p_employee_type_id uuid, p_work_schedule_id uuid, p_marital_status text, p_avatar_url text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if coalesce(nullif(trim(p_status), ''), 'Đang làm việc') <> 'Đang làm việc' then
    raise exception using errcode = '22023', message = 'HRM_WORK_STATUS_CREATE_ACTIVE_ONLY';
  end if;
  insert into public.employees(
    id, employee_code, full_name, gender, phone, email, date_of_birth,
    start_date, official_date, status, user_id, area_id, office_id,
    employee_type_id, work_schedule_id, marital_status, avatar_url
  ) values (
    coalesce(p_employee_id, gen_random_uuid()), nullif(trim(p_employee_code), ''), trim(p_full_name),
    nullif(trim(p_gender), ''), nullif(trim(p_phone), ''), nullif(trim(p_email), ''),
    p_date_of_birth, p_start_date, p_official_date,
    'Đang làm việc', p_linked_user_id,
    p_area_id, p_office_id, p_employee_type_id, p_work_schedule_id,
    nullif(trim(p_marital_status), ''), nullif(trim(p_avatar_url), '')
  ) returning * into v_employee;
  perform app_private.audit_hrm_profile_command(
    v_employee.id, 'HRM_EMPLOYEE_PROFILE', v_employee.id::text, 'INSERT', p_reason,
    array['employee_code','full_name','profile_fields']
  );
  return to_jsonb(v_employee);
end;
$function$;

-- Danh bạ: thêm exit_date (ngày NGHI_VIEC gần nhất của người đang nghỉ).
create or replace function public.list_hrm_employee_directory()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_can_view_all_c2 boolean;
begin
  if not app_private.has_governed_hrm_permission(v_actor_id, 'hrm.employee.view_directory') then
    raise exception using errcode = '42501', message = 'HRM_EMPLOYEE_DIRECTORY_REQUIRED';
  end if;
  v_can_view_all_c2 := app_private.has_hrm_template_permission(v_actor_id, 'hrm.employee.view_profile');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', employee.id, 'employee_code', employee.employee_code,
      'full_name', employee.full_name, 'title', employee.title,
      'phone', employee.phone, 'email', employee.email,
      'gender', case when v_can_view_all_c2 or employee.user_id = v_actor_id then employee.gender else null end,
      'date_of_birth', case when v_can_view_all_c2 or employee.user_id = v_actor_id then employee.date_of_birth else null end,
      'marital_status', case when v_can_view_all_c2 or employee.user_id = v_actor_id then employee.marital_status else null end,
      'start_date', employee.start_date, 'official_date', employee.official_date,
      'status', employee.status, 'user_id', employee.user_id,
      'exit_date', case when employee.status = 'Đã nghỉ việc' then (
        select max(event.event_date) from public.hrm_employee_employment_events event
        where event.employee_id = employee.id and event.event_type_code = 'NGHI_VIEC' and event.status = 'ACTIVE'
      ) end,
      'area_id', employee.area_id, 'office_id', employee.office_id,
      'employee_type_id', employee.employee_type_id, 'position_id', employee.position_id,
      'salary_policy_id', case when v_can_view_all_c2 then employee.salary_policy_id else null end,
      'work_schedule_id', employee.work_schedule_id,
      'construction_site_id', employee.construction_site_id,
      'department_id', employee.department_id, 'factory_id', employee.factory_id,
      'org_unit_id', employee.org_unit_id, 'avatar_url', employee.avatar_url,
      'created_at', employee.created_at, 'updated_at', employee.updated_at
    ) order by employee.employee_code, employee.full_name)
    from public.employees employee
  ), '[]'::jsonb);
end;
$function$;
