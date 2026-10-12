import { describe, expect, it } from 'vitest';
import { RequestStatus, type MaterialRequest } from '../../types';
import { buildSiteItemHistory, frequentSiteItems, siteSpecGhost } from '../materialRequestPrefill';

const req = (over: Partial<MaterialRequest>): MaterialRequest => ({
  id: over.id || 'r', code: over.code || 'MR-1', projectId: 'p1', status: RequestStatus.APPROVED, createdDate: '2026-10-10', items: [], ...over,
} as MaterialRequest);
const line = (itemId: string, specification = '') => ({ itemId, requestQty: 1, specification } as any);

describe('buildSiteItemHistory', () => {
  const requests = [
    req({ id: 'a', code: 'MR-3', createdDate: '2026-10-11', items: [line('thep', ''), line('thep', 'D16'), line('xm')] }),
    req({ id: 'b', code: 'MR-2', createdDate: '2026-10-05', items: [line('thep', 'D12 CB300')] }),
    req({ id: 'c', code: 'MR-1', createdDate: '2026-10-01', items: [line('cat')], status: RequestStatus.REJECTED }),
    req({ id: 'd', code: 'MR-0', createdDate: '2026-06-01', items: [line('da')] }),
    req({ id: 'e', code: 'MR-X', projectId: 'p2', createdDate: '2026-10-11', items: [line('gach')] }),
  ];
  const map = buildSiteItemHistory(requests, { projectId: 'p1', today: '2026-10-13' });

  it('đếm theo phiếu, chỉ cùng dự án, trong 90 ngày, bỏ phiếu nháp / từ chối', () => {
    expect([...map.keys()].sort()).toEqual(['thep', 'xm']);
    expect(map.get('thep')).toMatchObject({ count: 2, lastCode: 'MR-3', lastDate: '2026-10-11' });
  });

  it('quy cách lấy lần gần nhất có ghi', () => {
    expect(map.get('thep')).toMatchObject({ lastSpec: 'D16', lastSpecCode: 'MR-3' });
    expect(siteSpecGhost(map.get('thep'))).toEqual({ text: 'D16', value: 'D16', title: 'Theo MR-3 (11/10)' });
    expect(siteSpecGhost(map.get('xm'))).toBeNull();
  });

  it('bỏ phiếu đang sửa; không có phạm vi thì rỗng', () => {
    expect(buildSiteItemHistory(requests, { projectId: 'p1', excludeRequestId: 'a', today: '2026-10-13' }).get('thep')?.lastSpec).toBe('D12 CB300');
    expect(buildSiteItemHistory(requests, {}).size).toBe(0);
  });

  it('hay đề xuất: nhiều phiếu trước, cùng số thì gần đây trước', () => {
    expect(frequentSiteItems(map).map(e => e.itemId)).toEqual(['thep', 'xm']);
  });
});
