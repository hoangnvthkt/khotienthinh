import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  upload: vi.fn(),
  remove: vi.fn(),
  getPublicUrl: vi.fn(),
  from: vi.fn(),
}));
const compression = vi.hoisted(() => ({ compress: vi.fn(async (file: File) => file as Blob) }));

vi.mock('../supabase', () => ({
  supabase: { storage: { from: storage.from } },
}));

vi.mock('../vehicleBookingService', () => ({
  compressImageWithinLimit: compression.compress,
}));

import {
  deleteAssetImage,
  uploadAssetImage,
  validateAssetImageFile,
} from '../assetImageService';

describe('asset image service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    compression.compress.mockImplementation(async (file: File) => file);
    storage.from.mockReturnValue({
      upload: storage.upload,
      remove: storage.remove,
      getPublicUrl: storage.getPublicUrl,
    });
    storage.upload.mockResolvedValue({ data: { path: 'assets/asset-1/photo.jpg' }, error: null });
    storage.remove.mockResolvedValue({ data: [], error: null });
    storage.getPublicUrl.mockReturnValue({ data: { publicUrl: 'https://cdn.test/asset-images/assets/asset-1/photo.jpg' } });
  });

  it('accepts only JPEG, PNG, or WebP before compression', () => {
    expect(validateAssetImageFile(new File(['ok'], 'car.png', { type: 'image/png' }))).toBeNull();
    expect(validateAssetImageFile(new File(['bad'], 'car.gif', { type: 'image/gif' }))).toBe('INVALID_ASSET_IMAGE_TYPE');
    const oversized = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'car.jpg', { type: 'image/jpeg' });
    expect(validateAssetImageFile(oversized)).toBeNull();
  });

  it('rejects an object that still exceeds 5 MB after compression', async () => {
    const oversized = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'car.jpg', { type: 'image/jpeg' });
    compression.compress.mockResolvedValueOnce(oversized);

    await expect(uploadAssetImage(oversized, 'asset-1')).rejects.toThrow('ASSET_IMAGE_TOO_LARGE');
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('uploads under the immutable asset namespace and returns a public URL', async () => {
    const result = await uploadAssetImage(new File(['ok'], 'car.png', { type: 'image/png' }), 'asset-1');

    expect(storage.from).toHaveBeenCalledWith('asset-images');
    expect(storage.upload.mock.calls[0][0]).toMatch(/^assets\/asset-1\/.+\.jpg$/);
    expect(result.url).toContain('/asset-images/assets/asset-1/photo.jpg');
  });

  it('deletes only URLs belonging to the asset-images bucket', async () => {
    await deleteAssetImage('https://cdn.test/storage/v1/object/public/asset-images/assets/asset-1/old.jpg');
    await deleteAssetImage('https://outside.test/car.jpg');

    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(storage.remove).toHaveBeenCalledWith(['assets/asset-1/old.jpg']);
  });
});
