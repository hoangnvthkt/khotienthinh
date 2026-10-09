// Tính toán cho Bảng điều khiển: định dạng tiền kiểu "285,248 tỷ", tình trạng dự án, cộng dồn theo dự án / tháng,
// và dữ liệu bấm xuống (drill-down: bảng các dòng tạo nên một con số) / bấm sang (drill-through: mở màn gốc).

import type { CostCategory, DashGap, DashMonth, DashProject, DashProjectFinance, DashRecords, DashboardDataset, DashboardId } from './dashboardTypes';

// ── Định dạng ────────────────────────────────────────────────────────────────

const nf = (digits: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: digits, minimumFractionDigits: 0 });

/** Tiền đầy đủ: 1.258.869.411 */
export const money = (value: number | null | undefined): string => (value == null || Number.isNaN(value) ? '—' : nf(0).format(Math.round(value)));

/** Tiền gọn như ảnh mẫu: 285,248 tỷ · 200 triệu · 850.000 đ. */
export const shortMoney = (value: number | null | undefined): string => {
  if (value == null || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${nf(3).format(value / 1e12)} nghìn tỷ`;
  if (abs >= 1e9) return `${nf(3).format(value / 1e9)} tỷ`;
  if (abs >= 1e6) return `${nf(1).format(value / 1e6)} triệu`;
  return `${nf(0).format(value)} đ`;
};

/** Trục biểu đồ: 3,5 tỷ · 500 tr. */
export const axisMoney = (value: number): string => {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${nf(1).format(value / 1e9)} tỷ`;
  if (abs >= 1e6) return `${nf(0).format(value / 1e6)} tr`;
  return nf(0).format(value);
};

/** Số tròn trong vòng tiến độ: 1B · 496M. */
export const ringMoney = (value: number | null | undefined): string => {
  if (value == null) return '—';
  if (value >= 1e9) return `${nf(1).format(value / 1e9)} tỷ`;
  if (value >= 1e6) return `${nf(0).format(value / 1e6)} tr`;
  return nf(0).format(value);
};

export const pct = (value: number | null | undefined): string => (value == null ? '—' : `${nf(0).format(value)}%`);

export const viDate = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');

/** 2026-04 → 4/2026 */
export const monthLabel = (month: string): string => `${Number(month.slice(5, 7))}/${month.slice(0, 4)}`;

export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00`) - Date.parse(`${from.slice(0, 10)}T00:00:00`)) / 86_400_000);

/** 12 tháng gần nhất (yyyy-mm), cũ → mới. */
export const lastMonths = (today: string, count = 12): string[] => {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(year, month - (count - 1 - index), 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  });
};

// ── Tình trạng dự án ─────────────────────────────────────────────────────────

export type ProjectHealth = 'on_track' | 'late' | 'risk' | 'overdue' | 'done' | 'unknown';

export const HEALTH_LABEL: Record<ProjectHealth, string> = {
  on_track: 'Đúng tiến độ', late: 'Chậm trễ', risk: 'Rủi ro', overdue: 'Quá hạn', done: 'Hoàn thành', unknown: 'Chưa có tiến độ',
};

/** Chậm khi thực tế kém kế hoạch từ 10 điểm %; rủi ro khi chi phí vượt ngân sách hoặc vượt sản lượng thực hiện. */
export const LATE_GAP = 10;

export const projectHealth = (project: DashProject, today: string): ProjectHealth => {
  const actual = project.actualProgress;
  if (actual != null && actual >= 100) return 'done';
  if (project.end && today > project.end && (actual ?? 0) < 100) return 'overdue';
  if (actual != null && project.plannedProgress != null && project.plannedProgress - actual >= LATE_GAP) return 'late';
  const finance = project.finance;
  if (finance && ((finance.budget != null && finance.cost > finance.budget) || (finance.output != null && finance.output > 0 && finance.cost > finance.output * 1.05))) return 'risk';
  if (actual == null) return 'unknown';
  return 'on_track';
};

// ── Cộng dồn ─────────────────────────────────────────────────────────────────

export const CATEGORY_ORDER: CostCategory[] = ['materials', 'labor', 'machinery', 'subcontract', 'overhead', 'other'];
export const CATEGORY_LABEL: Record<CostCategory, string> = {
  materials: 'Chi phí vật liệu', labor: 'Chi phí nhân công', machinery: 'Chi phí máy thi công', subcontract: 'Chi phí thầu phụ',
  overhead: 'Chi phí quản lý chung', other: 'Chi phí khác',
};

/** Cộng một trường tài chính trên các dự án được xem; null nếu không dự án nào cho xem tài chính. */
export const sumFinance = (projects: readonly DashProject[], pick: (finance: DashProjectFinance) => number | null | undefined): number | null => {
  const visible = projects.filter(project => project.finance);
  if (!visible.length) return null;
  return visible.reduce((sum, project) => sum + (pick(project.finance as DashProjectFinance) ?? 0), 0);
};

export interface MonthTotals { month: string; revenue: number; cost: number; cashIn: number; cashOut: number; matIn: number; matOut: number }

export const monthTotals = (dataset: DashboardDataset, projectIds: ReadonlySet<string>): MonthTotals[] => {
  const months = lastMonths(dataset.today);
  return months.map(month => dataset.months
    .filter(row => row.month === month && projectIds.has(row.projectId))
    .reduce<MonthTotals>((sum, row) => ({
      month, revenue: sum.revenue + row.revenue, cost: sum.cost + row.cost, cashIn: sum.cashIn + row.cashIn,
      cashOut: sum.cashOut + row.cashOut, matIn: sum.matIn + row.matIn, matOut: sum.matOut + row.matOut,
    }), { month, revenue: 0, cost: 0, cashIn: 0, cashOut: 0, matIn: 0, matOut: 0 }));
};

export const costByCategory = (projects: readonly DashProject[]): Array<{ category: CostCategory; value: number }> =>
  CATEGORY_ORDER.map(category => ({ category, value: projects.reduce((sum, project) => sum + (project.finance?.costByCategory[category] ?? 0), 0) }))
    .filter(item => item.value > 0);

// ── Đích bấm sang (drill-through) ────────────────────────────────────────────

const query = (base: string, params: Record<string, string | null | undefined>): string => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value) search.set(key, value); });
  const encoded = search.toString();
  return encoded ? `${base}?${encoded}` : base;
};

export const ROUTES = {
  project: (id: string, tab?: string, extra: Record<string, string> = {}) => query('/da', { projectId: id, tab, ...extra }),
  projectFinance: (id: string) => query('/finance/project', { project: id }),
  receivables: '/finance/receivables',
  payables: '/finance/payables',
  subcontracts: '/finance/subcontracts',
  cost: '/finance/cost',
  reports: '/finance/reports',
  cash: '/finance/cash',
  overview: '/finance/overview',
  inventory: '/inventory',
  operations: '/operations',
  procurement: '/procurement',
  portfolio: '/da/portfolio',
  materialRequest: (projectId: string, requestId: string) => query('/da', { projectId, tab: 'material', materialTab: 'request', requestId }),
};

/** Tên tab khi mở màn gốc từ bảng. */
export const routeTitle = (route: string): string => {
  const path = route.split('?')[0];
  const params = new URLSearchParams(route.split('?')[1] || '');
  const titles: Record<string, string> = {
    '/finance/project': 'Tài chính dự án', '/finance/receivables': 'Phải thu', '/finance/payables': 'Phải trả', '/finance/subcontracts': 'Thầu phụ',
    '/finance/cost': 'Chi phí & ngân sách', '/finance/reports': 'Báo cáo tài chính', '/finance/cash': 'Thu chi & quỹ', '/finance/overview': 'Tổng quan tài chính',
    '/inventory': 'Tồn kho', '/operations': 'Phiếu kho', '/procurement': 'Mua hàng', '/da/portfolio': 'Đa dự án',
  };
  if (path === '/da') {
    const tab = params.get('tab');
    return tab === 'gantt' ? 'Tiến độ' : tab === 'material' ? (params.get('requestId') ? 'Đề xuất vật tư' : 'Vật tư dự án') : 'Dự án';
  }
  return titles[path] || 'Chi tiết';
};

// ── Bấm xuống (drill-down) ───────────────────────────────────────────────────

export type DrillCellKind = 'money' | 'pct' | 'text' | 'date' | 'number';
export interface DrillColumn { key: string; label: string; kind?: DrillCellKind }
export interface DrillRow { id: string; cells: Record<string, string | number | null>; route?: string }
export interface DrillDown {
  title: string;
  subtitle?: string;
  columns: DrillColumn[];
  rows: DrillRow[];
  /** Dòng tổng (cột tiền / số). */
  total?: Record<string, number | null>;
  /** Mở màn gốc của con số này. */
  through?: { label: string; route: string };
}

const projectCol: DrillColumn = { key: 'project', label: 'Dự án' };

/** Bảng các dự án tạo nên một con số tài chính, lớn trước. */
export const drillByProject = (
  title: string,
  projects: readonly DashProject[],
  pick: (finance: DashProjectFinance, project: DashProject) => number | null,
  options: { subtitle?: string; through?: DrillDown['through']; route?: (project: DashProject) => string; valueLabel?: string } = {},
): DrillDown => {
  const rows = projects
    .filter(project => project.finance)
    .map(project => ({ project, value: pick(project.finance as DashProjectFinance, project) }))
    .filter(item => item.value != null && Math.abs(item.value) > 0.5)
    .sort((a, b) => (b.value as number) - (a.value as number));
  return {
    title,
    subtitle: options.subtitle,
    columns: [projectCol, { key: 'value', label: options.valueLabel || 'Giá trị', kind: 'money' }],
    rows: rows.map(({ project, value }) => ({
      id: project.id,
      cells: { project: `${project.code} · ${project.name}`, value },
      route: options.route ? options.route(project) : ROUTES.projectFinance(project.id),
    })),
    total: { value: rows.reduce((sum, item) => sum + (item.value as number), 0) },
    through: options.through,
  };
};

/** Một tháng trên biểu đồ → các dự án đóng góp. */
export const drillMonth = (
  dataset: DashboardDataset,
  projects: readonly DashProject[],
  month: string,
  fields: Array<{ key: keyof Omit<DashMonth, 'month' | 'projectId'>; label: string }>,
  through?: DrillDown['through'],
): DrillDown => {
  const byId = new Map(projects.map(project => [project.id, project]));
  const rows = dataset.months
    .filter(row => row.month === month && byId.has(row.projectId) && fields.some(field => row[field.key] > 0.5))
    .map(row => {
      const project = byId.get(row.projectId) as DashProject;
      return {
        id: row.projectId,
        cells: { project: `${project.code} · ${project.name}`, ...Object.fromEntries(fields.map(field => [field.key, row[field.key]])) },
        route: ROUTES.projectFinance(project.id),
      };
    })
    .sort((a, b) => Number(b.cells[fields[0].key] ?? 0) - Number(a.cells[fields[0].key] ?? 0));
  return {
    title: `Tháng ${monthLabel(month)}`,
    subtitle: 'Theo dự án',
    columns: [projectCol, ...fields.map(field => ({ key: field.key, label: field.label, kind: 'money' as const }))],
    rows,
    total: Object.fromEntries(fields.map(field => [field.key, rows.reduce((sum, row) => sum + Number(row.cells[field.key] ?? 0), 0)])),
    through,
  };
};

// ── Quyền xem bảng ───────────────────────────────────────────────────────────

export const DASHBOARD_META: Record<DashboardId, { title: string; short: string; hint: string }> = {
  portfolio: { title: 'Quản lý tiến độ đa dự án', short: 'Tiến độ dự án', hint: 'Tiến độ kế hoạch – thực tế, ngân sách, thu chi từng công trình' },
  cashflow: { title: 'Tổng quan dòng tiền, chi phí dự án', short: 'Dòng tiền & chi phí', hint: 'Doanh thu, chi phí, lợi nhuận, công nợ 12 tháng gần nhất' },
  materials: { title: 'Báo cáo nhập / xuất vật tư', short: 'Vật tư', hint: 'Ngân sách vật tư, đã mua, nhập – xuất, nhu cầu cấp vật tư' },
  debt: { title: 'Báo cáo thu / chi, công nợ', short: 'Thu chi & công nợ', hint: 'Cơ cấu dòng thu, dòng chi, nợ phải thu – phải trả' },
};

// ── Dữ liệu còn thiếu ────────────────────────────────────────────────────────
// Mỗi chỉ số cần dữ liệu nguồn; thiếu thì con số sai hoặc "—". Bảng nhắc đúng chỗ cần bổ sung, bấm là mở màn đó.

export const GAP_META: Record<DashGap, { label: string; boards: DashboardId[]; route: (project: DashProject) => string }> = {
  dates: { label: 'Ngày bắt đầu / kết thúc dự án', boards: ['portfolio'], route: project => ROUTES.project(project.id) },
  director: { label: 'Giám đốc dự án', boards: ['portfolio'], route: project => ROUTES.project(project.id) },
  gantt: { label: 'Kế hoạch Gantt (tiến độ thực tế, sản lượng)', boards: ['portfolio', 'cashflow'], route: project => ROUTES.project(project.id, 'gantt') },
  baseline: { label: 'Chốt baseline tiến độ (tiến độ kế hoạch)', boards: ['portfolio'], route: project => ROUTES.project(project.id, 'gantt') },
  coords: { label: 'Tọa độ công trường (Cài đặt → Địa điểm chấm công)', boards: ['portfolio'], route: () => '/settings' },
  contract: { label: 'Hợp đồng chủ đầu tư (giá trị HĐ)', boards: ['portfolio', 'cashflow', 'debt'], route: project => ROUTES.projectFinance(project.id) },
  budget: { label: 'Ngân sách chi phí đã duyệt', boards: ['portfolio', 'cashflow'], route: () => ROUTES.cost },
  unclassified: { label: 'Chi phí chưa xếp khoản mục', boards: ['cashflow'], route: () => ROUTES.cost },
  ar_due: { label: 'Hạn thanh toán đợt thu CĐT (tuổi nợ)', boards: ['debt', 'cashflow'], route: () => ROUTES.receivables },
  ap_due: { label: 'Hạn thanh toán công nợ NCC, thầu phụ (tuổi nợ)', boards: ['debt', 'cashflow'], route: () => ROUTES.payables },
  material_budget: { label: 'Dự toán vật tư', boards: ['materials'], route: project => ROUTES.project(project.id, 'material', { materialTab: 'boq' }) },
  material_price: { label: 'Đơn giá dự toán vật tư', boards: ['materials'], route: project => ROUTES.project(project.id, 'material', { materialTab: 'boq' }) },
};

/** Dự án thiếu dữ liệu cho một bảng: mỗi dòng một dự án, liệt kê thứ còn thiếu, bấm mở màn của thứ đầu tiên. */
export const gapsFor = (board: DashboardId, projects: readonly DashProject[]): DrillDown => {
  const rows = projects
    .map(project => ({ project, gaps: (project.gaps || []).filter(gap => GAP_META[gap]?.boards.includes(board)) }))
    .filter(row => row.gaps.length > 0)
    .sort((a, b) => b.gaps.length - a.gaps.length || a.project.code.localeCompare(b.project.code));
  return {
    title: 'Dữ liệu còn thiếu',
    subtitle: 'Bổ sung để bảng tính đủ. Bấm một dòng để mở màn cần bổ sung.',
    columns: [projectCol, { key: 'missing', label: 'Còn thiếu' }],
    rows: rows.map(({ project, gaps }) => ({
      id: project.id, route: GAP_META[gaps[0]].route(project),
      cells: { project: `${project.code} · ${project.name}`, missing: gaps.map(gap => GAP_META[gap].label).join(' · ') },
    })),
  };
};

// ── Chưa có dữ liệu ──────────────────────────────────────────────────────────
// Không có chứng từ nào thì không vẽ số 0 (dễ đọc thành "không nợ", "không chi") — hiện "Chưa có dữ liệu".

export const NO_DATA = 'Chưa có dữ liệu';

/** Số chứng từ của các dự án được xem tiền; null khi không dự án nào được xem tiền. */
export const recordCount = (projects: readonly DashProject[], key: keyof DashRecords): number | null => {
  const visible = projects.filter(project => project.finance);
  return visible.length ? visible.reduce((sum, project) => sum + (project.finance!.records?.[key] ?? 0), 0) : null;
};
