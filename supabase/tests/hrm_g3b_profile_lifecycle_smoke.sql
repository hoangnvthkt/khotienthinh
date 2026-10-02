-- Run after 20261007100000_hrm_g3b_profile_lifecycle. Rolls back.
begin;
set local statement_timeout = '90s';

-- Employee persona: a regular staff member with an account. HR persona: an HR Manage holder.
select set_config('test.g3b.emp_auth', u.auth_id::text, true),
       set_config('test.g3b.emp_email', u.email, true),
       set_config('test.g3b.emp_user', u.id::text, true),
       set_config('test.g3b.emp_id', e.id::text, true)
from public.users u join public.employees e on e.user_id = u.id and e.status = 'Đang làm việc'
where u.is_active and u.auth_id is not null and u.role <> 'ADMIN'
  and not app_private.has_hrm_template_permission(u.id, 'hrm.employee.view_sensitive')
order by u.created_at limit 1;

select set_config('test.g3b.hr_auth', u.auth_id::text, true),
       set_config('test.g3b.hr_email', u.email, true),
       set_config('test.g3b.hr_user', u.id::text, true)
from public.users u
where u.is_active and u.auth_id is not null
  and app_private.has_hrm_template_permission(u.id, 'hrm.compensation.manage')
  and app_private.has_hrm_template_permission(u.id, 'hrm.employee.edit_sensitive')
  and u.id <> current_setting('test.g3b.emp_user')::uuid
order by u.created_at limit 1;

-- ── Employee: submit, guardrails, cannot read the HR queue ──
select set_config('request.jwt.claim.sub', current_setting('test.g3b.emp_auth'), true);
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.g3b.emp_auth'), 'email', current_setting('test.g3b.emp_email'))::text, true);
set local role authenticated;
do $$
declare v_id uuid; v_mine jsonb;
begin
  v_id := public.submit_my_hrm_profile_change('address',
    '{"addressType":"CURRENT","provinceCode":"HA_NOI","wardName":"Phường Cầu Giấy","addressLine":"Số 1 ngõ 2"}',
    'Chuyển nhà', array[current_setting('test.g3b.emp_id') || '/cccd.jpg']);
  perform set_config('test.g3b.req_address', v_id::text, true);
  v_id := public.submit_my_hrm_profile_change('bank',
    '{"bankCode":"VCB","accountNumber":"0011223344","accountHolder":"NGUYEN VAN A"}', null, '{}');
  perform set_config('test.g3b.req_bank', v_id::text, true);
  v_id := public.submit_my_hrm_profile_change('identity',
    '{"documentTypeCode":"CCCD","documentNumber":"001099000001","expiryDate":"2040-01-01"}', null, '{}');
  perform set_config('test.g3b.req_identity', v_id::text, true);

  begin
    perform public.submit_my_hrm_profile_change('other', '{}', null, '{}');
    raise exception 'HRM_G3B_OTHER_WITHOUT_NOTE_ACCEPTED';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.submit_my_hrm_profile_change('bank', '{"bankCode":"VCB"}', null, array[gen_random_uuid()::text || '/x.jpg']);
    raise exception 'HRM_G3B_FOREIGN_ATTACHMENT_ACCEPTED';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.list_hrm_profile_change_requests('pending');
    raise exception 'HRM_G3B_EMPLOYEE_READS_QUEUE';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.list_hrm_direct_managers();
    raise exception 'HRM_G3B_EMPLOYEE_READS_MANAGERS';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.list_hrm_hr_reminders(30);
    raise exception 'HRM_G3B_EMPLOYEE_READS_REMINDERS';
  exception when sqlstate '42501' then null;
  end;

  v_mine := public.list_my_hrm_profile_changes();
  if jsonb_array_length(v_mine) < 3 or v_mine -> 0 ->> 'status' <> 'pending' then
    raise exception 'HRM_G3B_MY_LIST %', v_mine;
  end if;
end;
$$;
reset role;

select set_config('test.g3b.active_count', (select count(*) from public.employees where status = 'Đang làm việc')::text, true);

-- A certificate 7 days from expiry, for the reminder checks.
insert into public.hrm_employee_certifications (employee_id, record_code, certification_name, expiry_date)
values (current_setting('test.g3b.emp_id')::uuid, 'G3B-SMOKE', 'Thẻ an toàn lao động', current_date + 7);

-- ── HR: queue, approve with a correction, approve pay data, reject needs a reason ──
select set_config('request.jwt.claim.sub', current_setting('test.g3b.hr_auth'), true);
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.g3b.hr_auth'), 'email', current_setting('test.g3b.hr_email'))::text, true);
set local role authenticated;
do $$
declare v_queue jsonb; v_result jsonb; v_contact jsonb; v_list jsonb; v_row jsonb;
begin
  v_queue := public.list_hrm_profile_change_requests('pending');
  if not exists (select 1 from jsonb_array_elements(v_queue) item where item ->> 'id' = current_setting('test.g3b.req_bank')
                 and (item ->> 'needsCompensationManager')::boolean) then
    raise exception 'HRM_G3B_QUEUE %', v_queue;
  end if;

  v_result := public.decide_hrm_profile_change(current_setting('test.g3b.req_address')::uuid, true, null,
    '{"addressType":"CURRENT","provinceCode":"HA_NOI","wardName":"Phường Cầu Giấy","addressLine":"Số 1 ngõ 2 Trần Thái Tông"}');
  if v_result ->> 'status' <> 'approved' then raise exception 'HRM_G3B_APPROVE %', v_result; end if;
  v_contact := public.get_hrm_employee_personal_contact(current_setting('test.g3b.emp_id')::uuid);
  if not exists (select 1 from jsonb_array_elements(v_contact -> 'addresses') a
                 where a ->> 'wardName' = 'Phường Cầu Giấy' and a ->> 'addressLine' like '%Trần Thái Tông') then
    raise exception 'HRM_G3B_ADDRESS_NOT_WRITTEN %', v_contact -> 'addresses';
  end if;

  perform public.decide_hrm_profile_change(current_setting('test.g3b.req_bank')::uuid, true, 'Đã đối chiếu thẻ', null);

  begin
    perform public.decide_hrm_profile_change(current_setting('test.g3b.req_identity')::uuid, false, null, null);
    raise exception 'HRM_G3B_REJECT_WITHOUT_REASON';
  exception when sqlstate '22023' then null;
  end;
  perform public.decide_hrm_profile_change(current_setting('test.g3b.req_identity')::uuid, false, 'Ảnh mờ, chụp lại', null);
  begin
    perform public.decide_hrm_profile_change(current_setting('test.g3b.req_identity')::uuid, true, null, null);
    raise exception 'HRM_G3B_DECIDED_TWICE';
  exception when sqlstate '22023' then null;
  end;

  -- Reminders: a certificate 7 days from expiry shows up.
  v_list := public.list_hrm_hr_reminders(30);
  if not exists (select 1 from jsonb_array_elements(v_list) item
                 where item ->> 'kind' = 'certification' and (item ->> 'daysLeft')::int = 7) then
    raise exception 'HRM_G3B_REMINDER %', v_list;
  end if;

  -- Direct managers: every active employee listed, with a source.
  v_list := public.list_hrm_direct_managers();
  if jsonb_array_length(v_list) <> current_setting('test.g3b.active_count')::int then
    raise exception 'HRM_G3B_MANAGER_LIST_COUNT %', jsonb_array_length(v_list);
  end if;
  perform public.set_hrm_designated_manager(current_setting('test.g3b.emp_id')::uuid,
    current_setting('test.g3b.hr_user')::uuid, 'Chỉ định quản lý trực tiếp khi sơ đồ chưa có');
  select item into v_row from jsonb_array_elements(public.list_hrm_direct_managers()) item
  where item ->> 'employeeId' = current_setting('test.g3b.emp_id');
  if v_row ->> 'designatedManagerUserId' <> current_setting('test.g3b.hr_user') then
    raise exception 'HRM_G3B_DESIGNATE %', v_row;
  end if;
  begin
    perform public.set_hrm_designated_manager(current_setting('test.g3b.emp_id')::uuid,
      current_setting('test.g3b.emp_user')::uuid, 'Tự làm quản lý của chính mình');
    raise exception 'HRM_G3B_SELF_MANAGER';
  exception when sqlstate '22023' then null;
  end;
end;
$$;
reset role;

do $$
begin
  if not exists (select 1 from public.hrm_employee_bank_accounts b
                 where b.employee_id = current_setting('test.g3b.emp_id')::uuid and b.account_number = '0011223344') then
    raise exception 'HRM_G3B_BANK_NOT_WRITTEN';
  end if;
  if app_private.notify_hrm_hr_reminders() < 1 then raise exception 'HRM_G3B_REMINDER_NOTICE'; end if;
end;
$$;

select 'hrm_g3b_profile_lifecycle_smoke passed' as result;
rollback;
