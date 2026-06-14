import { supabase } from './supabase';
import {
    ProjectTask, DailyLog, AcceptanceRecord,
    MaterialBudgetItem, ProjectMaterialRequest, ProjectVendor,
    PurchaseOrder, PaymentSchedule, ProjectBaseline, ProjectWorkBoqItem, PurchaseOrderRequestLineLink,
    PaymentDossierStatus, PaymentQualityStatus, PaymentScheduleMilestoneType
} from '../types';
import { auditService } from './auditService';
import { dailyLogDetailService } from './dailyLogDetailService';
import { buildProjectScopeFilter, dedupeRowsById } from './projectScope';
import { createPoQrToken } from './poQr';
import { projectTransactionService } from './projectTransactionService';
import { projectDocumentDependencyService } from './projectDocumentDependencyService';
import { projectSubmissionService } from './projectSubmissionService';

// ==================== HELPER ====================
// snake_case ↔ camelCase mapping
const toSnake = (s: string) => s.replace(/[A-Z]/g, l => `_${l.toLowerCase()}`);
const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, l) => l.toUpperCase());

const mapKeys = (obj: any, fn: (k: string) => string): any => {
    if (Array.isArray(obj)) return obj.map(v => mapKeys(v, fn));
    if (obj && typeof obj === 'object' && !(obj instanceof Date)) {
        return Object.fromEntries(Object.entries(obj).map(([k, v]) => [fn(k), v]));
    }
    return obj;
};
const toDb = (obj: any) => mapKeys(obj, toSnake);
const fromDb = (obj: any) => mapKeys(obj, toCamel);

const PAYMENT_MILESTONE_TYPES = new Set<PaymentScheduleMilestoneType>(['advance', 'progress', 'settlement', 'retention', 'other']);
const PAYMENT_DOSSIER_STATUSES = new Set<PaymentDossierStatus>(['not_started', 'preparing', 'submitted', 'approved']);
const PAYMENT_QUALITY_STATUSES = new Set<PaymentQualityStatus>(['not_applicable', 'not_confirmed', 'passed', 'failed']);
const getDefaultPaymentQualityStatus = (milestoneType: PaymentScheduleMilestoneType): PaymentQualityStatus =>
    milestoneType === 'advance' ? 'not_applicable' : 'not_confirmed';

const normalizePaymentSchedule = (row: any): PaymentSchedule => {
    const item = fromDb(row || {}) as PaymentSchedule;
    const milestoneType = PAYMENT_MILESTONE_TYPES.has(item.milestoneType as PaymentScheduleMilestoneType)
        ? item.milestoneType as PaymentScheduleMilestoneType
        : 'progress';
    const qualityDefault = getDefaultPaymentQualityStatus(milestoneType);
    return {
        ...item,
        sequenceNo: Number(item.sequenceNo || 1),
        milestoneType,
        amount: Number(item.amount || 0),
        paidAmount: Number(item.paidAmount || 0),
        status: item.status || 'pending',
        type: item.type || 'receivable',
        plannedTaskIds: Array.isArray(item.plannedTaskIds) ? item.plannedTaskIds.filter(Boolean) : [],
        dossierStatus: PAYMENT_DOSSIER_STATUSES.has(item.dossierStatus as PaymentDossierStatus)
            ? item.dossierStatus
            : 'not_started',
        qualityStatus: PAYMENT_QUALITY_STATUSES.has(item.qualityStatus as PaymentQualityStatus)
            ? item.qualityStatus
            : qualityDefault,
    };
};

const paymentScheduleToDb = (item: PaymentSchedule) => toDb({
    id: item.id,
    projectId: item.projectId || null,
    constructionSiteId: item.constructionSiteId || null,
    contractId: item.contractId || null,
    contractType: item.contractType || null,
    appendixId: item.appendixId || null,
    sequenceNo: item.sequenceNo || 1,
    milestoneType: item.milestoneType || 'progress',
    description: item.description || '',
    amount: Number(item.amount || 0),
    dueDate: item.dueDate || new Date().toISOString().slice(0, 10),
    paidDate: item.paidDate || null,
    paidAmount: Number(item.paidAmount || 0),
    status: item.status || 'pending',
    type: item.type || 'receivable',
    contactName: item.contactName || null,
    plannedTaskIds: item.plannedTaskIds || [],
    plannedScopeNote: item.plannedScopeNote || null,
    dossierStatus: item.dossierStatus || 'not_started',
    qualityStatus: item.qualityStatus || getDefaultPaymentQualityStatus(item.milestoneType || 'progress'),
    qualityConfirmedBy: item.qualityConfirmedBy || null,
    qualityConfirmedName: item.qualityConfirmedName || null,
    qualityConfirmedAt: item.qualityConfirmedAt || null,
    qualityNote: item.qualityNote || null,
    note: item.note || null,
});

const FULFILLMENT_BATCH_TABLE = 'material_request_fulfillment_batches';
const FULFILLMENT_LINE_TABLE = 'material_request_fulfillment_lines';
const DEFAULT_PROJECT_LIST_PAGE_SIZE = 500;

type ListPage<T> = {
    rows: T[];
    nextCursor: string | null;
    hasMore: boolean;
};

const normalizePageLimit = (limit?: number | null): number =>
    Math.max(1, Math.min(Math.floor(Number(limit || DEFAULT_PROJECT_LIST_PAGE_SIZE)), 1000));

const parseOffsetCursor = (cursor?: string | null): number => {
    const offset = Number(cursor || 0);
    return Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
};

const extractReturnTransactionIds = (note?: string | null): string[] => {
    if (!note) return [];
    const matches = note.match(/tx-[a-z0-9-]+/gi) || [];
    return Array.from(new Set(matches));
};

const getPoReceiptCleanupState = async (po: PurchaseOrder) => {
    const { data: lineRows, error: lineError } = await supabase
        .from(FULFILLMENT_LINE_TABLE)
        .select('batch_id,item_id,received_qty')
        .eq('po_id', po.id);
    if (lineError) {
        if (lineError.code === '42P01') {
            return { hasActiveBatches: false, hasReceivedBatchQty: false, hasMissingReturnTransaction: false, hasUnfinishedTransactions: false, hasInsufficientReturnQty: false };
        }
        throw lineError;
    }

    const batchIds = Array.from(new Set((lineRows || []).map(row => row.batch_id).filter(Boolean)));
    const hasReceivedBatchQty = (lineRows || []).some(row => Number(row.received_qty || 0) > 0);
    const receivedQtyByItemId = (lineRows || []).reduce((map: Map<string, number>, row: any) => {
        const qty = Number(row.received_qty || 0);
        if (qty <= 0 || !row.item_id) return map;
        map.set(row.item_id, (map.get(row.item_id) || 0) + qty);
        return map;
    }, new Map<string, number>());
    if (batchIds.length === 0) {
        return { hasActiveBatches: false, hasReceivedBatchQty, hasMissingReturnTransaction: false, hasUnfinishedTransactions: false, hasInsufficientReturnQty: false };
    }

    const { data: batchRows, error: batchError } = await supabase
        .from(FULFILLMENT_BATCH_TABLE)
        .select('id,status,note,transaction_id')
        .in('id', batchIds);
    if (batchError) throw batchError;

    const finalBatchStatuses = new Set(['returned', 'cancelled']);
    const batches = batchRows || [];
    const hasActiveBatches = batches.some(batch => !finalBatchStatuses.has(String(batch.status || '').toLowerCase()));
    const returnTransactionIds = Array.from(new Set(batches.flatMap(batch => extractReturnTransactionIds(batch.note))));
    const receiptTransactionIds = Array.from(new Set([
        ...(po.receivedTransactionIds || []),
        ...batches.map(batch => batch.transaction_id).filter(Boolean),
    ]));
    const transactionIds = Array.from(new Set([...receiptTransactionIds, ...returnTransactionIds]));
    let hasUnfinishedTransactions = false;
    let completedReturnTransactionIds = new Set<string>();
    const returnedQtyByItemId = new Map<string, number>();

    if (transactionIds.length > 0) {
        const { data: txRows, error: txError } = await supabase
            .from('transactions')
            .select('id,status,items')
            .in('id', transactionIds);
        if (txError) throw txError;
        completedReturnTransactionIds = new Set(
            (txRows || [])
                .filter(tx => returnTransactionIds.includes(tx.id) && String(tx.status || '').toUpperCase() === 'COMPLETED')
                .map(tx => tx.id),
        );
        (txRows || [])
            .filter(tx => completedReturnTransactionIds.has(tx.id))
            .forEach(tx => {
                (tx.items || []).forEach((item: any) => {
                    if (!item.itemId) return;
                    returnedQtyByItemId.set(item.itemId, (returnedQtyByItemId.get(item.itemId) || 0) + Number(item.quantity || 0));
                });
            });
        hasUnfinishedTransactions = (txRows || []).some(tx => {
            const status = String(tx.status || '').toUpperCase();
            return status !== 'COMPLETED' && status !== 'CANCELLED';
        });
    }

    const hasReturnedBatch = batches.some(batch => String(batch.status || '').toLowerCase() === 'returned');
    const hasMissingReturnTransaction =
        hasReceivedBatchQty &&
        hasReturnedBatch &&
        (completedReturnTransactionIds.size === 0 || returnTransactionIds.some(txId => !completedReturnTransactionIds.has(txId)));
    const hasInsufficientReturnQty = Array.from(receivedQtyByItemId.entries())
        .some(([itemId, receivedQty]) => (returnedQtyByItemId.get(itemId) || 0) + 1e-9 < receivedQty);

    return {
        hasActiveBatches,
        hasReceivedBatchQty,
        hasMissingReturnTransaction,
        hasUnfinishedTransactions,
        hasInsufficientReturnQty,
        hasCompletedReturnTransaction: completedReturnTransactionIds.size > 0,
    };
};

const mapPage = <T>(
    data: any[] | null,
    limit: number,
    offset: number,
    mapper: (row: any) => T,
): ListPage<T> => {
    const rawRows = data || [];
    const hasMore = rawRows.length > limit;
    return {
        rows: rawRows.slice(0, limit).map(mapper),
        hasMore,
        nextCursor: hasMore ? String(offset + limit) : null,
    };
};

const loadAllPages = async <T>(loadPage: (cursor: string | null) => Promise<ListPage<T>>): Promise<T[]> => {
    const rows: T[] = [];
    let cursor: string | null = null;
    do {
        const page = await loadPage(cursor);
        rows.push(...page.rows);
        cursor = page.nextCursor;
    } while (cursor);
    return rows;
};

const taskFromDb = (row: any): ProjectTask => ({
    ...fromDb(row),
    order: row.sort_order ?? row.order ?? 0,
});

const taskToDb = (task: ProjectTask): any => {
    const row = toDb(task);
    row.sort_order = task.order ?? 0;
    delete row.order;
    // WBS tasks no longer own BOQ commercial fields. Keep legacy DB columns untouched during transition.
    delete row.code;
    delete row.quantity;
    delete row.unit;
    delete row.unit_price;
    delete row.total_price;
    delete row.completed_quantity;
    delete row.contract_item_id;
    return row;
};

// NOTE: contractService đã chuyển sang lib/hdService.ts


// ==================== TASKS (GANTT) ====================
export const taskService = {
    async list(projectIdOrSiteId: string, constructionSiteId?: string | null): Promise<ProjectTask[]> {
        const { data, error } = await supabase
            .from('project_tasks')
            .select('*')
            .or(buildProjectScopeFilter(projectIdOrSiteId, constructionSiteId))
            .order('sort_order', { ascending: true })
            .order('id', { ascending: true });
        if (error) throw error;
        return dedupeRowsById(data || []).map(taskFromDb);
    },
    async listBySites(siteIds: string[]): Promise<ProjectTask[]> {
        if (siteIds.length === 0) return [];
        const { data, error } = await supabase
            .from('project_tasks')
            .select('*')
            .in('construction_site_id', siteIds)
            .order('construction_site_id', { ascending: true })
            .order('sort_order', { ascending: true })
            .order('id', { ascending: true });
        if (error) throw error;
        return (data || []).map(taskFromDb);
    },
    async upsertMany(items: ProjectTask[]): Promise<void> {
        const { error } = await supabase
            .from('project_tasks')
            .upsert(items.map(taskToDb), { onConflict: 'id' });
        if (error) throw error;
    },
    async upsert(item: ProjectTask): Promise<void> {
        const { error } = await supabase
            .from('project_tasks')
            .upsert(taskToDb(item), { onConflict: 'id' });
        if (error) throw error;
    },
    async remove(id: string): Promise<void> {
        const { error } = await supabase
            .from('project_tasks')
            .delete()
            .eq('id', id);
        if (error) throw error;
    },
};

// ==================== DAILY LOGS ====================
export const dailyLogService = {
    async list(projectIdOrSiteId: string, constructionSiteId?: string | null): Promise<DailyLog[]> {
        const { data, error } = await supabase
            .from('daily_logs')
            .select('*')
            .or(buildProjectScopeFilter(projectIdOrSiteId, constructionSiteId))
            .order('date', { ascending: false });
        if (error) throw error;
        const logs = dedupeRowsById(data || []).map(fromDb) as DailyLog[];
        const detailMap = await dailyLogDetailService.listByLogIds(logs.map(l => l.id));
        return logs.map(log => {
            const details = detailMap[log.id];
            if (!details) return log;
            return {
                ...log,
                volumes: details.volumes.length > 0 ? details.volumes : log.volumes,
                materials: details.materials.length > 0 ? details.materials : log.materials,
                laborDetails: details.laborDetails.length > 0 ? details.laborDetails : log.laborDetails,
                machines: details.machines.length > 0 ? details.machines : log.machines,
            };
        });
    },
    async upsert(item: DailyLog): Promise<void> {
        const { data: current, error: currentError } = await supabase
            .from('daily_logs')
            .select('status')
            .eq('id', item.id)
            .maybeSingle();
        if (currentError) throw currentError;
        if (current && !['draft', 'rejected'].includes(current.status || 'draft')) {
            throw new Error('Nhật ký đã gửi đi hoặc đã xác nhận, không thể chỉnh sửa trực tiếp. Vui lòng trả lại nhật ký trước khi sửa.');
        }
        if (current) {
            const deps = await projectDocumentDependencyService.getDailyLogDependencies({ ...item, status: current.status });
            if (deps.blockers.length > 0) {
                throw new Error(`${deps.blockers[0]} ${deps.requiredRollbackSteps.join(' ')}`);
            }
        }
        // Mục 8: Strip JSONB array fields — data chi tiết lưu trong normalized tables
        // (daily_log_volumes, daily_log_materials, daily_log_labor, daily_log_machines)
        // Không gửi lên daily_logs để tránh double-write và drift
        const { volumes, materials, laborDetails, machines, ...metaItem } = item;
        const { error } = await supabase
            .from('daily_logs')
            .upsert(toDb({
                ...metaItem,
                ...projectSubmissionService.actionMeta(undefined, (metaItem.status || 'draft') !== 'draft'),
            }), { onConflict: 'id' });
        if (error) throw error;
        await dailyLogDetailService.replaceForLog(item.id, item.projectId || null, item.constructionSiteId || null, {
            volumes: volumes || [],
            materials: materials || [],
            laborDetails: laborDetails || [],
            machines: machines || [],
        });
    },

    async updateStatus(input: {
        logId: string;
        status: NonNullable<DailyLog['status']>;
        requestedVerifierId?: string | null;
        requestedVerifierName?: string | null;
        rejectionReason?: string | null;
        actorUserId?: string | null;
    }): Promise<void> {
        if (input.status === 'rejected') {
            const { data: current, error: currentError } = await supabase
                .from('daily_logs')
                .select('status, created_by_id, submitted_by_id, submitted_by')
                .eq('id', input.logId)
                .single();
            if (currentError) throw currentError;
            if (current?.status === 'verified') {
                if (!input.rejectionReason?.trim()) {
                    throw new Error('Vui lòng nhập lý do trả lại nhật ký.');
                }
                const { error: updateError } = await supabase
                    .from('daily_logs')
                    .update({
                        status: 'rejected',
                        verified: false,
                        rejected_by: input.actorUserId || null,
                        rejected_by_id: input.actorUserId || null,
                        rejected_at: new Date().toISOString(),
                        rejection_reason: input.rejectionReason,
                        submitted_to_user_id: current.created_by_id || current.submitted_by_id || current.submitted_by || null,
                        submitted_to_permission: 'edit',
                        submission_note: input.rejectionReason,
                        last_action_by: input.actorUserId || null,
                        last_action_at: new Date().toISOString(),
                    })
                    .eq('id', input.logId);
                if (updateError) throw updateError;
                return;
            }
        }
        const { error } = await supabase.rpc('transition_daily_log_status', {
            p_log_id: input.logId,
            p_status: input.status,
            p_requested_verifier_id: input.requestedVerifierId || null,
            p_requested_verifier_name: input.requestedVerifierName || null,
            p_rejection_reason: input.rejectionReason || null,
        });
        if (error) throw error;
    },

    async remove(id: string): Promise<void> {
        const { data, error: readError } = await supabase
            .from('daily_logs')
            .select('status, ever_submitted')
            .eq('id', id)
            .single();
        if (readError) throw readError;
        if ((data?.status || 'draft') !== 'draft') {
            throw new Error('Chỉ xoá được nhật ký ở trạng thái Nháp. Phiếu đã gửi/duyệt cần được trả lại hoặc rollback theo đúng quy trình.');
        }
        if (data?.ever_submitted) {
            throw new Error('Nhật ký đã từng gửi xác nhận, không được xoá cứng. Vui lòng trả lại/rollback để giữ lịch sử.');
        }
        const { error } = await supabase
            .from('daily_logs')
            .delete()
            .eq('id', id);
        if (error) throw error;
    },
};

// ==================== ACCEPTANCE RECORDS ====================
export const acceptanceService = {
    async list(projectIdOrSiteId: string, constructionSiteId?: string | null): Promise<AcceptanceRecord[]> {
        const { data, error } = await supabase
            .from('acceptance_records')
            .select('*')
            .or(buildProjectScopeFilter(projectIdOrSiteId, constructionSiteId))
            .order('period_number', { ascending: true });
        if (error) throw error;
        return dedupeRowsById(data || []).map(fromDb);
    },
    async upsert(item: AcceptanceRecord): Promise<void> {
        const { error } = await supabase
            .from('acceptance_records')
            .upsert(toDb(item), { onConflict: 'id' });
        if (error) throw error;
    },
    async remove(id: string): Promise<void> {
        const { error } = await supabase
            .from('acceptance_records')
            .delete()
            .eq('id', id);
        if (error) throw error;
    },
};

// ==================== MATERIAL BUDGET (BOQ) ====================
export const boqService = {
    async list(projectIdOrSiteId: string, constructionSiteId?: string | null): Promise<MaterialBudgetItem[]> {
        const { data, error } = await supabase
            .from('material_budget_items')
            .select('*')
            .or(buildProjectScopeFilter(projectIdOrSiteId, constructionSiteId))
            .order('category', { ascending: true })
            .order('id', { ascending: true });
        if (error) throw error;
        return dedupeRowsById(data || []).map(fromDb);
    },
    async upsert(item: MaterialBudgetItem): Promise<void> {
        const { error } = await supabase
            .from('material_budget_items')
            .upsert(toDb(item), { onConflict: 'id' });
        if (error) throw error;
    },
    async remove(id: string): Promise<void> {
        const { error } = await supabase
            .from('material_budget_items')
            .delete()
            .eq('id', id);
        if (error) throw error;
    },
};

export interface WorkBoqSyncPreview {
    created: number;
    updated: number;
    skipped: number;
    orphaned: number;
}

const newId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const normalizeText = (value?: string | null) => (value || '').trim();

const sameWorkBoqMetadata = (a: ProjectWorkBoqItem, b: ProjectWorkBoqItem): boolean =>
    normalizeText(a.wbsCode) === normalizeText(b.wbsCode) &&
    normalizeText(a.name) === normalizeText(b.name) &&
    normalizeText(a.parentId) === normalizeText(b.parentId) &&
    Number(a.sortOrder || 0) === Number(b.sortOrder || 0) &&
    a.syncStatus === b.syncStatus;

const buildWorkBoqRowsFromTasks = (
    projectIdOrSiteId: string,
    constructionSiteId: string | null | undefined,
    tasks: ProjectTask[],
    existingItems: ProjectWorkBoqItem[],
): { rows: ProjectWorkBoqItem[]; preview: WorkBoqSyncPreview } => {
    const taskById = new Map(tasks.map(task => [task.id, task]));
    const existingByTaskId = new Map(
        existingItems
            .filter(item => item.sourceTaskId)
            .map(item => [item.sourceTaskId as string, item])
    );
    const idByTaskId = new Map<string, string>();
    tasks.forEach(task => idByTaskId.set(task.id, existingByTaskId.get(task.id)?.id || newId()));

    const preview: WorkBoqSyncPreview = { created: 0, updated: 0, skipped: 0, orphaned: 0 };
    const rows: ProjectWorkBoqItem[] = [];

    tasks
        .slice()
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .forEach((task, index) => {
            const existing = existingByTaskId.get(task.id);
            const parentTask = task.parentId ? taskById.get(task.parentId) : undefined;
            const parentId = parentTask ? idByTaskId.get(parentTask.id) || null : null;
            const next: ProjectWorkBoqItem = {
                id: idByTaskId.get(task.id) || newId(),
                projectId: projectIdOrSiteId,
                constructionSiteId: constructionSiteId || null,
                sourceTaskId: task.id,
                parentId,
                wbsCode: task.wbsCode || null,
                name: task.name,
                unit: existing?.unit ?? task.fallbackUnit ?? '',
                plannedQty: existing?.plannedQty ?? task.provisionalQuantity ?? 0,
                unitPrice: existing?.unitPrice ?? 0,
                totalAmount: (existing?.plannedQty ?? task.provisionalQuantity ?? 0) * (existing?.unitPrice ?? 0),
                sortOrder: task.order ?? index,
                syncStatus: 'synced',
                notes: existing?.notes || null,
                createdAt: existing?.createdAt,
            };
            rows.push(next);
            if (!existing) preview.created += 1;
            else if (sameWorkBoqMetadata(existing, next)) preview.skipped += 1;
            else preview.updated += 1;
        });

    existingItems
        .filter(item => item.sourceTaskId && !taskById.has(item.sourceTaskId))
        .forEach(item => {
            if (item.syncStatus !== 'orphaned') preview.orphaned += 1;
            else preview.skipped += 1;
            rows.push({ ...item, syncStatus: 'orphaned' });
        });

    return { rows, preview };
};

const workBoqToDb = (item: ProjectWorkBoqItem): any => {
    const row = toDb(item);
    delete row.total_amount;
    delete row.created_at;
    delete row.updated_at;
    return row;
};

const poToDb = (po: PurchaseOrder): any => {
    const row = toDb(po);
    row.items = po.items || [];
    row.received_transaction_ids = po.receivedTransactionIds || [];
    return row;
};

const poRequestLineLinkToDb = (link: PurchaseOrderRequestLineLink): any => {
    const row = toDb(link);
    delete row.created_at;
    return row;
};

// ==================== WORK BOQ (TỪ TIẾN ĐỘ) ====================
export const workBoqService = {
    async list(projectIdOrSiteId: string, constructionSiteId?: string | null): Promise<ProjectWorkBoqItem[]> {
        const { data, error } = await supabase
            .from('project_work_boq_items')
            .select('*')
            .or(buildProjectScopeFilter(projectIdOrSiteId, constructionSiteId))
            .order('sort_order', { ascending: true })
            .order('id', { ascending: true });
        if (error) throw error;
        return dedupeRowsById(data || []).map(fromDb);
    },

    previewSync(tasks: ProjectTask[], existingItems: ProjectWorkBoqItem[]): WorkBoqSyncPreview {
        return buildWorkBoqRowsFromTasks('', null, tasks, existingItems).preview;
    },

    async syncFromTasks(
        projectIdOrSiteId: string,
        constructionSiteId: string | null | undefined,
        tasks: ProjectTask[],
        existingItems: ProjectWorkBoqItem[],
    ): Promise<WorkBoqSyncPreview> {
        const { rows, preview } = buildWorkBoqRowsFromTasks(projectIdOrSiteId, constructionSiteId, tasks, existingItems);
        if (rows.length > 0) {
            const { error } = await supabase
                .from('project_work_boq_items')
                .upsert(rows.map(workBoqToDb), { onConflict: 'id' });
            if (error) throw error;
        }
        return preview;
    },

    async upsert(item: ProjectWorkBoqItem): Promise<void> {
        const { error } = await supabase
            .from('project_work_boq_items')
            .upsert(workBoqToDb(item), { onConflict: 'id' });
        if (error) throw error;
    },

    async upsertMany(items: ProjectWorkBoqItem[]): Promise<void> {
        if (items.length === 0) return;
        const { error } = await supabase
            .from('project_work_boq_items')
            .upsert(items.map(workBoqToDb), { onConflict: 'id' });
        if (error) throw error;
    },

    async remove(id: string): Promise<void> {
        const { error } = await supabase.from('project_work_boq_items').delete().eq('id', id);
        if (error) throw error;
    },
};

// ==================== MATERIAL REQUESTS ====================
export const matRequestService = {
    async list(projectIdOrSiteId: string, constructionSiteId?: string | null): Promise<ProjectMaterialRequest[]> {
        const { data, error } = await supabase
            .from('project_material_requests')
            .select('*')
            .or(buildProjectScopeFilter(projectIdOrSiteId, constructionSiteId))
            .order('created_at', { ascending: false });
        if (error) throw error;
        return dedupeRowsById(data || []).map(fromDb);
    },
    async upsert(item: ProjectMaterialRequest): Promise<void> {
        const { error } = await supabase
            .from('project_material_requests')
            .upsert(toDb({
                ...item,
                ...projectSubmissionService.actionMeta(undefined, true),
            }), { onConflict: 'id' });
        if (error) throw error;
    },
    async remove(id: string): Promise<void> {
        const { data: current, error: readError } = await supabase
            .from('project_material_requests')
            .select('status, ever_submitted')
            .eq('id', id)
            .single();
        if (readError) throw readError;
        if (current.status !== 'draft' || current.ever_submitted) {
            throw new Error('Chỉ xoá cứng yêu cầu vật tư nháp chưa từng gửi duyệt.');
        }
        const { error } = await supabase
            .from('project_material_requests')
            .delete()
            .eq('id', id);
        if (error) throw error;
    },
};

// ==================== VENDORS ====================
export const vendorService = {
    async list(projectIdOrSiteId: string, constructionSiteId?: string | null): Promise<ProjectVendor[]> {
        const { data, error } = await supabase
            .from('project_vendors')
            .select('*')
            .or(buildProjectScopeFilter(projectIdOrSiteId, constructionSiteId))
            .order('name', { ascending: true });
        if (error) throw error;
        return dedupeRowsById(data || []).map(fromDb);
    },
    async upsert(item: ProjectVendor): Promise<void> {
        const { error } = await supabase
            .from('project_vendors')
            .upsert(toDb(item), { onConflict: 'id' });
        if (error) throw error;
    },
    async remove(id: string): Promise<void> {
        const { error } = await supabase
            .from('project_vendors')
            .delete()
            .eq('id', id);
        if (error) throw error;
    },
};

// ==================== PURCHASE ORDERS ====================
const listPurchaseOrdersPage = async (input: {
    projectIdOrSiteId: string;
    constructionSiteId?: string | null;
    limit?: number | null;
    cursor?: string | null;
}): Promise<ListPage<PurchaseOrder>> => {
    const limit = normalizePageLimit(input.limit);
    const offset = parseOffsetCursor(input.cursor);
    const { data, error } = await supabase
        .from('purchase_orders')
        .select('*')
        .or(buildProjectScopeFilter(input.projectIdOrSiteId, input.constructionSiteId))
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(offset, offset + limit);
    if (error) throw error;
    return mapPage(data || [], limit, offset, fromDb);
};

const listAllPurchaseOrders = async (projectIdOrSiteId: string, constructionSiteId?: string | null): Promise<PurchaseOrder[]> => {
    const rows = await loadAllPages(cursor => listPurchaseOrdersPage({
        projectIdOrSiteId,
        constructionSiteId,
        cursor,
    }));
    return dedupeRowsById(rows);
};

const listStockPurchaseOrdersPage = async (input: {
    limit?: number | null;
    cursor?: string | null;
} = {}): Promise<ListPage<PurchaseOrder>> => {
    const limit = normalizePageLimit(input.limit);
    const offset = parseOffsetCursor(input.cursor);
    const { data, error } = await supabase
        .from('purchase_orders')
        .select('*')
        .eq('source_mode', 'proactive_stock')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(offset, offset + limit);
    if (error) throw error;
    return mapPage(data || [], limit, offset, fromDb);
};

const listAllStockPurchaseOrders = async (): Promise<PurchaseOrder[]> =>
    loadAllPages(cursor => listStockPurchaseOrdersPage({ cursor }));

const listPurchaseOrderRequestLineLinksPage = async (input: {
    projectIdOrSiteId: string;
    constructionSiteId?: string | null;
    limit?: number | null;
    cursor?: string | null;
}): Promise<ListPage<PurchaseOrderRequestLineLink>> => {
    const limit = normalizePageLimit(input.limit);
    const offset = parseOffsetCursor(input.cursor);
    const { data, error } = await supabase
        .from('purchase_order_request_lines')
        .select('*')
        .or(buildProjectScopeFilter(input.projectIdOrSiteId, input.constructionSiteId))
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(offset, offset + limit);
    if (error) throw error;
    return mapPage(data || [], limit, offset, fromDb);
};

const listAllPurchaseOrderRequestLineLinks = async (
    projectIdOrSiteId: string,
    constructionSiteId?: string | null,
): Promise<PurchaseOrderRequestLineLink[]> => {
    const rows = await loadAllPages(cursor => listPurchaseOrderRequestLineLinksPage({
        projectIdOrSiteId,
        constructionSiteId,
        cursor,
    }));
    return dedupeRowsById(rows);
};

export const poService = {
    async list(projectIdOrSiteId: string, constructionSiteId?: string | null): Promise<PurchaseOrder[]> {
        return listAllPurchaseOrders(projectIdOrSiteId, constructionSiteId);
    },
    async listPage(input: {
        projectIdOrSiteId: string;
        constructionSiteId?: string | null;
        limit?: number | null;
        cursor?: string | null;
    }): Promise<ListPage<PurchaseOrder>> {
        return listPurchaseOrdersPage(input);
    },
    async upsert(item: PurchaseOrder): Promise<void> {
        const { error } = await supabase
            .from('purchase_orders')
            .upsert(poToDb({
                ...item,
                ...projectSubmissionService.actionMeta(undefined, item.status !== 'draft'),
            }), { onConflict: 'id' });
        if (error) throw error;
    },
    async updateStatus(id: string, patch: Partial<PurchaseOrder>): Promise<void> {
        const row = toDb(patch);
        if (patch.receivedTransactionIds) row.received_transaction_ids = patch.receivedTransactionIds;
        delete row.id;
        delete row.created_at;
        const { error } = await supabase
            .from('purchase_orders')
            .update(row)
            .eq('id', id);
        if (error) throw error;
    },
    async listStockOrders(): Promise<PurchaseOrder[]> {
        return listAllStockPurchaseOrders();
    },
    async listStockOrdersPage(input: {
        limit?: number | null;
        cursor?: string | null;
    } = {}): Promise<ListPage<PurchaseOrder>> {
        return listStockPurchaseOrdersPage(input);
    },
    async listRequestLineLinks(projectIdOrSiteId: string, constructionSiteId?: string | null): Promise<PurchaseOrderRequestLineLink[]> {
        return listAllPurchaseOrderRequestLineLinks(projectIdOrSiteId, constructionSiteId);
    },
    async listRequestLineLinksPage(input: {
        projectIdOrSiteId: string;
        constructionSiteId?: string | null;
        limit?: number | null;
        cursor?: string | null;
    }): Promise<ListPage<PurchaseOrderRequestLineLink>> {
        return listPurchaseOrderRequestLineLinksPage(input);
    },
    async replaceRequestLineLinks(purchaseOrderId: string, links: PurchaseOrderRequestLineLink[]): Promise<void> {
        const { error: deleteError } = await supabase
            .from('purchase_order_request_lines')
            .delete()
            .eq('purchase_order_id', purchaseOrderId);
        if (deleteError) throw deleteError;
        if (links.length === 0) return;
        const { error } = await supabase
            .from('purchase_order_request_lines')
            .upsert(links.map(poRequestLineLinkToDb), {
                onConflict: 'purchase_order_id,purchase_order_line_id,material_request_id,request_line_id',
            });
        if (error) throw error;
    },
    async getByQrToken(token: string): Promise<PurchaseOrder | null> {
        const { data, error } = await supabase
            .from('purchase_orders')
            .select('*')
            .eq('qr_token', token)
            .maybeSingle();
        if (error) throw error;
        return data ? fromDb(data) as PurchaseOrder : null;
    },
    async ensureQrToken(item: PurchaseOrder): Promise<PurchaseOrder> {
        if (item.qrToken) return item;
        const next = { ...item, qrToken: createPoQrToken() };
        await this.upsert(next);
        return next;
    },
    async receivePo(
        poId: string,
        receiptLines: { itemId: string; quantity: number; lineId?: string }[],
        transactionId: string
    ): Promise<PurchaseOrder> {
        const { data, error } = await supabase
            .from('purchase_orders')
            .select('*')
            .eq('id', poId)
            .single();
        if (error) throw error;

        const po = fromDb(data) as PurchaseOrder;
        if (['cancelled', 'closed', 'returned', 'delivered'].includes(po.status)) {
            throw new Error('PO đã huỷ/đóng/hoàn hàng/hoàn thành, không thể nhập kho.');
        }
        const receiptMap = new Map(receiptLines.map(line => [line.lineId || line.itemId, Number(line.quantity) || 0]));
        let hasReceipt = false;

        const nextItems = po.items.map(item => {
            const receiveQty = receiptMap.get(item.lineId || item.itemId) || 0;
            const orderedQty = Number(item.qty) || 0;
            const receivedQty = Number(item.receivedQty) || 0;
            const remainingQty = Math.max(orderedQty - receivedQty, 0);

            if (receiveQty <= 0) return item;
            if (receiveQty > remainingQty) {
                throw new Error(`Số lượng nhận của ${item.sku || item.name} vượt phần còn lại.`);
            }

            hasReceipt = true;
            return { ...item, receivedQty: receivedQty + receiveQty };
        });

        if (!hasReceipt) throw new Error('Chưa có dòng vật tư nào có số lượng nhận.');

        const isDelivered = nextItems.every(item => (Number(item.receivedQty) || 0) >= (Number(item.qty) || 0));
        const updated: PurchaseOrder = {
            ...po,
            items: nextItems,
            status: isDelivered ? 'delivered' : 'partial',
            actualDeliveryDate: isDelivered ? new Date().toISOString().split('T')[0] : po.actualDeliveryDate,
            receivedTransactionIds: [...(po.receivedTransactionIds || []), transactionId],
        };

        await this.upsert(updated);
        return updated;
    },
    async remove(id: string): Promise<void> {
        const { data: current, error: readError } = await supabase
            .from('purchase_orders')
            .select('*')
            .eq('id', id)
            .single();
        if (readError) throw readError;
        const po = fromDb(current) as PurchaseOrder & { everSubmitted?: boolean };
        const cleanupState = await getPoReceiptCleanupState(po);
        const receivedTransactionIds = po.receivedTransactionIds || [];
        const receivedQty = (po.items || []).reduce((sum, item) => sum + Number(item.receivedQty || 0), 0);
        const noReceipt = receivedQty <= 0 && receivedTransactionIds.length === 0 && !cleanupState.hasReceivedBatchQty;
        const status = String(po.status || '').toLowerCase();
        const stockReturned = !cleanupState.hasActiveBatches
            && !cleanupState.hasUnfinishedTransactions
            && !cleanupState.hasMissingReturnTransaction;
        if (cleanupState.hasActiveBatches) {
            throw new Error('PO còn đợt nhận/cấp từ đề xuất chưa hoàn trả, không thể xoá. Vui lòng hoàn kho đủ trước.');
        }
        if (cleanupState.hasUnfinishedTransactions) {
            throw new Error('PO còn phiếu kho chưa hoàn tất hoặc chưa huỷ, không thể xoá.');
        }
        if (cleanupState.hasMissingReturnTransaction) {
            throw new Error('PO đã phát sinh nhập kho nhưng chưa có phiếu hoàn kho completed đầy đủ, không thể xoá.');
        }
        if (cleanupState.hasInsufficientReturnQty) {
            throw new Error('PO đã phát sinh nhập kho nhưng số lượng hoàn kho chưa đủ, không thể xoá.');
        }
        const canHardDelete =
            (status === 'draft' && !po.everSubmitted && noReceipt) ||
            ((status === 'returned' || status === 'cancelled') && (noReceipt || (cleanupState.hasReceivedBatchQty && stockReturned))) ||
            (['partial', 'delivered', 'closed'].includes(status) && cleanupState.hasReceivedBatchQty && stockReturned);
        if (!canHardDelete) {
            throw new Error('Chỉ xoá PO nháp chưa gửi duyệt, hoặc PO đã hoàn kho đủ/không còn giao dịch kho dang dở.');
        }
        const { error: linkError } = await supabase
            .from('purchase_order_request_lines')
            .delete()
            .eq('purchase_order_id', id);
        if (linkError && linkError.code !== '42P01') throw linkError;
        const { data: deletedRows, error } = await supabase
            .from('purchase_orders')
            .delete()
            .eq('id', id)
            .select('id');
        if (error) throw error;
        if (!deletedRows || deletedRows.length === 0) {
            throw new Error('Không xoá được PO trên Supabase. Vui lòng kiểm tra quyền xoá hoặc trạng thái PO.');
        }
    },
};

// ==================== PAYMENT SCHEDULES ====================
export const paymentService = {
    async list(projectIdOrSiteId: string, constructionSiteId?: string | null): Promise<PaymentSchedule[]> {
        const { data, error } = await supabase
            .from('payment_schedules')
            .select('*')
            .or(buildProjectScopeFilter(projectIdOrSiteId, constructionSiteId))
            .order('due_date', { ascending: true });
        if (error) throw error;
        return dedupeRowsById(data || []).map(normalizePaymentSchedule);
    },
    async listScoped(projectId?: string | null, constructionSiteId?: string | null): Promise<PaymentSchedule[]> {
        let query = supabase
            .from('payment_schedules')
            .select('*')
            .order('due_date', { ascending: true });
        if (projectId && constructionSiteId) {
            query = query.or(`project_id.eq.${projectId},construction_site_id.eq.${constructionSiteId}`);
        } else if (projectId) {
            query = query.eq('project_id', projectId);
        } else if (constructionSiteId) {
            query = query.eq('construction_site_id', constructionSiteId);
        }
        const { data, error } = await query;
        if (error) throw error;
        return dedupeRowsById(data || []).map(normalizePaymentSchedule);
    },
    async upsert(item: PaymentSchedule): Promise<void> {
        const normalized = normalizePaymentSchedule(item);
        const { error } = await supabase
            .from('payment_schedules')
            .upsert(paymentScheduleToDb(normalized), { onConflict: 'id' });
        if (error) throw error;
        if (normalized.status === 'paid') {
            await projectTransactionService.ensureWorkflowTransaction({
                sourceRef: `payment_schedule:${normalized.id}`,
                projectId: normalized.projectId || null,
                constructionSiteId: normalized.constructionSiteId,
                type: normalized.type === 'receivable' ? 'revenue_received' : 'expense',
                category: normalized.type === 'receivable' ? 'other' : normalized.contractType === 'subcontractor' ? 'subcontract' : 'materials',
                amount: Number(normalized.paidAmount || normalized.amount || 0),
                description: `${normalized.type === 'receivable' ? 'Thu' : 'Chi'} lịch thanh toán: ${normalized.description}`,
                date: normalized.paidDate || new Date().toISOString().slice(0, 10),
            });
        }
    },
    async listByContract(contractId: string, contractType?: PaymentSchedule['contractType']): Promise<PaymentSchedule[]> {
        let query = supabase
            .from('payment_schedules')
            .select('*')
            .eq('contract_id', contractId)
            .order('due_date', { ascending: true });
        if (contractType) query = query.eq('contract_type', contractType);
        const { data, error } = await query;
        if (error) throw error;
        return (data || []).map(normalizePaymentSchedule);
    },
    async remove(id: string): Promise<void> {
        const { error } = await supabase
            .from('payment_schedules')
            .delete()
            .eq('id', id);
        if (error) throw error;
    },
};

// ==================== BASELINES ====================
export const baselineService = {
    async list(projectIdOrSiteId: string, constructionSiteId?: string | null): Promise<ProjectBaseline[]> {
        const { data, error } = await supabase
            .from('project_baselines')
            .select('*')
            .or(buildProjectScopeFilter(projectIdOrSiteId, constructionSiteId))
            .order('locked_at', { ascending: false });
        if (error) throw error;
        return dedupeRowsById(data || []).map(fromDb);
    },
    async create(baseline: ProjectBaseline): Promise<void> {
        const { error } = await supabase
            .from('project_baselines')
            .insert(toDb(baseline));
        if (error) throw error;
    },
    async remove(id: string): Promise<void> {
        const { error } = await supabase
            .from('project_baselines')
            .delete()
            .eq('id', id);
        if (error) throw error;
    },
};
