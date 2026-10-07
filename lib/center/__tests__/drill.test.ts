import { describe, expect, it } from 'vitest';
import { isEmbeddableRoute, moduleRouteFor, resolveDrillTarget } from '../drill';
import { CENTER_MODULES } from '../centerRegistry';
import type { WorkItem, WorkItemSource } from '../workItemsService';
import { getRouteModuleKey, isAuthenticatedOpenRoute, normalizeRoutePath } from '../../routeAccess';

const base = (source: WorkItemSource, module: WorkItem['module'], ref: Record<string, unknown>): WorkItem => ({
  source, module, kind: 'approve', id: 'id-1', code: 'CODE-1', title: 'Hồ sơ', who: null, whoId: null, meta: null, dueAt: null, status: null, ref,
});

// Mỗi nguồn của vcc_my_work_items_v1 mở ngay màn xử lý trong tab (view đã tách hoặc trang module chạy trong tab),
// và route module vẫn tồn tại cho "Mở ở màn … ↗" (hợp đồng drill-down, kế hoạch 07 mục 3).
const SAMPLES: Array<[WorkItem, 'tab', string]> = [
  [base('rq', 'request', { requestId: 'rq-1' }), 'tab', '/rq/rq-1'],
  [base('mr', 'project', { requestId: 'mr-1', projectId: 'p1', requestOrigin: 'project' }), 'tab', '/da?projectId=p1&tab=material&materialTab=request&requestId=mr-1'],
  [base('mr', 'warehouse', { requestId: 'mr-2', requestOrigin: 'wms' }), 'tab', '/requests'],
  [base('wms_tx', 'warehouse', { transactionId: 'tx' }), 'tab', '/operations'],
  [base('daily_log', 'project', { dailyLogId: 'dl', projectId: 'p1' }), 'tab', '/da?projectId=p1&tab=dailylog&dailyLogId=dl'],
  [base('daily_slip', 'project', { projectId: 'p1' }), 'tab', '/da?projectId=p1&tab=dailylog'],
  [base('work_plan', 'project', { planId: 'w', projectId: 'p1', periodType: 'week', periodStart: '2026-10-06' }), 'tab', '/da?projectId=p1&tab=work_plan&period=week&start=2026-10-06'],
  [base('po', 'procurement', { poId: 'po-1' }), 'tab', '/procurement?po=po-1'],
  [base('po_delivery', 'procurement', { poId: 'po-1', deliveryId: 'b' }), 'tab', '/procurement?po=po-1'],
  [base('hot', 'procurement', { hotPurchaseId: 'hp-1' }), 'tab', '/procurement?hp=hp-1'],
  [base('reconciliation', 'procurement', { poId: 'po-1', reconciliationId: 'r' }), 'tab', '/procurement?po=po-1'],
  [base('fin_payment', 'finance', { requestId: 'dnc-1' }), 'tab', '/finance/requests?request=dnc-1'],
  [base('fin_site_expense', 'finance', { expenseId: 'x' }), 'tab', '/finance/cash'],
  [base('fin_fund_opening', 'finance', { openingId: 'o' }), 'tab', '/finance/project'],
  [base('leave', 'hrm', { requestId: 'np-1' }), 'tab', '/hrm/leave?request=np-1'],
  [base('makeup', 'hrm', { proposalId: 'a' }), 'tab', '/hrm/attendance?tab=proposals&proposal=a'],
  [base('site_assignment', 'hrm', { assignmentId: 'sa-1' }), 'tab', '/hrm/assignments?id=sa-1'],
  [base('timesheet', 'hrm', { year: 2026, month: 10 }), 'tab', '/hrm/timesheet?year=2026&month=10'],
  [base('profile_change', 'hrm', { changeId: 'c' }), 'tab', '/hrm/employees'],
  [base('office', 'office', { documentId: 'doc-1' }), 'tab', '/office/documents/doc-1'],
  [base('work', 'work', { taskCode: 'VW-2026-000001' }), 'tab', '/work/tasks/VW-2026-000001'],
  [base('vehicle', 'vehicle', { bookingId: 'b' }), 'tab', '/booking/vehicle/approvals'],
  [base('stock_count', 'warehouse', { countId: 'c' }), 'tab', '/audit'],
];

describe('Command Center drill-down', () => {
  it.each(SAMPLES.map(([item, kind, route]) => [item.source, kind, route, item]))('%s → %s %s', (_source, kind, route, item) => {
    const target = resolveDrillTarget(item as WorkItem);
    expect(target.kind).toBe(kind);
    expect(moduleRouteFor(item as WorkItem)).toBe(route);
    expect(target.kind === 'tab' ? target.route : target.path).toBe(route);
    expect(target.title).toBe('CODE-1');
    // Không còn bước "Mở ở màn …": nguồn chưa tách view thì chạy đúng trang module (cùng id / bộ lọc) trong tab.
    if (target.kind === 'tab' && target.renderer === 'route') expect(target.props.path).toBe(route);
  });

  it('never points at a route the app cannot open', () => {
    for (const [item] of SAMPLES) {
      const path = normalizeRoutePath(moduleRouteFor(item));
      expect(Boolean(getRouteModuleKey(path)) || isAuthenticatedOpenRoute(path), path).toBe(true);
    }
    for (const module of Object.values(CENTER_MODULES)) {
      expect(Boolean(getRouteModuleKey(module.route)) || isAuthenticatedOpenRoute(module.route), module.route).toBe(true);
    }
  });

  it('opens the procurement hub in the tab when a PO reference is missing', () => {
    const target = resolveDrillTarget(base('po_delivery', 'procurement', {}));
    expect(target).toMatchObject({ kind: 'tab', renderer: 'procurement', props: {}, route: '/procurement' });
  });

  it('only embeds module pages the Center can run in a tab', () => {
    expect(isEmbeddableRoute('/hrm/leave?request=1')).toBe(true);
    expect(isEmbeddableRoute('/work/tasks/VW-1')).toBe(true);
    expect(isEmbeddableRoute('/booking/vehicle/approvals')).toBe(true);
    expect(isEmbeddableRoute('/hrm/payroll')).toBe(false);
    expect(isEmbeddableRoute('/dashboard')).toBe(false);
    expect(isEmbeddableRoute('/da/portfolio')).toBe(false);
  });

  it('encodes ids in paths', () => {
    expect(moduleRouteFor(base('office', 'office', { documentId: 'a b/c' }))).toBe('/office/documents/a%20b%2Fc');
    expect(moduleRouteFor(base('rq', 'request', { requestId: 'x y' }))).toBe('/rq/x%20y');
  });
});
