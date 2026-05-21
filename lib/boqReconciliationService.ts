import { supabase } from './supabase';
import {
  BoqReconciliationContractLine,
  BoqReconciliationGroup,
  BoqReconciliationStatus,
  BoqReconciliationWorkLine,
  ContractItem,
  ContractItemType,
  ProjectWorkBoqItem,
} from '../types';
import { fromDb, toDb } from './dbMapping';
import { buildProjectScopeFilter, dedupeRowsById } from './projectScope';

const GROUP_TABLE = 'boq_reconciliation_groups';
const CONTRACT_LINE_TABLE = 'boq_reconciliation_contract_lines';
const WORK_LINE_TABLE = 'boq_reconciliation_work_lines';
const OFFICIAL_STATUSES: BoqReconciliationStatus[] = ['reviewed', 'locked'];

const lineQuantity = (value?: number | null) => Math.max(0, Number(value || 0));
const lineFactor = (value?: number | null) => {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? n : 1;
};

const normalizeGroup = (
  row: any,
  contractLines: BoqReconciliationContractLine[] = [],
  workLines: BoqReconciliationWorkLine[] = [],
): BoqReconciliationGroup => ({
  ...fromDb(row),
  contractLines,
  workLines,
});

const stripVirtualGroupFields = (group: BoqReconciliationGroup) => {
  const payload = toDb(group);
  delete payload.contract_lines;
  delete payload.work_lines;
  delete payload.created_at;
  delete payload.updated_at;
  return payload;
};

const linePayload = (line: BoqReconciliationContractLine | BoqReconciliationWorkLine) => {
  const payload = toDb(line);
  delete payload.created_at;
  delete payload.updated_at;
  return payload;
};

export const buildContractReconciliationLine = (
  groupId: string,
  item: ContractItem,
): BoqReconciliationContractLine => {
  const qty = lineQuantity(item.revisedQuantity ?? item.quantity);
  const unitPrice = Number(item.revisedUnitPrice ?? item.unitPrice ?? 0);
  return {
    groupId,
    contractItemId: item.id,
    contractId: item.contractId,
    contractType: item.contractType,
    originalQuantity: qty,
    originalUnit: item.unit || '',
    allocatedQuantity: qty,
    allocatedPercent: 100,
    convertedQuantity: qty,
    convertedUnit: item.unit || '',
    conversionFactor: 1,
    unitPriceSnapshot: unitPrice,
    amountSnapshot: Number(item.revisedTotalPrice ?? item.totalPrice ?? qty * unitPrice),
    note: null,
  };
};

export const buildWorkReconciliationLine = (
  groupId: string,
  item: ProjectWorkBoqItem,
): BoqReconciliationWorkLine => {
  const qty = lineQuantity(item.plannedQty);
  const unitPrice = Number(item.unitPrice || 0);
  return {
    groupId,
    workBoqItemId: item.id,
    sourceTaskId: item.sourceTaskId || null,
    originalQuantity: qty,
    originalUnit: item.unit || '',
    allocatedQuantity: qty,
    allocatedPercent: 100,
    convertedQuantity: qty,
    convertedUnit: item.unit || '',
    conversionFactor: 1,
    unitPriceSnapshot: unitPrice,
    amountSnapshot: Number(item.totalAmount ?? qty * unitPrice),
    note: null,
  };
};

export interface WorkBoqContractQuantityFactor {
  groupId: string;
  workBoqItemId: string;
  contractItemId: string;
  quantityFactor: number;
}

export const boqReconciliationService = {
  async listByProject(
    projectIdOrSiteId: string,
    constructionSiteId?: string | null,
    contractType?: ContractItemType,
  ): Promise<BoqReconciliationGroup[]> {
    let query = supabase
      .from(GROUP_TABLE)
      .select('*')
      .or(buildProjectScopeFilter(projectIdOrSiteId, constructionSiteId))
      .order('created_at', { ascending: false });
    if (contractType) query = query.eq('contract_type', contractType);
    const { data, error } = await query;
    if (error) throw error;

    const groupRows = dedupeRowsById(data || []);
    const groupIds = groupRows.map(row => row.id);
    if (groupIds.length === 0) return [];

    const [contractLineResult, workLineResult] = await Promise.all([
      supabase.from(CONTRACT_LINE_TABLE).select('*').in('group_id', groupIds).order('created_at', { ascending: true }),
      supabase.from(WORK_LINE_TABLE).select('*').in('group_id', groupIds).order('created_at', { ascending: true }),
    ]);
    if (contractLineResult.error) throw contractLineResult.error;
    if (workLineResult.error) throw workLineResult.error;

    const contractByGroup = new Map<string, BoqReconciliationContractLine[]>();
    for (const row of contractLineResult.data || []) {
      const item = fromDb(row) as BoqReconciliationContractLine;
      if (!contractByGroup.has(item.groupId)) contractByGroup.set(item.groupId, []);
      contractByGroup.get(item.groupId)!.push(item);
    }

    const workByGroup = new Map<string, BoqReconciliationWorkLine[]>();
    for (const row of workLineResult.data || []) {
      const item = fromDb(row) as BoqReconciliationWorkLine;
      if (!workByGroup.has(item.groupId)) workByGroup.set(item.groupId, []);
      workByGroup.get(item.groupId)!.push(item);
    }

    return groupRows.map(row => normalizeGroup(row, contractByGroup.get(row.id) || [], workByGroup.get(row.id) || []));
  },

  async upsertGroup(group: BoqReconciliationGroup): Promise<void> {
    const { error } = await supabase
      .from(GROUP_TABLE)
      .upsert(stripVirtualGroupFields(group), { onConflict: 'id' });
    if (error) throw error;
  },

  async removeGroup(groupId: string): Promise<void> {
    const { error } = await supabase.from(GROUP_TABLE).delete().eq('id', groupId);
    if (error) throw error;
  },

  async setStatus(
    groupId: string,
    status: BoqReconciliationStatus,
    user?: { id?: string; name?: string },
  ): Promise<void> {
    const now = new Date().toISOString();
    const updates: Partial<BoqReconciliationGroup> = { status };
    if (status === 'reviewed') {
      updates.reviewedById = user?.id || null;
      updates.reviewedByName = user?.name || user?.id || null;
      updates.reviewedAt = now;
    }
    if (status === 'locked') {
      updates.lockedById = user?.id || null;
      updates.lockedByName = user?.name || user?.id || null;
      updates.lockedAt = now;
    }
    const { error } = await supabase.from(GROUP_TABLE).update(toDb(updates)).eq('id', groupId);
    if (error) throw error;
  },

  async addContractLines(groupId: string, lines: BoqReconciliationContractLine[]): Promise<void> {
    if (lines.length === 0) return;
    const { error } = await supabase
      .from(CONTRACT_LINE_TABLE)
      .upsert(lines.map(linePayload), { onConflict: 'group_id,contract_item_id' });
    if (error) throw error;
  },

  async addWorkLines(groupId: string, lines: BoqReconciliationWorkLine[]): Promise<void> {
    if (lines.length === 0) return;
    const { error } = await supabase
      .from(WORK_LINE_TABLE)
      .upsert(lines.map(linePayload), { onConflict: 'group_id,work_boq_item_id' });
    if (error) throw error;
  },

  async updateContractLine(line: BoqReconciliationContractLine): Promise<void> {
    const { error } = await supabase
      .from(CONTRACT_LINE_TABLE)
      .upsert(linePayload(line), { onConflict: 'id' });
    if (error) throw error;
  },

  async updateWorkLine(line: BoqReconciliationWorkLine): Promise<void> {
    const { error } = await supabase
      .from(WORK_LINE_TABLE)
      .upsert(linePayload(line), { onConflict: 'id' });
    if (error) throw error;
  },

  async removeContractLine(lineId: string): Promise<void> {
    const { error } = await supabase.from(CONTRACT_LINE_TABLE).delete().eq('id', lineId);
    if (error) throw error;
  },

  async removeWorkLine(lineId: string): Promise<void> {
    const { error } = await supabase.from(WORK_LINE_TABLE).delete().eq('id', lineId);
    if (error) throw error;
  },

  async listOfficialByProject(
    projectIdOrSiteId: string,
    constructionSiteId: string | null | undefined,
    contractType: ContractItemType,
  ): Promise<BoqReconciliationGroup[]> {
    const groups = await this.listByProject(projectIdOrSiteId, constructionSiteId, contractType);
    return groups.filter(group => OFFICIAL_STATUSES.includes(group.status));
  },

  buildWorkContractFactors(groups: BoqReconciliationGroup[]): WorkBoqContractQuantityFactor[] {
    const result: WorkBoqContractQuantityFactor[] = [];
    for (const group of groups.filter(item => OFFICIAL_STATUSES.includes(item.status))) {
      const contractLines = group.contractLines || [];
      const workLines = group.workLines || [];
      if (contractLines.length === 0 || workLines.length === 0) continue;

      const totalContractConverted = contractLines.reduce((sum, line) => {
        const converted = lineQuantity(line.convertedQuantity) || lineQuantity(line.allocatedQuantity) * lineFactor(line.conversionFactor);
        return sum + converted;
      }, 0);
      const equalShare = contractLines.length > 0 ? 1 / contractLines.length : 0;

      for (const workLine of workLines) {
        const workFactor = lineFactor(workLine.conversionFactor);
        for (const contractLine of contractLines) {
          const contractConverted = lineQuantity(contractLine.convertedQuantity) ||
            lineQuantity(contractLine.allocatedQuantity) * lineFactor(contractLine.conversionFactor);
          const share = totalContractConverted > 0 ? contractConverted / totalContractConverted : equalShare;
          const contractFactor = lineFactor(contractLine.conversionFactor);
          result.push({
            groupId: group.id,
            workBoqItemId: workLine.workBoqItemId,
            contractItemId: contractLine.contractItemId,
            quantityFactor: (workFactor / contractFactor) * share,
          });
        }
      }
    }
    return result;
  },
};
