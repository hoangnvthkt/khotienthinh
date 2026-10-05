import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import { RequestPurchaseNeedEditor } from '../../components/request/RequestPurchaseNeedEditor';
import { RequestPurchaseOutput } from '../../components/request/template/RequestPurchaseOutput';
import { RequestPurchaseLines } from '../../components/procurement/hub/RequestPurchaseLines';
import { requestPurchaseService } from '../../lib/requestPurchaseService';
import { procurementInboxService, type ProcurementInboxDetail } from '../../lib/procurementInboxService';
import { emptyPurchaseNeed, purchaseNeedField, type PurchaseNeedRow } from '../../lib/requestPurchaseNeed';
import type { RequestTemplateFieldSchema } from '../../types';
requestPurchaseService.options = async () => ({ warehouses: [{ id: 'wh1', name: 'Kho Văn phòng Tiến Thịnh' }], categories: [{ id: 'it', name: 'Máy tính và thiết bị văn phòng' }] });
procurementInboxService.searchItems = async () => [{ id:'laptop', name:'Máy tính xách tay',sku:'MT-01',unit:'Cái',purchaseUnit:null,purchaseFactor:null,inBoq:false,boqQty:0,orderedQty:0 }];
procurementInboxService.vendors = async () => [{id:'vendor',name:'Công ty Thiết bị văn phòng',taxCode:'0101234567',recentOrders:1}];
requestPurchaseService.order = async () => ({purchaseOrderId:'po-fixture',poNumber:'PO-KIEM-THU'});
const row = {...emptyPurchaseNeed(), 'Tên hàng':'Máy tính xách tay cho kỹ sư công trường', 'Quy cách':'RAM 16 GB, SSD 512 GB, màn hình 15.6 inch; bảo hành 24 tháng', 'Đơn vị':'Cái', 'Số lượng':'2', 'Loại hàng':'Tài sản' as const, _warehouseId:'wh1','Kho nhận':'Kho Văn phòng Tiến Thịnh','Ngày cần':'2026-10-10',_categoryId:'it','Nhóm tài sản':'Máy tính và thiết bị văn phòng'};
const detail: ProcurementInboxDetail = {sourceType:'request',sourceId:'request-fixture',sourceRevision:1,code:'RQ-KIEM-THU',title:'Mua máy tính',projectId:null,projectCode:null,projectName:null,warehouseId:'wh1',warehouseName:row['Kho nhận'],neededDate:'2026-10-10',requesterName:'Người đề xuất',approvedAt:null,approvedByName:'Người duyệt',constructionSiteId:null,periodType:null,periodStart:null,closure:null,lines:[],assignment:null,intakeState:'received',orderable:true,
 purchaseLines:[{id:row._id,name:row['Tên hàng'],specification:row['Quy cách'],unit:'Cái',qty:2,kind:'asset',warehouseId:'wh1',warehouseName:row['Kho nhận'],neededDate:'2026-10-10',recipientName:null,categoryName:row['Nhóm tài sản'],orderedQty:1,receivedQty:1,orders:[{id:'po1',code:'PO-TEST',status:'partial'}],assets:[{id:'asset1',code:'TS-KIEM-THU-001',status:'AVAILABLE',holder:null}]}]};
function Fixture(){const [rows,setRows]=useState<PurchaseNeedRow[]>([row]);const [fields,setFields]=useState<RequestTemplateFieldSchema[]>([]);const [saved,setSaved]=useState('');return <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6"><h1 className="text-xl font-bold">Yêu cầu → Mua hàng → Tài sản</h1><RequestPurchaseOutput fields={fields} dispatch={a=>{if(a.type==='UPSERT_FIELD')setFields([purchaseNeedField(1)]);if(a.type==='REMOVE_FIELD')setFields([]);}}/><RequestPurchaseNeedEditor value={rows} onChange={setRows} users={[]}/><RequestPurchaseLines detail={detail} canManage onChanged={()=>undefined} onOpenOrder={setSaved}/>{saved&&<p role="status">Đã mở đơn {saved}</p>}</main>}
createRoot(document.getElementById('root')!).render(<Fixture/>);
