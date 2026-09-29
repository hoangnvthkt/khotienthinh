import type {
  AggregatedDailyLogWorkItem,
  DerivedWorkItemProgress,
} from '../types';

const PROGRESS_TOLERANCE = 0.0001;

const roundQuantity = (value: number): number =>
  Math.round((value + Number.EPSILON) * 10_000) / 10_000;

export interface AreaWorkItemProgressInput {
  id: string;
  taskId: string;
  workAreaCode: string;
  areaPlannedQuantity: number | null;
  cumulativePercent: number;
  dailyQuantity: number | null;
}

export interface ValidateWorkItemProgressInput {
  plannedQuantity: number;
  cumulativePercent: number;
  cumulativeQuantity: number;
  baselineProgressPercent?: number | null;
  nextProgressPercent?: number | null;
  allowOver100?: boolean;
}

export type WorkItemProgressValidationError =
  | 'inconsistent_progress_inputs'
  | 'progress_below_allowed_minimum'
  | 'progress_below_baseline'
  | 'progress_above_next'
  | 'progress_above_allowed_maximum';

export type WorkItemProgressValidationResult =
  | { valid: true; errorCode: null }
  | { valid: false; errorCode: WorkItemProgressValidationError };

export const deriveWorkItemProgress = (input: {
  plannedQuantity: number | null;
  previousCumulativeQuantity: number | null;
  cumulativePercent: number;
}): DerivedWorkItemProgress => {
  if (!Number.isFinite(input.plannedQuantity) || Number(input.plannedQuantity) <= 0) {
    return {
      cumulativePercent: input.cumulativePercent,
      cumulativeQuantity: null,
      dailyQuantity: null,
      conversionStatus: 'missing_planned_quantity',
    };
  }

  const cumulativeQuantity = roundQuantity(
    Number(input.plannedQuantity) * input.cumulativePercent / 100,
  );
  return {
    cumulativePercent: input.cumulativePercent,
    cumulativeQuantity,
    dailyQuantity: roundQuantity(cumulativeQuantity - Number(input.previousCumulativeQuantity ?? 0)),
    conversionStatus: 'ready',
  };
};

export const deriveWorkItemProgressFromQuantity = (input: {
  plannedQuantity: number;
  previousCumulativeQuantity: number | null;
  cumulativeQuantity: number;
}): DerivedWorkItemProgress => ({
  cumulativePercent: roundQuantity(input.cumulativeQuantity / input.plannedQuantity * 100),
  cumulativeQuantity: input.cumulativeQuantity,
  dailyQuantity: roundQuantity(input.cumulativeQuantity - Number(input.previousCumulativeQuantity ?? 0)),
  conversionStatus: 'ready',
});

export const validateWorkItemProgressInput = (
  input: ValidateWorkItemProgressInput,
): WorkItemProgressValidationResult => {
  if (
    input.plannedQuantity <= 0
    || input.cumulativePercent < 0
    || input.cumulativeQuantity < 0
  ) {
    return { valid: false, errorCode: 'progress_below_allowed_minimum' };
  }
  const derivedQuantity = input.plannedQuantity * input.cumulativePercent / 100;
  if (Math.abs(derivedQuantity - input.cumulativeQuantity) > PROGRESS_TOLERANCE) {
    return { valid: false, errorCode: 'inconsistent_progress_inputs' };
  }
  if (
    input.baselineProgressPercent != null
    && input.cumulativePercent + PROGRESS_TOLERANCE < input.baselineProgressPercent
  ) {
    return { valid: false, errorCode: 'progress_below_baseline' };
  }
  if (
    input.nextProgressPercent != null
    && input.cumulativePercent - PROGRESS_TOLERANCE > input.nextProgressPercent
  ) {
    return { valid: false, errorCode: 'progress_above_next' };
  }
  if (!input.allowOver100 && input.cumulativePercent > 100 + PROGRESS_TOLERANCE) {
    return { valid: false, errorCode: 'progress_above_allowed_maximum' };
  }
  return { valid: true, errorCode: null };
};

export const aggregateAreaWorkItems = (
  items: AreaWorkItemProgressInput[],
): AggregatedDailyLogWorkItem[] => {
  const groups = new Map<string, AreaWorkItemProgressInput[]>();
  for (const item of items) {
    groups.set(item.taskId, [...(groups.get(item.taskId) ?? []), item]);
  }

  return [...groups.entries()].map(([taskId, taskItems]) => {
    const sourceWorkItemIds = taskItems.map(item => item.id);
    const dailyQuantity = taskItems.every(item => item.dailyQuantity != null)
      ? roundQuantity(taskItems.reduce((sum, item) => sum + Number(item.dailyQuantity), 0))
      : null;

    if (taskItems.length === 1) {
      const [item] = taskItems;
      const cumulativeQuantity = item.areaPlannedQuantity != null && item.areaPlannedQuantity > 0
        ? roundQuantity(item.areaPlannedQuantity * item.cumulativePercent / 100)
        : null;
      return {
        taskId,
        officialCumulativePercent: item.cumulativePercent,
        cumulativeQuantity,
        dailyQuantity,
        conflicts: [],
        sourceWorkItemIds,
      };
    }

    const hasCompleteAllocation = taskItems.every(
      item => Number.isFinite(item.areaPlannedQuantity) && Number(item.areaPlannedQuantity) > 0,
    );
    if (!hasCompleteAllocation) {
      return {
        taskId,
        officialCumulativePercent: null,
        cumulativeQuantity: null,
        dailyQuantity: null,
        conflicts: ['missing_area_allocation', 'duplicate_daily_quantity'],
        sourceWorkItemIds,
      };
    }

    const allocatedQuantity = taskItems.reduce(
      (sum, item) => sum + Number(item.areaPlannedQuantity),
      0,
    );
    const cumulativeQuantity = roundQuantity(taskItems.reduce(
      (sum, item) => sum + Number(item.areaPlannedQuantity) * item.cumulativePercent / 100,
      0,
    ));
    return {
      taskId,
      officialCumulativePercent: roundQuantity(cumulativeQuantity / allocatedQuantity * 100),
      cumulativeQuantity,
      dailyQuantity,
      conflicts: [],
      sourceWorkItemIds,
    };
  });
};
