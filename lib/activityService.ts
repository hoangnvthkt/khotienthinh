import type { GlobalActivity } from '../types';
import { supabase } from './supabase';

export interface ActivityCursor {
  timestamp: string;
  id: string;
}

export interface ActivityListPage {
  items: GlobalActivity[];
  nextCursor?: ActivityCursor;
}

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
    const limit = Math.min(Math.max(options.limit || 50, 1), 100);
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

    const rows = data || [];
    const pageRows = rows.slice(0, limit);
    const last = pageRows[pageRows.length - 1];

    return {
      items: pageRows.map(mapActivityFromDb),
      nextCursor: rows.length > limit && last ? { timestamp: last.timestamp, id: last.id } : undefined,
    };
  },

  fromRealtimeRow(row: any): GlobalActivity {
    return mapActivityFromDb(row);
  },
};
