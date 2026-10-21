import { describe, expect, it } from 'vitest';
import { buildLocalIndex, entityTerms, hitsForGateway, instantKinds, isLookupQuery, mergeHits, rankLocalHits, rankRecordHits, strongTopHit } from '../search/instantSearch';
import { parseQuery } from '../search/searchEngine';
import type { ServerRecord } from '../search/searchTypes';

const rec = (p: Partial<ServerRecord> & { kind: ServerRecord['kind']; id: string }): ServerRecord => ({
  code: null, title: null, subtitle: null, status: null, date: null, projectId: null, siteId: null, rank: 60, extra: {}, ...p,
});

describe('ô hỏi hai tầng — tìm ngay (19/10)', () => {
  it('câu dài: chỉ tìm từ khóa thực thể (tên viết hoa giữa câu, mã có số); câu ngắn dùng nguyên câu; không có thực thể → không tìm', () => {
    const terms = (q: string) => entityTerms(q, parseQuery(q)).map(g => g[0]);
    expect(terms('nhân viên Hương còn bao nhiêu ngày phép năm')).toEqual(['huong']);
    expect(terms('PO-272 giao được bao nhiêu kg rồi')).toEqual(['po-272']);
    expect(terms('Đề xuất 2 tấn xi măng PCB40, 50 cây thép D16 cho SMB')).toEqual(['pcb40', 'd16', 'smb']);
    expect(terms('hôm nay anh có việc gì phải làm')).toEqual([]);
    expect(terms('Nguyễn Văn Thanh')).toEqual(['nguyen', 'van', 'thanh']);
  });

  it('câu chỉ là mã / tên → mở; câu hỏi (bao nhiêu, còn, lập, đề xuất, có dấu ?) → hỏi AI', () => {
    expect(isLookupQuery('TT006974')).toBe(true);
    expect(isLookupQuery('Nguyễn Văn Thanh')).toBe(true);
    expect(isLookupQuery('PO-272')).toBe(true);
    expect(isLookupQuery('nhân viên Hương còn bao nhiêu ngày phép năm')).toBe(false);
    expect(isLookupQuery('Đề xuất 2 tấn xi măng cho SMB')).toBe(false);
    expect(isLookupQuery('PO-272 giao bao nhiêu rồi')).toBe(false);
    expect(isLookupQuery('Thanh là ai?')).toBe(false);
    expect(isLookupQuery('xin nghỉ phép ngày mai')).toBe(false);
    expect(isLookupQuery('a b c d e f g')).toBe(false);
  });

  it('xếp hồ sơ theo thước đo ô Tìm kiếm, bỏ trùng, tối đa 5; đúng mã (hạng 100) đứng đầu và là khớp chắc', () => {
    const parsed = parseQuery('TT006974');
    const hits = rankRecordHits([
      rec({ kind: 'employee', id: 'e1', code: 'TT006974', title: 'Nguyễn Văn Thanh', rank: 100 }),
      rec({ kind: 'employee', id: 'e1', code: 'TT006974', title: 'Nguyễn Văn Thanh', rank: 100 }),
      rec({ kind: 'employee', id: 'e2', code: 'TT006975', title: 'Nguyễn Văn Thành', rank: 80 }),
      ...Array.from({ length: 6 }, (_, i) => rec({ kind: 'project', id: `p${i}`, code: `DA${i}`, title: `Công trình ${i}`, rank: 20 })),
    ], parsed);
    expect(hits).toHaveLength(5);
    expect(hits[0].record.id).toBe('e1');
    expect(strongTopHit(hits)?.record.id).toBe('e1');
  });

  it('hai hồ sơ sát điểm, không đúng mã → không mở luôn (để người chọn hoặc hỏi AI)', () => {
    const parsed = parseQuery('Thanh');
    const hits = rankRecordHits([
      rec({ kind: 'employee', id: 'e1', code: 'TT1', title: 'Nguyễn Văn Thanh', rank: 60 }),
      rec({ kind: 'employee', id: 'e2', code: 'TT2', title: 'Trần Thị Thanh', rank: 60 }),
    ], parsed);
    expect(strongTopHit(hits)).toBeNull();
  });

  it('gửi cổng: bỏ SĐT / email trong extra; loại tìm ngay bỏ nguồn nặng và loại không có quyền mở', () => {
    const parsed = parseQuery('Thanh');
    const hits = rankRecordHits([rec({ kind: 'employee', id: 'e1', title: 'Thanh', extra: { phone: '0912', email: 'a@b.c', jobTitle: 'Tổ trưởng' } })], parsed);
    expect(hitsForGateway(hits)[0].extra).toEqual({ jobTitle: 'Tổ trưởng' });
    const kinds = instantKinds(route => route.startsWith('/hrm') || route === '/ep' || route.startsWith('/projects'));
    expect(kinds).toContain('employee');
    expect(kinds).not.toContain('wms_tx');
    expect(kinds).not.toContain('purchase_order');
  });
});

describe('tầng tìm ngay — trang + thao tác (19/10)', () => {
  const local = buildLocalIndex(
    [{ key: 'procurement', label: 'Mua hàng', route: '/procurement' }],
    () => [{ to: '/procurement', label: 'Mua hàng' }, { to: '/procurement?mode=orders', label: 'Đơn hàng' }],
    route => !route.startsWith('/finance'));
  it('chỉ mục: thao tác theo quyền (bỏ lệnh đổi giao diện), trang của thanh bên', () => {
    const keys = local.map(e => e.entry.key);
    expect(keys).toContain('action:leave');
    expect(keys).toContain('action:po');
    expect(keys).not.toContain('action:payment');
    expect(keys).not.toContain('action:theme');
    expect(local.some(e => e.entry.kind === 'page' && e.entry.route === '/procurement')).toBe(true);
  });
  it('"chấm công" → thao tác khớp chắc (Enter làm ngay); "xin nghỉ phép" hiện nhưng Enter đi AI (Trợ lý tự lo); câu dài → không tự mở; "mua hàng" → trang', () => {
    const q0 = 'chấm công';
    expect(strongTopHit(rankLocalHits(local, parseQuery(q0)), q0)?.entry.key).toBe('action:checkin');
    const q1 = 'xin nghỉ phép';
    const h1 = rankLocalHits(local, parseQuery(q1));
    expect(h1[0].entry.key).toBe('action:leave');
    expect(strongTopHit(h1, q1)).toBeNull();
    const q2 = 'xin nghỉ phép ngày mai lý do việc riêng';
    expect(strongTopHit(rankLocalHits(local, parseQuery(q2)), q2)).toBeNull();
    const q3 = 'mua hàng';
    const h3 = rankLocalHits(local, parseQuery(q3));
    expect(h3.some(h => h.entry.kind === 'page' && h.entry.route === '/procurement')).toBe(true);
  });
  it('ghép: hồ sơ đúng mã luôn trên cùng; trang / thao tác không gửi cổng', () => {
    const parsed = parseQuery('PO-272');
    const records = rankRecordHits([rec({ kind: 'purchase_order', id: 'po1', code: 'PO-272', title: 'Thép', rank: 100 })], parsed);
    const merged = mergeHits(records, rankLocalHits(local, parseQuery('đơn hàng')));
    expect(merged[0].record?.code).toBe('PO-272');
    expect(hitsForGateway(merged).map(r => r.code)).toEqual(['PO-272']);
  });
});
