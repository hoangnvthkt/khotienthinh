import { describe, expect, it } from 'vitest';
import { filterCandidates, selectDisplayed, validateSelectedSources } from '../projectV2/sourcePicker';

const source = (overrides: Record<string, unknown> = {}) => ({
  sourcePlanId: 'plan-a', sourceRevision: 2, sourcePlanHash: 'hash-a',
  sourceLineId: 'line-a', sourceQuantity: '10.000000', availableQuantity: '7.000000',
  sourceUnit: 'm3', workspaceId: 'workspace-a', sourceStatus: 'approved',
  unavailableReason: null, code: 'M01', title: 'Móng', ...overrides,
});

describe('Project V2 source selection', () => {
  it('accepts only approved, scoped, available sources', () => {
    const rows = [source(), source({ sourceLineId: 'pending', sourceStatus: 'pending_approval' }),
      source({ sourceLineId: 'other', workspaceId: 'workspace-b' }),
      source({ sourceLineId: 'empty', availableQuantity: '0.000000', unavailableReason: 'Đã phân bổ hết' })];
    expect(filterCandidates(rows, 'workspace-a', '').map(row => row.sourceLineId)).toEqual(['line-a', 'pending', 'empty']);
    expect(validateSelectedSources(rows, ['line-a', 'pending', 'other', 'empty'], 'workspace-a'))
      .toEqual([{ sourceLineId: 'pending', reason: 'Nguồn chưa được duyệt' },
        { sourceLineId: 'other', reason: 'Nguồn không thuộc dự án này' },
        { sourceLineId: 'empty', reason: 'Đã phân bổ hết' }]);
  });

  it('preserves selected rows across search and selects only displayed usable results', () => {
    const rows = [source(), source({ sourceLineId: 'line-b', code: 'M02', title: 'Cột' }),
      source({ sourceLineId: 'line-c', code: 'M03', title: 'Móng phụ', unavailableReason: 'Nguồn hết hiệu lực' })];
    const shown = filterCandidates(rows, 'workspace-a', 'móng');
    expect(selectDisplayed(['line-b'], shown, 'workspace-a')).toEqual(['line-b', 'line-a']);
  });

  it('rejects a changed source revision and never clips requested quantity', () => {
    const rows = [source({ sourceRevision: 3, sourcePlanHash: 'hash-new' })];
    expect(validateSelectedSources(rows, ['line-a'], 'workspace-a', { 'line-a': { revision: 2, hash: 'hash-a', quantity: '8.000000' } }))
      .toEqual([{ sourceLineId: 'line-a', reason: 'Nguồn đã đổi phiên bản' },
        { sourceLineId: 'line-a', reason: 'Khối lượng vượt khả dụng (7.000000)' }]);
  });

  it('keeps unknown availability explicit', () => {
    expect(validateSelectedSources([source({ availableQuantity: null })], ['line-a'], 'workspace-a'))
      .toEqual([{ sourceLineId: 'line-a', reason: 'Chưa xác định khối lượng khả dụng' }]);
  });
});
