import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  storageFrom: vi.fn(),
  createSignedUrls: vi.fn(),
  upload: vi.fn(),
}));

const cacheMocks = vi.hoisted(() => ({
  getCached: vi.fn(),
  invalidate: vi.fn(),
  setActor: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: {
    rpc: supabaseMocks.rpc,
    storage: { from: supabaseMocks.storageFrom },
  },
}));

vi.mock('../safetyWorkforceCache', async importOriginal => {
  const actual = await importOriginal<typeof import('../safetyWorkforceCache')>();
  return {
    ...actual,
    getSafetyWorkforceCached: cacheMocks.getCached,
    invalidateSafetyWorkforceScope: cacheMocks.invalidate,
    setSafetyWorkforceCacheActor: cacheMocks.setActor,
  };
});

import { safetyWorkforceApi } from '../safetyWorkforceApi';

const scope = {
  userId: 'user-1',
  projectId: 'project-1',
  constructionSiteId: '11111111-1111-4111-8111-111111111111',
};

const capabilities = {
  canViewBasic: true,
  canManageWorker: true,
  canVerifyDocuments: true,
};

const rosterItem = (workerId = 'worker-1', membershipId = 'membership-1', photoPath = 'worker-1/photo/a.jpg') => ({
  membership: {
    id: membershipId,
    workerId,
    projectId: scope.projectId,
    constructionSiteId: scope.constructionSiteId,
    defaultSubcontractorId: null,
    defaultTeamId: null,
    status: 'active',
    firstJoinedAt: '2026-08-22T00:00:00Z',
    lastLeftAt: null,
    source: 'manual',
  },
  worker: {
    id: workerId,
    workerCode: `SW-${workerId}`,
    fullName: `Worker ${workerId}`,
    workerKind: 'company_staff',
    phone: null,
    status: 'active',
    photoStoragePath: photoPath,
  },
  subcontractor: null,
  team: null,
  activeAssignment: null,
  activeCard: null,
  identityNumberMasked: '********1234',
  profileStatus: 'valid',
  healthStatus: 'missing',
  insuranceStatus: 'missing',
});

const rosterPayload = (items = [rosterItem()]) => ({
  items,
  nextCursor: null,
  capabilities,
});

const detailPayload = () => ({
  rosterItem: rosterItem(),
  profile: {
    id: 'worker-1',
    workerCode: 'SW-worker-1',
    fullName: 'Worker worker-1',
    workerKind: 'company_staff',
    phone: null,
    dateOfBirth: null,
    roleName: null,
    status: 'active',
    photoAttachment: {
      name: 'Photo',
      url: 'worker-1/photo/a.jpg',
      storagePath: 'worker-1/photo/a.jpg',
    },
    identityType: 'cccd',
    identityNumber: '001234567890',
    identityIssueDate: null,
    identityIssuePlace: null,
    permanentAddress: null,
  },
  documents: [{
    id: 'document-1',
    workerId: 'worker-1',
    documentType: 'identity_front',
    name: 'CCCD front',
    issueDate: null,
    expiryDate: null,
    attachments: [{
      name: 'CCCD',
      url: 'worker-1/identity/front.pdf',
      storagePath: 'worker-1/identity/front.pdf',
    }],
    status: 'submitted',
    isRequired: true,
    note: null,
    createdBy: null,
  }],
  certificates: [],
  assignments: [],
  cards: [],
  capabilities,
  sensitiveLoaded: true,
});

describe('safetyWorkforceApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cacheMocks.getCached.mockImplementation((_: string, __: number, loader: () => Promise<unknown>) => loader());
    supabaseMocks.storageFrom.mockReturnValue({
      createSignedUrls: supabaseMocks.createSignedUrls,
      upload: supabaseMocks.upload,
    });
    supabaseMocks.createSignedUrls.mockResolvedValue({ data: [], error: null });
    supabaseMocks.upload.mockResolvedValue({ data: { path: 'uploaded/path' }, error: null });
  });

  it('requires explicit scope and sends exact roster RPC parameters', async () => {
    await expect(safetyWorkforceApi.getDashboard({ ...scope, projectId: '' }))
      .rejects.toThrow('SAFETY_SCOPE_REQUIRED');
    expect(supabaseMocks.rpc).not.toHaveBeenCalled();

    supabaseMocks.rpc.mockResolvedValueOnce({ data: rosterPayload(), error: null });
    supabaseMocks.createSignedUrls.mockResolvedValueOnce({
      data: [{ path: 'worker-1/photo/a.jpg', signedUrl: 'https://signed.test/a.jpg' }],
      error: null,
    });

    const result = await safetyWorkforceApi.listRoster(scope, { limit: 50 });

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('list_safety_site_worker_roster', {
      p_project_id: scope.projectId,
      p_construction_site_id: scope.constructionSiteId,
      p_search: null,
      p_membership_status: null,
      p_assignment_status: null,
      p_eligibility_status: null,
      p_document_status: null,
      p_cursor_created_at: null,
      p_cursor_id: null,
      p_limit: 50,
    });
    expect(supabaseMocks.createSignedUrls).toHaveBeenCalledTimes(1);
    expect(supabaseMocks.createSignedUrls).toHaveBeenCalledWith(['worker-1/photo/a.jpg'], 300);
    expect(result.items[0].worker.photoUrl).toBe('https://signed.test/a.jpg');
    expect(cacheMocks.setActor).toHaveBeenCalledWith(scope.userId);
    expect(cacheMocks.getCached.mock.calls[0][0]).toContain('|roster|');
  });

  it('deduplicates roster photo signing and isolates an individual signing failure', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({
      data: rosterPayload([
        rosterItem('worker-1', 'membership-1', 'shared/photo.jpg'),
        rosterItem('worker-2', 'membership-2', 'shared/photo.jpg'),
      ]),
      error: null,
    });
    supabaseMocks.createSignedUrls.mockResolvedValueOnce({
      data: [{ path: 'shared/photo.jpg', signedUrl: null, error: 'not found' }],
      error: null,
    });

    const result = await safetyWorkforceApi.listRoster(scope, { limit: 50 });

    expect(supabaseMocks.createSignedUrls).toHaveBeenCalledWith(['shared/photo.jpg'], 300);
    expect(result.items.map(item => item.worker.photoUrl)).toEqual([null, null]);
  });

  it('batch-signs photo and sensitive detail attachments only after detail parsing', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: detailPayload(), error: null });
    supabaseMocks.createSignedUrls.mockResolvedValueOnce({
      data: [
        { path: 'worker-1/photo/a.jpg', signedUrl: 'https://signed.test/photo' },
        { path: 'worker-1/identity/front.pdf', signedUrl: 'https://signed.test/front' },
      ],
      error: null,
    });

    const result = await safetyWorkforceApi.getDetail(scope, 'membership-1', true);

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('get_safety_site_worker_detail', {
      p_project_id: scope.projectId,
      p_construction_site_id: scope.constructionSiteId,
      p_membership_id: 'membership-1',
      p_include_sensitive: true,
    });
    expect(supabaseMocks.createSignedUrls).toHaveBeenCalledTimes(1);
    expect(supabaseMocks.createSignedUrls).toHaveBeenCalledWith([
      'worker-1/photo/a.jpg',
      'worker-1/identity/front.pdf',
    ], 300);
    expect(result.profile.photoAttachment?.previewUrl).toBe('https://signed.test/photo');
    expect(result.documents[0].attachments[0].previewUrl).toBe('https://signed.test/front');
  });

  it('uses scoped command RPCs and invalidates the correct resource groups', async () => {
    supabaseMocks.rpc.mockResolvedValue({ data: detailPayload(), error: null });

    await safetyWorkforceApi.createProfile(scope, {
      workerKind: 'company_staff',
      profile: { fullName: 'Nguyễn Văn A', identityType: 'cccd' },
      subcontractorId: null,
      teamId: null,
    });
    expect(supabaseMocks.rpc).toHaveBeenLastCalledWith('create_safety_worker_profile_for_site', {
      p_project_id: scope.projectId,
      p_construction_site_id: scope.constructionSiteId,
      p_worker_kind: 'company_staff',
      p_profile: { fullName: 'Nguyễn Văn A', identityType: 'cccd' },
      p_subcontractor_id: null,
      p_team_id: null,
    });
    expect(cacheMocks.invalidate).toHaveBeenCalledWith(scope, ['roster', 'detail', 'dashboard']);

    await safetyWorkforceApi.assign(scope, {
      membershipId: 'membership-1',
      startedAt: '2026-08-22T00:00:00Z',
      subcontractorId: null,
      teamId: null,
      roleName: 'Kỹ sư',
      workType: 'Giám sát',
    });
    expect(supabaseMocks.rpc).toHaveBeenLastCalledWith('assign_safety_worker_to_site', {
      p_membership_id: 'membership-1',
      p_started_at: '2026-08-22T00:00:00Z',
      p_subcontractor_id: null,
      p_team_id: null,
      p_assignment: { roleName: 'Kỹ sư', workType: 'Giám sát' },
    });
    expect(cacheMocks.invalidate).toHaveBeenCalledWith(scope, ['roster', 'active', 'detail', 'dashboard']);
  });

  it('invalidates both source and destination scopes after an atomic transfer', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: detailPayload(), error: null });
    const sourceScope = {
      ...scope,
      projectId: 'project-source',
      constructionSiteId: '22222222-2222-4222-8222-222222222222',
    };

    await safetyWorkforceApi.transfer(scope, {
      assignmentId: 'assignment-1',
      sourceProjectId: sourceScope.projectId,
      sourceConstructionSiteId: sourceScope.constructionSiteId,
      targetProjectId: scope.projectId,
      targetConstructionSiteId: scope.constructionSiteId,
      startedAt: '2026-08-22T02:00:00Z',
      subcontractorId: null,
      teamId: null,
    });

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('transfer_safety_worker_site', {
      p_assignment_id: 'assignment-1',
      p_target_project_id: scope.projectId,
      p_target_construction_site_id: scope.constructionSiteId,
      p_started_at: '2026-08-22T02:00:00Z',
      p_subcontractor_id: null,
      p_team_id: null,
    });
    expect(cacheMocks.invalidate).toHaveBeenCalledWith(sourceScope, ['roster', 'active', 'detail', 'dashboard']);
    expect(cacheMocks.invalidate).toHaveBeenCalledWith(scope, ['roster', 'active', 'detail', 'dashboard']);
  });

  it('uploads under a durable worker folder and never calls legacy global loaders', async () => {
    const file = new File(['identity'], 'CCCD mặt trước.jpg', { type: 'image/jpeg' });
    const result = await safetyWorkforceApi.uploadWorkerAttachment('worker-1', 'identity', file);

    const uploadedPath = supabaseMocks.upload.mock.calls[0][0] as string;
    expect(uploadedPath).toMatch(/^worker-1\/identity\/[0-9a-f-]+-CCCD-mat-truoc\.jpg$/);
    expect(supabaseMocks.upload).toHaveBeenCalledWith(uploadedPath, file, {
      upsert: false,
      contentType: 'image/jpeg',
    });
    expect(result).toMatchObject({
      name: 'CCCD mặt trước.jpg',
      fileName: 'CCCD mặt trước.jpg',
      storagePath: 'uploaded/path',
      url: 'uploaded/path',
      category: 'identity',
    });

    const source = await import('node:fs').then(fs => fs.readFileSync(
      new URL('../safetyWorkforceApi.ts', import.meta.url),
      'utf8',
    ));
    for (const legacyCall of [
      'listWorkers(',
      'listProjectWorkerRows(',
      'listCards(',
      'assignWorkerToProject(',
      'saveWorkerDetail(',
    ]) {
      expect(source).not.toContain(legacyCall);
    }
  });
});
