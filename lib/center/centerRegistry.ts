// Danh mục của Trung tâm điều hành. Màu từng module nằm ở components/center/center.css
// (--c-<module>, --c-<module>-s), có bản sáng và tối — mockup v1.1 đã duyệt:
// Dự án chàm · Yêu cầu cyan · Quy trình xanh dương · Công việc/Office teal · Mua hàng lục · Vật tư cam · Nhân sự tím · Tài chính cyan đậm · Đặt xe sky.

export type CenterModuleKey =
  | 'project' | 'request' | 'workflow' | 'work' | 'procurement' | 'warehouse' | 'hrm' | 'finance' | 'office' | 'vehicle';

/** Thứ tự nhóm trong "Việc của tôi" (theo rail module của mockup). */
export const CENTER_MODULE_KEYS: readonly CenterModuleKey[] =
  ['project', 'request', 'workflow', 'work', 'procurement', 'warehouse', 'hrm', 'finance', 'office', 'vehicle'];

export const CENTER_MODULES: Record<CenterModuleKey, { label: string; route: string }> = {
  project: { label: 'Dự án', route: '/da' },
  request: { label: 'Yêu cầu', route: '/rq' },
  workflow: { label: 'Quy trình', route: '/wf' },
  work: { label: 'Vioo Work', route: '/work' },
  procurement: { label: 'Mua hàng', route: '/procurement' },
  warehouse: { label: 'Vật tư', route: '/operations' },
  hrm: { label: 'Nhân sự', route: '/my-profile' },
  finance: { label: 'Tài chính', route: '/finance' },
  office: { label: 'Office', route: '/office' },
  vehicle: { label: 'Đặt xe', route: '/booking/vehicle' },
};

/** View module đã tách được (props-driven) để nhúng vào tab của Center. Còn lại mở bằng deep link. */
/** route = màn thật của module chạy ngay trong tab (CenterRenderers › RouteRenderer). */
export type RendererId = 'request' | 'procurement' | 'finance' | 'site_assignment' | 'route';

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
  { id: 'hrm', label: 'Nhân sự', hint: 'Chấm công, nghỉ phép, bảng công', module: 'hrm', route: '/my-profile', routeLabel: 'Mở Nhân sự',
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
