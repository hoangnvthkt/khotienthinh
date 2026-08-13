import { describe, expect, it } from 'vitest';

import {
  canConfigureProjectRoomAction,
  getDailyLogPermissionCodesForEffectiveRoomActions,
  getGanttEffectiveCapabilities,
  getMaterialPoEffectiveCapabilities,
  getMaterialRequestEffectiveCapabilities,
  getWeeklyProgressPermissionCodesForEffectiveRoomActions,
} from '../permissions/projectRoomEffectiveActions';
import * as projectRoomEffectiveActions from '../permissions/projectRoomEffectiveActions';

describe('effective Project Room actions', () => {
  it('blocks configuration until an action reaches pilot or enforced status', () => {
    expect(canConfigureProjectRoomAction('audit_only')).toBe(false);
    expect(canConfigureProjectRoomAction('pilot')).toBe(true);
    expect(canConfigureProjectRoomAction('enforced')).toBe(true);
  });

  it('requires Room view before exposing any Material PO workflow capability', () => {
    const editOnly = getMaterialPoEffectiveCapabilities([{
      roomCode: 'material_po',
      actionCode: 'edit',
      source: 'room',
      enforcementStatus: 'pilot',
    }]);

    expect(editOnly).toEqual({
      canViewPo: false,
      canEditPo: false,
      canDeletePo: false,
      canSubmitPo: false,
      canApprovePo: false,
      canConfirmPo: false,
    });

    const viewAndEdit = getMaterialPoEffectiveCapabilities([
      { roomCode: 'material_po', actionCode: 'view', source: 'room', enforcementStatus: 'pilot' },
      { roomCode: 'material_po', actionCode: 'edit', source: 'room', enforcementStatus: 'pilot' },
    ]);
    expect(viewAndEdit.canViewPo).toBe(true);
    expect(viewAndEdit.canEditPo).toBe(true);
    expect(viewAndEdit.canDeletePo).toBe(false);
  });

  it('ignores actions belonging to another Room', () => {
    expect(getMaterialPoEffectiveCapabilities([{
      roomCode: 'daily_log',
      actionCode: 'approve',
      source: 'room',
      enforcementStatus: 'pilot',
    }]).canApprovePo).toBe(false);
  });

  it('keeps Material Request actions independent and requires view', () => {
    const editOnly = getMaterialRequestEffectiveCapabilities([{
      roomCode: 'material_request', actionCode: 'edit', source: 'room', enforcementStatus: 'pilot',
    }]);
    expect(editOnly.canCreateMaterialRequest).toBe(false);
    const viewAndEdit = getMaterialRequestEffectiveCapabilities([
      { roomCode: 'material_request', actionCode: 'view', source: 'room', enforcementStatus: 'pilot' },
      { roomCode: 'material_request', actionCode: 'edit', source: 'room', enforcementStatus: 'pilot' },
    ]);
    expect(viewAndEdit.canCreateMaterialRequest).toBe(true);
    expect(viewAndEdit.canSubmitMaterialRequest).toBe(false);
    expect(viewAndEdit.canDeleteMaterialRequest).toBe(false);
  });

  it('maps Daily Log edit and delete to owner-scoped permissions only', () => {
    const permissions = getDailyLogPermissionCodesForEffectiveRoomActions(['edit', 'delete']);

    expect(permissions).toEqual(expect.arrayContaining([
      'project.daily_log.create',
      'project.daily_log.edit_own',
      'project.daily_log.delete_own',
    ]));
    expect(permissions).not.toContain('project.daily_log.edit_all');
    expect(permissions).not.toContain('project.daily_log.delete_all');
  });

  it('lets the assigned verifier summarize or return and the approver return', () => {
    const verifier = getDailyLogPermissionCodesForEffectiveRoomActions(['verify']);
    const approver = getDailyLogPermissionCodesForEffectiveRoomActions(['approve']);

    expect(verifier).toEqual(expect.arrayContaining([
      'project.daily_log.verify',
      'project.daily_log.return',
      'project.daily_log.summarize',
    ]));
    expect(approver).toEqual(expect.arrayContaining([
      'project.daily_log.approve',
      'project.daily_log.return',
    ]));
  });

  it('maps weekly progress Room actions to the three approved PBAC candidates only', () => {
    expect(getWeeklyProgressPermissionCodesForEffectiveRoomActions([
      'view', 'edit', 'confirm',
    ])).toEqual([
      'project.weekly_progress.view',
      'project.weekly_progress.create',
      'project.weekly_progress.edit_all',
      'project.weekly_progress.lock',
    ]);
  });

  it('keeps weekly progress mutations unavailable until effective actions load', () => {
    const getCapabilities = (projectRoomEffectiveActions as any).getWeeklyProgressEffectiveCapabilities;
    expect(getCapabilities).toBeTypeOf('function');
    if (typeof getCapabilities !== 'function') return;

    const actions = [
      { roomCode: 'weekly_progress', actionCode: 'view', source: 'room', enforcementStatus: 'pilot' },
      { roomCode: 'weekly_progress', actionCode: 'edit', source: 'room', enforcementStatus: 'pilot' },
      { roomCode: 'weekly_progress', actionCode: 'confirm', source: 'room', enforcementStatus: 'pilot' },
      { roomCode: 'daily_log', actionCode: 'approve', source: 'room', enforcementStatus: 'pilot' },
    ];

    expect(getCapabilities(actions, false)).toEqual({
      canView: false,
      canEdit: false,
      canConfirm: false,
    });
    expect(getCapabilities(actions, true)).toEqual({
      canView: true,
      canEdit: true,
      canConfirm: true,
    });
  });

  it('keeps gantt edit and delete independent while requiring view', () => {
    const editOnly = getGanttEffectiveCapabilities([
      { roomCode: 'gantt', actionCode: 'edit', source: 'room', enforcementStatus: 'pilot' },
    ], true);
    expect(editOnly).toEqual({ canView: false, canEdit: false, canDelete: false });

    const viewAndEdit = getGanttEffectiveCapabilities([
      { roomCode: 'gantt', actionCode: 'view', source: 'room', enforcementStatus: 'pilot' },
      { roomCode: 'gantt', actionCode: 'edit', source: 'room', enforcementStatus: 'pilot' },
    ], true);
    expect(viewAndEdit).toEqual({ canView: true, canEdit: true, canDelete: false });

    const viewAndDelete = getGanttEffectiveCapabilities([
      { roomCode: 'gantt', actionCode: 'view', source: 'room', enforcementStatus: 'pilot' },
      { roomCode: 'gantt', actionCode: 'delete', source: 'room', enforcementStatus: 'pilot' },
    ], true);
    expect(viewAndDelete).toEqual({ canView: true, canEdit: false, canDelete: true });
  });

  it('fails gantt capabilities closed until effective actions load', () => {
    expect(getGanttEffectiveCapabilities([
      { roomCode: 'gantt', actionCode: 'view', source: 'room', enforcementStatus: 'pilot' },
      { roomCode: 'gantt', actionCode: 'edit', source: 'room', enforcementStatus: 'pilot' },
      { roomCode: 'gantt', actionCode: 'delete', source: 'room', enforcementStatus: 'pilot' },
    ], false)).toEqual({ canView: false, canEdit: false, canDelete: false });
  });
});
