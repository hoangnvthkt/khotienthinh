import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import { ToastProvider } from '../../context/ToastContext';
import { ConfirmProvider } from '../../context/ConfirmContext';
import { ProactiveOrderEditor } from '../../components/procurement/hub/ProactiveOrderEditor';
import { procurementInboxService, type ProcurementCatalogItem } from '../../lib/procurementInboxService';

// Nhập Excel cho Lập đơn chủ động. Dữ liệu giả, không gọi Supabase.
const catalog: ProcurementCatalogItem[] = [
  { id: 'thep10', name: 'Thép D10 CB300', sku: 'VT-THEP-D10', unit: 'kg', purchaseUnit: 'cây', purchaseFactor: 7.22, inBoq: true, boqQty: 5000, orderedQty: 1200 },
  { id: 'thep12', name: 'Thép D12 CB300', sku: 'VT-THEP-D12', unit: 'kg', purchaseUnit: 'cây', purchaseFactor: 10.39, inBoq: true, boqQty: 3000, orderedQty: 0 },
  { id: 'xm40', name: 'Xi măng PCB40 Bút Sơn', sku: 'VT-XM-40', unit: 'bao', purchaseUnit: null, purchaseFactor: null, inBoq: true, boqQty: 800, orderedQty: 100 },
  { id: 'cat', name: 'Cát vàng xây trát', sku: 'VT-CAT-V', unit: 'm3', purchaseUnit: null, purchaseFactor: null, inBoq: true, boqQty: 120, orderedQty: 20 },
  { id: 'dinh', name: 'Đinh sắt 10cm', sku: 'VT0001701', unit: 'kg', purchaseUnit: null, purchaseFactor: null, inBoq: false, boqQty: 0, orderedQty: 0 },
];
const fold = (s: string) => s.toLowerCase();
const svc = procurementInboxService as any;
svc.proactiveOptions = async () => ({
  projects: [{ id: 'smb', code: 'SMB-2026', name: 'Dự án Sơn Miền Bắc', warehouses: [{ id: 'kho-smb', name: 'Kho Sơn Miền Bắc' }] }],
  stockWarehouses: [{ id: 'kho-tong', name: 'Kho Tổng' }],
});
// Như server: rỗng = vật tư trong BOQ; có chữ = đủ mọi từ (phân biệt dấu) trong tên hoặc mã.
svc.searchItems = async (_projectId: string | null, search?: string) => {
  const words = fold(search || '').split(/\s+/).filter(Boolean);
  await new Promise(r => setTimeout(r, 30));
  return words.length ? catalog.filter(i => words.every(w => fold(`${i.name} ${i.sku}`).includes(w))) : catalog.filter(i => i.inBoq);
};
svc.vendors = async () => [];

createRoot(document.getElementById('root')!).render(
  <ToastProvider><ConfirmProvider>
    <ProactiveOrderEditor onClose={() => {}} onSaved={() => {}} />
  </ConfirmProvider></ToastProvider>,
);
