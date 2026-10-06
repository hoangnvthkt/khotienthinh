// Phiên bản kế hoạch tháng / tuần: so sánh hai bản, đúng/chậm theo lịch, luật không sửa lùi (khớp máy chủ).
import type { PlanChangeReason, ResponsibleParty, WorkPlan, WorkPlanLine } from './projectWorkPlanService';

const EPS = 0.0005;
const ms = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00`);
export const dayDiff = (from: string, to: string) => Math.round((ms(to) - ms(from)) / 86400000);

type DatedLine = Pick<WorkPlanLine, 'plannedStart' | 'plannedEnd'>;
type Period = Pick<WorkPlan, 'periodStart' | 'periodEnd'>;
export const effStart = (line: DatedLine, period: Period) => (line.plannedStart || period.periodStart).slice(0, 10);
export const effEnd = (line: DatedLine, period: Period) => (line.plannedEnd || period.periodEnd).slice(0, 10);

/** Bản gốc của kỳ: bản đầu tiên đã được duyệt (null khi kỳ chưa có bản nào được duyệt). */
export const originalVersion = (versions: WorkPlan[]): WorkPlan | null =>
  versions.filter(v => v.approvedAt).sort((a, b) => a.revisionNo - b.revisionNo)[0] || null;

export type DiffKind = 'same' | 'added' | 'removed' | 'changed';
export interface PlanDiffRow {
  taskId: string;
  wbsCode: string | null;
  taskName: string;
  groupName: string;
  unit: string | null;
  base?: WorkPlanLine;
  cur?: WorkPlanLine;
  kind: DiffKind;
  /** Khối lượng mới − cũ (null khi một bên chưa có khối lượng). */
  dQty: number | null;
  dStart: number;
  dEnd: number;
  /** Nhanh hơn: thêm việc / tăng khối lượng / xong sớm hơn. Chậm hơn: bỏ khỏi kỳ / giảm / xong muộn hơn. */
  pace: 'faster' | 'slower' | null;
}

export const diffPlans = (base: (Period & { lines: WorkPlanLine[] }) | null, cur: Period & { lines: WorkPlanLine[] }): PlanDiffRow[] => {
  const b = new Map((base?.lines || []).map(l => [l.taskId, l]));
  const c = new Map(cur.lines.map(l => [l.taskId, l]));
  const order = [...cur.lines, ...(base?.lines || []).filter(l => !c.has(l.taskId))];
  return order.map(any => {
    const bl = base ? b.get(any.taskId) : undefined; const cl = c.get(any.taskId);
    const qtyChanged = !!bl && !!cl && ((bl.plannedQty == null) !== (cl.plannedQty == null)
      || (bl.plannedQty != null && cl.plannedQty != null && Math.abs(bl.plannedQty - cl.plannedQty) > EPS));
    const dStart = bl && cl ? dayDiff(effStart(bl, base!), effStart(cl, cur)) : 0;
    const dEnd = bl && cl ? dayDiff(effEnd(bl, base!), effEnd(cl, cur)) : 0;
    const kind: DiffKind = !base ? 'same' : !bl ? 'added' : !cl ? 'removed' : qtyChanged || dStart !== 0 || dEnd !== 0 ? 'changed' : 'same';
    const dQty = kind === 'added' ? cl?.plannedQty ?? null : kind === 'removed' ? (bl?.plannedQty != null ? -bl.plannedQty : null)
      : bl?.plannedQty != null && cl?.plannedQty != null ? cl.plannedQty - bl.plannedQty : null;
    const pace = kind === 'added' ? 'faster' : kind === 'removed' ? 'slower' : kind !== 'changed' ? null
      : dQty != null && Math.abs(dQty) > EPS ? (dQty > 0 ? 'faster' : 'slower')
        : dEnd !== 0 ? (dEnd > 0 ? 'slower' : 'faster') : dStart !== 0 ? (dStart > 0 ? 'slower' : 'faster') : null;
    return { taskId: any.taskId, wbsCode: any.wbsCode, taskName: any.taskName, groupName: any.groupName || 'Công việc khác', unit: any.unit,
      base: bl, cur: cl, kind, dQty, dStart, dEnd, pace };
  });
};

export interface ChangeRef { revisionNo: number; reasonCode: string; party: ResponsibleParty | null; note: string | null }
/** Lý do của một việc ở các bản sau `fromNo` tới hết `toNo`. */
export const changeRefs = (versions: WorkPlan[], taskId: string, fromNo: number, toNo: number): ChangeRef[] =>
  versions.filter(v => v.revisionNo > fromNo && v.revisionNo <= toNo).flatMap(v => {
    const line = v.lines.find(l => l.taskId === taskId && l.changeReasonCode);
    const removed = (v.removedLines || []).find(l => l.taskId === taskId && l.changeReasonCode);
    const hit = line ? { code: line.changeReasonCode!, party: line.responsibleParty ?? null, note: line.changeNote ?? null }
      : removed ? { code: removed.changeReasonCode!, party: removed.responsibleParty, note: removed.changeNote } : null;
    return hit ? [{ revisionNo: v.revisionNo, reasonCode: hit.code, party: hit.party, note: hit.note }] : [];
  });

/** Khối lượng lẽ ra phải xong tới hôm nay: chia đều theo số ngày của dòng. */
export const expectedByToday = (line: WorkPlanLine, period: Period, today: string): number | null => {
  if (line.plannedQty == null) return null;
  const s = effStart(line, period); const e = effEnd(line, period);
  if (today < s) return 0;
  if (today >= e) return line.plannedQty;
  return line.plannedQty * (dayDiff(s, today) + 1) / (dayDiff(s, e) + 1);
};

export interface PlanPerformance { ok: number; late: number; notYet: number; unknown: number; total: number; avgPct: number | null }
/** Đúng/chậm so với lịch tới hôm nay. Dòng chưa có khối lượng hoặc chưa có số thực hiện = chưa rõ (không tính 0). */
export const planPerformance = (plan: Period & { lines: WorkPlanLine[] }, today: string, actualOf: (taskId: string) => number | null | undefined): PlanPerformance => {
  let ok = 0; let late = 0; let notYet = 0; let unknown = 0; let sum = 0; let counted = 0;
  plan.lines.forEach(line => {
    const exp = expectedByToday(line, plan, today);
    const done = actualOf(line.taskId);
    if (today < effStart(line, plan)) { notYet += 1; return; }
    if (exp == null || done == null || line.plannedQty == null || line.plannedQty <= 0) { unknown += 1; return; }
    sum += Math.min(done / line.plannedQty, 1); counted += 1;
    if (done + EPS >= exp * 0.98) ok += 1; else late += 1;
  });
  return { ok, late, notYet, unknown, total: plan.lines.length, avgPct: counted ? (sum / counted) * 100 : null };
};

export type RevisionIssueCode = 'START_LOCKED' | 'START_IN_PAST' | 'END_IN_PAST' | 'NEW_LINE_IN_PAST' | 'QTY_BELOW_DONE' | 'REMOVE_DONE_LINE'
  | 'END_BEFORE_START' | 'OUTSIDE_PERIOD';
export interface RevisionIssue { code: RevisionIssueCode; message: string }

/** Luật không sửa lùi cho một dòng của bản điều chỉnh (giống app_private.work_plan_assert_editable). */
export const revisionLineIssues = (input: {
  line: DatedLine & { plannedQty: number | null }; base: DatedLine | null; period: Period; today: string; done: number | null;
}): RevisionIssue[] => {
  const { line, base, period, today } = input;
  const out: RevisionIssue[] = [];
  const s = effStart(line, period); const e = effEnd(line, period);
  if (s < period.periodStart.slice(0, 10) || e > period.periodEnd.slice(0, 10)) out.push({ code: 'OUTSIDE_PERIOD', message: 'Ngày phải nằm trong kỳ' });
  if (e < s) out.push({ code: 'END_BEFORE_START', message: 'Ngày kết thúc trước ngày bắt đầu' });
  if (!base) {
    if (s < today) out.push({ code: 'NEW_LINE_IN_PAST', message: 'Việc thêm mới phải bắt đầu từ hôm nay trở đi' });
  } else {
    const bs = effStart(base, period); const be = effEnd(base, period);
    if (s !== bs && bs < today) out.push({ code: 'START_LOCKED', message: 'Việc đã bắt đầu — giữ ngày bắt đầu, chỉ dời ngày kết thúc (không sửa lùi)' });
    else if (s !== bs && s < today) out.push({ code: 'START_IN_PAST', message: 'Ngày bắt đầu đã qua — không dời kế hoạch về quá khứ' });
    if (e !== be && e < today) out.push({ code: 'END_IN_PAST', message: 'Ngày kết thúc đã qua — không dời về quá khứ' });
  }
  if (line.plannedQty != null && input.done != null && line.plannedQty + EPS < input.done) {
    out.push({ code: 'QTY_BELOW_DONE', message: 'Thấp hơn khối lượng đã làm trong kỳ' });
  }
  return out;
};

export const removalIssue = (done: number | null): RevisionIssue | null =>
  done != null && done > EPS ? { code: 'REMOVE_DONE_LINE', message: 'Đã làm trong kỳ — không bỏ khỏi kỳ, hãy giảm khối lượng về phần đã làm' } : null;

/** Lý do nào cần văn bản đính kèm. */
export const reasonNeedsDocument = (reasons: PlanChangeReason[], codes: Array<string | null | undefined>) =>
  codes.some(code => code && reasons.find(r => r.code === code)?.needsDocument);
