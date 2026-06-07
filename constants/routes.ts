
import { PROJECT_TAB_PERMISSIONS } from '../lib/projectTabPermissions';

/**
 * ROUTE_TO_MODULE — Single source of truth.
 * Map: route pathname → module key
 *
 * Dùng tại:
 *  - App.tsx (SubModuleGuard)
 *  - hooks/usePermission.ts (canManage)
 *
 * Quy tắc:
 *  - Route nào không có trong map → guard bỏ qua (allow all)
 *  - Route dynamic dùng pattern của react-router-dom matchPath
 */
export const ROUTE_TO_MODULE: Record<string, string> = {
  // ── WMS ──────────────────────────────────────────────
  '/dashboard':    'WMS',
  '/requests':     'WMS',
  '/material-code-requests': 'WMS',
  '/inventory':    'WMS',
  '/operations':   'WMS',
  '/audit':        'WMS',
  '/reports':      'WMS',
  '/misa-export':  'WMS',

  // ── HRM ──────────────────────────────────────────────
  '/hrm/dashboard':   'HRM',
  '/hrm/checkin':     'HRM',
  '/hrm/employees':   'HRM',
  '/hrm/attendance':  'HRM',
  '/hrm/shifts':      'HRM',
  '/hrm/leave':       'HRM',
  '/hrm/payroll':     'HRM',
  '/hrm/contracts':   'HRM',
  '/hrm/documents':   'HRM',
  '/hrm/reports':     'HRM',
  '/hrm/ranking':     'HRM',

  // ── WORKFLOW ──────────────────────────────────────────
  '/wf/dashboard':  'WF',
  '/wf':            'WF',
  '/wf/templates':  'WF',
  '/wf/builder/:id': 'WF',

  // ── DỰ ÁN ────────────────────────────────────────────
  '/da':            'DA',
  '/da/portfolio':  'DA',
  ...Object.fromEntries(PROJECT_TAB_PERMISSIONS.map(tab => [tab.route, 'DA'])),

  // ── TÀI SẢN ──────────────────────────────────────────
  '/ts/dashboard':   'TS',
  '/ts/catalog':     'TS',
  '/ts/assignment':  'TS',
  '/ts/maintenance': 'TS',
  '/ts/audit':       'TS',
  '/ts/reports':     'TS',
  '/ts/asset/:id':   'TS',

  // ── YÊU CẦU ──────────────────────────────────────────
  '/rq/dashboard':  'RQ',
  '/rq':            'RQ',
  '/rq/categories': 'RQ',

  // ── NGÂN SÁCH ─────────────────────────────────────────
  '/expense': 'EX',

  // ── EMPLOYEE PROFILE ──────────────────────────────────
  '/ep': 'EP',
  '/ep/:employeeId': 'EP',

  // ── HỢP ĐỒNG ──────────────────────────────────────────
  '/hd/overview':      'HD',
  '/hd/partners':      'HD',
  '/hd/contract-types': 'HD',
  '/hd/catalogs':      'HD',
  '/hd/supplier':      'HD',
  '/hd/customer':      'HD',
  '/hd/customer/:id':  'HD',
  '/hd/subcontractor': 'HD',
  '/hd/subcontractor/:id': 'HD',

  // ── ROUTE NHẠY CẢM / MODULE BỔ SUNG ───────────────────
  '/settings': 'SETTINGS',
  '/users': 'SETTINGS',
  '/storage': 'STORAGE',
  '/knowledge-base': 'KB',
  '/ai': 'AI',
  '/ai/executive': 'AI',
  '/ai/reports': 'AI',
  '/audit-trail': 'AUDIT_TRAIL',
  '/analytics': 'ANALYTICS',
  '/custom-dashboard': 'CUSTOM_DASHBOARD',
  '/org-map': 'HRM',
};
