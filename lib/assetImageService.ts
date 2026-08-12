import { supabase } from './supabase';
import { compressImageWithinLimit } from './vehicleBookingService';

const ASSET_IMAGE_BUCKET = 'asset-images';
const MAX_ASSET_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_ASSET_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type AssetImageValidationError = 'INVALID_ASSET_IMAGE_TYPE' | 'ASSET_IMAGE_TOO_LARGE';

export function validateAssetImageFile(file: File): AssetImageValidationError | null {
  if (!ALLOWED_ASSET_IMAGE_TYPES.has(file.type)) return 'INVALID_ASSET_IMAGE_TYPE';
  return null;
}

export async function uploadAssetImage(file: File, assetId: string): Promise<{ path: string; url: string }> {
  const validationError = validateAssetImageFile(file);
  if (validationError) throw new Error(validationError);

  const compressed = await compressImageWithinLimit(file, 5);
  if (compressed.size > MAX_ASSET_IMAGE_BYTES) throw new Error('ASSET_IMAGE_TOO_LARGE');
  const safeAssetId = assetId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const path = `assets/${safeAssetId}/${Date.now()}_${crypto.randomUUID()}.jpg`;
  const bucket = supabase.storage.from(ASSET_IMAGE_BUCKET);
  const { data, error } = await bucket.upload(path, compressed, {
    cacheControl: '31536000',
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (error) throw error;

  const { data: publicUrlData } = bucket.getPublicUrl(data.path);
  return { path: data.path, url: publicUrlData.publicUrl };
}

export function assetImagePathFromUrl(url: string): string | null {
  const marker = '/object/public/asset-images/';
  const markerIndex = url.indexOf(marker);
  if (markerIndex < 0) return null;
  const path = url.slice(markerIndex + marker.length).split('?')[0];
  return path || null;
}

export async function deleteAssetImage(url?: string | null): Promise<void> {
  if (!url) return;
  const path = assetImagePathFromUrl(url);
  if (!path) return;
  const { error } = await supabase.storage.from(ASSET_IMAGE_BUCKET).remove([path]);
  if (error) throw error;
}
