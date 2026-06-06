import { supabase } from './supabase';
import { ProjectWorkflowComment, ProjectWorkflowCommentAttachment, ProjectWorkflowSubject } from '../types';

const TABLE = 'workflow_subject_comments';
const BUCKET = 'workflow-comment-attachments';
const MAX_ATTACHMENTS_PER_COMMENT = 5;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const isMissingWorkflowCommentTable = (error: any): boolean =>
  ['42P01', 'PGRST205'].includes(error?.code)
  || String(error?.message || '').includes(TABLE);

const mapComment = (row: any): ProjectWorkflowComment => ({
  id: row.id,
  workflowSubjectId: row.workflow_subject_id ?? row.workflowSubjectId,
  workflowInstanceId: row.workflow_instance_id ?? row.workflowInstanceId ?? null,
  subjectType: row.subject_type ?? row.subjectType,
  subjectId: row.subject_id ?? row.subjectId,
  projectId: row.project_id ?? row.projectId ?? null,
  constructionSiteId: row.construction_site_id ?? row.constructionSiteId ?? null,
  authorUserId: row.author_user_id ?? row.authorUserId,
  body: row.body || '',
  attachments: Array.isArray(row.attachments) ? row.attachments : [],
  metadata: row.metadata || {},
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

export const projectWorkflowCommentService = {
  maxAttachmentsPerComment: MAX_ATTACHMENTS_PER_COMMENT,
  maxAttachmentBytes: MAX_ATTACHMENT_BYTES,

  async listBySubject(workflowSubjectId: string): Promise<ProjectWorkflowComment[]> {
    if (!workflowSubjectId) return [];
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('workflow_subject_id', workflowSubjectId)
      .order('created_at', { ascending: true });
    if (error) {
      if (isMissingWorkflowCommentTable(error)) return [];
      throw error;
    }
    return (data || []).map(mapComment);
  },

  async uploadAttachment(input: {
    subject: ProjectWorkflowSubject;
    file: File;
    draftId?: string;
  }): Promise<ProjectWorkflowCommentAttachment> {
    if (!input.subject?.id) throw new Error('Thiếu workflow subject để upload file.');
    if (!input.file) throw new Error('Thiếu file đính kèm.');
    if (input.file.size > MAX_ATTACHMENT_BYTES) {
      throw new Error('File đính kèm tối đa 25MB.');
    }

    const attachmentId = crypto.randomUUID();
    const draftId = input.draftId || crypto.randomUUID();
    const fileName = sanitizeFileName(input.file.name);
    const storagePath = `workflow-subjects/${input.subject.id}/${draftId}/${attachmentId}-${fileName}`;
    const mimeType = input.file.type || 'application/octet-stream';

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, input.file, {
        contentType: mimeType,
        upsert: false,
      });
    if (error) throw error;

    return {
      id: attachmentId,
      fileName: input.file.name || fileName,
      fileSize: input.file.size,
      mimeType,
      storagePath,
      kind: isImageMime(mimeType) ? 'image' : 'file',
      uploadedAt: new Date().toISOString(),
    };
  },

  async getAttachmentUrl(storagePath: string, expiresIn = 60 * 60): Promise<string> {
    if (!storagePath) throw new Error('Thiếu đường dẫn file đính kèm.');
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

  async create(input: {
    subject: ProjectWorkflowSubject;
    authorUserId: string;
    body?: string;
    attachments?: ProjectWorkflowCommentAttachment[];
    metadata?: Record<string, any>;
  }): Promise<ProjectWorkflowComment> {
    const body = (input.body || '').trim();
    const attachments = input.attachments || [];
    if (!body && attachments.length === 0) throw new Error('Nội dung trao đổi hoặc file đính kèm không được để trống.');
    if (body.length > 4000) throw new Error('Nội dung trao đổi tối đa 4000 ký tự.');
    if (attachments.length > MAX_ATTACHMENTS_PER_COMMENT) throw new Error('Mỗi tin nhắn tối đa 5 file đính kèm.');

    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        workflow_subject_id: input.subject.id,
        workflow_instance_id: input.subject.workflowInstanceId || null,
        subject_type: input.subject.subjectType,
        subject_id: input.subject.subjectId,
        project_id: input.subject.projectId || null,
        construction_site_id: input.subject.constructionSiteId || null,
        author_user_id: input.authorUserId,
        body,
        attachments,
        metadata: input.metadata || {},
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapComment(data);
  },
};
