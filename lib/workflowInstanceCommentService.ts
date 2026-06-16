import { supabase } from './supabase';
import { WorkflowInstanceComment, WorkflowInstanceCommentAttachment } from '../types';

const TABLE = 'workflow_instance_comments';
const BUCKET = 'workflow-instance-comment-attachments';
const MAX_ATTACHMENTS_PER_COMMENT = 5;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const mapComment = (row: any): WorkflowInstanceComment => ({
  id: row.id,
  instanceId: row.instance_id ?? row.instanceId,
  authorUserId: row.author_user_id ?? row.authorUserId,
  body: row.body || '',
  attachments: Array.isArray(row.attachments) ? row.attachments : [],
  createdAt: row.created_at ?? row.createdAt,
  updatedAt: row.updated_at ?? row.updatedAt,
});

const sanitizeFileName = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'attachment';

const isImageMime = (mimeType: string) => mimeType.startsWith('image/');

export const workflowInstanceCommentService = {
  maxAttachmentsPerComment: MAX_ATTACHMENTS_PER_COMMENT,
  maxAttachmentBytes: MAX_ATTACHMENT_BYTES,

  async list(instanceId: string): Promise<WorkflowInstanceComment[]> {
    if (!instanceId) return [];
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('instance_id', instanceId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data || []).map(mapComment);
  },

  async uploadAttachment(input: { instanceId: string; file: File; draftId?: string }): Promise<WorkflowInstanceCommentAttachment> {
    if (!input.instanceId) throw new Error('Thiếu phiếu quy trình để upload file.');
    if (!input.file) throw new Error('Thiếu file đính kèm.');
    if (input.file.size > MAX_ATTACHMENT_BYTES) throw new Error('File đính kèm tối đa 25MB.');

    const attachmentId = crypto.randomUUID();
    const draftId = input.draftId || crypto.randomUUID();
    const mimeType = input.file.type || 'application/octet-stream';
    const storagePath = `workflow-instances/${input.instanceId}/${draftId}/${attachmentId}-${sanitizeFileName(input.file.name)}`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, input.file, {
        contentType: mimeType,
        upsert: false,
      });
    if (error) throw error;

    return {
      id: attachmentId,
      fileName: input.file.name || 'attachment',
      fileSize: input.file.size,
      mimeType,
      storagePath,
      kind: isImageMime(mimeType) ? 'image' : 'file',
      uploadedAt: new Date().toISOString(),
    };
  },

  async create(input: {
    instanceId: string;
    authorUserId: string;
    body?: string;
    attachments?: WorkflowInstanceCommentAttachment[];
  }): Promise<WorkflowInstanceComment> {
    const body = (input.body || '').trim();
    const attachments = input.attachments || [];
    if (!body && attachments.length === 0) throw new Error('Nội dung trao đổi hoặc file đính kèm không được để trống.');
    if (body.length > 4000) throw new Error('Nội dung trao đổi tối đa 4000 ký tự.');
    if (attachments.length > MAX_ATTACHMENTS_PER_COMMENT) throw new Error('Mỗi tin nhắn tối đa 5 file đính kèm.');

    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        instance_id: input.instanceId,
        author_user_id: input.authorUserId,
        body,
        attachments,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapComment(data);
  },

  async getAttachmentUrl(storagePath: string, expiresIn = 60 * 60): Promise<string> {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, expiresIn);
    if (error) throw error;
    if (!data?.signedUrl) throw new Error('Không tạo được link xem file.');
    return data.signedUrl;
  },

  async removeAttachments(storagePaths: string[]): Promise<void> {
    const paths = storagePaths.filter(Boolean);
    if (paths.length === 0) return;
    await supabase.storage.from(BUCKET).remove(paths);
  },
};

