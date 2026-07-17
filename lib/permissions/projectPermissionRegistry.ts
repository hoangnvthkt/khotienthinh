import {
  LEGACY_PROJECT_SUPPLY_ROUTE,
  PROJECT_MATERIAL_TAB_ROUTE_BY_KEY,
  PROJECT_TAB_ROUTE_BY_KEY,
} from '../projectTabPermissions';
import {
  PermissionActionDefinition,
  PermissionModuleDefinition,
  PermissionScopeType,
} from './permissionTypes';
import {
  PermissionRiskMetadata,
  resolvePermissionRiskMetadata,
} from './permissionRisk';

const PROJECT_SCOPE_TYPES: readonly PermissionScopeType[] = ['global', 'project', 'construction_site'];
const PROJECT_WAREHOUSE_SCOPE_TYPES: readonly PermissionScopeType[] = [
  'global',
  'project',
  'construction_site',
  'warehouse',
];

export const PROJECT_PERMISSION_MODULE_CODES = [
  'project.master',
  'project.overview',
  'project.org',
  'project.executive',
  'project.daily_log',
  'project.material_request',
  'project.material_plan',
  'project.material_boq',
  'project.material_po',
  'project.material_waste',
  'project.custom_material',
  'project.gantt',
  'project.weekly_progress',
  'project.contract',
  'project.contract_item',
  'project.contract_variation',
  'project.subcontract',
  'project.payment',
  'project.quantity_acceptance',
  'project.cashflow',
  'project.budget',
  'project.quality',
  'project.safety',
  'project.documents',
  'project.report',
  'project.dashboard',
] as const;

export type ProjectPermissionModuleCode = typeof PROJECT_PERMISSION_MODULE_CODES[number];

export const PROJECT_TAB_MODULE_CODE_BY_KEY = {
  executive: 'project.executive',
  org: 'project.org',
  finance: 'project.cashflow',
  budget: 'project.budget',
  cashflow: 'project.cashflow',
  contract: 'project.contract',
  gantt: 'project.gantt',
  weekly_progress: 'project.weekly_progress',
  dailylog: 'project.daily_log',
  material: 'project.material_request',
  quality: 'project.quality',
  safety: 'project.safety',
  subcontract: 'project.subcontract',
  documents: 'project.documents',
  report: 'project.report',
  payment: 'project.payment',
} as const;

export const PROJECT_MATERIAL_TAB_MODULE_CODE_BY_KEY = {
  summary: 'project.material_request',
  boq: 'project.material_boq',
  planning: 'project.material_plan',
  request: 'project.material_request',
  custom: 'project.custom_material',
  po: 'project.material_po',
  waste: 'project.material_waste',
  dashboard: 'project.material_request',
} as const;

const projectAction = (
  action: string,
  label: string,
  prefix: string,
  legacyRoute: string,
  sortOrder: number,
  scopeTypes: readonly PermissionScopeType[] = PROJECT_SCOPE_TYPES,
  riskMetadata?: PermissionRiskMetadata,
): PermissionActionDefinition => ({
  action,
  label,
  permissionCode: `${prefix}.${action}`,
  ...resolvePermissionRiskMetadata(prefix, action, riskMetadata),
  legacyModuleKey: 'DA',
  legacyRoute,
  legacyAdminOnly: false,
  scopeTypes,
  sortOrder,
});

type ProjectActionTuple =
  | readonly [string, string, number]
  | readonly [string, string, number, readonly PermissionScopeType[]];

const actionSet = (
  prefix: string,
  legacyRoute: string,
  actions: readonly ProjectActionTuple[],
): readonly PermissionActionDefinition[] =>
  actions.map(([action, label, sortOrder, scopeTypes]) =>
    projectAction(action, label, prefix, legacyRoute, sortOrder, scopeTypes || PROJECT_SCOPE_TYPES)
  );

const workflowActions = (prefix: string, legacyRoute: string): readonly PermissionActionDefinition[] =>
  actionSet(prefix, legacyRoute, [
    ['view', 'Xem', 10],
    ['create', 'Tạo', 20],
    ['edit_own', 'Sửa của mình', 30],
    ['edit_all', 'Sửa tất cả', 40],
    ['delete_own', 'Xóa của mình', 50],
    ['delete_all', 'Xóa tất cả', 60],
    ['submit', 'Gửi', 70],
    ['return', 'Trả lại', 80],
    ['verify', 'Kiểm tra', 90],
    ['confirm', 'Xác nhận', 100],
    ['approve', 'Duyệt', 110],
    ['manage', 'Quản trị', 120],
  ]);

const moduleDefinition = (
  code: ProjectPermissionModuleCode,
  label: string,
  routes: readonly string[],
  sortOrder: number,
  actions: readonly PermissionActionDefinition[],
): PermissionModuleDefinition => ({
  code,
  label,
  routes,
  legacyModuleKey: 'DA',
  sortOrder,
  actions,
});

export const PROJECT_PERMISSION_MODULES: readonly PermissionModuleDefinition[] = [
  moduleDefinition('project.master', 'Danh mục dự án', [], 5, actionSet('project.master', '/da', [
    ['view', 'Xem', 10],
    ['create', 'Tạo', 20],
    ['edit', 'Sửa', 30],
    ['hide', 'Ẩn', 40],
    ['restore', 'Khôi phục', 50],
    ['manage_categories', 'Quản trị danh mục', 60],
    ['manage', 'Quản trị', 70],
  ])),
  moduleDefinition('project.overview', 'Tổng quan dự án', ['/da'], 10, actionSet('project.overview', '/da', [
    ['view', 'Xem', 10],
    ['manage', 'Quản trị', 20],
  ])),
  moduleDefinition('project.org', 'Tổ chức dự án', [PROJECT_TAB_ROUTE_BY_KEY.org], 20, actionSet('project.org', PROJECT_TAB_ROUTE_BY_KEY.org, [
    ['view', 'Xem', 10],
    ['assign_staff', 'Phân bổ nhân sự', 20],
    ['grant_permissions', 'Cấp quyền', 30],
    ['manage', 'Quản trị', 40],
  ])),
  moduleDefinition('project.executive', 'Điều hành', [PROJECT_TAB_ROUTE_BY_KEY.executive], 30, actionSet('project.executive', PROJECT_TAB_ROUTE_BY_KEY.executive, [
    ['view', 'Xem', 10],
    ['manage', 'Quản trị', 20],
  ])),
  moduleDefinition('project.daily_log', 'Nhật ký dự án', [PROJECT_TAB_ROUTE_BY_KEY.dailylog], 40, [
    ...workflowActions('project.daily_log', PROJECT_TAB_ROUTE_BY_KEY.dailylog),
    projectAction('summarize', 'Tổng hợp', 'project.daily_log', PROJECT_TAB_ROUTE_BY_KEY.dailylog, 130),
  ]),
  moduleDefinition('project.material_request', 'Đề xuất vật tư', [
    PROJECT_TAB_ROUTE_BY_KEY.material,
    LEGACY_PROJECT_SUPPLY_ROUTE,
    PROJECT_MATERIAL_TAB_ROUTE_BY_KEY.summary,
    PROJECT_MATERIAL_TAB_ROUTE_BY_KEY.request,
    PROJECT_MATERIAL_TAB_ROUTE_BY_KEY.dashboard,
  ], 50, [
    ...workflowActions('project.material_request', PROJECT_TAB_ROUTE_BY_KEY.material),
    projectAction('confirm_fulfillment', 'Xác nhận cấp hàng', 'project.material_request', PROJECT_TAB_ROUTE_BY_KEY.material, 125),
    projectAction('view_available_stock', 'Xem tồn khả dụng', 'project.material_request', PROJECT_TAB_ROUTE_BY_KEY.material, 130, PROJECT_WAREHOUSE_SCOPE_TYPES),
  ]),
  moduleDefinition('project.material_plan', 'Kế hoạch vật tư', [PROJECT_MATERIAL_TAB_ROUTE_BY_KEY.planning], 60, actionSet('project.material_plan', PROJECT_MATERIAL_TAB_ROUTE_BY_KEY.planning, [
    ['view', 'Xem', 10],
    ['edit', 'Sửa', 20],
    ['manage', 'Quản trị', 30],
  ])),
  moduleDefinition('project.material_boq', 'BOQ vật tư', [PROJECT_MATERIAL_TAB_ROUTE_BY_KEY.boq], 70, actionSet('project.material_boq', PROJECT_MATERIAL_TAB_ROUTE_BY_KEY.boq, [
    ['view', 'Xem', 10],
    ['edit', 'Sửa', 20],
    ['delete', 'Xóa', 30],
    ['manage', 'Quản trị', 40],
  ])),
  moduleDefinition('project.material_po', 'Đơn hàng PO dự án', [PROJECT_MATERIAL_TAB_ROUTE_BY_KEY.po], 80, actionSet('project.material_po', PROJECT_MATERIAL_TAB_ROUTE_BY_KEY.po, [
    ['view', 'Xem', 10],
    ['create', 'Tạo', 20],
    ['approve', 'Duyệt', 30],
    ['receive', 'Nhận hàng', 40],
    ['delete', 'Xóa', 45],
    ['manage', 'Quản trị', 50],
  ])),
  moduleDefinition('project.material_waste', 'Hao hụt vật tư', [PROJECT_MATERIAL_TAB_ROUTE_BY_KEY.waste], 85, actionSet('project.material_waste', PROJECT_MATERIAL_TAB_ROUTE_BY_KEY.waste, [
    ['view', 'Xem', 10],
    ['record', 'Ghi nhận', 20],
    ['approve', 'Duyệt', 30],
    ['manage', 'Quản trị', 40],
  ])),
  moduleDefinition('project.custom_material', 'Vật tư phi tiêu chuẩn', [PROJECT_MATERIAL_TAB_ROUTE_BY_KEY.custom], 90, actionSet('project.custom_material', PROJECT_MATERIAL_TAB_ROUTE_BY_KEY.custom, [
    ['view', 'Xem', 10],
    ['create', 'Tạo', 20],
    ['approve', 'Duyệt', 30],
    ['manage', 'Quản trị', 40],
  ])),
  moduleDefinition('project.gantt', 'Tiến độ Gantt', [PROJECT_TAB_ROUTE_BY_KEY.gantt], 100, actionSet('project.gantt', PROJECT_TAB_ROUTE_BY_KEY.gantt, [
    ['view', 'Xem', 10],
    ['create_task', 'Tạo công việc', 20],
    ['edit_task', 'Sửa công việc', 30],
    ['assign_task', 'Giao việc', 40],
    ['submit_completion', 'Gửi hoàn thành', 50],
    ['verify_completion', 'Kiểm tra hoàn thành', 60],
    ['approve_completion', 'Duyệt hoàn thành', 70],
    ['edit', 'Sửa', 80],
    ['manage', 'Quản trị', 90],
  ])),
  moduleDefinition('project.weekly_progress', 'Chốt tiến độ tuần', [PROJECT_TAB_ROUTE_BY_KEY.weekly_progress], 110, actionSet('project.weekly_progress', PROJECT_TAB_ROUTE_BY_KEY.weekly_progress, [
    ['view', 'Xem', 10],
    ['create', 'Tạo', 20],
    ['edit_all', 'Sửa tất cả', 30],
    ['submit', 'Gửi', 40],
    ['verify', 'Kiểm tra', 50],
    ['approve', 'Duyệt', 60],
    ['lock', 'Khóa kỳ', 70],
    ['manage', 'Quản trị', 80],
  ])),
  moduleDefinition('project.contract', 'Hợp đồng', [PROJECT_TAB_ROUTE_BY_KEY.contract], 120, actionSet('project.contract', PROJECT_TAB_ROUTE_BY_KEY.contract, [
    ['view', 'Xem', 10],
    ['create', 'Tạo', 20],
    ['edit_all', 'Sửa tất cả', 30],
    ['approve', 'Duyệt', 40],
    ['manage', 'Quản trị', 50],
  ])),
  moduleDefinition('project.contract_item', 'Hạng mục hợp đồng', [], 125, actionSet('project.contract_item', PROJECT_TAB_ROUTE_BY_KEY.contract, [
    ['view', 'Xem', 10],
    ['edit', 'Sửa', 20],
    ['manage', 'Quản trị', 30],
  ])),
  moduleDefinition('project.contract_variation', 'Phát sinh hợp đồng', [], 126, actionSet('project.contract_variation', PROJECT_TAB_ROUTE_BY_KEY.contract, [
    ['view', 'Xem', 10],
    ['create', 'Tạo', 20],
    ['submit', 'Gửi', 30],
    ['verify', 'Kiểm tra', 40],
    ['approve', 'Duyệt', 50],
    ['manage', 'Quản trị', 60],
  ])),
  moduleDefinition('project.subcontract', 'Nhà thầu phụ', [PROJECT_TAB_ROUTE_BY_KEY.subcontract], 130, actionSet('project.subcontract', PROJECT_TAB_ROUTE_BY_KEY.subcontract, [
    ['view', 'Xem', 10],
    ['create', 'Tạo', 20],
    ['edit_all', 'Sửa tất cả', 30],
    ['approve', 'Duyệt', 40],
    ['manage', 'Quản trị', 50],
  ])),
  moduleDefinition('project.payment', 'Nghiệm thu và thanh toán', [PROJECT_TAB_ROUTE_BY_KEY.payment], 140, [
    ...workflowActions('project.payment', PROJECT_TAB_ROUTE_BY_KEY.payment),
    projectAction('mark_paid', 'Đánh dấu đã thanh toán', 'project.payment', PROJECT_TAB_ROUTE_BY_KEY.payment, 130),
  ]),
  moduleDefinition('project.quantity_acceptance', 'Nghiệm thu khối lượng', [PROJECT_TAB_ROUTE_BY_KEY.payment], 150, actionSet('project.quantity_acceptance', PROJECT_TAB_ROUTE_BY_KEY.payment, [
    ['view', 'Xem', 10],
    ['create', 'Tạo', 20],
    ['submit', 'Gửi', 30],
    ['verify', 'Kiểm tra', 40],
    ['approve', 'Duyệt', 50],
    ['manage', 'Quản trị', 60],
  ])),
  moduleDefinition('project.cashflow', 'Dòng tiền', [PROJECT_TAB_ROUTE_BY_KEY.finance, PROJECT_TAB_ROUTE_BY_KEY.cashflow], 160, actionSet('project.cashflow', PROJECT_TAB_ROUTE_BY_KEY.cashflow, [
    ['view', 'Xem', 10],
    ['manage', 'Quản trị', 20],
  ])),
  moduleDefinition('project.budget', 'Ngân sách', [PROJECT_TAB_ROUTE_BY_KEY.budget], 170, actionSet('project.budget', PROJECT_TAB_ROUTE_BY_KEY.budget, [
    ['view', 'Xem', 10],
    ['edit', 'Sửa', 20],
    ['manage', 'Quản trị', 30],
  ])),
  moduleDefinition('project.quality', 'Chất lượng', [PROJECT_TAB_ROUTE_BY_KEY.quality], 180, [
    ...workflowActions('project.quality', PROJECT_TAB_ROUTE_BY_KEY.quality),
    ...actionSet('project.quality', PROJECT_TAB_ROUTE_BY_KEY.quality, [
      ['template_manage', 'Quản trị biểu mẫu', 130],
      ['checklist_create', 'Tạo checklist', 140],
      ['checklist_edit_own', 'Sửa checklist của mình', 150],
      ['checklist_edit_all', 'Sửa mọi checklist', 160],
      ['delete', 'Xóa', 170],
    ]),
  ]),
  moduleDefinition('project.safety', 'An toàn', [PROJECT_TAB_ROUTE_BY_KEY.safety], 190, actionSet('project.safety', PROJECT_TAB_ROUTE_BY_KEY.safety, [
    ['view', 'Xem', 10],
    ['worker_manage', 'Quản lý lao động', 20],
    ['issue_create', 'Tạo sự cố', 30],
    ['issue_edit_own', 'Sửa sự cố của mình', 40],
    ['issue_edit_all', 'Sửa mọi sự cố', 50],
    ['issue_close', 'Đóng sự cố', 60],
    ['training_manage', 'Quản lý huấn luyện', 70],
    ['document_verify', 'Xác minh hồ sơ', 80],
    ['create', 'Tạo', 90],
    ['edit_all', 'Sửa tất cả', 100],
    ['verify', 'Kiểm tra', 110],
    ['approve', 'Duyệt', 120],
    ['manage', 'Quản trị', 130],
  ])),
  moduleDefinition('project.documents', 'Tài liệu', [PROJECT_TAB_ROUTE_BY_KEY.documents], 200, actionSet('project.documents', PROJECT_TAB_ROUTE_BY_KEY.documents, [
    ['view', 'Xem', 10],
    ['upload', 'Tải lên', 20],
    ['edit_metadata', 'Sửa metadata', 30],
    ['delete_own', 'Xóa của mình', 40],
    ['delete_all', 'Xóa tất cả', 50],
    ['approve', 'Duyệt', 60],
    ['delete', 'Xóa', 70],
    ['manage', 'Quản trị', 80],
  ])),
  moduleDefinition('project.report', 'Báo cáo', [PROJECT_TAB_ROUTE_BY_KEY.report], 210, actionSet('project.report', PROJECT_TAB_ROUTE_BY_KEY.report, [
    ['view', 'Xem', 10],
    ['export', 'Xuất dữ liệu', 20],
  ])),
  moduleDefinition('project.dashboard', 'Dashboard dự án', [], 220, actionSet('project.dashboard', '/da/portfolio', [
    ['view_progress', 'Xem tiến độ', 10],
    ['view_financials', 'Xem tài chính', 20],
    ['view_risk', 'Xem rủi ro', 30],
    ['manage', 'Quản trị', 40],
  ])),
];

export const getProjectModuleCodeForTab = (tabKey: keyof typeof PROJECT_TAB_MODULE_CODE_BY_KEY): ProjectPermissionModuleCode =>
  PROJECT_TAB_MODULE_CODE_BY_KEY[tabKey];

export const getProjectModuleCodeForMaterialTab = (
  tabKey: keyof typeof PROJECT_MATERIAL_TAB_MODULE_CODE_BY_KEY,
): ProjectPermissionModuleCode =>
  PROJECT_MATERIAL_TAB_MODULE_CODE_BY_KEY[tabKey];
