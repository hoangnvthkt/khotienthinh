import type { ProjectRoomActionCode } from './projectPermissionRooms';

export type ProjectRoomEnforcementStatus = 'audit_only' | 'pilot' | 'enforced';
export type ProjectRoomAuthorizationSource = 'admin' | 'room' | 'pbac_fallback';
export type ProjectRoomGrantSource = 'manual_room' | 'pbac_backfill';

export interface EffectiveProjectRoomAction {
  roomCode: string;
  actionCode: ProjectRoomActionCode;
  source: ProjectRoomAuthorizationSource;
  enforcementStatus: ProjectRoomEnforcementStatus;
  pbacFallbackEnabled?: boolean;
}

export const canConfigureProjectRoomAction = (
  status: ProjectRoomEnforcementStatus,
): boolean => status !== 'audit_only';

const DAILY_LOG_ROOM_ACTION_PERMISSION_CODES: Partial<Record<
  ProjectRoomActionCode,
  readonly string[]
>> = {
  view: ['project.daily_log.view'],
  edit: ['project.daily_log.create', 'project.daily_log.edit_own'],
  delete: ['project.daily_log.delete_own'],
  submit: ['project.daily_log.submit'],
  verify: [
    'project.daily_log.verify',
    'project.daily_log.return',
    'project.daily_log.summarize',
  ],
  approve: ['project.daily_log.approve', 'project.daily_log.return'],
};

export const getDailyLogPermissionCodesForEffectiveRoomActions = (
  actionCodes: readonly ProjectRoomActionCode[],
): string[] => Array.from(new Set(actionCodes.flatMap(
  actionCode => DAILY_LOG_ROOM_ACTION_PERMISSION_CODES[actionCode] || [],
)));

const WEEKLY_PROGRESS_ROOM_ACTION_PERMISSION_CODES: Partial<Record<
  ProjectRoomActionCode,
  readonly string[]
>> = {
  view: ['project.weekly_progress.view'],
  edit: ['project.weekly_progress.create', 'project.weekly_progress.edit_all'],
  confirm: ['project.weekly_progress.lock'],
};

export const getWeeklyProgressPermissionCodesForEffectiveRoomActions = (
  actionCodes: readonly ProjectRoomActionCode[],
): string[] => Array.from(new Set(actionCodes.flatMap(
  actionCode => WEEKLY_PROGRESS_ROOM_ACTION_PERMISSION_CODES[actionCode] || [],
)));

export interface WeeklyProgressEffectiveCapabilities {
  canView: boolean;
  canEdit: boolean;
  canConfirm: boolean;
}

export interface GanttEffectiveCapabilities {
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export const getGanttEffectiveCapabilities = (
  actions: readonly EffectiveProjectRoomAction[],
  actionsLoaded: boolean,
): GanttEffectiveCapabilities => {
  if (!actionsLoaded) return { canView: false, canEdit: false, canDelete: false };
  const granted = getEffectiveProjectRoomActionSet(actions, 'gantt');
  const canView = granted.has('view');
  return {
    canView,
    canEdit: canView && granted.has('edit'),
    canDelete: canView && granted.has('delete'),
  };
};

export const getWeeklyProgressEffectiveCapabilities = (
  actions: readonly EffectiveProjectRoomAction[],
  actionsLoaded: boolean,
): WeeklyProgressEffectiveCapabilities => {
  if (!actionsLoaded) return { canView: false, canEdit: false, canConfirm: false };
  const granted = getEffectiveProjectRoomActionSet(actions, 'weekly_progress');
  const canView = granted.has('view');
  return {
    canView,
    canEdit: canView && granted.has('edit'),
    canConfirm: canView && granted.has('confirm'),
  };
};

export interface MaterialPoEffectiveCapabilities {
  canViewPo: boolean;
  canEditPo: boolean;
  canDeletePo: boolean;
  canSubmitPo: boolean;
  canApprovePo: boolean;
  canConfirmPo: boolean;
}

export interface MaterialRequestEffectiveCapabilities {
  canViewMaterialRequest: boolean;
  canCreateMaterialRequest: boolean;
  canEditOwnMaterialRequest: boolean;
  canDeleteMaterialRequest: boolean;
  canSubmitMaterialRequest: boolean;
  canReturnMaterialRequest: boolean;
  canApproveMaterialRequest: boolean;
  canConfirmFulfillment: boolean;
  canViewAvailableStock: boolean;
}

export const getEffectiveProjectRoomActionSet = (
  actions: readonly EffectiveProjectRoomAction[],
  roomCode: string,
): ReadonlySet<ProjectRoomActionCode> => new Set(actions
  .filter(action => action.roomCode === roomCode)
  .map(action => action.actionCode));

const MATERIAL_PO_ACTION_CODES = [
  'view',
  'edit',
  'delete',
  'submit',
  'approve',
  'confirm',
] as const satisfies readonly ProjectRoomActionCode[];

export const getMaterialPoEffectiveCapabilities = (
  actions: readonly EffectiveProjectRoomAction[],
): MaterialPoEffectiveCapabilities => {
  const granted = getEffectiveProjectRoomActionSet(actions, 'material_po');
  const has = (actionCode: (typeof MATERIAL_PO_ACTION_CODES)[number]) => granted.has(actionCode);
  const canViewPo = has('view');

  return {
    canViewPo,
    canEditPo: canViewPo && has('edit'),
    canDeletePo: canViewPo && has('delete'),
    canSubmitPo: canViewPo && has('submit'),
    canApprovePo: canViewPo && has('approve'),
    canConfirmPo: canViewPo && has('confirm'),
  };
};

export const getMaterialRequestEffectiveCapabilities = (
  actions: readonly EffectiveProjectRoomAction[],
): MaterialRequestEffectiveCapabilities => {
  const granted = getEffectiveProjectRoomActionSet(actions, 'material_request');
  const canViewMaterialRequest = granted.has('view');
  const has = (action: ProjectRoomActionCode) => canViewMaterialRequest && granted.has(action);
  return {
    canViewMaterialRequest,
    canCreateMaterialRequest: has('edit'),
    canEditOwnMaterialRequest: has('edit'),
    canDeleteMaterialRequest: has('delete'),
    canSubmitMaterialRequest: has('submit'),
    canReturnMaterialRequest: has('approve'),
    canApproveMaterialRequest: has('approve'),
    canConfirmFulfillment: has('confirm'),
    canViewAvailableStock: has('view_available_stock'),
  };
};
