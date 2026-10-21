import { describe, expect, it } from 'vitest';
import {
  aggregateAreaWorkItems,
  deriveWorkItemProgress,
  deriveWorkItemProgressFromQuantity,
  validateWorkItemProgressInput,
} from '../dailyLogWorkItemRules';

describe('dailyLogWorkItemRules', () => {
  it('derives cumulative and daily quantities from percent', () => {
    expect(deriveWorkItemProgress({
      plannedQuantity: 200,
      previousCumulativeQuantity: 60,
      cumulativePercent: 40,
    })).toEqual({
      cumulativePercent: 40,
      cumulativeQuantity: 80,
      dailyQuantity: 20,
      conversionStatus: 'ready',
    });
  });

  it('derives percent and daily quantity from cumulative quantity', () => {
    expect(deriveWorkItemProgressFromQuantity({
      plannedQuantity: 200,
      previousCumulativeQuantity: 60,
      cumulativeQuantity: 80,
    })).toMatchObject({
      cumulativePercent: 40,
      cumulativeQuantity: 80,
      dailyQuantity: 20,
    });
  });

  it('rejects conflicting percent and cumulative quantity inputs', () => {
    expect(validateWorkItemProgressInput({
      plannedQuantity: 200,
      cumulativePercent: 40,
      cumulativeQuantity: 90,
    })).toEqual({ valid: false, errorCode: 'inconsistent_progress_inputs' });
  });

  it('rejects negative cumulative progress even when percent and quantity agree', () => {
    expect(validateWorkItemProgressInput({
      plannedQuantity: 200,
      cumulativePercent: -10,
      cumulativeQuantity: -20,
    })).toEqual({ valid: false, errorCode: 'progress_below_allowed_minimum' });
  });

  it('rejects cumulative progress below the official baseline', () => {
    expect(validateWorkItemProgressInput({
      plannedQuantity: 200,
      cumulativePercent: 25,
      cumulativeQuantity: 50,
      baselineProgressPercent: 30,
    })).toEqual({ valid: false, errorCode: 'progress_below_baseline' });
  });

  it('rejects backdated progress above the next official value', () => {
    expect(validateWorkItemProgressInput({
      plannedQuantity: 200,
      cumulativePercent: 45,
      cumulativeQuantity: 90,
      nextProgressPercent: 40,
    })).toEqual({ valid: false, errorCode: 'progress_above_next' });
  });

  it('allows progress above 100 only when the leaf task permits it', () => {
    expect(validateWorkItemProgressInput({
      plannedQuantity: 200,
      cumulativePercent: 110,
      cumulativeQuantity: 220,
    })).toEqual({ valid: false, errorCode: 'progress_above_allowed_maximum' });

    expect(validateWorkItemProgressInput({
      plannedQuantity: 200,
      cumulativePercent: 110,
      cumulativeQuantity: 220,
      allowOver100: true,
    })).toEqual({ valid: true, errorCode: null });
  });

  it('keeps quantities unknown when planned quantity is missing', () => {
    expect(deriveWorkItemProgress({
      plannedQuantity: null,
      previousCumulativeQuantity: null,
      cumulativePercent: 25,
    })).toMatchObject({
      cumulativePercent: 25,
      cumulativeQuantity: null,
      dailyQuantity: null,
      conversionStatus: 'missing_planned_quantity',
    });
  });

  it('requires an official cumulative value for the same task without area allocation', () => {
    const result = aggregateAreaWorkItems([
      { id: 'a', taskId: 'task-1', workAreaCode: 'A', areaPlannedQuantity: null, cumulativePercent: 30, dailyQuantity: 5 },
      { id: 'b', taskId: 'task-1', workAreaCode: 'B', areaPlannedQuantity: null, cumulativePercent: 45, dailyQuantity: 7 },
    ]);

    expect(result[0].conflicts).toContain('missing_area_allocation');
    expect(result[0].conflicts).toContain('duplicate_daily_quantity');
    expect(result[0].officialCumulativePercent).toBeNull();
    expect(result[0].dailyQuantity).toBeNull();
  });

  it('một mũi chưa chia khối lượng riêng: quy đổi theo khối lượng hạng mục (DA29 4.1.1.9: 85% × 2,766 m³)', () => {
    const [single] = aggregateAreaWorkItems([
      { id: 'a', taskId: 'task-1', workAreaCode: 'NX1', areaPlannedQuantity: null, plannedQuantity: 2.766, cumulativePercent: 85, dailyQuantity: null },
    ]);
    expect(single.cumulativeQuantity).toBe(2.3511);
    expect(single.conflicts).toEqual([]);
    // Hai mũi chưa chia vẫn phải chia khối lượng, không lấy khối lượng hạng mục cho cả hai.
    const [shared] = aggregateAreaWorkItems([
      { id: 'a', taskId: 'task-1', workAreaCode: 'A', areaPlannedQuantity: null, plannedQuantity: 100, cumulativePercent: 30, dailyQuantity: 5 },
      { id: 'b', taskId: 'task-1', workAreaCode: 'B', areaPlannedQuantity: null, plannedQuantity: 100, cumulativePercent: 45, dailyQuantity: 7 },
    ]);
    expect(shared.conflicts).toContain('missing_area_allocation');
  });

  it('weights the same task by allocated planned quantity', () => {
    const result = aggregateAreaWorkItems([
      { id: 'a', taskId: 'task-1', workAreaCode: 'A', areaPlannedQuantity: 100, cumulativePercent: 20, dailyQuantity: 5 },
      { id: 'b', taskId: 'task-1', workAreaCode: 'B', areaPlannedQuantity: 300, cumulativePercent: 60, dailyQuantity: 7 },
    ]);

    expect(result[0].officialCumulativePercent).toBe(50);
    expect(result[0].dailyQuantity).toBe(12);
  });
});
