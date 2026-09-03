begin;

create or replace function public.list_hrm_employee_directory()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
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
$$;

create or replace function public.lookup_hrm_employee_directory(
  p_employee_ids uuid[] default null,
  p_user_ids uuid[] default null
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor_id uuid := public.current_app_user_id();
begin
  if not app_private.has_governed_hrm_permission(v_actor_id, 'hrm.employee.view_directory') then
    raise exception using errcode = '42501', message = 'HRM_EMPLOYEE_DIRECTORY_REQUIRED';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', employee.id, 'user_id', employee.user_id,
      'employee_code', employee.employee_code, 'full_name', employee.full_name,
      'title', employee.title, 'phone', employee.phone, 'email', employee.email,
      'avatar_url', employee.avatar_url, 'status', employee.status
    ) order by employee.employee_code)
    from public.employees employee
    where (p_employee_ids is null or employee.id = any(p_employee_ids))
      and (p_user_ids is null or employee.user_id = any(p_user_ids))
  ), '[]'::jsonb);
end;
$$;

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
  if length(trim(coalesce(p_employee_code, ''))) = 0 or length(trim(coalesce(p_full_name, ''))) = 0 then
    raise exception using errcode = '22023', message = 'HRM_EMPLOYEE_CORE_REQUIRED';
  end if;
  insert into public.employees(
    id, employee_code, full_name, gender, phone, email, date_of_birth,
    start_date, official_date, status, user_id, area_id, office_id,
    employee_type_id, work_schedule_id, marital_status, avatar_url
  ) values (
    coalesce(p_employee_id, gen_random_uuid()), trim(p_employee_code), trim(p_full_name),
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

create or replace function public.archive_hrm_employee(p_employee_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_employee public.employees%rowtype;
begin
  if not app_private.has_hrm_template_permission(v_actor_id, 'hrm.employee.edit_profile') then
    raise exception using errcode = '42501', message = 'HRM_PROFILE_EDIT_REQUIRED';
  end if;
  perform app_private.assert_hrm_mutation_context(p_reason, 'employee-archive');
  update public.employees set status = 'Đã nghỉ việc', updated_at = now()
  where id = p_employee_id returning * into v_employee;
  if not found then raise exception using errcode = 'P0002', message = 'HRM_EMPLOYEE_NOT_FOUND'; end if;
  perform app_private.audit_hrm_profile_command(
    p_employee_id, 'HRM_EMPLOYEE_PROFILE', p_employee_id::text, 'UPDATE', p_reason, array['status']
  );
  return to_jsonb(v_employee);
end;
$$;

create or replace function public.list_hrm_labor_contracts()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.has_hrm_template_permission(public.current_app_user_id(), 'hrm.contract.view') then
    raise exception using errcode = '42501', message = 'HRM_CONTRACT_VIEW_REQUIRED';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', id, 'employee_id', employee_id, 'contract_number', contract_number,
    'type', type, 'status', status, 'effective_from', effective_from,
    'effective_to', effective_to, 'base_salary', base_salary,
    'allowance_position', allowance_position, 'allowance_other', allowance_other,
    'signed_by', signed_by, 'note', note, 'created_at', created_at, 'updated_at', updated_at
  ) order by created_at desc) from public.hrm_labor_contracts), '[]'::jsonb);
end;
$$;

create or replace function public.list_hrm_salary_history()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.has_hrm_template_permission(public.current_app_user_id(), 'hrm.compensation.view') then
    raise exception using errcode = '42501', message = 'HRM_COMPENSATION_VIEW_REQUIRED';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', id, 'employee_id', employee_id, 'contract_id', contract_id,
    'effective_from', effective_from, 'effective_to', effective_to,
    'previous_salary', previous_salary, 'new_salary', new_salary,
    'previous_allowance', previous_allowance, 'new_allowance', new_allowance,
    'reason', reason, 'changed_by_legacy', changed_by_legacy,
    'status', status, 'created_at', created_at, 'updated_at', updated_at
  ) order by effective_from desc) from public.hrm_salary_history), '[]'::jsonb);
end;
$$;

create or replace function public.list_hrm_payrolls()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.has_hrm_template_permission(public.current_app_user_id(), 'hrm.payroll.view') then
    raise exception using errcode = '42501', message = 'HRM_PAYROLL_VIEW_REQUIRED';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', payroll.id, 'employeeId', payroll."employeeId", 'month', payroll.month, 'year', payroll.year,
    'workingDays', payroll."workingDays", 'standardDays', payroll."standardDays",
    'overtimeHours', payroll."overtimeHours", 'baseSalary', payroll."baseSalary",
    'dailyRate', payroll."dailyRate", 'overtimeRate', payroll."overtimeRate",
    'allowancePosition', payroll."allowancePosition", 'allowanceMeal', payroll."allowanceMeal",
    'allowanceTransport', payroll."allowanceTransport", 'allowancePhone', payroll."allowancePhone",
    'allowanceOther', payroll."allowanceOther", 'deductionInsurance', payroll."deductionInsurance",
    'deductionTax', payroll."deductionTax", 'deductionAdvance', payroll."deductionAdvance",
    'deductionOther', payroll."deductionOther", 'grossSalary', payroll."grossSalary",
    'netSalary', payroll."netSalary", 'note', payroll.note, 'status', payroll.status,
    'paidDate', payroll."paidDate", 'createdAt', payroll."createdAt",
    'calculationMode', payroll."calculationMode", 'compensationPlanId', payroll."compensationPlanId",
    'compensationAssignmentId', payroll."compensationAssignmentId", 'salaryGradeId', payroll."salaryGradeId",
    'p3BandId', payroll."p3BandId", 'kpiBandId', payroll."kpiBandId",
    'p1Salary', payroll."p1Salary", 'p3StandardSalary', payroll."p3StandardSalary",
    'p3ActualSalary', payroll."p3ActualSalary", 'kpiMultiplier', payroll."kpiMultiplier",
    'recurringAllowanceTotal', payroll."recurringAllowanceTotal",
    'payrollComponentSnapshot', payroll."payrollComponentSnapshot",
    'calculationSnapshot', payroll."calculationSnapshot",
    'templateId', payroll."templateId", 'templateValues', payroll."templateValues"
  ) order by payroll.year desc, payroll.month desc) from public.hrm_payrolls payroll), '[]'::jsonb);
end;
$$;

create or replace function public.upsert_hrm_payroll(p_payroll jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor_id uuid := public.current_app_user_id(); v_id uuid; v_row public.hrm_payrolls%rowtype;
begin
  if not app_private.has_hrm_template_permission(v_actor_id, 'hrm.payroll.manage') then
    raise exception using errcode = '42501', message = 'HRM_PAYROLL_MANAGE_REQUIRED';
  end if;
  perform app_private.assert_hrm_mutation_context(p_reason, 'payroll-command');
  v_id := coalesce(nullif(p_payroll ->> 'id', '')::uuid, gen_random_uuid());
  insert into public.hrm_payrolls(
    id,"employeeId",month,year,"workingDays","standardDays","overtimeHours","baseSalary",
    "dailyRate","overtimeRate","allowancePosition","allowanceMeal","allowanceTransport",
    "allowancePhone","allowanceOther","deductionInsurance","deductionTax","deductionAdvance",
    "deductionOther","grossSalary","netSalary",note,status,"paidDate","createdAt",
    "templateId","templateValues"
  ) values (
    v_id,(p_payroll->>'employeeId')::uuid,(p_payroll->>'month')::integer,(p_payroll->>'year')::integer,
    coalesce((p_payroll->>'workingDays')::numeric,0),coalesce((p_payroll->>'standardDays')::numeric,0),
    coalesce((p_payroll->>'overtimeHours')::numeric,0),coalesce((p_payroll->>'baseSalary')::numeric,0),
    coalesce((p_payroll->>'dailyRate')::numeric,0),coalesce((p_payroll->>'overtimeRate')::numeric,0),
    coalesce((p_payroll->>'allowancePosition')::numeric,0),coalesce((p_payroll->>'allowanceMeal')::numeric,0),
    coalesce((p_payroll->>'allowanceTransport')::numeric,0),coalesce((p_payroll->>'allowancePhone')::numeric,0),
    coalesce((p_payroll->>'allowanceOther')::numeric,0),coalesce((p_payroll->>'deductionInsurance')::numeric,0),
    coalesce((p_payroll->>'deductionTax')::numeric,0),coalesce((p_payroll->>'deductionAdvance')::numeric,0),
    coalesce((p_payroll->>'deductionOther')::numeric,0),coalesce((p_payroll->>'grossSalary')::numeric,0),
    coalesce((p_payroll->>'netSalary')::numeric,0),nullif(p_payroll->>'note',''),
    coalesce(nullif(p_payroll->>'status',''),'draft'),nullif(p_payroll->>'paidDate',''),
    coalesce(nullif(p_payroll->>'createdAt','')::timestamptz,now()),
    nullif(p_payroll->>'templateId','')::uuid,coalesce(p_payroll->'templateValues','{}'::jsonb)
  ) on conflict (id) do update set
    "workingDays"=excluded."workingDays","standardDays"=excluded."standardDays",
    "overtimeHours"=excluded."overtimeHours","baseSalary"=excluded."baseSalary",
    "dailyRate"=excluded."dailyRate","overtimeRate"=excluded."overtimeRate",
    "allowancePosition"=excluded."allowancePosition","allowanceMeal"=excluded."allowanceMeal",
    "allowanceTransport"=excluded."allowanceTransport","allowancePhone"=excluded."allowancePhone",
    "allowanceOther"=excluded."allowanceOther","deductionInsurance"=excluded."deductionInsurance",
    "deductionTax"=excluded."deductionTax","deductionAdvance"=excluded."deductionAdvance",
    "deductionOther"=excluded."deductionOther","grossSalary"=excluded."grossSalary",
    "netSalary"=excluded."netSalary",note=excluded.note,status=excluded.status,
    "paidDate"=excluded."paidDate","templateId"=excluded."templateId","templateValues"=excluded."templateValues"
  returning * into v_row;
  perform app_private.audit_hrm_profile_command(
    v_row."employeeId", 'HRM_PAYROLL', v_id::text, 'UPSERT', p_reason, array['payroll_fields','status']
  );
  return to_jsonb(v_row);
end;
$$;

create or replace function public.delete_hrm_payroll(p_payroll_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor_id uuid := public.current_app_user_id(); v_employee_id uuid;
begin
  if not app_private.has_hrm_template_permission(v_actor_id, 'hrm.payroll.manage') then
    raise exception using errcode = '42501', message = 'HRM_PAYROLL_MANAGE_REQUIRED';
  end if;
  perform app_private.assert_hrm_mutation_context(p_reason, 'payroll-command');
  delete from public.hrm_payrolls where id = p_payroll_id and status = 'draft' returning "employeeId" into v_employee_id;
  if not found then raise exception using errcode = '55000', message = 'HRM_PAYROLL_DRAFT_REQUIRED'; end if;
  perform app_private.audit_hrm_profile_command(
    v_employee_id, 'HRM_PAYROLL', p_payroll_id::text, 'DELETE', p_reason, array['payroll_record']
  );
end;
$$;

create or replace function public.list_hrm_documents(
  p_doc_type text default null, p_category text default null,
  p_employee_id text default null, p_search text default null, p_limit integer default 200
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.has_hrm_template_permission(public.current_app_user_id(), 'hrm.document.view') then
    raise exception using errcode = '42501', message = 'HRM_DOCUMENT_VIEW_REQUIRED';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', document.id, 'doc_type', document.doc_type, 'doc_category', document.doc_category,
    'employee_id', document.employee_id, 'title', document.title, 'doc_number', document.doc_number,
    'description', document.description, 'sender', document.sender, 'receiver', document.receiver,
    'signed_by', document.signed_by, 'assigned_to', document.assigned_to,
    'doc_date', document.doc_date, 'deadline', document.deadline, 'status', document.status,
    'file_name', document.file_name, 'file_type', document.file_type, 'file_size', document.file_size,
    'storage_path', document.storage_path, 'tags', document.tags, 'uploaded_by', document.uploaded_by,
    'created_at', document.created_at, 'updated_at', document.updated_at
  ) order by document.created_at desc)
  from (select * from public.hrm_documents source
    where (p_doc_type is null or source.doc_type = p_doc_type)
      and (p_category is null or p_category = 'all' or source.doc_category = p_category)
      and (p_employee_id is null or source.employee_id = p_employee_id)
      and (nullif(trim(p_search), '') is null
        or source.title ilike '%'||trim(p_search)||'%'
        or coalesce(source.doc_number,'') ilike '%'||trim(p_search)||'%')
    order by source.created_at desc limit least(greatest(p_limit,1),500)
  ) document), '[]'::jsonb);
end;
$$;

create or replace function public.upsert_hrm_document_metadata(p_document jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_id uuid;
  v_row public.hrm_documents%rowtype;
  v_subject_employee_id uuid;
begin
  if not app_private.has_hrm_template_permission(v_actor_id, 'hrm.document.manage') then
    raise exception using errcode = '42501', message = 'HRM_DOCUMENT_MANAGE_REQUIRED';
  end if;
  perform app_private.assert_hrm_mutation_context(p_reason, 'document-command');
  v_id := coalesce(nullif(p_document->>'id','')::uuid, gen_random_uuid());
  insert into public.hrm_documents(
    id,doc_type,doc_category,employee_id,title,doc_number,description,sender,receiver,
    signed_by,assigned_to,doc_date,deadline,status,file_name,file_type,file_size,
    storage_path,tags,uploaded_by
  ) values (
    v_id,p_document->>'docType',p_document->>'docCategory',nullif(p_document->>'employeeId',''),
    p_document->>'title',nullif(p_document->>'docNumber',''),nullif(p_document->>'description',''),
    nullif(p_document->>'sender',''),nullif(p_document->>'receiver',''),nullif(p_document->>'signedBy',''),
    nullif(p_document->>'assignedTo',''),nullif(p_document->>'docDate','')::date,
    nullif(p_document->>'deadline','')::date,coalesce(nullif(p_document->>'status',''),'active'),
    p_document->>'fileName',p_document->>'fileType',coalesce((p_document->>'fileSize')::bigint,0),
    p_document->>'storagePath',coalesce(array(select jsonb_array_elements_text(coalesce(p_document->'tags','[]'::jsonb))),array[]::text[]),
    nullif(p_document->>'uploadedBy','')
  ) on conflict (id) do update set
    status=excluded.status,title=excluded.title,doc_number=excluded.doc_number,
    description=excluded.description,deadline=excluded.deadline,tags=excluded.tags,updated_at=now()
  returning * into v_row;
  select employee.id into v_subject_employee_id
  from public.employees employee
  where employee.id::text = v_row.employee_id;
  perform app_private.audit_hrm_profile_command(
    coalesce(v_subject_employee_id, v_actor_id), 'HRM_DOCUMENT', v_id::text,
    'UPSERT', p_reason, array['document_metadata','storage_path']
  );
  return to_jsonb(v_row);
end;
$$;

create or replace function public.delete_hrm_document_metadata(p_document_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_employee_id text;
  v_subject_employee_id uuid;
begin
  if not app_private.has_hrm_template_permission(v_actor_id, 'hrm.document.manage') then
    raise exception using errcode = '42501', message = 'HRM_DOCUMENT_MANAGE_REQUIRED';
  end if;
  perform app_private.assert_hrm_mutation_context(p_reason, 'document-command');
  delete from public.hrm_documents where id=p_document_id returning employee_id into v_employee_id;
  if not found then raise exception using errcode = 'P0002', message = 'HRM_DOCUMENT_NOT_FOUND'; end if;
  select employee.id into v_subject_employee_id
  from public.employees employee
  where employee.id::text = v_employee_id;
  perform app_private.audit_hrm_profile_command(
    coalesce(v_subject_employee_id, v_actor_id), 'HRM_DOCUMENT', p_document_id::text,
    'DELETE', p_reason, array['document_metadata']
  );
end;
$$;

create or replace function public.list_hrm_compensation_assignments()
returns jsonb language plpgsql stable security definer set search_path = '' as $$ begin
  if not app_private.has_hrm_template_permission(public.current_app_user_id(),'hrm.compensation.view') then raise exception using errcode='42501',message='HRM_COMPENSATION_VIEW_REQUIRED'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',id,'employee_id',employee_id,'employee_code_snapshot',employee_code_snapshot,
    'employee_name_snapshot',employee_name_snapshot,'plan_id',plan_id,'position_id',position_id,
    'org_unit_id',org_unit_id,'salary_grade_id',salary_grade_id,'p3_band_id',p3_band_id,
    'effective_from',effective_from,'effective_to',effective_to,'status',status,'source',source,
    'review_status',review_status,'review_note',review_note,'metadata',metadata,
    'created_at',created_at,'updated_at',updated_at
  ) order by effective_from desc) from public.hrm_employee_compensation_assignments),'[]'::jsonb);
end $$;
create or replace function public.list_hrm_manual_allowances()
returns jsonb language plpgsql stable security definer set search_path = '' as $$ begin
  if not app_private.has_hrm_template_permission(public.current_app_user_id(),'hrm.compensation.view') then raise exception using errcode='42501',message='HRM_COMPENSATION_VIEW_REQUIRED'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',id,'employee_id',employee_id,'component_id',component_id,'amount',amount,'status',status,
    'effective_from',effective_from,'effective_to',effective_to,'note',note,'source',source,
    'created_at',created_at,'updated_at',updated_at
  ) order by effective_from desc) from public.hrm_employee_manual_allowances),'[]'::jsonb);
end $$;
create or replace function public.list_hrm_payroll_components()
returns jsonb language plpgsql stable security definer set search_path = '' as $$ begin
  if not app_private.has_hrm_template_permission(public.current_app_user_id(),'hrm.compensation.view') then raise exception using errcode='42501',message='HRM_COMPENSATION_VIEW_REQUIRED'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',id,'plan_id',plan_id,'code',code,'name',name,'component_type',component_type,
    'formula_key',formula_key,'sort_order',sort_order,'is_active',is_active,'is_recurring',is_recurring,
    'source',source,'metadata',metadata,'created_at',created_at,'updated_at',updated_at
  ) order by sort_order,code) from public.hrm_payroll_components),'[]'::jsonb);
end $$;

update storage.buckets set public=false where id = 'hr-documents';
drop policy if exists "Allow public access to hr-documents" on storage.objects;
drop policy if exists hr_documents_template_select on storage.objects;
drop policy if exists hr_documents_template_insert on storage.objects;
drop policy if exists hr_documents_template_update on storage.objects;
drop policy if exists hr_documents_template_delete on storage.objects;
create policy hr_documents_template_select on storage.objects for select to authenticated
using (bucket_id='hr-documents' and app_private.has_hrm_template_permission(public.current_app_user_id(),'hrm.document.view'));
create policy hr_documents_template_insert on storage.objects for insert to authenticated
with check (bucket_id='hr-documents' and app_private.has_hrm_template_permission(public.current_app_user_id(),'hrm.document.manage'));
create policy hr_documents_template_update on storage.objects for update to authenticated
using (bucket_id='hr-documents' and app_private.has_hrm_template_permission(public.current_app_user_id(),'hrm.document.manage'))
with check (bucket_id='hr-documents' and app_private.has_hrm_template_permission(public.current_app_user_id(),'hrm.document.manage'));
create policy hr_documents_template_delete on storage.objects for delete to authenticated
using (bucket_id='hr-documents' and app_private.has_hrm_template_permission(public.current_app_user_id(),'hrm.document.manage'));

revoke all on public.employees from authenticated,anon;
grant all on public.employees to service_role;
revoke all on public.hrm_documents from authenticated,anon;
revoke all on public.hrm_employee_compensation_assignments from authenticated,anon;
revoke all on public.hrm_employee_manual_allowances from authenticated,anon;
revoke all on public.hrm_labor_contracts from authenticated,anon;
revoke all on public.hrm_payroll_components from authenticated,anon;
revoke all on public.hrm_payrolls from authenticated,anon;
revoke all on public.hrm_salary_history from authenticated,anon;

do $$ declare v_function text; begin
  foreach v_function in array array[
    'list_hrm_employee_directory()','lookup_hrm_employee_directory(uuid[],uuid[])',
    'create_hrm_employee_core(uuid,text,text,text,text,text,date,date,date,text,uuid,uuid,uuid,uuid,uuid,text,text,text)',
    'archive_hrm_employee(uuid,text)','list_hrm_labor_contracts()','list_hrm_salary_history()',
    'list_hrm_payrolls()','upsert_hrm_payroll(jsonb,text)','delete_hrm_payroll(uuid,text)',
    'list_hrm_documents(text,text,text,text,integer)','upsert_hrm_document_metadata(jsonb,text)',
    'delete_hrm_document_metadata(uuid,text)','list_hrm_compensation_assignments()',
    'list_hrm_manual_allowances()','list_hrm_payroll_components()'
  ] loop
    execute format('revoke all on function public.%s from public,anon',v_function);
    execute format('grant execute on function public.%s to authenticated,service_role',v_function);
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
