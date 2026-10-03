// Server calls for Điều động công trường. Every change goes through RPCs that check rights,
// overlaps and leave, and apply the record to attendance / leave approval on its start date.
import { supabase } from './supabase';
import type {
  SiteAssignment, SiteAssignmentKind, SiteAssignmentPreview, SiteReviewRow, SiteSummary,
} from './siteAssignment';

export interface SiteAssignmentBoard {
  assignments: SiteAssignment[];
  sites: SiteSummary[];
  review: SiteReviewRow[];
  can: { create: boolean; approve: boolean };
}

export interface SiteAssignmentDraft {
  employeeIds: string[];
  siteId: string;
  kind: SiteAssignmentKind;
  startDate: string;
  endDate: string | null;
  reason: string;
}

const rpc = async <T>(name: string, params: Record<string, unknown>, fallback: string): Promise<T> => {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw new Error(error.message || fallback);
  return data as T;
};

export const siteAssignmentService = {
  board(): Promise<SiteAssignmentBoard> {
    return rpc<SiteAssignmentBoard>('get_hrm_site_assignment_board', {}, 'Không tải được điều động.');
  },

  preview(draft: SiteAssignmentDraft): Promise<SiteAssignmentPreview> {
    return rpc<SiteAssignmentPreview>('preview_hrm_site_assignment', { p_payload: draft }, 'Không kiểm tra được phiếu.');
  },

  /** Returns the created codes, one per person. */
  submit(draft: SiteAssignmentDraft): Promise<string[]> {
    return rpc<string[]>('submit_hrm_site_assignment', { p_payload: draft }, 'Không gửi được phiếu điều động.');
  },

  decide(id: string, approve: boolean, note: string | null): Promise<void> {
    return rpc<void>('decide_hrm_site_assignment', { p_id: id, p_approve: approve, p_note: note }, 'Không lưu được quyết định.');
  },

  cancel(id: string, reason: string): Promise<void> {
    return rpc<void>('cancel_hrm_site_assignment', { p_id: id, p_reason: reason }, 'Không hủy được phiếu.');
  },

  /** End earlier or extend; the new end date must be today or later. Null = no end. */
  changeEnd(id: string, endDate: string | null, reason: string): Promise<void> {
    return rpc<void>('change_hrm_site_assignment_end', { p_id: id, p_end: endDate, p_reason: reason }, 'Không đổi được ngày kết thúc.');
  },

  /** HR confirms where people really work before H2 starts (siteId null = office, no assignment). */
  confirmReview(rows: Array<{ employeeId: string; siteId: string | null }>): Promise<number> {
    return rpc<number>('confirm_hrm_site_assignment_review', { p_rows: rows }, 'Không xác nhận được hiện trạng.');
  },
};
