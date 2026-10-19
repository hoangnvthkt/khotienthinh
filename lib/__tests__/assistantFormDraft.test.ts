import { beforeEach, describe, expect, it } from 'vitest';
import { clearFormDraft, pruneFormDrafts, readFormDraft, writeFormDraft } from '../assistantFormDraft';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); },
    key: (i: number) => [...store.keys()][i] ?? null, get length() { return store.size; }, clear: () => store.clear(),
  } as Storage;
});

describe('nháp form thẻ Trợ lý (localStorage)', () => {
  it('ghi rồi đọc lại đúng dữ liệu; xóa thì hết; lệnh khác không thấy', () => {
    writeFormDraft('c1', { vat: '8', rows: [{ key: 'r1', price: '15850' }] });
    expect(readFormDraft<{ vat: string }>('c1')?.vat).toBe('8');
    expect(readFormDraft('c2')).toBeNull();
    clearFormDraft('c1');
    expect(readFormDraft('c1')).toBeNull();
  });

  it('bản quá 7 ngày coi như không có và bị dọn; quá 20 bản thì bỏ bản cũ nhất', () => {
    const t0 = 1_000_000_000_000;
    writeFormDraft('old', { a: 1 }, t0 - 8 * 24 * 3600_000);
    expect(readFormDraft('old', t0)).toBeNull();
    expect(store.has('vioo.assistant.formDraft.old')).toBe(false);
    for (let i = 0; i < 25; i++) writeFormDraft(`c${i}`, { i }, t0 + i);
    pruneFormDrafts(t0 + 100);
    expect(store.size).toBe(20);
    expect(store.has('vioo.assistant.formDraft.c0')).toBe(false);
    expect(store.has('vioo.assistant.formDraft.c24')).toBe(true);
  });

  it('localStorage hỏng (private mode) không ném lỗi', () => {
    (globalThis as unknown as { localStorage: Storage }).localStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } } as unknown as Storage;
    expect(() => writeFormDraft('x', { a: 1 })).not.toThrow();
    expect(readFormDraft('x')).toBeNull();
  });
});
