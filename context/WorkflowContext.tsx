
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
import {
    buildInitialWorkflowStepAssignees,
    getWorkflowProcessErrorMessage,
    normalizeStepAssigneeIds,
} from '../lib/workflowAssignmentResolver';
import { chunkValues } from '../lib/supabasePagination';
import { isWorkflowInstanceId } from '../lib/workflowRoutes';

export interface WorkflowProcessResult {
    ok: boolean;
    errorCode?: string;
    errorMessage?: string;
}

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
    createInstance: (templateId: string, title: string, userId: string, formData?: Record<string, any>, firstAssigneeUserIds?: string | string[]) => Promise<WorkflowInstance | null>;
    createDraft: (templateId: string, title: string, formData?: Record<string, any>, firstAssigneeUserIds?: string | string[]) => Promise<WorkflowInstance | null>;
    loadInstanceById: (instanceId: string) => Promise<WorkflowInstance | null>;
    loadInstanceFormData: (instanceId: string) => Promise<Record<string, any> | null>;
    updateInstance: (instanceId: string, updates: { title?: string; formData?: Record<string, any>; initialAssigneeUserIds?: string[] }) => Promise<boolean>;
    submitDraft: (instanceId: string, firstAssigneeUserIds?: string[]) => Promise<boolean>;
    deleteDraft: (instanceId: string) => Promise<boolean>;
    cancelInstance: (instanceId: string, userId: string) => Promise<boolean>;
    processInstance: (instanceId: string, action: WorkflowInstanceAction, userId: string, comment?: string, nextAssigneeUserIds?: string | string[]) => Promise<WorkflowProcessResult>;
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

const WORKFLOW_INSTANCE_LIST_SELECT = 'id, template_id, code, title, created_by, current_node_id, status, form_data, watchers, step_assignees, created_at, updated_at';
const WORKFLOW_INSTANCE_LIST_LIMIT = 300;
const WORKFLOW_TEMPLATE_SELECT = 'id,name,description,created_by,is_active,custom_fields,managers,default_watchers,created_at,updated_at';
const WORKFLOW_NODE_SELECT = 'id,template_id,type,label,config,position_x,position_y';
const WORKFLOW_EDGE_SELECT = 'id,template_id,source_node_id,target_node_id,label';
const WORKFLOW_LOG_SELECT = 'id,instance_id,node_id,action,acted_by,comment,created_at';
const WORKFLOW_PRINT_TEMPLATE_SELECT = 'id,template_id,name,file_name,storage_path,created_at';
const WORKFLOW_TEMPLATE_CATALOG_LIMIT = 200;
const WORKFLOW_PRINT_TEMPLATE_LIMIT = 500;
const WORKFLOW_CHILD_PAGE_SIZE = 1000;
const WORKFLOW_CHILD_MAX_ROWS = 10_000;

const loadWorkflowRowsByIds = async (
    table: string,
    projection: string,
    filterColumn: string,
    values: string[],
): Promise<any[]> => {
    const rows: any[] = [];
    for (const valueChunk of chunkValues(Array.from(new Set(values.filter(Boolean))), 100)) {
        let lastId: string | null = null;
        while (true) {
            let query: any = supabase
                .from(table as any)
                .select(projection)
                .in(filterColumn, valueChunk)
                .order('id', { ascending: true })
                .limit(WORKFLOW_CHILD_PAGE_SIZE);
            if (lastId) query = query.gt('id', lastId);
            const { data, error } = await query;
            if (error) throw error;
            const page = data || [];
            rows.push(...page);
            if (rows.length > WORKFLOW_CHILD_MAX_ROWS) {
                throw new Error(`Workflow child read exceeded safety cap of ${WORKFLOW_CHILD_MAX_ROWS} rows`);
            }
            if (page.length < WORKFLOW_CHILD_PAGE_SIZE) break;
            const nextId = String(page[page.length - 1]?.id || '');
            if (!nextId || nextId === lastId) throw new Error('Workflow child read received a repeated cursor');
            lastId = nextId;
        }
    }
    return rows;
};

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

const isTemplateRemovedNode = (node: WorkflowNode) => {
    const config = node.config as Record<string, unknown> | undefined;
    return config?.__templateRemoved === true || config?.__templateRemoved === 'true';
};

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

const getWorkflowSubjectValue = (formData: Record<string, any> | undefined, keys: string[]): string | undefined => {
    for (const key of keys) {
        const value = formData?.[key];
        if (value !== undefined && value !== null && String(value).trim()) return String(value);
    }
    return undefined;
};

const buildMaterialRequestLink = (request: { id: string; project_id?: string | null; construction_site_id?: string | null }) =>
    `/da?projectId=${request.project_id || ''}&siteId=${request.construction_site_id || ''}&tab=material&materialTab=request&requestId=${request.id}`;

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
            const [tRes, iRes, ptRes] = await Promise.all([
                supabase.from('workflow_templates').select(WORKFLOW_TEMPLATE_SELECT).order('created_at', { ascending: false }).limit(WORKFLOW_TEMPLATE_CATALOG_LIMIT),
                supabase.from('workflow_instances').select(WORKFLOW_INSTANCE_LIST_SELECT).order('created_at', { ascending: false }).limit(WORKFLOW_INSTANCE_LIST_LIMIT),
                supabase.from('workflow_print_templates').select(WORKFLOW_PRINT_TEMPLATE_SELECT).order('created_at', { ascending: false }).limit(WORKFLOW_PRINT_TEMPLATE_LIMIT),
            ]);
            if (tRes.data) setTemplates(tRes.data.map(mapTemplateFromDB));
            const activeTemplateIds = (tRes.data || []).filter((template: any) => template.is_active !== false).map((template: any) => template.id);
            const [nodeRows, edgeRows] = await Promise.all([
                loadWorkflowRowsByIds('workflow_nodes', WORKFLOW_NODE_SELECT, 'template_id', activeTemplateIds),
                loadWorkflowRowsByIds('workflow_edges', WORKFLOW_EDGE_SELECT, 'template_id', activeTemplateIds),
            ]);
            setNodes(nodeRows.map(mapNodeFromDB));
            setEdges(edgeRows.map(mapEdgeFromDB));
            if (iRes.data) setInstances(iRes.data.map(mapInstanceFromDB));
            if (iRes.data && iRes.data.length > 0) {
                const instanceIds = iRes.data.map((i: any) => i.id);
                const logData = await loadWorkflowRowsByIds('workflow_instance_logs', WORKFLOW_LOG_SELECT, 'instance_id', instanceIds);
                logData.sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)) || String(left.id).localeCompare(String(right.id)));
                setLogs(logData.map(mapLogFromDB));
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
            .select('id, role, is_active')
            .eq('role', role)
            .limit(500);
        if (error) {
            console.error('WF recipient lookup error:', error);
            return [];
        }
        return (data || [])
            .filter((row: any) => row.is_active !== false)
            .map((row: any) => row.id)
            .filter(Boolean);
    }, []);

    const getWorkflowNodeRecipientIds = useCallback(async (
        node?: WorkflowNode,
        stepAssignees?: Record<string, string | string[]>,
    ): Promise<string[]> => {
        if (!node) return [];
        const assignedOverride = stepAssignees?.[node.id];
        if (Array.isArray(assignedOverride)) return assignedOverride.filter(Boolean);
        if (assignedOverride) return [assignedOverride];
        if (node.config?.assigneeUserId) return [node.config.assigneeUserId];
        return getWorkflowRoleRecipients(node.config?.assigneeRole);
    }, [getWorkflowRoleRecipients]);

    const getMaterialRequestWorkflowNotificationContext = useCallback(async (instance: WorkflowInstance) => {
        const formData = instance.formData || {};
        const subjectType = getWorkflowSubjectValue(formData, ['subjectType', 'subject_type']);
        const requestId = getWorkflowSubjectValue(formData, ['subjectId', 'subject_id', 'requestId', 'request_id', 'materialRequestId']);

        let query = supabase
            .from('requests')
            .select('id, code, title, project_id, construction_site_id, workflow_instance_id, request_origin')
            .limit(1);

        if (requestId) {
            query = query.eq('id', requestId);
        } else if (subjectType === 'material_request') {
            query = query.eq('workflow_instance_id', instance.id);
        } else {
            query = query.eq('workflow_instance_id', instance.id);
        }

        const { data, error } = await query.maybeSingle();
        if (error) {
            console.warn('Cannot resolve material request workflow notification route:', error);
            return null;
        }
        if (!data) return null;
        if (subjectType && subjectType !== 'material_request' && data.request_origin !== 'project') return null;

        return {
            category: 'material',
            icon: '📦',
            link: buildMaterialRequestLink(data),
            sourceType: 'material_request',
            sourceId: data.id,
            metadata: {
                ...formData,
                subjectType: 'material_request',
                requestId: data.id,
                materialRequestId: data.id,
                requestCode: data.code,
                projectId: data.project_id || undefined,
                constructionSiteId: data.construction_site_id || undefined,
                materialTab: 'request',
                workflowInstanceId: instance.id,
                instanceId: instance.id,
            },
        };
    }, []);

    // Generic Workflow notification delivery is server-authoritative. This client path
    // remains only for the legacy Material/Request-owned workflow presentation.
    const notifyMaterialWorkflowUsers = useCallback(async (input: {
        recipientIds: Array<string | null | undefined>;
        actorId?: string;
        type: 'info' | 'warning' | 'success' | 'error';
        title: string;
        message: string;
        severity?: 'info' | 'warning' | 'critical';
        sourceId: string;
        category?: string;
        icon?: string;
        link?: string;
        sourceType?: string;
        metadata?: Record<string, any>;
    }) => {
        if (input.category !== 'material' && input.sourceType !== 'material_request') return;
        try {
            await notificationService.notifyProjectUsers({
                recipientIds: input.recipientIds,
                actorId: input.actorId,
                type: input.type,
                category: input.category || 'system',
                title: input.title,
                message: input.message,
                severity: input.severity || 'info',
                icon: input.icon || '📋',
                link: input.link || '/wf',
                sourceType: input.sourceType || 'workflow',
                sourceId: input.sourceId,
                metadata: input.metadata || {},
            });
        } catch (err) {
            console.error('WF notification error:', err);
        }
    }, []);

    // ---- Template CRUD ----

    const createTemplate = async (name: string, description: string, userId: string): Promise<WorkflowTemplate | null> => {
        const { data, error } = await supabase.rpc('create_workflow_template', {
            p_name: name,
            p_description: description,
            p_idempotency_key: crypto.randomUUID(),
        });
        if (error) throw error;
        const row = (data as { template?: any } | null)?.template;
        if (!row) throw new Error('Không nhận được dữ liệu mẫu quy trình sau khi tạo.');
        const t = mapTemplateFromDB(row);
        setTemplates(prev => [t, ...prev]);
        return t;
    };

    const updateTemplate = async (template: WorkflowTemplate) => {
        const previous = templates.find(item => item.id === template.id);
        const { data, error } = await supabase.rpc('update_workflow_template_metadata', {
            p_template_id: template.id,
            p_name: template.name,
            p_description: template.description || '',
            p_custom_fields: template.customFields || [],
            p_managers: template.managers || [],
            p_default_watchers: template.defaultWatchers || [],
            p_idempotency_key: crypto.randomUUID(),
        });
        if (error) throw error;
        const metadataRow = (data as { template?: any } | null)?.template;
        if (!metadataRow) throw new Error('Không nhận được dữ liệu mẫu quy trình sau khi cập nhật.');
        let updated = mapTemplateFromDB(metadataRow);
        if (previous && previous.isActive !== template.isActive) {
            const { data: publishData, error: publishError } = await supabase.rpc('publish_workflow_template', {
                p_template_id: template.id,
                p_is_active: template.isActive,
                p_idempotency_key: crypto.randomUUID(),
            });
            if (publishError) throw publishError;
            const publishedRow = (publishData as { template?: any } | null)?.template;
            if (publishedRow) updated = mapTemplateFromDB(publishedRow);
        }
        setTemplates(prev => prev.map(t => t.id === template.id ? updated : t));
    };

    const deleteTemplate = async (id: string) => {
        const { error } = await supabase.rpc('delete_workflow_template', {
            p_template_id: id,
            p_idempotency_key: crypto.randomUUID(),
        });
        if (error) throw error;
        setTemplates(prev => prev.filter(t => t.id !== id));
        setNodes(prev => prev.filter(n => n.templateId !== id));
        setEdges(prev => prev.filter(e => e.templateId !== id));
    };

    // ---- Nodes & Edges ----

    const getTemplateNodes = (templateId: string) =>
        nodes.filter(n => n.templateId === templateId && !isTemplateRemovedNode(n));
    const getTemplateEdges = (templateId: string) => {
        const activeNodeIds = new Set(getTemplateNodes(templateId).map(node => node.id));
        return edges.filter(e =>
            e.templateId === templateId &&
            activeNodeIds.has(e.sourceNodeId) &&
            activeNodeIds.has(e.targetNodeId)
        );
    };

    const saveNodesAndEdges = async (templateId: string, newNodes: WorkflowNode[], newEdges: WorkflowEdge[]) => {
        const template = templates.find(item => item.id === templateId);
        if (!template) throw new Error('Không tìm thấy mẫu quy trình.');
        const { error } = await supabase.rpc('save_workflow_template_structure', {
            p_template_id: templateId,
            p_template: {
                name: template.name,
                description: template.description || '',
                is_active: template.isActive,
                custom_fields: template.customFields || [],
                managers: template.managers || [],
                default_watchers: template.defaultWatchers || [],
            },
            p_nodes: newNodes.map(node => ({
                id: node.id, type: node.type, label: node.label,
                config: node.config || {}, position_x: node.positionX, position_y: node.positionY,
            })),
            p_edges: newEdges.map(edge => ({
                id: edge.id, source_node_id: edge.sourceNodeId,
                target_node_id: edge.targetNodeId, label: edge.label || '',
            })),
        });
        if (error) throw error;

        // Refresh local state
        setNodes(prev => [...prev.filter(n => n.templateId !== templateId), ...newNodes]);
        setEdges(prev => [...prev.filter(e => e.templateId !== templateId), ...newEdges]);
    };

    // ---- Instances ----

    const createInstance = async (
        templateId: string,
        title: string,
        userId: string,
        formData: Record<string, any> = {},
        firstAssigneeUserIds?: string | string[],
    ): Promise<WorkflowInstance | null> => {
        // Find the START node of this template
        const templateNodes = getTemplateNodes(templateId);
        const templateEdges = getTemplateEdges(templateId);
        const startNode = templateNodes.find(n => n.type === WorkflowNodeType.START);
        if (!startNode) { console.error('No START node found'); return null; }

        // Find next node after START
        const startEdge = templateEdges.find(e => e.sourceNodeId === startNode.id);
        const firstTaskNodeId = startEdge ? startEdge.targetNodeId : null;
        const firstTaskNode = templateNodes.find(node => node.id === firstTaskNodeId);
        const initialStepAssignees = firstTaskNode?.type === WorkflowNodeType.END
            ? {}
            : buildInitialWorkflowStepAssignees(firstTaskNodeId, firstAssigneeUserIds);
        if (!initialStepAssignees) {
            console.error('Workflow first task requires at least one concrete assignee');
            return null;
        }

        const assigneeIds = normalizeStepAssigneeIds(firstAssigneeUserIds);
        const { data, error } = await supabase.rpc('create_workflow_instance_v2', {
            p_input: {
                templateId,
                title,
                formData,
                firstNodeId: firstTaskNodeId,
                firstAssigneeUserIds: assigneeIds,
            },
            p_idempotency_key: crypto.randomUUID(),
        });
        if (error) { console.error(error); return null; }
        const commandResult = data as { instance?: any; log?: any } | null;
        if (!commandResult?.instance) return null;
        const createdInstance = mapInstanceFromDB(commandResult.instance);
        setInstances(prev => [createdInstance, ...prev]);
        if (commandResult.log) setLogs(prev => [...prev, mapLogFromDB(commandResult.log)]);

        // 📝 Audit trail: new workflow instance created
        auditService.log({
            tableName: 'workflow_instances',
            recordId: createdInstance.id,
            action: 'INSERT',
            newData: { id: createdInstance.id, code: createdInstance.code, title, templateId, status: 'RUNNING', formData },
            userId,
            userName: userId,
            description: `Tạo phiếu quy trình: ${title} (${createdInstance.code})`,
        });

        // 🔔 Notify assignees when new WF instance is created
        if (firstTaskNodeId) {
            const firstNode = templateNodes.find(n => n.id === firstTaskNodeId);
            const materialNotificationContext = await getMaterialRequestWorkflowNotificationContext(createdInstance);
            if (materialNotificationContext) {
                const recipientIds = await getWorkflowNodeRecipientIds(firstNode, createdInstance.stepAssignees);
                await notifyMaterialWorkflowUsers({
                    recipientIds,
                    actorId: userId,
                    type: 'info',
                    title: 'Phiếu vật tư cần xử lý',
                    message: `Phiếu ${materialNotificationContext.metadata.requestCode || createdInstance.code} đang chờ bạn xử lý bước "${firstNode?.label || ''}".`,
                    sourceId: materialNotificationContext.sourceId || `wf_new_${createdInstance.id}`,
                    category: materialNotificationContext.category,
                    icon: materialNotificationContext.icon,
                    link: materialNotificationContext.link,
                    sourceType: materialNotificationContext.sourceType,
                    metadata: { ...materialNotificationContext.metadata, instanceId: createdInstance.id, templateId, nodeId: firstTaskNodeId },
                });
            }
        }

        return createdInstance;
    };

    const createDraft = async (
        templateId: string,
        title: string,
        formData: Record<string, any> = {},
        firstAssigneeUserIds?: string | string[],
    ): Promise<WorkflowInstance | null> => {
        const { data, error } = await supabase.rpc('create_workflow_instance_draft', {
            p_input: {
                templateId,
                title,
                formData,
                initialAssigneeUserIds: normalizeStepAssigneeIds(firstAssigneeUserIds),
            },
            p_idempotency_key: crypto.randomUUID(),
        });
        if (error) { console.error(error); return null; }
        const commandResult = data as { instance?: any } | null;
        if (!commandResult?.instance) return null;
        const draft = mapInstanceFromDB(commandResult.instance);
        setInstances(prev => [draft, ...prev]);
        return draft;
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

    const loadInstanceById = useCallback(async (instanceId: string): Promise<WorkflowInstance | null> => {
        if (!isWorkflowInstanceId(instanceId)) return null;

        const { data: instanceRow, error: instanceError } = await supabase
            .from('workflow_instances')
            .select(WORKFLOW_INSTANCE_LIST_SELECT)
            .eq('id', instanceId)
            .maybeSingle();
        if (instanceError || !instanceRow) {
            if (instanceError) console.error('loadInstanceById instance error:', instanceError);
            return null;
        }

        try {
            const [templateRes, nodeRes, edgeRes, logRes, printTemplateRes] = await Promise.all([
                supabase.from('workflow_templates').select(WORKFLOW_TEMPLATE_SELECT).eq('id', instanceRow.template_id).maybeSingle(),
                supabase.from('workflow_nodes').select(WORKFLOW_NODE_SELECT).eq('template_id', instanceRow.template_id).order('id', { ascending: true }).limit(WORKFLOW_CHILD_MAX_ROWS),
                supabase.from('workflow_edges').select(WORKFLOW_EDGE_SELECT).eq('template_id', instanceRow.template_id).order('id', { ascending: true }).limit(WORKFLOW_CHILD_MAX_ROWS),
                supabase.from('workflow_instance_logs').select(WORKFLOW_LOG_SELECT).eq('instance_id', instanceId).order('created_at', { ascending: true }).limit(WORKFLOW_CHILD_MAX_ROWS),
                supabase.from('workflow_print_templates').select(WORKFLOW_PRINT_TEMPLATE_SELECT).eq('template_id', instanceRow.template_id).order('created_at', { ascending: false }).limit(WORKFLOW_CHILD_MAX_ROWS),
            ]);
            const firstError = [templateRes.error, nodeRes.error, edgeRes.error, logRes.error, printTemplateRes.error].find(Boolean);
            if (firstError) {
                console.error('loadInstanceById related data error:', firstError);
                return null;
            }

            const loadedInstance = mapInstanceFromDB(instanceRow);
            const loadedTemplate = templateRes.data ? mapTemplateFromDB(templateRes.data) : null;
            const loadedNodes = (nodeRes.data || []).map(mapNodeFromDB);
            const loadedEdges = (edgeRes.data || []).map(mapEdgeFromDB);
            const loadedLogs = (logRes.data || []).map(mapLogFromDB);
            const loadedPrintTemplates = (printTemplateRes.data || []).map(mapPrintTemplateFromDB);

            setInstances(previous => [loadedInstance, ...previous.filter(item => item.id !== loadedInstance.id)]);
            if (loadedTemplate) {
                setTemplates(previous => [loadedTemplate, ...previous.filter(item => item.id !== loadedTemplate.id)]);
            }
            setNodes(previous => [
                ...previous.filter(item => item.templateId !== loadedInstance.templateId),
                ...loadedNodes.filter(item => !isTemplateRemovedNode(item)),
            ]);
            setEdges(previous => [
                ...previous.filter(item => item.templateId !== loadedInstance.templateId),
                ...loadedEdges,
            ]);
            setLogs(previous => [
                ...previous.filter(item => item.instanceId !== loadedInstance.id),
                ...loadedLogs,
            ].sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)) || left.id.localeCompare(right.id)));
            setPrintTemplates(previous => [
                ...previous.filter(item => item.templateId !== loadedInstance.templateId),
                ...loadedPrintTemplates,
            ]);
            return loadedInstance;
        } catch (error) {
            console.error('loadInstanceById related data error:', error);
            return null;
        }
    }, []);

    const processInstance = async (
        instanceId: string,
        action: WorkflowInstanceAction,
        userId: string,
        comment: string = '',
        nextAssigneeUserIds?: string | string[],
    ): Promise<WorkflowProcessResult> => {
        const normalizedNextAssigneeIds = normalizeStepAssigneeIds(nextAssigneeUserIds);
        // IMPORTANT: Fetch fresh data from DB to avoid stale React state closure issues
        const { data: freshInstance, error: freshInstanceError } = await supabase
            .from('workflow_instances')
            .select(WORKFLOW_INSTANCE_LIST_SELECT)
            .eq('id', instanceId)
            .single();
        
        if (freshInstanceError || !freshInstance || !freshInstance.current_node_id) {
            console.error('processInstance: instance not found or no current_node_id', freshInstanceError || instanceId);
            return {
                ok: false,
                errorCode: freshInstanceError?.code,
                errorMessage: getWorkflowProcessErrorMessage(freshInstanceError || undefined),
            };
        }

        let { data: processedData, error: processError } = await supabase.rpc('process_workflow_instance_fast', {
            p_instance_id: instanceId,
            p_action: action,
            p_user_id: userId,
            p_comment: comment,
            p_next_assignee_user_ids: normalizedNextAssigneeIds,
        });
        if (processError && (
            processError.code === 'PGRST202' ||
            String(processError.message || '').includes('p_next_assignee_user_ids')
        )) {
            const fallback = await supabase.rpc('process_workflow_instance_fast', {
                p_instance_id: instanceId,
                p_action: action,
                p_user_id: userId,
                p_comment: comment,
                p_next_assignee_user_id: normalizedNextAssigneeIds[0] || null,
            });
            processedData = fallback.data;
            processError = fallback.error;
        }
        if (processError) {
            console.error('processInstance RPC error:', processError);
            return {
                ok: false,
                errorCode: processError.code,
                errorMessage: getWorkflowProcessErrorMessage(processError),
            };
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
            const mappedInstance = mapInstanceFromDB(processedRow);
            const updatedInstance = {
                ...mappedInstance,
                formData: Object.keys(existingFormData).length > 0 ? existingFormData : mappedInstance.formData,
            };
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

        // 🔔 Push notifications for workflow actions
        try {
            const inst = mapInstanceFromDB(freshInstance);
            const mappedNextInstance = processedRow ? mapInstanceFromDB(processedRow) : undefined;
            const nextInstance = mappedNextInstance
                ? {
                    ...mappedNextInstance,
                    formData: Object.keys(mappedNextInstance.formData || {}).length > 0 ? mappedNextInstance.formData : inst.formData,
                }
                : undefined;
            const materialNotificationContext = await getMaterialRequestWorkflowNotificationContext(inst);
            if (!materialNotificationContext) return { ok: true };
            const templateNodes = nodes.filter(node => node.templateId === inst.templateId);
            const workflowNotificationFields = (metadata: Record<string, any> = {}) => ({
                sourceId: materialNotificationContext?.sourceId,
                category: materialNotificationContext?.category,
                icon: materialNotificationContext?.icon,
                link: materialNotificationContext?.link,
                sourceType: materialNotificationContext?.sourceType,
                metadata: { ...(materialNotificationContext?.metadata || {}), ...metadata },
            });
            if (action === WorkflowInstanceAction.APPROVED) {
                const route = workflowNotificationFields({ instanceId, action, status: nextInstance?.status });
                await notifyMaterialWorkflowUsers({
                    recipientIds: [inst.createdBy],
                    actorId: userId,
                    type: 'success',
                    title: materialNotificationContext ? 'Phiếu vật tư được duyệt' : '✅ Phiếu quy trình được duyệt',
                    message: materialNotificationContext
                        ? `Phiếu ${materialNotificationContext.metadata.requestCode || inst.code} đã được duyệt${nextInstance?.status === WorkflowInstanceStatus.COMPLETED ? ' hoàn tất' : ''}.`
                        : `"${inst.title}" (${inst.code}) đã được duyệt${nextInstance?.status === WorkflowInstanceStatus.COMPLETED ? ' hoàn tất' : ''}`,
                    sourceId: route.sourceId || `wf_approved_${instanceId}_${Date.now()}`,
                    category: route.category,
                    icon: route.icon,
                    link: route.link,
                    sourceType: route.sourceType,
                    metadata: route.metadata,
                });

                if (nextInstance?.status === WorkflowInstanceStatus.RUNNING && nextInstance.currentNodeId) {
                    const nextNode = templateNodes.find(n => n.id === nextInstance.currentNodeId);
                    if (nextNode && nextNode.type !== WorkflowNodeType.END) {
                        const recipientIds = await getWorkflowNodeRecipientIds(nextNode, nextInstance.stepAssignees);
                        const nextRoute = workflowNotificationFields({ instanceId, nodeId: nextNode.id, assignedUserIds: normalizedNextAssigneeIds });
                        await notifyMaterialWorkflowUsers({
                            recipientIds,
                            actorId: userId,
                            type: 'info',
                            title: materialNotificationContext ? 'Phiếu vật tư cần xử lý' : '📋 Phiếu quy trình cần duyệt',
                            message: materialNotificationContext
                                ? `Phiếu ${materialNotificationContext.metadata.requestCode || inst.code} đang chờ bạn xử lý bước "${nextNode.label}".`
                                : `"${inst.title}" (${inst.code}) — Bạn cần duyệt bước "${nextNode.label}"`,
                            sourceId: nextRoute.sourceId || `wf_next_${instanceId}_${Date.now()}`,
                            category: nextRoute.category,
                            icon: nextRoute.icon,
                            link: nextRoute.link,
                            sourceType: nextRoute.sourceType,
                            metadata: nextRoute.metadata,
                        });
                    }
                }
            } else if (action === WorkflowInstanceAction.REJECTED) {
                const route = workflowNotificationFields({ instanceId, action });
                await notifyMaterialWorkflowUsers({
                    recipientIds: [inst.createdBy],
                    actorId: userId,
                    type: 'error',
                    title: materialNotificationContext ? 'Phiếu vật tư bị từ chối' : '❌ Phiếu quy trình bị từ chối',
                    message: materialNotificationContext
                        ? `Phiếu ${materialNotificationContext.metadata.requestCode || inst.code} đã bị từ chối${comment ? ': ' + comment : ''}`
                        : `"${inst.title}" (${inst.code}) đã bị từ chối${comment ? ': ' + comment : ''}`,
                    severity: 'warning',
                    sourceId: route.sourceId || `wf_rejected_${instanceId}_${Date.now()}`,
                    category: route.category,
                    icon: route.icon,
                    link: route.link,
                    sourceType: route.sourceType,
                    metadata: route.metadata,
                });
            } else if (action === WorkflowInstanceAction.REVISION_REQUESTED) {
                const route = workflowNotificationFields({ instanceId, action, currentNodeId: nextInstance?.currentNodeId });
                await notifyMaterialWorkflowUsers({
                    recipientIds: [inst.createdBy],
                    actorId: userId,
                    type: 'warning',
                    title: materialNotificationContext ? 'Phiếu vật tư cần bổ sung' : '↩ Phiếu quy trình cần bổ sung',
                    message: materialNotificationContext
                        ? `Phiếu ${materialNotificationContext.metadata.requestCode || inst.code} cần bổ sung${comment ? ': ' + comment : ''}`
                        : `"${inst.title}" (${inst.code}) cần bổ sung${comment ? ': ' + comment : ''}`,
                    severity: 'warning',
                    sourceId: route.sourceId || `wf_revision_${instanceId}_${Date.now()}`,
                    category: route.category,
                    icon: route.icon,
                    link: route.link,
                    sourceType: route.sourceType,
                    metadata: route.metadata,
                });

                if (nextInstance?.status === WorkflowInstanceStatus.RUNNING && nextInstance.currentNodeId) {
                    const revisionNode = templateNodes.find(n => n.id === nextInstance.currentNodeId);
                    const recipientIds = await getWorkflowNodeRecipientIds(revisionNode, nextInstance.stepAssignees);
                    const revisionRoute = workflowNotificationFields({ instanceId, nodeId: revisionNode?.id });
                    await notifyMaterialWorkflowUsers({
                        recipientIds,
                        actorId: userId,
                        type: 'info',
                        title: materialNotificationContext ? 'Phiếu vật tư đã quay về bước của bạn' : '📋 Phiếu quy trình đã quay về bước của bạn',
                        message: materialNotificationContext
                            ? `Phiếu ${materialNotificationContext.metadata.requestCode || inst.code} cần xử lý lại bước "${revisionNode?.label || ''}".`
                            : `"${inst.title}" (${inst.code}) — cần xử lý lại bước "${revisionNode?.label || ''}"`,
                        sourceId: revisionRoute.sourceId || `wf_revision_assignee_${instanceId}_${Date.now()}`,
                        category: revisionRoute.category,
                        icon: revisionRoute.icon,
                        link: revisionRoute.link,
                        sourceType: revisionRoute.sourceType,
                        metadata: revisionRoute.metadata,
                    });
                }
            }
        } catch (err) { console.error('WF notification error:', err); }

        return { ok: true };
    };

    const getInstanceLogs = (instanceId: string) => logs.filter(l => l.instanceId === instanceId);

    const updateInstance = async (instanceId: string, updates: { title?: string; formData?: Record<string, any>; initialAssigneeUserIds?: string[] }): Promise<boolean> => {
        const existingInstance = instances.find(instance => instance.id === instanceId);
        const isDraft = existingInstance?.status === WorkflowInstanceStatus.DRAFT;
        const { data, error } = isDraft
            ? await supabase.rpc('update_workflow_instance_draft', {
                p_instance_id: instanceId,
                p_title: updates.title ?? null,
                p_form_data: updates.formData ?? null,
                p_initial_assignee_user_ids: updates.initialAssigneeUserIds ?? null,
                p_idempotency_key: crypto.randomUUID(),
            })
            : await supabase.rpc('update_workflow_instance_content', {
                p_instance_id: instanceId,
                p_title: updates.title ?? null,
                p_form_data: updates.formData ?? null,
                p_idempotency_key: crypto.randomUUID(),
            });
        if (error) { console.error(error); return false; }
        const commandResult = data as { instance?: any } | null;
        if (!commandResult?.instance) return false;
        setInstances(prev => prev.map(i => i.id === instanceId
            ? mapInstanceFromDB(commandResult.instance)
            : i));
        return true;
    };

    const submitDraft = async (instanceId: string, firstAssigneeUserIds: string[] = []): Promise<boolean> => {
        const { data, error } = await supabase.rpc('submit_workflow_instance_draft', {
            p_instance_id: instanceId,
            p_initial_assignee_user_ids: firstAssigneeUserIds,
            p_idempotency_key: crypto.randomUUID(),
        });
        if (error) { console.error(error); return false; }
        const commandResult = data as { instance?: any; log?: any } | null;
        if (!commandResult?.instance) return false;
        setInstances(prev => prev.map(instance => instance.id === instanceId
            ? mapInstanceFromDB(commandResult.instance)
            : instance));
        if (commandResult.log) {
            setLogs(prev => prev.some(log => log.id === commandResult.log.id)
                ? prev
                : [...prev, mapLogFromDB(commandResult.log)]);
        }
        return true;
    };

    const deleteDraft = async (instanceId: string): Promise<boolean> => {
        const { data, error } = await supabase.rpc('delete_workflow_instance_draft', {
            p_instance_id: instanceId,
            p_idempotency_key: crypto.randomUUID(),
        });
        if (error || !(data as { deletedInstanceId?: string } | null)?.deletedInstanceId) {
            if (error) console.error(error);
            return false;
        }
        setInstances(prev => prev.filter(instance => instance.id !== instanceId));
        setLogs(prev => prev.filter(log => log.instanceId !== instanceId));
        return true;
    };

    const cancelInstance = async (instanceId: string, userId: string): Promise<boolean> => {
        const { data, error } = await supabase.rpc('cancel_workflow_instance', {
            p_instance_id: instanceId,
            p_comment: 'Phiếu đã bị hủy bởi người có thẩm quyền',
            p_idempotency_key: crypto.randomUUID(),
        });
        if (error) { console.error(error); return false; }
        const existingFormData = instances.find(i => i.id === instanceId)?.formData || {};
        const commandResult = data as { instance?: any; log?: any } | null;
        if (commandResult?.instance) {
            setInstances(prev => prev.map(i => i.id === instanceId
                ? { ...mapInstanceFromDB(commandResult.instance), formData: existingFormData }
                : i));
        }
        if (commandResult?.log) {
            setLogs(prev => prev.some(log => log.id === commandResult.log.id)
                ? prev
                : [...prev, mapLogFromDB(commandResult.log)]);
        }
        return true;
    };

    const reopenInstance = async (instanceId: string, targetNodeId: string, userId: string, comment: string = ''): Promise<boolean> => {
        const instance = instances.find(i => i.id === instanceId);
        if (!instance) return false;
        // Only allow reopening COMPLETED or REJECTED instances
        if (instance.status !== WorkflowInstanceStatus.COMPLETED && instance.status !== WorkflowInstanceStatus.REJECTED) return false;

        const { data, error } = await supabase.rpc('reopen_workflow_instance', {
            p_instance_id: instanceId,
            p_target_node_id: targetNodeId,
            p_comment: comment || '',
            p_idempotency_key: crypto.randomUUID(),
        });
        if (error) { console.error(error); return false; }
        const commandResult = data as { instance?: any; log?: any } | null;
        if (commandResult?.instance) {
            setInstances(prev => prev.map(i => i.id === instanceId
                ? { ...mapInstanceFromDB(commandResult.instance), formData: instance.formData || {} }
                : i));
        }
        if (commandResult?.log) {
            setLogs(prev => prev.some(log => log.id === commandResult.log.id)
                ? prev
                : [...prev, mapLogFromDB(commandResult.log)]);
        }

        return true;
    };

    // ---- Instance Watchers ----
    const updateInstanceWatchers = async (instanceId: string, watchers: string[]): Promise<boolean> => {
        const currentInstance = instances.find(i => i.id === instanceId);
        const previousWatchers = new Set(currentInstance?.watchers || []);
        const addedWatchers = [...new Set(watchers)].filter(uid => !previousWatchers.has(uid));
        const { error } = await supabase.rpc('update_workflow_instance_watchers', {
            p_instance_id: instanceId,
            p_watcher_user_ids: [...new Set(watchers)],
            p_idempotency_key: crypto.randomUUID(),
        });
        if (error) { console.error(error); return false; }
        setInstances(prev => prev.map(i => i.id === instanceId ? { ...i, watchers } : i));
        if (currentInstance && addedWatchers.length > 0) {
            const materialNotificationContext = await getMaterialRequestWorkflowNotificationContext(currentInstance);
            await notifyMaterialWorkflowUsers({
                recipientIds: addedWatchers,
                type: 'info',
                title: materialNotificationContext ? 'Bạn được thêm theo dõi phiếu vật tư' : '👀 Bạn được tag theo dõi quy trình',
                message: materialNotificationContext
                    ? `Phiếu ${materialNotificationContext.metadata.requestCode || currentInstance.code} đã thêm bạn vào danh sách theo dõi.`
                    : `"${currentInstance.title}" (${currentInstance.code}) đã thêm bạn vào danh sách theo dõi`,
                sourceId: materialNotificationContext?.sourceId || `wf_watchers_${instanceId}_${Date.now()}`,
                category: materialNotificationContext?.category,
                icon: materialNotificationContext?.icon,
                link: materialNotificationContext?.link,
                sourceType: materialNotificationContext?.sourceType,
                metadata: { ...(materialNotificationContext?.metadata || {}), instanceId },
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
        createInstance, createDraft, loadInstanceById, loadInstanceFormData, updateInstance, submitDraft, deleteDraft, cancelInstance, processInstance, reopenInstance, getInstanceLogs, updateInstanceWatchers,
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
