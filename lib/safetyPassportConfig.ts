import { SafetyWorkerDocumentType } from '../types';

export const SAFETY_DOCUMENT_TYPES: Array<{ value: SafetyWorkerDocumentType; label: string; required: boolean }> = [
  { value: 'identity_front', label: 'CCCD mặt trước', required: true },
  { value: 'identity_back', label: 'CCCD mặt sau', required: true },
  { value: 'health_check', label: 'Giấy khám sức khỏe', required: true },
  { value: 'insurance', label: 'Bảo hiểm', required: true },
  { value: 'safety_card', label: 'Thẻ an toàn', required: false },
];

export const SAFETY_WORKER_LIST_GROUPS = [
  {
    title: 'Dự án / Vào ra',
    columns: ['Mã giới thiệu', 'Tên dự án', 'Mã thẻ vào ra', 'Ngày vào'],
  },
  {
    title: 'Nhà thầu / Tổ đội',
    columns: ['Mã', 'Tên', 'Loại', 'Loại công việc'],
  },
  {
    title: 'Thông tin nhân công',
    columns: ['Họ tên', 'Chức vụ', 'Ngày sinh', 'Số điện thoại', 'Số CCCD', 'Ngày cấp', 'Nơi cấp', 'Hộ khẩu thường trú'],
  },
  {
    title: 'Điều kiện vào công trường',
    columns: ['Thẻ an toàn', 'Giấy khám sức khỏe', 'Bảo hiểm', 'Đào tạo nội quy', 'Cam kết', 'PPE', 'Toolbox'],
  },
  {
    title: 'Trạng thái',
    columns: ['Đủ điều kiện', 'Thiếu hồ sơ', 'Hết hạn', 'Bị cấm'],
  },
] as const;

export const SAFETY_WORKER_DETAIL_SECTIONS = [
  {
    title: 'Thông tin công nhân',
    fields: ['Mã giới thiệu', 'Mã thẻ vào ra', 'Mã nhà thầu / tổ đội', 'Loại công việc', 'Chức danh', 'Ngày vào', 'Họ tên', 'Ngày sinh', 'Số điện thoại'],
  },
  {
    title: 'Giấy tờ cá nhân',
    fields: ['Số CMND/CCCD', 'Ngày cấp', 'Nơi cấp', 'Hộ khẩu thường trú', 'CCCD mặt trước', 'CCCD mặt sau', 'Ảnh thẻ'],
  },
  {
    title: 'Hồ sơ an toàn',
    fields: ['Thẻ an toàn', 'Số thẻ an toàn', 'Ngày hết hạn thẻ an toàn', 'Giấy khám sức khỏe', 'Bảo hiểm'],
  },
  {
    title: 'Kiểm soát vào công trường',
    fields: ['Đào tạo nội quy', 'Cam kết an toàn', 'PPE', 'Toolbox đầu vào', 'Công nhân bị cấm', 'Lý do cấm', 'Trạng thái đủ điều kiện'],
  },
] as const;

export const CANONICAL_SAFETY_DOCUMENT_TYPES = SAFETY_DOCUMENT_TYPES.map(item => item.value);

export const SAFETY_DOCUMENT_LABELS = SAFETY_DOCUMENT_TYPES.reduce<Record<string, string>>((acc, item) => {
  acc[item.value] = item.label;
  return acc;
}, {});
