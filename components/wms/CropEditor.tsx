import React, { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Trash2, Undo2 } from 'lucide-react';
import type { Pt, Quad } from '../../lib/docDetect';

// Chỉnh khung cắt phiếu (chủ SP 16/10): kéo 4 góc theo mép tờ phiếu, hoặc dùng ảnh gốc, hoặc bỏ ảnh.
// Góc hiển thị theo toạ độ ảnh gốc; tay cầm 44 px để chạm dễ trên điện thoại.

const defaultQuad = (w: number, h: number): Quad => [
  { x: w * 0.06, y: h * 0.06 }, { x: w * 0.94, y: h * 0.06 }, { x: w * 0.94, y: h * 0.94 }, { x: w * 0.06, y: h * 0.94 }];

export const CropEditor: React.FC<{
  src: string; width: number; height: number; quad: Quad | null; index: number;
  onApply: (q: Quad) => Promise<void>; onOriginal: () => void; onRemove: () => void; onClose: () => void;
}> = ({ src, width, height, quad, index, onApply, onOriginal, onRemove, onClose }) => {
  const [q, setQ] = useState<Quad>(() => quad || defaultQuad(width, height));
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const drag = useRef<number>(-1);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const measure = () => setBox({ w: img.clientWidth, h: img.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(img); measure();
    return () => ro.disconnect();
  }, []);
  const k = box ? box.w / width : 0;

  const move = (e: React.PointerEvent) => {
    const i = drag.current;
    if (i < 0 || !imgRef.current || !k) return;
    const r = imgRef.current.getBoundingClientRect();
    const p: Pt = { x: Math.min(Math.max((e.clientX - r.left) / k, 0), width), y: Math.min(Math.max((e.clientY - r.top) / k, 0), height) };
    setQ(cur => cur.map((c, j) => j === i ? p : c) as Quad);
  };

  return <div className="absolute inset-0 z-10 flex flex-col bg-black" onPointerMove={move} onPointerUp={() => { drag.current = -1; }} onPointerCancel={() => { drag.current = -1; }}>
    <div className="flex items-center justify-between px-3 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
      <button type="button" onClick={onClose} className="rounded-full bg-white/10 px-3 py-2 text-sm font-semibold">Quay lại</button>
      <p className="text-sm font-semibold">Ảnh {index + 1} · kéo 4 góc theo mép phiếu</p>
      <span className="w-16" />
    </div>
    <div className="grid min-h-0 flex-1 place-items-center overflow-hidden p-4">
      <div className="relative touch-none select-none">
        <img ref={imgRef} src={src} alt="" draggable={false} className="block max-h-[calc(100dvh-12rem)] max-w-full" onLoad={() => imgRef.current && setBox({ w: imgRef.current.clientWidth, h: imgRef.current.clientHeight })} />
        {box && <>
          <svg className="pointer-events-none absolute inset-0" width={box.w} height={box.h}>
            <defs><mask id="crop-mask"><rect width={box.w} height={box.h} fill="white" /><polygon points={q.map(p => `${p.x * k},${p.y * k}`).join(' ')} fill="black" /></mask></defs>
            <rect width={box.w} height={box.h} fill="rgba(0,0,0,0.55)" mask="url(#crop-mask)" />
            <polygon points={q.map(p => `${p.x * k},${p.y * k}`).join(' ')} fill="none" stroke="#52b53a" strokeWidth={2.5} />
          </svg>
          {q.map((p, i) => <span key={i} role="slider" aria-label={`Góc ${i + 1}`} aria-valuenow={Math.round(p.x)}
            onPointerDown={e => { drag.current = i; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); }}
            style={{ left: p.x * k - 22, top: p.y * k - 22 }}
            className="absolute grid h-11 w-11 cursor-grab place-items-center rounded-full">
            <span className="h-5 w-5 rounded-full border-[3px] border-white bg-leaf-500 shadow" /></span>)}
        </>}
      </div>
    </div>
    <div className="grid grid-cols-3 items-center gap-2 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-2">
      <button type="button" onClick={onRemove} className="justify-self-start inline-flex items-center gap-1 text-sm font-semibold text-rose-300"><Trash2 size={15} />Bỏ ảnh</button>
      <button type="button" onClick={onOriginal} className="justify-self-center inline-flex items-center gap-1 rounded-full bg-white/10 px-4 py-2.5 text-sm font-semibold"><Undo2 size={15} />Ảnh gốc</button>
      <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await onApply(q); } finally { setBusy(false); } }}
        className="justify-self-end inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-leaf-600 px-4 py-2.5 text-sm font-semibold disabled:opacity-50">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}Cắt</button>
    </div>
  </div>;
};
