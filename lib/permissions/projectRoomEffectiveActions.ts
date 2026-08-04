import type { ProjectRoomActionCode } from './projectPermissionRooms';

export type ProjectRoomEnforcementStatus = 'audit_only' | 'pilot' | 'enforced';
export type ProjectRoomAuthorizationSource = 'admin' | 'room' | 'pbac_fallback';

export interface EffectiveProjectRoomAction {
  roomCode: string;
  actionCode: ProjectRoomActionCode;
  source: ProjectRoomAuthorizationSource;
  enforcementStatus: ProjectRoomEnforcementStatus;
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

export interface MaterialPoEffectiveCapabilities {
  canViewPo: boolean;
  canEditPo: boolean;
  canDeletePo: boolean;
  canSubmitPo: boolean;
  canApprovePo: boolean;
  canConfirmPo: boolean;
}

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
  const granted = new Set(actions
    .filter(action => action.roomCode === 'material_po')
    .map(action => action.actionCode));
  const has = (actionCode: (typeof MATERIAL_PO_ACTION_CODES)[number]) => granted.has(actionCode);

  return {
    canViewPo: has('view'),
    canEditPo: has('edit'),
    canDeletePo: has('delete'),
    canSubmitPo: has('submit'),
    canApprovePo: has('approve'),
    canConfirmPo: has('confirm'),
  };
};
