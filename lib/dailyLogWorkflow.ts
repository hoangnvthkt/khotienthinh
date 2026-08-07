import type {
  DailyLog,
  DailyLogLabor,
  DailyLogMachine,
  DailyLogVolume,
} from '../types';

export const DAILY_SUMMARY_SOURCE_TYPE = 'member_contributions';

export const getDailyLogWorkflowStatus = (log: DailyLog) => (
  log.status || (log.verified ? 'verified' : 'draft')
);

export const isDailyLogSummaryRow = (log: DailyLog): boolean =>
  log.summarySourceType === DAILY_SUMMARY_SOURCE_TYPE;

export const isDailyLogSummaryEditable = (log?: DailyLog | null): boolean =>
  !!log && isDailyLogSummaryRow(log) && ['draft', 'rejected'].includes(getDailyLogWorkflowStatus(log));

export type DailyLogSourceReviewState = 'waiting_review' | 'included' | 'needs_rereview' | 'returned';

export interface DailyLogSummarySourceLogOptions {
  canReviewSources: boolean;
  currentUserId?: string | null;
  sourceSummaryLogIds?: Iterable<string>;
}

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

const isSubmittedDailyLogDetailSource = (log: DailyLog): boolean =>
  !isDailyLogSummaryRow(log) &&
  getDailyLogWorkflowStatus(log) === 'submitted' &&
  (log.submittedToPermission || 'verify') !== 'approve';

const isReturnedDailyLogDetailSource = (log: DailyLog): boolean =>
  !isDailyLogSummaryRow(log) &&
  getDailyLogWorkflowStatus(log) === 'rejected' &&
  Boolean(log.everSubmitted || log.rejectedAt || log.submittedAt);

const isDraftDailyLogDetailSource = (log: DailyLog): boolean =>
  !isDailyLogSummaryRow(log) && getDailyLogWorkflowStatus(log) === 'draft';

export const getDailyLogSummarySourceLogs = (
  dayLogs: DailyLog[],
  options: DailyLogSummarySourceLogOptions,
): DailyLog[] => {
  const linkedSourceIds = new Set(options.sourceSummaryLogIds || []);
  const seen = new Set<string>();

  return dayLogs.filter(log => {
    if (isDailyLogSummaryRow(log) || seen.has(log.id)) return false;

    const alreadyLinkedToSummary = linkedSourceIds.has(log.id);
    const isSource = alreadyLinkedToSummary ||
      isSubmittedDailyLogDetailSource(log) ||
      (options.canReviewSources && (
        isDraftDailyLogDetailSource(log) ||
        isReturnedDailyLogDetailSource(log)
      ));

    if (!isSource) return false;
    seen.add(log.id);
    return true;
  });
};

export const getDefaultDailyLogSummaryApprover = <T extends { userId?: string }>(_approvers: T[]): T | null => null;

interface CanReturnDailyLogSourceInput {
  sourceLog: DailyLog;
  sourceSummaryLog?: DailyLog | null;
  userId?: string | null;
  isAdmin: boolean;
  permissions: Iterable<string>;
}

const hasPermission = (permissions: Iterable<string>, code: string): boolean =>
  new Set(permissions).has(code);

export const canReturnDailyLogSource = ({
  sourceLog,
  sourceSummaryLog,
  userId,
  isAdmin,
  permissions,
}: CanReturnDailyLogSourceInput): boolean => {
  if (getDailyLogWorkflowStatus(sourceLog) !== 'submitted') return false;

  if (!isAdmin && !hasPermission(permissions, 'project.daily_log.return')) return false;

  if (!isAdmin) {
    if (sourceLog.submittedToUserId && sourceLog.submittedToUserId !== userId) return false;
    if (sourceLog.requestedVerifierId && sourceLog.requestedVerifierId !== userId) return false;
  }

  if (!sourceSummaryLog) return true;
  return isDailyLogSummaryEditable(sourceSummaryLog);
};

const normalizeSummaryKeyPart = (value?: string | null): string =>
  String(value || '').trim().toLowerCase();

const getVolumeKey = (volume: DailyLogVolume): string => {
  const identity = volume.workBoqItemId
    ? `work-boq:${volume.workBoqItemId}`
    : volume.taskId
      ? `task:${volume.taskId}`
      : volume.contractItemId
        ? `contract:${volume.contractItemId}`
        : [
          normalizeSummaryKeyPart(volume.workBoqItemName),
          normalizeSummaryKeyPart(volume.taskName),
          normalizeSummaryKeyPart(volume.contractItemName),
        ].join('|');
  return `${identity}|unit:${normalizeSummaryKeyPart(volume.unit)}`;
};

const mergeVolumeAttachments = (
  attachments: NonNullable<DailyLogVolume['attachments']>,
): NonNullable<DailyLogVolume['attachments']> => {
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  return attachments.filter(attachment => {
    const duplicate = Boolean(
      (attachment.id && seenIds.has(attachment.id))
      || (attachment.url && seenUrls.has(attachment.url)),
    );
    if (duplicate) return false;
    if (attachment.id) seenIds.add(attachment.id);
    if (attachment.url) seenUrls.add(attachment.url);
    return true;
  });
};

const toFiniteNumber = (value: unknown): number => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const firstNonEmptyText = (current?: string, next?: string): string | undefined =>
  current?.trim() ? current : next?.trim() ? next : undefined;

const firstDefinedNumber = (current?: number, next?: number): number | undefined =>
  Number.isFinite(current) ? current : Number.isFinite(next) ? next : undefined;

const sumDefinedNumber = (current?: number, next?: number): number | undefined => {
  const hasCurrent = Number.isFinite(current);
  const hasNext = Number.isFinite(next);
  if (!hasCurrent && !hasNext) return undefined;
  return (hasCurrent ? Number(current) : 0) + (hasNext ? Number(next) : 0);
};

const buildSummaryVolumes = (sourceLogs: DailyLog[]): DailyLogVolume[] => {
  const byKey = new Map<string, DailyLogVolume>();

  sourceLogs.forEach(log => {
    (log.volumes || []).forEach(volume => {
      const key = getVolumeKey(volume);
      if (!key.replace(/[|:]/g, '').replace('unit', '').trim()) return;

      const current = byKey.get(key);
      if (!current) {
        byKey.set(key, {
          ...volume,
          quantity: toFiniteNumber(volume.quantity),
          attachments: volume.attachments ? [...volume.attachments] : undefined,
        });
        return;
      }

      const mergedAttachments = mergeVolumeAttachments([
        ...(current.attachments || []),
        ...(volume.attachments || []),
      ]);

      byKey.set(key, {
        ...current,
        quantity: toFiniteNumber(current.quantity) + toFiniteNumber(volume.quantity),
        note: firstNonEmptyText(current.note, volume.note),
        photoUrl: firstNonEmptyText(current.photoUrl, volume.photoUrl),
        attachments: mergedAttachments.length > 0 ? mergedAttachments : undefined,
      });
    });
  });

  return Array.from(byKey.values());
};

const getTaskKey = (taskId?: string, taskName?: string): string =>
  taskId ? `task:${taskId}` : `task-name:${normalizeSummaryKeyPart(taskName)}`;

const getPartnerKey = (partnerId?: string, partnerName?: string): string =>
  partnerId ? `partner:${partnerId}` : `partner-name:${normalizeSummaryKeyPart(partnerName)}`;

const getLaborKey = (labor: DailyLogLabor): string => {
  const identity = labor.catalogItemId
    ? `catalog:${labor.catalogItemId}`
    : labor.catalogCode
      ? `catalog-code:${normalizeSummaryKeyPart(labor.catalogCode)}`
      : `labor:${[
        normalizeSummaryKeyPart(labor.catalogName),
        normalizeSummaryKeyPart(labor.laborType),
        normalizeSummaryKeyPart(labor.groupName),
      ].join('|')}`;
  return [
    getTaskKey(labor.taskId, labor.taskName),
    identity,
    getPartnerKey(labor.partnerId, labor.partnerName),
    `unit:${normalizeSummaryKeyPart(labor.unit)}`,
  ].join('|');
};

const buildSummaryLabor = (sourceLogs: DailyLog[]): DailyLogLabor[] => {
  const byKey = new Map<string, DailyLogLabor>();

  sourceLogs.forEach(log => {
    (log.laborDetails || []).forEach(labor => {
      const key = getLaborKey(labor);
      const current = byKey.get(key);
      if (!current) {
        byKey.set(key, {
          ...labor,
          count: toFiniteNumber(labor.count),
          hours: toFiniteNumber(labor.hours),
        });
        return;
      }

      byKey.set(key, {
        ...current,
        count: toFiniteNumber(current.count) + toFiniteNumber(labor.count),
        hours: toFiniteNumber(current.hours) + toFiniteNumber(labor.hours),
        unitCost: firstDefinedNumber(current.unitCost, labor.unitCost),
        totalCost: sumDefinedNumber(current.totalCost, labor.totalCost),
        note: firstNonEmptyText(current.note, labor.note),
      });
    });
  });

  return Array.from(byKey.values());
};

const getMachineKey = (machine: DailyLogMachine): string => {
  const identity = machine.catalogItemId
    ? `catalog:${machine.catalogItemId}`
    : machine.catalogCode
      ? `catalog-code:${normalizeSummaryKeyPart(machine.catalogCode)}`
      : `machine:${[
        normalizeSummaryKeyPart(machine.catalogName),
        normalizeSummaryKeyPart(machine.machineName),
        normalizeSummaryKeyPart(machine.machineType),
        normalizeSummaryKeyPart(machine.groupName),
      ].join('|')}`;
  return [
    getTaskKey(machine.taskId, machine.taskName),
    identity,
    getPartnerKey(machine.partnerId, machine.partnerName),
    `unit:${normalizeSummaryKeyPart(machine.unit)}`,
  ].join('|');
};

const buildSummaryMachines = (sourceLogs: DailyLog[]): DailyLogMachine[] => {
  const byKey = new Map<string, DailyLogMachine>();

  sourceLogs.forEach(log => {
    (log.machines || []).forEach(machine => {
      const key = getMachineKey(machine);
      const current = byKey.get(key);
      if (!current) {
        byKey.set(key, {
          ...machine,
          shifts: toFiniteNumber(machine.shifts),
          hours: toFiniteNumber(machine.hours),
        });
        return;
      }

      byKey.set(key, {
        ...current,
        shifts: toFiniteNumber(current.shifts) + toFiniteNumber(machine.shifts),
        hours: toFiniteNumber(current.hours) + toFiniteNumber(machine.hours),
        unitCost: firstDefinedNumber(current.unitCost, machine.unitCost),
        totalCost: sumDefinedNumber(current.totalCost, machine.totalCost),
        note: firstNonEmptyText(current.note, machine.note),
      });
    });
  });

  return Array.from(byKey.values());
};

export interface DailyLogSummaryDetails {
  volumes: DailyLogVolume[];
  laborDetails: DailyLogLabor[];
  machines: DailyLogMachine[];
  workerCount: number;
}

export const buildDailyLogSummaryDetails = (sourceLogs: DailyLog[]): DailyLogSummaryDetails => {
  const laborDetails = buildSummaryLabor(sourceLogs);
  return {
    volumes: buildSummaryVolumes(sourceLogs),
    laborDetails,
    machines: buildSummaryMachines(sourceLogs),
    workerCount: laborDetails.reduce((sum, row) => sum + toFiniteNumber(row.count), 0),
  };
};

export const withDailyLogSummaryDetails = (
  log: DailyLog,
  details: DailyLogSummaryDetails,
): DailyLog => ({
  ...log,
  workerCount: details.workerCount,
  volumes: details.volumes,
  materials: [],
  laborDetails: details.laborDetails,
  machines: details.machines,
});

export type DailyLogSummaryDetailSource = 'persisted' | 'legacy_fallback' | 'unresolved';

export interface DailyLogSummaryDetailResolution {
  details: DailyLogSummaryDetails;
  source: DailyLogSummaryDetailSource;
}

const getPersistedDailyLogSummaryDetails = (log: DailyLog): DailyLogSummaryDetails => {
  const laborDetails = log.laborDetails || [];
  const laborWorkerCount = laborDetails.reduce((sum, row) => sum + toFiniteNumber(row.count), 0);
  return {
    volumes: log.volumes || [],
    laborDetails,
    machines: log.machines || [],
    workerCount: laborDetails.length > 0 ? laborWorkerCount : toFiniteNumber(log.workerCount),
  };
};

const sourceSnapshotMatches = (
  sourceLog: DailyLog,
  snapshot: DailyLogSummarySourceSnapshot,
): boolean => {
  const current = buildDailyLogSourceSnapshot(sourceLog);
  return current.sourceLogId === snapshot.sourceLogId
    && current.submittedAt === snapshot.submittedAt
    && current.updatedAt === snapshot.updatedAt
    && current.lastActionAt === snapshot.lastActionAt
    && current.status === snapshot.status;
};

export const resolveDailyLogSummaryDetails = (
  summaryLog: DailyLog,
  allLogs: DailyLog[],
): DailyLogSummaryDetailResolution => {
  const persisted = getPersistedDailyLogSummaryDetails(summaryLog);
  if (!isDailyLogSummaryRow(summaryLog)) return { details: persisted, source: 'persisted' };

  const metadata = summaryLog.summarySourceMetadata || {};
  if (Number(metadata.aggregationVersion || 0) >= 2) {
    return { details: persisted, source: 'persisted' };
  }

  const sourceIds = Array.isArray(metadata.legacyDailyLogIds)
    ? metadata.legacyDailyLogIds.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : [];
  const snapshots = getDailyLogSummarySourceSnapshots(metadata);
  const logById = new Map(allLogs.map(log => [log.id, log]));
  const sourceLogs = sourceIds.map(id => logById.get(id)).filter((log): log is DailyLog => Boolean(log));
  const canRebuild = sourceIds.length > 0
    && sourceLogs.length === sourceIds.length
    && sourceLogs.every(sourceLog => {
      const snapshot = snapshots[sourceLog.id];
      return Boolean(snapshot && sourceSnapshotMatches(sourceLog, snapshot));
    });

  if (!canRebuild) return { details: persisted, source: 'unresolved' };
  return { details: buildDailyLogSummaryDetails(sourceLogs), source: 'legacy_fallback' };
};

export const buildDailyLogSummaryVolumes = (sourceLogs: DailyLog[]): DailyLogVolume[] => {
  return buildSummaryVolumes(sourceLogs);
};
