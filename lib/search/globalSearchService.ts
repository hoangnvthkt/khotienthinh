// Gọi máy chủ tìm hồ sơ (search_global_v1). Nguồn có RLS đắt (phiếu kho, đề xuất cấp mã) đi một lượt
// riêng để kết quả nhanh hiện trước. Kết quả giữ ngắn hạn để gõ lùi / gõ lại không gọi lại.

import { supabase } from '../supabase';
import { RECORD_KINDS, type RecordKind, type ServerRecord, type ServerSearchResult } from './searchTypes';

export const HEAVY_KINDS: readonly RecordKind[] = ['wms_tx', 'material_code'];

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; value: ServerSearchResult }>();

const isRecordKind = (value: unknown): value is RecordKind => typeof value === 'string' && (RECORD_KINDS as readonly string[]).includes(value);

const parseRecord = (raw: any): ServerRecord | null => {
  if (!raw || typeof raw !== 'object' || !isRecordKind(raw.kind) || typeof raw.id !== 'string') return null;
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null);
  return {
    kind: raw.kind,
    id: raw.id,
    code: text(raw.code),
    title: text(raw.title),
    subtitle: text(raw.subtitle),
    status: text(raw.status),
    date: text(raw.date),
    projectId: text(raw.projectId),
    siteId: text(raw.siteId),
    rank: typeof raw.rank === 'number' ? raw.rank : 0,
    extra: raw.extra && typeof raw.extra === 'object' ? raw.extra : {},
  };
};

export const parseSearchResponse = (data: unknown): ServerSearchResult => {
  const body = (data && typeof data === 'object' ? data : {}) as { records?: unknown; failed?: unknown };
  const records = Array.isArray(body.records) ? body.records.map(parseRecord).filter((record): record is ServerRecord => record !== null) : [];
  const failed = Array.isArray(body.failed) ? body.failed.filter(isRecordKind) : [];
  return { records, failed };
};

export const searchRecords = async (
  terms: string[][],
  kinds: readonly RecordKind[],
  limit: number,
  signal?: AbortSignal,
): Promise<ServerSearchResult> => {
  if (kinds.length === 0) return { records: [], failed: [] };
  const key = JSON.stringify([terms, [...kinds].sort(), limit]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const { data, error } = await supabase
    .rpc('search_global_v1', { p_terms: terms, p_kinds: [...kinds], p_limit: limit })
    .abortSignal(signal as AbortSignal);
  if (error) throw error;
  const value = parseSearchResponse(data);
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 60) cache.delete(cache.keys().next().value as string);
  return value;
};

/** Xóa kết quả đã nhớ (sau khi người dùng vừa sửa dữ liệu ở màn khác thì gọi lại cho mới). */
export const clearSearchCache = () => cache.clear();
