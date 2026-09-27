import { describe, expect, it } from 'vitest';
import { parsePrivateStorageUrl } from '../storageSignedUrl';

describe('parsePrivateStorageUrl', () => {
  const base = 'https://example.supabase.co/storage/v1/object';

  it('recognises stored public URLs of buckets that are now private', () => {
    expect(parsePrivateStorageUrl(`${base}/public/checkin-photos/emp-1/2026-09-27_check_in_1.jpg`))
      .toEqual({ bucket: 'checkin-photos', path: 'emp-1/2026-09-27_check_in_1.jpg' });
    expect(parsePrivateStorageUrl(`${base}/public/checkin-photos/emp%201/a.jpg?t=1`))
      .toEqual({ bucket: 'checkin-photos', path: 'emp 1/a.jpg' });
  });

  it('covers the project buckets and never re-signs signed URLs', () => {
    expect(parsePrivateStorageUrl(`${base}/public/project-attachments/tx/1.xlsx`))
      .toEqual({ bucket: 'project-attachments', path: 'tx/1.xlsx' });
    expect(parsePrivateStorageUrl(`${base}/public/project-files/p1/a.pdf`))
      .toEqual({ bucket: 'project-files', path: 'p1/a.pdf' });
    expect(parsePrivateStorageUrl(`${base}/sign/project-files/p1/a.pdf?token=abc`)).toBeNull();
  });

  it('leaves other URLs alone', () => {
    expect(parsePrivateStorageUrl(`${base}/public/avatars/u1.png`)).toBeNull();
    expect(parsePrivateStorageUrl('https://example.com/photo.jpg')).toBeNull();
    expect(parsePrivateStorageUrl('')).toBeNull();
    expect(parsePrivateStorageUrl(null)).toBeNull();
  });
});
