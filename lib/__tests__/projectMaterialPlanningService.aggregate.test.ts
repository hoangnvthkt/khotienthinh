import { describe, expect, it } from 'vitest';
import { projectMaterialPlanningService } from '../projectMaterialPlanningService';
import { MaterialRequestFulfillmentMode, RequestStatus } from '../../types';

describe('projectMaterialPlanningService.buildAggregateSummary', () => {
  it('groups same material and keeps remaining BOQ separate from near-term shortage', () => {
    const rows = projectMaterialPlanningService.buildAggregateSummary({
      projectId: 'project-1',
      constructionSiteId: 'site-1',
      siteWarehouseId: 'wh-site',
      today: '2026-06-25',
      tasks: [
        { id: 'task-1', name: 'Thi công thép khu A', startDate: '2026-06-26', endDate: '2026-07-10', progress: 0 } as any,
        { id: 'task-2', name: 'Thi công thép khu B', startDate: '2026-06-27', endDate: '2026-07-11', progress: 0 } as any,
      ],
      workBoqItems: [
        { id: 'work-1', name: 'Khu A', sourceTaskId: 'task-1', plannedQty: 1, unitPrice: 0 } as any,
        { id: 'work-2', name: 'Khu B', sourceTaskId: 'task-2', plannedQty: 1, unitPrice: 0 } as any,
      ],
      materialBudgetItems: [
        {
          id: 'mb-1',
          workBoqItemId: 'work-1',
          inventoryItemId: 'item-steel-d8',
          materialCode: 'VT-D8',
          category: 'Thép',
          itemName: 'Thép XD D8',
          unit: 'Kg',
          budgetQty: 100,
          budgetUnitPrice: 14570,
          actualQty: 0,
          wasteThreshold: 1,
        },
        {
          id: 'mb-2',
          workBoqItemId: 'work-2',
          inventoryItemId: 'item-steel-d8',
          materialCode: 'VT-D8',
          category: 'Thép',
          itemName: 'Thép XD D8',
          unit: 'Kg',
          budgetQty: 400,
          budgetUnitPrice: 14570,
          actualQty: 0,
          wasteThreshold: 1,
        },
      ],
      inventoryItems: [
        {
          id: 'item-steel-d8',
          sku: 'VT-D8',
          name: 'Thép XD D8',
          category: 'Thép',
          unit: 'Kg',
          priceIn: 14570,
          priceOut: 14570,
          minStock: 0,
          stockByWarehouse: { 'wh-site': 0 },
        },
      ],
      purchaseOrders: [],
      transactions: [],
      rules: [{ scopeKey: 'project-1_site-1', inventoryItemId: 'item-steel-d8', leadTimeDays: 0, distributionMethod: 'pre_start' }],
      curveTemplates: [],
      requests: [
        {
          id: 'mr-1',
          code: 'MR-1',
          projectId: 'project-1',
          constructionSiteId: 'site-1',
          requestOrigin: 'project',
          siteWarehouseId: 'wh-site',
          requesterId: 'user-1',
          status: RequestStatus.PENDING,
          createdDate: '2026-06-25',
          expectedDate: '2026-06-28',
          fulfillmentMode: MaterialRequestFulfillmentMode.RECEIVE_TO_STOCK,
          items: [
            {
              lineId: 'line-1',
              itemId: 'item-steel-d8',
              requestQty: 125,
              approvedQty: 0,
              materialGroupKey: 'item:item-steel-d8',
            },
          ],
          logs: [],
        },
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].totalBoqQty).toBe(500);
    expect(rows[0].cumulativeRequested).toBe(125);
    expect(rows[0].remainingBoqQty).toBe(375);
    expect(rows[0].demandQty['30d']).toBe(500);
    expect(rows[0].shortageQty['30d']).toBe(500);
  });
});
