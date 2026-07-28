import { describe, expect, it } from 'vitest';
import { mapUserProfileRow } from '../../context/authState';

describe('request direct manager profile mapping', () => {
  it('maps manager_id from the authoritative user profile', () => {
    expect(mapUserProfileRow({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Nhân viên',
      email: 'employee@vioo.vn',
      role: 'EMPLOYEE',
      manager_id: '22222222-2222-4222-8222-222222222222',
      is_active: true,
    }).managerId).toBe('22222222-2222-4222-8222-222222222222');
  });
});
