import { it, expect, vi } from 'vitest';
import { createWorkAttachmentService } from '../work/workAttachmentService';
function fixture() {
  const upload = vi.fn().mockResolvedValue({ error: null });
  const client = { rpc: vi.fn().mockResolvedValue({ data: {}, error: null }), storage: { from: vi.fn().mockReturnValue({ upload }) }, functions: { invoke: vi.fn().mockResolvedValue({ data: { signedUrl: 'short-lived', expiresIn: 60 }, error: null }) } };
  return { client, upload, service: createWorkAttachmentService(client as any) };
}
it('sends kind/original retention and stable reservation key without inventing actor or object paths', async () => {
  const { client, service } = fixture();
  await service.begin('task', new File(['hello'],'note.txt',{ type: 'text/plain' }), 'evidence', true, 'stable-key');
  expect(client.rpc).toHaveBeenCalledWith('command_work_attachment', { p_command: 'begin', p_payload: { taskId: 'task', fileName: 'note.txt', mimeType: 'text/plain', sizeBytes: 5, kind: 'evidence', keepOriginal: true }, p_idempotency_key: 'stable-key' });
});
it('blocks expired upload and never overwrites an existing object', async () => {
  const { service, upload } = fixture(); const file = new File(['hello'],'note.txt',{ type: 'text/plain' });
  const reservation = { id: 'file', status: 'pending' as const, bucket: 'work-attachments' as const, path: 'server/path', expiresAt: new Date(Date.now()-1000).toISOString() };
  await expect(service.upload(reservation,file)).rejects.toThrow('WORK_ATTACHMENT_EXPIRED'); expect(upload).not.toHaveBeenCalled();
  await service.upload({ ...reservation, expiresAt: new Date(Date.now()+60000).toISOString() },file);
  expect(upload).toHaveBeenCalledWith('server/path',file,{ contentType: 'text/plain', cacheControl: '60', upsert: false });
});
it('signs through the authorized Edge boundary on each request and defaults to thumbnail', async () => {
  const { client, service } = fixture();
  await service.read('file'); await service.read('file','original');
  expect(client.functions.invoke).toHaveBeenNthCalledWith(1,'work-attachments',{ body: { action: 'read', attachmentId: 'file', variant: 'thumbnail' } });
  expect(client.functions.invoke).toHaveBeenNthCalledWith(2,'work-attachments',{ body: { action: 'read', attachmentId: 'file', variant: 'original' } });
  expect(client.storage.from).not.toHaveBeenCalled();
});
it('exposes only known Edge failure codes so the UI can recover rejected upload attempts', async () => {
 const {client,service}=fixture();
 client.functions.invoke.mockResolvedValue({data:null,error:{context:new Response(JSON.stringify({error:'WORK_ATTACHMENT_EXPIRED'}),{status:409})}} as any);
 await expect(service.finalize('file')).rejects.toThrow('WORK_ATTACHMENT_EXPIRED');
});
