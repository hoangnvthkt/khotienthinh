import { supabase } from './supabase';
import {
    ProjectTask, DailyLog, AcceptanceRecord,
    MaterialBudgetItem, ProjectMaterialRequest, ProjectVendor,
    PurchaseOrder, PaymentSchedule, ProjectBaseline
} from '../types';
import { auditService } from './auditService';

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
    return row;
};

// NOTE: contractService đã chuyển sang lib/hdService.ts


// ==================== TASKS (GANTT) ====================
export const taskService = {
    async list(siteId: string): Promise<ProjectTask[]> {
        const { data, error } = await supabase
            .from('project_tasks')
            .select('*')
            .eq('construction_site_id', siteId)
            .order('sort_order', { ascending: true });
        if (error) throw error;
        return (data || []).map(taskFromDb);
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
    async list(siteId: string): Promise<DailyLog[]> {
        const { data, error } = await supabase
            .from('daily_logs')
            .select('*')
            .eq('construction_site_id', siteId)
            .order('date', { ascending: false });
        if (error) throw error;
        return (data || []).map(fromDb);
    },
    async upsert(item: DailyLog): Promise<void> {
        const { error } = await supabase
            .from('daily_logs')
            .upsert(toDb(item), { onConflict: 'id' });
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
    async list(siteId: string): Promise<AcceptanceRecord[]> {
        const { data, error } = await supabase
            .from('acceptance_records')
            .select('*')
            .eq('construction_site_id', siteId)
            .order('period_number', { ascending: true });
        if (error) throw error;
        return (data || []).map(fromDb);
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
    async list(siteId: string): Promise<MaterialBudgetItem[]> {
        const { data, error } = await supabase
            .from('material_budget_items')
            .select('*')
            .eq('construction_site_id', siteId)
            .order('category', { ascending: true });
        if (error) throw error;
        return (data || []).map(fromDb);
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

// ==================== MATERIAL REQUESTS ====================
export const matRequestService = {
    async list(siteId: string): Promise<ProjectMaterialRequest[]> {
        const { data, error } = await supabase
            .from('project_material_requests')
            .select('*')
            .eq('construction_site_id', siteId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return (data || []).map(fromDb);
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
    async list(siteId: string): Promise<ProjectVendor[]> {
        const { data, error } = await supabase
            .from('project_vendors')
            .select('*')
            .eq('construction_site_id', siteId)
            .order('name', { ascending: true });
        if (error) throw error;
        return (data || []).map(fromDb);
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
    async list(siteId: string): Promise<PurchaseOrder[]> {
        const { data, error } = await supabase
            .from('purchase_orders')
            .select('*')
            .eq('construction_site_id', siteId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return (data || []).map(fromDb);
    },
    async upsert(item: PurchaseOrder): Promise<void> {
        const { error } = await supabase
            .from('purchase_orders')
            .upsert(toDb(item), { onConflict: 'id' });
        if (error) throw error;
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
    async list(siteId: string): Promise<PaymentSchedule[]> {
        const { data, error } = await supabase
            .from('payment_schedules')
            .select('*')
            .eq('construction_site_id', siteId)
            .order('due_date', { ascending: true });
        if (error) throw error;
        return (data || []).map(fromDb);
    },
    async upsert(item: PaymentSchedule): Promise<void> {
        const { error } = await supabase
            .from('payment_schedules')
            .upsert(toDb(item), { onConflict: 'id' });
        if (error) throw error;
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
    async list(siteId: string): Promise<ProjectBaseline[]> {
        const { data, error } = await supabase
            .from('project_baselines')
            .select('*')
            .eq('construction_site_id', siteId)
            .order('locked_at', { ascending: false });
        if (error) throw error;
        return (data || []).map(fromDb);
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
