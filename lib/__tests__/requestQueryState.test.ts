import { describe, expect, it } from 'vitest';
import { mergeRequestPage, requestQueryKey } from '../requestQueryState';

describe('request query state', () => {
  it('deduplicates overlapping cursor pages and preserves server order', () => {
    expect(mergeRequestPage(
      [{ id: 'r2' }, { id: 'r1' }],
      [{ id: 'r1' }, { id: 'r0' }],
    ).map(item => item.id)).toEqual(['r2', 'r1', 'r0']);
  });

  it('normalizes filter keys independent of object insertion order', () => {
    expect(requestQueryKey({ view: 'ALL', status: 'PENDING', search: '  mua  ' }))
      .toBe(requestQueryKey({ search: 'mua', status: 'PENDING', view: 'ALL' }));
  });
});
