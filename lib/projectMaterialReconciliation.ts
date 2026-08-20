import type {
  ProjectMaterialDataQualityFlag,
  ProjectMaterialReconciliationRow,
  ProjectMaterialReconciliationSummary,
} from '../types';

const numeric = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const rounded = (value: unknown): number =>
  Math.round((numeric(value) + Number.EPSILON) * 10_000) / 10_000;

const read = (row: Record<string, any>, camel: string, snake: string) =>
  row[camel] ?? row[snake];

const normalizedFlags = (value: unknown): ProjectMaterialDataQualityFlag[] =>
  Array.isArray(value)
    ? [...new Set(value.map(flag => String(flag) as ProjectMaterialDataQualityFlag))]
    : [];

export const normalizeProjectMaterialReconciliationRow = (
  source: Record<string, any>,
): ProjectMaterialReconciliationRow => {
  const totalBoqQty = rounded(read(source, 'totalBoqQty', 'total_boq_qty'));
  const plannedProgressPercent = rounded(read(source, 'plannedProgressPercent', 'planned_progress_percent'));
  const constructionIssuedQty = rounded(read(source, 'constructionIssuedQty', 'construction_issued_qty'));
  const projectReturnedQty = rounded(read(source, 'projectReturnedQty', 'project_returned_qty'));
  const confirmedUsedQty = rounded(read(source, 'confirmedUsedQty', 'confirmed_used_qty'));
  const lossAfterIssueQty = rounded(read(source, 'lossAfterIssueQty', 'loss_after_issue_qty'));
  const plannedQtyToDate = read(source, 'plannedQtyToDate', 'planned_qty_to_date') == null
    ? rounded(totalBoqQty * plannedProgressPercent / 100)
    : rounded(read(source, 'plannedQtyToDate', 'planned_qty_to_date'));
  const netIssuedQty = read(source, 'netIssuedQty', 'net_issued_qty') == null
    ? rounded(constructionIssuedQty - projectReturnedQty)
    : rounded(read(source, 'netIssuedQty', 'net_issued_qty'));
  const openWithRecipientQty = read(source, 'openWithRecipientQty', 'open_with_recipient_qty') == null
    ? rounded(netIssuedQty - confirmedUsedQty - lossAfterIssueQty)
    : rounded(read(source, 'openWithRecipientQty', 'open_with_recipient_qty'));

  return {
    inventoryItemId: read(source, 'inventoryItemId', 'inventory_item_id') ?? null,
    sku: read(source, 'sku', 'sku') ?? null,
    itemName: String(read(source, 'itemName', 'item_name') || 'Chưa xác định'),
    unit: read(source, 'unit', 'unit') ?? null,
    totalBoqQty,
    plannedProgressPercent,
    plannedQtyToDate,
    requestPoReceiptQty: rounded(read(source, 'requestPoReceiptQty', 'request_po_receipt_qty')),
    proactivePoReceiptQty: rounded(read(source, 'proactivePoReceiptQty', 'proactive_po_receipt_qty')),
    siteHotPurchaseReceiptQty: rounded(read(source, 'siteHotPurchaseReceiptQty', 'site_hot_purchase_receipt_qty')),
    directSupplierReceiptQty: rounded(read(source, 'directSupplierReceiptQty', 'direct_supplier_receipt_qty')),
    directManualReceiptQty: rounded(read(source, 'directManualReceiptQty', 'direct_manual_receipt_qty')),
    transferReceiptQty: rounded(read(source, 'transferReceiptQty', 'transfer_receipt_qty')),
    grossReceivedQty: rounded(read(source, 'grossReceivedQty', 'gross_received_qty')),
    currentStockQty: rounded(read(source, 'currentStockQty', 'current_stock_qty')),
    constructionIssuedQty,
    projectReturnedQty,
    netIssuedQty,
    confirmedUsedQty,
    lossAfterIssueQty,
    openWithRecipientQty,
    usedVarianceToPlan: read(source, 'usedVarianceToPlan', 'used_variance_to_plan') == null
      ? rounded(confirmedUsedQty - plannedQtyToDate)
      : rounded(read(source, 'usedVarianceToPlan', 'used_variance_to_plan')),
    usedVarianceToBoq: read(source, 'usedVarianceToBoq', 'used_variance_to_boq') == null
      ? rounded(confirmedUsedQty - totalBoqQty)
      : rounded(read(source, 'usedVarianceToBoq', 'used_variance_to_boq')),
    usedPercentOfBoq: read(source, 'usedPercentOfBoq', 'used_percent_of_boq') == null
      ? (totalBoqQty > 0 ? rounded(confirmedUsedQty * 100 / totalBoqQty) : 0)
      : rounded(read(source, 'usedPercentOfBoq', 'used_percent_of_boq')),
    dataQualityFlags: normalizedFlags(read(source, 'dataQualityFlags', 'data_quality_flags')),
  };
};

export const summarizeProjectMaterialReconciliation = (
  rows: ProjectMaterialReconciliationRow[],
): ProjectMaterialReconciliationSummary => {
  const hasFlag = (row: ProjectMaterialReconciliationRow, ...flags: ProjectMaterialDataQualityFlag[]) =>
    flags.some(flag => row.dataQualityFlags.includes(flag));
  const sum = (selector: (row: ProjectMaterialReconciliationRow) => number) =>
    rounded(rows.reduce((total, row) => total + selector(row), 0));

  return {
    rowCount: rows.length,
    exceptionRowCount: rows.filter(row => row.dataQualityFlags.length > 0).length,
    unmappedRowCount: rows.filter(row => hasFlag(row, 'unmapped_material')).length,
    unitMismatchRowCount: rows.filter(row => hasFlag(row, 'unit_mismatch')).length,
    legacyRowCount: rows.filter(row => hasFlag(
      row,
      'legacy_transaction',
      'legacy_direct_receipt',
      'legacy_direct_issue',
    )).length,
    pendingSettlementRowCount: rows.filter(row => hasFlag(row, 'pending_settlement')).length,
    totalBoqQty: sum(row => row.totalBoqQty),
    plannedQtyToDate: sum(row => row.plannedQtyToDate),
    grossReceivedQty: sum(row => row.grossReceivedQty),
    currentStockQty: sum(row => row.currentStockQty),
    confirmedUsedQty: sum(row => row.confirmedUsedQty),
    openWithRecipientQty: sum(row => row.openWithRecipientQty),
  };
};
