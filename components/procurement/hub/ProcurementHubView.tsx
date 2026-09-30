import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowUpRight, Boxes, CalendarClock, ChevronRight, FileText, Inbox, Loader2, PackageCheck,
  RefreshCw, Search, ShieldAlert, ShoppingCart, Truck, UserRound, Warehouse, X,
} from 'lucide-react';
import { useToast } from '../../../context/ToastContext';
import {
  PROCUREMENT_PROGRESS_LABELS, PROCUREMENT_SOURCE_LABELS, procurementInboxService, procurementSourceLink, urgencyOf,
  type ProcurementInbox, type ProcurementInboxDetail, type ProcurementInboxDocument, type ProcurementInboxFilter,
  type ProcurementProgress, type ProcurementSourceType,
} from '../../../lib/procurementInboxService';
import { dateVi, fmt, useGroupAccordion } from '../../project/work-plan/workPlanUi';

// Mua hàng hub: one place where the procurement team receives every purchase need
// (KH vật tư, đề xuất công trường, later other modules), assigns it and follows it
// through ordering, delivery and warehouse receipt.

type Stage = 'intake' | 'orders' | 'delivering' | 'received';
type SourceKey = ProcurementSourceType;
const LEGACY = '#/procurement/legacy';

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
};
const SOURCE_STYLE: Record<SourceKey, string> = {
  material_plan: 'bg-teal-50 text-teal-800 border-teal-200 dark:bg-teal-950/40 dark:text-teal-200 dark:border-teal-900',
  material_request: 'bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-200 dark:border-indigo-900',
};
const PROJECT_TONES = [
  'border-l-teal-500 bg-teal-50/70 text-teal-950 dark:bg-teal-950/30 dark:text-teal-100',
  'border-l-indigo-500 bg-indigo-50/70 text-indigo-950 dark:bg-indigo-950/30 dark:text-indigo-100',
  'border-l-orange-500 bg-orange-50/70 text-orange-950 dark:bg-orange-950/30 dark:text-orange-100',
  'border-l-sky-500 bg-sky-50/70 text-sky-950 dark:bg-sky-950/30 dark:text-sky-100',
];

const Badge: React.FC<{ className: string; children: React.ReactNode }> = ({ className, children }) =>
  <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${className}`}>{children}</span>;

const UrgencyBadge: React.FC<{ date: string | null; today: string }> = ({ date, today }) => {
  const u = urgencyOf(date, today);
  return <Badge className={URGENCY_STYLE[u.tone]}><CalendarClock size={11} />{u.label}</Badge>;
};

const StateBox: React.FC<{ kind: 'loading' | 'error' | 'denied' | 'empty'; message?: string; onRetry?: () => void }> = ({ kind, message, onRetry }) => {
  const Icon = kind === 'loading' ? Loader2 : kind === 'denied' ? ShieldAlert : kind === 'error' ? AlertTriangle : Inbox;
  const title = { loading: 'Đang tải nhu cầu mua hàng…', error: 'Chưa tải được Mua hàng', denied: 'Bạn chưa có quyền vào Mua hàng', empty: 'Không có phiếu nào khớp bộ lọc' }[kind];
  return <div role={kind === 'error' ? 'alert' : undefined} className="rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
    <Icon size={26} className={`mx-auto ${kind === 'loading' ? 'animate-spin text-teal-600' : kind === 'empty' ? 'text-muted-foreground' : 'text-amber-600'}`} />
    <p className="mt-3 font-semibold text-foreground">{title}</p>
    {message && <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{message}</p>}
    {onRetry && <button type="button" onClick={onRetry} className="mt-4 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold hover:bg-muted">Thử lại</button>}
  </div>;
};

// ---------------------------------------------------------------------------
// Stage strip: the whole buying pipeline at a glance; each card is also a tab.
// ---------------------------------------------------------------------------
const StageStrip: React.FC<{ inbox: ProcurementInbox; stage: Stage; onStage: (s: Stage) => void }> = ({ inbox, stage, onStage }) => {
  const s = inbox.stages;
  const cards: Array<{ key: Stage; label: string; value: number; hint: React.ReactNode; icon: React.ElementType; tone: string }> = [
    { key: 'intake', label: 'Tiếp nhận', value: s.intake, icon: Inbox, tone: 'text-teal-700 dark:text-teal-300',
      hint: <>{s.intakeUrgent > 0 && <span className="font-semibold text-rose-700 dark:text-rose-300">{s.intakeUrgent} quá hạn</span>}{s.intakeUrgent > 0 && s.unassigned > 0 && ' · '}{s.unassigned > 0 && `${s.unassigned} chưa giao`}{!s.intakeUrgent && !s.unassigned && 'phiếu cần mua'}</> },
    { key: 'orders', label: 'Đơn hàng', value: s.drafting + s.ordered, icon: ShoppingCart, tone: 'text-indigo-700 dark:text-indigo-300',
      hint: <>{s.drafting} đang soạn/gửi · {s.ordered} NCC đã xác nhận{s.orderedLate > 0 && <span className="font-semibold text-rose-700 dark:text-rose-300"> · {s.orderedLate} quá hẹn giao</span>}</> },
    { key: 'delivering', label: 'Đang giao', value: s.delivering, icon: Truck, tone: 'text-orange-700 dark:text-orange-300',
      hint: s.deliveringLate > 0 ? <span className="font-semibold text-rose-700 dark:text-rose-300">{s.deliveringLate} đơn quá ngày hẹn giao</span> : 'đơn đang về công trường' },
    { key: 'received', label: 'Đã giao đủ', value: s.receiving, icon: PackageCheck, tone: 'text-emerald-700 dark:text-emerald-300',
      hint: 'chờ đối chiếu & đóng đơn' },
  ];
  return <nav aria-label="Các bước mua hàng" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
    {cards.map((card, i) => {
      const Icon = card.icon; const active = card.key === stage;
      return <button key={card.key} type="button" aria-current={active ? 'page' : undefined} onClick={() => onStage(card.key)}
        className={`relative rounded-2xl border bg-card p-3 text-left shadow-sm transition md:p-4 ${active ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-border hover:border-teal-300'}`}>
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-muted text-[11px] font-bold text-foreground">{i + 1}</span>{card.label}</span>
        <span className="mt-2 flex items-center gap-2"><Icon size={18} className={card.tone} /><span className="text-2xl font-bold tabular-nums text-foreground">{card.value}</span></span>
        <span className="mt-1 block text-xs text-muted-foreground">{card.hint}</span>
      </button>;
    })}
  </nav>;
};

const LegacyStage: React.FC<{ stage: Exclude<Stage, 'intake'>; inbox: ProcurementInbox }> = ({ stage, inbox }) => {
  const info = {
    orders: { title: 'Đơn hàng', view: 'orders', text: 'Danh sách đơn mua, gửi NCC và theo dõi xác nhận.' },
    delivering: { title: 'Đang giao', view: 'receiving', text: 'Theo dõi lịch giao, hàng về từng đợt.' },
    received: { title: 'Đã giao đủ', view: 'reconcile', text: 'Đối chiếu số lượng, hóa đơn và đóng đơn.' },
  }[stage];
  return <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
    <p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">Bước {info.title}</p>
    <h2 className="mt-1 text-lg font-bold text-foreground">Đang chuyển sang giao diện mới</h2>
    <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{info.text} Trong lúc chuyển đổi, bước này vẫn làm ở màn hình Mua hàng cũ — số liệu dùng chung, không phải nhập lại.</p>
    {stage !== 'received' && (stage === 'delivering' ? inbox.stages.deliveringLate : inbox.stages.orderedLate) > 0 && <p className="mt-3 inline-flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
      <AlertTriangle size={15} />{stage === 'delivering' ? inbox.stages.deliveringLate : inbox.stages.orderedLate} đơn đã quá ngày hẹn giao — nên gọi NCC xác nhận lại hoặc cập nhật trạng thái.</p>}
    <a href={`${LEGACY}?view=${info.view}`} className="mt-4 flex w-fit items-center gap-2 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800">
      <ArrowUpRight size={16} />Mở {info.title.toLowerCase()} (màn hình cũ)</a>
  </section>;
};

// ---------------------------------------------------------------------------
// Document detail drawer
// ---------------------------------------------------------------------------
const DetailDrawer: React.FC<{
  doc: ProcurementInboxDocument; today: string; canManage: boolean; assignees: ProcurementInbox['assignees'];
  onClose: () => void; onAssign: (userId: string | null) => Promise<void>;
}> = ({ doc, today, canManage, assignees, onClose, onAssign }) => {
  const [detail, setDetail] = useState<ProcurementInboxDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(() => {
    setError(null); setDetail(null);
    procurementInboxService.get(doc.sourceType, doc.sourceId).then(setDetail).catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, [doc.sourceType, doc.sourceId]);
  useEffect(load, [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const link = procurementSourceLink(doc);
  const lines = detail?.lines || [];
  const missing = lines.filter(l => l.remainingQty > 0).length;

  return <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`Phiếu ${doc.code}`}>
    <button type="button" aria-label="Đóng" onClick={onClose} className="absolute inset-0 bg-slate-950/40" />
    <aside className="relative flex h-full w-full max-w-3xl flex-col bg-background shadow-2xl">
      <header className="border-b border-border px-4 py-4 md:px-6">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge className={SOURCE_STYLE[doc.sourceType]}>{PROCUREMENT_SOURCE_LABELS[doc.sourceType]}</Badge>
              <UrgencyBadge date={doc.neededDate} today={today} />
            </div>
            <h2 className="mt-2 text-lg font-bold text-foreground">{doc.code}{doc.title && <span className="font-medium text-muted-foreground"> · {doc.title}</span>}</h2>
            <p className="text-sm text-muted-foreground">{[doc.projectCode, doc.projectName].filter(Boolean).join(' — ') || 'Không gắn dự án'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng" className="rounded-lg p-2 text-muted-foreground hover:bg-muted"><X size={18} /></button>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-4">
          {[
            [Warehouse, 'Kho nhận', doc.warehouseName || 'Chưa chọn kho'],
            [CalendarClock, 'Ngày cần', doc.neededDate ? dateVi(doc.neededDate) : 'Chưa có'],
            [UserRound, 'Người đề xuất', doc.requesterName || '—'],
            [FileText, 'Duyệt', doc.approvedByName ? `${doc.approvedByName}${doc.approvedAt ? ` · ${dateVi(doc.approvedAt)}` : ''}` : 'Đã duyệt'],
          ].map(([Icon, label, value]) => { const I = Icon as React.ElementType; return <div key={label as string} className="min-w-0">
            <dt className="flex items-center gap-1 text-xs text-muted-foreground"><I size={12} />{label as string}</dt>
            <dd className="truncate font-medium text-foreground">{value as string}</dd></div>; })}
        </dl>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 md:px-6">
        <section className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-sm">
          <span className="font-semibold text-foreground">Người xử lý</span>
          {canManage
            ? <select aria-label="Người xử lý" value={doc.assigneeUserId || ''} disabled={saving}
                onChange={async e => { setSaving(true); try { await onAssign(e.target.value || null); } finally { setSaving(false); } }}
                className="min-w-[12rem] rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground">
                <option value="">— Chưa giao —</option>
                {assignees.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            : <span className="text-muted-foreground">{doc.assigneeName || 'Chưa giao'}</span>}
          {saving && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
          {detail?.assignment?.assignedAt && <span className="text-xs text-muted-foreground">từ {dateVi(detail.assignment.assignedAt)}</span>}
        </section>

        {error ? <StateBox kind="error" message={error} onRetry={load} />
          : !detail ? <StateBox kind="loading" />
            : <section>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h3 className="font-semibold text-foreground">Vật tư cần mua</h3>
                <span className="text-xs text-muted-foreground">{missing > 0 ? `${missing}/${lines.length} dòng còn thiếu` : `Đã đặt đủ ${lines.length} dòng`}</span>
              </div>
              <div className="overflow-hidden rounded-xl border border-border">
                <table className="hidden w-full text-sm md:table">
                  <thead className="bg-muted/60 text-xs text-muted-foreground">
                    <tr><th className="px-3 py-2 text-left font-semibold">Vật tư</th><th className="px-2 py-2 text-right font-semibold">Cần</th>
                      <th className="px-2 py-2 text-right font-semibold">Đã đặt</th><th className="px-2 py-2 text-right font-semibold">Đã nhận</th>
                      <th className="px-2 py-2 text-right font-semibold">Còn thiếu</th><th className="px-3 py-2 text-right font-semibold" title="Tồn kho nhận của phiếu">Tồn kho</th></tr>
                  </thead>
                  <tbody>{lines.map(l => <tr key={l.lineId} className="border-t border-border align-top">
                    <td className="px-3 py-2"><p className="font-medium text-foreground">{l.itemName}</p>
                      <p className="text-xs text-muted-foreground">{[l.sku, l.unit].filter(Boolean).join(' · ')}</p>
                      {l.orders.length > 0 && <p className="mt-1 flex flex-wrap gap-1">{l.orders.map(o => <span key={o.id} className="rounded bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-800 dark:bg-sky-950/40 dark:text-sky-200">{o.poNumber || 'PO'}{o.vendorName ? ` · ${o.vendorName}` : ''}</span>)}</p>}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmt(l.needQty)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmt(l.orderedQty) || '0'}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmt(l.receivedQty) || '0'}</td>
                    <td className={`px-2 py-2 text-right font-semibold tabular-nums ${l.remainingQty > 0 ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'}`}>{l.remainingQty > 0 ? fmt(l.remainingQty) : 'Đủ'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{l.stockQty == null ? <span title="Phiếu chưa có kho nhận">—</span> : fmt(l.stockQty)}</td>
                  </tr>)}</tbody>
                </table>
                <ul className="divide-y divide-border md:hidden">{lines.map(l => <li key={l.lineId} className="px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2"><p className="font-medium text-foreground">{l.itemName}</p>
                    <span className={`shrink-0 text-sm font-semibold ${l.remainingQty > 0 ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'}`}>{l.remainingQty > 0 ? `Thiếu ${fmt(l.remainingQty)}` : 'Đủ'}</span></div>
                  <p className="mt-0.5 text-xs text-muted-foreground">Cần {fmt(l.needQty)} {l.unit} · đặt {fmt(l.orderedQty) || 0} · nhận {fmt(l.receivedQty) || 0} · tồn {l.stockQty == null ? '—' : fmt(l.stockQty)}</p>
                </li>)}</ul>
              </div>
            </section>}

        <p className="rounded-xl border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
          Bước tiếp theo — gom nhiều phiếu thành đơn hàng ngay tại đây — sẽ có ở bản cập nhật tới. Trong lúc chờ, lập đơn ở <a className="font-semibold text-teal-700 underline dark:text-teal-300" href={`${LEGACY}?view=demand`}>màn hình Mua hàng cũ</a>.
        </p>
      </div>

      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3 md:px-6">
        {link && <a href={link} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted"><ArrowUpRight size={15} />Mở phiếu trong dự án</a>}
        <button type="button" onClick={onClose} className="rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background">Xong</button>
      </footer>
    </aside>
  </div>;
};

// ---------------------------------------------------------------------------
// Intake list
// ---------------------------------------------------------------------------
const DocumentRow: React.FC<{
  doc: ProcurementInboxDocument; today: string; selectable: boolean; selected: boolean; onSelect: () => void; onOpen: () => void;
}> = ({ doc, today, selectable, selected, onSelect, onOpen }) => {
  const ordered = doc.orderedLines;
  return <li className={`flex items-stretch border-t border-border ${selected ? 'bg-teal-50/60 dark:bg-teal-950/20' : 'bg-card hover:bg-muted/40'}`}>
    {selectable && <label className="flex w-11 shrink-0 cursor-pointer items-center justify-center">
      <input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Chọn ${doc.code}`} className="h-4 w-4 accent-teal-600" /></label>}
    <button type="button" onClick={onOpen} className={`flex min-w-0 flex-1 flex-col gap-1.5 py-3 pr-3 text-left md:flex-row md:items-center md:gap-4 ${selectable ? '' : 'pl-4'}`}>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold text-foreground">{doc.code}</span>
          <Badge className={SOURCE_STYLE[doc.sourceType]}>{PROCUREMENT_SOURCE_LABELS[doc.sourceType]}</Badge>
        </span>
        <span className="mt-0.5 block truncate text-sm text-muted-foreground">{doc.title || 'Không tiêu đề'}{doc.requesterName && ` · ${doc.requesterName}`}</span>
      </span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs md:w-[24rem] md:shrink-0 md:justify-end xl:w-[34rem]">
        <UrgencyBadge date={doc.neededDate} today={today} />
        <span className={`font-semibold ${PROGRESS_STYLE[doc.progress]}`}>{PROCUREMENT_PROGRESS_LABELS[doc.progress]}
          <span className="font-normal text-muted-foreground"> · đủ {ordered}/{doc.lineCount} dòng{doc.partialLines > 0 ? ` · ${doc.partialLines} dòng đặt thiếu` : ''}</span></span>
        <span className={`inline-flex items-center gap-1 ${doc.assigneeName ? 'text-foreground' : 'text-amber-700 dark:text-amber-300'}`}><UserRound size={12} />{doc.assigneeName || 'Chưa giao'}</span>
      </span>
      <ChevronRight size={16} className="hidden shrink-0 text-muted-foreground md:block" />
    </button>
  </li>;
};

export const ProcurementHubView: React.FC<{ currentUserId: string }> = ({ currentUserId }) => {
  const toast = useToast();
  const [stage, setStage] = useState<Stage>('intake');
  const [filter, setFilter] = useState<Required<ProcurementInboxFilter>>({ source: '', progress: 'open', projectId: '', assigneeId: '', search: '' });
  const [searchText, setSearchText] = useState('');
  const [inbox, setInbox] = useState<ProcurementInbox | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [message, setMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAssignee, setBulkAssignee] = useState('');
  const [openSnap, setOpenSnap] = useState<ProcurementInboxDocument | null>(null);

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

  const docKey = (d: Pick<ProcurementInboxDocument, 'sourceType' | 'sourceId'>) => `${d.sourceType}:${d.sourceId}`;
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

  const assign = async (keys: string[], userId: string | null) => {
    const sources = docs.filter(d => keys.includes(docKey(d))).map(d => ({ sourceType: d.sourceType, sourceId: d.sourceId }));
    try {
      const r = await procurementInboxService.assign({ sources, assigneeUserId: userId });
      const name = inbox?.assignees.find(a => a.id === userId)?.name;
      setOpenSnap(cur => (cur && keys.includes(docKey(cur)) ? { ...cur, assigneeUserId: userId, assigneeName: name || null } : cur));
      toast.success(userId ? `Đã giao ${r.assigned} phiếu cho ${name}` : `Đã bỏ giao ${r.assigned} phiếu`, userId && userId !== currentUserId ? 'Người nhận đã được thông báo.' : undefined);
      setSelected(new Set()); setBulkAssignee('');
      await load(true);
    } catch (e) { toast.error('Chưa giao được', e instanceof Error ? e.message : ''); }
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
          <p className="text-sm text-muted-foreground">Tiếp nhận nhu cầu mua từ mọi nguồn, giao người xử lý và theo dõi tới khi nhập kho.</p>
        </div>
      </div>
      <button type="button" onClick={() => void load(true)} disabled={refreshing || status === 'loading'}
        className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-60">
        <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />Làm mới</button>
    </header>

    {status === 'denied' ? <StateBox kind="denied" message={message} />
      : status === 'error' && !inbox ? <StateBox kind="error" message={message} onRetry={() => void load()} />
        : !inbox ? <StateBox kind="loading" />
          : <>
            <StageStrip inbox={inbox} stage={stage} onStage={setStage} />
            {stage !== 'intake' ? <LegacyStage stage={stage} inbox={inbox} /> : <section className="space-y-3">
              {/* Sources */}
              <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Nguồn đề xuất">
                {([['', 'Tất cả nguồn', sourceTotal], ['material_plan', PROCUREMENT_SOURCE_LABELS.material_plan, inbox.sourceCounts.material_plan || 0],
                  ['material_request', PROCUREMENT_SOURCE_LABELS.material_request, inbox.sourceCounts.material_request || 0]] as const).map(([key, label, n]) => {
                  const active = filter.source === key;
                  return <button key={key || 'all'} type="button" role="tab" aria-selected={active} onClick={() => setF({ source: key })}
                    className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold transition ${active ? 'border-teal-600 bg-teal-700 text-white' : 'border-border bg-card text-foreground hover:border-teal-300'}`}>
                    {label}<span className={`rounded-full px-1.5 text-xs tabular-nums ${active ? 'bg-white/20' : 'bg-muted text-muted-foreground'}`}>{n}</span></button>;
                })}
                {['Module Đề xuất', 'Quy trình'].map(label => <span key={label} title="Sẽ kết nối ở bản sau" className="inline-flex shrink-0 cursor-default items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1.5 text-sm text-muted-foreground">
                  {label}<span className="text-[11px]">· sắp có</span></span>)}
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm">
                <div className="inline-flex rounded-lg bg-muted p-0.5 text-sm" role="group" aria-label="Tình trạng đặt hàng">
                  {([['open', 'Cần mua'], ['ordered', 'Đã đặt đủ'], ['all', 'Tất cả']] as const).map(([key, label]) =>
                    <button key={key} type="button" aria-pressed={filter.progress === key} onClick={() => setF({ progress: key })}
                      className={`rounded-md px-3 py-1 font-semibold ${filter.progress === key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{label}</button>)}
                </div>
                <select aria-label="Dự án" value={filter.projectId} onChange={e => setF({ projectId: e.target.value })}
                  className="min-w-0 max-w-[14rem] rounded-lg border border-border bg-background px-2 py-1.5 text-sm">
                  <option value="">Mọi dự án</option>
                  {inbox.projects.map(p => <option key={p.id} value={p.id}>{p.code || p.name}</option>)}
                </select>
                <select aria-label="Người xử lý" value={filter.assigneeId} onChange={e => setF({ assigneeId: e.target.value })}
                  className="min-w-0 max-w-[14rem] rounded-lg border border-border bg-background px-2 py-1.5 text-sm">
                  <option value="">Mọi người xử lý</option>
                  <option value={currentUserId}>Việc của tôi</option>
                  <option value="none">Chưa giao</option>
                  {inbox.assignees.filter(a => a.id !== currentUserId).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <label className="relative min-w-[12rem] flex-1">
                  <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input type="search" value={searchText} onChange={e => setSearchText(e.target.value)} placeholder="Tìm mã phiếu, nội dung, dự án…"
                    className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-2 text-sm" />
                </label>
                {filtersActive && <button type="button" onClick={() => { setSearchText(''); setFilter({ source: '', progress: 'open', projectId: '', assigneeId: '', search: '' }); }}
                  className="rounded-lg px-2 py-1.5 text-sm font-semibold text-teal-700 hover:bg-muted dark:text-teal-300">Xóa lọc</button>}
              </div>

              {status === 'error' && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{message}</p>}

              {docs.length === 0
                ? <StateBox kind="empty" message={filtersActive ? 'Thử bỏ bớt bộ lọc.' : 'Chưa có phiếu nhu cầu nào cần mua. Phiếu mới xuất hiện ngay khi KH vật tư hoặc đề xuất công trường được duyệt.'} />
                : <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground">
                    <span>{docs.length} phiếu · {groups.length} dự án</span>
                    <button type="button" onClick={accordion.allOpen ? accordion.collapseAll : accordion.expandAll} className="rounded-lg border border-border px-2.5 py-1 font-semibold text-foreground hover:bg-muted">
                      {accordion.allOpen ? 'Thu gọn hết' : 'Mở rộng hết'}</button>
                  </div>
                  {groups.map((g, i) => {
                    const open = accordion.isOpen(g.key);
                    const overdue = g.docs.filter(d => urgencyOf(d.neededDate, inbox.today).tone === 'overdue').length;
                    const unassigned = g.docs.filter(d => !d.assigneeUserId).length;
                    const keys = g.docs.map(docKey);
                    const allSel = canManage && keys.every(k => selected.has(k));
                    return <div key={g.key}>
                      <div className={`flex items-center border-t border-l-4 border-border ${PROJECT_TONES[i % PROJECT_TONES.length]}`}>
                        {canManage && <label className="flex w-10 shrink-0 cursor-pointer items-center justify-center self-stretch">
                          <input type="checkbox" checked={allSel} aria-label={`Chọn tất cả phiếu ${g.label}`} className="h-4 w-4 accent-teal-600"
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
                      {open && <ul>{g.docs.map(d => { const k = docKey(d); return <DocumentRow key={k} doc={d} today={inbox.today} selectable={canManage} selected={selected.has(k)}
                        onSelect={() => setSelected(cur => { const next = new Set(cur); if (next.has(k)) next.delete(k); else next.add(k); return next; })}
                        onOpen={() => setOpenSnap(d)} />; })}</ul>}
                    </div>;
                  })}
                </div>}
            </section>}
          </>}

    {canManage && selected.size > 0 && <div className="sticky bottom-3 z-40 mx-auto flex max-w-2xl flex-wrap items-center gap-2 rounded-2xl border border-teal-200 bg-card px-3 py-2.5 shadow-lg dark:border-teal-900">
      <span className="text-sm font-semibold">Đã chọn {selected.size} phiếu</span>
      <select aria-label="Giao cho" value={bulkAssignee} onChange={e => setBulkAssignee(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-sm">
        <option value="">Giao cho…</option>
        {inbox?.assignees.map(a => <option key={a.id} value={a.id}>{a.name}{a.id === currentUserId ? ' (tôi)' : ''}</option>)}
      </select>
      <button type="button" disabled={!bulkAssignee} onClick={() => void assign([...selected], bulkAssignee)}
        className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50">Giao việc</button>
      <button type="button" onClick={() => setSelected(new Set())} className="rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted">Bỏ chọn</button>
    </div>}

    {openDoc && inbox && <DetailDrawer doc={openDoc} today={inbox.today} canManage={canManage} assignees={inbox.assignees}
      onClose={() => setOpenSnap(null)} onAssign={userId => assign([docKey(openDoc)], userId)} />}
  </main>;
};

export default ProcurementHubView;
