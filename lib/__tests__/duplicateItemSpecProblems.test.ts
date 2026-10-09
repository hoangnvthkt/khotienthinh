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
  it('specKey khớp lower(btrim()) phía máy chủ', () => {
    expect(specKey('  Loại 1 ')).toBe('loại 1');
    expect(specKey(null)).toBe('');
  });
});
