import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronRight, FileSpreadsheet, Hourglass, PencilLine, RotateCcw, Search, Undo2, UserPlus } from 'lucide-react';
import { useConfirm, useReasonConfirm } from '../../../context/ConfirmContext';
import { useToast } from '../../../context/ToastContext';
import { matchesSearchQueryMultiple } from '../../../lib/searchUtils';
import { Badge, Drawer, StateBox, inputCls, primaryBtn, secondaryBtn } from '../../procurement/hub/hubUi';
import {
  BATCH_SOURCE_LABEL, BATCH_STATUS_LABEL, dateVi, isPayField,
  type RosterBatch, type RosterChangeItem, type RosterData, type RosterFieldKey,
} from '../../../lib/hrmRoster';
import { hrmRosterService, type RosterBatchScope } from '../../../lib/hrmRosterService';
import { BATCH_STATUS_STYLE, BATCH_STRIP, ChangeLine, ENT, NUM } from './rosterUi';

const timeVi = (iso: string | null) => (iso ? new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

const SourceBadge: React.FC<{ batch: RosterBatch }> = ({ batch }) => batch.source === 'import'
  ? <Badge className="border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-200"><FileSpreadsheet size={11} />{BATCH_SOURCE_LABEL.import}</Badge>
  : <Badge className="border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"><PencilLine size={11} />{BATCH_SOURCE_LABEL.grid}</Badge>;

const groupItems = (items: RosterChangeItem[]) => {
  const map = new Map<string, { key: string; fullName: string; employeeCode: string | null; isNew: boolean; items: RosterChangeItem[] }>();
  items.forEach(item => {
    if (!map.has(item.personKey)) map.set(item.personKey, { key: item.personKey, fullName: item.fullName, employeeCode: item.employeeCode, isNew: item.employeeId == null, items: [] });
    map.get(item.personKey)!.items.push(item);
  });
  return [...map.values()];
};

/** Changes of one request grouped by person; "Chỉ ô sửa" hides cells that only fill an empty value. */
export const BatchItems: React.FC<{ items: RosterChangeItem[]; data: RosterData; collapsedByDefault?: boolean }> = ({ items, data, collapsedByDefault }) => {
  const [onlyChanges, setOnlyChanges] = useState(false);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const hiddenPay = !data.can.viewPay ? items.filter(item => isPayField(item.field)).length : 0;
  const visible = items.filter(item => (data.can.viewPay || !isPayField(item.field)) && (!onlyChanges || item.oldValue != null));
  const people = groupItems(visible).filter(person => matchesSearchQueryMultiple([person.fullName, person.employeeCode], query));
  const fills = items.filter(item => item.oldValue == null && item.employeeId != null).length;
  const isOpen = (key: string) => (collapsedByDefault ? open.has(key) : !open.has(key));
  const toggle = (key: string) => setOpen(cur => { const next = new Set(cur); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  return <section className="rounded-2xl border border-border bg-card">
    <div className="flex flex-wrap items-center gap-2 border-b border-border p-2">
      <div className="inline-flex rounded-lg bg-muted p-0.5 text-sm" role="group" aria-label="Lọc thay đổi">
        {([[false, `Tất cả ${items.length}`], [true, `Chỉ ô sửa ${items.length - fills - items.filter(i => i.employeeId == null).length}`]] as const).map(([value, label]) =>
          <button key={String(value)} type="button" aria-pressed={onlyChanges === value} onClick={() => setOnlyChanges(value)}
            className={`rounded-md px-3 py-1 font-semibold ${onlyChanges === value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{label}</button>)}
      </div>
      <label className="relative min-w-[10rem] flex-1">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Tìm người…" className={`w-full pl-8 ${inputCls}`} />
      </label>
    </div>
    {hiddenPay > 0 && <p className="border-b border-border bg-slate-50 px-4 py-1.5 text-xs text-muted-foreground dark:bg-slate-900">{hiddenPay} ô lương & phụ cấp ẩn — chỉ HR Manage xem.</p>}
    {people.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">Không có thay đổi khớp bộ lọc.</p>
      : <ul className="divide-y divide-border">
        {people.map(person => <li key={person.key}>
          <button type="button" aria-expanded={isOpen(person.key)} onClick={() => toggle(person.key)} className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-muted/60">
            <ChevronRight size={14} className={`shrink-0 transition-transform ${isOpen(person.key) ? 'rotate-90' : ''}`} />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{person.fullName}
              {person.employeeCode && <span className={`ml-2 text-xs ${ENT}`}>{person.employeeCode}</span>}</span>
            {person.isNew && <Badge className="border-leaf-200 bg-leaf-50 text-leaf-800 dark:border-leaf-900 dark:bg-leaf-950/40 dark:text-leaf-200"><UserPlus size={11} />Người mới</Badge>}
            <span className={`text-xs ${NUM}`}>{person.items.length}</span>
          </button>
          {isOpen(person.key) && <ul className="px-4 pb-2 pl-10">{person.items.map(item => <ChangeLine key={item.field} field={item.field}
            oldValue={item.oldValue} newValue={item.newValue} catalogs={data.catalogs} />)}</ul>}
        </li>)}
      </ul>}
  </section>;
};

/** The step after the current one, when the request has more than one approval step. */
const nextStep = (batch: RosterBatch) => batch.steps && batch.currentStep ? batch.steps.find(step => step.step === batch.currentStep! + 1) || null : null;

const StepTrail: React.FC<{ batch: RosterBatch }> = ({ batch }) =>
  <ol className="mt-2 flex flex-wrap items-center gap-1.5 text-xs" aria-label="Các bước duyệt">
    {batch.steps!.map((step, index) => {
      const done = Boolean(step.decidedAt);
      const current = batch.status === 'pending' && step.step === batch.currentStep;
      return <li key={step.step} className="flex items-center gap-1.5">
        {index > 0 && <ChevronRight size={13} className="text-muted-foreground" />}
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold ${done ? 'border-leaf-200 bg-leaf-50 text-leaf-800 dark:border-leaf-900 dark:bg-leaf-950/40 dark:text-leaf-200'
          : current ? 'border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200' : 'border-border bg-card text-muted-foreground'}`}>
          {done ? <CheckCircle2 size={12} /> : <Hourglass size={12} />}Bước {step.step}: {done ? step.decidedByName : step.approverNames.join(' / ')}
          {done && step.decidedAt && <span className="font-normal opacity-80">· {timeVi(step.decidedAt)}</span>}</span>
      </li>;
    })}
  </ol>;

const BatchDrawer: React.FC<{ batchId: string; data: RosterData; onClose: () => void; onChanged: () => void; onResubmit: (batch: RosterBatch) => void }> = ({ batchId, data, onClose, onChanged, onResubmit }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const askReason = useReasonConfirm();
  const [batch, setBatch] = useState<RosterBatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    setError(null);
    hrmRosterService.getBatch(batchId).then(setBatch).catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, [batchId]);
  useEffect(load, [load]);

  const approve = async () => {
    if (!batch) return;
    const next = nextStep(batch);
    const ok = await confirm({
      title: next ? `Duyệt bước ${batch.currentStep}?` : 'Duyệt phiếu thay đổi?', targetName: `${batch.code} · ${batch.title}`, confirmText: 'Duyệt', actionLabel: 'Duyệt',
      subtitle: `${batch.itemCount} thay đổi cho ${batch.peopleCount} người${batch.newPeopleCount ? ` (${batch.newPeopleCount} người mới)` : ''}, hiệu lực từ ${dateVi(batch.effectiveDate)}.`,
      warningText: next ? `Phiếu chuyển sang bước ${next.step}: ${next.approverNames.join(' / ')} duyệt. Hồ sơ chỉ cập nhật sau bước cuối.`
        : 'Hồ sơ từng người cập nhật ngay. Muốn sửa lại thì lập phiếu mới; lịch sử giữ cả giá trị cũ.', intent: 'success', countdownSeconds: 0,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const decided = await hrmRosterService.decide(batch.id, true, '');
      setBatch(decided);
      toast.success(`Đã duyệt ${batch.code}${next ? ` bước ${batch.currentStep}` : ''}`,
        next ? `Chờ ${next.approverNames.join(' / ')} duyệt bước ${next.step}.` : `${batch.peopleCount} hồ sơ đã cập nhật. Người gửi đã được thông báo.`);
      onChanged();
    } catch (e) { toast.error('Chưa duyệt được', e instanceof Error ? e.message : ''); } finally { setBusy(false); }
  };
  const reject = async () => {
    if (!batch) return;
    const note = await askReason({
      title: 'Trả lại phiếu', targetName: `${batch.code} · ${batch.title}`, reasonLabel: 'Lý do trả lại', minLength: 5,
      reasonPlaceholder: 'VD: Level của anh A chưa đúng quyết định, sửa lại rồi gửi', actionLabel: 'Trả lại', intent: 'warning',
    });
    if (!note) return;
    setBusy(true);
    try {
      setBatch(await hrmRosterService.decide(batch.id, false, note));
      toast.success(`Đã trả lại ${batch.code}`, `${batch.createdByName} sẽ sửa và gửi lại.`);
      onChanged();
    } catch (e) { toast.error('Chưa trả lại được', e instanceof Error ? e.message : ''); } finally { setBusy(false); }
  };
  const cancel = async () => {
    if (!batch) return;
    const note = await askReason({
      title: 'Rút phiếu', targetName: `${batch.code} · ${batch.title}`, reasonLabel: 'Lý do rút', minLength: 5,
      reasonPlaceholder: 'VD: Gửi nhầm, soạn lại', actionLabel: 'Rút phiếu', intent: 'warning',
    });
    if (!note) return;
    setBusy(true);
    try {
      await hrmRosterService.cancel(batch.id, note);
      toast.success(`Đã rút ${batch.code}`, 'Các ô trở lại bình thường, có thể soạn lại.');
      onChanged(); onClose();
    } catch (e) { toast.error('Chưa rút được', e instanceof Error ? e.message : ''); } finally { setBusy(false); }
  };

  return <Drawer label={batch ? `Phiếu ${batch.code}` : 'Phiếu thay đổi'} wide onClose={onClose}
    header={batch ? <>
      <div className="flex flex-wrap items-center gap-1.5"><Badge className={BATCH_STATUS_STYLE[batch.status]}>{BATCH_STATUS_LABEL[batch.status]}</Badge><SourceBadge batch={batch} /></div>
      <h2 className="mt-2 text-lg font-bold text-foreground"><span className={ENT}>{batch.code}</span> · {batch.title}</h2>
      {batch.steps && batch.steps.length > 1 && <StepTrail batch={batch} />}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-4">
        {([['Người gửi', `${batch.createdByName} · ${timeVi(batch.createdAt)}`], ['Hiệu lực từ', dateVi(batch.effectiveDate)],
          ['Người duyệt', batch.approverNames.join(', ') || '—'], ['Quy mô', `${batch.itemCount} ô · ${batch.peopleCount} người`]] as const).map(([label, value]) =>
          <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="truncate font-medium text-foreground" title={value}>{value}</dd></div>)}
      </dl>
    </> : <h2 className="text-lg font-bold">Phiếu thay đổi</h2>}
    footer={batch && (batch.can.decide || batch.can.cancel || batch.can.resubmit) ? <>
      {batch.can.cancel && <button type="button" onClick={() => void cancel()} disabled={busy} className={`${secondaryBtn} mr-auto`}><Undo2 size={15} />Rút phiếu</button>}
      {batch.can.resubmit && <button type="button" onClick={() => onResubmit(batch)} disabled={busy} className={primaryBtn}><RotateCcw size={15} />Sửa & gửi lại</button>}
      {batch.can.decide && <><button type="button" onClick={() => void reject()} disabled={busy} className={secondaryBtn}>Trả lại</button>
        <button type="button" onClick={() => void approve()} disabled={busy} className={primaryBtn}><CheckCircle2 size={15} />
          {nextStep(batch) ? `Duyệt bước ${batch.currentStep}` : `Duyệt ${batch.itemCount} thay đổi`}</button></>}
    </> : undefined}>
    {error ? <StateBox kind="error" title="Chưa mở được phiếu" message={error} onRetry={load} />
      : !batch ? <StateBox kind="loading" title="Đang mở phiếu…" />
        : <>
          <section className="rounded-2xl border border-border bg-card px-4 py-3 text-sm">
            <p className="text-xs font-semibold text-muted-foreground">Lý do</p>
            <p className="mt-0.5 text-foreground">{batch.reason}</p>
            {batch.decisionNote && <p className={`mt-2 rounded-lg px-3 py-2 ${batch.status === 'returned' ? 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200' : 'bg-muted text-foreground'}`}>
              <b>{batch.decidedByName}</b>: {batch.decisionNote}</p>}
          </section>
          {batch.source === 'import' && <div className="flex flex-wrap gap-2 text-sm">
            {([[batch.peopleCount - batch.newPeopleCount, 'người cập nhật'], [batch.newPeopleCount, 'người mới'],
              [batch.items.filter(i => i.oldValue == null && i.employeeId).length, 'ô trống được điền'], [batch.items.filter(i => i.oldValue != null).length, 'ô sửa giá trị']] as const)
              .map(([n, label]) => <span key={label} className="rounded-xl border border-border bg-card px-3 py-1.5"><b className={NUM}>{n}</b> {label}</span>)}
          </div>}
          <BatchItems items={batch.items} data={data} collapsedByDefault={batch.peopleCount > 8} />
        </>}
  </Drawer>;
};

const SCOPES: Array<{ key: RosterBatchScope; label: string; icon: React.ElementType; tone: string }> = [
  { key: 'pending', label: 'Chờ duyệt', icon: Hourglass, tone: 'text-indigo-700 dark:text-indigo-300' },
  { key: 'returned', label: 'Trả lại', icon: RotateCcw, tone: 'text-rose-700 dark:text-rose-300' },
  { key: 'approved', label: 'Đã duyệt', icon: CheckCircle2, tone: 'text-leaf-700 dark:text-leaf-300' },
];

/** Phiếu thay đổi: each card is a tab and a count, like Mua hàng. */
export const RosterBatchesView: React.FC<{
  data: RosterData; reloadKey: number; initialOpenId?: string | null; onChanged: () => void; onResubmit: (batch: RosterBatch) => void;
  onCounts?: (pending: number, mine: number) => void;
}> = ({ data, reloadKey, initialOpenId = null, onChanged, onResubmit, onCounts }) => {
  const [scope, setScope] = useState<RosterBatchScope>('pending');
  const [lists, setLists] = useState<Record<RosterBatchScope, RosterBatch[]> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const load = useCallback(() => {
    setError(null);
    Promise.all(SCOPES.map(item => hrmRosterService.listBatches(item.key)))
      .then(([pending, returned, approved]) => { setLists({ pending, returned, approved }); onCounts?.(pending.length, pending.filter(b => b.awaitingMe).length); })
      .catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, [onCounts]);
  useEffect(load, [load, reloadKey]);
  const list = lists?.[scope] || [];
  const hints = useMemo(() => ({
    pending: lists ? (lists.pending.some(b => b.awaitingMe) ? <span className="font-semibold text-indigo-800 dark:text-indigo-200">{lists.pending.filter(b => b.awaitingMe).length} chờ bạn duyệt</span> : 'đang chờ người duyệt') : '',
    returned: 'cần sửa & gửi lại',
    approved: '30 ngày gần đây',
  }), [lists]);

  if (error) return <StateBox kind="error" title="Chưa tải được phiếu thay đổi" message={error} onRetry={load} />;
  if (!lists) return <StateBox kind="loading" title="Đang tải phiếu thay đổi…" />;
  return <section className="space-y-3">
    <nav aria-label="Trạng thái phiếu" className="grid grid-cols-3 gap-2">
      {SCOPES.map((item, i) => {
        const Icon = item.icon; const active = scope === item.key;
        return <button key={item.key} type="button" aria-current={active ? 'page' : undefined} onClick={() => setScope(item.key)}
          className={`rounded-2xl border bg-card p-3 text-left shadow-sm transition md:p-4 ${active ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-border hover:border-teal-300'}`}>
          <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span className="grid h-5 w-5 place-items-center rounded-full bg-muted text-[11px] font-bold text-foreground">{i + 1}</span>{item.label}</span>
          <span className="mt-2 flex items-center gap-2"><Icon size={18} className={item.tone} /><span className="text-2xl font-bold tabular-nums text-foreground">{lists[item.key].length}</span></span>
          <span className="mt-1 hidden text-xs text-muted-foreground sm:block">{hints[item.key]}</span>
        </button>;
      })}
    </nav>
    {list.length === 0 ? <StateBox kind="empty" title={scope === 'pending' ? 'Không có phiếu chờ duyệt' : scope === 'returned' ? 'Không có phiếu bị trả lại' : 'Chưa có phiếu đã duyệt'} />
      : <ul className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        {list.map(batch => <li key={batch.id} className="border-b border-border last:border-b-0">
          <button type="button" onClick={() => setOpenId(batch.id)} className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 border-l-4 px-3 py-3 text-left hover:bg-muted/50 ${BATCH_STRIP[batch.status]}`}>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2"><span className={ENT}>{batch.code}</span><SourceBadge batch={batch} />
                {batch.awaitingMe && <Badge className="border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200">Chờ bạn duyệt</Badge>}
                {batch.status === 'pending' && batch.steps && batch.steps.length > 1 && <Badge className="border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200">Bước {batch.currentStep}/{batch.steps.length}</Badge>}</span>
              <span className="mt-0.5 block truncate text-sm font-semibold text-foreground">{batch.title}</span>
              <span className="block truncate text-xs text-muted-foreground">{batch.createdByName} · {timeVi(batch.createdAt)} · hiệu lực {dateVi(batch.effectiveDate)}</span>
            </span>
            <span className="text-right text-sm"><b className={NUM}>{batch.itemCount}</b> ô<span className="block text-xs text-muted-foreground">{batch.peopleCount} người</span></span>
            <Badge className={BATCH_STATUS_STYLE[batch.status]}>{BATCH_STATUS_LABEL[batch.status]}</Badge>
          </button>
        </li>)}
      </ul>}
    {openId && <BatchDrawer batchId={openId} data={data} onClose={() => setOpenId(null)} onChanged={() => { load(); onChanged(); }}
      onResubmit={batch => { setOpenId(null); onResubmit(batch); }} />}
  </section>;
};
