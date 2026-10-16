import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import { ToastProvider } from '../../context/ToastContext';
import { ConfirmProvider } from '../../context/ConfirmContext';
import { ProactiveOrderEditor } from '../../components/procurement/hub/ProactiveOrderEditor';
import { procurementInboxService, type ProcurementCatalogItem } from '../../lib/procurementInboxService';
import { aiGateway } from '../../lib/aiGateway';
import HANAKA from './po-quote-hanaka.json';

// Lập đơn chủ động · Chụp / dán báo giá. Danh mục thép thật (17/10/2026), kết quả AI thật đọc báo giá HANAKA (claude-sonnet-5-5).
// Không gọi Supabase. ?ai=none (chưa bật AI) · ?ai=fail (AI lỗi) · ?vendor=1 (báo giá có tên + MST NCC, VAT 8%)
const params = new URLSearchParams(location.search);
const thep = (id: string, sku: string, name: string, unit: string, factor?: number): ProcurementCatalogItem =>
  ({ id, sku, name, unit, purchaseUnit: factor ? 'Kg' : null, purchaseFactor: factor ?? null, inBoq: false, boqQty: 0, orderedQty: 0 });
const catalog: ProcurementCatalogItem[] = [
  thep('xd8', 'VT0000824', 'Thép XD D8', 'Kg'),
  thep('xd10', 'VT0000825', 'Thép XD D10', 'Cây', 0.138888888889),
  thep('xd16', 'VT0000828', 'Thép XD D16', 'Cây', 0.054094990804),
  thep('xd18', 'VT0000829', 'Thép XD D18', 'Cây', 0.042735042735),
  thep('xd20', 'VT0000830', 'Thép XD D20', 'Cây', 0.03460327347),
  thep('xd25', 'VT0000832', 'Thép XD D25', 'Cây', 0.0222000222),
  thep('tron16', 'VT0000109', 'Thép tròn trơn D16', 'Kg'),
  thep('tron18', 'VT0000110', 'Thép tròn trơn D18', 'Kg'),
  thep('tron20', 'VT0000111', 'Thép tròn trơn D20', 'Kg'),
  thep('tron25', 'VT0000112', 'Thép tròn trơn D25', 'Kg'),
  { id: 'xm40', name: 'Xi măng PCB40 Bút Sơn', sku: 'VT-XM-40', unit: 'bao', purchaseUnit: null, purchaseFactor: null, inBoq: true, boqQty: 800, orderedQty: 100 },
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
const VENDORS = [{ id: 'v-hanaka', name: 'Công ty TNHH Thép HANAKA', taxCode: '0109876543' }, { id: 'v-hp', name: 'Công ty CP Thép Hòa Phát', taxCode: '0100100100' }];
svc.vendors = async (search?: string) => {
  const q = fold(search || '').trim();
  return q ? VENDORS.filter(v => fold(`${v.name} ${v.taxCode}`).includes(q)) : VENDORS;
};
svc.vendorPrefill = async () => { throw new Error('fixture: không có đơn trước'); };

const ai = aiGateway as any;
ai.status = async () => ({ deployed: true, configured: params.get('ai') !== 'none', skills: params.get('ai') === 'none' ? [] : ['po_quote_lines'] });
ai.feedback = async () => undefined;
ai.run = async (skill: string, input: { text: string; images: unknown[] }) => {
  (window as any).__aiCalls = [...((window as any).__aiCalls || []), { skill, text: input.text, images: input.images.length }];
  await new Promise(r => setTimeout(r, 1200));
  if (params.get('ai') === 'fail') return { code: 'AI_FAILED', error: 'AI_HTTP_502' };
  const result = params.get('vendor') ? { ...HANAKA, vendorName: 'CÔNG TY TNHH THÉP HANAKA', vendorTaxCode: '0109876543', vatRate: 8, vatAmount: 78876614 } : HANAKA;
  return { code: 'OK', runId: 'run-quote', result, model: 'claude-sonnet-5-5', provider: 'openai_compatible', usage: { tokensIn: 2400, tokensOut: 900, costUsd: null, durationMs: 17000 } };
};

createRoot(document.getElementById('root')!).render(
  <ToastProvider><ConfirmProvider>
    <ProactiveOrderEditor onClose={() => {}} onSaved={() => {}} />
  </ConfirmProvider></ToastProvider>,
);
