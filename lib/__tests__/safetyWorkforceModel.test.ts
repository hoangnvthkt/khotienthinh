import { describe, expect, it } from 'vitest';

const modulePath = '../safetyWorkforceModel';

const loadModel = async () => {
  try {
    return await import(/* @vite-ignore */ modulePath);
  } catch {
    return null;
  }
};

const membership = {
  id: 'membership-1',
  workerId: 'worker-1',
  projectId: 'project-1',
  constructionSiteId: 'site-1',
  defaultSubcontractorId: null,
  defaultTeamId: null,
  status: 'active',
  firstJoinedAt: '2026-08-21T00:00:00Z',
  lastLeftAt: null,
  source: 'manual',
};

const worker = {
  id: 'worker-1',
  workerCode: 'W-001',
  fullName: 'Nguyễn Văn A',
  workerKind: 'contractor_worker',
  phone: '0900000000',
  status: 'active',
  photoStoragePath: 'worker-1/photo/avatar.jpg',
};

const rosterItem = {
  membership,
  worker,
  subcontractor: null,
  team: null,
  activeAssignment: null,
  activeCard: null,
  identityNumberMasked: '********1234',
  profileStatus: 'valid',
  healthStatus: 'missing',
  insuranceStatus: 'missing',
};

describe('safetyWorkforceModel', () => {
  it('loads the scoped model boundary', async () => {
    // Break caught: deleting the standalone domain model must fail independently
    // from any Project page or component.
    expect(await loadModel()).not.toBeNull();
  });

  it('parses a scoped roster without copying sensitive or unknown worker fields', async () => {
    const model = await loadModel();
    expect(model).not.toBeNull();

    const page = model!.parseSafetyWorkerRosterPage({
      items: [{
        ...rosterItem,
        worker: {
          ...worker,
          identityNumber: '012345678901',
          identityAttachments: [{ storagePath: 'secret/cccd.jpg' }],
          unexpected: 'must-not-leak',
        },
      }],
      nextCursor: { createdAt: '2026-08-21T00:00:00Z', id: 'membership-1' },
      capabilities: { canViewBasic: true, canManageWorker: false, canVerifyDocuments: false },
    });

    expect(page.items[0].worker).toEqual({
      id: 'worker-1',
      workerCode: 'W-001',
      fullName: 'Nguyễn Văn A',
      workerKind: 'contractor_worker',
      phone: '0900000000',
      status: 'active',
      photoStoragePath: 'worker-1/photo/avatar.jpg',
    });
    expect(page.items[0].worker).not.toHaveProperty('identityNumber');
    expect(page.items[0].worker).not.toHaveProperty('identityAttachments');
    expect(page.items[0].worker).not.toHaveProperty('unexpected');
    expect(page.nextCursor).toEqual({ createdAt: '2026-08-21T00:00:00Z', id: 'membership-1' });
  });

  it('rejects roster rows without the canonical site scope', async () => {
    const model = await loadModel();
    expect(model).not.toBeNull();

    expect(() => model!.parseSafetyWorkerRosterPage({
      items: [{
        ...rosterItem,
        membership: { ...membership, constructionSiteId: '' },
      }],
      capabilities: { canViewBasic: true, canManageWorker: false, canVerifyDocuments: false },
    })).toThrow('SAFETY_INVALID_RPC_PAYLOAD');
  });

  it('normalizes dashboard arrays and required numeric counters', async () => {
    const model = await loadModel();
    expect(model).not.toBeNull();

    expect(model!.parseSafetyWorkforceDashboard({
      totalWorkers: 12,
      activeAssignments: 10,
      eligibleAssignments: 8,
      missingProfile: 1,
      missingCertificate: 2,
      expiredCertificate: 3,
      missingSiteRequirement: 4,
      suspendedAssignments: 1,
      expiringCertificates7Days: 2,
      expiringCertificates30Days: 5,
      expiredCertificates: 3,
      expiringCards30Days: 4,
    })).toEqual({
      totalWorkers: 12,
      activeAssignments: 10,
      eligibleAssignments: 8,
      missingProfile: 1,
      missingCertificate: 2,
      expiredCertificate: 3,
      missingSiteRequirement: 4,
      suspendedAssignments: 1,
      expiringCertificates7Days: 2,
      expiringCertificates30Days: 5,
      expiredCertificates: 3,
      expiringCards30Days: 4,
      problematicSubcontractors: [],
    });
  });

  it('defaults omitted detail collections and preserves the sensitive-load marker', async () => {
    const model = await loadModel();
    expect(model).not.toBeNull();

    const detail = model!.parseSafetyWorkerDetailPayload({
      rosterItem,
      profile: {
        id: 'worker-1',
        workerCode: 'W-001',
        fullName: 'Nguyễn Văn A',
        workerKind: 'contractor_worker',
        phone: null,
        dateOfBirth: null,
        roleName: 'Thợ sơn',
        status: 'active',
        photoAttachment: null,
      },
      capabilities: { canViewBasic: true, canManageWorker: true, canVerifyDocuments: false },
      sensitiveLoaded: false,
    });

    expect(detail.documents).toEqual([]);
    expect(detail.certificates).toEqual([]);
    expect(detail.assignments).toEqual([]);
    expect(detail.cards).toEqual([]);
    expect(detail.sensitiveLoaded).toBe(false);
  });

  it('normalizes legacy snake_case attachment metadata so the storage object can be read again', async () => {
    const model = await loadModel();
    expect(model).not.toBeNull();

    const detail = model!.parseSafetyWorkerDetailPayload({
      rosterItem,
      profile: {
        id: 'worker-1',
        workerCode: 'W-001',
        fullName: 'Nguyễn Văn A',
        workerKind: 'contractor_worker',
        phone: null,
        dateOfBirth: null,
        roleName: null,
        status: 'active',
        photoAttachment: null,
      },
      documents: [{
        id: 'document-1',
        workerId: 'worker-1',
        documentType: 'identity_front',
        name: 'CCCD mặt trước',
        issueDate: null,
        expiryDate: null,
        attachments: [{
          id: 'attachment-1',
          name: 'CCCD cũ',
          file_name: 'cccd-cu.jpg',
          file_type: 'image/jpeg',
          file_size: 28743,
          storage_path: 'draft/identity_front/cccd-cu.jpg',
          url: 'https://expired.test/cccd-cu.jpg',
          preview_url: 'https://expired.test/cccd-cu.jpg',
          uploaded_at: '2026-06-30T02:07:23.169Z',
          uploaded_by: 'Nguyễn Văn Thanh',
        }],
        status: 'submitted',
        isRequired: true,
        note: null,
        createdBy: null,
      }],
      capabilities: { canViewBasic: true, canManageWorker: true, canVerifyDocuments: true },
      sensitiveLoaded: true,
    });

    expect(detail.documents[0].attachments[0]).toMatchObject({
      fileName: 'cccd-cu.jpg',
      fileType: 'image/jpeg',
      fileSize: 28743,
      storagePath: 'draft/identity_front/cccd-cu.jpg',
      previewUrl: 'https://expired.test/cccd-cu.jpg',
      uploadedAt: '2026-06-30T02:07:23.169Z',
      uploadedBy: 'Nguyễn Văn Thanh',
    });
  });

  it('defaults omitted site master arrays without inventing options', async () => {
    const model = await loadModel();
    expect(model).not.toBeNull();

    expect(model!.parseSafetySiteWorkforceOptions({})).toEqual({
      subcontractors: [],
      teams: [],
      certificateTypes: [],
    });
  });

  it('parses active certificate types returned with scoped site options', async () => {
    const model = await loadModel();
    expect(model).not.toBeNull();

    expect(model!.parseSafetySiteWorkforceOptions({
      certificateTypes: [{
        id: 'certificate-type-1', code: 'SAFETY_ORIENTATION', name: 'Huấn luyện an toàn cơ bản',
        isRequiredDefault: true, validityDays: null, appliesToRoles: [], isActive: true, sortOrder: 0,
      }],
    }).certificateTypes).toEqual([{
      id: 'certificate-type-1', code: 'SAFETY_ORIENTATION', name: 'Huấn luyện an toàn cơ bản',
      isRequiredDefault: true, validityDays: null, appliesToRoles: [], isActive: true, sortOrder: 0,
    }]);
  });

  it('parses the minimal source scope needed for an authorized transfer', async () => {
    const model = await loadModel();
    expect(model).not.toBeNull();

    expect(model!.parseSafetyWorkerLookupResult({
      workerId: 'worker-1',
      workerCode: 'SW-001',
      fullName: 'Nguyễn Văn A',
      workerKind: 'contractor_worker',
      identityNumberMasked: '********7890',
      targetMembershipId: null,
      activeAssignmentId: 'assignment-1',
      activeProjectId: 'project-source',
      activeConstructionSiteId: 'site-source',
      activeSiteName: 'Công trường nguồn',
      canTransfer: true,
    })).toMatchObject({
      workerKind: 'contractor_worker',
      activeProjectId: 'project-source',
      activeConstructionSiteId: 'site-source',
    });
  });

  it('extracts stable business codes from Supabase message or detail', async () => {
    const model = await loadModel();
    expect(model).not.toBeNull();

    expect(model!.parseSafetyWorkforceError({
      message: 'SAFETY_WORKER_ACTIVE_ELSEWHERE: worker is assigned',
    })).toEqual({
      code: 'SAFETY_WORKER_ACTIVE_ELSEWHERE',
      message: 'SAFETY_WORKER_ACTIVE_ELSEWHERE: worker is assigned',
    });
    expect(model!.parseSafetyWorkforceError({
      message: 'Database error',
      details: 'SAFETY_TEAM_SCOPE_MISMATCH: invalid team',
    })).toEqual({
      code: 'SAFETY_TEAM_SCOPE_MISMATCH',
      message: 'Database error',
    });
    expect(model!.parseSafetyWorkforceError(new Error('unexpected'))).toEqual({
      code: 'UNKNOWN',
      message: 'unexpected',
    });
  });
});
