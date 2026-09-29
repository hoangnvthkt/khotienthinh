import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  boardStage, boardTotals, buildAttention, buildMyTask, isItemDelayed, reportedFronts,
  type DailyLogTodayBoard, type TodayBoardSlip,
} from '../dailyLogTodayBoard';

const slip = (input: Partial<TodayBoardSlip> & { id: string }): TodayBoardSlip => ({
  status: 'submitted', photos: [], photoCount: 0, items: [], people: 0, laborHours: 0, machineCount: 0, machineHours: 0, ...input,
});
const board = (input: Partial<DailyLogTodayBoard> = {}): DailyLogTodayBoard => ({
  date: '2026-09-29', slips: [], missingFronts: [], summary: null, yesterday: null, days: [], ...input,
});
const roles = { userId: 'eng', canSubmit: false, canSummarize: false, canApprove: false };

describe('Daily Log today board rules', () => {
  it('flags an item late when the forecast passes the plan or the plan date passed unfinished', () => {
    expect(isItemDelayed({ scheduleFinishDate: '2026-10-02', forecastFinishDate: '2026-10-06' }, '2026-09-29')).toBe(true);
    expect(isItemDelayed({ scheduleFinishDate: '2026-10-02', forecastFinishDate: '2026-10-02' }, '2026-09-29')).toBe(false);
    expect(isItemDelayed({ scheduleFinishDate: '2026-09-20', cumulativePercent: 80 }, '2026-09-29')).toBe(true);
    expect(isItemDelayed({ scheduleFinishDate: '2026-09-20', cumulativePercent: 100 }, '2026-09-29')).toBe(false);
    expect(isItemDelayed({ cumulativePercent: 10 }, '2026-09-29')).toBe(false);
  });

  it('lists late items, incidents, returned slips and missing fronts, and ignores unsent drafts', () => {
    const items = buildAttention(board({
      slips: [
        slip({ id: 'a', areaName: 'Mũi 2', issues: 'Ngập hố móng', items: [{ wbsCode: '2.3', taskName: 'Cốt thép', scheduleFinishDate: '2026-10-02', forecastFinishDate: '2026-10-06' }] }),
        slip({ id: 'b', areaName: 'Mũi 3', status: 'returned', authorName: 'KS. Lan', returnReason: 'Thiếu ảnh' }),
        slip({ id: 'c', areaName: 'Mũi 5', status: 'draft', issues: 'Chưa gửi' }),
      ],
      missingFronts: [{ areaCode: 'M4', areaName: 'Mũi 4', authorName: 'KS. Hà', lastDate: '2026-09-28' }],
    }));
    expect(items.map(item => item.tone)).toEqual(['danger', 'warning', 'warning', 'warning']);
    expect(items[0].text).toContain('trễ 4 ngày');
    expect(items[2].text).toContain('Thiếu ảnh');
    expect(items[3].text).toBe('Mũi 4 (KS. Hà) chưa gửi phiếu hôm nay');
  });

  it('counts only sent slips and knows the workflow stage', () => {
    const value = board({ slips: [slip({ id: 'a', areaCode: 'A', people: 10, machineHours: 4 }), slip({ id: 'b', areaCode: 'B', status: 'draft', people: 99 })],
      missingFronts: [{ areaCode: 'C', lastDate: '2026-09-28' }], summary: { id: 's', status: 'submitted' } });
    expect(boardTotals(value)).toMatchObject({ people: 10, machineHours: 4 });
    expect(reportedFronts(value)).toEqual({ sent: 1, expected: 2 });
    expect(boardStage(value)).toBe(2);
  });

  it('gives each role its next step', () => {
    const pending = board({ slips: [slip({ id: 'a', areaCode: 'A', authorUserId: 'eng' })], summary: { id: 's', status: 'submitted', summarizedByName: 'KTT' } });
    expect(buildMyTask(pending, { ...roles, canApprove: true })).toMatchObject({ action: 'review', title: 'Bản tổng hợp chờ bạn duyệt' });
    expect(buildMyTask(board({ slips: [slip({ id: 'a', areaCode: 'A' })], missingFronts: [{ areaCode: 'B', lastDate: '2026-09-28' }] }), { ...roles, canSummarize: true }))
      .toMatchObject({ action: 'summarize', title: '1/2 mũi đã gửi phiếu, chờ tổng hợp' });
    expect(buildMyTask(board(), { ...roles, canSubmit: true })).toMatchObject({ action: 'create', actionLabel: 'Ghi phiếu hôm nay' });
    expect(buildMyTask(board({ slips: [slip({ id: 'r', authorUserId: 'eng', status: 'returned', returnReason: 'Đo lại' })] }), { ...roles, canSubmit: true }))
      .toMatchObject({ action: 'fixReturned', detail: 'Đo lại' });
  });

  it('guards the board read with Room view and keeps drafts private', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260929090000_daily_log_today_board.sql'), 'utf8');
    expect(sql).toContain("'daily_log', 'view')) then");
    expect(sql).toContain("message = 'DAILY_LOG_VIEW_REQUIRED'");
    expect(sql).toContain("(c.status <> 'draft' or c.author_user_id = v_actor)");
    expect(sql).toContain('revoke all on function public.get_daily_log_today_board_v1(text, text, date) from public, anon;');
  });
});
