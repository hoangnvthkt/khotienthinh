import { supabase } from './supabase';
import {
  BoqReconciliationContractLine,
  BoqReconciliationGroup,
  BoqReconciliationStatus,
  BoqReconciliationWorkLine,
  ContractItem,
  ContractItemType,
  ProjectSubmissionTarget,
  ProjectWorkBoqItem,
} from '../types';
import { fromDb, toDb } from './dbMapping';
import { buildProjectScopeFilter, dedupeRowsById } from './projectScope';
import { projectSubmissionService } from './projectSubmissionService';

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
    const { data: current, error: readError } = await supabase
      .from(GROUP_TABLE)
      .select('status')
      .eq('id', groupId)
      .single();
    if (readError) throw readError;
    if (current?.status !== 'draft') throw new Error('Chỉ xoá được nhóm đối chiếu ở trạng thái Nháp.');
    const { data: deletedRow, error } = await supabase
      .from(GROUP_TABLE)
      .delete()
      .eq('id', groupId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!deletedRow) {
      throw new Error('Không xoá được nhóm đối chiếu. Có thể RLS đang chặn thao tác hoặc bản ghi không còn tồn tại.');
    }
  },

  async setStatus(
    groupId: string,
    status: BoqReconciliationStatus,
    user?: { id?: string; name?: string },
    submissionTarget?: ProjectSubmissionTarget,
  ): Promise<void> {
    const now = new Date().toISOString();
    const { data: current } = await supabase.from(GROUP_TABLE).select('*').eq('id', groupId).maybeSingle();
    const currentGroup = current ? fromDb(current) as BoqReconciliationGroup : null;
    const updates: Partial<BoqReconciliationGroup> = {
      status,
      ...projectSubmissionService.actionMeta(user?.id, status === 'submitted'),
    };
    if (status === 'submitted') {
      Object.assign(updates, projectSubmissionService.targetToUpdate(submissionTarget));
    }
    if (status === 'reviewed') {
      updates.reviewedById = user?.id || null;
      updates.reviewedByName = user?.name || user?.id || null;
      updates.reviewedAt = now;
    }
    if (status === 'locked') {
      updates.lockedById = user?.id || null;
      updates.lockedByName = user?.name || user?.id || null;
      updates.lockedAt = now;
      Object.assign(updates, projectSubmissionService.targetToUpdate(null));
    }
    if (status !== 'locked') {
      updates.lockedById = null;
      updates.lockedByName = null;
      updates.lockedAt = null;
    }
    if (status === 'draft' || status === 'submitted') {
      updates.reviewedById = null;
      updates.reviewedByName = null;
      updates.reviewedAt = null;
    }
    const { data: updatedRow, error } = await supabase
      .from(GROUP_TABLE)
      .update(toDb(updates))
      .eq('id', groupId)
      .select('id, status')
      .maybeSingle();
    if (error) throw error;
    if (!updatedRow) {
      throw new Error('Không cập nhật được trạng thái đối chiếu. Có thể RLS đang chặn thao tác hoặc bản ghi không còn tồn tại.');
    }
    if (updatedRow.status !== status) {
      throw new Error(`Trạng thái đối chiếu chưa đổi sang ${status}. Vui lòng tải lại và kiểm tra quyền xử lý bước hiện tại.`);
    }
    if (status === 'submitted' && submissionTarget) {
      await projectSubmissionService.notifyTarget({
        target: submissionTarget,
        actorId: user?.id,
        category: 'contract',
        title: `Nhóm đối chiếu BOQ ${currentGroup?.code || ''} chờ rà soát`.trim(),
        message: `Bạn được chọn rà soát nhóm đối chiếu ${currentGroup?.name || groupId}.`,
        sourceType: 'boq_reconciliation_group',
        sourceId: groupId,
        constructionSiteId: currentGroup?.constructionSiteId || undefined,
        link: '/da',
        metadata: {
          contractId: currentGroup?.contractId,
          contractType: currentGroup?.contractType,
          code: currentGroup?.code,
          name: currentGroup?.name,
        },
      }).catch(error => console.warn('Cannot notify BOQ reconciliation recipient', error));
    }
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
