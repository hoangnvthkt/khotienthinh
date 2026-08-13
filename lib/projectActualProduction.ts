import type { ProjectFinance } from '../types';

interface BuildProjectActualProductionUpdateInput {
  current: ProjectFinance | null;
  projectId?: string | null;
  constructionSiteId: string;
  value: number;
  note?: string | null;
  actorId: string;
  updatedAt: string;
  newId: string;
}

const emptyProjectFinance = (
  id: string,
  projectId: string | null | undefined,
  constructionSiteId: string,
  updatedAt: string,
): ProjectFinance => ({
  id,
  projectId: projectId || null,
  constructionSiteId,
  contractValue: 0,
  budgetMaterials: 0,
  budgetLabor: 0,
  budgetSubcontract: 0,
  budgetMachinery: 0,
  budgetOverhead: 0,
  actualMaterials: 0,
  actualLabor: 0,
  actualSubcontract: 0,
  actualMachinery: 0,
  actualOverhead: 0,
  revenueReceived: 0,
  revenuePending: 0,
  progressPercent: 0,
  status: 'planning',
  updatedAt,
});

export const buildProjectActualProductionUpdate = ({
  current,
  projectId,
  constructionSiteId,
  value,
  note,
  actorId,
  updatedAt,
  newId,
}: BuildProjectActualProductionUpdateInput): ProjectFinance => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Giá trị sản lượng không hợp lệ.');
  }

  return {
    ...(current || emptyProjectFinance(newId, projectId, constructionSiteId, updatedAt)),
    actualProductionValue: value,
    actualProductionNote: note?.trim() || undefined,
    actualProductionUpdatedAt: updatedAt,
    actualProductionUpdatedBy: actorId,
    updatedAt,
  };
};
