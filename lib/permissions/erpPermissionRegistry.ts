import {
  PermissionActionDefinition,
  PermissionApplicationDefinition,
  PermissionModuleDefinition,
  PermissionScopeType,
} from './permissionTypes';

const GLOBAL_SCOPE: readonly PermissionScopeType[] = ['global'];
const WMS_SCOPE: readonly PermissionScopeType[] = ['global', 'warehouse', 'own', 'assigned'];
const WMS_RECONCILIATION_SCOPE: readonly PermissionScopeType[] = ['global', 'warehouse'];
const HRM_SCOPE: readonly PermissionScopeType[] = ['global', 'own', 'department', 'assigned'];
const EXPENSE_SCOPE: readonly PermissionScopeType[] = ['global', 'own', 'department'];
const WORKFLOW_SCOPE: readonly PermissionScopeType[] = ['global', 'own', 'assigned'];
const ASSET_SCOPE: readonly PermissionScopeType[] = ['global', 'warehouse', 'department', 'assigned'];

type ActionTuple = readonly [string, string, number] | readonly [string, string, number, readonly PermissionScopeType[]];

const actions = (
  prefix: string,
  legacyModuleKey: string,
  legacyRoute: string | undefined,
  scopeTypes: readonly PermissionScopeType[],
  entries: readonly ActionTuple[],
): readonly PermissionActionDefinition[] =>
  entries.map(([action, label, sortOrder, actionScopes]) => ({
    action,
    label,
    permissionCode: `${prefix}.${action}`,
    legacyModuleKey,
    legacyRoute,
    legacyAdminOnly: !action.startsWith('view') && action !== 'use',
    scopeTypes: actionScopes || scopeTypes,
    sortOrder,
  }));

const module = (
  code: string,
  label: string,
  legacyModuleKey: string,
  routes: readonly string[],
  sortOrder: number,
  moduleActions: readonly PermissionActionDefinition[],
): PermissionModuleDefinition => ({
  code,
  label,
  routes,
  legacyModuleKey,
  sortOrder,
  actions: moduleActions,
});

export const ERP_PERMISSION_APPLICATIONS: readonly PermissionApplicationDefinition[] = [
  {
    code: 'wms',
    label: 'Kho vật tư',
    sortOrder: 30,
    modules: [
      module('wms.inventory', 'Tồn kho', 'WMS', ['/dashboard', '/inventory'], 10, actions('wms.inventory', 'WMS', '/inventory', WMS_SCOPE, [
        ['view', 'Xem', 10],
        ['edit', 'Sửa', 20],
      ])),
      module('wms.request', 'Đề xuất vật tư', 'WMS', ['/requests', '/material-code-requests'], 20, actions('wms.request', 'WMS', '/requests', WMS_SCOPE, [
        ['view', 'Xem', 10],
        ['create', 'Tạo', 20],
        ['approve', 'Duyệt', 30],
        ['export', 'Xuất kho', 40],
        ['receive', 'Nhận kho', 50],
      ])),
      module('wms.transaction', 'Giao dịch kho', 'WMS', ['/operations', '/audit', '/reports', '/misa-export'], 30, actions('wms.transaction', 'WMS', '/operations', WMS_SCOPE, [
        ['view', 'Xem', 10],
        ['create', 'Tạo', 20],
        ['approve', 'Duyệt', 30],
        ['complete', 'Hoàn tất', 40],
      ])),
      module('wms.reconciliation', 'Đối soát tồn kho', 'WMS', ['/wms/reconciliation'], 35, actions('wms.reconciliation', 'WMS', '/wms/reconciliation', WMS_RECONCILIATION_SCOPE, [
        ['view', 'Xem', 10],
        ['generate', 'Tạo run', 20],
        ['approve_cache', 'Duyệt sửa cache', 30],
        ['approve_business', 'Duyệt nghiệp vụ', 40],
        ['apply', 'Áp dụng', 50],
        ['rollback', 'Hoàn tác', 60],
      ])),
      module('wms.master_data', 'Danh mục kho', 'WMS', [], 40, actions('wms.master_data', 'WMS', undefined, WMS_SCOPE, [
        ['manage', 'Quản trị danh mục', 10],
      ])),
    ],
  },
  {
    code: 'hrm',
    label: 'Nhân sự',
    sortOrder: 40,
    modules: [
      module('hrm.employee', 'Nhân viên', 'HRM', ['/hrm/dashboard', '/hrm/employees', '/org-map'], 10, actions('hrm.employee', 'HRM', '/hrm/employees', HRM_SCOPE, [
        ['view', 'Xem', 10],
        ['create', 'Tạo', 20],
        ['edit', 'Sửa', 30],
      ])),
      module('hrm.attendance', 'Chấm công', 'HRM', ['/hrm/checkin', '/hrm/attendance'], 20, actions('hrm.attendance', 'HRM', '/hrm/attendance', HRM_SCOPE, [
        ['view', 'Xem', 10],
        ['edit', 'Sửa', 20],
      ])),
      module('hrm.leave', 'Nghỉ phép', 'HRM', ['/hrm/leave'], 30, actions('hrm.leave', 'HRM', '/hrm/leave', HRM_SCOPE, [
        ['view', 'Xem', 10],
        ['approve', 'Duyệt nghỉ phép', 20],
      ])),
      module('hrm.payroll', 'Bảng lương', 'HRM', ['/hrm/payroll'], 40, actions('hrm.payroll', 'HRM', '/hrm/payroll', HRM_SCOPE, [
        ['view', 'Xem', 10],
        ['manage', 'Quản trị', 20],
      ])),
      module('hrm.master_data', 'Danh mục nhân sự', 'HRM', ['/hrm/shifts', '/hrm/contracts', '/hrm/documents', '/hrm/reports', '/hrm/ranking'], 50, actions('hrm.master_data', 'HRM', '/hrm/shifts', HRM_SCOPE, [
        ['view', 'Xem', 10],
        ['manage', 'Quản trị danh mục', 20],
      ])),
    ],
  },
  {
    code: 'expense',
    label: 'Ngân sách',
    sortOrder: 50,
    modules: [
      module('expense.budget', 'Ngân sách', 'EX', ['/expense'], 10, actions('expense.budget', 'EX', '/expense', EXPENSE_SCOPE, [
        ['view', 'Xem', 10],
        ['create', 'Tạo', 20],
        ['edit_all', 'Sửa tất cả', 30],
      ])),
      module('expense.expense_record', 'Ghi nhận chi phí', 'EX', ['/expense'], 20, actions('expense.expense_record', 'EX', '/expense', EXPENSE_SCOPE, [
        ['view_own', 'Xem của mình', 10],
        ['view_all', 'Xem tất cả', 20],
        ['create', 'Tạo', 30],
        ['edit_own', 'Sửa của mình', 40],
        ['approve', 'Duyệt', 50],
      ])),
      module('expense.master_data', 'Danh mục chi phí', 'EX', ['/expense'], 30, actions('expense.master_data', 'EX', '/expense', EXPENSE_SCOPE, [
        ['manage', 'Quản trị danh mục', 10],
      ])),
    ],
  },
  {
    code: 'workflow',
    label: 'Quy trình',
    sortOrder: 60,
    modules: [
      module('workflow.instance', 'Phiên quy trình', 'WF', ['/wf/dashboard', '/wf', '/wf/instances/:id'], 10, actions('workflow.instance', 'WF', '/wf', WORKFLOW_SCOPE, [
        ['view', 'Xem', 10],
        ['create', 'Tạo', 20],
        ['act_assigned', 'Xử lý được giao', 30],
      ])),
      module('workflow.template', 'Mẫu quy trình', 'WF', ['/wf/templates', '/wf/builder/:id'], 20, actions('workflow.template', 'WF', '/wf/templates', WORKFLOW_SCOPE, [
        ['view', 'Xem', 10],
        ['create', 'Tạo', 20],
        ['edit', 'Sửa', 30],
        ['publish', 'Phát hành', 40],
      ])),
    ],
  },
  {
    code: 'request',
    label: 'Yêu cầu',
    sortOrder: 70,
    modules: [
      module('request.instance', 'Phiếu yêu cầu', 'RQ', ['/rq/dashboard', '/rq'], 10, actions('request.instance', 'RQ', '/rq', WORKFLOW_SCOPE, [
        ['view_own', 'Xem của mình', 10],
        ['create', 'Tạo', 20],
        ['act_assigned', 'Xử lý được giao', 30],
        ['view_all', 'Xem tất cả', 40],
      ])),
      module('request.category', 'Danh mục yêu cầu', 'RQ', ['/rq/categories'], 20, actions('request.category', 'RQ', '/rq/categories', WORKFLOW_SCOPE, [
        ['view', 'Xem', 10],
        ['manage', 'Quản trị danh mục', 20],
      ])),
      module('request.template', 'Mẫu yêu cầu', 'RQ', ['/rq/categories'], 30, actions('request.template', 'RQ', '/rq/categories', WORKFLOW_SCOPE, [
        ['view', 'Xem', 10],
        ['manage', 'Quản trị mẫu', 20],
      ])),
    ],
  },
  {
    code: 'asset',
    label: 'Tài sản',
    sortOrder: 80,
    modules: [
      module('asset.catalog', 'Danh mục tài sản', 'TS', ['/ts/dashboard', '/ts/catalog', '/ts/asset/:id'], 10, actions('asset.catalog', 'TS', '/ts/catalog', ASSET_SCOPE, [
        ['view', 'Xem', 10],
        ['manage', 'Quản trị', 20],
      ])),
      module('asset.assignment', 'Cấp phát tài sản', 'TS', ['/ts/assignment'], 20, actions('asset.assignment', 'TS', '/ts/assignment', ASSET_SCOPE, [
        ['view', 'Xem', 10],
        ['create', 'Tạo', 20],
        ['approve', 'Duyệt', 30],
      ])),
      module('asset.maintenance', 'Bảo trì tài sản', 'TS', ['/ts/maintenance'], 30, actions('asset.maintenance', 'TS', '/ts/maintenance', ASSET_SCOPE, [
        ['view', 'Xem', 10],
        ['create', 'Tạo', 20],
        ['manage', 'Quản trị', 30],
      ])),
      module('asset.audit', 'Kiểm kê tài sản', 'TS', ['/ts/audit', '/ts/reports'], 40, actions('asset.audit', 'TS', '/ts/audit', ASSET_SCOPE, [
        ['view', 'Xem', 10],
        ['perform', 'Thực hiện kiểm kê', 20],
      ])),
    ],
  },
  {
    code: 'contract',
    label: 'Hợp đồng',
    sortOrder: 90,
    modules: [
      module('contract.partner', 'Đối tác', 'HD', ['/hd', '/hd/overview', '/hd/partners'], 10, actions('contract.partner', 'HD', '/hd/partners', GLOBAL_SCOPE, [
        ['view', 'Xem', 10],
        ['manage', 'Quản trị', 20],
      ])),
      module('contract.customer', 'Hợp đồng khách hàng', 'HD', ['/hd/customer', '/hd/customer/:id'], 20, actions('contract.customer', 'HD', '/hd/customer', GLOBAL_SCOPE, [
        ['view', 'Xem', 10],
        ['manage', 'Quản trị', 20],
      ])),
      module('contract.supplier', 'Hợp đồng nhà cung cấp', 'HD', ['/hd/supplier', '/hd/subcontractor', '/hd/subcontractor/:id'], 30, actions('contract.supplier', 'HD', '/hd/supplier', GLOBAL_SCOPE, [
        ['view', 'Xem', 10],
        ['manage', 'Quản trị', 20],
      ])),
      module('contract.template', 'Mẫu hợp đồng', 'HD', ['/hd/contract-types', '/hd/catalogs'], 40, actions('contract.template', 'HD', '/hd/contract-types', GLOBAL_SCOPE, [
        ['view', 'Xem', 10],
        ['manage', 'Quản trị mẫu', 20],
      ])),
      module('contract.cost_library', 'Thư viện đơn giá', 'HD', ['/hd/cost-library'], 50, actions('contract.cost_library', 'HD', '/hd/cost-library', GLOBAL_SCOPE, [
        ['view', 'Xem', 10],
        ['manage', 'Quản trị', 20],
      ])),
    ],
  },
  {
    code: 'ai',
    label: 'AI',
    sortOrder: 100,
    modules: [
      module('ai.assistant', 'Trợ lý AI', 'AI', ['/ai'], 10, actions('ai.assistant', 'AI', '/ai', GLOBAL_SCOPE, [
        ['view', 'Xem', 10],
        ['use', 'Sử dụng', 20],
      ])),
      module('ai.executive', 'AI điều hành', 'AI', ['/ai/executive'], 20, actions('ai.executive', 'AI', '/ai/executive', GLOBAL_SCOPE, [
        ['view', 'Xem', 10],
      ])),
      module('ai.report', 'Báo cáo AI', 'AI', ['/ai/reports'], 30, actions('ai.report', 'AI', '/ai/reports', GLOBAL_SCOPE, [
        ['view', 'Xem', 10],
        ['generate', 'Tạo báo cáo', 20],
      ])),
    ],
  },
  {
    code: 'storage',
    label: 'Lưu trữ',
    sortOrder: 110,
    modules: [
      module('storage.files', 'Tệp lưu trữ', 'STORAGE', ['/storage'], 10, actions('storage', 'STORAGE', '/storage', GLOBAL_SCOPE, [
        ['view', 'Xem', 10],
        ['manage', 'Quản trị', 20],
      ])),
    ],
  },
  {
    code: 'kb',
    label: 'Kho tri thức',
    sortOrder: 120,
    modules: [
      module('kb.articles', 'Bài viết tri thức', 'KB', ['/knowledge-base'], 10, actions('kb', 'KB', '/knowledge-base', GLOBAL_SCOPE, [
        ['view', 'Xem', 10],
        ['manage', 'Quản trị', 20],
      ])),
    ],
  },
  {
    code: 'analytics',
    label: 'Phân tích',
    sortOrder: 130,
    modules: [
      module('analytics.dashboard', 'Dashboard phân tích', 'ANALYTICS', ['/analytics'], 10, actions('analytics', 'ANALYTICS', '/analytics', GLOBAL_SCOPE, [
        ['view', 'Xem', 10],
        ['export', 'Xuất dữ liệu', 20],
      ])),
    ],
  },
];
