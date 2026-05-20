import { supabase } from './supabase';
import {
    ProjectTask, DailyLog, AcceptanceRecord,
    MaterialBudgetItem, ProjectMaterialRequest, ProjectVendor,
    PurchaseOrder, PaymentSchedule, ProjectBaseline, ProjectWorkBoqItem
} from '../types';
import { auditService } from './auditService';
import { dailyLogDetailService } from './dailyLogDetailService';
import { buildProjectScopeFilter, dedupeRowsById } from './projectScope';
import { createPoQrToken } from './poQr';

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
            .order('sort_order', { ascending: true });
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
            .order('sort_order', { ascending: true });
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
        // Mục 8: Strip JSONB array fields — data chi tiết lưu trong normalized tables
        // (daily_log_volumes, daily_log_materials, daily_log_labor, daily_log_machines)
        // Không gửi lên daily_logs để tránh double-write và drift
        const { volumes, materials, laborDetails, machines, ...metaItem } = item;
        const { error } = await supabase
            .from('daily_logs')
            .upsert(toDb(metaItem), { onConflict: 'id' });
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
    }): Promise<void> {
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
            .order('category', { ascending: true });
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

// ==================== WORK BOQ (TỪ TIẾN ĐỘ) ====================
export const workBoqService = {
    async list(projectIdOrSiteId: string, constructionSiteId?: string | null): Promise<ProjectWorkBoqItem[]> {
        const { data, error } = await supabase
            .from('project_work_boq_items')
            .select('*')
            .or(buildProjectScopeFilter(projectIdOrSiteId, constructionSiteId))
            .order('sort_order', { ascending: true });
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
            .upsert(toDb(item), { onConflict: 'id' });
        if (error) throw error;
    },
    async remove(id: string): Promise<void> {
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
export const poService = {
    async list(projectIdOrSiteId: string, constructionSiteId?: string | null): Promise<PurchaseOrder[]> {
        const { data, error } = await supabase
            .from('purchase_orders')
            .select('*')
            .or(buildProjectScopeFilter(projectIdOrSiteId, constructionSiteId))
            .order('created_at', { ascending: false });
        if (error) throw error;
        return dedupeRowsById(data || []).map(fromDb);
    },
    async upsert(item: PurchaseOrder): Promise<void> {
        const { error } = await supabase
            .from('purchase_orders')
            .upsert(toDb(item), { onConflict: 'id' });
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
        receiptLines: { itemId: string; quantity: number }[],
        transactionId: string
    ): Promise<PurchaseOrder> {
        const { data, error } = await supabase
            .from('purchase_orders')
            .select('*')
            .eq('id', poId)
            .single();
        if (error) throw error;

        const po = fromDb(data) as PurchaseOrder;
        const receiptMap = new Map(receiptLines.map(line => [line.itemId, Number(line.quantity) || 0]));
        let hasReceipt = false;

        const nextItems = po.items.map(item => {
            const receiveQty = receiptMap.get(item.itemId) || 0;
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
        const { error } = await supabase
            .from('purchase_orders')
            .delete()
            .eq('id', id);
        if (error) throw error;
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
        return dedupeRowsById(data || []).map(fromDb);
    },
    async upsert(item: PaymentSchedule): Promise<void> {
        const { error } = await supabase
            .from('payment_schedules')
            .upsert(toDb(item), { onConflict: 'id' });
        if (error) throw error;
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
        return (data || []).map(fromDb);
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
