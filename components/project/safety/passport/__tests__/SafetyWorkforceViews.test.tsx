import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  dashboard: vi.fn(),
  roster: vi.fn(),
  active: vi.fn(),
  options: vi.fn(),
  detail: vi.fn(),
}));

vi.mock('../../../../../hooks/useSafetyWorkforce', () => ({
  useSafetyDashboard: hookMocks.dashboard,
  useSafetyRoster: hookMocks.roster,
  useSafetyActiveWorkforce: hookMocks.active,
  useSafetyWorkforceOptions: hookMocks.options,
  useSafetyWorkerDetail: hookMocks.detail,
}));

import SafetyPassportPanel from '../../SafetyPassportPanel';
import SafetyPassportWorkerDetailModal from '../../SafetyPassportWorkerDetailModal';
import { SafetyPassportDashboardContent } from '../SafetyPassportDashboardView';
import { SafetyWorkerRosterContent } from '../SafetyWorkerRosterView';
import { SafetyActiveWorkforceContent } from '../SafetyActiveWorkforceView';
import {
  filterSafetyTeamsBySubcontractor,
  SafetyWorkerProfileForm,
  validateSafetyWorkerProfileInput,
} from '../SafetyWorkerProfileForm';
import {
  canOfferSafetyTransfer,
  SafetyWorkerAssignmentDialog,
  selectableAssignmentCandidates,
  validateSafetyAssignmentEnd,
} from '../SafetyWorkerAssignmentDialog';
import {
  canIssueSafetyCard,
  isFutureSafetyCardExpiry,
  SafetyWorkerCardSection,
} from '../SafetyWorkerCardSection';
import {
  currentMembershipHistory,
  SafetyWorkerHistory,
} from '../SafetyWorkerHistory';
import SafetyWorkerCertificateSection from '../SafetyWorkerCertificateSection';
import SafetyWorkerReadinessChecklist from '../SafetyWorkerReadinessChecklist';
import SafetyWorkerSiteReadinessSection from '../SafetyWorkerSiteReadinessSection';

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

  it('offers the next active-workforce page when the scoped API returns a cursor', () => {
    const activeMarkup = renderToStaticMarkup(
      <SafetyActiveWorkforceContent
        page={{
          ...rosterPage,
          nextCursor: {
            createdAt: '2026-08-22T00:00:00Z',
            id: 'membership-1',
          },
        }}
        loading={false}
        error={null}
        onRetry={() => undefined}
        onLoadMore={() => undefined}
      />,
    );

    expect(activeMarkup).toContain('Xem thêm');
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

  it('requires a subcontractor for contractor workers and clears it for company staff', () => {
    expect(validateSafetyWorkerProfileInput({
      workerKind: 'contractor_worker',
      fullName: 'Nguyễn Văn Bình',
      subcontractorId: '',
    })).toMatchObject({ subcontractorId: expect.any(String) });
    expect(validateSafetyWorkerProfileInput({
      workerKind: 'company_staff',
      fullName: 'Nguyễn Văn Bình',
      subcontractorId: '',
    })).toEqual({});
  });

  it('limits teams to the selected subcontractor', () => {
    const options = {
      subcontractors: [],
      teams: [
        { id: 'team-a', name: 'Tổ A', code: 'A', status: 'active' as const, subcontractorId: 'sub-a' },
        { id: 'team-b', name: 'Tổ B', code: 'B', status: 'active' as const, subcontractorId: 'sub-b' },
      ],
      certificateTypes: [],
    };

    expect(filterSafetyTeamsBySubcontractor(options, 'sub-a').map(item => item.id)).toEqual(['team-a']);
    expect(filterSafetyTeamsBySubcontractor(options, '')).toEqual([]);
  });

  it('renders both worker kinds and the site-scoped subcontractor source', () => {
    const markup = renderToStaticMarkup(
      <SafetyWorkerProfileForm
        scope={{ userId: 'user-1', projectId: 'project-1', constructionSiteId: 'site-1' }}
        options={{
          subcontractors: [{ id: 'sub-a', name: 'Nhà thầu phụ A', code: 'NTP-A', status: 'active' }],
          teams: [{ id: 'team-a', name: 'Tổ A', code: 'A', status: 'active', subcontractorId: 'sub-a' }],
          certificateTypes: [],
        }}
        optionsLoading={false}
        initialValue={{ workerKind: 'contractor_worker' }}
        onClose={() => undefined}
        onCreated={() => undefined}
      />,
    );

    expect(markup).toContain('Cán bộ công ty');
    expect(markup).toContain('Nhân công nhà thầu');
    expect(markup).toContain('Nhà thầu phụ A');
    expect(markup).not.toContain('Tổ A');
  });

  it('selects only candidate or inactive memberships for a new assignment', () => {
    const active = {
      ...rosterPage.items[0],
      membership: { ...rosterPage.items[0].membership, id: 'membership-active', status: 'active' as const },
      activeAssignment: { id: 'assignment-active', assignmentStatus: 'active' as const },
    } as any;
    const candidate = {
      ...rosterPage.items[0],
      membership: { ...rosterPage.items[0].membership, id: 'membership-candidate', status: 'candidate' as const },
    };
    const inactive = {
      ...rosterPage.items[0],
      membership: { ...rosterPage.items[0].membership, id: 'membership-inactive', status: 'inactive' as const },
    };

    expect(selectableAssignmentCandidates([active, candidate, inactive]).map(item => item.membership.id)).toEqual([
      'membership-candidate',
      'membership-inactive',
    ]);
  });

  it('validates end date and reason and exposes transfer only from RPC capability', () => {
    expect(validateSafetyAssignmentEnd('2026-08-22T08:00:00Z', '2026-08-22T07:00:00Z', '')).toEqual({
      endedAt: expect.any(String),
      reason: expect.any(String),
    });
    expect(canOfferSafetyTransfer({ canTransfer: true, activeAssignmentId: 'assignment-1' } as any)).toBe(true);
    expect(canOfferSafetyTransfer({ canTransfer: false, activeAssignmentId: 'assignment-1' } as any)).toBe(false);
  });

  it('renders assign and end modes with actionable guidance', () => {
    const assignMarkup = renderToStaticMarkup(
      <SafetyWorkerAssignmentDialog
        scope={{ userId: 'user-1', projectId: 'project-1', constructionSiteId: 'site-1' }}
        mode="assign"
        onClose={() => undefined}
        onCompleted={() => undefined}
      />,
    );
    const endMarkup = renderToStaticMarkup(
      <SafetyWorkerAssignmentDialog
        scope={{ userId: 'user-1', projectId: 'project-1', constructionSiteId: 'site-1' }}
        mode="end"
        item={rosterPage.items[0] as any}
        onClose={() => undefined}
        onCompleted={() => undefined}
      />,
    );

    expect(assignMarkup).toContain('Gán nhân công');
    expect(assignMarkup).toContain('Mã nhân công');
    expect(assignMarkup).toContain('CCCD');
    expect(endMarkup).toContain('Kết thúc làm việc');
    expect(endMarkup).toContain('Lý do');
  });

  it('allows card issue only for an active eligible assignment and future expiry', () => {
    expect(canIssueSafetyCard(null)).toBe(false);
    expect(canIssueSafetyCard({ assignmentStatus: 'active', eligibilityStatus: 'missing_profile' } as any)).toBe(false);
    expect(canIssueSafetyCard({ assignmentStatus: 'active', eligibilityStatus: 'eligible' } as any)).toBe(true);
    expect(isFutureSafetyCardExpiry('2000-01-01', new Date('2026-08-22T00:00:00Z'))).toBe(false);
    expect(isFutureSafetyCardExpiry('2026-09-01', new Date('2026-08-22T00:00:00Z'))).toBe(true);
  });

  it('keeps card controls inside worker detail states', () => {
    const detail = {
      rosterItem: rosterPage.items[0],
      profile: { ...rosterPage.items[0].worker, photoAttachment: null, dateOfBirth: null, roleName: null },
      documents: [],
      certificates: [],
      assignments: [],
      cards: [],
      capabilities,
      sensitiveLoaded: false,
    } as any;
    const markup = renderToStaticMarkup(
      <SafetyWorkerCardSection
        scope={{ userId: 'user-1', projectId: 'project-1', constructionSiteId: 'site-1' }}
        detail={detail}
        onChanged={() => undefined}
      />,
    );

    expect(markup).toContain('Thẻ an toàn');
    expect(markup).toContain('Không có phân công đang hoạt động');
  });

  it('renders certificate upload, readiness checklist, and site safety controls in the worker profile', () => {
    const detail = {
      rosterItem: {
        ...rosterPage.items[0],
        profileStatus: 'valid',
        healthStatus: 'valid',
        insuranceStatus: 'valid',
        activeAssignment: {
          id: 'assignment-1',
          assignmentStatus: 'active',
          siteTrainingStatus: 'pending',
          commitmentStatus: 'pending',
          ppeStatus: 'missing',
          toolboxStatus: 'pending',
          eligibilityStatus: 'missing_certificate',
        },
      },
      profile: { ...rosterPage.items[0].worker, photoAttachment: null, dateOfBirth: null, roleName: 'Thợ xây' },
      documents: [],
      certificates: [],
      assignments: [{
        id: 'assignment-1',
        assignmentStatus: 'active',
        siteTrainingStatus: 'pending',
        commitmentStatus: 'pending',
        ppeStatus: 'missing',
        toolboxStatus: 'pending',
        eligibilityStatus: 'missing_certificate',
      }],
      cards: [],
      capabilities,
      sensitiveLoaded: true,
    } as any;
    const scope = { userId: 'user-1', projectId: 'project-1', constructionSiteId: 'site-1' };
    const certificateTypes = [{
      id: 'certificate-type-1', code: 'SAFETY_ORIENTATION', name: 'Huấn luyện an toàn cơ bản',
      isRequiredDefault: true, validityDays: 365, appliesToRoles: [], isActive: true, sortOrder: 1,
    }];

    const certificateMarkup = renderToStaticMarkup(
      <SafetyWorkerCertificateSection
        scope={scope}
        membershipId="membership-1"
        workerId="worker-1"
        certificates={[]}
        certificateTypes={certificateTypes}
        canManage
        onChanged={() => undefined}
      />,
    );
    const checklistMarkup = renderToStaticMarkup(
      <SafetyWorkerReadinessChecklist detail={detail} certificateTypes={certificateTypes} />,
    );
    const siteMarkup = renderToStaticMarkup(
      <SafetyWorkerSiteReadinessSection scope={scope} assignment={detail.assignments[0]} canManage onChanged={() => undefined} />,
    );

    expect(certificateMarkup).toContain('Tải chứng chỉ');
    expect(certificateMarkup).toContain('Huấn luyện an toàn cơ bản');
    expect(checklistMarkup).toContain('Điều kiện cấp thẻ');
    expect(checklistMarkup).toContain('Chứng chỉ bắt buộc');
    expect(siteMarkup).toContain('Yêu cầu an toàn công trường');
    expect(siteMarkup).toContain('Đã huấn luyện tại công trường');
  });

  it('renders history for the current membership only and orders newest first', () => {
    const assignments = [
      { id: 'old', membershipId: 'membership-1', startedAt: '2026-01-01T00:00:00Z', assignmentStatus: 'ended' },
      { id: 'foreign', membershipId: 'membership-2', startedAt: '2027-01-01T00:00:00Z', assignmentStatus: 'ended' },
      { id: 'new', membershipId: 'membership-1', startedAt: '2026-08-01T00:00:00Z', assignmentStatus: 'active' },
    ] as any;
    expect(currentMembershipHistory('membership-1', assignments).map(item => item.id)).toEqual(['new', 'old']);

    const markup = renderToStaticMarkup(
      <SafetyWorkerHistory membershipId="membership-1" assignments={assignments} cards={[]} />,
    );
    expect(markup.indexOf('01/08/2026')).toBeLessThan(markup.indexOf('01/01/2026'));
    expect(markup).not.toContain('2027');
  });

  it('renders basic profile without exposing sensitive data to an unauthorized actor', () => {
    hookMocks.detail.mockImplementation((_scope, membershipId, includeSensitive) => ({
      data: membershipId && !includeSensitive ? {
        rosterItem: rosterPage.items[0],
        profile: {
          ...rosterPage.items[0].worker,
          photoAttachment: null,
          dateOfBirth: null,
          roleName: null,
          identityNumber: '001234567890',
        },
        documents: [],
        certificates: [],
        assignments: [],
        cards: [],
        capabilities: { canViewBasic: true, canManageWorker: false, canVerifyDocuments: false },
        sensitiveLoaded: false,
      } : null,
      loading: false,
      error: null,
      reload: vi.fn(),
    }));

    const markup = renderToStaticMarkup(
      <SafetyPassportWorkerDetailModal
        scope={{ userId: 'user-1', projectId: 'project-1', constructionSiteId: 'site-1' }}
        membershipId="membership-1"
        onClose={() => undefined}
      />,
    );

    expect(markup).toContain('Nguyễn Văn An');
    expect(markup).toContain('********1234');
    expect(markup).not.toContain('001234567890');
    expect(markup).not.toContain('Giấy tờ &amp; chứng chỉ');
    expect(hookMocks.detail).toHaveBeenCalledWith(expect.anything(), null, true);
  });
});
