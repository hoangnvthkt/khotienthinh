import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('../supabase', () => ({
  supabase: {
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
  },
}));
vi.mock('../requestRuntimeService', () => ({
  requestRuntimeService: { reserveAttachment: async () => ({ attachmentId: 'a-1', storagePath: 'x/original' }) },
}));

const { requestAttachmentService } = await import('../requestAttachmentService');
const photo = new File([new Uint8Array(1024)], 'yeu-cau.jpg', { type: 'image/jpeg' });
const httpError = (body: unknown) => ({ message: 'Edge Function returned a non-2xx status code', context: { json: async () => body } });

describe('request attachment upload errors', () => {
  beforeEach(() => invoke.mockReset());

  it('replaces the raw Edge Function message with a next step', async () => {
    invoke.mockResolvedValue({ error: httpError({ error: 'REQUEST_ATTACHMENT_PROCESSING_FAILED' }) });
    await expect(requestAttachmentService.upload('r-1', photo, 'k-1')).rejects.toThrow('Máy chủ chưa xử lý được tệp. Bấm × rồi đính kèm lại.');
  });

  it('explains files the processor rejects', async () => {
    invoke.mockResolvedValue({ error: httpError({ error: 'REQUEST_INVALID_FILE' }) });
    await expect(requestAttachmentService.upload('r-1', photo, 'k-1')).rejects.toThrow(/ảnh quá lớn/);
  });

  it('falls back when the worker died without a JSON body', async () => {
    invoke.mockResolvedValue({ error: { message: 'Edge Function returned a non-2xx status code', context: { json: async () => { throw new Error('not json'); } } } });
    await expect(requestAttachmentService.upload('r-1', photo, 'k-1')).rejects.toThrow(/Bấm × rồi đính kèm lại/);
  });
});
