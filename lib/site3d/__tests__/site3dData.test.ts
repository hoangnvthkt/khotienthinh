import { describe, expect, it } from 'vitest';
import { machineKinds, parseSite3dAccess, parseSite3dResult } from '../site3dData';

const raw = {
  access: true, canManage: false,
  project: { id: 'p1', code: 'DA29', name: 'XinHai' },
  today: '2026-10-17',
  tasks: [
    ['4', null, 'Xưởng', 0, null, null, null, null, null, null],
    ['4.3.1', '4', '  Lắp dựng   kết cấu thép ', 35.5, '2026-08-10', '2026-11-30', '2026-08-15', null, 120.4, 'tấn'],
    ['4.3.2', '4', 'Lợp tôn', '12', '2026-03-20', '2026-12-01', null, null, null, '–'],
  ],
  series: { '4.3.1': [['2026-09-01', 10], ['2026-10-01', 30], ['bad', 5]] },
  logs: [
    ['2026-10-16', 30, 'verified', [['Máy xúc PC200, ô tô tải', 'Máy xúc', 2]], [['Tổ cốt thép', 12]]],
    ['2026-10-15', 0, 'draft', [], []],
  ],
  stock: [['Cọc ly tâm  D300', 'm', '820']],
};

describe('parseSite3dResult', () => {
  it('quy ngày về số ngày từ đầu tháng của mốc sớm nhất, giữ đúng thứ tự cột', () => {
    const result = parseSite3dResult(raw);
    expect(result.access && 'data' in result).toBe(true);
    if (!result.access || !('data' in result)) return;
    const { data } = result;
    expect(new Date(data.startMs).toISOString().slice(0, 10)).toBe('2026-03-01'); // KH sớm nhất 20/03 → D0 = 01/03
    expect(data.today).toBe(230); // 17/10 - 01/03
    const task = data.tasks.find(t => t[0] === '4.3.1')!;
    expect(task[2]).toBe('Lắp dựng kết cấu thép');
    expect(task[3]).toBe(35.5);
    expect(task[4]).toBe(162); // 10/08
    expect(task[7]).toBeNull();
    expect(data.tasks.find(t => t[0] === '4.3.2')![3]).toBe(12);
    expect(data.tasks.find(t => t[0] === '4.3.2')![9]).toBe('–');
    expect(data.series['4.3.1']).toEqual([[184, 10], [214, 30]]);
  });

  it('nhật ký: tách đủ loại máy trong một dòng, bỏ ngày không có người / máy / tổ', () => {
    const result = parseSite3dResult(raw);
    if (!result.access || !('data' in result)) throw new Error('expected data');
    expect(result.data.logs).toHaveLength(1);
    const [day, workers, status, machines, labor] = result.data.logs[0];
    expect([day, workers, status]).toEqual([229, 30, 'verified']);
    expect(machines.map(m => m[0]).sort()).toEqual(['excavator', 'truck']);
    expect(labor).toEqual([['Tổ cốt thép', 12]]);
    expect(result.data.stock).toEqual([['Cọc ly tâm D300', 'm', 820]]);
  });

  it('không quyền / không thấy dự án', () => {
    expect(parseSite3dResult({ access: false, reason: 'no_permission' })).toEqual({ access: false, reason: 'no_permission' });
    expect(parseSite3dResult({ access: true, reason: 'not_found' })).toEqual({ access: true, canManage: false, project: null, reason: 'not_found' });
    expect(parseSite3dResult(null)).toEqual({ access: false, reason: 'unknown' });
  });
});

describe('parseSite3dAccess', () => {
  it('đọc danh sách dự án, bỏ dòng hỏng', () => {
    expect(parseSite3dAccess({ access: true, canManage: true, projects: [{ id: 'a', code: 'DA29', name: 'XinHai' }, { code: 'x' }] }))
      .toEqual({ access: true, canManage: true, projects: [{ id: 'a', code: 'DA29', name: 'XinHai' }] });
    expect(parseSite3dAccess({ access: false, reason: 'no_center' })).toEqual({ access: false, reason: 'no_center' });
  });
});

describe('machineKinds', () => {
  it('nhận đúng loại máy theo cách ghi nhật ký thật', () => {
    expect(machineKinds('Cẩu', 'Kato 25T')).toEqual(['crane']);
    expect(machineKinds('', 'Xe bồn bê tông')).toEqual([]);
    expect(machineKinds('Ô tô tải', 'Ô tô tải ben 15 tấn')).toEqual(['truck']);
    expect(machineKinds('Máy ép cọc', 'Robot ép cọc 260T')).toEqual(['pilepress']);
  });
});
