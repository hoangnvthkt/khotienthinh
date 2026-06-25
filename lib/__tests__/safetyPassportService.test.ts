import { describe, expect, it } from 'vitest';
import {
  buildSafetyCardQrPath,
  getSafetyAssignmentStatusLabel,
  getSafetyCertificateStatus,
} from '../safetyPassportService';

describe('safetyPassportService helpers', () => {
  it('computes certificate status by expiry date and review status', () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const later = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);

    expect(getSafetyCertificateStatus({ status: 'submitted', expiryDate: yesterday })).toBe('expired');
    expect(getSafetyCertificateStatus({ status: 'submitted', expiryDate: soon })).toBe('expiring_soon');
    expect(getSafetyCertificateStatus({ status: 'submitted', expiryDate: later })).toBe('valid');
    expect(getSafetyCertificateStatus({ status: 'rejected', expiryDate: later })).toBe('rejected');
    expect(getSafetyCertificateStatus({ status: 'revoked', expiryDate: later })).toBe('revoked');
  });

  it('maps assignment statuses to Vietnamese labels', () => {
    expect(getSafetyAssignmentStatusLabel('eligible')).toBe('Đủ điều kiện');
    expect(getSafetyAssignmentStatusLabel('missing_profile')).toBe('Thiếu hồ sơ');
    expect(getSafetyAssignmentStatusLabel('expired_certificate')).toBe('Hết hạn chứng chỉ');
    expect(getSafetyAssignmentStatusLabel('missing_site_requirement')).toBe('Thiếu yêu cầu công trình');
  });

  it('builds the internal QR route for safety cards', () => {
    expect(buildSafetyCardQrPath('abc123')).toBe('/safety-card/abc123');
  });
});
