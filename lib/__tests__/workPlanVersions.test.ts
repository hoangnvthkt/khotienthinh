import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mapWorkPlanError, type WorkPlan, type WorkPlanLine } from '../projectWorkPlanService';
import {
  changeRefs, diffPlans, expectedByToday, originalVersion, planPerformance, reasonNeedsDocument, removalIssue, revisionLineIssues,
} from '../workPlanVersions';

const period = { periodStart: '2026-10-01', periodEnd: '2026-10-31' };
const line = (taskId: string, qty: number | null, start: string | null, end: string | null, extra: Partial<WorkPlanLine> = {}): WorkPlanLine => ({
  taskId, workBoqItemId: null, wbsCode: taskId, taskName: `Việc ${taskId}`, groupName: 'Nhà văn phòng', unit: 'm2', totalQty: 1000, doneBeforeQty: 0,
  plannedQty: qty, plannedStart: start, plannedEnd: end, crewLabel: null, note: null, ...extra,
});
const plan = (no: number, lines: WorkPlanLine[], extra: Partial<WorkPlan> = {}): WorkPlan => ({
  id: `p${no}`, projectId: 'P', constructionSiteId: null, periodType: 'month', periodStart: period.periodStart, periodEnd: period.periodEnd,
  code: 'KHT-2026-10', status: 'approved', revisionNo: no, supersedesPlanId: no > 1 ? `p${no - 1}` : null, note: null, rowVersion: 1,
  createdAt: '', updatedAt: '', createdBy: 'u1', createdByName: null, submittedAt: null, submittedBy: null, submittedByName: null, submittedToUserId: null,
  approvedAt: '2026-10-01T08:00:00Z', approvedBy: 'u2', approvedByName: null, returnedAt: null, returnedByName: null, returnReason: null,
  changeReasonCode: null, responsibleParty: null, changeSummary: null, attachments: [], removedLines: [], needsReviewAt: null, needsReviewReason: null,
  lines, events: [], ...extra,
});

describe('so sánh hai bản kế hoạch', () => {
  const base = plan(1, [line('A', 700, '2026-10-02', '2026-10-20'), line('B', 100, '2026-10-05', '2026-10-10'), line('C', 50, null, null)]);
  const cur = plan(2, [line('A', 900, '2026-10-02', '2026-10-25'), line('C', 50, null, null), line('D', 30, '2026-10-12', '2026-10-30')]);
  const rows = diffPlans(base, cur);
  const by = (id: string) => rows.find(r => r.taskId === id)!;

  it('nhận ra thêm, bỏ, đổi và không đổi', () => {
    expect(by('A').kind).toBe('changed');
    expect(by('B').kind).toBe('removed');
    expect(by('C').kind).toBe('same');
    expect(by('D').kind).toBe('added');
  });

  it('đánh dấu nhanh / chậm theo khối lượng rồi theo ngày kết thúc', () => {
    expect(by('A')).toMatchObject({ dQty: 200, dEnd: 5, pace: 'faster' });
    expect(by('B')).toMatchObject({ dQty: -100, pace: 'slower' });
    expect(by('D').pace).toBe('faster');
    const later = diffPlans(base, plan(2, [line('A', 700, '2026-10-02', '2026-10-27')]));
    expect(later.find(r => r.taskId === 'A')).toMatchObject({ kind: 'changed', dQty: 0, dEnd: 7, pace: 'slower' });
  });

  it('coi ngày trống là theo kỳ khi so', () => {
    const same = diffPlans(plan(1, [line('C', 50, null, null)]), plan(2, [line('C', 50, '2026-10-01', '2026-10-31')]));
    expect(same[0].kind).toBe('same');
  });

  it('lấy lý do của các bản nằm giữa hai bản so sánh', () => {
    const v2 = plan(2, [line('A', 900, '2026-10-02', '2026-10-25', { changeReasonCode: 'method', responsibleParty: 'company' })],
      { removedLines: [{ taskId: 'B', wbsCode: 'B', taskName: 'Việc B', groupName: null, unit: 'm2', plannedQty: 100, plannedStart: null, plannedEnd: null, crewLabel: null, changeReasonCode: 'weather', responsibleParty: 'objective', changeNote: 'mưa' }] });
    const v3 = plan(3, [line('A', 950, '2026-10-02', '2026-10-25', { changeReasonCode: 'speedup', responsibleParty: 'company' })]);
    expect(changeRefs([base, v2, v3], 'A', 1, 3).map(r => r.reasonCode)).toEqual(['method', 'speedup']);
    expect(changeRefs([base, v2, v3], 'A', 2, 3).map(r => r.reasonCode)).toEqual(['speedup']);
    expect(changeRefs([base, v2, v3], 'B', 1, 3)).toEqual([{ revisionNo: 2, reasonCode: 'weather', party: 'objective', note: 'mưa' }]);
  });

  it('bản gốc là bản được duyệt đầu tiên', () => {
    const draft1 = plan(1, [], { approvedAt: null, status: 'cancelled' });
    expect(originalVersion([plan(3, []), draft1, plan(2, [])])?.revisionNo).toBe(2);
    expect(originalVersion([draft1])).toBeNull();
  });
});

describe('đúng / chậm theo lịch', () => {
  it('chia đều khối lượng theo số ngày của dòng', () => {
    const l = line('A', 100, '2026-10-11', '2026-10-20');
    expect(expectedByToday(l, period, '2026-10-10')).toBe(0);
    expect(expectedByToday(l, period, '2026-10-15')).toBe(50);
    expect(expectedByToday(l, period, '2026-10-25')).toBe(100);
    expect(expectedByToday(line('X', null, null, null), period, '2026-10-15')).toBeNull();
  });

  it('không coi chưa có số liệu là 0', () => {
    const p = plan(1, [line('A', 100, '2026-10-01', '2026-10-10'), line('B', 100, '2026-10-01', '2026-10-10'), line('C', 100, '2026-10-20', '2026-10-30'), line('D', 100, '2026-10-01', '2026-10-10')]);
    const actual: Record<string, number | null> = { A: 100, B: 20, C: 0, D: null };
    expect(planPerformance(p, '2026-10-12', id => actual[id])).toEqual({ ok: 1, late: 1, notYet: 1, unknown: 1, total: 4, avgPct: 60 });
  });
});

describe('luật không sửa lùi (khớp máy chủ)', () => {
  const today = '2026-10-06';
  const base = { plannedStart: '2026-10-02', plannedEnd: '2026-10-20' };
  const codes = (input: Parameters<typeof revisionLineIssues>[0]) => revisionLineIssues(input).map(i => i.code);

  it('việc đã bắt đầu giữ ngày bắt đầu', () => {
    expect(codes({ line: { ...base, plannedStart: '2026-10-08', plannedQty: 700 }, base, period, today, done: 0 })).toEqual(['START_LOCKED']);
  });
  it('không dời ngày về quá khứ', () => {
    expect(codes({ line: { ...base, plannedEnd: '2026-10-05', plannedQty: 700 }, base, period, today, done: 0 })).toEqual(['END_IN_PAST']);
    expect(codes({ line: { plannedStart: '2026-10-04', plannedEnd: '2026-10-20', plannedQty: 1 }, base: { plannedStart: '2026-10-10', plannedEnd: '2026-10-20' }, period, today, done: 0 })).toEqual(['START_IN_PAST']);
    expect(codes({ line: { plannedStart: '2026-10-03', plannedEnd: '2026-10-20', plannedQty: 1 }, base: null, period, today, done: null })).toEqual(['NEW_LINE_IN_PAST']);
  });
  it('khối lượng không dưới phần đã làm, việc đã làm không bỏ khỏi kỳ', () => {
    expect(codes({ line: { ...base, plannedQty: 150 }, base, period, today, done: 200 })).toEqual(['QTY_BELOW_DONE']);
    expect(codes({ line: { ...base, plannedQty: 200 }, base, period, today, done: 200 })).toEqual([]);
    expect(removalIssue(200)?.code).toBe('REMOVE_DONE_LINE');
    expect(removalIssue(0)).toBeNull();
  });
  it('kỳ chưa bắt đầu thì sửa tự do', () => {
    expect(codes({ line: { plannedStart: '2026-10-08', plannedEnd: '2026-10-12', plannedQty: 5 }, base, period, today: '2026-09-25', done: null })).toEqual([]);
  });
  it('lý do cần văn bản', () => {
    const reasons = [{ code: 'design', label: '', defaultParty: 'owner' as const, needsDocument: true }, { code: 'weather', label: '', defaultParty: 'objective' as const, needsDocument: false }];
    expect(reasonNeedsDocument(reasons, ['weather', null])).toBe(false);
    expect(reasonNeedsDocument(reasons, ['weather', 'design'])).toBe(true);
  });
});

describe('thông báo lỗi', () => {
  it('kèm tên việc khi máy chủ chỉ ra dòng vi phạm', () => {
    expect(mapWorkPlanError({ message: 'WORK_PLAN_START_LOCKED', details: 'Trát ngoài nhà' }).message).toBe('Việc đã bắt đầu thì giữ ngày bắt đầu, chỉ dời ngày kết thúc: Trát ngoài nhà.');
    expect(mapWorkPlanError({ message: 'WORK_PLAN_SELF_APPROVAL_DENIED' }).message).toContain('không tự duyệt');
    expect(mapWorkPlanError({ message: 'WORK_PLAN_NOT_APPROVED' }).message).toContain('đã duyệt');
  });
});

describe('migration phiên bản kế hoạch', () => {
  const sql = readFileSync(resolve(__dirname, '../../supabase/migrations/20261008138100_project_plan_versions.sql'), 'utf8');
  it('chặn sửa lùi, tự duyệt và vá đặt trùng ở máy chủ', () => {
    for (const code of ['WORK_PLAN_PERIOD_ENDED', 'WORK_PLAN_START_LOCKED', 'WORK_PLAN_QTY_BELOW_DONE', 'WORK_PLAN_REMOVE_DONE_LINE',
      'WORK_PLAN_SELF_APPROVAL_DENIED', 'MATERIAL_PLAN_SELF_APPROVAL_DENIED', 'WORK_PLAN_DOCUMENT_REQUIRED']) expect(sql).toContain(code);
    expect(sql).toMatch(/update public\.procurement_po_plan_links k set material_plan_id = v_plan\.id, material_plan_line_id = nl\.id/);
    expect(sql).toContain("revoke all on function public.preview_project_work_plan_impact_v1(uuid) from public, anon;");
  });
});
