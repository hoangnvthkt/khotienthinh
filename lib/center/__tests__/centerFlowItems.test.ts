import { describe, expect, it } from 'vitest';
import { FLOW_UNASSIGNED, parseFlowItem, parseFlowItemsResult, parseFlowRemindResult } from '../centerFlowService';
import { moduleRouteFor, resolveDrillTarget } from '../drill';
import { displayCode } from '../workItemsService';

// Hình dạng JSON của vcc_flow_items_v1 / vcc_flow_remind_v1 (migration 20261013180000). Mỗi dòng là vcc_item + thông tin dòng chảy,
// nên mở được thành tab y như "Việc của tôi".
const ROW = {
  source: 'mr', module: 'project', kind: 'watch', id: 'flow-mr-legacy', code: 'MR-FLOW-1', title: 'Flow test đề xuất', who: 'Flow rollback head đang giữ', whoId: 'u-head',
  meta: 'Đề xuất vật tư · FLOW-P', dueAt: '2026-10-16T02:00:00+00:00', status: 'PENDING',
  ref: { requestId: 'flow-mr-legacy', projectId: 'p1', requestOrigin: 'project', siteWarehouseId: 'wh' },
  holder: { userId: 'u-head', name: 'Flow rollback head', unitId: 'u1' }, holderRole: null, sender: { userId: 'u-s1', name: 'Flow rollback staff1', unitId: 'u1' },
  since: '2026-10-11T02:00:00+00:00', stuck: false, overdue: false, dead: false, slaDefault: false, kindName: 'Đề xuất vật tư', projectId: 'p1', projectCode: 'FLOW-P',
};

describe('flow items', () => {
  it('parses a server row into a WorkItem that the Center can open as a tab', () => {
    const item = parseFlowItem(ROW)!;
    expect(item).toMatchObject({ source: 'mr', module: 'project', kind: 'watch', code: 'MR-FLOW-1', holder: { name: 'Flow rollback head', unitId: 'u1' }, stuck: false });
    expect(displayCode(item)).toBe('MR-FLOW-1');
    expect(moduleRouteFor(item)).toBe('/da?projectId=p1&tab=material&materialTab=request&requestId=flow-mr-legacy');
    expect(resolveDrillTarget(item).kind).toBe('tab');
  });

  it('defaults unknown kinds, modules and missing people without inventing numbers', () => {
    const item = parseFlowItem({ ...ROW, kind: 'bogus', module: 'nope', holder: null, holderRole: 'Thủ kho', sender: { userId: 'x' }, projectCode: null })!;
    expect(item.kind).toBe('watch');
    expect(item.module).toBe('work');
    expect(item.holder).toBeNull();
    expect(item.holderRole).toBe('Thủ kho');
    expect(item.sender).toMatchObject({ userId: 'x', name: null, unitId: FLOW_UNASSIGNED });
    expect(parseFlowItem({ code: 'no id' })).toBeNull();
  });

  it('parses a page and a denial', () => {
    const page = parseFlowItemsResult({ access: true, generatedAt: 'x', total: 7, limit: 2, offset: 2, items: [ROW, { bad: true }] });
    expect(page.access && page.items).toHaveLength(1);
    expect(page.access && [page.total, page.limit, page.offset]).toEqual([7, 2, 2]);
    expect(parseFlowItemsResult({ access: false, reason: 'no_scope' })).toEqual({ access: false, reason: 'no_scope' });
  });

  it('parses reminder outcomes', () => {
    const r = parseFlowRemindResult({ access: true, sent: 1, skipped: 2, holders: [{ userId: 'a', name: 'A', items: 3, status: 'sent' }, { userId: 'b', name: null, items: 1, status: 'self' }, { userId: 'c', items: 1, status: 'weird' }] });
    expect(r.access && r.sent).toBe(1);
    expect(r.access && r.holders.map(h => h.status)).toEqual(['sent', 'self', 'skipped']);
    expect(parseFlowRemindResult(null)).toEqual({ access: false, reason: 'unknown' });
  });
});
