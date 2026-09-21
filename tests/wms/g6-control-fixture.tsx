import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import WmsControlPanel from '../../components/WmsControlPanel';
import { ToastProvider } from '../../context/ToastContext';
import type { InventoryItem, Warehouse } from '../../types';
import type { WmsInventoryWorkspace } from '../../lib/wmsWorkspaceService';

const warehouses = [{ id: 'wh-1', name: 'Kho công trường Riverside' }] as Warehouse[];
const items = [
  { id: 'item-1', sku: 'THEP-D16', name: 'Thép D16', unit: 'kg', stockByWarehouse: { 'wh-1': 88 } },
  { id: 'item-2', sku: 'XM-PCB40', name: 'Xi măng PCB40', unit: 'bao', stockByWarehouse: { 'wh-1': 0 } },
] as unknown as InventoryItem[];
const workspace: WmsInventoryWorkspace = {
  asOf: '2026-09-21T06:00:00Z', metricVersion: 'g6.wms.quantity.v1', warehouseId: 'wh-1', nextCursor: null,
  completeness: { authoritative: false, openReconciliationIssues: 0, unknownReceiptCounts: 1 },
  rows: [
    { key: 'wh-1:item-1', warehouseId: 'wh-1', warehouseName: warehouses[0].name, materialId: 'item-1', sku: 'THEP-D16', materialName: 'Thép D16', unit: 'kg', cacheQty: 88, onHandQty: 88, reservedQty: 1, availableQty: 87, inTransitQty: 4, receiptCustodyQty: 0.2, teamCustodyQty: 10, authoritative: true, classification: 'matched', reconciliationIssueId: null, ownerUserId: null, disposition: null },
    { key: 'wh-1:item-2', warehouseId: 'wh-1', warehouseName: warehouses[0].name, materialId: 'item-2', sku: 'XM-PCB40', materialName: 'Xi măng PCB40', unit: 'bao', cacheQty: 0, onHandQty: 0, reservedQty: 0, availableQty: null, inTransitQty: 0, receiptCustodyQty: null, teamCustodyQty: 0, authoritative: false, classification: 'receipt_count_unknown', reconciliationIssueId: null, ownerUserId: null, disposition: null },
  ],
};
const fakeService = {
  getInventory: async () => workspace,
  getMaterialCustody: async () => ({ asOf: workspace.asOf, metricVersion: 'g6.material-custody.v1', completeness: { allocationComplete: false }, rows: [{ issueOrderId: 'issue-1', issueNo: 'PX-001', issueLineId: 'line-1', projectId: 'project-1', constructionSiteId: 'site-1', sourceWarehouseId: 'wh-1', recipientType: 'work_group', recipientId: 'team-1', recipientName: 'Đội thi công móng', responsibleUserId: null, itemId: 'item-1', itemName: 'Thép D16', unit: 'kg', issuedQty: 60, receivedConfirmedQty: 60, consumedQty: 40, returnedQty: 10, lostQty: 0, custodyQty: 10, workBoqItemId: null, materialBudgetItemId: null, allocationComplete: false, status: 'settling', neededDate: '2026-09-20' }] }),
  startCount: async () => ({ inventoryCountId: 'count-1', countNo: 'KK-20260921-01', warehouseId: 'wh-1', status: 'counting' as const, rowVersion: 1, snapshotAt: workspace.asOf, replayed: false }),
  listCountLines: async () => [{ id: 'count-line-1', inventory_count_id: 'count-1', item_id: 'item-1', unit: 'kg', snapshot_qty: 88, movement_qty: null, expected_qty_at_post: null, counted_qty: null, variance_qty: null, evidence: [], note: null }],
  postCount: async () => ({ inventoryCountId: 'count-1', countNo: 'KK-20260921-01', status: 'posted' as const, rowVersion: 2, adjustmentTransactionId: 'tx-adjust', replayed: false }),
};

createRoot(document.getElementById('root')!).render(<ToastProvider><main className="mx-auto max-w-7xl p-3 sm:p-6"><WmsControlPanel warehouseId="wh-1" warehouses={warehouses} items={items} canCount service={fakeService} /></main></ToastProvider>);
