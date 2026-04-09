import { supabase } from './supabase';
import { DashboardLayout, WidgetConfig, DEFAULT_LAYOUT } from './widgetRegistry';

// ══════════════════════════════════════════
//  DASHBOARD SERVICE — CRUD for layouts
// ══════════════════════════════════════════

const fromDb = (row: any): DashboardLayout => ({
  id: row.id,
  userId: row.user_id,
  name: row.name,
  layout: row.layout || [],
  isDefault: row.is_default,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const dashboardService = {
  /** Get user's dashboard layouts */
  async getLayouts(userId: string): Promise<DashboardLayout[]> {
    const { data, error } = await supabase
      .from('dashboard_layouts')
      .select('*')
      .eq('user_id', userId)
      .order('is_default', { ascending: false });
    if (error) { console.error('dashboardService.getLayouts error:', error); return []; }
    return (data || []).map(fromDb);
  },

  /** Get active (default) layout, or create one if none exists */
  async getActiveLayout(userId: string): Promise<DashboardLayout> {
    const layouts = await this.getLayouts(userId);
    const defaultLayout = layouts.find(l => l.isDefault) || layouts[0];
    if (defaultLayout) return defaultLayout;

    // Create default layout if none
    return this.createLayout(userId, 'Mặc định', DEFAULT_LAYOUT, true);
  },

  /** Create a new layout */
  async createLayout(userId: string, name: string, layout: WidgetConfig[], isDefault = false): Promise<DashboardLayout> {
    const { data, error } = await supabase
      .from('dashboard_layouts')
      .insert({ user_id: userId, name, layout, is_default: isDefault })
      .select()
      .single();
    if (error) throw error;
    return fromDb(data);
  },

  /** Update existing layout */
  async updateLayout(id: string, updates: { name?: string; layout?: WidgetConfig[]; isDefault?: boolean }): Promise<void> {
    const payload: any = { updated_at: new Date().toISOString() };
    if (updates.name !== undefined) payload.name = updates.name;
    if (updates.layout !== undefined) payload.layout = updates.layout;
    if (updates.isDefault !== undefined) payload.is_default = updates.isDefault;

    const { error } = await supabase
      .from('dashboard_layouts')
      .update(payload)
      .eq('id', id);
    if (error) throw error;
  },

  /** Delete a layout */
  async deleteLayout(id: string): Promise<void> {
    const { error } = await supabase
      .from('dashboard_layouts')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },
};
