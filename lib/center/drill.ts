import { buildRequestRoute } from '../requestRoutes';
import { CENTER_MODULES, type CenterModuleKey, type RendererId } from './centerRegistry';
import type { WorkItem } from './workItemsService';

// Hợp đồng drill-down (kế hoạch 07 mục 3): mỗi việc mở đúng hồ sơ — nhúng view thật khi
// module đã tách được (tab), còn lại mở màn module với đúng id / bộ lọc (route). Không có ngõ cụt.
export type ItemDrillTarget =
  | { kind: 'tab'; renderer: RendererId; props: Record<string, string>; title: string; route: string }
  | { kind: 'route'; path: string; title: string };
/** Widget còn có đích "Việc của tôi" (lọc theo module) — mở cột việc thay vì rời Center. */
export type DrillTarget = ItemDrillTarget | { kind: 'inbox'; title: string; module?: CenterModuleKey };

const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : typeof value === 'number' ? String(value) : null);

const query = (base: string, params: Record<string, string | null | undefined>): string => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value) search.set(key, value); });
  const encoded = search.toString();
  return encoded ? `${base}?${encoded}` : base;
};

/** Màn module đầy đủ của một việc ("Mở ở màn … ↗"). */
export const moduleRouteFor = (item: WorkItem): string => {
  const ref = item.ref;
  switch (item.source) {
    case 'rq': return buildRequestRoute(str(ref.requestId) || item.id);
    case 'mr': return ref.requestOrigin === 'project' && str(ref.projectId)
      ? query('/da', { projectId: str(ref.projectId), tab: 'material', materialTab: 'request', requestId: str(ref.requestId) || item.id })
      : '/requests';
    case 'wms_tx':
    case 'stock_count': return item.source === 'stock_count' ? '/audit' : '/operations';
    case 'daily_log': return query('/da', { projectId: str(ref.projectId), tab: 'dailylog', dailyLogId: str(ref.dailyLogId) || item.id });
    case 'daily_slip': return query('/da', { projectId: str(ref.projectId), tab: 'dailylog' });
    case 'work_plan': return query('/da', { projectId: str(ref.projectId), tab: 'work_plan', period: str(ref.periodType), start: str(ref.periodStart) });
    case 'po':
    case 'po_delivery':
    case 'reconciliation': return query('/procurement', { po: str(ref.poId) });
    case 'hot': return query('/procurement', { hp: str(ref.hotPurchaseId) || item.id });
    case 'fin_payment': return query('/finance/requests', { request: str(ref.requestId) || item.id });
    case 'fin_site_expense': return '/finance/cash';
    case 'fin_fund_opening': return '/finance/project';
    case 'leave': return query('/hrm/leave', { request: str(ref.requestId) || item.id });
    case 'makeup': return query('/hrm/attendance', { tab: 'proposals', proposal: str(ref.proposalId) || item.id });
    case 'site_assignment': return query('/hrm/assignments', { id: str(ref.assignmentId) || item.id });
    case 'timesheet': return query('/hrm/timesheet', { year: str(ref.year), month: str(ref.month) });
    case 'profile_change': return '/hrm/employees';
    case 'office': return `/office/documents/${encodeURIComponent(str(ref.documentId) || item.id)}`;
    case 'work': return `/work/tasks/${encodeURIComponent(str(ref.taskCode) || item.code)}`;
    case 'vehicle': return '/booking/vehicle/approvals';
    default: return CENTER_MODULES[item.module].route;
  }
};

/** Màn module chạy được ngay trong tab Center (khớp EMBED_ROUTES ở components/center/CenterRenderers.tsx). */
const EMBEDDABLE = [/^\/hrm\/(leave|attendance|timesheet|employees)(\?|$)/, /^\/da(\?|$)/, /^\/(requests|operations|audit)(\?|$)/,
  /^\/finance(\/[\w-]+)?(\?|$)/, /^\/office\//, /^\/work\/tasks\/[^/?]+(\?|$)/, /^\/booking\/vehicle(\/|$)/];
export const isEmbeddableRoute = (path: string): boolean => EMBEDDABLE.some(pattern => pattern.test(path));

/** Bấm việc → mở ngay màn xử lý trong tab: view đã tách, không thì trang module chạy trong tab. */
export const resolveDrillTarget = (item: WorkItem): ItemDrillTarget => {
  const ref = item.ref;
  const route = moduleRouteFor(item);
  const tab = (renderer: RendererId, props: Record<string, string>): ItemDrillTarget => ({ kind: 'tab', renderer, props, title: item.code, route });
  switch (item.source) {
    case 'rq': return tab('request', { requestId: str(ref.requestId) || item.id });
    case 'po':
    case 'po_delivery':
    case 'reconciliation': {
      const poId = str(ref.poId);
      return tab('procurement', poId ? { initialOrderId: poId } : {});
    }
    case 'hot': return tab('procurement', { initialHotPurchaseId: str(ref.hotPurchaseId) || item.id });
    case 'fin_payment': return tab('finance', { initialSection: 'requests', initialRequestId: str(ref.requestId) || item.id });
    case 'site_assignment': return tab('site_assignment', { initialSelectedId: str(ref.assignmentId) || item.id });
    default: return isEmbeddableRoute(route) ? tab('route', { path: route }) : { kind: 'route', path: route, title: item.code };
  }
};
