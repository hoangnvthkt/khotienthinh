import { ContractItemType, DailyLog, PaymentCertificate, ProjectTask, QuantityAcceptance } from '../types';
import { ProjectDocumentDependencies } from './projectDocumentPolicy';
import { supabase } from './supabase';

const emptyDependencies = (metadata: Record<string, any> = {}): ProjectDocumentDependencies => ({
  blockers: [],
  requiredRollbackSteps: [],
  metadata,
});

const pushBlocker = (deps: ProjectDocumentDependencies, blocker: string, rollbackStep: string) => {
  deps.blockers.push(blocker);
  if (!deps.requiredRollbackSteps.includes(rollbackStep)) deps.requiredRollbackSteps.push(rollbackStep);
};

async function countRows(table: string, column: string, value: string, optional = true): Promise<number> {
  try {
    const { data, error } = await supabase
      .from(table)
      .select('id')
      .eq(column, value)
      .limit(1);
    if (error) throw error;
    return data && data.length > 0 ? 1 : 0;
  } catch (error: any) {
    if (!optional) throw error;
    console.warn(`Cannot check ${table}.${column} dependencies`, error?.message || error);
    return 0;
  }
}

async function countRowsByFilters(table: string, filters: Record<string, string>, optional = true): Promise<number> {
  try {
    let query = supabase
      .from(table)
      .select('id');
    Object.entries(filters).forEach(([column, value]) => {
      query = query.eq(column, value);
    });
    const { data, error } = await query.limit(1);
    if (error) throw error;
    return data && data.length > 0 ? 1 : 0;
  } catch (error: any) {
    if (!optional) throw error;
    console.warn(`Cannot check ${table} dependencies`, error?.message || error);
    return 0;
  }
}

async function countPaymentCertificatesByAcceptance(acceptanceId: string): Promise<{ total: number; locked: number }> {
  try {
    const [anyResult, lockedResult] = await Promise.all([
      supabase
        .from('payment_certificates')
        .select('id')
        .eq('acceptance_id', acceptanceId)
        .limit(1),
      supabase
        .from('payment_certificates')
        .select('id')
        .eq('acceptance_id', acceptanceId)
        .in('status', ['submitted', 'approved', 'paid', 'cancelled'])
        .limit(1),
    ]);
    if (anyResult.error) throw anyResult.error;
    if (lockedResult.error) throw lockedResult.error;
    return {
      total: anyResult.data && anyResult.data.length > 0 ? 1 : 0,
      locked: lockedResult.data && lockedResult.data.length > 0 ? 1 : 0,
    };
  } catch (error: any) {
    console.warn('Cannot check payment certificate dependencies', error?.message || error);
    return { total: 0, locked: 0 };
  }
}

async function getDailyLogVolumeIds(dailyLogId: string): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('daily_log_volumes')
      .select('id')
      .eq('daily_log_id', dailyLogId);
    if (error) throw error;
    return (data || []).map(row => row.id).filter(Boolean);
  } catch (error: any) {
    console.warn('Cannot load daily log volume ids', error?.message || error);
    return [];
  }
}

async function countAcceptedVolumeLinks(volumeIds: string[]): Promise<number> {
  if (volumeIds.length === 0) return 0;
  try {
    const { data, error } = await supabase
      .from('quantity_acceptance_items')
      .select('id')
      .overlaps('source_daily_log_volume_ids', volumeIds)
      .limit(1);
    if (error) throw error;
    return data && data.length > 0 ? 1 : 0;
  } catch (error: any) {
    console.warn('Cannot check accepted daily log volume links', error?.message || error);
    return 0;
  }
}

export const projectDocumentDependencyService = {
  async getDailyLogDependencies(log: DailyLog): Promise<ProjectDocumentDependencies> {
    const deps = emptyDependencies();
    const status = log.status || (log.verified ? 'verified' : 'draft');
    const [delayCount, volumeIds] = await Promise.all([
      countRows('project_delay_events', 'source_daily_log_id', log.id),
      getDailyLogVolumeIds(log.id),
    ]);
    const acceptanceLinkCount = await countAcceptedVolumeLinks(volumeIds);

    deps.metadata = { delayCount, volumeCount: volumeIds.length, acceptanceLinkCount };
    if (delayCount > 0) {
      pushBlocker(
        deps,
        'Không thể xoá/sửa nhật ký vì đã có sự kiện chậm tiến độ liên kết.',
        'Xử lý hoặc void sự kiện chậm tiến độ trước khi điều chỉnh nhật ký.',
      );
    }
    if (acceptanceLinkCount > 0) {
      pushBlocker(
        deps,
        'Không thể xoá/sửa nhật ký vì khối lượng đã nằm trong dòng nghiệm thu.',
        'Trả lại/huỷ nghiệm thu liên quan trước, sau đó điều chỉnh nhật ký gốc.',
      );
    }
    if (status === 'verified' && volumeIds.length > 0) {
      pushBlocker(
        deps,
        'Nhật ký đã xác nhận và đã sinh khối lượng/progress, không thể sửa hoặc xoá trực tiếp.',
        'Trả lại nhật ký hoặc rollback các chứng từ downstream trước khi sửa dữ liệu gốc.',
      );
    }
    return deps;
  },

  async getProjectTaskDependencies(taskId: string, tasks: ProjectTask[] = []): Promise<ProjectDocumentDependencies> {
    const deps = emptyDependencies();
    const childCount = tasks.filter(task => task.parentId === taskId).length;
    const dependentCount = tasks.filter(task => (task.dependencies || []).some(dep => dep.taskId === taskId)).length;
    const [completionCount, volumeCount, delayCount, contractLinkCount, internalAcceptanceCount] = await Promise.all([
      countRows('project_task_completion_requests', 'task_id', taskId),
      countRows('daily_log_volumes', 'task_id', taskId),
      countRows('project_delay_events', 'task_id', taskId),
      countRows('task_contract_items', 'task_id', taskId),
      countRows('quantity_acceptance_items', 'task_id', taskId),
    ]);

    deps.metadata = { childCount, dependentCount, completionCount, volumeCount, delayCount, contractLinkCount, internalAcceptanceCount };
    if (childCount > 0) {
      pushBlocker(deps, `Không thể xoá hạng mục vì còn ${childCount} công việc con.`, 'Xoá hoặc chuyển công việc con sang hạng mục khác trước.');
    }
    if (dependentCount > 0) {
      pushBlocker(deps, `Không thể xoá hạng mục vì còn ${dependentCount} công việc đang phụ thuộc vào nó.`, 'Gỡ dependency ở các công việc kế tiếp trước.');
    }
    if (completionCount > 0) {
      pushBlocker(deps, 'Không thể xoá hạng mục vì đã có phiếu hoàn thành liên kết.', 'Huỷ hoặc xử lý phiếu hoàn thành trước khi xoá task.');
    }
    if (volumeCount > 0) {
      pushBlocker(deps, 'Không thể xoá hạng mục vì đã có dòng khối lượng nhật ký liên kết.', 'Điều chỉnh nhật ký thi công hoặc chuyển khối lượng sang hạng mục khác trước.');
    }
    if (delayCount > 0) {
      pushBlocker(deps, 'Không thể xoá hạng mục vì đã có sự kiện chậm tiến độ liên kết.', 'Void/xử lý sự kiện chậm tiến độ trước.');
    }
    if (contractLinkCount > 0) {
      pushBlocker(deps, 'Không thể xoá hạng mục vì đã map với dòng BOQ hợp đồng.', 'Gỡ liên kết BOQ trước khi xoá task.');
    }
    if (internalAcceptanceCount > 0) {
      pushBlocker(deps, 'Không thể xoá hạng mục vì đã có dòng nghiệm thu nội bộ liên kết.', 'Huỷ/rollback nghiệm thu nội bộ trước khi xoá task.');
    }
    return deps;
  },

  async getQuantityAcceptanceDependencies(acceptance: QuantityAcceptance): Promise<ProjectDocumentDependencies> {
    const deps = emptyDependencies();
    const paymentCounts = await countPaymentCertificatesByAcceptance(acceptance.id);
    deps.metadata = paymentCounts;
    if (paymentCounts.total > 0) {
      const lockedText = paymentCounts.locked > 0 ? ', trong đó có chứng từ đã gửi/duyệt/thanh toán' : '';
      pushBlocker(
        deps,
        `Không thể xoá/huỷ nghiệm thu vì đã có chứng từ thanh toán liên kết${lockedText}.`,
        'Xoá, trả lại hoặc rollback chứng từ thanh toán liên kết trước khi điều chỉnh nghiệm thu.',
      );
    }
    return deps;
  },

  async getPaymentCertificateDependencies(cert: PaymentCertificate): Promise<ProjectDocumentDependencies> {
    const deps = emptyDependencies();
    const [recoveryCount, transactionCount] = await Promise.all([
      countRows('payment_certificate_advance_recoveries', 'payment_certificate_id', cert.id),
      countRows('project_transactions', 'source_ref', `payment_certificate:${cert.id}`),
    ]);
    deps.metadata = { recoveryCount, transactionCount };
    return deps;
  },

  async getContractDependencies(contractId: string, contractType: ContractItemType): Promise<ProjectDocumentDependencies> {
    const deps = emptyDependencies();
    const [
      boqCount,
      acceptanceCount,
      paymentCount,
      variationCount,
      appendixCount,
      scheduleCount,
      guaranteeCount,
      advanceCount,
    ] = await Promise.all([
      countRowsByFilters('contract_items', { contract_id: contractId, contract_type: contractType }),
      countRowsByFilters('quantity_acceptances', { contract_id: contractId, contract_type: contractType }),
      countRowsByFilters('payment_certificates', { contract_id: contractId, contract_type: contractType }),
      countRowsByFilters('contract_variations', { contract_id: contractId, contract_type: contractType }),
      countRowsByFilters('contract_appendices', { contract_id: contractId, contract_type: contractType }),
      countRowsByFilters('payment_schedules', { contract_id: contractId, contract_type: contractType }),
      contractType === 'customer' ? countRows('contract_guarantees', 'contract_id', contractId) : Promise.resolve(0),
      countRowsByFilters('advance_payments', { contract_id: contractId, contract_type: contractType }),
    ]);

    deps.metadata = {
      boqCount,
      acceptanceCount,
      paymentCount,
      variationCount,
      appendixCount,
      scheduleCount,
      guaranteeCount,
      advanceCount,
    };
    if (boqCount > 0) {
      pushBlocker(deps, 'Không thể xoá hợp đồng vì còn dòng BOQ hợp đồng.', 'Xoá/rollback BOQ hợp đồng trước khi xoá hợp đồng.');
    }
    if (acceptanceCount > 0) {
      pushBlocker(deps, 'Không thể xoá hợp đồng vì còn nghiệm thu liên kết.', 'Rollback nghiệm thu trước khi xoá hợp đồng.');
    }
    if (paymentCount > 0) {
      pushBlocker(deps, 'Không thể xoá hợp đồng vì còn chứng từ thanh toán liên kết.', 'Rollback/xoá chứng từ thanh toán trước khi xoá hợp đồng.');
    }
    if (variationCount > 0) {
      pushBlocker(deps, 'Không thể xoá hợp đồng vì còn điều chỉnh BOQ/phát sinh.', 'Xử lý điều chỉnh BOQ/phát sinh trước khi xoá hợp đồng.');
    }
    if (appendixCount > 0) {
      pushBlocker(deps, 'Không thể xoá hợp đồng vì còn phụ lục hợp đồng.', 'Xoá phụ lục hợp đồng trước khi xoá hợp đồng.');
    }
    if (scheduleCount > 0) {
      pushBlocker(deps, 'Không thể xoá hợp đồng vì còn lịch thanh toán.', 'Xoá lịch thanh toán trước khi xoá hợp đồng.');
    }
    if (guaranteeCount > 0) {
      pushBlocker(deps, 'Không thể xoá hợp đồng vì còn bảo lãnh hợp đồng.', 'Xử lý bảo lãnh hợp đồng trước khi xoá hợp đồng.');
    }
    if (advanceCount > 0) {
      pushBlocker(deps, 'Không thể xoá hợp đồng vì còn khoản tạm ứng.', 'Rollback/xử lý tạm ứng trước khi xoá hợp đồng.');
    }
    return deps;
  },

  async getContractItemDependencies(contractItemId: string, isLocked?: boolean): Promise<ProjectDocumentDependencies> {
    const deps = emptyDependencies();
    const [paymentCount, acceptanceCount, childCount] = await Promise.all([
      countRows('payment_certificate_items', 'contract_item_id', contractItemId),
      countRows('quantity_acceptance_items', 'contract_item_id', contractItemId),
      countRows('contract_items', 'parent_id', contractItemId),
    ]);
    deps.metadata = { paymentCount, acceptanceCount, childCount, isLocked: !!isLocked };
    if (childCount > 0) {
      pushBlocker(
        deps,
        'Không thể xoá BOQ vì còn hạng mục con.',
        'Xoá hoặc chuyển hạng mục con sang nhóm khác trước khi xoá BOQ cha.',
      );
    }
    if (paymentCount > 0) {
      pushBlocker(
        deps,
        'Không thể xoá BOQ vì đã có dòng chứng từ thanh toán liên kết.',
        'Rollback hoặc xoá chứng từ thanh toán trước khi chỉnh BOQ gốc.',
      );
    }
    if (acceptanceCount > 0) {
      pushBlocker(
        deps,
        'Không thể xoá BOQ vì đã có dòng nghiệm thu liên kết.',
        'Rollback hoặc xoá nghiệm thu trước khi chỉnh BOQ gốc.',
      );
    }
    if (isLocked) {
      pushBlocker(
        deps,
        'Không thể xoá/sửa BOQ vì hạng mục đã bị khoá bởi nghiệm thu hoặc thanh toán.',
        'Điều chỉnh qua phát sinh hợp đồng hoặc rollback chứng từ downstream trước.',
      );
    }
    return deps;
  },
};
