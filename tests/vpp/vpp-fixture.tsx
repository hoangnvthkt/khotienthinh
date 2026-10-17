import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '../../index.css';
import { ToastProvider } from '../../context/ToastContext';
import { ConfirmProvider } from '../../context/ConfirmContext';
import OfficeSupplies from '../../pages/vpp/OfficeSupplies';
import { officeSupplyService, type VppDetail, type VppLine, type VppReceipt, type VppSettings, type VppStatus } from '../../lib/officeSupplyService';
import seedSql from '../../supabase/migrations/20261018100000_vpp_opening_balance.sql?raw';

// Văn phòng phẩm — giả lập máy chủ trong trình duyệt, không gọi Cloud. ?as=staff | approver | keeper | admin
// Danh mục + tồn lấy đúng 82 mã từ migration tồn đầu kỳ 17/10/2026.
const as = new URLSearchParams(location.search).get('as') || 'staff';
const PEOPLE = {
  staff: { id: 'u-staff', name: 'Nguyễn Thị Hương', ou: 'ou-hcns' },
  approver: { id: 'u-tp', name: 'Phạm Thị Bích Phương', ou: 'ou-hcns' },
  keeper: { id: 'u-keeper', name: 'Đặng Thị Hương', ou: 'ou-hcns' },
  admin: { id: 'u-admin', name: 'Admin Hoàng', ou: 'ou-bld' },
  kt: { id: 'u-kt', name: 'Vũ Thị Hồng Phương', ou: 'ou-tckt' },
};
const me = PEOPLE[as as keyof typeof PEOPLE] || PEOPLE.staff;
const OU: Record<string, string> = { 'ou-hcns': 'Phòng Hành chính - Nhân sự', 'ou-tckt': 'Phòng Tài chính - Kế toán', 'ou-bld': 'Ban lãnh đạo', 'ou-nm': 'Văn phòng nhà máy' };
const name = (id: string | null) => Object.values(PEOPLE).find(p => p.id === id)?.name || null;

const items = [...seedSql.matchAll(/\('(VPP\d{3})', '((?:[^']|'')+)', '([^']+)', (\d+), (\d+)\)/g)]
  .map(m => ({ itemId: `it-${m[1]}`, sku: m[1], name: m[2].replace(/''/g, "'"), unit: m[3], price: Number(m[4]), stock: Number(m[5]) }));
const item = (id: string | null) => items.find(i => i.itemId === id);
const settings: VppSettings = {
  warehouseId: 'wh-vpp', thresholdAmount: 5_000_000, rowVersion: 1, thresholdApproverId: 'u-admin', fallbackApproverId: 'u-keeper',
  departments: [
    { orgUnitId: 'ou-hcns', code: 'HCNS', name: OU['ou-hcns'], members: 13, approverId: 'u-tp', deputyId: null, suggestedId: 'u-tp' },
    { orgUnitId: 'ou-tckt', code: 'TCKT', name: OU['ou-tckt'], members: 5, approverId: null, deputyId: null, suggestedId: 'u-admin' },
    { orgUnitId: 'ou-nm', code: 'VPNM', name: OU['ou-nm'], members: 10, approverId: null, deputyId: null, suggestedId: null },
    { orgUnitId: 'ou-bld', code: 'BLĐ', name: OU['ou-bld'], members: 5, approverId: 'u-admin', deputyId: null, suggestedId: null },
  ],
  people: Object.values(PEOPLE).map(p => ({ id: p.id, name: p.name })),
};
const approverFor = (requester: string, ou: string | null) => {
  const a = settings.departments.find(d => d.orgUnitId === ou)?.approverId;
  if (a && a !== requester) return a;
  return settings.fallbackApproverId !== requester ? settings.fallbackApproverId : null;
};

type Req = Omit<VppDetail, 'can' | 'lines' | 'requesterName' | 'approverName' | 'warehouseName'> & { lines: VppLine[] };
let seq = 3;
const mkLine = (no: number, sku: string | null, qty: number, extra: Partial<VppLine> = {}): VppLine => {
  const it = sku ? items.find(i => i.sku === sku)! : null;
  return { id: `l-${Math.random().toString(36).slice(2)}`, lineNo: no, itemId: it?.itemId || null, sku: it?.sku || null, name: it?.name || 'Bút bi đen Thiên Long', unit: it?.unit || 'Cái',
    requestedQty: qty, approvedQty: null, issuedQty: 0, returnedQty: 0, note: null, stock: null, unitCost: null, ...extra };
};
const reqs: Req[] = [
  { id: 'r1', code: 'DX-VPP-2610-001', status: 'pending', note: 'Chuẩn bị hồ sơ tuyển dụng tháng 11', rowVersion: 1, warehouseId: 'wh-vpp', requesterId: 'u-staff', orgUnitId: 'ou-hcns', orgUnitName: OU['ou-hcns'],
    approverId: 'u-tp', approvedByName: null, approvedAt: null, thresholdRequired: false, thresholdApprovedByName: null, thresholdApprovedAt: null, estimatedAmount: 0,
    submittedAt: '2026-10-17T02:10:00Z', updatedAt: '2026-10-17T02:10:00Z', closedReason: null, events: [], moves: [],
    lines: [mkLine(1, 'VPP001', 5), mkLine(2, 'VPP005', 10), mkLine(3, null, 4), mkLine(4, 'VPP017', 2)] },
  { id: 'r2', code: 'DX-VPP-2610-002', status: 'approved', note: null, rowVersion: 2, warehouseId: 'wh-vpp', requesterId: 'u-kt', orgUnitId: 'ou-tckt', orgUnitName: OU['ou-tckt'],
    approverId: 'u-keeper', approvedByName: 'Đặng Thị Hương', approvedAt: '2026-10-17T03:00:00Z', thresholdRequired: false, thresholdApprovedByName: null, thresholdApprovedAt: null, estimatedAmount: 0,
    submittedAt: '2026-10-17T01:00:00Z', updatedAt: '2026-10-17T03:00:00Z', closedReason: null, events: [], moves: [],
    lines: [mkLine(1, 'VPP001', 10, { approvedQty: 10 }), mkLine(2, 'VPP064', 3, { approvedQty: 3 }), mkLine(3, 'VPP018', 5, { approvedQty: 5 })] },
];
const receipts: VppReceipt[] = [{ transactionId: 'tx-1', date: '2026-10-17T01:00:00Z', supplierName: 'Hồng Hà Hưng Yên', invoiceNo: '0001234', note: null, attachments: 0, code: 'NK-0682',
  amount: 1_250_000, byName: 'Đặng Thị Hương', lines: [{ name: 'Giấy A4', sku: 'VPP001', unit: 'Gam', qty: 20, price: 62_500 }] }];

const can = { manage: as === 'admin', report: as === 'admin', keeper: as === 'keeper', approve: ['approver', 'admin', 'keeper'].includes(as) };
const cost = (id: string | null) => item(id)?.price || 0;
const estimate = (r: Req) => r.lines.reduce((s, l) => s + (l.approvedQty ?? l.requestedQty) * cost(l.itemId), 0);
const role = (r: Req) => r.requesterId === me.id || !['pending', 'pending_threshold'].includes(r.status) ? null
  : r.approverId === me.id ? 'self' : as === 'admin' || (r.status === 'pending' && settings.fallbackApproverId === me.id) ? 'behalf' : null;
const log = (r: Req, action: string, note?: string | null, onBehalfOfName?: string | null) =>
  r.events.push({ action, at: new Date().toISOString(), note: note || null, payload: {}, actorName: me.name, onBehalfOfName: onBehalfOfName || null });
const view = (r: Req): VppDetail => {
  const ro = role(r); const keeper = can.keeper;
  return { ...structuredClone(r), requesterName: name(r.requesterId)!, approverName: name(r.approverId), warehouseName: 'Kho VPP Hưng Yên',
    estimatedAmount: me.id === r.requesterId && !ro ? null : estimate(r),
    lines: r.lines.map(l => ({ ...l, stock: l.itemId && (keeper || ro) ? item(l.itemId)!.stock : null, unitCost: l.itemId ? cost(l.itemId) : null })),
    can: { approve: !!ro, onBehalf: ro === 'behalf', edit: me.id === r.requesterId && ['pending', 'returned'].includes(r.status) && !r.approvedByName,
      cancel: me.id === r.requesterId && ['pending', 'pending_threshold', 'returned', 'approved'].includes(r.status),
      issue: keeper && ['approved', 'partial'].includes(r.status), close: (keeper && ['approved', 'partial'].includes(r.status)) || (me.id === r.requesterId && r.status === 'partial'),
      return: keeper && r.lines.some(l => l.issuedQty > l.returnedQty) } };
};
const find = (id: string) => { const r = reqs.find(x => x.id === id); if (!r) throw new Error('VPP_REQUEST_NOT_FOUND'); return r; };
const wait = () => new Promise(res => setTimeout(res, 150));

officeSupplyService.home = async () => ({ warehouseId: 'wh-vpp', warehouseName: 'Kho VPP Hưng Yên',
  me: { id: me.id, name: me.name, orgUnitId: me.ou, orgUnitName: OU[me.ou], approverName: name(approverFor(me.id, me.ou)) }, can,
  catalog: items.map(i => ({ itemId: i.itemId, sku: i.sku, name: i.name, unit: i.unit, inStock: i.stock > 0 })),
  uncoded: [{ name: 'Bút bi đen Thiên Long', unit: 'Cái', times: 2 }, { name: 'Bìa còng Kokuyo 5cm', unit: 'Cái', times: 1 }] });
officeSupplyService.list = async v => {
  await wait();
  const rows = reqs.filter(r => v === 'mine' ? r.requesterId === me.id : v === 'approve' ? !!role(r) : v === 'issue' ? can.keeper && ['approved', 'partial', 'issued', 'closed'].includes(r.status) : true);
  return { counts: { mine: reqs.filter(r => r.requesterId === me.id && ['pending', 'returned', 'approved', 'partial'].includes(r.status)).length,
    approve: reqs.filter(r => !!role(r)).length, issue: can.keeper ? reqs.filter(r => ['approved', 'partial'].includes(r.status)).length : 0 },
    rows: rows.map(r => ({ id: r.id, code: r.code, status: r.status, requesterId: r.requesterId, requesterName: name(r.requesterId)!, orgUnitName: r.orgUnitName,
      approverName: name(r.approverId), submittedAt: r.submittedAt, updatedAt: r.updatedAt, note: r.note, thresholdRequired: r.thresholdRequired,
      estimatedAmount: r.requesterId === me.id ? null : estimate(r), lineCount: r.lines.length,
      myTurn: ['pending', 'pending_threshold'].includes(r.status) ? !!role(r) : ['approved', 'partial'].includes(r.status) ? can.keeper : r.status === 'returned' && r.requesterId === me.id,
      summary: r.lines.map(l => `${l.name} ×${l.approvedQty ?? l.requestedQty}`).join(', ') })) };
};
officeSupplyService.get = async id => { await wait(); return view(find(id)); };
officeSupplyService.save = async input => {
  await wait();
  let r = input.id ? find(input.id) : null;
  const lines = input.lines.map((l, i) => { const it = item(l.itemId); return mkLine(i + 1, it?.sku || null, l.qty, it ? {} : { name: l.name, unit: l.unit }); });
  if (!r) {
    r = { id: `r${++seq}`, code: `DX-VPP-2610-${String(seq).padStart(3, '0')}`, status: 'pending', note: input.note || null, rowVersion: 1, warehouseId: 'wh-vpp',
      requesterId: me.id, orgUnitId: me.ou, orgUnitName: OU[me.ou], approverId: approverFor(me.id, me.ou), approvedByName: null, approvedAt: null, thresholdRequired: false,
      thresholdApprovedByName: null, thresholdApprovedAt: null, estimatedAmount: 0, submittedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      closedReason: null, events: [], moves: [], lines };
    reqs.unshift(r); log(r, 'submit');
  } else { Object.assign(r, { lines, note: input.note || null, status: 'pending' as VppStatus, rowVersion: r.rowVersion + 1 }); log(r, 'resubmit'); }
  return view(r);
};
officeSupplyService.act = async input => {
  await wait();
  const r = find(input.id); const ro = role(r); const behalf = ro === 'behalf' ? name(r.approverId) : null;
  if (input.action === 'approve') {
    if (r.status === 'pending') {
      input.lines?.forEach(x => { const l = r.lines.find(y => y.id === x.lineId)!; l.approvedQty = x.approvedQty; });
      r.approvedByName = me.name; r.approvedAt = new Date().toISOString();
      r.thresholdRequired = estimate(r) > settings.thresholdAmount;
      if (r.thresholdRequired && settings.thresholdApproverId !== me.id) { r.status = 'pending_threshold'; r.approverId = settings.thresholdApproverId; }
      else r.status = 'approved';
      log(r, 'approve', null, behalf);
    } else { r.status = 'approved'; r.thresholdApprovedByName = me.name; log(r, 'approve_threshold', null, behalf); }
  } else if (input.action === 'reject') { r.status = 'rejected'; r.closedReason = input.reason || null; log(r, 'reject', input.reason, behalf); }
  else if (input.action === 'return') { r.status = 'returned'; r.approvedByName = null; r.lines.forEach(l => { l.approvedQty = null; }); log(r, 'return', input.reason, behalf); }
  else if (input.action === 'cancel') { r.status = 'cancelled'; r.closedReason = input.reason || null; log(r, 'cancel', input.reason); }
  else { r.status = r.status === 'approved' ? 'cancelled' : 'closed'; r.closedReason = input.reason || null; log(r, 'close', input.reason); }
  r.rowVersion++; r.estimatedAmount = estimate(r);
  return view(r);
};
officeSupplyService.issue = async input => {
  await wait();
  const r = find(input.id);
  for (const x of input.lines) {
    const l = r.lines.find(y => y.id === x.lineId)!;
    if (!l.itemId && x.itemId) { const it = item(x.itemId)!; Object.assign(l, { itemId: it.itemId, sku: it.sku, unit: it.unit }); log(r, 'map_item', `${l.name} → ${it.sku}`); }
    const it = item(l.itemId)!; if (it.stock < x.qty) throw Object.assign(new Error('VPP_STOCK_SHORT'), { details: `${it.sku} ${it.name}` });
    it.stock -= x.qty; l.issuedQty += x.qty;
  }
  r.status = r.lines.every(l => l.issuedQty >= (l.approvedQty ?? 0)) ? 'issued' : 'partial';
  r.moves.push({ transactionId: `tx-${Date.now()}`, type: 'EXPORT', event: 'office_supply_issue', date: new Date().toISOString(), code: `XK-0${408 + r.moves.length}`, reason: null });
  log(r, 'issue'); r.rowVersion++;
  return view(r);
};
officeSupplyService.returnStock = async input => {
  await wait();
  const r = find(input.id);
  input.lines.forEach(x => { const l = r.lines.find(y => y.id === x.lineId)!; l.returnedQty += x.qty; item(l.itemId)!.stock += x.qty; });
  r.moves.push({ transactionId: `tx-${Date.now()}`, type: 'IMPORT', event: 'office_supply_return', date: new Date().toISOString(), code: 'NK-0683', reason: input.reason });
  log(r, 'return_stock', input.reason); r.rowVersion++;
  return view(r);
};
officeSupplyService.receipts = async () => { await wait(); return structuredClone(receipts); };
officeSupplyService.receive = async input => {
  await wait();
  const newItems = input.lines.filter(l => !l.itemId).map((l, i) => ({ sku: `VPP${83 + i}`, name: l.name }));
  receipts.unshift({ transactionId: `tx-in-${Date.now()}`, date: new Date().toISOString(), supplierName: input.supplierName || null, invoiceNo: input.invoiceNo || null, note: null,
    attachments: input.files.length, code: 'NK-0684', amount: input.lines.reduce((s, l) => s + l.qty * l.price, 0), byName: me.name,
    lines: input.lines.map(l => ({ name: l.name, sku: null, unit: l.unit, qty: l.qty, price: l.price })) });
  return { transactionId: 'tx-in', code: 'NK-0684', newItems, filesError: null };
};
officeSupplyService.attachReceiptFiles = async (id, files) => { await wait(); const r = receipts.find(x => x.transactionId === id); if (r) r.attachments += files.length; };
officeSupplyService.settings = async () => { await wait(); if (!can.manage) throw Object.assign(new Error('VPP_MANAGE_DENIED'), { code: '42501' }); return structuredClone(settings); };
officeSupplyService.saveSettings = async input => {
  await wait();
  Object.assign(settings, { thresholdAmount: input.thresholdAmount, thresholdApproverId: input.thresholdApproverId, fallbackApproverId: input.fallbackApproverId, rowVersion: settings.rowVersion + 1 });
  input.approvers.forEach(a => { const d = settings.departments.find(x => x.orgUnitId === a.orgUnitId)!; d.approverId = a.approverId; d.deputyId = a.deputyId; });
  (window as any).lastSettings = input;
  return structuredClone(settings);
};

createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={['/vpp']}><ToastProvider><ConfirmProvider><OfficeSupplies /></ConfirmProvider></ToastProvider></MemoryRouter>,
);
