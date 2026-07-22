import type { BusinessPartner, SupplierContract } from '../types';

export type WmsImportSupplySource = {
  sourceType: 'supplier_contract' | 'business_partner';
  sourceId: string;
  businessPartnerId?: string | null;
  businessPartnerNameSnapshot: string;
};

export type WmsImportSupplySourceSelection =
  | { kind: 'supplier_contract'; contract: SupplierContract }
  | { kind: 'business_partner'; partner: BusinessPartner };

export const buildWmsImportSupplySource = (
  selection: WmsImportSupplySourceSelection,
): WmsImportSupplySource => {
  if (selection.kind === 'supplier_contract') {
    return {
      sourceType: 'supplier_contract',
      sourceId: selection.contract.id,
      businessPartnerId: selection.contract.supplierId || null,
      businessPartnerNameSnapshot: selection.contract.supplierName || selection.contract.name,
    };
  }

  return {
    sourceType: 'business_partner',
    sourceId: selection.partner.id,
    businessPartnerId: selection.partner.id,
    businessPartnerNameSnapshot: selection.partner.name,
  };
};
