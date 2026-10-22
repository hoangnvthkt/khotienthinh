// Sổ tay Vioo (B3, chủ SP 22/10/2026): công cụ so_tay trả lời "làm sao để…" từ danh sách mục sinh sẵn (handbook.generated.ts: docs/so-tay,
// hướng dẫn Dự án, danh mục màn hình / thao tác trong mã). Khớp bằng từ khóa không dấu, không gọi model, không đọc dữ liệu nghiệp vụ.
// Không dùng API Deno để vitest kiểm thử được.
import { HANDBOOK, type HandbookEntry } from './handbook.generated.ts';

export const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
/** Từ không mang nghĩa khi tìm mục ("làm sao để", "anh muốn", "ở đâu"…). */
const STOP = new Set(['lam', 'sao', 'de', 'the', 'nao', 'cach', 'o', 'dau', 'toi', 'anh', 'em', 'chi', 'giup', 'voi', 'nhu', 'la', 'cua', 'cho', 'va', 'bi', 'duoc', 'khong', 'co', 'muon', 'can', 'thi', 'ma', 'a', 'oi', 'nhe', 'nha', 'ban', 'minh', 'huong', 'dan', 'huongdan', 'phan', 'mem', 'vioo', 'app', 'thao', 'tac', 'nay', 'kia', 'do', 'gi', 'vay', 'roi', 'hay', 'hoac', 'tren', 'trong', 'bang', 'tu', 'den', 'mot', 'cai', 'viec', 'xin', 'hoi', 'biet', 'xem', 'lai', 'moi', 'thu']);
export const tokens = (q: string) => stripAccents(q).replace(/[^a-z0-9\s/-]+/g, ' ').split(/\s+/).map(t => t.trim()).filter(t => t.length >= 2 && !STOP.has(t));

export interface HandbookHit { entry: HandbookEntry; score: number }
export interface ScoreDetail { score: number; strong: number }
/** Điểm = từ khớp tiêu đề ×4, từ khóa ×3, thân ×1; cụm 2 từ liền nhau trong từ khóa / tiêu đề ×3 thêm. strong = số từ khớp tiêu đề / từ khóa. */
export const scoreDetail = (entry: HandbookEntry, qTokens: string[]): ScoreDetail => {
  if (!qTokens.length) return { score: 0, strong: 0 };
  const title = stripAccents(entry.title); const kw = ` ${entry.keywords} `; const body = stripAccents(entry.body);
  let score = 0; let strong = 0;
  for (const t of qTokens) {
    if (title.includes(t)) { score += 4; strong += 1; }
    else if (kw.includes(` ${t} `) || kw.includes(` ${t}`)) { score += 3; strong += 1; }
    else if (body.includes(t)) score += 1;
  }
  for (let i = 0; i + 1 < qTokens.length; i++) if (kw.includes(`${qTokens[i]} ${qTokens[i + 1]}`) || title.includes(`${qTokens[i]} ${qTokens[i + 1]}`)) score += 3;
  if (!strong) return { score: 0, strong: 0 };
  // Mục viết tay (docs) ưu tiên hơn mục sinh từ danh mục khi điểm bằng nhau.
  return { score: score + (entry.source === 'docs' ? 0.5 : entry.source === 'catalog' ? 0 : 0.25), strong };
};
export const scoreEntry = (entry: HandbookEntry, qTokens: string[]): number => scoreDetail(entry, qTokens).score;

/**
 * Mục khớp: ≥ 1 từ mạnh; câu ≥ 3 từ thì ít nhất nửa số từ phải khớp mạnh (tránh "đổi mật khẩu wifi văn phòng" dính "Văn phòng phẩm").
 * Cùng điểm: tiêu đề ngắn hơn trước (khớp sát hơn), rồi theo id. Chỉ giữ mục đủ gần mục đầu.
 */
export const searchHandbook = (question: string, limit = 3, entries: HandbookEntry[] = HANDBOOK): HandbookHit[] => {
  const q = tokens(question);
  if (!q.length) return [];
  const need = q.length >= 3 ? Math.ceil(q.length / 2) : 1;
  const hits = entries.map(entry => ({ entry, ...scoreDetail(entry, q) })).filter(h => h.score >= 4 && h.strong >= need)
    .sort((a, b) => b.score - a.score || a.entry.title.length - b.entry.title.length || a.entry.id.localeCompare(b.entry.id));
  if (!hits.length) return [];
  const top = hits[0].score;
  return hits.filter(h => h.score >= top * 0.5).slice(0, limit).map(h => ({ entry: h.entry, score: h.score }));
};

export const handbookSize = () => HANDBOOK.length;
