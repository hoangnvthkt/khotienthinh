import type { ErpStatusTone } from '../components/erp/status';
import {
  SafetyContractorStatus,
  SafetyEquipmentStatus,
  SafetyInspectionResult,
  SafetyInspectionStatus,
  SafetyIssueStatus,
  SafetyIssueType,
  SafetySeverity,
} from '../types';

export const SAFETY_SEVERITY_LABELS: Record<SafetySeverity, string> = {
  low: 'Thấp',
  medium: 'Trung bình',
  high: 'Cao',
  critical: 'Nghiêm trọng',
};

export const SAFETY_ISSUE_TYPE_LABELS: Record<SafetyIssueType, string> = {
  hazard: 'Nguy cơ',
  violation: 'Vi phạm',
  near_miss: 'Near-miss',
  minor_incident: 'Sự cố nhẹ',
  serious_incident: 'Sự cố nghiêm trọng',
  corrective_action: 'Khắc phục',
};

export const SAFETY_ISSUE_STATUS_LABELS: Record<SafetyIssueStatus, string> = {
  new: 'Mới ghi nhận',
  assigned: 'Đã giao xử lý',
  in_progress: 'Đang xử lý',
  waiting_verification: 'Chờ xác nhận',
  resolved: 'Đã khắc phục',
  closed: 'Đã đóng',
  rejected: 'Từ chối',
  overdue: 'Quá hạn',
};

export const SAFETY_INSPECTION_STATUS_LABELS: Record<SafetyInspectionStatus, string> = {
  draft: 'Nháp',
  in_progress: 'Đang kiểm tra',
  completed: 'Hoàn thành',
  cancelled: 'Đã huỷ',
};

export const SAFETY_EQUIPMENT_STATUS_LABELS: Record<SafetyEquipmentStatus, string> = {
  pending_review: 'Chờ kiểm tra',
  approved: 'Đã duyệt',
  active: 'Đang sử dụng',
  expired: 'Hết hạn',
  suspended: 'Tạm dừng',
  removed: 'Đã rời công trường',
};

export const SAFETY_CONTRACTOR_STATUS_LABELS: Record<SafetyContractorStatus, string> = {
  pending_documents: 'Thiếu hồ sơ',
  approved: 'Đã duyệt',
  active: 'Đang thi công',
  suspended: 'Tạm dừng',
  completed: 'Hoàn thành',
};

export const getSafetySeverityTone = (severity?: SafetySeverity | string | null): ErpStatusTone => {
  if (severity === 'critical') return 'danger';
  if (severity === 'high') return 'attention';
  if (severity === 'medium') return 'warning';
  return 'neutral';
};

export const getSafetyIssueStatusTone = (status?: SafetyIssueStatus | string | null): ErpStatusTone => {
  if (status === 'closed' || status === 'resolved') return 'success';
  if (status === 'assigned' || status === 'in_progress' || status === 'waiting_verification') return 'info';
  if (status === 'overdue') return 'attention';
  if (status === 'rejected') return 'danger';
  return 'warning';
};

export const getSafetyInspectionStatusTone = (status?: SafetyInspectionStatus | string | null): ErpStatusTone => {
  if (status === 'completed') return 'success';
  if (status === 'in_progress') return 'info';
  if (status === 'cancelled') return 'neutral';
  return 'warning';
};

export const getSafetyResultTone = (result?: SafetyInspectionResult | string | null): ErpStatusTone => {
  if (result === 'pass') return 'success';
  if (result === 'fail') return 'danger';
  return 'neutral';
};

export const getSafetyNextAction = (status: SafetyIssueStatus, assignedName?: string | null) => {
  if (status === 'new') return 'Phân công người xử lý và đặt hạn khắc phục.';
  if (status === 'assigned') return `${assignedName || 'Người phụ trách'} cần bắt đầu xử lý nguy cơ/sự cố.`;
  if (status === 'in_progress') return 'Cập nhật ảnh sau, ghi chú khắc phục và chuyển chờ xác nhận.';
  if (status === 'waiting_verification') return 'Cán bộ an toàn xác nhận kết quả khắc phục.';
  if (status === 'resolved') return 'Có thể đóng hồ sơ nếu kết quả đã đạt yêu cầu.';
  if (status === 'overdue') return 'Cần xử lý ngay hoặc gia hạn có lý do.';
  if (status === 'rejected') return 'Xem lý do từ chối và cập nhật lại biện pháp.';
  return 'Hồ sơ đã đóng.';
};

export const getSafetyEquipmentTone = (status?: SafetyEquipmentStatus | string | null): ErpStatusTone => {
  if (status === 'active' || status === 'approved') return 'success';
  if (status === 'expired' || status === 'suspended') return 'danger';
  if (status === 'pending_review') return 'warning';
  return 'neutral';
};

export const getSafetyContractorTone = (status?: SafetyContractorStatus | string | null): ErpStatusTone => {
  if (status === 'active' || status === 'approved' || status === 'completed') return 'success';
  if (status === 'suspended') return 'danger';
  if (status === 'pending_documents') return 'warning';
  return 'neutral';
};
