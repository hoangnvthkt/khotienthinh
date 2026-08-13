import type { TaskContractItem } from '../types';
import {
  projectGanttCommandService,
  type ProjectGanttCatalogTask,
  type ProjectGanttScope,
} from './projectGanttCommandService';

export interface DependentRoomGanttCatalog {
  tasks: ProjectGanttCatalogTask[];
  taskContractItems: TaskContractItem[];
}

const loadCatalog = async (
  scope: ProjectGanttScope,
  consumerRoom: Parameters<typeof projectGanttCommandService.loadCatalog>[1],
): Promise<DependentRoomGanttCatalog> => {
  const tasks = await projectGanttCommandService.loadCatalog(scope, consumerRoom);
  return {
    tasks,
    taskContractItems: tasks.flatMap(task => task.contractItemIds.map(contractItemId => ({
      id: `${task.id}:${contractItemId}`,
      taskId: task.id,
      contractItemId,
      projectId: task.projectId,
      constructionSiteId: task.constructionSiteId,
    }))),
  };
};

export const loadDailyLogGanttCatalog = (scope: ProjectGanttScope) =>
  loadCatalog(scope, 'daily_log');

export const loadWeeklyProgressGanttCatalog = (scope: ProjectGanttScope) =>
  loadCatalog(scope, 'weekly_progress');

export const loadMaterialPlanningGanttCatalog = (scope: ProjectGanttScope) =>
  loadCatalog(scope, 'material_planning');

export const loadQuantityAcceptanceGanttCatalog = (scope: ProjectGanttScope) =>
  loadCatalog(scope, 'quantity_acceptance');

export const loadQualityGanttCatalog = (scope: ProjectGanttScope) =>
  loadCatalog(scope, 'quality');

export const loadPaymentGanttCatalog = (scope: ProjectGanttScope) =>
  loadCatalog(scope, 'payment');
