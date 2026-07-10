import { supabase } from './supabase';
import type { ContractAttachment } from '../types';

export const CONTRACT_ATTACHMENT_BUCKET = 'contract-files';
export const CONTRACT_ATTACHMENT_ACCEPT = '.pdf,.doc,.docx,.jpg,.jpeg,.png,.xlsx,.xls';

export type ContractAttachmentOwnerType = 'customer' | 'supplier' | 'subcontractor';
export type ContractAttachmentCategory = NonNullable<ContractAttachment['category']>;

export interface ContractAttachmentDraft {
  id: string;
  file: File;
  category: ContractAttachmentCategory;
}

interface ContractStorageClient {
  from(bucket: string): {
    upload(path: string, file: File, options?: { contentType?: string; upsert?: boolean }): Promise<{ error: any }>;
    remove(paths: string[]): Promise<{ error: any }>;
  };
}

interface UploadContractAttachmentInput {
  storageClient?: ContractStorageClient;
  contractType: ContractAttachmentOwnerType;
  contractId: string;
  file: File;
  category?: ContractAttachmentCategory;
  uploadedBy: string;
  now?: () => Date;
  idFactory?: () => string;
  timestampFactory?: () => number;
}

interface UploadContractDraftAttachmentsInput extends Omit<UploadContractAttachmentInput, 'file' | 'category'> {
  drafts: ContractAttachmentDraft[];
}

export const sanitizeContractAttachmentFileName = (name: string) => {
  const cleaned = name
    .trim()
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+\./g, '.')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
  return cleaned || 'attachment';
};

export const buildContractAttachmentStoragePath = (input: {
  contractType: ContractAttachmentOwnerType;
  contractId: string;
  category?: ContractAttachmentCategory;
  fileName: string;
  timestamp?: number;
}) => {
  const category = input.category || 'other';
  const timestamp = input.timestamp ?? Date.now();
  const safeName = sanitizeContractAttachmentFileName(input.fileName);
  return `${input.contractType}/${input.contractId}/${category}/${timestamp}_${safeName}`;
};

export const createContractAttachmentMetadata = (input: {
  id: string;
  file: File;
  storagePath: string;
  category?: ContractAttachmentCategory;
  uploadedAt: string;
  uploadedBy: string;
}): ContractAttachment => {
  const safeName = sanitizeContractAttachmentFileName(input.file.name);
  return {
    id: input.id,
    name: input.file.name || safeName,
    fileName: safeName,
    storagePath: input.storagePath,
    fileType: input.file.type || safeName.split('.').pop() || '',
    fileSize: input.file.size,
    category: input.category,
    uploadedAt: input.uploadedAt,
    uploadedBy: input.uploadedBy,
  };
};

export const createContractAttachmentDrafts = (
  files: File[] | FileList,
  category: ContractAttachmentCategory = 'other',
): ContractAttachmentDraft[] =>
  Array.from(files).map(file => ({
    id: crypto.randomUUID(),
    file,
    category,
  }));

export const uploadContractAttachment = async (input: UploadContractAttachmentInput): Promise<ContractAttachment> => {
  if (!input.contractId) throw new Error('Thiếu hợp đồng để upload file.');
  if (!input.file) throw new Error('Thiếu file đính kèm.');

  const storageClient = input.storageClient || supabase.storage;
  const uploadedAt = (input.now || (() => new Date()))().toISOString();
  const attachmentId = input.idFactory?.() || crypto.randomUUID();
  const storagePath = buildContractAttachmentStoragePath({
    contractType: input.contractType,
    contractId: input.contractId,
    category: input.category,
    fileName: input.file.name,
    timestamp: input.timestampFactory?.() ?? Date.now(),
  });

  const { error } = await storageClient.from(CONTRACT_ATTACHMENT_BUCKET).upload(storagePath, input.file, {
    contentType: input.file.type || undefined,
    upsert: false,
  });
  if (error) throw error;

  return createContractAttachmentMetadata({
    id: attachmentId,
    file: input.file,
    storagePath,
    category: input.category,
    uploadedAt,
    uploadedBy: input.uploadedBy,
  });
};

export const removeContractAttachmentPaths = async (
  storagePaths: string[],
  storageClient: ContractStorageClient = supabase.storage,
) => {
  const paths = storagePaths.filter(Boolean);
  if (paths.length === 0) return;
  await storageClient.from(CONTRACT_ATTACHMENT_BUCKET).remove(paths);
};

export const uploadContractDraftAttachments = async (
  input: UploadContractDraftAttachmentsInput,
): Promise<ContractAttachment[]> => {
  const uploaded: ContractAttachment[] = [];
  try {
    for (const draft of input.drafts) {
      const attachment = await uploadContractAttachment({
        ...input,
        file: draft.file,
        category: draft.category,
      });
      uploaded.push(attachment);
    }
    return uploaded;
  } catch (error) {
    await removeContractAttachmentPaths(
      uploaded.map(attachment => attachment.storagePath),
      input.storageClient,
    );
    throw error;
  }
};
