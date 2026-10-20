import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  storageFrom: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: {
    from: mocks.from,
    storage: { from: mocks.storageFrom },
  },
}));

import {
  SIGNATURE_URL_TTL_SECONDS,
  createSignatureUrls,
  downloadSignatureImage,
  loadSignatureUrlForUser,
  signaturePathFor,
} from '../signatureService';

const tableQuery = (response: { data?: any; error?: any }) => {
  const api: any = {
    select: vi.fn(() => api),
    eq: vi.fn(() => api),
    maybeSingle: vi.fn(async () => response),
  };
  return api;
};

describe('signatureService', () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.storageFrom.mockReset();
  });

  it('đặt tệp chữ ký theo quy ước signatures/<user_id>.png', () => {
    expect(signaturePathFor('u-1')).toBe('signatures/u-1.png');
  });

  it('ký hàng loạt và bỏ qua tệp Storage RLS không cho đọc', async () => {
    const createSignedUrls = vi.fn(async () => ({
      data: [
        { path: 'signatures/a.png', signedUrl: 'https://x/sign/a?token=1', error: null },
        { path: null, signedUrl: '', error: 'Object not found' },
      ],
      error: null,
    }));
    mocks.storageFrom.mockReturnValue({ createSignedUrls });

    const urls = await createSignatureUrls(['signatures/a.png', 'signatures/b.png', 'signatures/a.png']);

    expect(mocks.storageFrom).toHaveBeenCalledWith('workflow-templates');
    expect(createSignedUrls).toHaveBeenCalledWith(['signatures/a.png', 'signatures/b.png'], SIGNATURE_URL_TTL_SECONDS);
    expect(urls.get('signatures/a.png')).toBe('https://x/sign/a?token=1');
    expect(urls.has('signatures/b.png')).toBe(false);
  });

  it('không gọi Storage khi không có đường dẫn nào', async () => {
    expect((await createSignatureUrls([])).size).toBe(0);
    expect(mocks.storageFrom).not.toHaveBeenCalled();
  });

  it('trả signed URL ngắn hạn cho chữ ký của một người', async () => {
    mocks.from.mockReturnValue(tableQuery({ data: { image_path: 'signatures/u-1.png' }, error: null }));
    const createSignedUrl = vi.fn(async () => ({ data: { signedUrl: 'https://x/sign/u-1?token=t' }, error: null }));
    mocks.storageFrom.mockReturnValue({ createSignedUrl });

    await expect(loadSignatureUrlForUser('u-1')).resolves.toBe('https://x/sign/u-1?token=t');
    expect(mocks.from).toHaveBeenCalledWith('user_signatures');
    expect(createSignedUrl).toHaveBeenCalledWith('signatures/u-1.png', SIGNATURE_URL_TTL_SECONDS);
  });

  it('trả undefined / null khi RLS không trả dòng chữ ký', async () => {
    mocks.from.mockReturnValue(tableQuery({ data: null, error: null }));

    await expect(loadSignatureUrlForUser('u-2')).resolves.toBeUndefined();
    await expect(downloadSignatureImage('u-2')).resolves.toBeNull();
    expect(mocks.storageFrom).not.toHaveBeenCalled();
  });

  it('tải ảnh chữ ký qua Storage để chèn vào tệp in', async () => {
    mocks.from.mockReturnValue(tableQuery({ data: { image_path: 'signatures/u-3.png' }, error: null }));
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const download = vi.fn(async () => ({ data: { arrayBuffer: async () => bytes }, error: null }));
    mocks.storageFrom.mockReturnValue({ download });

    await expect(downloadSignatureImage('u-3')).resolves.toBe(bytes);
    expect(download).toHaveBeenCalledWith('signatures/u-3.png');
  });

  it('coi lỗi tải (không có quyền) là không có chữ ký, không ném lỗi', async () => {
    mocks.from.mockReturnValue(tableQuery({ data: { image_path: 'signatures/u-4.png' }, error: null }));
    mocks.storageFrom.mockReturnValue({ download: vi.fn(async () => ({ data: null, error: { message: 'denied' } })) });

    await expect(downloadSignatureImage('u-4')).resolves.toBeNull();
  });
});
