import { describe, expect, it } from 'vitest';
import { inheritedReason, isOn } from '../ProjectSensitiveAccessPanel';
import type { SensitiveViewAccessRow } from '../../../../lib/projectSensitiveAccessService';

const row = (overrides: Partial<SensitiveViewAccessRow> = {}): SensitiveViewAccessRow => ({
  userId: 'u1',
  userName: 'Người dùng',
  userEmail: 'u1@example.invalid',
  userAvatar: null,
  isSystemAdmin: false,
  inProject: true,
  financeProject: false,
  contractProject: false,
  financeAll: false,
  contractAll: false,
  financeRoom: false,
  contractManager: false,
  ...overrides,
});

describe('project sensitive access switches', () => {
  it('is off and editable without any source', () => {
    expect(isOn(row(), 'finance', false)).toBe(false);
    expect(inheritedReason(row(), 'finance', false)).toBeNull();
  });

  it('follows the project-level grant per domain', () => {
    const granted = row({ financeProject: true });
    expect(isOn(granted, 'finance', false)).toBe(true);
    expect(isOn(granted, 'contract', false)).toBe(false);
    expect(inheritedReason(granted, 'finance', false)).toBeNull();
  });

  it('locks switches that come from Admin, all projects, Rooms or contract managers', () => {
    expect(inheritedReason(row({ isSystemAdmin: true }), 'contract', false)).toBe('Admin hệ thống');
    expect(inheritedReason(row({ financeAll: true }), 'finance', false)).toBe('Tất cả dự án');
    expect(inheritedReason(row({ financeRoom: true }), 'contract', false)).toBe('Xử lý thanh toán / nghiệm thu');
    expect(inheritedReason(row({ contractManager: true }), 'contract', false)).toBe('Quản trị hợp đồng');
    expect(inheritedReason(row({ contractManager: true }), 'finance', false)).toBeNull();
  });

  it('keeps all-projects switches editable except for Admin and contract managers', () => {
    const allFinance = row({ financeAll: true, financeRoom: true });
    expect(isOn(allFinance, 'finance', true)).toBe(true);
    expect(inheritedReason(allFinance, 'finance', true)).toBeNull();
    expect(inheritedReason(row({ contractManager: true }), 'contract', true)).toBe('Quản trị hợp đồng');
  });
});
