import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');

describe('dependent Room Gantt catalog adapters', () => {
  it('hard-codes the consumer Room in one adapter per dependent Room', () => {
    const source = read('lib', 'projectGanttCatalogAdapters.ts');
    for (const [adapter, room] of [
      ['loadDailyLogGanttCatalog', 'daily_log'],
      ['loadWeeklyProgressGanttCatalog', 'weekly_progress'],
      ['loadMaterialPlanningGanttCatalog', 'material_planning'],
      ['loadQuantityAcceptanceGanttCatalog', 'quantity_acceptance'],
      ['loadQualityGanttCatalog', 'quality'],
      ['loadPaymentGanttCatalog', 'payment'],
    ]) {
      expect(source).toContain(`export const ${adapter}`);
      expect(source).toContain(`scope, '${room}'`);
    }
  });

  it('replaces direct task reads in Daily, Weekly, Material and Quality Rooms', () => {
    for (const [file, adapter] of [
      ['DailyLogTab.tsx', 'loadDailyLogGanttCatalog'],
      ['WeeklyProgressTab.tsx', 'loadWeeklyProgressGanttCatalog'],
      ['MaterialTab.tsx', 'loadMaterialPlanningGanttCatalog'],
      ['QualityTab.tsx', 'loadQualityGanttCatalog'],
    ]) {
      const source = read('pages', 'project', file);
      expect(source).toContain(adapter);
      expect(source).not.toContain('taskService.list(');
    }
  });

  it('replaces direct task/link reads in Quantity Acceptance and Payment consumers', () => {
    const quantity = read('lib', 'quantityAcceptanceService.ts');
    expect(quantity).toContain('loadQuantityAcceptanceGanttCatalog');
    expect(quantity).not.toContain(".from('project_tasks')");
    expect(quantity).not.toContain('taskContractItemService.listBySite');

    for (const parts of [
      ['lib', 'paymentEligibilityService.ts'],
      ['lib', 'paymentScheduleWorkbenchService.ts'],
      ['components', 'project', 'ContractPaymentSchedulePanel.tsx'],
    ]) {
      const source = read(...parts);
      expect(source).toContain('loadPaymentGanttCatalog');
      expect(source).not.toContain('taskService.list(');
    }
  });
});
