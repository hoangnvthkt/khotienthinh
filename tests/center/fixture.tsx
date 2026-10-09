// Dữ liệu minh họa, chỉ dùng cho kiểm thử giao diện. Không gọi Supabase.
// ?theme=dark để xem nền tối; ?inbox=empty|error|many để xem trạng thái rỗng / lỗi / 200 việc của Việc của tôi;
// ?today=loner|error để xem Hôm nay khi không thuộc dự án nào / lỗi; ?layout=locked khi chưa có quyền tùy chỉnh.
// Bố cục "lưu máy chủ" giả lập bằng sessionStorage để tải lại trang vẫn còn.
// Cột 64px bên trái chỉ giả lập thanh bên (Sidebar) có sẵn của app.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BarChart3, Bell, Briefcase, FileText, GitBranch, LayoutDashboard, Package, ShoppingCart } from 'lucide-react';
import CenterShell from '../../components/center/CenterShell';
import { CenterRailView } from '../../components/center/CenterRail';
import { SIDEBAR_MODULES, type ModuleNavItem } from '../../components/Sidebar';
import { MemoryRouter } from 'react-router-dom';
import CenterEntrance from '../../components/center/CenterIntro';
import UiModeSwitch from '../../components/center/UiModeSwitch';
import type { InboxTab, WorkItem, WorkItemsPage } from '../../lib/center/workItemsService';
import type { CenterToday } from '../../lib/center/centerTodayService';
import type { CenterActionFlags, CenterModal } from '../../lib/center/centerActions';
import { parseCenterLayout, type CenterLayout, type CenterLayoutRecord } from '../../lib/center/centerLayout';
import { buildDashboardFixture } from './dashboardFixture';
import '../../index.css';

const params = new URLSearchParams(location.search);
const PERSON = { fullName: 'Phạm Ngọc Sơn', gender: 'Nam', title: 'Chỉ huy trưởng · SMB-2026' };
const DENIED_ROUTES = new Set(['/procurement']);
const NOW = new Date(2026, 9, 7, 8, 30);
// Bảng điều khiển: ?dash=bgd | ketoan | cht | muahang | none | error | slow | flaky · ?dash=off: không có tab.
// flaky: lần đầu được, bấm Cập nhật thì lỗi (giữ số cũ). Số lần gọi ghi ở window.__dashLoads để kiểm "không realtime".
const DASH = params.get('dash') || 'bgd';
let dashLoads = 0;
const loadDashboard = DASH === 'off' ? undefined : (options?: { force?: boolean }) => new Promise<ReturnType<typeof buildDashboardFixture>>((resolve, reject) => {
  dashLoads += 1;
  (window as unknown as { __dashLoads: number }).__dashLoads = dashLoads;
  setTimeout(() => {
    if (DASH === 'error' || (DASH === 'flaky' && options?.force)) reject(new Error('Máy chủ bận, thử lại sau ít phút.'));
    else resolve({ ...buildDashboardFixture(DASH === 'flaky' ? 'bgd' : DASH), generatedAt: options?.force ? '2026-10-07T09:40:00+07:00' : '2026-10-07T08:25:00+07:00' });
  }, DASH === 'slow' ? 1500 : 120);
});
const loadDashboardAccess = () => Promise.resolve(DASH === 'error' || DASH === 'flaky' || DASH === 'slow' ? buildDashboardFixture('bgd').access : buildDashboardFixture(DASH).access);
const at = (days: number, hour = 17) => new Date(2026, 9, 7 + days, hour, 0).toISOString();

const item = (partial: Partial<WorkItem> & Pick<WorkItem, 'source' | 'module' | 'kind' | 'id' | 'code' | 'title'>): WorkItem => ({
  who: null, whoId: null, meta: null, dueAt: null, status: null, ref: {}, ...partial,
});

// Số thật 06/10 trong mockup v1.1 + phiếu minh họa.
const ITEMS: Record<InboxTab, WorkItem[]> = {
  mine: [
    item({ source: 'mr', module: 'project', kind: 'approve', id: 'mr-2688', code: 'MR-2026-2688', title: 'Thép D16 + D10 móng nhà xưởng 3', who: 'Nguyễn Chấp Việt lập', meta: '4 dòng · cần 09/10 · SMB-2026', dueAt: at(0, 13), ref: { requestId: 'mr-2688', projectId: 'smb', requestOrigin: 'project' } }),
    item({ source: 'daily_log', module: 'project', kind: 'approve', id: 'dl-0510', code: 'NK 05/10', title: 'Nhật ký 05/10 · Sơn Miền Bắc', who: 'Lê Văn Tùng gửi', meta: '41 công · 5 phiếu kỹ sư', dueAt: at(0), ref: { dailyLogId: 'dl-0510', projectId: 'smb' } }),
    item({ source: 'work_plan', module: 'project', kind: 'approve', id: 'wp-41', code: 'KH-2026-41', title: 'Kế hoạch tuần 06/10–12/10', who: 'Lê Văn Tùng gửi', meta: 'SMB-2026', dueAt: at(0), ref: { planId: 'wp-41', projectId: 'smb', periodType: 'week', periodStart: '2026-10-06' } }),
    item({ source: 'rq', module: 'request', kind: 'approve', id: 'rq-61', code: 'RQ-2026-000061', title: 'Bổ sung 2 kỹ sư hoàn thiện từ 13/10', who: 'Nguyễn Thị Mơ lập', meta: 'Nhu cầu nhân sự', dueAt: at(2), ref: { requestId: 'rq-61' } }),
    item({ source: 'leave', module: 'hrm', kind: 'approve', id: 'np-41', code: 'NP-2026-041', title: 'Trần Văn Hải nghỉ phép năm 2 ngày 08/10–09/10', who: 'Trần Văn Hải gửi', meta: 'Việc gia đình', dueAt: at(1), ref: { requestId: 'np-41' } }),
    item({ source: 'makeup', module: 'hrm', kind: 'approve', id: 'cc-03', code: 'Bù công 03/10', title: 'Phạm Văn Đức đề nghị chấm công bù 03/10', who: 'Phạm Văn Đức gửi', meta: 'Quên chấm ra · 17:30', dueAt: at(3), ref: { proposalId: 'cc-03' } }),
    item({ source: 'safety', module: 'project', kind: 'confirm', id: 'sc-7', code: 'SAFE-0007', title: 'Lan can mép sàn tầng 2 xưởng 2', who: 'Trần Văn Bình báo đã khắc phục', meta: 'An toàn · mức cao · SMB-2026', dueAt: at(1), ref: { safetyId: 'sc-7', projectId: 'smb' } }),
    item({ source: 'wf', module: 'workflow', kind: 'approve', id: '0f8b3a52-1c1e-4b7a-9a77-2c4f0d7e9b10', code: 'WF-2026-031', title: 'Xin xe chở vật tư đi Bắc Ninh 09/10', who: 'Nguyễn Thị Mơ lập', meta: 'Xin xe công trường · Trưởng phòng duyệt', dueAt: at(1, 9), ref: { instanceId: '0f8b3a52-1c1e-4b7a-9a77-2c4f0d7e9b10' } }),
    item({ source: 'work', module: 'work', kind: 'do', id: 'wk-1203', code: 'VW-2026-001203', title: 'Gửi biên bản nghiệm thu móng A3 cho CĐT', who: 'Nguyễn Thị Mơ giao', meta: 'Đang làm · quan trọng', dueAt: at(0, 18), ref: { taskCode: 'VW-2026-001203' } }),
    item({ source: 'po', module: 'procurement', kind: 'approve', id: 'po-116', code: 'PO-116', title: 'Kết cấu thép 568 · 1,3 tỷ', who: 'Nguyễn Thị Mơ lập', meta: '8 dòng · SMB-2026', dueAt: at(-2), ref: { poId: 'po-116' } }),
    item({ source: 'office', module: 'office', kind: 'read', id: 'tb-12', code: 'TB-12/2026', title: 'Quy định an toàn thi công mùa mưa', who: 'Ban TGĐ phát hành', meta: 'Yêu cầu xác nhận đã đọc', dueAt: at(1), ref: { documentId: 'tb-12' } }),
  ],
  sent: [
    item({ source: 'fin_site_expense', module: 'finance', kind: 'wait', id: 'qct-10', code: 'QCT-SMB-10', title: 'Đề nghị cấp vốn quỹ công trường · 150 tr', who: 'Chờ kế toán duyệt', meta: 'SMB-2026 · Quỹ công trường SMB', dueAt: at(4) }),
    item({ source: 'wf', module: 'workflow', kind: 'wait', id: '5c2d1e0a-7b9f-4c3e-8a21-6d4b3f2e1a09', code: 'WF-2026-029', title: 'Xuất vật tư ra ngoài nhà máy SMB', who: 'Đang ở bước Bảo vệ xác nhận', meta: 'QT Xuất vật tư, hàng hóa ra ngoài nhà máy', ref: { instanceId: '5c2d1e0a-7b9f-4c3e-8a21-6d4b3f2e1a09' } }),
    item({ source: 'rq', module: 'request', kind: 'wait', id: 'rq-62', code: 'RQ-2026-000062', title: 'Xin cấp máy cắt sắt cho mũi 2', who: 'Nguyễn Thị Mơ lập', meta: 'Mua sắm thiết bị', ref: { requestId: 'rq-62' } }),
    item({ source: 'hot', module: 'procurement', kind: 'wait', id: 'mn-3', code: 'MN-2026-003', title: 'Thuê máy cắt sắt · 850.000 đ', who: 'Chờ duyệt', meta: 'SMB-2026 · đã mua', ref: { hotPurchaseId: 'mn-3' } }),
  ],
  watch: [
    item({ source: 'site_assignment', module: 'hrm', kind: 'watch', id: 'sa-7', code: 'SA-2026-007', title: 'Nguyễn Văn Nam đến Sơn Miền Bắc từ 08/10', who: 'HR lập', meta: 'Bổ sung kỹ sư hoàn thiện', dueAt: at(1), ref: { assignmentId: 'sa-7' } }),
    item({ source: 'office', module: 'office', kind: 'watch', id: 'cv-88', code: 'CV-88/2026', title: 'Công văn CĐT về tiến độ hạng mục móng', who: 'Văn thư phát hành', meta: 'Đang theo dõi', ref: { documentId: 'cv-88' } }),
  ],
};

// Số lần tải từng tab — kiểm thử "Tôi gửi / Theo dõi chỉ tải khi bấm".
const loads: Record<InboxTab, number> = { mine: 0, sent: 0, watch: 0 };
(window as unknown as { __vccLoads: typeof loads }).__vccLoads = loads;
const loadWorkItems = (tab: InboxTab): Promise<WorkItemsPage> => new Promise((resolve, reject) => setTimeout(() => {
  loads[tab] += 1;
  const mode = params.get('inbox');
  if (mode === 'error') return reject(new Error('fixture error'));
  const many = (): WorkItem[] => Array.from({ length: 200 }, (_, index) => {
    const base = ITEMS.mine[index % ITEMS.mine.length];
    return { ...base, id: `${base.id}-${index}`, code: `${base.code}-${index}`, dueAt: at((index % 9) - 2) };
  });
  const items = mode === 'empty' ? [] : mode === 'many' && tab === 'mine' ? many() : ITEMS[tab];
  resolve({ tab, generatedAt: NOW.toISOString(), total: items.length, truncatedSources: [], items });
}, 60));

// Hôm nay: số thật SMB-2026 trong mockup v1.1; DA29 để thử đổi dự án.
const TODAY: Record<string, CenterToday> = {
  smb: {
    generatedAt: NOW.toISOString(), today: '2026-10-07',
    project: { id: 'smb', code: 'SMB-2026', name: 'Nhà máy Sơn Miền Bắc', status: 'active', endDate: '2026-10-21', source: 'assignment',
      site: { id: 'site-smb', name: 'Sơn Miền Bắc', latitude: 20.93, longitude: 106.05 } },
    projectOptions: [{ id: 'smb', code: 'SMB-2026', name: 'Nhà máy Sơn Miền Bắc', waiting: 3 }, { id: 'da29', code: 'DA29', name: 'Dự án 29', waiting: 0 }],
    widgets: {
      project: {
        construction: { state: 'ready', slips: 3, fronts: 5, people: 39, summaryStatus: 'submitted' },
        supply: { state: 'ready', count: 6, amount: 5_360_000_000, nextPo: { poId: 'po-116', poNumber: 'PO-116', expectedDate: '2026-10-09' } },
        progress: { state: 'ready', mode: 'gantt_weighted', percent: 81, total: 332, done: 170, inProgress: 13, overdue: 7, notStarted: 142, endDate: '2026-10-21' },
        waiting: 3,
      },
      hrm: { state: 'ready', attendance: { checkIn: '07:52', checkOut: null, locationName: 'Công trường Sơn Miền Bắc', status: 'present' },
        leave: { availableDays: 6, pendingDays: 0, year: 2026 }, timesheet: { workDays: 4, month: 10, year: 2026, periodStatus: null },
        team: { state: 'ready', total: 28, present: 21, assignments: 6 } },
      work: { workEnabled: true, assigned: { active: 3, overdue: 1, nearest: { code: 'VW-2026-001203', taskCode: 'VW-2026-001203', dueAt: at(0, 18) } },
        created: { open: 3, awaitingReview: 0 },
        requests: { pending: 1, returned: 0, latest: { id: 'rq-61', code: 'RQ-2026-000061', title: 'Bổ sung 2 kỹ sư', status: 'PENDING', waitingOn: 'Nguyễn Thị Mơ' } } },
      office: { documents: { state: 'ready', count: 1, first: { id: 'tb-12', documentNumber: 'TB-12/2026', title: 'Quy định an toàn thi công mùa mưa' } },
        nextTrip: { id: 'b1', code: 'XE-2026-012', status: 'ASSIGNED', pickupAt: at(1, 7), destination: 'Văn phòng Hưng Yên', vehicle: '29A-123.45' } },
      supply: { requests: { state: 'ready', pending: 4, supplying: 29, waitingStep: 'Phòng vật tư duyệt' }, orders: { state: 'denied' },
        warehouse: { id: 'wh-smb', name: 'Kho SMB', canView: false } },
      finance: { projectId: 'smb', contractGross: 105_840_000_000, received: 0, receivable: 0, receivableOverdue: 0, openingTodo: true,
        cost: 12_300_000_000, committed: null, eac: 85_700_000_000, payable: 1_100_000_000, payableOverdue: 0, fundBalance: null, progress: 81 },
    },
  },
  da29: {
    generatedAt: NOW.toISOString(), today: '2026-10-07',
    project: { id: 'da29', code: 'DA29', name: 'Dự án 29', status: 'active', endDate: null, source: 'selected', site: null },
    projectOptions: [{ id: 'smb', code: 'SMB-2026', name: 'Nhà máy Sơn Miền Bắc', waiting: 3 }, { id: 'da29', code: 'DA29', name: 'Dự án 29', waiting: 0 }],
    widgets: {
      project: { construction: { state: 'denied' }, supply: { state: 'ready', count: 0, amount: 0, nextPo: null }, progress: { state: 'empty' }, waiting: 0 },
      hrm: { state: 'ready', attendance: null, leave: null, timesheet: { workDays: 4, month: 10, year: 2026, periodStatus: 'reviewing' }, team: { state: 'empty' } },
      work: { workEnabled: false, assigned: null, created: null, requests: { pending: 0, returned: 0, latest: null } },
      office: { documents: { state: 'ready', count: 0, first: null }, nextTrip: null },
      supply: { requests: { state: 'ready', pending: 0, supplying: 0, waitingStep: null }, orders: { state: 'ready', open: 0, openAmount: 0, awaitingApproval: 0 }, warehouse: null },
      finance: null,
    },
  },
};
const LONER: CenterToday = {
  generatedAt: NOW.toISOString(), today: '2026-10-07', project: null, projectOptions: [],
  widgets: { project: null, hrm: { state: 'empty' }, work: { workEnabled: false, assigned: null, created: null, requests: { pending: 0, returned: 0, latest: null } },
    office: { documents: { state: 'denied' }, nextTrip: null }, supply: null, finance: null },
};
const loadToday = (projectId: string | null): Promise<CenterToday> => new Promise((resolve, reject) => setTimeout(() => {
  const mode = params.get('today');
  if (mode === 'error') return reject(new Error('fixture error'));
  if (mode === 'loner') return resolve(LONER);
  resolve(TODAY[projectId || ''] || TODAY.smb);
}, 60));

// Cờ thao tác theo dự án: SMB nhiều quyền, DA29 gần như không.
const ACTIONS: Record<string, CenterActionFlags> = {
  smb: { projectId: 'smb', employee: true,
    project: { materialRequest: true, dailyLog: true, dailyReport: true, workPlan: false },
    hrm: { checkin: true, leave: true, makeup: true, timesheet: true, assignment: false },
    work: { request: true, workflow: false, po: true, task: true },
    office: { compose: true, incoming: true, booking: true, directory: true },
    supply: { hot: true, inbox: false, receive: false, count: false, warehouseId: 'wh-smb' },
    finance: { siteFund: true, projectFinance: true, paymentRequest: false } },
  da29: { projectId: 'da29', employee: true,
    project: { materialRequest: false, dailyLog: false, dailyReport: false, workPlan: false },
    hrm: { checkin: true, leave: true, makeup: true, timesheet: true, assignment: false },
    work: { request: true, workflow: false, po: false, task: false },
    office: { compose: true, incoming: true, booking: true, directory: true },
    supply: { hot: false, inbox: false, receive: false, count: false, warehouseId: null },
    finance: null },
};
const loadActions = (projectId: string | null): Promise<CenterActionFlags> => new Promise(resolve => setTimeout(() => {
  if (params.get('today') === 'loner') return resolve({ projectId: null, employee: false, project: null, hrm: { checkin: false, leave: false, makeup: false, timesheet: false, assignment: false },
    work: { request: false, workflow: false, po: false, task: false }, office: { compose: false, incoming: false, booking: true, directory: false }, supply: null, finance: null });
  resolve(ACTIONS[projectId || ''] || ACTIONS.smb);
}, 40));

const LAYOUT_KEY = 'fixture_center_layout';
let layoutVersion = 0;
const loadLayout = (): Promise<CenterLayoutRecord> => new Promise(resolve => setTimeout(() => {
  let layout: CenterLayout | null = null;
  try { layout = parseCenterLayout(JSON.parse(sessionStorage.getItem(LAYOUT_KEY) || 'null')); } catch { layout = null; }
  resolve({ layout, version: layoutVersion, canManage: params.get('layout') !== 'locked' });
}, 30));
const saveLayout = (layout: CenterLayout): Promise<number> => new Promise(resolve => setTimeout(() => {
  sessionStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  layoutVersion += 1;
  resolve(layoutVersion);
}, 30));

const StubModalHost: React.FC<{ modal: CenterModal; onClose: () => void; onDone: () => void }> = ({ modal, onClose, onDone }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-label={`Form ${modal}`}>
    <div className="vcc-card w-full max-w-sm p-4" data-testid="stub-modal">
      <p className="m-0 font-semibold">Form thật: <b>{modal}</b> (fixture)</p>
      <div className="mt-3 flex gap-2">
        <button type="button" className="vcc-btn" onClick={onClose}>Đóng</button>
        <button type="button" className="vcc-btn" data-pri="true" onClick={() => { onDone(); onClose(); }}>Gửi</button>
      </div>
    </div>
  </div>
);

// Bản thử không có Supabase: chỗ màn xử lý thật của module sẽ hiện (cùng đường dẫn / id như bản thật).
const StubRenderer: React.FC<{ renderer: string; props: Record<string, string> }> = ({ renderer, props }) => (
  <div className="vcc-card p-4" data-testid="stub-renderer">
    <div>View nhúng: <b>{renderer}</b> · {JSON.stringify(props)}</div>
    <div className="mt-1 text-xs vcc-muted">Bản thử dùng dữ liệu minh họa — trên app thật, màn xử lý của module (duyệt / từ chối / sửa) hiện ngay tại đây.</div>
    <label className="mt-3 block text-xs vcc-muted">Ghi chú nháp (thử giữ form khi đổi tab)
      <textarea className="mt-1 block w-full rounded border p-2 text-sm" aria-label="Ghi chú nháp" rows={2} />
    </label>
    <div style={{ height: 1600 }} aria-hidden="true" />
  </div>
);

// Rail thật của giao diện Trung tâm điều hành (CenterRailView), app mẫu theo thứ tự mockup.
const RAIL_KEYS = ['DA', 'RQ', 'WF', 'work.module', 'PROCUREMENT', 'WMS', 'HRM', 'FINANCE', 'office.module', 'VEHICLE_BOOKING'];
const RAIL_MODULES = RAIL_KEYS.map(key => SIDEBAR_MODULES.find(module => module.key === key)!).filter(Boolean);
// Chức năng mẫu bên trong app (app thật lấy từ useModuleNavigation của thanh bên, theo quyền).
const RAIL_NAV: Record<string, ModuleNavItem[]> = {
  WF: [{ to: '/wf/dashboard', icon: LayoutDashboard, label: 'Dashboard QT' }, { to: '/wf', icon: GitBranch, label: 'Quy trình' }, { to: '/wf/templates', icon: FileText, label: 'Mẫu quy trình' }],
  DA: [{ to: '/da', icon: BarChart3, label: 'Tổng quan DA' }, { to: '/da/portfolio', icon: Briefcase, label: 'Đa dự án' }],
  WMS: [{ to: '/inventory', icon: Package, label: 'Tồn kho' }, { to: '/operations', icon: ShoppingCart, label: 'Phiếu kho', badge: 3 }, { to: '/audit', icon: FileText, label: 'Kiểm kê' }],
  PROCUREMENT: [{ to: '/procurement', icon: ShoppingCart, label: 'Mua hàng công ty' }],
};
const FixtureRail: React.FC<{ dark: boolean; onToggleTheme: () => void; onExit: () => void; onNavigate: (to: string) => void }> = ({ dark, onToggleTheme, onExit, onNavigate }) => {
  const [order, setOrder] = useState(RAIL_KEYS);
  return (
    <CenterRailView
      pathname="/center"
      company={{ name: 'Tiến Thịnh' }}
      modules={order.map(key => RAIL_MODULES.find(module => module.key === key)!).filter(Boolean)}
      navFor={key => RAIL_NAV[key] || [{ to: RAIL_MODULES.find(module => module.key === key)?.route || '/', icon: LayoutDashboard, label: 'Tổng quan' }]}
      onReorder={keys => setOrder(keys)}
      badge="9"
      avatar="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 34 34'><rect width='34' height='34' fill='%23e7f0f3'/><text x='17' y='22' font-size='12' text-anchor='middle' fill='%232e6f80' font-family='sans-serif'>PS</text></svg>"
      userName="Phạm Ngọc Sơn"
      isDark={dark}
      notifications={<button type="button" aria-label="Thông báo"><Bell size={16} /></button>}
      onNavigate={onNavigate}
      onToggleTheme={onToggleTheme}
      onProfile={() => undefined}
      onSettings={() => undefined}
      onExitCenter={onExit}
    />
  );
};

// ?defaults=1: dùng giá trị mặc định của CenterShell cho giờ (như app thật) — bắt lỗi vẽ lại mãi.
// Giả lập "giao diện hiện tại" để thử công tắc + lời chào (?ui=classic mở ở giao diện hiện tại; ?intro=1 chạy lời chào).
const FakeClassic: React.FC<{ onEnter: () => void }> = ({ onEnter }) => (
  <div className="mx-auto max-w-md p-6" data-testid="fake-classic">
    <h1 className="text-xl font-black text-slate-800 dark:text-white">Trang chủ (giao diện hiện tại)</h1>
    <p className="mt-1 text-sm text-slate-500">Bản thử: chỗ này là Home hiện có. Công tắc nằm ở khối tài khoản của thanh bên trái.</p>
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-800/60">
      <UiModeSwitch active={false} onChange={next => { if (next) onEnter(); }} />
    </div>
  </div>
);

const Fixture: React.FC = () => {
  const [dark, setDark] = useState(params.get('theme') === 'dark');
  const [lastRoute, setLastRoute] = useState('');
  const [ui, setUi] = useState<'center' | 'classic'>(params.get('ui') === 'classic' ? 'classic' : 'center');
  const [intro, setIntro] = useState(params.get('intro') === '1');
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);
  if (ui === 'classic') {
    return <FakeClassic onEnter={() => { setIntro(true); setUi('center'); }} />;
  }
  return (
    <div className="flex h-[100dvh] w-full overflow-hidden" data-last-route={lastRoute}>
      <FixtureRail dark={dark} onToggleTheme={() => setDark(value => !value)} onExit={() => setUi('classic')} onNavigate={setLastRoute} />
      <main className="min-w-0 flex-1">
        <CenterEntrance play={intro} person={PERSON} now={NOW} onDone={() => setIntro(false)}>
          <CenterShell
            person={PERSON}
            company={{ name: 'Tiến Thịnh' }}
            isDark={dark}
            onToggleTheme={() => setDark(value => !value)}
            onOpenMenu={() => setLastRoute('menu')}
            mobileNotifications={<button type="button" className="vcc-iconbtn" aria-label="Thông báo"><Bell size={15} /></button>}
            canOpenRoute={route => !DENIED_ROUTES.has(route)}
            onNavigate={setLastRoute}
            now={params.get('defaults') === '1' ? undefined : NOW}
            loadWorkItems={loadWorkItems}
            loadToday={loadToday}
            loadActions={loadActions}
            loadLayout={loadLayout}
            saveLayout={saveLayout}
            loadDashboard={loadDashboard}
            loadDashboardAccess={loadDashboardAccess}
            Renderer={StubRenderer}
            ModalHost={StubModalHost}
          />
        </CenterEntrance>
      </main>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={['/center']}><Fixture /></MemoryRouter>);
