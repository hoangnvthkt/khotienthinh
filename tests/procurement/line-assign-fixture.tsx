import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import { ToastProvider } from '../../context/ToastContext';
import { ConfirmProvider } from '../../context/ConfirmContext';
import { DocumentRow, NeedDrawer } from '../../components/procurement/hub/ProcurementHubView';
import { OrderEditor } from '../../components/procurement/hub/OrderEditor';
import { procurementInboxService, type ProcurementInboxDetail, type ProcurementInboxDocument, type ProcurementInboxLine } from '../../lib/procurementInboxService';

// Giao việc theo dòng — dữ liệu theo phiếu thật MR-2026-9787 (SMB). Người đang xem: Bùi Quang Chung.
// ?as=mo xem bằng người điều phối; ?fresh bắt đầu khi chưa chia dòng.
const params = new URLSearchParams(location.search);
const people = [
  { id: 'mo', name: 'Nguyễn Thị Mơ' }, { id: 'chung', name: 'Bùi Quang Chung' }, { id: 'thuy', name: 'Phạm Thị Thủy' },
];
const me = params.get('as') || 'chung';
const nameOf = (id: string | null) => people.find(p => p.id === id)?.name || null;
const mk = (lineId: string, itemName: string, sku: string, unit: string, needQty: number, stockQty: number, assignee: string | null): ProcurementInboxLine => ({
  lineId, itemId: sku, itemName, sku, unit, needQty, orderedQty: 0, receivedQty: 0, remainingQty: needQty, stockQty,
  purchaseUnit: null, purchaseFactor: null, orders: [], otherStock: [], transfers: [], assigneeUserId: assignee, assigneeName: nameOf(assignee),
});
const fresh = params.has('fresh');
const detail: ProcurementInboxDetail = {
  sourceType: 'material_request', sourceId: 'mr-9787', code: 'MR-2026-9787', title: 'Đề xuất vật tư xây tường bê tông ALC',
  projectId: 'smb', projectCode: 'SMB-2026', projectName: 'DỰ ÁN SƠN MIỀN BẮC', warehouseId: 'kho-smb', warehouseName: 'Kho Sơn Miền Bắc',
  neededDate: '2026-08-14', requesterName: 'Nguyễn Văn Luật', approvedAt: null, approvedByName: null, constructionSiteId: null,
  periodType: null, periodStart: null, closure: null, orderable: true, intakeState: 'received',
  assignment: { assigneeUserId: 'mo', assigneeName: 'Nguyễn Thị Mơ', assignedAt: '2026-10-08', note: null },
  lines: [
    mk('l1', 'Đinh nở đạn M6 (vách ALC)', 'VT0001707', 'Cái', 1750, 0, fresh ? null : 'chung'),
    mk('l2', 'Đinh sắt 10cm', 'VT0001701', 'Kg', 56000, 600, fresh ? null : 'thuy'),
    mk('l3', 'Ke thẳng (vách ALC)', 'VT0001706', 'Cái', 14000, 0, fresh ? null : 'chung'),
    mk('l4', 'Ke vuông (vách ALC)', 'VT0001705', 'Cái', 10000, 0, null),
    mk('l5', 'Vữa liên kết Ekoflex - ALC (25kg/bao)', 'VT0000862', 'Tấn', 25, 0, null),
  ],
};
const docOf = (d: ProcurementInboxDetail): ProcurementInboxDocument => {
  const counts = new Map<string, number>();
  d.lines.forEach(l => { const o = l.assigneeUserId || d.assignment?.assigneeUserId; if (o) counts.set(o, (counts.get(o) || 0) + 1); });
  return {
    sourceType: d.sourceType, sourceId: d.sourceId, code: d.code, title: d.title, projectId: d.projectId, projectCode: d.projectCode, projectName: d.projectName,
    constructionSiteId: null, warehouseId: d.warehouseId, warehouseName: d.warehouseName, neededDate: d.neededDate, requesterName: d.requesterName,
    approvedAt: null, approvedByName: null, createdAt: '2026-08-01', lineCount: d.lines.length, orderedLines: 0, partialLines: 0, receivedLines: 0,
    progress: 'new', assigneeUserId: d.assignment?.assigneeUserId || null, assigneeName: d.assignment?.assigneeName || null,
    lineAssignees: Array.from(counts, ([userId, n]) => ({ userId, name: nameOf(userId), lines: n, openLines: n })).sort((a, b) => b.openLines - a.openLines),
    unassignedOpenLines: d.assignment ? 0 : d.lines.filter(l => !l.assigneeUserId).length, splitByLine: d.lines.some(l => l.assigneeUserId),
    periodType: null, periodStart: null, closedAt: null, closeReason: null, closedByName: null,
  };
};
const others: ProcurementInboxDocument[] = [
  { ...docOf({ ...detail, lines: detail.lines.map(l => ({ ...l, assigneeUserId: null, assigneeName: null })) }), sourceId: 'mr-9790', code: 'MR-2026-9790', title: 'Vật tư hoàn thiện tầng 3', neededDate: '2026-10-20' },
  { ...docOf({ ...detail, assignment: null, lines: detail.lines.slice(0, 2).map(l => ({ ...l, assigneeUserId: null, assigneeName: null })) }), sourceId: 'mr-9791', code: 'MR-2026-9791', title: 'Thép buộc, đinh cho cốp pha', neededDate: '2026-10-09' },
];

let state = detail;
procurementInboxService.get = async () => structuredClone(state);
procurementInboxService.proactiveCandidates = async () => [];
procurementInboxService.vendors = async () => [{ id: 'v1', name: 'Công ty TNHH Vật liệu ALC Việt Nam', taxCode: '0101234567', recentOrders: 3 }];
procurementInboxService.assignLines = async input => {
  const to = input.claim ? me : input.assigneeUserId || null;
  if (input.claim && state.lines.some(l => input.lineIds.includes(l.lineId) && l.assigneeUserId && l.assigneeUserId !== me)) throw new Error('Có dòng vừa được người khác nhận. Tải lại để xem ai đang mua.');
  state = { ...state, lines: state.lines.map(l => (input.lineIds.includes(l.lineId) ? { ...l, assigneeUserId: to, assigneeName: nameOf(to) } : l)) };
  return { assigned: input.lineIds.length, assigneeUserId: to };
};

function Fixture() {
  const [, setTick] = useState(0);
  const [open, setOpen] = useState(!params.has('list'));
  const [editor, setEditor] = useState<string[] | undefined | null>(null);
  const doc = docOf(state);
  return <main className="mx-auto max-w-5xl space-y-4 p-4">
    <h1 className="text-xl font-bold">Cần mua · xem bằng {nameOf(me)}</h1>
    <ul className="overflow-hidden rounded-2xl border border-border bg-card">
      {[doc, ...others].map(d => <DocumentRow key={d.code} doc={d} today="2026-10-08" currentUserId={me} selectable selected={false} onSelect={() => undefined} onOpen={() => setOpen(d.code === doc.code)} />)}
    </ul>
    {open && editor === null && <NeedDrawer doc={doc} today="2026-10-08" canManage assignees={people} currentUserId={me}
      onClose={() => setOpen(false)} onAssign={async () => undefined} onOrder={keys => setEditor(keys)} onCloseNeed={() => undefined}
      onReopen={() => undefined} onOpenOrder={() => undefined} onChanged={() => setTick(n => n + 1)} onHotPurchase={() => undefined} />}
    {editor !== null && <OrderEditor sources={[{ sourceType: 'material_request', sourceId: 'mr-9787' }]} lineKeys={editor} currentUserId={me}
      onClose={() => setEditor(null)} onSaved={() => setEditor(null)} />}
  </main>;
}

createRoot(document.getElementById('root')!).render(<ToastProvider><ConfirmProvider><Fixture /></ConfirmProvider></ToastProvider>);
