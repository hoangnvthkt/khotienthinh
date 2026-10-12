import { describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('../supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }));

import { fetchUiSuggestionStats, groupSuggestionRows, ratioPercent, suggestionFieldLabel, suggestionScreenLabel } from '../uiSuggestionStats';

describe('uiSuggestionStats', () => {
  it('nhãn tiếng Việt cho màn / ô đã biết, giữ mã khi lạ; % không che bằng 0', () => {
    expect(suggestionScreenLabel('daily_log')).toBe('Nhật ký công trường');
    expect(suggestionFieldLabel('price')).toBe('Đơn giá');
    expect(suggestionFieldLabel('something_new')).toBe('something_new');
    expect(ratioPercent(2, 3)).toBe(67);
    expect(ratioPercent(0, 0)).toBeNull();
  });

  it('đọc RPC, ép số, nhóm theo màn nhiều lượt trước và ô nhiều lượt trước', async () => {
    rpc.mockResolvedValueOnce({
      data: {
        days: '30', from: '2026-09-13T00:00:00Z', total: { events: '7', users: '3', firstAt: '2026-10-12T01:00:00Z', lastAt: null },
        screens: [{ screen: 'purchase_order', events: 5, users: 2 }, { screen: 'daily_log', events: 2, users: 1 }],
        rows: [
          { screen: 'daily_log', field: 'weather', events: 2, accepted: 2, edited: 0, dismissed: 0, suggestedRows: 2, acceptedRows: 2, users: 1, lastAt: null },
          { screen: 'purchase_order', field: 'spec', events: 2, accepted: 1, edited: 1, dismissed: 0, suggestedRows: 4, acceptedRows: 3, users: 2, lastAt: null },
          { screen: 'purchase_order', field: 'header', events: 3, accepted: 2, edited: 0, dismissed: 1, suggestedRows: 6, acceptedRows: 4, users: 2, lastAt: null },
        ],
      },
      error: null,
    });
    const stats = await fetchUiSuggestionStats(30);
    expect(rpc).toHaveBeenCalledWith('get_ui_suggestion_stats_v1', { p_days: 30 });
    expect(stats.total).toEqual({ events: 7, users: 3, firstAt: '2026-10-12T01:00:00Z', lastAt: null });
    const groups = groupSuggestionRows(stats);
    expect(groups.map(g => g.screen)).toEqual(['purchase_order', 'daily_log']);
    expect(groups[0]).toMatchObject({ events: 5, users: 2 });
    expect(groups[0].rows.map(r => r.field)).toEqual(['header', 'spec']);
  });

  it('lỗi RPC thì ném ra (màn hiện lỗi, không hiện 0)', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'SUGGESTION_STATS_ADMIN_REQUIRED' } });
    await expect(fetchUiSuggestionStats(7)).rejects.toMatchObject({ code: '42501' });
  });
});
