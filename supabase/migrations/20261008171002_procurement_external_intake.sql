-- CLI-created 2026-10-05, ordered after the repository's future-dated dependencies.
-- Intake only: preserve free-form approved rows; do not invent catalog IDs, units or approved quantities.
create table app_private.procurement_source_routes (
 source_type text not null check(source_type in ('request','workflow')),
 template_id uuid not null,
 table_field text not null,
 columns jsonb not null check(jsonb_typeof(columns)='array'),
 notes_field text,
 enabled_at timestamptz not null default now(),
 primary key(source_type,template_id)
);
create table app_private.procurement_source_receipts (
 source_type text not null check(source_type in ('request','workflow')),
 source_id uuid not null,
 template_id uuid not null,
 revision integer not null default 1 check(revision>0),
 state text not null check(state in ('received','withdrawn')),
 document jsonb not null,
 snapshot jsonb not null,
 received_at timestamptz not null default now(),
 withdrawn_reason text,
 withdrawn_at timestamptz,
 assignee_id uuid references public.users(id),
 assigned_at timestamptz,
 assignment_note text,
 closed_at timestamptz,
 closed_by uuid references public.users(id),
 close_reason text,
 primary key(source_type,source_id)
);
create table app_private.procurement_source_versions (
 source_type text not null,
 source_id uuid not null,
 revision integer not null,
 snapshot jsonb not null,
 received_at timestamptz not null default now(),
 primary key(source_type,source_id,revision),
 foreign key(source_type,source_id) references app_private.procurement_source_receipts(source_type,source_id)
);
alter table app_private.procurement_source_routes enable row level security;
alter table app_private.procurement_source_receipts enable row level security;
alter table app_private.procurement_source_versions enable row level security;
revoke all on app_private.procurement_source_routes,app_private.procurement_source_receipts,app_private.procurement_source_versions from public,anon,authenticated;
create index procurement_source_receipts_open on app_private.procurement_source_receipts(source_type,received_at) where state='received' and closed_at is null;
create index procurement_source_receipts_assignee on app_private.procurement_source_receipts(assignee_id) where assignee_id is not null;

create function app_private.procurement_capture_source() returns trigger
language plpgsql security definer set search_path='' as $$
declare src text:=case tg_table_name when 'request_instances' then 'request' else 'workflow' end;
 old_data jsonb:=to_jsonb(old); data jsonb; cfg app_private.procurement_source_routes;
 existing app_private.procurement_source_receipts; tid uuid; final_status text; actor uuid:=public.current_app_user_id();
 cols jsonb; raw_rows jsonb; rows jsonb:='[]'; row_value jsonb; cells jsonb; ordinal integer:=0;
 doc jsonb; snap jsonb; why text; next_revision integer;
begin
 data:=case when tg_op='DELETE' then old_data else to_jsonb(new) end;
 select * into existing from app_private.procurement_source_receipts where source_type=src and source_id=(data->>'id')::uuid for update;
 tid:=nullif(data->>case when src='request' then 'request_template_id' else 'template_id' end,'')::uuid;
 final_status:=case src when 'request' then 'APPROVED' else 'COMPLETED' end;
 select * into cfg from app_private.procurement_source_routes where source_type=src and template_id=tid;
 if tg_op='DELETE' or data->>'status' is distinct from final_status or nullif(data->>'deleted_at','') is not null or cfg.template_id is null
    or (existing.source_id is not null and existing.template_id is distinct from tid)
    or (old_data->>'status'=final_status and data->'form_data' is distinct from old_data->'form_data') then
  if existing.source_id is not null and existing.state='received' then
   why:=case when tg_op='DELETE' or nullif(data->>'deleted_at','') is not null then 'Phiếu nguồn đã bị xóa.'
    when data->>'status' is distinct from final_status then 'Phiếu nguồn không còn ở trạng thái đã duyệt hoàn tất.'
    else 'Nội dung hoặc mẫu nguồn đã thay đổi; cần duyệt lại.' end;
   update app_private.procurement_source_receipts set state='withdrawn',withdrawn_reason=why,withdrawn_at=now() where source_type=src and source_id=existing.source_id;
   insert into public.procurement_hub_events(entity_type,entity_id,action,actor_id,reason,payload)
   values('need',src||':'||existing.source_id,'source_withdrawn',actor,why,jsonb_build_object('revision',existing.revision));
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
 end if;
 -- No backfill: unchanged historical APPROVED/COMPLETED rows do not enter the inbox.
 if old_data->>'status'=final_status then return new; end if;
 cols:=cfg.columns;
 raw_rows:=data->'form_data'->cfg.table_field;
 if jsonb_typeof(raw_rows)='array' then
  for row_value in select value from jsonb_array_elements(raw_rows) loop
   ordinal:=ordinal+1;
   if jsonb_typeof(row_value)='object' then
    select jsonb_agg(coalesce(row_value->>c.value,'') order by c.ord) into cells from jsonb_array_elements_text(cols) with ordinality c(value,ord);
   elsif jsonb_typeof(row_value)='array' then
    select jsonb_agg(coalesce(row_value->>(c.ord::integer-1),'') order by c.ord) into cells from jsonb_array_elements_text(cols) with ordinality c(value,ord);
   else cells:=jsonb_build_array(coalesce(row_value#>>'{}','')); end if;
   rows:=rows||jsonb_build_array(jsonb_build_object('id',(data->>'id')||':'||ordinal,'cells',cells));
  end loop;
 end if;
 if src='workflow' then
  select acted_by into actor from public.workflow_instance_logs where instance_id=(data->>'id')::uuid and action::text='APPROVED' and node_id=nullif(old_data->>'current_node_id','')::uuid
   order by created_at desc,id desc limit 1;
  actor:=coalesce(actor,public.current_app_user_id());
 end if;
 next_revision:=coalesce(existing.revision,0)+1;
 doc:=jsonb_build_object('sourceType',src,'sourceId',data->>'id','code',data->>'code','title',data->>'title',
 'requesterName',(select name from public.users where id=(data->>'created_by')::uuid),
 'approvedAt',now(),'approvedByName',(select name from public.users where id=actor),'createdAt',data->'created_at',
 'projectId',null,'projectCode',null,'projectName',null,'constructionSiteId',null,'warehouseId',null,'warehouseName',null,
 'neededDate',null,'periodType',null,'periodStart',null,'lineCount',jsonb_array_length(rows),
 'orderedLines',0,'partialLines',0,'receivedLines',0,'orderable',false);
 snap:=jsonb_build_object('columns',cols,'rows',rows,'notes',concat_ws(E'\n',nullif(data->'form_data'->>'bộ_phận_công_trường',''),case when nullif(data->'form_data'->>'ngày_cần_dự_kiến','') is not null then 'Ngày cần dự kiến: '||(data->'form_data'->>'ngày_cần_dự_kiến') end,coalesce(nullif(data->'form_data'->>cfg.notes_field,''),data->>'description')),
 'revision',next_revision,'sourceVersionId',coalesce(data->>'request_template_version_id',data->>'template_version_id'));
 insert into app_private.procurement_source_receipts(source_type,source_id,template_id,revision,state,document,snapshot)
 values(src,(data->>'id')::uuid,tid,next_revision,'received',doc,snap)
 on conflict(source_type,source_id) do update set template_id=excluded.template_id,revision=excluded.revision,state='received',
 document=excluded.document,snapshot=excluded.snapshot,received_at=now(),withdrawn_reason=null,withdrawn_at=null,closed_at=null,closed_by=null,close_reason=null;
 insert into app_private.procurement_source_versions(source_type,source_id,revision,snapshot) values(src,(data->>'id')::uuid,next_revision,jsonb_build_object('document',doc,'sourceSnapshot',snap));
 insert into public.procurement_hub_events(entity_type,entity_id,action,actor_id,payload)
 values('need',src||':'||(data->>'id'),'source_received',actor,jsonb_build_object('revision',next_revision,'templateId',tid,'lineCount',jsonb_array_length(rows)));
 return new;
end $$;
revoke all on function app_private.procurement_capture_source() from public,anon,authenticated;
create trigger procurement_request_intake after update or delete on public.request_instances for each row execute function app_private.procurement_capture_source();
create trigger procurement_workflow_intake after update or delete on public.workflow_instances for each row execute function app_private.procurement_capture_source();

create function app_private.procurement_receipt_document(r app_private.procurement_source_receipts) returns jsonb
language sql stable set search_path='' as $$
 select r.document||jsonb_build_object('sourceRevision',r.revision,'intakeState',r.state,
 'progress',case when r.state='withdrawn' or r.closed_at is not null then 'closed' else 'new' end,
 'closedAt',case when r.state='withdrawn' then coalesce(r.withdrawn_at,r.closed_at,r.received_at) else r.closed_at end,
 'closeReason',coalesce(r.withdrawn_reason,r.close_reason),'closedByName',(select name from public.users where id=r.closed_by),
 'assigneeUserId',r.assignee_id,'assigneeName',(select name from public.users where id=r.assignee_id));
$$;
revoke all on function app_private.procurement_receipt_document(app_private.procurement_source_receipts) from public,anon,authenticated;

-- Preserve legacy inbox and ordering implementations. New invoker RPCs dispatch through guarded private functions.
alter function public.list_procurement_inbox_v1(jsonb) rename to procurement_legacy_list_v1;
alter function public.procurement_legacy_list_v1(jsonb) set schema app_private;
alter function public.get_procurement_inbox_document_v1(text,text) rename to procurement_legacy_get_v1;
alter function public.procurement_legacy_get_v1(text,text) set schema app_private;
alter function public.assign_procurement_inbox_v1(jsonb) rename to procurement_legacy_assign_v1;
alter function public.procurement_legacy_assign_v1(jsonb) set schema app_private;
alter function public.close_procurement_need_v1(jsonb) rename to procurement_legacy_close_v1;
alter function public.procurement_legacy_close_v1(jsonb) set schema app_private;
alter function public.save_procurement_hub_po_v1(jsonb) rename to procurement_legacy_save_po_v1;
alter function public.procurement_legacy_save_po_v1(jsonb) set schema app_private;
revoke all on function app_private.procurement_legacy_list_v1(jsonb),app_private.procurement_legacy_get_v1(text,text),app_private.procurement_legacy_assign_v1(jsonb),app_private.procurement_legacy_close_v1(jsonb),app_private.procurement_legacy_save_po_v1(jsonb) from public,anon,authenticated;

create function app_private.procurement_bridge_list(p_filter jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare base jsonb; extra jsonb; counts jsonb; active_n integer; unassigned_n integer; f jsonb:=coalesce(p_filter,'{}');
begin
 if not app_private.procurement_can('view') then raise exception 'PROCUREMENT_VIEW_DENIED' using errcode='42501'; end if;
 base:=app_private.procurement_legacy_list_v1(f);
 select coalesce(jsonb_agg(doc order by doc->>'approvedAt'),'[]') into extra from (
  select app_private.procurement_receipt_document(r) doc from app_private.procurement_source_receipts r
 ) d where (nullif(f->>'source','') is null or doc->>'sourceType'=f->>'source')
 and nullif(f->>'projectId','') is null
 and (nullif(f->>'assigneeId','') is null or (f->>'assigneeId'='none' and doc->>'assigneeUserId' is null) or doc->>'assigneeUserId'=f->>'assigneeId')
 and (coalesce(f->>'progress','open')='all' or (coalesce(f->>'progress','open')='open' and doc->>'progress'='new') or doc->>'progress'=f->>'progress')
 and (nullif(f->>'search','') is null or lower(concat_ws(' ',doc->>'code',doc->>'title',doc->>'requesterName')) like '%'||lower(f->>'search')||'%');
 select count(*),count(*) filter(where assignee_id is null) into active_n,unassigned_n from app_private.procurement_source_receipts where state='received' and closed_at is null;
 select jsonb_build_object('request',count(*) filter(where source_type='request'),'workflow',count(*) filter(where source_type='workflow')) into counts
 from app_private.procurement_source_receipts where state='received' and closed_at is null;
 return base||jsonb_build_object('documents',(base->'documents')||extra,'sourceCounts',(base->'sourceCounts')||counts,
 'stages',(base->'stages')||jsonb_build_object('intake',(base->'stages'->>'intake')::integer+active_n,'unassigned',(base->'stages'->>'unassigned')::integer+unassigned_n));
end $$;
create function app_private.procurement_bridge_get(p_source_type text,p_source_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r app_private.procurement_source_receipts;
begin
 if not app_private.procurement_can('view') then raise exception 'PROCUREMENT_VIEW_DENIED' using errcode='42501'; end if;
 if p_source_type not in ('request','workflow') then return app_private.procurement_legacy_get_v1(p_source_type,p_source_id); end if;
 select * into r from app_private.procurement_source_receipts where source_type=p_source_type and source_id::text=p_source_id;
 if not found then raise exception 'PROCUREMENT_SOURCE_NOT_FOUND' using errcode='PT404'; end if;
 return app_private.procurement_receipt_document(r)||jsonb_build_object('lines','[]'::jsonb,
 'sourceSnapshot',r.snapshot||jsonb_build_object('withdrawnReason',r.withdrawn_reason),
 'closure',case when r.closed_at is not null or r.state='withdrawn' then jsonb_build_object('closedAt',coalesce(r.withdrawn_at,r.closed_at,r.received_at),'reason',coalesce(r.withdrawn_reason,r.close_reason),'closedByName',(select name from public.users where id=r.closed_by)) end,
 'assignment',case when r.assigned_at is not null then jsonb_build_object('assigneeUserId',r.assignee_id,'assigneeName',(select name from public.users where id=r.assignee_id),'assignedAt',r.assigned_at,'note',r.assignment_note) end);
end $$;
create function app_private.procurement_bridge_mutate(p_input jsonb,p_operation text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare refs jsonb:=p_input->'sources'; legacy jsonb; s jsonb; r app_private.procurement_source_receipts;
 actor uuid:=public.current_app_user_id(); assignee uuid:=nullif(p_input->>'assigneeUserId','')::uuid;
 n integer:=0; result jsonb:='{}'; action text:=coalesce(p_input->>'action','close'); reason text:=nullif(btrim(p_input->>'reason'),'');
begin
 if not app_private.procurement_can('manage') then raise exception 'PROCUREMENT_MANAGE_DENIED' using errcode='42501'; end if;
 if p_operation not in ('assign','close') or p_operation is null then raise exception 'PROCUREMENT_ACTION_INVALID'; end if;
 if jsonb_typeof(refs) is distinct from 'array' or jsonb_array_length(refs)=0 then raise exception 'PROCUREMENT_SOURCES_REQUIRED'; end if;
 if exists(select 1 from jsonb_array_elements(refs) ref(value) where jsonb_typeof(ref.value) is distinct from 'object' or coalesce(ref.value->>'sourceType','') not in ('request','workflow','material_request','material_plan') or nullif(ref.value->>'sourceId','') is null) then raise exception 'PROCUREMENT_SOURCE_NOT_FOUND'; end if;
 if p_operation='assign' and assignee is not null and not exists(select 1 from public.users where id=assignee and is_active and account_status='ACTIVE' and app_private.has_permission(id,'system.procurement.manage')) then raise exception 'PROCUREMENT_ASSIGNEE_INVALID'; end if;
 if p_operation='close' and action not in ('close','reopen') then raise exception 'PROCUREMENT_ACTION_INVALID'; end if;
 if p_operation='close' and action='close' and reason is null then raise exception 'PROCUREMENT_CLOSE_REASON_REQUIRED'; end if;
 select coalesce(jsonb_agg(value),'[]') into legacy from jsonb_array_elements(refs) where value->>'sourceType' not in ('request','workflow');
 if jsonb_array_length(legacy)>0 then
  if p_operation='assign' then result:=app_private.procurement_legacy_assign_v1(p_input||jsonb_build_object('sources',legacy));
  else result:=app_private.procurement_legacy_close_v1(p_input||jsonb_build_object('sources',legacy)); end if;
 end if;
 for s in select distinct value from jsonb_array_elements(refs) where value->>'sourceType' in ('request','workflow') order by value loop
  select * into r from app_private.procurement_source_receipts where source_type=s->>'sourceType' and source_id::text=s->>'sourceId' for update;
  if not found then raise exception 'PROCUREMENT_SOURCE_NOT_FOUND'; end if;
  if r.state='withdrawn' then raise exception 'PROCUREMENT_SOURCE_WITHDRAWN'; end if;
  if p_operation='assign' then
   update app_private.procurement_source_receipts set assignee_id=assignee,assigned_at=now(),assignment_note=nullif(btrim(p_input->>'note'),'') where source_type=r.source_type and source_id=r.source_id;
  elsif action='close' then
   update app_private.procurement_source_receipts set closed_at=now(),closed_by=actor,close_reason=reason where source_type=r.source_type and source_id=r.source_id;
  else
   update app_private.procurement_source_receipts set closed_at=null,closed_by=null,close_reason=null where source_type=r.source_type and source_id=r.source_id;
  end if;
  insert into public.procurement_hub_events(entity_type,entity_id,action,actor_id,reason,payload)
  values('need',r.source_type||':'||r.source_id,case when p_operation='assign' then 'assign' else action end,actor,reason,jsonb_build_object('revision',r.revision,'assigneeId',assignee));
  n:=n+1;
 end loop;
 if p_operation='assign' and n>0 and assignee is not null and assignee is distinct from actor then
  insert into public.notifications(user_id,type,category,title,message,body,severity,icon,link,source_type,source_id,priority,push_enabled,metadata,delivery_reason)
  values(assignee::text,'info','procurement','Bạn được giao xử lý nhu cầu mua',n||' phiếu đã duyệt từ module được giao cho bạn.',n||' phiếu đã duyệt từ module được giao cho bạn.','info','🛒','/#/procurement','procurement_inbox_assigned','procurement_assign:'||gen_random_uuid(),'normal',true,jsonb_build_object('sources',refs),'assigned');
 end if;
 if p_operation='assign' then return jsonb_build_object('assigned',coalesce((result->>'assigned')::integer,0)+n); end if;
 return result||jsonb_build_object('changed',coalesce((result->>'changed')::integer,0)+n);
end $$;
create function app_private.procurement_bridge_save_po(p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not app_private.procurement_can('manage') then raise exception 'PROCUREMENT_MANAGE_DENIED' using errcode='42501'; end if;
 if exists(select 1 from jsonb_array_elements(p_input->'items') i cross join lateral jsonb_array_elements(i->'allocations') a where a->>'sourceType' in ('request','workflow')) then raise exception 'PROCUREMENT_SOURCE_REVIEW_REQUIRED'; end if;
 return app_private.procurement_legacy_save_po_v1(p_input);
end $$;

create function public.list_procurement_inbox_v1(p_filter jsonb default '{}') returns jsonb language sql stable set search_path='' as $$ select app_private.procurement_bridge_list(p_filter); $$;
create function public.get_procurement_inbox_document_v1(p_source_type text,p_source_id text) returns jsonb language sql stable set search_path='' as $$ select app_private.procurement_bridge_get(p_source_type,p_source_id); $$;
create function public.assign_procurement_inbox_v1(p_input jsonb) returns jsonb language sql set search_path='' as $$ select app_private.procurement_bridge_mutate(p_input,'assign'); $$;
create function public.close_procurement_need_v1(p_input jsonb) returns jsonb language sql set search_path='' as $$ select app_private.procurement_bridge_mutate(p_input,'close'); $$;
create function public.save_procurement_hub_po_v1(p_input jsonb) returns jsonb language sql set search_path='' as $$ select app_private.procurement_bridge_save_po(p_input); $$;
revoke all on function app_private.procurement_bridge_list(jsonb),app_private.procurement_bridge_get(text,text),app_private.procurement_bridge_mutate(jsonb,text),app_private.procurement_bridge_save_po(jsonb),public.list_procurement_inbox_v1(jsonb),public.get_procurement_inbox_document_v1(text,text),public.assign_procurement_inbox_v1(jsonb),public.close_procurement_need_v1(jsonb),public.save_procurement_hub_po_v1(jsonb) from public,anon;
grant execute on function app_private.procurement_bridge_list(jsonb),app_private.procurement_bridge_get(text,text),app_private.procurement_bridge_mutate(jsonb,text),app_private.procurement_bridge_save_po(jsonb),public.list_procurement_inbox_v1(jsonb),public.get_procurement_inbox_document_v1(text,text),public.assign_procurement_inbox_v1(jsonb),public.close_procurement_need_v1(jsonb),public.save_procurement_hub_po_v1(jsonb) to authenticated;

-- Only newly approved transitions after activation. No historical request/instance updates.
insert into app_private.procurement_source_routes(source_type,template_id,table_field,columns)
select 'request',id,'bang_ke_de_xuat','["TÊN THẾT BỊ","ĐVT","SỐ LƯỢNG","ĐƠN GIÁ","THÀNH TIỀN","NGÀY CẦN","GHI CHÚ"]'::jsonb
from public.request_templates where id='444f2d55-63fd-4dee-836f-698ff6a10b26' and name='Đề xuất cấp phát thiết bị văn phòng';
insert into app_private.procurement_source_routes(source_type,template_id,table_field,columns,notes_field)
select 'workflow',id,'bảng_đề_xuất_vật_tư','["Tên vật tư","ĐVT Theo BVTC","Lũy kế KL đã cấp","SL đề xuất đợt này","SL Phê duyệt","Ngày cần (dự kiến)","Mục đích sử dụng","SL tồn kho","Ghi chú"]'::jsonb,'mục_đích_cấp_vật_tư'
from public.workflow_templates where id='5bdb1593-765b-4013-b458-0c05f155631b' and name='CT Sơn MB - Kết Cấu';
