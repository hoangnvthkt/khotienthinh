import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WmsTransactionAttachment } from '../../types';

const supabaseMocks = vi.hoisted(() => ({
  from: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  storageFrom: vi.fn(),
  upload: vi.fn(),
  createSignedUrl: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: {
    from: supabaseMocks.from,
    storage: { from: supabaseMocks.storageFrom },
  },
}));

import {
  WMS_ATTACHMENT_BUCKET,
  cleanupTransactionAttachmentPaths,
  getTransactionAttachmentUrl,
  uploadTransactionAttachments,
} from '../wmsTransactionAttachmentService';

const existing: WmsTransactionAttachment[] = [];

describe('wmsTransactionAttachmentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMocks.storageFrom.mockReturnValue({
      upload: supabaseMocks.upload,
      createSignedUrl: supabaseMocks.createSignedUrl,
      remove: supabaseMocks.remove,
    });
    supabaseMocks.upload.mockResolvedValue({ data: { path: 'tx-1/file' }, error: null });
    supabaseMocks.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed.example/file' }, error: null });
    supabaseMocks.remove.mockResolvedValue({ data: [], error: null });
  });

  it('uploads metadata without a public URL and creates signed URL only on demand', async () => {
    const result = await uploadTransactionAttachments({
      transactionId: 'tx-1',
      actorUserId: 'user-1',
      files: [new File(['scale'], 'can.jpg', { type: 'image/jpeg' })],
      existing,
    });

    expect(result.attachments[0]).toMatchObject({
      fileName: 'can.jpg',
      mimeType: 'image/jpeg',
      uploadedBy: 'user-1',
    });
    expect(result.attachments[0]).not.toHaveProperty('url');
    expect(supabaseMocks.createSignedUrl).not.toHaveBeenCalled();

    await getTransactionAttachmentUrl(result.attachments[0].storagePath);
    expect(supabaseMocks.createSignedUrl).toHaveBeenCalledWith(result.attachments[0].storagePath, 300);
  });

  it('cleans up paths when requested after a failed approval step', async () => {
    await cleanupTransactionAttachmentPaths(['tx-1/a.jpg', 'tx-1/b.jpg']);
    expect(supabaseMocks.storageFrom).toHaveBeenCalledWith(WMS_ATTACHMENT_BUCKET);
    expect(supabaseMocks.remove).toHaveBeenCalledWith(['tx-1/a.jpg', 'tx-1/b.jpg']);
  });
});
