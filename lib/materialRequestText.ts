// Đề xuất từ một câu (lộ trình AI A1, chủ SP 16/10/2026): gõ / dán danh sách vật tư → các dòng đề xuất nháp.
// Tách bằng quy tắc ngay trên máy (danh sách xuống dòng, dấu phẩy, "50 bao xi măng", "ống PVC 140 44 cây"); câu khó thì nhờ AI tách
// (skill mr_text_lines) rồi vẫn khớp mã ở đây. Khớp mã với danh mục đã tải của dự án; người dùng xem, đổi mã, rồi mới thêm vào phiếu.
// Không import gì để chạy được cả trong test lẫn script đo.

export interface TextLine {
  name: string; spec: string | null; qty: number | null; unit: string | null; note: string | null; raw: string;
  /** Quy tắc chưa chắc đã tách đúng (câu văn, còn số + đơn vị trong tên) → gợi ý "Nhờ AI tách". */
  unsure?: boolean;
  /** Số lượng nằm giữa câu ("tổ anh Hùng 10 cuộn băng tan"): cách hiểu còn lại — khớp mã sẽ chọn phía khớp tốt hơn. */
  alt?: { name: string; note: string | null };
}
export interface CatalogItem { id: string; name: string; sku?: string | null; unit?: string | null }
export interface ItemCandidate<T extends CatalogItem = CatalogItem> { item: T; score: number }
export interface MatchedLine<T extends CatalogItem = CatalogItem> extends TextLine {
  candidates: ItemCandidate<T>[];
  /** Mã chọn sẵn khi đủ chắc (điểm ≥ 0,75 và hơn mã thứ hai ≥ 0,1); null = người dùng chọn. */
  pick: T | null;
  /** Phần chữ không có trong tên mã đã chọn — gợi ý làm quy cách. */
  specGuess: string | null;
  /** Đơn vị trên câu khác đơn vị của mã (không tự quy đổi). */
  unitMismatch: boolean;
  /** Lệch đơn vị nhưng chữ của dòng có sẵn số theo đơn vị của mã ("3 cây · 6300 kg", mã tính Kg) → dùng số này. */
  qtyFromText: number | null;
}

export const fold = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[φø∅Φ]/g, 'phi');

// Đơn vị hay gặp ở công trường (dạng không dấu) → cách viết chuẩn hiển thị.
const UNITS: Record<string, string> = {
  cai: 'cái', chiec: 'chiếc', cay: 'cây', thanh: 'thanh', m: 'm', met: 'm', md: 'md', m2: 'm2', m3: 'm3', khoi: 'm3', kg: 'kg', tan: 'tấn', ta: 'tạ',
  bao: 'bao', con: 'con', bo: 'bộ', cuon: 'cuộn', hop: 'hộp', thung: 'thùng', lit: 'lít', l: 'lít', lo: 'lọ', chai: 'chai', tam: 'tấm', vien: 'viên', doi: 'đôi',
  ong: 'ống', xe: 'xe', chuyen: 'chuyến', lan: 'lần', ca: 'ca', goi: 'gói', tui: 'túi', can: 'can', phuy: 'phuy', soi: 'sợi', doan: 'đoạn',
  kien: 'kiện', pallet: 'pallet', hu: 'hũ', qua: 'quả', cuc: 'cục', tuyp: 'tuýp', lon: 'lon', ram: 'ram', quyen: 'quyển',
};
// "bó" và "bộ" cùng là "bo" khi bỏ dấu — phân biệt bằng chữ gốc.
const unitOf = (word: string): string | null => {
  const w = word.toLowerCase().replace(/[.,;:]+$/, '');
  if (w === 'bó') return 'bó';
  if (w === 'm²') return 'm2';
  if (w === 'm³') return 'm3';
  return UNITS[fold(w)] ?? null;
};
/** Khóa so đơn vị: "m" = "Mét", "khối" = "m3", "Kg" = "kg". */
export const unitKey = (u: string | null | undefined) => (u ? unitOf(u) ?? fold(u).trim() : '');
export const sameUnit = (a: string | null | undefined, b: string | null | undefined) => !a || !b || unitKey(a) === unitKey(b);
const NUM = String.raw`\d+(?:[.,]\d+)*`;
/** "1.332,42" / "1,5" / "2.000" → số (dấu chấm nghìn, dấu phẩy thập phân kiểu Việt). */
export const parseViNumber = (s: string): number | null => {
  const t = s.trim();
  if (!/^\d+(?:[.,]\d+)*$/.test(t)) return null;
  let v = t;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) v = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d+,\d+$/.test(t)) v = t.replace(',', '.');
  else if (/^\d{1,3}(,\d{3})+$/.test(t)) v = t.replace(/,/g, '');
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Từ mở đầu / lời chào không phải tên vật tư.
const LEAD_FILLER = /^(?:(?:anh|chị|em|a|c|e)\s+(?:ơi|oi)[,!]?\s+)?(?:(?:đặt|dat|mua|lấy|lay|xin|cần|can|gửi|gui|giúp|giup|cho|em|anh|chị|thêm|them)\s+)*/i;
const UNIT_WORDS = 'cái|cai|chiếc|cây|cay|thanh|mét|met|md|m2|m3|m²|m³|m|kg|tấn|tan|tạ|bao|con|bộ|cuộn|cuon|hộp|hop|thùng|thung|lít|lit|lọ|chai|tấm|tam|viên|vien|đôi|ống|chuyến|lần|ca|gói|túi|can|phuy|sợi|đoạn|khối|bó|kiện|pallet|hũ|quả|cục|tuýp|lon|ram|quyển';
/** "120m2" → "120 m2" (chỉ khi số đứng riêng, không đụng "x6m" hay "M250"). */
const splitGlued = (s: string) => s.replace(new RegExp(`(^|\\s)(${NUM})(${UNIT_WORDS})(?=\\s|$|[,;.)])`, 'gi'), '$1$2 $3');
const PAIR = new RegExp(`(^|\\s)${NUM}\\s+(?:${UNIT_WORDS})(?=\\s|$)`, 'i');

/** Tên + phần sau "cho / để / làm" → ghi chú (mục đích, hạng mục). */
const splitPurpose = (name: string): [string, string | null] => {
  const m = name.match(/^(.+?)\s+(?:cho|để|de|làm|lam|dùng|dung)\s+(.+)$/i);
  return m && m[1].trim().length > 1 ? [m[1].trim(), m[2].trim()] : [name, null];
};
const joinNote = (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join('; ') || null;

/** Một đoạn → dòng: "<tên> <SL> <ĐV> [ghi chú]" · "<SL> <ĐV> <tên>" · "<tên>: <SL>" · "<tên> x <SL>". Không thấy SL thì qty null. */
export const parseSegment = (raw: string): TextLine | null => {
  let s = splitGlued(raw.replace(/^\s*(?:[-–•*+]|\d+[.)])\s+/, '').replace(/\s+/g, ' ').trim());
  if (!s || !/[a-z]/i.test(fold(s))) return null;
  if (/:\s*$/.test(s)) return null; // dòng tiêu đề "Anh ơi đặt giúp em:"
  s = s.replace(LEAD_FILLER, '').trim();
  if (!s) return null;
  // Ngoặc có số là ghi chú ("(24 tuýp)"); ngoặc chỉ có chữ ("(thường)") giữ trong tên để phân biệt mã; ngoặc kích thước ("(50x100)") giữ nguyên.
  const parens: string[] = [];
  s = s.replace(/\(([^)]*)\)/g, (all, inner: string) => (/\d+\s*[x×*]\s*\d+/.test(inner) ? all : /\d/.test(inner) ? (parens.push(inner.trim()), ' ') : ` ${inner} `))
    .replace(/\s+/g, ' ').trim();
  let note: string | null = parens.filter(Boolean).join('; ') || null;
  const words = s.split(' ');
  const done = (name: string, qty: number | null, unit: string | null, extra: string | null): TextLine => {
    const [n, purpose] = splitPurpose(name.replace(/[:\-–=]+$/, '').trim());
    return { name: n, spec: null, qty, unit, note: joinNote(note, purpose, extra), raw, unsure: PAIR.test(n) || undefined };
  };
  // <SL> <ĐV> ở đầu: "50 bao xi măng", "2 tấn thép D16"
  const lead = parseViNumber(words[0] || '');
  if (lead != null && words.length > 2 && unitOf(words[1])) return done(words.slice(2).join(' '), lead, unitOf(words[1]), null);
  // <SL> <ĐV> sau tên: lấy cặp số + đơn vị cuối cùng; phần còn lại là ghi chú
  for (let i = words.length - 2; i >= 1; i--) {
    const q = parseViNumber(words[i]); const u = unitOf(words[i + 1]);
    if (q == null || !u) continue;
    const before = words.slice(0, i).join(' '); const after = words.slice(i + 2).join(' ').trim();
    const line = done(before, q, u, after || null);
    // Có chữ ở cả hai phía: tên vật tư có thể là phía sau ("tổ anh Hùng 10 cuộn băng tan").
    if (after && /[a-z]{2}/i.test(fold(after))) {
      const [an, ap] = splitPurpose(after);
      line.alt = { name: an, note: joinNote(note, before, ap) };
    }
    return line;
  }
  // "<tên>: 44" · "<tên> x 44" · "<tên> SL 44" · "<tên> = 44"
  const m = s.match(new RegExp(String.raw`^(.*?)\s*(?::|=|\bx\b|×|\bSL\b|\bsl\b)\s*(${NUM})\s*([^\d\s]*)\s*$`));
  if (m && m[1].trim()) return done(m[1], parseViNumber(m[2]), m[3] ? unitOf(m[3]) : null, null);
  return { ...done(s, null, null, null), unsure: true };
};

/** Cả đoạn văn bản → các dòng. Tách theo xuống dòng, ";", ", " có dấu cách (không tách "1,5") và "và / với / +" giữa hai vật tư. */
export const parseRequestText = (text: string): TextLine[] => text
  .split(/\n|;|,\s+|\s+(?:và|va|với|voi|\+|&)\s+(?=\S*\d|\S+\s+\S*\d)/i)
  .map(parseSegment)
  .filter((l): l is TextLine => !!l && l.name.length > 1)
  .slice(0, 60);

// ---- Khớp mã ----
// Cách gọi ngoài công trường → cách gọi trong danh mục (so sau khi bỏ dấu).
const SYNONYMS: Record<string, string> = { sat: 'thep', t: 'te' };
const tokens = (t: string) => {
  const f = fold(t).replace(/,/g, '.').replace(/[×*]/g, ' x ').replace(/(\d)x(\d)/g, '$1 x $2');
  const out: string[] = [];
  for (const w of f.split(/[^a-z0-9.]+/).filter(Boolean)) {
    const x = SYNONYMS[w.replace(/^\.+|\.+$/g, '')] ?? w.replace(/^\.+|\.+$/g, '');
    if (!x) continue;
    out.push(x);
    // D110 / phi27 / M6 → thêm phần số để khớp "110", "27"; 0.45mm / 1000g → thêm "0.45", "1000"
    const parts = x.match(/^(d|phi|m|dn|pn|k)(\d+(?:\.\d+)?)$/);
    if (parts) out.push(parts[2]);
    const unitTail = x.match(/^(\d+(?:\.\d+)?)(mm|cm|m|ly|g|kg|l|ml)$/);
    if (unitTail) out.push(unitTail[1]);
  }
  return out;
};
const STOP = new Set(['va', 'cho', 'can', 'loai', 'hang', 'vat', 'tu', 'cua', 'de', 'cac', 'x']);
const isNum = (t: string) => /^\d/.test(t);

/**
 * Điểm 0–1: phần từ của câu có trong tên mã (số nặng gấp đôi) và phần tên mã có trong câu.
 * Trừ điểm khi: tên mã có cỡ số khác (cút 110 ≠ cút 90); từ đầu tên mã không có trong câu (Cút ≠ Tê, Khóa cáp ≠ Cốc cáp, Đế cống ≠ Cống).
 */
export const scoreItem = (query: string, itemName: string): number => {
  const q = tokens(query).filter(t => !STOP.has(t));
  if (!q.length) return 0;
  const n = tokens(itemName);
  if (!n.length) return 0;
  const nSet = new Set(n);
  let hit = 0; let total = 0;
  for (const t of q) {
    const w = isNum(t) ? 2 : 1;
    total += w;
    if (nSet.has(t)) hit += w;
    else if (!isNum(t) && t.length >= 4 && n.some(x => x.startsWith(t) || (t.startsWith(x) && x.length >= 4))) hit += w * 0.6;
  }
  const qCover = hit / total;
  const qSet = new Set(q);
  const nameCover = n.filter(t => qSet.has(t) || STOP.has(t)).length / n.length;
  const qNums = q.filter(isNum); const nNums = n.filter(isNum);
  const sizeClash = qNums.length > 0 && nNums.length > 0 && !nNums.some(x => qSet.has(x));
  const headMiss = !isNum(n[0]) && !qSet.has(n[0]);
  return Math.max(0, 0.7 * qCover + 0.3 * nameCover - (sizeClash ? 0.35 : 0) - (headMiss ? 0.25 : 0));
};

export const rankItems = <T extends CatalogItem>(query: string, items: T[], opts: { unit?: string | null; boost?: Set<string>; limit?: number } = {}): ItemCandidate<T>[] => {
  const unit = opts.unit ? unitKey(opts.unit) : null;
  return items
    .map(item => {
      let score = scoreItem(query, item.name);
      if (item.sku && fold(query).replace(/\s+/g, '').includes(fold(item.sku))) score = Math.max(score, 0.99);
      if (score > 0 && unit && item.unit && unitKey(item.unit) === unit) score += 0.05;
      if (score > 0 && opts.boost?.has(item.id)) score += 0.08;
      return { item, score: Math.min(1, score) };
    })
    .filter(c => c.score >= 0.55)
    .sort((a, b) => b.score - a.score || a.item.name.length - b.item.name.length)
    .slice(0, opts.limit ?? 3);
};

/** Chữ của câu không có trong tên mã (trừ từ đệm) → gợi ý quy cách, VD "Ống PVC 140 PN5" + mã "Ống PVC 140" → "PN5". */
export const leftoverSpec = (query: string, itemName: string): string | null => {
  const nSet = new Set(tokens(itemName));
  const left = query.split(/\s+/).filter(w => {
    const t = tokens(w);
    // "D110" đã nằm trong mã "Cút PVC 110" → không lặp lại làm quy cách.
    return t.length > 0 && !t.every(x => nSet.has(x) || STOP.has(x) || nSet.has(x.replace(/^(d|phi|m|dn|k)(?=\d)/, '')));
  });
  const s = left.join(' ').trim();
  return s && s.length <= 80 ? s : null;
};

/** Ghi chú chỉ là số đo ("Trọng lượng tạm tính 6300 kg", "702kg") — không phải lý do / mục đích. */
export const isMeasureNote = (note: string | null | undefined) =>
  Boolean(note && new RegExp(`(^|\\s|[a-zà-ỹ])${NUM}\\s*(?:${UNIT_WORDS})\\b`, 'i').test(note) && !/\b(cho|để|de|làm|lam|dùng|dung)\b/i.test(note));

/** Số lượng theo đơn vị của mã tìm thấy trong chữ của dòng ("6300 kg" khi mã tính Kg). Không thấy thì null. */
export const qtyInUnit = (line: Pick<TextLine, 'note' | 'raw' | 'spec'>, unit: string | null | undefined): number | null => {
  const want = unitKey(unit);
  if (!want) return null;
  const re = new RegExp(`(${NUM})\\s*(${UNIT_WORDS})(?![a-zà-ỹ0-9])`, 'gi');
  for (const text of [line.note, line.spec, line.raw]) {
    for (const m of String(text || '').matchAll(re)) {
      const q = parseViNumber(m[1]);
      if (q != null && q > 0 && unitKey(m[2]) === want) return q;
    }
  }
  return null;
};

export const matchLines = <T extends CatalogItem>(lines: TextLine[], items: T[], opts: { boost?: Set<string> } = {}): MatchedLine<T>[] =>
  lines.map(raw => {
    let line: TextLine = raw;
    let candidates = rankItems([line.name, line.spec].filter(Boolean).join(' '), items, { unit: line.unit, boost: opts.boost });
    if (raw.alt) {
      const other = rankItems(raw.alt.name, items, { unit: raw.unit, boost: opts.boost });
      if ((other[0]?.score ?? 0) > (candidates[0]?.score ?? 0) + 0.05) { line = { ...raw, name: raw.alt.name, note: raw.alt.note }; candidates = other; }
    }
    const [a, b] = candidates;
    const unitDiff = (item: T | undefined) => Boolean(item && !sameUnit(line.unit, item.unit));
    // Chọn sẵn khi đủ chắc và cùng đơn vị; lệch đơn vị thì người dùng chọn (không tự quy đổi cây ↔ mét).
    // Tên trùng khít (điểm 1) mà mã thứ hai không khít thì chọn luôn: "Ống PPR 25" thắng "Ống tránh PPR 25".
    const exact = a && a.score >= 0.999 && (!b || b.score < 0.999);
    // Đơn vị phân định: phiếu ghi "cây", mã đầu tính Cây còn mã sau tính Kg (Thép XD D16 / Thép tròn trơn D16) → chọn mã đầu.
    const unitDecides = Boolean(a && b && line.unit && !unitDiff(a.item) && unitDiff(b.item) && a.score - b.score >= 0.05);
    // Lệch đơn vị mà dòng có sẵn số theo đơn vị của mã (thép D8: phiếu ghi 3 cây, khối lượng 6300 kg; mã tính Kg) → vẫn chọn được.
    const altQty = a && unitDiff(a.item) ? qtyInUnit(line, a.item.unit) : null;
    const pick = a && a.score >= 0.75 && (exact || unitDecides || !b || a.score - b.score >= 0.1) && (!unitDiff(a.item) || altQty != null) ? a.item : null;
    const chosen = pick || a?.item || null;
    const { alt: _alt, ...rest } = line;
    return {
      ...rest, candidates, pick, unsure: rest.unsure || (Boolean(raw.alt) && candidates.length === 0) || undefined,
      // Quy cách AI tách riêng hoặc phần chữ thừa của tên — bỏ nếu tên mã đã có ("10" với "Đinh sắt 10cm").
      specGuess: chosen ? leftoverSpec(line.spec || line.name, chosen.name) : line.spec,
      unitMismatch: unitDiff(chosen || undefined),
      qtyFromText: chosen && unitDiff(chosen) ? qtyInUnit(line, chosen.unit) : null,
    };
  });
