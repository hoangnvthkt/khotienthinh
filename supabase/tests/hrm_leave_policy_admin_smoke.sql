-- Run after 20261008140000_hrm_leave_policy_admin. Rolls back.
begin;
set local statement_timeout = '90s';

-- Requester: an active non-HR office employee. Manager: someone allowed to manage leave policy.
select set_config('test.lp.auth_id', u.auth_id::text, true),
       set_config('test.lp.email', u.email, true),
       set_config('test.lp.user_id', u.id::text, true),
       set_config('test.lp.employee_id', e.id::text, true)
from public.users u join public.employees e on e.user_id = u.id and e.status = 'Đang làm việc'
where u.is_active and u.auth_id is not null and u.role <> 'ADMIN' and e.construction_site_id is null
  and not app_private.has_hrm_template_permission(u.id, 'hrm.employee.view_sensitive')
  and not app_private.has_hrm_template_permission(u.id, 'hrm.master_data.manage')
order by u.created_at limit 1;

select set_config('test.lp.hr_auth', u.auth_id::text, true),
       set_config('test.lp.hr_email', u.email, true)
from public.users u
where u.is_active and u.auth_id is not null and app_private.has_hrm_template_permission(u.id, 'hrm.master_data.manage')
order by u.created_at limit 1;

-- Backfill: today's step-2 types keep the 3-day rule; seeded reasons are in place.
do $$
begin
  if (select second_step_after_days from public.hrm_leave_types where code = 'annual') is distinct from 3 then raise exception 'LP_BACKFILL_ANNUAL'; end if;
  if (select second_step_after_days from public.hrm_leave_types where code = 'sick') is not null then raise exception 'LP_BACKFILL_SICK'; end if;
  if jsonb_array_length((select subtypes from public.hrm_leave_types where code = 'personal')) <> 3 then raise exception 'LP_SEED_PERSONAL'; end if;
  if jsonb_array_length((select subtypes from public.hrm_leave_types where code = 'late_early')) <> 3 then raise exception 'LP_SEED_LATE'; end if;
  if (select requires_attachment from public.hrm_leave_types where code = 'sick') then raise exception 'LP_SICK_ATTACH_DEFAULT'; end if;
end;
$$;

-- ── Ordinary employee cannot change policy, nor write the tables directly ──
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.lp.auth_id'), 'email', current_setting('test.lp.email'))::text, true);
set local role authenticated;
do $$
declare v_count integer;
begin
  begin
    perform public.save_hrm_leave_type('personal', '{"name": "Hack"}'::jsonb);
    raise exception 'LP_EMPLOYEE_CAN_SAVE';
  exception when insufficient_privilege then null;
  end;
  update public.hrm_leave_types set name = 'Hack' where code = 'personal';
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'LP_EMPLOYEE_DIRECT_WRITE'; end if;
  begin
    perform public.list_hrm_leave_policy_log(10);
    raise exception 'LP_EMPLOYEE_READS_LOG';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- ── HR Manage edits types and the shared rules ─────────────────────────────
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.lp.hr_auth'), 'email', current_setting('test.lp.hr_email'))::text, true);
set local role authenticated;
do $$
declare v_code text; v_log jsonb;
begin
  -- Attachment without saying which paper is refused.
  begin
    perform public.save_hrm_leave_type('personal', '{"name": "Việc riêng có lương", "paidBy": "company", "requiresAttachment": true, "attachmentHint": "", "subtypes": [{"name": "Kết hôn", "maxDays": 3}, {"name": "Con đẻ, con nuôi kết hôn", "maxDays": 1}]}'::jsonb);
    raise exception 'LP_ATTACH_WITHOUT_HINT';
  exception when invalid_parameter_value then null;
  end;
  perform public.save_hrm_leave_type('personal', '{"name": "Việc riêng có lương", "paidBy": "company", "secondStepAfterDays": 1, "requiresAttachment": true, "attachmentHint": "Giấy đăng ký kết hôn", "subtypes": [{"name": "Kết hôn", "maxDays": 3}, {"name": " Con đẻ, con nuôi kết hôn ", "maxDays": 1}, {"name": "", "maxDays": 2}]}'::jsonb);
  if (select second_step_after_days from public.hrm_leave_types where code = 'personal') is distinct from 1 then raise exception 'LP_THRESHOLD_NOT_SAVED'; end if;
  if (select subtypes -> 1 ->> 'name' from public.hrm_leave_types where code = 'personal') <> 'Con đẻ, con nuôi kết hôn' then raise exception 'LP_SUBTYPE_NOT_TRIMMED'; end if;
  if jsonb_array_length((select subtypes from public.hrm_leave_types where code = 'personal')) <> 2 then raise exception 'LP_EMPTY_SUBTYPE_KEPT'; end if;

  -- Locked parts of system types.
  begin
    perform public.save_hrm_leave_type('annual', '{"name": "Phép năm", "paidBy": "none", "secondStepAfterDays": 3, "requiresOfficial": true}'::jsonb);
    raise exception 'LP_ANNUAL_PAID_BY_CHANGED';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.save_hrm_leave_type('late_early', '{"name": "Đi muộn / về sớm có lý do", "paidBy": "company", "hrStep": true, "subtypes": [{"name": "Đi muộn"}]}'::jsonb);
    raise exception 'LP_LATE_SUBTYPES_CHANGED';
  exception when insufficient_privilege then null;
  end;

  -- New type; duplicate names refused; switched off, not deleted.
  v_code := public.save_hrm_leave_type(null, '{"name": "Nghỉ bù smoke", "paidBy": "company", "subtypes": [{"name": "Bù Chủ nhật", "maxDays": 1}]}'::jsonb);
  if v_code not like 'custom_%' or (select unit from public.hrm_leave_types where code = v_code) <> 'day' then raise exception 'LP_CREATE %', v_code; end if;
  begin
    perform public.save_hrm_leave_type(null, '{"name": "nghỉ bù SMOKE", "paidBy": "none"}'::jsonb);
    raise exception 'LP_DUPLICATE_NAME';
  exception when unique_violation then null;
  end;
  perform public.set_hrm_leave_type_active(v_code, false);
  if (select is_active from public.hrm_leave_types where code = v_code) then raise exception 'LP_DEACTIVATE'; end if;

  -- Shared rules.
  begin
    perform public.save_hrm_leave_settings('{"secondStepLabel": "", "lateEarlyMaxMinutes": 60, "saturdayIsWorkday": true}'::jsonb);
    raise exception 'LP_EMPTY_LABEL';
  exception when invalid_parameter_value then null;
  end;
  perform public.save_hrm_leave_settings(jsonb_build_object(
    'secondStepApproverUserId', (select second_step_approver_user_id from public.hrm_leave_settings),
    'secondStepLabel', 'Tổng giám đốc', 'lateEarlyMaxMinutes', 45, 'saturdayIsWorkday', true));

  v_log := public.list_hrm_leave_policy_log(20);
  if jsonb_array_length(v_log) < 4 then raise exception 'LP_LOG_COUNT %', v_log; end if;
  if not exists (select 1 from jsonb_array_elements(v_log) row where row ->> 'target' = 'personal' and row -> 'changes' ? 'secondStepAfterDays') then
    raise exception 'LP_LOG_DIFF %', v_log;
  end if;
  if not exists (select 1 from jsonb_array_elements(v_log) row where row ->> 'target' = v_code and row ->> 'action' = 'deactivate') then
    raise exception 'LP_LOG_DEACTIVATE';
  end if;
end;
$$;
reset role;

-- A paper uploaded by the requester (the app uploads through Storage before sending).
insert into storage.objects (bucket_id, name) values ('hrm-leave-evidence', current_setting('test.lp.employee_id') || '/smoke-paper.jpg');

-- ── Employee: reasons, limits, papers, director threshold ──────────────────
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.lp.auth_id'), 'email', current_setting('test.lp.email'))::text, true);
set local role authenticated;
do $$
declare v_preview jsonb; v_row public.hrm_leave_requests; v_path text := current_setting('test.lp.employee_id') || '/smoke-paper.jpg';
begin
  -- Mon 2099-06-01 … Wed 06-03 = 3 working days.
  v_preview := public.preview_my_leave_request('personal', '2099-06-01', '2099-06-03', 'full', 'full', null, 'Con đẻ, con nuôi kết hôn');
  if jsonb_array_length(v_preview -> 'problems') = 0 then raise exception 'LP_LIMIT_NOT_CHECKED %', v_preview; end if;
  v_preview := public.preview_my_leave_request('personal', '2099-06-01', '2099-06-03', 'full', 'full', null, 'Kết hôn');
  if jsonb_array_length(v_preview -> 'problems') > 0 then raise exception 'LP_LIMIT_FALSE_ALARM %', v_preview; end if;
  -- Threshold 1 day → director step when someone else is the director.
  if (select second_step_approver_user_id from public.hrm_leave_settings) is distinct from (v_preview -> 'steps' -> 0 ->> 'userId')::uuid
     and not exists (select 1 from jsonb_array_elements(v_preview -> 'steps') step where step ->> 'kind' = 'director') then
    raise exception 'LP_DIRECTOR_STEP_MISSING %', v_preview;
  end if;
  v_preview := public.preview_my_leave_request('personal', '2099-06-01', '2099-06-03', 'full', 'full', null, 'Không có trong danh sách');
  if jsonb_array_length(v_preview -> 'problems') = 0 then raise exception 'LP_UNKNOWN_REASON'; end if;

  begin
    perform public.submit_my_leave_request('personal', '2099-06-01', '2099-06-03', 'full', 'full', null, null, 'Cưới', array[v_path]);
    raise exception 'LP_SUBMIT_WITHOUT_REASON';
  exception when check_violation then null;
  end;
  begin
    perform public.submit_my_leave_request('personal', '2099-06-01', '2099-06-03', 'full', 'full', null, 'Kết hôn', 'Cưới');
    raise exception 'LP_SUBMIT_WITHOUT_PAPER';
  exception when check_violation then null;
  end;
  begin
    perform public.submit_my_leave_request('personal', '2099-06-01', '2099-06-03', 'full', 'full', null, 'Kết hôn', 'Cưới', array['00000000-0000-0000-0000-000000000000/x.jpg']);
    raise exception 'LP_SUBMIT_FOREIGN_PAPER';
  exception when invalid_parameter_value then null;
  end;
  v_row := public.submit_my_leave_request('personal', '2099-06-01', '2099-06-03', 'full', 'full', null, 'Kết hôn', 'Cưới', array[v_path]);
  if v_row.attachment_paths <> array[v_path] or v_row.subtype <> 'Kết hôn' then raise exception 'LP_SUBMIT_STORED %', v_row; end if;
  perform set_config('test.lp.request_id', v_row.id::text, true);
  perform set_config('test.lp.step1', coalesce(v_row.approvers -> 0 ->> 'userId', ''), true);

  -- Old 8-argument calls (late/early explanation from the timesheet) still work.
  v_row := public.submit_my_leave_request('late_early', '2099-06-08', '2099-06-08', 'full', 'full', 20, 'Đi muộn', 'Kẹt xe');
  if v_row.attachment_paths <> '{}'::text[] then raise exception 'LP_LATE_PATHS'; end if;
  begin
    perform public.submit_my_leave_request('late_early', '2099-06-09', '2099-06-09', 'full', 'full', 50, 'Đi muộn', 'Kẹt xe');
    raise exception 'LP_LATE_MAX_NOT_UPDATED';
  exception when check_violation then null;
  end;
end;
$$;
reset role;

-- The step-1 approver sees the paper; an unrelated employee does not.
do $$
declare v_path text := current_setting('test.lp.employee_id') || '/smoke-paper.jpg'; v_other uuid;
begin
  if nullif(current_setting('test.lp.step1'), '') is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub',
      (select auth_id::text from public.users where id = current_setting('test.lp.step1')::uuid))::text, true);
    if not app_private.hrm_leave_attachment_visible(v_path) then raise exception 'LP_APPROVER_CANNOT_SEE'; end if;
  end if;
  select u.id into v_other from public.users u
  where u.is_active and u.auth_id is not null and u.id::text <> current_setting('test.lp.user_id') and u.id::text <> current_setting('test.lp.step1')
    and not app_private.has_hrm_template_permission(u.id, 'hrm.employee.view_sensitive')
    and not (u.id = any(app_private.hrm_leave_hr_user_ids()))
    and u.id <> coalesce((select second_step_approver_user_id from public.hrm_leave_settings), gen_random_uuid())
  order by u.created_at limit 1;
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub',
    (select auth_id::text from public.users where id = v_other))::text, true);
  if app_private.hrm_leave_attachment_visible(v_path) then raise exception 'LP_STRANGER_SEES_PAPER'; end if;
end;
$$;

select 'hrm_leave_policy_admin_smoke passed' as result;
rollback;
