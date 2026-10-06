-- Vioo Office: người soạn chọn phần số của mã văn bản (chủ SP duyệt 06/10/2026, cách 1).
-- Form gợi ý số tiếp theo; số người soạn chọn lưu ở proposed_sequence và chỉ chính thức khi
-- người có quyền bấm Cấp số. Số đã dùng → OFFICE_NUMBER_TAKEN. Để trống → cấp tự động như cũ.
-- office_command dưới đây là bản đang chạy trên Cloud, chỉ thêm proposed_sequence và nhánh Cấp số.

alter table public.office_documents add column if not exists proposed_sequence integer;
alter table public.office_documents drop constraint if exists office_documents_proposed_sequence_check;
alter table public.office_documents add constraint office_documents_proposed_sequence_check
  check (proposed_sequence is null or proposed_sequence between 1 and 999999);

CREATE OR REPLACE FUNCTION app_private.office_command(p_command text, p_document_id uuid, p_payload jsonb, p_expected_version bigint, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 a uuid:=public.current_app_user_id(); d public.office_documents; prev public.office_documents;
 typ public.office_document_types; wf public.office_approval_workflows; approval public.office_document_approvals;
 att public.office_document_attachments; caps jsonb; prior app_private.office_commands;
 h text:=md5(jsonb_build_array(p_command,p_document_id,p_payload,p_expected_version)::text); result jsonb;
 event text; note text:=nullif(btrim(p_payload->>'reason'),''); step_record record; ids uuid[]; next_user uuid;
 editable_fields text[]:=array['document_group','document_type_id','title','summary','content','document_date','received_date','due_date','issuer_department_id','signer_user_id','signer_position','project_id','construction_site_id','source_organization','source_document_number','source_sender','external_recipient','urgency','confidentiality','archive_folder_id','workflow_id','recipient_specs','watcher_ids','require_acknowledgement','expires_on','effective_on','proposed_sequence'];
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
  insert into public.office_documents(proposed_sequence,require_acknowledgement,expires_on,effective_on,id,document_group,document_type_id,title,summary,content,content_text,status,document_date,received_date,due_date,issuer_department_id,signer_user_id,signer_position,project_id,construction_site_id,source_organization,source_document_number,source_sender,external_recipient,urgency,confidentiality,archive_folder_id,workflow_id,recipient_specs,watcher_ids,collaborator_ids,created_by,updated_by,creator_name,version,approval_round,created_at,updated_at) values(d.proposed_sequence,d.require_acknowledgement,d.expires_on,d.effective_on,d.id,d.document_group,d.document_type_id,d.title,d.summary,d.content,d.content_text,d.status,d.document_date,d.received_date,d.due_date,d.issuer_department_id,d.signer_user_id,d.signer_position,d.project_id,d.construction_site_id,d.source_organization,d.source_document_number,d.source_sender,d.external_recipient,d.urgency,d.confidentiality,d.archive_folder_id,d.workflow_id,d.recipient_specs,d.watcher_ids,d.collaborator_ids,d.created_by,d.updated_by,d.creator_name,d.version,d.approval_round,d.created_at,d.updated_at);
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
   update public.office_documents set proposed_sequence=d.proposed_sequence,effective_on=d.effective_on,require_acknowledgement=d.require_acknowledgement,expires_on=d.expires_on,document_group=d.document_group,document_type_id=d.document_type_id,title=d.title,summary=d.summary,content=d.content,content_text=d.content_text,
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
   if d.proposed_sequence is not null then
    -- Người soạn chọn số: chỉ chính thức tại đây; số đã dùng thì báo để chọn số khác.
    if exists(select 1 from public.office_documents o where o.id<>d.id and o.numbering_rule_id=d.numbering_rule_id
      and o.document_type_id=d.document_type_id and o.number_year=d.number_year and o.sequence_number=d.proposed_sequence) then
     raise exception 'OFFICE_NUMBER_TAKEN';
    end if;
    d.sequence_number:=d.proposed_sequence;
    insert into app_private.office_number_sequences(rule_id,type_id,year,last_value) values(d.numbering_rule_id,d.document_type_id,d.number_year,d.sequence_number)
    on conflict(rule_id,type_id,year) do update set last_value=greatest(app_private.office_number_sequences.last_value,excluded.last_value);
   else
    insert into app_private.office_number_sequences(rule_id,type_id,year,last_value) values(d.numbering_rule_id,d.document_type_id,d.number_year,1)
    on conflict(rule_id,type_id,year) do update set last_value=app_private.office_number_sequences.last_value+1 returning last_value into d.sequence_number;
   end if;
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
end $function$;

-- Gợi ý số cho form: số tiếp theo của sổ (theo loại, năm hiện tại) và số người soạn gõ đã dùng chưa.
create or replace function public.office_number_suggestion_v1(
  p_document_type_id uuid,
  p_sequence integer default null,
  p_document_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  a uuid := public.current_app_user_id();
  typ public.office_document_types;
  rule public.office_numbering_rules;
  y integer := extract(year from now() at time zone 'Asia/Ho_Chi_Minh');
  next_value integer;
  taken public.office_documents;
begin
  if not app_private.office_access(a) then raise exception 'OFFICE_DENIED' using errcode = '42501'; end if;
  select * into typ from public.office_document_types where id = p_document_type_id;
  if not found then raise exception 'OFFICE_NOT_FOUND' using errcode = '42501'; end if;
  select * into rule from public.office_numbering_rules where id = typ.numbering_rule_id and is_active;
  if not typ.requires_number or rule.id is null then
    return jsonb_build_object('requiresNumber', false);
  end if;
  select greatest(
    coalesce((select s.last_value from app_private.office_number_sequences s
      where s.rule_id = rule.id and s.type_id = typ.id and s.year = y), 0),
    coalesce((select max(o.sequence_number) from public.office_documents o
      where o.numbering_rule_id = rule.id and o.document_type_id = typ.id and o.number_year = y), 0)
  ) + 1 into next_value;
  if p_sequence is not null then
    select * into taken from public.office_documents o
    where o.numbering_rule_id = rule.id and o.document_type_id = typ.id and o.number_year = y
      and o.sequence_number = p_sequence and o.id is distinct from p_document_id
    limit 1;
  end if;
  return jsonb_build_object(
    'requiresNumber', true, 'year', y, 'code', typ.code, 'format', rule.format, 'ruleName', rule.name,
    'next', next_value, 'taken', taken.id is not null, 'takenNumber', taken.document_number,
    -- chỉ lộ tiêu đề văn bản đang giữ số nếu người hỏi được xem văn bản đó
    'takenTitle', case when taken.id is not null and app_private.office_can_view(taken.id, a) then taken.title end
  );
end;
$function$;

revoke all on function public.office_number_suggestion_v1(uuid, integer, uuid) from public, anon;
grant execute on function public.office_number_suggestion_v1(uuid, integer, uuid) to authenticated, service_role;
