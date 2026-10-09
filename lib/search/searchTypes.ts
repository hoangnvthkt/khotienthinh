// Kiểu dữ liệu chung của Tìm kiếm toàn hệ thống.

import type { ComponentType } from 'react';

/** Loại hồ sơ máy chủ tìm được (khớp nhánh trong hàm search_global_v1). */
export const RECORD_KINDS = [
  'project', 'employee', 'item', 'wms_tx', 'material_request', 'purchase_order', 'rq', 'wf',
  'partner', 'customer_contract', 'subcontract', 'supplier_contract', 'asset', 'office_doc',
  'work_task', 'payment_request', 'vehicle_booking', 'leave', 'feedback', 'material_code',
] as const;

export type RecordKind = typeof RECORD_KINDS[number];
export type SearchKind = RecordKind | 'page' | 'action';

export type StatusTone = 'neutral' | 'pending' | 'active' | 'done' | 'warn';

/** Nhóm hiển thị (chip lọc + tiêu đề nhóm). */
export type SearchGroup =
  | 'action' | 'page' | 'project' | 'people' | 'material' | 'purchase' | 'request'
  | 'contract' | 'finance' | 'asset' | 'office' | 'work' | 'hr';

export interface SearchRelatedLink {
  label: string;
  route: string;
  state?: unknown;
}

/** Một dòng kết quả (trang, thao tác hoặc hồ sơ). */
export interface SearchEntry {
  key: string;
  kind: SearchKind;
  group: SearchGroup;
  title: string;
  /** Mã hiển thị (font-mono) — mã phiếu, mã nhân viên, SKU… */
  code?: string | null;
  subtitle?: string | null;
  /** Tên module hoặc loại hồ sơ, hiện mờ bên phải. */
  context?: string | null;
  status?: string | null;
  statusTone?: StatusTone;
  /** Từ khóa ẩn (đồng nghĩa, viết tắt) — chỉ dùng để khớp. */
  keywords?: string;
  /** Đích khi mở. Thao tác có thể dùng run() thay vì route. */
  route?: string;
  routeState?: unknown;
  /** Mở hộp thoại tại chỗ (không rời trang). */
  modal?: 'leave' | 'request';
  /** Lệnh chạy tại chỗ (đổi giao diện sáng/tối…). */
  command?: 'toggle-theme' | 'ask-ai';
  /** Thao tác cần chọn dự án trước. */
  needsProject?: { tab: string; extra?: Record<string, string> };
  /** Thông tin thêm cho ngăn xem trước. */
  facts?: Array<{ label: string; value: string; tone?: 'num' | 'ent' | 'warn' }>;
  related?: SearchRelatedLink[];
  /** Ngày cập nhật (ISO) — dùng xếp hạng nhẹ. */
  date?: string | null;
  /** Biểu tượng riêng (trang lấy từ thanh bên); không có thì theo loại. */
  icon?: ComponentType<{ size?: number; className?: string }>;
}

export interface ServerRecord {
  kind: RecordKind;
  id: string;
  code: string | null;
  title: string | null;
  subtitle: string | null;
  status: string | null;
  date: string | null;
  projectId: string | null;
  siteId: string | null;
  /** Hạng máy chủ: 100 = đúng mã, 80 = đầu mã, 60 = đầu tên… */
  rank: number;
  extra: Record<string, unknown>;
}

export interface ServerSearchResult {
  records: ServerRecord[];
  /** Nguồn lỗi máy chủ (không phải thiếu quyền). */
  failed: RecordKind[];
}
