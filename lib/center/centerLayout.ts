import { supabase } from '../supabase';
import { CENTER_WIDGET_GROUPS, type CenterWidgetId } from './centerRegistry';
import type { CenterActionFlags } from './centerActions';
import type { CenterToday } from './centerTodayService';
import type { WidgetView } from './todayWidgets';

// Bố cục "Hôm nay" của từng người: thứ tự + ô đã ẩn, lưu ở center_user_layouts (PR-A) qua
// get/save_center_layout_v1. Chưa lưu gì → mặc định theo quyền máy chủ (kế hoạch 07 mục 5).

export interface CenterLayout {
  widgets: { order: CenterWidgetId[]; hidden: CenterWidgetId[] };
}

const WIDGET_IDS: readonly CenterWidgetId[] = CENTER_WIDGET_GROUPS.map(group => group.id);
const isWidgetId = (value: unknown): value is CenterWidgetId => typeof value === 'string' && (WIDGET_IDS as readonly string[]).includes(value);
const uniqueIds = (values: unknown): CenterWidgetId[] => {
  const out: CenterWidgetId[] = [];
  (Array.isArray(values) ? values : []).forEach(value => { if (isWidgetId(value) && !out.includes(value)) out.push(value); });
  return out;
};

/** null khi chưa lưu gì / dữ liệu lạ → dùng mặc định. */
export const parseCenterLayout = (raw: unknown): CenterLayout | null => {
  const row = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  const widgets = row?.widgets && typeof row.widgets === 'object' ? row.widgets as Record<string, unknown> : null;
  if (!widgets) return null;
  const order = uniqueIds(widgets.order);
  const hidden = uniqueIds(widgets.hidden);
  if (order.length === 0 && hidden.length === 0) return null;
  return { widgets: { order, hidden } };
};

/**
 * Mặc định theo quyền máy chủ (thay cho "mẫu quyền" vì Center không đọc mẫu trực tiếp):
 * kế toán (lập đề nghị chi) → Tài chính trước; Mua hàng (xem Cần mua) → Mua hàng & Kho trước;
 * thuộc dự án → Dự án trước; văn phòng không dự án → Nhân sự, Công việc, Hành chính; ẩn 3 ô theo dự án.
 */
export const defaultCenterLayout = (flags: CenterActionFlags | null, today: CenterToday | null): CenterLayout => {
  const hasProject = !!today?.project;
  if (flags?.finance?.paymentRequest) return { widgets: { order: ['finance', 'supply', 'work', 'office', 'hrm', 'project'], hidden: [] } };
  if (flags?.supply?.inbox) return { widgets: { order: ['supply', 'project', 'work', 'office', 'hrm', 'finance'], hidden: [] } };
  if (hasProject) return { widgets: { order: ['project', 'hrm', 'work', 'office', 'supply', 'finance'], hidden: [] } };
  return { widgets: { order: ['hrm', 'work', 'office', 'project', 'supply', 'finance'], hidden: ['project', 'supply', 'finance'] } };
};

/** Thứ tự đầy đủ: theo layout, ô chưa khai xếp sau theo thứ tự danh mục. */
export const fullOrder = (layout: CenterLayout): CenterWidgetId[] =>
  [...layout.widgets.order, ...WIDGET_IDS.filter(id => !layout.widgets.order.includes(id))];

export const applyCenterLayout = (views: WidgetView[], layout: CenterLayout): { visible: WidgetView[]; hidden: WidgetView[] } => {
  const order = fullOrder(layout);
  const sorted = [...views].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return {
    visible: sorted.filter(view => !layout.widgets.hidden.includes(view.id)),
    hidden: sorted.filter(view => layout.widgets.hidden.includes(view.id)),
  };
};

export const moveWidget = (layout: CenterLayout, id: CenterWidgetId, direction: -1 | 1): CenterLayout => {
  const order = fullOrder(layout);
  const index = order.indexOf(id);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= order.length) return layout;
  [order[index], order[next]] = [order[next], order[index]];
  return { widgets: { order, hidden: layout.widgets.hidden } };
};

export const hideWidget = (layout: CenterLayout, id: CenterWidgetId): CenterLayout =>
  layout.widgets.hidden.includes(id) ? layout : { widgets: { order: fullOrder(layout), hidden: [...layout.widgets.hidden, id] } };

export const showWidget = (layout: CenterLayout, id: CenterWidgetId): CenterLayout =>
  ({ widgets: { order: fullOrder(layout), hidden: layout.widgets.hidden.filter(item => item !== id) } });

export const sameLayout = (a: CenterLayout, b: CenterLayout): boolean =>
  fullOrder(a).join(',') === fullOrder(b).join(',') && [...a.widgets.hidden].sort().join(',') === [...b.widgets.hidden].sort().join(',');

export interface CenterLayoutRecord { layout: CenterLayout | null; version: number; canManage: boolean }

export const fetchCenterLayout = async (): Promise<CenterLayoutRecord> => {
  const { data, error } = await supabase.rpc('get_center_layout_v1');
  if (error) throw error;
  const row = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return { layout: parseCenterLayout(row.layout), version: typeof row.version === 'number' ? row.version : 0, canManage: row.canManage === true };
};

export const saveCenterLayout = async (layout: CenterLayout): Promise<number> => {
  const { data, error } = await supabase.rpc('save_center_layout_v1', { p_layout: layout });
  if (error) throw error;
  const row = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return typeof row.version === 'number' ? row.version : 0;
};
