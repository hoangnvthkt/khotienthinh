// Bảng đo gợi ý in mờ (chủ SP 11–13/10/2026): Admin xem người dùng nhận / sửa / bỏ gợi ý theo màn và ô — điều kiện "xong" của đợt
// gợi ý không cần AI trong lộ trình. Số liệu từ ui_suggestion_events qua RPC chỉ đọc.
import { supabase } from './supabase';

export interface UiSuggestionStatRow {
  screen: string;
  field: string;
  /** Số lượt gợi ý hiện ra và có kết quả (dùng / sửa / bỏ). */
  events: number;
  accepted: number;
  edited: number;
  dismissed: number;
  /** Số dòng (ô) máy gợi ý và số dòng người dùng giữ nguyên. */
  suggestedRows: number;
  acceptedRows: number;
  users: number;
  lastAt: string | null;
}

export interface UiSuggestionStats {
  days: number;
  from: string;
  total: { events: number; users: number; firstAt: string | null; lastAt: string | null };
  screens: Array<{ screen: string; events: number; users: number }>;
  rows: UiSuggestionStatRow[];
}

export const SUGGESTION_SCREEN_LABELS: Record<string, string> = {
  daily_log: 'Nhật ký công trường',
  purchase_order: 'Lập đơn mua hàng',
  material_request: 'Đề xuất vật tư',
};

export const SUGGESTION_FIELD_LABELS: Record<string, string> = {
  weather: 'Thời tiết',
  labor: 'Nhân công',
  machines: 'Máy thi công',
  description: 'Công việc hôm nay',
  header: 'Đầu đơn',
  spec: 'Quy cách',
  price: 'Đơn giá',
  item: 'Vật tư',
};

export const suggestionScreenLabel = (screen: string) => SUGGESTION_SCREEN_LABELS[screen] || screen;
export const suggestionFieldLabel = (field: string) => SUGGESTION_FIELD_LABELS[field] || field;

/** % làm tròn; null khi chưa có mẫu (không che bằng 0). */
export const ratioPercent = (part: number, whole: number) => whole > 0 ? Math.round((part / whole) * 100) : null;

const num = (value: unknown) => Number(value) || 0;

export const fetchUiSuggestionStats = async (days: number): Promise<UiSuggestionStats> => {
  const { data, error } = await supabase.rpc('get_ui_suggestion_stats_v1', { p_days: days });
  if (error) throw error;
  const raw = (data || {}) as Partial<UiSuggestionStats> & { total?: Partial<UiSuggestionStats['total']> };
  return {
    days: num(raw.days) || days,
    from: String(raw.from || ''),
    total: { events: num(raw.total?.events), users: num(raw.total?.users), firstAt: raw.total?.firstAt || null, lastAt: raw.total?.lastAt || null },
    screens: (raw.screens || []).map(s => ({ screen: String(s.screen), events: num(s.events), users: num(s.users) })),
    rows: (raw.rows || []).map(r => ({
      screen: String(r.screen), field: String(r.field), events: num(r.events), accepted: num(r.accepted), edited: num(r.edited), dismissed: num(r.dismissed),
      suggestedRows: num(r.suggestedRows), acceptedRows: num(r.acceptedRows), users: num(r.users), lastAt: r.lastAt || null,
    })),
  };
};

/** Nhóm dòng theo màn, giữ thứ tự màn nhiều lượt trước. */
export const groupSuggestionRows = (stats: UiSuggestionStats) => {
  const order = new Map(stats.screens.map((s, i) => [s.screen, i]));
  const groups = new Map<string, UiSuggestionStatRow[]>();
  stats.rows.forEach(row => { groups.set(row.screen, [...(groups.get(row.screen) || []), row]); });
  return Array.from(groups.entries())
    .sort((a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99))
    .map(([screen, rows]) => ({
      screen,
      users: stats.screens.find(s => s.screen === screen)?.users ?? null,
      events: rows.reduce((sum, r) => sum + r.events, 0),
      rows: [...rows].sort((a, b) => b.events - a.events),
    }));
};
