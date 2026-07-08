import { describe, expect, it } from 'vitest';
import { buildQualityChecklistForTask, canReviewQualityChecklist } from '../qualityChecklistWorkflow';
import { Role, type ProjectStaff, type QualityChecklist } from '../../types';

describe('quality checklist workflow helpers', () => {
  it('builds a new task checklist as submitted when a reviewer is selected', () => {
    const checklist = buildQualityChecklistForTask({
      code: 'QC-001',
      now: '2026-07-08T03:00:00.000Z',
      params: {
        projectId: 'project-1',
        constructionSiteId: 'site-1',
        taskId: 'task-1',
        title: '1 - Nhà văn phòng - Phần móng',
        workDate: '2026-07-08',
        createdBy: 'creator-1',
      },
      submissionTarget: {
        userId: 'approver-1',
        name: 'Lưu Công Danh',
        permissionCode: 'approve',
        note: 'Kiểm tra giúp em',
      },
    });

    expect(checklist).toMatchObject({
      code: 'QC-001',
      status: 'submitted',
      submittedBy: 'creator-1',
      submittedAt: '2026-07-08T03:00:00.000Z',
      submittedToUserId: 'approver-1',
      submittedToName: 'Lưu Công Danh',
      submittedToPermission: 'approve',
      submissionNote: 'Kiểm tra giúp em',
      everSubmitted: true,
      lastActionBy: 'creator-1',
      lastActionAt: '2026-07-08T03:00:00.000Z',
    });
  });

  it('allows the assigned reviewer or an active project approver to review submitted checklists', () => {
    const checklist = {
      status: 'submitted',
      submittedToUserId: 'approver-1',
    } as QualityChecklist;
    const projectStaff = [
      {
        id: 'staff-2',
        userId: 'approver-2',
        positionId: 'pos-1',
        sortOrder: 1,
        permissions: [{ id: 'perm-1', staffId: 'staff-2', permissionTypeId: 'type-1', isActive: true, permissionCode: 'approve' }],
      },
    ] as ProjectStaff[];

    expect(canReviewQualityChecklist(checklist, { id: 'approver-1', role: Role.EMPLOYEE } as any, [])).toBe(true);
    expect(canReviewQualityChecklist(checklist, { id: 'approver-2', role: Role.EMPLOYEE } as any, projectStaff)).toBe(true);
    expect(canReviewQualityChecklist(checklist, { id: 'viewer-1', role: Role.EMPLOYEE } as any, projectStaff)).toBe(false);
  });
});
