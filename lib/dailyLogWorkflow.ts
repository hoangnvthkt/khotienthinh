import type { DailyLog, DailyLogVolume } from '../types';
import type { ProjectPermissionCode } from './projectStaffService';

export const DAILY_SUMMARY_SOURCE_TYPE = 'member_contributions';

export const getDailyLogWorkflowStatus = (log: DailyLog) => (
  log.status || (log.verified ? 'verified' : 'draft')
);

export const isDailyLogSummaryRow = (log: DailyLog): boolean =>
  log.summarySourceType === DAILY_SUMMARY_SOURCE_TYPE;

export const isDailyLogSummaryEditable = (log?: DailyLog | null): boolean =>
  !!log && isDailyLogSummaryRow(log) && ['draft', 'rejected'].includes(getDailyLogWorkflowStatus(log));

export type DailyLogSourceReviewState = 'waiting_review' | 'included' | 'needs_rereview' | 'returned';

export interface DailyLogSummarySourceSnapshot {
  sourceLogId: string;
  submittedAt: string | null;
  updatedAt: string | null;
  lastActionAt: string | null;
  status: string;
}

interface GetDailyLogSourceReviewStateInput {
  sourceLog: DailyLog;
  included: boolean;
  snapshot?: DailyLogSummarySourceSnapshot | null;
}

const normalizeTimestamp = (value?: string | null): string | null =>
  value && Number.isFinite(Date.parse(value)) ? value : null;

const isNewerTimestamp = (current?: string | null, snapshot?: string | null): boolean => {
  const currentTime = current ? Date.parse(current) : NaN;
  const snapshotTime = snapshot ? Date.parse(snapshot) : NaN;
  if (!Number.isFinite(currentTime) || !Number.isFinite(snapshotTime)) return false;
  return currentTime > snapshotTime;
};

export const buildDailyLogSourceSnapshot = (log: DailyLog): DailyLogSummarySourceSnapshot => ({
  sourceLogId: log.id,
  submittedAt: normalizeTimestamp(log.submittedAt),
  updatedAt: normalizeTimestamp(log.updatedAt),
  lastActionAt: normalizeTimestamp(log.lastActionAt),
  status: getDailyLogWorkflowStatus(log),
});

const isSnapshotLike = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const normalizeSourceSnapshot = (
  sourceLogId: string,
  value: unknown,
): DailyLogSummarySourceSnapshot | null => {
  if (!isSnapshotLike(value)) return null;

  return {
    sourceLogId: typeof value.sourceLogId === 'string' ? value.sourceLogId : sourceLogId,
    submittedAt: typeof value.submittedAt === 'string' ? normalizeTimestamp(value.submittedAt) : null,
    updatedAt: typeof value.updatedAt === 'string' ? normalizeTimestamp(value.updatedAt) : null,
    lastActionAt: typeof value.lastActionAt === 'string' ? normalizeTimestamp(value.lastActionAt) : null,
    status: typeof value.status === 'string' ? value.status : 'submitted',
  };
};

export const getDailyLogSummarySourceSnapshots = (
  metadata?: Record<string, unknown> | null,
): Record<string, DailyLogSummarySourceSnapshot> => {
  const rawSnapshots = metadata?.sourceSnapshots;
  if (!isSnapshotLike(rawSnapshots)) return {};

  return Object.entries(rawSnapshots).reduce<Record<string, DailyLogSummarySourceSnapshot>>((acc, [sourceLogId, value]) => {
    const snapshot = normalizeSourceSnapshot(sourceLogId, value);
    if (snapshot) acc[sourceLogId] = snapshot;
    return acc;
  }, {});
};

export const getDailyLogSourceReviewState = ({
  sourceLog,
  included,
  snapshot,
}: GetDailyLogSourceReviewStateInput): DailyLogSourceReviewState => {
  const sourceStatus = getDailyLogWorkflowStatus(sourceLog);
  if (sourceStatus === 'rejected') return 'returned';
  if (!included) return 'waiting_review';

  // Summaries created before sourceSnapshots existed should remain sendable.
  if (!snapshot) return 'included';
  if (snapshot.status !== sourceStatus) return 'needs_rereview';
  if (isNewerTimestamp(sourceLog.submittedAt, snapshot.submittedAt)) return 'needs_rereview';
  if (isNewerTimestamp(sourceLog.updatedAt, snapshot.updatedAt)) return 'needs_rereview';
  if (isNewerTimestamp(sourceLog.lastActionAt, snapshot.lastActionAt)) return 'needs_rereview';

  return 'included';
};

interface CanReturnDailyLogSourceInput {
  sourceLog: DailyLog;
  sourceSummaryLog?: DailyLog | null;
  userId?: string | null;
  isAdmin: boolean;
  permissions: Iterable<ProjectPermissionCode>;
}

const hasPermission = (permissions: Iterable<ProjectPermissionCode>, code: ProjectPermissionCode): boolean =>
  new Set(permissions).has(code);

export const canReturnDailyLogSource = ({
  sourceLog,
  sourceSummaryLog,
  userId,
  isAdmin,
  permissions,
}: CanReturnDailyLogSourceInput): boolean => {
  if (getDailyLogWorkflowStatus(sourceLog) !== 'submitted') return false;

  const reviewPermission: ProjectPermissionCode = sourceLog.submittedToPermission === 'approve'
    ? 'approve'
    : 'verify';
  if (!isAdmin && !hasPermission(permissions, reviewPermission)) return false;

  if (!isAdmin) {
    if (sourceLog.submittedToUserId && sourceLog.submittedToUserId !== userId) return false;
    if (sourceLog.requestedVerifierId && sourceLog.requestedVerifierId !== userId) return false;
  }

  if (!sourceSummaryLog) return true;
  return isDailyLogSummaryEditable(sourceSummaryLog);
};

const normalizeVolumeKeyPart = (value?: string | null): string =>
  String(value || '').trim().toLowerCase();

const getVolumeKey = (volume: DailyLogVolume): string => {
  if (volume.workBoqItemId) return `work-boq:${volume.workBoqItemId}`;
  if (volume.taskId) return `task:${volume.taskId}`;
  if (volume.contractItemId) return `contract:${volume.contractItemId}`;
  return [
    normalizeVolumeKeyPart(volume.workBoqItemName),
    normalizeVolumeKeyPart(volume.taskName),
    normalizeVolumeKeyPart(volume.contractItemName),
    normalizeVolumeKeyPart(volume.unit),
  ].join('|');
};

const getAttachmentKey = (attachment: NonNullable<DailyLogVolume['attachments']>[number], index: number): string =>
  String(attachment.id || attachment.url || attachment.fileName || attachment.name || index);

export const buildDailyLogSummaryVolumes = (sourceLogs: DailyLog[]): DailyLogVolume[] => {
  const byKey = new Map<string, DailyLogVolume>();

  sourceLogs.forEach(log => {
    (log.volumes || []).forEach(volume => {
      const key = getVolumeKey(volume);
      if (!key.replace(/\|/g, '').trim()) return;

      const current = byKey.get(key);
      if (!current) {
        byKey.set(key, {
          ...volume,
          attachments: volume.attachments ? [...volume.attachments] : undefined,
        });
        return;
      }

      const currentQuantity = Number(current.quantity || 0);
      const nextQuantity = Number(volume.quantity || 0);
      const mergedAttachments = [
        ...(current.attachments || []),
        ...(volume.attachments || []),
      ].filter((attachment, index, list) => {
        const attachmentKey = getAttachmentKey(attachment, index);
        return list.findIndex((item, itemIndex) => getAttachmentKey(item, itemIndex) === attachmentKey) === index;
      });

      byKey.set(key, {
        ...current,
        quantity: Math.max(currentQuantity, nextQuantity),
        note: current.note || volume.note,
        photoUrl: current.photoUrl || volume.photoUrl,
        attachments: mergedAttachments.length > 0 ? mergedAttachments : undefined,
      });
    });
  });

  return Array.from(byKey.values());
};
