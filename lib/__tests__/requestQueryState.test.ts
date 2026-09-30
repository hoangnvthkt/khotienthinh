import { describe, expect, it } from 'vitest';
import { buildRequestListParams, mergeRequestPage, parseRequestListParams, requestQueryKey } from '../requestQueryState';

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

describe('request list URL filters', () => {
  it('round-trips view, status, overdue and search through the URL', () => {
    const params = buildRequestListParams({ view: 'ASSIGNED_TO_ME', status: 'CANCELLED', overdue: true, search: 'RQ-2026' });
    expect(params.toString()).toBe('view=ASSIGNED_TO_ME&status=CANCELLED&overdue=1&q=RQ-2026');
    expect(parseRequestListParams(params)).toEqual({ view: 'ASSIGNED_TO_ME', status: 'CANCELLED', overdue: true, search: 'RQ-2026' });
  });

  it('omits defaults and ignores unknown values', () => {
    expect(buildRequestListParams({ view: 'ALL' }).toString()).toBe('');
    expect(parseRequestListParams(new URLSearchParams('view=HACK&status=DRAFT'))).toEqual({ view: 'ALL', status: undefined, overdue: false, search: '' });
  });
});
