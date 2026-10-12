import { describe, expect, it } from 'vitest';
import { buildMyCalendar, leavePartLabel } from '../myAttendanceCalendar';
import type { LeaveRequestRow } from '../leaveService';
import type { TimesheetDay } from '../timesheetService';

const day = (date: string, status: string) => ({ date, status } as TimesheetDay);
const leave = (patch: Partial<LeaveRequestRow>) => ({
  id: 'l1', type: 'annual', startDate: '2026-10-14', endDate: '2026-10-15', status: 'pending', startSession: 'full', endSession: 'afternoon',
  ...patch,
}) as LeaveRequestRow;

describe('buildMyCalendar', () => {
  it('lưới bắt đầu thứ Hai, đủ tuần, gắn bảng công và đơn nghỉ theo ngày', () => {
    const cells = buildMyCalendar(2026, 10, [day('2026-10-01', 'absent'), day('2026-10-02', 'present')], [
      leave({}), leave({ id: 'l2', status: 'cancelled', startDate: '2026-10-20', endDate: '2026-10-20' }),
    ]);
    // 01/10/2026 là thứ Năm → 3 ô tháng trước (T2 28/09, T3 29/09, T4 30/09).
    expect(cells[0]).toMatchObject({ date: '2026-09-28', inMonth: false });
    expect(cells[3]).toMatchObject({ date: '2026-10-01', inMonth: true, day: 1 });
    expect(cells[3].timesheet?.status).toBe('absent');
    expect(cells.length % 7).toBe(0);
    expect(cells.at(-1)?.date).toBe('2026-11-01');
    expect(cells.find(c => c.date === '2026-10-15')?.leaves.map(l => l.id)).toEqual(['l1']);
    expect(cells.find(c => c.date === '2026-10-20')?.leaves).toEqual([]);
  });

  it('nhãn buổi chỉ ở ngày đầu / cuối đơn nghỉ', () => {
    const l = leave({});
    expect(leavePartLabel(l, '2026-10-14')).toBe('');
    expect(leavePartLabel(l, '2026-10-15')).toBe(' (chiều)');
  });
});
