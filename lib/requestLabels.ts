import type { RequestAssignmentStatus, RequestRuntimeStatus } from '../types';

export const REQUEST_STATUS_LABELS: Record<RequestRuntimeStatus, string> = {
  DRAFT: 'Nháp',
  PENDING: 'Chờ duyệt',
  RETURNED: 'Trả lại',
  APPROVED: 'Hoàn thành',
  REJECTED: 'Từ chối',
  CANCELLED: 'Đã hủy',
};

export const REQUEST_ASSIGNMENT_STATUS_LABELS: Record<RequestAssignmentStatus, string> = {
  PENDING: 'Đang chờ',
  APPROVED: 'Đã đồng ý',
  REJECTED: 'Đã từ chối',
  RETURNED: 'Đã trả lại',
  SKIPPED: 'Không cần duyệt',
  CANCELLED: 'Đã đóng',
};

const TIMELINE_EVENT_LABELS: Record<string, string> = {
  SUBMITTED: 'Gửi đề xuất',
  APPROVED: 'Đồng ý',
  REJECTED: 'Từ chối',
  REVISION_REQUESTED: 'Trả lại để bổ sung',
  REOPENED: 'Gửi lại',
  REASSIGNED: 'Chuyển người duyệt',
  CANCELLED: 'Hủy đề xuất',
};

// act_on_request logs CANCEL with the REJECTED action; a cancelled request can
// never have been rejected (both are terminal), so the creator/admin REJECTED
// entry on a cancelled request is the cancellation.
export const requestTimelineEventLabel = (eventType: string, requestStatus: RequestRuntimeStatus) => {
  if (eventType === 'REJECTED' && requestStatus === 'CANCELLED') return TIMELINE_EVENT_LABELS.CANCELLED;
  return TIMELINE_EVENT_LABELS[eventType] ?? 'Cập nhật đề xuất';
};

export const stripReassignPrefix = (comment: string | null) => comment?.replace(/^REASSIGNED:\s*/, '') ?? null;
