import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectGanttCommandError } from '../projectGanttCommandService';

const mocks = vi.hoisted(() => ({
  listSchedules: vi.fn(),
  listCustomers: vi.fn(),
  listSubcontractors: vi.fn(),
  loadPaymentGanttCatalog: vi.fn(),
}));

vi.mock('../projectService', () => ({
  paymentService: { listScoped: mocks.listSchedules },
}));

vi.mock('../hdService', () => ({
  customerContractService: { listBySite: mocks.listCustomers },
  subcontractorContractService: { listBySite: mocks.listSubcontractors },
}));

vi.mock('../projectGanttCatalogAdapters', () => ({
  loadPaymentGanttCatalog: mocks.loadPaymentGanttCatalog,
}));

import { paymentScheduleWorkbenchService } from '../paymentScheduleWorkbenchService';

describe('paymentScheduleWorkbenchService', () => {
  beforeEach(() => {
    mocks.listSchedules.mockReset();
    mocks.listCustomers.mockReset();
    mocks.listSubcontractors.mockReset();
    mocks.loadPaymentGanttCatalog.mockReset();
    mocks.listSchedules.mockResolvedValue([]);
    mocks.listCustomers.mockResolvedValue([]);
    mocks.listSubcontractors.mockResolvedValue([]);
  });

  it('still loads payment schedules when Gantt catalog access is denied', async () => {
    mocks.listSchedules.mockResolvedValue([{
      id: 'schedule-1',
      projectId: 'project-1',
      constructionSiteId: 'site-1',
      type: 'receivable',
      status: 'pending',
      description: 'Đợt thanh toán 1',
      amount: 1_000_000,
      paidAmount: 0,
      dueDate: '2099-01-01',
      plannedTaskIds: ['task-private'],
    }]);
    mocks.loadPaymentGanttCatalog.mockRejectedValue(
      new ProjectGanttCommandError('GANTT_PERMISSION_DENIED'),
    );

    const result = await paymentScheduleWorkbenchService.getWorkbench({
      projectId: 'project-1',
      constructionSiteId: 'site-1',
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      id: 'schedule-1',
      description: 'Đợt thanh toán 1',
      plannedTasks: [],
    });
    expect(result.summary.totalReceivable).toBe(1_000_000);
  });
});
