export const PROJECT_TAB_ROUTE_PREFIX = '/da/tabs/';
export const LEGACY_PROJECT_SUPPLY_ROUTE = '/da/tabs/supply';

export const PROJECT_TAB_PERMISSIONS = [
  { key: 'executive', label: 'Điều hành', icon: '🏛️', route: '/da/tabs/executive' },
  { key: 'org', label: 'Tổ chức', icon: '👥', route: '/da/tabs/org' },
  { key: 'budget', label: 'Ngân sách', icon: '📊', route: '/da/tabs/budget' },
  { key: 'cashflow', label: 'Dòng tiền', icon: '💰', route: '/da/tabs/cashflow' },
  { key: 'contract', label: 'Hợp đồng', icon: '📋', route: '/da/tabs/contract' },
  { key: 'gantt', label: 'Tiến độ', icon: '📐', route: '/da/tabs/gantt' },
  { key: 'weekly_progress', label: 'Chốt tiến độ', icon: '📅', route: '/da/tabs/weekly_progress' },
  { key: 'dailylog', label: 'Nhật ký', icon: '📝', route: '/da/tabs/dailylog' },
  { key: 'material', label: 'Vật tư', icon: '📦', route: '/da/tabs/material' },
  
  
  { key: 'quality', label: 'Chất lượng', icon: '✅', route: '/da/tabs/quality' },
  { key: 'safety', label: 'An toàn', icon: '🛡️', route: '/da/tabs/safety' },
  { key: 'subcontract', label: 'Nhà thầu', icon: '🏗️', route: '/da/tabs/subcontract' },
  
  { key: 'documents', label: 'Tài liệu', icon: '📎', route: '/da/tabs/documents' },
  { key: 'report', label: 'Báo cáo', icon: '📊', route: '/da/tabs/report' },
  { key: 'payment', label: 'Nghiệm thu & Thanh toán', icon: '💳', route: '/da/tabs/payment' },
] as const;

export type ProjectOverviewTabKey = typeof PROJECT_TAB_PERMISSIONS[number]['key'];
export type ProjectTabPermissionRoute = typeof PROJECT_TAB_PERMISSIONS[number]['route'];

export const PROJECT_TAB_ROUTES = PROJECT_TAB_PERMISSIONS.map(tab => tab.route);

export const PROJECT_TAB_ROUTE_BY_KEY = PROJECT_TAB_PERMISSIONS.reduce((acc, tab) => {
  acc[tab.key] = tab.route;
  return acc;
}, {} as Record<ProjectOverviewTabKey, ProjectTabPermissionRoute>);

export const PROJECT_MATERIAL_TAB_ROUTE_PREFIX = `${PROJECT_TAB_ROUTE_BY_KEY.material}/`;

export const PROJECT_MATERIAL_TAB_PERMISSIONS = [
  { key: 'summary', label: 'Tổng hợp', route: '/da/tabs/material/summary' },
  { key: 'boq', label: 'BOQ', route: '/da/tabs/material/boq' },
  { key: 'planning', label: 'Kế hoạch', route: '/da/tabs/material/planning' },
  { key: 'request', label: 'Yêu cầu', route: '/da/tabs/material/request' },
  { key: 'po', label: 'Đơn hàng PO', route: '/da/tabs/material/po' },
  { key: 'waste', label: 'Hao hụt', route: '/da/tabs/material/waste' },
  { key: 'dashboard', label: 'Dashboard', route: '/da/tabs/material/dashboard' },
] as const;

export type ProjectMaterialTabKey = typeof PROJECT_MATERIAL_TAB_PERMISSIONS[number]['key'];
export type ProjectMaterialTabPermissionRoute = typeof PROJECT_MATERIAL_TAB_PERMISSIONS[number]['route'];
export type ProjectMaterialTabPermissionMap = Record<ProjectMaterialTabKey, { canView: boolean; canManage: boolean }>;

export const PROJECT_MATERIAL_TAB_ROUTE_BY_KEY = PROJECT_MATERIAL_TAB_PERMISSIONS.reduce((acc, tab) => {
  acc[tab.key] = tab.route;
  return acc;
}, {} as Record<ProjectMaterialTabKey, ProjectMaterialTabPermissionRoute>);

export const isProjectOverviewTabKey = (value?: string | null): value is ProjectOverviewTabKey =>
  PROJECT_TAB_PERMISSIONS.some(tab => tab.key === value);

export const isProjectTabPermissionRoute = (route?: string | null): route is ProjectTabPermissionRoute =>
  Boolean(route && route.startsWith(PROJECT_TAB_ROUTE_PREFIX));

export const hasProjectTabPermissionRoute = (routes?: string[] | null) =>
  Array.isArray(routes) && routes.some(route => isProjectTabPermissionRoute(route));

export const isProjectMaterialTabPermissionRoute = (route?: string | null): route is ProjectMaterialTabPermissionRoute =>
  Boolean(route && route.startsWith(PROJECT_MATERIAL_TAB_ROUTE_PREFIX));

export const hasProjectMaterialTabPermissionRoute = (routes?: string[] | null) =>
  Array.isArray(routes) && routes.some(route =>
    route === PROJECT_TAB_ROUTE_BY_KEY.material ||
    route === LEGACY_PROJECT_SUPPLY_ROUTE ||
    isProjectMaterialTabPermissionRoute(route)
  );

export const getProjectAllowedSubModuleRedirect = (routes: string[]) => {
  if (routes.includes('/da') || hasProjectTabPermissionRoute(routes)) return '/da';
  return routes.find(route => !isProjectTabPermissionRoute(route)) || '/';
};
