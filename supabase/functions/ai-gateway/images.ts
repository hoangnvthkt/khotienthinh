// Ảnh gửi kèm skill đọc ảnh (base64 không tiền tố data:). Tách riêng để skills.ts không kéo SDK nhà cung cấp vào test.
export interface ImagePart { mime: 'image/jpeg' | 'image/png' | 'image/webp'; b64: string }

const IMAGE_MIME: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp']);
/** Ảnh đính kèm câu hỏi Trợ lý (T3): tối đa 4 ảnh, mỗi ảnh ≤ ~4,5 MB (máy đã thu về cạnh 2000 px). Ảnh hỏng → lỗi đầu vào. */
export const parseImageParts = (raw: unknown, max = 4): ImagePart[] => {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > max) throw new Error('AI_BAD_INPUT');
  return raw.map(x => {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const mime = String(o.mime || ''); const b64 = String(o.b64 || '');
    if (!IMAGE_MIME.has(mime) || b64.length < 200 || b64.length > 6_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64.slice(-200))) throw new Error('AI_BAD_INPUT');
    return { mime: mime as ImagePart['mime'], b64 };
  });
};
