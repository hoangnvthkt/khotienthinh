import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../context/AppContext', () => ({ useApp: () => ({ items: [], warehouses: [] }) }));
vi.mock('../itemSpecService', async importOriginal => ({ ...(await importOriginal<object>()), itemSpecService: { options: () => Promise.resolve([]) } }));

import ItemSelectionModal from '../../components/ItemSelectionModal';
import MaterialCommercialDescriptionFields from '../../components/material/MaterialCommercialDescriptionFields';

const item = (id: string, name: string) => ({ id, sku: id.toUpperCase(), name, unit: 'kg', category: 'Thép', stockByWarehouse: {}, status: 'active' }) as any;

describe('Đề xuất vật tư · gợi ý', () => {
  it('ô chọn vật tư: mã hay đề xuất lên đầu kèm số phiếu khi chưa gõ tìm', () => {
    const html = renderToStaticMarkup(<ItemSelectionModal isOpen allowAllItems showStockQuantities={false} onClose={() => {}} onSelect={() => {}} onOpenScanner={() => {}}
      items={[item('a', 'Cát vàng'), item('b', 'Thép D16'), item('c', 'Xi măng PCB40')]} frequent={[{ itemId: 'c', count: 4 }, { itemId: 'b', count: 2 }]} />);
    expect(html.indexOf('Xi măng PCB40')).toBeLessThan(html.indexOf('Thép D16'));
    expect(html.indexOf('Thép D16')).toBeLessThan(html.indexOf('Cát vàng'));
    expect(html).toContain('Hay đề xuất · 4 phiếu gần đây');
  });

  it('không có lịch sử thì ô chọn như cũ', () => {
    const html = renderToStaticMarkup(<ItemSelectionModal isOpen allowAllItems showStockQuantities={false} onClose={() => {}} onSelect={() => {}} onOpenScanner={() => {}}
      items={[item('a', 'Cát vàng')]} />);
    expect(html).not.toContain('Hay đề xuất');
  });

  it('ô quy cách in mờ quy cách lần trước khi còn trống; đã gõ thì thôi', () => {
    const ghost = { text: 'D16 CB400', value: 'D16 CB400', title: 'Theo MR-3 (11/10)' };
    const empty = renderToStaticMarkup(<MaterialCommercialDescriptionFields name="Thép" itemId="b" specification="" onNameChange={() => {}} onSpecificationChange={() => {}} specificationGhost={ghost} />);
    expect(empty).toContain('placeholder="D16 CB400"');
    expect(empty).toContain('title="Theo MR-3 (11/10)"');
    const typed = renderToStaticMarkup(<MaterialCommercialDescriptionFields name="Thép" itemId="b" specification="D12" onNameChange={() => {}} onSpecificationChange={() => {}} specificationGhost={ghost} />);
    expect(typed).not.toContain('D16 CB400');
  });
});
