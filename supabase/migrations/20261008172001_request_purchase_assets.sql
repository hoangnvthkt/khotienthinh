-- Versioned Request purchasing contract; no backfill of approved requests.
create table app_private.request_purchase_po_links (
 id uuid primary key default gen_random_uuid(), request_id uuid not null references public.request_instances(id),
 revision integer not null, line_id text not null, purchase_order_id text not null unique references public.purchase_orders(id) on delete cascade,
 po_line_id text not null, item_id text not null references public.items(id), qty numeric not null check(qty>0),
 kind text not null check(kind in ('asset','material')), warehouse_id text not null references public.warehouses(id),
 category_id text references public.asset_categories(id), recipient_id uuid references public.users(id),
 idempotency_key text not null unique, created_by uuid not null references public.users(id), created_at timestamptz not null default now()
);
create index request_purchase_po_links_source_idx on app_private.request_purchase_po_links(request_id,revision,line_id);
alter table app_private.request_purchase_po_links enable row level security;
revoke all on app_private.request_purchase_po_links from public, anon, authenticated;
create table app_private.request_purchase_assets (
 asset_id text primary key references public.assets(id), link_id uuid not null references app_private.request_purchase_po_links(id),
 delivery_line_id uuid not null references public.purchase_order_delivery_lines(id), ordinal integer not null,
 created_at timestamptz not null default now(), unique(delivery_line_id,ordinal)
);
create index request_purchase_assets_link_idx on app_private.request_purchase_assets(link_id);
alter table app_private.request_purchase_assets enable row level security;
revoke all on app_private.request_purchase_assets from public, anon, authenticated;

-- Keep the legacy raw route pinned to the version that was connected before this release.
alter table app_private.procurement_source_routes add column legacy_request_version_id uuid;
update app_private.procurement_source_routes r set legacy_request_version_id = (
 select id from public.request_template_versions v where v.request_template_id=r.template_id and v.status='PUBLISHED' order by v.version_number desc limit 1
) where source_type='request';

create function app_private.request_purchase_options_v1() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if public.current_app_user_id() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 return jsonb_build_object('warehouses',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]') from public.warehouses where not coalesce(is_archived,false)),
 'categories',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]') from public.asset_categories));
end $$;
create function public.request_purchase_options_v1() returns jsonb language sql stable security invoker set search_path='' as $$ select app_private.request_purchase_options_v1() $$;
revoke all on function app_private.request_purchase_options_v1(), public.request_purchase_options_v1() from public,anon;
grant execute on function app_private.request_purchase_options_v1(), public.request_purchase_options_v1() to authenticated;

create function app_private.request_purchase_validate() returns trigger language plpgsql security definer set search_path='' as $$
declare rows jsonb; r jsonb; normalized jsonb:='[]'; ids text[]:='{}'; qty numeric; wh text; cat text; person text; schema jsonb;
begin
 select v.form_schema into schema from public.request_template_versions v where v.id=new.request_template_version_id;
 if not exists(select 1 from jsonb_array_elements(schema) f where f->>'key'='purchase_need_v1') then return new; end if;
 if tg_op='UPDATE' and (new.form_data is distinct from old.form_data or new.status is distinct from old.status) and old.status='APPROVED'
  and exists(select 1 from app_private.request_purchase_po_links l join public.purchase_orders p on p.id=l.purchase_order_id where l.request_id=new.id and p.status<>'cancelled' and p.archived_at is null)
 then raise exception 'REQUEST_PURCHASE_HAS_ORDERS'; end if;
 if tg_op='UPDATE' and new.form_data is not distinct from old.form_data and new.status is not distinct from old.status then return new; end if;
 rows:=new.form_data->'purchase_need_v1';
 if jsonb_typeof(rows) is distinct from 'array' or jsonb_array_length(rows) not between 1 and 100 then raise exception 'REQUEST_PURCHASE_INVALID'; end if;
 for r in select value from jsonb_array_elements(rows) loop
  if jsonb_typeof(r) is distinct from 'object' or nullif(r->>'_id','') is null or (r->>'_id')=any(ids)
   or length(r->>'_id')>100 or nullif(btrim(r->>'Tên hàng'),'') is null or nullif(btrim(r->>'Đơn vị'),'') is null
   or coalesce(r->>'Loại hàng','') not in ('Vật tư','Tài sản')
   or coalesce(r->>'Số lượng','') !~ '^([0-9]+)(\.[0-9]+)?$'
   or coalesce(r->>'Ngày cần','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'REQUEST_PURCHASE_INVALID'; end if;
  qty:=(r->>'Số lượng')::numeric; ids:=array_append(ids,r->>'_id');
  if qty<=0 or qty>100000000 or ((r->>'Loại hàng')='Tài sản' and (qty<>trunc(qty) or qty>200)) then raise exception 'REQUEST_PURCHASE_INVALID'; end if;
  perform (r->>'Ngày cần')::date;
  select name into wh from public.warehouses where id=r->>'_warehouseId' and not coalesce(is_archived,false);
  if wh is null then raise exception 'REQUEST_PURCHASE_INVALID'; end if;
  cat:=null; person:=null;
  if r->>'Loại hàng'='Tài sản' then
   select name into cat from public.asset_categories where id=r->>'_categoryId';
   if cat is null then raise exception 'REQUEST_PURCHASE_INVALID'; end if;
   if nullif(r->>'_recipientId','') is not null then
    select name into person from public.users where id::text=r->>'_recipientId';
    if person is null then raise exception 'REQUEST_PURCHASE_INVALID'; end if;
   end if;
  end if;
  normalized:=normalized||jsonb_build_array(r||jsonb_build_object('Kho nhận',wh,'Nhóm tài sản',coalesce(cat,''),'Người dự kiến nhận',coalesce(person,'')));
 end loop;
 new.form_data:=jsonb_set(new.form_data,'{purchase_need_v1}',normalized);
 return new;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then raise exception 'REQUEST_PURCHASE_INVALID';
end $$;
revoke all on function app_private.request_purchase_validate() from public,anon,authenticated;
create trigger request_purchase_validate before insert or update of form_data,status on public.request_instances for each row execute function app_private.request_purchase_validate();

CREATE OR REPLACE FUNCTION app_private.procurement_capture_source()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare src text:=case tg_table_name when 'request_instances' then 'request' else 'workflow' end;
 old_data jsonb:=to_jsonb(old); data jsonb; cfg app_private.procurement_source_routes;
 existing app_private.procurement_source_receipts; tid uuid; final_status text; actor uuid:=public.current_app_user_id();
 standard boolean:=false; cols jsonb; raw_rows jsonb; rows jsonb:='[]'; row_value jsonb; cells jsonb; ordinal integer:=0;
 doc jsonb; snap jsonb; why text; next_revision integer;
begin
 data:=case when tg_op='DELETE' then old_data else to_jsonb(new) end;
 select * into existing from app_private.procurement_source_receipts where source_type=src and source_id=(data->>'id')::uuid for update;
 tid:=nullif(data->>case when src='request' then 'request_template_id' else 'template_id' end,'')::uuid;
 final_status:=case src when 'request' then 'APPROVED' else 'COMPLETED' end;
 select * into cfg from app_private.procurement_source_routes where source_type=src and template_id=tid;
 if src='request' then
  standard:=exists(select 1 from public.request_template_versions v cross join lateral jsonb_array_elements(v.form_schema) f where v.id::text=data->>'request_template_version_id' and f->>'key'='purchase_need_v1');
  if standard then
   cfg.template_id:=tid; cfg.table_field:='purchase_need_v1'; cfg.columns:='["Tên hàng","Quy cách","Đơn vị","Số lượng","Loại hàng","Kho nhận","Ngày cần","Người dự kiến nhận","Nhóm tài sản"]';
  elsif cfg.legacy_request_version_id is not null and cfg.legacy_request_version_id::text is distinct from data->>'request_template_version_id' then cfg.template_id:=null;
  end if;
 end if;
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

 if standard then
  snap:=snap||jsonb_build_object('purchaseNeeds',data->'form_data'->'purchase_need_v1');
  doc:=doc||jsonb_build_object('orderable',true,'warehouseName',(select case when count(distinct x->>'_warehouseId')=1 then min(x->>'Kho nhận') else 'Nhiều kho · xem từng dòng' end from jsonb_array_elements(data->'form_data'->'purchase_need_v1') x),
   'warehouseId',(select case when count(distinct x->>'_warehouseId')=1 then min(x->>'_warehouseId') end from jsonb_array_elements(data->'form_data'->'purchase_need_v1') x),
   'neededDate',(select min(x->>'Ngày cần') from jsonb_array_elements(data->'form_data'->'purchase_need_v1') x));
 end if;
 insert into app_private.procurement_source_receipts(source_type,source_id,template_id,revision,state,document,snapshot)
 values(src,(data->>'id')::uuid,tid,next_revision,'received',doc,snap)
 on conflict(source_type,source_id) do update set template_id=excluded.template_id,revision=excluded.revision,state='received',
 document=excluded.document,snapshot=excluded.snapshot,received_at=now(),withdrawn_reason=null,withdrawn_at=null,closed_at=null,closed_by=null,close_reason=null;
 insert into app_private.procurement_source_versions(source_type,source_id,revision,snapshot) values(src,(data->>'id')::uuid,next_revision,jsonb_build_object('document',doc,'sourceSnapshot',snap));
 insert into public.procurement_hub_events(entity_type,entity_id,action,actor_id,payload)
 values('need',src||':'||(data->>'id'),'source_received',actor,jsonb_build_object('revision',next_revision,'templateId',tid,'lineCount',jsonb_array_length(rows)));
 return new;
end $function$
;

create function app_private.request_purchase_committed_qty(l app_private.request_purchase_po_links) returns numeric language sql stable set search_path='' as $$
 select case when p.status='cancelled' or p.archived_at is not null then 0
  when p.status='closed' and coalesce((p.metadata#>>'{shortClose,returnToNeed}')::boolean,false)
  then coalesce((select sum(d.accepted_stock_qty) from public.purchase_order_delivery_lines d join public.purchase_order_delivery_batches b on b.id=d.delivery_batch_id where d.purchase_order_id=l.purchase_order_id and d.purchase_order_line_id=l.po_line_id and b.status in ('received','received_short','received_over')),0)
  else l.qty end from public.purchase_orders p where p.id=l.purchase_order_id;
$$;
revoke all on function app_private.request_purchase_committed_qty(app_private.request_purchase_po_links) from public,anon,authenticated;

create function app_private.request_purchase_lines(r app_private.procurement_source_receipts) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',x->>'_id','name',x->>'Tên hàng','specification',x->>'Quy cách','unit',x->>'Đơn vị',
 'qty',(x->>'Số lượng')::numeric,'kind',case when x->>'Loại hàng'='Tài sản' then 'asset' else 'material' end,
 'warehouseId',x->>'_warehouseId','warehouseName',x->>'Kho nhận','neededDate',x->>'Ngày cần','recipientName',nullif(x->>'Người dự kiến nhận',''),'categoryName',nullif(x->>'Nhóm tài sản',''),
 'orderedQty',coalesce((select sum(app_private.request_purchase_committed_qty(l)) from app_private.request_purchase_po_links l join public.purchase_orders p on p.id=l.purchase_order_id where l.request_id=r.source_id and l.revision=r.revision and l.line_id=x->>'_id' and p.status<>'cancelled' and p.archived_at is null),0),
 'receivedQty',coalesce((select sum(d.accepted_stock_qty) from app_private.request_purchase_po_links l join public.purchase_order_delivery_lines d on d.purchase_order_id=l.purchase_order_id and d.purchase_order_line_id=l.po_line_id join public.purchase_order_delivery_batches b on b.id=d.delivery_batch_id where l.request_id=r.source_id and l.revision=r.revision and l.line_id=x->>'_id' and b.status in ('received','received_short','received_over')),0),
 'orders',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'code',p.po_number,'status',p.status) order by p.created_at) from app_private.request_purchase_po_links l join public.purchase_orders p on p.id=l.purchase_order_id where l.request_id=r.source_id and l.revision=r.revision and l.line_id=x->>'_id'),'[]'),
 'assets',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'code',a.code,'status',a.status,'holder',a.assigned_to_name) order by a.code) from app_private.request_purchase_po_links l join app_private.request_purchase_assets pa on pa.link_id=l.id join public.assets a on a.id=pa.asset_id where l.request_id=r.source_id and l.revision=r.revision and l.line_id=x->>'_id'),'[]')
 ) order by ord),'[]') from jsonb_array_elements(coalesce(r.snapshot->'purchaseNeeds','[]')) with ordinality n(x,ord);
$$;
revoke all on function app_private.request_purchase_lines(app_private.procurement_source_receipts) from public,anon,authenticated;

create function app_private.create_request_purchase_order_v1(p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r app_private.procurement_source_receipts; n jsonb; qty numeric; used numeric; result jsonb; po public.purchase_orders; wh public.warehouses; project text; catalog public.items; l app_private.request_purchase_po_links;
begin
 if not app_private.procurement_can('manage') then raise exception 'PROCUREMENT_MANAGE_DENIED' using errcode='42501'; end if;
 if coalesce(p_input->>'unitPrice','') !~ '^([0-9]+)(\.[0-9]+)?$' or coalesce(p_input->>'vatRate','') !~ '^([0-9]+)(\.[0-9]+)?$' then raise exception 'REQUEST_PURCHASE_INVALID'; end if;
 if nullif(p_input->>'key','') is null then raise exception 'REQUEST_PURCHASE_INVALID'; end if;
 -- Serializes competing orders against the same approved request.
 select * into r from app_private.procurement_source_receipts where source_type='request' and source_id::text=p_input->>'requestId' for update;
 if not found then raise exception 'REQUEST_PURCHASE_CHANGED'; end if;
 select * into l from app_private.request_purchase_po_links where idempotency_key=p_input->>'key';
 if found then
  if l.request_id<>r.source_id or l.line_id is distinct from p_input->>'lineId' or l.created_by<>public.current_app_user_id() then raise exception 'REQUEST_PURCHASE_CHANGED'; end if;
  return (select jsonb_build_object('purchaseOrderId',id,'poNumber',po_number) from public.purchase_orders where id=l.purchase_order_id);
 end if;
 if r.state<>'received' or r.closed_at is not null or r.revision is distinct from (p_input->>'revision')::integer then raise exception 'REQUEST_PURCHASE_CHANGED'; end if;
 select value into n from jsonb_array_elements(coalesce(r.snapshot->'purchaseNeeds','[]')) where value->>'_id'=p_input->>'lineId';
 if n is null then raise exception 'REQUEST_PURCHASE_INVALID'; end if;
 qty:=(p_input->>'qty')::numeric;
 if qty is null or qty::text in ('NaN','Infinity','-Infinity') or qty<=0 then raise exception 'REQUEST_PURCHASE_QTY'; end if;
 select coalesce(sum(app_private.request_purchase_committed_qty(a)),0) into used from app_private.request_purchase_po_links a join public.purchase_orders p on p.id=a.purchase_order_id where a.request_id=r.source_id and a.revision=r.revision and a.line_id=n->>'_id' and p.status<>'cancelled' and p.archived_at is null;
 if used+qty>(n->>'Số lượng')::numeric or (n->>'Loại hàng'='Tài sản' and qty<>trunc(qty)) then raise exception 'REQUEST_PURCHASE_QTY'; end if;
 select * into catalog from public.items where id=p_input->>'itemId';
 if not found then raise exception 'PROCUREMENT_ITEM_NOT_FOUND'; end if;
 if lower(btrim(catalog.unit)) is distinct from lower(btrim(n->>'Đơn vị')) then raise exception 'REQUEST_PURCHASE_UNIT'; end if;
 select * into wh from public.warehouses where id=n->>'_warehouseId' and not coalesce(is_archived,false);
 if not found then raise exception 'PROCUREMENT_PO_WAREHOUSE_INVALID'; end if;
 if wh.type='SITE' then
  select p.id into project from public.projects p where p.id=wh.project_id or (wh.project_id is null and p.construction_site_id::text=wh.construction_site_id::text) order by p.id limit 1;
  if project is null then raise exception 'PROCUREMENT_PROACTIVE_PROJECT_REQUIRED'; end if;
 end if;
 result:=public.save_procurement_proactive_po_v1(jsonb_build_object('purpose',case when wh.type='SITE' then 'project' else 'stock' end,'projectId',project,
 'targetWarehouseId',wh.id,'vendorId',p_input->>'vendorId','purchaseMode','multiple','expectedDeliveryDate',n->>'Ngày cần','vatRate',p_input->'vatRate',
 'reasonCode','other','reason','Theo yêu cầu đã duyệt '||(r.document->>'code'),'overBoqReason','Theo yêu cầu đã duyệt '||(r.document->>'code'),
 'note',concat_ws(E'\n','Nguồn Module Yêu cầu: '||(r.document->>'code'),nullif(p_input->>'note','')),
 'items',jsonb_build_array(jsonb_build_object('itemId',catalog.id,'stockQty',qty,'purchaseQty',qty,'purchaseUnit',catalog.unit,'unitPrice',p_input->'unitPrice','specification',n->>'Quy cách'))));
 select * into po from public.purchase_orders where id=result->>'purchaseOrderId';
 insert into app_private.request_purchase_po_links(request_id,revision,line_id,purchase_order_id,po_line_id,item_id,qty,kind,warehouse_id,category_id,recipient_id,idempotency_key,created_by)
 values(r.source_id,r.revision,n->>'_id',po.id,po.items->0->>'lineId',catalog.id,qty,case when n->>'Loại hàng'='Tài sản' then 'asset' else 'material' end,wh.id,
 case when n->>'Loại hàng'='Tài sản' then nullif(n->>'_categoryId','') end,case when n->>'Loại hàng'='Tài sản' then nullif(n->>'_recipientId','')::uuid end,p_input->>'key',public.current_app_user_id());
 insert into public.procurement_hub_events(entity_type,entity_id,action,actor_id,payload) values('need','request:'||r.source_id,'order_created',public.current_app_user_id(),jsonb_build_object('purchaseOrderId',po.id,'lineId',n->>'_id','qty',qty,'revision',r.revision));
 return result;
end $$;
create function public.create_request_purchase_order_v1(p_input jsonb) returns jsonb language sql security invoker set search_path='' as $$ select app_private.create_request_purchase_order_v1(p_input) $$;
revoke all on function app_private.create_request_purchase_order_v1(jsonb), public.create_request_purchase_order_v1(jsonb) from public,anon;
grant execute on function app_private.create_request_purchase_order_v1(jsonb), public.create_request_purchase_order_v1(jsonb) to authenticated;

create function app_private.guard_request_purchase_po() returns trigger language plpgsql security definer set search_path='' as $$
declare l app_private.request_purchase_po_links; r app_private.procurement_source_receipts; it jsonb;
begin
 select * into l from app_private.request_purchase_po_links where purchase_order_id=new.id;
 if not found then return new; end if;
 select * into r from app_private.procurement_source_receipts where source_type='request' and source_id=l.request_id;
 if new.status not in ('cancelled','returned') and (new.status is distinct from old.status or new.items is distinct from old.items) and (r.state<>'received' or r.revision<>l.revision) then raise exception 'REQUEST_PURCHASE_CHANGED'; end if;
 it:=new.items->0;
 if jsonb_array_length(new.items)<>1 or it->>'lineId' is distinct from l.po_line_id or it->>'itemId' is distinct from l.item_id
  or (it->>'stockQty')::numeric is distinct from l.qty or (it->>'qty')::numeric is distinct from l.qty
  or new.purchase_mode<>'multiple' or (it->>'purchaseConversionFactor')::numeric is distinct from 1::numeric
  or new.target_warehouse_id is distinct from l.warehouse_id or new.fulfillment_mode is distinct from old.fulfillment_mode
  or new.project_id is distinct from old.project_id or new.source_mode is distinct from old.source_mode then raise exception 'REQUEST_PURCHASE_LOCKED'; end if;
 return new;
end $$;
revoke all on function app_private.guard_request_purchase_po() from public,anon,authenticated;
create trigger guard_request_purchase_po before update on public.purchase_orders for each row execute function app_private.guard_request_purchase_po();

CREATE OR REPLACE FUNCTION app_private.procurement_bridge_get(p_source_type text, p_source_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r app_private.procurement_source_receipts;
begin
 if not app_private.procurement_can('view') then raise exception 'PROCUREMENT_VIEW_DENIED' using errcode='42501'; end if;
 if p_source_type not in ('request','workflow') then return app_private.procurement_legacy_get_v1(p_source_type,p_source_id); end if;
 select * into r from app_private.procurement_source_receipts where source_type=p_source_type and source_id::text=p_source_id;
 if not found then raise exception 'PROCUREMENT_SOURCE_NOT_FOUND' using errcode='PT404'; end if;
 return app_private.procurement_receipt_document(r)||jsonb_build_object('lines','[]'::jsonb,'purchaseLines',app_private.request_purchase_lines(r),
 'sourceSnapshot',r.snapshot||jsonb_build_object('withdrawnReason',r.withdrawn_reason),
 'closure',case when r.closed_at is not null or r.state='withdrawn' then jsonb_build_object('closedAt',coalesce(r.withdrawn_at,r.closed_at,r.received_at),'reason',coalesce(r.withdrawn_reason,r.close_reason),'closedByName',(select name from public.users where id=r.closed_by)) end,
 'assignment',case when r.assigned_at is not null then jsonb_build_object('assigneeUserId',r.assignee_id,'assigneeName',(select name from public.users where id=r.assignee_id),'assignedAt',r.assigned_at,'note',r.assignment_note) end);
end $function$
;

-- Asset receipts have their own physical custody ledger. Procurement/AP still posts once
-- through the existing receipt command; no second WMS stock or inventory-value entry.
create function app_private.request_purchase_asset_receipt() returns trigger language plpgsql security definer set search_path='' as $$
declare l app_private.request_purchase_po_links; d public.purchase_order_delivery_lines; n integer; aid text; acode text; aname text; po public.purchase_orders; need jsonb; total numeric;
begin
 if new.status not in ('received','received_short','received_over') or old.status in ('received','received_short','received_over') then return new; end if;
 select * into l from app_private.request_purchase_po_links where purchase_order_id=new.purchase_order_id and kind='asset' for update;
 if not found then return new; end if;
 select * into po from public.purchase_orders where id=l.purchase_order_id;
 select x into need from app_private.procurement_source_versions v cross join lateral jsonb_array_elements(v.snapshot#>'{sourceSnapshot,purchaseNeeds}') x where v.source_type='request' and v.source_id=l.request_id and v.revision=l.revision and x->>'_id'=l.line_id;
 for d in select * from public.purchase_order_delivery_lines where delivery_batch_id=new.id loop
  if d.purchase_order_line_id<>l.po_line_id or d.accepted_stock_qty<>trunc(d.accepted_stock_qty) or d.accepted_stock_qty<0 or d.accepted_stock_qty>200 then raise exception 'REQUEST_ASSET_WHOLE_UNITS'; end if;
  select count(*) into total from app_private.request_purchase_assets where link_id=l.id;
  if total+d.accepted_stock_qty>l.qty then raise exception 'REQUEST_ASSET_WHOLE_UNITS'; end if;
  for n in 1..d.accepted_stock_qty::integer loop
   aid:='rq-asset-'||d.id||'-'||n; acode:='TS-'||upper(substr(replace(d.id::text,'-',''),1,12))||'-'||lpad(n::text,3,'0');
   aname:=coalesce(need->>'Tên hàng',po.items->0->>'name');
   insert into public.assets(id,code,name,category_id,status,asset_type,quantity,unit,warehouse_id,original_value,purchase_date,is_fixed_asset,depreciation_years,asset_origin,supplier_id,note)
   values(aid,acode,aname,l.category_id,'AVAILABLE','single',1,need->>'Đơn vị',l.warehouse_id,d.delivery_unit_price,current_date::text,false,0,'purchase',po.vendor_id,
    concat_ws(E'\n','Nguồn Yêu cầu: '||l.request_id,'Đơn mua: '||po.po_number,'Quy cách: '||(need->>'Quy cách'),case when nullif(need->>'Người dự kiến nhận','') is not null then 'Dự kiến cấp cho: '||(need->>'Người dự kiến nhận') end,'Chờ xác nhận bàn giao. Phân loại tài sản cố định do bộ phận Tài sản xác nhận.'));
   insert into public.asset_location_stocks(id,asset_id,warehouse_id,qty) values('als-'||aid,aid,l.warehouse_id,1);
   insert into app_private.request_purchase_assets(asset_id,link_id,delivery_line_id,ordinal) values(aid,l.id,d.id,n);
  end loop;
 end loop;
 return new;
end $$;
revoke all on function app_private.request_purchase_asset_receipt() from public,anon,authenticated;
create trigger request_purchase_asset_receipt after update of status on public.purchase_order_delivery_batches for each row execute function app_private.request_purchase_asset_receipt();

CREATE OR REPLACE FUNCTION app_private.finalize_purchase_receipt_v2(p_delivery_batch_id uuid, p_wms_transaction_id text, p_actor_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_po_id text;
  v_po public.purchase_orders%rowtype;
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_tx public.transactions%rowtype;
  v_item jsonb;
  v_item_id text;
  v_qty numeric;
  v_planned_purchase_qty numeric;
  v_accepted_purchase_qty numeric;
  v_delivery_status text;
  v_next_items jsonb;
  v_is_delivered boolean;
  v_already_recorded boolean;
  v_previous_guard text;
begin
  if p_actor_user_id is null then
    raise exception 'Nguoi thuc hien lenh khong hop le.' using errcode = '42501';
  end if;
  if public.current_app_user_id() is null or p_actor_user_id <> public.current_app_user_id() then
    raise exception 'Nguoi thuc hien lenh khong hop le.' using errcode = '42501';
  end if;

  select purchase_order_id into v_po_id
  from public.purchase_order_delivery_batches
  where id = p_delivery_batch_id;
  if not found then
    raise exception 'Khong tim thay Dot giao %.', p_delivery_batch_id using errcode = '22023';
  end if;

  select * into v_po
  from public.purchase_orders
  where id = v_po_id
  for update;
  if not found then
    raise exception 'Khong tim thay Goi mua hang cua Dot giao %.', p_delivery_batch_id using errcode = '22023';
  end if;

  select * into v_batch
  from public.purchase_order_delivery_batches
  where id = p_delivery_batch_id
  for update;
  if not found then
    raise exception 'Khong tim thay Dot giao %.', p_delivery_batch_id using errcode = '22023';
  end if;
  if v_batch.wms_transaction_id is distinct from p_wms_transaction_id then
    raise exception 'WMS transaction khong khop Dot giao.' using errcode = '22023';
  end if;

  select * into v_tx
  from public.transactions
  where id = p_wms_transaction_id
  for update;
  if not found then
    raise exception 'Khong tim thay WMS cua Dot giao.' using errcode = '22023';
  end if;
  if v_tx.source_type <> 'po_delivery_batch' or v_tx.source_id <> p_delivery_batch_id::text then
    raise exception 'WMS khong lien ket dung Dot giao.' using errcode = '22023';
  end if;
  if not app_private.current_user_can_receive_purchase_batch_v2(p_actor_user_id, v_tx.target_warehouse_id) then
    raise exception 'Nguoi dung khong co quyen xac nhan nhan hang tai kho nhan.' using errcode = '42501';
  end if;

  if v_batch.status in ('received', 'received_short', 'received_over')
     and v_tx.status = 'COMPLETED'::public.transaction_status then
    return app_private.purchase_receipt_command_result_v2(p_delivery_batch_id, true);
  end if;
  if v_batch.status in ('received', 'received_short', 'received_over')
     or v_tx.status = 'COMPLETED'::public.transaction_status then
    raise exception 'Anomaly: Dot giao va WMS khong dong bo trang thai finalize.' using errcode = 'P0001';
  end if;
  if v_batch.status <> 'quality_approved' or v_tx.status <> 'APPROVED'::public.transaction_status then
    raise exception 'Chi finalize Dot da duyet SL/CL va WMS APPROVED.' using errcode = '22023';
  end if;

  perform 1
  from public.purchase_order_delivery_lines
  where delivery_batch_id = p_delivery_batch_id
  order by id
  for update;

  perform 1
  from public.items item
  where item.id in (
    select distinct line.value ->> 'itemId'
    from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) line(value)
    where nullif(line.value ->> 'itemId', '') is not null
  )
  order by item.id
  for update;

  if coalesce(v_batch.fulfillment_mode, 'RECEIVE_TO_STOCK') = 'RECEIVE_TO_STOCK' then
    for v_item in
      select value from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) as item(value)
    loop
      v_item_id := nullif(v_item ->> 'itemId', '');
      v_qty := coalesce(nullif(v_item ->> 'quantity', '')::numeric, 0);
      if v_item_id is null or v_qty < 0 then
        raise exception 'WMS item nhan hang khong hop le.' using errcode = '22023';
      end if;
      if v_qty > 0 and not exists(select 1 from app_private.request_purchase_po_links l where l.purchase_order_id=v_po.id and l.kind='asset') then
        perform public.apply_stock_change(v_item_id, v_tx.target_warehouse_id, v_qty);
      end if;
    end loop;
  elsif coalesce(v_batch.fulfillment_mode, '') <> 'DIRECT_CONSUMPTION' then
    raise exception 'Fulfillment mode khong hop le: %', v_batch.fulfillment_mode using errcode = '22023';
  end if;

  update public.transactions
  set status = 'COMPLETED'::public.transaction_status,
      approver_id = p_actor_user_id,
      approved_at = coalesce(approved_at, now())
  where id = p_wms_transaction_id
  returning * into v_tx;

  select
    coalesce(sum(coalesce(planned_qty, 0)), 0),
    coalesce(sum(coalesce(accepted_qty, 0)), 0)
  into v_planned_purchase_qty, v_accepted_purchase_qty
  from public.purchase_order_delivery_lines
  where delivery_batch_id = p_delivery_batch_id;

  v_delivery_status := case
    when v_accepted_purchase_qty > v_planned_purchase_qty then 'received_over'
    when v_accepted_purchase_qty < v_planned_purchase_qty then 'received_short'
    else 'received'
  end;

  update public.purchase_order_delivery_batches
  set status = v_delivery_status,
      received_by = p_actor_user_id,
      received_at = now(),
      updated_at = now()
  where id = p_delivery_batch_id
  returning * into v_batch;

  select exists (
    select 1
    from jsonb_array_elements_text(coalesce(v_po.received_transaction_ids, '[]'::jsonb)) existing(id)
    where existing.id = v_tx.id
  ) into v_already_recorded;

  with receipt_by_line as (
    select
      purchase_order_line_id,
      sum(coalesce(accepted_qty, 0)) as accepted_purchase_qty
    from public.purchase_order_delivery_lines
    where delivery_batch_id = p_delivery_batch_id
    group by purchase_order_line_id
  ),
  item_rows as (
    select
      item.value as item,
      item.ordinality,
      coalesce(item.value ->> 'lineId', item.value ->> 'line_id', item.value ->> 'itemId', item.value ->> 'item_id') as line_key,
      coalesce(nullif(item.value ->> 'receivedQty', '')::numeric, 0) as current_received_qty
    from jsonb_array_elements(coalesce(v_po.items, '[]'::jsonb)) with ordinality item(value, ordinality)
  ),
  next_rows as (
    select
      case
        when coalesce(r.accepted_purchase_qty, 0) > 0 then
          jsonb_set(
            ir.item,
            '{receivedQty}',
            to_jsonb(ir.current_received_qty + coalesce(r.accepted_purchase_qty, 0)),
            true
          )
        else ir.item
      end as item,
      ir.ordinality
    from item_rows ir
    left join receipt_by_line r on r.purchase_order_line_id = ir.line_key
  )
  select coalesce(jsonb_agg(item order by ordinality), '[]'::jsonb)
  into v_next_items
  from next_rows;

  select coalesce(bool_and(
    coalesce(nullif(item.value ->> 'receivedQty', '')::numeric, 0)
      >= coalesce(nullif(item.value ->> 'qty', '')::numeric, 0)
  ), false)
  into v_is_delivered
  from jsonb_array_elements(coalesce(v_next_items, '[]'::jsonb)) item(value);

  v_previous_guard := current_setting('app.material_transition_context', true);
  perform set_config('app.material_transition_context', 'on', true);

  update public.purchase_orders
  set items = v_next_items,
      status = case when v_is_delivered then 'delivered' else 'partial' end,
      actual_delivery_date = case when v_is_delivered then current_date::text else actual_delivery_date end,
      received_transaction_ids = case
        when v_already_recorded then coalesce(received_transaction_ids, '[]'::jsonb)
        else coalesce(received_transaction_ids, '[]'::jsonb) || jsonb_build_array(v_tx.id)
      end
  where id = v_po.id;

  perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);

  update public.material_request_fulfillment_lines mfl
  set received_qty = coalesce(line.accepted_stock_qty, line.accepted_qty, 0),
      variance_reason = coalesce(v_batch.variance_reason, mfl.variance_reason),
      updated_at = now()
  from public.purchase_order_delivery_lines line
  where mfl.po_delivery_line_id = line.id
    and line.delivery_batch_id = p_delivery_batch_id;

  update public.material_request_fulfillment_batches
  set status = 'received',
      received_by = p_actor_user_id,
      received_at = now(),
      updated_at = now()
  where po_delivery_batch_id = p_delivery_batch_id
    and status = 'issued';

  return app_private.purchase_receipt_command_result_v2(p_delivery_batch_id, false);
exception
  when others then
    perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
    raise;
end;
$function$
;

CREATE OR REPLACE FUNCTION app_private.trg_sync_wms_transaction_inventory_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists(select 1 from public.purchase_order_delivery_batches b join app_private.request_purchase_po_links l on l.purchase_order_id=b.purchase_order_id and l.kind='asset' where b.wms_transaction_id=new.id)
     and new.status::text = 'COMPLETED'
     and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and not (
       new.type = 'TRANSFER'::public.transaction_type
       and exists (
         select 1 from public.wms_transfer_lines line
         where line.transaction_id = new.id
       )
     )
     and not (
       new.source_type = 'po_delivery_batch'
       and exists (
         select 1 from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) item(value)
         where item.value ->> 'fulfillmentMode' = 'DIRECT_CONSUMPTION'
       )
     ) then
    perform app_private.sync_wms_transaction_to_inventory_ledger(new.id);
  end if;
  return new;
end;
$function$
;

-- Existing asset assignment remains the authority for permissions and actual handover.
-- Mirror its confirmed custody changes for assets received from Requests.
alter function public.record_asset_assignment(jsonb) rename to request_purchase_legacy_assignment;
alter function public.request_purchase_legacy_assignment(jsonb) set schema app_private;
revoke all on function app_private.request_purchase_legacy_assignment(jsonb) from public,anon,authenticated;
create function app_private.request_purchase_assignment(p_assignment jsonb) returns public.asset_assignments language plpgsql security definer set search_path='' as $$
declare a public.assets; result public.asset_assignments; existing public.asset_assignments; linked boolean;
begin
 select exists(select 1 from app_private.request_purchase_assets where asset_id=p_assignment->>'asset_id') into linked;
 if not linked then return app_private.request_purchase_legacy_assignment(p_assignment); end if;
 if public.current_app_user_id() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into a from public.assets where id=p_assignment->>'asset_id' for update;
 select * into existing from public.asset_assignments where id=p_assignment->>'id';
 if found then
  if existing.asset_id=a.id and existing.performed_by=public.current_app_user_id()::text and existing.type::text=p_assignment->>'type' and existing.user_id is not distinct from p_assignment->>'user_id' then return existing; end if;
  raise exception 'REQUEST_PURCHASE_CHANGED';
 end if;
 if p_assignment->>'type'='assign' and a.status<>'AVAILABLE' then raise exception 'Asset is not available'; end if;
 if p_assignment->>'type' in ('return','transfer') and a.status<>'IN_USE' then raise exception 'Asset is not assigned'; end if;
 if p_assignment->>'type' in ('assign','transfer') and not exists(select 1 from public.users where id::text=p_assignment->>'user_id') then raise exception 'Invalid recipient'; end if;
 result:=app_private.request_purchase_legacy_assignment(p_assignment||jsonb_build_object('qty',1,'performed_by',public.current_app_user_id(),'performed_by_name',(select name from public.users where id=public.current_app_user_id()),'user_name',(select name from public.users where id::text=p_assignment->>'user_id')));
 -- One serialized asset has exactly one physical custody position.
 delete from public.asset_location_stocks where asset_id=a.id;
 insert into public.asset_location_stocks(id,asset_id,warehouse_id,qty,assigned_to_user_id,assigned_to_name)
 values('als-'||a.id,a.id,case when p_assignment->>'type'='return' then a.warehouse_id end,1,
 case when p_assignment->>'type'<>'return' then result.user_id end,case when p_assignment->>'type'<>'return' then result.user_name end);
 return result;
end $$;
create function public.record_asset_assignment(p_assignment jsonb) returns public.asset_assignments language sql security invoker set search_path='' as $$ select app_private.request_purchase_assignment(p_assignment) $$;
revoke all on function app_private.request_purchase_assignment(jsonb), public.record_asset_assignment(jsonb) from public,anon;
grant execute on function app_private.request_purchase_assignment(jsonb), public.record_asset_assignment(jsonb) to authenticated;

CREATE OR REPLACE FUNCTION app_private.prepare_planned_purchase_delivery_batch_with_wms_qr_v2(p_delivery_batch_id uuid, p_actor_user_id uuid, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_po public.purchase_orders%rowtype;
  v_line public.purchase_order_delivery_lines%rowtype;
  v_qr_token text := 'pod_' || replace(gen_random_uuid()::text, '-', '');
  v_tx_id text := 'tx-po-delivery-' || replace(gen_random_uuid()::text, '-', '');
  v_wms_items jsonb := '[]'::jsonb;
  v_purchase_unit_price numeric;
  v_stock_unit_price numeric;
begin
  if p_actor_user_id is null then
    raise exception 'Nguoi thuc hien lenh khong hop le.' using errcode = '42501';
  end if;
  if public.current_app_user_id() is null or p_actor_user_id <> public.current_app_user_id() then
    raise exception 'Nguoi thuc hien lenh khong hop le.' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'Idempotency key is required.' using errcode = '22023';
  end if;

  select * into v_batch
  from public.purchase_order_delivery_batches
  where id = p_delivery_batch_id
  for update;
  if not found then
    raise exception 'Khong tim thay Dot giao %.', p_delivery_batch_id using errcode = '22023';
  end if;

  select * into v_po
  from public.purchase_orders
  where id = v_batch.purchase_order_id
  for update;
  if not found then
    raise exception 'Khong tim thay Goi mua hang cua Dot giao %.', p_delivery_batch_id using errcode = '22023';
  end if;
  if coalesce(v_po.source_mode, '') <> 'from_request' and not exists(select 1 from app_private.request_purchase_po_links where purchase_order_id=v_po.id) then
    raise exception 'Chi chuan bi Dot giao cho Goi mua hang V2 tao tu MR.' using errcode = '22023';
  end if;
  if v_po.status not in ('confirmed', 'in_transit', 'partial') then
    raise exception 'Chi chuan bi Dot giao sau khi Goi da duyet.' using errcode = '22023';
  end if;
  if coalesce(v_batch.status, 'planned') not in ('planned', 'waiting_delivery', 'receiving', 'wms_pending') then
    raise exception 'Trang thai Dot giao khong cho phep tao WMS/QR: %', v_batch.status using errcode = '22023';
  end if;
  if coalesce(v_batch.wms_transaction_id, '') <> '' and coalesce(v_batch.qr_token, '') <> '' then
    return app_private.purchase_delivery_command_result_v2(v_batch.id);
  end if;
  if nullif(trim(coalesce(v_batch.target_warehouse_id, v_po.target_warehouse_id, '')), '') is null then
    raise exception 'Kho nhan hang la bat buoc de tao WMS/QR Dot giao.' using errcode = '22023';
  end if;

  for v_line in
    select *
    from public.purchase_order_delivery_lines
    where delivery_batch_id = v_batch.id
    order by id
  loop
    if coalesce(v_line.planned_qty, 0) <= 0 or coalesce(v_line.stock_planned_qty, 0) <= 0 then
      raise exception 'So luong Dot giao phai lon hon 0.' using errcode = '22023';
    end if;
    v_purchase_unit_price := coalesce(v_line.delivery_unit_price, 0);
    if v_purchase_unit_price < 0 then
      raise exception 'Don gia Dot giao khong duoc am.' using errcode = '22023';
    end if;
    v_stock_unit_price := case
      when coalesce(v_line.stock_planned_qty, 0) > 0
        then v_purchase_unit_price * coalesce(v_line.planned_qty, 0) / coalesce(v_line.stock_planned_qty, 1)
      else 0
    end;

    v_wms_items := v_wms_items || jsonb_build_array(jsonb_build_object(
      'itemId', v_line.item_id,
      'quantity', v_line.stock_planned_qty,
      'orderedQty', v_line.stock_planned_qty,
      'price', v_stock_unit_price,
      'accountingQty', v_line.planned_qty,
      'accountingUnit', coalesce(v_line.unit, 'DV mua'),
      'accountingPrice', v_purchase_unit_price,
      'purchaseOrderLineId', v_line.purchase_order_line_id,
      'purchaseOrderDeliveryBatchId', v_batch.id,
      'purchaseOrderDeliveryLineId', v_line.id,
      'fulfillmentMode', coalesce(v_batch.fulfillment_mode, v_po.fulfillment_mode)
    ));
  end loop;

  if jsonb_array_length(v_wms_items) = 0 then
    raise exception 'Dot giao phai co it nhat mot dong vat tu.' using errcode = '22023';
  end if;

  insert into public.transactions (
    id, type, date, items, target_warehouse_id, supplier_id,
    requester_id, created_by, approver_id, status, note,
    business_partner_id, business_partner_name_snapshot, source_type, source_id
  ) values (
    v_tx_id, 'IMPORT'::public.transaction_type, now(), v_wms_items, coalesce(v_batch.target_warehouse_id, v_po.target_warehouse_id), nullif(coalesce(v_batch.supplier_id, v_po.vendor_id), ''),
    p_actor_user_id, p_actor_user_id, p_actor_user_id, 'PENDING'::public.transaction_status,
    coalesce(v_po.po_number, v_po.id) || '-' || lpad(v_batch.delivery_no::text, 2, '0') || ' dang giao',
    null, nullif(coalesce(v_batch.supplier_name_snapshot, v_po.vendor_name), ''), 'po_delivery_batch', v_batch.id::text
  );

  update public.purchase_order_delivery_batches
  set supplier_id = nullif(coalesce(v_batch.supplier_id, v_po.vendor_id), ''),
      supplier_name_snapshot = nullif(coalesce(v_batch.supplier_name_snapshot, v_po.vendor_name), ''),
      fulfillment_mode = coalesce(v_batch.fulfillment_mode, v_po.fulfillment_mode),
      vat_rate = coalesce(v_batch.vat_rate, v_po.vat_rate, 0),
      qr_token = coalesce(v_batch.qr_token, v_qr_token),
      idempotency_key = coalesce(v_batch.idempotency_key, p_idempotency_key),
      wms_transaction_id = v_tx_id,
      status = 'receiving',
      updated_at = now()
  where id = v_batch.id;

  return app_private.purchase_delivery_command_result_v2(v_batch.id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.receive_purchase_delivery_v1(p_delivery_batch_id uuid, p_wms_transaction_id text, p_quality_result text DEFAULT 'passed'::text, p_lines jsonb DEFAULT '[]'::jsonb, p_attachments jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_tx_status text;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  select * into v_batch from public.purchase_order_delivery_batches where id = p_delivery_batch_id for update;
  if not found or v_batch.wms_transaction_id is distinct from p_wms_transaction_id then
    raise exception using errcode = '22023', message = 'PURCHASE_RECEIPT_BATCH_MISMATCH'; end if;
  select status::text into v_tx_status from public.transactions where id = p_wms_transaction_id for update;

  if v_batch.status in ('received','received_short','received_over') and v_tx_status='COMPLETED' then
    return public.finalize_material_po_receipt(p_delivery_batch_id,p_wms_transaction_id,v_actor);
  end if;

  if v_batch.status = 'wms_pending' and v_tx_status = 'PENDING' then
    update public.purchase_order_delivery_batches set status = 'receiving', updated_at = now() where id = v_batch.id;
    v_batch.status := 'receiving';
  end if;

  if v_batch.status = 'receiving' and v_tx_status = 'PENDING' then
    perform public.approve_material_po_quality(p_delivery_batch_id, p_wms_transaction_id, v_actor, p_quality_result, p_lines, p_attachments);
  elsif not (v_batch.status = 'quality_approved' and v_tx_status = 'APPROVED') then
    raise exception using errcode = '22023', message = 'PURCHASE_RECEIPT_NOT_RECEIVABLE';
  end if;

  return public.finalize_material_po_receipt(p_delivery_batch_id, p_wms_transaction_id, v_actor);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_procurement_order_v1(p_po_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_po public.purchase_orders%rowtype; v_actor uuid := public.current_app_user_id(); v_hub boolean; v_manage boolean;
begin
  if not app_private.procurement_can('view') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_VIEW_DENIED'; end if;
  select * into v_po from public.purchase_orders where id = p_po_id and archived_at is null;
  if not found then raise exception using errcode = 'PT404', message = 'PROCUREMENT_PO_NOT_FOUND'; end if;
  v_hub := app_private.procurement_po_is_hub(v_po.metadata);
  v_manage := app_private.procurement_can('manage');
  return jsonb_build_object(
    'requestSource',(select jsonb_build_object('id',l.request_id,'code',r.document->>'code','kind',l.kind) from app_private.request_purchase_po_links l join app_private.procurement_source_receipts r on r.source_type='request' and r.source_id=l.request_id where l.purchase_order_id=v_po.id),
    'id', v_po.id, 'poNumber', v_po.po_number, 'status', v_po.status, 'stage', app_private.procurement_po_stage(v_po.status),
    'isHub', v_hub, 'rowVersion', v_po.row_version, 'vendorId', v_po.vendor_id, 'vendorName', v_po.vendor_name,
    'projectId', v_po.project_id, 'constructionSiteId', v_po.construction_site_id,
    'projectCode', (select code from public.projects where id = v_po.project_id),
    'projectName', (select name from public.projects where id = v_po.project_id),
    'targetWarehouseId', v_po.target_warehouse_id, 'warehouseName', (select name from public.warehouses where id = v_po.target_warehouse_id),
    'orderDate', v_po.order_date, 'expectedDeliveryDate', app_private.procurement_date_or_null(v_po.expected_delivery_date),
    'totalAmount', v_po.total_amount, 'vatRate', v_po.vat_rate, 'note', v_po.note,
    'createdById', v_po.created_by_id, 'createdByName', (select name from public.users where id::text = v_po.created_by_id),
    'createdByTitle', (select e.title from public.employees e where e.user_id::text = v_po.created_by_id limit 1),
    'createdAt', v_po.created_at, 'submittedToUserId', v_po.submitted_to_user_id, 'submittedToName', v_po.submitted_to_name,
    'returnReason', v_po.metadata->>'returnReason', 'everSubmitted', v_po.ever_submitted,
    'purchaseMode', v_po.purchase_mode,
    'kind', case when v_po.source_mode in ('proactive_project', 'proactive_stock') then 'proactive' else 'need' end, 'proactive', v_po.metadata->'proactive', 'approvedTotalAmount', v_po.approved_total_amount, 'shortClose', v_po.metadata->'shortClose', 'budgetApproval', v_po.metadata->'budgetApproval',
    'isGroup', app_private.procurement_po_is_group(v_po.metadata),
    'sites', case when app_private.procurement_po_is_group(v_po.metadata) then app_private.group_po_sites(v_po) else '[]'::jsonb end,
    'deliveries', app_private.procurement_po_deliveries(v_po.id),
    'returns', app_private.procurement_po_returns(v_po.id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'lineId', coalesce(x.value->>'lineId', x.value->>'itemId'), 'itemId', x.value->>'itemId',
        'name', coalesce(x.value->>'name', x.value->>'itemNameSnapshot'), 'sku', x.value->>'sku', 'unit', x.value->>'unit',
        'qty', coalesce(nullif(x.value->>'qty', '')::numeric, 0), 'unitPrice', coalesce(nullif(x.value->>'unitPrice', '')::numeric, 0),
        'receivedQty', coalesce(nullif(x.value->>'receivedQty', '')::numeric, 0), 'note', x.value->>'note', 'specification', x.value->>'specification',
        'returnedQty', coalesce(nullif(x.value->>'returnedQty', '')::numeric, 0),
        'stockUnit', coalesce(x.value->>'stockUnitSnapshot', x.value->>'unit'),
        'remainingToDeliver', app_private.procurement_po_line_undelivered(v_po.id, v_po.items, coalesce(x.value->>'lineId', x.value->>'itemId')),
        'factor', coalesce(nullif(x.value->>'purchaseConversionFactor', '')::numeric, 1),
        'stockQty', app_private.procurement_po_line_stock_qty(x.value),
        'allocatedQty', app_private.procurement_po_line_link_total(v_po.id, coalesce(x.value->>'lineId', x.value->>'itemId')),
        'boq', x.value->'boq',
        'allocations', coalesce((select jsonb_agg(a) from (
            select jsonb_build_object('sourceType', 'material_request', 'sourceId', l.material_request_id,
              'code', coalesce(r.code, l.material_request_code), 'lineId', l.request_line_id, 'qty', l.ordered_qty, 'needQty', l.requested_qty,
              'projectCode', (select pr.code from public.projects pr where pr.id = l.project_id), 'warehouseId', l.target_warehouse_id,
              'warehouseName', (select w.name from public.warehouses w where w.id = l.target_warehouse_id), 'excessReason', l.excess_reason) a
            from public.purchase_order_request_lines l left join public.requests r on r.id = l.material_request_id
            where l.purchase_order_id = v_po.id and l.purchase_order_line_id = coalesce(x.value->>'lineId', x.value->>'itemId')
            union all
            select jsonb_build_object('sourceType', 'material_plan', 'sourceId', k.material_plan_id,
              'code', p.code, 'lineId', k.material_plan_line_id, 'qty', k.ordered_qty, 'needQty', pl.requested_qty)
            from public.procurement_po_plan_links k join public.project_material_plans p on p.id = k.material_plan_id
            join public.project_material_plan_lines pl on pl.id = k.material_plan_line_id
            where k.purchase_order_id = v_po.id and k.purchase_order_line_id = coalesce(x.value->>'lineId', x.value->>'itemId')) q), '[]'::jsonb))
        order by x.ordinality)
      from jsonb_array_elements(case when jsonb_typeof(v_po.items) = 'array' then v_po.items else '[]'::jsonb end) with ordinality x), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'actorName', u.name, 'reason', e.reason, 'at', e.created_at, 'payload', e.payload)
        order by e.created_at) from public.procurement_hub_events e left join public.users u on u.id = e.actor_id
      where e.entity_type = 'purchase_order' and e.entity_id = v_po.id), '[]'::jsonb),
    'permissions', jsonb_build_object(
      'canEdit', v_hub and v_manage and v_po.status in ('draft', 'returned') and v_po.created_by_id = v_actor::text,
      'canSubmit', v_hub and v_manage and v_po.status in ('draft', 'returned') and v_po.created_by_id = v_actor::text,
      'canApprove', v_hub and v_po.status = 'sent' and v_po.created_by_id is distinct from v_actor::text
        and (v_po.submitted_to_user_id = v_actor::text or public.is_admin()),
      'canDelete', v_hub and v_manage and v_po.status = 'draft' and not v_po.ever_submitted and v_po.created_by_id = v_actor::text,
      'canDecideReturn', v_hub and v_manage,
      'canLink', v_hub and v_manage and v_po.source_mode = 'proactive_project' and app_private.procurement_proactive_linkable(v_po.status),
      'canAddDelivery', v_hub and v_manage and v_po.status in ('confirmed', 'in_transit', 'partial')
        and exists (select 1 from jsonb_array_elements(v_po.items) x
          where app_private.procurement_po_line_undelivered(v_po.id, v_po.items, coalesce(x.value->>'lineId', x.value->>'itemId')) > 0),
      'canCloseShort', v_hub and v_manage and v_po.status in ('confirmed', 'in_transit', 'partial')
        and not app_private.procurement_po_has_open_delivery(v_po.id)
        and exists (select 1 from jsonb_array_elements(v_po.items) x
          where coalesce(nullif(x.value->>'receivedQty', '')::numeric, 0) < coalesce(nullif(x.value->>'qty', '')::numeric, 0) - 0.0005)),
    'approvers', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.name)
      from public.users u where u.id <> v_actor and u.is_active and u.account_status = 'ACTIVE'
        and (u.role = 'ADMIN' or app_private.has_permission(u.id, 'system.procurement.manage'))), '[]'::jsonb)
  );
end;
$function$
;

create or replace function app_private.procurement_receipt_document(r app_private.procurement_source_receipts)
returns jsonb language plpgsql stable set search_path='' as $$
declare lines jsonb; progress text:='new'; ordered integer:=0; received integer:=0; partial integer:=0;
begin
 if r.snapshot ? 'purchaseNeeds' then
  -- Inbox badges only need aggregate quantities; asset cards are loaded on drill-down.
  select jsonb_agg(jsonb_build_object('qty',(x->>'Số lượng')::numeric,
    'orderedQty',coalesce((select sum(app_private.request_purchase_committed_qty(l)) from app_private.request_purchase_po_links l join public.purchase_orders p on p.id=l.purchase_order_id where l.request_id=r.source_id and l.revision=r.revision and l.line_id=x->>'_id' and p.status<>'cancelled' and p.archived_at is null),0),
    'receivedQty',coalesce((select sum(d.accepted_stock_qty) from app_private.request_purchase_po_links l join public.purchase_order_delivery_lines d on d.purchase_order_id=l.purchase_order_id and d.purchase_order_line_id=l.po_line_id join public.purchase_order_delivery_batches b on b.id=d.delivery_batch_id where l.request_id=r.source_id and l.revision=r.revision and l.line_id=x->>'_id' and b.status in ('received','received_short','received_over')),0)))
   into lines from jsonb_array_elements(r.snapshot->'purchaseNeeds') x;
  select count(*) filter(where (x->>'orderedQty')::numeric >= (x->>'qty')::numeric),
   count(*) filter(where (x->>'receivedQty')::numeric >= (x->>'qty')::numeric),
   count(*) filter(where (x->>'orderedQty')::numeric>0 and (x->>'orderedQty')::numeric<(x->>'qty')::numeric)
  into ordered,received,partial from jsonb_array_elements(lines) x;
  progress:=case when received=jsonb_array_length(lines) then 'received' when ordered=jsonb_array_length(lines) then 'ordered' when ordered+partial>0 then 'partial' else 'new' end;
 end if;
 return r.document||jsonb_build_object('sourceRevision',r.revision,'intakeState',r.state,
 'progress',case when r.state='withdrawn' or r.closed_at is not null then 'closed' else progress end,
 'orderedLines',ordered,'partialLines',partial,'receivedLines',received,
 'closedAt',case when r.state='withdrawn' then coalesce(r.withdrawn_at,r.closed_at,r.received_at) else r.closed_at end,
 'closeReason',coalesce(r.withdrawn_reason,r.close_reason),'closedByName',(select name from public.users where id=r.closed_by),
 'assigneeUserId',r.assignee_id,'assigneeName',(select name from public.users where id=r.assignee_id));
end $$;

-- Each linked asset is serialized; both receipt representations must stay 1:1.
create function app_private.request_purchase_delivery_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare l app_private.request_purchase_po_links;
begin
 select * into l from app_private.request_purchase_po_links where purchase_order_id=new.purchase_order_id;
 if not found then return new; end if;
 if tg_table_name='purchase_order_delivery_batches' then
  new.target_warehouse_id:=coalesce(new.target_warehouse_id,l.warehouse_id);
  if new.target_warehouse_id is distinct from l.warehouse_id or new.fulfillment_mode<>'RECEIVE_TO_STOCK' then raise exception 'REQUEST_PURCHASE_LOCKED'; end if;
 else
  if new.purchase_order_line_id<>l.po_line_id or new.item_id<>l.item_id or new.stock_planned_qty is distinct from new.planned_qty
   or new.accepted_stock_qty is distinct from new.accepted_qty then raise exception 'REQUEST_PURCHASE_UNIT'; end if;
  if l.kind='asset' and (new.planned_qty<>trunc(new.planned_qty) or new.accepted_qty<>trunc(new.accepted_qty)) then raise exception 'REQUEST_ASSET_WHOLE_UNITS'; end if;
 end if;
 return new;
end $$;
revoke all on function app_private.request_purchase_delivery_guard() from public,anon,authenticated;
create trigger request_purchase_delivery_guard before insert or update on public.purchase_order_delivery_batches for each row execute function app_private.request_purchase_delivery_guard();
create trigger request_purchase_delivery_guard before insert or update on public.purchase_order_delivery_lines for each row execute function app_private.request_purchase_delivery_guard();

CREATE OR REPLACE FUNCTION app_private.procurement_bridge_list(p_filter jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare base jsonb; extra jsonb; counts jsonb; active_n integer; unassigned_n integer; f jsonb:=coalesce(p_filter,'{}');
begin
 if not app_private.procurement_can('view') then raise exception 'PROCUREMENT_VIEW_DENIED' using errcode='42501'; end if;
 base:=app_private.procurement_legacy_list_v1(f);
 select coalesce(jsonb_agg(doc order by doc->>'approvedAt'),'[]') into extra from (
  select app_private.procurement_receipt_document(r) doc from app_private.procurement_source_receipts r
 ) d where (nullif(f->>'source','') is null or doc->>'sourceType'=f->>'source')
 and nullif(f->>'projectId','') is null
 and (nullif(f->>'assigneeId','') is null or (f->>'assigneeId'='none' and doc->>'assigneeUserId' is null) or doc->>'assigneeUserId'=f->>'assigneeId')
 and (coalesce(f->>'progress','open')='all' or (coalesce(f->>'progress','open')='open' and doc->>'progress' in ('new','partial','ordered','received')) or doc->>'progress'=f->>'progress')
 and (nullif(f->>'search','') is null or lower(concat_ws(' ',doc->>'code',doc->>'title',doc->>'requesterName')) like '%'||lower(f->>'search')||'%');
 select count(*),count(*) filter(where assignee_id is null) into active_n,unassigned_n from app_private.procurement_source_receipts where state='received' and closed_at is null;
 select jsonb_build_object('request',count(*) filter(where source_type='request'),'workflow',count(*) filter(where source_type='workflow')) into counts
 from app_private.procurement_source_receipts where state='received' and closed_at is null;
 return base||jsonb_build_object('documents',(base->'documents')||extra,'sourceCounts',(base->'sourceCounts')||counts,
 'stages',(base->'stages')||jsonb_build_object('intake',(base->'stages'->>'intake')::integer+active_n,'unassigned',(base->'stages'->>'unassigned')::integer+unassigned_n));
end $function$
;

-- This release supports receipt and staff custody, not disposal to suppliers.
-- Stop legacy material-return/stock-transfer commands from moving serialized assets as stock.
create function app_private.request_purchase_asset_movement_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='purchase_order_supplier_returns' then
  if exists(select 1 from app_private.request_purchase_po_links where purchase_order_id=new.purchase_order_id and kind='asset') then
   raise exception 'Tài sản mua theo Yêu cầu phải được thu hồi và xử lý theo hồ sơ tài sản; chưa hỗ trợ trả NCC bằng phiếu vật tư.';
  end if;
 elsif exists(select 1 from app_private.request_purchase_assets where asset_id=new.asset_id) then
  raise exception 'Tài sản mua theo Yêu cầu được cấp phát hoặc luân chuyển tại Tài sản → Cấp phát.';
 end if;
 return new;
end $$;
revoke all on function app_private.request_purchase_asset_movement_guard() from public,anon,authenticated;
create trigger request_purchase_asset_movement_guard before insert on public.purchase_order_supplier_returns for each row execute function app_private.request_purchase_asset_movement_guard();
create trigger request_purchase_asset_movement_guard before insert on public.asset_transfers for each row execute function app_private.request_purchase_asset_movement_guard();

CREATE OR REPLACE FUNCTION public.list_procurement_proactive_candidates_v1(p_source_type text, p_source_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_doc record;
begin
  if not app_private.procurement_can('view') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_VIEW_DENIED'; end if;
  select d.* into v_doc from app_private.procurement_inbox_documents() d
  where d.source_type = p_source_type and d.source_id = p_source_id;
  if not found then raise exception using errcode = 'PT404', message = 'PROCUREMENT_SOURCE_NOT_FOUND'; end if;
  if v_doc.closed_at is not null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'needLineId', l.line_id, 'itemId', l.item_id, 'itemName', l.item_name, 'unit', l.unit,
      'remainingQty', round(greatest(l.need_qty - l.ordered_qty, 0), 6),
      'purchaseOrderId', o.id, 'poNumber', o.po_number, 'status', o.status, 'vendorName', o.vendor_name,
      'expectedDeliveryDate', app_private.procurement_date_or_null(o.expected_delivery_date),
      'poLineId', x.value->>'lineId',
      'lineStockQty', app_private.procurement_po_line_stock_qty(x.value),
      'unallocatedQty', round(app_private.procurement_po_line_stock_qty(x.value) - app_private.procurement_po_line_link_total(o.id, x.value->>'lineId'), 6),
      'reasonCode', o.metadata->'proactive'->>'reasonCode') order by l.item_name, o.po_number)
    from app_private.procurement_inbox_lines() l
    join public.purchase_orders o on o.source_mode = 'proactive_project' and app_private.procurement_po_is_hub(o.metadata)
      and o.archived_at is null and app_private.procurement_proactive_linkable(o.status)
      and o.project_id = v_doc.project_id
      and (v_doc.construction_site_id is null or o.construction_site_id is null or o.construction_site_id = v_doc.construction_site_id)
    cross join lateral jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) x
    where not exists(select 1 from app_private.request_purchase_po_links rp where rp.purchase_order_id=o.id) and l.source_type = p_source_type and l.source_id = p_source_id
      and x.value->>'itemId' = l.item_id and l.need_qty - l.ordered_qty > 0.0005
      and app_private.procurement_po_line_stock_qty(x.value) - app_private.procurement_po_line_link_total(o.id, x.value->>'lineId') > 0.0005
      and not exists (select 1 from public.purchase_order_request_lines k where p_source_type = 'material_request'
        and k.purchase_order_id = o.id and k.material_request_id = p_source_id and k.request_line_id = l.line_id)
      and not exists (select 1 from public.procurement_po_plan_links k where p_source_type = 'material_plan'
        and k.purchase_order_id = o.id and k.material_plan_line_id::text = l.line_id)), '[]'::jsonb);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.list_procurement_orders_v1(p_filter jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_filter jsonb := coalesce(p_filter, '{}'::jsonb); v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_actor text := public.current_app_user_id()::text;
begin
  if not app_private.procurement_can('view') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_VIEW_DENIED'; end if;
  return (
    with pos as (
      select o.*, app_private.procurement_po_stage(o.status) stage,
        app_private.procurement_date_or_null(o.expected_delivery_date) expected_date,
        app_private.procurement_po_is_hub(o.metadata) is_hub,
        app_private.procurement_po_awaits_me(o.id, o.status, o.submitted_to_user_id, v_actor) awaits_me,
        coalesce(pr.code, case when app_private.procurement_po_is_group(o.metadata) then (select 'Đơn gom ' || string_agg(distinct p2.code, ', ')
          from public.purchase_order_request_lines k join public.projects p2 on p2.id = k.project_id where k.purchase_order_id = o.id) end) project_code,
        pr.name project_name, app_private.procurement_po_is_group(o.metadata) is_group,
        (select array_agg(distinct k.project_id) from public.purchase_order_request_lines k where k.purchase_order_id = o.id) link_projects,
        (select u.name from public.users u where u.id::text = o.created_by_id) created_by_name,
        (select coalesce(sum(nullif(x.value->>'qty', '')::numeric), 0) from jsonb_array_elements(
          case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) x) qty_total,
        (select coalesce(sum(least(coalesce(nullif(x.value->>'receivedQty', '')::numeric, 0), coalesce(nullif(x.value->>'qty', '')::numeric, 0))), 0)
          from jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) x) qty_received
      from public.purchase_orders o left join public.projects pr on pr.id = o.project_id
      where o.archived_at is null and o.status <> 'cancelled'
    ),
    filtered as (
      select *, row_number() over (order by case when awaits_me then 0 else 1 end,
        expected_date nulls last, created_at desc) rn
      from pos
      where (coalesce(v_filter->>'stage', 'all') = 'all' or stage = v_filter->>'stage')
        and (nullif(v_filter->>'projectId', '') is null or project_id = v_filter->>'projectId' or (is_group and v_filter->>'projectId' = any(link_projects)))
        and (coalesce(v_filter->>'mine', 'false') <> 'true' or created_by_id = v_actor or submitted_to_user_id = v_actor)
        and (nullif(v_filter->>'search', '') is null or lower(concat_ws(' ', po_number, vendor_name, project_code, project_name))
          like '%' || lower(v_filter->>'search') || '%')
    )
    select jsonb_build_object(
      'today', v_today,
      'orders', coalesce((select jsonb_agg(jsonb_build_object(
          'id', f.id, 'poNumber', f.po_number, 'status', f.status, 'stage', f.stage, 'isHub', f.is_hub, 'isGroup', f.is_group,
          'vendorName', f.vendor_name, 'projectId', f.project_id, 'projectCode', f.project_code, 'projectName', f.project_name,
          'constructionSiteId', f.construction_site_id, 'totalAmount', f.total_amount, 'vatRate', f.vat_rate,
          'orderDate', f.order_date, 'expectedDeliveryDate', f.expected_date,
          'late', f.stage in ('ordered', 'delivering') and f.expected_date < v_today,
          'lineCount', jsonb_array_length(case when jsonb_typeof(f.items) = 'array' then f.items else '[]'::jsonb end),
          'qtyTotal', f.qty_total, 'qtyReceived', f.qty_received,
          'createdById', f.created_by_id, 'createdByName', f.created_by_name,
          'submittedToUserId', f.submitted_to_user_id, 'submittedToName', f.submitted_to_name,
          'awaitingMe', f.awaits_me, 'purchaseMode', f.purchase_mode,
          'kind', case when f.source_mode in ('proactive_project', 'proactive_stock') then 'proactive' else 'need' end,
          'returnsPending', (select count(*) from public.purchase_order_supplier_returns r where r.purchase_order_id = f.id and r.status <> 'cancelled' and r.resolution is null),
          'sources', app_private.procurement_po_sources(f.id)||coalesce((select jsonb_agg(jsonb_build_object('sourceType','request','sourceId',rp.request_id,'code',r.document->>'code')) from app_private.request_purchase_po_links rp join app_private.procurement_source_receipts r on r.source_type='request' and r.source_id=rp.request_id where rp.purchase_order_id=f.id),'[]'::jsonb)) order by f.rn) from filtered f where f.rn <= 300), '[]'::jsonb),
      'awaitingMyApproval', (select count(*) from pos where awaits_me)
    )
  );
end;
$function$
;

create function app_private.request_purchase_allocation_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from app_private.request_purchase_po_links where purchase_order_id=new.purchase_order_id) then raise exception 'REQUEST_PURCHASE_LOCKED'; end if;
 return new;
end $$;
revoke all on function app_private.request_purchase_allocation_guard() from public,anon,authenticated;
create trigger request_purchase_allocation_guard before insert or update on public.purchase_order_request_lines for each row execute function app_private.request_purchase_allocation_guard();
create trigger request_purchase_allocation_guard before insert or update on public.procurement_po_plan_links for each row execute function app_private.request_purchase_allocation_guard();

CREATE OR REPLACE FUNCTION public.close_procurement_po_short_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_return boolean := coalesce((p_input->>'returnToNeed')::boolean, true);
  v_po public.purchase_orders%rowtype;
  v_short numeric;
begin
  if not app_private.procurement_can('manage') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'PROCUREMENT_CLOSE_REASON_REQUIRED'; end if;
  select * into v_po from public.purchase_orders where id = p_input->>'purchaseOrderId' for update;
  if not found or not app_private.procurement_po_is_hub(v_po.metadata) or v_po.archived_at is not null then
    raise exception using errcode = 'PT404', message = 'PROCUREMENT_PO_NOT_FOUND'; end if;
  if v_po.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
    raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
  if v_po.status not in ('confirmed', 'in_transit', 'partial') then
    raise exception using errcode = '22023', message = 'PROCUREMENT_DELIVERY_PO_STATE'; end if;
  if app_private.procurement_po_has_open_delivery(v_po.id) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_DELIVERY_STILL_OPEN'; end if;

  -- Shortfall in stock units across need links, before shrinking them.
  select coalesce(sum(greatest(q.ordered_qty - app_private.procurement_link_received_v2(v_po.id, v_po.items, q.line_id, q.ordered_qty, q.id), 0)), 0)
  into v_short from (
    select id, purchase_order_line_id line_id, ordered_qty from public.purchase_order_request_lines where purchase_order_id = v_po.id
    union all select id, purchase_order_line_id, ordered_qty from public.procurement_po_plan_links where purchase_order_id = v_po.id) q;

  if exists(select 1 from app_private.request_purchase_po_links where purchase_order_id=v_po.id) then
    select greatest(l.qty-coalesce((select sum(d.accepted_stock_qty) from public.purchase_order_delivery_lines d join public.purchase_order_delivery_batches b on b.id=d.delivery_batch_id where d.purchase_order_id=l.purchase_order_id and d.purchase_order_line_id=l.po_line_id and b.status in ('received','received_short','received_over')),0),0)
    into v_short from app_private.request_purchase_po_links l where l.purchase_order_id=v_po.id;
  end if;
  perform set_config('app.procurement_hub_context', 'on', true);
  perform set_config('app.material_transition_context', 'on', true);
  if v_return then
    -- Each need keeps only what actually arrived, so the rest shows again under Cần mua.
    update public.purchase_order_request_lines l
    set ordered_qty = r.received, ordered_stock_qty_snapshot = r.received
    from (select id, round(app_private.procurement_link_received_v2(v_po.id, v_po.items, purchase_order_line_id, ordered_qty, id), 6) received
          from public.purchase_order_request_lines where purchase_order_id = v_po.id) r
    where l.id = r.id;
    delete from public.procurement_po_plan_links k
    where k.purchase_order_id = v_po.id and app_private.procurement_link_received_v2(v_po.id, v_po.items, k.purchase_order_line_id, k.ordered_qty, k.id) <= 0;
    update public.procurement_po_plan_links k
    set ordered_qty = round(app_private.procurement_link_received_v2(v_po.id, v_po.items, k.purchase_order_line_id, k.ordered_qty, k.id), 6)
    where k.purchase_order_id = v_po.id;
  end if;
  update public.purchase_orders
  set status = 'closed', closed_need_qty = coalesce(closed_need_qty, 0) + v_short,
      last_action_by = v_actor::text, last_action_at = now(),
      metadata = metadata || jsonb_build_object('shortClose', jsonb_build_object('reason', v_reason, 'returnToNeed', v_return,
        'shortStockQty', round(v_short, 3), 'at', now(), 'by', (select name from public.users where id = v_actor)))
  where id = v_po.id returning * into v_po;
  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('purchase_order', v_po.id, 'close_short', v_actor, v_reason, jsonb_build_object('returnToNeed', v_return, 'shortStockQty', v_short));
  perform set_config('app.procurement_hub_context', 'off', true);
  perform set_config('app.material_transition_context', 'off', true);
  return jsonb_build_object('purchaseOrderId', v_po.id, 'status', v_po.status, 'shortStockQty', v_short, 'returnToNeed', v_return);
end;
$function$
;
