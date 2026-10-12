// Dữ liệu minh họa: ô chọn vật tư (mã hay đề xuất lên đầu) + ô quy cách in mờ quy cách lần trước. Không gọi Supabase.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import ItemSelectionModal from '../../components/ItemSelectionModal';
import MaterialCommercialDescriptionFields from '../../components/material/MaterialCommercialDescriptionFields';

const item = (id: string, sku: string, name: string, category: string) => ({ id, sku, name, unit: 'kg', category, stockByWarehouse: {}, status: 'active' }) as any;
const ITEMS = [item('a', 'CAT-V', 'Cát vàng bê tông', 'Cát đá'), item('b', 'THEP-D16', 'Thép D16', 'Thép'), item('c', 'XM-PCB40', 'Xi măng PCB40', 'Xi măng'),
  item('d', 'DA-12', 'Đá 1x2', 'Cát đá'), item('e', 'GACH-6', 'Gạch đặc 6 lỗ', 'Gạch')];

const Fixture: React.FC = () => {
  const [open, setOpen] = useState(new URLSearchParams(location.search).get('picker') === '1');
  const [spec, setSpec] = useState('');
  return <div className="min-h-screen bg-background p-4 sm:p-6">
    <div className="mx-auto max-w-xl rounded-2xl border border-border bg-card p-4 space-y-3">
      <div className="text-sm font-black">Đề xuất vật tư · dòng 1</div>
      <MaterialCommercialDescriptionFields sku="THEP-D16" itemId="b" name="Thép D16" onNameChange={() => {}} specification={spec} onSpecificationChange={setSpec}
        specificationGhost={{ text: 'D16 CB400, cây 11,7 m', value: 'D16 CB400, cây 11,7 m', title: 'Theo MR-2026-0184 (11/10)' }} />
      <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold" onClick={() => setOpen(true)}>Thêm vật tư</button>
    </div>
    <ItemSelectionModal isOpen={open} allowAllItems showStockQuantities={false} onClose={() => setOpen(false)} onSelect={() => setOpen(false)} onOpenScanner={() => {}}
      items={ITEMS} frequent={[{ itemId: 'c', count: 6 }, { itemId: 'b', count: 4 }, { itemId: 'd', count: 2 }]} />
  </div>;
};
createRoot(document.getElementById('root')!).render(<Fixture />);
