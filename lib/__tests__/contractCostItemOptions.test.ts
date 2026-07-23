import { describe, expect, it } from 'vitest';
import type { ContractCostItem, ProjectTransaction } from '../../types';
import {
  applyContractCostItemToTransaction,
  buildContractCostItemOptions,
  inferProjectCostCategoryFromCostItem,
  resolveContractCostItem,
} from '../contractCostItemOptions';

const item = (overrides: Partial<ContractCostItem> & Pick<ContractCostItem, 'id' | 'symbol' | 'name'>): ContractCostItem => ({
  parentId: null,
  status: 'active',
  sortOrder: 0,
  ...overrides,
});

describe('contract cost item options', () => {
  const items: ContractCostItem[] = [
    item({ id: 'root-1', symbol: 'CPTT', name: 'Chi phí trực tiếp', sortOrder: 1 }),
    item({ id: 'child-1', parentId: 'root-1', symbol: 'CPVL', name: 'Chi phí vật liệu', sortOrder: 1 }),
    item({ id: 'child-2', parentId: 'root-1', symbol: 'CPNC', name: 'Chi phí nhân công', sortOrder: 2 }),
    item({ id: 'inactive', symbol: 'CPOLD', name: 'Chi phí cũ', status: 'inactive', sortOrder: 9 }),
  ];

  it('builds active tree options with display index, symbol, and name', () => {
    const options = buildContractCostItemOptions(items);

    expect(options.map(option => option.label)).toEqual([
      '1 - CPTT - Chi phí trực tiếp',
      '1.1 - CPVL - Chi phí vật liệu',
      '1.2 - CPNC - Chi phí nhân công',
    ]);
  });

  it('resolves active cost items by id or symbol', () => {
    expect(resolveContractCostItem(items, 'child-2')?.id).toBe('child-2');
    expect(resolveContractCostItem(items, ' cpnc ')?.id).toBe('child-2');
    expect(resolveContractCostItem(items, '1.2 - CPNC - Chi phí nhân công')?.id).toBe('child-2');
    expect(resolveContractCostItem(items, 'CPOLD')).toBeNull();
  });

  it('applies id and snapshot fields to a transaction draft', () => {
    const tx = {
      id: 'tx-1',
      type: 'expense',
    } as ProjectTransaction;

    expect(applyContractCostItemToTransaction(tx, items[2])).toMatchObject({
      contractCostItemId: 'child-2',
      contractCostItemSymbolSnapshot: 'CPNC',
      contractCostItemNameSnapshot: 'Chi phí nhân công',
      costClassificationStatus: 'manual',
    });
  });

  it('infers project cost category from contract cost item symbol, name keywords, or explicit category', () => {
    expect(inferProjectCostCategoryFromCostItem(item({ id: 'cpvl', symbol: 'CPVL', name: 'Chi phí vật liệu' }))).toBe('materials');
    expect(inferProjectCostCategoryFromCostItem(item({ id: 'cpnvl', symbol: 'CPNVL', name: 'Chi phí nguyên vật liệu' }))).toBe('materials');
    expect(inferProjectCostCategoryFromCostItem(item({ id: 'cpnc', symbol: 'CPNC', name: 'Chi phí nhân công' }))).toBe('labor');
    expect(inferProjectCostCategoryFromCostItem(item({ id: 'cpmtc', symbol: 'CPMTC', name: 'Chi phí giờ máy thi công' }))).toBe('machinery');
    expect(inferProjectCostCategoryFromCostItem(item({ id: 'cpgt', symbol: 'CPGT', name: 'Chi phí gián tiếp' }))).toBe('overhead');
    expect(inferProjectCostCategoryFromCostItem(item({ id: 'cpng', symbol: 'CPNG', name: 'Chi phí ngoại giao' }))).toBe('overhead');
    expect(inferProjectCostCategoryFromCostItem(item({ id: 'cpql', symbol: 'CPQL', name: 'Chi phí quản lý chung' }))).toBe('overhead');
    expect(inferProjectCostCategoryFromCostItem(item({ id: 'cpl', symbol: 'CPL', name: 'Chi phí lương nhân viên' }))).toBe('overhead');
    expect(inferProjectCostCategoryFromCostItem(item({ id: 'cpl1', symbol: 'CPL1', name: 'Chi phí lương BCH công trường' }))).toBe('overhead');
    expect(inferProjectCostCategoryFromCostItem(item({ id: 'cpc', symbol: 'CPC', name: 'Chi phí chung' }))).toBe('overhead');
    expect(inferProjectCostCategoryFromCostItem(item({ id: 'other', symbol: 'CPK', name: 'Chi phí khác' }))).toBe('other');

    // Test explicit category override
    expect(inferProjectCostCategoryFromCostItem(item({ id: 'custom', symbol: 'CPNG', name: 'Chi phí ngoại giao', category: 'other' }))).toBe('other');
    expect(inferProjectCostCategoryFromCostItem(item({ id: 'custom2', symbol: 'CUSTOM', name: 'Giao thầu phần móng', category: 'subcontract' }))).toBe('subcontract');

    // Test keyword fallback on name
    expect(inferProjectCostCategoryFromCostItem(item({ id: 'kw1', symbol: 'X1', name: 'Mua sắm vật tư xây dựng' }))).toBe('materials');
    expect(inferProjectCostCategoryFromCostItem(item({ id: 'kw2', symbol: 'X2', name: 'Thuê thợ chính thi công' }))).toBe('labor');
  });
});
