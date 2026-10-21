// Đo gợi ý in mờ: mỗi lần người dùng nhận / bỏ / sửa một gợi ý điền sẵn ghi một dòng, để tính tỷ lệ dùng theo màn.
// Ghi nền, không bao giờ chặn thao tác; lỗi chỉ in ra console.
import { supabase } from './supabase';

export type SuggestionOutcome = 'accepted' | 'dismissed' | 'edited';

export interface SuggestionEvent {
  /** Màn: 'daily_log', 'purchase_order', … */
  screen: string;
  /** Nhóm ô: 'labor', 'machines', 'weather', … */
  field: string;
  outcome: SuggestionOutcome;
  /** Số dòng / ô được gợi ý và số được giữ nguyên. */
  suggested?: number;
  accepted?: number;
  /** Nguồn gợi ý (id chứng từ, ngày…) — không ghi nội dung. */
  source?: Record<string, unknown>;
}

export const recordSuggestionEvent = (event: SuggestionEvent): void => {
  void supabase.from('ui_suggestion_events').insert({
    screen: event.screen,
    field: event.field,
    outcome: event.outcome,
    suggested: event.suggested ?? 0,
    accepted: event.accepted ?? 0,
    source: event.source ?? {},
  }).then(({ error }) => { if (error) console.warn('ui_suggestion_events:', error.message); });
};
