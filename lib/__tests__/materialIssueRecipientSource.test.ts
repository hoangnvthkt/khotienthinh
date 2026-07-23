import { describe, expect, it } from 'vitest';
import type { BusinessPartner, SupplierContract } from '../../types';
import { buildMaterialIssueRecipientSource } from '../materialIssueRecipientSource';

const contract: SupplierContract = {
  id: 'supplier-contract-01',
  code: 'HD-NCC-001',
  name: 'Hợp đồng cung cấp thép',
  supplierId: 'partner-01',
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
  id: 'partner-02',
  code: 'DT-002',
  name: 'Tổ đội An Phú',
  classifications: ['contractor'],
  isActive: true,
};

describe('buildMaterialIssueRecipientSource', () => {
  it('uses a supplier contract as the traceable recipient source', () => {
    expect(buildMaterialIssueRecipientSource({ kind: 'supplier_contract', contract })).toEqual({
      recipientType: 'partner',
      recipientId: 'partner-01',
      recipientName: 'Công ty Thép Việt',
      recipientSourceType: 'supplier_contract',
      recipientSourceId: 'supplier-contract-01',
    });
  });

  it('uses an active partner as the traceable recipient source', () => {
    expect(buildMaterialIssueRecipientSource({ kind: 'business_partner', partner })).toEqual({
      recipientType: 'partner',
      recipientId: 'partner-02',
      recipientName: 'Tổ đội An Phú',
      recipientSourceType: 'business_partner',
      recipientSourceId: 'partner-02',
    });
  });
});
