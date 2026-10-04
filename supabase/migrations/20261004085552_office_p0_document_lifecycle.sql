-- Vioo Office P0. Additive; no real-user grants, no legacy authorization bypass.
insert into public.permission_applications(code,name,description,sort_order,is_active,member_assignable)
values('office','Vioo Office','Quản trị vòng đời văn bản chính thức',66,true,true)
on conflict(code) do update set name=excluded.name,is_active=true;
insert into public.permission_modules(application_code,code,name,routes,sort_order,is_active)
values ('office','office.module','Vioo Office',array['/office','/office/documents','/office/new','/office/documents/:id','/office/documents/:id/edit','/office/settings'],10,true),
('office','office.document','Văn bản','{}',20,true),('office','office.configuration','Cấu hình Office','{}',30,true)
on conflict(code) do update set routes=excluded.routes,is_active=true;
insert into public.permission_actions(module_code,action,permission_code,label,scope_modes,sort_order,is_active,risk_level,is_business_action,is_business_approval,grant_readiness,access_application_code)
select module,action,module||'.'||action,label,scopes,n,true,risk,action not in ('access','view'),action='approve','enforced','office'
from (values
 ('office.module','access','Truy cập Vioo Office',array['global'],1,'normal'),
 ('office.document','view','Xem văn bản',array['global','own','assigned','department','project','construction_site'],10,'normal'),
 ('office.document','view_restricted','Xem văn bản hạn chế theo phạm vi',array['global','department','project','construction_site'],15,'sensitive'),
 ('office.document','create','Soạn / tiếp nhận văn bản',array['global','own','department','project','construction_site'],20,'normal'),
 ('office.document','edit','Sửa bản nháp',array['global','own','department','project','construction_site'],30,'normal'),
 ('office.document','submit','Trình duyệt / đăng ký tiếp nhận',array['global','own','department','project','construction_site'],40,'important'),
 ('office.document','approve','Duyệt nội dung',array['global','assigned','department','project','construction_site'],50,'important'),
 ('office.document','issue_number','Cấp số văn bản',array['global','department','project','construction_site'],60,'sensitive'),
 ('office.document','publish','Phát hành / phân phối',array['global','department','project','construction_site'],70,'sensitive'),
 ('office.document','assign','Giao xử lý văn bản đến',array['global','own','department','project','construction_site'],80,'important'),
 ('office.document','process','Xử lý văn bản được giao',array['global','assigned','department','project','construction_site'],90,'normal'),
 ('office.document','revoke','Thu hồi văn bản',array['global','department','project','construction_site'],100,'sensitive'),
 ('office.document','archive','Lưu trữ văn bản',array['global','own','department','project','construction_site'],110,'important'),
 ('office.configuration','manage','Quản lý loại, tuyến duyệt, cấp số, kho',array['global'],120,'sensitive')
) x(module,action,label,scopes,n,risk)
on conflict(permission_code) do update set label=excluded.label,scope_modes=excluded.scope_modes,grant_readiness='enforced',is_active=true;

create table public.office_numbering_rules (
 id uuid primary key default gen_random_uuid(), name text not null check(length(btrim(name)) between 1 and 120),
 format text not null default '{sequence}/{year}/{code}-TT' check(format like '%{sequence}%' and format like '%{year}%' and format like '%{code}%'),
 is_active boolean not null default true, created_at timestamptz not null default now()
);
create table public.office_archive_folders (
 id uuid primary key default gen_random_uuid(), name text not null check(length(btrim(name)) between 1 and 120),
 parent_id uuid references public.office_archive_folders(id), is_active boolean not null default true,
 check(parent_id is distinct from id)
);
create index office_folder_parent_idx on public.office_archive_folders(parent_id);
create table public.office_approval_workflows (
 id uuid primary key default gen_random_uuid(), name text not null check(length(btrim(name)) between 1 and 120),
 steps jsonb not null default '[]' check(jsonb_typeof(steps)='array' and jsonb_array_length(steps) between 1 and 20),
 department_id uuid references public.org_units(id), project_id text references public.projects(id),
 is_active boolean not null default true, version int not null default 1
);
create index office_workflow_department_idx on public.office_approval_workflows(department_id);
create index office_workflow_project_idx on public.office_approval_workflows(project_id);
create table public.office_document_types (
 id uuid primary key default gen_random_uuid(), code text not null unique check(length(btrim(code)) between 1 and 20),
 name text not null check(length(btrim(name)) between 1 and 120),
 groups text[] not null check(cardinality(groups)>0 and groups <@ array['ANNOUNCEMENT','INCOMING','OUTGOING','INTERNAL']),
 requires_approval boolean not null default true, requires_number boolean not null default true,
 numbering_rule_id uuid references public.office_numbering_rules(id),
 workflow_id uuid references public.office_approval_workflows(id),
 archive_folder_id uuid references public.office_archive_folders(id),
 is_active boolean not null default true,
 check(not requires_number or numbering_rule_id is not null)
);
create index office_type_workflow_idx on public.office_document_types(workflow_id);
create index office_type_rule_idx on public.office_document_types(numbering_rule_id);
create index office_type_folder_idx on public.office_document_types(archive_folder_id);
create table public.office_documents (
 id uuid primary key default gen_random_uuid(), document_group text not null check(document_group in ('ANNOUNCEMENT','INCOMING','OUTGOING','INTERNAL')),
 document_type_id uuid not null references public.office_document_types(id), title text not null check(length(btrim(title)) between 1 and 500),
 summary text not null default '' check(length(summary)<=2000), content jsonb not null default '{"version":1,"type":"doc","content":[]}', content_text text not null default '',
 status text not null default 'DRAFT' check(status in ('DRAFT','PENDING_APPROVAL','RETURNED','REJECTED','APPROVED','WAITING_NUMBER','ISSUED','REVOKED','ARCHIVED')),
 processing_status text check(processing_status in ('RECEIVED','ASSIGNED','IN_PROGRESS','COMPLETED')),
 document_number text unique, sequence_number bigint, number_year int, numbering_rule_id uuid references public.office_numbering_rules(id),
 document_date date not null default current_date, received_date date, due_date date,
 issuer_department_id uuid references public.org_units(id), signer_user_id uuid references public.users(id), signer_position text,
 project_id text references public.projects(id), construction_site_id uuid references public.hrm_construction_sites(id),
 source_organization text, source_document_number text, source_sender text, external_recipient text,
 urgency text not null default 'NORMAL' check(urgency in ('NORMAL','URGENT','VERY_URGENT')),
 confidentiality text not null default 'INTERNAL' check(confidentiality in ('NORMAL','INTERNAL','RESTRICTED','CONFIDENTIAL')),
 archive_folder_id uuid references public.office_archive_folders(id), workflow_id uuid references public.office_approval_workflows(id),
 recipient_specs jsonb not null default '[]' check(jsonb_typeof(recipient_specs)='array' and jsonb_array_length(recipient_specs)<=100),
 watcher_ids uuid[] not null default '{}', approval_round int not null default 0,
 requires_approval boolean, requires_number boolean, number_code text, number_format text,
 assigned_to uuid references public.users(id), collaborator_ids uuid[] not null default '{}', processing_instruction text, processing_result text,
 received_ack_at timestamptz, processing_started_at timestamptz, processing_completed_at timestamptz,
 created_by uuid not null references public.users(id), updated_by uuid not null references public.users(id), creator_name text not null,
 version bigint not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 submitted_at timestamptz, approved_at timestamptz, numbered_at timestamptz, issued_at timestamptz, revoked_at timestamptz, archived_at timestamptz,
 search_vector tsvector generated always as (to_tsvector('simple',coalesce(title,'')||' '||coalesce(document_number,'')||' '||coalesce(content_text,'')||' '||coalesce(source_organization,'')||' '||creator_name)) stored,
 unique(numbering_rule_id,document_type_id,number_year,sequence_number),
 check((document_number is null)=(sequence_number is null)),
 check(document_group='INCOMING' or processing_status is null)
);
create index office_doc_search_idx on public.office_documents using gin(search_vector);
create index office_doc_list_idx on public.office_documents(created_at desc,id);
create index office_doc_group_status_idx on public.office_documents(document_group,status,created_at desc);
create index office_doc_creator_idx on public.office_documents(created_by,status);
create index office_doc_department_idx on public.office_documents(issuer_department_id,status);
create index office_doc_project_idx on public.office_documents(project_id,status);
create index office_doc_site_idx on public.office_documents(construction_site_id,status);
create index office_doc_type_idx on public.office_documents(document_type_id);
create index office_doc_folder_idx on public.office_documents(archive_folder_id);
create index office_doc_workflow_idx on public.office_documents(workflow_id);
create index office_doc_assigned_idx on public.office_documents(assigned_to,due_date) where processing_status<>'COMPLETED';
create index office_doc_signer_idx on public.office_documents(signer_user_id);
create index office_doc_updated_by_idx on public.office_documents(updated_by);
create index office_doc_rule_idx on public.office_documents(numbering_rule_id);
create table public.office_document_approvals (
 id uuid primary key default gen_random_uuid(), document_id uuid not null references public.office_documents(id),
 round int not null, step int not null, label text not null, user_id uuid not null references public.users(id),
 status text not null default 'WAITING' check(status in ('WAITING','PENDING','APPROVED','RETURNED','REJECTED','CANCELLED')),
 acted_at timestamptz, actor_id uuid references public.users(id), comment text,
 unique(document_id,round,step)
);
create index office_approval_user_idx on public.office_document_approvals(user_id,status);
create index office_approval_actor_idx on public.office_document_approvals(actor_id);
create table public.office_document_recipients (
 document_id uuid not null references public.office_documents(id), user_id uuid not null references public.users(id),
 delivered_at timestamptz not null default now(), read_at timestamptz, acknowledged_at timestamptz,
 primary key(document_id,user_id)
);
create index office_recipient_user_idx on public.office_document_recipients(user_id,read_at,document_id);
create table public.office_document_bookmarks (
 document_id uuid not null references public.office_documents(id), user_id uuid not null references public.users(id),
 favorite boolean not null default false, following boolean not null default false,
 primary key(document_id,user_id)
);
create index office_bookmark_user_idx on public.office_document_bookmarks(user_id,document_id);
create table public.office_document_attachments (
 id uuid primary key default gen_random_uuid(), document_id uuid not null references public.office_documents(id),
 file_name text not null check(length(file_name) between 1 and 240), mime_type text not null, size_bytes bigint not null check(size_bytes between 1 and 52428800),
 bucket text not null default 'office-attachments', path text not null unique,
 status text not null default 'PENDING' check(status in ('PENDING','READY','REMOVED')),
 uploaded_by uuid not null references public.users(id), created_at timestamptz not null default now()
);
create index office_attachment_document_idx on public.office_document_attachments(document_id,status);
create index office_attachment_user_idx on public.office_document_attachments(uploaded_by);
create table public.office_document_versions (
 document_id uuid not null references public.office_documents(id), version bigint not null,
 snapshot jsonb not null, actor_id uuid not null references public.users(id), created_at timestamptz not null default now(),
 primary key(document_id,version)
);
create index office_versions_actor_idx on public.office_document_versions(actor_id);
create table app_private.office_number_sequences (
 rule_id uuid not null references public.office_numbering_rules(id), type_id uuid not null references public.office_document_types(id),
 year int not null, last_value bigint not null check(last_value>0), primary key(rule_id,type_id,year)
);
create table app_private.office_commands (
 actor_id uuid not null, key uuid not null, request_hash text not null, response jsonb,
 created_at timestamptz not null default now(), primary key(actor_id,key)
);
alter table app_private.office_number_sequences enable row level security;
alter table app_private.office_commands enable row level security;
revoke all on app_private.office_number_sequences,app_private.office_commands from public,anon,authenticated;

insert into public.office_numbering_rules(name) values('Sổ văn bản Tiến Thịnh');
insert into public.office_archive_folders(name) values('Văn phòng Tiến Thịnh');
insert into public.office_archive_folders(name,parent_id)
select child.name,f.id from public.office_archive_folders f cross join unnest(array['Ban Tổng Giám đốc','Hành chính Nhân sự','Tài chính Kế toán','Quản lý dự án','Nhà máy KCT','Công trường']) child(name) where f.parent_id is null;
insert into public.office_document_types(code,name,groups,numbering_rule_id,archive_folder_id)
select t.code,t.name,t.groups,r.id,f.id from (values
 ('TB','Thông báo',array['ANNOUNCEMENT','INTERNAL']),('QĐ','Quyết định',array['INTERNAL']),
 ('CV','Công văn',array['INCOMING','OUTGOING','INTERNAL']),('TTr','Tờ trình',array['INTERNAL','OUTGOING']),
 ('BBH','Biên bản cuộc họp',array['INTERNAL']),('BBHT','Biên bản hiện trường',array['INTERNAL','INCOMING','OUTGOING']),
 ('BBLV','Biên bản làm việc',array['INTERNAL','INCOMING','OUTGOING']),('QC','Quy chế',array['INTERNAL']),
 ('QĐI','Quy định',array['INTERNAL']),('QT','Quy trình',array['INTERNAL']),('HD','Hướng dẫn',array['INTERNAL']),
 ('UQ','Ủy quyền',array['INTERNAL','OUTGOING']),('BC','Báo cáo',array['INTERNAL','INCOMING','OUTGOING']),
 ('CT','Chỉ thị',array['INTERNAL']),('ĐN','Đề nghị',array['INTERNAL','OUTGOING']),('KH','Khác',array['INTERNAL','INCOMING','OUTGOING'])
) t(code,name,groups) cross join public.office_numbering_rules r cross join public.office_archive_folders f where f.parent_id is null;

create function app_private.office_access(p_user uuid default public.current_app_user_id()) returns boolean
language sql stable security definer set search_path='' as $$
 select p_user is not null and exists(select 1 from public.users where id=p_user and is_active and account_status='ACTIVE')
 and app_private.has_permission(p_user,'office.module.access','global','*')
$$;
create function app_private.office_has(p_action text,p_doc public.office_documents,p_user uuid default public.current_app_user_id()) returns boolean
language sql stable security definer set search_path='' as $$
 select app_private.office_access(p_user) and coalesce((
 app_private.has_permission(p_user,'office.document.'||p_action,'global','*')
 or (p_doc.created_by=p_user and app_private.has_permission(p_user,'office.document.'||p_action,'own','*'))
 or (p_doc.issuer_department_id is not null and app_private.has_permission(p_user,'office.document.'||p_action,'department',p_doc.issuer_department_id::text))
 or (p_doc.project_id is not null and app_private.has_permission(p_user,'office.document.'||p_action,'project',p_doc.project_id))
 or (p_doc.construction_site_id is not null and app_private.has_permission(p_user,'office.document.'||p_action,'construction_site',p_doc.construction_site_id::text))
 or (app_private.has_permission(p_user,'office.document.'||p_action,'assigned','*') and (
   exists(select 1 from public.office_document_approvals a where a.document_id=p_doc.id and a.user_id=p_user and a.round=p_doc.approval_round)
   or p_user=any(p_doc.watcher_ids)
   or (p_doc.issued_at is not null and (p_doc.assigned_to=p_user or p_user=any(p_doc.collaborator_ids)
     or exists(select 1 from public.office_document_recipients r where r.document_id=p_doc.id and r.user_id=p_user)))))
 ),false)
$$;
create function app_private.office_can_view(p_id uuid,p_user uuid default public.current_app_user_id()) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare d public.office_documents; related boolean;
begin
 if not app_private.office_access(p_user) then return false; end if;
 select * into d from public.office_documents where id=p_id; if not found then return false; end if;
 related:=coalesce(d.created_by=p_user or p_user=any(d.watcher_ids)
 or exists(select 1 from public.office_document_approvals where document_id=d.id and user_id=p_user and round=d.approval_round)
 or (d.issued_at is not null and (d.assigned_to=p_user or p_user=any(d.collaborator_ids)
 or exists(select 1 from public.office_document_recipients where document_id=d.id and user_id=p_user))),false);
 if not app_private.office_has('view',d,p_user) then return false; end if;
 if d.confidentiality in ('RESTRICTED','CONFIDENTIAL') and not related and not app_private.office_has('view_restricted',d,p_user) then return false; end if;
 return related or d.issued_at is not null or app_private.office_has('issue_number',d,p_user) or app_private.office_has('publish',d,p_user)
 or app_private.has_permission(p_user,'office.document.view','global','*');
end $$;
create function app_private.office_capabilities(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare d public.office_documents; a uuid:=public.current_app_user_id(); editable boolean;
begin
 if not app_private.office_can_view(p_id) then raise exception 'OFFICE_NOT_FOUND' using errcode='42501'; end if;
 select * into strict d from public.office_documents where id=p_id;
 editable:=d.status in ('DRAFT','RETURNED') and d.document_number is null;
 return jsonb_build_object(
 'edit',editable and app_private.office_has('edit',d),
 'submit',editable and app_private.office_has('submit',d),
 'approve',d.status='PENDING_APPROVAL' and app_private.office_has('approve',d) and exists(select 1 from public.office_document_approvals where document_id=d.id and round=d.approval_round and status='PENDING' and user_id=a),
 'issue_number',d.status='WAITING_NUMBER' and d.document_number is null and app_private.office_has('issue_number',d),
 'publish',d.status='APPROVED' and app_private.office_has('publish',d),
 'revoke',d.status='ISSUED' and app_private.office_has('revoke',d),
 'archive',d.status in ('ISSUED','REVOKED','REJECTED') and (d.document_group<>'INCOMING' or d.processing_status='COMPLETED' or d.status='REVOKED') and app_private.office_has('archive',d),
 'assign',d.document_group='INCOMING' and d.status='ISSUED' and app_private.office_has('assign',d),
 'process',d.document_group='INCOMING' and d.status='ISSUED' and d.assigned_to=a and d.processing_status in ('ASSIGNED','IN_PROGRESS') and app_private.office_has('process',d),
 'track',d.created_by=a or app_private.office_has('publish',d) or app_private.office_has('approve',d),
 'read',d.issued_at is not null and d.revoked_at is null and d.status in ('ISSUED','ARCHIVED') and exists(select 1 from public.office_document_recipients where document_id=d.id and user_id=a and read_at is null));
end $$;

-- Resolve audience from existing identities and current organizational assignments.
create function app_private.office_resolve_recipients(p_specs jsonb) returns table(user_id uuid)
language sql stable security definer set search_path='' as $$
 select distinct u.id from public.users u cross join jsonb_array_elements(p_specs) s
 where u.is_active and u.account_status='ACTIVE' and (
 s->>'type'='company' or (s->>'type'='user' and u.id::text=s->>'id')
 or (s->>'type' in ('department','factory') and exists(
 select 1 from public.employees e join public.hrm_employee_slot_assignments a on a.employee_id=e.id
 join public.hrm_org_position_slots slot on slot.id=a.slot_id join public.org_units unit on unit.id=slot.org_unit_id
 where e.user_id=u.id and e.status='Đang làm việc' and unit.is_active and unit.id::text=s->>'id'
 and a.status='ACTIVE' and a.effective_from<=current_date and (a.effective_to is null or a.effective_to>=current_date)
 and slot.status='ACTIVE' and slot.effective_from<=current_date and (slot.effective_to is null or slot.effective_to>=current_date)))
 or (s->>'type' in ('project','site') and exists(select 1 from public.project_staff ps where ps.user_id=u.id::text
 and (ps.start_date is null or ps.start_date<=current_date) and (ps.end_date is null or ps.end_date>=current_date)
 and ((s->>'type'='project' and ps.project_id=s->>'id') or (s->>'type'='site' and ps.construction_site_id=s->>'id'))))
 or (s->>'type'='role' and exists(select 1 from public.principal_role_assignments ra
 join public.role_permission_templates rt on rt.id=ra.role_template_id and rt.is_active
 where ra.principal_type='user' and ra.principal_id=u.id and ra.role_template_id::text=s->>'id'
 and ra.status='ACTIVE' and ra.starts_at<=now() and (ra.expires_at is null or ra.expires_at>now())))
 )
$$;
create function app_private.office_event(p_doc uuid,p_event text,p_comment text default null) returns void
language plpgsql security definer set search_path='' as $$
declare a uuid:=public.current_app_user_id(); d public.office_documents;
begin
 select * into strict d from public.office_documents where id=p_doc;
 insert into public.audit_trail(table_name,record_id,record_label,entity_type,action,user_id,user_name,module,description,context)
 values('office_documents',d.id::text,'Văn bản Office','office_document',case when p_event='CREATED' then 'INSERT' else 'UPDATE' end,
 a::text,(select name from public.users where id=a),'OFFICE',p_event,
 jsonb_strip_nulls(jsonb_build_object('event',p_event,'comment',p_comment,'version',d.version,'number',d.document_number,'status',d.status)));
end $$;
create function app_private.office_notify(p_doc uuid,p_event text,p_users uuid[],p_reason text default 'assigned') returns void
language plpgsql security definer set search_path='' as $$
declare d public.office_documents; caption text;
begin
 select * into strict d from public.office_documents where id=p_doc;
 caption:=case p_event when 'DOCUMENT_APPROVAL_REQUIRED' then 'Văn bản chờ bạn duyệt' when 'DOCUMENT_ISSUED' then 'Văn bản mới được phát hành'
 when 'DOCUMENT_RETURNED' then 'Văn bản cần chỉnh sửa' when 'DOCUMENT_REJECTED' then 'Văn bản đã bị từ chối'
 when 'DOCUMENT_APPROVED' then 'Văn bản đã được duyệt' when 'DOCUMENT_NUMBER_REQUIRED' then 'Văn bản đang chờ cấp số'
 when 'DOCUMENT_REVOKED' then 'Văn bản đã được thu hồi' when 'DOCUMENT_ASSIGNED' then 'Bạn được giao xử lý văn bản' else 'Cập nhật văn bản' end;
 insert into public.notifications(user_id,type,category,module,title,message,body,link,source_type,source_id,entity_type,entity_id,metadata,delivery_reason,push_enabled)
 select distinct u.id::text,'info','office','OFFICE',caption,d.title,d.title,'/office/documents/'||d.id,'office_document',d.id::text,'office_document',d.id,
 jsonb_build_object('event',p_event,'documentId',d.id),p_reason,true
 from unnest(coalesce(p_users,'{}')) target(id) join public.users u on u.id=target.id
 where app_private.office_can_view(d.id,u.id);
end $$;

create function app_private.office_validate_draft(p_doc public.office_documents) returns void
language plpgsql stable security definer set search_path='' as $$
declare t public.office_document_types; spec jsonb; wf public.office_approval_workflows;
begin
 select * into t from public.office_document_types where id=p_doc.document_type_id and is_active;
 if not found or not p_doc.document_group=any(t.groups) then raise exception 'OFFICE_INVALID_TYPE'; end if;
 if p_doc.project_id is not null and p_doc.construction_site_id is not null and not exists(select 1 from public.projects where id=p_doc.project_id and construction_site_id=p_doc.construction_site_id) then raise exception 'OFFICE_SITE_PROJECT_MISMATCH'; end if;
 if p_doc.workflow_id is not null then
  select * into wf from public.office_approval_workflows where id=p_doc.workflow_id and is_active;
  if not found or (wf.department_id is not null and wf.department_id is distinct from p_doc.issuer_department_id)
   or (wf.project_id is not null and wf.project_id is distinct from p_doc.project_id) then raise exception 'OFFICE_INVALID_WORKFLOW'; end if;
 end if;
 if p_doc.archive_folder_id is not null and not exists(select 1 from public.office_archive_folders where id=p_doc.archive_folder_id and is_active) then raise exception 'OFFICE_INVALID_FOLDER'; end if;
 if cardinality(p_doc.watcher_ids)>100 then raise exception 'OFFICE_INVALID_RECIPIENTS'; end if;
 for spec in select value from jsonb_array_elements(p_doc.recipient_specs) loop
  if spec->>'type' not in ('company','user','department','factory','project','site','role') or spec->>'type' is null
   or (spec->>'type'<>'company' and nullif(spec->>'id','') is null) then raise exception 'OFFICE_INVALID_RECIPIENTS'; end if;
 end loop;
end $$;

create function app_private.office_command(p_command text,p_document_id uuid,p_payload jsonb,p_expected_version bigint,p_idempotency_key uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
 a uuid:=public.current_app_user_id(); d public.office_documents; prev public.office_documents;
 typ public.office_document_types; wf public.office_approval_workflows; approval public.office_document_approvals;
 att public.office_document_attachments; caps jsonb; prior app_private.office_commands;
 h text:=md5(jsonb_build_array(p_command,p_document_id,p_payload,p_expected_version)::text); result jsonb;
 event text; note text:=nullif(btrim(p_payload->>'reason'),''); step_record record; ids uuid[]; next_user uuid;
 editable_fields text[]:=array['document_group','document_type_id','title','summary','content','document_date','received_date','due_date','issuer_department_id','signer_user_id','signer_position','project_id','construction_site_id','source_organization','source_document_number','source_sender','external_recipient','urgency','confidentiality','archive_folder_id','workflow_id','recipient_specs','watcher_ids'];
begin
 if not app_private.office_access(a) then raise exception 'OFFICE_DENIED' using errcode='42501'; end if;
 if p_idempotency_key is null or jsonb_typeof(p_payload) is distinct from 'object' or length(coalesce(note,''))>4000 then raise exception 'OFFICE_INVALID_COMMAND'; end if;
 insert into app_private.office_commands(actor_id,key,request_hash) values(a,p_idempotency_key,h) on conflict do nothing;
 select * into strict prior from app_private.office_commands where actor_id=a and key=p_idempotency_key for update;
 if prior.request_hash<>h then raise exception 'OFFICE_IDEMPOTENCY_CONFLICT'; end if;
 if prior.response is not null then return prior.response; end if;
 if p_command='create' then
  if p_payload-editable_fields<>'{}'::jsonb then raise exception 'OFFICE_INVALID_COMMAND'; end if;
  d:=jsonb_populate_record(null::public.office_documents,p_payload);
  d.id:=gen_random_uuid(); d.created_by:=a; d.updated_by:=a; d.creator_name:=(select name from public.users where id=a);
  d.version:=1; d.status:='DRAFT'; d.approval_round:=0; d.created_at:=now(); d.updated_at:=now();
  d.document_date:=coalesce(d.document_date,current_date); d.summary:=coalesce(d.summary,'');
  d.content:=coalesce(d.content,'{"version":1,"type":"doc","content":[]}');
  d.content_text:=app_private.work_validate_document(d.content); d.urgency:=coalesce(d.urgency,'NORMAL'); d.confidentiality:=coalesce(d.confidentiality,'INTERNAL');
  d.recipient_specs:=coalesce(d.recipient_specs,'[]'); d.watcher_ids:=coalesce(d.watcher_ids,'{}'); d.collaborator_ids:='{}';
  if not app_private.office_has('create',d) or not app_private.office_has('view',d) then raise exception 'OFFICE_DENIED' using errcode='42501'; end if;
  perform app_private.office_validate_draft(d);
  insert into public.office_documents(id,document_group,document_type_id,title,summary,content,content_text,status,document_date,received_date,due_date,issuer_department_id,signer_user_id,signer_position,project_id,construction_site_id,source_organization,source_document_number,source_sender,external_recipient,urgency,confidentiality,archive_folder_id,workflow_id,recipient_specs,watcher_ids,collaborator_ids,created_by,updated_by,creator_name,version,approval_round,created_at,updated_at) values(d.id,d.document_group,d.document_type_id,d.title,d.summary,d.content,d.content_text,d.status,d.document_date,d.received_date,d.due_date,d.issuer_department_id,d.signer_user_id,d.signer_position,d.project_id,d.construction_site_id,d.source_organization,d.source_document_number,d.source_sender,d.external_recipient,d.urgency,d.confidentiality,d.archive_folder_id,d.workflow_id,d.recipient_specs,d.watcher_ids,d.collaborator_ids,d.created_by,d.updated_by,d.creator_name,d.version,d.approval_round,d.created_at,d.updated_at);
  event:='CREATED';
 else
  select * into d from public.office_documents where id=p_document_id for update;
  if not found or not app_private.office_can_view(d.id) then raise exception 'OFFICE_NOT_FOUND' using errcode='42501'; end if;
  prev:=d; caps:=app_private.office_capabilities(d.id);
  if p_command not in ('read','bookmark') and p_expected_version is distinct from d.version then raise exception 'OFFICE_VERSION_CONFLICT'; end if;
  if p_command='save' then
   if not (caps->>'edit')::boolean then raise exception 'OFFICE_DENIED' using errcode='42501'; end if;
   if p_payload-editable_fields<>'{}'::jsonb then raise exception 'OFFICE_INVALID_COMMAND'; end if;
   d:=jsonb_populate_record(d,p_payload); d.content_text:=app_private.work_validate_document(d.content);
   perform app_private.office_validate_draft(d);
   if not app_private.office_has('edit',d) or not app_private.office_has('view',d) then raise exception 'OFFICE_DENIED'; end if;
   update public.office_documents set document_group=d.document_group,document_type_id=d.document_type_id,title=d.title,summary=d.summary,content=d.content,content_text=d.content_text,
    document_date=d.document_date,received_date=d.received_date,due_date=d.due_date,issuer_department_id=d.issuer_department_id,signer_user_id=d.signer_user_id,signer_position=d.signer_position,
    project_id=d.project_id,construction_site_id=d.construction_site_id,source_organization=d.source_organization,source_document_number=d.source_document_number,source_sender=d.source_sender,external_recipient=d.external_recipient,
    urgency=d.urgency,confidentiality=d.confidentiality,archive_folder_id=d.archive_folder_id,workflow_id=d.workflow_id,recipient_specs=d.recipient_specs,watcher_ids=d.watcher_ids where id=d.id;
   event:='EDITED';
  elsif p_command='submit' then
   if not (caps->>'submit')::boolean then raise exception 'OFFICE_DENIED' using errcode='42501'; end if;
   perform app_private.office_validate_draft(d);
   select * into strict typ from public.office_document_types where id=d.document_type_id;
   if btrim(d.content_text)='' and not exists(select 1 from public.office_document_attachments where document_id=d.id and status='READY') then raise exception 'OFFICE_CONTENT_REQUIRED'; end if;
   if not exists(select 1 from app_private.office_resolve_recipients(d.recipient_specs)) then raise exception 'OFFICE_RECIPIENT_REQUIRED'; end if;
   if d.document_group='INCOMING' and (nullif(btrim(d.source_organization),'') is null or d.received_date is null
    or not exists(select 1 from public.office_document_attachments where document_id=d.id and status='READY')) then raise exception 'OFFICE_INCOMING_REQUIRED'; end if;
   if d.document_group='OUTGOING' and nullif(btrim(d.external_recipient),'') is null then raise exception 'OFFICE_EXTERNAL_RECIPIENT_REQUIRED'; end if;
   d.requires_approval:=typ.requires_approval and d.document_group<>'INCOMING';
   d.requires_number:=typ.requires_number and d.document_group<>'INCOMING'; d.numbering_rule_id:=typ.numbering_rule_id;
   d.number_code:=typ.code; select format into d.number_format from public.office_numbering_rules where id=typ.numbering_rule_id and is_active;
   if d.requires_number and d.number_format is null then raise exception 'OFFICE_INVALID_NUMBER_RULE'; end if;
   d.approval_round:=d.approval_round+1;
   if d.requires_approval then
    select * into wf from public.office_approval_workflows where id=coalesce(d.workflow_id,typ.workflow_id) and is_active;
    if not found or (wf.department_id is not null and wf.department_id is distinct from d.issuer_department_id)
     or (wf.project_id is not null and wf.project_id is distinct from d.project_id) then raise exception 'OFFICE_WORKFLOW_REQUIRED'; end if;
    for step_record in select value,ordinality n from jsonb_array_elements(wf.steps) with ordinality loop
     next_user:=(step_record.value->>'userId')::uuid;
     if next_user=a then raise exception 'OFFICE_SELF_APPROVAL'; end if;
     insert into public.office_document_approvals(document_id,round,step,label,user_id,status)
      values(d.id,d.approval_round,step_record.n,coalesce(nullif(step_record.value->>'label',''),'Phê duyệt'),next_user,case when step_record.n=1 then 'PENDING' else 'WAITING' end);
    end loop;
    d.status:='PENDING_APPROVAL';
   else d.status:=case when d.requires_number then 'WAITING_NUMBER' else 'APPROVED' end; end if;
   update public.office_documents set status=d.status,requires_approval=d.requires_approval,requires_number=d.requires_number,
    numbering_rule_id=d.numbering_rule_id,number_code=d.number_code,number_format=d.number_format,approval_round=d.approval_round,
    workflow_id=coalesce(d.workflow_id,typ.workflow_id),submitted_at=now(),approved_at=case when not d.requires_approval then now() end,
    processing_status=case when d.document_group='INCOMING' then 'RECEIVED' end where id=d.id;
   for next_user in select user_id from public.office_document_approvals where document_id=d.id and round=d.approval_round loop
    if not app_private.office_has('approve',d,next_user) or not app_private.office_can_view(d.id,next_user) then raise exception 'OFFICE_APPROVER_INELIGIBLE'; end if;
   end loop;
   perform app_private.office_notify(d.id,'DOCUMENT_APPROVAL_REQUIRED',array(select user_id from public.office_document_approvals where document_id=d.id and round=d.approval_round and status='PENDING'));
   event:='SUBMITTED';
  elsif p_command in ('approve','return','reject') then
   if not (caps->>'approve')::boolean then raise exception 'OFFICE_DENIED' using errcode='42501'; end if;
   if p_command in ('return','reject') and note is null then raise exception 'OFFICE_REASON_REQUIRED'; end if;
   select * into strict approval from public.office_document_approvals where document_id=d.id and round=d.approval_round and status='PENDING' and user_id=a for update;
   update public.office_document_approvals set status=case p_command when 'approve' then 'APPROVED' when 'return' then 'RETURNED' else 'REJECTED' end,
    actor_id=a,acted_at=now(),comment=note where id=approval.id;
   if p_command='approve' then
    select user_id into next_user from public.office_document_approvals where document_id=d.id and round=d.approval_round and step=approval.step+1;
    if found then
     update public.office_document_approvals set status='PENDING' where document_id=d.id and round=d.approval_round and step=approval.step+1;
     perform app_private.office_notify(d.id,'DOCUMENT_APPROVAL_REQUIRED',array[next_user]);
    else
     update public.office_documents set status=case when requires_number then 'WAITING_NUMBER' else 'APPROVED' end,approved_at=now() where id=d.id;
    end if;
    event:='APPROVED';
   else
    update public.office_documents set status=case p_command when 'return' then 'RETURNED' else 'REJECTED' end where id=d.id;
    update public.office_document_approvals set status='CANCELLED' where document_id=d.id and round=d.approval_round and status='WAITING';
    event:=case p_command when 'return' then 'RETURNED' else 'REJECTED' end;
   end if;
   perform app_private.office_notify(d.id,'DOCUMENT_'||event,array[d.created_by]);
  elsif p_command='issue_number' then
   if not (caps->>'issue_number')::boolean or (d.requires_approval and exists(select 1 from public.office_document_approvals where document_id=d.id and round=d.approval_round and status<>'APPROVED')) then raise exception 'OFFICE_DENIED' using errcode='42501'; end if;
   d.number_year:=extract(year from now() at time zone 'Asia/Ho_Chi_Minh');
   insert into app_private.office_number_sequences(rule_id,type_id,year,last_value) values(d.numbering_rule_id,d.document_type_id,d.number_year,1)
   on conflict(rule_id,type_id,year) do update set last_value=app_private.office_number_sequences.last_value+1 returning last_value into d.sequence_number;
   d.document_number:=replace(replace(replace(d.number_format,'{sequence}',d.sequence_number::text),'{year}',d.number_year::text),'{code}',d.number_code);
   update public.office_documents set document_number=d.document_number,sequence_number=d.sequence_number,number_year=d.number_year,numbered_at=now(),status='APPROVED' where id=d.id;
   event:='NUMBER_ISSUED';
  elsif p_command='publish' then
   if not (caps->>'publish')::boolean or (d.requires_number and d.document_number is null) or d.approved_at is null
     or (d.requires_approval and (not exists(select 1 from public.office_document_approvals where document_id=d.id and round=d.approval_round)
       or exists(select 1 from public.office_document_approvals where document_id=d.id and round=d.approval_round and status<>'APPROVED'))) then raise exception 'OFFICE_DENIED' using errcode='42501'; end if;
   select array_agg(user_id) into ids from app_private.office_resolve_recipients(d.recipient_specs);
   if coalesce(cardinality(ids),0)=0 then raise exception 'OFFICE_RECIPIENT_REQUIRED'; end if;
   insert into public.office_document_recipients(document_id,user_id) select d.id,unnest(ids) on conflict do nothing;
   update public.office_documents set status='ISSUED',issued_at=now() where id=d.id;
   if exists(select 1 from unnest(ids) u where not app_private.office_can_view(d.id,u)) then raise exception 'OFFICE_RECIPIENT_INELIGIBLE'; end if;
   perform app_private.office_notify(d.id,'DOCUMENT_ISSUED',ids);
   event:='PUBLISHED';
  elsif p_command='revoke' then
   if not (caps->>'revoke')::boolean then raise exception 'OFFICE_DENIED' using errcode='42501'; end if;
   if note is null then raise exception 'OFFICE_REASON_REQUIRED'; end if;
   update public.office_documents set status='REVOKED',revoked_at=now() where id=d.id;
   perform app_private.office_notify(d.id,'DOCUMENT_REVOKED',array(select user_id from public.office_document_recipients where document_id=d.id)); event:='REVOKED';
  elsif p_command='archive' then
   if not (caps->>'archive')::boolean then raise exception 'OFFICE_DENIED' using errcode='42501'; end if;
   update public.office_documents set status='ARCHIVED',archived_at=now() where id=d.id; event:='ARCHIVED';
  elsif p_command='assign' then
   if not (caps->>'assign')::boolean then raise exception 'OFFICE_DENIED' using errcode='42501'; end if;
   next_user:=(p_payload->>'userId')::uuid;
   if next_user is null or nullif(btrim(p_payload->>'instruction'),'') is null or nullif(p_payload->>'dueDate','') is null then raise exception 'OFFICE_ASSIGNMENT_REQUIRED'; end if;
   ids:=array(select jsonb_array_elements_text(coalesce(p_payload->'collaboratorIds','[]'))::uuid);
   update public.office_documents set assigned_to=next_user,collaborator_ids=ids,due_date=(p_payload->>'dueDate')::date,processing_instruction=p_payload->>'instruction',
    processing_status='ASSIGNED',received_ack_at=null,processing_started_at=null,processing_completed_at=null,processing_result=null where id=d.id returning * into d;
   insert into public.office_document_recipients(document_id,user_id) select d.id,unnest(array[next_user]||ids) on conflict do nothing;
   if not app_private.office_has('process',d,next_user) or exists(select 1 from unnest(array[next_user]||ids) u where not app_private.office_can_view(d.id,u)) then raise exception 'OFFICE_RECIPIENT_INELIGIBLE'; end if;
   perform app_private.office_notify(d.id,'DOCUMENT_ASSIGNED',array[next_user]||ids); event:='ASSIGNED';
  elsif p_command in ('acknowledge','start','complete') then
   if not (caps->>'process')::boolean then raise exception 'OFFICE_DENIED' using errcode='42501'; end if;
   if p_command='start' and d.received_ack_at is null then raise exception 'OFFICE_ACK_REQUIRED'; end if;
   if p_command='complete' and (d.processing_status<>'IN_PROGRESS' or nullif(btrim(p_payload->>'result'),'') is null) then raise exception 'OFFICE_RESULT_REQUIRED'; end if;
   update public.office_documents set received_ack_at=case when p_command='acknowledge' then coalesce(received_ack_at,now()) else received_ack_at end,
    processing_status=case p_command when 'start' then 'IN_PROGRESS' when 'complete' then 'COMPLETED' else processing_status end,
    processing_started_at=case when p_command='start' then coalesce(processing_started_at,now()) else processing_started_at end,
    processing_completed_at=case when p_command='complete' then now() else processing_completed_at end,
    processing_result=case when p_command='complete' then p_payload->>'result' else processing_result end where id=d.id;
   event:=upper(p_command);
  elsif p_command='read' then
   if d.issued_at is null or d.revoked_at is not null or d.status not in ('ISSUED','ARCHIVED') then raise exception 'OFFICE_NOT_ISSUED'; end if;
   update public.office_document_recipients set read_at=coalesce(read_at,now()) where document_id=d.id and user_id=a;
   result:=jsonb_build_object('id',d.id,'version',d.version);
  elsif p_command='bookmark' then
   insert into public.office_document_bookmarks(document_id,user_id,favorite,following) values(d.id,a,coalesce((p_payload->>'favorite')::boolean,false),coalesce((p_payload->>'following')::boolean,false))
   on conflict(document_id,user_id) do update set favorite=excluded.favorite,following=excluded.following;
   result:=jsonb_build_object('id',d.id,'version',d.version);
  elsif p_command in ('attachment_begin','attachment_finish','attachment_remove') then
   if not (caps->>'edit')::boolean then raise exception 'OFFICE_DENIED' using errcode='42501'; end if;
   if p_command='attachment_begin' then
    if (select count(*) from public.office_document_attachments where document_id=d.id and status<>'REMOVED')>=30 then raise exception 'OFFICE_ATTACHMENT_LIMIT'; end if;
    if p_payload->>'mimeType' not in ('application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/jpeg','image/png','image/webp','text/plain','text/csv') then raise exception 'OFFICE_FILE_TYPE'; end if;
    att.id:=gen_random_uuid();
    insert into public.office_document_attachments(id,document_id,file_name,mime_type,size_bytes,path,uploaded_by)
     values(att.id,d.id,p_payload->>'fileName',p_payload->>'mimeType',(p_payload->>'size')::bigint,d.id::text||'/'||att.id::text,a) returning * into att;
    result:=jsonb_build_object('attachment',to_jsonb(att)); event:='ATTACHMENT_RESERVED';
   else
    select * into att from public.office_document_attachments where id=(p_payload->>'attachmentId')::uuid and document_id=d.id for update;
    if not found then raise exception 'OFFICE_ATTACHMENT_NOT_FOUND'; end if;
    if p_command='attachment_finish' then
     if att.status<>'PENDING' or not exists(select 1 from storage.objects where bucket_id=att.bucket and name=att.path and (metadata->>'size')::bigint=att.size_bytes and metadata->>'mimetype'=att.mime_type) then raise exception 'OFFICE_UPLOAD_INCOMPLETE'; end if;
     update public.office_document_attachments set status='READY' where id=att.id; event:='ATTACHMENT_UPLOADED';
    else update public.office_document_attachments set status='REMOVED' where id=att.id; event:='ATTACHMENT_REMOVED'; end if;
   end if;
  else raise exception 'OFFICE_INVALID_COMMAND'; end if;
 end if;
 if event is not null then
  if p_command<>'create' then update public.office_documents set version=version+1,updated_by=a,updated_at=now() where id=d.id; end if;
  select * into strict d from public.office_documents where id=d.id;
  insert into public.office_document_versions(document_id,version,snapshot,actor_id) values(d.id,d.version,to_jsonb(d)-'search_vector',a);
  perform app_private.office_event(d.id,event,note);
  perform app_private.office_notify(d.id,'DOCUMENT_'||event,
    array(select user_id from public.office_document_bookmarks where document_id=d.id and following and user_id<>a)||d.watcher_ids,'watching');
  if d.status='WAITING_NUMBER' then perform app_private.office_notify(d.id,'DOCUMENT_NUMBER_REQUIRED',array(select id from public.users where app_private.office_has('issue_number',d,id))); end if;
 end if;
 result:=coalesce(result,'{}')||jsonb_build_object('id',d.id,'version',d.version,'status',d.status);
 update app_private.office_commands set response=result where actor_id=a and key=p_idempotency_key;
 return result;
end $$;

create function app_private.office_configure(p_kind text,p_id uuid,p_data jsonb) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare new_id uuid:=coalesce(p_id,gen_random_uuid()); s jsonb; t public.office_document_types; w public.office_approval_workflows;
begin
 if not app_private.office_access() or not app_private.has_permission(public.current_app_user_id(),'office.configuration.manage','global','*') then raise exception 'OFFICE_DENIED' using errcode='42501'; end if;
 if p_kind='type' then
  t:=jsonb_populate_record(null::public.office_document_types,p_data);
  insert into public.office_document_types(id,code,name,groups,requires_approval,requires_number,numbering_rule_id,workflow_id,archive_folder_id,is_active)
  values(new_id,t.code,t.name,t.groups,coalesce(t.requires_approval,true),coalesce(t.requires_number,true),t.numbering_rule_id,t.workflow_id,t.archive_folder_id,coalesce(t.is_active,true))
  on conflict(id) do update set code=excluded.code,name=excluded.name,groups=excluded.groups,requires_approval=excluded.requires_approval,requires_number=excluded.requires_number,
   numbering_rule_id=excluded.numbering_rule_id,workflow_id=excluded.workflow_id,archive_folder_id=excluded.archive_folder_id,is_active=excluded.is_active;
 elsif p_kind='workflow' then
  w:=jsonb_populate_record(null::public.office_approval_workflows,p_data);
  for s in select value from jsonb_array_elements(w.steps) loop
   if nullif(s->>'label','') is null or not exists(select 1 from public.users where id=(s->>'userId')::uuid and is_active and account_status='ACTIVE') then raise exception 'OFFICE_INVALID_WORKFLOW'; end if;
  end loop;
  insert into public.office_approval_workflows(id,name,steps,department_id,project_id,is_active) values(new_id,w.name,w.steps,w.department_id,w.project_id,coalesce(w.is_active,true))
  on conflict(id) do update set name=excluded.name,steps=excluded.steps,department_id=excluded.department_id,project_id=excluded.project_id,is_active=excluded.is_active,version=office_approval_workflows.version+1;
 elsif p_kind='rule' then
  if (p_data->>'format') ~ '\{(?!sequence\}|year\}|code\})' then raise exception 'OFFICE_INVALID_NUMBER_RULE'; end if;
  insert into public.office_numbering_rules(id,name,format,is_active) values(new_id,p_data->>'name',p_data->>'format',coalesce((p_data->>'is_active')::boolean,true))
  on conflict(id) do update set name=excluded.name,format=excluded.format,is_active=excluded.is_active;
 elsif p_kind='folder' then
  if p_id is not null and exists(with recursive children as (select id from public.office_archive_folders where parent_id=p_id union all select f.id from public.office_archive_folders f join children c on f.parent_id=c.id) select 1 from children where id=(p_data->>'parent_id')::uuid) then raise exception 'OFFICE_FOLDER_CYCLE'; end if;
  insert into public.office_archive_folders(id,name,parent_id,is_active) values(new_id,p_data->>'name',(p_data->>'parent_id')::uuid,coalesce((p_data->>'is_active')::boolean,true))
  on conflict(id) do update set name=excluded.name,parent_id=excluded.parent_id,is_active=excluded.is_active;
 else raise exception 'OFFICE_INVALID_COMMAND'; end if;
 insert into public.audit_trail(table_name,record_id,record_label,action,user_id,user_name,module,description,context)
 values('office_configuration',new_id::text,p_kind,'UPDATE',public.current_app_user_id()::text,(select name from public.users where id=public.current_app_user_id()),'OFFICE','CONFIGURED',jsonb_build_object('kind',p_kind));
 return new_id;
end $$;

create function app_private.office_filtered(p_params jsonb) returns setof public.office_documents
language sql stable security definer set search_path='' as $$
 with recursive selected_folders as (
  select id from public.office_archive_folders where id::text=nullif(p_params->>'folderId','')
  union all select f.id from public.office_archive_folders f join selected_folders parent on f.parent_id=parent.id
 )
 select d.* from public.office_documents d
 where app_private.office_can_view(d.id)
 and (nullif(p_params->>'group','') is null or d.document_group=p_params->>'group')
 and (nullif(p_params->>'status','') is null or d.status=p_params->>'status')
 and (nullif(p_params->>'typeId','') is null or d.document_type_id::text=p_params->>'typeId')
 and (nullif(p_params->>'departmentId','') is null or d.issuer_department_id::text=p_params->>'departmentId')
 and (nullif(p_params->>'projectId','') is null or d.project_id=p_params->>'projectId')
 and (nullif(p_params->>'siteId','') is null or d.construction_site_id::text=p_params->>'siteId')
 and (nullif(p_params->>'folderId','') is null or d.archive_folder_id in (select id from selected_folders))
 and (nullif(p_params->>'creatorId','') is null or d.created_by::text=p_params->>'creatorId')
 and (nullif(p_params->>'signerId','') is null or d.signer_user_id::text=p_params->>'signerId')
 and (nullif(p_params->>'urgency','') is null or d.urgency=p_params->>'urgency')
 and (nullif(p_params->>'confidentiality','') is null or d.confidentiality=p_params->>'confidentiality')
 and (nullif(p_params->>'from','') is null or d.document_date >= (p_params->>'from')::date)
 and (nullif(p_params->>'to','') is null or d.document_date <= (p_params->>'to')::date)
 and (nullif(btrim(p_params->>'search'),'') is null or d.search_vector @@ plainto_tsquery('simple',p_params->>'search')
   or d.title ilike '%'||replace(replace(replace(p_params->>'search','\','\\'),'%','\%'),'_','\_')||'%'
   or d.document_number ilike '%'||replace(replace(replace(p_params->>'search','\','\\'),'%','\%'),'_','\_')||'%')
 and case coalesce(p_params->>'view','all')
 when 'all' then true
 when 'created' then d.created_by=public.current_app_user_id()
 when 'approval' then exists(select 1 from public.office_document_approvals where document_id=d.id and round=d.approval_round and status='PENDING' and user_id=public.current_app_user_id()) and app_private.office_has('approve',d)
 when 'numbering' then d.status='WAITING_NUMBER' and app_private.office_has('issue_number',d)
 when 'assigned' then d.assigned_to=public.current_app_user_id() and d.processing_status<>'COMPLETED' and d.status='ISSUED'
 when 'overdue' then d.due_date<current_date and d.processing_status in ('RECEIVED','ASSIGNED','IN_PROGRESS') and d.status='ISSUED'
 when 'unread' then d.revoked_at is null and d.status in ('ISSUED','ARCHIVED') and exists(select 1 from public.office_document_recipients where document_id=d.id and user_id=public.current_app_user_id() and read_at is null)
 when 'following' then exists(select 1 from public.office_document_bookmarks where document_id=d.id and user_id=public.current_app_user_id() and following)
 when 'favorites' then exists(select 1 from public.office_document_bookmarks where document_id=d.id and user_id=public.current_app_user_id() and favorite)
 when 'archive' then d.status='ARCHIVED'
 else false end
$$;
create function app_private.office_query(p_query text,p_params jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a uuid:=public.current_app_user_id(); d public.office_documents; caps jsonb; out jsonb; items jsonb; total bigint;
 page_size int:=least(50,greatest(1,coalesce((p_params->>'pageSize')::int,25))); page_no int:=greatest(0,coalesce((p_params->>'page')::int,0));
begin
 if not app_private.office_access() then raise exception 'OFFICE_DENIED' using errcode='42501'; end if;
 if p_query='catalog' then
  return jsonb_build_object('types',(select coalesce(jsonb_agg(t order by name),'[]') from public.office_document_types t),
   'rules',(select coalesce(jsonb_agg(t order by name),'[]') from public.office_numbering_rules t),
   'workflows',(select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('stepNames',(select jsonb_object_agg(u.id,u.name) from public.users u where u.id in (select (s->>'userId')::uuid from jsonb_array_elements(t.steps) s)))),'[]') from public.office_approval_workflows t),
   'folders',(select coalesce(jsonb_agg(t order by name),'[]') from public.office_archive_folders t),
   'canConfigure',app_private.has_permission(a,'office.configuration.manage','global','*'),
   'canCreate',exists(select 1 from app_private.resolve_effective_permission_sources(a,'office.document.create',null,null,now())),
   'actorId',a);
 elsif p_query='options' then
  select coalesce(jsonb_agg(q),'[]') into items from (
   select * from (
    select 'user' kind,id::text id,name from public.users where is_active and account_status='ACTIVE' and p_params->>'kind'='user'
    union all select 'department',id::text,name from public.org_units where is_active and p_params->>'kind' in ('department','factory')
    union all select 'project',id,name from public.projects where p_params->>'kind'='project'
    union all select 'site',id::text,name from public.hrm_construction_sites where p_params->>'kind'='site'
    union all select 'role',id::text,name from public.role_permission_templates where is_active and p_params->>'kind'='role'
   ) choices where name ilike '%'||coalesce(p_params->>'search','')||'%' or id in (select jsonb_array_elements_text(coalesce(p_params->'ids','[]')))
   order by (id in (select jsonb_array_elements_text(coalesce(p_params->'ids','[]')))) desc,name,id limit 50
  ) q; return items;
 elsif p_query='audience' then
  select jsonb_build_object('total',count(*),'withoutAccess',count(*) filter(where not app_private.office_access(r.user_id)),
   'names',(select coalesce(jsonb_agg(n),'[]') from (select u.name from app_private.office_resolve_recipients(p_params->'specs') rr join public.users u on u.id=rr.user_id order by u.name limit 10)n)) into out
  from app_private.office_resolve_recipients(p_params->'specs') r; return out;
 elsif p_query='dashboard' then
  select jsonb_build_object('new',count(*) filter(where doc.issued_at>=now()-interval '7 days'),
   'unread',count(*) filter(where doc.revoked_at is null and doc.status in ('ISSUED','ARCHIVED') and exists(select 1 from public.office_document_recipients where document_id=doc.id and user_id=a and read_at is null)),
   'approval',count(*) filter(where doc.status='PENDING_APPROVAL' and exists(select 1 from public.office_document_approvals where document_id=doc.id and round=doc.approval_round and user_id=a and status='PENDING') and app_private.office_has('approve',doc)),
   'numbering',count(*) filter(where doc.status='WAITING_NUMBER' and app_private.office_has('issue_number',doc)),
   'assigned',count(*) filter(where doc.status='ISSUED' and doc.assigned_to=a and doc.processing_status<>'COMPLETED'),
   'overdue',count(*) filter(where doc.status='ISSUED' and doc.processing_status in ('RECEIVED','ASSIGNED','IN_PROGRESS') and doc.due_date<current_date),
   'issuedThisMonth',count(*) filter(where doc.issued_at>=date_trunc('month',now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh')) into out
  from public.office_documents doc where app_private.office_can_view(doc.id);
  return out;
 elsif p_query='list' then
  select count(*) into total from app_private.office_filtered(p_params);
  select coalesce(jsonb_agg(q),'[]') into items from (
   select doc.id,doc.title,doc.document_number,doc.source_document_number,doc.document_group,doc.status,doc.processing_status,doc.document_date,doc.issued_at,doc.revoked_at,doc.created_at,doc.urgency,doc.confidentiality,doc.due_date,doc.creator_name,
   t.name type_name,u.name signer_name,o.name department_name,p.name project_name,
   (select read_at from public.office_document_recipients where document_id=doc.id and user_id=a) read_at,
   exists(select 1 from public.office_document_recipients where document_id=doc.id and user_id=a) is_recipient
   from app_private.office_filtered(p_params) doc join public.office_document_types t on t.id=doc.document_type_id
   left join public.users u on u.id=doc.signer_user_id left join public.org_units o on o.id=doc.issuer_department_id left join public.projects p on p.id=doc.project_id
   order by case when p_params->>'sort'='oldest' then doc.created_at end asc,
    case when p_params->>'sort'='title' then doc.title end asc,doc.created_at desc,doc.id desc
   offset page_no*page_size limit page_size
  ) q; return jsonb_build_object('items',items,'total',total);
 elsif p_query in ('detail','recipients','activity') then
  if not app_private.office_can_view((p_params->>'id')::uuid) then raise exception 'OFFICE_NOT_FOUND' using errcode='42501'; end if;
  select * into strict d from public.office_documents where id=(p_params->>'id')::uuid; caps:=app_private.office_capabilities(d.id);
  if p_query='recipients' then
   if not (caps->>'track')::boolean then raise exception 'OFFICE_DENIED'; end if;
   select count(*) into total from public.office_document_recipients where document_id=d.id and (coalesce(p_params->>'filter','all')<>'unread' or read_at is null);
   select coalesce(jsonb_agg(q),'[]') into items from (select r.user_id,u.name,r.delivered_at,r.read_at from public.office_document_recipients r join public.users u on u.id=r.user_id
    where r.document_id=d.id and (coalesce(p_params->>'filter','all')<>'unread' or r.read_at is null) order by u.name,r.user_id offset page_no*page_size limit page_size) q;
   return jsonb_build_object('items',items,'total',total);
  elsif p_query='activity' then
   select coalesce(jsonb_agg(q),'[]') into items from (select id,user_name,description,context,created_at from public.audit_trail where table_name='office_documents' and record_id=d.id::text order by created_at desc,id desc offset page_no*page_size limit page_size) q;
   return items;
  end if;
  return jsonb_build_object('document',to_jsonb(d)-'search_vector','capabilities',caps,
   'typeName',(select name from public.office_document_types where id=d.document_type_id),
   'departmentName',(select name from public.org_units where id=d.issuer_department_id),'projectName',(select name from public.projects where id=d.project_id),
   'signerName',(select name from public.users where id=d.signer_user_id),'assigneeName',(select name from public.users where id=d.assigned_to),
   'attachments',(select coalesce(jsonb_agg(f order by created_at),'[]') from public.office_document_attachments f where document_id=d.id and (status='READY' or ((caps->>'edit')::boolean and status='PENDING'))),
   'approvals',(select coalesce(jsonb_agg(to_jsonb(ap)||jsonb_build_object('name',u.name) order by ap.round desc,ap.step),'[]') from public.office_document_approvals ap join public.users u on u.id=ap.user_id where document_id=d.id),
   'recipientStats',case when (caps->>'track')::boolean then (select jsonb_build_object('total',count(*),'read',count(read_at),'unread',count(*)-count(read_at)) from public.office_document_recipients where document_id=d.id) else null end,
   'bookmark',coalesce((select to_jsonb(b)-'document_id'-'user_id' from public.office_document_bookmarks b where document_id=d.id and user_id=a),'{"favorite":false,"following":false}'));
 else raise exception 'OFFICE_INVALID_QUERY'; end if;
end $$;

create function app_private.office_guard_official_document() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'OFFICE_NO_HARD_DELETE'; end if;
 if old.issued_at is not null or old.document_number is not null then
  if (to_jsonb(new)-array['status','processing_status','assigned_to','collaborator_ids','due_date','processing_instruction','processing_result','received_ack_at','processing_started_at','processing_completed_at','version','updated_at','updated_by','issued_at','revoked_at','archived_at','search_vector'])
   is distinct from (to_jsonb(old)-array['status','processing_status','assigned_to','collaborator_ids','due_date','processing_instruction','processing_result','received_ack_at','processing_started_at','processing_completed_at','version','updated_at','updated_by','issued_at','revoked_at','archived_at','search_vector']) then raise exception 'OFFICE_OFFICIAL_IMMUTABLE'; end if;
 end if;
 return new;
end $$;
create trigger office_protect_official before update or delete on public.office_documents for each row execute function app_private.office_guard_official_document();

-- Read-only Data API tables; all writes go through actor-aware commands.
do $$ declare t text; begin
 foreach t in array array['office_numbering_rules','office_archive_folders','office_approval_workflows','office_document_types','office_documents','office_document_approvals','office_document_recipients','office_document_bookmarks','office_document_attachments','office_document_versions'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
 end loop;
 foreach t in array array['office_numbering_rules','office_archive_folders','office_approval_workflows','office_document_types'] loop
  execute format('create policy office_catalog_read on public.%I for select to authenticated using ((select app_private.office_access()))',t);
 end loop;
end $$;
create policy office_documents_read on public.office_documents for select to authenticated using (app_private.office_can_view(id));
create policy office_approvals_read on public.office_document_approvals for select to authenticated using (app_private.office_can_view(document_id));
create policy office_recipients_read on public.office_document_recipients for select to authenticated using (app_private.office_can_view(document_id) and (user_id=(select public.current_app_user_id()) or (app_private.office_capabilities(document_id)->>'track')::boolean));
create policy office_bookmarks_read on public.office_document_bookmarks for select to authenticated using (user_id=(select public.current_app_user_id()) and app_private.office_can_view(document_id));
create policy office_attachments_read on public.office_document_attachments for select to authenticated using (app_private.office_can_view(document_id) and (status='READY' or (status='PENDING' and (app_private.office_capabilities(document_id)->>'edit')::boolean)));
create policy office_versions_read on public.office_document_versions for select to authenticated using (app_private.office_can_view(document_id) and (app_private.office_capabilities(document_id)->>'track')::boolean);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('office-attachments','office-attachments',false,52428800,array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/jpeg','image/png','image/webp','text/plain','text/csv'])
on conflict(id) do nothing;
create function app_private.office_storage_allowed(p_path text,p_action text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare f public.office_document_attachments; d public.office_documents;
begin
 select * into f from public.office_document_attachments where path=p_path;
 if not found or not app_private.office_can_view(f.document_id) then return false; end if;
 select * into strict d from public.office_documents where id=f.document_id;
 if p_action='read' then return f.status='READY' or (f.status in ('PENDING','REMOVED') and (app_private.office_capabilities(d.id)->>'edit')::boolean); end if;
 if not (app_private.office_capabilities(d.id)->>'edit')::boolean then return false; end if;
 if p_action='insert' then return f.status='PENDING' and f.uploaded_by=public.current_app_user_id(); end if;
 if p_action='delete' then return f.status='REMOVED'; end if;
 return false;
end $$;
create policy office_files_select on storage.objects for select to authenticated using(bucket_id='office-attachments' and app_private.office_storage_allowed(name,'read'));
create policy office_files_insert on storage.objects for insert to authenticated with check(bucket_id='office-attachments' and app_private.office_storage_allowed(name,'insert'));
create policy office_files_delete on storage.objects for delete to authenticated using(bucket_id='office-attachments' and app_private.office_storage_allowed(name,'delete'));
-- Restrictive guards also defeat any older, permissive generic storage policies.
create policy office_files_select_guard on storage.objects as restrictive for select to authenticated using(bucket_id<>'office-attachments' or app_private.office_storage_allowed(name,'read'));
create policy office_files_insert_guard on storage.objects as restrictive for insert to authenticated with check(bucket_id<>'office-attachments' or app_private.office_storage_allowed(name,'insert'));
create policy office_files_update_guard on storage.objects as restrictive for update to authenticated using(bucket_id<>'office-attachments') with check(bucket_id<>'office-attachments');
create policy office_files_delete_guard on storage.objects as restrictive for delete to authenticated using(bucket_id<>'office-attachments' or app_private.office_storage_allowed(name,'delete'));

create function public.office_query(p_query text,p_params jsonb default '{}') returns jsonb language sql stable security invoker set search_path='' as $$select app_private.office_query(p_query,p_params)$$;
create function public.office_command(p_command text,p_document_id uuid,p_payload jsonb,p_expected_version bigint,p_idempotency_key uuid) returns jsonb language sql volatile security invoker set search_path='' as $$select app_private.office_command(p_command,p_document_id,p_payload,p_expected_version,p_idempotency_key)$$;
create function public.office_configure(p_kind text,p_id uuid,p_data jsonb) returns uuid language sql volatile security invoker set search_path='' as $$select app_private.office_configure(p_kind,p_id,p_data)$$;
do $$ declare f record; begin
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.proname like 'office_%' loop
  execute format('revoke all on function %s from public,anon,authenticated',f.sig);
 end loop;
end $$;
grant execute on function app_private.office_access(uuid),app_private.office_can_view(uuid,uuid),app_private.office_capabilities(uuid),app_private.office_storage_allowed(text,text) to authenticated;
grant execute on function app_private.office_query(text,jsonb),public.office_query(text,jsonb),
 app_private.office_command(text,uuid,jsonb,bigint,uuid),public.office_command(text,uuid,jsonb,bigint,uuid),
 app_private.office_configure(text,uuid,jsonb),public.office_configure(text,uuid,jsonb) to authenticated;
