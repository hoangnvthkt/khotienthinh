import type { GlobalActivity } from '../types';
import { supabase } from './supabase';
import { clampPageSize, takeCursorPage, type CursorPage } from './supabasePagination';

export interface ActivityCursor {
  timestamp: string;
  id: string;
}

export type ActivityListPage = CursorPage<GlobalActivity, ActivityCursor>;

const ACTIVITY_SELECT = 'id,type,action,description,status,timestamp,user_id,user_name,user_avatar,warehouse_id';

const mapActivityFromDb = (row: any): GlobalActivity => ({
  id: row.id,
  userId: row.user_id,
  userName: row.user_name,
  userAvatar: row.user_avatar || undefined,
  type: row.type as GlobalActivity['type'],
  action: row.action,
  description: row.description,
  timestamp: row.timestamp,
  warehouseId: row.warehouse_id || undefined,
  status: row.status as GlobalActivity['status'],
});

export const activityService = {
  async listPage(options: {
    limit?: number;
    cursor?: ActivityCursor;
    warehouseId?: string | null;
  } = {}): Promise<ActivityListPage> {
    const limit = clampPageSize(options.limit);
    let query = supabase
      .from('activities')
      .select(ACTIVITY_SELECT)
      .order('timestamp', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    if (options.warehouseId) {
      query = query.eq('warehouse_id', options.warehouseId);
    }

    if (options.cursor?.timestamp && options.cursor.id) {
      query = query.or(`timestamp.lt.${options.cursor.timestamp},and(timestamp.eq.${options.cursor.timestamp},id.lt.${options.cursor.id})`);
    }

    const { data, error } = await query;
    if (error) throw error;

    const page = takeCursorPage(data || [], limit, row => ({ timestamp: row.timestamp, id: row.id }));

    return {
      items: page.items.map(mapActivityFromDb),
      nextCursor: page.nextCursor,
    };
  },

  fromRealtimeRow(row: any): GlobalActivity {
    return mapActivityFromDb(row);
  },
};
