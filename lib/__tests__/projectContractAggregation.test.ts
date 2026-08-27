import { describe, expect, it } from 'vitest';
import {
  buildProjectContractViews,
  contractMatchesProjectFilter,
  filterContractOverviewGroups,
  filterProjectContractViews,
  removeSupplierContractDeepLink,
  summarizeProjectContracts,
} from '../projectContractAggregation';
import type { CustomerContract, SubcontractorContract, SupplierContract } from '../../types';

const customerContract = {
  id: 'customer-1',
  code: 'HD-NT-001',
  name: 'Hợp đồng thi công chính',
  customerName: 'Chủ đầu tư A',
  type: 'construction',
  value: 1_000_000_000,
  currency: 'VND',
  status: 'active',
  signedDate: '2026-01-10',
  endDate: '2026-12-31',
  attachments: [],
  createdAt: '2026-01-10T00:00:00.000Z',
  updatedAt: '2026-01-10T00:00:00.000Z',
} satisfies CustomerContract;

const supplierContract = {
  id: 'supplier-1',
  code: 'HD-NCC-001',
  name: 'Hợp đồng cung ứng thép',
  type: 'supply',
  supplierName: 'Nhà cung cấp B',
  value: 300_000_000,
  currency: 'VND',
  status: 'signed',
  signedDate: '2026-02-10',
  expiryDate: '2026-08-31',
  attachments: [],
  createdAt: '2026-02-10T00:00:00.000Z',
  updatedAt: '2026-02-10T00:00:00.000Z',
} satisfies SupplierContract;

const subcontractorContract = {
  id: 'subcontractor-1',
  code: 'HD-TP-001',
  name: 'Hợp đồng thầu phụ MEP',
  subcontractorName: 'Thầu phụ C',
  value: 200_000_000,
  currency: 'VND',
  status: 'draft',
  signedDate: '2026-03-10',
  completionDate: '2026-10-31',
  attachments: [],
  createdAt: '2026-03-10T00:00:00.000Z',
  updatedAt: '2026-03-10T00:00:00.000Z',
} satisfies SubcontractorContract;

describe('project contract aggregation', () => {
  it('builds one date-sorted project list containing all three contract sources', () => {
    const views = buildProjectContractViews({
      customerContracts: [customerContract],
      supplierContracts: [supplierContract],
      subcontractorContracts: [subcontractorContract],
    });

    expect(views.map(contract => ({
      id: contract.id,
      type: contract.type,
      partyName: contract.partyName,
      endDate: contract.endDate,
      sourcePath: contract.sourcePath,
    }))).toEqual([
      {
        id: 'subcontractor-1',
        type: 'subcontractor',
        partyName: 'Thầu phụ C',
        endDate: '2026-10-31',
        sourcePath: '/hd/subcontractor/subcontractor-1',
      },
      {
        id: 'supplier-1',
        type: 'supplier',
        partyName: 'Nhà cung cấp B',
        endDate: '2026-08-31',
        sourcePath: '/hd/supplier?supplierContractId=supplier-1',
      },
      {
        id: 'customer-1',
        type: 'customer',
        partyName: 'Chủ đầu tư A',
        endDate: '2026-12-31',
        sourcePath: '/hd/customer/customer-1',
      },
    ]);
  });

  it('keeps only the selected contract type while all keeps every source', () => {
    const views = buildProjectContractViews({
      customerContracts: [customerContract],
      supplierContracts: [supplierContract],
      subcontractorContracts: [subcontractorContract],
    });

    expect(filterProjectContractViews(views, 'supplier').map(contract => contract.id))
      .toEqual(['supplier-1']);
    expect(filterProjectContractViews(views, 'all')).toEqual(views);
  });

  it('summarizes value and active counts independently for all three sources', () => {
    const views = buildProjectContractViews({
      customerContracts: [customerContract],
      supplierContracts: [supplierContract],
      subcontractorContracts: [subcontractorContract],
    });

    expect(summarizeProjectContracts(views)).toEqual({
      total: 3,
      active: 2,
      customerValue: 1_000_000_000,
      supplierValue: 300_000_000,
      subcontractorValue: 200_000_000,
    });
  });

  it('returns only the selected project group and preserves all groups for the all option', () => {
    const groups = [
      { project: { id: 'project-a', name: 'Dự án A' } },
      { project: { id: 'project-b', name: 'Dự án B' } },
      { project: { id: 'unassigned', name: 'Chưa phân dự án' } },
    ];

    expect(filterContractOverviewGroups(groups, 'project-b')).toEqual([groups[1]]);
    expect(filterContractOverviewGroups(groups, 'unassigned')).toEqual([groups[2]]);
    expect(filterContractOverviewGroups(groups, 'all')).toEqual(groups);
  });

  it('matches unassigned contracts only when the unassigned project filter is selected', () => {
    expect(contractMatchesProjectFilter(undefined, 'unassigned')).toBe(true);
    expect(contractMatchesProjectFilter(null, 'unassigned')).toBe(true);
    expect(contractMatchesProjectFilter('project-a', 'unassigned')).toBe(false);
    expect(contractMatchesProjectFilter('project-a', 'project-a')).toBe(true);
    expect(contractMatchesProjectFilter('project-b', 'project-a')).toBe(false);
    expect(contractMatchesProjectFilter('project-b', 'all')).toBe(true);
  });

  it('removes only the supplier contract deep-link when closing its modal', () => {
    const params = new URLSearchParams('supplierContractId=supplier-1&project=project-a');

    expect(removeSupplierContractDeepLink(params).toString()).toBe('project=project-a');
    expect(params.toString()).toBe('supplierContractId=supplier-1&project=project-a');
  });
});
