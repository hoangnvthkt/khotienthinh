// Giao diện "Điều chỉnh tiến độ có duyệt" trên tab Tiến độ (mockup chủ SP duyệt 15/10/2026).
import React, { useMemo, useRef, useState } from 'react';
import {
  AlarmClock, CalendarClock, CalendarRange, Check, CircleCheck, FileText, Flag, GitCommitHorizontal, Goal,
  History, Hourglass, Info, Loader2, Paperclip, PencilRuler, Send, ShieldCheck, Trash2, TriangleAlert, Undo2, UserCheck, X,
} from 'lucide-react';
import type { ProjectBaseline } from '../../../types';
import { Drawer, inputCls, primaryBtn, secondaryBtn } from '../../procurement/hub/hubUi';
import { ENT, viDate } from '../../finance/financeUi';
import { useToast } from '../../../context/ToastContext';
import {
  SCHEDULE_PARTIES, SCHEDULE_PARTY_LABELS, scheduleChangeService,
  type ScheduleAttachment, type ScheduleChange, type ScheduleControl, type ScheduleDiffRow, type ScheduleDiffSummary,
  type ScheduleDraftHeader, type ScheduleParty, type ScheduleReason, type LineMeta,
} from '../../../lib/projectScheduleChangeService';

const sd = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '—');
const num = (v: number | null | undefined) => (v == null ? '—' : Number(v).toLocaleString('vi-VN', { maximumFractionDigits: 2 }));
const pill = (tone: string) => `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${tone}`;
const TONE = {
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  rose: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200',
  sky: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  mint: 'bg-mint-100 text-mint-800 dark:bg-mint-900/40 dark:text-mint-200',
  zinc: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
};

export const reasonLabelOf = (reasons: ScheduleReason[], code: string | null | undefined) =>
  reasons.find(reason => reason.code === code)?.label || code || '—';

// ---------------------------------------------------------------------------- dải chỉ số
export const ScheduleControlStrip: React.FC<{
  control: ScheduleControl; versionLabel: string; versionHint: string; originalFinish: string | null;
  overdueCount: number; onOpenVersions: () => void;
}> = ({ control, versionLabel, versionHint, originalFinish, overdueCount, onOpenVersions }) => {
  const finish = control.currentFinish || null;
  const lag = finish && originalFinish ? Math.round((Date.parse(finish) - Date.parse(originalFinish)) / 86_400_000) : 0;
  const pending = control.openChange && control.openChange.status === 'submitted' ? 1 : 0;
  const cards: Array<{ icon: React.ElementType; label: string; value: string; hint: string; tone: string; onClick?: () => void }> = [
    { icon: Flag, label: 'Hạn hợp đồng', value: viDate(control.contractFinishDate), hint: control.contractFinishDate ? 'Bản gốc HĐ · khóa' : 'Chưa nhập hạn HĐ', tone: TONE.zinc },
    { icon: GitCommitHorizontal, label: 'Đang áp dụng', value: versionLabel, hint: versionHint, tone: TONE.mint, onClick: onOpenVersions },
    { icon: Goal, label: 'Về đích hiện hành', value: viDate(finish), hint: lag > 0 ? `chậm ${lag} ngày so với bản gốc` : lag < 0 ? `sớm ${-lag} ngày so với bản gốc` : 'đúng bản gốc', tone: lag > 0 ? TONE.rose : TONE.mint },
    { icon: AlarmClock, label: 'Việc quá ngày KH', value: String(overdueCount), hint: overdueCount > 0 ? 'chưa xong · cần lập lại' : 'không có', tone: overdueCount > 0 ? TONE.rose : TONE.mint },
    { icon: Hourglass, label: 'Chờ duyệt', value: String(pending), hint: pending ? 'phiếu điều chỉnh' : 'không có phiếu', tone: pending ? TONE.amber : TONE.zinc },
  ];
  return <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">{cards.map(card => {
    const Icon = card.icon;
    const body = <>
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${card.tone}`}><Icon size={16} /></span>
      <span className="min-w-0 text-left">
        <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{card.label}</span>
        <span className="block truncate text-base font-black tabular-nums text-foreground">{card.value}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{card.hint}</span>
      </span>
    </>;
    const cls = 'flex min-w-[170px] flex-1 shrink-0 items-start gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5';
    return card.onClick
      ? <button key={card.label} type="button" onClick={card.onClick} className={`${cls} hover:border-teal-400`}>{body}</button>
      : <div key={card.label} className={cls}>{body}</div>;
  })}</div>;
};

// ---------------------------------------------------------------------------- trạng thái phiếu đang mở
export const ScheduleStatusBar: React.FC<{
  control: ScheduleControl; meId: string | null; reasons: ScheduleReason[];
  onReview: () => void; onContinue: () => void; onWithdraw: () => void;
}> = ({ control, meId, reasons, onReview, onContinue, onWithdraw }) => {
  const change = control.openChange;
  if (!change) return null;
  const mine = change.createdBy === meId;
  const waitingMe = change.status === 'submitted' && change.approvers.some(user => user.id === meId);
  const lines = change.lines.filter(line => line.isLeaf).length;
  const finish = change.finishAfter && change.finishAfter !== change.finishBefore
    ? ` · về đích ${sd(change.finishBefore)} → ${sd(change.finishAfter)}` : '';
  if (change.status === 'submitted') {
    return <div className={`flex flex-wrap items-center gap-3 rounded-xl border border-l-4 bg-card px-3 py-2.5 text-xs ${waitingMe ? 'border-amber-300 border-l-amber-500' : 'border-border border-l-sky-500'}`}>
      <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${waitingMe ? TONE.amber : TONE.sky}`}><Hourglass size={16} /></span>
      <div className="min-w-0 flex-1">
        <div className="font-bold text-foreground">{waitingMe ? 'Chờ bạn duyệt' : change.step === 'confirm' ? 'Chờ duyệt dời về đích' : 'Chờ duyệt'} · <span className="font-mono text-teal-700 dark:text-teal-300">{change.code}</span>{finish}</div>
        <div className="text-muted-foreground"><span className={ENT}>{change.createdByName}</span> gửi {change.submittedAt ? new Date(change.submittedAt).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : ''} · {lines} việc · {reasonLabelOf(reasons, change.reasonCode)} · người duyệt {change.approvers.map(user => user.name).join(', ')}</div>
      </div>
      {mine && change.step === 'approve' && <button type="button" onClick={onWithdraw} className={`${secondaryBtn} text-xs`}><Undo2 size={14} /> Rút lại để sửa</button>}
      <button type="button" onClick={onReview} className={waitingMe ? `${primaryBtn} text-xs` : `${secondaryBtn} text-xs`}>{waitingMe ? 'Xem và duyệt' : 'Xem phiếu'}</button>
    </div>;
  }
  if (change.status === 'returned') {
    return <div className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 border-l-4 border-l-rose-500 bg-rose-50 px-3 py-2.5 text-xs dark:bg-rose-950/30">
      <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${TONE.rose}`}><Undo2 size={16} /></span>
      <div className="min-w-0 flex-1">
        <div className="font-bold text-rose-800 dark:text-rose-200"><span className="font-mono">{change.code}</span> bị trả lại{change.returnedByName ? ` bởi ${change.returnedByName}` : ''}</div>
        <div className="text-rose-700/90 dark:text-rose-200/80">{change.returnReason}</div>
      </div>
      {mine ? <button type="button" onClick={onContinue} className={`${primaryBtn} text-xs`}><PencilRuler size={14} /> Sửa lại</button>
        : <span className="text-muted-foreground">Chờ {change.createdByName} sửa</span>}
    </div>;
  }
  return <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-xs">
    <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${TONE.sky}`}><PencilRuler size={16} /></span>
    <div className="min-w-0 flex-1">
      {mine ? <><b>Bạn có bản nháp</b> <span className="font-mono text-teal-700 dark:text-teal-300">{change.code}</span> · {lines} việc · chưa gửi duyệt</>
        : <><span className={ENT}>{change.createdByName}</span> đang soạn điều chỉnh <span className="font-mono text-teal-700 dark:text-teal-300">{change.code}</span>. Mỗi lúc chỉ một phiếu mở.</>}
    </div>
    {mine ? <button type="button" onClick={onContinue} className={`${primaryBtn} text-xs`}><PencilRuler size={14} /> Tiếp tục soạn</button>
      : <button type="button" onClick={onReview} className={`${secondaryBtn} text-xs`}>Xem nháp</button>}
  </div>;
};

// ---------------------------------------------------------------------------- bản nháp
export const DraftBanner: React.FC<{
  code: string | null; summary: ScheduleDiffSummary; saving: boolean; savedAt: string | null; saveError: string | null;
  overdueLeft: number; approverHint: string; readOnly?: boolean; onCancel: () => void; onSubmit: () => void; onClose?: () => void;
}> = ({ code, summary, saving, savedAt, saveError, overdueLeft, approverHint, readOnly, onCancel, onSubmit, onClose }) => {
  const empty = summary.rows.length === 0;
  return <div className="rounded-2xl border-2 border-teal-600 bg-teal-50 p-3 dark:bg-teal-950/30 md:p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-700 text-white"><PencilRuler size={18} /></span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm font-black text-teal-900 dark:text-teal-100">
            {readOnly ? 'Xem điều chỉnh' : 'Bản nháp điều chỉnh'} {code && <span className="font-mono">{code}</span>}
            <span className={pill(TONE.amber)}>Chưa áp dụng</span>
          </div>
          <div className="mt-0.5 text-[11px] text-teal-800/80 dark:text-teal-200/80">
            {readOnly ? 'Thanh mờ là kế hoạch đang áp dụng.'
              : <>Kéo thanh hoặc sửa ngày, khối lượng, thêm / xóa việc. Kế hoạch đang áp dụng không đổi cho tới khi được duyệt.{' '}
                {saveError ? <span className="font-semibold text-rose-600">{saveError}</span>
                  : saving ? <span className="inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Đang lưu…</span>
                  : savedAt ? `Đã lưu ${savedAt}.` : ''}</>}
          </div>
        </div>
      </div>
      <div className="flex w-full gap-2 md:w-auto">
        {readOnly ? <button type="button" onClick={onClose} className={`${secondaryBtn} flex-1 text-xs md:flex-none`}><X size={14} /> Đóng</button> : <>
          <button type="button" onClick={onCancel} className={`${secondaryBtn} flex-1 text-xs md:flex-none`}><Trash2 size={14} /> Bỏ nháp</button>
          <button type="button" onClick={onSubmit} disabled={empty || saving} title={empty ? 'Chưa có thay đổi ngày, khối lượng hay việc thêm / xóa' : undefined}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50 md:flex-none"><Send size={14} /> Gửi duyệt</button>
        </>}
      </div>
    </div>
    <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto text-xs">
      <span className="shrink-0 rounded-full border border-border bg-card px-3 py-1"><b className="tabular-nums">{summary.moved}</b> việc dời ngày</span>
      <span className="shrink-0 rounded-full border border-border bg-card px-3 py-1"><b className="tabular-nums">{summary.added}</b> thêm · <b className="tabular-nums">{summary.deleted}</b> xóa</span>
      <span className="shrink-0 rounded-full border border-border bg-card px-3 py-1"><b className="tabular-nums">{summary.qtyChanged}</b> đổi khối lượng</span>
      {summary.finishDelta !== 0
        ? <span className="shrink-0 rounded-full bg-rose-600 px-3 py-1 font-bold text-white">Về đích {sd(summary.finishBefore)} → {sd(summary.finishAfter)} ({summary.finishDelta > 0 ? '+' : ''}{summary.finishDelta} ngày) · {approverHint}</span>
        : <span className="shrink-0 rounded-full border border-border bg-card px-3 py-1">Về đích giữ {sd(summary.finishBefore)} · {approverHint}</span>}
      {!readOnly && overdueLeft > 0 && <span className="shrink-0 rounded-full border border-rose-200 bg-card px-3 py-1 text-rose-700">Còn <b className="tabular-nums">{overdueLeft}</b> việc quá hạn chưa lập lại</span>}
    </div>
  </div>;
};

const LineRow: React.FC<{ row: ScheduleDiffRow; reasonText?: string | null }> = ({ row, reasonText }) => {
  const kept = row.action === 'update' && row.beforeStart === row.afterStart && row.progress > 0 && row.beforeEnd !== row.afterEnd;
  return <div className="flex items-start gap-2 border-t border-border px-3 py-2 text-xs">
    <span className="w-12 shrink-0 pt-0.5 font-mono text-[11px] text-teal-700 dark:text-teal-300">{row.wbsCode || '—'}</span>
    <div className="min-w-0 flex-1">
      <div className="truncate font-medium text-foreground" title={row.name}>{row.name}</div>
      <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
        {row.action === 'add' && <span className="font-semibold text-sky-700 dark:text-sky-300">Thêm mới · {sd(row.afterStart)}–{sd(row.afterEnd)} · {num(row.afterQty)} {row.unit || ''}</span>}
        {row.action === 'delete' && <span className="font-semibold text-rose-600">Xóa · {sd(row.beforeStart)}–{sd(row.beforeEnd)}</span>}
        {row.action === 'update' && (row.beforeStart !== row.afterStart || row.beforeEnd !== row.afterEnd) &&
          <span><s>{sd(row.beforeStart)}–{sd(row.beforeEnd)}</s> → <b className="text-foreground">{sd(row.afterStart)}–{sd(row.afterEnd)}</b></span>}
        {row.action === 'update' && row.beforeQty !== row.afterQty &&
          <span>KL <s>{num(row.beforeQty)}</s> → <b className="text-foreground">{num(row.afterQty)}</b> {row.unit || ''}</span>}
        {kept && <span className="text-sky-700 dark:text-sky-300">giữ ngày bắt đầu (đã làm {row.progress}%)</span>}
        {reasonText && <span>· {reasonText}</span>}
      </div>
    </div>
    <div className="shrink-0 text-right">
      {row.deltaDays != null && row.deltaDays !== 0 && <div className={`font-bold tabular-nums ${row.deltaDays > 0 ? 'text-rose-600' : 'text-leaf-700'}`}>{row.deltaDays > 0 ? '+' : ''}{row.deltaDays} ngày</div>}
      {row.setsFinish && <span className={`mt-0.5 ${pill(TONE.rose)}`}>Quyết định về đích</span>}
    </div>
  </div>;
};

/** Danh sách thay đổi nhóm theo hạng mục cha. */
export const ChangeList: React.FC<{ rows: ScheduleDiffRow[]; groupName: (parentId: string | null) => string; reasonOf?: (row: ScheduleDiffRow) => string | null }> =
  ({ rows, groupName, reasonOf }) => {
    const groups = useMemo(() => {
      const map = new Map<string, ScheduleDiffRow[]>();
      for (const row of rows.filter(item => item.isLeaf || item.action !== 'update')) {
        const key = row.parentId || '';
        map.set(key, [...(map.get(key) || []), row]);
      }
      return [...map.entries()];
    }, [rows]);
    if (groups.length === 0) return <div className="rounded-xl border border-dashed border-border bg-card p-4 text-center text-xs text-muted-foreground">Chưa có thay đổi. Kéo thanh trên Gantt hoặc sửa ngày, khối lượng của việc.</div>;
    return <div className="space-y-2">{groups.map(([parentId, items]) => <div key={parentId || 'root'} className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-l-4 border-teal-600 bg-muted/50 px-3 py-2 text-xs">
        <span className="truncate font-bold text-foreground">{groupName(parentId || null)}</span><span className="shrink-0 text-muted-foreground">{items.length} việc</span>
      </div>
      {items.map(row => <LineRow key={row.taskId} row={row} reasonText={reasonOf?.(row)} />)}
    </div>)}</div>;
  };

export const DraftRulesNote: React.FC = () => <div className="space-y-1 rounded-xl border border-dashed border-border bg-card p-3 text-[11px] text-muted-foreground">
  <div className="flex items-center gap-1 font-bold text-foreground"><Info size={12} className="text-sky-600" /> Không cần duyệt — lưu ngay</div>
  <div>Đổi tên việc, người phụ trách, ghi chú (sửa ngoài bản nháp).</div>
  <div className="flex items-center gap-1 pt-1 font-bold text-foreground"><ShieldCheck size={12} className="text-amber-600" /> Phải duyệt — vào phiếu này</div>
  <div>Đổi ngày, khối lượng, thêm hoặc xóa việc, nhập Excel, áp dự báo trễ.</div>
</div>;

// ---------------------------------------------------------------------------- tóm tắt
const SummaryKpis: React.FC<{ summary: Pick<ScheduleDiffSummary, 'moved' | 'added' | 'deleted' | 'qtyChanged' | 'finishBefore' | 'finishAfter' | 'finishDelta'> }> = ({ summary }) =>
  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
    {[
      ['Dời ngày', String(summary.moved), 'việc', false],
      ['Thêm / xóa', `${summary.added} / ${summary.deleted}`, 'việc', false],
      ['Đổi khối lượng', String(summary.qtyChanged), 'việc', false],
      ['Về đích', summary.finishDelta === 0 ? 'Giữ' : `${summary.finishDelta > 0 ? '+' : ''}${summary.finishDelta}`, `${sd(summary.finishBefore)} → ${sd(summary.finishAfter)}`, summary.finishDelta !== 0],
    ].map(([label, value, hint, hot]) => <div key={String(label)} className={`rounded-xl border px-3 py-2 ${hot ? 'border-rose-200 bg-rose-50 dark:bg-rose-950/30' : 'border-border bg-card'}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-lg font-black tabular-nums ${hot ? 'text-rose-600' : 'text-foreground'}`}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{hint}</div>
    </div>)}
  </div>;

export const summaryFromChange = (change: ScheduleChange) => {
  const leaf = change.lines.filter(line => line.isLeaf);
  return {
    moved: leaf.filter(line => line.action === 'update' && (line.beforeStart !== line.afterStart || line.beforeEnd !== line.afterEnd)).length,
    added: leaf.filter(line => line.action === 'add').length,
    deleted: change.lines.filter(line => line.action === 'delete').length,
    qtyChanged: leaf.filter(line => line.action === 'update' && Number(line.beforeQty ?? 0) !== Number(line.afterQty ?? 0)).length,
    finishBefore: change.finishBefore, finishAfter: change.finishAfter,
    finishDelta: change.finishBefore && change.finishAfter ? Math.round((Date.parse(change.finishAfter) - Date.parse(change.finishBefore)) / 86_400_000) : 0,
  };
};

export const rowsFromChange = (change: ScheduleChange): ScheduleDiffRow[] => change.lines.map(line => ({
  taskId: line.taskId, action: line.action, wbsCode: line.wbsCode, name: line.taskName, parentId: line.parentId, isLeaf: line.isLeaf,
  beforeStart: line.beforeStart, beforeEnd: line.beforeEnd, beforeQty: line.beforeQty == null ? null : Number(line.beforeQty),
  afterStart: line.afterStart, afterEnd: line.afterEnd, afterQty: line.afterQty == null ? null : Number(line.afterQty),
  deltaDays: line.deltaDays, unit: line.payload?.unit || null, progress: 0,
  setsFinish: !!change.finishAfter && change.finishAfter !== change.finishBefore && line.afterEnd === change.finishAfter,
}));

const Attachments: React.FC<{ files: ScheduleAttachment[]; onRemove?: (path: string) => void }> = ({ files, onRemove }) => {
  const toast = useToast();
  if (files.length === 0) return null;
  return <div className="flex flex-wrap gap-1.5">{files.map(file => <span key={file.path} className="inline-flex max-w-full items-center gap-1 rounded-lg border border-border bg-background px-2 py-1 text-xs">
    <button type="button" onClick={() => scheduleChangeService.openAttachment(file.path).catch(error => toast.error('Không mở được tệp', error instanceof Error ? error.message : ''))}
      className="inline-flex min-w-0 items-center gap-1 hover:underline"><FileText size={12} className="shrink-0 text-muted-foreground" /><span className="truncate">{file.name}</span></button>
    {onRemove && <button type="button" aria-label={`Bỏ ${file.name}`} onClick={() => onRemove(file.path)} className="text-muted-foreground hover:text-rose-600">×</button>}
  </span>)}</div>;
};

// ---------------------------------------------------------------------------- gửi duyệt
export const SubmitDrawer: React.FC<{
  code: string | null; summary: ScheduleDiffSummary; reasons: ScheduleReason[]; header: ScheduleDraftHeader; lineMeta: LineMeta;
  contractFinishDate: string | null; approverText: string; scope: { projectId: string; constructionSiteId?: string | null };
  groupName: (parentId: string | null) => string; busy: boolean;
  onHeader: (header: ScheduleDraftHeader) => void; onLineMeta: (meta: LineMeta) => void; onClose: () => void; onSubmit: () => void;
}> = ({ code, summary, reasons, header, lineMeta, contractFinishDate, approverText, scope, groupName, busy, onHeader, onLineMeta, onClose, onSubmit }) => {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const mainReason = reasons.find(reason => reason.code === header.reasonCode);
  const leafRows = summary.rows.filter(row => row.isLeaf || row.action !== 'update');
  const effectiveParty = (row: ScheduleDiffRow) => lineMeta[row.taskId]?.responsibleParty || header.responsibleParty;
  const effectiveReason = (row: ScheduleDiffRow) => lineMeta[row.taskId]?.reasonCode || header.reasonCode;
  const needsDocument = header.isContractExtension || header.responsibleParty === 'owner' || !!mainReason?.needsDocument
    || leafRows.some(row => effectiveParty(row) === 'owner' || reasons.find(reason => reason.code === effectiveReason(row))?.needsDocument);
  const overridden = leafRows.filter(row => lineMeta[row.taskId]?.reasonCode || lineMeta[row.taskId]?.responsibleParty).length;
  const extensionAllowed = header.responsibleParty === 'owner' && header.attachments.length > 0 && !!summary.finishAfter
    && (!contractFinishDate || summary.finishAfter > contractFinishDate);
  const missing = !header.reasonCode ? 'Chọn lý do chính' : !header.responsibleParty ? 'Chọn bên chịu trách nhiệm'
    : header.summary.trim().length < 10 ? 'Ghi diễn giải ít nhất 10 ký tự' : needsDocument && header.attachments.length === 0 ? 'Cần đính kèm chứng từ' : null;

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const added = await scheduleChangeService.uploadAttachments({ ...scope, files: [...files] });
      onHeader({ ...header, attachments: [...header.attachments, ...added] });
    } catch (error) {
      toast.error('Không tải được tệp', error instanceof Error ? error.message : '');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return <Drawer label="Gửi duyệt điều chỉnh tiến độ" onClose={onClose}
    header={<><div className="text-base font-black text-foreground">Gửi duyệt điều chỉnh tiến độ</div><div className="text-xs text-muted-foreground">{code ? <span className="font-mono text-teal-700 dark:text-teal-300">{code}</span> : 'Phiếu mới'}</div></>}
    footer={<>
      <button type="button" onClick={onClose} className={`${secondaryBtn} flex-1 md:flex-none`}>Quay lại sửa</button>
      <button type="button" onClick={onSubmit} disabled={!!missing || busy || uploading} title={missing || undefined} className={`${primaryBtn} flex-1 md:flex-none`}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Gửi duyệt
      </button>
    </>}>
    <SummaryKpis summary={summary} />
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold text-foreground">Lý do chính <span className="text-rose-600">*</span></span>
      <select value={header.reasonCode || ''} onChange={event => {
        const reason = reasons.find(item => item.code === event.target.value);
        onHeader({ ...header, reasonCode: reason?.code || null, responsibleParty: reason ? reason.defaultParty : header.responsibleParty });
      }} className={`${inputCls} w-full`}>
        <option value="">— Chọn lý do —</option>
        {reasons.map(reason => <option key={reason.code} value={reason.code}>{reason.label}</option>)}
      </select>
      <span className="mt-1 block text-[11px] text-muted-foreground">Áp cho mọi dòng. Dòng nào khác lý do thì đổi ở danh sách bên dưới.</span>
    </label>
    <div>
      <span className="mb-1.5 block text-xs font-bold text-foreground">Bên chịu trách nhiệm <span className="text-rose-600">*</span></span>
      <div className="grid grid-cols-3 gap-1 rounded-xl border border-border bg-muted/40 p-1 text-center text-xs font-semibold">
        {SCHEDULE_PARTIES.map(party => <button key={party} type="button" onClick={() => onHeader({ ...header, responsibleParty: party, isContractExtension: party === 'owner' && header.isContractExtension })}
          className={`rounded-lg py-2 ${header.responsibleParty === party ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:bg-card'}`}>{SCHEDULE_PARTY_LABELS[party]}</button>)}
      </div>
      <span className="mt-1 block text-[11px] text-muted-foreground">Tự chọn theo lý do, người lập đổi được. Chậm do vật tư / NCC tính cho Công ty.</span>
    </div>
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold text-foreground">Diễn giải <span className="text-rose-600">*</span></span>
      <textarea rows={3} value={header.summary} onChange={event => onHeader({ ...header, summary: event.target.value })}
        placeholder="Vì sao phải đổi, đổi những phần nào" className={`${inputCls} w-full`} />
    </label>
    <div>
      <span className="mb-1.5 block text-xs font-bold text-foreground">Chứng từ đính kèm {needsDocument && <span className="text-rose-600">*</span>}</span>
      <div className="space-y-2 rounded-xl border border-dashed border-border p-3">
        <Attachments files={header.attachments} onRemove={path => onHeader({ ...header, attachments: header.attachments.filter(file => file.path !== path) })} />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className={`${secondaryBtn} text-xs`}>
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />} Thêm tệp
        </button>
        <input ref={fileRef} type="file" multiple className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx" onChange={event => upload(event.target.files)} />
      </div>
      <span className="mt-1 block text-[11px] text-muted-foreground">Bắt buộc khi bên chịu trách nhiệm là CĐT hoặc lý do cần văn bản (thay đổi thiết kế, phát sinh, CĐT chậm duyệt).</span>
    </div>
    <details className="rounded-xl border border-border" open={overridden > 0}>
      <summary className="cursor-pointer px-3 py-2 text-xs font-bold text-foreground">Lý do theo từng dòng ({leafRows.length}){overridden > 0 ? ` · ${overridden} dòng khác lý do chính` : ''}</summary>
      <div className="max-h-[420px] space-y-1 overflow-y-auto bg-muted/30 p-2">
        {leafRows.map(row => <div key={row.taskId} className="rounded-lg border border-border bg-card p-2 text-xs">
          <div className="flex items-center gap-2"><span className="font-mono text-[11px] text-teal-700 dark:text-teal-300">{row.wbsCode || '—'}</span><span className="min-w-0 flex-1 truncate">{row.name}</span>
            {row.deltaDays != null && row.deltaDays !== 0 && <span className={`shrink-0 font-bold tabular-nums ${row.deltaDays > 0 ? 'text-rose-600' : 'text-leaf-700'}`}>{row.deltaDays > 0 ? '+' : ''}{row.deltaDays}</span>}</div>
          <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-[1fr_140px]">
            <select value={lineMeta[row.taskId]?.reasonCode || ''} onChange={event => onLineMeta({ ...lineMeta, [row.taskId]: { ...lineMeta[row.taskId], reasonCode: event.target.value || null } })} className={`${inputCls} text-xs`}>
              <option value="">Theo lý do chính{mainReason ? ` (${mainReason.label})` : ''}</option>
              {reasons.map(reason => <option key={reason.code} value={reason.code}>{reason.label}</option>)}
            </select>
            <select value={lineMeta[row.taskId]?.responsibleParty || ''} onChange={event => onLineMeta({ ...lineMeta, [row.taskId]: { ...lineMeta[row.taskId], responsibleParty: (event.target.value || null) as ScheduleParty | null } })} className={`${inputCls} text-xs`}>
              <option value="">Theo bên chính</option>
              {SCHEDULE_PARTIES.map(party => <option key={party} value={party}>{SCHEDULE_PARTY_LABELS[party]}</option>)}
            </select>
          </div>
        </div>)}
        {leafRows.length === 0 && <div className="p-2 text-xs text-muted-foreground">Chưa có dòng nào.</div>}
      </div>
    </details>
    <label className={`flex items-start gap-2 rounded-xl border p-3 text-xs ${extensionAllowed ? 'border-border bg-card' : 'border-border bg-muted/40 text-muted-foreground'}`}>
      <input type="checkbox" className="mt-0.5" disabled={!extensionAllowed && !header.isContractExtension} checked={header.isContractExtension}
        onChange={event => onHeader({ ...header, isContractExtension: event.target.checked })} />
      <span><b className="text-foreground">CĐT đã chấp thuận gia hạn hợp đồng</b> — duyệt xong sẽ cập nhật hạn hợp đồng ({viDate(contractFinishDate)}) thành ngày về đích mới.<br />
        Chỉ chọn được khi bên chịu trách nhiệm là CĐT, có văn bản chấp thuận và ngày về đích mới sau hạn hợp đồng.</span>
    </label>
    <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs dark:bg-amber-950/30">
      <UserCheck size={16} className="shrink-0 text-amber-600" />
      <div className="text-amber-900 dark:text-amber-100">{approverText}</div>
    </div>
  </Drawer>;
};

// ---------------------------------------------------------------------------- xem / duyệt
export const ReviewDrawer: React.FC<{
  change: ScheduleChange; reasons: ScheduleReason[]; canDecide: boolean; busy: boolean; groupName: (parentId: string | null) => string;
  onClose: () => void; onApprove: () => void; onReturn: () => void; onShowOnGantt: () => void;
}> = ({ change, reasons, canDecide, busy, groupName, onClose, onApprove, onReturn, onShowOnGantt }) => {
  const summary = summaryFromChange(change);
  const rows = rowsFromChange(change);
  const partyCounts = rows.filter(row => row.isLeaf || row.action !== 'update').reduce<Record<string, number>>((acc, row) => {
    const line = change.lines.find(item => item.taskId === row.taskId);
    const party = line?.responsibleParty || change.responsibleParty;
    if (party && party !== change.responsibleParty) acc[party] = (acc[party] || 0) + 1;
    return acc;
  }, {});
  const statusText = change.status === 'submitted' ? (change.step === 'confirm' ? 'Chờ duyệt dời về đích' : 'Chờ duyệt')
    : change.status === 'draft' ? 'Nháp' : change.status === 'returned' ? 'Bị trả lại' : change.status === 'approved' ? 'Đã duyệt' : 'Đã bỏ';
  return <Drawer label={`Điều chỉnh tiến độ ${change.code}`} wide onClose={onClose}
    header={<>
      <div className="flex flex-wrap items-center gap-2"><span className="text-base font-black text-foreground">Điều chỉnh tiến độ</span><span className="font-mono text-sm text-teal-700 dark:text-teal-300">{change.code}</span><span className={pill(change.status === 'submitted' ? TONE.amber : TONE.zinc)}>{statusText}</span></div>
      <div className="text-xs text-muted-foreground">Lập: <span className={ENT}>{change.createdByName}</span>{change.submittedAt ? ` · gửi ${new Date(change.submittedAt).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}` : ''}{change.approvedByName ? ` · CHT duyệt: ${change.approvedByName}` : ''}</div>
    </>}
    footer={canDecide ? <>
      <button type="button" onClick={onReturn} disabled={busy} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50 md:flex-none"><Undo2 size={14} /> Trả lại</button>
      <button type="button" onClick={onApprove} disabled={busy} className={`${primaryBtn} flex-1 md:flex-none`}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Duyệt{change.step === 'confirm' ? ' dời về đích' : ''}</button>
    </> : <button type="button" onClick={onClose} className={secondaryBtn}>Đóng</button>}>
    <SummaryKpis summary={summary} />
    <div className="space-y-1.5 rounded-xl border border-border p-3 text-xs">
      <div className="flex gap-2"><span className="w-28 shrink-0 text-muted-foreground">Lý do chính</span><b>{reasonLabelOf(reasons, change.reasonCode)}</b></div>
      <div className="flex flex-wrap gap-2"><span className="w-28 shrink-0 text-muted-foreground">Chịu trách nhiệm</span>
        <span className={pill(TONE.zinc)}>{change.responsibleParty ? SCHEDULE_PARTY_LABELS[change.responsibleParty] : '—'}</span>
        {Object.entries(partyCounts).map(([party, count]) => <span key={party} className="text-muted-foreground">· {count} dòng {SCHEDULE_PARTY_LABELS[party as ScheduleParty]}</span>)}</div>
      <div className="flex gap-2"><span className="w-28 shrink-0 text-muted-foreground">Diễn giải</span><span className="whitespace-pre-wrap">{change.summary || '—'}</span></div>
      <div className="flex gap-2"><span className="w-28 shrink-0 text-muted-foreground">Chứng từ</span>{change.attachments.length ? <Attachments files={change.attachments} /> : <span>—</span>}</div>
      <div className="flex gap-2"><span className="w-28 shrink-0 text-muted-foreground">Gia hạn HĐ</span><span>{change.isContractExtension ? `Có — hạn hợp đồng đổi thành ${viDate(change.finishAfter)}` : 'Không'}</span></div>
      {change.returnReason && <div className="flex gap-2 text-rose-700"><span className="w-28 shrink-0">Lần trả lại</span><span>{change.returnReason}</span></div>}
    </div>
    <button type="button" onClick={onShowOnGantt} className={`${secondaryBtn} w-full text-xs`}><CalendarRange size={14} /> Xem trên Gantt (thanh mờ = kế hoạch đang áp dụng)</button>
    <div>
      <div className="mb-1.5 text-xs font-bold text-foreground">Danh sách thay đổi</div>
      <ChangeList rows={rows} groupName={groupName} reasonOf={row => {
        const line = change.lines.find(item => item.taskId === row.taskId);
        const code = line?.reasonCode || change.reasonCode;
        const party = line?.responsibleParty || change.responsibleParty;
        return `${reasonLabelOf(reasons, code)}${party ? ` · ${SCHEDULE_PARTY_LABELS[party]}` : ''}`;
      }} />
    </div>
    {canDecide && <div className="flex gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900 dark:bg-sky-950/30 dark:text-sky-100">
      <CalendarClock size={16} className="shrink-0 text-sky-600" />
      <span>Sau khi duyệt: lưu thành phiên bản mới, Gantt đổi theo. KH tháng / tuần còn hiệu lực bị lệch sẽ được báo cho người lập KH.</span>
    </div>}
  </Drawer>;
};

// ---------------------------------------------------------------------------- phiên bản
export const VersionsDrawer: React.FC<{
  baselines: ProjectBaseline[]; control: ScheduleControl; reasons: ScheduleReason[]; compareId: string | null;
  onCompare: (baseline: ProjectBaseline | null) => void; onClose: () => void;
}> = ({ baselines, control, reasons, compareId, onCompare, onClose }) => {
  const versions = baselines.filter(item => item.versionKind && item.versionKind !== 'legacy').sort((a, b) => (b.versionNo ?? 0) - (a.versionNo ?? 0));
  const legacy = baselines.filter(item => !item.versionKind || item.versionKind === 'legacy');
  const changeOf = (id: string | null | undefined) => control.recentChanges?.find(item => item.id === id);
  return <Drawer label="Phiên bản tiến độ" onClose={onClose}
    header={<><div className="text-base font-black text-foreground">Phiên bản tiến độ</div><div className="text-xs text-muted-foreground">Mỗi lần duyệt tự lưu một phiên bản · không ai sửa đè được</div></>}>
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground">Thanh mờ trên Gantt so với</span>
      <select value={compareId || ''} onChange={event => onCompare(baselines.find(item => item.id === event.target.value) || null)} className={`${inputCls} text-xs`}>
        <option value="">Không so sánh</option>
        {versions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        {legacy.length > 0 && <optgroup label="Bản chụp tay trước đây">{legacy.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>}
      </select>
    </div>
    <ol className="relative ml-3 space-y-4 border-l-2 border-border">
      {versions.map((item, index) => {
        const change = changeOf(item.scheduleChangeId);
        return <li key={item.id} className="ml-4">
          <span className={`absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full ${index === 0 ? 'bg-teal-600' : 'bg-zinc-400'}`} />
          <div className="rounded-xl border border-border bg-card p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2"><b className="text-sm text-foreground">{item.versionKind === 'original' ? 'Bản gốc' : `Phiên bản ${item.versionNo}`}</b>
              {index === 0 ? <span className={pill('bg-teal-700 text-white')}>Đang áp dụng</span> : <span className={pill(TONE.zinc)}>Khóa</span>}
              {item.isContract && <span className={pill(TONE.rose)}>Gia hạn HĐ</span>}</div>
            <div className="mt-1 text-muted-foreground">{item.versionKind === 'original' ? 'Chụp bảng tiến độ khi bật điều chỉnh có duyệt' : change
              ? <><span className="font-mono text-teal-700 dark:text-teal-300">{change.code}</span> · lập {change.createdByName} · {reasonLabelOf(reasons, change.reasonCode)}{change.responsibleParty ? ` · ${SCHEDULE_PARTY_LABELS[change.responsibleParty]}` : ''}</> : item.name}</div>
            <div className="mt-0.5 text-muted-foreground">Về đích {viDate(item.finishDate)} · lưu {new Date(item.lockedAt).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}
              {change && change.finishBefore !== change.finishAfter && change.finishBefore && change.finishAfter && <> · <b className="text-rose-600">{Math.round((Date.parse(change.finishAfter) - Date.parse(change.finishBefore)) / 86_400_000) > 0 ? '+' : ''}{Math.round((Date.parse(change.finishAfter) - Date.parse(change.finishBefore)) / 86_400_000)} ngày</b></>}</div>
            <button type="button" onClick={() => onCompare(item)} className="mt-2 text-[11px] font-semibold text-teal-700 hover:underline dark:text-teal-300"><History size={11} className="mr-1 inline" />So Gantt với bản này</button>
          </div>
        </li>;
      })}
      <li className="ml-4">
        <span className="absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full bg-zinc-400" />
        <div className="rounded-xl border border-border bg-card p-3 text-xs">
          <div className="flex items-center gap-2"><b className="text-sm text-foreground">Hạn hợp đồng</b><span className={pill(TONE.zinc)}>Khóa</span></div>
          <div className="mt-1 text-muted-foreground">{viDate(control.contractFinishDate)} · chỉ đổi khi phiếu "CĐT chấp thuận gia hạn" được duyệt.</div>
        </div>
      </li>
    </ol>
    {legacy.length > 0 && <div className="text-[11px] text-muted-foreground">{legacy.length} bản chụp tay trước đây vẫn giữ để xem lại (chọn ở ô so sánh).</div>}
  </Drawer>;
};

// ---------------------------------------------------------------------------- KH tháng / tuần lệch
export const ReviewPlansAlert: React.FC<{ control: ScheduleControl; onOpen: () => void }> = ({ control, onOpen }) => {
  const plans = control.reviewPlans || [];
  if (plans.length === 0) return null;
  return <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs dark:bg-amber-950/30">
    <div className="flex items-start gap-2">
      <TriangleAlert size={16} className="mt-0.5 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1">
        <div className="font-bold text-amber-900 dark:text-amber-100">Kế hoạch tháng / tuần lệch với tiến độ mới</div>
        <div className="mt-2 space-y-1.5">{plans.map(plan => <div key={plan.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2">
          {plan.code && <span className="font-mono text-teal-700 dark:text-teal-300">{plan.code}</span>}
          <span>{plan.periodType === 'month' ? `KH tháng ${plan.periodStart.slice(5, 7)}/${plan.periodStart.slice(0, 4)}` : `KH tuần ${sd(plan.periodStart)}–${sd(plan.periodEnd)}`}</span>
          <span className="text-amber-800 dark:text-amber-200">{plan.reason}</span>
        </div>)}</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" onClick={onOpen} className={`${primaryBtn} text-xs`}>Mở Kế hoạch tháng/tuần</button>
          <span className="text-[11px] text-amber-800/80 dark:text-amber-200/70">Lập bản điều chỉnh theo gợi ý hoặc giữ nguyên kèm lý do.</span>
        </div>
      </div>
    </div>
  </div>;
};

export const ApprovedNotice: React.FC<{ text: string; onClose: () => void }> = ({ text, onClose }) =>
  <div className="flex items-center gap-2 rounded-xl border border-leaf-200 bg-leaf-50 px-3 py-2 text-xs text-leaf-800 dark:bg-leaf-950/30 dark:text-leaf-200">
    <CircleCheck size={16} className="shrink-0" /><span className="flex-1">{text}</span>
    <button type="button" aria-label="Đóng" onClick={onClose} className="text-leaf-700"><X size={14} /></button>
  </div>;
