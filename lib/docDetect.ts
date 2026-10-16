// Tự cắt khung phiếu giao (chủ SP 16/10/2026): tìm tờ phiếu trong ảnh rồi làm phẳng, bỏ phần nền (bàn, tay, màn hình…).
// Không dùng OpenCV (~8 MB, nặng cho iPhone): ảnh thu nhỏ ~360 px → ngưỡng Otsu → vùng sáng lớn nhất (tờ giấy) lấp lỗ chữ
// → 4 góc cực trị → kiểm tra hình dạng → biến đổi phối cảnh (homography) trên ảnh gốc. Không chắc chắn thì trả null (giữ ảnh gốc).

export type Pt = { x: number; y: number };
/** 4 góc theo thứ tự trên-trái, trên-phải, dưới-phải, dưới-trái (toạ độ ảnh). */
export type Quad = [Pt, Pt, Pt, Pt];

/** Ngưỡng Otsu trên ảnh xám. */
export const otsu = (gray: Uint8Array): number => {
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = t; }
  }
  return thr;
};

const blur = (src: Uint8Array, w: number, h: number): Uint8Array => {
  const out = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += src[yy * w + xx]; n++; }
    }
    out[y * w + x] = s / n;
  }
  return out;
};

const area = (q: Pt[]): number => {
  let a = 0;
  for (let i = 0; i < q.length; i++) { const p = q[i], n = q[(i + 1) % q.length]; a += p.x * n.y - n.x * p.y; }
  return Math.abs(a) / 2;
};
const isConvex = (q: Quad): boolean => {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(z) < 1e-9) return false;
    if (!sign) sign = Math.sign(z); else if (Math.sign(z) !== sign) return false;
  }
  return true;
};
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Tìm tờ phiếu trên ảnh xám đã thu nhỏ. Trả 4 góc (toạ độ ảnh nhỏ) hoặc null khi:
 * không có vùng sáng đủ lớn, tờ phiếu đã chiếm gần hết ảnh (ảnh scan — không cần cắt) hoặc hình dạng không giống tờ giấy.
 */
export const detectQuad = (grayIn: Uint8Array, w: number, h: number): Quad | null => {
  const gray = blur(blur(grayIn, w, h), w, h);
  // Hai ngưỡng: Otsu toàn ảnh, rồi Otsu trong phần sáng — tách tờ giấy trắng khỏi vật sáng dính vào (tay, bàn sáng).
  const t1 = otsu(gray);
  const upper = gray.filter(v => v > t1);
  const t2 = upper.length > 100 ? otsu(upper) : t1;
  let best: { q: Quad; fit: number } | null = null;
  for (const thr of t2 > t1 + 8 ? [t1, t2] : [t1]) {
    const r = quadAt(gray, w, h, thr);
    if (r && (!best || r.fit < best.fit)) best = r;
  }
  return best?.q ?? null;
};

const quadAt = (gray: Uint8Array, w: number, h: number, thr: number): { q: Quad; fit: number } | null => {
  const n = w * h;
  const bright = new Uint8Array(n);
  for (let i = 0; i < n; i++) bright[i] = gray[i] > thr ? 1 : 0;

  // Vùng sáng liền lớn nhất (4 hướng).
  const label = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  let bestId = -1, bestSize = 0, id = 0;
  for (let s = 0; s < n; s++) {
    if (!bright[s] || label[s] !== -1) continue;
    let top = 0, size = 0; stack[top++] = s; label[s] = id;
    while (top) {
      const p = stack[--top]; size++;
      const x = p % w, y = (p - x) / w;
      if (x > 0 && bright[p - 1] && label[p - 1] === -1) { label[p - 1] = id; stack[top++] = p - 1; }
      if (x < w - 1 && bright[p + 1] && label[p + 1] === -1) { label[p + 1] = id; stack[top++] = p + 1; }
      if (y > 0 && bright[p - w] && label[p - w] === -1) { label[p - w] = id; stack[top++] = p - w; }
      if (y < h - 1 && bright[p + w] && label[p + w] === -1) { label[p + w] = id; stack[top++] = p + w; }
    }
    if (size > bestSize) { bestSize = size; bestId = id; }
    id++;
  }
  if (bestId < 0 || bestSize < n * 0.12) return null;

  // Lấp lỗ (chữ, bảng kẻ trên phiếu): những điểm không thông ra mép ảnh qua vùng ngoài tờ giấy đều thuộc tờ giấy.
  const outside = new Uint8Array(n);
  let top = 0;
  const push = (p: number) => { if (!outside[p] && label[p] !== bestId) { outside[p] = 1; stack[top++] = p; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (top) {
    const p = stack[--top]; const x = p % w, y = (p - x) / w;
    if (x > 0) push(p - 1); if (x < w - 1) push(p + 1); if (y > 0) push(p - w); if (y < h - 1) push(p + w);
  }
  let filled = 0;
  let tl = { x: 0, y: 0, v: Infinity }, br = { x: 0, y: 0, v: -Infinity }, tr = { x: 0, y: 0, v: -Infinity }, bl = { x: 0, y: 0, v: Infinity };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (outside[y * w + x]) continue;
    filled++;
    const s = x + y, d = x - y;
    if (s < tl.v) tl = { x, y, v: s };
    if (s > br.v) br = { x, y, v: s };
    if (d > tr.v) tr = { x, y, v: d };
    if (d < bl.v) bl = { x, y, v: d };
  }
  const q: Quad = [{ x: tl.x, y: tl.y }, { x: tr.x + 1, y: tr.y }, { x: br.x + 1, y: br.y + 1 }, { x: bl.x, y: bl.y + 1 }];
  const qa = area(q);
  if (!isConvex(q) || qa < n * 0.12) return null;
  // Vùng giấy phải lấp gần kín tứ giác (loại vùng sáng méo: đèn, cửa sổ, tay áo…).
  const fill = filled / qa;
  if (fill < 0.9 || fill > 1.1) return null;
  // Tờ phiếu chiếm gần hết ảnh → ảnh đã gọn, không cắt.
  if (qa > n * 0.93) return null;
  // Cạnh quá ngắn so với cạnh đối diện → góc chụp quá xiên, để thủ kho chỉnh tay.
  const ratio = Math.min(dist(q[0], q[1]), dist(q[3], q[2])) / Math.max(dist(q[0], q[1]), dist(q[3], q[2]));
  const ratio2 = Math.min(dist(q[0], q[3]), dist(q[1], q[2])) / Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  if (ratio < 0.5 || ratio2 < 0.5) return null;
  return { q, fit: Math.abs(1 - fill) };
};

/** Ma trận homography 3×3 (8 hệ số, h33 = 1) biến 4 điểm src → dst. */
export const homography = (src: Quad, dst: Quad): number[] => {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i], { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Khử Gauss có chọn trụ.
  for (let c = 0; c < 8; c++) {
    let piv = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  return [...A.map((row, i) => row[8] / row[i]), 1];
};
export const applyH = (H: number[], p: Pt): Pt => {
  const d = H[6] * p.x + H[7] * p.y + H[8];
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / d, y: (H[3] * p.x + H[4] * p.y + H[5]) / d };
};

/** Kích thước ảnh sau khi làm phẳng: theo cạnh dài nhất của tứ giác, giới hạn cạnh dài `max` px. */
export const outputSize = (q: Quad, max = 2000) => {
  const w = Math.max(dist(q[0], q[1]), dist(q[3], q[2]));
  const h = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
};

/** Làm phẳng: với mỗi điểm ảnh đích lấy mẫu song tuyến tính ở ảnh gốc (ánh xạ ngược). */
export const warpQuad = (src: { data: Uint8ClampedArray; width: number; height: number }, q: Quad, out: { w: number; h: number }): Uint8ClampedArray => {
  const { w, h } = out;
  const H = homography([{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], q);
  const dst = new Uint8ClampedArray(w * h * 4);
  const sw = src.width, sh = src.height, s = src.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = H[6] * (x + 0.5) + H[7] * (y + 0.5) + H[8];
      let fx = (H[0] * (x + 0.5) + H[1] * (y + 0.5) + H[2]) / d - 0.5;
      let fy = (H[3] * (x + 0.5) + H[4] * (y + 0.5) + H[5]) / d - 0.5;
      fx = Math.min(Math.max(fx, 0), sw - 1.001); fy = Math.min(Math.max(fy, 0), sh - 1.001);
      const x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        dst[o + c] = (s[i00 + c] * (1 - ax) + s[i10 + c] * ax) * (1 - ay) + (s[i01 + c] * (1 - ax) + s[i11 + c] * ax) * ay;
      }
      dst[o + 3] = 255;
    }
  }
  return dst;
};

/** RGBA → xám (BT.601). */
export const toGray = (rgba: Uint8ClampedArray, w: number, h: number): Uint8Array => {
  const g = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114) / 1000;
  return g;
};
