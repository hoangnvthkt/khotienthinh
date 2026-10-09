import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import { ToastProvider } from '../../context/ToastContext';
import { ConfirmProvider } from '../../context/ConfirmContext';
import { OrderEditor } from '../../components/procurement/hub/OrderEditor';
import { ProactiveOrderEditor } from '../../components/procurement/hub/ProactiveOrderEditor';
import { ContractOrderEditor } from '../../components/procurement/hub/ContractOrderEditor';
import { procurementInboxService, type ProcurementInboxDetail, type ProcurementInboxLine } from '../../lib/procurementInboxService';
import { procurementContractService, type ContractDetail, type ContractSummary } from '../../lib/procurementContractService';
import { wmsCatalogService } from '../../lib/wmsCatalogService';
import type { Warehouse } from '../../types';
import MaterialCommercialDescriptionFields from '../../components/material/MaterialCommercialDescriptionFields';
import { duplicateItemSpecProblems } from '../../lib/materialLineDescription';

// Một mã nhiều quy cách — dữ liệu mẫu, không gọi Cloud. ?v=order | proactive | contract
const view = new URLSearchParams(location.search).get('v') || 'order';
const log = (label: string, input: unknown) => { (window as any).lastSave = input; console.info(label, JSON.stringify(input)); };

const mk = (lineId: string, itemId: string, itemName: string, sku: string, unit: string, needQty: number, specification: string | null): ProcurementInboxLine => ({
  lineId, itemId, itemName, sku, unit, needQty, orderedQty: 0, receivedQty: 0, remainingQty: needQty, stockQty: 0, specification,
  purchaseUnit: null, purchaseFactor: null, orders: [], otherStock: [], transfers: [],
} as ProcurementInboxLine);
const detail = {
  sourceType: 'material_request', sourceId: 'mr-9842', code: 'MR-2026-9842', title: 'Đề xuất vật tư thi công lần 18 (Hộp ubot cho sàn phẳng)',
  projectId: 'smb', projectCode: 'SMB-2026', projectName: 'DỰ ÁN SƠN MIỀN BẮC', warehouseId: 'kho-smb', warehouseName: 'Kho Sơn Miền Bắc',
  neededDate: '2026-10-20', requesterName: 'Nguyễn Phương Thảo', approvedAt: null, approvedByName: null, constructionSiteId: null,
  periodType: null, periodStart: null, closure: null, orderable: true, intakeState: 'received', assignment: null,
  lines: [
    mk('l1', 'i-ubot', 'Hộp ubot H18', 'VT0001184', 'Cái', 400, 'Loại 1'),
    mk('l2', 'i-ubot', 'Hộp ubot H18', 'VT0001184', 'Cái', 150, 'Loại 2'),
    mk('l3', 'i-ubot', 'Hộp ubot H18', 'VT0001184', 'Cái', 60, 'loại 1 '),
    mk('l4', 'i-ke', 'Ke chân ubot', 'VT0001185', 'Cái', 800, null),
  ],
} as unknown as ProcurementInboxDetail;
procurementInboxService.get = async () => structuredClone(detail);
procurementInboxService.vendors = async () => [{ id: 'v1', name: 'Công ty CP Ubot Việt Nam', taxCode: '0109990002', recentOrders: 3 }];
procurementInboxService.saveOrder = async input => { log('saveOrder', input); return { purchaseOrderId: 'po-1', poNumber: 'PO-2026-0001', rowVersion: 1, totalAmount: 0, lines: input.items.length }; };

const catalog = [
  { id: 'i-ton', name: 'Tôn sóng công nghiệp dày 0.45mm', sku: 'VT0001049', unit: 'm2', purchaseUnit: null, purchaseFactor: null, inBoq: true, boqQty: 500, orderedQty: 120 },
  { id: 'i-ton4', name: 'Tôn sóng công nghiệp dày 0.4mm', sku: 'VT0001703', unit: 'm2', purchaseUnit: null, purchaseFactor: null, inBoq: false, boqQty: 0, orderedQty: 0 },
];
procurementInboxService.proactiveOptions = async () => ({ projects: [{ id: 'p1', code: 'SMB-2026', name: 'DỰ ÁN SƠN MIỀN BẮC', status: 'active', warehouses: [{ id: 'w1', name: 'Kho Sơn Miền Bắc' }] }], stockWarehouses: [] });
procurementInboxService.searchItems = async () => catalog;
procurementInboxService.saveProactiveOrder = async input => { log('saveProactiveOrder', input); return { purchaseOrderId: 'po-2', poNumber: 'PO-2026-0002', rowVersion: 1, totalAmount: 0, lines: input.items.length, overBoq: 0 }; };
wmsCatalogService.createOptions = async () => ({ canCreate: false, canEdit: false, canIssueCode: false, categories: [], units: [] });

const priceLine = (id: string, specification: string | null, unitPrice: number) => ({ id, lineNo: 1, itemId: 'i-ton', sku: 'VT0001049', name: 'Tôn sóng công nghiệp dày 0.45mm', unit: 'm2',
  unitPrice, vatRate: 8, quantityLimit: null, amountLimit: null, effectiveFrom: null, effectiveTo: null, note: null, used: false, specification });
const contract = {
  id: 'c1', code: 'HĐNT-2026-07', name: 'HĐ nguyên tắc tôn', type: 'framework', status: 'active', supplierId: 'v1', supplierName: 'Công ty TNHH Tôn Hoa Sen',
  projectId: null, projectCode: null, projectName: null, constructionSiteId: null, value: null, signedDate: '2026-07-01', effectiveDate: null, expiryDate: null,
  paymentTerms: null, paymentTermDays: null, note: null, canManage: true, isBuyer: true, canOrder: true, approvers: [], orders: [], usage: [], deliveries: [], statements: [],
  priceLines: [priceLine('pl-1', 'Tôn biên và tôn hồi 13 sóng', 94000), priceLine('pl-2', 'Tôn mái 11 sóng', 90000)],
} as unknown as ContractDetail;
procurementContractService.get = async () => structuredClone(contract);
procurementContractService.searchItems = async () => [{ id: 'i-ton', name: 'Tôn sóng công nghiệp dày 0.45mm', sku: 'VT0001049', unit: 'm2' }];
procurementContractService.saveOrder = async input => { log('saveContractOrder', input); return { purchaseOrderId: 'po-3', poNumber: 'PO-2026-0003', rowVersion: 1, totalAmount: 0, lines: input.items.length, manualPrices: 0 } as any; };
const warehouses = [{ id: 'w1', name: 'Kho Sơn Miền Bắc', type: 'SITE', isArchived: false, projectId: 'p1' }] as unknown as Warehouse[];

// Dòng phiếu đề xuất (RequestModal dùng đúng component + kiểm tra này).
const RequestLines = () => {
  const [lines, setLines] = React.useState([
    { lineId: 'a', itemId: 'i-ubot', sku: 'VT0001184', name: 'Hộp ubot H18', specification: 'Loại 1' },
    { lineId: 'b', itemId: 'i-ubot', sku: 'VT0001184', name: 'Hộp ubot H18', specification: '' },
    { lineId: 'c', itemId: 'i-ke', sku: 'VT0001185', name: 'Ke chân ubot', specification: '' },
  ]);
  const problems = duplicateItemSpecProblems(lines.map(l => ({ key: l.lineId, itemId: l.itemId, specification: l.specification })));
  const set = (id: string, p: object) => setLines(cur => cur.map(l => l.lineId === id ? { ...l, ...p } : l));
  return <div className="mx-auto max-w-2xl space-y-3 p-4">{lines.map(l => <div key={l.lineId} className="rounded-xl border border-border bg-card p-3">
    <MaterialCommercialDescriptionFields sku={l.sku} name={l.name} onNameChange={v => set(l.lineId, { name: v })}
      specification={l.specification} onSpecificationChange={v => set(l.lineId, { specification: v })} specificationProblem={problems.get(l.lineId)} /></div>)}</div>;
};

const App = () => view === 'request' ? <RequestLines /> : view === 'proactive'
  ? <ProactiveOrderEditor onClose={() => undefined} onSaved={() => undefined} />
  : view === 'contract'
    ? <ContractOrderEditor contracts={[{ id: 'c1', code: 'HĐNT-2026-07', supplierName: 'Công ty TNHH Tôn Hoa Sen', canOrder: true } as ContractSummary]} warehouses={warehouses}
      contractId="c1" onClose={() => undefined} onSaved={() => undefined} />
    : <OrderEditor sources={[{ sourceType: 'material_request', sourceId: 'mr-9842' }]} onClose={() => undefined} onSaved={() => undefined} />;
createRoot(document.getElementById('root')!).render(<ToastProvider><ConfirmProvider><App /></ConfirmProvider></ToastProvider>);
