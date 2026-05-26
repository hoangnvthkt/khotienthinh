import { ProjectSubmissionTarget } from '../types';
import { notificationService } from './notificationService';

export const projectSubmissionService = {
  targetToUpdate(target?: ProjectSubmissionTarget | null) {
    return {
      submittedToUserId: target?.userId || null,
      submittedToName: target?.name || null,
      submittedToPermission: target?.permissionCode || null,
      submissionNote: target?.note || null,
    };
  },

  actionMeta(userId?: string | null, markSubmitted = false) {
    return {
      lastActionBy: userId || null,
      lastActionAt: new Date().toISOString(),
      ...(markSubmitted ? { everSubmitted: true } : {}),
    };
  },

  returnToOwnerUpdate(ownerUserId?: string | null, reason?: string | null) {
    return {
      submittedToUserId: ownerUserId || null,
      submittedToName: null,
      submittedToPermission: 'edit',
      submissionNote: reason || null,
    };
  },

  async notifyTarget(params: {
    target?: ProjectSubmissionTarget | null;
    actorId?: string | null;
    category: string;
    title: string;
    message: string;
    sourceType: string;
    sourceId: string;
    constructionSiteId?: string | null;
    link?: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    if (!params.target?.userId) return;
    await notificationService.notifyProjectUsers({
      recipientIds: [params.target.userId],
      actorId: params.actorId,
      type: 'info',
      category: params.category,
      title: params.title,
      message: params.message,
      severity: 'info',
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      constructionSiteId: params.constructionSiteId || undefined,
      link: params.link,
      metadata: {
        ...(params.metadata || {}),
        submittedToUserId: params.target.userId,
        submittedToName: params.target.name,
        submittedToPermission: params.target.permissionCode,
        submissionNote: params.target.note,
      },
    });
  },
};
