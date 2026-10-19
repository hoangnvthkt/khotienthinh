-- Trợ lý · biến động nhân sự theo tháng (chủ SP 19/10/2026): số tổng toàn công ty, không lộ tên.
-- Quyền (chủ SP chốt): Xem tổ chức (hrm.organization.view — BLĐ, HR, trưởng bộ phận) hoặc HR xem hồ sơ nhạy cảm.
-- Vào làm = employees.start_date; nghỉ việc = sự kiện quá trình công tác NGHI_VIEC của người đang "Đã nghỉ việc".
-- Không biết ngày thì không đoán: người chưa có ngày vào làm / đã nghỉ chưa có ngày nghỉ không xếp vào tháng nào, trả số riêng để báo.
create or replace function public.get_hrm_headcount_trend_v1(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_today date := app_private.hrm_vn_today();
  v_from date;
  v_to date;
begin
  if v_actor is null or not (app_private.has_permission(v_actor, 'hrm.organization.view', 'global', '*')
      or app_private.has_hrm_template_permission(v_actor, 'hrm.employee.view_sensitive')) then
    raise exception using errcode = '42501', message = 'HRM_HEADCOUNT_DENIED';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_from < date '2000-01-01' then
    raise exception using errcode = '22023', message = 'HRM_HEADCOUNT_RANGE_INVALID';
  end if;
  v_from := date_trunc('month', p_from)::date;
  v_to := least(p_to, v_today);
  if v_to < v_from then
    raise exception using errcode = '22023', message = 'HRM_HEADCOUNT_RANGE_FUTURE';
  end if;
  if (date_part('year', v_to) - date_part('year', v_from)) * 12 + date_part('month', v_to) - date_part('month', v_from) >= 24 then
    raise exception using errcode = '22023', message = 'HRM_HEADCOUNT_RANGE_TOO_LONG';
  end if;

  return (
    with people as (
      select employee.start_date, employee.status = 'Đã nghỉ việc' as resigned,
        case when employee.status = 'Đã nghỉ việc' then (
          select max(event.event_date) from public.hrm_employee_employment_events event
          where event.employee_id = employee.id and event.event_type_code = 'NGHI_VIEC' and event.status = 'ACTIVE'
        ) end as exit_date
      from public.employees employee
    ),
    months as (
      select month::date as month_start, least((month + interval '1 month - 1 day')::date, v_to) as month_end
      from generate_series(v_from, date_trunc('month', v_to)::date, interval '1 month') month
    )
    select jsonb_build_object(
      'from', v_from, 'to', v_to, 'today', v_today,
      'opening', (select count(*) from people p where p.start_date < v_from and (not p.resigned or p.exit_date >= v_from)),
      'months', (select jsonb_agg(jsonb_build_object(
          'month', to_char(m.month_start, 'YYYY-MM'), 'endDate', m.month_end,
          'hired', (select count(*) from people p where p.start_date between m.month_start and m.month_end),
          'left', (select count(*) from people p where p.exit_date between m.month_start and m.month_end),
          'headcount', (select count(*) from people p where p.start_date <= m.month_end and (not p.resigned or p.exit_date > m.month_end))
        ) order by m.month_start) from months m),
      'activeNow', (select count(*) from people p where not p.resigned),
      'activeNoStartDate', (select count(*) from people p where not p.resigned and p.start_date is null),
      'resignedNoExitDate', (select count(*) from people p where p.resigned and p.exit_date is null),
      'resignedWithExitDate', (select count(*) from people p where p.resigned and p.exit_date is not null)
    )
  );
end;
$function$;

revoke all on function public.get_hrm_headcount_trend_v1(date, date) from public, anon;
grant execute on function public.get_hrm_headcount_trend_v1(date, date) to authenticated;
