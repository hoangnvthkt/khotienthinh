import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { describeDailyLogProgressIssue, type DailyLogProgressIssue } from '../dailyLogProgressIssues';
import { approvedBoundHint, approvedBoundMessage, deriveDailyLogEntry } from '../dailyLogEntryRules';
import { mapDailyLogWbsCommandError } from '../dailyLogWorkflow';
import { DailyLogProgressIssuesPanel } from '../../components/project/daily-log/DailyLogProgressIssuesPanel';

// Số liệu thật bản 19/10 dự án SMB (23/10/2026).
const below: DailyLogProgressIssue = {
  kind: 'below_approved', taskId: 'task-510', wbsCode: '5.10', taskName: 'Gia công, lắp đặt cốt thép giằng móng, cổ móng',
  officialPercent: 50, approvedDate: '2026-10-03', approvedPercent: 98,
  sources: [{ summarySourceId: 'ss-1', authorName: 'Nguyễn Chấp Việt', areaName: 'Nhà xưởng 1', percent: 50 }],
};
const stale: DailyLogProgressIssue = {
  kind: 'baseline_changed', taskId: 'task-34', wbsCode: '3.4', taskName: 'Xây tường tầng 4 + tầng tum',
  summarySourceId: 'ss-2', authorName: 'Nguyễn Chấp Việt', areaName: 'Nhà văn phòng',
  slipPercent: 10, slipBaselinePercent: 0, cause: 'later_day', causeDate: '2026-10-20', causePercent: 45,
};

describe('daily log progress issues', () => {
  it('names the task, the approved mark and the fix when progress goes down', () => {
    const view = describeDailyLogProgressIssue(below);
    expect(view.task).toBe('5.10 Gia công, lắp đặt cốt thép giằng móng, cổ móng');
    expect(view.problem).toBe('Bản này ghi 50%, thấp hơn 98% đã ghi nhận ngày 03/10. Lũy kế không được giảm.');
    expect(view.fix).toContain('điều chỉnh tiến độ');
    expect(view.sources[0].authorName).toBe('Nguyễn Chấp Việt');
  });

  it('explains a slip made stale by a later day approved afterwards', () => {
    const view = describeDailyLogProgressIssue(stale);
    expect(view.problem).toBe('Ngày 20/10 (45%) được duyệt sau khi lập phiếu này.');
    expect(view.returnReason).toContain('3.4 Xây tường tầng 4 + tầng tum');
  });

  it('lists each issue with the slip author and a return action', () => {
    const html = renderToStaticMarkup(<DailyLogProgressIssuesPanel issues={[below, stale]} busy={false} onReturn={async () => undefined} />);
    expect(html).toContain('Cần xử lý trước khi duyệt · 2 hạng mục');
    expect(html).toContain('Nhà văn phòng · phiếu của <b>Nguyễn Chấp Việt</b>');
    expect(html).toContain('Trả phiếu cho Nguyễn Chấp Việt');
    expect(renderToStaticMarkup(<DailyLogProgressIssuesPanel issues={[]} busy={false} />)).toBe('');
  });
});

describe('approved progress bounds on the engineer slip', () => {
  const base = { mode: 'percent' as const, plannedQuantity: null, unit: null, previousCumulativeQuantity: null, baselineQuantityState: 'unknown' as const };
  const bounds = { approvedBefore: { date: '2026-10-03', percent: 98 }, approvedAfter: { date: '2026-10-20', percent: 100 } };

  it('blocks a cumulative percent below the mark already recorded', () => {
    const result = deriveDailyLogEntry({ ...base, enteredValue: '50', ...bounds });
    expect(result.errorCode).toBe('progress_below_approved');
    expect(approvedBoundMessage(result.errorCode, bounds)).toBe('Thấp hơn 98% đã ghi nhận ngày 03/10. Lũy kế là tổng từ đầu, không được giảm.');
    expect(deriveDailyLogEntry({ ...base, enteredValue: '98', ...bounds }).valid).toBe(true);
  });

  it('blocks a percent above a later approved day, also when entered as quantity', () => {
    const later = { approvedAfter: { date: '2026-10-20', percent: 30 } };
    expect(deriveDailyLogEntry({ ...base, enteredValue: '31', ...later }).errorCode).toBe('progress_above_approved_later');
    expect(deriveDailyLogEntry({ ...base, mode: 'cumulative_quantity', plannedQuantity: 1000, unit: 'm2', enteredValue: '350', ...later }).errorCode)
      .toBe('progress_above_approved_later');
  });

  it('shows the recorded marks as a hint', () => {
    expect(approvedBoundHint(bounds)).toBe('Đã ghi nhận 98% (03/10) · ngày sau 20/10: 100%');
    expect(approvedBoundHint({})).toBeNull();
  });

  it('turns the server block into a sentence with task, date and percent', () => {
    const error = mapDailyLogWbsCommandError({ message: 'PROGRESS_BELOW_APPROVED', details: JSON.stringify({
      wbsCode: '5.10', taskName: 'Cốt thép giằng móng', enteredPercent: 50, approvedPercent: 98, approvedDate: '2026-10-03' }) });
    expect(error.message).toBe('5.10 Cốt thép giằng móng: nhập 50% nhưng đã ghi nhận 98% ngày 03/10. Lũy kế là tổng từ đầu, không được giảm. Nếu 98% ghi sai, đề nghị điều chỉnh tiến độ trước.');
  });
});
