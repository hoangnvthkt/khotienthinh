import { describe, expect, it } from 'vitest';
import {
  PROJECT_PERMISSION_ROOMS,
  getProjectPermissionRoom,
  isRoomActionAllowed,
} from '../permissions/projectPermissionRooms';

describe('projectPermissionRooms', () => {
  it('exposes 10 unique active Room codes', () => {
    const codes = PROJECT_PERMISSION_ROOMS.map(room => room.code);

    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toEqual(expect.arrayContaining([
      'daily_log',
      'material_request',
      'material_po',
      'gantt',
      'weekly_progress',
      'quantity_acceptance',
      'payment',
      'quality',
      'safety',
    ]));
  });

  it('keeps actions scoped to the Room that declares them', () => {
    expect(isRoomActionAllowed('daily_log', 'approve')).toBe(true);
    expect(isRoomActionAllowed('daily_log', 'confirm')).toBe(false);
    expect(isRoomActionAllowed('material_planning', 'view_available_stock')).toBe(false);
    expect(isRoomActionAllowed('material_request', 'view_available_stock')).toBe(true);
    expect(isRoomActionAllowed('material_request', 'verify')).toBe(false);
  });

  it('requires view before every mutation in the final three Rooms', () => {
    for (const roomCode of ['quantity_acceptance', 'payment', 'safety'] as const) {
      const room = getProjectPermissionRoom(roomCode);
      const mutations = room?.actions.filter(action => action !== 'view') || [];

      expect(mutations.length).toBeGreaterThan(0);
      for (const action of mutations) {
        expect(room?.actionPrerequisites[action]).toContain('view');
      }
    }
  });

  it('gives weekly progress only view, edit, and confirm, with view prerequisites', () => {
    const room = getProjectPermissionRoom('weekly_progress');

    expect(room?.actions).toEqual(['view', 'edit', 'confirm']);
    expect(room?.requiredActions).toEqual([]);
    expect(room?.actionPrerequisites).toEqual({
      edit: ['view'],
      confirm: ['view'],
    });
    expect(isRoomActionAllowed('weekly_progress', 'submit')).toBe(false);
    expect(isRoomActionAllowed('weekly_progress', 'verify')).toBe(false);
    expect(isRoomActionAllowed('weekly_progress', 'approve')).toBe(false);
  });

  it('gives gantt only view, edit, and delete, with view prerequisites', () => {
    const room = getProjectPermissionRoom('gantt');

    expect(room?.actions).toEqual(['view', 'edit', 'delete']);
    expect(room?.requiredActions).toEqual([]);
    expect(room?.actionPrerequisites).toEqual({
      edit: ['view'],
      delete: ['view'],
    });
    expect(isRoomActionAllowed('gantt', 'submit')).toBe(false);
    expect(isRoomActionAllowed('gantt', 'verify')).toBe(false);
    expect(isRoomActionAllowed('gantt', 'approve')).toBe(false);
  });

  it('exposes immutable Room definitions', () => {
    expect(getProjectPermissionRoom('material_po')?.name).toBe('Đơn hàng PO');
    expect(() => (PROJECT_PERMISSION_ROOMS as unknown as unknown[]).push({ code: 'custom' })).toThrow();
  });
});
