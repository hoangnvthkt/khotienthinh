import { RequestPurchaseLines } from './RequestPurchaseLines';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowUpRight, Boxes, CalendarClock, ChevronRight, CircleSlash, FilePlus2, FileText, Flame, Inbox, Layers, Link2, Loader2, PackageCheck,
  Hand, RefreshCw, RotateCcw, Search, ShoppingCart, Stamp, Truck, UserRound, Warehouse,
} from 'lucide-react';
import { useConfirm, useReasonConfirm } from '../../../context/ConfirmContext';
import { useToast } from '../../../context/ToastContext';
import { useApp } from '../../../context/AppContext';
import {
  PROCUREMENT_PO_STATUS_LABELS, PROCUREMENT_PROGRESS_LABELS, PROCUREMENT_SOURCE_LABELS, procurementInboxService, procurementSourceLink, urgencyOf, canOrderProcurementSource, isExternalProcurementSource,
  type ProcurementProactiveCandidate,
  type ProcurementInbox, type ProcurementInboxDetail, type ProcurementInboxDocument, type ProcurementInboxFilter, type ProcurementInboxLine,
  type ProcurementOrderDetail, type ProcurementOrderStage, type ProcurementProgress, type ProcurementSourceRef, type ProcurementSourceType,
} from '../../../lib/procurementInboxService';
import { dateVi, fmt, useGroupAccordion } from '../../project/work-plan/workPlanUi';
import { Badge, Drawer, StateBox, inputCls, primaryBtn, secondaryBtn } from './hubUi';
import { OrderDrawer } from './OrderDrawer';
import { OrderEditor } from './OrderEditor';
import { ProactiveOrderEditor } from './ProactiveOrderEditor';
import { OrdersView } from './OrdersView';
import { ContractsView } from './ContractsView';
import { ReceiptReconciliationView } from '../receipt/ReceiptReconciliationView';
import { SupplyFromStockDrawer, TRANSFER_STATUS_LABELS } from './SupplyFromStockDrawer';
import { ExternalSourceSnapshot } from './ExternalSourceSnapshot';
import { HotPurchaseView } from '../hotPurchase/HotPurchaseView';
import type { HotPurchasePrefill } from '../../../lib/hotPurchaseService';
import { docBuyers, givenName, lineKey, lineOwner, openLineOwners } from '../../../lib/procurementLineAssignment';

// Mua hàng hub: one place where the procurement team receives every purchase need
// (KH vật tư, đề xuất công trường, later other modules), turns it into orders that
// are approved here, and follows them through delivery and warehouse receipt.

type Stage = 'intake' | ProcurementOrderStage;

const URGENCY_STYLE = {
  overdue: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-900',
  soon: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900',
  normal: 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700',
  none: 'bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700',
};
const PROGRESS_STYLE: Record<ProcurementProgress, string> = {
  new: 'text-rose-700 dark:text-rose-300',
  partial: 'text-amber-700 dark:text-amber-300',
  ordered: 'text-sky-700 dark:text-sky-300',
  received: 'text-emerald-700 dark:text-emerald-300',
  closed: 'text-slate-500 dark:text-slate-400',
};
const SOURCE_STYLE: Record<ProcurementSourceType, string> = {
  request: 'bg-violet-50 text-violet-800 border-violet-200 dark:bg-violet-950/40 dark:text-violet-200 dark:border-violet-900',
  workflow: 'bg-orange-50 text-orange-800 border-orange-200 dark:bg-orange-950/40 dark:text-orange-200 dark:border-orange-900',
  material_plan: 'bg-teal-50 text-teal-800 border-teal-200 dark:bg-teal-950/40 dark:text-teal-200 dark:border-teal-900',
  material_request: 'bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-200 dark:border-indigo-900',
};
const PROJECT_TONES = [
  'border-l-teal-500 bg-teal-50/70 text-teal-950 dark:bg-teal-950/30 dark:text-teal-100',
  'border-l-indigo-500 bg-indigo-50/70 text-indigo-950 dark:bg-indigo-950/30 dark:text-indigo-100',
  'border-l-orange-500 bg-orange-50/70 text-orange-950 dark:bg-orange-950/30 dark:text-orange-100',
  'border-l-sky-500 bg-sky-50/70 text-sky-950 dark:bg-sky-950/30 dark:text-sky-100',
];
const docKey = (d: ProcurementSourceRef) => `${d.sourceType}:${d.sourceId}`;
const refOf = (d: ProcurementSourceRef): ProcurementSourceRef => ({ sourceType: d.sourceType, sourceId: d.sourceId });

const UrgencyBadge: React.FC<{ date: string | null; today: string }> = ({ date, today }) => {
  const u = urgencyOf(date, today);
  return <Badge className={`${URGENCY_STYLE[u.tone]} ${u.tone === 'overdue' ? 'overdue-blink' : ''}`}><CalendarClock size={11} />{u.label}</Badge>;
};

// ---------------------------------------------------------------------------
// Stage strip: the whole buying pipeline at a glance; each card is also a tab.
// ---------------------------------------------------------------------------
const StageStrip: React.FC<{ inbox: ProcurementInbox; stage: Stage; onStage: (s: Stage) => void }> = ({ inbox, stage, onStage }) => {
  const s = inbox.stages;
  const warn = (n: number, text: string) => n > 0 ? <span className="font-semibold text-rose-700 dark:text-rose-300">{n} {text}</span> : null;
  const cards: Array<{ key: Stage; label: string; value: number; hint: React.ReactNode; icon: React.ElementType; tone: string }> = [
    { key: 'intake', label: 'Cần mua', value: s.intake, icon: Inbox, tone: 'text-teal-700 dark:text-teal-300',
      hint: <>{warn(s.intakeUrgent, 'quá hạn/gấp')}{s.intakeUrgent > 0 && s.unassigned > 0 && ' · '}{s.unassigned > 0 && `${s.unassigned} chưa giao`}{!s.intakeUrgent && !s.unassigned && 'phiếu nhu cầu mở'}</> },
    { key: 'drafting', label: 'Lập & duyệt đơn', value: s.drafting, icon: Stamp, tone: 'text-amber-700 dark:text-amber-300',
      hint: s.awaitingMe > 0 ? <span className="font-semibold text-amber-800 dark:text-amber-200">{s.awaitingMe} chờ bạn duyệt</span> : 'nháp, chờ duyệt, bị trả lại' },
    { key: 'ordered', label: 'Chờ giao', value: s.ordered, icon: ShoppingCart, tone: 'text-indigo-700 dark:text-indigo-300',
      hint: warn(s.orderedLate, 'quá ngày hẹn giao') || 'đã duyệt, chờ NCC giao' },
    { key: 'delivering', label: 'Đang giao', value: s.delivering, icon: Truck, tone: 'text-orange-700 dark:text-orange-300',
      hint: warn(s.deliveringLate, 'quá ngày hẹn giao') || 'hàng về từng đợt' },
    { key: 'received', label: 'Đã giao đủ', value: s.receiving, icon: PackageCheck, tone: 'text-emerald-700 dark:text-emerald-300',
      hint: 'đối chiếu & đóng đơn' },
  ];
  return <nav aria-label="Các bước mua hàng" className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
    {cards.map((card, i) => {
      const Icon = card.icon; const active = card.key === stage;
      return <button key={card.key} type="button" aria-current={active ? 'page' : undefined} onClick={() => onStage(card.key)}
        className={`relative rounded-2xl border bg-card p-3 text-left shadow-sm transition md:p-4 ${active ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-border hover:border-teal-300'} ${i === 0 ? 'col-span-2 md:col-span-1' : ''}`}>
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-muted text-[11px] font-bold text-foreground">{i + 1}</span>{card.label}</span>
        <span className="mt-2 flex items-center gap-2"><Icon size={18} className={card.tone} /><span className="text-2xl font-bold tabular-nums text-foreground">{card.value}</span></span>
        <span className="mt-1 block text-xs text-muted-foreground">{card.hint}</span>
      </button>;
    })}
  </nav>;
};

// ---------------------------------------------------------------------------
// Need document drawer
// ---------------------------------------------------------------------------
export const NeedDrawer: React.FC<{
  doc: ProcurementInboxDocument; today: string; canManage: boolean; assignees: ProcurementInbox['assignees']; currentUserId: string;
  onClose: () => void; onAssign: (userId: string | null) => Promise<void>; onOrder: (lineKeys?: string[]) => void;
  onCloseNeed: () => void; onReopen: () => void; onOpenOrder: (id: string) => void; onChanged: () => void;
  onHotPurchase: (prefill: HotPurchasePrefill) => void;
}> = ({ doc, today, canManage, assignees, currentUserId, onClose, onAssign, onOrder, onCloseNeed, onReopen, onOpenOrder, onChanged, onHotPurchase }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const [detail, setDetail] = useState<ProcurementInboxDetail | null>(null);
  const [candidates, setCandidates] = useState<ProcurementProactiveCandidate[]>([]);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [supplyLine, setSupplyLine] = useState<ProcurementInboxLine | null>(null);
  // Giao việc theo dòng: tick dòng → giao / nhận / lập đơn đúng các dòng đó.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pickAssignee, setPickAssignee] = useState('');
  const [lineBusy, setLineBusy] = useState(false);
  const load = useCallback(() => {
    setError(null); setDetail(null); setPicked(new Set());
    procurementInboxService.get(doc.sourceType, doc.sourceId).then(setDetail).catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, [doc.sourceType, doc.sourceId]);
  useEffect(load, [load, doc.progress, doc.closedAt]);
  // Đơn chủ động cùng dự án còn phần chưa phân bổ cho vật tư phiếu đang thiếu: gắn vào thay vì mua thêm.
  const loadCandidates = useCallback(() => {
    if (!canManage || doc.closedAt || !canOrderProcurementSource(doc)) { setCandidates([]); return; }
    procurementInboxService.proactiveCandidates(doc.sourceType, doc.sourceId).then(setCandidates).catch(() => setCandidates([]));
  }, [canManage, doc.closedAt, doc.sourceType, doc.sourceId, doc.orderable, doc.intakeState]);
  useEffect(loadCandidates, [loadCandidates, doc.progress]);
  const linkCandidate = async (c: ProcurementProactiveCandidate) => {
    const qty = Math.min(c.remainingQty, c.unallocatedQty);
    const ok = await confirm({ title: 'Gắn nhu cầu vào đơn chủ động?', targetName: `${doc.code} → ${c.poNumber}`, confirmText: 'Gắn vào đơn', actionLabel: 'Gắn vào đơn',
      subtitle: `${c.itemName}: ${fmt(qty, 3)} ${c.unit || ''}. Dòng này tính là đã đặt; hàng của ${c.poNumber} về sẽ chia cho nhu cầu đã gắn trước.`,
      warningText: `Gắn nhầm thì gỡ ở chi tiết ${c.poNumber} (bắt buộc ghi lý do) — phần đó quay lại Cần mua.`, intent: 'success', countdownSeconds: 0 });
    if (!ok) return;
    setLinking(true);
    try {
      await procurementInboxService.linkProactive({ action: 'link', purchaseOrderId: c.purchaseOrderId, poLineId: c.poLineId,
        sourceType: doc.sourceType, sourceId: doc.sourceId, lineId: c.needLineId, qty });
      toast.success(`Đã gắn ${fmt(qty, 3)} ${c.unit || ''} ${c.itemName} vào ${c.poNumber}`, `${doc.code} không cần lập đơn mới cho dòng này. Theo dõi giao hàng ở ${c.poNumber}.`);
      load(); loadCandidates(); onChanged();
    } catch (e) { toast.error('Chưa gắn được', e instanceof Error ? e.message : ''); } finally { setLinking(false); }
  };
  const link = procurementSourceLink(doc);
  const lines = detail?.lines || [];
  const missing = lines.filter(l => l.remainingQty > 0).length;
  const withdrawn = doc.intakeState === 'withdrawn' || detail?.intakeState === 'withdrawn';
  const closed = Boolean(doc.closedAt) || doc.progress === 'closed' || withdrawn;
  const external = isExternalProcurementSource(doc.sourceType);
  const orderable = canOrderProcurementSource(doc) && (!detail || canOrderProcurementSource(detail));
  // Mỗi dòng một người mua; dòng chưa giao riêng thuộc người điều phối (người xử lý của phiếu).
  const lineTools = canManage && orderable && !closed && !external;
  const split = lines.some(l => l.assigneeUserId);
  const ownerOf = (l: ProcurementInboxLine) => lineOwner(l, detail || { assignment: null });
  const openLines = lines.filter(l => l.remainingQty > 0);
  const owners = detail ? openLineOwners(detail) : [];
  const mineOpen = openLines.filter(l => ownerOf(l).userId === currentUserId);
  const orderableForMe = split ? openLines.filter(l => { const o = ownerOf(l).userId; return !o || o === currentUserId; }).length : openLines.length;
  const shownLines = split ? [...lines].sort((a, b) => Number(ownerOf(b).userId === currentUserId) - Number(ownerOf(a).userId === currentUserId)) : lines;
  const pickedLines = openLines.filter(l => picked.has(l.lineId));
  const takenByOthers = pickedLines.filter(l => l.assigneeUserId && l.assigneeUserId !== currentUserId).length;
  const allPicked = openLines.length > 0 && pickedLines.length === openLines.length;
  const togglePick = (id: string) => setPicked(cur => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const assignLines = async (lineIds: string[], opts: { assigneeUserId?: string | null; claim?: boolean }) => {
    setLineBusy(true);
    try {
      const r = await procurementInboxService.assignLines({ sourceType: doc.sourceType, sourceId: doc.sourceId, lineIds, ...opts });
      const to = opts.claim ? currentUserId : opts.assigneeUserId || null;
      const name = assignees.find(a => a.id === to)?.name;
      toast.success(opts.claim ? `Bạn đã nhận ${r.assigned} dòng` : to ? `Đã giao ${r.assigned} dòng cho ${name || 'người được chọn'}` : `Đã trả ${r.assigned} dòng về người điều phối`,
        to && to !== currentUserId ? 'Người nhận đã được thông báo.' : opts.claim ? 'Các dòng này hiện trong Việc của tôi.' : undefined);
      setPickAssignee('');
      load(); onChanged();
    } catch (e) { toast.error('Chưa giao được', e instanceof Error ? e.message : ''); } finally { setLineBusy(false); }
  };

  return <Drawer label={`Phiếu ${doc.code}`} onClose={onClose}
    header={<>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge className={SOURCE_STYLE[doc.sourceType]}>{PROCUREMENT_SOURCE_LABELS[doc.sourceType]}</Badge>
        {closed ? <Badge className="border-border bg-muted text-muted-foreground">{withdrawn ? 'Nguồn đã thu hồi' : 'Đã đóng'}</Badge> : <UrgencyBadge date={doc.neededDate} today={today} />}
      </div>
      <h2 className="mt-2 text-lg font-bold text-foreground">{doc.code}{doc.title && <span className="font-medium text-muted-foreground"> · {doc.title}</span>}</h2>
      <p className="text-sm text-muted-foreground">{[doc.projectCode, doc.projectName].filter(Boolean).join(' — ') || 'Không gắn dự án'}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-4">
        {([
          [Warehouse, 'Kho nhận', doc.warehouseName || 'Chưa chọn kho'],
          [CalendarClock, 'Ngày cần', doc.neededDate ? dateVi(doc.neededDate) : 'Chưa có'],
          [UserRound, 'Người đề xuất', doc.requesterName || '—'],
          [FileText, 'Duyệt', doc.approvedByName ? `${doc.approvedByName}${doc.approvedAt ? ` · ${dateVi(doc.approvedAt)}` : ''}` : 'Đã duyệt'],
        ] as const).map(([Icon, label, value]) => <div key={label} className="min-w-0">
          <dt className="flex items-center gap-1 text-xs text-muted-foreground"><Icon size={12} />{label}</dt>
          <dd className="truncate font-medium text-foreground">{value}</dd></div>)}
      </dl>
    </>}
    footer={lineTools && pickedLines.length > 0 ? <>
      <span className="mr-auto flex items-center gap-2 text-sm font-semibold">Đã chọn {pickedLines.length} dòng
        <button type="button" onClick={() => setPicked(new Set())} className="rounded-lg px-2 py-1 text-sm font-normal text-muted-foreground hover:bg-muted">Bỏ chọn</button></span>
      <span className="flex min-w-0 flex-1 basis-full items-center gap-1 sm:basis-auto sm:flex-none">
        <select aria-label="Giao dòng đã chọn cho" value={pickAssignee} onChange={e => setPickAssignee(e.target.value)} disabled={lineBusy} className={`min-w-0 flex-1 sm:w-44 ${inputCls}`}>
          <option value="">Giao cho…</option>
          {assignees.map(a => <option key={a.id} value={a.id}>{a.name}{a.id === currentUserId ? ' (tôi)' : ''}</option>)}
          {pickedLines.some(l => l.assigneeUserId) && <option value="__coordinator">↩ Trả về người điều phối</option>}
        </select>
        <button type="button" disabled={!pickAssignee || lineBusy} className={secondaryBtn}
          onClick={() => void assignLines(pickedLines.map(l => l.lineId), { assigneeUserId: pickAssignee === '__coordinator' ? null : pickAssignee })}>Giao</button>
      </span>
      <button type="button" disabled={lineBusy || takenByOthers > 0 || pickedLines.every(l => l.assigneeUserId === currentUserId)}
        title={takenByOthers > 0 ? 'Có dòng đã giao cho người khác — dùng "Giao cho…" nếu cần chuyển người' : pickedLines.every(l => l.assigneeUserId === currentUserId) ? 'Các dòng này đã là của bạn' : 'Nhận các dòng này về mình mua'}
        onClick={() => void assignLines(pickedLines.map(l => l.lineId), { claim: true })} className={secondaryBtn}><Hand size={15} />Nhận</button>
      <button type="button" disabled={lineBusy} onClick={() => onOrder(pickedLines.map(l => lineKey(doc, l.lineId)))} className={primaryBtn}>
        {lineBusy ? <Loader2 size={15} className="animate-spin" /> : <ShoppingCart size={15} />}Lập đơn {pickedLines.length} dòng</button>
    </> : <>
      {link && <a href={link} className={`${secondaryBtn} mr-auto`}><ArrowUpRight size={15} />Mở phiếu nguồn</a>}
      {canManage && !withdrawn && (closed
        ? <button type="button" onClick={onReopen} className={secondaryBtn}><RotateCcw size={15} />Mở lại nhu cầu</button>
        : <>
          <button type="button" onClick={onCloseNeed} className={secondaryBtn}><CircleSlash size={15} />Đóng nhu cầu</button>
          {orderable && missing > 0 && <button type="button" onClick={() => onOrder()} disabled={orderableForMe === 0}
            title={orderableForMe === 0 ? 'Các dòng còn thiếu đều do người khác mua. Tick dòng nếu cần lập đơn thay.' : split && orderableForMe < openLines.length ? 'Chỉ gồm dòng của bạn và dòng chưa có người mua' : undefined}
            className={candidates.length > 0 ? secondaryBtn : primaryBtn}><ShoppingCart size={15} />{split && orderableForMe < openLines.length ? `Lập đơn ${orderableForMe} dòng của tôi` : 'Lập đơn hàng'}</button>}
        </>)}
    </>}>
    {closed && !withdrawn && <p className="rounded-xl border border-border bg-muted/50 px-3 py-2.5 text-sm">
      <b>Đã đóng — không cần mua thêm.</b> {doc.closeReason}<span className="text-muted-foreground"> · {doc.closedByName}{doc.closedAt ? `, ${dateVi(doc.closedAt)}` : ''}</span></p>}
    <section className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-sm">
      <span className="font-semibold text-foreground" title="Người điều phối phiếu: mua các dòng chưa giao riêng cho ai">Người xử lý</span>
      {canManage && !withdrawn
        ? <select aria-label="Người xử lý" value={doc.assigneeUserId || ''} disabled={saving}
          onChange={async e => { setSaving(true); try { await onAssign(e.target.value || null); } finally { setSaving(false); } }}
          className={`min-w-[12rem] ${inputCls}`}>
          <option value="">— Chưa giao —</option>
          {assignees.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        : <span className="text-muted-foreground">{doc.assigneeName || 'Chưa giao'}</span>}
      {saving && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
      {detail?.assignment?.assignedAt && <span className="text-xs text-muted-foreground">từ {dateVi(detail.assignment.assignedAt)}</span>}
      {!external && openLines.length > 0 && (split || owners.some(o => !o.userId)) && <div className="flex w-full flex-wrap items-center gap-1.5 border-t border-border pt-2 text-xs">
        <span className="text-muted-foreground">Đang mua {openLines.length} dòng còn thiếu:</span>
        {owners.map(o => o.userId
          ? <span key={o.userId} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${o.userId === currentUserId ? 'bg-teal-100 text-teal-900 dark:bg-teal-900/50 dark:text-teal-100' : 'bg-muted text-foreground'}`}>
            <UserRound size={11} />{o.userId === currentUserId ? 'Bạn' : o.name || '—'} · {o.count}</span>
          : <span key="none" className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
            <AlertTriangle size={11} />Chưa có người mua · {o.count}</span>)}
        {split && <span className="w-full text-muted-foreground">Dòng chưa giao riêng thuộc người xử lý.</span>}
      </div>}
    </section>

    {candidates.length > 0 && <section className="space-y-2 rounded-xl border border-teal-200 bg-teal-50/60 p-3 dark:border-teal-900 dark:bg-teal-950/20">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-teal-900 dark:text-teal-100"><Link2 size={15} />Đã có trong đơn chủ động — gắn vào thay vì mua thêm</p>
      <ul className="space-y-1.5">{candidates.map(c => {
        const qty = Math.min(c.remainingQty, c.unallocatedQty);
        return <li key={`${c.purchaseOrderId}:${c.poLineId}:${c.needLineId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-card px-3 py-2 text-sm">
          <span className="min-w-0 flex-1"><b className="text-mint-700 dark:text-mint-300">{c.itemName}</b> · thiếu <b className="text-leaf-700 dark:text-leaf-300">{fmt(c.remainingQty, 3)}</b> {c.unit}
            <span className="block text-xs text-muted-foreground">
              <button type="button" onClick={() => onOpenOrder(c.purchaseOrderId)} className="font-semibold text-mint-700 hover:underline dark:text-mint-300">{c.poNumber}</button>
              {c.vendorName ? ` · ${c.vendorName}` : ''} · {PROCUREMENT_PO_STATUS_LABELS[c.status] || c.status} · còn {fmt(c.unallocatedQty, 3)} {c.unit} chưa phân bổ</span></span>
          <button type="button" disabled={linking} onClick={() => void linkCandidate(c)} className={primaryBtn}>{linking ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}Gắn {fmt(qty, 3)} {c.unit}</button>
        </li>;
      })}</ul>
    </section>}

    {error ? <StateBox kind="error" message={error} onRetry={load} />
      : !detail ? <StateBox kind="loading" title="Đang tải phiếu…" />
        : external ? detail.purchaseLines?.length ? <RequestPurchaseLines detail={detail} canManage={canManage} onChanged={() => { load(); onChanged(); }} onOpenOrder={onOpenOrder} /> : <ExternalSourceSnapshot detail={detail} withdrawn={withdrawn} /> : <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              {lineTools && openLines.length > 1 && <input type="checkbox" checked={allPicked} aria-label="Chọn mọi dòng còn thiếu" className="h-4 w-4 accent-teal-600"
                onChange={() => setPicked(allPicked ? new Set() : new Set(openLines.map(l => l.lineId)))} />}
              <h3 className="font-semibold text-foreground">Vật tư cần mua</h3>
            </span>
            <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {lineTools && split && mineOpen.length > 0 && mineOpen.length < openLines.length && <button type="button" onClick={() => setPicked(new Set(mineOpen.map(l => l.lineId)))}
                className="rounded-lg border border-border px-2 py-1 font-semibold text-teal-700 hover:bg-muted dark:text-teal-300">Chọn dòng của tôi ({mineOpen.length})</button>}
              {lineTools && openLines.length > 1 && pickedLines.length === 0 && <span className="hidden sm:inline">Tick dòng để chia cho người mua</span>}
              <span>{missing > 0 ? `${missing}/${lines.length} dòng còn thiếu` : `Đã đặt đủ ${lines.length} dòng`}</span>
            </span>
          </div>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">{shownLines.map(l => {
            const owner = ownerOf(l);
            const mine = owner.userId === currentUserId;
            const canPick = lineTools && l.remainingQty > 0;
            return <li key={l.lineId} className={`relative flex gap-2.5 px-3 py-2.5 ${picked.has(l.lineId) ? 'bg-teal-50/60 dark:bg-teal-950/20' : split && owner.userId && !mine ? 'bg-muted/30' : ''}`}>
            {split && mine && <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-teal-500" />}
            {canPick && <input type="checkbox" checked={picked.has(l.lineId)} onChange={() => togglePick(l.lineId)} aria-label={`Chọn ${l.itemName}`} className="mt-1 h-4 w-4 shrink-0 accent-teal-600" />}
            <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium text-foreground">{l.itemName}<span className="ml-2 text-xs font-normal text-muted-foreground">{[l.sku, l.unit].filter(Boolean).join(' · ')}</span></p>
              <span className="flex shrink-0 flex-col items-end gap-0.5">
                <span className={`text-sm font-semibold ${l.remainingQty > 0 ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'}`}>{l.remainingQty > 0 ? `Thiếu ${fmt(l.remainingQty)}` : 'Đã đặt đủ'}</span>
                {!external && (owner.userId
                  ? <span className={`inline-flex items-center gap-1 text-xs ${mine ? 'font-semibold text-teal-700 dark:text-teal-300' : 'text-muted-foreground'}`} title={owner.explicit ? 'Được giao riêng dòng này' : 'Theo người xử lý của phiếu'}>
                    <UserRound size={11} />{mine ? 'Bạn mua' : owner.name || '—'}</span>
                  : l.remainingQty > 0 && <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-300"><UserRound size={11} />Chưa có người mua</span>)}
                {canPick && !owner.userId && <button type="button" disabled={lineBusy} onClick={() => void assignLines([l.lineId], { claim: true })}
                  className="text-xs font-semibold text-teal-700 hover:underline disabled:opacity-50 dark:text-teal-300">Nhận dòng này</button>}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">Cần {fmt(l.needQty)} · đã đặt/cấp {fmt(l.orderedQty) || 0} · đã nhận {fmt(l.receivedQty) || 0} · tồn kho nhận {l.stockQty == null ? '—' : fmt(l.stockQty)}</p>
            {(l.orders.length > 0 || (l.transfers || []).length > 0) && <p className="mt-1 flex flex-wrap gap-1">{l.orders.map(o => <button key={o.id} type="button" onClick={() => onOpenOrder(o.id)}
              className="rounded bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-800 hover:underline dark:bg-sky-950/40 dark:text-sky-200">
              {o.poNumber || 'PO'} · {fmt(o.orderedQty)}{o.vendorName ? ` · ${o.vendorName}` : ''}</button>)}
              {(l.transfers || []).map(t => <span key={t.id} title={t.id} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${t.status === 'CANCELLED' ? 'bg-muted text-muted-foreground line-through' : 'bg-teal-50 text-teal-800 dark:bg-teal-950/40 dark:text-teal-200'}`}>
                <Truck size={11} />Chuyển kho · {fmt(t.qty)} · {t.sourceWarehouseName || 'kho gửi'} · {TRANSFER_STATUS_LABELS[t.status] || t.status}</span>)}</p>}
            {canManage && orderable && !closed && l.remainingQty > 0 && <div className="mt-2 flex flex-wrap items-center gap-2">
              {(l.otherStock || []).length > 0 && <button type="button" onClick={() => setSupplyLine(l)} className={secondaryBtn}>
                <Warehouse size={15} />Cấp từ kho
                <span className="rounded-full bg-teal-100 px-1.5 text-xs tabular-nums text-teal-800 dark:bg-teal-900/60 dark:text-teal-100">{fmt((l.otherStock || []).reduce((sum, x) => sum + x.qty, 0))}</span></button>}
              {doc.sourceType === 'material_request' && doc.projectId && <button type="button" className={secondaryBtn} title="Công trường mua gấp / nhỏ lẻ: dưới ngưỡng mua trước báo sau, từ ngưỡng CHT duyệt trước"
                onClick={() => onHotPurchase({ projectId: doc.projectId!, constructionSiteId: doc.constructionSiteId, targetWarehouseId: doc.warehouseId,
                  line: { itemId: l.itemId, name: l.itemName, unit: l.unit, qty: l.remainingQty, materialRequestId: doc.sourceId, requestLineId: l.lineId, requestCode: doc.code } })}>
                <Flame size={15} />Mua nóng</button>}
              {(l.otherStock || []).length > 0 && <span className="text-xs text-muted-foreground">{(l.otherStock || []).length} kho khác còn hàng</span>}
            </div>}
            </div>
          </li>;
          })}</ul>
        </section>}
    {supplyLine && <SupplyFromStockDrawer doc={doc} line={supplyLine} onClose={() => setSupplyLine(null)}
      onDone={() => { setSupplyLine(null); load(); onChanged(); }} />}
  </Drawer>;
};

// ---------------------------------------------------------------------------
// Intake list
// ---------------------------------------------------------------------------
// Người mua của phiếu: một người như cũ; phiếu đã chia theo dòng thì hiện từng người + số dòng còn thiếu.
const DocBuyers: React.FC<{ doc: ProcurementInboxDocument; currentUserId: string }> = ({ doc, currentUserId }) => {
  const buyers = docBuyers(doc);
  if (!buyers) return <span className={`inline-flex items-center gap-1 ${doc.assigneeName ? 'text-foreground' : 'text-amber-700 dark:text-amber-300'}`}><UserRound size={12} />{doc.assigneeName || 'Chưa giao'}</span>;
  const label = (p: { userId: string; name: string | null }) => (p.userId === currentUserId ? 'Bạn' : givenName(p.name));
  return <span className="inline-flex min-w-0 items-center gap-1 text-foreground" title={buyers.people.map(p => `${p.name || '—'}: ${p.count} dòng`).concat(buyers.unassigned ? [`Chưa có người mua: ${buyers.unassigned} dòng`] : []).join('\n')}>
    <UserRound size={12} className="shrink-0" />
    <span className="truncate">{buyers.people.map(p => `${label(p)} ${p.count}`).join(' · ')}</span>
    {buyers.unassigned > 0 && <span className="shrink-0 font-semibold text-amber-700 dark:text-amber-300">{buyers.people.length ? '· ' : ''}{buyers.unassigned} chưa giao</span>}
  </span>;
};

export const DocumentRow: React.FC<{
  doc: ProcurementInboxDocument; today: string; currentUserId: string; selectable: boolean; selected: boolean; onSelect: () => void; onOpen: () => void;
}> = ({ doc, today, currentUserId, selectable, selected, onSelect, onOpen }) =>
  <li className={`flex items-stretch border-t border-border ${selected ? 'bg-teal-50/60 dark:bg-teal-950/20' : 'bg-card hover:bg-muted/40'}`}>
    {selectable && <label className="flex w-11 shrink-0 cursor-pointer items-center justify-center">
      <input type="checkbox" checked={selected} disabled={doc.intakeState === 'withdrawn'} onChange={onSelect} aria-label={`Chọn ${doc.code}`} className="h-4 w-4 accent-teal-600" /></label>}
    <button type="button" onClick={onOpen} className={`flex min-w-0 flex-1 flex-col gap-1.5 py-3 pr-3 text-left md:flex-row md:items-center md:gap-4 ${selectable ? '' : 'pl-4'}`}>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold text-foreground">{doc.code}</span>
          <Badge className={SOURCE_STYLE[doc.sourceType]}>{PROCUREMENT_SOURCE_LABELS[doc.sourceType]}</Badge>
        </span>
        <span className="mt-0.5 block truncate text-sm text-muted-foreground">{doc.title || 'Không tiêu đề'}{doc.requesterName && ` · ${doc.requesterName}`}</span>
      </span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs md:w-[24rem] md:shrink-0 md:justify-end xl:w-[34rem]">
        {doc.progress === 'closed' ? <span className="truncate text-muted-foreground" title={doc.closeReason || ''}>Lý do: {doc.closeReason}</span> : <UrgencyBadge date={doc.neededDate} today={today} />}
        <span className={`font-semibold ${PROGRESS_STYLE[doc.progress]}`}>{doc.intakeState === 'withdrawn' ? 'Nguồn đã thu hồi' : isExternalProcurementSource(doc.sourceType) && doc.progress !== 'closed' ? 'Đã tiếp nhận · chờ đối chiếu' : PROCUREMENT_PROGRESS_LABELS[doc.progress]}
          {isExternalProcurementSource(doc.sourceType) ? <span className="font-normal text-muted-foreground"> · {doc.lineCount} dòng nguồn</span> : doc.progress !== 'closed' && <span className="font-normal text-muted-foreground"> · đủ {doc.orderedLines}/{doc.lineCount} dòng{doc.partialLines > 0 ? ` · ${doc.partialLines} dòng đặt thiếu` : ''}</span>}</span>
        <DocBuyers doc={doc} currentUserId={currentUserId} />
      </span>
      <ChevronRight size={16} className="hidden shrink-0 text-muted-foreground md:block" />
    </button>
  </li>;

const EMPTY_FILTER: Required<ProcurementInboxFilter> = { source: '', progress: 'open', projectId: '', assigneeId: '', search: '' };

export const ProcurementHubView: React.FC<{ currentUserId: string; initialOrderId?: string | null; initialContractId?: string | null; initialMode?: string | null; initialHotPurchaseId?: string | null }> = ({ currentUserId, initialOrderId = null, initialContractId = null, initialMode = null, initialHotPurchaseId = null }) => {
  const toast = useToast();
  const askReason = useReasonConfirm();
  const { items, warehouses } = useApp();
  const [stage, setStage] = useState<Stage>(initialOrderId ? 'drafting' : 'intake');
  const [mode, setMode] = useState<'orders' | 'contracts' | 'hot' | 'reconcile'>(initialContractId || initialMode === 'contracts' ? 'contracts' : initialMode === 'reconcile' ? 'reconcile' : initialMode === 'hot' || initialHotPurchaseId ? 'hot' : 'orders');
  const [hotPrefill, setHotPrefill] = useState<HotPurchasePrefill | null>(null);
  const [filter, setFilter] = useState<Required<ProcurementInboxFilter>>(EMPTY_FILTER);
  const [searchText, setSearchText] = useState('');
  const [inbox, setInbox] = useState<ProcurementInbox | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [message, setMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAssignee, setBulkAssignee] = useState('');
  const [openSnap, setOpenSnap] = useState<ProcurementInboxDocument | null>(null);
  const [editor, setEditor] = useState<{ sources: ProcurementSourceRef[]; order: ProcurementOrderDetail | null; lineKeys?: string[] } | null>(null);
  const [proactive, setProactive] = useState<{ order: ProcurementOrderDetail | null } | null>(null);
  const [orderId, setOrderId] = useState<string | null>(initialOrderId);
  const [ordersReload, setOrdersReload] = useState(0);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setStatus(s => (s === 'ready' ? s : 'loading'));
    try {
      setInbox(await procurementInboxService.list(filter));
      setStatus('ready');
    } catch (e) {
      const denied = (e as { code?: string })?.code === 'PROCUREMENT_VIEW_DENIED';
      setMessage(denied ? 'Màn hình này dành cho phòng Mua hàng. Nhờ quản trị cấp quyền "Mua hàng — Xem" nếu bạn cần.' : e instanceof Error ? e.message : String(e));
      setStatus(denied ? 'denied' : 'error');
    } finally { setRefreshing(false); }
  }, [filter]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const t = setTimeout(() => setFilter(f => (f.search === searchText.trim() ? f : { ...f, search: searchText.trim() })), 300); return () => clearTimeout(t); }, [searchText]);
  useEffect(() => { setSelected(new Set()); }, [filter]);
  const refreshAll = () => { void load(true); setOrdersReload(n => n + 1); };

  const docs = useMemo(() => inbox?.documents || [], [inbox]);
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; name: string | null; docs: ProcurementInboxDocument[] }>();
    docs.forEach(d => {
      const key = d.projectId || 'none';
      const g = map.get(key) || { key, label: d.projectCode || 'Không gắn dự án', name: d.projectName, docs: [] };
      g.docs.push(d); map.set(key, g);
    });
    return Array.from(map.values());
  }, [docs]);
  const accordion = useGroupAccordion(groups.map(g => g.key));
  // Keep the drawer open even when the document leaves the filtered list (e.g. after assigning).
  const openDoc = openSnap ? docs.find(d => docKey(d) === docKey(openSnap)) || openSnap : null;
  const canManage = Boolean(inbox?.canManage);
  const selectedDocs = docs.filter(d => selected.has(docKey(d)));
  const selectedOpen = selectedDocs.filter(d => d.intakeState !== 'withdrawn' && (d.progress === 'new' || d.progress === 'partial'));
  const selectedOrderable = selectedOpen.filter(canOrderProcurementSource);
  const selectedReviewOnly = selectedOpen.length - selectedOrderable.length;
  const selectedScopes = new Set(selectedOrderable.map(d => `${d.projectId}|${d.constructionSiteId}`));
  // Việc 2: phiếu của nhiều dự án → một đơn gom (mỗi phiếu cần kho nhận).
  const selectedProjects = new Set(selectedOrderable.map(d => d.projectId)).size;
  const missingWarehouse = selectedOrderable.filter(d => !d.warehouseId).length;

  const assign = async (keys: string[], userId: string | null) => {
    const sources = docs.filter(d => keys.includes(docKey(d))).map(refOf);
    try {
      const r = await procurementInboxService.assign({ sources, assigneeUserId: userId });
      const name = inbox?.assignees.find(a => a.id === userId)?.name;
      setOpenSnap(cur => (cur && keys.includes(docKey(cur)) ? { ...cur, assigneeUserId: userId, assigneeName: name || null } : cur));
      toast.success(userId ? `Đã giao ${r.assigned} phiếu cho ${name}` : `Đã bỏ giao ${r.assigned} phiếu`, userId && userId !== currentUserId ? 'Người nhận đã được thông báo.' : undefined);
      setSelected(new Set()); setBulkAssignee('');
      await load(true);
    } catch (e) { toast.error('Chưa giao được', e instanceof Error ? e.message : ''); }
  };

  const closeNeeds = async (targets: ProcurementInboxDocument[]) => {
    // Đề xuất vật tư: đóng nhu cầu = Kết thúc đề xuất bên dự án (dòng đã đặt / đang chuyển vẫn giao).
    const hasRequest = targets.some(d => d.sourceType === 'material_request');
    const reason = await askReason({
      title: targets.length > 1 ? `Đóng ${targets.length} phiếu nhu cầu` : 'Đóng nhu cầu', targetName: targets.map(d => d.code).join(', '),
      subtitle: hasRequest
        ? 'Phiếu ra khỏi Cần mua và đề xuất bên dự án chuyển "Kết thúc" kèm lý do này. Dòng đã đặt PO / đang chuyển kho vẫn giao bình thường. Mở lại được khi cần.'
        : 'Phiếu sẽ ra khỏi danh sách cần mua. Có thể mở lại khi cần.', reasonLabel: 'Lý do không cần mua',
      reasonPlaceholder: 'VD: Đã mua ngoài, công trường hủy, trùng phiếu…', actionLabel: 'Đóng nhu cầu', intent: 'warning',
    });
    if (!reason) return;
    try {
      const r = await procurementInboxService.close({ sources: targets.map(refOf), action: 'close', reason });
      toast.success(`Đã đóng ${r.changed} phiếu nhu cầu`, r.endedRequests
        ? `${r.endedRequests} đề xuất bên dự án đã chuyển Kết thúc. Xem lại ở bộ lọc "Đã đóng".` : 'Xem lại ở bộ lọc "Đã đóng".');
      setOpenSnap(cur => (cur && targets.some(t => docKey(t) === docKey(cur)) ? { ...cur, progress: 'closed', closedAt: new Date().toISOString(), closeReason: reason } : cur));
      setSelected(new Set());
      await load(true);
    } catch (e) { toast.error('Chưa đóng được', e instanceof Error ? e.message : ''); }
  };
  const reopenNeed = async (doc: ProcurementInboxDocument) => {
    try {
      await procurementInboxService.close({ sources: [refOf(doc)], action: 'reopen' });
      toast.success(`Đã mở lại ${doc.code}`, doc.sourceType === 'material_request' ? 'Đề xuất bên dự án về lại "Đang cung ứng".' : undefined);
      setOpenSnap(cur => (cur && docKey(cur) === docKey(doc) ? { ...cur, progress: 'new', closedAt: null, closeReason: null } : cur));
      await load(true);
    } catch (e) { toast.error('Chưa mở lại được', e instanceof Error ? e.message : ''); }
  };

  const setF = (patch: Partial<ProcurementInboxFilter>) => setFilter(f => ({ ...f, ...patch }));
  const filtersActive = Boolean(filter.source || filter.projectId || filter.assigneeId || filter.search || filter.progress !== 'open');
  const sourceTotal = inbox ? Object.values(inbox.sourceCounts).reduce((a, b) => a + (b || 0), 0) : 0;

  return <main className="min-h-screen space-y-4 bg-slate-50 px-3 py-4 text-foreground dark:bg-slate-950 sm:px-5 md:py-5">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-teal-700 text-white shadow-sm"><Boxes size={22} /></span>
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">Mua hàng</h1>
          <p className="text-sm text-muted-foreground">Tiếp nhận nhu cầu từ mọi nguồn, lập và duyệt đơn hàng, theo dõi tới khi nhập kho.</p>
        </div>
      </div>
      <span className="flex flex-wrap items-center gap-2">
        {canManage && mode === 'orders' && <button type="button" onClick={() => setProactive({ order: null })} className={primaryBtn}
          title="Mua khi chưa có phiếu nhu cầu: chốt giá, hàng đặt dài ngày, bù tồn…"><FilePlus2 size={15} />Lập đơn chủ động</button>}
        <button type="button" onClick={refreshAll} disabled={refreshing || status === 'loading'} className={`${secondaryBtn} bg-card`}>
          <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />Làm mới</button>
      </span>
    </header>

    {status === 'denied' && mode === 'hot' ? <HotPurchaseView items={items} initialPurchaseId={initialHotPurchaseId} />
      // Công trường không có quyền Mua hàng vẫn gọi hàng theo HĐ của dự án mình (link ?mode=contracts).
      : status === 'denied' && mode === 'contracts' ? <ContractsView projects={[]} warehouses={warehouses} initialContractId={initialContractId} currentUserId={currentUserId} />
      : status === 'denied' ? <StateBox kind="denied" message={message} />
      : status === 'error' && !inbox ? <StateBox kind="error" title="Chưa tải được Mua hàng" message={message} onRetry={() => void load()} />
        : !inbox ? <StateBox kind="loading" title="Đang tải nhu cầu mua hàng…" />
          : <>
            <div className="inline-flex max-w-full overflow-x-auto rounded-xl border border-border bg-card p-1 shadow-sm" role="tablist" aria-label="Hình thức mua">
              {([['orders', 'Đơn hàng (PO)'], ['contracts', 'Hợp đồng nguyên tắc'], ['hot', 'Mua nóng'], ['reconcile', 'Đối chiếu nhận hàng']] as const).map(([k, l]) =>
                <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
                  className={`whitespace-nowrap rounded-lg px-4 py-1.5 text-sm font-semibold transition ${mode === k ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:text-foreground'}`}>{l}</button>)}
            </div>
            {mode === 'reconcile' ? <ReceiptReconciliationView currentUserId={currentUserId} />
              : mode === 'hot' ? <HotPurchaseView items={items} initialPurchaseId={initialHotPurchaseId} prefill={hotPrefill} onPrefillUsed={() => setHotPrefill(null)} showSettings />
              : mode === 'contracts' ? <ContractsView projects={inbox.projects} warehouses={warehouses} initialContractId={initialContractId} currentUserId={currentUserId} /> : <>
            <StageStrip inbox={inbox} stage={stage} onStage={setStage} />
            {stage !== 'intake' ? <OrdersView stage={stage} projects={inbox.projects} reloadKey={ordersReload} onOpen={setOrderId} /> : <section className="space-y-3">
              <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Nguồn đề xuất">
                {([['', 'Tất cả nguồn', sourceTotal], ['material_plan', PROCUREMENT_SOURCE_LABELS.material_plan, inbox.sourceCounts.material_plan || 0],
                  ['material_request', PROCUREMENT_SOURCE_LABELS.material_request, inbox.sourceCounts.material_request || 0],
                  ['request', PROCUREMENT_SOURCE_LABELS.request, inbox.sourceCounts.request ?? '—'],
                  ['workflow', PROCUREMENT_SOURCE_LABELS.workflow, inbox.sourceCounts.workflow ?? '—']] as const).map(([key, label, n]) => {
                  const active = filter.source === key;
                  return <button key={key || 'all'} type="button" role="tab" aria-selected={active} onClick={() => setF({ source: key })}
                    className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold transition ${active ? 'border-teal-600 bg-teal-700 text-white' : 'border-border bg-card text-foreground hover:border-teal-300'}`}>
                    {label}<span className={`rounded-full px-1.5 text-xs tabular-nums ${active ? 'bg-white/20' : 'bg-muted text-muted-foreground'}`}>{n}</span></button>;
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm">
                <div className="inline-flex rounded-lg bg-muted p-0.5 text-sm" role="group" aria-label="Tình trạng đặt hàng">
                  {([['open', 'Cần mua'], ['ordered', 'Đã đặt đủ'], ['closed', 'Đã đóng'], ['all', 'Tất cả']] as const).map(([key, label]) =>
                    <button key={key} type="button" aria-pressed={filter.progress === key} onClick={() => setF({ progress: key })}
                      className={`rounded-md px-3 py-1 font-semibold ${filter.progress === key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{label}</button>)}
                </div>
                <select aria-label="Dự án" value={filter.projectId} onChange={e => setF({ projectId: e.target.value })} className={`min-w-0 max-w-[14rem] ${inputCls}`}>
                  <option value="">Mọi dự án</option>
                  {inbox.projects.map(p => <option key={p.id} value={p.id}>{p.code || p.name}</option>)}
                </select>
                <select aria-label="Người xử lý" value={filter.assigneeId} onChange={e => setF({ assigneeId: e.target.value })} className={`min-w-0 max-w-[14rem] ${inputCls}`}>
                  <option value="">Mọi người xử lý</option>
                  <option value={currentUserId}>Việc của tôi</option>
                  <option value="none">Chưa giao</option>
                  {inbox.assignees.filter(a => a.id !== currentUserId).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <label className="relative min-w-[12rem] flex-1">
                  <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input type="search" value={searchText} onChange={e => setSearchText(e.target.value)} placeholder="Tìm mã phiếu, nội dung, dự án…" className={`w-full pl-8 ${inputCls}`} />
                </label>
                {filtersActive && <button type="button" onClick={() => { setSearchText(''); setFilter(EMPTY_FILTER); }}
                  className="rounded-lg px-2 py-1.5 text-sm font-semibold text-teal-700 hover:bg-muted dark:text-teal-300">Xóa lọc</button>}
              </div>

              {status === 'error' && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{message}</p>}

              {docs.length === 0
                ? <StateBox kind="empty" title="Không có phiếu nào khớp bộ lọc" message={filter.source === 'request' ? 'Đề xuất cấp phát thiết bị văn phòng sẽ xuất hiện sau lần duyệt cuối mới. Các phiếu đã duyệt trước khi kết nối không được nhập lại.' : filter.source === 'workflow' ? 'CT Sơn MB - Kết Cấu sẽ xuất hiện sau khi duyệt hoàn tất bước cuối. Các bước duyệt trung gian chưa chuyển sang Mua hàng.' : filtersActive ? 'Thử bỏ bớt bộ lọc.' : 'Phiếu mới xuất hiện khi nhu cầu vật tư hoặc nguồn module được duyệt hoàn tất.'} />
                : <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground">
                    <span>{docs.length} phiếu · {groups.length} nhóm{canManage && ' · chọn phiếu để phân công hoặc xử lý'}</span>
                    <button type="button" onClick={accordion.allOpen ? accordion.collapseAll : accordion.expandAll} className="rounded-lg border border-border px-2.5 py-1 font-semibold text-foreground hover:bg-muted">
                      {accordion.allOpen ? 'Thu gọn hết' : 'Mở rộng hết'}</button>
                  </div>
                  {groups.map((g, i) => {
                    const open = accordion.isOpen(g.key);
                    const overdue = g.docs.filter(d => d.progress !== 'closed' && urgencyOf(d.neededDate, inbox.today).tone === 'overdue').length;
                    const unassigned = g.docs.filter(d => d.progress !== 'closed' && (d.unassignedOpenLines != null ? d.unassignedOpenLines > 0 && (d.progress === 'new' || d.progress === 'partial') : !d.assigneeUserId)).length;
                    const keys = g.docs.filter(d => d.intakeState !== 'withdrawn').map(docKey);
                    const allSel = canManage && keys.length > 0 && keys.every(k => selected.has(k));
                    return <div key={g.key}>
                      <div className={`flex items-center border-t border-l-4 border-border ${PROJECT_TONES[i % PROJECT_TONES.length]}`}>
                        {canManage && <label className="flex w-10 shrink-0 cursor-pointer items-center justify-center self-stretch">
                          <input type="checkbox" checked={allSel} disabled={keys.length === 0} aria-label={`Chọn tất cả phiếu ${g.label}`} className="h-4 w-4 accent-teal-600"
                            onChange={() => setSelected(cur => { const next = new Set(cur); keys.forEach(k => (allSel ? next.delete(k) : next.add(k))); return next; })} /></label>}
                        <button type="button" aria-expanded={open} onClick={() => accordion.toggle(g.key)} className={`flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 py-2.5 pr-3 text-left ${canManage ? '' : 'pl-3'}`}>
                          <ChevronRight size={16} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
                          <span className="w-5 shrink-0 text-sm font-bold tabular-nums">{i + 1}</span>
                          <span className="min-w-0 flex-1 text-sm font-bold uppercase tracking-wide">{g.label}
                            {g.name && <span className="ml-2 text-xs font-medium normal-case tracking-normal opacity-70">{g.name}</span>}</span>
                          <span className="flex flex-wrap items-center gap-1.5 text-xs">
                            <span className="rounded-full bg-white/70 px-2 py-0.5 font-semibold text-slate-700 dark:bg-slate-900/60 dark:text-slate-200">{g.docs.length} phiếu</span>
                            {overdue > 0 && <span className="rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-700 dark:bg-rose-950/60 dark:text-rose-200">{overdue} quá hạn</span>}
                            {unassigned > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">{unassigned} chưa giao</span>}
                          </span>
                        </button>
                      </div>
                      {open && <ul>{g.docs.map(d => { const k = docKey(d); return <DocumentRow key={k} doc={d} today={inbox.today} currentUserId={currentUserId} selectable={canManage} selected={selected.has(k)}
                        onSelect={() => setSelected(cur => { const next = new Set(cur); if (next.has(k)) next.delete(k); else next.add(k); return next; })}
                        onOpen={() => setOpenSnap(d)} />; })}</ul>}
                    </div>;
                  })}
                </div>}
            </section>}
            </>}
          </>}

    {canManage && mode === 'orders' && stage === 'intake' && selected.size > 0 && <div className="sticky bottom-3 z-40 mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-2xl border border-teal-200 bg-card px-3 py-2.5 shadow-lg dark:border-teal-900">
      <span className="text-sm font-semibold">Đã chọn {selected.size} phiếu</span>
      <button type="button" disabled={selectedOrderable.length === 0 || (selectedScopes.size > 1 && missingWarehouse > 0)}
        title={selectedOrderable.length === 0 ? 'Chưa có phiếu đủ điều kiện lập đơn; phiếu từ module cần kiểm tra quy cách và nơi nhận' : selectedScopes.size > 1 && missingWarehouse > 0 ? 'Có phiếu chưa chọn kho nhận — đơn gom cần kho nhận của từng phiếu' : undefined}
        onClick={() => setEditor({ sources: selectedOrderable.map(refOf), order: null })} className={primaryBtn}>
        {selectedScopes.size > 1 ? <><Layers size={15} />Lập đơn gom {selectedProjects} dự án</> : <><ShoppingCart size={15} />Lập đơn hàng</>}</button>
      {selectedReviewOnly > 0 && <p className="w-full text-xs text-amber-800 dark:text-amber-200">{selectedReviewOnly} phiếu từ module chỉ tiếp nhận và phân công; chưa đưa vào đơn mua vì cần kiểm tra quy cách và nơi nhận.</p>}
      {selectedScopes.size > 1 && <span className="text-xs text-teal-800 dark:text-teal-200">{missingWarehouse > 0 ? `${missingWarehouse} phiếu chưa có kho nhận` : 'Một NCC, một giá · mỗi đợt giao về một công trường · nợ + chi phí theo dự án nhận'}</span>}
      <span className="flex min-w-0 flex-1 items-center gap-1">
        <select aria-label="Giao cho" value={bulkAssignee} onChange={e => setBulkAssignee(e.target.value)} className={`min-w-0 flex-1 ${inputCls}`}>
          <option value="">Giao cho…</option>
          {inbox?.assignees.map(a => <option key={a.id} value={a.id}>{a.name}{a.id === currentUserId ? ' (tôi)' : ''}</option>)}
        </select>
        <button type="button" disabled={!bulkAssignee} onClick={() => void assign([...selected], bulkAssignee)} className={secondaryBtn}>Giao</button>
      </span>
      <button type="button" disabled={selectedOpen.length === 0} onClick={() => void closeNeeds(selectedOpen)} className={secondaryBtn}><CircleSlash size={15} />Đóng</button>
      <button type="button" onClick={() => setSelected(new Set())} className="rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted">Bỏ chọn</button>
    </div>}

    {openDoc && inbox && !editor && !proactive && !orderId && <NeedDrawer doc={openDoc} today={inbox.today} canManage={canManage} assignees={inbox.assignees} currentUserId={currentUserId}
      onClose={() => setOpenSnap(null)} onAssign={userId => assign([docKey(openDoc)], userId)}
      onOrder={lineKeys => { if (canOrderProcurementSource(openDoc)) setEditor({ sources: [refOf(openDoc)], order: null, lineKeys }); }}
      onCloseNeed={() => void closeNeeds([openDoc])} onReopen={() => void reopenNeed(openDoc)} onOpenOrder={setOrderId} onChanged={refreshAll}
      onHotPurchase={prefill => { setOpenSnap(null); setHotPrefill(prefill); setMode('hot'); }} />}

    {editor && <OrderEditor sources={editor.sources} order={editor.order} lineKeys={editor.lineKeys} currentUserId={currentUserId} onClose={() => setEditor(null)}
      onSaved={(id, poNumber) => {
        toast.success(editor.order ? `Đã lưu ${poNumber}` : `Đã lập đơn nháp ${poNumber}`, 'Chọn người duyệt rồi bấm Gửi duyệt.');
        setEditor(null); setSelected(new Set()); setOpenSnap(null); setOrderId(id); refreshAll();
      }} />}

    {proactive && <ProactiveOrderEditor order={proactive.order} onClose={() => setProactive(null)}
      onSaved={(id, poNumber) => {
        toast.success(proactive.order ? `Đã lưu ${poNumber}` : `Đã lập đơn chủ động nháp ${poNumber}`, 'Chọn người duyệt rồi bấm Gửi duyệt.');
        setProactive(null); setStage('drafting'); setOrderId(id); refreshAll();
      }} />}

    {orderId && !editor && !proactive && inbox && <OrderDrawer orderId={orderId} today={inbox.today} currentUserId={currentUserId} onClose={() => setOrderId(null)} onChanged={refreshAll}
      onEdit={order => order.kind === 'proactive' ? setProactive({ order }) : setEditor({
        order, sources: Array.from(new Map(order.lines.flatMap(l => l.allocations).map(a => [docKey(a), refOf(a)])).values()),
      })} />}
  </main>;
};

export default ProcurementHubView;
