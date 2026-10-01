import { describe, expect, it } from 'vitest';
import {
  formatWorkPlanPeriod, mapWorkPlanError, normalizeWorkPlanPeriodStart, shiftWorkPlanPeriod, workPlanLineAchievement,
  workPlanPeriodEnd,
} from '../projectWorkPlanService';

describe('work plan periods', () => {
  it('starts months on the 1st and weeks on Monday', () => {
    expect(normalizeWorkPlanPeriodStart('month', '2026-10-17')).toBe('2026-10-01');
    expect(normalizeWorkPlanPeriodStart('week', '2026-10-04')).toBe('2026-09-28');
    expect(normalizeWorkPlanPeriodStart('week', '2026-09-28')).toBe('2026-09-28');
  });

  it('moves and ends periods across month and year boundaries', () => {
    expect(shiftWorkPlanPeriod('month', '2026-12-01', 1)).toBe('2027-01-01');
    expect(shiftWorkPlanPeriod('week', '2026-12-28', 1)).toBe('2027-01-04');
    expect(workPlanPeriodEnd('month', '2026-02-01')).toBe('2026-02-28');
    expect(workPlanPeriodEnd('week', '2026-09-28')).toBe('2026-10-04');
  });

  it('labels periods for people', () => {
    expect(formatWorkPlanPeriod('month', '2026-10-01')).toBe('Tháng 10/2026');
    expect(formatWorkPlanPeriod('week', '2026-09-28')).toBe('Tuần 40 (28/09 – 04/10/2026)');
  });
});

describe('work plan achievement', () => {
  it('is unknown, not zero, when nothing was recorded or nothing planned', () => {
    expect(workPlanLineAchievement({ plannedQty: 10, actualQty: null })).toBeNull();
    expect(workPlanLineAchievement({ plannedQty: null, actualQty: 3 })).toBeNull();
    expect(workPlanLineAchievement({ plannedQty: 0, actualQty: 3 })).toBeNull();
    expect(workPlanLineAchievement({ plannedQty: 10, actualQty: 0 })).toBe(0);
    expect(workPlanLineAchievement({ plannedQty: 8, actualQty: 10 })).toBe(125);
  });

  it('turns server codes into Vietnamese guidance', () => {
    expect(mapWorkPlanError({ message: 'WORK_PLAN_ALREADY_OPEN' }).message).toContain('đã có một bản kế hoạch');
    expect(mapWorkPlanError({ message: 'something else' }).message).toContain('Không thực hiện được');
  });
});
