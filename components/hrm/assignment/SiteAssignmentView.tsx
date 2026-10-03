import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, ArrowRight, Building2, CalendarClock, CheckCircle2, ChevronDown, ClipboardCheck, HardHat, Hourglass,
  MapPinOff, Plus, RefreshCw, Search, Send, UserCheck, Users, X, XCircle,
} from 'lucide-react';
import { useConfirm, useReasonConfirm } from '../../../context/ConfirmContext';
import { useToast } from '../../../context/ToastContext';
import { matchesSearchQueryMultiple } from '../../../lib/searchUtils';
import {
  closedLabel, dateVi, dayBefore, daysBetween, KIND_HINT, KIND_LABEL, periodLabel, STAGE_LABEL, stageOf,
  type SiteAssignment, type SiteAssignmentKind, type SiteAssignmentPreview, type SiteAssignmentStage, type SiteReviewRow,
} from '../../../lib/siteAssignment';
import { siteAssignmentService, type SiteAssignmentBoard, type SiteAssignmentDraft } from '../../../lib/siteAssignmentService';
import SearchableSelect from '../../common/SearchableSelect';
import { Badge, Drawer, StateBox, inputCls, primaryBtn, secondaryBtn } from '../../procurement/hub/hubUi';

// Điều động công trường: HR / site managers record who works where; HR Manage or Admin approves;
// the record drives check-in site, leave approver and (later) labour cost per project.

export interface AssignmentPerson { id: string; fullName: string; employeeCode?: string | null; title?: string | null }

const ENT = 'font-semibold text-mint-700 dark:text-mint-300';
const NUM = 'font-semibold tabular-nums text-leaf-700 dark:text-leaf-300';
const today = () => new Date().toLocaleDateString('sv-SE');

const STAGE_STRIP: Record<SiteAssignmentStage, string> = {
  pending: 'border-l-amber-400',
  upcoming: 'border-l-teal-500',
  active: 'border-l-leaf-500',
  closed: 'border-l-slate-300',
};
const STAGE_BADGE: Record<SiteAssignmentStage, string> = {
  pending: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  upcoming: 'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-200',
  active: 'border-leaf-200 bg-leaf-50 text-leaf-800 dark:border-leaf-900 dark:bg-leaf-950/40 dark:text-leaf-200',
  closed: 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
};
const KIND_BADGE: Record<SiteAssignmentKind, string> = {
  primary: 'border-mint-200 bg-mint-50 text-mint-800 dark:border-mint-900 dark:bg-mint-950/40 dark:text-mint-200',
  concurrent: 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
  temporary: 'border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-200',
};

const KindBadge: React.FC<{ kind: SiteAssignmentKind }> = ({ kind }) => <Badge className={KIND_BADGE[kind]}>{KIND_LABEL[kind]}</Badge>;
const StageBadge: React.FC<{ row: SiteAssignment; stage: SiteAssignmentStage }> = ({ row, stage }) =>
  <Badge className={STAGE_BADGE[stage]}>{stage === 'closed' ? closedLabel(row) : STAGE_LABEL[stage]}</Badge>;

// ---------------------------------------------------------------------------
// Stage strip: each card is a tab and a count.
// ---------------------------------------------------------------------------
const StageStrip: React.FC<{ counts: Record<SiteAssignmentStage, number>; hints: Record<SiteAssignmentStage, React.ReactNode>; stage: SiteAssignmentStage | null; onStage: (s: SiteAssignmentStage | null) => void }> = ({ counts, hints, stage, onStage }) => {
  const cards: Array<{ key: SiteAssignmentStage; icon: React.ElementType; tone: string }> = [
    { key: 'pending', icon: Hourglass, tone: 'text-amber-700 dark:text-amber-300' },
    { key: 'upcoming', icon: CalendarClock, tone: 'text-teal-700 dark:text-teal-300' },
    { key: 'active', icon: HardHat, tone: 'text-leaf-700 dark:text-leaf-300' },
    { key: 'closed', icon: CheckCircle2, tone: 'text-slate-500 dark:text-slate-400' },
  ];
  return <nav aria-label="Các bước điều động" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
    {cards.map((card, index) => {
      const selected = stage === card.key;
      return <button key={card.key} type="button" aria-pressed={selected} onClick={() => onStage(selected ? null : card.key)}
        className={`flex items-start gap-3 rounded-2xl border bg-card p-3 text-left transition hover:shadow-sm ${selected ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-border'}`}>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">{index + 1}</span>
        <span className="min-w-0 flex-1">
          <span className={`flex items-center gap-1.5 text-sm font-semibold ${card.tone}`}><card.icon size={15} />{STAGE_LABEL[card.key]}</span>
          <span className="block text-2xl font-bold tabular-nums text-foreground">{counts[card.key]}</span>
          <span className="block truncate text-xs text-muted-foreground">{hints[card.key]}</span>
        </span>
      </button>;
    })}
  </nav>;
};

// ---------------------------------------------------------------------------
// Detail of one assignment.
// ---------------------------------------------------------------------------
const AssignmentDetail: React.FC<{
  row: SiteAssignment;
  canApprove: boolean;
  busy: boolean;
  onBack: () => void;
  onApprove: () => void;
  onReject: () => void;
  onCancel: () => void;
  onChangeEnd: (mode: 'end' | 'extend') => void;
}> = ({ row, canApprove, busy, onBack, onApprove, onReject, onCancel, onChangeEnd }) => {
  const now = today();
  const stage = stageOf(row, now);
  const startsIn = daysBetween(now, row.startDate);
  const effects = [
    `Chấm công: ${row.siteName} là nơi chấm ${row.kind === 'concurrent' ? 'phụ (nơi chính giữ nguyên)' : 'chính'}${row.kind === 'temporary' && row.endDate ? ` đến ${dateVi(row.endDate)}, sau đó về ${row.fromSiteName || 'nơi cũ'}` : ''}.`,
    row.kind === 'concurrent' ? 'Duyệt phép, chấm công bù: vẫn theo nơi chính.' : `Duyệt phép, chấm công bù: người duyệt của ${row.siteName}.`,
    row.kind === 'primary' && row.fromSiteName ? `${row.fromSiteName} kết thúc ngày ${dateVi(dayBefore(row.startDate))}.` : null,
    `Được thêm vào Tổ chức dự án ${row.projectCode || row.siteName} với quyền Xem (nếu chưa có).`,
  ].filter(Boolean) as string[];
  const steps: Array<{ label: string; at: string | null; by?: string | null; done: boolean; tone?: string }> = [
    { label: row.source === 'baseline' ? 'Ghi nhận hiện trạng' : 'Lập phiếu', at: row.createdAt, by: row.createdByName, done: true },
    { label: row.status === 'rejected' ? 'Từ chối' : row.status === 'cancelled' ? 'Đã hủy' : 'Duyệt', at: row.decidedAt, by: row.decidedByName, done: row.status !== 'pending', tone: row.status === 'rejected' || row.status === 'cancelled' ? 'bg-rose-500' : undefined },
    { label: 'Có hiệu lực', at: row.status === 'approved' && row.startDate <= now ? row.startDate : null, done: row.status === 'approved' && row.startDate <= now },
    { label: row.endedEarlyReason ? 'Kết thúc sớm' : 'Kết thúc', at: row.endDate && row.endDate < now ? row.endDate : null, done: stage === 'closed' && row.status === 'approved' },
  ];

  return <article className="flex h-full flex-col rounded-2xl border border-border bg-card">
    <header className="border-b border-border p-4">
      <button type="button" onClick={onBack} className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-teal-700 lg:hidden dark:text-teal-300"><ArrowLeft size={14} />Danh sách</button>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">{row.code}</span>
        <StageBadge row={row} stage={stage} />
        <KindBadge kind={row.kind} />
        {row.source === 'baseline' && <Badge className={STAGE_BADGE.closed}>Ghi nhận hiện trạng</Badge>}
      </div>
      <h2 className={`mt-1 text-lg ${ENT}`}>{row.employeeName} <span className="text-sm font-normal text-muted-foreground">{row.employeeCode}{row.jobTitle ? ` · ${row.jobTitle}` : ''}</span></h2>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-lg bg-muted px-2 py-1 text-muted-foreground">{row.fromSiteName || 'Chưa có nơi chính'}</span>
        <ArrowRight size={16} className="text-teal-600" />
        <span className={`rounded-lg bg-mint-50 px-2 py-1 dark:bg-mint-950/40 ${ENT}`}>{row.siteName}</span>
        {row.projectCode && <span className="text-xs text-muted-foreground">{row.projectCode}</span>}
      </p>
      <p className="mt-1 text-sm text-foreground">{periodLabel(row)}
        {stage === 'upcoming' && <span className="ml-2 text-xs font-semibold text-teal-700 dark:text-teal-300">bắt đầu sau {startsIn} ngày</span>}
        {stage === 'active' && row.endDate && <span className="ml-2 text-xs font-semibold text-amber-700 dark:text-amber-300">còn {daysBetween(now, row.endDate)} ngày</span>}
      </p>
    </header>
    <div className="flex-1 space-y-4 overflow-y-auto p-4">
      <section><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lý do</h3><p className="mt-1 text-sm text-foreground">{row.reason}</p>
        {row.decisionNote && <p className="mt-1 text-sm text-rose-700 dark:text-rose-300">{row.status === 'rejected' ? 'Lý do từ chối' : 'Ghi chú'}: {row.decisionNote}</p>}
        {row.endedEarlyReason && <p className="mt-1 text-sm text-muted-foreground">Kết thúc sớm: {row.endedEarlyReason}</p>}
      </section>
      {row.status !== 'rejected' && row.status !== 'cancelled' && <section className="rounded-xl bg-mint-50 p-3 dark:bg-mint-950/30">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-mint-800 dark:text-mint-200">{stage === 'active' || stage === 'closed' ? 'Đã áp dụng' : 'Khi có hiệu lực, hệ thống tự áp dụng'}</h3>
        <ul className="mt-1 space-y-1 text-sm text-mint-950 dark:text-mint-50">{effects.map(text => <li key={text} className="flex gap-1.5"><CheckCircle2 size={14} className="mt-0.5 shrink-0 text-leaf-600" />{text}</li>)}</ul>
      </section>}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tiến trình</h3>
        <ol className="mt-2 space-y-2">{steps.map((step, index) => <li key={step.label} className="flex items-start gap-2 text-sm">
          <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${step.done ? step.tone || 'bg-leaf-600' : 'bg-slate-300 dark:bg-slate-600'}`}>{index + 1}</span>
          <span><span className={step.done ? 'font-semibold text-foreground' : 'text-muted-foreground'}>{step.label}</span>
            {step.done && step.at && <span className="text-xs text-muted-foreground"> · {step.at.length > 10 ? new Date(step.at).toLocaleString('vi-VN') : dateVi(step.at)}{step.by ? ` · ${step.by}` : ''}</span>}
            {!step.done && index === 1 && row.status === 'pending' && <span className="text-xs font-semibold text-amber-700 dark:text-amber-300"> · chờ HR Manage / Admin</span>}
          </span>
        </li>)}</ol>
      </section>
    </div>
    {(row.status === 'pending' || stage === 'active' || stage === 'upcoming') && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border p-3">
      {row.status === 'pending' && <button type="button" disabled={busy} onClick={onCancel} className={`${secondaryBtn} mr-auto`}>Hủy phiếu</button>}
      {row.status === 'pending' && canApprove && <>
        <button type="button" disabled={busy} onClick={onReject} className={`${secondaryBtn} text-rose-700 dark:text-rose-300`}><XCircle size={15} />Từ chối</button>
        <button type="button" disabled={busy} onClick={onApprove} className={primaryBtn}><UserCheck size={15} />Duyệt điều động</button>
      </>}
      {stage === 'upcoming' && canApprove && <button type="button" disabled={busy} onClick={onCancel} className={secondaryBtn}>Hủy điều động</button>}
      {stage === 'active' && canApprove && <>
        <button type="button" disabled={busy} onClick={() => onChangeEnd('end')} className={secondaryBtn}>Kết thúc sớm</button>
        <button type="button" disabled={busy} onClick={() => onChangeEnd('extend')} className={secondaryBtn}>{row.endDate ? 'Gia hạn' : 'Đặt ngày kết thúc'}</button>
      </>}
    </footer>}
  </article>;
};

// ---------------------------------------------------------------------------
// Create drawer.
// ---------------------------------------------------------------------------
const CreateDrawer: React.FC<{
  people: AssignmentPerson[];
  board: SiteAssignmentBoard;
  onClose: () => void;
  onCreated: (codes: string[]) => Promise<void>;
}> = ({ people, board, onClose, onCreated }) => {
  const toast = useToast();
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [siteId, setSiteId] = useState('');
  const [kind, setKind] = useState<SiteAssignmentKind>('primary');
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<SiteAssignmentPreview | null>(null);
  const [sending, setSending] = useState(false);
  const draft: SiteAssignmentDraft = { employeeIds, siteId, kind, startDate, endDate: endDate || null, reason: reason.trim() };
  const ready = employeeIds.length > 0 && !!siteId && !!startDate;

  useEffect(() => {
    if (!ready) { setPreview(null); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      siteAssignmentService.preview(draft).then(result => { if (!cancelled) setPreview(result); }).catch(() => { if (!cancelled) setPreview(null); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeIds, siteId, kind, startDate, endDate, ready]);

  const missing = [
    ...(employeeIds.length ? [] : ['chọn người']),
    ...(siteId ? [] : ['chọn công trường']),
    ...(kind === 'temporary' && !endDate ? ['ngày kết thúc (bắt buộc với Tạm thời)'] : []),
    ...(reason.trim().length < 5 ? ['lý do (ít nhất 5 ký tự)'] : []),
  ];
  const blocked = missing.length > 0 || !preview || preview.problems.length > 0;

  const submit = async () => {
    setSending(true);
    try {
      const codes = await siteAssignmentService.submit(draft);
      toast.success(`Đã gửi ${codes.length} phiếu điều động`, `${codes.join(', ')} chờ HR Manage / Admin duyệt; CHT nơi đi và nơi đến được báo.`);
      await onCreated(codes);
    } catch (error) {
      toast.error('Chưa gửi được', error instanceof Error ? error.message : 'Vui lòng thử lại.');
    } finally {
      setSending(false);
    }
  };

  const picked = employeeIds.map(id => people.find(person => person.id === id)).filter(Boolean) as AssignmentPerson[];
  const site = board.sites.find(item => item.id === siteId);

  return <Drawer label="Lập phiếu điều động" onClose={onClose}
    header={<div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Điều động công trường</p><h2 className="text-lg font-semibold text-foreground">Lập phiếu điều động</h2></div>}
    footer={<>
      {missing.length > 0 && <span className="mr-auto text-xs text-muted-foreground">Còn thiếu: {missing.join(', ')}.</span>}
      <button type="button" onClick={onClose} className={secondaryBtn}>Đóng</button>
      <button type="button" disabled={blocked || sending} onClick={() => void submit()} className={primaryBtn}><Send size={15} />{sending ? 'Đang gửi…' : `Gửi duyệt${employeeIds.length > 1 ? ` (${employeeIds.length} người)` : ''}`}</button>
    </>}>
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">1. Ai được điều động</h3>
      <SearchableSelect value={null} options={people.filter(person => !employeeIds.includes(person.id))}
        onChange={person => person && setEmployeeIds(ids => [...ids, person.id])}
        getOptionValue={person => person.id}
        getOptionLabel={person => `${person.fullName}${person.employeeCode ? ` (${person.employeeCode})` : ''}`}
        getOptionSearchText={person => [person.fullName, person.employeeCode, person.title].filter(Boolean).join(' ')}
        placeholder="Gõ tên hoặc mã nhân viên… (chọn được nhiều người)" emptyLabel="Không tìm thấy nhân viên" />
      {picked.length > 0 && <ul className="flex flex-wrap gap-1.5">{picked.map(person => <li key={person.id} className="inline-flex items-center gap-1 rounded-full border border-mint-200 bg-mint-50 px-2.5 py-1 text-xs dark:border-mint-900 dark:bg-mint-950/40">
        <span className={ENT}>{person.fullName}</span>
        <button type="button" aria-label={`Bỏ ${person.fullName}`} onClick={() => setEmployeeIds(ids => ids.filter(id => id !== person.id))} className="text-muted-foreground hover:text-rose-600"><X size={12} /></button>
      </li>)}</ul>}
    </section>
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">2. Đến công trường nào, làm thế nào</h3>
      <select value={siteId} onChange={event => setSiteId(event.target.value)} aria-label="Công trường đến" className={`${inputCls} w-full`}>
        <option value="">— Chọn công trường —</option>
        {board.sites.map(item => <option key={item.id} value={item.id}>{item.name}{item.projectCode ? ` · ${item.projectCode}` : ''}</option>)}
      </select>
      {site && <p className="text-xs text-muted-foreground">Người duyệt chấm công / phép tại đây: <span className={ENT}>{site.approverName || 'chưa chọn'}</span>
        {!site.hasCoordinates && <span className="ml-1 font-semibold text-amber-700 dark:text-amber-300">· chưa có tọa độ chấm công</span>}</p>}
      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Loại điều động">
        {(['primary', 'concurrent', 'temporary'] as const).map(option => <button key={option} type="button" role="radio" aria-checked={kind === option} onClick={() => setKind(option)}
          className={`rounded-xl border px-3 py-2 text-left ${kind === option ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-border hover:bg-muted'}`}>
          <span className="block text-sm font-semibold text-foreground">{KIND_LABEL[option]}</span>
          <span className="block text-[11px] leading-snug text-muted-foreground">{KIND_HINT[option]}</span>
        </button>)}
      </div>
    </section>
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">3. Thời gian và lý do</h3>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-semibold text-muted-foreground">Từ ngày<input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} className={`${inputCls} mt-1 block`} /></label>
        <label className="text-xs font-semibold text-muted-foreground">Đến ngày {kind !== 'temporary' && <span className="font-normal">(để trống = không thời hạn)</span>}
          <input type="date" value={endDate} min={startDate} onChange={event => setEndDate(event.target.value)} className={`${inputCls} mt-1 block`} /></label>
      </div>
      <textarea value={reason} onChange={event => setReason(event.target.value)} rows={2} maxLength={500}
        placeholder="Ví dụ: Tăng cường QS/QC cho đợt nghiệm thu móng RICO" className={`${inputCls} w-full resize-none`} />
    </section>
    <section className="rounded-2xl border border-border bg-muted/40 p-3 text-sm">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Kiểm tra trước khi gửi</h3>
      {!ready ? <p className="mt-1 text-xs text-muted-foreground">Chọn người, công trường và ngày để hệ thống kiểm tra.</p>
        : !preview ? <p className="mt-1 text-xs text-muted-foreground">Đang kiểm tra…</p>
        : <ul className="mt-1 space-y-1">
          {preview.problems.map(text => <li key={text} className="flex gap-1.5 font-semibold text-rose-700 dark:text-rose-300"><XCircle size={14} className="mt-0.5 shrink-0" />{text}</li>)}
          {preview.warnings.map(text => <li key={text} className="flex gap-1.5 text-amber-800 dark:text-amber-200"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{text}</li>)}
          {preview.effects.map(text => <li key={text} className="flex gap-1.5 text-foreground"><CheckCircle2 size={14} className="mt-0.5 shrink-0 text-leaf-600" />{text}</li>)}
        </ul>}
      <p className="mt-2 text-xs text-muted-foreground">Người duyệt: HR Manage hoặc Admin. CHT nơi đi và nơi đến nhận thông báo.</p>
    </section>
  </Drawer>;
};

// ---------------------------------------------------------------------------
// Change end date (end early / extend).
// ---------------------------------------------------------------------------
const ChangeEndDrawer: React.FC<{ row: SiteAssignment; mode: 'end' | 'extend'; onClose: () => void; onDone: () => Promise<void> }> = ({ row, mode, onClose, onDone }) => {
  const toast = useToast();
  const [endDate, setEndDate] = useState(mode === 'end' ? today() : row.endDate || '');
  const [noEnd, setNoEnd] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const invalid = reason.trim().length < 5 || (!noEnd && (!endDate || endDate < today() || (mode === 'end' && row.endDate !== null && endDate >= row.endDate)));
  const save = async () => {
    setSaving(true);
    try {
      await siteAssignmentService.changeEnd(row.id, noEnd ? null : endDate, reason.trim());
      toast.success(mode === 'end' ? 'Đã đặt kết thúc sớm' : 'Đã gia hạn', `${row.employeeName} · ${row.siteName} ${noEnd ? 'không thời hạn' : `đến ${dateVi(endDate)}`}.`);
      await onDone();
    } catch (error) {
      toast.error('Chưa lưu được', error instanceof Error ? error.message : 'Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  };
  return <Drawer label={mode === 'end' ? 'Kết thúc sớm' : 'Gia hạn'} onClose={onClose}
    header={<div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{row.code}</p><h2 className="text-lg font-semibold text-foreground">{mode === 'end' ? 'Kết thúc sớm' : 'Gia hạn điều động'}</h2>
      <p className={`text-sm ${ENT}`}>{row.employeeName} · {row.siteName}</p></div>}
    footer={<><button type="button" onClick={onClose} className={secondaryBtn}>Đóng</button>
      <button type="button" disabled={invalid || saving} onClick={() => void save()} className={primaryBtn}>{saving ? 'Đang lưu…' : 'Lưu'}</button></>}>
    <p className="text-sm text-muted-foreground">Hiện tại: {periodLabel(row)}. Ngày bắt đầu không đổi được vì đã có hiệu lực; công đã chấm giữ nguyên.</p>
    <label className="block text-xs font-semibold text-muted-foreground">{mode === 'end' ? 'Làm ngày cuối cùng' : 'Đến ngày'}
      <input type="date" value={endDate} min={today()} disabled={noEnd} onChange={event => setEndDate(event.target.value)} className={`${inputCls} mt-1 block`} /></label>
    {mode === 'extend' && row.kind !== 'temporary' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={noEnd} onChange={event => setNoEnd(event.target.checked)} />Không thời hạn</label>}
    <label className="block text-xs font-semibold text-muted-foreground">Lý do
      <textarea value={reason} onChange={event => setReason(event.target.value)} rows={2} className={`${inputCls} mt-1 w-full resize-none`} placeholder="Ví dụ: Hoàn thành nghiệm thu sớm" /></label>
  </Drawer>;
};

// ---------------------------------------------------------------------------
// Sites: who is where right now.
// ---------------------------------------------------------------------------
const SitesView: React.FC<{ board: SiteAssignmentBoard; onOpen: (id: string) => void }> = ({ board, onOpen }) => {
  const now = today();
  return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
    {board.sites.map(site => {
      const rows = board.assignments.filter(row => row.siteId === site.id);
      const active = rows.filter(row => stageOf(row, now) === 'active');
      const coming = rows.filter(row => stageOf(row, now) === 'upcoming');
      const primary = active.filter(row => row.kind !== 'concurrent');
      return <section key={site.id} className="flex flex-col rounded-2xl border border-border bg-card p-4">
        <header className="flex items-start gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-600 to-leaf-500 text-white"><Building2 size={18} /></span>
          <div className="min-w-0 flex-1">
            <h3 className={`truncate ${ENT}`}>{site.name}</h3>
            <p className="truncate text-xs text-muted-foreground">{site.projectCode || 'Chưa gắn dự án'} · duyệt: {site.approverName || <span className="font-semibold text-amber-700">chưa chọn</span>}</p>
          </div>
          <span className="text-right text-xs text-muted-foreground"><span className={`block text-xl ${NUM}`}>{active.length}</span>người</span>
        </header>
        {!site.hasCoordinates && <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"><MapPinOff size={13} />Chưa có tọa độ chấm công</p>}
        <p className="mt-2 text-xs text-muted-foreground"><span className={NUM}>{primary.length}</span> nơi chính · <span className={NUM}>{active.length - primary.length}</span> kiêm nhiệm{coming.length > 0 && <> · <span className="font-semibold text-teal-700 dark:text-teal-300">{coming.length} sắp đến</span></>}</p>
        {active.length + coming.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Chưa có ai.</p>
          : <ul className="mt-2 max-h-64 divide-y divide-border overflow-y-auto">{[...coming, ...active].map(row => <li key={row.id}>
            <button type="button" onClick={() => onOpen(row.id)} className="flex w-full items-center gap-2 py-1.5 text-left text-sm hover:bg-muted/50">
              <span className={`min-w-0 flex-1 truncate ${ENT}`}>{row.employeeName}</span>
              {stageOf(row, now) === 'upcoming' ? <Badge className={STAGE_BADGE.upcoming}>từ {dateVi(row.startDate)}</Badge> : <KindBadge kind={row.kind} />}
            </button>
          </li>)}</ul>}
      </section>;
    })}
  </div>;
};

// ---------------------------------------------------------------------------
// Review: HR confirms where people really work before H2 starts.
// ---------------------------------------------------------------------------
const ReviewView: React.FC<{ board: SiteAssignmentBoard; onConfirmed: () => Promise<void> }> = ({ board, onConfirmed }) => {
  const toast = useToast();
  const [choice, setChoice] = useState<Record<string, string>>(() => Object.fromEntries(board.review.map(row => [row.employeeId, row.office ? 'office' : row.suggestedSiteId || ''])));
  const [checked, setChecked] = useState<Set<string>>(() => new Set(board.review.filter(row => row.office || row.suggestedSiteId).map(row => row.employeeId)));
  const [filter, setFilter] = useState<'all' | 'need' | 'office'>('all');
  const [saving, setSaving] = useState(false);
  const rows = board.review.filter(row => filter === 'all' || (filter === 'need' ? !row.office && row.sites.length > 1 : row.office));
  const ready = [...checked].filter(id => choice[id]);
  const confirm = async () => {
    setSaving(true);
    try {
      const count = await siteAssignmentService.confirmReview(ready.map(id => ({ employeeId: id, siteId: choice[id] === 'office' ? null : choice[id] })));
      toast.success(`Đã xác nhận ${ready.length} người`, `${count} điều động ghi nhận hiện trạng có hiệu lực ngay; người văn phòng không tạo điều động.`);
      await onConfirmed();
    } catch (error) {
      toast.error('Chưa xác nhận được', error instanceof Error ? error.message : 'Vui lòng thử lại.');
    } finally {
      setSaving(false);
    }
  };
  if (board.review.length === 0) return <StateBox kind="empty" title="Đã rà soát xong" message="Mọi người đã có nơi làm việc rõ ràng." />;
  return <section className="overflow-hidden rounded-2xl border border-border bg-card">
    <div className="space-y-2 border-b border-border p-3">
      <p className="text-sm text-foreground">Trước khi bật điều động, HR xác nhận <b>nơi làm việc chính</b> của từng người. Hệ thống đã gợi ý từ hồ sơ và Tổ chức dự án; người văn phòng (TGĐ, kế toán, HCNS…) có mặt trong dự án chỉ để xem dự án nên gợi ý <b>Văn phòng — không điều động</b>.</p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-border p-0.5 text-xs font-semibold" role="group" aria-label="Lọc">
          {([['all', `Tất cả ${board.review.length}`], ['need', `Ở nhiều nơi ${board.review.filter(row => !row.office && row.sites.length > 1).length}`], ['office', `Văn phòng ${board.review.filter(row => row.office).length}`]] as const).map(([key, label]) =>
            <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)} className={`rounded-md px-2.5 py-1 ${filter === key ? 'bg-teal-600 text-white' : 'text-muted-foreground hover:bg-muted'}`}>{label}</button>)}
        </div>
        <button type="button" disabled={!ready.length || saving} onClick={() => void confirm()} className={`${primaryBtn} ml-auto`}><ClipboardCheck size={15} />{saving ? 'Đang xác nhận…' : `Xác nhận ${ready.length} người đã chọn`}</button>
      </div>
    </div>
    <ul className="divide-y divide-border">{rows.map(row => {
      const value = choice[row.employeeId] || '';
      return <li key={row.employeeId} className={`flex flex-col gap-2 border-l-4 p-3 md:flex-row md:items-center ${row.office ? 'border-l-slate-300' : row.sites.length > 1 ? 'border-l-amber-400' : 'border-l-leaf-500'}`}>
        <label className="flex min-w-0 flex-1 items-start gap-2">
          <input type="checkbox" className="mt-1" checked={checked.has(row.employeeId)} onChange={event => setChecked(current => { const next = new Set(current); if (event.target.checked) next.add(row.employeeId); else next.delete(row.employeeId); return next; })} />
          <span className="min-w-0">
            <span className={`block ${ENT}`}>{row.employeeName} <span className="text-xs font-normal text-muted-foreground">{row.employeeCode}{row.jobTitle ? ` · ${row.jobTitle}` : ''}</span></span>
            <span className="mt-0.5 flex flex-wrap gap-1">{row.sites.map(item => <Badge key={item.siteId} className={KIND_BADGE.concurrent}>{item.siteName}{item.role ? ` · ${item.role}` : ''}</Badge>)}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{row.suggestionNote}</span>
          </span>
        </label>
        <select value={value} aria-label={`Nơi chính của ${row.employeeName}`} onChange={event => { setChoice(current => ({ ...current, [row.employeeId]: event.target.value })); setChecked(current => new Set(current).add(row.employeeId)); }}
          className={`${inputCls} w-full md:w-72 ${!value ? 'border-amber-400' : ''}`}>
          <option value="">— Chọn nơi chính —</option>
          <option value="office">Văn phòng — không điều động</option>
          {board.sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
        </select>
      </li>;
    })}</ul>
  </section>;
};

// ---------------------------------------------------------------------------
// Main view.
// ---------------------------------------------------------------------------
const SiteAssignmentView: React.FC<{ people: AssignmentPerson[]; initialSelectedId?: string | null }> = ({ people, initialSelectedId = null }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const reasonConfirm = useReasonConfirm();
  const [board, setBoard] = useState<SiteAssignmentBoard | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'list' | 'sites' | 'review'>('list');
  const [stage, setStage] = useState<SiteAssignmentStage | null>(null);
  const [search, setSearch] = useState('');
  const [siteFilter, setSiteFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [creating, setCreating] = useState(false);
  const [changing, setChanging] = useState<'end' | 'extend' | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBoard(await siteAssignmentService.board());
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được điều động.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const now = today();
  const counts = useMemo(() => {
    const result: Record<SiteAssignmentStage, number> = { pending: 0, upcoming: 0, active: 0, closed: 0 };
    board?.assignments.forEach(row => { result[stageOf(row, now)] += 1; });
    return result;
  }, [board, now]);

  if (error && !board) return <StateBox kind={/quyền|permission|42501/i.test(error) ? 'denied' : 'error'} title={/quyền|42501/i.test(error) ? 'Bạn chưa có quyền xem điều động' : undefined} message={error} onRetry={() => void load()} />;
  if (!board) return <StateBox kind="loading" title="Đang tải điều động…" />;

  const rows = board.assignments
    .filter(row => !stage || stageOf(row, now) === stage)
    .filter(row => stage !== null || stageOf(row, now) !== 'closed')
    .filter(row => !siteFilter || row.siteId === siteFilter)
    .filter(row => !search || matchesSearchQueryMultiple([row.code, row.employeeName, row.employeeCode, row.siteName, row.projectCode, row.reason], search))
    .sort((a, b) => {
      const order: Record<SiteAssignmentStage, number> = { pending: 0, upcoming: 1, active: 2, closed: 3 };
      return order[stageOf(a, now)] - order[stageOf(b, now)] || a.startDate.localeCompare(b.startDate) || a.employeeName.localeCompare(b.employeeName, 'vi');
    });
  const selected = board.assignments.find(row => row.id === selectedId) || null;
  const pendingMine = board.can.approve ? counts.pending : 0;
  const soon = board.assignments.filter(row => stageOf(row, now) === 'upcoming' && daysBetween(now, row.startDate) <= 7).length;
  const activeSites = new Set(board.assignments.filter(row => stageOf(row, now) === 'active').map(row => row.siteId)).size;
  const hints: Record<SiteAssignmentStage, React.ReactNode> = {
    pending: pendingMine > 0 ? <span className="font-semibold text-amber-800 dark:text-amber-200">{pendingMine} chờ bạn duyệt</span> : 'phiếu mới gửi',
    upcoming: soon > 0 ? `${soon} bắt đầu trong 7 ngày` : 'đã duyệt, chưa tới ngày',
    active: `ở ${activeSites} công trường`,
    closed: 'hết hạn, kết thúc sớm, hủy, từ chối',
  };

  const act = async (action: () => Promise<void>, title: string, detail: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(title, detail);
      await load();
    } catch (actionError) {
      toast.error('Chưa thực hiện được', actionError instanceof Error ? actionError.message : 'Vui lòng thử lại.');
    } finally {
      setBusy(false);
    }
  };
  const approve = async (row: SiteAssignment) => {
    const ok = await confirm({
      title: 'Duyệt điều động', targetName: `${row.code} · ${row.employeeName} → ${row.siteName}`, actionLabel: 'Duyệt', confirmText: 'Duyệt',
      intent: 'success', countdownSeconds: 0, subtitle: `${periodLabel(row)} · ${KIND_LABEL[row.kind]}`,
      warningText: 'Trước ngày bắt đầu vẫn hủy được; sau đó chỉ kết thúc sớm hoặc gia hạn.',
    });
    if (!ok) return;
    await act(() => siteAssignmentService.decide(row.id, true, null), 'Đã duyệt điều động',
      `${row.employeeName} làm tại ${row.siteName} từ ${dateVi(row.startDate)}; CHT hai nơi đã được báo.`);
  };
  const reject = async (row: SiteAssignment) => {
    const note = await reasonConfirm({ title: 'Từ chối điều động', targetName: `${row.code} · ${row.employeeName}`, reasonLabel: 'Lý do từ chối', reasonPlaceholder: 'Ví dụ: công trường đi đang thiếu người', actionLabel: 'Từ chối', intent: 'danger', minLength: 5 });
    if (note === null) return;
    await act(() => siteAssignmentService.decide(row.id, false, note), 'Đã từ chối', `${row.code}: người lập phiếu nhận thông báo kèm lý do.`);
  };
  const cancel = async (row: SiteAssignment) => {
    const note = await reasonConfirm({ title: row.status === 'pending' ? 'Hủy phiếu' : 'Hủy điều động', targetName: `${row.code} · ${row.employeeName}`, subtitle: 'Chưa tới ngày bắt đầu nên chưa ảnh hưởng chấm công hay duyệt phép.', reasonLabel: 'Lý do hủy', actionLabel: 'Hủy', intent: 'danger', minLength: 5 });
    if (note === null) return;
    await act(() => siteAssignmentService.cancel(row.id, note), 'Đã hủy', `${row.code} không còn hiệu lực; lịch sử được giữ.`);
  };

  return <section className="space-y-3">
    <div className={`${selected ? 'hidden lg:flex' : 'flex'} flex-wrap items-start gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm`}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-600 to-leaf-500 text-white"><HardHat size={20} /></span>
      <div className="min-w-[220px] flex-1">
        <h2 className="text-lg font-bold text-foreground">Điều động công trường</h2>
        <p className="text-sm text-muted-foreground">Ai làm ở công trường nào, từ ngày nào. Phiếu đã duyệt tự áp dụng vào chấm công và người duyệt phép từ ngày bắt đầu.</p>
        <details className="mt-1 text-sm">
          <summary className="inline-flex cursor-pointer items-center gap-1 text-xs font-semibold text-teal-700 dark:text-teal-300">Cách làm <ChevronDown size={13} /></summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
            <li>Bấm <b>Lập phiếu điều động</b>: chọn người (nhiều người một lần), công trường, loại <b>Chính / Kiêm nhiệm / Tạm thời</b>, ngày và lý do.</li>
            <li>HR Manage hoặc Admin duyệt; chỉ huy trưởng nơi đi và nơi đến nhận thông báo.</li>
            <li>Đến ngày bắt đầu: chấm công nhận công trường mới, đơn nghỉ đi tới người duyệt của công trường đó, người được thêm vào Tổ chức dự án với quyền Xem.</li>
            <li>Đổi ý trước ngày bắt đầu thì <b>Hủy</b>; đã bắt đầu thì <b>Kết thúc sớm</b> hoặc <b>Gia hạn</b>. Công đã chấm giữ nguyên.</li>
          </ol>
        </details>
      </div>
      {board.can.create && <button type="button" onClick={() => setCreating(true)} className={primaryBtn}><Plus size={16} />Lập phiếu điều động</button>}
    </div>

    {board.can.approve && board.review.length > 0 && view !== 'review' && <div className={`${selected ? 'hidden lg:flex' : 'flex'} flex-wrap items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100`}>
      <AlertTriangle size={16} className="shrink-0" />
      <span className="flex-1"><b>{board.review.length} người</b> chưa được xác nhận nơi làm việc chính ({board.review.filter(row => !row.office && row.sites.length > 1).length} người đang ở nhiều công trường).</span>
      <button type="button" onClick={() => { setView('review'); setSelectedId(null); }} className={secondaryBtn}>Rà soát hiện trạng</button>
    </div>}

    <div className={selected ? 'hidden lg:block' : ''}><StageStrip counts={counts} hints={hints} stage={stage} onStage={next => { setStage(next); setView('list'); }} /></div>

    <div className={`${selected ? 'hidden lg:flex' : 'flex'} flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-2`}>
      <div className="flex rounded-lg border border-border p-0.5 text-xs font-semibold" role="tablist" aria-label="Góc nhìn">
        {([['list', 'Phiếu điều động', ClipboardCheck], ['sites', 'Công trường đang có ai', Users], ...(board.can.approve ? [['review', `Rà soát hiện trạng${board.review.length ? ` (${board.review.length})` : ''}`, UserCheck]] : [])] as Array<[typeof view, string, React.ElementType]>).map(([key, label, Icon]) =>
          <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => { setView(key); setSelectedId(null); }}
            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 ${view === key ? 'bg-teal-600 text-white' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={13} />{label}</button>)}
      </div>
      {view === 'list' && <>
        <label className="flex min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-border bg-background px-2">
          <Search size={15} className="text-muted-foreground" />
          <input value={search} onChange={event => setSearch(event.target.value)} aria-label="Tìm phiếu" placeholder="Tìm tên, mã NV, công trường, số phiếu…" className="w-full bg-transparent py-1.5 text-sm focus:outline-none" />
          {search && <button type="button" onClick={() => setSearch('')} aria-label="Xóa tìm kiếm"><X size={14} /></button>}
        </label>
        <select value={siteFilter} onChange={event => setSiteFilter(event.target.value)} aria-label="Công trường" className={inputCls}>
          <option value="">Mọi công trường</option>{board.sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
        </select>
      </>}
      <button type="button" onClick={() => void load()} className={`${secondaryBtn} ml-auto`}><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /><span className="hidden sm:inline">Tải lại</span></button>
    </div>

    {view === 'sites' ? <SitesView board={board} onOpen={id => { setView('list'); setStage(null); setSelectedId(id); }} />
      : view === 'review' ? <ReviewView key={board.review.length} board={board} onConfirmed={async () => { await load(); setView('sites'); }} />
      : <div className="grid gap-3 lg:grid-cols-[380px_minmax(0,1fr)]">
        <section aria-label="Phiếu điều động" className={`${selected ? 'hidden lg:block' : ''} overflow-hidden rounded-2xl border border-border bg-card`}>
          {rows.length === 0 ? <div className="px-4 py-12 text-center text-sm text-muted-foreground"><HardHat size={24} className="mx-auto mb-2 text-mint-500" />
            {board.assignments.length === 0 ? 'Chưa có phiếu điều động. Bấm "Lập phiếu điều động" để bắt đầu.' : 'Không có phiếu khớp bộ lọc.'}</div>
            : <ul className="max-h-[70vh] divide-y divide-border overflow-y-auto">{rows.map(row => {
              const rowStage = stageOf(row, now);
              return <li key={row.id}><button type="button" onClick={() => setSelectedId(row.id)} aria-current={selectedId === row.id}
                className={`w-full border-l-4 px-3 py-2.5 text-left hover:bg-mint-50/60 dark:hover:bg-mint-950/20 ${STAGE_STRIP[rowStage]} ${selectedId === row.id ? 'bg-mint-50 dark:bg-mint-950/30' : ''}`}>
                <span className="flex items-center gap-2"><span className={`min-w-0 flex-1 truncate text-sm ${ENT}`}>{row.employeeName}</span><StageBadge row={row} stage={rowStage} /></span>
                <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <span className="truncate">{row.fromSiteName || '—'}</span><ArrowRight size={11} className="shrink-0" /><span className="truncate font-semibold text-foreground">{row.siteName}</span>
                </span>
                <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground"><KindBadge kind={row.kind} /><span className="truncate">{periodLabel(row)}</span></span>
              </button></li>;
            })}</ul>}
        </section>
        <div className={selected ? '' : 'hidden lg:block'}>
          {selected ? <AssignmentDetail row={selected} canApprove={board.can.approve} busy={busy} onBack={() => setSelectedId(null)}
            onApprove={() => void approve(selected)} onReject={() => void reject(selected)} onCancel={() => void cancel(selected)} onChangeEnd={setChanging} />
            : <div className="flex h-full min-h-[240px] items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">Chọn một phiếu để xem chi tiết.</div>}
        </div>
      </div>}

    {creating && <CreateDrawer people={people} board={board} onClose={() => setCreating(false)} onCreated={async () => { setCreating(false); setStage('pending'); await load(); }} />}
    {selected && changing && <ChangeEndDrawer row={selected} mode={changing} onClose={() => setChanging(null)} onDone={async () => { setChanging(null); await load(); }} />}
  </section>;
};

export default SiteAssignmentView;
