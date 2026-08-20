import { describe, expect, it } from 'vitest';
import {
  normalizeProjectMaterialReconciliationRow,
  summarizeProjectMaterialReconciliation,
} from '../projectMaterialReconciliation';

describe('project material BOQ reconciliation', () => {
  it('uses confirmed consumption as actual and keeps the issue equation balanced', () => {
    const row = normalizeProjectMaterialReconciliationRow({
      inventory_item_id: 'steel-d8',
      sku: 'VT-D8',
      item_name: 'Thép D8',
      unit: 'Kg',
      total_boq_qty: 1_000,
      planned_progress_percent: 40,
      gross_received_qty: 900,
      construction_issued_qty: 600,
      project_returned_qty: 50,
      confirmed_used_qty: 300,
      loss_after_issue_qty: 10,
      current_stock_qty: 350,
      data_quality_flags: [],
    });

    expect(row.plannedQtyToDate).toBe(400);
    expect(row.netIssuedQty).toBe(550);
    expect(row.openWithRecipientQty).toBe(240);
    expect(row.confirmedUsedQty).toBe(300);
    expect(row.usedVarianceToPlan).toBe(-100);
    expect(row.usedVarianceToBoq).toBe(-700);
    expect(row.netIssuedQty).toBe(
      row.confirmedUsedQty + row.lossAfterIssueQty + row.openWithRecipientQty,
    );
  });

  it('does not turn direct receipts into confirmed use', () => {
    const row = normalizeProjectMaterialReconciliationRow({
      inventory_item_id: 'cement',
      sku: 'XM-PC40',
      item_name: 'Xi măng PC40',
      unit: 'Bao',
      total_boq_qty: 100,
      planned_progress_percent: 50,
      request_po_receipt_qty: 10,
      proactive_po_receipt_qty: 20,
      site_hot_purchase_receipt_qty: 30,
      direct_supplier_receipt_qty: 40,
      gross_received_qty: 100,
      construction_issued_qty: 0,
      project_returned_qty: 0,
      confirmed_used_qty: 0,
      loss_after_issue_qty: 0,
      current_stock_qty: 100,
      data_quality_flags: [],
    });

    expect(row.grossReceivedQty).toBe(100);
    expect(row.confirmedUsedQty).toBe(0);
    expect(row.usedVarianceToPlan).toBe(-50);
  });

  it('preserves unmapped and unit-mismatch warnings in the summary', () => {
    const rows = [
      normalizeProjectMaterialReconciliationRow({
        inventory_item_id: null,
        sku: null,
        item_name: 'Vật tư chưa map',
        unit: 'kg',
        total_boq_qty: 5,
        planned_progress_percent: 20,
        data_quality_flags: ['unmapped_material'],
      }),
      normalizeProjectMaterialReconciliationRow({
        inventory_item_id: 'item-1',
        sku: 'VT-1',
        item_name: 'Vật tư sai đơn vị',
        unit: 'cái',
        total_boq_qty: 8,
        planned_progress_percent: 20,
        data_quality_flags: ['unit_mismatch', 'legacy_direct_receipt'],
      }),
    ];

    expect(summarizeProjectMaterialReconciliation(rows)).toEqual(expect.objectContaining({
      rowCount: 2,
      exceptionRowCount: 2,
      unmappedRowCount: 1,
      unitMismatchRowCount: 1,
      legacyRowCount: 1,
    }));
  });
});
