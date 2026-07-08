import {
  ProjectStaff,
  ProjectSubmissionTarget,
  QualityChecklist,
  Role,
  User,
} from '../types';

export interface BuildQualityChecklistForTaskInput {
  code: string;
  now: string;
  params: {
    projectId: string;
    constructionSiteId: string;
    taskId: string;
    title: string;
    workDescription?: string;
    workLocation?: string;
    workDate?: string;
    workSupervisor?: string;
    sitePhotos?: QualityChecklist['sitePhotos'];
    attachments?: QualityChecklist['attachments'];
    note?: string;
    createdBy?: string;
  };
  submissionTarget?: ProjectSubmissionTarget | null;
}

const targetToChecklistFields = (target: ProjectSubmissionTarget | null | undefined) => ({
  submittedToUserId: target?.userId || null,
  submittedToName: target?.name || null,
  submittedToPermission: target?.permissionCode || null,
  submissionNote: target?.note || null,
});

export const buildQualityChecklistForTask = ({
  code,
  now,
  params,
  submissionTarget,
}: BuildQualityChecklistForTaskInput): Partial<QualityChecklist> => {
  const isSubmitted = !!submissionTarget;

  return {
    constructionSiteId: params.constructionSiteId,
    projectId: params.projectId,
    taskId: params.taskId,
    contractItemId: null,
    dailyLogId: null,
    templateId: null,
    workTypeId: null,
    code,
    title: params.title || code,
    templateCode: undefined,
    templateName: undefined,
    templateVersion: undefined,
    workDescription: params.workDescription,
    workLocation: params.workLocation,
    workDate: params.workDate || new Date(now).toISOString().slice(0, 10),
    workSupervisor: params.workSupervisor,
    checklistData: [],
    sitePhotos: params.sitePhotos || [],
    attachments: params.attachments || [],
    status: isSubmitted ? 'submitted' : 'draft',
    currentAttempt: 1,
    totalCriteria: 0,
    passedCriteria: 0,
    failedCriteria: 0,
    inspectionResult: undefined,
    note: params.note,
    createdBy: params.createdBy,
    ...(isSubmitted
      ? {
        submittedBy: params.createdBy || null,
        submittedAt: now,
        everSubmitted: true,
        lastActionBy: params.createdBy || null,
        lastActionAt: now,
        ...targetToChecklistFields(submissionTarget),
      }
      : {}),
  };
};

const userReviewKeys = (user?: Pick<User, 'id' | 'authId' | 'name' | 'username' | 'email' | 'role'> | null) =>
  new Set([user?.id, user?.authId, user?.name, user?.username, user?.email].filter(Boolean) as string[]);

const staffHasPermission = (staff: ProjectStaff, permissionCode: string) =>
  !staff.endDate &&
  staff.permissions?.some(permission =>
    permission.isActive &&
    permission.permissionCode === permissionCode
  );

export const canReviewQualityChecklist = (
  checklist: Pick<QualityChecklist, 'status' | 'submittedToUserId'>,
  user?: Pick<User, 'id' | 'authId' | 'name' | 'username' | 'email' | 'role'> | null,
  projectStaff: ProjectStaff[] = [],
) => {
  if (!user || checklist.status !== 'submitted') return false;
  if (user.role === Role.ADMIN) return true;

  const keys = userReviewKeys(user);
  if (checklist.submittedToUserId && keys.has(checklist.submittedToUserId)) return true;

  return projectStaff.some(staff => keys.has(staff.userId) && staffHasPermission(staff, 'approve'));
};
