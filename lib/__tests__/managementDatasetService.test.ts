import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: { rpc: mocks.rpc } }));

import { managementDatasetService } from '../managementDatasetService';

const payload = (overrides: Record<string, unknown> = {}) => ({
  metricVersion: 'g8.management.dataset.v1',
  asOf: '2026-09-21T08:00:00.000Z',
  staleAfter: '2026-09-21T08:05:00.000Z',
  filter: { viewId: 'M05', projectId: null, constructionSiteId: null },
  capabilities: { canViewFinancials: false, canExport: true },
  options: { projects: [{ id: 'project-1', name: 'Dự án A', constructionSiteId: 'site-1' }] },
  catalog: [{ id: 'executive.intervention.count', viewId: 'M05', definitionVersion: '1.0.0', label: 'Dự án cần can thiệp', unit: 'record', currency: null, vatBasis: 'not_applicable', availability: 'available', unavailableReason: null }],
  totals: { rowCount: 1, criticalCount: 1, warningCount: 0, unknownCount: 0 },
  rows: [{ id: 'M05:project-1', viewId: 'M05', metricId: 'executive.intervention.count', metricDefinitionVersion: '1.0.0', title: 'Dự án A', severity: 'critical', projectId: 'project-1', constructionSiteId: 'site-1', ownerId: null, ownerName: null, dueAt: null, value: 2, unit: 'record', currency: null, vatBasis: 'not_applicable', completeness: 'complete', qualityIssues: [], source: { type: 'management_dataset', id: 'project-1', label: 'Dự án A', inferred: false }, drill: { type: 'project', id: 'project-1', path: '/da' } }],
  nextCursor: null,
  ...overrides,
});

describe('managementDatasetService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    managementDatasetService.clearCache();
    managementDatasetService.setActor('management-test-actor');
  });

  it('maps one strict versioned page and preserves unknown values', async () => {
    mocks.rpc.mockResolvedValue({ data: payload({ rows: [{
      ...payload().rows[0], value: null, completeness: 'unknown', qualityIssues: ['SOURCE_NOT_READY'],
    }], totals: { rowCount: 1, criticalCount: 1, warningCount: 0, unknownCount: 1 } }), error: null });

    const page = await managementDatasetService.list({ viewId: 'M05', limit: 50 });

    expect(mocks.rpc).toHaveBeenCalledWith('list_management_dataset_v1', {
      p_filter: { viewId: 'M05' }, p_cursor: null, p_limit: 50, p_as_of: null,
    });
    expect(page.rows[0].value).toBeNull();
    expect(page.rows[0].completeness).toBe('unknown');
  });

  it('propagates denied reads and invalid payloads instead of returning empty data', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'denied' } });
    await expect(managementDatasetService.list({ viewId: 'M05' }))
      .rejects.toMatchObject({ code: '42501' });

    mocks.rpc.mockResolvedValueOnce({ data: payload({ metricVersion: 'legacy' }), error: null });
    await expect(managementDatasetService.list({ viewId: 'M05' }))
      .rejects.toThrow('MANAGEMENT_DATASET_VERSION_INVALID');
  });

  it('deduplicates the same in-flight read and invalidates cache after a source event', async () => {
    let resolve!: (value: unknown) => void;
    mocks.rpc.mockReturnValueOnce(new Promise(value => { resolve = value; }));
    const first = managementDatasetService.list({ viewId: 'M02', projectId: 'project-1' });
    const second = managementDatasetService.list({ viewId: 'M02', projectId: 'project-1' });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    resolve({ data: payload({ filter: { viewId: 'M02', projectId: 'project-1' } }), error: null });
    await Promise.all([first, second]);

    await managementDatasetService.list({ viewId: 'M02', projectId: 'project-1' });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    managementDatasetService.invalidate({ table: 'purchase_order_delivery_batches', projectId: 'project-1' });
    mocks.rpc.mockResolvedValueOnce({ data: payload({ filter: { viewId: 'M02', projectId: 'project-1' } }), error: null });
    await managementDatasetService.list({ viewId: 'M02', projectId: 'project-1' });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it('exports every page with the first page filter, version, and cutoff', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: payload({ nextCursor: '1:snapshot' }), error: null })
      .mockResolvedValueOnce({ data: payload({ rows: [{ ...payload().rows[0], id: 'M05:project-2' }], nextCursor: null }), error: null });

    const result = await managementDatasetService.listAllForExport({ viewId: 'M05', search: 'trễ' });

    expect(result.rows).toHaveLength(2);
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'list_management_dataset_v1', {
      p_filter: { viewId: 'M05', search: 'trễ' },
      p_cursor: '1:snapshot', p_limit: 200, p_as_of: '2026-09-21T08:00:00.000Z',
    });
  });

  it('clears cached scope when the authenticated actor changes', async () => {
    mocks.rpc.mockResolvedValue({ data: payload(), error: null });
    managementDatasetService.setActor('actor-a');
    await managementDatasetService.list({ viewId: 'M05' });
    await managementDatasetService.list({ viewId: 'M05' });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);

    managementDatasetService.setActor('actor-b');
    await managementDatasetService.list({ viewId: 'M05' });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
});
