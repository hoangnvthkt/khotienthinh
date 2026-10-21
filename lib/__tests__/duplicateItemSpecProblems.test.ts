import { describe, expect, it } from 'vitest';
import { duplicateItemSpecProblems, specKey } from '../materialLineDescription';

describe('duplicateItemSpecProblems — một mã nhiều quy cách', () => {
  it('một dòng mỗi mã: không bắt quy cách', () => {
    expect(duplicateItemSpecProblems([{ key: 'a', itemId: 'i1' }, { key: 'b', itemId: 'i2', specification: '' }]).size).toBe(0);
  });
  it('cùng mã khác quy cách: hợp lệ', () => {
    expect(duplicateItemSpecProblems([
      { key: 'a', itemId: 'i1', specification: 'Loại 1' }, { key: 'b', itemId: 'i1', specification: 'Loại 2' },
    ]).size).toBe(0);
  });
  it('cùng mã thiếu quy cách hoặc trùng (bỏ hoa thường, khoảng trắng): báo đúng dòng', () => {
    const p = duplicateItemSpecProblems([
      { key: 'a', itemId: 'i1', specification: ' Tôn  biên ' }, { key: 'b', itemId: 'i1', specification: 'tôn biên' }, { key: 'c', itemId: 'i1' },
      { key: 'd', itemId: 'i2', specification: 'x' },
    ]);
    expect([...p.keys()].sort()).toEqual(['a', 'b', 'c']);
    expect(p.get('c')).toMatch(/ghi quy cách/);
    expect(p.get('a')).toMatch(/Trùng quy cách/);
  });
  it('specKey khớp catalog_name_key phía máy chủ (bỏ dấu, dấu cách, x/*/×, phẩy thập phân, ly = mm)', () => {
    expect(specKey('  Loại 1 ')).toBe('loai1');
    expect(specKey('Hòa Phát CB-300')).toBe(specKey('hoa phat cb 300'));
    expect(specKey('V120*30*1,5ly')).toBe('v120x30x15mm');
    expect(specKey(null)).toBe('');
  });
});
