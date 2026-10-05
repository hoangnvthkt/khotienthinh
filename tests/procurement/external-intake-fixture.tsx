import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import { ExternalSourceSnapshot } from '../../components/procurement/hub/ExternalSourceSnapshot';
import { Drawer } from '../../components/procurement/hub/hubUi';
import type { ProcurementInboxDetail } from '../../lib/procurementInboxService';
const detail: ProcurementInboxDetail = {
 sourceType: 'workflow', sourceId: 'fixture', code: 'WF-QA', title: 'CT Sơn MB - Kết Cấu',
 projectId: null, projectCode: null, projectName: null, warehouseId: null, warehouseName: null, neededDate: null,
 requesterName: 'Người đề xuất', approvedAt: null, approvedByName: 'Người duyệt', constructionSiteId: null, periodType: null, periodStart: null,
 closure: null, lines: [], assignment: null, orderable: false, intakeState: 'received',
 sourceSnapshot: { columns: ['Tên vật tư','ĐVT Theo BVTC','Lũy kế KL đã cấp','SL đề xuất đợt này','SL Phê duyệt','Ngày cần (dự kiến)','Mục đích sử dụng','SL tồn kho','Ghi chú'],
 rows: [{id:'1',cells:['Máng xối — thép mạ kẽm, dày 2 mm, dài 6.000 mm','cái','12','8','','05/10/2026','Mái nhà xưởng Sơn Miền Bắc','','Theo bản vẽ KC-02, phiên bản B; không thay thế bằng chi tiết của công trình khác.']}], notes:'CT Sơn Miền Bắc\nLắp đặt kết cấu mái', revision:1, withdrawnReason:null }
};
createRoot(document.getElementById('root')!).render(<Drawer label="Phiếu WF-QA" onClose={() => undefined} header={<h2>CT Sơn MB - Kết Cấu</h2>} footer={<a href="#/wf/fixture">Mở phiếu nguồn</a>}><ExternalSourceSnapshot detail={detail} withdrawn={new URLSearchParams(location.search).has('withdrawn')} /></Drawer>);
