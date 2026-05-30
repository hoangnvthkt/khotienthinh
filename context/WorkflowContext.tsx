
import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import {
    WorkflowTemplate, WorkflowNode, WorkflowEdge,
    WorkflowInstance, WorkflowInstanceLog, WorkflowPrintTemplate,
    WorkflowInstanceStatus, WorkflowInstanceAction, WorkflowNodeType,
    WorkflowCustomField, Role
} from '../types';
import { notificationService } from '../lib/notificationService';
import { auditService } from '../lib/auditService';
import { xpService } from '../lib/xpService';

interface WorkflowContextType {
    templates: WorkflowTemplate[];
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    instances: WorkflowInstance[];
    logs: WorkflowInstanceLog[];
    printTemplates: WorkflowPrintTemplate[];
    isLoading: boolean;

    // Template CRUD
    createTemplate: (name: string, description: string, userId: string) => Promise<WorkflowTemplate | null>;
    updateTemplate: (template: WorkflowTemplate) => Promise<void>;
    deleteTemplate: (id: string) => Promise<void>;

    // Nodes & Edges
    saveNodesAndEdges: (templateId: string, nodes: WorkflowNode[], edges: WorkflowEdge[]) => Promise<void>;
    getTemplateNodes: (templateId: string) => WorkflowNode[];
    getTemplateEdges: (templateId: string) => WorkflowEdge[];

    // Instances
    createInstance: (templateId: string, title: string, userId: string, formData?: Record<string, any>) => Promise<WorkflowInstance | null>;
    loadInstanceFormData: (instanceId: string) => Promise<Record<string, any> | null>;
    updateInstance: (instanceId: string, updates: { title?: string; formData?: Record<string, any> }) => Promise<boolean>;
    deleteInstance: (instanceId: string) => Promise<boolean>;
    cancelInstance: (instanceId: string, userId: string) => Promise<boolean>;
    processInstance: (instanceId: string, action: WorkflowInstanceAction, userId: string, comment?: string, nextAssigneeUserId?: string) => Promise<boolean>;
    reopenInstance: (instanceId: string, targetNodeId: string, userId: string, comment?: string) => Promise<boolean>;
    getInstanceLogs: (instanceId: string) => WorkflowInstanceLog[];
    updateInstanceWatchers: (instanceId: string, watchers: string[]) => Promise<boolean>;

    // Print Templates
    uploadPrintTemplate: (templateId: string, name: string, file: File) => Promise<WorkflowPrintTemplate | null>;
    deletePrintTemplate: (id: string, storagePath: string) => Promise<boolean>;
    getPrintTemplates: (templateId: string) => WorkflowPrintTemplate[];

    refreshData: () => Promise<void>;
}

const WorkflowContext = createContext<WorkflowContextType | undefined>(undefined);

const WORKFLOW_INSTANCE_LIST_SELECT = 'id, template_id, code, title, created_by, current_node_id, status, watchers, step_assignees, created_at, updated_at';
const WORKFLOW_INSTANCE_LIST_LIMIT = 300;

// DB snake_case <-> TS camelCase mappers
const mapTemplateFromDB = (row: any): WorkflowTemplate => ({
    id: row.id,
    name: row.name,
    description: row.description || '',
    createdBy: row.created_by,
    isActive: row.is_active,
    customFields: row.custom_fields || [],
    managers: row.managers || [],
    defaultWatchers: row.default_watchers || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

const mapNodeFromDB = (row: any): WorkflowNode => ({
    id: row.id,
    templateId: row.template_id,
    type: row.type,
    label: row.label,
    config: row.config || {},
    positionX: row.position_x || 0,
    positionY: row.position_y || 0,
});

const mapEdgeFromDB = (row: any): WorkflowEdge => ({
    id: row.id,
    templateId: row.template_id,
    sourceNodeId: row.source_node_id,
    targetNodeId: row.target_node_id,
    label: row.label || '',
});

const mapInstanceFromDB = (row: any): WorkflowInstance => ({
    id: row.id,
    templateId: row.template_id,
    code: row.code,
    title: row.title,
    createdBy: row.created_by,
    currentNodeId: row.current_node_id,
    status: row.status,
    formData: row.form_data || row.formData || {},
    watchers: row.watchers || [],
    stepAssignees: row.step_assignees || row.stepAssignees || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

const mapLogFromDB = (row: any): WorkflowInstanceLog => ({
    id: row.id,
    instanceId: row.instance_id,
    nodeId: row.node_id,
    action: row.action,
    actedBy: row.acted_by,
    comment: row.comment || '',
    createdAt: row.created_at,
});

const mapPrintTemplateFromDB = (row: any): WorkflowPrintTemplate => ({
    id: row.id,
    templateId: row.template_id,
    name: row.name,
    fileName: row.file_name,
    storagePath: row.storage_path,
    createdAt: row.created_at,
});

export const WorkflowProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
    const [nodes, setNodes] = useState<WorkflowNode[]>([]);
    const [edges, setEdges] = useState<WorkflowEdge[]>([]);
    const [instances, setInstances] = useState<WorkflowInstance[]>([]);
    const [logs, setLogs] = useState<WorkflowInstanceLog[]>([]);
    const [printTemplates, setPrintTemplates] = useState<WorkflowPrintTemplate[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const inflightRefreshRef = useRef<Promise<void> | null>(null);

    const refreshData = useCallback(async () => {
        if (inflightRefreshRef.current) return inflightRefreshRef.current;
        setIsLoading(true);
        const refreshTask = (async () => {
            const [tRes, nRes, eRes, iRes, ptRes] = await Promise.all([
                supabase.from('workflow_templates').select('*').order('created_at', { ascending: false }),
                supabase.from('workflow_nodes').select('*'),
                supabase.from('workflow_edges').select('*'),
                supabase.from('workflow_instances').select(WORKFLOW_INSTANCE_LIST_SELECT).order('created_at', { ascending: false }).limit(WORKFLOW_INSTANCE_LIST_LIMIT),
                supabase.from('workflow_print_templates').select('*').order('created_at', { ascending: false }),
            ]);
            if (tRes.data) setTemplates(tRes.data.map(mapTemplateFromDB));
            if (nRes.data) setNodes(nRes.data.map(mapNodeFromDB));
            if (eRes.data) setEdges(eRes.data.map(mapEdgeFromDB));
            if (iRes.data) setInstances(iRes.data.map(mapInstanceFromDB));
            if (iRes.data && iRes.data.length > 0) {
                const instanceIds = iRes.data.map((i: any) => i.id);
                const { data: logData } = await supabase
                    .from('workflow_instance_logs')
                    .select('*')
                    .in('instance_id', instanceIds)
                    .order('created_at', { ascending: true });
                if (logData) setLogs(logData.map(mapLogFromDB));
            } else {
                setLogs([]);
            }
            if (ptRes.data) setPrintTemplates(ptRes.data.map(mapPrintTemplateFromDB));
        })();
        inflightRefreshRef.current = refreshTask;
        try {
            await refreshTask;
        } catch (err) {
            console.error('WorkflowContext fetch error:', err);
        } finally {
            inflightRefreshRef.current = null;
            setIsLoading(false);
        }
    }, []);

    const getWorkflowRoleRecipients = useCallback(async (role?: Role): Promise<string[]> => {
        if (!role) return [];
        const { data, error } = await supabase
            .from('users')
            .select('id, role, allowed_modules, is_active')
            .eq('role', role);
        if (error) {
            console.error('WF recipient lookup error:', error);
            return [];
        }
        return (data || [])
            .filter((row: any) => row.is_active !== false)
            .filter((row: any) =>
                row.role === Role.ADMIN ||
                !Array.isArray(row.allowed_modules) ||
                row.allowed_modules.includes('WF')
            )
            .map((row: any) => row.id)
            .filter(Boolean);
    }, []);

    const getWorkflowNodeRecipientIds = useCallback(async (
        node?: WorkflowNode,
        stepAssignees?: Record<string, string>,
    ): Promise<string[]> => {
        if (!node) return [];
        const assignedOverride = stepAssignees?.[node.id];
        if (assignedOverride) return [assignedOverride];
        if (node.config?.assigneeUserId) return [node.config.assigneeUserId];
        return getWorkflowRoleRecipients(node.config?.assigneeRole);
    }, [getWorkflowRoleRecipients]);

    const notifyWorkflowUsers = useCallback(async (input: {
        recipientIds: Array<string | null | undefined>;
        actorId?: string;
        type: 'info' | 'warning' | 'success' | 'error';
        title: string;
        message: string;
        severity?: 'info' | 'warning' | 'critical';
        sourceId: string;
        metadata?: Record<string, any>;
    }) => {
        try {
            await notificationService.notifyProjectUsers({
                recipientIds: input.recipientIds,
                actorId: input.actorId,
                type: input.type,
                category: 'system',
                title: input.title,
                message: input.message,
                severity: input.severity || 'info',
                icon: '📋',
                link: '/wf',
                sourceType: 'workflow',
                sourceId: input.sourceId,
                metadata: input.metadata || {},
            });
        } catch (err) {
            console.error('WF notification error:', err);
        }
    }, []);

    // ---- Template CRUD ----

    const createTemplate = async (name: string, description: string, userId: string): Promise<WorkflowTemplate | null> => {
        const { data, error } = await supabase.from('workflow_templates').insert({
            name,
            description,
            created_by: userId,
            is_active: true,
            custom_fields: [],
            managers: [],
            default_watchers: [],
        }).select().single();
        if (error || !data) { console.error(error); return null; }
        const t = mapTemplateFromDB(data);
        setTemplates(prev => [t, ...prev]);
        return t;
    };

    const updateTemplate = async (template: WorkflowTemplate) => {
        const { error } = await supabase.from('workflow_templates').update({
            name: template.name,
            description: template.description,
            is_active: template.isActive,
            custom_fields: template.customFields || [],
            managers: template.managers || [],
            default_watchers: template.defaultWatchers || [],
            updated_at: new Date().toISOString(),
        }).eq('id', template.id);
        if (error) console.error('[WF] updateTemplate ERROR:', error);
        setTemplates(prev => prev.map(t => t.id === template.id ? template : t));
    };

    const deleteTemplate = async (id: string) => {
        await supabase.from('workflow_templates').delete().eq('id', id);
        setTemplates(prev => prev.filter(t => t.id !== id));
        setNodes(prev => prev.filter(n => n.templateId !== id));
        setEdges(prev => prev.filter(e => e.templateId !== id));
    };

    // ---- Nodes & Edges ----

    const getTemplateNodes = (templateId: string) => nodes.filter(n => n.templateId === templateId);
    const getTemplateEdges = (templateId: string) => edges.filter(e => e.templateId === templateId);

    const saveNodesAndEdges = async (templateId: string, newNodes: WorkflowNode[], newEdges: WorkflowEdge[]) => {
        // Use UPSERT instead of delete+insert to avoid FK constraint violations
        // (workflow_instance_logs references workflow_nodes)

        if (newNodes.length > 0) {
            const nodeRows = newNodes.map(n => ({
                id: n.id,
                template_id: templateId,
                type: n.type,
                label: n.label,
                config: n.config,
                position_x: n.positionX,
                position_y: n.positionY,
            }));
            const { error: upsertNodeErr } = await supabase.from('workflow_nodes').upsert(nodeRows, { onConflict: 'id' });
            if (upsertNodeErr) console.error('Error upserting nodes:', upsertNodeErr);
        }

        // Delete nodes that were removed (but only ones not in the new set)
        const existingNodes = nodes.filter(n => n.templateId === templateId);
        const newNodeIds = new Set(newNodes.map(n => n.id));
        const removedNodeIds = existingNodes.filter(n => !newNodeIds.has(n.id)).map(n => n.id);
        if (removedNodeIds.length > 0) {
            const { error: delNodeErr } = await supabase.from('workflow_nodes').delete().in('id', removedNodeIds);
            if (delNodeErr) console.error('Error deleting removed nodes:', delNodeErr);
        }

        // Replace edges (edges have no FK references from other tables)
        const { error: delEdgeErr } = await supabase.from('workflow_edges').delete().eq('template_id', templateId);
        if (delEdgeErr) console.error('Error deleting edges:', delEdgeErr);

        if (newEdges.length > 0) {
            const edgeRows = newEdges.map(e => ({
                id: e.id,
                template_id: templateId,
                source_node_id: e.sourceNodeId,
                target_node_id: e.targetNodeId,
                label: e.label,
            }));
            const { error: insEdgeErr } = await supabase.from('workflow_edges').insert(edgeRows);
            if (insEdgeErr) console.error('Error inserting edges:', insEdgeErr);
        }

        // Refresh local state
        setNodes(prev => [...prev.filter(n => n.templateId !== templateId), ...newNodes]);
        setEdges(prev => [...prev.filter(e => e.templateId !== templateId), ...newEdges]);
    };

    // ---- Instances ----

    const createInstance = async (templateId: string, title: string, userId: string, formData: Record<string, any> = {}): Promise<WorkflowInstance | null> => {
        // Find the START node of this template
        const templateNodes = nodes.filter(n => n.templateId === templateId);
        const templateEdges = edges.filter(e => e.templateId === templateId);
        const startNode = templateNodes.find(n => n.type === WorkflowNodeType.START);
        if (!startNode) { console.error('No START node found'); return null; }

        // Find next node after START
        const startEdge = templateEdges.find(e => e.sourceNodeId === startNode.id);
        const firstTaskNodeId = startEdge ? startEdge.targetNodeId : null;

        // Auto-copy default watchers from template
        const tmpl = templates.find(t => t.id === templateId);

        // Generate code: WF-YYYY-NNN (DB-backed when Supabase RPC is available)
        const year = new Date().getFullYear();
        let code = `WF-${year}-${String(instances.length + 1).padStart(3, '0')}`;
        const { data: nextCode, error: codeError } = await supabase.rpc('next_workflow_code');
        if (!codeError && nextCode) code = nextCode;

        const { data, error } = await supabase.from('workflow_instances').insert({
            template_id: templateId,
            code,
            title,
            created_by: userId,
            current_node_id: firstTaskNodeId,
            status: 'RUNNING',
            form_data: formData,
            watchers: tmpl?.defaultWatchers || [],
        }).select(WORKFLOW_INSTANCE_LIST_SELECT).single();

        if (error || !data) { console.error(error); return null; }

        // Log the submission at the START node
        const { data: logData } = await supabase.from('workflow_instance_logs').insert({
            instance_id: data.id,
            node_id: startNode.id,
            action: 'SUBMITTED',
            acted_by: userId,
            comment: 'Phiếu được tạo mới',
        }).select().single();

        const createdInstance = { ...mapInstanceFromDB(data), formData };
        setInstances(prev => [createdInstance, ...prev]);
        if (logData) setLogs(prev => [...prev, mapLogFromDB(logData)]);

        // 📝 Audit trail: new workflow instance created
        auditService.log({
            tableName: 'workflow_instances',
            recordId: data.id,
            action: 'INSERT',
            newData: { id: data.id, code, title, templateId, status: 'RUNNING', formData },
            userId,
            userName: userId,
            description: `Tạo phiếu quy trình: ${title} (${code})`,
        });

        // 🎮 XP: Award for creating workflow
        xpService.awardXP(userId, 'create_workflow').catch(() => {});

        // 🔔 Notify assignees when new WF instance is created
        if (data && firstTaskNodeId) {
            const firstNode = templateNodes.find(n => n.id === firstTaskNodeId);
            const recipientIds = await getWorkflowNodeRecipientIds(firstNode, createdInstance.stepAssignees);
            await notifyWorkflowUsers({
                recipientIds,
                actorId: userId,
                type: 'info',
                title: '📋 Phiếu quy trình mới cần xử lý',
                message: `"${title}" (${code}) — Bạn cần duyệt bước "${firstNode?.label || ''}"`,
                sourceId: `wf_new_${data.id}`,
                metadata: { instanceId: data.id, templateId, nodeId: firstTaskNodeId },
            });
        }

        return createdInstance;
    };

    const loadInstanceFormData = useCallback(async (instanceId: string): Promise<Record<string, any> | null> => {
        const { data, error } = await supabase
            .from('workflow_instances')
            .select('form_data')
            .eq('id', instanceId)
            .single();

        if (error) {
            console.error('loadInstanceFormData error:', error);
            return null;
        }

        const formData = data?.form_data || {};
        setInstances(prev => prev.map(i => i.id === instanceId ? { ...i, formData } : i));
        return formData;
    }, []);

    const processInstance = async (
        instanceId: string,
        action: WorkflowInstanceAction,
        userId: string,
        comment: string = '',
        nextAssigneeUserId?: string,
    ): Promise<boolean> => {
        // IMPORTANT: Fetch fresh data from DB to avoid stale React state closure issues
        const { data: freshInstance } = await supabase
            .from('workflow_instances')
            .select(WORKFLOW_INSTANCE_LIST_SELECT)
            .eq('id', instanceId)
            .single();
        
        if (!freshInstance || !freshInstance.current_node_id) {
            console.error('processInstance: instance not found or no current_node_id', instanceId);
            return false;
        }

        const templateId = freshInstance.template_id;

        // Fetch fresh nodes from DB for notification routing
        const nodesRes = await supabase.from('workflow_nodes').select('*').eq('template_id', templateId);
        const templateNodes = (nodesRes.data || []).map(mapNodeFromDB);

        const { data: processedData, error: processError } = await supabase.rpc('process_workflow_instance_fast', {
            p_instance_id: instanceId,
            p_action: action,
            p_user_id: userId,
            p_comment: comment,
            p_next_assignee_user_id: nextAssigneeUserId || null,
        });
        if (processError) {
            console.error('processInstance RPC error:', processError);
            return false;
        }

        let processedRow = Array.isArray(processedData) ? processedData[0] : processedData;
        if (!processedRow) {
            const { data: updatedRow } = await supabase
                .from('workflow_instances')
                .select(WORKFLOW_INSTANCE_LIST_SELECT)
                .eq('id', instanceId)
                .single();
            processedRow = updatedRow;
        }

        if (processedRow) {
            const existingFormData = instances.find(i => i.id === instanceId)?.formData || {};
            const updatedInstance = { ...mapInstanceFromDB(processedRow), formData: existingFormData };
            setInstances(prev => prev.map(i => i.id === instanceId ? updatedInstance : i));
        }

        const { data: latestLog } = await supabase
            .from('workflow_instance_logs')
            .select('*')
            .eq('instance_id', instanceId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (latestLog) {
            setLogs(prev => prev.some(l => l.id === latestLog.id) ? prev : [...prev, mapLogFromDB(latestLog)]);
        }

        // 📝 Audit trail: workflow status change
        const actionLabels: Record<string, string> = {
            APPROVED: 'Duyệt',
            REJECTED: 'Từ chối',
            REVISION_REQUESTED: 'Yêu cầu chỉnh sửa',
        };
        auditService.log({
            tableName: 'workflow_instances',
            recordId: instanceId,
            action: 'UPDATE',
            oldData: { status: freshInstance.status, current_node_id: freshInstance.current_node_id },
            newData: { status: processedRow?.status || (action === 'REJECTED' ? 'REJECTED' : freshInstance.status), current_node_id: processedRow?.current_node_id, action, comment },
            userId,
            userName: userId,
            description: `${actionLabels[action] || action} phiếu "${freshInstance.title || ''}" (${freshInstance.code || ''})`,
        });

        // 🎮 XP: Award for approving workflow
        if (action === 'APPROVED') {
            xpService.awardXP(userId, 'approve_workflow').catch(() => {});
        }

        // 🔔 Push notifications for workflow actions
        try {
            const inst = mapInstanceFromDB(freshInstance);
            const nextInstance = processedRow ? mapInstanceFromDB(processedRow) : undefined;
            if (action === WorkflowInstanceAction.APPROVED) {
                await notifyWorkflowUsers({
                    recipientIds: [inst.createdBy],
                    actorId: userId,
                    type: 'success',
                    title: '✅ Phiếu quy trình được duyệt',
                    message: `"${inst.title}" (${inst.code}) đã được duyệt${nextInstance?.status === WorkflowInstanceStatus.COMPLETED ? ' hoàn tất' : ''}`,
                    sourceId: `wf_approved_${instanceId}_${Date.now()}`,
                    metadata: { instanceId, action, status: nextInstance?.status },
                });

                if (nextInstance?.status === WorkflowInstanceStatus.RUNNING && nextInstance.currentNodeId) {
                    const nextNode = templateNodes.find(n => n.id === nextInstance.currentNodeId);
                    if (nextNode && nextNode.type !== WorkflowNodeType.END) {
                        const recipientIds = await getWorkflowNodeRecipientIds(nextNode, nextInstance.stepAssignees);
                        await notifyWorkflowUsers({
                            recipientIds,
                            actorId: userId,
                            type: 'info',
                            title: '📋 Phiếu quy trình cần duyệt',
                            message: `"${inst.title}" (${inst.code}) — Bạn cần duyệt bước "${nextNode.label}"`,
                            sourceId: `wf_next_${instanceId}_${Date.now()}`,
                            metadata: { instanceId, nodeId: nextNode.id, assignedUserId: nextAssigneeUserId || undefined },
                        });
                    }
                }
            } else if (action === WorkflowInstanceAction.REJECTED) {
                await notifyWorkflowUsers({
                    recipientIds: [inst.createdBy],
                    actorId: userId,
                    type: 'error',
                    title: '❌ Phiếu quy trình bị từ chối',
                    message: `"${inst.title}" (${inst.code}) đã bị từ chối${comment ? ': ' + comment : ''}`,
                    severity: 'warning',
                    sourceId: `wf_rejected_${instanceId}_${Date.now()}`,
                    metadata: { instanceId, action },
                });
            } else if (action === WorkflowInstanceAction.REVISION_REQUESTED) {
                await notifyWorkflowUsers({
                    recipientIds: [inst.createdBy],
                    actorId: userId,
                    type: 'warning',
                    title: '↩ Phiếu quy trình cần bổ sung',
                    message: `"${inst.title}" (${inst.code}) cần bổ sung${comment ? ': ' + comment : ''}`,
                    severity: 'warning',
                    sourceId: `wf_revision_${instanceId}_${Date.now()}`,
                    metadata: { instanceId, action, currentNodeId: nextInstance?.currentNodeId },
                });

                if (nextInstance?.status === WorkflowInstanceStatus.RUNNING && nextInstance.currentNodeId) {
                    const revisionNode = templateNodes.find(n => n.id === nextInstance.currentNodeId);
                    const recipientIds = await getWorkflowNodeRecipientIds(revisionNode, nextInstance.stepAssignees);
                    await notifyWorkflowUsers({
                        recipientIds,
                        actorId: userId,
                        type: 'info',
                        title: '📋 Phiếu quy trình đã quay về bước của bạn',
                        message: `"${inst.title}" (${inst.code}) — cần xử lý lại bước "${revisionNode?.label || ''}"`,
                        sourceId: `wf_revision_assignee_${instanceId}_${Date.now()}`,
                        metadata: { instanceId, nodeId: revisionNode?.id },
                    });
                }
            }
        } catch (err) { console.error('WF notification error:', err); }

        return true;
    };

    const getInstanceLogs = (instanceId: string) => logs.filter(l => l.instanceId === instanceId);

    const updateInstance = async (instanceId: string, updates: { title?: string; formData?: Record<string, any> }): Promise<boolean> => {
        const updatePayload: any = { updated_at: new Date().toISOString() };
        if (updates.title !== undefined) updatePayload.title = updates.title;
        if (updates.formData !== undefined) updatePayload.form_data = updates.formData;
        const { error } = await supabase.from('workflow_instances').update(updatePayload).eq('id', instanceId);
        if (error) { console.error(error); return false; }
        setInstances(prev => prev.map(i => i.id === instanceId ? { ...i, ...(updates.title !== undefined ? { title: updates.title } : {}), ...(updates.formData !== undefined ? { formData: updates.formData } : {}), updatedAt: updatePayload.updated_at } : i));
        return true;
    };

    const deleteInstance = async (instanceId: string): Promise<boolean> => {
        await supabase.from('workflow_instance_logs').delete().eq('instance_id', instanceId);
        const { error } = await supabase.from('workflow_instances').delete().eq('id', instanceId);
        if (error) { console.error(error); return false; }
        setInstances(prev => prev.filter(i => i.id !== instanceId));
        setLogs(prev => prev.filter(l => l.instanceId !== instanceId));
        return true;
    };

    const cancelInstance = async (instanceId: string, userId: string): Promise<boolean> => {
        const updatedAt = new Date().toISOString();
        const { data, error } = await supabase.from('workflow_instances').update({
            status: 'CANCELLED',
            updated_at: updatedAt,
        }).eq('id', instanceId).select(WORKFLOW_INSTANCE_LIST_SELECT).single();
        if (error) { console.error(error); return false; }
        const existingFormData = instances.find(i => i.id === instanceId)?.formData || {};
        if (data) setInstances(prev => prev.map(i => i.id === instanceId ? { ...mapInstanceFromDB(data), formData: existingFormData } : i));

        const { data: logData } = await supabase.from('workflow_instance_logs').insert({
            instance_id: instanceId,
            node_id: instances.find(i => i.id === instanceId)?.currentNodeId,
            action: 'REJECTED',
            acted_by: userId,
            comment: 'Phiếu đã bị hủy bởi người tạo',
        }).select().single();
        if (logData) setLogs(prev => [...prev, mapLogFromDB(logData)]);
        return true;
    };

    const reopenInstance = async (instanceId: string, targetNodeId: string, userId: string, comment: string = ''): Promise<boolean> => {
        const instance = instances.find(i => i.id === instanceId);
        if (!instance) return false;
        // Only allow reopening COMPLETED or REJECTED instances
        if (instance.status !== WorkflowInstanceStatus.COMPLETED && instance.status !== WorkflowInstanceStatus.REJECTED) return false;

        const { data, error } = await supabase.from('workflow_instances').update({
            status: 'RUNNING',
            current_node_id: targetNodeId,
            updated_at: new Date().toISOString(),
        }).eq('id', instanceId).select(WORKFLOW_INSTANCE_LIST_SELECT).single();
        if (error) { console.error(error); return false; }
        if (data) setInstances(prev => prev.map(i => i.id === instanceId ? { ...mapInstanceFromDB(data), formData: instance.formData || {} } : i));

        // Log the reopen action
        const targetNode = nodes.find(n => n.id === targetNodeId);
        const { data: logData } = await supabase.from('workflow_instance_logs').insert({
            instance_id: instanceId,
            node_id: targetNodeId,
            action: 'REOPENED',
            acted_by: userId,
            comment: comment || `Mở lại quy trình về bước "${targetNode?.label || ''}"`
        }).select().single();
        if (logData) setLogs(prev => [...prev, mapLogFromDB(logData)]);

        return true;
    };

    // ---- Instance Watchers ----
    const updateInstanceWatchers = async (instanceId: string, watchers: string[]): Promise<boolean> => {
        const currentInstance = instances.find(i => i.id === instanceId);
        const previousWatchers = new Set(currentInstance?.watchers || []);
        const addedWatchers = [...new Set(watchers)].filter(uid => !previousWatchers.has(uid));
        const { error } = await supabase.from('workflow_instances').update({
            watchers,
            updated_at: new Date().toISOString(),
        }).eq('id', instanceId);
        if (error) { console.error(error); return false; }
        setInstances(prev => prev.map(i => i.id === instanceId ? { ...i, watchers } : i));
        if (currentInstance && addedWatchers.length > 0) {
            await notifyWorkflowUsers({
                recipientIds: addedWatchers,
                type: 'info',
                title: '👀 Bạn được tag theo dõi quy trình',
                message: `"${currentInstance.title}" (${currentInstance.code}) đã thêm bạn vào danh sách theo dõi`,
                sourceId: `wf_watchers_${instanceId}_${Date.now()}`,
                metadata: { instanceId },
            });
        }
        return true;
    };

    // ==================== PRINT TEMPLATES ====================
    const uploadPrintTemplate = async (templateId: string, name: string, file: File): Promise<WorkflowPrintTemplate | null> => {
        const ext = file.name.split('.').pop() || 'docx';
        const storagePath = `${templateId}/${Date.now()}_${file.name}`;
        const { error: uploadErr } = await supabase.storage.from('workflow-templates').upload(storagePath, file, {
            contentType: file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
        if (uploadErr) { console.error('Upload error:', uploadErr); return null; }
        const { data, error } = await supabase.from('workflow_print_templates').insert({
            template_id: templateId,
            name,
            file_name: file.name,
            storage_path: storagePath,
        }).select().single();
        if (error || !data) { console.error('Insert error:', error); return null; }
        const pt = mapPrintTemplateFromDB(data);
        setPrintTemplates(prev => [pt, ...prev]);
        return pt;
    };

    const deletePrintTemplate = async (id: string, storagePath: string): Promise<boolean> => {
        await supabase.storage.from('workflow-templates').remove([storagePath]);
        const { error } = await supabase.from('workflow_print_templates').delete().eq('id', id);
        if (error) { console.error('Delete print template error:', error); return false; }
        setPrintTemplates(prev => prev.filter(pt => pt.id !== id));
        return true;
    };

    const getPrintTemplates = (templateId: string): WorkflowPrintTemplate[] => {
        return printTemplates.filter(pt => pt.templateId === templateId);
    };

    const value: WorkflowContextType = {
        templates, nodes, edges, instances, logs, printTemplates, isLoading,
        createTemplate, updateTemplate, deleteTemplate,
        saveNodesAndEdges, getTemplateNodes, getTemplateEdges,
        createInstance, loadInstanceFormData, updateInstance, deleteInstance, cancelInstance, processInstance, reopenInstance, getInstanceLogs, updateInstanceWatchers,
        uploadPrintTemplate, deletePrintTemplate, getPrintTemplates,
        refreshData,
    };

    return <WorkflowContext.Provider value={value}>{children}</WorkflowContext.Provider>;
};

export const useWorkflow = () => {
    const ctx = useContext(WorkflowContext);
    if (!ctx) throw new Error('useWorkflow must be used within WorkflowProvider');
    return ctx;
};
