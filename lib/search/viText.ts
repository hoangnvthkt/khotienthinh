// Chuẩn hóa tiếng Việt cho tìm kiếm: bỏ dấu, đ → d, chữ thường, và đoán chữ khi người dùng
// quên bật bộ gõ (gõ Telex/VNI thô như "nhapj khoo", "va6t tu7").

/** "Đề nghị Thanh toán" → "de nghi thanh toan". */
export const foldVi = (value: string | null | undefined): string =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();

/** Chuỗi tìm kiếm: bỏ dấu, chỉ giữ chữ, số và ký tự hay có trong mã (. / -), gộp khoảng trắng. */
export const searchText = (value: string | null | undefined): string =>
  foldVi(value).replace(/[^a-z0-9./-]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Mã viết liền để so mã gõ thiếu gạch: "PO-2026/015" → "po2026015". */
export const compactCode = (value: string | null | undefined): string => foldVi(value).replace(/[^a-z0-9]+/g, '');

export const tokenize = (value: string | null | undefined): string[] => {
  const text = searchText(value);
  return text ? text.split(' ') : [];
};

const VOWEL = /[aeiouy]/;

/**
 * Gõ Telex khi bộ gõ tắt: bỏ dấu thanh (s f r x j z sau nguyên âm), aa/ee/oo → a/e/o, dd → d, w → bỏ.
 * "dduwowngf" → "duong", "nhaapj" → "nhap", "hopwj" → "hop". Trả null khi không thấy dấu hiệu Telex.
 */
export const telexToPlain = (token: string): string | null => {
  if (!VOWEL.test(token) || /[0-9]/.test(token)) return null;
  let word = token;
  // Dấu thanh: tối đa một chữ s/f/r/x/j/z đứng sau nguyên âm (Telex cho gõ dấu ở giữa hoặc cuối từ).
  word = word.replace(/([aeiouy][a-z]*?)[sfrxjz]([^aeiouy]*)$/, (match, head: string, tail: string) =>
    /^(c|ch|m|n|ng|nh|p|t|w)?$/.test(tail) ? head + tail : match);
  word = word
    .replace(/dd/g, 'd')
    .replace(/aa/g, 'a')
    .replace(/ee/g, 'e')
    .replace(/oo/g, 'o')
    .replace(/w/g, '');
  return word && word !== token ? word : null;
};

/** VNI khi bộ gõ tắt: số 1–9 đứng sau chữ cái là dấu. "va6t5" → "vat", "d9u7o7ng2" → "duong". */
export const vniToPlain = (token: string): string | null => {
  if (!/[a-z][1-9](?=[a-z]|$)/.test(token) || !VOWEL.test(token)) return null;
  // Mã có số liền nhau (D10, PO2026) không phải VNI.
  if (/[0-9]{2,}/.test(token)) return null;
  const word = token.replace(/([a-z])[1-9](?=[a-z]|$)/g, '$1').replace(/([a-z])[1-9](?=[a-z]|$)/g, '$1');
  return word && word !== token ? word : null;
};

/** Các cách hiểu của một từ người dùng gõ (luôn có chính từ đó trước). */
export const tokenVariants = (token: string): string[] => {
  const variants = [token];
  const telex = telexToPlain(token);
  if (telex && telex.length >= 2) variants.push(telex);
  const vni = vniToPlain(token);
  if (vni && vni.length >= 2) variants.push(vni);
  return [...new Set(variants)];
};

/** Khoảng cách sửa (Damerau–Levenshtein rút gọn) có ngưỡng — vượt ngưỡng thì trả max + 1. */
export const editDistance = (a: string, b: string, max: number): number => {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prevPrev: number[] = [];
  let prev = Array.from({ length: cols }, (_, j) => j);
  for (let i = 1; i < rows; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(prev[j] + 1, current[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, prevPrev[j - 2] + 1);
      current.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    prevPrev = prev;
    prev = current;
  }
  return prev[cols - 1];
};

/** Số lỗi gõ chấp nhận theo độ dài từ: từ ngắn phải đúng, từ dài được sai 1–2 chữ. */
export const typoBudget = (length: number): number => (length >= 8 ? 2 : length >= 4 ? 1 : 0);
