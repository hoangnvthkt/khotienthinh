// Bộ máy tìm kiếm phía trình duyệt: hiểu câu gõ (không dấu, Telex, viết tắt, đồng nghĩa, gõ sai)
// rồi chấm điểm từng dòng. Dùng cho trang/thao tác/gần đây, và xếp lại hồ sơ máy chủ trả về.

import { compactCode, editDistance, foldVi, searchText, tokenVariants, tokenize, typoBudget } from './viText';
import { DOMAIN_WORDS, KIND_WORDS, SYNONYM_GROUPS } from './viLexicon';
import type { SearchEntry, SearchKind } from './searchTypes';

export type AltSource = 'typed' | 'keyboard' | 'synonym' | 'typo';

export interface QueryAlt { text: string; source: AltSource }

/** Một cụm phải khớp (AND giữa các cụm, OR giữa các cách hiểu trong cụm). */
export interface QueryGroup { text: string; alts: QueryAlt[] }

export interface ParsedQuery {
  raw: string;
  folded: string;
  compact: string;
  groups: QueryGroup[];
  kindHints: SearchKind[];
  /** Từ được hiểu lại do quên bật bộ gõ: [đã gõ, hiểu là]. */
  keyboardFixes: Array<[string, string]>;
}

const SYNONYM_INDEX = (() => {
  const index = new Map<string, readonly string[]>();
  SYNONYM_GROUPS.forEach(group => group.forEach(phrase => index.set(phrase, group)));
  return index;
})();

const MAX_PHRASE_WORDS = 4;

const VOCABULARY = (() => {
  const words = new Map<string, string>();
  DOMAIN_WORDS.forEach(word => { const key = foldVi(word); if (!words.has(key)) words.set(key, word); });
  return words;
})();

/** Thêm từ (có dấu) của trang/thao tác vào vốn từ để sửa lỗi gõ và gợi ý. */
export const learnVocabulary = (texts: readonly string[]) => {
  texts.forEach(text => text.split(/[\s/,.()·–-]+/).forEach(word => {
    const key = foldVi(word).replace(/[^a-z0-9]/g, '');
    if (key.length >= 3 && !/^[0-9]+$/.test(key) && !VOCABULARY.has(key)) VOCABULARY.set(key, word.toLowerCase());
  }));
};

/** Từ đã bỏ dấu → dạng có dấu nếu có trong vốn từ ("nhap" → "nhập"). */
export const displayWord = (folded: string): string => VOCABULARY.get(folded) || folded;

/** Hai từ chỉ khác nhau do gõ đảo hai chữ liền nhau ("thpe" ↔ "thep"). */
const isTransposition = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  const diff = [...a].map((char, index) => (char === b[index] ? -1 : index)).filter(index => index >= 0);
  return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
};

const closestWord = (token: string): string | null => {
  if (VOCABULARY.has(token) || /[0-9]/.test(token)) return null;
  // Từ 4 chữ: chỉ sửa khi gõ đảo chữ — thay một chữ dễ thành từ khác hẳn ("phat" → "chất").
  if (token.length === 4) {
    for (const word of VOCABULARY.keys()) if (isTransposition(token, word)) return word;
    return null;
  }
  const budget = typoBudget(token.length) > 1 ? 2 : token.length >= 5 ? 1 : 0;
  if (!budget) return null;
  let best: string | null = null;
  let bestDistance = budget + 1;
  VOCABULARY.forEach((_display, word) => {
    if (Math.abs(word.length - token.length) > budget) return;
    const distance = editDistance(token, word, budget);
    if (distance < bestDistance || (distance === bestDistance && best && word.length > best.length)) { best = word; bestDistance = distance; }
  });
  return bestDistance <= budget ? best : null;
};

const addAlt = (alts: QueryAlt[], text: string, source: AltSource) => {
  if (text && !alts.some(alt => alt.text === text)) alts.push({ text, source });
};

export const parseQuery = (raw: string): ParsedQuery => {
  const tokens = tokenize(raw);
  const groups: QueryGroup[] = [];
  const kindHints = new Set<SearchKind>();
  const keyboardFixes: Array<[string, string]> = [];
  const hint = (text: string) => (KIND_WORDS[text] || []).forEach(kind => kindHints.add(kind));

  for (let i = 0; i < tokens.length;) {
    let consumed = 0;
    // Cụm nhiều từ có trong từ điển ("đơn hàng", "đề nghị thanh toán") — khớp dài nhất trước.
    for (let size = Math.min(MAX_PHRASE_WORDS, tokens.length - i); size >= 2; size -= 1) {
      const phrase = tokens.slice(i, i + size).join(' ');
      const synonyms = SYNONYM_INDEX.get(phrase);
      if (synonyms || KIND_WORDS[phrase]) {
        const alts: QueryAlt[] = [{ text: phrase, source: 'typed' }];
        (synonyms || []).forEach(text => addAlt(alts, text, 'synonym'));
        groups.push({ text: phrase, alts });
        hint(phrase);
        consumed = size;
        break;
      }
    }
    if (consumed) { i += consumed; continue; }

    const token = tokens[i];
    const alts: QueryAlt[] = [];
    tokenVariants(token).forEach((variant, index) => {
      addAlt(alts, variant, index === 0 ? 'typed' : 'keyboard');
      if (index > 0) keyboardFixes.push([token, variant]);
      hint(variant);
      (SYNONYM_INDEX.get(variant) || []).forEach(text => addAlt(alts, text, 'synonym'));
    });
    if (alts.length === 1) {
      const fixed = closestWord(token);
      if (fixed) addAlt(alts, fixed, 'typo');
    }
    groups.push({ text: token, alts });
    i += 1;
  }

  return { raw, folded: searchText(raw), compact: compactCode(raw), groups, kindHints: [...kindHints], keyboardFixes };
};

// ── Chấm điểm ────────────────────────────────────────────────────────────────

interface PreparedText { folded: string; words: string[]; acronym: string }

const prepare = (text: string | null | undefined): PreparedText => {
  const folded = searchText(text);
  const words = folded ? folded.split(' ') : [];
  return { folded, words, acronym: words.map(word => word[0]).join('') };
};

const SOURCE_WEIGHT: Record<AltSource, number> = { typed: 1, keyboard: 0.95, synonym: 0.8, typo: 0.6 };

/** Dung sai lỗi gõ khi so từng từ: từ tiếng Việt 4 chữ rất hay chỉ khác nhau 1 chữ (phép/thép) → từ 5 chữ trở lên mới cho sai. */
const fuzzyBudget = (length: number): number => (length >= 8 ? 2 : length >= 5 ? 1 : 0);

/** Viết tắt đồng nghĩa ngắn (cc, po, hd) do máy thêm vào phải khớp trọn từ — "cc" không khớp "ccdc". */
export const isWholeWordAlt = (alt: QueryAlt): boolean => alt.source === 'synonym' && alt.text.length <= 3 && !alt.text.includes(' ');

const wordScore = (alt: string, field: PreparedText, allowFuzzy = false, wholeWord = false): number => {
  if (!field.folded) return 0;
  if (wholeWord) return field.words.includes(alt) ? 10 : 0;
  if (alt.includes(' ')) {
    if (field.folded === alt) return 12;
    if (field.folded.startsWith(`${alt} `) || field.folded.startsWith(alt)) return 10;
    if (field.folded.includes(` ${alt}`)) return 8;
    return field.folded.includes(alt) ? 4 : 0;
  }
  let best = 0;
  for (const word of field.words) {
    if (word === alt) return 10;
    if (word.startsWith(alt)) best = Math.max(best, alt.length >= 2 ? 8 : 5);
    else if (alt.length >= 3 && word.includes(alt)) best = Math.max(best, 3);
    else if (allowFuzzy && best < 4) {
      const budget = fuzzyBudget(alt.length);
      if (budget && Math.abs(word.length - alt.length) <= budget && editDistance(alt, word, budget) <= budget) best = 4;
    }
  }
  return best;
};

export interface EntryScore { score: number; matchedAll: boolean }

export interface PreparedEntry {
  entry: SearchEntry;
  title: PreparedText;
  code: string;
  rest: PreparedText;
}

export const prepareEntry = (entry: SearchEntry): PreparedEntry => ({
  entry,
  title: prepare(entry.title),
  code: compactCode(entry.code),
  rest: prepare([entry.code, entry.subtitle, entry.context, entry.keywords].filter(Boolean).join(' ')),
});

/** Điểm của một dòng với câu gõ. matchedAll = mọi cụm đều khớp (điều kiện để hiện dòng trang/thao tác). */
export const scoreEntry = (prepared: PreparedEntry, query: ParsedQuery): EntryScore => {
  if (!query.groups.length) return { score: 0, matchedAll: false };
  let total = 0;
  let matchedAll = true;
  for (const group of query.groups) {
    let best = 0;
    for (const alt of group.alts) {
      const weight = SOURCE_WEIGHT[alt.source];
      const altCompact = alt.text.replace(/[^a-z0-9]/g, '');
      // Chỉ dung sai cho chữ người dùng gõ; từ đồng nghĩa / từ đã sửa phải khớp đúng.
      const fuzzy = alt.source === 'typed' || alt.source === 'keyboard';
      const whole = isWholeWordAlt(alt);
      let score = wordScore(alt.text, prepared.title, fuzzy, whole) * 1.6;
      if (prepared.code && altCompact.length >= 2) {
        if (prepared.code === altCompact) score = Math.max(score, 20);
        else if (prepared.code.startsWith(altCompact)) score = Math.max(score, 14);
        else if (altCompact.length >= 3 && prepared.code.includes(altCompact)) score = Math.max(score, 9);
      }
      score = Math.max(score, wordScore(alt.text, prepared.rest, fuzzy, whole));
      best = Math.max(best, score * weight);
    }
    if (best === 0 && query.groups.length === 1 && group.text.length >= 2 && prepared.title.acronym.startsWith(group.text)) {
      // Gõ chữ cái đầu: "nvh" → Nguyễn Văn Hoàng, "dntt" → Đề nghị thanh toán.
      best = group.text.length === prepared.title.acronym.length ? 14 : 9;
    }
    if (best === 0) matchedAll = false;
    total += best;
  }
  const title = prepared.title.folded;
  if (title && query.folded) {
    if (title === query.folded) total += 30;
    else if (title.startsWith(query.folded)) total += 14;
    else if (title.includes(query.folded)) total += 6;
  }
  if (query.compact.length >= 3 && prepared.code === query.compact) total += 30;
  // Gõ đúng dấu thì ưu tiên hơn ("đá" hơn "đã" khi người dùng gõ có dấu).
  const rawLower = query.raw.trim().toLowerCase();
  if (rawLower && rawLower !== query.folded && prepared.entry.title.toLowerCase().includes(rawLower)) total += 6;
  if (query.kindHints.includes(prepared.entry.kind)) total += 6;
  return { score: total, matchedAll };
};

export interface RankedEntry { entry: SearchEntry; score: number }

/** Lọc + xếp các dòng cục bộ (trang, thao tác, gần đây): chỉ giữ dòng khớp đủ mọi cụm. */
export const rankLocal = (entries: readonly PreparedEntry[], query: ParsedQuery, limit = 40): RankedEntry[] =>
  entries
    .map(prepared => ({ prepared, result: scoreEntry(prepared, query) }))
    .filter(({ result }) => result.matchedAll && result.score > 0)
    .sort((a, b) => b.result.score - a.result.score)
    .slice(0, limit)
    .map(({ prepared, result }) => ({ entry: prepared.entry, score: result.score }));

// ── Gợi ý sửa câu gõ ─────────────────────────────────────────────────────────

/** "Có phải bạn muốn tìm …" — thay từ gõ sai bằng từ gần nhất trong vốn từ (có dấu). */
export const suggestCorrection = (query: ParsedQuery): string | null => {
  let changed = false;
  const words = query.groups.map(group => {
    const typo = group.alts.find(alt => alt.source === 'typo');
    const keyboard = group.alts.find(alt => alt.source === 'keyboard');
    const pick = typo || keyboard;
    if (!pick) return group.text;
    changed = true;
    return VOCABULARY.get(pick.text) || pick.text;
  });
  return changed ? words.join(' ') : null;
};

// ── Tô sáng ──────────────────────────────────────────────────────────────────

/** Bỏ dấu từng ký tự, giữ vị trí gốc để tô đúng chữ trên chuỗi có dấu. */
const foldWithMap = (text: string): { folded: string; map: number[] } => {
  let folded = '';
  const map: number[] = [];
  let offset = 0;
  for (const char of text) {
    const piece = foldVi(char);
    for (let k = 0; k < piece.length; k += 1) { folded += piece[k]; map.push(offset); }
    offset += char.length;
  }
  return { folded, map };
};

/** Các đoạn [start, end) trên chuỗi gốc cần tô — đầu từ khớp với cách hiểu của câu gõ. */
export const highlightRanges = (text: string, query: ParsedQuery): Array<[number, number]> => {
  if (!text || !query.groups.length) return [];
  const { folded, map } = foldWithMap(text);
  const ranges: Array<[number, number]> = [];
  const isBoundary = (index: number) => index === 0 || !/[a-z0-9]/.test(folded[index - 1]);
  const isEnd = (index: number) => index >= folded.length || !/[a-z0-9]/.test(folded[index]);
  query.groups.forEach(group => {
    group.alts.filter(alt => alt.source !== 'typo').forEach(alt => {
      let from = 0;
      while (alt.text && from < folded.length) {
        const index = folded.indexOf(alt.text, from);
        if (index < 0) break;
        if (isBoundary(index) && (!isWholeWordAlt(alt) || isEnd(index + alt.text.length))) {
          const end = index + alt.text.length;
          const startChar = map[index];
          const endChar = end < map.length ? map[end] : text.length;
          ranges.push([startChar, endChar]);
        }
        from = index + 1;
      }
    });
  });
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  ranges.forEach(range => {
    const last = merged[merged.length - 1];
    if (last && (range[0] <= last[1] || !text.slice(last[1], range[0]).trim())) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  });
  return merged;
};

/** Cụm gửi máy chủ: mỗi cụm là danh sách cách hiểu (đã bỏ dấu) — máy chủ AND giữa cụm, OR trong cụm. */
export const serverTerms = (query: ParsedQuery): string[][] =>
  query.groups
    .map(group => group.alts.map(alt => alt.text).filter(text => /^[a-z0-9 ./-]+$/.test(text)).slice(0, 8))
    .filter(alts => alts.length > 0)
    .slice(0, 6);
