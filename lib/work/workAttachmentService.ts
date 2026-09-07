import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkAttachmentKind } from './workTypes';

export interface WorkUploadReservation { id: string; status: 'pending'; bucket: 'work-attachments'; path: string; expiresAt: string }
export type WorkAttachmentVariant = 'thumbnail' | 'display' | 'fallback' | 'original';
/** Keep the reservation and key until the UI resolves the attempt; retries of finalize
 * are safe after a lost response. Call read again after expiry; never persist signed URLs. */
export function createWorkAttachmentService(client: Pick<SupabaseClient, 'rpc' | 'storage' | 'functions'>) {
  const command = async (name: string, payload: Record<string, unknown>, key: string = crypto.randomUUID()) => {
    const result = await client.rpc('command_work_attachment', { p_command: name, p_payload: payload, p_idempotency_key: key });
    if (result.error) throw result.error;
    return result.data;
  };
  const edgeError = async (error: unknown): Promise<never> => {
    const context = (error as { context?: Response })?.context;
    if (context instanceof Response) {
      const body = await context.clone().json().catch(() => null);
      if (typeof body?.error === 'string' && /^WORK_[A-Z_]+$/.test(body.error)) throw new Error(body.error);
    }
    throw error;
  };
  return {
    async begin(taskId: string, file: File, kind: WorkAttachmentKind, keepOriginal: boolean, idempotencyKey: string): Promise<WorkUploadReservation> {
      return command('begin', { taskId, fileName: file.name, mimeType: file.type, sizeBytes: file.size, kind, keepOriginal }, idempotencyKey);
    },
    async upload(reservation: WorkUploadReservation, file: File): Promise<void> {
      if (Date.parse(reservation.expiresAt) <= Date.now()) throw new Error('WORK_ATTACHMENT_EXPIRED');
      const result = await client.storage.from('work-attachments').upload(reservation.path, file, { contentType: file.type, cacheControl: '60', upsert: false });
      if (result.error) throw result.error;
    },
    async finalize(attachmentId: string): Promise<{ id: string; status: 'ready' }> {
      const result = await client.functions.invoke('work-attachments', { body: { action: 'finalize', attachmentId } });
      if (result.error) return edgeError(result.error);
      return result.data;
    },
    async read(attachmentId: string, variant: WorkAttachmentVariant = 'thumbnail'): Promise<{ signedUrl: string; expiresIn: number }> {
      const result = await client.functions.invoke('work-attachments', { body: { action: 'read', attachmentId, variant } });
      if (result.error) return edgeError(result.error);
      return result.data;
    },
    async remove(attachmentId: string): Promise<void> { await command('delete', { attachmentId }); },
  };
}
