import type { DocumentTraceNodeType } from '../../types';
import type { ProcurementDocumentRef } from '../../types/procurementWorkbench';
import { buildDocumentTracePath } from '../documentTraceService';

const TRACE_TYPE_BY_PROCUREMENT_TYPE: Record<ProcurementDocumentRef['type'], DocumentTraceNodeType> = {
  material_request: 'material_request',
  purchase_order: 'purchase_order',
  wms: 'wms_transaction',
  direct_purchase: 'site_direct_purchase',
  supplier_contract: 'supplier_contract',
  supplier_delivery: 'supplier_direct_delivery_note',
  supplier_statement: 'supplier_delivery_statement',
  payable: 'supplier_payable_document',
};

export const validateProcurementReturnTo = (returnTo: string): string => {
  if (!returnTo.startsWith('/') || returnTo.startsWith('//') || returnTo.includes('\\')
    || /[\u0000-\u001f]/.test(returnTo)) {
    throw new Error('INVALID_RETURN_ROUTE');
  }
  return returnTo;
};

export const resolveProcurementDocument = (
  ref: ProcurementDocumentRef,
  returnTo: string,
): { route: string; engine: string } => {
  if (!ref.id.trim() || !ref.engine.trim()) throw new Error('PROCUREMENT_DOCUMENT_REF_INVALID');
  const safeReturnTo = validateProcurementReturnTo(returnTo);
  const traceType = TRACE_TYPE_BY_PROCUREMENT_TYPE[ref.type];
  const route = buildDocumentTracePath(traceType, ref.id);
  const [path, query = ''] = route.split('?');
  const params = new URLSearchParams(query);
  params.set('returnTo', safeReturnTo);
  return { route: `${path}?${params.toString()}`, engine: ref.engine };
};
