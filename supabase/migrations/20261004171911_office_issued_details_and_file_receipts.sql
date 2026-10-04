-- Add explicit effective date and private download receipts; existing issued content stays immutable.
alter table public.office_documents add column effective_on date;
alter table public.office_documents add constraint office_effective_dates check (effective_on is null or expires_on is null or effective_on <= expires_on);
create table app_private.office_attachment_downloads (
 attachment_id uuid not null references public.office_document_attachments(id),
 document_id uuid not null references public.office_documents(id),
 user_id uuid not null references public.users(id), downloaded_at timestamptz not null default now(),
 primary key(attachment_id,user_id)
);
create index office_download_document_idx on app_private.office_attachment_downloads(document_id,user_id);
create index office_download_user_idx on app_private.office_attachment_downloads(user_id);
alter table app_private.office_attachment_downloads enable row level security;
revoke all on app_private.office_attachment_downloads from public,anon,authenticated;
comment on table app_private.office_attachment_downloads is 'First explicit download after file bytes reach the client. Does not prove a file was saved to the device.';

create function app_private.office_people(p_document_id uuid,p_kind text,p_page int default 0,p_size int default 25) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare d public.office_documents; result jsonb;
begin
 if not app_private.office_can_view(p_document_id) then raise exception 'OFFICE_NOT_FOUND' using errcode='42501'; end if;
 if not (app_private.office_capabilities(p_document_id)->>'track')::boolean then raise exception 'OFFICE_DENIED' using errcode='42501'; end if;
 if p_kind is null or p_kind not in ('recipients','viewers','followers','downloads') then raise exception 'OFFICE_INVALID_QUERY'; end if;
 select * into strict d from public.office_documents where id=p_document_id;
 with people as (
  select r.user_id,case when p_kind='viewers' then r.read_at else r.delivered_at end occurred_at
  from public.office_document_recipients r where r.document_id=d.id and (p_kind='recipients' or (p_kind='viewers' and r.read_at is not null))
  union all
  select u.id,null::timestamptz from public.users u where p_kind='followers' and (u.id=any(d.watcher_ids) or exists(select 1 from public.office_document_bookmarks b where b.document_id=d.id and b.user_id=u.id and b.following))
  union all
  select x.user_id,min(x.downloaded_at) from app_private.office_attachment_downloads x where p_kind='downloads' and x.document_id=d.id group by x.user_id
 ), page as (select p.user_id,u.name,u.username,p.occurred_at from people p join public.users u on u.id=p.user_id order by u.name,p.user_id offset greatest(coalesce(p_page,0),0)*least(greatest(coalesce(p_size,25),1),25) limit least(greatest(coalesce(p_size,25),1),25))
 select jsonb_build_object('total',(select count(*) from people),'items',coalesce((select jsonb_agg(page) from page),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function app_private.office_people(uuid,text,int,int) from public,anon,authenticated;

create or replace function app_private.office_validate_draft(p_doc public.office_documents) returns void
language plpgsql stable security definer set search_path='' as $$
declare t public.office_document_types; spec jsonb; wf public.office_approval_workflows;
begin
 select * into t from public.office_document_types where id=p_doc.document_type_id and is_active;
 if not found or not p_doc.document_group=any(t.groups) then raise exception 'OFFICE_INVALID_TYPE'; end if;
 if p_doc.expires_on is not null and p_doc.expires_on<coalesce(p_doc.effective_on,p_doc.document_date) then raise exception 'OFFICE_INVALID_EXPIRY'; end if;
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

create or replace function app_private.office_command(p_command text,p_document_id uuid,p_payload jsonb,p_expected_version bigint,p_idempotency_key uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
 a uuid:=public.current_app_user_id(); d public.office_documents; prev public.office_documents;
 typ public.office_document_types; wf public.office_approval_workflows; approval public.office_document_approvals;
 att public.office_document_attachments; caps jsonb; prior app_private.office_commands;
 h text:=md5(jsonb_build_array(p_command,p_document_id,p_payload,p_expected_version)::text); result jsonb;
 event text; note text:=nullif(btrim(p_payload->>'reason'),''); step_record record; ids uuid[]; next_user uuid;
 editable_fields text[]:=array['document_group','document_type_id','title','summary','content','document_date','received_date','due_date','issuer_department_id','signer_user_id','signer_position','project_id','construction_site_id','source_organization','source_document_number','source_sender','external_recipient','urgency','confidentiality','archive_folder_id','workflow_id','recipient_specs','watcher_ids','require_acknowledgement','expires_on','effective_on'];
begin
 if not app_private.office_access(a) then raise exception 'OFFICE_DENIED' using errcode='42501'; end if;
 if p_idempotency_key is null or jsonb_typeof(p_payload) is distinct from 'object' or length(coalesce(note,''))>4000 then raise exception 'OFFICE_INVALID_COMMAND'; end if;
 insert into app_private.office_commands(actor_id,key,request_hash) values(a,p_idempotency_key,h) on conflict do nothing;
 select * into strict prior from app_private.office_commands where actor_id=a and key=p_idempotency_key for update;
 if prior.request_hash<>h then raise exception 'OFFICE_IDEMPOTENCY_CONFLICT'; end if;
 if prior.response is not null then return prior.response; end if;
 perform set_config('office.command_key',p_idempotency_key::text,true);
 if p_command='create' then
  if p_payload-editable_fields<>'{}'::jsonb then raise exception 'OFFICE_INVALID_COMMAND'; end if;
  d:=jsonb_populate_record(null::public.office_documents,p_payload);
  d.id:=gen_random_uuid(); d.created_by:=a; d.updated_by:=a; d.creator_name:=(select name from public.users where id=a);
  d.version:=1; d.status:='DRAFT'; d.approval_round:=0; d.created_at:=now(); d.updated_at:=now();
  d.document_date:=coalesce(d.document_date,current_date); d.summary:=coalesce(d.summary,'');
  d.content:=coalesce(d.content,'{"version":1,"type":"doc","content":[]}');
  d.content_text:=app_private.office_validate_content(d.content); d.urgency:=coalesce(d.urgency,'NORMAL'); d.confidentiality:=coalesce(d.confidentiality,'INTERNAL');
  d.require_acknowledgement:=coalesce(d.require_acknowledgement,false);
  d.recipient_specs:=coalesce(d.recipient_specs,'[]'); d.watcher_ids:=coalesce(d.watcher_ids,'{}'); d.collaborator_ids:='{}';
  if not app_private.office_has('create',d) or not app_private.office_has('view',d) then raise exception 'OFFICE_DENIED' using errcode='42501'; end if;
  perform app_private.office_validate_draft(d);
  insert into public.office_documents(require_acknowledgement,expires_on,effective_on,id,document_group,document_type_id,title,summary,content,content_text,status,document_date,received_date,due_date,issuer_department_id,signer_user_id,signer_position,project_id,construction_site_id,source_organization,source_document_number,source_sender,external_recipient,urgency,confidentiality,archive_folder_id,workflow_id,recipient_specs,watcher_ids,collaborator_ids,created_by,updated_by,creator_name,version,approval_round,created_at,updated_at) values(d.require_acknowledgement,d.expires_on,d.effective_on,d.id,d.document_group,d.document_type_id,d.title,d.summary,d.content,d.content_text,d.status,d.document_date,d.received_date,d.due_date,d.issuer_department_id,d.signer_user_id,d.signer_position,d.project_id,d.construction_site_id,d.source_organization,d.source_document_number,d.source_sender,d.external_recipient,d.urgency,d.confidentiality,d.archive_folder_id,d.workflow_id,d.recipient_specs,d.watcher_ids,d.collaborator_ids,d.created_by,d.updated_by,d.creator_name,d.version,d.approval_round,d.created_at,d.updated_at);
  event:='CREATED';
 else
  select * into d from public.office_documents where id=p_document_id for update;
  if not found or not app_private.office_can_view(d.id) then raise exception 'OFFICE_NOT_FOUND' using errcode='42501'; end if;
  prev:=d; caps:=app_private.office_capabilities(d.id);
  if p_command not in ('read','bookmark','confirm_read','download') and p_expected_version is distinct from d.version then raise exception 'OFFICE_VERSION_CONFLICT'; end if;
  if p_command='save' then
   if not (caps->>'edit')::boolean then raise exception 'OFFICE_DENIED' using errcode='42501'; end if;
   if p_payload-editable_fields<>'{}'::jsonb then raise exception 'OFFICE_INVALID_COMMAND'; end if;
   d:=jsonb_populate_record(d,p_payload); d.content_text:=app_private.office_validate_content(d.content);
   perform app_private.office_validate_draft(d);
   if not app_private.office_has('edit',d) or not app_private.office_has('view',d) then raise exception 'OFFICE_DENIED'; end if;
   update public.office_documents set effective_on=d.effective_on,require_acknowledgement=d.require_acknowledgement,expires_on=d.expires_on,document_group=d.document_group,document_type_id=d.document_type_id,title=d.title,summary=d.summary,content=d.content,content_text=d.content_text,
    document_date=d.document_date,received_date=d.received_date,due_date=d.due_date,issuer_department_id=d.issuer_department_id,signer_user_id=d.signer_user_id,signer_position=d.signer_position,
    project_id=d.project_id,construction_site_id=d.construction_site_id,source_organization=d.source_organization,source_document_number=d.source_document_number,source_sender=d.source_sender,external_recipient=d.external_recipient,
    urgency=d.urgency,confidentiality=d.confidentiality,archive_folder_id=d.archive_folder_id,workflow_id=d.workflow_id,recipient_specs=d.recipient_specs,watcher_ids=d.watcher_ids where id=d.id;
   event:='EDITED';
  elsif p_command='submit' then
   if not (caps->>'submit')::boolean then raise exception 'OFFICE_DENIED' using errcode='42501'; end if;
   perform app_private.office_validate_draft(d);
   perform app_private.office_validate_images(d);
   if (d.content::text||d.title||d.summary) ~ '\{\{(?!document_number)[a-z_]+\}\}' then raise exception 'OFFICE_TEMPLATE_UNFILLED'; end if;
   select * into strict typ from public.office_document_types where id=d.document_type_id;
   if btrim(d.content_text)='' and not exists(select 1 from public.office_document_attachments where document_id=d.id and status='READY') then raise exception 'OFFICE_CONTENT_REQUIRED'; end if;
   if not exists(select 1 from app_private.office_resolve_recipients(d.recipient_specs)) then raise exception 'OFFICE_RECIPIENT_REQUIRED'; end if;
   if d.document_group='INCOMING' and (nullif(btrim(d.source_organization),'') is null or d.received_date is null
    or not exists(select 1 from public.office_document_attachments where document_id=d.id and status='READY')) then raise exception 'OFFICE_INCOMING_REQUIRED'; end if;
   if d.document_group='OUTGOING' and nullif(btrim(d.external_recipient),'') is null then raise exception 'OFFICE_EXTERNAL_RECIPIENT_REQUIRED'; end if;
   if not typ.requires_number or d.document_group='INCOMING' then
    d.content:=app_private.office_fill_number(d.content,coalesce(nullif(d.source_document_number,''),'Không áp dụng'));
    d.title:=replace(d.title,'{{document_number}}',coalesce(nullif(d.source_document_number,''),'Không áp dụng'));
    d.summary:=replace(d.summary,'{{document_number}}',coalesce(nullif(d.source_document_number,''),'Không áp dụng'));
    update public.office_documents set content=d.content,content_text=app_private.office_validate_content(d.content),title=d.title,summary=d.summary where id=d.id;
   end if;
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
   d.content:=app_private.office_fill_number(d.content,d.document_number);
   update public.office_documents set content=d.content,content_text=app_private.office_validate_content(d.content),title=replace(d.title,'{{document_number}}',d.document_number),summary=replace(d.summary,'{{document_number}}',d.document_number),document_number=d.document_number,sequence_number=d.sequence_number,number_year=d.number_year,numbered_at=now(),status='APPROVED' where id=d.id;
   event:='NUMBER_ISSUED';
  elsif p_command='publish' then
   if d.expires_on is not null and d.expires_on < (now() at time zone 'Asia/Ho_Chi_Minh')::date then raise exception 'OFFICE_EXPIRED'; end if;
   if not (caps->>'publish')::boolean or (d.requires_number and d.document_number is null) or d.approved_at is null
     or (d.requires_approval and (not exists(select 1 from public.office_document_approvals where document_id=d.id and round=d.approval_round)
       or exists(select 1 from public.office_document_approvals where document_id=d.id and round=d.approval_round and status<>'APPROVED'))) then raise exception 'OFFICE_DENIED' using errcode='42501'; end if;
   select array_agg(user_id) into ids from app_private.office_resolve_recipients(d.recipient_specs);
   if coalesce(cardinality(ids),0)=0 then raise exception 'OFFICE_RECIPIENT_REQUIRED'; end if;
   insert into public.office_document_recipients(document_id,user_id) select d.id,unnest(ids) on conflict do nothing;
   update public.office_documents set status='ISSUED',issued_at=now() where id=d.id;
   if exists(select 1 from unnest(ids) u where not app_private.office_can_view(d.id,u)) then raise exception 'OFFICE_RECIPIENT_INELIGIBLE'; end if;
   insert into public.office_document_distribution(document_id,specs,actor_id) values(d.id,d.recipient_specs,a);
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
  elsif p_command='download' then
   select * into att from public.office_document_attachments where id=(p_payload->>'attachmentId')::uuid and document_id=d.id and status='READY';
   if not found then raise exception 'OFFICE_FILE_NOT_FOUND' using errcode='42501'; end if;
   insert into app_private.office_attachment_downloads(attachment_id,document_id,user_id) values(att.id,d.id,a) on conflict do nothing;
  elsif p_command='add_watchers' then
   if not (caps->>'distribute')::boolean then raise exception 'OFFICE_DENIED' using errcode='42501'; end if;
   if jsonb_typeof(p_payload->'userIds') is distinct from 'array' then raise exception 'OFFICE_INVALID_RECIPIENTS'; end if;
   select array_agg(distinct v::uuid) into ids from jsonb_array_elements_text(p_payload->'userIds') v where not v::uuid=any(d.watcher_ids);
   if coalesce(cardinality(ids),0)=0 then raise exception 'OFFICE_RECIPIENT_REQUIRED'; end if;
   if cardinality(d.watcher_ids)+cardinality(ids)>100 or exists(select 1 from unnest(ids) target(id) where not exists(select 1 from public.users u where u.id=target.id and u.is_active and u.account_status='ACTIVE')) then raise exception 'OFFICE_INVALID_RECIPIENTS'; end if;
   update public.office_documents set watcher_ids=watcher_ids||ids where id=d.id;
   if exists(select 1 from unnest(ids) target(id) where not app_private.office_can_view(d.id,target.id)) then raise exception 'OFFICE_RECIPIENT_INELIGIBLE'; end if;
   event:='WATCHERS_ADDED';
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
  elsif p_command='confirm_read' then
   if not (caps->>'confirm_read')::boolean then raise exception 'OFFICE_DENIED' using errcode='42501'; end if;
   update public.office_document_recipients set read_at=coalesce(read_at,now()),acknowledged_at=now() where document_id=d.id and user_id=a and acknowledged_at is null;
   perform app_private.office_event(d.id,'READ_CONFIRMED',null);
   result:=jsonb_build_object('id',d.id,'version',d.version);
  elsif p_command='cancel' then
   if not (caps->>'cancel')::boolean then raise exception 'OFFICE_DENIED' using errcode='42501'; end if;
   if note is null then raise exception 'OFFICE_REASON_REQUIRED'; end if;
   update public.office_documents set status='CANCELLED' where id=d.id;
   update public.office_document_approvals set status='CANCELLED' where document_id=d.id and status in ('PENDING','WAITING');
   perform app_private.office_notify(d.id,'DOCUMENT_CANCELLED',array(select user_id from public.office_document_approvals where document_id=d.id and round=d.approval_round));
   event:='CANCELLED';
  elsif p_command='add_recipients' then
   if not (caps->>'distribute')::boolean then raise exception 'OFFICE_DENIED' using errcode='42501'; end if;
   if jsonb_typeof(p_payload->'specs') is distinct from 'array' or jsonb_array_length(p_payload->'specs') not between 1 and 100 then raise exception 'OFFICE_INVALID_RECIPIENTS'; end if;
   if exists(select 1 from jsonb_array_elements(p_payload->'specs') s where s->>'type' is null or s->>'type' not in ('company','user','department','factory','project','site','role') or (s->>'type'<>'company' and nullif(s->>'id','') is null)) then raise exception 'OFFICE_INVALID_RECIPIENTS'; end if;
   if not exists(select 1 from app_private.office_resolve_recipients(p_payload->'specs')) then raise exception 'OFFICE_RECIPIENT_REQUIRED'; end if;
   select array_agg(user_id) into ids from app_private.office_resolve_recipients(p_payload->'specs') r
     where not exists(select 1 from public.office_document_recipients where document_id=d.id and user_id=r.user_id);
   insert into public.office_document_recipients(document_id,user_id) select d.id,unnest(coalesce(ids,'{}')) on conflict do nothing;
   if exists(select 1 from unnest(ids) u where not app_private.office_can_view(d.id,u)) then raise exception 'OFFICE_RECIPIENT_INELIGIBLE'; end if;
   insert into public.office_document_distribution(document_id,specs,actor_id) values(d.id,p_payload->'specs',a);
   perform app_private.office_notify(d.id,'DOCUMENT_ISSUED',ids); event:='RECIPIENTS_ADDED';
  elsif p_command in ('link_add','link_remove') then
   if not (caps->>'edit')::boolean then raise exception 'OFFICE_DENIED' using errcode='42501'; end if;
   if p_command='link_add' then
    if p_payload->>'targetType' not in ('document','project','work_task','project_contract') or p_payload->>'relation' not in ('related','replaces','responds_to','implements')
      or (p_payload->>'targetType'='document' and p_payload->>'targetId'=d.id::text)
      or app_private.office_target(p_payload->>'targetType',p_payload->>'targetId') is null then raise exception 'OFFICE_NOT_FOUND' using errcode='42501'; end if;
    insert into public.office_document_links(document_id,target_type,target_id,relation,created_by) values(d.id,p_payload->>'targetType',p_payload->>'targetId',p_payload->>'relation',a) on conflict do nothing;
   else delete from public.office_document_links where document_id=d.id and id=(p_payload->>'linkId')::uuid; end if;
   event:='LINKS_UPDATED';
  else raise exception 'OFFICE_INVALID_COMMAND'; end if;
 end if;
 if event is not null then
  if p_command<>'create' then update public.office_documents set version=version+1,updated_by=a,updated_at=now() where id=d.id; end if;
  select * into strict d from public.office_documents where id=d.id;
  insert into public.office_document_versions(document_id,version,snapshot,actor_id) values(d.id,d.version,(to_jsonb(d)-'search_vector')||jsonb_build_object('attachments',(select coalesce(jsonb_agg(to_jsonb(f) order by f.id),'[]') from public.office_document_attachments f where document_id=d.id and status='READY')),a);
  perform app_private.office_event(d.id,event,note);
  perform app_private.office_notify(d.id,'DOCUMENT_'||event,
    array(select user_id from public.office_document_bookmarks where document_id=d.id and following and user_id<>a)||d.watcher_ids,'watching');
  if d.status='WAITING_NUMBER' then perform app_private.office_notify(d.id,'DOCUMENT_NUMBER_REQUIRED',array(select id from public.users where app_private.office_has('issue_number',d,id))); end if;
 end if;
 result:=coalesce(result,'{}')||jsonb_build_object('id',d.id,'version',d.version,'status',d.status);
 update app_private.office_commands set response=result where actor_id=a and key=p_idempotency_key;
 return result;
end $$;

create or replace function app_private.office_guard_official_document() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'OFFICE_NO_HARD_DELETE'; end if;
 if old.issued_at is not null or old.document_number is not null then
  if (to_jsonb(new)-array['watcher_ids','status','processing_status','assigned_to','collaborator_ids','due_date','processing_instruction','processing_result','received_ack_at','processing_started_at','processing_completed_at','version','updated_at','updated_by','issued_at','revoked_at','archived_at','search_vector'])
   is distinct from (to_jsonb(old)-array['watcher_ids','status','processing_status','assigned_to','collaborator_ids','due_date','processing_instruction','processing_result','received_ack_at','processing_started_at','processing_completed_at','version','updated_at','updated_by','issued_at','revoked_at','archived_at','search_vector']) then raise exception 'OFFICE_OFFICIAL_IMMUTABLE'; end if;
 end if;
 return new;
end $$;

create or replace function app_private.office_query(p_query text,p_params jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a uuid:=public.current_app_user_id(); d public.office_documents; caps jsonb; out jsonb; items jsonb; total bigint;
 page_size int:=least(50,greatest(1,coalesce((p_params->>'pageSize')::int,25))); page_no int:=greatest(0,coalesce((p_params->>'page')::int,0));
begin
 if not app_private.office_access() then raise exception 'OFFICE_DENIED' using errcode='42501'; end if;
 if p_query='people' then return app_private.office_people((p_params->>'id')::uuid,p_params->>'kind',coalesce((p_params->>'page')::int,0),25);
 elsif p_query='catalog' then
  return jsonb_build_object('types',(select coalesce(jsonb_agg(t order by name),'[]') from public.office_document_types t),
   'rules',(select coalesce(jsonb_agg(t order by name),'[]') from public.office_numbering_rules t),
   'workflows',(select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('stepNames',(select jsonb_object_agg(u.id,u.name) from public.users u where u.id in (select (s->>'userId')::uuid from jsonb_array_elements(t.steps) s)))),'[]') from public.office_approval_workflows t),
   'folders',(select coalesce(jsonb_agg(t order by name),'[]') from public.office_archive_folders t),
   'canConfigure',app_private.has_permission(a,'office.configuration.manage','global','*'),
   'canCreate',exists(select 1 from app_private.resolve_effective_permission_sources(a,'office.document.create',null,null,now())),
   'actorId',a,'actorName',(select name from public.users where id=a));
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
  from app_private.office_visible_documents() doc;
  return out;
 elsif p_query='list' then
  select count(*) into total from app_private.office_filtered(p_params);
  select coalesce(jsonb_agg(q),'[]') into items from (
   select doc.id,doc.title,doc.document_number,doc.source_document_number,doc.document_group,app_private.office_effective_status(doc) status,doc.processing_status,doc.document_date,doc.issued_at,doc.revoked_at,doc.created_at,doc.urgency,doc.confidentiality,doc.due_date,doc.creator_name,
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
   select count(*) into total from public.office_document_recipients where document_id=d.id and (coalesce(p_params->>'filter','all')<>'unread' or read_at is null) and (coalesce(p_params->>'filter','all')<>'unconfirmed' or acknowledged_at is null);
   select coalesce(jsonb_agg(q),'[]') into items from (select r.user_id,u.name,r.delivered_at,r.read_at,r.acknowledged_at from public.office_document_recipients r join public.users u on u.id=r.user_id
    where r.document_id=d.id and (coalesce(p_params->>'filter','all')<>'unread' or r.read_at is null) and (coalesce(p_params->>'filter','all')<>'unconfirmed' or r.acknowledged_at is null) order by u.name,r.user_id offset page_no*page_size limit page_size) q;
   return jsonb_build_object('items',items,'total',total);
  elsif p_query='activity' then
   select coalesce(jsonb_agg(q),'[]') into items from (select id,user_name,description,context,created_at from public.audit_trail where table_name='office_documents' and record_id=d.id::text order by created_at desc,id desc offset page_no*page_size limit page_size) q;
   return items;
  end if;
  return jsonb_build_object('document',(to_jsonb(d)-'search_vector')||jsonb_build_object('status',app_private.office_effective_status(d)),'receipt',(select jsonb_build_object('read_at',read_at,'acknowledged_at',acknowledged_at) from public.office_document_recipients where document_id=d.id and user_id=a),'distribution',(select coalesce(jsonb_agg(jsonb_build_object('created_at',x.created_at,'sender',u.name,'specs',app_private.office_audience_labels(x.specs)) order by x.created_at),'[]') from public.office_document_distribution x join public.users u on u.id=x.actor_id where x.document_id=d.id),'capabilities',caps,
   'issuedByName',(select u.name from public.office_document_distribution x join public.users u on u.id=x.actor_id where x.document_id=d.id order by x.created_at,x.id limit 1),
   'peoplePreview',case when (caps->>'track')::boolean then jsonb_build_object('recipients',app_private.office_people(d.id,'recipients',0,4),'viewers',app_private.office_people(d.id,'viewers',0,4),'followers',app_private.office_people(d.id,'followers',0,4),'downloads',app_private.office_people(d.id,'downloads',0,4)) else null end,
   'typeName',(select name from public.office_document_types where id=d.document_type_id),
   'departmentName',(select name from public.org_units where id=d.issuer_department_id),'projectName',(select name from public.projects where id=d.project_id),
   'siteName',(select name from public.hrm_construction_sites where id=d.construction_site_id),
   'signerName',(select name from public.users where id=d.signer_user_id),'assigneeName',(select name from public.users where id=d.assigned_to),
   'attachments',(select coalesce(jsonb_agg(f order by created_at),'[]') from public.office_document_attachments f where document_id=d.id and (status='READY' or ((caps->>'edit')::boolean and status='PENDING'))),
   'approvals',(select coalesce(jsonb_agg(to_jsonb(ap)||jsonb_build_object('name',u.name) order by ap.round desc,ap.step),'[]') from public.office_document_approvals ap join public.users u on u.id=ap.user_id where document_id=d.id),
   'recipientStats',case when (caps->>'track')::boolean then (select jsonb_build_object('total',count(*),'read',count(read_at),'unread',count(*)-count(read_at),'acknowledged',count(acknowledged_at)) from public.office_document_recipients where document_id=d.id) else null end,
   'pendingRecipientSpecs',app_private.office_audience_labels(d.recipient_specs),
   'bookmark',coalesce((select to_jsonb(b)-'document_id'-'user_id' from public.office_document_bookmarks b where document_id=d.id and user_id=a),'{"favorite":false,"following":false}'));
 else return app_private.office_extended_query(p_query,p_params); end if;
end $$;
