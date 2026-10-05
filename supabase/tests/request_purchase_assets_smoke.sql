-- Run only via scripts/office/cloud-rollback.mjs. All fixtures and RPC changes roll back.
create function pg_temp.rpa_assert(ok boolean,msg text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'REQUEST ASSET TEST: %',msg; end if; end $$;
create function pg_temp.rpa_as(uid uuid) returns void language plpgsql as $$ begin
 perform set_config('request.jwt.claim.sub',coalesce((select auth_id::text from public.users where id=uid),''),true);
 perform set_config('request.jwt.claims',coalesce((select jsonb_build_object('sub',auth_id,'email',email,'role','authenticated')::text from public.users where id=uid),'{}'),true);
end $$;
do $$ declare admin_id uuid; creator uuid; rt uuid:=gen_random_uuid(); rv uuid:=gen_random_uuid(); rid uuid; rowid text:=gen_random_uuid()::text;
 wh text; category text; item public.items; vendor text; rows jsonb; result jsonb; detail jsonb; payload jsonb; before_count integer; denied boolean; poid text; poline text;
 rv2 uuid:=gen_random_uuid(); rid2 uuid; off_id uuid; stock_before numeric; batch uuid; tx text; dl uuid; aid text; assignment jsonb; receipt jsonb;
begin
 select id into strict admin_id from public.users where email='admin@khoviet.vn';
 select id into creator from public.users where is_active and account_status='ACTIVE' and auth_id is not null and id<>admin_id order by id limit 1;
 select id into wh from public.warehouses where type='GENERAL' and not coalesce(is_archived,false) order by id limit 1;
 select id into category from public.asset_categories order by id limit 1;
 select * into item from public.items where nullif(unit,'') is not null order by id limit 1;
 select id into vendor from public.business_partners where coalesce(is_active,true) order by id limit 1;
 perform pg_temp.rpa_assert(wh is not null and category is not null and item.id is not null and vendor is not null,'fixtures available');
 perform pg_temp.rpa_as(admin_id);
 select count(*) into before_count from app_private.procurement_source_receipts;
 update public.request_instances set updated_at=now() where code='RQ-2026-000052';
 perform pg_temp.rpa_assert((select count(*)=before_count from app_private.procurement_source_receipts),'no backfill existing approved request');
 insert into public.request_templates(id,name,created_by) values(rt,'ROLLBACK standard purchasing',admin_id);
 insert into public.request_template_versions(id,request_template_id,version_number,form_schema,usage_scope,flow_mode,completion_policy,status,created_by)
 values(rv,rt,1,'[{"key":"purchase_need_v1","label":"Nhu cầu","fieldType":"table","required":true,"options":["Tên hàng","Đơn vị","Số lượng","Kho nhận","Ngày cần"]}]',
 '{"companyWide":true,"orgUnitIds":[],"userIds":[],"permissionCodes":[]}','SEQUENTIAL','ALL','DRAFT',admin_id);
 insert into public.request_approval_blocks(request_template_version_id,block_key,name,sort_order,approver_source,fixed_user_ids) values(rv,'final','Final',0,'FIXED_SINGLE',array[admin_id]);
 perform public.publish_request_template_version(rt,(select updated_at from public.request_templates where id=rt));
 rows:=jsonb_build_object('purchase_need_v1',jsonb_build_array(jsonb_build_object('_id',rowid,'Tên hàng','ROLLBACK laptop','Quy cách','Kiểm thử rollback','Đơn vị',item.unit,'Số lượng','2','Loại hàng','Tài sản','_warehouseId',wh,'Kho nhận','FORGED NAME','Ngày cần','2026-10-10','_categoryId',category,'_recipientId',creator)));
 perform pg_temp.rpa_as(creator);
 denied:=false; begin perform public.submit_request(rv,'ROLLBACK invalid','test',jsonb_set(rows,array['purchase_need_v1','0','_warehouseId'],'"invalid"'),'{}',gen_random_uuid()::text); exception when others then denied:=sqlerrm='REQUEST_PURCHASE_INVALID'; end;
 perform pg_temp.rpa_assert(denied,'unknown warehouse rejected at submit');
 result:=public.submit_request(rv,'ROLLBACK standard assets','Rollback only',rows,'{}',gen_random_uuid()::text); rid:=(result->>'requestId')::uuid;
 perform pg_temp.rpa_assert(not exists(select 1 from app_private.procurement_source_receipts where source_id=rid),'pending not dispatched');
 perform pg_temp.rpa_as(admin_id);
 perform public.act_on_request(rid,'APPROVE','Rollback approval',null,null,gen_random_uuid()::text,(select updated_at from public.request_instances where id=rid));
 detail:=public.get_procurement_inbox_document_v1('request',rid::text);
 perform pg_temp.rpa_assert(detail->>'orderable'='true' and detail->>'warehouseId'=wh and detail->>'neededDate'='2026-10-10','standard header passes to purchasing');
 perform pg_temp.rpa_assert(detail#>>'{purchaseLines,0,warehouseName}'<>'FORGED NAME' and detail#>>'{purchaseLines,0,qty}'='2','canonical names and approved quantity');
 payload:=jsonb_build_object('requestId',rid,'revision',1,'lineId',rowid,'itemId',item.id,'qty',2,'vendorId',vendor,'unitPrice',100000,'vatRate',10,'key',gen_random_uuid());
 result:=public.create_request_purchase_order_v1(payload); poid:=result->>'purchaseOrderId';
 perform pg_temp.rpa_assert(poid is not null,'linked PO created');
 perform pg_temp.rpa_assert(public.create_request_purchase_order_v1(payload)->>'purchaseOrderId'=poid,'repeated submit idempotent');
 denied:=false; begin perform public.create_request_purchase_order_v1(payload||jsonb_build_object('key',gen_random_uuid(),'qty',1)); exception when others then denied:=sqlerrm='REQUEST_PURCHASE_QTY'; end;
 perform pg_temp.rpa_assert(denied,'over-order rejected');
 perform set_config('app.procurement_hub_context','on',true);
 denied:=false; begin update public.purchase_orders set items=jsonb_set(items,'{0,stockQty}','3') where id=poid; exception when others then denied:=sqlerrm='REQUEST_PURCHASE_LOCKED'; end;
 perform pg_temp.rpa_assert(denied,'cannot edit linked ordered quantity through generic PO');
 select items->0->>'lineId' into poline from public.purchase_orders where id=poid;
 -- Grant only inside rollback to exercise the real submit/approve commands with two people.
 insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,is_active,granted_by,granted_at,grant_reason)
 values(creator,'system.procurement.manage','global','*',true,admin_id,now(),'ROLLBACK fixture')
 on conflict(user_id,permission_code,scope_type,scope_id) do update set is_active=true,expires_at=null;
 perform public.transition_procurement_hub_po_v1(jsonb_build_object('purchaseOrderId',poid,'expectedRowVersion',(select row_version from public.purchase_orders where id=poid),'action','submit','approverUserId',creator));
 perform pg_temp.rpa_as(creator);
 perform public.transition_procurement_hub_po_v1(jsonb_build_object('purchaseOrderId',poid,'expectedRowVersion',(select row_version from public.purchase_orders where id=poid),'action','approve'));
 perform pg_temp.rpa_as(admin_id);
 perform pg_temp.rpa_assert((select status='confirmed' from public.purchase_orders where id=poid),'PO approval completes through public commands');
 denied:=false; begin update public.request_instances set status='CANCELLED' where id=rid; exception when others then denied:=sqlerrm='REQUEST_PURCHASE_HAS_ORDERS'; end;
 perform pg_temp.rpa_assert(denied,'source cannot change under an active commitment');
 result:=public.save_procurement_delivery_v1(jsonb_build_object('purchaseOrderId',poid,'vatRate',10,'plannedDate','2026-10-10','lines',jsonb_build_array(jsonb_build_object('purchaseOrderLineId',poline,'purchaseQty',1,'stockQty',1,'unitPrice',100000))));
 batch:=(result->>'deliveryId')::uuid;
 select wms_transaction_id into tx from public.purchase_order_delivery_batches where id=batch;
 select id into dl from public.purchase_order_delivery_lines where delivery_batch_id=batch;
 receipt:=jsonb_build_array(jsonb_build_object('deliveryLineId',dl,'itemId',item.id,'acceptedPurchaseQty',1,'acceptedStockQty',1,'deliveredQty',1,'deliveredStockQty',1));
 result:=public.receive_purchase_delivery_v1(batch,tx,'passed',receipt,'[]');
 perform pg_temp.rpa_assert((select count(*)=1 from app_private.request_purchase_assets a join app_private.request_purchase_po_links l on l.id=a.link_id where l.purchase_order_id=poid),'partial receipt creates exactly one asset');
 perform public.receive_purchase_delivery_v1(batch,tx,'passed',receipt,'[]');
 perform pg_temp.rpa_assert((select count(*)=1 from app_private.request_purchase_assets a join app_private.request_purchase_po_links l on l.id=a.link_id where l.purchase_order_id=poid),'receipt retry creates no duplicate');
 select a.asset_id into aid from app_private.request_purchase_assets a where a.delivery_line_id=dl;
 perform pg_temp.rpa_assert((select status='AVAILABLE' and assigned_to_user_id is null and not is_fixed_asset from public.assets where id=aid),'not automatically assigned or fixed-asset classified');
 perform pg_temp.rpa_assert((select stock_by_warehouse is not distinct from item.stock_by_warehouse from public.items where id=item.id),'asset receipt does not duplicate WMS inventory');
 denied:=false; begin perform public.record_asset_assignment(jsonb_build_object('id','denied-test','asset_id',aid,'type','assign','user_id',creator)); exception when insufficient_privilege then denied:=true; end;
 perform pg_temp.rpa_assert(denied,'procurement permission alone cannot assign an asset');
 -- A test-only permission grant proves the existing business permission remains required.
 insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,is_active,granted_by,granted_at,grant_reason)
 select admin_id,p,'global','*',true,admin_id,now(),'ROLLBACK fixture' from unnest(array['asset.assignment.assign','asset.assignment.return']) p
 on conflict(user_id,permission_code,scope_type,scope_id) do update set is_active=true,expires_at=null;
 assignment:=jsonb_build_object('id','rollback-assignment-'||gen_random_uuid(),'asset_id',aid,'type','assign','user_id',creator,'user_name','FORGED','performed_by',creator);
 perform public.record_asset_assignment(assignment);
 perform public.record_asset_assignment(assignment);
 perform pg_temp.rpa_assert((select status='IN_USE' and assigned_to_user_id=creator::text from public.assets where id=aid),'confirmed handover updates holder');
 perform pg_temp.rpa_assert((select sum(qty)=1 and count(*)=1 and bool_and(assigned_to_user_id=creator::text) from public.asset_location_stocks where asset_id=aid),'custody quantity transferred once');
 perform public.record_asset_assignment(jsonb_build_object('id','rollback-return-'||gen_random_uuid(),'asset_id',aid,'type','return','user_id',creator));
 perform pg_temp.rpa_assert((select status='AVAILABLE' and assigned_to_user_id is null from public.assets where id=aid),'return releases asset');
 detail:=public.get_procurement_inbox_document_v1('request',rid::text);
 perform pg_temp.rpa_assert(detail#>>'{purchaseLines,0,receivedQty}'='1' and jsonb_array_length(detail#>'{purchaseLines,0,assets}')=1,'receipt and asset visible at source');
 perform pg_temp.rpa_assert(not exists(select 1 from public.inventory_transactions where source_type='wms_transaction' and source_id=tx),'no duplicate inventory valuation');
 perform pg_temp.rpa_assert((select count(*)=1 from public.supplier_payable_documents where source_type='purchase_delivery_receipt' and source_id=batch::text),'one payable per actual receipt');
 result:=public.close_procurement_po_short_v1(jsonb_build_object('purchaseOrderId',poid,'expectedRowVersion',(select row_version from public.purchase_orders where id=poid),'reason','ROLLBACK vendor cannot finish','returnToNeed',true));
 perform pg_temp.rpa_assert(result->>'shortStockQty'='1','short-close accounts for Request source');
 detail:=public.get_procurement_inbox_document_v1('request',rid::text);
 perform pg_temp.rpa_assert(detail#>>'{purchaseLines,0,orderedQty}'='1','unreceived balance returns to need');
 payload:=payload||jsonb_build_object('qty',1,'key',gen_random_uuid());
 result:=public.create_request_purchase_order_v1(payload); poid:=result->>'purchaseOrderId';
 perform public.transition_procurement_hub_po_v1(jsonb_build_object('purchaseOrderId',poid,'expectedRowVersion',(select row_version from public.purchase_orders where id=poid),'action','submit','approverUserId',creator));
 perform pg_temp.rpa_as(creator);
 perform public.transition_procurement_hub_po_v1(jsonb_build_object('purchaseOrderId',poid,'expectedRowVersion',(select row_version from public.purchase_orders where id=poid),'action','approve'));
 perform pg_temp.rpa_as(admin_id);
 select items->0->>'lineId' into poline from public.purchase_orders where id=poid;
 result:=public.save_procurement_delivery_v1(jsonb_build_object('purchaseOrderId',poid,'vatRate',10,'plannedDate','2026-10-10','lines',jsonb_build_array(jsonb_build_object('purchaseOrderLineId',poline,'purchaseQty',1,'stockQty',1,'unitPrice',100000))));
 batch:=(result->>'deliveryId')::uuid;
 select wms_transaction_id into tx from public.purchase_order_delivery_batches where id=batch;
 select id into dl from public.purchase_order_delivery_lines where delivery_batch_id=batch;
 receipt:=jsonb_build_array(jsonb_build_object('deliveryLineId',dl,'itemId',item.id,'acceptedPurchaseQty',1,'acceptedStockQty',1));
 perform public.receive_purchase_delivery_v1(batch,tx,'passed',receipt,'[]');
 detail:=public.get_procurement_inbox_document_v1('request',rid::text);
 perform pg_temp.rpa_assert(detail->>'progress'='received' and jsonb_array_length(detail#>'{purchaseLines,0,assets}')=2,'second partial completes only the remaining asset');
 -- An in-flight v1 request retains its connection when the template publishes v2 without it.
 rows:=jsonb_set(jsonb_set(rows,'{purchase_need_v1,0,Loại hàng}','"Vật tư"'),'{purchase_need_v1,0,Số lượng}','"1.5"');
 perform pg_temp.rpa_as(creator);
 result:=public.submit_request(rv,'ROLLBACK material','test',rows,'{}',gen_random_uuid()::text); rid2:=(result->>'requestId')::uuid;
 perform pg_temp.rpa_as(admin_id);
 insert into public.request_template_versions(id,request_template_id,version_number,form_schema,usage_scope,flow_mode,completion_policy,status,created_by)
 values(rv2,rt,2,'[{"key":"reason","label":"Lý do","fieldType":"text","required":true,"options":[]}]','{"companyWide":true,"orgUnitIds":[],"userIds":[],"permissionCodes":[]}','SEQUENTIAL','ALL','DRAFT',admin_id);
 insert into public.request_approval_blocks(request_template_version_id,block_key,name,sort_order,approver_source,fixed_user_ids) values(rv2,'final','Final',0,'FIXED_SINGLE',array[admin_id]);
 perform public.publish_request_template_version(rt,(select updated_at from public.request_templates where id=rt));
 perform public.act_on_request(rid2,'APPROVE','Rollback old version',null,null,gen_random_uuid()::text,(select updated_at from public.request_instances where id=rid2));
 perform pg_temp.rpa_assert(exists(select 1 from app_private.procurement_source_receipts where source_id=rid2),'inflight version still connected');
 perform pg_temp.rpa_as(creator);
 result:=public.submit_request(rv2,'ROLLBACK disconnected','test','{"reason":"No purchasing"}','{}',gen_random_uuid()::text); off_id:=(result->>'requestId')::uuid;
 perform pg_temp.rpa_as(admin_id);
 perform public.act_on_request(off_id,'APPROVE','Rollback disabled',null,null,gen_random_uuid()::text,(select updated_at from public.request_instances where id=off_id));
 perform pg_temp.rpa_assert(not exists(select 1 from app_private.procurement_source_receipts where source_id=off_id),'disabled version not dispatched');
 -- Materials still post to the original warehouse ledger, including fractional units.
 payload:=payload||jsonb_build_object('requestId',rid2,'qty',1.5,'key',gen_random_uuid());
 result:=public.create_request_purchase_order_v1(payload); poid:=result->>'purchaseOrderId';
 perform public.transition_procurement_hub_po_v1(jsonb_build_object('purchaseOrderId',poid,'expectedRowVersion',(select row_version from public.purchase_orders where id=poid),'action','submit','approverUserId',creator));
 perform pg_temp.rpa_as(creator);
 perform public.transition_procurement_hub_po_v1(jsonb_build_object('purchaseOrderId',poid,'expectedRowVersion',(select row_version from public.purchase_orders where id=poid),'action','approve'));
 perform pg_temp.rpa_as(admin_id);
 select items->0->>'lineId' into poline from public.purchase_orders where id=poid;
 select coalesce((stock_by_warehouse->>wh)::numeric,0) into stock_before from public.items where id=item.id;
 result:=public.save_procurement_delivery_v1(jsonb_build_object('purchaseOrderId',poid,'vatRate',10,'plannedDate','2026-10-10','lines',jsonb_build_array(jsonb_build_object('purchaseOrderLineId',poline,'purchaseQty',1.5,'stockQty',1.5,'unitPrice',100000))));
 batch:=(result->>'deliveryId')::uuid;
 select wms_transaction_id into tx from public.purchase_order_delivery_batches where id=batch;
 select id into dl from public.purchase_order_delivery_lines where delivery_batch_id=batch;
 receipt:=jsonb_build_array(jsonb_build_object('deliveryLineId',dl,'itemId',item.id,'acceptedPurchaseQty',1.5,'acceptedStockQty',1.5));
 perform public.receive_purchase_delivery_v1(batch,tx,'passed',receipt,'[]');
 perform pg_temp.rpa_assert((select (stock_by_warehouse->>wh)::numeric=stock_before+1.5 from public.items where id=item.id),'material stock increases once');
 perform pg_temp.rpa_assert(not exists(select 1 from app_private.request_purchase_assets where delivery_line_id=dl),'material receipt creates no assets');
 perform pg_temp.rpa_as(null);
 denied:=false; begin perform public.create_request_purchase_order_v1(payload); exception when insufficient_privilege then denied:=true; end;
 perform pg_temp.rpa_assert(denied,'unauthenticated order denied');
end $$;
set local role authenticated;
do $$ begin
 begin perform * from app_private.request_purchase_po_links; raise exception 'private links exposed'; exception when insufficient_privilege then null; end;
 begin perform app_private.request_purchase_legacy_assignment('{}'); raise exception 'legacy assignment bypass'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: Request approval, canonical destination/date, PO idempotency/limits, partial receipt, asset custody and authorization' as result;
