import { detectQuad, outputSize, toGray, warpQuad, type Quad } from './docDetect';

// Tự cắt khung phiếu trên trình duyệt: tìm trên bản thu nhỏ, cắt + làm phẳng trên ảnh gốc (cạnh dài tối đa 2000 px).

const DETECT_SIZE = 360;

/** Tìm tờ phiếu trên một khung hình (video / ảnh / canvas). Trả 4 góc theo toạ độ nguồn, hoặc null. */
export const detectIn = (src: CanvasImageSource, sw: number, sh: number, scratch?: HTMLCanvasElement): Quad | null => {
  if (!sw || !sh) return null;
  const s = Math.min(1, DETECT_SIZE / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * s)), h = Math.max(1, Math.round(sh * s));
  const c = scratch || document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, w, h);
  const q = detectQuad(toGray(ctx.getImageData(0, 0, w, h).data, w, h), w, h);
  return q ? q.map(p => ({ x: p.x / s, y: p.y / s })) as Quad : null;
};

export const loadImage = (file: Blob): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Không đọc được ảnh.')); };
  img.src = url;
});

const canvasOf = (src: CanvasImageSource, w: number, h: number) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d')!.drawImage(src, 0, 0, w, h);
  return c;
};

/** Cắt + làm phẳng theo 4 góc (toạ độ nguồn) → JPEG. */
export const cropToFile = async (src: CanvasImageSource, sw: number, sh: number, q: Quad, name: string): Promise<File> => {
  // Ảnh nguồn quá lớn thì thu về ~3000 px trước khi làm phẳng (đủ nét chữ, nhẹ bộ nhớ iPhone).
  const s = Math.min(1, 3000 / Math.max(sw, sh));
  const w = Math.round(sw * s), h = Math.round(sh * s);
  const base = canvasOf(src, w, h);
  const data = base.getContext('2d')!.getImageData(0, 0, w, h);
  const sq = q.map(p => ({ x: p.x * s, y: p.y * s })) as Quad;
  const size = outputSize(sq, 2000);
  const out = warpQuad(data, sq, size);
  const oc = document.createElement('canvas'); oc.width = size.w; oc.height = size.h;
  oc.getContext('2d')!.putImageData(new ImageData(out, size.w, size.h), 0, 0);
  const blob = await new Promise<Blob | null>(r => oc.toBlob(r, 'image/jpeg', 0.88));
  if (!blob) throw new Error('Không cắt được ảnh.');
  return new File([blob], name.replace(/\.[^.]+$/, '') + '-cat.jpg', { type: 'image/jpeg', lastModified: Date.now() });
};
