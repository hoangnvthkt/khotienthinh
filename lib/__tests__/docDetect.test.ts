import { describe, expect, it } from 'vitest';
import { applyH, detectQuad, homography, outputSize, warpQuad, type Pt, type Quad } from '../docDetect';

// Tự cắt khung phiếu (16/10): ảnh giả lập — tờ giấy sáng có chữ, nghiêng, trên nền tối có nhiễu.
const inside = (q: Pt[], x: number, y: number) => {
  let c = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    const a = q[i], b = q[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
};
const scene = (w: number, h: number, q: Pt[] | null, bg = 60, paper = 225) => {
  const g = new Uint8Array(w * h);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const onPaper = q ? inside(q, x + 0.5, y + 0.5) : true;
    // Dòng chữ tối trên phiếu mỗi 9 px.
    const text = onPaper && y % 9 < 2 && x % 13 < 9;
    g[y * w + x] = Math.max(0, Math.min(255, (onPaper ? (text ? 40 : paper) : bg) + (rnd() - 0.5) * 30));
  }
  return g;
};
const near = (a: Pt, b: Pt, tol: number) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;

describe('tìm tờ phiếu trong ảnh', () => {
  it('phiếu nghiêng, phối cảnh trên nền tối → 4 góc đúng thứ tự', () => {
    const truth: Quad = [{ x: 70, y: 60 }, { x: 290, y: 85 }, { x: 300, y: 420 }, { x: 50, y: 400 }];
    const q = detectQuad(scene(360, 480, truth), 360, 480);
    expect(q).not.toBeNull();
    q!.forEach((p, i) => expect(near(p, truth[i], 6)).toBe(true));
  });

  it('ảnh scan kín khung → không cắt', () => {
    expect(detectQuad(scene(360, 480, null), 360, 480)).toBeNull();
  });

  it('vùng sáng nhỏ / méo (đèn) → không cắt', () => {
    expect(detectQuad(scene(360, 480, [{ x: 150, y: 150 }, { x: 200, y: 150 }, { x: 200, y: 200 }, { x: 150, y: 200 }]), 360, 480)).toBeNull();
    const tri = [{ x: 40, y: 40 }, { x: 320, y: 60 }, { x: 60, y: 440 }];
    expect(detectQuad(scene(360, 480, tri), 360, 480)).toBeNull();
  });
});

describe('làm phẳng', () => {
  it('homography đưa đúng 4 góc', () => {
    const src: Quad = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 150 }, { x: 0, y: 150 }];
    const dst: Quad = [{ x: 12, y: 8 }, { x: 210, y: 30 }, { x: 220, y: 330 }, { x: 5, y: 300 }];
    const H = homography(src, dst);
    src.forEach((p, i) => expect(near(applyH(H, p), dst[i], 1e-6)).toBe(true));
  });

  it('cắt đúng vùng giấy: ảnh sau làm phẳng gần như toàn giấy sáng', () => {
    const w = 360, h = 480;
    const truth: Quad = [{ x: 70, y: 60 }, { x: 290, y: 85 }, { x: 300, y: 420 }, { x: 50, y: 400 }];
    const g = scene(w, h, truth, 30, 230);
    const rgba = new Uint8ClampedArray(w * h * 4);
    g.forEach((v, i) => { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255; });
    const q = detectQuad(g, w, h)!;
    const size = outputSize(q);
    const out = warpQuad({ data: rgba, width: w, height: h }, q, size);
    // Viền 3 px ngoài cùng: không còn nền tối.
    let dark = 0, edge = 0;
    for (let y = 0; y < size.h; y++) for (let x = 0; x < size.w; x++) {
      if (x > 3 && y > 3 && x < size.w - 4 && y < size.h - 4) continue;
      edge++; if (out[(y * size.w + x) * 4] < 80) dark++;
    }
    expect(dark / edge).toBeLessThan(0.25);
    expect(size.h).toBeGreaterThan(size.w);
  });
});
