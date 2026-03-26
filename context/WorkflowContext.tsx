
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import {
    WorkflowTemplate, WorkflowNode, WorkflowEdge,
    WorkflowInstance, WorkflowInstanceLog, WorkflowPrintTemplate,
    WorkflowInstanceStatus, WorkflowInstanceAction, WorkflowNodeType,
    WorkflowCustomField
} from '../types';

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
    updateInstance: (instanceId: string, updates: { title?: string; formData?: Record<string, any> }) => Promise<boolean>;
    deleteInstance: (instanceId: string) => Promise<boolean>;
    cancelInstance: (instanceId: string, userId: string) => Promise<boolean>;
    processInstance: (instanceId: string, action: WorkflowInstanceAction, userId: string, comment?: string) => Promise<void>;
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
    formData: row.form_data || {},
    watchers: row.watchers || [],
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
    const [isLoading, setIsLoading] = useState(true);

    const refreshData = useCallback(async () => {
        setIsLoading(true);
        try {
            const [tRes, nRes, eRes, iRes, lRes, ptRes] = await Promise.all([
                supabase.from('workflow_templates').select('*').order('created_at', { ascending: false }),
                supabase.from('workflow_nodes').select('*'),
                supabase.from('workflow_edges').select('*'),
                supabase.from('workflow_instances').select('*').order('created_at', { ascending: false }),
                supabase.from('workflow_instance_logs').select('*').order('created_at', { ascending: true }),
                supabase.from('workflow_print_templates').select('*').order('created_at', { ascending: false }),
            ]);
            if (tRes.data) setTemplates(tRes.data.map(mapTemplateFromDB));
            if (nRes.data) setNodes(nRes.data.map(mapNodeFromDB));
            if (eRes.data) setEdges(eRes.data.map(mapEdgeFromDB));
            if (iRes.data) setInstances(iRes.data.map(mapInstanceFromDB));
            if (lRes.data) setLogs(lRes.data.map(mapLogFromDB));
            if (ptRes.data) setPrintTemplates(ptRes.data.map(mapPrintTemplateFromDB));
        } catch (err) {
            console.error('WorkflowContext fetch error:', err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        refreshData();
    }, [refreshData]);

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
        await supabase.from('workflow_templates').update({
            name: template.name,
            description: template.description,
            is_active: template.isActive,
            custom_fields: template.customFields || [],
            managers: template.managers || [],
            default_watchers: template.defaultWatchers || [],
            updated_at: new Date().toISOString(),
        }).eq('id', template.id);
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

        // Generate code: WF-YYYY-NNN (global sequential)
        const year = new Date().getFullYear();
        const count = instances.length + 1;
        const code = `WF-${year}-${String(count).padStart(3, '0')}`;

        const { data, error } = await supabase.from('workflow_instances').insert({
            template_id: templateId,
            code,
            title,
            created_by: userId,
            current_node_id: firstTaskNodeId,
            status: 'RUNNING',
            form_data: formData,
            watchers: tmpl?.defaultWatchers || [],
        }).select().single();

        if (error || !data) { console.error(error); return null; }

        // Log the submission at the START node
        await supabase.from('workflow_instance_logs').insert({
            instance_id: data.id,
            node_id: startNode.id,
            action: 'SUBMITTED',
            acted_by: userId,
            comment: 'Phiếu được tạo mới',
        });

        await refreshData();
        return mapInstanceFromDB(data);
    };

    const processInstance = async (instanceId: string, action: WorkflowInstanceAction, userId: string, comment: string = '') => {
        // IMPORTANT: Fetch fresh data from DB to avoid stale React state closure issues
        const { data: freshInstance } = await supabase
            .from('workflow_instances')
            .select('*')
            .eq('id', instanceId)
            .single();
        
        if (!freshInstance || !freshInstance.current_node_id) {
            console.error('processInstance: instance not found or no current_node_id', instanceId);
            return;
        }

        const currentNodeId = freshInstance.current_node_id;
        const templateId = freshInstance.template_id;

        // Fetch fresh nodes and edges from DB
        const [nodesRes, edgesRes] = await Promise.all([
            supabase.from('workflow_nodes').select('*').eq('template_id', templateId),
            supabase.from('workflow_edges').select('*').eq('template_id', templateId),
        ]);
        const templateNodes = (nodesRes.data || []).map(mapNodeFromDB);
        const templateEdges = (edgesRes.data || []).map(mapEdgeFromDB);

        // Log the action at current node
        await supabase.from('workflow_instance_logs').insert({
            instance_id: instanceId,
            node_id: currentNodeId,
            action,
            acted_by: userId,
            comment,
        });

        if (action === WorkflowInstanceAction.APPROVED) {
            // Move to next node
            const nextEdge = templateEdges.find(e => e.sourceNodeId === currentNodeId);
            if (nextEdge) {
                const nextNode = templateNodes.find(n => n.id === nextEdge.targetNodeId);
                if (nextNode && nextNode.type === WorkflowNodeType.END) {
                    // Reached END
                    await supabase.from('workflow_instances').update({
                        current_node_id: nextNode.id,
                        status: 'COMPLETED',
                        updated_at: new Date().toISOString(),
                    }).eq('id', instanceId);
                } else {
                    await supabase.from('workflow_instances').update({
                        current_node_id: nextEdge.targetNodeId,
                        updated_at: new Date().toISOString(),
                    }).eq('id', instanceId);
                }
            } else {
                console.error('processInstance: No next edge found from node', currentNodeId);
            }
        } else if (action === WorkflowInstanceAction.REJECTED) {
            await supabase.from('workflow_instances').update({
                status: 'REJECTED',
                updated_at: new Date().toISOString(),
            }).eq('id', instanceId);
        } else if (action === WorkflowInstanceAction.REVISION_REQUESTED) {
            // Send back to previous step (find edge where target = current)
            const prevEdge = templateEdges.find(e => e.targetNodeId === currentNodeId);
            if (prevEdge) {
                const prevNode = templateNodes.find(n => n.id === prevEdge.sourceNodeId);
                if (prevNode && prevNode.type === WorkflowNodeType.START) {
                    // If prev is START, find the first real step (node right after START)
                    const firstStepEdge = templateEdges.find(e => e.sourceNodeId === prevNode.id);
                    if (firstStepEdge) {
                        await supabase.from('workflow_instances').update({
                            current_node_id: firstStepEdge.targetNodeId,
                            updated_at: new Date().toISOString(),
                        }).eq('id', instanceId);
                    }
                } else {
                    await supabase.from('workflow_instances').update({
                        current_node_id: prevEdge.sourceNodeId,
                        updated_at: new Date().toISOString(),
                    }).eq('id', instanceId);
                }
            }
        }

        await refreshData();
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
        const { error } = await supabase.from('workflow_instances').update({
            status: 'CANCELLED',
            updated_at: new Date().toISOString(),
        }).eq('id', instanceId);
        if (error) { console.error(error); return false; }
        await supabase.from('workflow_instance_logs').insert({
            instance_id: instanceId,
            node_id: instances.find(i => i.id === instanceId)?.currentNodeId,
            action: 'REJECTED',
            acted_by: userId,
            comment: 'Phiếu đã bị hủy bởi người tạo',
        });
        await refreshData();
        return true;
    };

    const reopenInstance = async (instanceId: string, targetNodeId: string, userId: string, comment: string = ''): Promise<boolean> => {
        const instance = instances.find(i => i.id === instanceId);
        if (!instance) return false;
        // Only allow reopening COMPLETED or REJECTED instances
        if (instance.status !== WorkflowInstanceStatus.COMPLETED && instance.status !== WorkflowInstanceStatus.REJECTED) return false;

        const { error } = await supabase.from('workflow_instances').update({
            status: 'RUNNING',
            current_node_id: targetNodeId,
            updated_at: new Date().toISOString(),
        }).eq('id', instanceId);
        if (error) { console.error(error); return false; }

        // Log the reopen action
        const targetNode = nodes.find(n => n.id === targetNodeId);
        await supabase.from('workflow_instance_logs').insert({
            instance_id: instanceId,
            node_id: targetNodeId,
            action: 'REOPENED',
            acted_by: userId,
            comment: comment || `Mở lại quy trình về bước "${targetNode?.label || ''}"`
        });

        await refreshData();
        return true;
    };

    // ---- Instance Watchers ----
    const updateInstanceWatchers = async (instanceId: string, watchers: string[]): Promise<boolean> => {
        const { error } = await supabase.from('workflow_instances').update({
            watchers,
            updated_at: new Date().toISOString(),
        }).eq('id', instanceId);
        if (error) { console.error(error); return false; }
        setInstances(prev => prev.map(i => i.id === instanceId ? { ...i, watchers } : i));
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
        createInstance, updateInstance, deleteInstance, cancelInstance, processInstance, reopenInstance, getInstanceLogs, updateInstanceWatchers,
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
