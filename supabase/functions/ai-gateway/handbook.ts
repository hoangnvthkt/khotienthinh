// Sổ tay Vioo (B3, chủ SP 22/10/2026): công cụ so_tay trả lời "làm sao để…" từ danh sách mục sinh sẵn (handbook.generated.ts: docs/so-tay,
// hướng dẫn Dự án, danh mục màn hình / thao tác trong mã). Khớp bằng từ khóa không dấu, không gọi model, không đọc dữ liệu nghiệp vụ.
// Không dùng API Deno để vitest kiểm thử được.
import { HANDBOOK, type HandbookEntry } from './handbook.generated.ts';

export const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
/** Từ không mang nghĩa khi tìm mục ("làm sao để", "anh muốn", "ở đâu"…). */
export const HANDBOOK_STOP = new Set(['lam', 'sao', 'de', 'the', 'nao', 'cach', 'o', 'dau', 'toi', 'anh', 'em', 'chi', 'giup', 'voi', 'nhu', 'la', 'cua', 'cho', 'va', 'bi', 'duoc', 'khong', 'co', 'muon', 'can', 'thi', 'ma', 'a', 'oi', 'nhe', 'nha', 'ban', 'minh', 'huong', 'dan', 'huongdan', 'phan', 'mem', 'vioo', 'app', 'thao', 'tac', 'nay', 'kia', 'do', 'gi', 'vay', 'roi', 'hay', 'hoac', 'tren', 'trong', 'bang', 'tu', 'den', 'mot', 'cai', 'xin', 'hoi', 'biet', 'xem', 'lai', 'moi', 'thu', 'kieu']);
/** Từ đệm trùng chữ nghiệp vụ khi bỏ dấu (chị / chi, để / đề, đâu / đầu tư, đó / tiến độ, bằng / bảng, cái / cài, bạn / bàn giao, phần / phân quyền,
 *  thì / thi công, mà / mã, cho / chờ…): chỉ bỏ khi người dùng gõ đúng dạng của từ đệm (Tài chính 23/10: "đề nghị chi" bị bỏ còn "nghi" → trúng nghỉ phép).
 *  Gõ không dấu thì giữ — thà thừa một từ yếu còn hơn mất chữ nghiệp vụ. "việc" không còn là từ đệm (nghỉ việc, giao việc, công việc). */
export const HANDBOOK_AMBIGUOUS: Record<string, string[]> = { chi: ['chị'], de: ['để'], tu: ['từ'], thu: ['thử'], dau: ['đâu'], do: ['đó', 'do'], the: ['thế', 'thể'], bang: ['bằng'], lai: ['lại'], cai: ['cái'], ban: ['bạn'], dan: ['dẫn'], phan: ['phần'], hoi: ['hỏi'], ma: ['mà'], can: ['cần'], cho: ['cho'], thi: ['thì'], muon: ['muốn'], nha: ['nhá', 'nha'] };
export const isStopWord = (word: string) => {
  const folded = stripAccents(word);
  if (!HANDBOOK_STOP.has(folded)) return false;
  const forms = HANDBOOK_AMBIGUOUS[folded];
  return !forms || forms.includes(word.toLowerCase());
};
/** "quy cách" giữ "cách" (Kho 23/10: "cách" là từ đệm nên hỏi "quy cách" không ra mục quy cách). */
const KEEP_AFTER: Record<string, string> = { cach: 'quy' };
/** Từ của câu hỏi sau khi bỏ từ đệm: raw = chữ người dùng gõ (có thể có dấu), folded = đã bỏ dấu để khớp từ khóa. */
export const queryWords = (q: string): Array<{ raw: string; folded: string }> => {
  const words = String(q || '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}\s/-]+/gu, ' ').split(/\s+/).map(t => t.trim()).filter(Boolean);
  return words.filter((t, i) => !isStopWord(t) || KEEP_AFTER[stripAccents(t)] === stripAccents(words[i - 1] || ''))
    .map(raw => ({ raw, folded: stripAccents(raw).replace(/[^a-z0-9/-]+/g, '') })).filter(w => w.folded.length >= 2);
};
export const tokens = (q: string) => queryWords(q).map(w => w.folded);

export interface HandbookHit { entry: HandbookEntry; score: number }
export interface ScoreDetail { score: number; strong: number }
/** Điểm = từ khớp tiêu đề ×4, từ khóa ×3, thân ×1; cụm 2 từ liền nhau trong từ khóa / tiêu đề ×3 thêm. strong = số từ khớp tiêu đề / từ khóa. */
export const scoreDetail = (entry: HandbookEntry, qTokens: string[], raw: string[] = []): ScoreDetail => {
  if (!qTokens.length) return { score: 0, strong: 0 };
  // Tiêu đề có dấu: người dùng gõ có dấu mà khác dấu với chữ trong tiêu đề ("kể" ↔ "kê", "đâu" ↔ "đầu") thì không tính khớp mạnh.
  const titleRaw = ` ${entry.title.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}/-]+/gu, ' ')} `;
  const sameAccent = (i: number) => { const r = raw[i]; return !r || r === qTokens[i] || titleRaw.includes(` ${r} `); };
  // Khớp NGUYÊN TỪ (23/10: khớp đoạn chữ làm "kho" dính "không", "de" dính "den" — mục "Không thấy…" bị cộng điểm nhầm).
  const words = (text: string) => ` ${stripAccents(text).replace(/[^a-z0-9/-]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
  const title = words(entry.title); const kw = words(entry.keywords); const body = words(entry.body);
  // Câu hỏi mẫu: ngăn từng câu bằng " | " để cụm 2 từ không nối qua hai câu.
  const qs = entry.questions ? ` ${entry.questions.split('·').map(x => words(x).trim()).join(' | ')} ` : '';
  let score = 0; let strong = 0;
  for (const [i, t] of qTokens.entries()) {
    const w = ` ${t} `;
    if (title.includes(w) && sameAccent(i)) { score += 4; strong += 1; }
    else if (title.includes(w)) score += 1;
    else if (kw.includes(w)) { score += 3; strong += 1; }
    else if (qs.includes(w)) score += 1.5;
    else if (body.includes(w)) score += 1;
  }
  // Cụm 2 từ liền nhau: trong từ khóa / tiêu đề +3; trong câu hỏi mẫu +3 và tính một từ mạnh (câu mẫu chỉ "mạnh" khi trùng cả cụm).
  for (let i = 0; i + 1 < qTokens.length; i++) {
    const pair = ` ${qTokens[i]} ${qTokens[i + 1]} `;
    if (kw.includes(pair) || title.includes(pair)) score += 3;
    else if (qs.includes(pair)) { score += 3; strong += 1; }
  }
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
  const qw = queryWords(question);
  const q = qw.map(w => w.folded); const raw = qw.map(w => w.raw);
  if (!q.length) return [];
  // Câu ≥ 3 từ: nửa số từ phải khớp mạnh, tối đa 3 (câu dài có tên người / phòng ban — "xin số điện thoại anh Đô phòng kỹ thuật" — vẫn ra mục).
  const need = q.length >= 3 ? Math.min(3, Math.ceil(q.length / 2)) : 1;
  const hits = entries.map(entry => ({ entry, ...scoreDetail(entry, q, raw) })).filter(h => h.score >= 4 && h.strong >= need)
    .sort((a, b) => b.score - a.score || a.entry.title.length - b.entry.title.length || a.entry.id.localeCompare(b.entry.id));
  if (!hits.length) return [];
  const top = hits[0].score;
  return hits.filter(h => h.score >= top * 0.5).slice(0, limit).map(h => ({ entry: h.entry, score: h.score }));
};

export const handbookSize = () => HANDBOOK.length;
