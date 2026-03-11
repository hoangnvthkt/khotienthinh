
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import {
    WorkflowTemplate, WorkflowNode, WorkflowEdge,
    WorkflowInstance, WorkflowInstanceLog,
    WorkflowInstanceStatus, WorkflowInstanceAction, WorkflowNodeType
} from '../types';

interface WorkflowContextType {
    templates: WorkflowTemplate[];
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    instances: WorkflowInstance[];
    logs: WorkflowInstanceLog[];
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
    processInstance: (instanceId: string, action: WorkflowInstanceAction, userId: string, comment?: string) => Promise<void>;
    getInstanceLogs: (instanceId: string) => WorkflowInstanceLog[];

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

export const WorkflowProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
    const [nodes, setNodes] = useState<WorkflowNode[]>([]);
    const [edges, setEdges] = useState<WorkflowEdge[]>([]);
    const [instances, setInstances] = useState<WorkflowInstance[]>([]);
    const [logs, setLogs] = useState<WorkflowInstanceLog[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const refreshData = useCallback(async () => {
        setIsLoading(true);
        try {
            const [tRes, nRes, eRes, iRes, lRes] = await Promise.all([
                supabase.from('workflow_templates').select('*').order('created_at', { ascending: false }),
                supabase.from('workflow_nodes').select('*'),
                supabase.from('workflow_edges').select('*'),
                supabase.from('workflow_instances').select('*').order('created_at', { ascending: false }),
                supabase.from('workflow_instance_logs').select('*').order('created_at', { ascending: true }),
            ]);
            if (tRes.data) setTemplates(tRes.data.map(mapTemplateFromDB));
            if (nRes.data) setNodes(nRes.data.map(mapNodeFromDB));
            if (eRes.data) setEdges(eRes.data.map(mapEdgeFromDB));
            if (iRes.data) setInstances(iRes.data.map(mapInstanceFromDB));
            if (lRes.data) setLogs(lRes.data.map(mapLogFromDB));
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
        // Delete existing then re-insert (simplest approach for canvas save)
        await supabase.from('workflow_edges').delete().eq('template_id', templateId);
        await supabase.from('workflow_nodes').delete().eq('template_id', templateId);

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
            await supabase.from('workflow_nodes').insert(nodeRows);
        }

        if (newEdges.length > 0) {
            const edgeRows = newEdges.map(e => ({
                id: e.id,
                template_id: templateId,
                source_node_id: e.sourceNodeId,
                target_node_id: e.targetNodeId,
                label: e.label,
            }));
            await supabase.from('workflow_edges').insert(edgeRows);
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

        // Generate code: WF-YYYY-NNN
        const year = new Date().getFullYear();
        const count = instances.filter(i => i.templateId === templateId).length + 1;
        const code = `WF-${year}-${String(count).padStart(3, '0')}`;

        const { data, error } = await supabase.from('workflow_instances').insert({
            template_id: templateId,
            code,
            title,
            created_by: userId,
            current_node_id: firstTaskNodeId,
            status: 'RUNNING',
            form_data: formData,
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
        const instance = instances.find(i => i.id === instanceId);
        if (!instance || !instance.currentNodeId) return;

        const templateNodes = nodes.filter(n => n.templateId === instance.templateId);
        const templateEdges = edges.filter(e => e.templateId === instance.templateId);

        // Log the action at current node
        await supabase.from('workflow_instance_logs').insert({
            instance_id: instanceId,
            node_id: instance.currentNodeId,
            action,
            acted_by: userId,
            comment,
        });

        if (action === WorkflowInstanceAction.APPROVED) {
            // Move to next node
            const nextEdge = templateEdges.find(e => e.sourceNodeId === instance.currentNodeId);
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
            }
        } else if (action === WorkflowInstanceAction.REJECTED) {
            await supabase.from('workflow_instances').update({
                status: 'REJECTED',
                updated_at: new Date().toISOString(),
            }).eq('id', instanceId);
        } else if (action === WorkflowInstanceAction.REVISION_REQUESTED) {
            // Send back to previous step (find edge where target = current)
            const prevEdge = templateEdges.find(e => e.targetNodeId === instance.currentNodeId);
            if (prevEdge) {
                await supabase.from('workflow_instances').update({
                    current_node_id: prevEdge.sourceNodeId,
                    updated_at: new Date().toISOString(),
                }).eq('id', instanceId);
            }
        }

        await refreshData();
    };

    const getInstanceLogs = (instanceId: string) => logs.filter(l => l.instanceId === instanceId);

    const value: WorkflowContextType = {
        templates, nodes, edges, instances, logs, isLoading,
        createTemplate, updateTemplate, deleteTemplate,
        saveNodesAndEdges, getTemplateNodes, getTemplateEdges,
        createInstance, processInstance, getInstanceLogs,
        refreshData,
    };

    return <WorkflowContext.Provider value={value}>{children}</WorkflowContext.Provider>;
};

export const useWorkflow = () => {
    const ctx = useContext(WorkflowContext);
    if (!ctx) throw new Error('useWorkflow must be used within WorkflowProvider');
    return ctx;
};
