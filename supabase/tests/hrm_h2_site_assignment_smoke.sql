-- Run after 20261008150000_hrm_h2_site_assignments. Rolls back.
begin;
set local statement_timeout = '120s';

-- Approver (HR Manage / Admin), two active non-HR employees with accounts and positions, two sites with projects.
select set_config('test.h2.hr_auth', u.auth_id::text, true), set_config('test.h2.hr_id', u.id::text, true)
from public.users u where u.is_active and u.auth_id is not null and app_private.hrm_site_assignment_is_approver(u.id)
order by u.created_at limit 1;

select set_config('test.h2.e1', e.id::text, true), set_config('test.h2.e1_auth', u.auth_id::text, true), set_config('test.h2.e1_user', u.id::text, true)
from public.employees e join public.users u on u.id = e.user_id
where e.status = 'Đang làm việc' and u.is_active and u.auth_id is not null and e.position_id is not null
  and not app_private.hrm_site_assignment_is_hr(u.id) and not app_private.hrm_site_assignment_can_create_any(u.id)
order by e.created_at limit 1;

select set_config('test.h2.e2', e.id::text, true), set_config('test.h2.e2_auth', u.auth_id::text, true)
from public.employees e join public.users u on u.id = e.user_id
where e.status = 'Đang làm việc' and u.is_active and u.auth_id is not null and e.id::text <> current_setting('test.h2.e1')
  and not app_private.hrm_site_assignment_is_approver(u.id)
order by e.created_at desc limit 1;

select set_config('test.h2.site_a', site.id::text, true) from public.hrm_construction_sites site
where app_private.hrm_site_project_id(site.id) is not null order by site.name limit 1;
select set_config('test.h2.site_b', site.id::text, true) from public.hrm_construction_sites site
where app_private.hrm_site_project_id(site.id) is not null and site.id::text <> current_setting('test.h2.site_a') order by site.name limit 1;
select set_config('test.h2.today', app_private.hrm_vn_today()::text, true);

-- Make e1 a clean subject.
delete from public.hrm_site_assignments where employee_id = current_setting('test.h2.e1')::uuid;
delete from public.hrm_site_assignment_reviews where employee_id in (current_setting('test.h2.e1')::uuid, current_setting('test.h2.e2')::uuid);
delete from public.hrm_site_assignments where employee_id = current_setting('test.h2.e2')::uuid;
update public.employees set construction_site_id = current_setting('test.h2.site_b')::uuid where id = current_setting('test.h2.e1')::uuid;

-- ── An ordinary employee cannot assign people ──────────────────────────────
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.h2.e1_auth'))::text, true);
set local role authenticated;
do $$
declare v_preview jsonb; v_board jsonb;
begin
  v_board := public.get_hrm_site_assignment_board();
  if (v_board -> 'can' ->> 'approve')::boolean or jsonb_array_length(v_board -> 'review') > 0 then raise exception 'H2_EMPLOYEE_SEES_REVIEW'; end if;
  v_preview := public.preview_hrm_site_assignment(jsonb_build_object('employeeIds', jsonb_build_array(current_setting('test.h2.e2')),
    'siteId', current_setting('test.h2.site_a'), 'kind', 'primary', 'startDate', current_setting('test.h2.today')));
  if jsonb_array_length(v_preview -> 'problems') = 0 then raise exception 'H2_EMPLOYEE_CAN_ASSIGN %', v_preview; end if;
  begin
    perform public.decide_hrm_site_assignment(gen_random_uuid(), true, null);
    raise exception 'H2_EMPLOYEE_CAN_DECIDE';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- ── HR: submit, approve, temporary, new primary, cancel, backdate limit ────
-- The checks below read tables directly; let the test role read them (rolled back with the test).
grant select on public.hrm_site_assignments, public.employees to authenticated;
create policy h2_smoke_read on public.hrm_site_assignments for select to authenticated using (true);
create policy h2_smoke_read on public.employees for select to authenticated using (true);
grant execute on function app_private.hrm_employee_primary_site_on(uuid, date) to authenticated;
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.h2.hr_auth'))::text, true);
set local role authenticated;
do $$
declare
  v_today date := current_setting('test.h2.today')::date;
  v_e1 uuid := current_setting('test.h2.e1')::uuid;
  v_a uuid := current_setting('test.h2.site_a')::uuid;
  v_b uuid := current_setting('test.h2.site_b')::uuid;
  v_preview jsonb; v_codes text[]; v_primary uuid; v_temp uuid; v_second uuid; v_board jsonb;
begin
  v_preview := public.preview_hrm_site_assignment(jsonb_build_object('employeeIds', jsonb_build_array(v_e1), 'siteId', v_a, 'kind', 'primary', 'startDate', v_today - 8));
  if v_preview -> 'problems' ->> 0 not like 'Chỉ được lùi ngày%' then raise exception 'H2_BACKDATE_LIMIT %', v_preview; end if;
  v_preview := public.preview_hrm_site_assignment(jsonb_build_object('employeeIds', jsonb_build_array(v_e1), 'siteId', v_a, 'kind', 'temporary', 'startDate', v_today + 3));
  if jsonb_array_length(v_preview -> 'problems') = 0 then raise exception 'H2_TEMP_NEEDS_END'; end if;

  v_codes := public.submit_hrm_site_assignment(jsonb_build_object('employeeIds', jsonb_build_array(v_e1), 'siteId', v_a, 'kind', 'primary',
    'startDate', v_today + 3, 'reason', 'Smoke chuyển công trường'));
  if cardinality(v_codes) <> 1 or v_codes[1] not like 'DD-%' then raise exception 'H2_SUBMIT %', v_codes; end if;
  select id into v_primary from public.hrm_site_assignments where code = v_codes[1];
  begin
    perform public.submit_hrm_site_assignment(jsonb_build_object('employeeIds', jsonb_build_array(v_e1), 'siteId', v_b, 'kind', 'concurrent',
      'startDate', v_today + 4, 'reason', 'Smoke trùng phiếu'));
    raise exception 'H2_DOUBLE_PENDING';
  exception when check_violation then null;
  end;

  perform public.decide_hrm_site_assignment(v_primary, true, null);
  if (select status from public.hrm_site_assignments where id = v_primary) <> 'approved' then raise exception 'H2_APPROVE'; end if;
  -- Future record: today's profile site stays.
  if (select construction_site_id from public.employees where id = v_e1) is distinct from v_b then raise exception 'H2_FUTURE_CLEARED_TODAY'; end if;
  if app_private.hrm_employee_primary_site_on(v_e1, v_today + 3) is distinct from v_a then raise exception 'H2_PRIMARY_ON_START'; end if;

  -- Temporary inside the primary period, then back.
  v_codes := public.submit_hrm_site_assignment(jsonb_build_object('employeeIds', jsonb_build_array(v_e1), 'siteId', v_b, 'kind', 'temporary',
    'startDate', v_today + 5, 'endDate', v_today + 10, 'reason', 'Smoke tăng cường'));
  select id into v_temp from public.hrm_site_assignments where code = v_codes[1];
  perform public.decide_hrm_site_assignment(v_temp, true, null);
  if app_private.hrm_employee_primary_site_on(v_e1, v_today + 6) is distinct from v_b then raise exception 'H2_TEMP_WINS'; end if;
  if app_private.hrm_employee_primary_site_on(v_e1, v_today + 11) is distinct from v_a then raise exception 'H2_TEMP_RETURNS'; end if;

  -- A later primary closes the previous one; cancelling it restores the end.
  v_codes := public.submit_hrm_site_assignment(jsonb_build_object('employeeIds', jsonb_build_array(v_e1), 'siteId', v_b, 'kind', 'primary',
    'startDate', v_today + 20, 'reason', 'Smoke chuyển tiếp'));
  select id into v_second from public.hrm_site_assignments where code = v_codes[1];
  perform public.decide_hrm_site_assignment(v_second, true, null);
  if (select end_date from public.hrm_site_assignments where id = v_primary) is distinct from v_today + 19 then raise exception 'H2_PREVIOUS_NOT_CLOSED'; end if;
  perform public.cancel_hrm_site_assignment(v_second, 'Smoke đổi ý');
  if (select end_date from public.hrm_site_assignments where id = v_primary) is not null then raise exception 'H2_PREVIOUS_NOT_RESTORED'; end if;

  -- Not started yet → cannot end early.
  begin
    perform public.change_hrm_site_assignment_end(v_primary, v_today + 30, 'Smoke kết thúc');
    raise exception 'H2_END_BEFORE_START';
  exception when check_violation then null;
  end;

  -- Review: e2 confirmed at site A starts today and drives the profile site.
  perform public.confirm_hrm_site_assignment_review(jsonb_build_array(jsonb_build_object('employeeId', current_setting('test.h2.e2'), 'siteId', v_a)));
  if (select construction_site_id from public.employees where id = current_setting('test.h2.e2')::uuid) is distinct from v_a then raise exception 'H2_REVIEW_SYNC'; end if;
  select id into v_primary from public.hrm_site_assignments where employee_id = current_setting('test.h2.e2')::uuid and source = 'baseline';
  perform public.change_hrm_site_assignment_end(v_primary, v_today + 2, 'Smoke kết thúc sớm');
  if (select ended_early_reason from public.hrm_site_assignments where id = v_primary) is null then raise exception 'H2_END_EARLY'; end if;

  v_board := public.get_hrm_site_assignment_board();
  if not (v_board -> 'can' ->> 'approve')::boolean or jsonb_array_length(v_board -> 'sites') = 0 then raise exception 'H2_BOARD %', v_board -> 'can'; end if;
  if not exists (select 1 from jsonb_array_elements(v_board -> 'assignments') row where row ->> 'id' = v_temp::text) then raise exception 'H2_BOARD_ROWS'; end if;
end;
$$;
reset role;

-- e2's phone check-in prefers the assigned site.
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.h2.e2_auth'))::text, true);
set local role authenticated;
do $$
begin
  if not (public.get_my_checkin_context() -> 'assignedSiteIds') @> to_jsonb(array[current_setting('test.h2.site_a')]) then
    raise exception 'H2_CHECKIN_SITE';
  end if;
end;
$$;
reset role;

select 'hrm_h2_site_assignment_smoke passed' as result;
rollback;
