import { supabase } from './supabase';

/**
 * Buckets that used to be public and are now private. Rows still store the
 * old public URL (…/storage/v1/object/public/<bucket>/<path>); these helpers
 * turn it into a short-lived signed URL at display time, so stored data does
 * not have to change. The bucket's storage RLS decides who may sign.
 */
export const PRIVATE_LEGACY_PUBLIC_BUCKETS = new Set(['checkin-photos']);

const SIGNED_URL_TTL_SECONDS = 60 * 60;
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export interface StorageObjectRef {
  bucket: string;
  path: string;
}

export const parsePrivateStorageUrl = (url: string | null | undefined): StorageObjectRef | null => {
  if (!url) return null;
  const match = /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/?#]+)\/([^?#]+)/.exec(url);
  if (!match || !PRIVATE_LEGACY_PUBLIC_BUCKETS.has(match[1])) return null;
  try {
    return { bucket: match[1], path: decodeURIComponent(match[2]) };
  } catch {
    return { bucket: match[1], path: match[2] };
  }
};

const cache = new Map<string, { url: string; expiresAt: number }>();
const pending = new Map<string, Promise<string>>();

/** Signed URL for a stored URL, or the URL unchanged when it is not private. */
export const resolveStorageUrl = async (url: string): Promise<string> => {
  const ref = parsePrivateStorageUrl(url);
  if (!ref) return url;
  const key = `${ref.bucket}/${ref.path}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) return cached.url;
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const request = (async () => {
    const { data, error } = await supabase.storage.from(ref.bucket).createSignedUrl(ref.path, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) throw error || new Error('Không tạo được đường dẫn xem ảnh.');
    cache.set(key, { url: data.signedUrl, expiresAt: Date.now() + SIGNED_URL_TTL_SECONDS * 1000 });
    return data.signedUrl;
  })();
  pending.set(key, request);
  try {
    return await request;
  } finally {
    pending.delete(key);
  }
};
