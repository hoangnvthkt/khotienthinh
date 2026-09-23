import { formatDecimal6, parseQuantity6 } from '../procurement/decimal';
import type { ProjectV2PlanStatus, ProjectV2Quantity, ProjectV2ValidationIssue } from '../../types/projectV2';

const statusLabels: Record<ProjectV2PlanStatus, string> = {
  draft: 'Nháp', pending_approval: 'Chờ duyệt', returned: 'Cần chỉnh sửa',
  approved: 'Đã duyệt', superseded: 'Đã thay thế', cancelled: 'Đã hủy',
};

export function getProjectV2StatusLabel(status: ProjectV2PlanStatus): string {
  return statusLabels[status];
}

export function getProjectV2SourceLabel(source: 'material_plan' | 'project_material_request'): string {
  return source === 'material_plan' ? 'Kế hoạch vật tư' : 'Đề xuất vật tư';
}

export function formatProjectV2Quantity(quantity: ProjectV2Quantity, unit: string): string {
  if (quantity.state === 'unknown') return 'Chưa xác định';
  if (quantity.state === 'incomplete') return quantity.reason;
  const canonical = formatDecimal6(parseQuantity6(quantity.value));
  const [whole, fraction] = canonical.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${grouped}${fraction ? `,${fraction}` : ''} ${unit}`.trim();
}

const issueMessages: Record<string, string> = {
  missing_norm: 'Thiếu định mức vật tư. Chọn định mức hợp lệ trước khi gửi duyệt.',
  missing_conversion: 'Thiếu quy đổi đơn vị. Chọn hệ số quy đổi hợp lệ trước khi gửi duyệt.',
  missing_item: 'Thiếu vật tư. Chọn vật tư trước khi gửi duyệt.',
  missing_destination: 'Thiếu nơi nhận. Chọn nơi nhận trước khi gửi duyệt.',
  invalid_date: 'Ngày chưa hợp lệ. Kiểm tra lại kỳ kế hoạch hoặc ngày cần.',
  unknown_quantity: 'Khối lượng chưa xác định. Bổ sung dữ liệu nguồn trước khi gửi duyệt.',
  derived_quantity_mismatch: 'Khối lượng vật tư không khớp nguồn tính toán. Kiểm tra lại từng công việc và định mức.',
};

export function presentProjectV2Issue(issue: ProjectV2ValidationIssue): string {
  return issueMessages[issue.code] ?? 'Dữ liệu chưa đầy đủ. Kiểm tra lại dòng kế hoạch trước khi gửi duyệt.';
}
