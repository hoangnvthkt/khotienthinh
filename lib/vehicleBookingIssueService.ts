import type {
  VehicleBookingIssuePage,
  VehicleBookingIssueStatus,
} from '../types';
import { supabase } from './supabase';

export interface VehicleBookingIssueFilter {
  status?: VehicleBookingIssueStatus;
  limit?: number;
  cursor?: { createdAt: string; id: string } | null;
}

export interface VehicleBookingIssueTransitionInput {
  issueId: string;
  targetStatus: VehicleBookingIssueStatus;
  resolutionNote?: string;
}

export const getVehicleBookingIssueTransitions = (
  status: VehicleBookingIssueStatus,
): VehicleBookingIssueStatus[] => {
  if (status === 'PENDING') return ['IN_REVIEW'];
  if (status === 'IN_REVIEW') return ['RESOLVED', 'DISMISSED'];
  return [];
};

export function validateVehicleBookingIssueTransition(
  currentStatus: VehicleBookingIssueStatus,
  targetStatus: VehicleBookingIssueStatus,
  resolutionNote: string,
): string | null {
  if (!getVehicleBookingIssueTransitions(currentStatus).includes(targetStatus)) {
    return 'Trạng thái xử lý không hợp lệ.';
  }
  const note = resolutionNote.trim();
  if (['RESOLVED', 'DISMISSED'].includes(targetStatus) && !note) {
    return 'Vui lòng ghi nhận kết quả xử lý.';
  }
  if (note.length > 4000) return 'Kết quả xử lý không được vượt quá 4.000 ký tự.';
  return null;
}

export async function fetchVehicleBookingIssues(
  filter: VehicleBookingIssueFilter,
): Promise<VehicleBookingIssuePage> {
  const limit = Math.min(100, Math.max(1, filter.limit || 50));
  const { data, error } = await supabase.rpc('get_vehicle_booking_issues', {
    p_status: filter.status || null,
    p_limit: limit,
    p_cursor_created_at: filter.cursor?.createdAt || null,
    p_cursor_id: filter.cursor?.id || null,
  });
  if (error) throw error;
  const payload = (data || {}) as Partial<VehicleBookingIssuePage>;
  return {
    items: Array.isArray(payload.items) ? payload.items : [],
    nextCursor: payload.nextCursor || null,
  };
}

export async function transitionVehicleBookingIssue(
  input: VehicleBookingIssueTransitionInput,
): Promise<{ success: boolean; status: VehicleBookingIssueStatus }> {
  const { data, error } = await supabase.rpc('transition_vehicle_booking_issue', {
    p_issue_id: input.issueId,
    p_target_status: input.targetStatus,
    p_resolution_note: input.resolutionNote?.trim() || null,
  });
  if (error) throw error;
  return data as { success: boolean; status: VehicleBookingIssueStatus };
}
