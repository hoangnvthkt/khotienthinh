import { describe, it, expect, vi } from 'vitest';
import { finalizeAttachment, cleanupAttachments, type Claim } from '../../supabase/functions/work-attachments/worker';
const claim: Claim = { id: 'file', status: 'processing', token: 'lease', sourcePath: 'source', outputPrefix: 'attempt/', mimeType: 'text/plain', sizeBytes: 5, keepOriginal: true };
function fixture() {
  const store = { download: vi.fn().mockResolvedValue({ data: new Blob(['hello']), error: null }), upload: vi.fn().mockResolvedValue({ error: null }), remove: vi.fn().mockResolvedValue({ error: null }) };
  const client = { rpc: vi.fn().mockResolvedValue({ data: true, error: null }), storage: { from: vi.fn().mockReturnValue(store) } };
  const process = vi.fn().mockResolvedValue([{ name: 'original', mimeType: 'text/plain', bytes: new TextEncoder().encode('hello') }]);
  return { client, store, process };
}
describe('Work attachment worker', () => {
  it('uploads immutable outputs then commits metadata with the processing lease', async () => {
    const { client, store, process } = fixture();
    expect(await finalizeAttachment(client, claim, process)).toEqual({ id: 'file', status: 'ready' });
    expect(store.upload).toHaveBeenCalledWith('attempt/original', expect.any(Uint8Array), { contentType: 'text/plain', cacheControl: '60', upsert: false });
    expect(client.rpc).toHaveBeenCalledWith('finish_work_attachment', { p_id: 'file', p_token: 'lease', p_variants: { original: { path: 'attempt/original', mimeType: 'text/plain', sizeBytes: 5 } }, p_error: null });
  });
  it('ready retries do no object operations', async () => {
    const { client, store, process } = fixture();
    await finalizeAttachment(client, { ...claim, status: 'ready' }, process);
    expect(store.download).not.toHaveBeenCalled(); expect(client.rpc).not.toHaveBeenCalled();
  });
  it('rejects invalid content and leaves durable cleanup to the queue', async () => {
    const { client, store, process } = fixture(); process.mockRejectedValue(new Error('WORK_INVALID_FILE'));
    await expect(finalizeAttachment(client, claim, process)).rejects.toThrow('WORK_INVALID_FILE');
    expect(store.upload).not.toHaveBeenCalled();
    expect(client.rpc).toHaveBeenCalledWith('finish_work_attachment', expect.objectContaining({ p_token: 'lease', p_error: 'invalid_file' }));
  });
  it('does not delete outputs after an ambiguous database commit', async () => {
    const { client, store, process } = fixture(); client.rpc.mockResolvedValue({ data: null, error: { message: 'timeout' } });
    await expect(finalizeAttachment(client, claim, process)).rejects.toThrow('WORK_FINALIZATION_FAILED');
    expect(store.remove).not.toHaveBeenCalled(); expect(client.rpc).toHaveBeenCalledTimes(1);
  });
  it('settles cleanup per object with fencing and retries transport failures', async () => {
    const { client, store } = fixture();
    client.rpc.mockResolvedValueOnce({ data: [{ path: 'a', token: 'one' }, { path: 'b', token: 'two' }], error: null });
    store.remove.mockRejectedValueOnce(new Error('network'));
    expect(await cleanupAttachments(client)).toEqual({ claimed: 2, removed: 1 });
    expect(client.rpc).toHaveBeenCalledWith('finish_work_attachment_cleanup', { p_path: 'a', p_token: 'one', p_success: false });
    expect(client.rpc).toHaveBeenCalledWith('finish_work_attachment_cleanup', { p_path: 'b', p_token: 'two', p_success: true });
  });
});
