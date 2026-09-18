import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const cloudRequestStatuses = new Set(['APPROVED', 'IN_TRANSIT']);

  const from = vi.fn((table: string) => {
    const query: Record<string, any> = {};
    query.select = vi.fn(() => query);
    query.eq = vi.fn(() => query);
    query.in = vi.fn((column: string, values: string[]) => {
      if (table === 'requests' && column === 'status') {
        const invalidStatus = values.find(value => !cloudRequestStatuses.has(value));
        if (invalidStatus) {
          throw new Error(`invalid input value for enum request_status: "${invalidStatus}"`);
        }
      }
      return query;
    });
    query.order = vi.fn(() => query);
    query.limit = vi.fn(() => query);
    query.or = vi.fn(() => query);
    query.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve);
    return query;
  });

  return { from };
});

vi.mock('../supabase', () => ({ supabase: { from: mocks.from } }));

import { companyProcurementService } from '../companyProcurementService';

describe('company procurement open demand status filter', () => {
  it('loads open demand using only values accepted by the Cloud request_status enum', async () => {
    await expect(companyProcurementService.listOpenDemand()).resolves.toEqual([]);
  });
});
