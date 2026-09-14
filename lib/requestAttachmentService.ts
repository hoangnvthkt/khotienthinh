import { supabase } from './supabase';
import { requestRuntimeService, type RequestAttachment } from './requestRuntimeService';

const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const documentTypes = new Set([
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
]);

export const validateRequestAttachment = (file: File) => {
  const kind: RequestAttachment['kind'] = imageTypes.has(file.type) ? 'discussion_image' : 'discussion_file';
  const limit = kind === 'discussion_image' ? 5 * 1024 * 1024 : 25 * 1024 * 1024;
  if ((!imageTypes.has(file.type) && !documentTypes.has(file.type)) || file.size < 1 || file.size > limit) {
    throw new Error(kind === 'discussion_image' ? 'Ảnh phải là JPEG, PNG hoặc WebP và không quá 5 MiB.' : 'Tệp phải là PDF, Word, Excel hoặc TXT và không quá 25 MiB.');
  }
  return kind;
};

const getSignedUrl = async (attachmentId: string, variant = 'original') => {
  const { data, error } = await supabase.functions.invoke('request-attachment-processor', { body: { action: 'read', attachmentId, variant } });
  if (error) throw error;
  const url = (data as { signedUrl?: unknown })?.signedUrl;
  if (typeof url !== 'string') throw new Error('Không thể tạo liên kết tải tệp.');
  return url;
};

export const requestAttachmentService = {
  async upload(requestId: string, file: File, idempotencyKey: string): Promise<string> {
    const kind = validateRequestAttachment(file);
    const reservation = await requestRuntimeService.reserveAttachment({
      requestId, fileName: file.name, mimeType: file.type, sizeBytes: file.size, kind,
    }, idempotencyKey);
    const { error: uploadError } = await supabase.storage.from('request-attachments').upload(reservation.storagePath, file, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;
    const { error: processError } = await supabase.functions.invoke('request-attachment-processor', { body: { attachmentId: reservation.attachmentId } });
    if (processError) throw processError;
    return reservation.attachmentId;
  },
  async open(attachmentId: string, variant = 'original') {
    const target = window.open('about:blank', '_blank');
    try {
      const url = await getSignedUrl(attachmentId, variant);
      if (target) {
        target.opener = null;
        target.location.href = url;
      } else {
        window.location.assign(url);
      }
    } catch (error) {
      target?.close();
      throw error;
    }
  },
  async signedUrl(attachmentId: string, variant = 'original') {
    return getSignedUrl(attachmentId, variant);
  },
};
