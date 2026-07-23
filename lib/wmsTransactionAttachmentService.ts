import type { WmsTransactionAttachment } from '../types';
import { supabase } from './supabase';

export const WMS_ATTACHMENT_BUCKET = 'wms-transaction-attachments';
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

const safeFileName = (fileName: string): string => {
  const normalized = fileName.trim().replace(/[^a-zA-Z0-9._-]+/g, '_');
  return normalized || 'file';
};

const assertFile = (file: File): void => {
  if (!file.name.trim()) throw new Error('Tệp đính kèm phải có tên.');
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Tệp ${file.name} vượt quá giới hạn 50 MB.`);
  }
};

export const uploadTransactionAttachments = async (input: {
  transactionId: string;
  actorUserId: string;
  files: File[];
  existing: WmsTransactionAttachment[];
}): Promise<{ attachments: WmsTransactionAttachment[]; uploadedPaths: string[] }> => {
  const attachments = [...input.existing];
  const uploadedPaths: string[] = [];

  try {
    for (const file of input.files) {
      assertFile(file);
      const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const storagePath = `${input.transactionId}/${id}-${safeFileName(file.name)}`;
      const { error } = await supabase.storage
        .from(WMS_ATTACHMENT_BUCKET)
        .upload(storagePath, file, { upsert: false, contentType: file.type || 'application/octet-stream' });
      if (error) throw error;

      uploadedPaths.push(storagePath);
      attachments.push({
        id,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileSize: file.size,
        storagePath,
        uploadedAt: new Date().toISOString(),
        uploadedBy: input.actorUserId,
      });
    }
  } catch (error) {
    if (uploadedPaths.length > 0) {
      try {
        await cleanupTransactionAttachmentPaths(uploadedPaths);
      } catch (cleanupError) {
        console.warn('Cannot clean up failed WMS attachment upload', cleanupError);
      }
    }
    throw error;
  }

  return { attachments, uploadedPaths };
};

export const persistTransactionAttachments = async (
  transactionId: string,
  attachments: WmsTransactionAttachment[],
): Promise<void> => {
  const { error } = await supabase
    .from('transactions')
    .update({ attachments })
    .eq('id', transactionId);
  if (error) throw error;
};

export const getTransactionAttachmentUrl = async (storagePath: string): Promise<string> => {
  const { data, error } = await supabase.storage
    .from(WMS_ATTACHMENT_BUCKET)
    .createSignedUrl(storagePath, 300);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error('Không tạo được đường dẫn tệp đính kèm.');
  return data.signedUrl;
};

export const cleanupTransactionAttachmentPaths = async (storagePaths: string[]): Promise<void> => {
  const paths = Array.from(new Set(storagePaths.filter(Boolean)));
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(WMS_ATTACHMENT_BUCKET).remove(paths);
  if (error) throw error;
};
