// Trợ lý · đọc PDF trong chat (chủ SP 18/10/2026: tệp tới 50 MB, đổi được sau). Đọc NGAY TRÊN MÁY bằng pdf.js (chỉ tải khi ghim PDF):
//   * PDF có chữ (báo giá, hợp đồng xuất từ Word / Excel) → chữ từng trang, gửi như bảng tính (dữ liệu, không phải lệnh);
//   * PDF scan (gần như không có chữ) → vài trang đầu thành ảnh (cạnh 2000 px) để AI đọc như ảnh chụp.
// Không tải tệp lên máy chủ; hội thoại chỉ ghi tên tệp.

/** Dung lượng PDF tối đa (MB) — chủ SP chốt 50 MB, đổi ở đây khi cần. */
export const PDF_MAX_MB = 50;
/** Đọc chữ tối đa bấy nhiêu trang; PDF scan gửi tối đa bấy nhiêu trang đầu thành ảnh (còn tùy số ảnh còn trống). */
export const PDF_TEXT_PAGES = 60;
export const PDF_IMAGE_PAGES = 4;
const MAX_TEXT = 14000;

export const isPdfFile = (file: Pick<File, 'name' | 'type'>) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

/** Có chữ thật hay là bản scan: trung bình dưới 40 ký tự / trang (chỉ số trang, dấu) thì coi là scan. */
export const pdfKind = (pageTexts: string[]): 'text' | 'scan' => {
  if (!pageTexts.length) return 'scan';
  const chars = pageTexts.reduce((n, t) => n + t.replace(/\s+/g, '').length, 0);
  return chars / pageTexts.length >= 40 ? 'text' : 'scan';
};

/** Chữ các trang → một khối "[Trang n] …" (≤ 14.000 ký tự hoặc ngân sách còn lại); cắt thì ghi rõ để AI biết tệp chưa đủ. */
export const pdfText = (pageTexts: string[], totalPages: number, budget = MAX_TEXT): { text: string; pages: number; truncated: boolean } => {
  const parts: string[] = [];
  let size = 0; let truncated = totalPages > pageTexts.length;
  for (let i = 0; i < pageTexts.length; i++) {
    // Ô bảng trong PDF cách nhau nhiều khoảng trắng → " | " để AI tách cột; còn lại một dấu cách.
    const body = pageTexts[i].replace(/\t/g, ' ').replace(/ {2,}/g, ' | ').replace(/[ |]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!body) continue;
    const block = `[Trang ${i + 1}]\n${body}`;
    if (size + block.length > budget) {
      const room = budget - size - 20;
      if (room > 200) parts.push(block.slice(0, room));
      truncated = true;
      break;
    }
    parts.push(block); size += block.length + 2;
  }
  const head = `[PDF · ${totalPages} trang]`;
  return { text: `${head}\n${parts.join('\n\n')}${truncated ? '\n(… tệp dài, đã cắt bớt — chỉ dựa trên phần trên)' : ''}`, pages: totalPages, truncated };
};

type PdfJs = typeof import('pdfjs-dist');
let pdfjsPromise: Promise<PdfJs> | null = null;
/** Bản "legacy" của pdf.js (chạy được trên Safari / iPhone đời cũ hơn), worker tải riêng — chỉ khi người dùng ghim PDF. */
const loadPdfJs = (): Promise<PdfJs> => {
  pdfjsPromise ||= Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs') as unknown as Promise<PdfJs>,
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url').then(m => (m as { default: string }).default),
  ]).then(([lib, worker]) => { lib.GlobalWorkerOptions.workerSrc = worker; return lib; });
  return pdfjsPromise;
};

export interface PdfRead { kind: 'text' | 'scan'; pages: number; text?: { text: string; truncated: boolean }; images?: Array<{ page: number; blob: Blob }> }

/** Đọc một PDF: chữ (≤ 60 trang) hoặc ảnh các trang đầu (PDF scan). imageSlots = số ảnh còn được gửi kèm. */
export const readPdf = async (file: File, imageSlots: number, textBudget = MAX_TEXT): Promise<PdfRead> => {
  if (file.size > PDF_MAX_MB * 1024 * 1024) throw new Error(`${file.name}: PDF quá lớn (trên ${PDF_MAX_MB} MB).`);
  const pdfjs = await loadPdfJs();
  let doc: Awaited<ReturnType<PdfJs['getDocument']>['promise']>;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  } catch (e) {
    const name = (e as { name?: string })?.name || '';
    throw new Error(name === 'PasswordException' ? `${file.name}: PDF có mật khẩu — mở khóa rồi gửi lại.` : `${file.name}: chưa đọc được PDF này.`);
  }
  try {
    const texts: string[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, PDF_TEXT_PAGES); i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      texts.push(content.items.map(item => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '')).join(''));
      page.cleanup();
    }
    if (pdfKind(texts) === 'text') return { kind: 'text', pages: doc.numPages, text: pdfText(texts, doc.numPages, textBudget) };
    if (imageSlots <= 0) throw new Error(`${file.name}: PDF scan cần gửi dạng ảnh nhưng đã đủ ảnh — bỏ bớt ảnh rồi thử lại.`);
    const images: Array<{ page: number; blob: Blob }> = [];
    for (let i = 1; i <= Math.min(doc.numPages, PDF_IMAGE_PAGES, imageSlots); i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(3, 2000 / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error(`${file.name}: máy không vẽ được trang PDF.`);
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      if (blob) images.push({ page: i, blob });
      page.cleanup();
    }
    return { kind: 'scan', pages: doc.numPages, images };
  } finally {
    void doc.destroy();
  }
};
