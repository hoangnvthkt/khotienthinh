import { describe, expect, it } from 'vitest';
import type { ProcurementInboxDetail, ProcurementInboxLine } from '../procurementInboxService';
import { docBuyers, givenName, lineOwner, openLineOwners, splitLinesForOrder } from '../procurementLineAssignment';

const line = (lineId: string, remainingQty: number, assigneeUserId: string | null = null, assigneeName: string | null = null): ProcurementInboxLine => ({
  lineId, itemId: `item-${lineId}`, itemName: lineId, sku: null, unit: 'Cái', needQty: 10, orderedQty: 10 - remainingQty, receivedQty: 0,
  remainingQty, stockQty: 0, purchaseUnit: null, purchaseFactor: null, orders: [], assigneeUserId, assigneeName,
});
const doc = (lines: ProcurementInboxLine[], coordinator: string | null = 'mo'): ProcurementInboxDetail => ({
  sourceType: 'material_request', sourceId: 'MR-1', code: 'MR-2026-9787', title: null, projectId: 'p', projectCode: 'SMB', projectName: null,
  warehouseId: 'w', warehouseName: null, neededDate: null, requesterName: null, approvedAt: null, approvedByName: null,
  constructionSiteId: null, periodType: null, periodStart: null, closure: null, lines,
  assignment: coordinator ? { assigneeUserId: coordinator, assigneeName: coordinator === 'mo' ? 'Nguyễn Thị Mơ' : coordinator, assignedAt: '2026-10-08', note: null } : null,
});

describe('giao việc theo dòng', () => {
  it('dòng chưa giao riêng thuộc người điều phối', () => {
    const d = doc([line('a', 5), line('b', 5, 'hung', 'Trần Văn Hùng')]);
    expect(lineOwner(d.lines[0], d)).toEqual({ userId: 'mo', name: 'Nguyễn Thị Mơ', explicit: false });
    expect(lineOwner(d.lines[1], d)).toEqual({ userId: 'hung', name: 'Trần Văn Hùng', explicit: true });
  });

  it('đếm người mua theo dòng còn thiếu, chưa có người mua xếp cuối', () => {
    const d = doc([line('a', 5), line('b', 5, 'hung', 'Hùng'), line('c', 5, 'hung', 'Hùng'), line('d', 0, 'mo', 'Mơ')], null);
    expect(openLineOwners(d)).toEqual([
      { userId: 'hung', name: 'Hùng', count: 2 },
      { userId: null, name: null, count: 1 },
    ]);
  });

  it('phiếu chưa chia: lập đơn lấy mọi dòng như trước', () => {
    const d = doc([line('a', 5), line('b', 5)]);
    const r = splitLinesForOrder([d], 'hung');
    expect([...r.include]).toEqual(['material_request:MR-1:a', 'material_request:MR-1:b']);
    expect(r.skipped).toEqual([]);
  });

  it('phiếu đã chia: chỉ dòng của mình + dòng chưa có người mua, báo dòng bỏ qua', () => {
    const mine = doc([line('a', 5), line('b', 5, 'hung', 'Hùng'), line('c', 0, 'hung', 'Hùng')]);
    const asHung = splitLinesForOrder([mine], 'hung');
    expect([...asHung.include]).toEqual(['material_request:MR-1:b', 'material_request:MR-1:c']);
    expect(asHung.skipped).toEqual([{ name: 'Nguyễn Thị Mơ', count: 1 }]);
    const asMo = splitLinesForOrder([mine], 'mo');
    expect([...asMo.include]).toEqual(['material_request:MR-1:a']);
    expect(asMo.skipped).toEqual([{ name: 'Hùng', count: 1 }]);
    const noCoordinator = splitLinesForOrder([doc([line('a', 5), line('b', 5, 'hung', 'Hùng')], null)], 'an');
    expect([...noCoordinator.include]).toEqual(['material_request:MR-1:a']);
  });

  it('dòng đã tick thắng mọi quy tắc', () => {
    const d = doc([line('a', 5), line('b', 5, 'hung', 'Hùng')]);
    const r = splitLinesForOrder([d], 'mo', new Set(['material_request:MR-1:b']));
    expect([...r.include]).toEqual(['material_request:MR-1:b']);
  });

  it('tóm tắt trên danh sách chỉ khi phiếu có nhiều người mua hoặc dòng chưa giao', () => {
    expect(docBuyers({ progress: 'new', lineAssignees: [{ userId: 'mo', name: 'Mơ', lines: 5, openLines: 5 }], unassignedOpenLines: 0 })).toBeNull();
    expect(docBuyers({ progress: 'new', lineAssignees: [], unassignedOpenLines: 5 })).toBeNull();
    expect(docBuyers({ progress: 'partial', unassignedOpenLines: 0, lineAssignees: [
      { userId: 'mo', name: 'Mơ', lines: 3, openLines: 3 }, { userId: 'hung', name: 'Hùng', lines: 2, openLines: 0 },
    ] })).toBeNull();
    expect(docBuyers({ progress: 'new', unassignedOpenLines: 1, lineAssignees: [{ userId: 'mo', name: 'Mơ', lines: 3, openLines: 3 }] }))
      .toEqual({ people: [{ userId: 'mo', name: 'Mơ', lines: 3, openLines: 3, count: 3 }], unassigned: 1 });
    expect(docBuyers({ progress: 'new' })).toEqual(null);
  });

  it('tên gọi ngắn', () => {
    expect(givenName('Nguyễn Thị Mơ')).toBe('Mơ');
    expect(givenName(null)).toBe('—');
  });
});
