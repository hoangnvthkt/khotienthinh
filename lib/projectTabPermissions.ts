export const PROJECT_TAB_ROUTE_PREFIX = '/da/tabs/';
export const LEGACY_PROJECT_SUPPLY_ROUTE = '/da/tabs/supply';

export const PROJECT_TAB_PERMISSIONS = [
  { key: 'executive', label: 'Điều hành', icon: '🏛️', route: '/da/tabs/executive' },
  { key: 'org', label: 'Tổ chức', icon: '👥', route: '/da/tabs/org' },
  { key: 'budget', label: 'Ngân sách', icon: '📊', route: '/da/tabs/budget' },
  { key: 'cashflow', label: 'Dòng tiền', icon: '💰', route: '/da/tabs/cashflow' },
  { key: 'contract', label: 'Hợp đồng', icon: '📋', route: '/da/tabs/contract' },
  { key: 'gantt', label: 'Tiến độ', icon: '📐', route: '/da/tabs/gantt' },
  { key: 'dailylog', label: 'Nhật ký', icon: '📝', route: '/da/tabs/dailylog' },
  { key: 'subcontract', label: 'Nhà thầu', icon: '🏗️', route: '/da/tabs/subcontract' },
  { key: 'material', label: 'Vật tư', icon: '📦', route: '/da/tabs/material' },
  { key: 'documents', label: 'Tài liệu', icon: '📎', route: '/da/tabs/documents' },
  { key: 'report', label: 'Báo cáo', icon: '📊', route: '/da/tabs/report' },
] as const;

export type ProjectOverviewTabKey = typeof PROJECT_TAB_PERMISSIONS[number]['key'];
export type ProjectTabPermissionRoute = typeof PROJECT_TAB_PERMISSIONS[number]['route'];

export const PROJECT_TAB_ROUTES = PROJECT_TAB_PERMISSIONS.map(tab => tab.route);

export const PROJECT_TAB_ROUTE_BY_KEY = PROJECT_TAB_PERMISSIONS.reduce((acc, tab) => {
  acc[tab.key] = tab.route;
  return acc;
}, {} as Record<ProjectOverviewTabKey, ProjectTabPermissionRoute>);

export const isProjectOverviewTabKey = (value?: string | null): value is ProjectOverviewTabKey =>
  PROJECT_TAB_PERMISSIONS.some(tab => tab.key === value);

export const isProjectTabPermissionRoute = (route?: string | null): route is ProjectTabPermissionRoute =>
  Boolean(route && route.startsWith(PROJECT_TAB_ROUTE_PREFIX));

export const hasProjectTabPermissionRoute = (routes?: string[] | null) =>
  Array.isArray(routes) && routes.some(route => isProjectTabPermissionRoute(route));

export const getProjectAllowedSubModuleRedirect = (routes: string[]) => {
  if (routes.includes('/da') || hasProjectTabPermissionRoute(routes)) return '/da';
  return routes.find(route => !isProjectTabPermissionRoute(route)) || '/';
};
