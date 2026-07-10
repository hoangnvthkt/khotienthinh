import { describe, expect, it, vi } from 'vitest';
import {
  buildContractAttachmentStoragePath,
  createContractAttachmentMetadata,
  createContractAttachmentDrafts,
  sanitizeContractAttachmentFileName,
  uploadContractDraftAttachments,
  type ContractAttachmentDraft,
} from '../contractAttachmentService';

describe('contractAttachmentService helpers', () => {
  it('sanitizes Vietnamese names for Supabase storage paths while keeping extension', () => {
    expect(sanitizeContractAttachmentFileName('Ảnh nghiệm thu số 1.pdf')).toBe('Anh-nghiem-thu-so-1.pdf');
    expect(sanitizeContractAttachmentFileName('   biên bản ký!.jpg   ')).toBe('bien-ban-ky.jpg');
    expect(sanitizeContractAttachmentFileName('###')).toBe('attachment');
  });

  it('builds stable paths by contract type, id, category and timestamp', () => {
    expect(buildContractAttachmentStoragePath({
      contractType: 'supplier',
      contractId: 'contract-1',
      category: 'other',
      fileName: 'Hóa đơn VAT.pdf',
      timestamp: 1783491112584,
    })).toBe('supplier/contract-1/other/1783491112584_Hoa-don-VAT.pdf');
  });

  it('creates attachment metadata with original display name and category', () => {
    const file = new File(['hello'], 'Hồ sơ HĐ.png', { type: 'image/png' });
    const attachment = createContractAttachmentMetadata({
      id: 'att-1',
      file,
      storagePath: 'customer/contract-1/contract/1_Ho-so-HD.png',
      category: 'contract',
      uploadedAt: '2026-07-10T00:00:00.000Z',
      uploadedBy: 'Anh Hoàng',
    });

    expect(attachment).toEqual({
      id: 'att-1',
      name: 'Hồ sơ HĐ.png',
      fileName: 'Ho-so-HD.png',
      storagePath: 'customer/contract-1/contract/1_Ho-so-HD.png',
      fileType: 'image/png',
      fileSize: 5,
      category: 'contract',
      uploadedAt: '2026-07-10T00:00:00.000Z',
      uploadedBy: 'Anh Hoàng',
    });
  });

  it('defaults draft attachments to the unified related-document category', () => {
    const file = new File(['x'], 'Giấy tờ HĐ.pdf', { type: 'application/pdf' });

    expect(createContractAttachmentDrafts([file])).toEqual([
      {
        id: expect.any(String),
        file,
        category: 'other',
      },
    ]);
  });

  it('removes previously uploaded draft files when a later draft upload fails', async () => {
    const upload = vi
      .fn()
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: new Error('Storage full') });
    const remove = vi.fn().mockResolvedValue({ error: null });
    const storageClient = {
      from: vi.fn(() => ({ upload, remove })),
    };
    const drafts: ContractAttachmentDraft[] = [
      { id: 'draft-1', file: new File(['a'], 'A.pdf', { type: 'application/pdf' }), category: 'contract' },
      { id: 'draft-2', file: new File(['b'], 'B.pdf', { type: 'application/pdf' }), category: 'other' },
    ];

    await expect(uploadContractDraftAttachments({
      storageClient,
      contractType: 'customer',
      contractId: 'contract-1',
      drafts,
      uploadedBy: 'Uploader',
      now: () => new Date('2026-07-10T00:00:00.000Z'),
      idFactory: () => 'att-id',
      timestampFactory: () => 1783491112584,
    })).rejects.toThrow('Storage full');

    expect(upload).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledWith([
      'customer/contract-1/contract/1783491112584_A.pdf',
    ]);
  });
});
