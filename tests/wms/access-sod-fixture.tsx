import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import { WmsAccessView } from '../../components/wms/WmsAccessView';
import { ToastProvider } from '../../context/ToastContext';
import { wmsAccessService } from '../../lib/wmsCatalogService';
import type { WmsAccessData } from '../../lib/wmsAccess';

// Phân quyền kho qua luật kiêm nhiệm · fixture (không gọi Supabase). Thêm Bùi Quang Chung (Mua hàng) làm thủ kho → máy chủ báo kiêm nhiệm.
// ?staff=1: người lưu không quản lý phân quyền (needsAdmin).
const params = new URLSearchParams(location.search);
const calls: Array<Record<string, unknown>> = [];
(window as unknown as { __wmsCalls: typeof calls }).__wmsCalls = calls;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const data: WmsAccessData = {
  can: { edit: true },
  warehouses: [{ id: 'wh-smb', name: 'Kho Sơn Miền Bắc', type: 'SITE', project: null }, { id: 'wh-xh', name: 'Kho Xin Hai Vina', type: 'SITE', project: null }],
  users: [['u-admin', 'Admin Hoàng'], ['u-chung', 'Bùi Quang Chung'], ['u-nhung', 'Dương Xuân Nhung'], ['u-mo', 'Nguyễn Thị Mơ'], ['u-huong', 'Nguyễn Thị Hương']]
    .map(([id, name]) => ({ id, name, role: 'EMPLOYEE', position: null })),
  grants: [
    { userId: 'u-nhung', code: 'wms.transaction.keeper', scopeType: 'warehouse', scopeId: 'wh-smb' },
    { userId: 'u-nhung', code: 'wms.inventory.view', scopeType: 'warehouse', scopeId: 'wh-smb' },
    { userId: 'u-huong', code: 'wms.accounting.manage', scopeType: 'global', scopeId: '*' },
    { userId: 'u-huong', code: 'wms.inventory.view', scopeType: 'global', scopeId: '*' },
  ],
  activity: [],
  log: [],
};
wmsAccessService.get = async () => { calls.push({ get: true }); await sleep(30); return JSON.parse(JSON.stringify(data)); };
wmsAccessService.preview = async (access, revoke) => {
  calls.push({ preview: { keepers: access.keepers, revoke } }); await sleep(60);
  const chungKeeper = Object.values(access.keepers).some(list => list.includes('u-chung'));
  return {
    added: chungKeeper ? 5 : 1, removed: 0,
    lines: [...(chungKeeper ? ['+ Bùi Quang Chung — Giao dịch kho: Thủ kho @ Kho Sơn Miền Bắc', '+ Bùi Quang Chung — Tồn kho: Xem @ Kho Sơn Miền Bắc',
      '+ Bùi Quang Chung — Giao dịch kho: Xem @ Kho Sơn Miền Bắc', '+ Bùi Quang Chung — Đề xuất vật tư: Xem @ Kho Sơn Miền Bắc', '+ Bùi Quang Chung — Kho vật tư: Xem'] : []),
      '+ Dương Xuân Nhung — Đề xuất vật tư: Tạo'],
    sod: chungKeeper && !params.has('staff') ? [{ userId: 'u-chung', name: 'Bùi Quang Chung', warnings: [{ ruleCode: 'PROCUREMENT_BUY_WAREHOUSE_KEEPER', name: 'Mua hàng + Thủ kho',
      description: 'Người mua hàng cũng nhập kho hàng mình mua.', scopeType: 'warehouse', scopeId: 'wh-smb', scopeLabel: 'Kho Sơn Miền Bắc',
      permissions: [{ code: 'system.procurement.manage', label: 'Quản trị', moduleLabel: 'Mua hàng' }, { code: 'wms.transaction.keeper', label: 'Thủ kho', moduleLabel: 'Kho' }],
      controls: ['Người khác đối chiếu phiếu nhập với đơn mua hằng tuần'] }] }] : [],
    needsAdmin: chungKeeper && params.has('staff'),
  };
};
wmsAccessService.save = async (access, revoke, reason, ack) => {
  calls.push({ save: { keepers: access.keepers, reason, ack } }); await sleep(60);
  return { added: 5, removed: 0, lines: [] };
};

createRoot(document.getElementById('root')!).render(
  <ToastProvider><main className="mx-auto max-w-6xl p-3 sm:p-6"><WmsAccessView currentUserId="u-admin" /></main></ToastProvider>,
);
