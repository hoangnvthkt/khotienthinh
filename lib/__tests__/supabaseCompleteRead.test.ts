import { describe, expect, it } from 'vitest';
import { fetchAllSupabaseRows } from '../supabaseCompleteRead';

const queryFake = <T>(
  pages: Array<{ data: T[] | null; error: any }>,
  url?: URL,
) => {
  const calls: Array<[string, ...any[]]> = [];
  let pageIndex = 0;
  const query: any = {
    url,
    order(column: string, options: any) {
      calls.push(['order', column, options]);
      if (url) {
        const next = `${column}.${options?.ascending === false ? 'desc' : 'asc'}`;
        const existing = url.searchParams.get('order');
        url.searchParams.set('order', existing ? `${existing},${next}` : next);
      }
      return query;
    },
    limit(value: number) {
      calls.push(['limit', value]);
      return query;
    },
    gt(column: string, value: unknown) {
      calls.push(['gt', column, value]);
      return query;
    },
    then(resolve: any, reject: any) {
      return Promise.resolve(pages[pageIndex++] || { data: [], error: null }).then(resolve, reject);
    },
  };
  return { calls, query };
};

describe('fetchAllSupabaseRows', () => {
  it('reads every page and appends deterministic order columns', async () => {
    const fake = queryFake([
      { data: [{ id: '1' }, { id: '2' }], error: null },
      { data: [{ id: '3' }], error: null },
    ]);

    await expect(fetchAllSupabaseRows(fake.query, {
      label: 'test rows',
      maxRows: 10,
      orderBy: 'id',
      pageSize: 2,
    })).resolves.toEqual({ data: [{ id: '1' }, { id: '2' }, { id: '3' }], error: null });
    expect(fake.calls).toEqual([
      ['order', 'id', { ascending: true }],
      ['limit', 2],
      ['gt', 'id', '2'],
    ]);
  });

  it('returns the Supabase error without returning a partial result', async () => {
    const failure = { code: 'PGRST001', message: 'failed' };
    const fake = queryFake([
      { data: [{ id: '1' }], error: null },
      { data: null, error: failure },
    ]);

    await expect(fetchAllSupabaseRows(fake.query, {
      label: 'test rows',
      maxRows: 10,
      orderBy: 'id',
      pageSize: 1,
    })).resolves.toEqual({ data: null, error: failure });
  });

  it('uses keyset filters without replacing existing filters and restores business ordering', async () => {
    const url = new URL('https://example.test/rows?id=in.%281%2C2%2C3%29&order=created_at.desc');
    const fake = queryFake([
      { data: [
        { id: '1', created_at: '2026-01-01' },
        { id: '2', created_at: '2026-01-03' },
      ], error: null },
      { data: [{ id: '3', created_at: '2026-01-02' }], error: null },
    ], url);

    const result = await fetchAllSupabaseRows(fake.query, {
      label: 'ordered rows',
      maxRows: 10,
      orderBy: 'id',
      pageSize: 2,
    });

    expect(result.data?.map(row => row.id)).toEqual(['2', '3', '1']);
    expect(url.searchParams.getAll('id')).toEqual(['in.(1,2,3)', 'gt."2"']);
    expect(url.searchParams.has('order')).toBe(true);
    expect(url.searchParams.get('order')).toBe('id.asc');
    expect(fake.calls).not.toEqual(expect.arrayContaining([expect.arrayContaining(['range'])]));
  });

  it('fails visibly when another full page reaches the safety cap', async () => {
    const fake = queryFake([
      { data: [{ id: '1' }, { id: '2' }], error: null },
      { data: [{ id: '3' }, { id: '4' }], error: null },
    ]);

    const result = await fetchAllSupabaseRows(fake.query, {
      label: 'project finance read',
      maxRows: 3,
      orderBy: 'id',
      pageSize: 2,
    });
    expect(result.data).toBeNull();
    expect(result.error).toEqual(new Error('project finance read exceeded safety cap of 3 rows'));
  });

  it('rejects invalid page, cap, and ordering options', async () => {
    const fake = queryFake([]);
    await expect(fetchAllSupabaseRows(fake.query, {
      label: 'invalid', maxRows: 0, orderBy: 'id',
    })).rejects.toThrow('Maximum rows must be a positive integer');
    await expect(fetchAllSupabaseRows(fake.query, {
      label: 'invalid', maxRows: 10, orderBy: [],
    })).rejects.toThrow('deterministic order column');
  });
});
