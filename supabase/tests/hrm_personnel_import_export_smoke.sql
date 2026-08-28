begin;
set local statement_timeout = '30s';

do $$
declare
  v_admin public.users%rowtype;
  v_employee public.employees%rowtype;
  v_hr_user public.users%rowtype;
  v_summary jsonb;
  v_result jsonb;
  v_batch_id uuid;
  v_fingerprint text;
  v_blocked boolean;
  v_path text;
begin
  select account.* into v_admin
  from public.users account
  join public.principal_role_assignments assignment_row
    on assignment_row.principal_type = 'user' and assignment_row.principal_id = account.id
   and assignment_row.status = 'ACTIVE'
  join public.role_permission_templates template
    on template.id = assignment_row.role_template_id and template.code = 'SYSTEM_ADMIN'
  where account.role = 'ADMIN' and account.is_active and account.account_status = 'ACTIVE'
  order by account.created_at limit 1;
  select employee.* into v_employee
  from public.employees employee
  join public.users account on account.id = employee.user_id
  where employee.status = 'Đang làm việc' and account.id <> v_admin.id
  order by employee.employee_code limit 1;
  select account.* into v_hr_user from public.users account where account.id = v_employee.user_id;
  if v_admin.id is null or v_employee.id is null then
    raise exception 'HRM_IMPORT_SMOKE_FIXTURES_NOT_FOUND';
  end if;

  perform set_config('request.jwt.claim.sub', v_admin.auth_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'role','authenticated','sub',v_admin.auth_id,'email',v_admin.email
  )::text, true);
  v_blocked := false;
  begin
    perform public.create_hrm_import_batch(
      v_admin.id::text || '/smoke/missing.xlsx', repeat('a', 64),
      '{"formatVersion":1,"dataSheetCount":8}'::jsonb
    );
  exception when others then v_blocked := position('HRM_EMPLOYEE_IMPORT_REQUIRED' in sqlerrm) > 0; end;
  if not v_blocked then raise exception 'HRM_IMPORT_TECHNICAL_ADMIN_NOT_BLOCKED'; end if;

  v_summary := public.get_user_hr_authorization(v_hr_user.id);
  perform public.set_user_hr_business_role(
    v_hr_user.id, 'HR', null, 'Smoke: cấp HR để thử import hồ sơ',
    '[]'::jsonb, v_summary ->> 'fingerprint'
  );
  v_path := v_hr_user.id::text || '/smoke/profile.xlsx';
  insert into storage.objects(bucket_id, name, owner_id, metadata)
  values ('hrm-private-imports', v_path, v_hr_user.auth_id::text, '{"smoke":true}'::jsonb);

  perform set_config('request.jwt.claim.sub', v_hr_user.auth_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'role','authenticated','sub',v_hr_user.auth_id,'email',v_hr_user.email
  )::text, true);
  v_result := public.create_hrm_import_batch(
    v_path, repeat('a', 64), '{"formatVersion":1,"dataSheetCount":8}'::jsonb
  );
  v_batch_id := (v_result ->> 'batchId')::uuid;
  perform public.stage_hrm_import_rows(v_batch_id, jsonb_build_array(jsonb_build_object(
    'sheetCode','LEGAL_INSURANCE','rowNumber',2,'employeeCode',v_employee.employee_code,
    'recordCode','SMOKE-ID','recordType','IDENTITY_DOCUMENT',
    'payload',jsonb_build_object('documentTypeCode','CCCD','documentNumber','000000000000')
  )));
  v_result := public.preview_hrm_import_batch(v_batch_id);
  if v_result ->> 'status' <> 'VALIDATED' or (v_result ->> 'errorRows')::integer <> 0 then
    raise exception 'HRM_IMPORT_C3_PREVIEW_FAILED: %', v_result;
  end if;
  v_fingerprint := v_result ->> 'fingerprint';
  v_result := public.apply_hrm_import_batch(v_batch_id, 'Smoke: nhập giấy tờ định danh hợp lệ', v_fingerprint);
  if (v_result ->> 'appliedRows')::integer <> 1 or not exists (
    select 1 from public.hrm_employee_identity_documents document
    where document.employee_id = v_employee.id and document.record_code = 'SMOKE-ID'
  ) then raise exception 'HRM_IMPORT_C3_APPLY_FAILED: %', v_result;
  end if;
  v_result := public.apply_hrm_import_batch(v_batch_id, 'Smoke: nhập giấy tờ định danh hợp lệ', v_fingerprint);
  if coalesce((v_result ->> 'idempotentReplay')::boolean, false) is not true then
    raise exception 'HRM_IMPORT_RETRY_NOT_IDEMPOTENT: %', v_result;
  end if;

  v_result := public.create_hrm_import_batch(
    v_path, repeat('b', 64), '{"formatVersion":1,"dataSheetCount":8}'::jsonb
  );
  v_batch_id := (v_result ->> 'batchId')::uuid;
  perform public.stage_hrm_import_rows(v_batch_id, jsonb_build_array(jsonb_build_object(
    'sheetCode','COMPENSATION_TAX_BANK','rowNumber',2,'employeeCode',v_employee.employee_code,
    'recordCode','PAYROLL','recordType','BANK_ACCOUNT',
    'payload',jsonb_build_object('bankCode','VCB','accountNumber','0001','accountHolder',v_employee.full_name)
  )));
  v_result := public.preview_hrm_import_batch(v_batch_id);
  if not (v_result -> 'errors' @> '[{"errorCode":"HRM_IMPORT_C4_MANAGE_REQUIRED"}]'::jsonb) then
    raise exception 'HRM_IMPORT_HR_C4_NOT_BLOCKED: %', v_result;
  end if;
  v_blocked := false;
  begin perform public.apply_hrm_import_batch(v_batch_id, 'Smoke: HR không được apply C4', v_result ->> 'fingerprint');
  exception when others then v_blocked := position('HRM_IMPORT_VALIDATION_REQUIRED' in sqlerrm) > 0; end;
  if not v_blocked then raise exception 'HRM_IMPORT_INVALID_BATCH_APPLY_NOT_BLOCKED'; end if;

  perform set_config('request.jwt.claim.sub', v_admin.auth_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'role','authenticated','sub',v_admin.auth_id,'email',v_admin.email
  )::text, true);
  v_summary := public.get_user_hr_authorization(v_admin.id);
  perform public.set_user_hr_business_role(
    v_admin.id, 'HR_MANAGE', null, 'Smoke: Admin tự cấp HR Manage để export',
    '[{"ruleCode":"HRM_ADMIN_SELF_GRANT","accepted":true}]'::jsonb,
    v_summary ->> 'fingerprint'
  );
  v_result := public.export_hrm_employee_profiles(
    array[v_employee.id], 'Smoke: xuất đủ hồ sơ để kiểm tra quyền'
  );
  if (v_result ->> 'employeeCount')::integer <> 1
    or jsonb_array_length(v_result -> 'employees') <> 1
    or nullif(v_result ->> 'manifestHash', '') is null
  then raise exception 'HRM_EXPORT_PAYLOAD_INVALID: %', v_result;
  end if;
end;
$$;

rollback;
