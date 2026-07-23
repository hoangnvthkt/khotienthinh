import type { BusinessPartner, MaterialIssueRecipientType, SupplierContract } from '../types';

export type MaterialIssueRecipientSource = {
  recipientType: MaterialIssueRecipientType;
  recipientId: string;
  recipientName: string;
  recipientSourceType: 'supplier_contract' | 'business_partner';
  recipientSourceId: string;
};

export type MaterialIssueRecipientSourceSelection =
  | { kind: 'supplier_contract'; contract: SupplierContract }
  | { kind: 'business_partner'; partner: BusinessPartner };

export const buildMaterialIssueRecipientSource = (
  selection: MaterialIssueRecipientSourceSelection,
): MaterialIssueRecipientSource => {
  if (selection.kind === 'supplier_contract') {
    const { contract } = selection;
    return {
      recipientType: 'partner',
      recipientId: contract.supplierId || contract.id,
      recipientName: contract.supplierName || contract.name,
      recipientSourceType: 'supplier_contract',
      recipientSourceId: contract.id,
    };
  }

  const { partner } = selection;
  return {
    recipientType: 'partner',
    recipientId: partner.id,
    recipientName: partner.name,
    recipientSourceType: 'business_partner',
    recipientSourceId: partner.id,
  };
};
