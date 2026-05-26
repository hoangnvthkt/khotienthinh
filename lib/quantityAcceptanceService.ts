import { supabase } from './supabase';
import {
  ContractItem,
  ContractItemType,
  QuantityAcceptance,
  QuantityAcceptanceItem,
  QuantityAcceptanceStatus,
  ProjectSubmissionTarget,
} from '../types';
import { contractItemService } from './contractItemService';
import { dailyLogDetailService } from './dailyLogDetailService';
import { buildTaskContractQuantityFactors, taskContractItemService } from './taskContractItemService';
import { fromDb, toDb } from './dbMapping';
import { auditService } from './auditService';
import { approvalService } from './approvalService';
import { User } from '../types';
import { projectSubmissionService } from './projectSubmissionService';

const TABLE = 'quantity_acceptances';
const ITEM_TABLE = 'quantity_acceptance_items';
const APPROVED: QuantityAcceptanceStatus[] = ['approved'];
const MONEY_EPSILON = 1;

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

const money = (value?: number | null) => Math.round(Number(value || 0));
const roundPercent = (value?: number | null) => Math.round(Number(value || 0) * 10000) / 10000;

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
  const revisedQuantity = contractItem.revisedQuantity ?? contractItem.quantity ?? 0;
  const unitPrice = contractItem.revisedUnitPrice ?? contractItem.unitPrice ?? 0;
  const contractAmount = Number(contractItem.revisedTotalPrice ?? contractItem.totalPrice ?? revisedQuantity * unitPrice);
  const suggestedAmount = money(acceptedQuantity * unitPrice);
  const acceptedPercent = contractAmount > 0
    ? roundPercent((suggestedAmount / contractAmount) * 100)
    : revisedQuantity > 0 ? roundPercent((acceptedQuantity / revisedQuantity) * 100) : 0;
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
    acceptedPercent,
    suggestedAmount,
    acceptedAmount: suggestedAmount,
    sourceDailyLogVolumeIds,
  };
};

async function assertAcceptanceAmountsWithinContract(params: {
  contractId: string;
  contractType: ContractItemType;
  items: QuantityAcceptanceItem[];
  currentAcceptanceId?: string;
}): Promise<void> {
  const contractItems = await contractItemService.listByContract(params.contractId, params.contractType);
  const contractItemMap = new Map(contractItems.map(item => [item.id, item]));
  const { data: approvedRows, error } = await supabase
    .from(TABLE)
    .select('id')
    .eq('contract_id', params.contractId)
    .eq('contract_type', params.contractType)
    .eq('status', 'approved');
  if (error) throw error;

  const previousIds = (approvedRows || [])
    .map(row => row.id)
    .filter(id => id !== params.currentAcceptanceId);
  const previousItemMap = await fetchItems(previousIds);
  const amountByContractItem = new Map<string, number>();
  const percentByContractItem = new Map<string, number>();

  const addLine = (line: QuantityAcceptanceItem) => {
    amountByContractItem.set(line.contractItemId, (amountByContractItem.get(line.contractItemId) || 0) + money(line.acceptedAmount));
    percentByContractItem.set(line.contractItemId, (percentByContractItem.get(line.contractItemId) || 0) + Number(line.acceptedPercent || 0));
  };
  Object.values(previousItemMap).flat().forEach(addLine);
  params.items.forEach(addLine);

  for (const [contractItemId, acceptedAmount] of amountByContractItem.entries()) {
    const contractItem = contractItemMap.get(contractItemId);
    if (!contractItem) continue;
    const contractAmount = Number(contractItem.revisedTotalPrice ?? contractItem.totalPrice ?? 0);
    if (contractAmount > 0 && acceptedAmount > contractAmount + MONEY_EPSILON) {
      throw new Error(`${contractItem.code || contractItem.name} vượt giá trị hợp đồng sau phát sinh.`);
    }
    const acceptedPercent = percentByContractItem.get(contractItemId) || 0;
    if (acceptedPercent > 100.0001) {
      throw new Error(`${contractItem.code || contractItem.name} vượt 100% nghiệm thu lũy kế.`);
    }
  }
}

async function syncContractCompletedQuantities(
  contractId: string,
  contractType: ContractItemType,
  contractItemIds: string[],
): Promise<void> {
  const uniqueIds = Array.from(new Set(contractItemIds));
  if (uniqueIds.length === 0) return;
  const contractItems = await contractItemService.listByContract(contractId, contractType);
  const contractItemMap = new Map(contractItems.map(item => [item.id, item]));
  const { data: approvedRows, error } = await supabase
    .from(TABLE)
    .select('id')
    .eq('contract_id', contractId)
    .eq('contract_type', contractType)
    .eq('status', 'approved');
  if (error) throw error;
  const itemMap = await fetchItems((approvedRows || []).map(row => row.id));
  const approvedItems = Object.values(itemMap).flat();

  for (const contractItemId of uniqueIds) {
    const contractItem = contractItemMap.get(contractItemId);
    if (!contractItem) continue;
    const revisedQuantity = Number(contractItem.revisedQuantity ?? contractItem.quantity ?? 0);
    const completedQuantity = approvedItems
      .filter(item => item.contractItemId === contractItemId)
      .reduce((sum, item) => {
        const linePercent = Number(item.acceptedPercent || 0);
        if (linePercent > 0 && revisedQuantity > 0) return sum + (revisedQuantity * linePercent / 100);
        return sum + Number(item.acceptedQuantity || 0);
      }, 0);
    await contractItemService.updateCompletedQuantity(
      contractItemId,
      revisedQuantity > 0 ? Math.min(completedQuantity, revisedQuantity) : completedQuantity,
    );
  }
}

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

  const [taskContractLinks, workBoqRows] = await Promise.all([
    taskContractItemService.listBySite(params.constructionSiteId, params.constructionSiteId),
    supabase
      .from('project_work_boq_items')
      .select('id, name, source_task_id')
      .eq('construction_site_id', params.constructionSiteId),
  ]);
  if (workBoqRows.error) throw workBoqRows.error;

  const taskToWorkBoqItemId = new Map<string, string>();
  const workBoqSourceTaskById = new Map<string, string>();
  const workBoqItemNameById = new Map<string, string>();
  for (const row of workBoqRows.data || []) {
    workBoqItemNameById.set(row.id, row.name || row.id);
    if (row.source_task_id) {
      taskToWorkBoqItemId.set(row.source_task_id, row.id);
      workBoqSourceTaskById.set(row.id, row.source_task_id);
    }
  }

  const factorsByTaskId = buildTaskContractQuantityFactors(taskContractLinks, contractItemIds)
    .reduce<Map<string, ReturnType<typeof buildTaskContractQuantityFactors>>>((acc, item) => {
      if (!acc.has(item.taskId)) acc.set(item.taskId, []);
      acc.get(item.taskId)!.push(item);
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
      const sourceTaskId = volume.taskId || (workBoqItemId ? workBoqSourceTaskById.get(workBoqItemId) : undefined);
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

      if (!sourceTaskId) {
        pushUnmapped('Chưa gắn task/BOQ thi công để xác định dòng BOQ hợp đồng.');
        continue;
      }

      const factors = factorsByTaskId.get(sourceTaskId) || [];
      if (factors.length === 0) {
        pushUnmapped('Task/BOQ thi công chưa liên kết BOQ hợp đồng trong tiến độ.');
        continue;
      }

      let applied = false;
      for (const factor of factors) {
        const row = grouped.get(factor.contractItemId) || { quantity: 0, volumeIds: [] };
        row.quantity += quantity * factor.quantityFactor;
        if (volumeId) row.volumeIds.push(volumeId);
        grouped.set(factor.contractItemId, row);
        applied = true;
      }
      if (!applied) {
        pushUnmapped('Liên kết task không có dòng BOQ hợp đồng thuộc hợp đồng này.');
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
          `Vui lòng gắn task/BOQ thi công với dòng BOQ hợp đồng trong tiến độ trước khi tạo nghiệm thu.`
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
    await assertAcceptanceAmountsWithinContract({
      contractId: params.contractId,
      contractType: params.contractType,
      items,
    });

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
      totalAcceptedAmount: items.reduce((sum, item) => sum + money(item.acceptedAmount), 0),
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
    if (items) {
      await assertAcceptanceAmountsWithinContract({
        contractId: current.contract_id,
        contractType: current.contract_type,
        items,
        currentAcceptanceId: id,
      });
    }
    const next: Partial<QuantityAcceptance> = {
      ...updates,
      totalAcceptedAmount: items ? items.reduce((sum, item) => sum + money(item.acceptedAmount), 0) : updates.totalAcceptedAmount,
    };
    const dbNext = toDb(next);
    delete dbNext.items; // 'items' là virtual field, không tồn tại trong bảng
    const { error } = await supabase.from(TABLE).update(dbNext).eq('id', id);
    if (error) throw error;
    if (items) await replaceItems(id, items);
  },

  async setStatus(
    id: string,
    status: QuantityAcceptanceStatus,
    userId?: string,
    reason?: string,
    approverUser?: User,
    projectId?: string,
    submissionTarget?: ProjectSubmissionTarget,
  ): Promise<void> {
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
      throw new Error('Phiếu nghiệm thu chưa có hạng mục. Cần tạo lại sau khi nhật ký verified có liên kết task/BOQ hợp đồng.');
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
    const updates: any = {
      status,
      ...projectSubmissionService.actionMeta(userId, status === 'submitted'),
    };
    if (status === 'submitted') {
      updates.submittedBy = userId;
      updates.submittedAt = now;
      Object.assign(updates, projectSubmissionService.targetToUpdate(submissionTarget));
    }
    if (status === 'returned') {
      updates.returnedBy = userId;
      updates.returnedAt = now;
      updates.returnReason = reason;
      Object.assign(updates, projectSubmissionService.returnToOwnerUpdate(acceptance.submittedBy, reason));
    }
    if (status === 'approved') {
      updates.approvedBy = userId;
      updates.approvedAt = now;
      Object.assign(updates, projectSubmissionService.targetToUpdate(null));
    }
    if (status === 'cancelled') {
      Object.assign(updates, projectSubmissionService.targetToUpdate(null));
    }
    const { error } = await supabase.from(TABLE).update(toDb(updates)).eq('id', id);
    if (error) throw error;
    if (status === 'submitted' && submissionTarget) {
      await projectSubmissionService.notifyTarget({
        target: submissionTarget,
        actorId: userId,
        category: 'contract',
        title: `Nghiệm thu khối lượng đợt ${acceptance.periodNumber} chờ duyệt`,
        message: `Bạn được chọn duyệt nghiệm thu ${acceptance.description || `đợt ${acceptance.periodNumber}`}.`,
        sourceType: 'quantity_acceptance',
        sourceId: id,
        constructionSiteId: acceptance.constructionSiteId,
        link: '/da',
        metadata: {
          contractId: acceptance.contractId,
          contractType: acceptance.contractType,
          periodNumber: acceptance.periodNumber,
          totalAcceptedAmount: acceptance.totalAcceptedAmount || 0,
        },
      }).catch(error => console.warn('Cannot notify quantity acceptance recipient', error));
    }
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
      await syncContractCompletedQuantities(acceptance.contractId, acceptance.contractType, acceptance.items.map(item => item.contractItemId));
    }

    // Mục 9a: Rollback khi hủy nghiệm thu đã approved
    if (status === 'cancelled' && acceptance.status === 'approved') {
      // Unlock BOQ items
      await contractItemService.unlockItems(acceptance.items.map(item => item.contractItemId));
      await syncContractCompletedQuantities(acceptance.contractId, acceptance.contractType, acceptance.items.map(item => item.contractItemId));
    }
  },

  async remove(id: string): Promise<void> {
    const { data, error: readError } = await supabase.from(TABLE).select('status, period_number, ever_submitted').eq('id', id).single();
    if (readError) throw readError;
    if (data?.status !== 'draft') throw new Error('Chỉ xoá được nghiệm thu ở trạng thái Nháp.');
    if (data?.ever_submitted) throw new Error('Phiếu đã từng gửi duyệt, không được xoá cứng. Vui lòng huỷ/rollback để giữ lịch sử.');
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
