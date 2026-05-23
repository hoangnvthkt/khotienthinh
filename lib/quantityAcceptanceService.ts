import { supabase } from './supabase';
import {
  ContractItem,
  ContractItemType,
  QuantityAcceptance,
  QuantityAcceptanceItem,
  QuantityAcceptanceStatus,
} from '../types';
import { contractItemService } from './contractItemService';
import { dailyLogDetailService } from './dailyLogDetailService';
import { boqReconciliationService } from './boqReconciliationService';
import { fromDb, toDb } from './dbMapping';
import { auditService } from './auditService';
import { approvalService } from './approvalService';
import { User } from '../types';

const TABLE = 'quantity_acceptances';
const ITEM_TABLE = 'quantity_acceptance_items';
const APPROVED: QuantityAcceptanceStatus[] = ['approved'];

export interface QuantityAcceptanceUnmappedVolume {
  dailyLogId: string;
  dailyLogDate: string;
  taskId?: string | null;
  taskName?: string | null;
  workBoqItemId?: string | null;
  workBoqItemName?: string | null;
  quantity: number;
  unit?: string | null;
  reason: string;
}

const normalize = (row: any): QuantityAcceptance => ({
  ...fromDb(row),
  items: row.items || [],
});

async function fetchItems(acceptanceIds: string[]): Promise<Record<string, QuantityAcceptanceItem[]>> {
  if (acceptanceIds.length === 0) return {};
  const { data, error } = await supabase
    .from(ITEM_TABLE)
    .select('*')
    .in('acceptance_id', acceptanceIds)
    .order('created_at', { ascending: true });
  if (error) {
    console.warn('quantity_acceptance_items unavailable', error.message);
    return {};
  }
  return (data || []).reduce<Record<string, QuantityAcceptanceItem[]>>((acc, row) => {
    if (!acc[row.acceptance_id]) acc[row.acceptance_id] = [];
    acc[row.acceptance_id].push(fromDb(row));
    return acc;
  }, {});
}

async function replaceItems(acceptanceId: string, items: QuantityAcceptanceItem[]): Promise<void> {
  const { error: deleteError } = await supabase.from(ITEM_TABLE).delete().eq('acceptance_id', acceptanceId);
  if (deleteError) {
    console.warn('Cannot replace normalized acceptance items', deleteError.message);
    return;
  }
  if (items.length === 0) return;
  const rows = items.map(item => {
    const dbItem = toDb({ ...item, acceptanceId });
    delete dbItem.id;
    return dbItem;
  });
  const { error } = await supabase.from(ITEM_TABLE).insert(rows);
  if (error) throw error;
}

const getPreviousAcceptedQty = (acceptances: QuantityAcceptance[], contractItemId: string): number => {
  return acceptances
    .filter(a => APPROVED.includes(a.status))
    .flatMap(a => a.items)
    .filter(item => item.contractItemId === contractItemId)
    .reduce((sum, item) => sum + (item.acceptedQuantity || 0), 0);
};

const buildAcceptanceItem = (
  contractItem: ContractItem,
  proposedQuantity: number,
  previousAcceptedQuantity: number,
  sourceDailyLogVolumeIds: string[],
): QuantityAcceptanceItem => {
  const acceptedQuantity = proposedQuantity;
  const cumulativeAcceptedQuantity = previousAcceptedQuantity + acceptedQuantity;
  const unitPrice = contractItem.unitPrice || 0;
  return {
    contractItemId: contractItem.id,
    contractItemCode: contractItem.code,
    contractItemName: contractItem.name,
    unit: contractItem.unit,
    previousAcceptedQuantity,
    proposedQuantity,
    acceptedQuantity,
    cumulativeAcceptedQuantity,
    unitPrice,
    acceptedAmount: acceptedQuantity * unitPrice,
    sourceDailyLogVolumeIds,
  };
};

async function collectVerifiedVolumeMapping(params: {
  contractType: ContractItemType;
  constructionSiteId: string;
  periodStart: string;
  periodEnd: string;
}, contractItems: ContractItem[]) {
  const contractItemIds = new Set(contractItems.map(item => item.id));
  const { data: logs, error } = await supabase
    .from('daily_logs')
    .select('*')
    .eq('construction_site_id', params.constructionSiteId)
    .eq('status', 'verified')
    .gte('date', params.periodStart)
    .lte('date', params.periodEnd);
  if (error) throw error;

  const [officialGroups, workBoqRows] = await Promise.all([
    boqReconciliationService.listOfficialByProject(
      params.constructionSiteId,
      params.constructionSiteId,
      params.contractType,
    ),
    supabase
      .from('project_work_boq_items')
      .select('id, name, source_task_id')
      .eq('construction_site_id', params.constructionSiteId),
  ]);
  if (workBoqRows.error) throw workBoqRows.error;

  const taskToWorkBoqItemId = new Map<string, string>();
  const workBoqItemNameById = new Map<string, string>();
  for (const row of workBoqRows.data || []) {
    workBoqItemNameById.set(row.id, row.name || row.id);
    if (row.source_task_id) taskToWorkBoqItemId.set(row.source_task_id, row.id);
  }

  const factorsByWorkBoqItem = boqReconciliationService
    .buildWorkContractFactors(officialGroups)
    .reduce<Map<string, ReturnType<typeof boqReconciliationService.buildWorkContractFactors>>>((acc, item) => {
      if (!acc.has(item.workBoqItemId)) acc.set(item.workBoqItemId, []);
      acc.get(item.workBoqItemId)!.push(item);
      return acc;
    }, new Map());

  const logIds = (logs || []).map((l: any) => l.id);
  const detailMap = await dailyLogDetailService.listByLogIds(logIds);
  const grouped = new Map<string, { quantity: number; volumeIds: string[] }>();
  const unmapped: QuantityAcceptanceUnmappedVolume[] = [];
  let positiveVolumeCount = 0;

  for (const rawLog of logs || []) {
    const logId = rawLog.id;
    const fallbackVolumes = fromDb(rawLog).volumes || [];
    const volumes = detailMap[logId]?.volumes?.length ? detailMap[logId].volumes : fallbackVolumes;
    for (const volume of volumes) {
      const quantity = Math.max(0, Number(volume.quantity || 0));
      if (quantity <= 0) continue;
      positiveVolumeCount += 1;

      const directContractItemId = volume.contractItemId;
      const volumeId = (volume as any).id;
      const workBoqItemId = volume.workBoqItemId || (volume.taskId ? taskToWorkBoqItemId.get(volume.taskId) : undefined);
      const pushUnmapped = (reason: string) => {
        unmapped.push({
          dailyLogId: logId,
          dailyLogDate: rawLog.date,
          taskId: volume.taskId || null,
          taskName: volume.taskName || null,
          workBoqItemId: workBoqItemId || null,
          workBoqItemName: volume.workBoqItemName || (workBoqItemId ? workBoqItemNameById.get(workBoqItemId) : null) || null,
          quantity,
          unit: volume.unit || null,
          reason,
        });
      };

      if (directContractItemId) {
        if (!contractItemIds.has(directContractItemId)) {
          pushUnmapped('Dòng nhật ký đang gắn BOQ hợp đồng không thuộc hợp đồng này.');
          continue;
        }
        const row = grouped.get(directContractItemId) || { quantity: 0, volumeIds: [] };
        row.quantity += quantity;
        if (volumeId) row.volumeIds.push(volumeId);
        grouped.set(directContractItemId, row);
        continue;
      }

      if (!workBoqItemId) {
        pushUnmapped('Chưa gắn BOQ thi công hoặc task không có BOQ thi công tương ứng.');
        continue;
      }

      const factors = factorsByWorkBoqItem.get(workBoqItemId) || [];
      if (factors.length === 0) {
        pushUnmapped('BOQ thi công chưa thuộc nhóm đối chiếu BOQ reviewed/locked.');
        continue;
      }

      let applied = false;
      for (const factor of factors) {
        if (!contractItemIds.has(factor.contractItemId)) continue;
        const row = grouped.get(factor.contractItemId) || { quantity: 0, volumeIds: [] };
        row.quantity += quantity * factor.quantityFactor;
        if (volumeId) row.volumeIds.push(volumeId);
        grouped.set(factor.contractItemId, row);
        applied = true;
      }
      if (!applied) {
        pushUnmapped('Nhóm đối chiếu không có dòng BOQ hợp đồng thuộc hợp đồng này.');
      }
    }
  }

  return { grouped, unmapped, positiveVolumeCount, verifiedLogCount: (logs || []).length };
}

export const quantityAcceptanceService = {
  async listByContract(contractId: string, contractType: ContractItemType): Promise<QuantityAcceptance[]> {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('contract_id', contractId)
      .eq('contract_type', contractType)
      .order('period_number', { ascending: true });
    if (error) throw error;
    const acceptances = (data || []).map(normalize);
    const itemMap = await fetchItems(acceptances.map(a => a.id));
    return acceptances.map(a => ({ ...a, items: itemMap[a.id] || a.items || [] }));
  },

  async listBySite(constructionSiteId: string): Promise<QuantityAcceptance[]> {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('construction_site_id', constructionSiteId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    const acceptances = (data || []).map(normalize);
    const itemMap = await fetchItems(acceptances.map(a => a.id));
    return acceptances.map(a => ({ ...a, items: itemMap[a.id] || a.items || [] }));
  },

  async listUnmappedVerifiedVolumes(params: {
    contractId: string;
    contractType: ContractItemType;
    constructionSiteId: string;
    periodStart: string;
    periodEnd: string;
  }): Promise<QuantityAcceptanceUnmappedVolume[]> {
    const contractItems = await contractItemService.listByContract(params.contractId, params.contractType);
    const source = await collectVerifiedVolumeMapping(params, contractItems);
    return source.unmapped;
  },

  async createDraftFromVerifiedLogs(params: {
    contractId: string;
    contractType: ContractItemType;
    constructionSiteId: string;
    periodStart: string;
    periodEnd: string;
    description?: string;
  }): Promise<QuantityAcceptance> {
    const [contractItems, previousAcceptances] = await Promise.all([
      contractItemService.listByContract(params.contractId, params.contractType),
      this.listByContract(params.contractId, params.contractType),
    ]);
    const contractItemMap = new Map(contractItems.map(item => [item.id, item]));

    // M1: Guard — kiểm tra overlap kỳ nghiệm thu
    const overlapping = previousAcceptances.find(a =>
      a.status !== 'cancelled' &&
      a.periodStart <= params.periodEnd &&
      a.periodEnd >= params.periodStart,
    );
    if (overlapping) {
      throw new Error(
        `Khoảng thời gian ${params.periodStart} — ${params.periodEnd} bị trùng với nghiệm thu đợt ${overlapping.periodNumber} ` +
        `(${overlapping.periodStart} — ${overlapping.periodEnd}). Vui lòng chọn kỳ khác để tránh tính trùng khối lượng.`,
      );
    }

    const source = await collectVerifiedVolumeMapping(params, contractItems);

    const items = Array.from(source.grouped.entries()).map(([contractItemId, value]) => {
      const contractItem = contractItemMap.get(contractItemId)!;
      const previousAcceptedQuantity = getPreviousAcceptedQty(previousAcceptances, contractItemId);
      return buildAcceptanceItem(contractItem, value.quantity, previousAcceptedQuantity, value.volumeIds);
    }).filter(item => item.proposedQuantity > 0);

    if (items.length === 0) {
      if (source.positiveVolumeCount > 0) {
        throw new Error(
          `Có ${source.positiveVolumeCount} dòng khối lượng từ nhật ký verified nhưng chưa quy đổi được sang BOQ hợp đồng. ` +
          `Vui lòng hoàn tất nhóm đối chiếu BOQ ở trạng thái reviewed/locked trước khi tạo nghiệm thu.`
        );
      }
      throw new Error(`Không có khối lượng nhật ký verified trong kỳ ${params.periodStart} - ${params.periodEnd}.`);
    }

    for (const item of items) {
      const contractItem = contractItemMap.get(item.contractItemId);
      const revisedQuantity = contractItem?.revisedQuantity ?? contractItem?.quantity ?? 0;
      if (revisedQuantity > 0 && item.cumulativeAcceptedQuantity > revisedQuantity) {
        throw new Error(`${item.contractItemCode} vượt khối lượng hợp đồng sau phát sinh.`);
      }
    }

    const periodNumber = previousAcceptances.length + 1;
    const acceptance: Partial<QuantityAcceptance> = {
      contractId: params.contractId,
      contractType: params.contractType,
      constructionSiteId: params.constructionSiteId,
      periodNumber,
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      description: params.description || `Nghiệm thu khối lượng đợt ${periodNumber}`,
      status: 'draft',
      items,
      totalAcceptedAmount: items.reduce((sum, item) => sum + item.acceptedAmount, 0),
    };

    const dbItem = toDb(acceptance);
    delete dbItem.id;
    delete dbItem.items; // 'items' là virtual field, lưu riêng trong quantity_acceptance_items
    const { data, error: insertError } = await supabase.from(TABLE).insert(dbItem).select().single();
    if (insertError) throw insertError;
    await replaceItems(data.id, items);
    await auditService.log({
      tableName: TABLE,
      recordId: data.id,
      action: 'INSERT',
      newData: { periodNumber, periodStart: params.periodStart, periodEnd: params.periodEnd, totalItems: items.length },
      userId: 'system',
      userName: 'system',
      description: `Tạo nghiệm thu khối lượng đợt ${periodNumber} (${params.periodStart} — ${params.periodEnd}), ${items.length} hạng mục`,
    });
    return { ...normalize(data), items };
  },

  async update(id: string, updates: Partial<QuantityAcceptance>): Promise<void> {
    const { data: current, error: readError } = await supabase.from(TABLE).select('*').eq('id', id).single();
    if (readError) throw readError;
    if (['submitted', 'approved', 'cancelled'].includes(current.status)) {
      throw new Error('Nghiệm thu đã gửi duyệt/duyệt/hủy, không thể chỉnh sửa trực tiếp.');
    }

    const items = updates.items;
    const next: Partial<QuantityAcceptance> = {
      ...updates,
      totalAcceptedAmount: items ? items.reduce((sum, item) => sum + item.acceptedAmount, 0) : updates.totalAcceptedAmount,
    };
    const dbNext = toDb(next);
    delete dbNext.items; // 'items' là virtual field, không tồn tại trong bảng
    const { error } = await supabase.from(TABLE).update(dbNext).eq('id', id);
    if (error) throw error;
    if (items) await replaceItems(id, items);
  },

  async setStatus(id: string, status: QuantityAcceptanceStatus, userId?: string, reason?: string, approverUser?: User, projectId?: string): Promise<void> {
    const { data, error: readError } = await supabase.from(TABLE).select('*').eq('id', id).single();
    if (readError) throw readError;
    const acceptance = normalize(data);
    const itemMap = await fetchItems([id]);
    acceptance.items = itemMap[id] || [];
    if (acceptance.status === 'cancelled') {
      throw new Error('Nghiệm thu đã hủy, không thể đổi trạng thái.');
    }
    if (acceptance.status === 'approved' && status !== 'cancelled') {
      throw new Error('Nghiệm thu đã duyệt. Chỉ có thể chuyển sang Hủy để rollback.');
    }
    if ((status === 'returned' || status === 'cancelled') && !reason?.trim()) {
      throw new Error('Vui lòng nhập lý do trả lại/huỷ nghiệm thu để truy vết.');
    }
    if ((status === 'submitted' || status === 'approved') && acceptance.items.length === 0) {
      throw new Error('Phiếu nghiệm thu chưa có hạng mục. Cần đối chiếu BOQ và tạo lại phiếu trước khi gửi duyệt.');
    }
    if (status === 'cancelled') {
      const { count: linkedCertCount, error: linkedCertError } = await supabase
        .from('payment_certificates')
        .select('*', { count: 'exact', head: true })
        .eq('acceptance_id', id);
      if (linkedCertError) throw linkedCertError;
      if ((linkedCertCount || 0) > 0) {
        throw new Error(`Không thể huỷ nghiệm thu vì đã có ${linkedCertCount} chứng từ thanh toán liên kết. Vui lòng xoá/rollback chứng từ thanh toán trước.`);
      }
    }

    // T5: Approval Matrix check — kiểm tra quyền duyệt
    if ((status === 'approved' || status === 'cancelled') && approverUser) {
      const approvalAction = status === 'approved' ? 'approve' : 'approve'; // cancel cũng cần quyền approve
      const check = await approvalService.checkApproval({
        module: 'quantity_acceptance',
        action: approvalAction,
        amount: acceptance.totalAcceptedAmount || 0,
        projectId,
        constructionSiteId: acceptance.constructionSiteId,
        user: approverUser,
      });
      if (!check.allowed) {
        throw new Error(check.reason);
      }
    }

    const now = new Date().toISOString();
    const updates: any = { status };
    if (status === 'submitted') { updates.submittedBy = userId; updates.submittedAt = now; }
    if (status === 'returned') { updates.returnedBy = userId; updates.returnedAt = now; updates.returnReason = reason; }
    if (status === 'approved') { updates.approvedBy = userId; updates.approvedAt = now; }
    const { error } = await supabase.from(TABLE).update(toDb(updates)).eq('id', id);
    if (error) throw error;
    await auditService.log({
      tableName: TABLE,
      recordId: id,
      action: 'UPDATE',
      oldData: { status: acceptance.status },
      newData: { status },
      userId: userId || 'system',
      userName: userId || 'system',
      description: `Chuyển trạng thái nghiệm thu khối lượng đợt ${acceptance.periodNumber}: ${acceptance.status} -> ${status}`,
    });

    if (status === 'approved') {
      await contractItemService.lockItems(acceptance.items.map(item => item.contractItemId));
      for (const item of acceptance.items) {
        await contractItemService.updateCompletedQuantity(item.contractItemId, item.cumulativeAcceptedQuantity);
      }
    }

    // Mục 9a: Rollback khi hủy nghiệm thu đã approved
    if (status === 'cancelled' && acceptance.status === 'approved') {
      // Unlock BOQ items
      await contractItemService.unlockItems(acceptance.items.map(item => item.contractItemId));
      // Revert completedQuantity = cumulative của các đợt approved TRƯỚC đó
      for (const item of acceptance.items) {
        const previousQty = item.cumulativeAcceptedQuantity - item.acceptedQuantity;
        await contractItemService.updateCompletedQuantity(item.contractItemId, Math.max(0, previousQty));
      }
    }
  },

  async remove(id: string): Promise<void> {
    const { data, error: readError } = await supabase.from(TABLE).select('status, period_number').eq('id', id).single();
    if (readError) throw readError;
    if (data?.status !== 'draft') throw new Error('Chỉ xoá được nghiệm thu ở trạng thái Nháp.');
    const { error } = await supabase.from(TABLE).delete().eq('id', id);
    if (error) throw error;
    await auditService.log({
      tableName: TABLE,
      recordId: id,
      action: 'DELETE',
      oldData: { status: data.status, periodNumber: data.period_number },
      userId: 'system',
      userName: 'system',
      description: `Xóa nghiệm thu khối lượng đợt ${data.period_number}`,
    });
  },
};
