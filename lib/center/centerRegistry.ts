// Danh mục của Trung tâm điều hành. Màu từng module nằm ở components/center/center.css
// (--c-<module>, --c-<module>-s), có bản sáng và tối — mockup v1.1 đã duyệt:
// Dự án chàm · Nhân sự tím · Công việc/Office teal · Mua hàng lục · Tài chính cyan · Kho cam.

export type CenterModuleKey = 'project' | 'hrm' | 'work' | 'office' | 'procurement' | 'finance' | 'warehouse';

export const CENTER_MODULE_KEYS: readonly CenterModuleKey[] = ['project', 'hrm', 'work', 'office', 'procurement', 'finance', 'warehouse'];

export type CenterWidgetId = 'project' | 'hrm' | 'work' | 'office' | 'supply' | 'finance';

export interface CenterWidgetGroup {
  id: CenterWidgetId;
  label: string;
  hint: string;
  module: CenterModuleKey;
  /** Màn module đầy đủ — luôn mở được khi người dùng có quyền, kể cả khi widget chưa có số. */
  route: string;
  routeLabel: string;
  /** Widget sẽ hiện gì — nói trước cho người dùng khi số liệu chưa nối. */
  preview: string;
}

// Nhóm widget của "Hôm nay" (kế hoạch đợt 0 mục 5). Số liệu và thao tác nhanh vào ở PR-C/PR-D.
export const CENTER_WIDGET_GROUPS: readonly CenterWidgetGroup[] = [
  { id: 'project', label: 'Dự án', hint: 'Hôm nay ở công trường', module: 'project', route: '/da', routeLabel: 'Mở Dự án',
    preview: 'Thi công hôm nay, vật tư đang về, tiến độ, việc chờ bạn.' },
  { id: 'hrm', label: 'Nhân sự', hint: 'Của tôi và đội công trường', module: 'hrm', route: '/my-profile', routeLabel: 'Mở Nhân sự',
    preview: 'Chấm công hôm nay, phép còn lại, công tháng, đội công trường.' },
  { id: 'work', label: 'Công việc', hint: 'Đề xuất, quy trình, đơn hàng, việc', module: 'work', route: '/rq', routeLabel: 'Mở Yêu cầu',
    preview: 'Việc đang làm, phiếu bạn đã gửi, yêu cầu đang xử lý.' },
  { id: 'office', label: 'Hành chính', hint: 'Văn bản, xe, thông tin', module: 'office', route: '/office', routeLabel: 'Mở Office',
    preview: 'Văn bản cần xác nhận, chuyến xe, thời tiết công trường.' },
  { id: 'supply', label: 'Mua hàng & Kho', hint: 'Cần mua, đơn hàng, tồn kho', module: 'procurement', route: '/procurement', routeLabel: 'Mở Mua hàng',
    preview: 'Cần mua theo dự án, đơn hàng đang treo, tồn kho công trường.' },
  { id: 'finance', label: 'Tài chính dự án', hint: 'Dự án được bật công tắc xem', module: 'finance', route: '/finance/project', routeLabel: 'Mở Tài chính dự án',
    preview: 'Hợp đồng chủ đầu tư, đã thu, quỹ công trường.' },
];
