import type {
  DailyLogVolume,
  ProjectDailyTaskProgress,
  ProjectTask,
  ProjectWorkBoqItem,
} from '../types';

export interface DailyLogProgressVolumeImportInput {
  dailyProgressRows: ProjectDailyTaskProgress[];
  tasks: ProjectTask[];
  workBoqItems: ProjectWorkBoqItem[];
  existingVolumes?: DailyLogVolume[];
}

export interface DailyLogProgressVolumeImportResult {
  volumes: DailyLogVolume[];
  skippedDuplicateCount: number;
  skippedNonPositiveCount: number;
}

const hasSameVolumeTarget = (volume: DailyLogVolume, taskId?: string, workBoqItemId?: string): boolean =>
  (!!workBoqItemId && volume.workBoqItemId === workBoqItemId) ||
  (!!taskId && volume.taskId === taskId);

export const buildDailyLogVolumesFromDailyProgress = ({
  dailyProgressRows,
  tasks,
  workBoqItems,
  existingVolumes = [],
}: DailyLogProgressVolumeImportInput): DailyLogProgressVolumeImportResult => {
  const taskById = new Map(tasks.map(task => [task.id, task]));
  const workBoqByTaskId = new Map(
    workBoqItems
      .filter(item => !!item.sourceTaskId)
      .map(item => [item.sourceTaskId as string, item]),
  );
  const volumes: DailyLogVolume[] = [];
  const duplicateTargets: DailyLogVolume[] = [...existingVolumes];
  let skippedDuplicateCount = 0;
  let skippedNonPositiveCount = 0;

  dailyProgressRows.forEach(row => {
    const dailyQuantity = Number(row.dailyQuantityDone || 0);
    if (!Number.isFinite(dailyQuantity) || dailyQuantity <= 0) {
      skippedNonPositiveCount += 1;
      return;
    }

    const task = taskById.get(row.taskId);
    const workBoqItem = workBoqByTaskId.get(row.taskId);
    const workBoqItemId = workBoqItem?.id;

    if (duplicateTargets.some(volume => hasSameVolumeTarget(volume, row.taskId, workBoqItemId))) {
      skippedDuplicateCount += 1;
      return;
    }

    const taskName = task?.name || row.taskId;
    const volume: DailyLogVolume = {
      taskId: row.taskId,
      taskName,
      workBoqItemId,
      workBoqItemName: workBoqItem?.name,
      contractItemId: undefined,
      contractItemName: workBoqItem?.name || taskName,
      quantity: dailyQuantity,
      unit: workBoqItem?.unit || task?.fallbackUnit || task?.unit || 'm2',
      note: row.note || undefined,
      attachments: [],
    };

    volumes.push(volume);
    duplicateTargets.push(volume);
  });

  return {
    volumes,
    skippedDuplicateCount,
    skippedNonPositiveCount,
  };
};
