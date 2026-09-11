create or replace function app_private.get_my_checkin_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := public.current_app_user_id();
  v_employee public.employees%rowtype;
begin
  if (select auth.uid()) is null or v_actor_user_id is null then
    raise exception using errcode = '28000', message = 'HRM_CHECKIN_SESSION_REQUIRED';
  end if;

  select employee.*
  into v_employee
  from public.employees employee
  where employee.user_id = v_actor_user_id
    and employee.status = 'Đang làm việc'
  order by employee.updated_at desc nulls last, employee.created_at desc nulls last
  limit 1;

  if v_employee.id is null then
    return jsonb_build_object(
      'employee', null,
      'attendanceRecords', '[]'::jsonb,
      'constructionSites', '[]'::jsonb,
      'offices', '[]'::jsonb
    );
  end if;

  return jsonb_build_object(
    'employee', jsonb_build_object(
      'id', v_employee.id,
      'employee_code', v_employee.employee_code,
      'full_name', v_employee.full_name,
      'title', v_employee.title,
      'status', v_employee.status,
      'user_id', v_employee.user_id,
      'office_id', v_employee.office_id,
      'construction_site_id', v_employee.construction_site_id,
      'avatar_url', v_employee.avatar_url
    ),
    'attendanceRecords', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', attendance.id,
        'employeeId', attendance."employeeId",
        'date', attendance.date,
        'status', attendance.status,
        'checkIn', attendance."checkIn",
        'checkOut', attendance."checkOut",
        'overtimeHours', attendance."overtimeHours",
        'note', attendance.note,
        'events', attendance.events,
        'eventCount', attendance."eventCount",
        'approvalStatus', attendance."approvalStatus",
        'locationName', attendance."locationName",
        'locationType', attendance."locationType",
        'isOutOfRange', attendance."isOutOfRange",
        'createdAt', attendance."createdAt"
      ) order by attendance.date desc)
      from public.hrm_attendance attendance
      where attendance."employeeId" = v_employee.id
    ), '[]'::jsonb),
    'constructionSites', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', site.id,
        'name', site.name,
        'latitude', site.latitude,
        'longitude', site.longitude,
        'checkInRadius', site."checkInRadius"
      ) order by site.name)
      from public.hrm_construction_sites site
    ), '[]'::jsonb),
    'offices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', office.id,
        'name', office.name,
        'latitude', office.latitude,
        'longitude', office.longitude,
        'checkInRadius', office."checkInRadius"
      ) order by office.name)
      from public.hrm_offices office
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_my_checkin_context()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select app_private.get_my_checkin_context();
$$;

create or replace function app_private.list_my_payrolls()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := public.current_app_user_id();
  v_employee_id uuid;
begin
  if (select auth.uid()) is null or v_actor_user_id is null then
    raise exception using errcode = '28000', message = 'HRM_PAYROLL_SESSION_REQUIRED';
  end if;

  select employee.id
  into v_employee_id
  from public.employees employee
  where employee.user_id = v_actor_user_id
    and employee.status = 'Đang làm việc'
  order by employee.updated_at desc nulls last, employee.created_at desc nulls last
  limit 1;

  if v_employee_id is null then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', payroll.id,
      'employeeId', payroll."employeeId",
      'month', payroll.month,
      'year', payroll.year,
      'workingDays', payroll."workingDays",
      'standardDays', payroll."standardDays",
      'overtimeHours', payroll."overtimeHours",
      'baseSalary', payroll."baseSalary",
      'dailyRate', payroll."dailyRate",
      'overtimeRate', payroll."overtimeRate",
      'allowancePosition', payroll."allowancePosition",
      'allowanceMeal', payroll."allowanceMeal",
      'allowanceTransport', payroll."allowanceTransport",
      'allowancePhone', payroll."allowancePhone",
      'allowanceOther', payroll."allowanceOther",
      'allowance', coalesce(payroll."allowancePosition", 0)
        + coalesce(payroll."allowanceMeal", 0)
        + coalesce(payroll."allowanceTransport", 0)
        + coalesce(payroll."allowancePhone", 0)
        + coalesce(payroll."allowanceOther", 0),
      'bonus', 0,
      'deductionInsurance', payroll."deductionInsurance",
      'deductionTax', payroll."deductionTax",
      'deductionAdvance', payroll."deductionAdvance",
      'deductionOther', payroll."deductionOther",
      'deduction', coalesce(payroll."deductionInsurance", 0)
        + coalesce(payroll."deductionTax", 0)
        + coalesce(payroll."deductionAdvance", 0)
        + coalesce(payroll."deductionOther", 0),
      'insurance', payroll."deductionInsurance",
      'grossSalary', payroll."grossSalary",
      'netSalary', payroll."netSalary",
      'note', payroll.note,
      'status', payroll.status,
      'paidDate', payroll."paidDate",
      'createdAt', payroll."createdAt"
    ) order by payroll.year desc, payroll.month desc)
    from public.hrm_payrolls payroll
    where payroll."employeeId" = v_employee_id
      and payroll.status in ('confirmed', 'paid')
  ), '[]'::jsonb);
end;
$$;

create or replace function public.list_my_payrolls()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select app_private.list_my_payrolls();
$$;

revoke all on function app_private.get_my_checkin_context() from public, anon, authenticated;
revoke all on function app_private.list_my_payrolls() from public, anon, authenticated;
grant execute on function app_private.get_my_checkin_context() to authenticated, service_role;
grant execute on function app_private.list_my_payrolls() to authenticated, service_role;

revoke all on function public.get_my_checkin_context() from public, anon, authenticated;
revoke all on function public.list_my_payrolls() from public, anon, authenticated;
grant execute on function public.get_my_checkin_context() to authenticated, service_role;
grant execute on function public.list_my_payrolls() to authenticated, service_role;

comment on function public.get_my_checkin_context() is
  'Task 12.2: current JWT actor Check-in context; independent from the HRM/payroll batch.';
comment on function public.list_my_payrolls() is
  'Task 12.2: released payroll rows for the employee linked to the current JWT actor; accepts no target employee id.';
