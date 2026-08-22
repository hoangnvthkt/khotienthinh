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

  it('defaults omitted site master arrays without inventing options', async () => {
    const model = await loadModel();
    expect(model).not.toBeNull();

    expect(model!.parseSafetySiteWorkforceOptions({})).toEqual({
      subcontractors: [],
      teams: [],
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
