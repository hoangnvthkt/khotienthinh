export const PROJECT_ROOM_ACTION_CODES = [
  'view',
  'edit',
  'delete',
  'submit',
  'verify',
  'confirm',
  'approve',
  'view_available_stock',
] as const;

export type ProjectRoomActionCode = typeof PROJECT_ROOM_ACTION_CODES[number];

export const PROJECT_PERMISSION_ROOM_CODES = [
  'daily_log',
  'material_planning',
  'material_request',
  'material_po',
  'material_waste',
  'custom_material',
  'gantt',
  'weekly_progress',
  'quantity_acceptance',
  'payment',
  'boq_reconciliation',
  'quality',
  'safety',
  'subcontract',
] as const;

export type ProjectPermissionRoomCode = typeof PROJECT_PERMISSION_ROOM_CODES[number];

export type ProjectPermissionRoomGroupCode =
  | 'daily_log'
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
): ProjectPermissionRoomDefinition => Object.freeze({
  code,
  groupCode,
  name,
  description,
  actions: Object.freeze([...actions]),
  requiredActions: Object.freeze([...requiredActions]),
  sortOrder,
});

export const PROJECT_PERMISSION_ROOMS = Object.freeze([
  defineRoom('daily_log', 'daily_log', 'Nhật ký công trường', 'Lập, kiểm tra và duyệt nhật ký.', ['view', 'edit', 'delete', 'submit', 'verify', 'approve'], ['verify', 'approve'], 10),
  defineRoom('material_planning', 'material', 'Kế hoạch & BOQ vật tư', 'Quản lý kế hoạch và BOQ vật tư.', ['view', 'edit', 'delete'], [], 20),
  defineRoom('material_request', 'material', 'Đề xuất vật tư', 'Gửi, kiểm tra, duyệt và xác nhận cấp vật tư.', ['view', 'edit', 'delete', 'submit', 'verify', 'confirm', 'approve', 'view_available_stock'], ['approve', 'confirm'], 30),
  defineRoom('material_po', 'material', 'Đơn hàng PO', 'Tạo, gửi duyệt, duyệt và xác nhận nhận hàng.', ['view', 'edit', 'delete', 'submit', 'approve', 'confirm'], ['approve'], 40),
  defineRoom('material_waste', 'material', 'Hao hụt vật tư', 'Ghi nhận và duyệt hao hụt.', ['view', 'edit', 'approve'], ['approve'], 50),
  defineRoom('custom_material', 'material', 'Vật tư phi tiêu chuẩn', 'Tạo, sửa và duyệt vật tư phi tiêu chuẩn.', ['view', 'edit', 'approve'], ['approve'], 60),
  defineRoom('gantt', 'progress', 'Tiến độ Gantt', 'Quản lý công việc và xác nhận hoàn thành.', ['view', 'edit', 'delete', 'submit', 'verify', 'approve'], ['verify', 'approve'], 70),
  defineRoom('weekly_progress', 'progress', 'Chốt tiến độ ngày/tuần', 'Cập nhật, duyệt và khóa kỳ tiến độ.', ['view', 'edit', 'submit', 'verify', 'approve', 'confirm'], ['approve'], 80),
  defineRoom('quantity_acceptance', 'finance', 'Nghiệm thu khối lượng', 'Lập và duyệt nghiệm thu khối lượng.', ['view', 'edit', 'delete', 'submit', 'verify', 'approve'], ['approve'], 90),
  defineRoom('payment', 'finance', 'Thanh toán', 'Lập, duyệt và xác nhận thanh toán.', ['view', 'edit', 'delete', 'submit', 'verify', 'approve', 'confirm'], ['approve', 'confirm'], 100),
  defineRoom('boq_reconciliation', 'finance', 'Đối soát BOQ', 'Kiểm tra, duyệt và khóa đối soát.', ['view', 'edit', 'submit', 'verify', 'approve'], ['verify'], 110),
  defineRoom('quality', 'quality', 'Hồ sơ & checklist chất lượng', 'Lập, kiểm tra và duyệt chất lượng.', ['view', 'edit', 'delete', 'submit', 'verify', 'approve'], ['approve'], 120),
  defineRoom('safety', 'safety', 'Hồ sơ & sự cố an toàn', 'Quản lý hồ sơ và đóng sự cố.', ['view', 'edit', 'delete', 'submit', 'verify', 'confirm', 'approve'], ['approve'], 130),
  defineRoom('subcontract', 'subcontract', 'Nghiệm thu & thanh toán nhà thầu', 'Quản lý nghiệm thu và thanh toán nhà thầu.', ['view', 'edit', 'delete', 'submit', 'approve', 'confirm'], ['approve'], 140),
] satisfies readonly ProjectPermissionRoomDefinition[]);

export const getProjectPermissionRoom = (code: ProjectPermissionRoomCode) =>
  PROJECT_PERMISSION_ROOMS.find(room => room.code === code);

export const isRoomActionAllowed = (
  roomCode: ProjectPermissionRoomCode,
  actionCode: ProjectRoomActionCode,
) => Boolean(getProjectPermissionRoom(roomCode)?.actions.includes(actionCode));
