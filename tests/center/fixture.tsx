// Dữ liệu minh họa, chỉ dùng cho kiểm thử giao diện. Không gọi Supabase.
// ?theme=dark để xem nền tối; ?inbox=empty|error|many để xem trạng thái rỗng / lỗi / 200 việc của Việc của tôi;
// ?today=loner|error để xem Hôm nay khi không thuộc dự án nào / lỗi; ?layout=locked khi chưa có quyền tùy chỉnh.
// Bố cục "lưu máy chủ" giả lập bằng sessionStorage để tải lại trang vẫn còn.
// Cột 64px bên trái chỉ giả lập thanh bên (Sidebar) có sẵn của app.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BarChart3, Bell, Briefcase, FileText, GitBranch, LayoutDashboard, LogOut, Package, ShoppingCart, UserRound } from 'lucide-react';
import CenterShell from '../../components/center/CenterShell';
import type { AssistantHooks } from '../../components/center/AssistantView';
import { notifyCommandChanged, type AssistantCommand } from '../../lib/assistantCommands';
import type { MrFormActions } from '../../lib/assistantMrForm';
import { habitKey, rememberedIds, type MemoryActions, type PersonalMemory, type SharedGroup } from '../../lib/aiMemory';
import { buildRows, type PoFormActions } from '../../lib/assistantPoForm';
import type { ProcurementCatalogItem } from '../../lib/procurementInboxService';
import type { DailyLogFormActions } from '../../lib/assistantDailyLogForm';
import type { ReportRead } from '../../lib/dailyLogReport';
import type { ProjectTask } from '../../types';
import DL_DATA from '../daily-log/report-fixture-data.json';
import MR_CATALOG_RAW from '../material-request/quick-lines-items.json';
import { CenterRailView } from '../../components/center/CenterRail';
import { SIDEBAR_MODULES, type ModuleNavItem } from '../../components/Sidebar';
import { MemoryRouter } from 'react-router-dom';
import CenterEntrance from '../../components/center/CenterIntro';
import UiModeSwitch from '../../components/center/UiModeSwitch';
import type { InboxTab, WorkItem, WorkItemsPage } from '../../lib/center/workItemsService';
import type { CenterToday } from '../../lib/center/centerTodayService';
import type { CenterActionFlags, CenterModal } from '../../lib/center/centerActions';
import { parseCenterLayout, type CenterLayout, type CenterLayoutRecord } from '../../lib/center/centerLayout';
import { buildDashboardFixture, fixtureDocs, fixtureMoves } from './dashboardFixture';
import { buildFlowFixture, buildFlowItemsFixture } from './flowFixture';
import type { FlowItemsFilter, FlowQuery, FlowRemindOutcome, FlowResult } from '../../lib/center/centerFlowService';
import type { DashDocQuery, DashMoveKind } from '../../lib/dashboard/dashboardTypes';
import { SITE3D_PROJECTS, site3dRaw } from './site3dFixture';
import { parseSite3dAccess, parseSite3dResult } from '../../lib/site3d/site3dData';
import type { Site3dHooks, SiteModelKind, SiteModels } from '../../lib/site3d/site3dService';
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
const loadMaterialMoves = (key: string, kind: DashMoveKind, projectId: string | null) =>
  new Promise<ReturnType<typeof fixtureMoves>>(resolve => setTimeout(() => resolve(fixtureMoves(buildDashboardFixture(DASH === 'flaky' || DASH === 'slow' ? 'bgd' : DASH), key, kind, projectId)), 150));
const loadMetricDocs = (query: DashDocQuery, projectId: string | null) =>
  new Promise<ReturnType<typeof fixtureDocs>>(resolve => setTimeout(() => resolve(fixtureDocs(buildDashboardFixture(DASH === 'flaky' || DASH === 'slow' ? 'bgd' : DASH), query, projectId)), 150));
const loadDashboardAccess = () => Promise.resolve(DASH === 'error' || DASH === 'flaky' || DASH === 'slow' ? buildDashboardFixture('bgd').access : buildDashboardFixture(DASH).access);
const at = (days: number, hour = 17) => new Date(2026, 9, 7 + days, hour, 0).toISOString();
// Dòng chảy công việc: ?flow=bgd (mặc định) | head | lead | none | error | slow | flaky · ?flow=off: không có tab.
// Số lần gọi và truy vấn cuối ghi ở window.__flowLoads / window.__flowQuery để kiểm "tải khi mở tab, lọc gọi lại máy chủ".
const FLOW = params.get('flow') || 'bgd';
let flowLoads = 0;
const loadFlow = FLOW === 'off' ? undefined : (query: FlowQuery) => new Promise<FlowResult>((resolve, reject) => {
  flowLoads += 1;
  const w = window as unknown as { __flowLoads: number; __flowQuery: FlowQuery };
  w.__flowLoads = flowLoads; w.__flowQuery = query;
  setTimeout(() => {
    if (FLOW === 'error' || (FLOW === 'flaky' && flowLoads > 1)) reject(new Error('Máy chủ bận, thử lại sau ít phút.'));
    else if (FLOW === 'none') resolve({ access: false, reason: 'no_scope' });
    else resolve(buildFlowFixture(FLOW === 'flaky' || FLOW === 'slow' ? 'bgd' : FLOW, query.range ?? 90, flowLoads > 1 ? '2026-10-07T08:31:00+07:00' : '2026-10-07T08:25:00+07:00'));
  }, FLOW === 'slow' ? 1500 : 120);
});
const loadFlowAccess = () => Promise.resolve(FLOW === 'none' ? { access: false, scope: null } : { access: true, scope: buildFlowFixture(FLOW === 'error' || FLOW === 'flaky' || FLOW === 'slow' ? 'bgd' : FLOW).scope });
// Danh sách phiếu + nhắc (PR-3): lọc cuối ghi ở window.__flowItemsFilter; nhắc ghi ở window.__flowReminds (không gửi gì thật).
const loadFlowItems = (filter: FlowItemsFilter, limit?: number, offset?: number) => new Promise<ReturnType<typeof buildFlowItemsFixture>>(resolve => {
  (window as unknown as { __flowItemsFilter: FlowItemsFilter }).__flowItemsFilter = filter;
  setTimeout(() => resolve(buildFlowItemsFixture(filter, limit, offset)), 120);
});
const remindFlow = (filter: FlowItemsFilter, note?: string | null) => new Promise<FlowRemindOutcome>(resolve => {
  const w = window as unknown as { __flowReminds: Array<{ filter: FlowItemsFilter; note: string | null }> };
  w.__flowReminds = [...(w.__flowReminds || []), { filter, note: note || null }];
  const holders = [...new Map(buildFlowItemsFixture(filter, 200).items.filter(item => item.holder).map(item => [item.holder!.userId, item.holder!])).values()];
  setTimeout(() => resolve({ access: true, sent: holders.length, skipped: 0, holders: holders.map(h => ({ userId: h.userId, name: h.name, items: 1, status: 'sent' as const })) }), 150);
});

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

// Tab Trợ lý v2: ?ai=gemini giả lập đã có khóa (hội thoại chạy dần, trích khóa dòng số liệu); ?ai=fail lỗi giữa chừng; ?ai=quota hết lượt;
// ?ai=busy còn câu đang trả lời / ?ai=rate gửi quá nhanh (chống spam); ?ai=refuse câu từ chối lịch sự;
// mặc định chưa có khóa (chỉ câu hỏi nhanh). ?threads=today|old gieo sẵn một hội thoại hôm nay / ngày cũ. Hội thoại lưu sessionStorage
// (giả lập máy chủ) để tải lại trang vẫn mở lại được. Câu hỏi đã gửi và chấm nhận ghi ở window.__aiCalls để kiểm thử.
const AI = params.get('ai') || 'off';
const aiCalls: Array<Record<string, unknown>> = [];
(window as unknown as { __aiCalls: typeof aiCalls }).__aiCalls = aiCalls;
const aiStatus = (configured: boolean) => ({
  deployed: true, configured, provider: 'gemini' as const, providerSource: 'AI_PROVIDER' as const, models: { fast: 'gemini-2.5-flash', reasoning: 'gemini-2.5-pro' },
  keysPresent: { anthropic: false, gemini: true, openai: false }, priceKnown: false, skills: ['assistant_chat', 'morning_brief'],
  targets: { fast: null, reasoning: null },
});
type FxThread = { id: string; title: string; lastMessageAt: string; messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; sources: string[]; runId: string | null; accepted: boolean | null; createdAt: string; commands?: AssistantCommand[] }> };
const THREADS_KEY = 'center-fixture-ai-threads';
const loadThreads = (): FxThread[] => { try { return JSON.parse(sessionStorage.getItem(THREADS_KEY) || '[]'); } catch { return []; } };
const saveThreads = (list: FxThread[]) => sessionStorage.setItem(THREADS_KEY, JSON.stringify(list));
if (params.get('threads') && !sessionStorage.getItem(THREADS_KEY)) {
  const at = params.get('threads') === 'old' ? new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - 3, 9, 15) : new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 7, 40);
  const iso = at.toISOString();
  saveThreads([{ id: '0d4c2f1e-8a5b-4c3d-9e2f-1a2b3c4d5e6f', title: 'PO nào sắp giao?', lastMessageAt: iso, messages: [
    { id: 'm1', role: 'user', content: 'PO nào sắp giao?', sources: [], runId: null, accepted: null, createdAt: iso },
    { id: 'm2', role: 'assistant', content: 'PO-116 hẹn giao 09/10 nhưng **đã quá hạn 2 ngày** [[item.po.po-116]].', sources: ['item.po.po-116'], runId: 'run-old', accepted: true, createdAt: iso },
  ] }]);
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const saveCommand = (command: AssistantCommand) => saveThreads(loadThreads().map(t => ({ ...t, messages: t.messages.map(m => ({ ...m,
  commands: (m.commands || []).map(c => (c.id === command.id ? command : c)) })) })));
// Lệnh nháp giả lập: câu xin nghỉ → Trợ lý gọi công cụ chuẩn bị, hiện thẻ (không gửi). ?ai=leave-short: thiếu phép (nút Gửi khóa).
const leaveCommand = (): AssistantCommand => ({
  id: `cmd-${Date.now()}`, kind: 'leave_request', status: 'prepared', title: 'Đơn phép năm 21/10',
  payload: { type: 'annual', typeName: 'Phép năm', start: '2026-10-21', end: '2026-10-21', startSession: 'full', endSession: 'full', reason: 'Việc gia đình', requiresAttachment: false },
  preview: { days: 1, annualRemaining: AI === 'leave-short' ? 0.5 : 6, steps: [{ label: 'Quản lý trực tiếp', name: 'Hà Đức Chuẩn' }],
    problems: AI === 'leave-short' ? ['Phép năm còn 0,5 ngày, không đủ 1 ngày.'] : [] },
  result: {}, error: null, createdAt: new Date(NOW).toISOString(), confirmedAt: null,
});
// T2b: câu đề xuất vật tư → Trợ lý tách dòng, chọn dự án đang xem, hiện thẻ mở form Đề xuất (không lập phiếu).
const mrCommand = (): AssistantCommand => ({
  id: `cmd-mr-${Date.now()}`, kind: 'material_request', status: 'prepared', title: 'Đề xuất vật tư SMB-2026',
  payload: { projectId: 'smb', projectCode: 'SMB-2026', projectName: 'Nhà máy SMB', title: 'Vật tư đổ bê tông sàn tầng 4', purpose: 'Đổ bê tông sàn tầng 4',
    neededDate: '2026-10-23', lines: [{ name: 'Xi măng PCB40', qty: 2, unit: 'tấn' }, { name: 'Thép', spec: 'D16', qty: 50, unit: 'cây' }, { name: 'Ống PVC', qty: 20, unit: 'cây' }, { name: 'Dây thép buộc', unit: 'kg' }] },
  preview: { lineCount: 4, missingQty: 1 }, result: {}, error: null, createdAt: new Date(NOW).toISOString(), confirmedAt: null,
});
// Form Đề xuất (bản thử) lưu xong: báo thẻ cùng trang đổi thành biên nhận như form thật.
(window as unknown as { __fxSaveMr: (submitted: boolean) => void }).__fxSaveMr = submitted => {
  const command = loadThreads().flatMap(t => t.messages.flatMap(m => m.commands || [])).filter(c => c.kind === 'material_request' && c.status === 'prepared').at(-1);
  if (!command) return;
  const done: AssistantCommand = { ...command, status: 'done', result: { code: 'MR-2026-0042', id: 'mr-42', submitted }, confirmedAt: new Date(NOW).toISOString() };
  saveCommand(done);
  notifyCommandChanged(done);
};
// T4b: trí nhớ giả lập (sessionStorage). ?memory=1: đã có 1 ghi nhớ, đã nhớ người duyệt Bùi Thị Tâm + Kho Xin Hai Vina ở SMB-2026, 2 cách gọi chung.
const MEMORY_KEY = 'center-fixture-memory';
type FxMemory = PersonalMemory & { shared: SharedGroup[] };
const loadMemory = (): FxMemory => {
  try { const raw = sessionStorage.getItem(MEMORY_KEY); if (raw) return JSON.parse(raw); } catch { /* bỏ qua */ }
  const at = new Date(NOW).toISOString();
  return params.get('memory') ? {
    notes: [{ id: 'note-1', text: 'Phụ trách dự án SMB-2026', source: 'user', createdAt: at }],
    habits: [{ id: 'hb-1', key: habitKey.mrApprovers('smb'), value: 'u-tam', label: 'Bùi Thị Tâm', scopeLabel: 'SMB-2026', hits: 3, updatedAt: at },
      { id: 'hb-2', key: habitKey.mrWarehouse('smb'), value: 'wh-xh', label: 'Kho Xin Hai Vina', scopeLabel: 'SMB-2026', hits: 1, updatedAt: at }],
    shared: [
      { key: 'company:procurement:po', title: 'Mua hàng · Báo giá', kind: 'po', items: [{ id: 'al-2', kind: 'vendor', alias: 'Hòa Phát', target: 'Công ty CP Thép Hòa Phát', hits: 5, lastUsedAt: at, by: 'Bùi Thị Tâm' }] },
      { key: 'project:smb:mr', title: 'SMB-2026 · Đề xuất vật tư', kind: 'mr', items: [{ id: 'al-1', kind: 'item', alias: 'Ống PVC', target: 'Ống PVC 42', hits: 2, lastUsedAt: at, by: 'Phạm Ngọc Sơn' }] },
    ],
  } : { notes: [], habits: [], shared: [] };
};
const saveMemory = (m: FxMemory) => sessionStorage.setItem(MEMORY_KEY, JSON.stringify(m));
const memory: MemoryActions = {
  personal: async () => { await sleep(60); const { notes, habits } = loadMemory(); return { notes, habits }; },
  shared: async () => { await sleep(60); return loadMemory().shared; },
  addNote: async text => {
    aiCalls.push({ memory: 'add', text });
    const m = loadMemory();
    const same = m.notes.find(n => n.text.toLowerCase() === text.trim().toLowerCase());
    if (same) return { id: same.id, created: false };
    const note = { id: `note-${Date.now()}`, text: text.trim(), source: 'user' as const, createdAt: new Date(NOW).toISOString() };
    saveMemory({ ...m, notes: [note, ...m.notes] });
    return { id: note.id, created: true };
  },
  forget: async (scope, id) => {
    aiCalls.push({ memory: 'forget', scope, id });
    await sleep(40);
    const m = loadMemory();
    saveMemory({ ...m, notes: m.notes.filter(n => n.id !== id), habits: m.habits.filter(h => h.id !== id),
      shared: m.shared.map(g => ({ ...g, items: g.items.filter(i => i.id !== id) })).filter(g => g.items.length) });
  },
  saveNoteCommand: async (command, text) => {
    aiCalls.push({ memory: 'save-command', text });
    const m = loadMemory();
    const note = { id: `note-${Date.now()}`, text: text.trim(), source: 'assistant' as const, createdAt: new Date(NOW).toISOString() };
    saveMemory({ ...m, notes: [note, ...m.notes] });
    const done: AssistantCommand = { ...command, status: 'done', result: { id: note.id, text: note.text, created: true }, confirmedAt: new Date(NOW).toISOString() };
    saveCommand(done);
    return done;
  },
};
const memoryCommand = (text: string): AssistantCommand => ({
  id: `cmd-mem-${Date.now()}`, kind: 'memory_note', status: 'prepared', title: 'Ghi nhớ', payload: { text }, preview: {}, result: {}, error: null,
  createdAt: new Date(NOW).toISOString(), confirmedAt: null,
});

// Form đề xuất ngay trong chat (bản thử): danh mục 175 mã thật, 2 kho, 2 người duyệt. ?ai=mr-noflow: dự án chưa có workflow (chỉ lưu nháp);
// ?ai=mr-fail: lần gửi đầu mất kết nối (giữ mã đã cấp, gửi lại được); ?mrform=0: bản cũ không có form (thẻ mở form của dự án).
const MR_CATALOG = (MR_CATALOG_RAW as Array<{ id: string; sku: string; name: string; unit: string }>).map(i => ({ id: i.id, sku: i.sku, name: i.name, unit: i.unit }));
const mrForm: MrFormActions = {
  load: async () => {
    await sleep(80);
    aiCalls.push({ mrForm: 'load' });
    // ?memory=1: dự án đã nhớ "Ống PVC" = Ống PVC 42 (người dùng xác nhận lần trước) → thẻ chọn sẵn, không bắt chọn lại.
    const memory = params.get('memory') ? [{ kind: 'item' as const, alias: 'Ống PVC', aliasNorm: 'ong pvc', targetId: 'it-1a7f772d34ab4306be08e57a597b0641', targetLabel: 'Ống PVC 42', hits: 2 }] : [];
    const warehouses = [{ id: 'wh-smb', name: 'Kho Sơn Miền Bắc' }, { id: 'wh-xh', name: 'Kho Xin Hai Vina' }];
    const approvers = [{ id: 'u-chuan', name: 'Hà Đức Chuẩn' }, { id: 'u-tam', name: 'Bùi Thị Tâm' }];
    const personal = loadMemory();
    return { memory, catalog: MR_CATALOG, warehouses, defaultWarehouseId: 'wh-smb', approvers,
      rememberedWarehouseId: rememberedIds(personal, habitKey.mrWarehouse('smb'), warehouses)[0] ?? null,
      rememberedApproverIds: rememberedIds(personal, habitKey.mrApprovers('smb'), approvers),
      sendBlocked: AI === 'mr-noflow' ? 'Dự án chưa cấu hình workflow đề xuất vật tư hợp lệ.' : null };
  },
  submit: async (command, input) => {
    aiCalls.push({ mrForm: 'submit', mode: input.mode, title: input.title, warehouseId: input.warehouseId, neededDate: input.neededDate, approverIds: input.approverIds,
      lines: input.lines.map(l => ({ item: l.item.name, qty: l.qty, spec: l.spec, reason: l.reason, said: l.said })) });
    await sleep(120);
    if (AI === 'mr-fail' && !aiCalls.some(c => c.mrForm === 'failed')) {
      aiCalls.push({ mrForm: 'failed' });
      saveCommand({ ...command, status: 'failed', result: { code: 'MR-2026-0042', id: 'mr-42' }, error: 'Mất kết nối, chưa gửi được.' });
      throw new Error('Mất kết nối, chưa gửi được.');
    }
    const done: AssistantCommand = { ...command, status: 'done', result: { code: 'MR-2026-0042', id: 'mr-42', submitted: input.mode === 'send', approvers: input.approverNames },
      confirmedAt: new Date(NOW).toISOString() };
    saveCommand(done);
    return done;
  },
};
// T2c: báo giá dán vào → thẻ đơn mua. Danh mục mua hàng = 175 mã thật (Xi măng PCB40 trong BOQ còn 8 tấn); NCC "Hòa Phát" có 2 công ty gần giống.
const PO_CATALOG: ProcurementCatalogItem[] = MR_CATALOG.map(i => ({ id: i.id, name: i.name, sku: i.sku, unit: i.unit, purchaseUnit: null, purchaseFactor: null,
  inBoq: i.name === 'Xi măng PCB40', boqQty: i.name === 'Xi măng PCB40' ? 20 : 0, orderedQty: i.name === 'Xi măng PCB40' ? 12 : 0 }));
const fold = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
const poSearch = async (q: string) => { const words = fold(q).split(/\s+/).filter(Boolean); return PO_CATALOG.filter(i => words.every(w => fold(`${i.name} ${i.sku}`).includes(w))).slice(0, 20); };
const PO_VENDORS = [{ id: 'v-hp', name: 'Công ty CP Thép Hòa Phát', taxCode: '0900189284', recentOrders: 12 }, { id: 'v-hpdn', name: 'Thép Hòa Phát Dung Quất', taxCode: '4300381300', recentOrders: 2 }];
const poCommand = (): AssistantCommand => ({
  id: `cmd-po-${Date.now()}`, kind: 'purchase_order', status: 'prepared', title: 'Đơn mua Hòa Phát · SMB-2026',
  payload: { projectId: 'smb', projectCode: 'SMB-2026', projectName: 'Nhà máy SMB', warehouseId: 'wh-smb', vendorQuery: 'Hòa Phát',
    vendorOptions: PO_VENDORS.map(({ recentOrders: _r, ...v }) => v), vat: 8, deliveryDate: '2026-10-25', note: 'Báo giá BG-1810',
    lines: [{ name: 'Xi măng PCB40', qty: 10, unit: 'tấn', price: 1650000 }, { name: 'Thép XD D16', qty: 50, unit: 'cây', price: 280000 }, { name: 'Ống PVC', qty: 20, unit: 'cây', price: 95000 }] },
  preview: { lineCount: 3 }, result: {}, error: null, createdAt: new Date(NOW).toISOString(), confirmedAt: null,
});
const poForm: PoFormActions = {
  load: async command => {
    await sleep(80);
    aiCalls.push({ poForm: 'load' });
    const lines = (command.payload.lines as Array<{ name: string; qty: number; unit: string; price: number }>).map(l => ({ name: l.name, spec: null, qty: l.qty, unit: l.unit, price: l.price }));
    return { warehouses: [{ id: 'wh-smb', name: 'Kho Sơn Miền Bắc' }], approvers: AI === 'po-noapprover' ? [] : [{ id: 'u-chuan', name: 'Hà Đức Chuẩn' }, { id: 'u-tam', name: 'Bùi Thị Tâm' }],
      rows: await buildRows(lines, poSearch) };
  },
  searchItems: async (_p, q) => poSearch(q),
  searchVendors: async q => PO_VENDORS.filter(v => fold(v.name).includes(fold(q))),
  submit: async (command, input) => {
    aiCalls.push({ poForm: 'submit', mode: input.mode, vendorId: input.vendor.id, warehouseId: input.warehouseId, vat: input.vat, reasonCode: input.reasonCode,
      overBoqReason: input.overBoqReason, approverId: input.approverId, deliveryDate: input.deliveryDate,
      lines: input.rows.filter(r => r.item).map(r => ({ item: r.item!.name, qty: r.stockQty, price: r.price })) });
    await sleep(120);
    const done: AssistantCommand = { ...command, status: 'done', confirmedAt: new Date(NOW).toISOString(),
      result: { code: 'PO-2026-0712', id: 'po-712', submitted: input.mode === 'send', approvers: input.approverName ? [input.approverName] : [], total: 20_520_000 } };
    saveCommand(done);
    return done;
  },
};
// T2d: báo cáo Zalo dán vào → thẻ nhật ký. Cây hạng mục thật DA29 + kết quả AI thật (tin 3 ngày 13–15/10), như bộ test màn Nhật ký.
const dlCommand = (text: string): AssistantCommand => ({
  id: `cmd-dl-${Date.now()}`, kind: 'daily_log', status: 'prepared', title: 'Nhật ký từ báo cáo Zalo · DA29',
  payload: { projectId: 'da29', projectCode: 'DA29', projectName: 'Nhà xưởng XinHai', siteId: 'site-da29', reportDate: '2026-10-15', text },
  preview: { chars: text.length }, result: {}, error: null, createdAt: new Date(NOW).toISOString(), confirmedAt: null,
});
const dailyLog: DailyLogFormActions = {
  tasks: async () => DL_DATA.tasks as unknown as ProjectTask[],
  hooks: {
    read: async input => {
      aiCalls.push({ dailyLog: 'read', reportDate: input.reportDate, taskLines: input.tasks.split('\n').length });
      await sleep(400);
      if (AI === 'dl-fail' && !aiCalls.some(c => c.dailyLog === 'failed')) { aiCalls.push({ dailyLog: 'failed' }); return { code: 'AI_FAILED', error: 'AI_HTTP_502' }; }
      return { code: 'OK', runId: 'run-dl', result: DL_DATA.read as unknown as ReportRead, model: 'claude-sonnet-5-5', provider: 'openai_compatible', usage: { tokensIn: 14198, tokensOut: 3110, costUsd: null, durationMs: 29630 } };
    },
    feedback: (runId, accepted) => { aiCalls.push({ feedback: { runId, accepted } }); },
    memory: async () => [],
    learn: async (_p, _s, pairs) => { aiCalls.push({ dailyLog: 'learn', pairs: pairs.length }); },
    recentAreas: async () => [{ code: 'NX1', name: 'Nhà xưởng' }, { code: 'NHA-NGHI-CA', name: 'Nhà Nghỉ ca' }, { code: 'NVP', name: 'Nhà văn phòng' }],
    knownCrews: async () => ['Tổ Đỗ Duy Ích', 'Tổ công nhật Đỗ Hiệp Đoàn'],
    createDraft: async ({ slip }) => {
      await sleep(60);
      aiCalls.push({ dailyLog: 'create', date: slip.date, area: slip.areaCode, works: slip.works.length });
      if (slip.date === '2026-10-13' && slip.areaCode === 'NX1') return { slip, status: 'exists', contributionId: 'existing-nx1-1310', message: 'Đã có phiếu của mũi này trong ngày — mở để bổ sung.' };
      return { slip, status: 'created', contributionId: `c-${slip.date}-${slip.areaCode}` };
    },
  },
  finish: async (command, result) => {
    const done: AssistantCommand = { ...command, status: 'done', result, confirmedAt: new Date(NOW).toISOString() };
    saveCommand(done);
    return done;
  },
};
// Model được cấp (?models=1: chỉ một model → không có menu chọn).
const MODELS = [
  { id: 'c-claude', name: 'Claude Sonnet 5.5', model: 'claude-sonnet-5-5', blurb: 'Hiểu sâu, đọc ảnh / PDF scan — hợp báo giá, phân tích', icon: '🧠', vision: true, isDefault: true },
  { id: 'c-deepseek', name: 'DeepSeek Flash', model: 'deepseek-v4.1-flash', blurb: 'Nhanh, rẻ — câu hỏi thường, tra cứu nhanh', icon: '⚡', vision: false, isDefault: false },
];
// 19/10: tìm ngay trong ô hỏi — hồ sơ giả theo cụm từ (như search_global_v1), ghi lại lời gọi để kiểm.
const INSTANT_RECORDS = [
  { kind: 'employee' as const, id: 'emp-thanh', code: 'TT006974', title: 'Nguyễn Văn Thanh', subtitle: 'Trưởng nhóm TLĐ', status: 'đang làm việc', date: null, projectId: null, siteId: null, rank: 60, extra: { jobTitle: 'Trưởng nhóm TLĐ', phone: '0912000000' } },
  { kind: 'employee' as const, id: 'emp-huong', code: 'TT004431', title: 'Nguyễn Thị Hương', subtitle: 'Trưởng phòng TCKT', status: 'đang làm việc', date: null, projectId: null, siteId: null, rank: 60, extra: {} },
  { kind: 'purchase_order' as const, id: 'po-272', code: 'PO-272', title: 'Thép D8 CB240 · Hòa Phát', subtitle: 'SMB-2026 · đang giao', status: 'in_transit', date: '2026-10-14', projectId: 'p-smb', siteId: null, rank: 100, extra: {} },
];
const instantSearch: NonNullable<AssistantHooks['search']> = async (terms, kinds, limit) => {
  aiCalls.push({ search: terms.map(g => g[0]).join(' '), kinds: kinds.length, limit });
  await sleep(40);
  const fold = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
  const records = INSTANT_RECORDS.filter(r => kinds.includes(r.kind) && terms.every(group => group.some(alt => fold(`${r.code} ${r.title}`).includes(alt))))
    .map(r => ({ ...r, rank: terms.some(g => g.some(alt => alt === fold(r.code))) ? 100 : r.rank }));
  return { records: records.slice(0, limit), failed: [] };
};

const assistantHooks: AssistantHooks = {
  search: instantSearch,
  poForm,
  memory,
  // Trung tâm AI: ?access=none → chưa được cấp Trợ lý; ?access=cap → trần 30 câu/ngày, đã dùng 27.
  access: async () => ({ models: params.get('models') === '1' ? [MODELS[0]] : MODELS, ...(params.get('access') === 'none'
    ? { assistant: false, dailyQuestionCap: null, monthlyCostCapUsd: null, usedToday: 0, monthCostUsd: 0, admin: 'Admin Hoàng' }
    : params.get('access') === 'cap'
      ? { assistant: true, dailyQuestionCap: 30, monthlyCostCapUsd: 3, usedToday: 27, monthCostUsd: 0.4, admin: 'Admin Hoàng' }
      : { assistant: true, dailyQuestionCap: null, monthlyCostCapUsd: null, usedToday: 0, monthCostUsd: 0, admin: 'Admin Hoàng' }) }),
  dailyLog,
  ...(params.get('mrform') === '0' ? {} : { mrForm }),
  status: () => new Promise(resolve => setTimeout(() => resolve(aiStatus(AI !== 'off')), 40)),
  narrate: (facts, context) => new Promise(resolve => setTimeout(() => {
    aiCalls.push({ skill: 'morning_brief', factLines: facts.split('\n').length, context });
    resolve({ code: 'OK', runId: `run-${aiCalls.length}`, provider: 'gemini', model: 'gemini-2.5-flash', usage: { tokensIn: 900, tokensOut: 90, costUsd: null, durationMs: 700 },
      result: { brief: 'Sáng nay bạn có 11 việc chờ, trong đó PO-116 quá hạn 2 ngày và MR-2026-2688 cần duyệt trước 13h. Tiến độ SMB-2026 đạt 81% nhưng 7 việc đã trễ; 4 đề xuất vật tư đang chờ Phòng vật tư. Bạn chưa chấm công hôm nay.' } });
  }, 120)),
  feedback: (runId, accepted, detail) => { aiCalls.push({ feedback: { runId, accepted, ...(detail?.reason ? { reason: detail.reason, note: detail.note || null } : {}) } }); },
  listThreads: async () => { await sleep(30); return loadThreads().sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)).map(({ messages, ...t }) => ({ ...t, messageCount: messages.length })); },
  getThread: async id => {
    await sleep(30);
    const t = loadThreads().find(x => x.id === id);
    if (!t) throw new Error('AI_THREAD_NOT_FOUND');
    return { ...t, messageCount: t.messages.length, messages: t.messages.map(m => ({ ...m, commands: m.commands || [] })) };
  },
  // T2a: Xác nhận lệnh nháp. ?ai=leave-fail lần gửi đầu báo lỗi (trùng ngày); trạng thái thẻ lưu cùng hội thoại (tải lại vẫn thấy).
  runCommand: async (command, edits) => {
    aiCalls.push({ command: 'run', id: command.id, reason: edits.reason });
    await sleep(80);
    if (AI === 'leave-fail' && !aiCalls.some(c => c.command === 'failed')) { aiCalls.push({ command: 'failed' }); throw new Error('Ngày 21/10 đã có đơn nghỉ khác.'); }
    const done: AssistantCommand = { ...command, status: 'done', result: { code: 'NP-2026-0099', id: 'lr-1', route: '/hrm/leave' }, confirmedAt: new Date(NOW).toISOString() };
    saveCommand(done);
    return done;
  },
  cancelCommand: async command => {
    aiCalls.push({ command: 'cancel', id: command.id });
    const cancelled: AssistantCommand = { ...command, status: 'cancelled' };
    saveCommand(cancelled);
    return cancelled;
  },
  chat: async (input, handlers, signal) => {
    const runId = `run-${aiCalls.length + 1}`;
    const prior = input.threadId ? loadThreads().find(t => t.id === input.threadId)?.messages.length || 0 : 0;
    aiCalls.push({ skill: 'assistant_chat', question: input.question, threadId: input.threadId, prior, pronoun: input.pronoun, factLines: input.facts.split('\n').length, context: input.context,
      ...(input.hits?.length ? { hits: input.hits.map(h => h.code || h.id) } : {}),
      ...(input.images?.length || input.files?.length ? { images: input.images?.length || 0, files: (input.files || []).map(f => ({ name: f.name, head: f.text.split('\n').slice(0, 5).join('\n') })) } : {}) });
    await sleep(60);
    if (AI === 'quota') return { code: 'AI_QUOTA', reason: 'day', usedToday: 80, dailyLimit: 80 };
    if (AI === 'busy') return { code: 'AI_QUOTA', reason: 'busy' };
    if (AI === 'rate') return { code: 'AI_QUOTA', reason: 'minute' };
    handlers.onStart?.({ runId, model: 'gemini-2.5-pro' });
    const keys = input.facts.split('\n').map(line => line.split(' | ')[0]).filter(key => /^(project\.progress|supply\.requests|item\.po\.)/.test(key)).slice(0, 3);
    // ?ai=refuse: lời lẽ khiếm nhã → AI mở đầu bằng nhãn từ chối (màn hình phải ẩn), máy chủ trả câu đã bỏ nhãn.
    const refused = AI === 'refuse' ? '[[tu_choi:khiem_nha]] Em mong anh dùng từ ngữ lịch sự hơn ạ. Anh cần xem việc nào hôm nay?' : null;
    // T1: câu hỏi cần tra (tồn kho, PO) → giả lập Trợ lý gọi công cụ rồi dẫn hồ sơ [[h1]] (nguồn dạng hồ sơ, màn hình tự mở đúng màn).
    const lookup = /tồn|PO-6/i.test(input.question) && !refused && !prior ? (/tồn/i.test(input.question)
      ? { tool: { name: 'ton_kho', label: 'Tồn kho', query: 'thép D16' }, text: 'Thép CB400 D16 còn **42,4 tấn**: Kho SMB 12,4 tấn, Kho tổng Hưng Yên 30 tấn [[h1]].',
        record: { kind: 'item', id: 'it-1', code: 'THEP-D16', title: 'Thép CB400 D16', subtitle: 'tấn · Thép', extra: { unit: 'tấn' } } }
      : { tool: { name: 'chi_tiet_don_mua', label: 'Chi tiết đơn mua', query: 'PO-646' }, text: 'PO-646 còn phải giao **8 tấn** thép D16, còn nợ NCC 280.000.000đ [[h1]].',
        record: { kind: 'purchase_order', id: 'po-1', code: 'PO-646', title: 'Kết cấu thép 568', projectId: 'smb' } }) : null;
    if (lookup) { await sleep(150); handlers.onTool?.(lookup.tool); await sleep(250); }
    // Gợi ý bấm: "xin nghỉ" chưa rõ loại → hỏi lại kèm phương án (màn hình thành nút; bấm là gửi đúng câu đó).
    // T3: chỉ gửi tệp (không gõ gì) → Trợ lý tóm tắt tệp, hỏi lại cần làm gì bằng gợi ý bấm.
    if (input.question === 'Xem tệp đính kèm.' && (input.images?.length || input.files?.length)) {
      const text = `Tệp có **3 dòng thép** (D16, D20, D8) kèm đơn giá — giống một báo giá. Anh muốn làm gì? [[goi_y:Lập đơn mua theo báo giá này]] [[goi_y:Đề xuất vật tư theo danh sách này]]`;
      for (const chunk of text.match(/[\s\S]{1,9}/g) || []) { await sleep(15); handlers.onDelta(chunk); }
      return { code: 'OK', runId, threadId: input.threadId || '0d4c2f1e-8a5b-4c3d-9e2f-0000000000f1', messageId: `msg-${aiCalls.length}`, answer: text, sources: [], model: 'gemini-2.5-pro', saved: true };
    }
    // T4b: "nhớ giúp …" → thẻ ghi nhớ (người dùng tự bấm Lưu).
    const wantsNote = /nhớ giúp|ghi nhớ/i.test(input.question) && !refused && !lookup;
    if (wantsNote) {
      const note = memoryCommand('Phụ trách SMB-2026 và DA29; báo cáo ngắn gọn, số liệu trước');
      await sleep(120);
      handlers.onTool?.({ name: 'chuan_bi_ghi_nho', label: 'Chuẩn bị ghi nhớ', query: '' });
      await sleep(100);
      handlers.onCommand?.(note);
      const text = 'Em đã chuẩn bị ghi nhớ — anh kiểm chữ rồi bấm **Lưu ghi nhớ** trên thẻ.';
      for (const chunk of text.match(/[\s\S]{1,9}/g) || []) { await sleep(20); handlers.onDelta(chunk); }
      const all = loadThreads();
      const at = new Date(NOW.getTime() + aiCalls.length * 60_000).toISOString();
      let thread = input.threadId ? all.find(t => t.id === input.threadId) : undefined;
      if (!thread) { thread = { id: `0d4c2f1e-8a5b-4c3d-9e2f-${String(all.length + 1).padStart(12, '0')}`, title: input.question.slice(0, 80), lastMessageAt: at, messages: [] }; all.push(thread); }
      const messageId = `msg-${aiCalls.length}`;
      thread.messages.push({ id: `${messageId}-q`, role: 'user', content: input.question, sources: [], runId: null, accepted: null, createdAt: at },
        { id: messageId, role: 'assistant', content: text, sources: [], runId, accepted: null, createdAt: at, commands: [note] });
      thread.lastMessageAt = at;
      saveThreads(all);
      return { code: 'OK', runId, threadId: thread.id, messageId, answer: text, sources: [], model: 'gemini-2.5-pro', saved: true };
    }
    const asksType = /^xin nghỉ\.?$/i.test(input.question.trim()) && !refused;
    const wantsDl = /^(BC|báo cáo) ngày/i.test(input.question.trim()) && !refused && !lookup;
    const wantsPo = /báo giá|đơn mua|đặt hàng/i.test(input.question) && !refused && !lookup && !wantsDl;
    const wantsMr = /đề xuất|xi măng/i.test(input.question) && !refused && !lookup && !wantsPo && !wantsDl;
    const wantsLeave = /nghỉ|phép/i.test(input.question) && !refused && !lookup && !asksType && !wantsMr && !wantsDl;
    const command = wantsDl ? dlCommand(input.question) : wantsPo ? poCommand() : wantsMr ? mrCommand() : wantsLeave ? leaveCommand() : null;
    if (command) {
      await sleep(120);
      handlers.onTool?.(wantsDl ? { name: 'chuan_bi_nhat_ky', label: 'Chuẩn bị nhật ký', query: '' } : wantsPo ? { name: 'chuan_bi_don_mua', label: 'Chuẩn bị đơn mua', query: '' }
        : wantsMr ? { name: 'chuan_bi_de_xuat_vat_tu', label: 'Chuẩn bị đề xuất vật tư', query: '' } : { name: 'chuan_bi_don_nghi_phep', label: 'Chuẩn bị đơn nghỉ phép', query: '' });
      await sleep(150);
      handlers.onCommand?.(command);
    }
    const answer = refused ?? lookup?.text
      ?? (asksType ? 'Anh nghỉ loại nào? [[goi_y:Phép năm]] [[goi_y:Ốm đau (BHXH)]] [[goi_y:Việc riêng không lương]]' : null)
      ?? (wantsDl ? 'Em đã nhận báo cáo **DA29**. Thẻ bên dưới đang đọc ngày, mũi, hạng mục — anh kiểm rồi bấm **Tạo phiếu nháp**.' : null)
      ?? (wantsPo ? 'Em đã chuẩn bị **đơn mua Hòa Phát · SMB-2026** gồm 3 dòng theo báo giá, VAT 8%. NCC có 2 công ty gần giống — anh bấm chọn, kiểm mã, chọn lý do và người duyệt rồi bấm **Gửi duyệt** trên thẻ.' : null)
      ?? (wantsMr ? 'Em đã chuẩn bị **đề xuất vật tư SMB-2026** gồm 4 dòng; dây thép buộc chưa có số lượng. Anh chọn mã, kiểm số lượng, chọn người duyệt rồi bấm **Gửi duyệt** ngay trên thẻ.' : null)
      ?? (command ? 'Em đã chuẩn bị **đơn phép năm 21/10** (1 ngày). Anh xem thẻ bên dưới rồi bấm Gửi đơn.' : null) ?? (prior
      ? `Tiếp câu trước (em nhớ ${prior / 2} lượt): **PO-116** vẫn quá hạn 2 ngày [[${keys[2] || ''}]], anh nên gọi NCC hôm nay.`
      : `Anh có 7 việc trễ trên tiến độ SMB-2026 [[${keys[0] || ''}]]. Gấp nhất:\n- **PO-116** đã quá hạn 2 ngày [[${keys[2] || ''}]]\n- 4 đề xuất vật tư chờ Phòng vật tư duyệt [[${keys[1] || ''}]]`);
    let sent = '';
    for (const chunk of answer.match(/[\s\S]{1,9}/g) || []) {
      if (signal?.aborted) return { code: 'AI_FAILED', runId, error: 'AI_ABORTED', partial: sent };
      if (AI === 'fail' && sent.length > 30) return { code: 'AI_FAILED', runId, error: 'AI_HTTP_502', partial: sent };
      await sleep(25);
      sent += chunk;
      handlers.onDelta(chunk);
    }
    const all = loadThreads();
    // Giờ giả lập của fixture (NOW) + vài phút mỗi lượt: hội thoại vừa hỏi là "hôm nay" với màn hình.
    const at = new Date(NOW.getTime() + aiCalls.length * 60_000).toISOString();
    let thread = input.threadId ? all.find(t => t.id === input.threadId) : undefined;
    if (!thread) { thread = { id: `0d4c2f1e-8a5b-4c3d-9e2f-${String(all.length + 1).padStart(12, '0')}`, title: input.question.slice(0, 80), lastMessageAt: at, messages: [] }; all.push(thread); }
    const messageId = `msg-${aiCalls.length}`;
    thread.messages.push({ id: `${messageId}-q`, role: 'user', content: input.question, sources: [], runId: null, accepted: null, createdAt: at },
      { id: messageId, role: 'assistant', content: answer, sources: lookup || command || asksType ? [] : keys, runId, accepted: null, createdAt: at, commands: command ? [command] : [] });
    thread.lastMessageAt = at;
    saveThreads(all);
    const sources = refused || command || asksType ? [] : lookup ? [{ ref: 'h1', type: 'record' as const, record: { ...lookup.record, status: null, date: null, siteId: null, projectId: (lookup.record as { projectId?: string }).projectId || null, rank: 100, extra: (lookup.record as { extra?: Record<string, unknown> }).extra || {}, subtitle: (lookup.record as { subtitle?: string }).subtitle || null } as never }] : keys;
    return { code: 'OK', runId, threadId: thread.id, messageId, answer: answer.replace(/\[\[tu_choi:[a-z_]+\]\]\s*/, ''), sources, model: 'gemini-2.5-pro', saved: true };
  },
};

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
      accountMenu={[
        { key: 'profile', label: 'Thông tin cá nhân', icon: UserRound, onSelect: () => onNavigate('/my-profile') },
        { key: 'logout', label: 'Đăng xuất', icon: LogOut, onSelect: () => onNavigate('/login'), danger: true },
      ]}
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

// Công trường 3D: ?site3d=admin | viewer | none (không quyền → không có tab) | error (lỗi tải số liệu) · mặc định không có tab.
// ?site3dModel=1: mô hình XinHai trong repo (docs/command-center/mockups/xinhai) đóng vai tệp ở kho riêng tư (kiểm luồng tải);
// tải lên ghi ở window.__site3dUploads (không gửi đi đâu).
const SITE3D = params.get('site3d');
const site3dUploads: Record<string, { name: string; size: number }> = {};
const SITE3D_MODEL_URL: Record<SiteModelKind, string> = { architecture: '/docs/command-center/mockups/xinhai/xinhai.glb', structure: '/docs/command-center/mockups/xinhai/xinhai-tekla.glb' };
const site3dHooks: Site3dHooks | undefined = !SITE3D ? undefined : {
  loadAccess: () => Promise.resolve(parseSite3dAccess(SITE3D === 'none' ? { access: false, reason: 'no_permission' } : { access: true, canManage: SITE3D === 'admin', projects: SITE3D_PROJECTS })),
  loadSite: code => new Promise((resolve, reject) => setTimeout(() => {
    if (SITE3D === 'error') reject(new Error('Máy chủ bận, thử lại sau ít phút.'));
    else resolve(parseSite3dResult({ ...site3dRaw(code), canManage: SITE3D === 'admin' }, new Date(2026, 9, 17, 9, 0)));
  }, 150)),
  // XinHai: tệp trong repo. SMB: tệp không có trong repo → /__site3d/smb/<loại>.glb (bản thử tự cấp qua route của Playwright).
  listModels: projectId => Promise.resolve<SiteModels>(params.get('site3dModel') === '1' ? {
    architecture: { kind: 'architecture', path: `${projectId}/architecture.glb`, size: 13_881_148, updatedAt: '2026-10-17T03:00:00Z' },
    structure: { kind: 'structure', path: `${projectId}/structure.glb`, size: 1_097_808, updatedAt: '2026-10-17T03:00:00Z' },
  } : {}),
  fetchModel: (file, onProgress) => fetch(file.path.endsWith('d2/' + file.kind + '.glb') ? SITE3D_MODEL_URL[file.kind] : `/__site3d/smb/${file.kind}.glb`)
    .then(r => { if (!r.ok) throw new Error(`Không tải được mô hình (${r.status}).`); return r.arrayBuffer(); }).then(buffer => { onProgress?.(1); return buffer; }),
  uploadModel: (projectId: string, kind: SiteModelKind, file: File) => new Promise<void>(resolve => setTimeout(() => {
    site3dUploads[`${projectId}/${kind}`] = { name: file.name, size: file.size };
    (window as unknown as { __site3dUploads: typeof site3dUploads }).__site3dUploads = site3dUploads;
    resolve();
  }, 200)),
};

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
            onLogout={() => setLastRoute('logout')}
            mobileNotifications={<button type="button" className="vcc-iconbtn" aria-label="Thông báo"><Bell size={15} /></button>}
            canOpenRoute={route => !DENIED_ROUTES.has(route)}
            onNavigate={setLastRoute}
            now={params.get('defaults') === '1' ? undefined : NOW}
            // ?loader=app: như app thật — không truyền loadWorkItems (dùng nguồn mặc định).
            loadWorkItems={params.get('loader') === 'app' ? undefined : loadWorkItems}
            loadToday={loadToday}
            loadActions={loadActions}
            loadLayout={loadLayout}
            saveLayout={saveLayout}
            loadDashboard={loadDashboard}
            loadDashboardAccess={loadDashboardAccess}
            loadMaterialMoves={loadMaterialMoves}
            loadMetricDocs={loadMetricDocs}
            loadFlow={loadFlow}
            loadFlowAccess={loadFlowAccess}
            loadFlowItems={FLOW === 'noitems' ? undefined : loadFlowItems}
            remindFlow={FLOW === 'noitems' ? undefined : remindFlow}
            initialTab={params.get('view') === 'flow' ? 'flow' : params.get('view') === 'site3d' ? 'site3d' : null}
            site3d={site3dHooks}
            exposeSite3dDebug
            Renderer={StubRenderer}
            ModalHost={StubModalHost}
            assistant={assistantHooks}
          />
        </CenterEntrance>
      </main>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={['/center']}><Fixture /></MemoryRouter>);
