import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Check, Crop, Images, Loader2, X } from 'lucide-react';
import type { Quad } from '../../lib/docDetect';
import { cropToFile, detectIn, loadImage } from '../../lib/docCrop';
import { CropEditor } from './CropEditor';

// Chụp liên tiếp (chủ SP 16/10): camera trong app, bấm chụp là xong một tấm, chụp tiếp tấm sau rồi bấm Xong.
// Máy không mở được camera trong app (chưa cho quyền, trình duyệt cũ) → dùng camera của máy, mỗi lần một tấm, vẫn chụp tiếp được.
// Hiệu ứng chụp chỉ đổi opacity một lần (không animation lặp — bài học Safari #117).
// Tự cắt khung (PR-4): khung xanh bám theo tờ phiếu khi ngắm; chụp xong tự cắt + làm phẳng; chạm ảnh để chỉnh 4 góc / dùng ảnh gốc.

/** file = ảnh gửi đi (đã cắt hoặc gốc); original + quad để chỉnh lại khung. */
type Shot = { file: File; url: string; original: File; quad: Quad | null; w: number; h: number; cropped: boolean };
const IMAGE_ACCEPT = 'image/*,application/pdf';

const grab = (video: HTMLVideoElement): Promise<{ file: File; canvas: HTMLCanvasElement } | null> => {
  const w = video.videoWidth; const h = video.videoHeight;
  if (!w || !h) return Promise.resolve(null);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(video, 0, 0, w, h);
  return new Promise(resolve => canvas.toBlob(b => resolve(b ? { file: new File([b], `phieu-${Date.now()}.jpg`, { type: 'image/jpeg', lastModified: Date.now() }), canvas } : null), 'image/jpeg', 0.92));
};

/** Ảnh vào: tìm tờ phiếu, có thì cắt + làm phẳng; không chắc thì giữ ảnh gốc (thủ kho chỉnh tay sau). */
const toShot = async (original: File, src?: { el: CanvasImageSource; w: number; h: number }): Promise<Shot> => {
  const blank = { file: original, url: '', original, quad: null, w: 0, h: 0, cropped: false };
  if (!original.type.startsWith('image/')) return blank;
  try {
    const s = src || await loadImage(original).then(img => ({ el: img as CanvasImageSource, w: img.naturalWidth, h: img.naturalHeight }));
    const quad = detectIn(s.el, s.w, s.h);
    const file = quad ? await cropToFile(s.el, s.w, s.h, quad, original.name) : original;
    return { file, url: URL.createObjectURL(file), original, quad, w: s.w, h: s.h, cropped: !!quad };
  } catch { return { ...blank, url: URL.createObjectURL(original) }; }
};

/** title: nhãn đầu màn (Kho: "Chụp phiếu giao"; Đề xuất: "Chụp phiếu đề xuất"). */
export const CaptureCamera: React.FC<{ onDone: (files: File[]) => void; onClose: () => void; title?: string }> = ({ onDone, onClose, title = 'Chụp phiếu giao' }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nativeRef = useRef<HTMLInputElement>(null);
  const albumRef = useRef<HTMLInputElement>(null);
  const [cam, setCam] = useState<'starting' | 'live' | 'native'>('starting');
  const [camErr, setCamErr] = useState('');
  const [shots, setShots] = useState<Shot[]>([]);
  const [flash, setFlash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const shotsRef = useRef(shots);
  shotsRef.current = shots;
  const [edit, setEdit] = useState<{ i: number; src: string } | null>(null);
  // Khung xanh khi ngắm: tìm tờ phiếu ~2,5 lần/giây trên bản thu nhỏ của khung hình.
  const [liveQuad, setLiveQuad] = useState<Quad | null>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (cam !== 'live' || edit) { setLiveQuad(null); return; }
    const scratch = document.createElement('canvas');
    const t = setInterval(() => {
      const v = videoRef.current;
      if (!v || document.hidden || !v.videoWidth) return;
      setView({ w: v.clientWidth, h: v.clientHeight });
      setLiveQuad(detectIn(v, v.videoWidth, v.videoHeight, scratch));
    }, 400);
    return () => clearInterval(t);
  }, [cam, edit]);

  useEffect(() => {
    let live = true;
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) { setCam('native'); return; }
    md.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } } })
      .then(stream => {
        if (!live) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) { v.srcObject = stream; void v.play().catch(() => undefined); }
        setCam('live');
      })
      .catch((e: { name?: string }) => {
        if (!live) return;
        setCamErr(e?.name === 'NotAllowedError' ? 'Chưa cho phép camera' : 'Không mở được camera trong app');
        setCam('native');
      });
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      live = false;
      streamRef.current?.getTracks().forEach(t => t.stop());
      document.body.style.overflow = prev;
    };
  }, []);
  // Thu hồi ảnh xem trước khi đóng.
  useEffect(() => () => shotsRef.current.forEach(s => s.url && URL.revokeObjectURL(s.url)), []);

  const add = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    try { for (const f of files) { const shot = await toShot(f); setShots(list => [...list, shot]); } } finally { setBusy(false); }
  }, []);
  const shoot = async () => {
    const v = videoRef.current;
    if (!v || busy) return;
    setBusy(true);
    setFlash(true); setTimeout(() => setFlash(false), 120);
    try {
      const g = await grab(v);
      if (g) { const shot = await toShot(g.file, { el: g.canvas, w: g.canvas.width, h: g.canvas.height }); setShots(list => [...list, shot]); }
    } finally { setBusy(false); }
  };
  const replace = (i: number, next: Shot) => setShots(list => list.map((s, j) => { if (j !== i) return s; if (s.url && s.url !== next.url) URL.revokeObjectURL(s.url); return next; }));
  const remove = (i: number) => setShots(list => { const s = list[i]; if (s?.url) URL.revokeObjectURL(s.url); return list.filter((_, j) => j !== i); });
  const openEdit = async (i: number) => {
    const s = shots[i];
    if (!s?.original.type.startsWith('image/')) return;
    if (!s.w) { try { const img = await loadImage(s.original); replace(i, { ...s, w: img.naturalWidth, h: img.naturalHeight }); } catch { return; } }
    setEdit({ i, src: URL.createObjectURL(s.original) });
  };
  const closeEdit = () => setEdit(e => { if (e) URL.revokeObjectURL(e.src); return null; });
  const applyCrop = async (q: Quad) => {
    if (!edit) return;
    const s = shots[edit.i];
    const img = await loadImage(s.original);
    const file = await cropToFile(img, img.naturalWidth, img.naturalHeight, q, s.original.name);
    replace(edit.i, { ...s, file, url: URL.createObjectURL(file), quad: q, w: img.naturalWidth, h: img.naturalHeight, cropped: true });
    closeEdit();
  };
  const keepOriginal = () => {
    if (!edit) return;
    const s = shots[edit.i];
    replace(edit.i, { ...s, file: s.original, url: URL.createObjectURL(s.original), cropped: false });
    closeEdit();
  };
  const finish = () => { const files = shots.map(s => s.file); setShots([]); onDone(files); };
  const pickFiles = (e: React.ChangeEvent<HTMLInputElement>) => { const list = Array.from(e.target.files || []); e.target.value = ''; void add(list); };

  // Đã chụp mà bấm đóng: hỏi lại, tránh mất ảnh.
  const close = useCallback(() => { if (shotsRef.current.length) setLeaving(true); else onClose(); }, [onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  // z-[1200]: nổi trên form Đề xuất vật tư (z-[1000]/[1010]), dưới thông báo (z-[9999]).
  return createPortal(<div className="fixed inset-x-0 inset-y-0 z-[1200] flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label={title}>
    <div className="flex items-center justify-between px-3 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
      <button type="button" onClick={close} className="grid h-10 w-10 place-items-center rounded-full bg-white/10" aria-label="Đóng"><X size={20} /></button>
      <p className="text-sm font-semibold">{shots.length ? `Đã chụp ${shots.length}` : title}</p>
      <span className="w-10" />
    </div>

    <div className="relative min-h-0 flex-1 overflow-hidden">
      <video ref={videoRef} playsInline muted autoPlay className={`h-full w-full object-contain ${cam === 'live' ? '' : 'hidden'}`} />
      {cam === 'live' && !liveQuad && <div className="pointer-events-none absolute inset-[6%] rounded-2xl border-2 border-dashed border-white/50" />}
      {cam === 'live' && liveQuad && view.w > 0 && (() => {
        // Video object-contain: quy toạ độ khung hình → toạ độ trên màn.
        const v = videoRef.current; const vw = v?.videoWidth || 1, vh = v?.videoHeight || 1;
        const k = Math.min(view.w / vw, view.h / vh), ox = (view.w - vw * k) / 2, oy = (view.h - vh * k) / 2;
        return <svg className="pointer-events-none absolute inset-0" width={view.w} height={view.h}>
          <polygon points={liveQuad.map(p => `${ox + p.x * k},${oy + p.y * k}`).join(' ')} fill="rgba(82,181,58,0.18)" stroke="#52b53a" strokeWidth={3} strokeLinejoin="round" />
        </svg>;
      })()}
      {cam === 'live' && <p className={`pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 whitespace-nowrap rounded-full px-3 py-1 text-[12px] font-semibold ${liveQuad ? 'bg-leaf-600' : 'bg-black/60'}`}>
        {liveQuad ? 'Đã thấy phiếu · bấm chụp' : 'Đưa cả tờ phiếu vào khung'}</p>}
      {cam === 'starting' && <Loader2 size={28} className="absolute left-1/2 top-1/2 -ml-3.5 -mt-3.5 animate-spin text-white/70" />}
      {cam === 'native' && <div className="absolute inset-0 grid place-items-center px-6 text-center">
        <div>
          {camErr && <p className="text-sm text-white/70">{camErr}</p>}
          {camErr === 'Chưa cho phép camera' && <p className="mt-0.5 text-[12px] text-white/50">Bật ở Cài đặt → Safari → Camera</p>}
          <button type="button" onClick={() => nativeRef.current?.click()} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-leaf-600 px-5 py-3 font-semibold">
            <Camera size={18} />{shots.length ? 'Chụp tiếp' : 'Mở camera'}</button>
        </div>
      </div>}
      {leaving && <div className="absolute inset-x-3 top-3 rounded-xl bg-white p-3 text-slate-900 shadow-lg">
        <p className="text-sm font-semibold">Bỏ {shots.length} ảnh đã chụp?</p>
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={() => setLeaving(false)} className="flex-1 rounded-lg border border-slate-300 py-2 text-sm font-semibold">Chụp tiếp</button>
          <button type="button" onClick={onClose} className="flex-1 rounded-lg bg-rose-600 py-2 text-sm font-semibold text-white">Bỏ ảnh</button>
        </div></div>}
      <div className={`pointer-events-none absolute inset-0 bg-white transition-opacity duration-100 ${flash ? 'opacity-70' : 'opacity-0'}`} />
    </div>

    {shots.length > 0 && <div className="scrollbar-hide flex gap-2 overflow-x-auto px-3 pt-2">{shots.map((s, i) =>
      <button key={s.url || i} type="button" onClick={() => void openEdit(i)} aria-label={`Ảnh ${i + 1}${s.cropped ? ' · đã cắt khung' : ''} — chỉnh khung`}
        className="relative h-[4.5rem] w-14 shrink-0 overflow-hidden rounded-md border border-white/30 bg-white/10">
        {s.url ? <img src={s.url} alt="" className="h-full w-full object-cover" /> : <span className="grid h-full place-items-center text-[10px]">PDF</span>}
        <span className="absolute left-0 top-0 rounded-br-md bg-black/60 px-1 text-[10px] font-semibold tabular-nums">{i + 1}</span>
        {s.cropped && <span className="absolute bottom-0 right-0 rounded-tl-md bg-leaf-600 p-0.5"><Crop size={10} /></span>}
      </button>)}</div>}

    <div className="grid grid-cols-3 items-center px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
      <button type="button" onClick={() => albumRef.current?.click()} className="justify-self-start inline-flex flex-col items-center gap-0.5 text-[12px] text-white/80" aria-label="Chọn từ album">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-white/10"><Images size={20} /></span>Album</button>
      <button type="button" onClick={() => void (cam === 'live' ? shoot() : nativeRef.current?.click())} disabled={cam === 'starting' || busy} aria-label="Chụp"
        className="justify-self-center grid h-[4.5rem] w-[4.5rem] place-items-center rounded-full border-4 border-white/80 disabled:opacity-50">
        <span className="h-14 w-14 rounded-full bg-white active:scale-90" /></button>
      <button type="button" onClick={finish} disabled={!shots.length} className="justify-self-end inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-leaf-600 px-4 py-2.5 text-sm font-semibold disabled:opacity-40">
        <Check size={16} />Xong{shots.length > 0 && ` (${shots.length})`}</button>
    </div>
    {edit && shots[edit.i] && <CropEditor src={edit.src} width={shots[edit.i].w} height={shots[edit.i].h} quad={shots[edit.i].quad} index={edit.i}
      onApply={applyCrop} onOriginal={keepOriginal} onClose={closeEdit} onRemove={() => { remove(edit.i); closeEdit(); }} />}
    <input ref={nativeRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={pickFiles} />
    <input ref={albumRef} type="file" accept={IMAGE_ACCEPT} multiple className="sr-only" onChange={pickFiles} />
  </div>, document.body);
};
