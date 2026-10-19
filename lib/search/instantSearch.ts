// Ô hỏi Trợ lý "hai tầng" (chủ SP 19/10/2026): gõ là tìm ngay bằng cùng bộ máy với ô Tìm kiếm — khớp hồ sơ thì bấm mở, không tốn AI;
// câu hỏi thật thì gửi AI kèm sẵn các hồ sơ vừa thấy (AI khỏi phải gọi công cụ tìm). Tệp này thuần logic để vitest kiểm được.
import { HEAVY_KINDS } from './globalSearchService';
import { KIND_META, recordToEntry } from './recordPresentation';
import { prepareEntry, scoreEntry, serverTerms, type ParsedQuery } from './searchEngine';
import { RECORD_KINDS, type RecordKind, type SearchEntry, type ServerRecord } from './searchTypes';
import { foldVi } from './viText';

export const HIT_LIMIT = 5;
export const INSTANT_DEBOUNCE_MS = 150;

/** Loại hồ sơ tìm ngay: những loại người này mở được, bỏ nguồn nặng (phiếu kho, mã vật tư) để trả trong ~200 ms. */
export const instantKinds = (canOpen: (route: string) => boolean): RecordKind[] =>
  RECORD_KINDS.filter(kind => !HEAVY_KINDS.includes(kind) && KIND_META[kind].gates.some(canOpen));

const QUESTION_WORDS = /\b(bao nhieu|con lai|con bao|the nao|ra sao|khi nao|ngay nao|ai |cua ai|tai sao|vi sao|co phai|chua\b|duoc khong|dang o dau|o dau|lam sao|gi\b|nao\b|may\b|tong|so luong|ton kho|tien do|gia\b|lap\b|tao\b|de xuat|dat hang|xin nghi|nghi phep|bao cao|nho giup|ghi nho|tom tat|so sanh|giup|hay |hay\b|vui long|cho anh|cho em|cho toi)/;
/**
 * Câu chỉ là mã / tên để mở (không phải câu hỏi): ≤ 6 từ, không có từ hỏi / động từ yêu cầu, không dấu "?"
 * — Enter mở hồ sơ khớp nhất thay vì hỏi AI.
 */
export const isLookupQuery = (text: string): boolean => {
  const t = text.trim();
  if (!t || t.length > 60 || t.includes('?')) return false;
  const folded = ` ${foldVi(t).replace(/\s+/g, ' ')} `;
  if (QUESTION_WORDS.test(folded)) return false;
  return folded.trim().split(' ').length <= 6;
};

export interface RankedHit { entry: SearchEntry; record: ServerRecord; score: number; /** Khớp mọi cụm từ (hiện ngay cả khi máy chủ chưa trả câu mới). */ matchedAll: boolean }

/** Xếp hồ sơ máy chủ theo cùng thước đo của ô Tìm kiếm; giữ tối đa `limit`. */
export const rankRecordHits = (records: readonly ServerRecord[], parsed: ParsedQuery, limit = HIT_LIMIT): RankedHit[] => {
  const seen = new Set<string>();
  const out: RankedHit[] = [];
  for (const record of records) {
    const entry = recordToEntry(record);
    if (seen.has(entry.key)) continue;
    seen.add(entry.key);
    const local = scoreEntry(prepareEntry(entry), parsed);
    out.push({ entry, record, score: Math.max(local.score, 12) + record.rank / 20, matchedAll: local.matchedAll });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
};

/** Khớp đủ mạnh để Enter mở luôn: đúng mã (hạng máy chủ ≥ 80) hoặc khớp mọi cụm và bỏ xa hồ sơ thứ hai. */
export const strongTopHit = (hits: readonly RankedHit[]): RankedHit | null => {
  const [top, second] = hits;
  if (!top) return null;
  if (top.record.rank >= 80) return top;
  if (top.matchedAll && (!second || top.score >= second.score + 6)) return top;
  return null;
};

/** Hồ sơ gửi kèm câu hỏi cho cổng (chỉ các trường cần, không SĐT / email). */
export const hitsForGateway = (hits: readonly RankedHit[]): ServerRecord[] => hits.slice(0, HIT_LIMIT).map(({ record }) => {
  const { phone: _p, email: _e, ...extra } = (record.extra || {}) as Record<string, unknown>;
  return { ...record, extra };
});

/**
 * Câu hỏi dài ("nhân viên Hương còn bao nhiêu ngày phép năm"): máy chủ AND mọi từ nên tìm cả câu không ra gì. Lấy riêng "từ khóa thực thể":
 * tên viết hoa giữa câu (Hương, Thanh, SMB), mã có số / gạch (PO-272, TT006974, D16). Câu ngắn kiểu mã / tên thì dùng nguyên câu.
 */
export const entityTerms = (raw: string, parsed: ParsedQuery): string[][] => {
  if (isLookupQuery(raw)) return serverTerms(parsed);
  const tokens = raw.trim().split(/\s+/);
  const entity = new Set<string>();
  tokens.forEach((tok, i) => {
    const clean = tok.replace(/[.,;:!?()"“”]+$/g, '');
    if (!clean) return;
    // Chữ hoa kiểm bằng so sánh hoa / thường (khoảng ký tự À-Ỹ bao cả chữ thường có dấu như "được").
    const first = clean[0];
    const capital = first !== first.toLowerCase() && first === first.toUpperCase() && !(i === 0 && tokens.length > 3);
    // Mã: có cả chữ lẫn số (PCB40, D16, TT006974) hoặc có gạch (PO-272); số trơn (2 tấn, 50 cây) không phải thực thể.
    const codeLike = (/\d/.test(clean) && /[a-zA-Z]/.test(clean)) || (/-/.test(clean) && clean.length >= 4);
    if (capital || codeLike) entity.add(foldVi(clean).replace(/[^a-z0-9./-]+/g, ' ').trim());
  });
  if (!entity.size) return [];
  const groups = parsed.groups.filter(group => {
    const words = group.text.split(' ');
    return words.some(w => entity.has(w)) || entity.has(group.text);
  });
  return serverTerms({ ...parsed, groups }).slice(0, 3);
};
