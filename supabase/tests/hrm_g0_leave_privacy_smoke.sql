-- Run after 20261005110000_hrm_g0_leave_balance_and_privacy. Rolls back.
begin;
set local statement_timeout = '60s';

do $$
declare
  v_balance public.hrm_leave_balances;
  v_request_id uuid := gen_random_uuid();
  v_employee_id uuid;
  v_leave_viewers integer;
  v_profile_viewers integer;
  v_hr_viewers integer;
begin
  -- Saving a current-year balance works again and is logged.
  select * into v_balance from public.hrm_leave_balances
  where year = extract(year from (now() at time zone 'Asia/Ho_Chi_Minh'))::integer limit 1;
  if v_balance.id is not null then
    update public.hrm_leave_balances set "accruedDays" = "accruedDays" + 0.5 where id = v_balance.id;
    if not exists (select 1 from public.hrm_leave_balance_changes where balance_id = v_balance.id and operation = 'update') then
      raise exception 'HRM_G0_BALANCE_CHANGE_NOT_LOGGED';
    end if;
  end if;

  -- Monthly accrual is idempotent.
  perform app_private.accrue_monthly_leave();
  if app_private.accrue_monthly_leave() <> 0 then raise exception 'HRM_G0_ACCRUAL_NOT_IDEMPOTENT'; end if;

  -- Half-day unpaid leave is stored, and never as paid.
  select id into v_employee_id from public.employees where status = 'Đang làm việc' limit 1;
  insert into public.hrm_leave_requests (id, "employeeId", type, "startDate", "endDate", "totalDays", reason, status, "isPaid")
  values (v_request_id, v_employee_id, 'unpaid', '2099-01-05', '2099-01-05', 0.5, 'smoke', 'pending', true);
  if (select "isPaid" from public.hrm_leave_requests where id = v_request_id) then
    raise exception 'HRM_G0_UNPAID_STORED_AS_PAID';
  end if;
  begin
    insert into public.hrm_leave_requests (id, "employeeId", type, "startDate", "endDate", "totalDays", reason, status)
    values (gen_random_uuid(), v_employee_id, 'annual', '2099-01-05', '2099-01-05', 0.3, 'smoke', 'pending');
    raise exception 'HRM_G0_ODD_DAY_FRACTION_ACCEPTED';
  exception when check_violation then null;
  end;

  -- Only HR role holders and company-wide leave approvers still see everyone's leave.
  select count(*) filter (where app_private.has_governed_hrm_permission(u.id, 'hrm.leave.view', 'global', '*')),
         count(*) filter (where app_private.has_governed_hrm_permission(u.id, 'hrm.employee.view_profile', 'global', '*')),
         count(*) filter (where app_private.has_hrm_template_permission(u.id, 'hrm.employee.view_sensitive'))
  into v_leave_viewers, v_profile_viewers, v_hr_viewers
  from public.users u where coalesce(u.is_active, true);

  if v_profile_viewers > v_hr_viewers then
    raise exception 'HRM_G0_NON_HR_PROFILE_VIEWERS_LEFT % > %', v_profile_viewers, v_hr_viewers;
  end if;
  if exists (
    select 1 from public.users u
    where coalesce(u.is_active, true)
      and app_private.has_governed_hrm_permission(u.id, 'hrm.leave.view', 'global', '*')
      and not app_private.has_hrm_template_permission(u.id, 'hrm.employee.view_sensitive')
      and not app_private.has_governed_hrm_permission(u.id, 'hrm.leave.approve', 'global', '*')
  ) then
    raise exception 'HRM_G0_NON_HR_LEAVE_VIEWERS_LEFT';
  end if;

  -- Everyone keeps their own leave.
  if (select count(*) from public.users u where coalesce(u.is_active, true)
        and app_private.has_governed_hrm_permission(u.id, 'hrm.leave.view', 'own', '*')) < 70 then
    raise exception 'HRM_G0_OWN_LEAVE_VIEW_LOST';
  end if;

  raise notice 'leave viewers %, profile viewers %, HR %', v_leave_viewers, v_profile_viewers, v_hr_viewers;
end;
$$;

select 'hrm_g0_leave_privacy_smoke passed' as result;
rollback;
