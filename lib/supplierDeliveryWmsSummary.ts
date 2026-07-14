import type { SupplierDirectDeliveryLine } from '../types';

export const SUPPLIER_DELIVERY_WMS_STATUS: Record<NonNullable<SupplierDirectDeliveryLine['wmsStatus']>, { label: string; badge: string }> = {
  not_required: { label: 'Không qua kho', badge: 'border-slate-200 bg-slate-50 text-slate-600' },
  import_pending: { label: 'Chờ nhập WMS', badge: 'border-amber-200 bg-amber-50 text-amber-700' },
  imported: { label: 'Tồn chờ xuất dùng', badge: 'border-orange-200 bg-orange-50 text-orange-700' },
  export_pending: { label: 'Chờ xác nhận xuất', badge: 'border-blue-200 bg-blue-50 text-blue-700' },
  exported: { label: 'Đã xuất dùng', badge: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  blocked: { label: 'WMS bị khóa', badge: 'border-red-200 bg-red-50 text-red-700' },
};

const DIRECT_IN_OUT_PENDING_STATUS = {
  label: 'Nhập-xuất thẳng',
  badge: 'border-indigo-200 bg-indigo-50 text-indigo-700',
};

export type SupplierDeliveryWmsSummary = {
  hasDirectLines: boolean;
  readyForStatement: boolean;
  canCreateImport: boolean;
  label: string;
  badge: string;
  importTransactionIds: string[];
  exportTransactionIds: string[];
};

export const getSupplierDeliveryWmsSummary = (lines: SupplierDirectDeliveryLine[]): SupplierDeliveryWmsSummary => {
  const directLines = lines.filter(line => (line.wmsFlowMode || 'none') === 'direct_in_out' && line.status !== 'rejected');
  if (directLines.length === 0) {
    return {
      hasDirectLines: false,
      readyForStatement: true,
      canCreateImport: false,
      label: SUPPLIER_DELIVERY_WMS_STATUS.not_required.label,
      badge: SUPPLIER_DELIVERY_WMS_STATUS.not_required.badge,
      importTransactionIds: [],
      exportTransactionIds: [],
    };
  }

  const importTransactionIds = Array.from(new Set(directLines.map(line => line.wmsImportTransactionId).filter(Boolean))) as string[];
  const exportTransactionIds = Array.from(new Set(directLines.map(line => line.wmsExportTransactionId).filter(Boolean))) as string[];
  const canCreateImport = directLines.some(line =>
    (line.status === 'accepted' || line.status === 'adjusted')
    && !line.wmsImportTransactionId,
  );
  const readyForStatement = directLines.every(line => line.wmsStatus === 'exported');
  const statusOrder: Array<NonNullable<SupplierDirectDeliveryLine['wmsStatus']>> = [
    'blocked',
    'export_pending',
    'imported',
    'import_pending',
    'exported',
    'not_required',
  ];
  const displayStatus = statusOrder.find(status => directLines.some(line => (line.wmsStatus || 'not_required') === status)) || 'not_required';
  const statusMeta = readyForStatement
    ? SUPPLIER_DELIVERY_WMS_STATUS.exported
    : displayStatus === 'not_required'
      ? DIRECT_IN_OUT_PENDING_STATUS
      : SUPPLIER_DELIVERY_WMS_STATUS[displayStatus];
  return {
    hasDirectLines: true,
    readyForStatement,
    canCreateImport,
    label: statusMeta.label,
    badge: statusMeta.badge,
    importTransactionIds,
    exportTransactionIds,
  };
};
