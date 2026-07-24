import { supabase } from './supabase';
import { WorkflowStepTask, WorkflowStepTaskAttachment } from '../types';

const TABLE = 'workflow_step_tasks';
const STORAGE_BUCKET = 'workflow-attachments';
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25MB

const sanitizeFileName = (value: string) =>
    value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120) || 'attachment';

const mapTaskFromDB = (row: any): WorkflowStepTask => ({
    id: row.id,
    instanceId: row.instance_id,
    nodeId: row.node_id,
    title: row.title || '',
    isCompleted: Boolean(row.is_completed),
    completedBy: row.completed_by || null,
    completedAt: row.completed_at || null,
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

export const workflowStepTaskService = {
    async listTasks(instanceId: string): Promise<WorkflowStepTask[]> {
        if (!instanceId) return [];
        const { data, error } = await supabase
            .from(TABLE)
            .select('*')
            .eq('instance_id', instanceId)
            .order('created_at', { ascending: true });

        if (error) {
            console.error('workflowStepTaskService listTasks error:', error);
            throw error;
        }

        return (data || []).map(mapTaskFromDB);
    },

    async uploadAttachment(instanceId: string, file: File): Promise<WorkflowStepTaskAttachment> {
        if (!instanceId) throw new Error('Thiếu ID phiếu quy trình.');
        if (!file) throw new Error('Thiếu tệp đính kèm.');
        if (file.size > MAX_ATTACHMENT_BYTES) throw new Error('Dung lượng tệp đính kèm tối đa là 25MB.');

        const attachmentId = crypto.randomUUID();
        const mimeType = file.type || 'application/octet-stream';
        const storagePath = `step-tasks/${instanceId}/${attachmentId}-${sanitizeFileName(file.name)}`;

        const { error } = await supabase.storage
            .from(STORAGE_BUCKET)
            .upload(storagePath, file, {
                contentType: mimeType,
                upsert: false,
            });

        if (error) {
            console.error('workflowStepTaskService uploadAttachment error:', error);
            throw error;
        }

        return {
            id: attachmentId,
            fileName: file.name || 'attachment',
            fileSize: file.size,
            mimeType,
            storagePath,
            uploadedAt: new Date().toISOString(),
        };
    },

    async createTask(params: {
        instanceId: string;
        nodeId: string;
        title: string;
        createdBy: string;
        attachments?: WorkflowStepTaskAttachment[];
    }): Promise<WorkflowStepTask> {
        const title = (params.title || '').trim();
        if (!title) throw new Error('Nội dung công việc không được để trống.');

        const { data, error } = await supabase
            .from(TABLE)
            .insert({
                instance_id: params.instanceId,
                node_id: params.nodeId,
                title,
                created_by: params.createdBy,
                attachments: params.attachments || [],
            })
            .select('*')
            .single();

        if (error) {
            console.error('workflowStepTaskService createTask error:', error);
            throw error;
        }

        return mapTaskFromDB(data);
    },

    async toggleTaskComplete(params: {
        taskId: string;
        isCompleted: boolean;
        completedBy: string;
    }): Promise<WorkflowStepTask> {
        const { taskId, isCompleted, completedBy } = params;
        const updates: Record<string, any> = {
            is_completed: isCompleted,
            completed_by: isCompleted ? completedBy : null,
            completed_at: isCompleted ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
        };

        const { data, error } = await supabase
            .from(TABLE)
            .update(updates)
            .eq('id', taskId)
            .select('*')
            .single();

        if (error) {
            console.error('workflowStepTaskService toggleTaskComplete error:', error);
            throw error;
        }

        return mapTaskFromDB(data);
    },

    async deleteTask(taskId: string): Promise<boolean> {
        if (!taskId) return false;
        const { error } = await supabase
            .from(TABLE)
            .delete()
            .eq('id', taskId);

        if (error) {
            console.error('workflowStepTaskService deleteTask error:', error);
            throw error;
        }

        return true;
    }
};
