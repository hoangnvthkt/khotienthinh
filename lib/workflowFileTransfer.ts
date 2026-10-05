import { saveAs } from 'file-saver';
import { supabase } from './supabase';
import type { WorkflowFileValue } from './workflowFiles';

export const WORKFLOW_ATTACHMENT_BUCKET = 'workflow-attachments';
export const MAX_WORKFLOW_FILE_BYTES = 25 * 1024 * 1024;

const sanitizeStorageFileName = (name: string) =>
  name.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'attachment';

export const hasDownloadableFile = (file?: Pick<WorkflowFileValue, 'data' | 'storagePath'> | null): boolean =>
  Boolean(file?.data || file?.storagePath);

export const uploadWorkflowAttachment = async (file: File): Promise<WorkflowFileValue> => {
  if (file.size > MAX_WORKFLOW_FILE_BYTES) throw new Error(`"${file.name}" lớn hơn 25MB.`);
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const storagePath = `${new Date().getFullYear()}/${id}-${sanitizeStorageFileName(file.name)}`;
  const { error } = await supabase.storage.from(WORKFLOW_ATTACHMENT_BUCKET).upload(storagePath, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (error) throw error;
  return {
    id,
    fileName: file.name,
    fileType: file.type || 'application/octet-stream',
    fileSize: file.size,
    storageBucket: WORKFLOW_ATTACHMENT_BUCKET,
    storagePath,
  };
};

const base64ToBlob = (base64: string, mimeType: string): Blob => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType || 'application/octet-stream' });
};

export const fetchWorkflowFileBlob = async (file: WorkflowFileValue): Promise<Blob> => {
  if (file.data) return base64ToBlob(file.data, file.fileType || file.mimeType || '');
  if (!file.storagePath) throw new Error('File cũ không còn dữ liệu.');
  const { data, error } = await supabase.storage.from(file.storageBucket || WORKFLOW_ATTACHMENT_BUCKET).download(file.storagePath);
  if (error || !data) throw error || new Error('Không tải được file.');
  return data;
};

export const downloadWorkflowFile = async (file: WorkflowFileValue): Promise<void> => {
  try {
    saveAs(await fetchWorkflowFileBlob(file), file.fileName || 'attachment');
  } catch (error) {
    console.error('downloadWorkflowFile error:', error);
    alert('Không tải được file đính kèm. Vui lòng thử lại.');
  }
};
