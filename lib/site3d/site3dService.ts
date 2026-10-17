import { supabase } from '../supabase';
import { parseSite3dAccess, parseSite3dResult, type Site3dAccess, type Site3dResult } from './site3dData';

// Công trường 3D: một RPC (vcc_site3d_v1) cho quyền + số liệu sống; mô hình thiết kế nằm ở kho riêng tư site-models
// (<project_id>/architecture.glb | structure.glb), người có quyền tải qua link ký 1 giờ, chỉ Admin tải lên. Khớp migration 20261017220000.

export type SiteModelKind = 'architecture' | 'structure';
export interface SiteModelFile { kind: SiteModelKind; path: string; size: number | null; updatedAt: string | null }
export type SiteModels = Partial<Record<SiteModelKind, SiteModelFile>>;

export interface Site3dHooks {
  loadAccess: () => Promise<Site3dAccess>;
  loadSite: (projectCode: string) => Promise<Site3dResult>;
  /** Mô hình đã tải lên của dự án; không có hàm = công trường chỉ dựng theo hạng mục. */
  listModels?: (projectId: string) => Promise<SiteModels>;
  /** Nội dung GLB; onProgress 0..1. */
  fetchModel?: (file: SiteModelFile, onProgress?: (fraction: number) => void) => Promise<ArrayBuffer>;
  /** Admin tải lên / thay mô hình (ghi đè cùng đường dẫn). */
  uploadModel?: (projectId: string, kind: SiteModelKind, file: File) => Promise<void>;
}

export const SITE_MODEL_BUCKET = 'site-models';
export const SITE_MODEL_LABEL: Record<SiteModelKind, string> = { architecture: 'Mô hình thiết kế (SketchUp)', structure: 'Kết cấu thép (Tekla)' };
const MAX_MODEL_BYTES = 60 * 1024 * 1024;

export async function fetchSite3dAccess(): Promise<Site3dAccess> {
  const { data, error } = await supabase.rpc('vcc_site3d_v1', { p_project_code: null });
  if (error) throw new Error(error.message || 'Không kiểm được quyền xem công trường 3D.');
  return parseSite3dAccess(data);
}

export async function fetchSite3d(projectCode: string): Promise<Site3dResult> {
  const { data, error } = await supabase.rpc('vcc_site3d_v1', { p_project_code: projectCode });
  if (error) throw new Error(error.message || 'Không tải được số liệu công trường.');
  return parseSite3dResult(data);
}

export async function listSiteModels(projectId: string): Promise<SiteModels> {
  const { data, error } = await supabase.storage.from(SITE_MODEL_BUCKET).list(projectId, { limit: 20 });
  if (error) throw new Error(error.message || 'Không đọc được danh sách mô hình.');
  const out: SiteModels = {};
  for (const row of data || []) {
    const kind = row.name === 'architecture.glb' ? 'architecture' : row.name === 'structure.glb' ? 'structure' : null;
    if (!kind) continue;
    const size = Number((row.metadata as { size?: number } | null)?.size);
    out[kind] = { kind, path: `${projectId}/${row.name}`, size: Number.isFinite(size) ? size : null, updatedAt: row.updated_at || row.created_at || null };
  }
  return out;
}

// Giữ trong bộ nhớ của phiên (đổi công trường / mở lại tab không tải lại 15 MB); không lưu xuống máy:
// máy dùng chung đăng xuất là không còn bản thiết kế.
const memory = new Map<string, Promise<ArrayBuffer>>();

export function fetchSiteModel(file: SiteModelFile, onProgress?: (fraction: number) => void): Promise<ArrayBuffer> {
  const key = `${file.path}@${file.updatedAt || ''}`;
  const cached = memory.get(key);
  if (cached) { onProgress?.(1); return cached; }
  const job = (async () => {
    const { data, error } = await supabase.storage.from(SITE_MODEL_BUCKET).createSignedUrl(file.path, 3600);
    if (error || !data?.signedUrl) throw new Error(error?.message || 'Không mở được mô hình.');
    const response = await fetch(data.signedUrl);
    if (!response.ok) throw new Error(`Không tải được mô hình (${response.status}).`);
    const total = Number(response.headers.get('content-length')) || file.size || 0;
    if (!response.body || !total) { const buffer = await response.arrayBuffer(); onProgress?.(1); return buffer; }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); loaded += value.length;
      onProgress?.(Math.min(1, loaded / total));
    }
    const out = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
    return out.buffer;
  })();
  memory.set(key, job);
  job.catch(() => memory.delete(key));
  return job;
}

export async function uploadSiteModel(projectId: string, kind: SiteModelKind, file: File): Promise<void> {
  if (!/\.glb$/i.test(file.name)) throw new Error('Chọn tệp .glb (xuất từ SketchUp / Tekla qua bộ chuyển đổi).');
  if (file.size > MAX_MODEL_BYTES) throw new Error('Tệp lớn hơn 60 MB. Nén lại bằng bộ chuyển đổi trước khi tải lên.');
  const { error } = await supabase.storage.from(SITE_MODEL_BUCKET)
    .upload(`${projectId}/${kind}.glb`, file, { upsert: true, contentType: 'model/gltf-binary', cacheControl: '3600' });
  if (error) throw new Error(error.message || 'Không tải lên được mô hình.');
  for (const key of [...memory.keys()]) if (key.startsWith(`${projectId}/${kind}.glb@`)) memory.delete(key);
}

export const site3dHooks: Site3dHooks = {
  loadAccess: fetchSite3dAccess,
  loadSite: fetchSite3d,
  listModels: listSiteModels,
  fetchModel: fetchSiteModel,
  uploadModel: uploadSiteModel,
};
