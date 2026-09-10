// Structural boundary makes upload/finalize/cleanup failures testable without live users.
export interface AttachmentClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
  storage: { from(bucket: string): {
    download(path: string): Promise<{ data: Blob | null; error: unknown }>;
    upload(path: string, data: Uint8Array, options: { contentType: string; cacheControl: string; upsert: boolean }): Promise<{ error: unknown }>;
    remove(paths: string[]): Promise<{ error: unknown }>;
  } };
}
export interface Claim { id: string; status: string; token: string; sourcePath: string; outputPrefix: string; mimeType: string; sizeBytes: number; keepOriginal: boolean }
export type FileProcessor = (bytes: Uint8Array, mime: string, size: number, keep: boolean) => Promise<{ name: string; bytes: Uint8Array; mimeType: string; width?: number; height?: number }[]>;
export async function finalizeAttachment(admin: AttachmentClient, claim: Claim, process: FileProcessor) {
  if (claim.status === 'ready') return { id: claim.id, status: 'ready' };
  const storage = admin.storage.from('work-attachments');
  let variants: Record<string, unknown>;
  try {
    const source = await storage.download(claim.sourcePath);
    if (source.error || !source.data) throw new Error('WORK_SOURCE_UNAVAILABLE');
    const outputs = await process(new Uint8Array(await source.data.arrayBuffer()), claim.mimeType, claim.sizeBytes, claim.keepOriginal);
    variants = {};
    for (const output of outputs) {
      const path = claim.outputPrefix + output.name;
      if (!['display.webp','thumbnail.webp','fallback.png','original'].includes(output.name)) throw new Error('WORK_INVALID_OUTPUT');
      const result = await storage.upload(path, output.bytes, { contentType: output.mimeType, cacheControl: '60', upsert: false });
      if (result.error) throw new Error('WORK_OUTPUT_UPLOAD_FAILED');
      const key = output.name.split('.')[0];
      variants[key] = { path, mimeType: output.mimeType, sizeBytes: output.bytes.length, ...(output.width ? { width: output.width, height: output.height } : {}) };
    }
  } catch (error) {
    // All source/output paths already have durable cleanup jobs, including partial writes.
    await admin.rpc('finish_work_attachment', { p_id: claim.id, p_token: claim.token, p_variants: {}, p_error: error instanceof Error && error.message === 'WORK_INVALID_FILE' ? 'invalid_file' : 'processing_failed' });
    throw error;
  }
  // An ambiguous DB response must NOT delete objects: the ready transaction may have committed.
  const finished = await admin.rpc('finish_work_attachment', { p_id: claim.id, p_token: claim.token, p_variants: variants, p_error: null });
  if (finished.error || finished.data !== true) throw new Error('WORK_FINALIZATION_FAILED');
  return { id: claim.id, status: 'ready' };
}
export async function cleanupAttachments(admin: AttachmentClient) {
  const claimed = await admin.rpc('claim_work_attachment_cleanup', { p_limit: 30 });
  if (claimed.error) throw new Error('WORK_CLEANUP_CLAIM_FAILED');
  const jobs = claimed.data as { path: string; token: string }[];
  let removed = 0;
  for (const job of jobs) {
    let success = false;
    try { success = !(await admin.storage.from('work-attachments').remove([job.path])).error; } catch { /* fenced retry */ }
    const finished = await admin.rpc('finish_work_attachment_cleanup', { p_path: job.path, p_token: job.token, p_success: success });
    if (finished.error) throw new Error('WORK_CLEANUP_FINISH_FAILED');
    if (success && finished.data === true) removed++;
  }
  return { claimed: jobs.length, removed };
}
