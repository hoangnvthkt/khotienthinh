// Trang + thao tác nhanh cho Tìm kiếm toàn hệ thống. Trang lấy từ chính thanh bên (đúng quyền, tự cập nhật
// khi thêm màn); thao tác là danh sách việc hay làm, mỗi việc chỉ hiện khi người dùng mở được màn đích.

import { PROJECT_TAB_PERMISSIONS } from '../projectTabPermissions';
import type { SearchEntry } from './searchTypes';

/** Từ khóa ẩn cho từng màn (đồng nghĩa, cách gọi quen) — để gõ kiểu nào cũng ra. */
export const ROUTE_KEYWORDS: Record<string, string> = {
  '/': 'trang chu hom nay viec cua toi',
  '/center': 'trung tam dieu hanh command center viec cho toi',
  '/notifications': 'thong bao tin moi',
  '/my-profile': 'ho so ca nhan thong tin cua toi',
  '/my-payroll': 'phieu luong luong cua toi',
  '/chat': 'tin nhan chat nhan tin trao doi',
  '/feedback': 'gop y bao loi y kien',
  '/leaderboard': 'bang xep hang diem thuong',
  '/settings': 'cai dat he thong nguoi dung tai khoan phan quyen',
  '/inventory': 'ton kho vat tu so luong con bao nhieu stock',
  '/operations': 'phieu kho nhap xuat chuyen kho duyet phieu nhan hang',
  '/audit': 'kiem ke dem kho',
  '/material-code-requests': 'danh muc vat tu ma vat tu cap ma sku',
  '/reports': 'bao cao kho nhap xuat ton misa',
  '/wms/owners': 'phan quyen kho thu kho',
  '/procurement': 'mua hang don hang po can mua nha cung cap doi chieu hop dong khung',
  '/finance/overview': 'tong quan tai chinh dong tien',
  '/finance/forecast': 'du bao dong tien thu chi 1 3 6 thang',
  '/finance/reports': 'bao cao tai chinh lai lo',
  '/finance/todo': 'viec can lam tai chinh cho duyet chi',
  '/finance/receivables': 'phai thu cong no chu dau tu thu tien',
  '/finance/payables': 'phai tra cong no ncc nha cung cap thanh toan',
  '/finance/subcontracts': 'thau phu thanh toan thau phu',
  '/finance/cash': 'thu chi quy tien mat ngan hang so quy sao ke',
  '/finance/cost': 'chi phi ngan sach phan bo',
  '/finance/project': 'tai chinh du an loi nhuan',
  '/finance/requests': 'de nghi chi de nghi thanh toan tam ung',
  '/finance/settings': 'quan tri tai chinh cau hinh ma tran duyet',
  '/site-fund': 'quy cong truong tien mat cong truong',
  '/hrm/checkin': 'cham cong vao ca ra ca gps',
  '/hrm/attendance': 'cham cong bang cham cong di muon ve som cham bu',
  '/hrm/leave': 'nghi phep don nghi phep nam',
  '/hrm/timesheet': 'bang cong chot cong thang',
  '/hrm/assignments': 'dieu dong cong truong',
  '/hrm/payroll': 'bang luong tinh luong',
  '/hrm/employees': 'ho so nhan su danh sach nhan vien',
  '/hrm/contracts': 'hop dong lao dong hdld',
  '/hrm/documents': 'tai lieu nhan su',
  '/ep': 'danh ba tra cuu nhan vien so dien thoai email',
  '/wf': 'quy trinh phieu duyet trinh ky',
  '/wf/dashboard': 'tong quan quy trinh',
  '/wf/templates': 'mau quy trinh thiet ke quy trinh',
  '/rq': 'yeu cau de xuat phieu yeu cau xin duyet',
  '/rq/templates': 'mau yeu cau mau de xuat',
  '/da': 'du an cong trinh tong quan du an',
  '/da/portfolio': 'da du an danh muc portfolio',
  '/hd/overview': 'tong quan hop dong',
  '/hd/partners': 'doi tac ncc khach hang chu dau tu',
  '/hd/contract-types': 'loai hop dong mau hop dong',
  '/hd/customer': 'hop dong nhan thau chu dau tu',
  '/hd/supplier': 'hop dong nha cung cap ncc',
  '/hd/subcontractor': 'hop dong thau phu',
  '/ts/dashboard': 'tong quan tai san',
  '/ts/catalog': 'danh muc tai san thiet bi',
  '/ts/assignment': 'cap phat thu hoi tai san',
  '/ts/maintenance': 'bao tri sua chua thiet bi',
  '/ts/audit': 'kiem ke tai san',
  '/office': 'van ban cong van',
  '/office/documents': 'van ban den van ban di',
  '/office/templates': 'mau van ban',
  '/work': 'cong viec khong gian lam viec',
  '/work/my': 'viec cua toi cong viec duoc giao',
  '/booking/vehicle': 'dat xe xe cong ty',
  '/booking/vehicle/my': 'don dat xe cua toi',
  '/booking/vehicle/approvals': 'duyet dat xe',
  '/ai': 'tro ly ai chatbot hoi dap',
  '/knowledge-base': 'kho kien thuc tai lieu huong dan quy dinh',
  '/storage': 'kho du lieu file tai lieu luu tru',
  '/audit-trail': 'nhat ky thay doi lich su thao tac',
};

/** Màn không có trong thanh bên nhưng ai cũng cần tìm thấy. */
export const EXTRA_PAGES: Array<{ route: string; title: string; context: string }> = [
  { route: '/', title: 'Hôm nay', context: 'Trang chính' },
  { route: '/center', title: 'Trung tâm điều hành', context: 'Trang chính' },
  { route: '/notifications', title: 'Thông báo', context: 'Cá nhân' },
  { route: '/my-profile', title: 'Hồ sơ của tôi', context: 'Cá nhân' },
  { route: '/my-payroll', title: 'Phiếu lương của tôi', context: 'Cá nhân' },
  { route: '/chat', title: 'Tin nhắn', context: 'Trao đổi' },
  { route: '/feedback', title: 'Trung tâm góp ý', context: 'Góp ý' },
  { route: '/leaderboard', title: 'Bảng xếp hạng', context: 'Cá nhân' },
  { route: '/settings', title: 'Cài đặt', context: 'Hệ thống' },
  { route: '/audit-trail', title: 'Nhật ký thay đổi', context: 'Hệ thống' },
  { route: '/site-fund', title: 'Quỹ công trường', context: 'Tài chính' },
  { route: '/finance/requests', title: 'Đề nghị chi', context: 'Tài chính' },
];

/** Màn của dự án cần chọn dự án trước (tab trong /da). Tab "Phân quyền", "Tổ chức" để trong dự án. */
const PROJECT_TAB_PAGES = new Set(['executive', 'finance', 'contract', 'gantt', 'work_plan', 'weekly_progress', 'dailylog', 'material', 'quality', 'safety', 'subcontract', 'documents', 'report', 'payment']);

/** Nhãn chung chung trong thanh bên — ghép tên app để biết là màn nào. */
const GENERIC_LABELS = new Set(['Tổng quan', 'Báo cáo', 'Quản trị', 'Cấu hình', 'Việc cần làm', 'Phản ánh']);

export interface NavModuleInput { key: string; label: string; route: string }
export interface NavItemInput { to: string; label: string; icon?: SearchEntry['icon'] }

/** Trang theo quyền: mọi chức năng thanh bên cho người này + màn chung + tab dự án. */
export const buildPageEntries = (
  modules: readonly NavModuleInput[],
  itemsOf: (key: string) => readonly NavItemInput[],
  canOpen: (route: string) => boolean,
): SearchEntry[] => {
  const entries: SearchEntry[] = [];
  const seen = new Set<string>();
  const add = (entry: SearchEntry) => {
    const route = entry.route || '';
    const key = entry.needsProject ? `tab:${entry.needsProject.tab}` : route;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push(entry);
  };

  modules.forEach(module => {
    const items = itemsOf(module.key);
    items.forEach(item => add({
      key: `page:${item.to}`,
      kind: 'page',
      group: 'page',
      title: GENERIC_LABELS.has(item.label) ? `${item.label} · ${module.label}` : item.label,
      context: module.label,
      keywords: [module.label, ROUTE_KEYWORDS[item.to]].filter(Boolean).join(' '),
      route: item.to,
      icon: item.icon,
    }));
  });

  EXTRA_PAGES.forEach(page => {
    if (!canOpen(page.route)) return;
    add({ key: `page:${page.route}`, kind: 'page', group: 'page', title: page.title, context: page.context, keywords: ROUTE_KEYWORDS[page.route], route: page.route });
  });

  PROJECT_TAB_PERMISSIONS.forEach(tab => {
    if (!PROJECT_TAB_PAGES.has(tab.key) || !canOpen(tab.route)) return;
    add({
      key: `page:project-tab:${tab.key}`,
      kind: 'page',
      group: 'page',
      title: `${tab.label} dự án`,
      subtitle: 'Chọn dự án để mở',
      context: 'Dự án',
      keywords: 'du an cong trinh',
      needsProject: { tab: tab.key },
    });
  });

  return entries;
};

export interface QuickActionDef {
  id: string;
  title: string;
  subtitle: string;
  context: string;
  keywords: string;
  /** Màn phải mở được thì mới hiện thao tác. */
  gate: string;
  route?: string;
  routeState?: unknown;
  modal?: SearchEntry['modal'];
  command?: SearchEntry['command'];
  needsProject?: SearchEntry['needsProject'];
  /** Gợi ý khi chưa gõ gì (thứ tự ưu tiên trong ô trống). */
  featured?: number;
}

const mondayOf = (now: Date): string => {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export const quickActionDefs = (now: Date): QuickActionDef[] => [
  { id: 'checkin', title: 'Chấm công', subtitle: 'Vào ca / ra ca theo vị trí', context: 'Nhân sự', keywords: 'cham cong check in vao ca ra ca diem danh gps', gate: '/hrm/checkin', route: '/hrm/checkin', featured: 1 },
  { id: 'leave', title: 'Xin nghỉ phép', subtitle: 'Gửi đơn nghỉ ngay tại đây', context: 'Nhân sự', keywords: 'xin nghi phep don nghi nghi om viec rieng', gate: '/hrm/leave', modal: 'leave', featured: 2 },
  { id: 'request', title: 'Tạo đề xuất', subtitle: 'Đề xuất, xin duyệt theo mẫu — ngay tại đây', context: 'Yêu cầu', keywords: 'tao de xuat yeu cau moi xin duyet to trinh', gate: '/rq', modal: 'request', featured: 3 },
  { id: 'material-request', title: 'Lập đề xuất vật tư', subtitle: 'Chọn dự án rồi lập đề xuất', context: 'Dự án', keywords: 'de xuat vat tu yeu cau vat tu dxvt cong truong', gate: '/da', needsProject: { tab: 'material', extra: { materialTab: 'request' } }, featured: 4 },
  { id: 'daily-log', title: 'Ghi nhật ký công trường', subtitle: 'Chọn dự án rồi ghi nhật ký', context: 'Dự án', keywords: 'nhat ky cong truong bao cao ngay', gate: '/da', needsProject: { tab: 'dailylog' }, featured: 5 },
  { id: 'po', title: 'Lập đơn hàng', subtitle: 'Mua hàng — lập PO cho nhà cung cấp', context: 'Mua hàng', keywords: 'lap don hang po tao po mua hang dat hang', gate: '/procurement', route: '/procurement?mode=orders', featured: 6 },
  { id: 'payment', title: 'Lập đề nghị chi', subtitle: 'Đề nghị thanh toán / tạm ứng', context: 'Tài chính', keywords: 'de nghi chi dntt thanh toan ncc tam ung', gate: '/finance/requests', route: '/finance/requests', featured: 7 },
  { id: 'booking', title: 'Đặt xe', subtitle: 'Đặt xe công ty đi công tác', context: 'Hành chính', keywords: 'dat xe xe cong ty di cong tac', gate: '/booking/vehicle', route: '/booking/vehicle', featured: 8 },
  { id: 'makeup', title: 'Chấm công bù', subtitle: 'Đề nghị bù công khi quên chấm', context: 'Nhân sự', keywords: 'cham cong bu quen cham de nghi bu cong', gate: '/hrm/attendance', route: '/hrm/attendance?tab=proposals' },
  { id: 'timesheet', title: 'Bảng công của tôi', subtitle: 'Công tháng này', context: 'Nhân sự', keywords: 'bang cong tong hop cong thang nay', gate: '/hrm/timesheet', route: `/hrm/timesheet?year=${now.getFullYear()}&month=${now.getMonth() + 1}` },
  { id: 'payslip', title: 'Phiếu lương của tôi', subtitle: 'Xem lương các tháng', context: 'Nhân sự', keywords: 'phieu luong luong thang cua toi', gate: '/my-payroll', route: '/my-payroll' },
  { id: 'workflow', title: 'Tạo phiếu quy trình', subtitle: 'Trình ký theo quy trình', context: 'Quy trình', keywords: 'tao phieu quy trinh workflow moi trinh ky', gate: '/wf', route: '/wf' },
  { id: 'task', title: 'Tạo công việc', subtitle: 'Giao việc trong Vioo Work', context: 'Công việc', keywords: 'tao cong viec giao viec task moi', gate: '/work/my', route: '/work/my?create=1' },
  { id: 'compose', title: 'Soạn văn bản', subtitle: 'Văn bản, công văn mới', context: 'Văn bản', keywords: 'soan van ban cong van to trinh quyet dinh', gate: '/office/new', route: '/office/new' },
  { id: 'hot', title: 'Mua nóng / CCDC', subtitle: 'Mua gấp ở công trường', context: 'Mua hàng', keywords: 'mua nong mua gap ccdc cong cu dung cu', gate: '/procurement', route: '/procurement?mode=hot' },
  { id: 'import', title: 'Lập phiếu nhập kho', subtitle: 'Nhận hàng vào kho', context: 'Vật tư', keywords: 'nhap kho phieu nhap pnk nhan hang', gate: '/operations', route: '/operations', routeState: { tab: 'IMPORT' } },
  { id: 'export', title: 'Lập phiếu xuất kho', subtitle: 'Cấp phát vật tư cho công trường', context: 'Vật tư', keywords: 'xuat kho phieu xuat pxk cap phat', gate: '/operations', route: '/operations', routeState: { tab: 'EXPORT' } },
  { id: 'transfer', title: 'Chuyển kho', subtitle: 'Điều chuyển vật tư giữa các kho', context: 'Vật tư', keywords: 'chuyen kho dieu chuyen vat tu', gate: '/operations', route: '/operations', routeState: { tab: 'TRANSFER' } },
  { id: 'count', title: 'Kiểm kê kho', subtitle: 'Đếm và đối chiếu tồn', context: 'Vật tư', keywords: 'kiem ke kho dem hang doi chieu ton', gate: '/audit', route: '/audit' },
  { id: 'new-code', title: 'Đề xuất mã vật tư mới', subtitle: 'Cấp mã cho vật tư chưa có', context: 'Vật tư', keywords: 'cap ma vat tu moi tao ma de xuat ma', gate: '/material-code-requests', route: '/material-code-requests' },
  { id: 'work-plan', title: 'Kế hoạch tuần', subtitle: 'Chọn dự án rồi lập kế hoạch tuần này', context: 'Dự án', keywords: 'ke hoach tuan lich thi cong', gate: '/da', needsProject: { tab: 'work_plan', extra: { period: 'week', start: mondayOf(now) } } },
  { id: 'site-fund', title: 'Chi quỹ công trường', subtitle: 'Ghi chi tiền mặt ở công trường', context: 'Tài chính', keywords: 'quy cong truong chi tien mat', gate: '/site-fund', route: '/site-fund' },
  { id: 'feedback', title: 'Gửi góp ý / báo lỗi', subtitle: 'Gửi cho đội phát triển', context: 'Góp ý', keywords: 'gop y bao loi feedback y kien', gate: '/feedback', route: '/feedback' },
  { id: 'theme', title: 'Đổi nền sáng / tối', subtitle: 'Giao diện dễ nhìn hơn', context: 'Giao diện', keywords: 'giao dien toi sang dark mode light mode nen', gate: '/', command: 'toggle-theme' },
];

export const buildActionEntries = (defs: readonly QuickActionDef[], canOpen: (route: string) => boolean): SearchEntry[] =>
  defs.filter(def => canOpen(def.gate)).map(def => ({
    key: `action:${def.id}`,
    kind: 'action',
    group: 'action',
    title: def.title,
    subtitle: def.subtitle,
    context: def.context,
    keywords: def.keywords,
    route: def.route,
    routeState: def.routeState,
    modal: def.modal,
    command: def.command,
    needsProject: def.needsProject,
  }));

/** Ô trống: các thao tác gợi ý, ưu tiên thao tác người này hay dùng. */
export const featuredActions = (
  actions: readonly SearchEntry[],
  defs: readonly QuickActionDef[],
  usage: (key: string) => number,
  limit = 8,
): SearchEntry[] => {
  const featuredRank = new Map(defs.filter(def => def.featured).map(def => [`action:${def.id}`, def.featured as number]));
  return [...actions]
    .filter(action => featuredRank.has(action.key) || usage(action.key) > 0)
    .sort((a, b) => (usage(b.key) - usage(a.key)) || ((featuredRank.get(a.key) ?? 99) - (featuredRank.get(b.key) ?? 99)))
    .slice(0, limit);
};
