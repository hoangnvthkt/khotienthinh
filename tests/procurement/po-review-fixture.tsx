import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import { ToastProvider } from '../../context/ToastContext';
import { ConfirmProvider } from '../../context/ConfirmContext';
import { OrderDrawer } from '../../components/procurement/hub/OrderDrawer';
import { procurementInboxService, type ProcurementOrderDetail, type ProcurementOrderLine } from '../../lib/procurementInboxService';
import { poReviewService, type PoReviewData, type PoReviewLine } from '../../lib/procurementPoReview';
import { aiGateway } from '../../lib/aiGateway';

// Trước khi duyệt Đơn mua — dữ liệu theo ca đo 16/10 (PO-646 nghi trùng PO-618, ống PVC gấp 4 lần giá, NCC giao thiếu).
// ?case=dup|price|clean|error · ?ai=ok|none|fail|slow · ?as=viewer (không phải người duyệt) · ?budget=pending|over|ok|none
const params = new URLSearchParams(location.search);
const scenario = params.get('case') || 'dup';
const aiMode = params.get('ai') || 'ok';
const budgetMode = params.get('budget') || (scenario === 'clean' ? 'ok' : 'pending');

const oLine = (lineId: string, name: string, unit: string, qty: number, unitPrice: number, over: Partial<ProcurementOrderLine> = {}): ProcurementOrderLine => ({
  lineId, itemId: lineId, name, sku: `VT${lineId}`, unit, qty, unitPrice, receivedQty: 0, note: null, specification: null, returnedQty: 0, stockUnit: unit,
  remainingToDeliver: qty, factor: 1, stockQty: qty, allocatedQty: qty, boq: null,
  allocations: [{ sourceType: 'material_request', sourceId: 'mr1', code: 'MR-2026-9787', lineId: 'r1', qty, needQty: qty, projectCode: 'SMB-2026', warehouseId: 'kho-smb', warehouseName: 'Kho Sơn Miền Bắc', excessReason: null }],
  ...over,
} as ProcurementOrderLine);
const rLine = (l: ProcurementOrderLine, over: Partial<PoReviewLine> = {}): PoReviewLine => ({
  lineId: l.lineId, itemId: l.itemId, name: l.name, specification: l.specification, unit: l.unit, qty: l.qty, price: l.unitPrice, boq: null,
  last: null, cheaper: null, contract: null, duplicates: [], excessReason: null, ...over,
});

const linesByCase: Record<string, ProcurementOrderLine[]> = {
  dup: [oLine('a', 'Đinh nở đạn M6 (vách ALC)', 'Cái', 2000, 1200), oLine('b', 'Vữa liên kết Ekoflex - ALC (25kg/bao)', 'Bao', 120, 98000)],
  price: [oLine('a', 'Ống PVC 110 C1', 'Cây', 3, 239632), oLine('b', 'Cút PVC 140', 'Cái', 17, 86564), oLine('c', 'Gạch 2 lỗ A1', 'Viên', 22000, 1150), oLine('d', 'Chi phí vận chuyển', 'Lần', 1, 1000000)],
  clean: [oLine('a', 'Bê tông M250', 'm3', 7.5, 1180000), oLine('b', 'Chi phí bơm cần (m3)', 'm3', 7.5, 95000)],
};
const lines = linesByCase[scenario] || linesByCase.dup;
const total = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
const budget: PoReviewData['budget'] = budgetMode === 'none' ? { check: null, approval: null }
  : budgetMode === 'ok' ? { check: { over: false, budget: 4_200_000_000, projected: 2_352_000_000 }, approval: null }
  : budgetMode === 'over' ? { check: { over: true, budget: 4_200_000_000, projected: 4_386_500_000 }, approval: null }
  : { check: { over: true, budget: 4_200_000_000, projected: 4_386_500_000 }, approval: { status: 'pending', approverNames: ['Đặng Thị Thu Hà'] } };

const order: ProcurementOrderDetail = {
  id: 'po-646', poNumber: scenario === 'price' ? 'PO-557' : scenario === 'clean' ? 'PO-679' : 'PO-646', status: 'sent', stage: 'drafting', isHub: true, rowVersion: 3,
  vendorId: 'v1', vendorName: scenario === 'price' ? 'Công ty TNHH Thiết bị điện nước Hưng Yên' : scenario === 'clean' ? 'Công ty TNHH Xây dựng và ĐTTM Hợp Thành' : 'Công ty TNHH Đông Hà Nội',
  projectId: 'smb', constructionSiteId: null, projectCode: 'SMB-2026', projectName: 'Dự án Sơn Miền Bắc', targetWarehouseId: 'kho-smb', warehouseName: 'Kho Sơn Miền Bắc',
  orderDate: '2026-10-10', expectedDeliveryDate: '2026-10-18', totalAmount: total, vatRate: 8, note: null,
  createdById: 'chung', createdByName: 'Bùi Quang Chung', createdAt: '2026-10-10T02:00:00Z', submittedToUserId: 'mo', submittedToName: 'Nguyễn Thị Mơ',
  returnReason: null, everSubmitted: true, purchaseMode: 'single', approvedTotalAmount: 0, kind: 'need', proactive: null, shortClose: null,
  budgetApproval: budgetMode === 'pending' ? { status: 'pending', budget: 4_200_000_000, projected: 4_386_500_000, order: total, projectCode: 'SMB-2026', approverNames: ['Đặng Thị Thu Hà'] } : null,
  deliveries: [], returns: [], lines, events: [{ action: 'submit', actorName: 'Bùi Quang Chung', reason: null, at: '2026-10-10T02:05:00Z' }],
  permissions: { canEdit: false, canSubmit: false, canApprove: params.get('as') !== 'viewer', canDelete: false, canAddDelivery: false, canCloseShort: false, canDecideReturn: false, canLink: false },
  approvers: [],
};

const review: PoReviewData = {
  poId: order.id, poNumber: order.poNumber, status: 'sent', vendorId: 'v1', vendorName: order.vendorName, createdAt: order.createdAt, budget, captures: [],
  vendor: scenario === 'price' ? { orders: 7, received: 3, short: 2 } : { orders: 4, received: 3, short: 0 },
  lines: scenario === 'dup' ? [
    rLine(lines[0], { duplicates: [{ poId: 'po-618', poNumber: 'PO-618', status: 'sent', qty: 2000, unit: 'Cái' }], last: { poId: 'po-560', poNumber: 'PO-560', date: '2026-09-22', price: 1180 } }),
    rLine(lines[1], { last: { poId: 'po-560', poNumber: 'PO-560', date: '2026-09-22', price: 98000 } }),
  ] : scenario === 'price' ? [
    rLine(lines[0], { last: { poId: 'po-370', poNumber: 'PO-370', date: '2026-08-18', price: 59908 } }),
    rLine(lines[1], { last: { poId: 'po-370', poNumber: 'PO-370', date: '2026-08-18', price: 111588 } }),
    rLine(lines[2], { cheaper: { poId: 'po-600', poNumber: 'PO-600', vendorName: 'Gạch Đồng Tâm', date: '2026-09-30', price: 1000 }, boq: 'outside' }),
    rLine(lines[3]),
  ] : lines.map(l => rLine(l, { last: { poId: 'po-640', poNumber: 'PO-640', date: '2026-10-04', price: l.unitPrice } })),
};
if (scenario === 'dup') review.captures = [{ id: 'c1', docNo: 'XK21044', docDate: '2026-10-07', createdAt: '2026-10-07T03:00:00Z', warehouseName: 'Kho Sơn Miền Bắc' }];

procurementInboxService.getOrder = async () => structuredClone(order);
procurementInboxService.poPaymentStatus = async () => ({});
procurementInboxService.poPriceSettlements = async () => [];
procurementInboxService.transitionOrder = async () => { await new Promise(r => setTimeout(r, 300)); return { purchaseOrderId: order.id } as Awaited<ReturnType<typeof procurementInboxService.transitionOrder>>; };
poReviewService.get = async () => {
  await new Promise(r => setTimeout(r, 350));
  if (scenario === 'error') throw new Error('network');
  return structuredClone(review);
};
const SENTENCES: Record<string, string> = {
  dup: 'Đinh nở M6 có thể trùng PO-618 và hàng đã về từ 07/10; đơn đang chờ duyệt vượt dự toán vật tư, giá như lần trước.',
  price: 'Ống PVC 110 cao gấp 4 lần giá lần trước, cần kiểm lại đơn giá; NCC này giao thiếu 2/3 lần gần đây.',
  clean: 'Các kiểm tra không thấy điểm bất thường: giá như lần trước, trong dự toán, NCC đã mua 4 đơn.',
};
aiGateway.run = (async () => {
  await new Promise(r => setTimeout(r, aiMode === 'slow' ? 4000 : 700));
  if (aiMode === 'none') return { code: 'AI_NOT_CONFIGURED' };
  if (aiMode === 'fail') return { code: 'AI_FAILED', error: 'AI_TRUNCATED' };
  return { code: 'OK', runId: 'run-1', result: { sentence: SENTENCES[scenario] || SENTENCES.dup }, model: 'deepseek-v4.1-flash', provider: 'openai_compatible', usage: { tokensIn: 300, tokensOut: 40, costUsd: null, durationMs: 700 } };
}) as typeof aiGateway.run;
aiGateway.feedback = () => undefined;

createRoot(document.getElementById('root')!).render(<ToastProvider><ConfirmProvider>
  <main className="min-h-screen bg-background p-4"><h1 className="text-lg font-bold">Mua hàng · Đơn chờ duyệt (fixture)</h1>
    <OrderDrawer orderId={order.id} today="2026-10-16" currentUserId="mo" onClose={() => undefined} onChanged={() => undefined} onEdit={() => undefined} />
  </main>
</ConfirmProvider></ToastProvider>);
