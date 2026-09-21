import { describe, expect, it } from 'vitest';
import {
  buildBoqPlanPreview,
  calculateBoqBalance,
  groupBoqTreePage,
} from '../materialPlanning/boqMaterialSelectors';
import type { BoqMaterialBudgetLine, BoqMaterialTreeNode } from '../../types/materialPlanning';

const balance = (patch: Partial<Parameters<typeof calculateBoqBalance>[0]> = {}) => calculateBoqBalance({
  unit: 'kg',
  budget: '100',
  issuedNet: '60',
  open: {
    awaitingApproval: '10',
    awaitingArrangement: '0',
    executing: '0',
  },
  closed: '0',
  issues: [],
  ...patch,
});

const line = (patch: Partial<BoqMaterialBudgetLine> = {}): BoqMaterialBudgetLine => ({
  id: 'budget-1',
  workBoqItemId: 'work-1',
  taskId: 'task-1',
  itemId: 'item-steel',
  sku: 'STEEL',
  itemName: 'Steel',
  category: 'Metal',
  unit: 'kg',
  suggestedQty30d: '20',
  unitPrice: null,
  balance: balance(),
  issues: [],
  ...patch,
});

describe('BOQ material balance', () => {
  it('keeps B/I/O/C separate and derives uncovered and excess', () => {
    expect(balance()).toMatchObject({
      budget: '100',
      issuedNet: '60',
      open: { awaitingApproval: '10', awaitingArrangement: '0', executing: '0' },
      closed: '0',
      uncovered: '30',
      excess: '0',
      completeness: 'complete',
      selectable: true,
    });

    expect(balance({ issuedNet: '110', open: { awaitingApproval: '5', awaitingArrangement: '0', executing: '0' } }))
      .toMatchObject({ uncovered: '0', excess: '15' });
  });

  it('preserves unknown and rejects malformed or negative quantities', () => {
    expect(balance({ issuedNet: null })).toMatchObject({
      uncovered: null,
      excess: null,
      completeness: 'unknown',
      selectable: false,
    });
    expect(() => balance({ budget: '-1' })).toThrow('INVALID_QUANTITY');
    expect(() => balance({ budget: '1.0000001' })).toThrow('INVALID_QUANTITY');
  });
});

describe('BOQ material preview', () => {
  it('keeps exact source allocations while grouping the same item and unit', () => {
    const preview = buildBoqPlanPreview({
      lines: [
        { line: line({ id: 'budget-1' }), draftQty: '10', neededDate: '2026-09-25', destination: 'Zone A' },
        { line: line({ id: 'budget-2', workBoqItemId: 'work-2' }), draftQty: '5', neededDate: '2026-09-26', destination: 'Zone A' },
      ],
    });

    expect(preview.groups).toHaveLength(1);
    expect(preview.groups[0]).toMatchObject({ itemId: 'item-steel', unit: 'kg', totalQty: '15' });
    expect(preview.groups[0].allocations).toEqual([
      expect.objectContaining({ sourceBudgetLineId: 'budget-1', quantity: '10' }),
      expect.objectContaining({ sourceBudgetLineId: 'budget-2', quantity: '5' }),
    ]);
  });

  it('does not aggregate different units and blocks unknown or excessive input', () => {
    const preview = buildBoqPlanPreview({
      lines: [
        { line: line({ id: 'budget-kg' }), draftQty: '10', neededDate: '2026-09-25', destination: 'Zone A' },
        { line: line({ id: 'budget-bag', unit: 'bag', balance: balance({ unit: 'bag' }) }), draftQty: '5', neededDate: '2026-09-25', destination: 'Zone A' },
      ],
    });
    expect(preview.groups.map(group => [group.unit, group.totalQty])).toEqual([['bag', '5'], ['kg', '10']]);

    expect(() => buildBoqPlanPreview({
      lines: [{ line: line({ balance: balance({ issuedNet: null }) }), draftQty: '1', neededDate: '2026-09-25', destination: 'Zone A' }],
    })).toThrow('BOQ_PREVIEW_SOURCE_UNKNOWN');
    expect(() => buildBoqPlanPreview({
      lines: [{ line: line(), draftQty: '31', neededDate: '2026-09-25', destination: 'Zone A' }],
    })).toThrow('BOQ_PREVIEW_QUANTITY_EXCEEDS_UNCOVERED');
  });
});

describe('BOQ tree page grouping', () => {
  it('reports quantities per unit instead of a mixed physical total', () => {
    const node: BoqMaterialTreeNode = {
      id: 'work-1', parentId: null, taskId: 'task-1', wbsCode: '1.1', name: 'Foundation',
      sortOrder: 1, childCount: 0, materials: [
        line({ id: 'budget-kg' }),
        line({ id: 'budget-bag', itemId: 'item-cement', unit: 'bag', balance: balance({ unit: 'bag', budget: '20', issuedNet: '0' }) }),
      ],
    };
    const page = groupBoqTreePage({
      scope: { projectId: 'project-1', constructionSiteId: 'site-1' },
      asOf: '2026-09-21T00:00:00.000Z', metricVersion: 'version-1',
      nodes: [node], nextCursor: null,
      totals: { workNodeCount: 1, materialLineCount: 2, selectableLineCount: 2, unallocatedEffectCount: 0 },
      capabilities: { canViewPrice: false },
    });
    expect(page.nodes[0].quantityGroups).toEqual([{ unit: 'bag', lineCount: 1 }, { unit: 'kg', lineCount: 1 }]);
    expect(page.nodes[0]).not.toHaveProperty('totalQuantity');
  });
});
