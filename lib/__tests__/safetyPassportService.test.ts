import { describe, expect, it } from 'vitest';
import {
  buildSafetyProjectWorkerRows,
  buildSafetyCardQrPath,
  getSafetyAssignmentStatusLabel,
  getSafetyCertificateStatus,
  getSafetyWorkerDocumentReadiness,
  maskSafetyIdentityNumber,
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

  it('masks sensitive identity numbers for list views', () => {
    expect(maskSafetyIdentityNumber('042090012995')).toBe('********2995');
    expect(maskSafetyIdentityNumber('123')).toBe('***');
    expect(maskSafetyIdentityNumber(null)).toBe('-');
  });

  it('computes worker document readiness', () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    expect(getSafetyWorkerDocumentReadiness(null)).toBe('missing');
    expect(getSafetyWorkerDocumentReadiness({ status: 'submitted', expiryDate: tomorrow, attachments: [{ id: 'a', name: 'file', url: 'path' }] as any })).toBe('valid');
    expect(getSafetyWorkerDocumentReadiness({ status: 'submitted', expiryDate: yesterday, attachments: [{ id: 'a', name: 'file', url: 'path' }] as any })).toBe('expired');
    expect(getSafetyWorkerDocumentReadiness({ status: 'rejected', attachments: [{ id: 'a', name: 'file', url: 'path' }] as any })).toBe('rejected');
    expect(getSafetyWorkerDocumentReadiness({ status: 'submitted', attachments: [] })).toBe('missing');
  });

  it('builds project worker rows from assignment, worker, contractor, documents, and card', () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const rows = buildSafetyProjectWorkerRows({
      assignments: [{
        id: 'assignment-1',
        workerId: 'worker-1',
        projectId: 'project-1',
        contractorId: 'contractor-1',
        startDate: '2026-06-26',
        siteTrainingStatus: 'completed',
        commitmentStatus: 'signed',
        ppeStatus: 'complete',
        toolboxStatus: 'completed',
        isLocked: false,
        eligibilityStatus: 'eligible',
      } as any],
      workers: [{
        id: 'worker-1',
        workerCode: 'HL2500501',
        fullName: 'Nguyễn Tuấn Anh',
        identityType: 'cccd',
        identityNumber: '042090012995',
        identityAttachments: [{ id: 'id-file', name: 'CCCD', url: 'identity.jpg' }],
        photoAttachment: { id: 'photo', name: 'Ảnh', url: 'photo.jpg' },
        status: 'active',
      } as any],
      contractors: [{ id: 'contractor-1', contractorType: 'team', name: 'Ban chỉ huy', status: 'active' } as any],
      documents: [
        { id: 'health', workerId: 'worker-1', documentType: 'health_check', name: 'Giấy khám', expiryDate: tomorrow, attachments: [{ id: 'h', name: 'h.pdf', url: 'h.pdf' }], status: 'submitted', isRequired: true } as any,
        { id: 'insurance', workerId: 'worker-1', documentType: 'insurance', name: 'Bảo hiểm', expiryDate: tomorrow, attachments: [{ id: 'i', name: 'i.pdf', url: 'i.pdf' }], status: 'submitted', isRequired: true } as any,
      ],
      cards: [{ id: 'card-1', assignmentId: 'assignment-1', workerId: 'worker-1', cardCode: 'SAFE-CARD-00001', qrToken: 'qr', issuedAt: '2026-06-26', expiresAt: tomorrow, status: 'active', printedCount: 0 } as any],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].worker?.fullName).toBe('Nguyễn Tuấn Anh');
    expect(rows[0].contractor?.name).toBe('Ban chỉ huy');
    expect(rows[0].identityNumberMasked).toBe('********2995');
    expect(rows[0].healthStatus).toBe('valid');
    expect(rows[0].insuranceStatus).toBe('valid');
    expect(rows[0].card?.cardCode).toBe('SAFE-CARD-00001');
  });
});
