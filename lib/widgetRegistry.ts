// ══════════════════════════════════════════
//  WIDGET REGISTRY — Type definitions & catalog
// ══════════════════════════════════════════

export type WidgetType = 
  | 'kpi_card' 
  | 'line_chart' 
  | 'bar_chart' 
  | 'pie_chart' 
  | 'data_table' 
  | 'alert_list' 
  | 'activity_feed'
  | 'ai_insight'
  | 'xp_leaderboard'
  | 'smart_alerts';

export interface WidgetConfig {
  id: string;
  type: WidgetType;
  title: string;
  // Grid position (CSS Grid)
  col: number; // 1-based column start
  row: number; // 1-based row start
  colSpan: number; // columns to span
  rowSpan: number; // rows to span
  // Widget-specific config
  metric?: string; // for KPI: 'totalInventory', 'lowStock', etc.
  dataSource?: string; // for charts: 'inventoryByCategory', etc.
  limit?: number; // for tables/lists: max items
}

export interface DashboardLayout {
  id: string;
  userId: string;
  name: string;
  layout: WidgetConfig[];
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

// ═════════ Widget Catalog ═════════

export interface WidgetCatalogItem {
  type: WidgetType;
  label: string;
  icon: string;
  description: string;
  defaultColSpan: number;
  defaultRowSpan: number;
  category: 'kpi' | 'chart' | 'data' | 'ai';
}

export const WIDGET_CATALOG: WidgetCatalogItem[] = [
  { type: 'kpi_card', label: 'KPI Card', icon: '📊', description: 'Thẻ KPI hiển thị 1 chỉ số', defaultColSpan: 1, defaultRowSpan: 1, category: 'kpi' },
  { type: 'bar_chart', label: 'Biểu đồ cột', icon: '📊', description: 'Biểu đồ bar/column chart', defaultColSpan: 2, defaultRowSpan: 2, category: 'chart' },
  { type: 'line_chart', label: 'Biểu đồ đường', icon: '📈', description: 'Biểu đồ trend theo thời gian', defaultColSpan: 2, defaultRowSpan: 2, category: 'chart' },
  { type: 'pie_chart', label: 'Biểu đồ tròn', icon: '🥧', description: 'Biểu đồ phân bổ %', defaultColSpan: 1, defaultRowSpan: 2, category: 'chart' },
  { type: 'data_table', label: 'Bảng dữ liệu', icon: '📋', description: 'Top N items, phiếu chờ, etc.', defaultColSpan: 2, defaultRowSpan: 2, category: 'data' },
  { type: 'alert_list', label: 'Cảnh báo', icon: '🚨', description: 'Danh sách cảnh báo thông minh', defaultColSpan: 1, defaultRowSpan: 2, category: 'data' },
  { type: 'activity_feed', label: 'Hoạt động', icon: '📰', description: 'Feed hoạt động gần đây', defaultColSpan: 1, defaultRowSpan: 2, category: 'data' },
  { type: 'ai_insight', label: 'AI Insight', icon: '🤖', description: 'Phân tích thông minh từ AI', defaultColSpan: 2, defaultRowSpan: 1, category: 'ai' },
  { type: 'xp_leaderboard', label: 'Bảng xếp hạng XP', icon: '🏆', description: 'Top nhân viên XP cao nhất', defaultColSpan: 2, defaultRowSpan: 2, category: 'data' },
  { type: 'smart_alerts', label: 'Cảnh báo thông minh', icon: '🚨', description: 'Tự động quét & cảnh báo bất thường', defaultColSpan: 2, defaultRowSpan: 2, category: 'data' },
];

// ═════════ KPI Metrics Catalog ═════════

export interface KPIMetric {
  id: string;
  label: string;
  module: string;
  icon: string;
  color: string;
}

export const KPI_METRICS: KPIMetric[] = [
  { id: 'totalInventory', label: 'Tổng vật tư', module: 'WMS', icon: '📦', color: 'from-blue-500 to-cyan-500' },
  { id: 'lowStock', label: 'Dưới tồn kho tối thiểu', module: 'WMS', icon: '⚠️', color: 'from-amber-500 to-orange-500' },
  { id: 'totalValue', label: 'Giá trị tồn kho', module: 'WMS', icon: '💰', color: 'from-emerald-500 to-green-500' },
  { id: 'pendingRequests', label: 'Phiếu chờ duyệt', module: 'WMS', icon: '📝', color: 'from-purple-500 to-violet-500' },
  { id: 'totalEmployees', label: 'Tổng nhân sự', module: 'HRM', icon: '👥', color: 'from-indigo-500 to-blue-500' },
  { id: 'activeProjects', label: 'Dự án đang triển khai', module: 'DA', icon: '🏗️', color: 'from-teal-500 to-cyan-500' },
  { id: 'totalAssets', label: 'Tổng tài sản', module: 'TS', icon: '🖥️', color: 'from-pink-500 to-rose-500' },
  { id: 'pendingWorkflows', label: 'Quy trình chờ xử lý', module: 'WF', icon: '⏳', color: 'from-yellow-500 to-amber-500' },
];

// ═════════ Chart Data Sources ═════════

export interface ChartDataSource {
  id: string;
  label: string;
  module: string;
}

export const CHART_DATA_SOURCES: ChartDataSource[] = [
  { id: 'inventoryByCategory', label: 'Tồn kho theo danh mục', module: 'WMS' },
  { id: 'inventoryByWarehouse', label: 'Tồn kho theo kho', module: 'WMS' },
  { id: 'transactionsLastWeek', label: 'Giao dịch 7 ngày', module: 'WMS' },
  { id: 'requestsByStatus', label: 'Phiếu theo trạng thái', module: 'WMS' },
  { id: 'employeesByDepartment', label: 'Nhân sự theo phòng ban', module: 'HRM' },
  { id: 'projectBudgetUsage', label: 'Sử dụng ngân sách DA', module: 'DA' },
];

// ═════════ Default Layout ═════════

export const DEFAULT_LAYOUT: WidgetConfig[] = [
  { id: 'w1', type: 'kpi_card', title: 'Tổng vật tư', col: 1, row: 1, colSpan: 1, rowSpan: 1, metric: 'totalInventory' },
  { id: 'w2', type: 'kpi_card', title: 'Cảnh báo tồn kho', col: 2, row: 1, colSpan: 1, rowSpan: 1, metric: 'lowStock' },
  { id: 'w3', type: 'kpi_card', title: 'Giá trị tồn kho', col: 3, row: 1, colSpan: 1, rowSpan: 1, metric: 'totalValue' },
  { id: 'w4', type: 'kpi_card', title: 'Phiếu chờ duyệt', col: 4, row: 1, colSpan: 1, rowSpan: 1, metric: 'pendingRequests' },
  { id: 'w5', type: 'bar_chart', title: 'Tồn kho theo danh mục', col: 1, row: 2, colSpan: 3, rowSpan: 2, dataSource: 'inventoryByCategory' },
  { id: 'w6', type: 'alert_list', title: 'Cảnh báo thông minh', col: 4, row: 2, colSpan: 1, rowSpan: 2, limit: 5 },
  { id: 'w7', type: 'activity_feed', title: 'Hoạt động gần đây', col: 1, row: 4, colSpan: 2, rowSpan: 2, limit: 8 },
  { id: 'w8', type: 'data_table', title: 'Tồn kho thấp nhất', col: 3, row: 4, colSpan: 2, rowSpan: 2, dataSource: 'lowStockItems', limit: 5 },
];
