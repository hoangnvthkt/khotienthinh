import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import { ToastProvider } from '../../context/ToastContext';
import { ConfirmProvider } from '../../context/ConfirmContext';
import { ProactiveOrderEditor } from '../../components/procurement/hub/ProactiveOrderEditor';
import { procurementInboxService, type ProcurementCatalogItem } from '../../lib/procurementInboxService';
import { wmsCatalogService, type CatalogItem } from '../../lib/wmsCatalogService';

// Tạo vật tư mới ngay trong Lập đơn chủ động — dữ liệu mẫu, không gọi Cloud.
const catalog: ProcurementCatalogItem[] = [
  { id: 'i1', name: 'Băng keo lưới', sku: 'VT0000135', unit: 'Cuộn', purchaseUnit: null, purchaseFactor: null, inBoq: true, boqQty: 2, orderedQty: 0 },
  { id: 'i2', name: 'Thép hình U200x75x6', sku: 'VT0000412', unit: 'Kg', purchaseUnit: 'Cây', purchaseFactor: 140, inBoq: false, boqQty: 0, orderedQty: 0 },
  { id: 'i3', name: 'Thép hình U250x80x9', sku: 'VT0000415', unit: 'Kg', purchaseUnit: null, purchaseFactor: null, inBoq: false, boqQty: 0, orderedQty: 0 },
];
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
procurementInboxService.proactiveOptions = async () => ({ projects: [{ id: 'p1', code: 'CT-01', name: 'Nhà xưởng Yên Phong', status: 'active', warehouses: [{ id: 'w1', name: 'Kho Nhà xưởng Yên Phong' }] }], stockWarehouses: [] });
procurementInboxService.searchItems = async (_p, q) => catalog.filter(i => !q || fold(`${i.sku} ${i.name}`).includes(fold(q).trim().split(/\s+/)[0]));
procurementInboxService.vendors = async () => [{ id: 'v1', name: 'Công ty CP Kim khí Thăng Long', taxCode: '0109990002', recentOrders: 3 }];
wmsCatalogService.createOptions = async () => ({ canCreate: true, canEdit: true, canIssueCode: false, categories: ['Sắt thép', 'Vật tư phụ', 'Điện nước'], units: ['Cây', 'Cuộn', 'Cái', 'Kg', 'Tấn', 'm3'] });
let n = 2101;
wmsCatalogService.issue = async input => {
  const item: CatalogItem = { id: `new-${n}`, sku: `VT000${n++}`, name: input.name, unit: input.unit, category: input.category, purchaseUnit: input.purchaseUnit || null,
    purchaseConversionFactor: input.purchaseConversionFactor || 1, minStock: 0, accountingCode: null, status: 'active', inventoryMode: input.inventoryMode, retiredAt: null, retiredReason: null, createdAt: null };
  catalog.push({ id: item.id, name: item.name, sku: item.sku, unit: item.unit, purchaseUnit: item.purchaseUnit, purchaseFactor: item.purchaseConversionFactor, inBoq: false, boqQty: 0, orderedQty: 0 });
  return item;
};
createRoot(document.getElementById('root')!).render(<ToastProvider><ConfirmProvider><ProactiveOrderEditor onClose={() => undefined} onSaved={() => undefined} /></ConfirmProvider></ToastProvider>);
