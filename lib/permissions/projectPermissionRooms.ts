export const PROJECT_ROOM_ACTION_CODES = [
  'view',
  'edit',
  'delete',
  'submit',
  'return',
  'verify',
  'confirm',
  'approve',
  'publish_progress',
  'view_available_stock',
  'view_resource_evidence',
] as const;

export type ProjectRoomActionCode = typeof PROJECT_ROOM_ACTION_CODES[number];

export const PROJECT_PERMISSION_ROOM_CODES = [
  'daily_log',
  'v2_month_plan',
  'v2_construction_plan',
  'v2_material_plan',
  'material_planning',
  'material_request',
  'material_po',
  'gantt',
  'weekly_progress',
  'quantity_acceptance',
  'payment',
  'quality',
  'safety',
] as const;

export type ProjectPermissionRoomCode = typeof PROJECT_PERMISSION_ROOM_CODES[number];

export type ProjectPermissionRoomGroupCode =
  | 'daily_log'
  | 'planning'
  | 'material'
  | 'progress'
  | 'finance'
  | 'quality'
  | 'safety'
  | 'subcontract';

export interface ProjectPermissionRoomDefinition {
  readonly code: ProjectPermissionRoomCode;
  readonly groupCode: ProjectPermissionRoomGroupCode;
  readonly name: string;
  readonly description: string;
  readonly actions: readonly ProjectRoomActionCode[];
  readonly requiredActions: readonly ProjectRoomActionCode[];
  readonly actionPrerequisites: Readonly<Partial<Record<ProjectRoomActionCode, readonly ProjectRoomActionCode[]>>>;
  readonly sortOrder: number;
}

const defineRoom = (
  code: ProjectPermissionRoomCode,
  groupCode: ProjectPermissionRoomGroupCode,
  name: string,
  description: string,
  actions: readonly ProjectRoomActionCode[],
  requiredActions: readonly ProjectRoomActionCode[],
  sortOrder: number,
  actionPrerequisites: Partial<Record<ProjectRoomActionCode, readonly ProjectRoomActionCode[]>> = {},
): ProjectPermissionRoomDefinition => Object.freeze({
  code,
  groupCode,
  name,
  description,
  actions: Object.freeze([...actions]),
  requiredActions: Object.freeze([...requiredActions]),
  actionPrerequisites: Object.freeze(Object.fromEntries(Object.entries(actionPrerequisites).map(([action, prerequisites]) => [
    action,
    Object.freeze([...prerequisites]),
  ]))) as ProjectPermissionRoomDefinition['actionPrerequisites'],
  sortOrder,
});

export const PROJECT_PERMISSION_ROOMS = Object.freeze([
  defineRoom('v2_month_plan', 'planning', 'Kế hoạch tháng V2', 'Lập và duyệt khối lượng tháng.',
    ['view', 'edit', 'delete', 'submit', 'return', 'approve'], [], 11,
    { edit: ['view'], delete: ['view'], submit: ['view'], return: ['view'], approve: ['view'] }),
  defineRoom('v2_construction_plan', 'planning', 'Kế hoạch thi công V2', 'Lập và duyệt công việc thi công.',
    ['view', 'edit', 'delete', 'submit', 'return', 'approve'], [], 12,
    { edit: ['view'], delete: ['view'], submit: ['view'], return: ['view'], approve: ['view'] }),
  defineRoom('v2_material_plan', 'planning', 'Kế hoạch vật tư V2', 'Lập và duyệt nhu cầu vật tư từ thi công.',
    ['view', 'edit', 'delete', 'submit', 'return', 'approve'], [], 13,
    { edit: ['view'], delete: ['view'], submit: ['view'], return: ['view'], approve: ['view'] }),
  defineRoom('daily_log', 'daily_log', 'Nhật ký công trường', 'Lập, kiểm tra và duyệt nhật ký.', ['view', 'edit', 'delete', 'submit', 'verify', 'approve', 'publish_progress'], ['verify', 'approve'], 10, { publish_progress: ['approve'] }),
  defineRoom('material_planning', 'material', 'Kế hoạch & BOQ vật tư', 'Quản lý kế hoạch và BOQ vật tư.', ['view', 'edit', 'delete'], [], 20),
  defineRoom('material_request', 'material', 'Đề xuất vật tư', 'Gửi, duyệt và xác nhận cấp vật tư.', ['view', 'edit', 'delete', 'submit', 'confirm', 'approve', 'view_available_stock'], [], 30),
  defineRoom('material_po', 'material', 'Đơn hàng PO', 'Tạo, gửi duyệt, duyệt và xác nhận nhận hàng.', ['view', 'edit', 'delete', 'submit', 'approve', 'confirm'], [], 40),
  defineRoom('gantt', 'progress', 'Tiến độ Gantt', 'Quản lý hạng mục và tiến độ thi công.', ['view', 'edit', 'delete'], [], 70, { edit: ['view'], delete: ['view'] }),
  defineRoom('weekly_progress', 'progress', 'Chốt tiến độ ngày/tuần', 'Cập nhật và chốt/mở chốt kỳ tiến độ.', ['view', 'edit', 'confirm'], [], 80, { edit: ['view'], confirm: ['view'] }),
  defineRoom('quantity_acceptance', 'finance', 'Nghiệm thu khối lượng', 'Lập và duyệt nghiệm thu khối lượng.', ['view', 'edit', 'delete', 'submit', 'verify', 'approve'], ['approve'], 90, { edit: ['view'], delete: ['view'], submit: ['view'], verify: ['view'], approve: ['view'] }),
  defineRoom('payment', 'finance', 'Thanh toán', 'Lập, duyệt và xác nhận thanh toán.', ['view', 'edit', 'delete', 'submit', 'verify', 'approve', 'confirm', 'view_resource_evidence'], ['approve', 'confirm'], 100, { edit: ['view'], delete: ['view'], submit: ['view'], verify: ['view'], approve: ['view'], confirm: ['view'] }),
  defineRoom('quality', 'quality', 'Hồ sơ & checklist chất lượng', 'Lập, kiểm tra và duyệt chất lượng.', ['view', 'edit', 'delete', 'submit', 'verify', 'approve'], ['approve'], 120),
  defineRoom('safety', 'safety', 'Hồ sơ & sự cố an toàn', 'Quản lý hồ sơ và đóng sự cố.', ['view', 'edit', 'delete', 'submit', 'verify', 'confirm', 'approve'], ['approve'], 130, { edit: ['view'], delete: ['view'], submit: ['view'], verify: ['view'], confirm: ['view'], approve: ['view'] }),
] satisfies readonly ProjectPermissionRoomDefinition[]);

export const getProjectPermissionRoom = (code: ProjectPermissionRoomCode) =>
  PROJECT_PERMISSION_ROOMS.find(room => room.code === code);

export const isRoomActionAllowed = (
  roomCode: ProjectPermissionRoomCode,
  actionCode: ProjectRoomActionCode,
) => Boolean(getProjectPermissionRoom(roomCode)?.actions.includes(actionCode));

const GENERIC_ROOM_ACTION_LABELS: Record<ProjectRoomActionCode, string> = {
  view: 'Xem',
  edit: 'Sửa',
  delete: 'Xóa',
  submit: 'Gửi',
  return: 'Trả lại',
  verify: 'Kiểm tra',
  confirm: 'Xác nhận',
  approve: 'Duyệt',
  publish_progress: 'Công bố tiến độ ngày',
  view_available_stock: 'Xem tồn khả dụng',
  view_resource_evidence: 'Xem bằng chứng nguồn lực',
};

export const getProjectPermissionRoomActionLabel = (
  roomCode: ProjectPermissionRoomCode,
  actionCode: ProjectRoomActionCode,
): string => {
  if (roomCode === 'weekly_progress') {
    if (actionCode === 'edit') return 'Sửa/Nhập liệu';
    if (actionCode === 'confirm') return 'Chốt/Mở chốt';
  }
  return GENERIC_ROOM_ACTION_LABELS[actionCode];
};
