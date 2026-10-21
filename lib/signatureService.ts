import { supabase } from './supabase';

/**
 * Chữ ký số nằm trong bucket riêng tư `workflow-templates` dưới `signatures/<user_id>.png`.
 * Từ 10/2026 Storage RLS chỉ cho chủ sở hữu, Admin / quản trị quy trình và người cùng xử lý
 * một phiếu đọc ảnh, nên client không dùng getPublicUrl nữa: hiển thị bằng signed URL ngắn hạn,
 * chèn vào tệp in bằng download trực tiếp (cả hai đều đi qua policy).
 */
export const SIGNATURE_BUCKET = 'workflow-templates';
export const SIGNATURE_URL_TTL_SECONDS = 10 * 60;

export const signaturePathFor = (userId: string) => `signatures/${userId}.png`;

/** Signed URL ngắn hạn cho một ảnh chữ ký; undefined khi không có tệp hoặc không có quyền. */
export const createSignatureUrl = async (
  imagePath: string,
  ttlSeconds: number = SIGNATURE_URL_TTL_SECONDS,
): Promise<string | undefined> => {
  try {
    const { data, error } = await supabase.storage.from(SIGNATURE_BUCKET).createSignedUrl(imagePath, ttlSeconds);
    if (error || !data?.signedUrl) return undefined;
    return data.signedUrl;
  } catch {
    return undefined;
  }
};

/** Ký hàng loạt; chỉ trả những tệp người dùng được đọc. Map theo image_path. */
export const createSignatureUrls = async (imagePaths: string[]): Promise<Map<string, string>> => {
  const result = new Map<string, string>();
  const unique = Array.from(new Set(imagePaths.filter((path): path is string => Boolean(path))));
  if (unique.length === 0) return result;
  try {
    const { data, error } = await supabase.storage.from(SIGNATURE_BUCKET).createSignedUrls(unique, SIGNATURE_URL_TTL_SECONDS);
    if (error || !data) return result;
    for (const entry of data) {
      if (!entry.error && entry.path && entry.signedUrl) result.set(entry.path, entry.signedUrl);
    }
  } catch {
    // Không có quyền / mất mạng: coi như không có chữ ký nào xem được.
  }
  return result;
};

/** Signed URL chữ ký của một người (tra bảng user_signatures rồi ký). */
export const loadSignatureUrlForUser = async (userId: string): Promise<string | undefined> => {
  try {
    const { data, error } = await supabase
      .from('user_signatures')
      .select('image_path')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data?.image_path) return undefined;
    return createSignatureUrl(data.image_path);
  } catch {
    return undefined;
  }
};

/** Ảnh chữ ký để chèn vào tệp in; null khi người này chưa có chữ ký hoặc mình không được xem. */
export const downloadSignatureImage = async (userId: string): Promise<ArrayBuffer | null> => {
  try {
    const { data, error } = await supabase
      .from('user_signatures')
      .select('image_path')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data?.image_path) return null;
    const { data: blob, error: downloadError } = await supabase.storage.from(SIGNATURE_BUCKET).download(data.image_path);
    if (downloadError || !blob) return null;
    return await blob.arrayBuffer();
  } catch {
    return null;
  }
};
