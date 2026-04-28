
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { RequestCategory, RequestInstance, RequestLog, RQStatus, RequestApprover, RequestPrintTemplate } from '../types';
import { notificationService } from '../lib/notificationService';
import { auditService } from '../lib/auditService';
import { xpService } from '../lib/xpService';

interface RequestContextType {
    categories: RequestCategory[];
    requests: RequestInstance[];
    logs: RequestLog[];
    isLoading: boolean;

    // Category CRUD
    createCategory: (data: Omit<RequestCategory, 'id' | 'createdAt' | 'updatedAt'>) => Promise<RequestCategory | null>;
    updateCategory: (cat: RequestCategory) => Promise<void>;
    deleteCategory: (id: string) => Promise<void>;

    // Request CRUD
    createRequest: (data: {
        categoryId: string;
        title: string;
        description: string;
        priority: string;
        formData: Record<string, any>;
        userId: string;
        approvers: { userId: string }[];
        dueDate?: string;
    }) => Promise<RequestInstance | null>;
    updateRequest: (id: string, updates: Partial<Pick<RequestInstance, 'title' | 'description' | 'priority' | 'formData' | 'dueDate'>>) => Promise<boolean>;
    deleteRequest: (id: string) => Promise<boolean>;

    // Actions
    submitRequest: (id: string, userId: string) => Promise<boolean>;
    approveRequest: (id: string, userId: string, comment?: string) => Promise<boolean>;
    rejectRequest: (id: string, userId: string, comment?: string) => Promise<boolean>;
    completeRequest: (id: string, userId: string, comment?: string) => Promise<boolean>;
    cancelRequest: (id: string, userId: string, comment?: string) => Promise<boolean>;

    getRequestLogs: (requestId: string) => RequestLog[];
    getCurrentApproverStep: (req: RequestInstance) => RequestApprover | null;
    refreshData: () => Promise<void>;

    // Print templates
    printTemplates: RequestPrintTemplate[];
    uploadRQPrintTemplate: (categoryId: string, name: string, file: File) => Promise<boolean>;
    deleteRQPrintTemplate: (id: string, storagePath: string) => Promise<boolean>;
    getRQPrintTemplates: (categoryId: string) => RequestPrintTemplate[];
}

const RequestContext = createContext<RequestContextType | undefined>(undefined);

// DB <-> TS mappers
const mapCategoryFromDB = (row: any): RequestCategory => ({
    id: row.id,
    name: row.name,
    description: row.description || '',
    icon: row.icon || 'FileText',
    color: row.color || 'from-blue-500 to-cyan-500',
    customFields: row.custom_fields || [],
    approverRole: row.approver_role || undefined,
    approverUserId: row.approver_user_id || undefined,
    slaHours: row.sla_hours != null ? Number(row.sla_hours) : undefined,
    isActive: row.is_active,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

const mapRequestFromDB = (row: any): RequestInstance => ({
    id: row.id,
    categoryId: row.category_id,
    code: row.code,
    title: row.title,
    description: row.description || '',
    priority: row.priority || 'medium',
    formData: row.form_data || {},
    createdBy: row.created_by,
    approverId: row.approver_id || undefined,
    approvers: row.approvers || [],
    assignedTo: row.assigned_to || undefined,
    status: row.status,
    dueDate: row.due_date || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

const mapLogFromDB = (row: any): RequestLog => ({
    id: row.id,
    requestId: row.request_id,
    action: row.action,
    actedBy: row.acted_by,
    comment: row.comment || '',
    createdAt: row.created_at,
});

export const RequestProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [categories, setCategories] = useState<RequestCategory[]>([]);
    const [requests, setRequests] = useState<RequestInstance[]>([]);
    const [logs, setLogs] = useState<RequestLog[]>([]);
    const [printTemplates, setPrintTemplates] = useState<RequestPrintTemplate[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const refreshData = useCallback(async () => {
        setIsLoading(true);
        try {
            const [catRes, reqRes, logRes, ptRes] = await Promise.all([
                supabase.from('request_categories').select('*').order('created_at', { ascending: false }),
                supabase.from('request_instances').select('*').order('created_at', { ascending: false }),
                supabase.from('request_logs').select('*').order('created_at', { ascending: true }),
                supabase.from('request_print_templates').select('*').order('created_at', { ascending: false }),
            ]);
            if (catRes.data) setCategories(catRes.data.map(mapCategoryFromDB));
            if (reqRes.data) setRequests(reqRes.data.map(mapRequestFromDB));
            if (logRes.data) setLogs(logRes.data.map(mapLogFromDB));
            if (ptRes.data) setPrintTemplates(ptRes.data.map((r: any): RequestPrintTemplate => ({
                id: r.id, categoryId: r.category_id, name: r.name, fileName: r.file_name,
                storagePath: r.storage_path, createdAt: r.created_at, updatedAt: r.updated_at,
            })));
        } catch (err) {
            console.error('RequestContext fetch error:', err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Debounced refresh for realtime events
    const debouncedRefresh = useCallback(() => {
        if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = setTimeout(() => refreshData(), 300);
    }, [refreshData]);

    useEffect(() => { refreshData(); }, [refreshData]);

    // ---- Realtime subscriptions ----
    useEffect(() => {
        const channel = supabase.channel('request-changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'request_instances' }, () => debouncedRefresh())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'request_logs' }, () => debouncedRefresh())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'request_categories' }, () => debouncedRefresh())
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [debouncedRefresh]);

    // ---- Helpers ----

    const getCurrentApproverStep = (req: RequestInstance): RequestApprover | null => {
        if (!req.approvers || req.approvers.length === 0) return null;
        // Find first 'waiting' step in order
        const sorted = [...req.approvers].sort((a, b) => a.order - b.order);
        return sorted.find(a => a.status === 'waiting') || null;
    };

    // ---- Category CRUD ----

    const createCategory = async (data: Omit<RequestCategory, 'id' | 'createdAt' | 'updatedAt'>): Promise<RequestCategory | null> => {
        const { data: row, error } = await supabase.from('request_categories').insert({
            name: data.name,
            description: data.description,
            icon: data.icon,
            color: data.color,
            custom_fields: data.customFields || [],
            approver_role: data.approverRole || null,
            approver_user_id: data.approverUserId || null,
            sla_hours: data.slaHours || null,
            is_active: data.isActive,
            created_by: data.createdBy,
        }).select().single();
        if (error || !row) { console.error(error); return null; }
        const cat = mapCategoryFromDB(row);
        setCategories(prev => [cat, ...prev]);
        return cat;
    };

    const updateCategory = async (cat: RequestCategory) => {
        await supabase.from('request_categories').update({
            name: cat.name,
            description: cat.description,
            icon: cat.icon,
            color: cat.color,
            custom_fields: cat.customFields || [],
            approver_role: cat.approverRole || null,
            approver_user_id: cat.approverUserId || null,
            sla_hours: cat.slaHours || null,
            is_active: cat.isActive,
            updated_at: new Date().toISOString(),
        }).eq('id', cat.id);
        setCategories(prev => prev.map(c => c.id === cat.id ? cat : c));
    };

    const deleteCategory = async (id: string) => {
        await supabase.from('request_categories').delete().eq('id', id);
        setCategories(prev => prev.filter(c => c.id !== id));
    };

    // ---- Request CRUD ----

    const createRequest = async (data: {
        categoryId: string;
        title: string;
        description: string;
        priority: string;
        formData: Record<string, any>;
        userId: string;
        approvers: { userId: string }[];
        dueDate?: string;
    }): Promise<RequestInstance | null> => {
        const year = new Date().getFullYear();
        let code = `REQ-${year}-${String(requests.length + 1).padStart(3, '0')}`;
        const { data: nextCode, error: codeError } = await supabase.rpc('next_request_code');
        if (!codeError && nextCode) code = nextCode;

        // Auto-calculate dueDate from SLA if not manually set
        let dueDate = data.dueDate || null;
        if (!dueDate) {
            const cat = categories.find(c => c.id === data.categoryId);
            if (cat?.slaHours && cat.slaHours > 0) {
                const deadline = new Date();
                deadline.setTime(deadline.getTime() + cat.slaHours * 60 * 60 * 1000);
                dueDate = deadline.toISOString();
            }
        }

        // Build approvers array with order
        const approvers: RequestApprover[] = data.approvers.map((a, i) => ({
            userId: a.userId,
            order: i + 1,
            status: 'waiting' as const,
        }));

        const { data: row, error } = await supabase.from('request_instances').insert({
            category_id: data.categoryId,
            code,
            title: data.title,
            description: data.description,
            priority: data.priority,
            form_data: data.formData,
            created_by: data.userId,
            approvers,
            status: 'PENDING',
            due_date: dueDate,
        }).select().single();

        if (error || !row) { console.error(error); return null; }

        // Log creation
        await supabase.from('request_logs').insert({
            request_id: row.id,
            action: 'CREATED',
            acted_by: data.userId,
            comment: 'Phiếu yêu cầu được tạo mới',
        });

        await refreshData();

        // 📝 Audit trail: new request created
        auditService.log({
            tableName: 'request_instances',
            recordId: row.id,
            action: 'INSERT',
            newData: { id: row.id, code, title: data.title, status: 'PENDING', priority: data.priority },
            userId: data.userId,
            userName: data.userId,
            description: `Tạo phiếu yêu cầu: ${data.title} (${code})`,
        });

        // 🎮 XP: Award for creating request
        xpService.awardXP(data.userId, 'create_rq').catch(() => {});

        // 🔔 Notify first approver when new request is created
        try {
            const approversList = approvers;
            const firstApprover = approversList.sort((a: RequestApprover, b: RequestApprover) => a.order - b.order)[0];
            if (firstApprover && firstApprover.userId !== data.userId) {
                notificationService.create({
                    userId: firstApprover.userId,
                    type: 'info',
                    category: 'system',
                    title: '📋 Yêu cầu mới cần duyệt',
                    message: `"${data.title}" (${code}) — Bạn cần duyệt yêu cầu này`,
                    severity: 'info',
                    icon: '📋',
                    link: '/rq',
                    sourceType: 'request',
                    sourceId: `rq_new_${row.id}`,
                    metadata: { requestId: row.id },
                });
            }
        } catch (err) { console.error('RQ notification error:', err); }

        return mapRequestFromDB(row);
    };

    const updateRequest = async (id: string, updates: Partial<Pick<RequestInstance, 'title' | 'description' | 'priority' | 'formData' | 'dueDate'>>): Promise<boolean> => {
        const payload: any = { updated_at: new Date().toISOString() };
        if (updates.title !== undefined) payload.title = updates.title;
        if (updates.description !== undefined) payload.description = updates.description;
        if (updates.priority !== undefined) payload.priority = updates.priority;
        if (updates.formData !== undefined) payload.form_data = updates.formData;
        if (updates.dueDate !== undefined) payload.due_date = updates.dueDate;

        const { error } = await supabase.from('request_instances').update(payload).eq('id', id);
        if (error) { console.error(error); return false; }
        await refreshData();
        return true;
    };

    const deleteRequest = async (id: string): Promise<boolean> => {
        await supabase.from('request_logs').delete().eq('request_id', id);
        const { error } = await supabase.from('request_instances').delete().eq('id', id);
        if (error) { console.error(error); return false; }
        setRequests(prev => prev.filter(r => r.id !== id));
        setLogs(prev => prev.filter(l => l.requestId !== id));
        return true;
    };

    // ---- Actions ----

    const submitRequest = async (id: string, userId: string): Promise<boolean> => {
        const { error } = await supabase.from('request_instances').update({
            status: 'PENDING', updated_at: new Date().toISOString(),
        }).eq('id', id);
        if (error) { console.error(error); return false; }
        await supabase.from('request_logs').insert({
            request_id: id, action: 'SUBMITTED', acted_by: userId, comment: 'Gửi phiếu yêu cầu',
        });
        await refreshData();
        return true;
    };

    const approveRequest = async (id: string, userId: string, comment?: string): Promise<boolean> => {
        // Find the request
        const req = requests.find(r => r.id === id);
        if (!req) return false;

        // Update current step in approvers array
        const updatedApprovers = req.approvers.map(a =>
            a.userId === userId && a.status === 'waiting'
                ? { ...a, status: 'approved' as const, comment: comment || 'Đã duyệt', actedAt: new Date().toISOString() }
                : a
        );

        // Check if all steps are approved
        const allApproved = updatedApprovers.every(a => a.status === 'approved');
        const nextStep = updatedApprovers.find(a => a.status === 'waiting');
        const stepOrder = req.approvers.find(a => a.userId === userId && a.status === 'waiting')?.order || 0;

        const newStatus = allApproved ? RQStatus.APPROVED : RQStatus.PENDING;

        const { error } = await supabase.rpc('process_request_step', {
            p_request_id: id,
            p_user_id: userId,
            p_action: 'APPROVED',
            p_comment: comment || '',
        });
        if (error) { console.error(error); return false; }

        await refreshData();

        // 📝 Audit trail: request approved
        auditService.log({
            tableName: 'request_instances',
            recordId: id,
            action: 'UPDATE',
            oldData: { status: req.status, approvers: req.approvers },
            newData: { status: newStatus, approvers: updatedApprovers },
            userId,
            userName: userId,
            description: `${allApproved ? 'Duyệt hoàn tất' : `Duyệt bước ${stepOrder}`} phiếu "${req.title}" (${req.code})`,
        });

        // 🎮 XP: Award for approving request
        xpService.awardXP(userId, 'approve_rq').catch(() => {});

        // 🔔 Notify: creator + next approver
        try {
            // Notify creator
            if (req.createdBy && req.createdBy !== userId) {
                notificationService.create({
                    userId: req.createdBy,
                    type: allApproved ? 'success' : 'info',
                    category: 'system',
                    title: allApproved ? '✅ Yêu cầu được duyệt hoàn tất!' : `✅ Bước ${stepOrder} đã duyệt`,
                    message: `"${req.title}" (${req.code})${allApproved ? ' — Tất cả các bước đã được duyệt' : ` — Đang chờ bước ${stepOrder + 1}`}`,
                    severity: 'info',
                    icon: '✅',
                    link: '/rq',
                    sourceType: 'request',
                    sourceId: `rq_approved_${id}_${Date.now()}`,
                    metadata: { requestId: id },
                });
            }
            // Notify next approver
            if (nextStep && nextStep.userId !== userId) {
                notificationService.create({
                    userId: nextStep.userId,
                    type: 'info',
                    category: 'system',
                    title: '📋 Yêu cầu cần duyệt',
                    message: `"${req.title}" (${req.code}) — Bạn cần duyệt bước ${nextStep.order}`,
                    severity: 'info',
                    icon: '📋',
                    link: '/rq',
                    sourceType: 'request',
                    sourceId: `rq_next_${id}_${Date.now()}`,
                    metadata: { requestId: id },
                });
            }
        } catch (err) { console.error('RQ approval notification error:', err); }

        return true;
    };

    const rejectRequest = async (id: string, userId: string, comment?: string): Promise<boolean> => {
        const req = requests.find(r => r.id === id);
        if (!req) return false;

        const stepOrder = req.approvers.find(a => a.userId === userId && a.status === 'waiting')?.order || 0;

        // Mark this step as rejected
        const updatedApprovers = req.approvers.map(a =>
            a.userId === userId && a.status === 'waiting'
                ? { ...a, status: 'rejected' as const, comment: comment || 'Từ chối', actedAt: new Date().toISOString() }
                : a
        );

        const { error } = await supabase.rpc('process_request_step', {
            p_request_id: id,
            p_user_id: userId,
            p_action: 'REJECTED',
            p_comment: comment || '',
        });
        if (error) { console.error(error); return false; }

        await refreshData();

        // 📝 Audit trail: request rejected
        auditService.log({
            tableName: 'request_instances',
            recordId: id,
            action: 'UPDATE',
            oldData: { status: req.status },
            newData: { status: 'REJECTED', comment },
            userId,
            userName: userId,
            description: `Từ chối phiếu "${req.title}" (${req.code})${comment ? ': ' + comment : ''}`,
        });

        // 🔔 Notify creator of rejection
        try {
            if (req.createdBy && req.createdBy !== userId) {
                notificationService.create({
                    userId: req.createdBy,
                    type: 'error',
                    category: 'system',
                    title: '❌ Yêu cầu bị từ chối',
                    message: `"${req.title}" (${req.code}) bị từ chối ở bước ${stepOrder}${comment ? ': ' + comment : ''}`,
                    severity: 'warning',
                    icon: '❌',
                    link: '/rq',
                    sourceType: 'request',
                    sourceId: `rq_rejected_${id}_${Date.now()}`,
                    metadata: { requestId: id },
                });
            }
        } catch (err) { console.error('RQ rejection notification error:', err); }

        return true;
    };

    const completeRequest = async (id: string, userId: string, comment?: string): Promise<boolean> => {
        const { error } = await supabase.from('request_instances').update({
            status: 'DONE', updated_at: new Date().toISOString(),
        }).eq('id', id);
        if (error) { console.error(error); return false; }
        await supabase.from('request_logs').insert({
            request_id: id, action: 'COMPLETED', acted_by: userId, comment: comment || 'Hoàn thành yêu cầu',
        });
        await refreshData();

        // 📝 Audit trail: request completed
        const compReq = requests.find(r => r.id === id);
        auditService.log({
            tableName: 'request_instances',
            recordId: id,
            action: 'UPDATE',
            oldData: { status: compReq?.status || 'APPROVED' },
            newData: { status: 'DONE' },
            userId,
            userName: userId,
            description: `Hoàn thành phiếu "${compReq?.title || ''}" (${compReq?.code || ''})`,
        });
        return true;
    };

    const cancelRequest = async (id: string, userId: string, comment?: string): Promise<boolean> => {
        const { error } = await supabase.from('request_instances').update({
            status: 'CANCELLED', updated_at: new Date().toISOString(),
        }).eq('id', id);
        if (error) { console.error(error); return false; }
        await supabase.from('request_logs').insert({
            request_id: id, action: 'CANCELLED', acted_by: userId, comment: comment || 'Hủy phiếu yêu cầu',
        });
        await refreshData();

        // 📝 Audit trail: request cancelled
        const canReq = requests.find(r => r.id === id);
        auditService.log({
            tableName: 'request_instances',
            recordId: id,
            action: 'UPDATE',
            oldData: { status: canReq?.status || 'PENDING' },
            newData: { status: 'CANCELLED' },
            userId,
            userName: userId,
            description: `Hủy phiếu "${canReq?.title || ''}" (${canReq?.code || ''})`,
        });
        return true;
    };

    const getRequestLogs = (requestId: string) => logs.filter(l => l.requestId === requestId);

    // ---- Print template CRUD ----

    const uploadRQPrintTemplate = async (categoryId: string, name: string, file: File): Promise<boolean> => {
        const path = `rq/${categoryId}/${Date.now()}_${file.name}`;
        const { error: upErr } = await supabase.storage.from('workflow-templates').upload(path, file);
        if (upErr) { console.error(upErr); return false; }
        const { error: dbErr } = await supabase.from('request_print_templates').insert({
            category_id: categoryId, name, file_name: file.name, storage_path: path,
        });
        if (dbErr) { console.error(dbErr); return false; }
        await refreshData();
        return true;
    };

    const deleteRQPrintTemplate = async (id: string, storagePath: string): Promise<boolean> => {
        await supabase.storage.from('workflow-templates').remove([storagePath]);
        const { error } = await supabase.from('request_print_templates').delete().eq('id', id);
        if (error) { console.error(error); return false; }
        setPrintTemplates(prev => prev.filter(p => p.id !== id));
        return true;
    };

    const getRQPrintTemplates = (categoryId: string) => printTemplates.filter(p => p.categoryId === categoryId);

    const value: RequestContextType = {
        categories, requests, logs, isLoading,
        createCategory, updateCategory, deleteCategory,
        createRequest, updateRequest, deleteRequest,
        submitRequest, approveRequest, rejectRequest,
        completeRequest, cancelRequest,
        getRequestLogs, getCurrentApproverStep, refreshData,
        printTemplates, uploadRQPrintTemplate, deleteRQPrintTemplate, getRQPrintTemplates,
    };

    return <RequestContext.Provider value={value}>{children}</RequestContext.Provider>;
};

export const useRequest = () => {
    const ctx = useContext(RequestContext);
    if (!ctx) throw new Error('useRequest must be used within RequestProvider');
    return ctx;
};
