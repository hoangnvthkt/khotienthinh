import { describe, expect, it } from 'vitest';
import {
  PROJECT_PERMISSION_ROOMS,
  getProjectPermissionRoom,
  isRoomActionAllowed,
} from '../permissions/projectPermissionRooms';

describe('projectPermissionRooms', () => {
  it('exposes 14 unique fixed Room codes', () => {
    const codes = PROJECT_PERMISSION_ROOMS.map(room => room.code);

    expect(codes).toHaveLength(14);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toEqual(expect.arrayContaining([
      'daily_log',
      'material_request',
      'material_po',
      'gantt',
      'weekly_progress',
      'quantity_acceptance',
      'payment',
      'boq_reconciliation',
      'quality',
      'safety',
      'subcontract',
    ]));
  });

  it('keeps actions scoped to the Room that declares them', () => {
    expect(isRoomActionAllowed('daily_log', 'approve')).toBe(true);
    expect(isRoomActionAllowed('daily_log', 'confirm')).toBe(false);
    expect(isRoomActionAllowed('material_planning', 'view_available_stock')).toBe(false);
    expect(isRoomActionAllowed('material_request', 'view_available_stock')).toBe(true);
  });

  it('exposes immutable Room definitions', () => {
    expect(getProjectPermissionRoom('material_po')?.name).toBe('Đơn hàng PO');
    expect(() => (PROJECT_PERMISSION_ROOMS as unknown as unknown[]).push({ code: 'custom' })).toThrow();
  });
});
