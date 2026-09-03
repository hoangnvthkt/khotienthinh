import { describe, expect, it, vi } from 'vitest';
import {
  chunkValues,
  clampPageSize,
  decodeCursor,
  encodeCursor,
  fetchAllPages,
  takeCursorPage,
} from '../supabasePagination';

describe('supabasePagination', () => {
  it('clamps page sizes to a safe integer range', () => {
    expect(clampPageSize(undefined)).toBe(50);
    expect(clampPageSize(0)).toBe(50);
    expect(clampPageSize(-10)).toBe(1);
    expect(clampPageSize(12.9)).toBe(12);
    expect(clampPageSize(500)).toBe(100);
    expect(clampPageSize(undefined, 25, 60)).toBe(25);
  });

  it('returns a cursor only when limit plus one proves another page', () => {
    expect(takeCursorPage([{ id: '3' }, { id: '2' }, { id: '1' }], 2, row => row.id))
      .toEqual({ items: [{ id: '3' }, { id: '2' }], nextCursor: '2' });
    expect(takeCursorPage([{ id: '2' }, { id: '1' }], 2, row => row.id))
      .toEqual({ items: [{ id: '2' }, { id: '1' }], nextCursor: undefined });
  });

  it('round-trips opaque cursors', () => {
    const cursor = { timestamp: '2026-09-03T02:00:00.000Z', id: 'row/đặc-biệt' };
    expect(decodeCursor<typeof cursor>(encodeCursor(cursor))).toEqual(cursor);
    expect(() => decodeCursor('not-a-cursor')).toThrow('Invalid pagination cursor');
  });

  it('chunks values without dropping their order', () => {
    expect(chunkValues([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkValues([], 2)).toEqual([]);
    expect(() => chunkValues([1], 0)).toThrow('Chunk size must be a positive integer');
  });

  it('reads every page and forwards the configured page size', async () => {
    const loadPage = vi.fn(async (cursor?: string) => cursor
      ? { items: [3], nextCursor: undefined }
      : { items: [1, 2], nextCursor: 'page-2' });

    await expect(fetchAllPages({ pageSize: 2, maxRows: 10, loadPage })).resolves.toEqual([1, 2, 3]);
    expect(loadPage).toHaveBeenNthCalledWith(1, undefined);
    expect(loadPage).toHaveBeenNthCalledWith(2, 'page-2');
  });

  it('fails instead of returning an incomplete complete-read result', async () => {
    await expect(fetchAllPages({
      pageSize: 2,
      maxRows: 3,
      loadPage: async cursor => cursor
        ? { items: [{ id: 3 }, { id: 4 }] }
        : { items: [{ id: 1 }, { id: 2 }], nextCursor: '2' },
    })).rejects.toThrow('exceeded safety cap of 3 rows');
  });

  it('rejects repeated cursors and cancellation', async () => {
    await expect(fetchAllPages({
      pageSize: 1,
      maxRows: 10,
      loadPage: async () => ({ items: [1], nextCursor: 'same' }),
    })).rejects.toThrow('repeated cursor');

    const controller = new AbortController();
    controller.abort();
    await expect(fetchAllPages({
      pageSize: 1,
      maxRows: 10,
      signal: controller.signal,
      loadPage: async () => ({ items: [] }),
    })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects invalid complete-read limits', async () => {
    await expect(fetchAllPages({
      pageSize: 0,
      maxRows: 10,
      loadPage: async () => ({ items: [] }),
    })).rejects.toThrow('Page size must be a positive integer');
    await expect(fetchAllPages({
      pageSize: 1,
      maxRows: 0,
      loadPage: async () => ({ items: [] }),
    })).rejects.toThrow('Maximum rows must be a positive integer');
  });
});
