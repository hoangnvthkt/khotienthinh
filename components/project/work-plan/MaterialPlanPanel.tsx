import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, Package, RotateCcw, Save, Send, ShieldCheck, Trash2, Undo2 } from 'lucide-react';
import { useToast } from '../../../context/ToastContext';
import { useConfirm, useReasonConfirm } from '../../../context/ConfirmContext';
import {
  isOverBoq, MATERIAL_PLAN_GAP_LABELS, materialBoqUsage, projectMaterialPlanService,
  type MaterialPlan, type MaterialPlanBoard, type MaterialPlanLine,
} from '../../../lib/projectMaterialPlanService';
import { formatWorkPlanPeriod, type WorkPlanPeriodType } from '../../../lib/projectWorkPlanService';
import { AccordionToolbar, fmt, GroupHeader, parseQty, qtyInput, StatusChip, useGroupAccordion } from './workPlanUi';

type DraftLine = { requestedQty: string; neededDate: string; overReason: string; note: string };

const groupByCategory = (lines: MaterialPlanLine[]) => {
  const map = new Map<string, MaterialPlanLine[]>();
  lines.forEach(line => { const key = line.category || 'Chưa phân nhóm'; map.set(key, [...(map.get(key) || []), line]); });
  return Array.from(map.entries());
};

const usageTone = (usage: number | null, over = false) => usage == null ? 'bg-slate-300'
  : over ? 'bg-rose-500' : usage >= 80 ? 'bg-amber-500' : 'bg-emerald-500';

const BoqBar: React.FC<{ line: MaterialPlanLine; requested: number }> = ({ line, requested }) => {
  const usage = materialBoqUsage(line, requested);
  const over = isOverBoq(line, requested);
  if (usage == null) return <span className="text-xs text-muted-foreground">{line.boqQty == null ? 'Không có trong BOQ' : 'Chưa rõ đã cấp'}</span>;
  return <span className="block">
    <span className="flex items-center gap-2"><span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"><span className={`block h-full ${usageTone(usage, over)}`} style={{ width: `${Math.min(usage, 100)}%` }} /></span>
      <span className={`text-xs font-semibold tabular-nums ${over ? 'text-rose-700 dark:text-rose-300' : usage >= 80 ? 'text-amber-700 dark:text-amber-300' : 'text-foreground'}`}>{fmt(usage, 0)}%</span></span>
    <span className="mt-0.5 block text-[11px] text-muted-foreground">Đã cấp {fmt(line.issuedQty)} / BOQ {fmt(line.boqQty)}</span>
  </span>;
};

const StockCell: React.FC<{ line: MaterialPlanLine }> = ({ line }) => {
  if (!line.stockKnown || line.stockQty == null) return <span className="text-xs text-muted-foreground">Chưa rõ tồn</span>;
  if (line.stockQty < 0) return <span className="text-xs font-semibold text-rose-600" title="Tồn kho âm — cần kiểm tra phiếu nhập/xuất">Tồn âm {fmt(line.stockQty)}</span>;
  return <span className="tabular-nums">{fmt(line.stockQty)}</span>;
};

const COLS = 'md:grid-cols-[52px_minmax(0,2.2fr)_56px_100px_90px_150px_120px_28px]';

const MaterialTable: React.FC<{
  plan: MaterialPlan; editable: boolean; drafts: Record<string, DraftLine>; disabled: boolean;
  onChange: (id: string, patch: Partial<DraftLine>) => void;
}> = ({ plan, editable, drafts, disabled, onChange }) => {
  const groups = useMemo(() => groupByCategory(plan.lines), [plan.lines]);
  const accordion = useGroupAccordion(groups.map(([g]) => g));
  const [openSources, setOpenSources] = useState<Set<string>>(new Set());
  const requestedOf = (line: MaterialPlanLine) => {
    if (!editable) return line.requestedQty;
    const q = parseQty(drafts[line.id]?.requestedQty ?? '');
    return q == null || Number.isNaN(q) ? 0 : q;
  };
  return <div className="space-y-2">
    <AccordionToolbar count={groups.length} allOpen={accordion.allOpen} onExpand={accordion.expandAll} onCollapse={accordion.collapseAll} />
    <div className="overflow-hidden rounded-xl border border-border">
      <div className={`hidden gap-3 bg-slate-100 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300 md:grid ${COLS}`}>
        <span>Chỉ mục</span><span>Vật tư</span><span>ĐVT</span><span className="text-right">Nhu cầu theo KH</span><span className="text-right">Tồn kho CT</span>
        <span>Đã cấp + đề nghị / BOQ</span><span className="text-right">SL đề nghị</span><span />
      </div>
      {groups.map(([group, lines], gi) => {
        const over = lines.filter(l => isOverBoq(l, requestedOf(l))).length;
        const near = lines.filter(l => { const u = materialBoqUsage(l, requestedOf(l)); return u != null && u >= 80 && !isOverBoq(l, requestedOf(l)); }).length;
        const tone = over ? 'bg-rose-50 border-l-rose-500 text-rose-950 dark:bg-rose-950/40 dark:text-rose-100'
          : near ? 'bg-amber-50 border-l-amber-500 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100'
            : 'bg-teal-50 border-l-teal-600 text-teal-950 dark:bg-teal-950/40 dark:border-l-teal-500 dark:text-teal-100';
        return <div key={group}>
          <GroupHeader index={gi + 1} name={group} open={accordion.isOpen(group)} onToggle={() => accordion.toggle(group)} count={lines.length} tone={tone}>
            {over > 0 && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:bg-rose-950/60 dark:text-rose-200">{over} vượt BOQ</span>}
            {near > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">{near} gần hết BOQ</span>}
          </GroupHeader>
          {accordion.isOpen(group) && lines.map((line, li) => {
            const draft = drafts[line.id];
            const requested = requestedOf(line);
            const usage = materialBoqUsage(line, requested);
            const isOver = isOverBoq(line, requested);
            const qty = editable ? parseQty(draft?.requestedQty ?? '') : line.requestedQty;
            const invalid = editable && (qty == null || Number.isNaN(qty) || qty < 0);
            const sourcesOpen = openSources.has(line.id);
            return <div key={line.id} className={`border-t border-border ${isOver ? 'bg-rose-50/60 dark:bg-rose-950/20' : usage != null && usage >= 80 ? 'bg-amber-50/40 dark:bg-amber-950/10' : ''}`}>
              <div className={`relative grid grid-cols-2 gap-x-3 gap-y-2 px-3 py-2.5 text-sm md:items-center ${COLS}`}>
                <span className="hidden text-xs tabular-nums text-muted-foreground md:block">{gi + 1}.{li + 1}</span>
                <span className="col-span-2 min-w-0 pr-8 md:col-span-1 md:pr-0">{line.sku && <span className="mr-1.5 text-xs text-muted-foreground">{line.sku}</span>}<span className="font-medium">{line.itemName}</span></span>
                <span className="text-muted-foreground"><span className="md:hidden">ĐVT: </span>{line.unit}</span>
                <span className="text-right tabular-nums"><span className="float-left text-xs text-muted-foreground md:hidden">Nhu cầu</span>{fmt(line.needQty)}</span>
                <span className="text-right"><span className="float-left text-xs text-muted-foreground md:hidden">Tồn kho</span><StockCell line={line} /></span>
                <span className="col-span-2 md:col-span-1"><BoqBar line={line} requested={requested} /></span>
                {editable ? <label className="col-span-2 block md:col-span-1"><span className="mb-1 block text-xs text-muted-foreground md:hidden">SL đề nghị</span>
                  <input inputMode="decimal" value={draft?.requestedQty ?? ''} disabled={disabled} aria-invalid={invalid} aria-label={`SL đề nghị ${line.itemName}`}
                    onChange={event => onChange(line.id, { requestedQty: event.target.value })}
                    className={`w-full rounded-lg border bg-background px-2.5 py-1.5 text-right text-sm font-semibold tabular-nums outline-none focus:border-teal-600 ${invalid ? 'border-rose-500' : 'border-border'}`} />
                </label> : <span className="text-right text-sm font-semibold tabular-nums"><span className="float-left text-xs font-normal text-muted-foreground md:hidden">Đề nghị</span>{fmt(line.requestedQty)}</span>}
                <button type="button" aria-expanded={sourcesOpen} aria-label={`Xem công việc cần ${line.itemName}`}
                  onClick={() => setOpenSources(current => { const next = new Set(current); if (next.has(line.id)) next.delete(line.id); else next.add(line.id); return next; })}
                  className="absolute right-2 top-2 rounded-lg p-1 text-muted-foreground hover:bg-muted md:static"><ChevronDown size={15} className={`transition-transform ${sourcesOpen ? 'rotate-180' : ''}`} /></button>
              </div>
              {(isOver && editable) && <div className="px-3 pb-2.5 md:pl-[4.25rem]">
                <label className="block text-xs font-semibold text-rose-700 dark:text-rose-300">Lý do đề nghị vượt BOQ (bắt buộc)
                  <input value={draft?.overReason ?? ''} disabled={disabled} onChange={event => onChange(line.id, { overReason: event.target.value })}
                    placeholder="Ví dụ: phát sinh theo bản vẽ điều chỉnh, BOQ khai thiếu…"
                    className={`mt-1 w-full rounded-lg border bg-background px-2.5 py-1.5 text-sm font-normal text-foreground outline-none focus:border-teal-600 ${!draft?.overReason?.trim() ? 'border-rose-400' : 'border-border'}`} /></label>
              </div>}
              {!editable && line.overReason && <p className="px-3 pb-2 text-xs text-rose-700 md:pl-[4.25rem] dark:text-rose-300">Lý do vượt BOQ: {line.overReason}</p>}
              {sourcesOpen && <div className="mx-3 mb-3 overflow-hidden rounded-lg border border-border bg-background text-xs md:ml-[4.25rem]">
                <div className="grid grid-cols-[minmax(0,2fr)_110px_90px_90px] gap-2 bg-muted/60 px-3 py-1.5 font-semibold text-muted-foreground"><span>Công việc cần vật tư này</span><span className="text-right">KL kế hoạch / KL CV</span><span className="text-right">SL BOQ</span><span className="text-right">Quy đổi</span></div>
                {line.sources.map(s => <div key={`${s.taskId}-${s.budgetQty}`} className="grid grid-cols-[minmax(0,2fr)_110px_90px_90px] gap-2 border-t border-border px-3 py-1.5">
                  <span className="min-w-0 truncate"><span className="text-muted-foreground">{s.wbsCode}</span> {s.taskName}</span>
                  <span className="text-right tabular-nums">{fmt(s.plannedWorkQty)} / {fmt(s.workTotalQty)} {s.workUnit || ''}</span>
                  <span className="text-right tabular-nums">{fmt(s.budgetQty)}</span>
                  <span className="text-right font-semibold tabular-nums">{fmt(s.derivedQty)}</span>
                </div>)}
              </div>}
            </div>;
          })}
        </div>;
      })}
    </div>
  </div>;
};

const MaterialPlanPanel: React.FC<{
  projectId: string; constructionSiteId: string | null; periodType: WorkPlanPeriodType; periodStart: string;
  onOpenWorkPlan: () => void;
}> = ({ projectId, constructionSiteId, periodType, periodStart, onOpenWorkPlan }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const reasonConfirm = useReasonConfirm();
  const [board, setBoard] = useState<MaterialPlanBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftLine>>({});
  const [header, setHeader] = useState({ note: '', neededDate: '', warehouseId: '' });
  const [dirty, setDirty] = useState(false);
  const [approverId, setApproverId] = useState('');
  const [showGaps, setShowGaps] = useState(false);
  const request = useRef(0);
  const periodLabel = formatWorkPlanPeriod(periodType, periodStart);

  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true); setError(null);
    try {
      const next = await projectMaterialPlanService.getBoard({ projectId, constructionSiteId, periodType, periodStart });
      if (id !== request.current) return;
      setBoard(next);
      const open = next.open;
      if (open && ['draft', 'returned'].includes(open.status)) {
        setDrafts(Object.fromEntries(open.lines.map(l => [l.id, { requestedQty: qtyInput(l.requestedQty), neededDate: l.neededDate || '', overReason: l.overReason || '', note: l.note || '' }])));
        setHeader({ note: open.note || '', neededDate: open.neededDate || '', warehouseId: open.destinationWarehouseId || '' });
      } else setDrafts({});
      setDirty(false);
    } catch (caught) { if (id === request.current) setError(caught instanceof Error ? caught.message : 'Không tải được kế hoạch vật tư.'); }
    finally { if (id === request.current) setLoading(false); }
  }, [constructionSiteId, periodStart, periodType, projectId]);
  useEffect(() => { void load(); }, [load]);

  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try { await fn(); } catch (caught) { toast.error('Chưa thực hiện được', caught instanceof Error ? caught.message : ''); }
    finally { setBusy(null); }
  };

  const open = board?.open || null;
  const approved = board?.approved || null;
  const editable = Boolean(open && ['draft', 'returned'].includes(open.status) && board?.permissions.canEdit);
  const permissions = board?.permissions;
  const invalidCount = editable && open ? open.lines.filter(l => { const q = parseQty(drafts[l.id]?.requestedQty ?? ''); return q == null || Number.isNaN(q) || q < 0; }).length : 0;
  const missingReasons = editable && open ? open.lines.filter(l => {
    const q = parseQty(drafts[l.id]?.requestedQty ?? '');
    return q != null && !Number.isNaN(q) && isOverBoq(l, q) && !drafts[l.id]?.overReason.trim();
  }).length : 0;

  const saveDraft = async (plan: MaterialPlan) => {
    if (invalidCount) { toast.error('Còn SL đề nghị chưa hợp lệ', 'Sửa các ô được tô đỏ.'); return null; }
    const result = await projectMaterialPlanService.save({ planId: plan.id, expectedRowVersion: plan.rowVersion, note: header.note,
      neededDate: header.neededDate || null, destinationWarehouseId: header.warehouseId || null,
      lines: plan.lines.map(l => ({ id: l.id, requestedQty: parseQty(drafts[l.id]?.requestedQty ?? '') ?? 0, neededDate: drafts[l.id]?.neededDate || null,
        overReason: drafts[l.id]?.overReason || null, note: drafts[l.id]?.note || null })) });
    setDirty(false);
    return result;
  };

  const onCreate = () => run('create', async () => {
    if (!board?.workPlan) return;
    const result = await projectMaterialPlanService.create(board.workPlan.id);
    toast.success(`Đã lập kế hoạch vật tư: ${result.lines} vật tư`, 'SL đề nghị gợi ý = nhu cầu trừ tồn kho công trường. Chỉnh rồi gửi CHT duyệt.');
    await load();
  });
  const onSave = () => run('save', async () => { if (open && await saveDraft(open)) { toast.success('Đã lưu nháp', periodLabel); await load(); } });
  const onSubmit = () => run('submit', async () => {
    if (!open) return;
    if (missingReasons) { toast.error(`${missingReasons} vật tư vượt BOQ chưa ghi lý do`, 'Mở các nhóm tô đỏ và nhập lý do.'); return; }
    const saved = await saveDraft(open); if (!saved) return;
    await projectMaterialPlanService.transition({ planId: saved.planId, expectedRowVersion: saved.rowVersion, action: 'submit', recipientUserId: approverId || null });
    toast.success('Đã gửi CHT duyệt', periodLabel); await load();
  });
  const onTransition = (plan: MaterialPlan, action: 'approve' | 'return' | 'withdraw' | 'delete' | 'keep') => run(action, async () => {
    let reason: string | undefined;
    if (action === 'keep') {
      const value = await reasonConfirm({ title: 'Giữ nguyên kế hoạch vật tư', targetName: periodLabel, reasonLabel: 'Lý do giữ nguyên',
        warningText: plan.needsReviewReason || 'Kế hoạch thi công của kỳ đã đổi.', reasonPlaceholder: 'Ví dụ: thay đổi không làm đổi nhu cầu vật tư của kỳ',
        actionLabel: 'Giữ nguyên', cancelLabel: 'Hủy', intent: 'warning', countdownSeconds: 0, minLength: 5 });
      if (!value) return; reason = value;
    }
    if (action === 'return') {
      const value = await reasonConfirm({ title: 'Trả lại kế hoạch vật tư', targetName: periodLabel, reasonLabel: 'Lý do trả lại',
        reasonPlaceholder: 'Ví dụ: thép D16 đề nghị nhiều hơn KL tuần…', actionLabel: 'Trả lại', cancelLabel: 'Hủy', intent: 'warning', countdownSeconds: 0 });
      if (!value) return; reason = value;
    }
    if (action === 'delete' && !(await confirm({ title: 'Xóa bản nháp kế hoạch vật tư?', targetName: periodLabel, warningText: 'Có thể lập lại từ kế hoạch thi công.', actionLabel: 'Xóa nháp', intent: 'danger' }))) return;
    if (action === 'approve' && !(await confirm({ title: 'Duyệt kế hoạch vật tư?', targetName: periodLabel,
      warningText: periodType === 'week'
        ? `${plan.lines.filter(l => l.requestedQty > 0).length} vật tư có SL đề nghị sẽ chuyển sang Mua hàng để đặt.`
        : `${plan.lines.filter(l => l.requestedQty > 0).length} vật tư thành dự báo vật tư của tháng. Dự báo không gửi Mua hàng — đề nghị mua đi theo kế hoạch vật tư tuần.`,
      actionLabel: 'Duyệt', intent: 'success' }))) return;
    await projectMaterialPlanService.transition({ planId: plan.id, expectedRowVersion: plan.rowVersion, action, reason });
    toast.success({ approve: 'Đã duyệt kế hoạch vật tư', return: 'Đã trả lại người lập', withdraw: 'Đã rút về để sửa', delete: 'Đã xóa bản nháp', keep: 'Đã giữ nguyên kế hoạch vật tư' }[action], periodLabel);
    await load();
  });
  const onRevise = (plan: MaterialPlan) => run('revise', async () => {
    const reason = await reasonConfirm({ title: 'Tạo bản điều chỉnh kế hoạch vật tư', targetName: periodLabel, reasonLabel: 'Lý do điều chỉnh',
      warningText: 'Nhu cầu được tính lại từ kế hoạch thi công đã duyệt mới nhất; SL đề nghị đã nhập được giữ lại.', actionLabel: 'Tạo bản điều chỉnh', cancelLabel: 'Hủy', intent: 'warning', countdownSeconds: 0 });
    if (!reason) return;
    await projectMaterialPlanService.revise({ planId: plan.id, reason });
    toast.success('Đã tạo bản điều chỉnh', 'Kiểm tra lại rồi gửi duyệt.'); await load();
  });

  const busyIcon = (key: string) => busy === key ? <Loader2 size={15} className="animate-spin" /> : null;
  if (loading && !board) return <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card p-12 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" />Đang tải kế hoạch vật tư…</div>;
  if (error && !board) return <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
    <p className="font-semibold">{error}</p><button type="button" onClick={() => void load()} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-semibold"><RotateCcw size={13} />Thử lại</button></div>;
  if (!board) return null;

  const shown = open || approved;
  const summary = (plan: MaterialPlan) => {
    const req = (l: MaterialPlanLine) => plan === open && editable ? (parseQty(drafts[l.id]?.requestedQty ?? '') ?? 0) : l.requestedQty;
    return {
      total: plan.lines.length,
      requested: plan.lines.filter(l => (req(l) || 0) > 0).length,
      over: plan.lines.filter(l => isOverBoq(l, req(l) || 0)).length,
      gaps: plan.gaps.length,
    };
  };

  const me = board.currentUserId;
  const planSection = (plan: MaterialPlan, mode: 'edit' | 'review' | 'approved') => {
    const s = summary(plan);
    const staleWork = plan.workPlanStatus === 'superseded' && !plan.needsReviewAt;
    const isSelf = Boolean(me && (plan.createdBy === me || plan.submittedBy === me));
    return <section className={`space-y-3 rounded-2xl border bg-card p-4 shadow-sm md:p-5 ${mode === 'edit' ? 'border-teal-200 dark:border-teal-900' : mode === 'review' ? 'border-amber-200 dark:border-amber-900' : 'border-border'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-bold text-foreground">Kế hoạch vật tư · {periodLabel}</h3><StatusChip status={plan.status} />
          {plan.revisionNo > 1 && <span className="text-xs text-muted-foreground">Bản điều chỉnh lần {plan.revisionNo - 1}</span>}
        </div>
        <span className="text-xs text-muted-foreground">Từ kế hoạch thi công {board.workPlan?.code}{plan.approvedByName ? ` · ${plan.approvedByName} duyệt ${plan.approvedAt ? new Date(plan.approvedAt).toLocaleDateString('vi-VN') : ''}` : ''}</span>
      </div>
      {plan.needsReviewAt && <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100 md:flex-row md:items-center md:justify-between">
        <span className="flex items-start gap-2"><AlertTriangle size={16} className="mt-0.5 shrink-0" /><span><strong>Cần tính lại kế hoạch vật tư.</strong> {plan.needsReviewReason}</span></span>
        {mode === 'approved' && permissions?.canEdit && !open && <span className="flex shrink-0 flex-wrap gap-2">
          <button type="button" onClick={() => onRevise(plan)} disabled={Boolean(busy)} className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50">Tạo bản điều chỉnh</button>
          <button type="button" onClick={() => onTransition(plan, 'keep')} disabled={Boolean(busy)} className="rounded-lg border border-amber-400 bg-white/80 px-3 py-1.5 text-xs font-semibold hover:bg-white disabled:opacity-50 dark:bg-transparent">Giữ nguyên — ghi lý do</button>
        </span>}</div>}
      {staleWork && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
        Kế hoạch thi công của kỳ đã được điều chỉnh sau khi lập kế hoạch vật tư này. {mode === 'approved' ? 'Tạo bản điều chỉnh để tính lại nhu cầu.' : 'Xóa nháp và lập lại để lấy nhu cầu mới.'}</div>}
      {plan.status === 'returned' && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
        <strong>Bị trả lại</strong>{plan.returnedByName ? ` bởi ${plan.returnedByName}` : ''}: {plan.returnReason}</div>}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {([['Vật tư theo kế hoạch', s.total, 'text-foreground', 'bg-slate-400'], ['Có SL đề nghị', s.requested, 'text-teal-700 dark:text-teal-300', 'bg-teal-500'],
          ['Vượt BOQ', s.over, 'text-rose-700 dark:text-rose-300', 'bg-rose-500'], ['Việc chưa quy đổi được', s.gaps, 'text-amber-700 dark:text-amber-300', 'bg-amber-500']] as const)
          .map(([label, value, tone, dot]) => <div key={label} className="rounded-xl border border-border bg-background px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground"><span className={`h-2 w-2 rounded-full ${dot}`} />{label}</div>
            <div className={`mt-1 text-2xl font-bold tabular-nums ${tone}`}>{value}</div></div>)}
      </div>
      {plan.gaps.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20">
        <button type="button" aria-expanded={showGaps} onClick={() => setShowGaps(v => !v)} className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm text-amber-900 dark:text-amber-100">
          <span className="flex items-center gap-2"><AlertTriangle size={15} /><span><strong>{plan.gaps.length} công việc chưa quy đổi được ra vật tư</strong> — thường do chưa khai vật tư BOQ cho công việc. Vật tư của các việc này cần đề xuất bổ sung.</span></span>
          <ChevronDown size={15} className={`shrink-0 transition-transform ${showGaps ? 'rotate-180' : ''}`} /></button>
        {showGaps && <div className="max-h-64 divide-y divide-amber-100 overflow-y-auto border-t border-amber-200 text-xs dark:divide-amber-900 dark:border-amber-900">
          {plan.gaps.map(g => <div key={g.taskId} className="flex items-center justify-between gap-3 px-4 py-1.5"><span className="min-w-0 truncate"><span className="text-muted-foreground">{g.wbsCode}</span> {g.taskName}</span>
            <span className="shrink-0 text-amber-800 dark:text-amber-200">{MATERIAL_PLAN_GAP_LABELS[g.reason]}</span></div>)}
        </div>}
      </div>}
      {mode === 'edit' && <div className="grid gap-3 md:grid-cols-3">
        <label className="text-xs font-semibold text-muted-foreground">Kho nhận
          <select value={header.warehouseId} disabled={Boolean(busy)} onChange={event => { setHeader(h => ({ ...h, warehouseId: event.target.value })); setDirty(true); }}
            className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm font-normal text-foreground">
            {board.warehouses.length === 0 && <option value="">Công trường chưa có kho</option>}
            {board.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
        <label className="text-xs font-semibold text-muted-foreground">Ngày cần có vật tư
          <input type="date" value={header.neededDate} disabled={Boolean(busy)} onChange={event => { setHeader(h => ({ ...h, neededDate: event.target.value })); setDirty(true); }}
            className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm font-normal text-foreground" /></label>
        <label className="text-xs font-semibold text-muted-foreground">Ghi chú
          <input value={header.note} disabled={Boolean(busy)} placeholder="Yêu cầu giao hàng, lưu ý chất lượng…" onChange={event => { setHeader(h => ({ ...h, note: event.target.value })); setDirty(true); }}
            className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm font-normal text-foreground" /></label>
      </div>}
      {mode !== 'edit' && <p className="text-xs text-muted-foreground">Kho nhận: <strong className="text-foreground">{plan.destinationWarehouseName || 'Chưa chọn'}</strong>{plan.neededDate ? <> · Ngày cần: <strong className="text-foreground">{new Date(plan.neededDate).toLocaleDateString('vi-VN')}</strong></> : null}{plan.note ? <> · {plan.note}</> : null}</p>}
      {plan.lines.length === 0
        ? <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">Không quy đổi được vật tư nào từ kế hoạch thi công. Kiểm tra vật tư BOQ của các công việc.</p>
        : <MaterialTable plan={plan} editable={mode === 'edit' && editable} drafts={drafts} disabled={Boolean(busy)}
          onChange={(id, patch) => { setDrafts(current => ({ ...current, [id]: { ...current[id], ...patch } })); setDirty(true); }} />}
      <div className="flex flex-col gap-2 border-t border-border pt-3 md:flex-row md:items-center md:justify-between">
        <span className="text-xs text-muted-foreground">
          {mode === 'edit' ? <>{dirty ? 'Có thay đổi chưa lưu. ' : ''}{missingReasons > 0 && <span className="font-semibold text-rose-600">{missingReasons} dòng vượt BOQ chưa có lý do. </span>}{invalidCount > 0 && <span className="font-semibold text-rose-600">{invalidCount} ô SL chưa hợp lệ.</span>}</>
            : mode === 'review' ? (isSelf ? <span className="inline-flex items-center gap-1"><ShieldCheck size={13} className="text-teal-600" />Bạn là người lập / gửi — cần CHT khác duyệt.</span>
              : permissions?.canApprove ? 'Kiểm tra SL đề nghị và các dòng vượt BOQ rồi duyệt.' : 'Đang chờ CHT duyệt.') : 'Kế hoạch vật tư chính thức của kỳ.'}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {mode === 'edit' && <>
            {plan.status === 'draft' && <button type="button" onClick={() => onTransition(plan, 'delete')} disabled={Boolean(busy)} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:hover:bg-rose-950/40">{busyIcon('delete') || <Trash2 size={15} />}Xóa nháp</button>}
            {permissions?.canSubmit && board.approvers.length > 0 && <label className="flex items-center gap-1.5 text-xs text-muted-foreground">Người duyệt
              <select value={approverId} onChange={event => setApproverId(event.target.value)} className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground">
                <option value="">Tất cả CHT có quyền</option>{board.approvers.filter(a => a.id !== me).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
            <button type="button" onClick={onSave} disabled={Boolean(busy)} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50">{busyIcon('save') || <Save size={15} />}Lưu nháp</button>
            {permissions?.canSubmit && <button type="button" onClick={onSubmit} disabled={Boolean(busy) || invalidCount > 0} className="inline-flex items-center gap-1.5 rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50">{busyIcon('submit') || <Send size={15} />}Gửi CHT duyệt</button>}
          </>}
          {mode === 'review' && <>
            {plan.submittedBy === me && <button type="button" onClick={() => onTransition(plan, 'withdraw')} disabled={Boolean(busy)} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50">{busyIcon('withdraw') || <Undo2 size={15} />}Rút về sửa</button>}
            {permissions?.canApprove && !isSelf && <>
              <button type="button" onClick={() => onTransition(plan, 'return')} disabled={Boolean(busy)} className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500 px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50 dark:text-amber-200">{busyIcon('return') || <Undo2 size={15} />}Trả lại</button>
              <button type="button" onClick={() => onTransition(plan, 'approve')} disabled={Boolean(busy)} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">{busyIcon('approve') || <CheckCircle2 size={15} />}Duyệt</button>
            </>}
          </>}
          {mode === 'approved' && permissions?.canEdit && !open && !plan.needsReviewAt && <button type="button" onClick={() => onRevise(plan)} disabled={Boolean(busy)} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50">{busyIcon('revise') || <RotateCcw size={13} />}Tạo bản điều chỉnh</button>}
        </div>
      </div>
    </section>;
  };

  return <div className="space-y-4">
    <div className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${periodType === 'week'
      ? 'border-teal-200 bg-teal-50 text-teal-900 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-100'
      : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'}`}>
      <Package size={16} className="mt-0.5 shrink-0" />
      {periodType === 'week'
        ? <span><strong>Kế hoạch vật tư tuần là đề nghị mua.</strong> CHT duyệt xong, vật tư có SL đề nghị chuyển sang Mua hàng → Cần mua.</span>
        : <span><strong>Kế hoạch vật tư tháng là dự báo</strong> để công trường và Mua hàng chuẩn bị trước; không gửi Mua hàng. Muốn đặt hàng, lập kế hoạch vật tư theo <strong>tuần</strong>.</span>}
    </div>
    {open && planSection(open, ['draft', 'returned'].includes(open.status) && permissions?.canEdit ? 'edit' : 'review')}
    {approved && planSection(approved, 'approved')}
    {!shown && <section className="rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
      <Package size={32} className="mx-auto text-slate-300" />
      {board.workPlan ? <>
        <h3 className="mt-3 text-base font-bold text-foreground">Chưa có kế hoạch vật tư cho {periodLabel.charAt(0).toLowerCase() + periodLabel.slice(1)}</h3>
        <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">Nhu cầu được tính từ kế hoạch thi công đã duyệt <strong>{board.workPlan.code}</strong> ({board.workPlan.lineCount} công việc) theo vật tư BOQ của từng công việc. SL đề nghị gợi ý = nhu cầu trừ tồn kho công trường.</p>
        {permissions?.canEdit ? <button type="button" onClick={onCreate} disabled={Boolean(busy)} className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50">{busyIcon('create') || <Package size={16} />}Lập kế hoạch vật tư</button>
          : <p className="mt-2 text-sm text-muted-foreground">Người có quyền "Lập/sửa kế hoạch" sẽ lập kế hoạch vật tư.</p>}
      </> : <>
        <h3 className="mt-3 text-base font-bold text-foreground">Cần kế hoạch thi công được duyệt trước</h3>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{board.workPlanPending ? 'Kế hoạch thi công của kỳ đang soạn hoặc chờ duyệt.' : 'Kỳ này chưa có kế hoạch thi công.'} Kế hoạch vật tư được tính từ khối lượng công việc đã duyệt.</p>
        <button type="button" onClick={onOpenWorkPlan} className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-teal-600 px-4 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-50 dark:text-teal-300">Mở kế hoạch thi công</button>
      </>}
    </section>}
  </div>;
};

export default MaterialPlanPanel;
