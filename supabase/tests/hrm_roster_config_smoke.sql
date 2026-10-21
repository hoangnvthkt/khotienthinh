-- Run after 20261017130000_hrm_roster_config. Rolls back.
begin;
set local statement_timeout = '120s';

-- HR (no pay), two HR Manage approvers A (with an employee record) and B, a non-HR person X with an account, two plain subjects.
select set_config('test.c.hr_auth', u.auth_id::text, true)
from public.users u where u.is_active and u.auth_id is not null and app_private.hrm_roster_access(u.id) = 'HR'
  and app_private.has_hrm_template_permission(u.id, 'hrm.employee.import') order by u.name limit 1;
select set_config('test.c.a_auth', u.auth_id::text, true), set_config('test.c.a_id', u.id::text, true)
from public.users u join public.employees e on e.user_id = u.id
where u.is_active and u.auth_id is not null and app_private.hrm_roster_access(u.id) = 'HR_MANAGE' order by u.name limit 1;
select set_config('test.c.b_auth', u.auth_id::text, true), set_config('test.c.b_id', u.id::text, true)
from public.users u where u.is_active and u.auth_id is not null and app_private.hrm_roster_access(u.id) = 'HR_MANAGE'
  and u.id::text <> current_setting('test.c.a_id') order by u.name limit 1;
select set_config('test.c.x_auth', u.auth_id::text, true), set_config('test.c.x_id', u.id::text, true)
from public.users u join public.employees e on e.user_id = u.id and e.status = 'Đang làm việc'
where u.is_active and u.auth_id is not null and app_private.hrm_roster_access(u.id) is null order by u.name limit 1;
select set_config('test.c.e1', e.id::text, true)
from public.employees e left join public.users u on u.id = e.user_id
where e.status = 'Đang làm việc' and (u.id is null or (app_private.hrm_roster_access(u.id) is null and u.id::text <> current_setting('test.c.x_id')))
order by e.employee_code limit 1;
select set_config('test.c.e2', e.id::text, true)
from public.employees e left join public.users u on u.id = e.user_id
where e.status = 'Đang làm việc' and (u.id is null or (app_private.hrm_roster_access(u.id) is null and u.id::text <> current_setting('test.c.x_id')))
  and e.id::text <> current_setting('test.c.e1') order by e.employee_code desc limit 1;
select set_config('test.c.unit', (select id::text from public.org_units where code = 'QLDA'), true);

do $$
begin
  if current_setting('test.c.hr_auth', true) is null or current_setting('test.c.a_auth', true) is null or current_setting('test.c.b_auth', true) is null
    or current_setting('test.c.x_auth', true) is null or current_setting('test.c.e1', true) is null or current_setting('test.c.e2', true) is null then
    raise exception 'CONFIG_SMOKE_FIXTURE_MISSING';
  end if;
  if not exists (select 1 from public.hrm_roster_settings where id) then raise exception 'CONFIG_SETTINGS_ROW_MISSING'; end if;
end;
$$;

-- ── B (HR Manage) sets approvers and adds columns ──────────────────────────
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.c.b_auth'))::text, true);
set local role authenticated;
do $$
declare v_config jsonb; v_field jsonb;
begin
  v_config := public.get_hrm_roster_config();
  if jsonb_array_length(v_config -> 'candidates') = 0 or jsonb_array_length(v_config -> 'defaultApproverIds') < 2 then raise exception 'CONFIG_EMPTY %', v_config - 'candidates'; end if;
  v_config := public.save_hrm_roster_approvals(jsonb_build_object(
    'general', jsonb_build_object('step1', jsonb_build_array(current_setting('test.c.a_id'), current_setting('test.c.b_id'), current_setting('test.c.a_id')), 'step2', '[]'::jsonb),
    'pay', jsonb_build_object('step1', jsonb_build_array(current_setting('test.c.a_id'), current_setting('test.c.b_id')), 'step2', jsonb_build_array(current_setting('test.c.x_id')))));
  if jsonb_array_length(v_config #> '{approvals,general,step1}') <> 2 or v_config #>> '{approvals,pay,step2,0}' <> current_setting('test.c.x_id') then
    raise exception 'CONFIG_APPROVALS_NOT_SAVED %', v_config -> 'approvals';
  end if;
  begin
    perform public.save_hrm_roster_approvals(jsonb_build_object('general', jsonb_build_object('step1', jsonb_build_array('nope'), 'step2', '[]'::jsonb),
      'pay', jsonb_build_object('step1', '[]'::jsonb, 'step2', '[]'::jsonb)));
    raise exception 'CONFIG_BAD_APPROVER_ACCEPTED';
  exception when invalid_parameter_value then null;
  end;

  v_field := public.save_hrm_roster_custom_field(null, 'Loại HĐ smoke', 'contract', 'select', array['HĐ 1 năm', 'HĐ KXĐ', 'hđ 1 năm'], false, false, null);
  if jsonb_array_length(v_field -> 'options') <> 2 or v_field ->> 'key' !~ '^custom:' then raise exception 'CONFIG_FIELD_OPTIONS %', v_field; end if;
  perform set_config('test.c.f_select', v_field ->> 'id', true);
  perform set_config('test.c.k_select', v_field ->> 'key', true);
  v_field := public.save_hrm_roster_custom_field(null, 'BHXH smoke', 'pay', 'money', null, false, false, 'Lương đóng BHXH');
  if not (v_field ->> 'payOnly')::boolean then raise exception 'CONFIG_PAY_FIELD_NOT_PRIVATE'; end if;
  perform set_config('test.c.k_pay', v_field ->> 'key', true);
  begin
    perform public.save_hrm_roster_custom_field(null, 'loại hđ SMOKE', 'other', 'text', null, false, false, null);
    raise exception 'CONFIG_DUPLICATE_LABEL_ACCEPTED';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.save_hrm_roster_custom_field(null, 'CCCD', 'other', 'text', null, false, false, null);
    raise exception 'CONFIG_STANDARD_LABEL_ACCEPTED';
  exception when invalid_parameter_value then null;
  end;
end;
$$;
reset role;

-- ── HR: sees the columns, cannot configure, sends a request with a custom value ──
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.c.hr_auth'))::text, true);
set local role authenticated;
do $$
declare v_roster jsonb; v_result jsonb; v_batch jsonb;
begin
  v_roster := public.get_hrm_roster();
  if (v_roster -> 'can' ->> 'configure')::boolean then raise exception 'CONFIG_HR_CAN_CONFIGURE'; end if;
  if not exists (select 1 from jsonb_array_elements(v_roster -> 'customFields') f where f ->> 'key' = current_setting('test.c.k_select')) then
    raise exception 'CONFIG_HR_MISSING_COLUMN';
  end if;
  begin perform public.get_hrm_roster_config(); raise exception 'CONFIG_HR_READS_CONFIG';
  exception when insufficient_privilege then null; end;
  begin
    perform public.submit_hrm_roster_batch('grid', 'Thử', 'HR đổi cột lương thêm', app_private.hrm_vn_today(),
      jsonb_build_array(jsonb_build_object('employeeId', current_setting('test.c.e1'), 'field', current_setting('test.c.k_pay'), 'newValue', 5000000)), null);
    raise exception 'CONFIG_HR_SENDS_CUSTOM_PAY';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.submit_hrm_roster_batch('grid', 'Thử', 'Lựa chọn không có trong danh sách', app_private.hrm_vn_today(),
      jsonb_build_array(jsonb_build_object('employeeId', current_setting('test.c.e1'), 'field', current_setting('test.c.k_select'), 'newValue', 'HĐ 5 năm')), null);
    raise exception 'CONFIG_BAD_OPTION_ACCEPTED';
  exception when invalid_parameter_value then null;
  end;
  v_result := public.submit_hrm_roster_batch('grid', 'Đổi bộ phận', 'Smoke cấu hình: đổi bộ phận và loại HĐ', app_private.hrm_vn_today(), jsonb_build_array(
    jsonb_build_object('employeeId', current_setting('test.c.e1'), 'field', 'orgUnit', 'newValue', current_setting('test.c.unit')),
    jsonb_build_object('employeeId', current_setting('test.c.e1'), 'field', current_setting('test.c.k_select'), 'newValue', 'HĐ KXĐ')), null);
  perform set_config('test.c.hr_batch', v_result ->> 'id', true);
  v_batch := public.get_hrm_roster_batch((v_result ->> 'id')::uuid);
  if v_batch ->> 'approvalGroup' <> 'general' or jsonb_array_length(v_batch -> 'steps') <> 1 then raise exception 'CONFIG_GENERAL_STEPS %', v_batch -> 'steps'; end if;
end;
$$;
reset role;

-- ── A sends pay + other cells: split into two requests; pay has step 2 (X) ──
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.c.a_auth'))::text, true);
set local role authenticated;
do $$
declare v_result jsonb; v_list jsonb; v_pay jsonb;
begin
  v_result := public.submit_hrm_roster_batch('grid', 'Đổi SĐT và lương', 'Smoke cấu hình: tách phiếu lương', app_private.hrm_vn_today(), jsonb_build_array(
    jsonb_build_object('employeeId', current_setting('test.c.e2'), 'field', 'phone', 'newValue', '0911000222'),
    jsonb_build_object('employeeId', current_setting('test.c.e2'), 'field', 'p1', 'newValue', 6600000),
    jsonb_build_object('employeeId', current_setting('test.c.e2'), 'field', current_setting('test.c.k_pay'), 'newValue', 5100000)), null);
  if jsonb_array_length(v_result -> 'codes') <> 2 then raise exception 'CONFIG_PAY_NOT_SPLIT %', v_result; end if;
  v_list := public.list_hrm_roster_batches('pending');
  select item into v_pay from jsonb_array_elements(v_list) item where item ->> 'approvalGroup' = 'pay' and item ->> 'title' like 'Đổi SĐT và lương%';
  if v_pay is null or jsonb_array_length(v_pay -> 'steps') <> 2 or (v_pay ->> 'itemCount')::int <> 2 then raise exception 'CONFIG_PAY_BATCH %', v_pay; end if;
  perform set_config('test.c.pay_batch', v_pay ->> 'id', true);
  perform set_config('test.c.a_general', (select item ->> 'id' from jsonb_array_elements(v_list) item
    where item ->> 'approvalGroup' = 'general' and item ->> 'title' = 'Đổi SĐT và lương'), true);
  begin
    perform public.decide_hrm_roster_batch((v_pay ->> 'id')::uuid, true, null);
    raise exception 'CONFIG_SENDER_DECIDED';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- ── B approves the HR request, A's other cells, and step 1 of the pay request ──
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.c.b_auth'))::text, true);
set local role authenticated;
do $$
declare v_batch jsonb;
begin
  perform public.decide_hrm_roster_batch(current_setting('test.c.hr_batch')::uuid, true, null);
  perform public.decide_hrm_roster_batch(current_setting('test.c.a_general')::uuid, true, null);
  v_batch := public.decide_hrm_roster_batch(current_setting('test.c.pay_batch')::uuid, true, null);
  if v_batch ->> 'status' <> 'pending' or (v_batch ->> 'currentStep')::int <> 2 or (v_batch -> 'can' ->> 'decide')::boolean then
    raise exception 'CONFIG_STEP1_NOT_MOVED %', v_batch - 'items';
  end if;
  begin
    perform public.decide_hrm_roster_batch(current_setting('test.c.pay_batch')::uuid, true, null);
    raise exception 'CONFIG_SAME_PERSON_TWO_STEPS';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

do $$
begin
  if (select value #>> '{}' from public.hrm_employee_custom_values v join public.hrm_roster_custom_fields f on f.id = v.field_id
      where v.employee_id = current_setting('test.c.e1')::uuid and f.key = current_setting('test.c.k_select')) <> 'HĐ KXĐ' then
    raise exception 'CONFIG_CUSTOM_VALUE_NOT_APPLIED';
  end if;
  if (select phone from public.employees where id = current_setting('test.c.e2')::uuid) <> '0911000222' then raise exception 'CONFIG_GENERAL_NOT_APPLIED'; end if;
  if exists (select 1 from public.hrm_employee_pay_profiles where employee_id = current_setting('test.c.e2')::uuid and p1 = 6600000) then
    raise exception 'CONFIG_PAY_APPLIED_AFTER_STEP1';
  end if;
end;
$$;

-- ── X (not HR) sees only the request given to them and approves step 2 ─────
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.c.x_auth'))::text, true);
set local role authenticated;
do $$
declare v_roster jsonb; v_list jsonb; v_batch jsonb;
begin
  v_roster := public.get_hrm_roster();
  if not (v_roster -> 'can' ->> 'approverOnly')::boolean or jsonb_array_length(v_roster -> 'rows') <> 0 then raise exception 'CONFIG_X_ROSTER %', v_roster -> 'can'; end if;
  v_list := public.list_hrm_roster_batches('pending');
  if exists (select 1 from jsonb_array_elements(v_list) item where (item ->> 'approvalGroup') <> 'pay') then raise exception 'CONFIG_X_SEES_GENERAL'; end if;
  begin perform public.get_hrm_roster_batch(current_setting('test.c.hr_batch')::uuid); raise exception 'CONFIG_X_OPENS_GENERAL';
  exception when insufficient_privilege then null; end;
  begin perform public.get_hrm_roster_config(); raise exception 'CONFIG_X_READS_CONFIG';
  exception when insufficient_privilege then null; end;
  v_batch := public.get_hrm_roster_batch(current_setting('test.c.pay_batch')::uuid);
  if jsonb_array_length(v_batch -> 'items') <> 2 then raise exception 'CONFIG_X_PAY_HIDDEN %', v_batch -> 'items'; end if;
  v_batch := public.decide_hrm_roster_batch(current_setting('test.c.pay_batch')::uuid, true, null);
  if v_batch ->> 'status' <> 'approved' or v_batch #>> '{steps,1,decidedByName}' is null then raise exception 'CONFIG_STEP2_NOT_APPROVED %', v_batch - 'items'; end if;
end;
$$;
reset role;

do $$
begin
  if (select p1 from public.hrm_employee_pay_profiles where employee_id = current_setting('test.c.e2')::uuid) <> 6600000 then raise exception 'CONFIG_PAY_NOT_APPLIED'; end if;
  if (select (value #>> '{}')::numeric from public.hrm_employee_custom_values v join public.hrm_roster_custom_fields f on f.id = v.field_id
      where v.employee_id = current_setting('test.c.e2')::uuid and f.key = current_setting('test.c.k_pay')) <> 5100000 then
    raise exception 'CONFIG_CUSTOM_PAY_NOT_APPLIED';
  end if;
end;
$$;

-- ── Columns with values are hidden, not deleted; one approver alone cannot approve their own request ──
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.c.b_auth'))::text, true);
set local role authenticated;
do $$
declare v_field jsonb;
begin
  begin perform public.delete_hrm_roster_custom_field(current_setting('test.c.f_select')::uuid); raise exception 'CONFIG_DELETED_USED_FIELD';
  exception when invalid_parameter_value then null; end;
  begin perform public.save_hrm_roster_custom_field(current_setting('test.c.f_select')::uuid, 'Loại HĐ smoke', 'contract', 'text', null, false, false, null);
    raise exception 'CONFIG_TYPE_CHANGED_WITH_VALUES';
  exception when invalid_parameter_value then null; end;
  begin perform public.save_hrm_roster_custom_field(current_setting('test.c.f_select')::uuid, 'Loại HĐ smoke', 'contract', 'select', array['HĐ 1 năm', 'CTV'], false, false, null);
    raise exception 'CONFIG_USED_OPTION_REMOVED';
  exception when invalid_parameter_value then null; end;
  v_field := public.set_hrm_roster_custom_field_active(current_setting('test.c.f_select')::uuid, false);
  if (v_field ->> 'isActive')::boolean or (v_field ->> 'filledCount')::int < 1 then raise exception 'CONFIG_HIDE %', v_field; end if;
  perform public.save_hrm_roster_approvals(jsonb_build_object(
    'general', jsonb_build_object('step1', jsonb_build_array(current_setting('test.c.a_id')), 'step2', '[]'::jsonb),
    'pay', jsonb_build_object('step1', '[]'::jsonb, 'step2', '[]'::jsonb)));
end;
$$;
reset role;

select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.c.a_auth'))::text, true);
set local role authenticated;
do $$
begin
  perform public.submit_hrm_roster_batch('grid', 'Thử', 'Chỉ một người duyệt là chính mình', app_private.hrm_vn_today(),
    jsonb_build_array(jsonb_build_object('employeeId', current_setting('test.c.e1'), 'field', 'phone', 'newValue', '0911000333')), null);
  raise exception 'CONFIG_NO_APPROVER_ACCEPTED';
exception when invalid_parameter_value then
  if sqlerrm <> 'HRM_ROSTER_NO_APPROVER' then raise; end if;
end;
$$;
reset role;

select 'hrm_roster_config_smoke ok' as result;
rollback;
