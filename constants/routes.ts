
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
 *  - Route dynamic (/:id) → không đưa vào map, guard bỏ qua → page tự xử lý
 */
export const ROUTE_TO_MODULE: Record<string, string> = {
  // ── WMS ──────────────────────────────────────────────
  '/dashboard':    'WMS',
  '/requests':     'WMS',
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
  // /wf/builder/:id → dynamic, không guard ở đây

  // ── DỰ ÁN ────────────────────────────────────────────
  '/da':            'DA',
  '/da/portfolio':  'DA',

  // ── TÀI SẢN ──────────────────────────────────────────
  '/ts/dashboard':   'TS',
  '/ts/catalog':     'TS',
  '/ts/assignment':  'TS',
  '/ts/maintenance': 'TS',
  '/ts/audit':       'TS',
  '/ts/reports':     'TS',
  // /ts/asset/:id → dynamic, không guard ở đây

  // ── YÊU CẦU ──────────────────────────────────────────
  '/rq/dashboard':  'RQ',
  '/rq':            'RQ',
  '/rq/categories': 'RQ',

  // ── NGÂN SÁCH ─────────────────────────────────────────
  '/expense': 'EX',

  // ── EMPLOYEE PROFILE ──────────────────────────────────
  '/ep': 'EP',
  // /ep/:employeeId → dynamic, không guard ở đây

  // ── HỢP ĐỒNG ──────────────────────────────────────────
  '/hd/supplier':      'HD',
  '/hd/customer':      'HD',
  '/hd/subcontractor': 'HD',
};
