import { beforeEach, describe, expect, it, vi } from 'vitest';
import { safetyService } from '../safetyService';

const { upload, createSignedUrl } = vi.hoisted(() => ({
  upload: vi.fn(),
  createSignedUrl: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: {
    storage: {
      from: () => ({ upload, createSignedUrl }),
    },
  },
}));

describe('Safety attachment upload scope', () => {
  beforeEach(() => {
    upload.mockReset().mockResolvedValue({ error: null });
    createSignedUrl.mockReset().mockResolvedValue({ data: { signedUrl: 'https://signed.example/file' } });
  });

  it('puts the construction site in the storage path', async () => {
    await safetyService.uploadAttachment({
      projectId: 'project-1',
      constructionSiteId: 'site-1',
      recordType: 'inspections',
      recordId: 'draft-1',
      file: new File(['photo'], 'hinh hien truong.jpg', { type: 'image/jpeg' }),
    });

    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(/^project-1\/site-1\/inspections\/draft-1\/\d+-hinh-hien-truong\.jpg$/),
      expect.any(File),
      expect.objectContaining({ upsert: false, contentType: 'image/jpeg' }),
    );
  });

  it('does not upload without a construction site', async () => {
    await expect(safetyService.uploadAttachment({
      projectId: 'project-1',
      constructionSiteId: null,
      recordType: 'inspections',
      recordId: 'draft-1',
      file: new File(['photo'], 'photo.jpg'),
    })).rejects.toThrow('Vui lòng chọn công trường');
    expect(upload).not.toHaveBeenCalled();
  });
});
