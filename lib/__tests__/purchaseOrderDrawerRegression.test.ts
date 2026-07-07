import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../../pages/project/SupplyChainTab.tsx', import.meta.url),
  'utf8',
);

describe('purchase order drawer regression guard', () => {
  it('opens purchase order details in the right drawer instead of expanding rows in the list', () => {
    expect(source).toContain('const [selectedPoId, setSelectedPoId]');
    expect(source).toContain('fixed inset-0 z-[1000]');
    expect(source).toContain('max-w-[min(1280px,calc(100vw-24px))]');
    expect(source).toContain('Xử lý');

    expect(source).not.toContain('const [expandedPoId, setExpandedPoId]');
    expect(source).not.toContain('const togglePoExpanded');
    expect(source).not.toContain('onClick={() => togglePoExpanded(po)}');
  });

  it('keeps the drawer as the original full detail view without tabs or a separate action panel', () => {
    expect(source).toContain('Thông tin phiếu đặt hàng');
    expect(source).toContain('Lịch sử trả hàng NCC');
    expect(source).toContain('Thao tác phê duyệt & trạng thái');

    expect(source).not.toContain('PO_DETAIL_TABS');
    expect(source).not.toContain('PurchaseOrderActionPanel');
    expect(source).not.toContain('role="tab"');
  });

  it('collapses the material description table by default behind a triangle toggle', () => {
    expect(source).toContain('const [isPoItemsExpanded, setIsPoItemsExpanded]');
    expect(source).toContain('setIsPoItemsExpanded(false);');
    expect(source).toContain('aria-expanded={isPoItemsExpanded}');
    expect(source).toContain('setIsPoItemsExpanded(prev => !prev)');
    expect(source).toContain('isPoItemsExpanded ? <ChevronDown');
    expect(source).toContain('id={`po-items-table-${po.id}`}');

    expect(source).not.toContain('const [isPoMetaExpanded, setIsPoMetaExpanded]');
    expect(source).not.toContain('aria-expanded={isPoMetaExpanded}');
  });
});
