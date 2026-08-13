import { describe, expect, it } from 'vitest';
import type { ProjectFinance } from '../../types';
import { buildProjectActualProductionUpdate } from '../projectActualProduction';

const existingFinance: ProjectFinance = {
  id: 'finance-1',
  projectId: 'project-1',
  constructionSiteId: 'site-1',
  contractValue: 12_000_000,
  budgetMaterials: 1_000_000,
  budgetLabor: 2_000_000,
  budgetSubcontract: 3_000_000,
  budgetMachinery: 4_000_000,
  budgetOverhead: 5_000_000,
  actualMaterials: 100_000,
  actualLabor: 200_000,
  actualSubcontract: 300_000,
  actualMachinery: 400_000,
  actualOverhead: 500_000,
  revenueReceived: 600_000,
  revenuePending: 700_000,
  progressPercent: 35,
  actualProductionValue: 1_000_000,
  actualProductionNote: 'Lần trước',
  status: 'active',
  notes: 'Giữ nguyên ghi chú tài chính',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('buildProjectActualProductionUpdate', () => {
  it('updates only the production checkpoint and audit metadata on an existing finance row', () => {
    const result = buildProjectActualProductionUpdate({
      current: existingFinance,
      projectId: 'project-1',
      constructionSiteId: 'site-1',
      value: 4_500_000,
      note: 'Khối lượng xác nhận đến tuần 32',
      actorId: 'user-1',
      updatedAt: '2026-08-13T09:30:00.000Z',
      newId: 'unused-id',
    });

    expect(result).toEqual({
      ...existingFinance,
      actualProductionValue: 4_500_000,
      actualProductionNote: 'Khối lượng xác nhận đến tuần 32',
      actualProductionUpdatedAt: '2026-08-13T09:30:00.000Z',
      actualProductionUpdatedBy: 'user-1',
      updatedAt: '2026-08-13T09:30:00.000Z',
    });
  });

  it('creates a valid finance row when the project has no finance record yet', () => {
    const result = buildProjectActualProductionUpdate({
      current: null,
      projectId: 'project-1',
      constructionSiteId: 'site-1',
      value: 250_000,
      note: '  Chốt lần đầu  ',
      actorId: 'user-1',
      updatedAt: '2026-08-13T10:00:00.000Z',
      newId: 'finance-new',
    });

    expect(result).toMatchObject({
      id: 'finance-new',
      projectId: 'project-1',
      constructionSiteId: 'site-1',
      contractValue: 0,
      budgetMaterials: 0,
      actualMaterials: 0,
      revenueReceived: 0,
      progressPercent: 0,
      status: 'planning',
      actualProductionValue: 250_000,
      actualProductionNote: 'Chốt lần đầu',
      actualProductionUpdatedAt: '2026-08-13T10:00:00.000Z',
      actualProductionUpdatedBy: 'user-1',
      updatedAt: '2026-08-13T10:00:00.000Z',
    });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    'rejects an invalid production value: %s',
    value => {
      expect(() => buildProjectActualProductionUpdate({
        current: existingFinance,
        projectId: 'project-1',
        constructionSiteId: 'site-1',
        value,
        note: '',
        actorId: 'user-1',
        updatedAt: '2026-08-13T10:00:00.000Z',
        newId: 'unused-id',
      })).toThrow('Giá trị sản lượng không hợp lệ');
    },
  );
});
