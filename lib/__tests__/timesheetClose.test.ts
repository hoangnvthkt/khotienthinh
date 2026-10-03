import { describe, expect, it } from 'vitest';
import type { EmployeeTimesheet, TimesheetDay } from '../timesheetService';
import { collectIssues, daySymbol, payableDays } from '../timesheetClose';

const day = (patch: Partial<TimesheetDay>): TimesheetDay => ({
  date: '2026-10-01', weekday: 4, shiftName: 'Ca', shiftStart: '08:00', shiftEnd: '17:00', checkIn: null, checkOut: null, status: 'present',
  leaveType: null, leaveName: null, leavePart: null, workCredit: 1, lateMinutes: 0, earlyMinutes: 0, lateBlock: 0, earlyBlock: 0,
  excusedLate: 0, excusedEarly: 0, extraMinutes: 0, workedMinutes: 0, locationName: null, flags: [], ...patch,
});
const row = (days: TimesheetDay[]): EmployeeTimesheet => ({
  employeeId: 'e1', employeeCode: 'TT1', fullName: 'Nguyễn A', orgUnitName: null,
  timesheet: { days, totals: {} as EmployeeTimesheet['timesheet']['totals'] },
});

describe('timesheet closing', () => {
  it('prints paper-timesheet symbols', () => {
    expect(daySymbol(day({}))).toBe('X');
    expect(daySymbol(day({ workCredit: 0.5 }))).toBe('½');
    expect(daySymbol(day({ status: 'leave', leaveType: 'annual' }))).toBe('P');
    expect(daySymbol(day({ status: 'leave', leaveType: 'unpaid', leavePart: 'morning' }))).toBe('KL½');
    expect(daySymbol(day({ status: 'leave', leaveType: 'sick' }))).toBe('BH');
    expect(daySymbol(day({ status: 'absent' }))).toBe('V');
    expect(daySymbol(day({ status: 'not_employed' }))).toBe('–');
    expect(daySymbol(day({ status: 'future' }))).toBe('');
  });

  it('pays worked days, company-paid leave and holidays', () => {
    expect(payableDays({ workDays: 20.5, paidLeaveDays: 1, holidays: 1 })).toBe(22.5);
  });

  it('lists pending requests first (they block sending) and skips adjusted days', () => {
    const issues = collectIssues({
      employees: [row([day({ date: '2026-10-01', status: 'absent' }), day({ date: '2026-10-02', status: 'missing_punch', checkIn: '07:50' }), day({ date: '2026-10-03', status: 'absent' })])],
      adjustments: [{ id: 'a', employeeId: 'e1', date: '2026-10-03', kind: 'credit', value: 1, before: 0, reason: 'xác nhận', byName: 'HR', at: '' }],
      feedback: [],
      pending: [{ kind: 'leave', employeeId: 'e1', date: '2026-10-05', label: 'Đơn NP-1' }],
    });
    expect(issues.map(item => item.kind)).toEqual(['pending', 'missing_punch', 'absent']);
    expect(issues[0].blocking).toBe(true);
    expect(issues[1].label).toBe('Vào 07:50, thiếu lượt ra');
  });
});
