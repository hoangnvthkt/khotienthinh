import type {
  VehicleBookingAuditPage,
  VehicleBookingAuditSourceType,
} from '../types';
import { supabase } from './supabase';

export interface VehicleBookingAuditFilter {
  bookingId?: string;
  departmentId?: string;
  sourceType?: VehicleBookingAuditSourceType;
  fromAt?: string;
  toAt?: string;
  limit?: number;
  cursor?: { occurredAt: string; id: string } | null;
}

export async function fetchVehicleBookingAuditTimeline(
  filter: VehicleBookingAuditFilter,
): Promise<VehicleBookingAuditPage> {
  const limit = Math.min(100, Math.max(1, filter.limit || 50));
  const { data, error } = await supabase.rpc('get_vehicle_booking_audit_timeline', {
    p_booking_id: filter.bookingId || null,
    p_department_id: filter.departmentId || null,
    p_event_type: filter.sourceType || null,
    p_from_at: filter.fromAt || null,
    p_to_at: filter.toAt || null,
    p_limit: limit,
    p_cursor_occurred_at: filter.cursor?.occurredAt || null,
    p_cursor_id: filter.cursor?.id || null,
  });
  if (error) throw error;
  const payload = (data || {}) as Partial<VehicleBookingAuditPage>;
  return {
    items: Array.isArray(payload.items) ? payload.items : [],
    nextCursor: payload.nextCursor || null,
  };
}
