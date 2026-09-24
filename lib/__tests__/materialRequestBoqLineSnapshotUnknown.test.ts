import { describe, expect, it } from 'vitest';
import type { MaterialRequest } from '../../types';
import { buildSnapshotRows } from '../materialRequestBoqLineSnapshotService';

describe('project request BOQ snapshot evidence', () => {
  it('does not write a zero snapshot for a request with unresolved BOQ or stock', () => {
    const request = {
      id: 'request-1', requestOrigin: 'project', items: [{
        lineId: 'line-1', itemId: 'sand', requestQty: 51, approvedQty: 0,
        materialBudgetItemId: 'budget-1',
      }],
    } as MaterialRequest;
    expect(buildSnapshotRows(request)).toEqual([]);
  });
});
