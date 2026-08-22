import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  dashboard: vi.fn(),
  roster: vi.fn(),
  active: vi.fn(),
}));

vi.mock('../../../../../hooks/useSafetyWorkforce', () => ({
  useSafetyDashboard: hookMocks.dashboard,
  useSafetyRoster: hookMocks.roster,
  useSafetyActiveWorkforce: hookMocks.active,
}));

import SafetyPassportPanel from '../../SafetyPassportPanel';
import { SafetyPassportDashboardContent } from '../SafetyPassportDashboardView';
import { SafetyWorkerRosterContent } from '../SafetyWorkerRosterView';
import { SafetyActiveWorkforceContent } from '../SafetyActiveWorkforceView';

const capabilities = {
  canViewBasic: true,
  canManageWorker: true,
  canVerifyDocuments: true,
};

const rosterPage = {
  items: [{
    membership: {
      id: 'membership-1',
      workerId: 'worker-1',
      projectId: 'project-1',
      constructionSiteId: 'site-1',
      defaultSubcontractorId: null,
      defaultTeamId: null,
      status: 'active' as const,
      firstJoinedAt: '2026-08-22T00:00:00Z',
      lastLeftAt: null,
      source: 'manual' as const,
    },
    worker: {
      id: 'worker-1',
      workerCode: 'SW-001',
      fullName: 'Nguyễn Văn An',
      workerKind: 'company_staff' as const,
      phone: '0900000001',
      status: 'active' as const,
      photoStoragePath: null,
      photoUrl: null,
    },
    subcontractor: null,
    team: null,
    activeAssignment: null,
    activeCard: null,
    identityNumberMasked: '********1234',
    profileStatus: 'valid' as const,
    healthStatus: 'missing' as const,
    insuranceStatus: 'missing' as const,
  }],
  nextCursor: null,
  capabilities,
};

describe('Safety Workforce scoped views', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the four dashboard decisions from scoped aggregate data', () => {
    const markup = renderToStaticMarkup(
      <SafetyPassportDashboardContent
        data={{
          totalWorkers: 54,
          activeAssignments: 54,
          eligibleAssignments: 12,
          missingProfile: 40,
          missingCertificate: 1,
          expiredCertificate: 0,
          missingSiteRequirement: 1,
          suspendedAssignments: 0,
          expiringCertificates7Days: 2,
          expiringCertificates30Days: 4,
          expiredCertificates: 0,
          expiringCards30Days: 3,
          problematicSubcontractors: [],
        }}
        loading={false}
        error={null}
        onRetry={() => undefined}
      />,
    );

    expect(markup).toContain('Nhân công');
    expect(markup).toContain('Đang tham gia');
    expect(markup).toContain('Đủ điều kiện');
    expect(markup).toContain('Cần xử lý');
    expect(markup).toContain('54');
  });

  it('renders roster and active branches from already-scoped rows', () => {
    const rosterMarkup = renderToStaticMarkup(
      <SafetyWorkerRosterContent
        page={rosterPage}
        loading={false}
        error={null}
        onRetry={() => undefined}
      />,
    );
    const activeMarkup = renderToStaticMarkup(
      <SafetyActiveWorkforceContent
        page={rosterPage}
        loading={false}
        error={null}
        onRetry={() => undefined}
      />,
    );

    expect(rosterMarkup).toContain('Hồ sơ nhân công');
    expect(rosterMarkup).toContain('Nguyễn Văn An');
    expect(activeMarkup).toContain('Nhân công công trường');
    expect(activeMarkup).toContain('SW-001');
  });

  it('does not mount any data view when construction site scope is missing', () => {
    const markup = renderToStaticMarkup(
      <SafetyPassportPanel
        mode="passport"
        projectId="project-1"
        constructionSiteId={null}
        currentUser={{ id: 'user-1' } as any}
      />,
    );

    expect(markup).toContain('Chưa chọn công trường');
    expect(hookMocks.dashboard).not.toHaveBeenCalled();
    expect(hookMocks.roster).not.toHaveBeenCalled();
    expect(hookMocks.active).not.toHaveBeenCalled();
  });
});
