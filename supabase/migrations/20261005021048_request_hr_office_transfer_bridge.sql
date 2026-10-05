-- Request approval -> pending HR assignment -> HR approval -> Office draft.
-- Only explicitly configured template versions use this bridge.
create table app_private.hr_transfer_routes (
 request_template_version_id uuid primary key references public.request_template_versions(id),
 office_template_id uuid not null references public.office_document_templates(id),
 office_template_snapshot jsonb not null,
 hr_approver_id uuid not null references public.users(id),
 office_author_id uuid not null references public.users(id),
 employee_options jsonb not null check(jsonb_typeof(employee_options)='object'),
 site_options jsonb not null check(jsonb_typeof(site_options)='object'),
 created_at timestamptz not null default now()
);
alter table app_private.hr_transfer_routes enable row level security;
revoke all on app_private.hr_transfer_routes from public,anon,authenticated;
alter table public.hrm_site_assignments
 add column source_request_id uuid unique references public.request_instances(id),
 add column source_request_revision integer,
 add column office_document_id uuid unique references public.office_documents(id),
 add column transfer_snapshot jsonb;
alter table public.office_documents add column source_assignment_id uuid unique references public.hrm_site_assignments(id);
alter table public.hrm_site_assignments drop constraint hrm_site_assignments_status_check;
alter table public.hrm_site_assignments add constraint hrm_site_assignments_status_check check(status in ('pending','awaiting_office','approved','rejected','cancelled'));

-- Replaces only text nodes, never structural data or mark URLs.
create function app_private.hr_transfer_fill(n jsonb, vars jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare k text; value text; children jsonb;
begin
 if n->>'type'='text' then
  value:=n->>'text';
  for k in select jsonb_object_keys(vars) loop value:=replace(value,'{{'||k||'}}',coalesce(vars->>k,'')); end loop;
  return jsonb_set(n,'{text}',to_jsonb(value));
 end if;
 if jsonb_typeof(n->'content')='array' then
  select coalesce(jsonb_agg(app_private.hr_transfer_fill(e,vars) order by ord),'[]') into children
  from jsonb_array_elements(n->'content') with ordinality a(e,ord);
  return jsonb_set(n,'{content}',children);
 end if;
 return n;
end $$;
revoke all on function app_private.hr_transfer_fill(jsonb,jsonb) from public,anon,authenticated;

create function app_private.hr_transfer_request_approved() returns trigger
language plpgsql security definer set search_path='' as $$
declare cfg app_private.hr_transfer_routes; e public.employees; a public.hrm_site_assignments;
 employee_id uuid; origin_id uuid; destination_id uuid; k text; starts date; ends date; check_result jsonb; actor uuid:=public.current_app_user_id();
begin
 select * into cfg from app_private.hr_transfer_routes where request_template_version_id=new.request_template_version_id;
 if not found then return new; end if;
 if tg_op='UPDATE' and exists(select 1 from public.hrm_site_assignments where source_request_id=new.id) then
  if new.form_data is distinct from old.form_data or new.status is distinct from old.status or new.deleted_at is distinct from old.deleted_at then
   raise exception 'Yêu cầu đã tạo điều động. Hãy xử lý/hủy phiếu điều động liên kết; không thay đổi nguồn đã duyệt.';
  end if;
  return new;
 end if;
 if new.status<>'APPROVED' then return new; end if;
 if actor is distinct from cfg.hr_approver_id or not app_private.hrm_site_assignment_is_approver(actor) then
  raise exception 'Người duyệt luồng điều động không hợp lệ.' using errcode='42501';
 end if;
 employee_id:=nullif(cfg.employee_options->>(new.form_data->>'employee'),'')::uuid;
 origin_id:=nullif(cfg.site_options->>(new.form_data->>'origin'),'')::uuid;
 destination_id:=nullif(cfg.site_options->>(new.form_data->>'destination'),'')::uuid;
 k:=case new.form_data->>'kind' when 'Chính' then 'primary' when 'Tạm thời' then 'temporary' when 'Kiêm nhiệm' then 'concurrent' end;
 starts:=nullif(new.form_data->>'start_date','')::date; ends:=nullif(new.form_data->>'end_date','')::date;
 if employee_id is null or origin_id is null or destination_id is null or origin_id=destination_id or k is null or starts is null
 or char_length(btrim(coalesce(new.form_data->>'reason','')))<5 or char_length(btrim(coalesce(new.form_data->>'duties','')))<5
 or char_length(btrim(coalesce(new.form_data->>'report_to','')))<2 then raise exception 'Yêu cầu điều động thiếu hoặc sai dữ liệu.'; end if;
 select * into e from public.employees where id=employee_id for update;
 if e.construction_site_id is distinct from origin_id then raise exception 'Công trường đi không khớp hồ sơ hiện tại. Cần cập nhật yêu cầu trước khi duyệt.'; end if;
 insert into public.hrm_site_assignments(code,employee_id,site_id,kind,start_date,end_date,reason,source,from_site_id,created_by,source_request_id,source_request_revision)
 values(app_private.hrm_site_assignment_next_code(),employee_id,destination_id,k,starts,ends,new.form_data->>'reason','request',origin_id,new.created_by,new.id,new.content_revision)
 returning * into a;
 check_result:=app_private.hrm_site_assignment_check(actor,jsonb_build_object('employeeIds',jsonb_build_array(employee_id),'siteId',destination_id,'kind',k,'startDate',starts,'endDate',ends),a.id);
 if jsonb_array_length(check_result->'problems')>0 then raise exception '%',check_result->'problems'->>0; end if;
 insert into public.hrm_site_assignment_events(assignment_id,action,actor,note,data)
 values(a.id,'create',actor,'Tự tạo từ yêu cầu đã duyệt',jsonb_build_object('requestId',new.id,'revision',new.content_revision,'requestedBy',new.created_by));
 perform app_private.notify_hrm_site_assignment(array[cfg.hr_approver_id],'Điều động từ Yêu cầu chờ duyệt',format('%s · %s → %s · từ %s',a.code,e.full_name,app_private.hrm_site_name(destination_id),app_private.hrm_date_vi(starts)),a.id);
 return new;
end $$;
revoke all on function app_private.hr_transfer_request_approved() from public,anon,authenticated;
create trigger hr_transfer_request_approved after insert or update on public.request_instances for each row execute function app_private.hr_transfer_request_approved();

create function app_private.hr_transfer_create_office(p_assignment_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.hrm_site_assignments; r public.request_instances; e public.employees;
 cfg app_private.hr_transfer_routes; identity_doc public.hrm_employee_identity_documents;
 t jsonb; vars jsonb; content jsonb; d public.office_documents; typ public.office_document_types; missing text[]:='{}'; v text; recipients jsonb; actor uuid:=public.current_app_user_id();
begin
 select * into strict a from public.hrm_site_assignments where id=p_assignment_id for update;
 if a.office_document_id is not null then return a.office_document_id; end if;
 if a.status<>'awaiting_office' or a.source_request_id is null then raise exception 'Điều động chưa được HR duyệt.'; end if;
 select * into strict r from public.request_instances where id=a.source_request_id;
 if r.status<>'APPROVED' or r.content_revision<>a.source_request_revision then raise exception 'Nguồn yêu cầu đã thay đổi.'; end if;
 select * into strict cfg from app_private.hr_transfer_routes where request_template_version_id=r.request_template_version_id;
 select * into strict e from public.employees where id=a.employee_id;
 select * into identity_doc from public.hrm_employee_identity_documents where employee_id=e.id and status='ACTIVE' and document_type_code='CCCD' and (expiry_date is null or expiry_date>=app_private.hrm_vn_today())
 order by is_primary desc,updated_at desc,id limit 1;
 t:=cfg.office_template_snapshot;
 select * into strict typ from public.office_document_types where id=(t->>'document_type_id')::uuid and is_active;
 if nullif(identity_doc.document_number,'') is null then missing:=array_append(missing,'CCCD'); end if;
 if identity_doc.issued_date is null then missing:=array_append(missing,'Ngày cấp CCCD'); end if;
 if nullif(identity_doc.issued_place,'') is null then missing:=array_append(missing,'Nơi cấp CCCD'); end if;
 if e.date_of_birth is null then missing:=array_append(missing,'Ngày sinh'); end if;
 if nullif(e.phone,'') is null then missing:=array_append(missing,'Điện thoại'); end if;
 recipients:=jsonb_build_array(jsonb_build_object('type','site','id',a.from_site_id),jsonb_build_object('type','site','id',a.site_id));
 if e.user_id is not null then recipients:=recipients||jsonb_build_array(jsonb_build_object('type','user','id',e.user_id)); end if;
 vars:=jsonb_build_object('employee_name',e.full_name,'employee_code',e.employee_code,
  'employee_dob',coalesce(to_char(e.date_of_birth,'DD/MM/YYYY'),'[Chưa cập nhật ngày sinh]'),
  'identity_no',coalesce(nullif(identity_doc.document_number,''),'[Chưa cập nhật CCCD]'),
  'identity_issued_on',coalesce(to_char(identity_doc.issued_date,'DD/MM/YYYY'),'[Chưa cập nhật ngày cấp]'),
  'identity_issued_at',coalesce(nullif(identity_doc.issued_place,''),'[Chưa cập nhật nơi cấp]'),
  'employee_phone',coalesce(nullif(e.phone,''),'[Chưa cập nhật điện thoại]'),'job_title',coalesce(nullif(e.title,''),'Nhân sự'),
  'origin_name',app_private.hrm_site_name(a.from_site_id),'destination_name',app_private.hrm_site_name(a.site_id),
  'transfer_period','Từ ngày '||to_char(a.start_date,'DD/MM/YYYY')||case when a.end_date is null then ' cho đến khi có thông báo mới.' else ' đến ngày '||to_char(a.end_date,'DD/MM/YYYY')||'.' end,
  'recipient_lines','- Ban điều hành '||app_private.hrm_site_name(a.from_site_id)||E';\n- Ban điều hành '||app_private.hrm_site_name(a.site_id)||E';\n- Phòng Hành chính Nhân sự.',
  'task_text',r.form_data->>'duties','report_to',r.form_data->>'report_to',
  'document_date',to_char(app_private.hrm_vn_today(),'DD/MM/YYYY'),
  'source_request_code',r.code,'assignment_code',a.code);
 content:=app_private.hr_transfer_fill(t->'content',vars);
 d.id:=gen_random_uuid(); d.document_group:='ANNOUNCEMENT';d.document_type_id:=typ.id;
 d.title:='Thông báo điều động nhân sự – '||e.full_name||' – '||app_private.hrm_site_name(a.site_id);
 d.summary:='Tự soạn từ '||r.code||' → '||a.code||case when cardinality(missing)>0 then '. Cần bổ sung hồ sơ: '||array_to_string(missing,', ')||'.' else '.' end;
 d.content:=content;d.content_text:=app_private.office_validate_content(content);d.status:='DRAFT';d.document_date:=app_private.hrm_vn_today();d.effective_on:=a.start_date;
 d.created_by:=cfg.office_author_id;d.updated_by:=actor;d.creator_name:=(select name from public.users where id=d.created_by);
 d.construction_site_id:=a.site_id;d.archive_folder_id:=typ.archive_folder_id;d.workflow_id:=typ.workflow_id;
 d.confidentiality:='RESTRICTED';d.recipient_specs:=recipients;d.watcher_ids:='{}';
 if not app_private.office_has('create',d,cfg.office_author_id) or not app_private.office_has('view',d,cfg.office_author_id) then raise exception 'Người soạn Office được cấu hình chưa đủ quyền.' using errcode='42501'; end if;
 perform app_private.office_validate_draft(d);
 insert into public.office_documents(id,document_group,document_type_id,title,summary,content,content_text,status,document_date,effective_on,created_by,updated_by,creator_name,construction_site_id,archive_folder_id,workflow_id,confidentiality,recipient_specs,source_document_number,source_organization,source_assignment_id)
 values(d.id,d.document_group,d.document_type_id,d.title,d.summary,d.content,d.content_text,'DRAFT',d.document_date,d.effective_on,d.created_by,d.updated_by,d.creator_name,d.construction_site_id,d.archive_folder_id,d.workflow_id,d.confidentiality,d.recipient_specs,r.code,'Nhân sự · '||a.code,a.id);
 update public.hrm_site_assignments set office_document_id=d.id,transfer_snapshot=jsonb_build_object('variables',vars,'missing',missing,'content',content,'template',t,'requestRevision',r.content_revision),updated_at=now() where id=a.id;
 insert into public.office_document_versions(document_id,version,snapshot,actor_id) select id,version,to_jsonb(x)-'search_vector',actor from public.office_documents x where id=d.id;
 insert into public.audit_trail(table_name,record_id,record_label,action,user_id,user_name,module,description,context)
 values('office_documents',d.id::text,d.title,'INSERT',actor::text,(select name from public.users where id=actor),'OFFICE','Tự soạn thông báo từ điều động đã duyệt',jsonb_build_object('requestId',r.id,'assignmentId',a.id,'automation','hr-transfer','missingFields',missing));
 return d.id;
end $$;
revoke all on function app_private.hr_transfer_create_office(uuid) from public,anon,authenticated;

-- Requests expose only links after the existing detail authorization succeeds.
create function app_private.hr_transfer_request_links(p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if app_private.request_detail_payload(p_request_id,public.current_app_user_id()) is null then raise exception 'Không được xem yêu cầu này.' using errcode='42501'; end if;
 select jsonb_build_object('assignmentId',a.id,'assignmentCode',a.code,'assignmentStatus',a.status,
 'officeDocumentId',case when app_private.office_can_view(a.office_document_id) then a.office_document_id end)
 into result from public.hrm_site_assignments a where a.source_request_id=p_request_id;
 return result;
end $$;
revoke all on function app_private.hr_transfer_request_links(uuid) from public,anon;
grant execute on function app_private.hr_transfer_request_links(uuid) to authenticated;
create or replace function public.get_request_detail(p_request_id uuid) returns jsonb language sql set search_path='' as $$
 select app_private.request_detail_payload(p_request_id,public.current_app_user_id())||jsonb_build_object('transfer',app_private.hr_transfer_request_links(p_request_id));
$$;

CREATE OR REPLACE FUNCTION app_private.hrm_site_assignment_check(p_user_id uuid, p_payload jsonb, p_ignore_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_today date := app_private.hrm_vn_today();
  v_site public.hrm_construction_sites%rowtype;
  v_kind text := coalesce(p_payload ->> 'kind', '');
  v_start date := nullif(p_payload ->> 'startDate', '')::date;
  v_end date := nullif(p_payload ->> 'endDate', '')::date;
  v_ids uuid[];
  v_id uuid;
  v_employee public.employees%rowtype;
  v_current uuid;
  v_other public.hrm_site_assignments%rowtype;
  v_leave text;
  v_problems jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_effects jsonb := '[]'::jsonb;
  v_project text;
  v_project_code text;
  v_name text;
begin
  select coalesce(array_agg(distinct value::uuid), '{}') into v_ids
  from jsonb_array_elements_text(coalesce(p_payload -> 'employeeIds', '[]'::jsonb)) value;
  select * into v_site from public.hrm_construction_sites where id = nullif(p_payload ->> 'siteId', '')::uuid;

  if cardinality(v_ids) = 0 then v_problems := v_problems || jsonb_build_array('Chọn người được điều động.'); end if;
  if cardinality(v_ids) > 50 then v_problems := v_problems || jsonb_build_array('Mỗi lần tối đa 50 người.'); end if;
  if v_site.id is null then v_problems := v_problems || jsonb_build_array('Chọn công trường đến.'); end if;
  if v_kind not in ('primary', 'concurrent', 'temporary') then v_problems := v_problems || jsonb_build_array('Chọn loại điều động.'); end if;
  if v_start is null then
    v_problems := v_problems || jsonb_build_array('Chọn ngày bắt đầu.');
  elsif v_start < v_today - 7 then
    v_problems := v_problems || jsonb_build_array(format('Chỉ được lùi ngày tối đa 7 ngày (từ %s).', app_private.hrm_date_vi(v_today - 7)));
  elsif v_start < v_today and v_site.id is not null then
    v_warnings := v_warnings || jsonb_build_array(format('Lùi ngày: lượt chấm từ %s sẽ được tính cho %s.', app_private.hrm_date_vi(v_start), v_site.name));
  end if;
  if v_kind = 'temporary' and v_end is null then v_problems := v_problems || jsonb_build_array('Tạm thời phải có ngày kết thúc.'); end if;
  if v_end is not null and v_start is not null and v_end < v_start then v_problems := v_problems || jsonb_build_array('Ngày kết thúc trước ngày bắt đầu.'); end if;
  if v_site.id is not null then
    if v_site.latitude is null or v_site.longitude is null then
      v_warnings := v_warnings || jsonb_build_array(format('%s chưa có tọa độ chấm công — nhập ở Cài đặt → Địa điểm chấm công trước ngày bắt đầu.', v_site.name));
    end if;
    if nullif(v_site."managerId", '') is null then
      v_warnings := v_warnings || jsonb_build_array(format('%s chưa có người duyệt — đơn nghỉ và chấm công bù sẽ về Phòng HCNS.', v_site.name));
    end if;
  end if;
  if jsonb_array_length(v_problems) > 0 then
    return jsonb_build_object('problems', v_problems, 'warnings', v_warnings, 'effects', v_effects);
  end if;

  foreach v_id in array v_ids loop
    select * into v_employee from public.employees where id = v_id;
    v_name := coalesce(v_employee.full_name, 'Nhân viên');
    if v_employee.id is null or v_employee.status <> 'Đang làm việc' then
      v_problems := v_problems || jsonb_build_array(format('%s không còn làm việc.', v_name)); continue;
    end if;
    if not app_private.hrm_site_assignment_can_create(p_user_id, v_id, v_site.id) then
      v_problems := v_problems || jsonb_build_array(format('Bạn chưa được lập điều động cho %s (HR, chỉ huy trưởng hoặc quản lý trực tiếp).', v_name)); continue;
    end if;
    select * into v_other from public.hrm_site_assignments
    where employee_id = v_id and status in ('pending','awaiting_office') and id is distinct from p_ignore_id limit 1;
    if v_other.id is not null then
      v_problems := v_problems || jsonb_build_array(format('%s đã có phiếu chờ duyệt %s.', v_name, v_other.code)); continue;
    end if;
    v_current := app_private.hrm_employee_primary_site_on(v_id, v_start);
    if v_kind in ('primary', 'temporary') then
      if v_current = v_site.id then
        v_problems := v_problems || jsonb_build_array(format('%s đang làm chính tại %s.', v_name, v_site.name)); continue;
      end if;
      select * into v_other from public.hrm_site_assignments
      where employee_id = v_id and status = 'approved' and kind in ('primary', 'temporary') and start_date >= v_start
        and id is distinct from p_ignore_id
        and not (source='baseline' and start_date=v_start and exists(
          select 1 from public.hrm_site_assignments linked where linked.id=p_ignore_id
          and linked.source_request_id is not null and linked.from_site_id=hrm_site_assignments.site_id))
      order by start_date limit 1;
      if v_other.id is not null then
        v_problems := v_problems || jsonb_build_array(format('%s đã có điều động %s từ %s; hủy phiếu đó trước.', v_name, v_other.code, app_private.hrm_date_vi(v_other.start_date))); continue;
      end if;
      select * into v_other from public.hrm_site_assignments
      where employee_id = v_id and status = 'approved' and kind = 'temporary' and start_date <= v_start and end_date >= v_start
        and id is distinct from p_ignore_id limit 1;
      if v_other.id is not null then
        v_problems := v_problems || jsonb_build_array(format('%s đang tăng cường tại %s đến %s.', v_name, app_private.hrm_site_name(v_other.site_id), app_private.hrm_date_vi(v_other.end_date))); continue;
      end if;
    else
      select * into v_other from public.hrm_site_assignments
      where employee_id = v_id and status = 'approved' and site_id = v_site.id
        and start_date <= coalesce(v_end, 'infinity'::date) and (end_date is null or end_date >= v_start)
        and id is distinct from p_ignore_id limit 1;
      if v_other.id is not null then
        v_problems := v_problems || jsonb_build_array(format('%s đã làm tại %s (%s).', v_name, v_site.name, v_other.code)); continue;
      end if;
    end if;

    select request.code into v_leave from public.hrm_leave_requests request
    join public.hrm_leave_types leave_type on leave_type.code = request.type and leave_type.unit = 'day'
    where request."employeeId" = v_id and request.status in ('pending', 'approved')
      and request."startDate"::date <= coalesce(v_end, v_start + 30) and request."endDate"::date >= v_start
    limit 1;
    if v_leave is not null then
      v_warnings := v_warnings || jsonb_build_array(format('%s có đơn nghỉ %s trong thời gian này.', v_name, coalesce(v_leave, '')));
    end if;
    if v_employee.user_id is null then
      v_warnings := v_warnings || jsonb_build_array(format('%s chưa có tài khoản Vioo — chưa chấm công trên điện thoại được.', v_name));
    elsif v_employee.position_id is null then
      v_warnings := v_warnings || jsonb_build_array(format('%s chưa có vị trí — không tự thêm vào Tổ chức dự án được, HR thêm sau.', v_name));
    end if;

    v_effects := v_effects || jsonb_build_array(case v_kind
      when 'primary' then format('%s: %s%s (chính) từ %s.', v_name,
        case when v_current is not null then format('%s kết thúc %s → ', app_private.hrm_site_name(v_current), app_private.hrm_date_vi(v_start - 1)) else '' end,
        v_site.name, app_private.hrm_date_vi(v_start))
      when 'temporary' then format('%s: tăng cường %s %s → %s, sau đó về %s.', v_name, v_site.name, app_private.hrm_date_vi(v_start), app_private.hrm_date_vi(v_end),
        coalesce(app_private.hrm_site_name(v_current), 'chưa có nơi chính'))
      else format('%s: kiêm nhiệm %s; nơi chính %s giữ nguyên.', v_name, v_site.name, coalesce(app_private.hrm_site_name(v_current), '(chưa có)'))
    end);
  end loop;

  v_project := app_private.hrm_site_project_id(v_site.id);
  if v_project is null then
    v_warnings := v_warnings || jsonb_build_array(format('%s chưa gắn dự án — không thêm vào Tổ chức dự án.', v_site.name));
  else
    select code into v_project_code from public.projects where id::text = v_project;
    v_effects := v_effects || jsonb_build_array(format('Thêm vào Tổ chức dự án %s với quyền Xem (nếu chưa có): %s người.', coalesce(v_project_code, ''), cardinality(v_ids)));
  end if;
  return jsonb_build_object('problems', v_problems, 'warnings', v_warnings, 'effects', v_effects);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.decide_hrm_site_assignment(p_id uuid, p_approve boolean, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := public.current_app_user_id();
  v_row public.hrm_site_assignments%rowtype;
  v_employee public.employees%rowtype;
  v_check jsonb;
  v_previous public.hrm_site_assignments%rowtype;
  v_staff uuid;
  v_recipients uuid[];
begin
  if not app_private.hrm_site_assignment_is_approver(v_user) then
    raise exception using errcode = '42501', message = 'Chỉ HR Manage và Admin được duyệt điều động.';
  end if;
  select * into v_row from public.hrm_site_assignments where id = p_id for update;
  if v_row.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy phiếu điều động.'; end if;
  if v_row.status <> 'pending' then raise exception using errcode = '23514', message = 'Phiếu này đã được xử lý.'; end if;
  select * into v_employee from public.employees where id = v_row.employee_id;
  if v_employee.user_id = v_user then raise exception using errcode = '42501', message = 'Không tự duyệt điều động của chính mình.'; end if;

  if v_row.source_request_id is not null and v_user is distinct from (
    select route.hr_approver_id from app_private.hr_transfer_routes route join public.request_instances r
    on r.request_template_version_id=route.request_template_version_id where r.id=v_row.source_request_id) then
    raise exception 'Phiếu này chỉ dành cho người duyệt được cấu hình.' using errcode='42501';
  end if;

  if not p_approve then
    if char_length(btrim(coalesce(p_note, ''))) < 5 then raise exception using errcode = '22023', message = 'Nhập lý do từ chối (ít nhất 5 ký tự).'; end if;
    update public.hrm_site_assignments set status = 'rejected', decided_by = v_user, decided_at = now(), decision_note = btrim(p_note), updated_at = now() where id = p_id;
    insert into public.hrm_site_assignment_events (assignment_id, action, actor, note) values (p_id, 'reject', v_user, btrim(p_note));
    perform app_private.notify_hrm_site_assignment(array[v_row.created_by, v_employee.user_id], 'Điều động bị từ chối',
      format('%s · %s → %s: %s', v_row.code, v_employee.full_name, app_private.hrm_site_name(v_row.site_id), btrim(p_note)), p_id);
    return;
  end if;

  if v_row.start_date < app_private.hrm_vn_today() - 7 then
    raise exception using errcode = '23514', message = 'Ngày bắt đầu đã quá 7 ngày; người lập cần hủy và lập phiếu mới.';
  end if;
  v_check := app_private.hrm_site_assignment_check(v_user, jsonb_build_object(
    'employeeIds', jsonb_build_array(v_row.employee_id), 'siteId', v_row.site_id, 'kind', v_row.kind,
    'startDate', v_row.start_date, 'endDate', v_row.end_date), p_id);
  if jsonb_array_length(v_check -> 'problems') > 0 then
    raise exception using errcode = '23514', message = v_check -> 'problems' ->> 0;
  end if;

  if v_row.source_request_id is not null then
    if v_user is distinct from (select route.hr_approver_id from app_private.hr_transfer_routes route
      join public.request_instances r on r.request_template_version_id=route.request_template_version_id where r.id=v_row.source_request_id) then
      raise exception 'Phiếu này chỉ dành cho người duyệt được cấu hình.' using errcode='42501';
    end if;
    if v_employee.construction_site_id is distinct from v_row.from_site_id then
      raise exception 'Nơi làm việc đã thay đổi so với yêu cầu. Cần lập lại phương án.';
    end if;
    update public.hrm_site_assignments set status='awaiting_office',decided_by=v_user,decided_at=now(),decision_note=p_note,updated_at=now() where id=p_id;
    insert into public.hrm_site_assignment_events(assignment_id,action,actor,note,data)
      values(p_id,'approve',v_user,p_note,jsonb_build_object('awaitingOffice',true,'requestId',v_row.source_request_id));
    perform app_private.hr_transfer_create_office(p_id);
    return;
  end if;

  -- A new primary site closes the current primary the day before.
  if v_row.kind = 'primary' then
    select * into v_previous from public.hrm_site_assignments
    where employee_id = v_row.employee_id and status = 'approved' and kind = 'primary' and id <> p_id
      and start_date < v_row.start_date and (end_date is null or end_date >= v_row.start_date)
    order by start_date desc limit 1;
    if v_previous.id is not null then
      update public.hrm_site_assignments set end_date = v_row.start_date - 1, updated_at = now() where id = v_previous.id;
    end if;
  end if;

  v_staff := app_private.hrm_site_assignment_join_project(p_id, v_user);
  update public.hrm_site_assignments set status = 'approved', decided_by = v_user, decided_at = now(),
    decision_note = nullif(btrim(coalesce(p_note, '')), ''), from_site_id = app_private.hrm_employee_primary_site_on(v_row.employee_id, v_row.start_date - 1),
    replaced_assignment_id = v_previous.id, replaced_end_date = v_previous.end_date, project_staff_id = v_staff, updated_at = now()
  where id = p_id;
  insert into public.hrm_site_assignment_events (assignment_id, action, actor, note, data)
  values (p_id, 'approve', v_user, nullif(btrim(coalesce(p_note, '')), ''), jsonb_build_object('closedAssignment', v_previous.id, 'projectStaffId', v_staff));
  perform app_private.hrm_sync_employee_site(v_row.employee_id);

  select array_agg(distinct recipient) into v_recipients from unnest(array[
    v_row.created_by, v_employee.user_id,
    nullif((select "managerId" from public.hrm_construction_sites where id = v_row.site_id), '')::uuid,
    nullif((select "managerId" from public.hrm_construction_sites where id = v_row.from_site_id), '')::uuid,
    nullif((select "managerId" from public.hrm_construction_sites where id = v_previous.site_id), '')::uuid
  ]) recipient where recipient is not null;
  perform app_private.notify_hrm_site_assignment(v_recipients, 'Điều động đã được duyệt',
    format('%s · %s → %s (%s) từ %s', v_row.code, v_employee.full_name, app_private.hrm_site_name(v_row.site_id),
      case v_row.kind when 'primary' then 'chính' when 'temporary' then 'tạm thời đến ' || app_private.hrm_date_vi(v_row.end_date) else 'kiêm nhiệm' end,
      app_private.hrm_date_vi(v_row.start_date)), p_id);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_hrm_site_assignment_board()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := public.current_app_user_id();
  v_hr boolean;
  v_approver boolean;
begin
  if v_user is null then raise exception using errcode = '28000', message = 'Phiên đăng nhập không hợp lệ.'; end if;
  v_hr := app_private.hrm_site_assignment_is_hr(v_user);
  v_approver := app_private.hrm_site_assignment_is_approver(v_user);
  return jsonb_build_object(
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', assignment.id, 'code', assignment.code, 'employeeId', assignment.employee_id, 'employeeName', employee.full_name,
        'employeeCode', employee.employee_code, 'jobTitle', employee.title, 'siteId', assignment.site_id, 'siteName', site.name,
        'projectCode', (select code from public.projects where id::text = app_private.hrm_site_project_id(assignment.site_id)),
        'kind', assignment.kind, 'startDate', assignment.start_date, 'endDate', assignment.end_date, 'status', assignment.status,
        'reason', assignment.reason, 'source', assignment.source, 'fromSiteName', app_private.hrm_site_name(assignment.from_site_id),
        'createdByName', creator.name, 'createdAt', assignment.created_at, 'decidedByName', decider.name, 'decidedAt', assignment.decided_at,
        'decisionNote', assignment.decision_note, 'endedEarlyReason', assignment.ended_early_reason,
        'sourceRequestId',assignment.source_request_id,'officeDocumentId',case when app_private.office_can_view(assignment.office_document_id) then assignment.office_document_id end,
        'canApprove',v_approver and (assignment.source_request_id is null or exists(select 1 from app_private.hr_transfer_routes route join public.request_instances r on r.request_template_version_id=route.request_template_version_id where r.id=assignment.source_request_id and route.hr_approver_id=v_user)),
        'mine', assignment.created_by = v_user
      ) order by assignment.created_at desc)
      from public.hrm_site_assignments assignment
      join public.employees employee on employee.id = assignment.employee_id
      join public.hrm_construction_sites site on site.id = assignment.site_id
      left join public.users creator on creator.id = assignment.created_by
      left join public.users decider on decider.id = assignment.decided_by
      where v_hr or employee.user_id = v_user or assignment.created_by = v_user
        or app_private.hrm_is_site_leader(v_user, assignment.site_id) or app_private.hrm_is_site_leader(v_user, assignment.from_site_id)
        or (employee.user_id is not null and app_private.resolve_active_direct_manager(employee.user_id) = v_user)
    ), '[]'::jsonb),
    'sites', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', site.id, 'name', site.name,
        'projectCode', project.code, 'projectName', project.name,
        'approverName', approver.name, 'hasCoordinates', site.latitude is not null and site.longitude is not null
      ) order by site.name)
      from public.hrm_construction_sites site
      left join public.projects project on project.id::text = app_private.hrm_site_project_id(site.id)
      left join public.users approver on approver.id::text = nullif(site."managerId", '')
    ), '[]'::jsonb),
    'review', case when v_approver then app_private.hrm_site_assignment_review_rows() else '[]'::jsonb end,
    'can', jsonb_build_object('create', app_private.hrm_site_assignment_can_create_any(v_user), 'approve', v_approver)
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.cancel_hrm_site_assignment(p_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := public.current_app_user_id();
  v_row public.hrm_site_assignments%rowtype;
begin
  if v_user is null then raise exception using errcode = '28000', message = 'Phiên đăng nhập không hợp lệ.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception using errcode = '22023', message = 'Nhập lý do hủy (ít nhất 5 ký tự).'; end if;
  select * into v_row from public.hrm_site_assignments where id = p_id for update;
  if v_row.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy phiếu điều động.'; end if;
  if v_row.status in ('pending','awaiting_office') then
    if v_row.created_by is distinct from v_user and not app_private.hrm_site_assignment_is_approver(v_user) then
      raise exception using errcode = '42501', message = 'Chỉ người lập phiếu, HR Manage hoặc Admin được hủy.';
    end if;
  elsif v_row.status = 'approved' then
    if not app_private.hrm_site_assignment_is_approver(v_user) then
      raise exception using errcode = '42501', message = 'Chỉ HR Manage và Admin được hủy điều động đã duyệt.';
    end if;
    if v_row.start_date <= app_private.hrm_vn_today() then
      raise exception using errcode = '23514', message = 'Điều động đã có hiệu lực — dùng Kết thúc sớm.';
    end if;
    if v_row.replaced_assignment_id is not null then
      update public.hrm_site_assignments set end_date = v_row.replaced_end_date, updated_at = now() where id = v_row.replaced_assignment_id;
    end if;
    if v_row.project_staff_id is not null then
      delete from public.project_staff where id = v_row.project_staff_id;
    end if;
  else
    raise exception using errcode = '23514', message = 'Phiếu này đã đóng.';
  end if;
  update public.hrm_site_assignments set status = 'cancelled', decided_by = coalesce(decided_by, v_user), decided_at = coalesce(decided_at, now()),
    decision_note = btrim(p_reason), project_staff_id = null, updated_at = now()
  where id = p_id;
  insert into public.hrm_site_assignment_events (assignment_id, action, actor, note) values (p_id, 'cancel', v_user, btrim(p_reason));
  perform app_private.hrm_sync_employee_site(v_row.employee_id);
  perform app_private.notify_hrm_site_assignment(array[v_row.created_by, (select user_id from public.employees where id = v_row.employee_id)],
    'Điều động đã hủy', format('%s: %s', v_row.code, btrim(p_reason)), p_id);
end;
$function$
;

create function app_private.hr_transfer_office_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare a public.hrm_site_assignments; prior public.hrm_site_assignments; e public.employees; result jsonb; staff uuid;
begin
 select * into a from public.hrm_site_assignments where office_document_id=new.id for update;
 if not found then return new; end if;
 if a.status in ('cancelled','rejected') and new.status not in ('DRAFT','CANCELLED','REJECTED') then
  raise exception 'Điều động nguồn đã hủy/từ chối; không được trình hoặc phát hành thông báo.';
 end if;
 -- A missing profile is visible in the draft; it must never become an official document.
 if new.status in ('PENDING_APPROVAL','APPROVED','WAITING_NUMBER','ISSUED') and old.status is distinct from new.status then
  if new.effective_on is distinct from a.start_date or new.construction_site_id is distinct from a.site_id then raise exception 'Ngày hiệu lực/công trường phải khớp phương án HR đã duyệt.'; end if;
  if jsonb_array_length(coalesce(a.transfer_snapshot->'missing','[]'))>0 then
   raise exception 'Hồ sơ nhân sự còn thiếu: %. Cập nhật hồ sơ rồi làm mới bản nháp điều động.',a.transfer_snapshot->'missing';
  end if;
  if new.content is distinct from (case when new.document_number is null then a.transfer_snapshot->'content' else app_private.office_fill_number(a.transfer_snapshot->'content',new.document_number) end) then
   raise exception 'Nội dung khác phương án HR đã duyệt. Cần lập lại phương án hoặc khôi phục bản nháp từ nguồn.';
  end if;
 end if;
 if new.status='ISSUED' and old.issued_at is null then
  if a.status<>'awaiting_office' then raise exception 'Điều động không còn chờ phát hành.'; end if;
  if a.start_date<app_private.hrm_vn_today() then raise exception 'Ngày bắt đầu đã qua. Cần rà soát và duyệt lại phương án, không tự lùi ngày.'; end if;
  select * into strict e from public.employees where id=a.employee_id for update;
  if e.construction_site_id is distinct from a.from_site_id then raise exception 'Nơi làm việc đã đổi; cần duyệt lại phương án.'; end if;
  result:=app_private.hrm_site_assignment_check(a.decided_by,jsonb_build_object('employeeIds',jsonb_build_array(a.employee_id),'siteId',a.site_id,'kind',a.kind,'startDate',a.start_date,'endDate',a.end_date),a.id);
  if jsonb_array_length(result->'problems')>0 then raise exception '%',result->'problems'->>0; end if;
  if a.kind='primary' then
   select * into prior from public.hrm_site_assignments where employee_id=a.employee_id and status='approved' and kind='primary'
    and start_date<=a.start_date and (end_date is null or end_date>=a.start_date) and id<>a.id order by start_date desc limit 1 for update;
   if prior.id is not null then
    if prior.start_date=a.start_date and prior.source='baseline' then
     update public.hrm_site_assignments set status='cancelled',decision_note='Thay thế hiện trạng cùng ngày bởi '||a.code,updated_at=now() where id=prior.id;
     insert into public.hrm_site_assignment_events(assignment_id,action,actor,note,data) values(prior.id,'cancel',public.current_app_user_id(),'Thay thế hiện trạng cùng ngày khi Office phát hành',jsonb_build_object('replacementId',a.id));
    else
     update public.hrm_site_assignments set end_date=a.start_date-1,updated_at=now() where id=prior.id;
    end if;
   end if;
  end if;
  if a.start_date<=app_private.hrm_vn_today() then staff:=app_private.hrm_site_assignment_join_project(a.id,a.decided_by); end if;
  update public.hrm_site_assignments set status='approved',replaced_assignment_id=prior.id,replaced_end_date=prior.end_date,project_staff_id=staff,updated_at=now() where id=a.id;
  perform app_private.hrm_sync_employee_site(a.employee_id);
 elsif new.status in ('CANCELLED','REJECTED','REVOKED') and old.status is distinct from new.status then
  if a.status='awaiting_office' then
   update public.hrm_site_assignments set status='cancelled',decision_note='Văn bản Office đã '||new.status,updated_at=now() where id=a.id;
   insert into public.hrm_site_assignment_events(assignment_id,action,actor,note) values(a.id,'cancel',public.current_app_user_id(),'Dừng điều động do văn bản Office đã đóng');
  elsif a.status='approved' and new.status='REVOKED' then
   raise exception 'Điều động đã được áp dụng. Cần xử lý kết thúc/điều chỉnh HR trước khi thu hồi văn bản.';
  end if;
 end if;
 return new;
end $$;
revoke all on function app_private.hr_transfer_office_guard() from public,anon,authenticated;
create trigger hr_transfer_office_guard before update on public.office_documents for each row execute function app_private.hr_transfer_office_guard();

-- Refresh missing profile fields while the Office document is still an unsubmitted draft.
-- Uses the already-approved assignment; does not change employee/destination/dates/duties.
create function app_private.hr_transfer_refresh_draft(p_document_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare a public.hrm_site_assignments; d public.office_documents; e public.employees; ident public.hrm_employee_identity_documents;
 vars jsonb; missing text[]:='{}'; v_content jsonb; actor uuid:=public.current_app_user_id();
begin
 select * into d from public.office_documents where id=p_document_id for update;
 select * into a from public.hrm_site_assignments where office_document_id=p_document_id for update;
 if a.id is null or a.status<>'awaiting_office' or d.status<>'DRAFT' or not app_private.hrm_site_assignment_is_hr(actor)
  or not app_private.office_has('edit',d) or not app_private.office_can_view(d.id) then raise exception 'Không được làm mới bản nháp này.' using errcode='42501'; end if;
 select * into strict e from public.employees where id=a.employee_id;
 select * into ident from public.hrm_employee_identity_documents where employee_id=e.id and status='ACTIVE' and document_type_code='CCCD' and (expiry_date is null or expiry_date>=app_private.hrm_vn_today()) order by is_primary desc,updated_at desc,id limit 1;
 if nullif(ident.document_number,'') is null then missing:=array_append(missing,'CCCD'); end if;
 if ident.issued_date is null then missing:=array_append(missing,'Ngày cấp CCCD'); end if;
 if nullif(ident.issued_place,'') is null then missing:=array_append(missing,'Nơi cấp CCCD'); end if;
 if e.date_of_birth is null then missing:=array_append(missing,'Ngày sinh'); end if;
 if nullif(e.phone,'') is null then missing:=array_append(missing,'Điện thoại'); end if;
 vars:=a.transfer_snapshot->'variables'||jsonb_build_object('employee_dob',coalesce(to_char(e.date_of_birth,'DD/MM/YYYY'),'[Chưa cập nhật ngày sinh]'),
 'identity_no',coalesce(nullif(ident.document_number,''),'[Chưa cập nhật CCCD]'),'identity_issued_on',coalesce(to_char(ident.issued_date,'DD/MM/YYYY'),'[Chưa cập nhật ngày cấp]'),
 'identity_issued_at',coalesce(nullif(ident.issued_place,''),'[Chưa cập nhật nơi cấp]'),'employee_phone',coalesce(nullif(e.phone,''),'[Chưa cập nhật điện thoại]'));
 v_content:=app_private.hr_transfer_fill(a.transfer_snapshot->'template'->'content',vars);
 update public.hrm_site_assignments set transfer_snapshot=transfer_snapshot||jsonb_build_object('variables',vars,'missing',missing,'content',v_content),updated_at=now() where id=a.id;
 update public.office_documents set content=v_content,content_text=app_private.office_validate_content(v_content),version=version+1,updated_by=actor,updated_at=now(),
 summary='Tự soạn từ điều động '||a.code||case when cardinality(missing)>0 then '. Cần bổ sung hồ sơ: '||array_to_string(missing,', ') else '' end where id=d.id;
 insert into public.office_document_versions(document_id,version,snapshot,actor_id) select id,version,to_jsonb(x)-'search_vector',actor from public.office_documents x where id=d.id;
 insert into public.audit_trail(table_name,record_id,action,user_id,user_name,module,description,context)
 values('office_documents',d.id::text,'UPDATE',actor::text,(select name from public.users where id=actor),'OFFICE','Làm mới thông tin hồ sơ trong bản nháp điều động',jsonb_build_object('assignmentId',a.id,'missingFields',missing));
end $$;
revoke all on function app_private.hr_transfer_refresh_draft(uuid) from public,anon;
grant execute on function app_private.hr_transfer_refresh_draft(uuid) to authenticated;
create function public.refresh_hr_transfer_office_draft(p_document_id uuid) returns void language sql set search_path='' as $$ select app_private.hr_transfer_refresh_draft(p_document_id); $$;
revoke all on function public.refresh_hr_transfer_office_draft(uuid) from public,anon;
grant execute on function public.refresh_hr_transfer_office_draft(uuid) to authenticated;

-- Existing daily job retains its scope; integrated future transfers join the project only on their start date.
create or replace function app_private.hrm_site_assignment_daily_sync() returns integer
language plpgsql security definer set search_path='' as $$
declare emp uuid; a public.hrm_site_assignments; total integer:=0; staff uuid;
begin
 for a in select h.* from public.hrm_site_assignments h join public.office_documents d on d.id=h.office_document_id
  where h.source_request_id is not null and h.status='approved' and d.status='ISSUED' and h.start_date<=app_private.hrm_vn_today()
   and (h.end_date is null or h.end_date>=app_private.hrm_vn_today()) and h.project_staff_id is null for update of h
 loop
  staff:=app_private.hrm_site_assignment_join_project(a.id,a.decided_by);
  if staff is not null then update public.hrm_site_assignments set project_staff_id=staff where id=a.id; end if;
 end loop;
 for emp in select employee_id from public.hrm_site_assignments where status='approved' union select employee_id from public.hrm_site_assignment_reviews
 loop perform app_private.hrm_sync_employee_site(emp);total:=total+1;end loop;
 return total;
end $$;
