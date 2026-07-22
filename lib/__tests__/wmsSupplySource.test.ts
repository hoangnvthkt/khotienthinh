import { describe, expect, it } from 'vitest';
import type { BusinessPartner, SupplierContract } from '../../types';
import { buildWmsImportSupplySource } from '../wmsSupplySource';

const contract: SupplierContract = {
  id: 'contract-01',
  code: 'HD-NCC-001',
  name: 'Cung cấp thép',
  supplierId: 'partner-supplier',
  supplierName: 'Công ty Thép Việt',
  type: 'supply',
  value: 100_000_000,
  currency: 'VND',
  status: 'active',
  attachments: [],
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
};

const partner: BusinessPartner = {
  id: 'partner-01',
  code: 'DT-001',
  name: 'Công ty Vận tải An Phú',
  classifications: ['contractor'],
  isActive: true,
  taxCode: '0312345678',
};

describe('buildWmsImportSupplySource', () => {
  it('traces a supplier-contract selection to the contract and its supplier', () => {
    expect(buildWmsImportSupplySource({ kind: 'supplier_contract', contract })).toEqual({
      sourceType: 'supplier_contract',
      sourceId: 'contract-01',
      businessPartnerId: 'partner-supplier',
      businessPartnerNameSnapshot: 'Công ty Thép Việt',
    });
  });

  it('traces a partner selection directly to the active partner', () => {
    expect(buildWmsImportSupplySource({ kind: 'business_partner', partner })).toEqual({
      sourceType: 'business_partner',
      sourceId: 'partner-01',
      businessPartnerId: 'partner-01',
      businessPartnerNameSnapshot: 'Công ty Vận tải An Phú',
    });
  });
});
