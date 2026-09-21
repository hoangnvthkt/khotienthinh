import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import SupplierFinanceFlowPanel from '../../components/project/SupplierFinanceFlowPanel';
import SupplierInvoiceMatchingModal from '../../components/project/SupplierInvoiceMatchingModal';

const snapshot = {
  asOf: '2026-09-21T07:00:00Z', projectId: 'project-1', authoritative: false,
  issues: ['CONSUMPTION_VALUATION_SOURCE_MISSING'],
  layers: [
    { layer: 'purchase_receipt' as const, amount: 1_000_000_000, currency: 'VND', completeness: 'complete' as const, source: 'supplier_payable_documents', documentCount: 8, issues: [] },
    { layer: 'inventory' as const, amount: 620_000_000, currency: 'VND', completeness: 'complete' as const, source: 'inventory_ledger_entries', documentCount: 38, issues: [] },
    { layer: 'consumption' as const, amount: null, currency: 'VND', completeness: 'unknown' as const, source: 'inventory_ledger_entries', documentCount: 12, issues: ['VALUATION_SOURCE_MISSING'] },
    { layer: 'ap' as const, amount: 700_000_000, currency: 'VND', completeness: 'complete' as const, source: 'supplier_payable_document_balances', documentCount: 6, issues: [] },
    { layer: 'cash' as const, amount: 300_000_000, currency: 'VND', completeness: 'complete' as const, source: 'supplier_payment_batches', documentCount: 2, issues: [] },
  ],
};

const candidates = {
  documents: [{ id: 'ap-1', sourceType: 'purchase_delivery_receipt', sourceId: 'batch-1', documentNo: 'REC-2026-001', currency: 'VND', recognizedAmount: 100_000_000, creditAmount: 0, paidAmount: 0, outstandingAmount: 100_000_000, invoicedToDate: 60_000_000, uninvoicedAmount: 40_000_000 }],
  receiptLines: [{ deliveryLineId: 'line-1', deliveryBatchId: 'batch-1', purchaseOrderId: 'po-1', purchaseOrderLineId: 'po-line-1', itemId: 'Xi măng PCB40', acceptedQty: 1000, unit: 'bao', receiptUnitPrice: 100_000, invoicedToDate: 600, uninvoicedQty: 400, vatRate: 10 }],
};

const Fixture = () => {
  const [open, setOpen] = useState(false);
  return <main className="mx-auto max-w-7xl space-y-4 p-3 sm:p-6">
    <SupplierFinanceFlowPanel snapshot={snapshot} loading={false} error={null} onRetry={() => undefined} />
    <button type="button" onClick={() => setOpen(true)} className="min-h-11 rounded-xl bg-teal-700 px-4 text-sm font-bold text-white">Đối soát hóa đơn NCC</button>
    {open && <SupplierInvoiceMatchingModal supplierName="Công ty Vật liệu An Phát" candidates={candidates} loading={false} error={null} saving={false} onRetry={() => undefined} onClose={() => setOpen(false)} onSubmit={() => undefined} />}
  </main>;
};

createRoot(document.getElementById('root')!).render(<Fixture />);
