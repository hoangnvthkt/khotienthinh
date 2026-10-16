import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Check, Images, Loader2, X } from 'lucide-react';

// Chụp liên tiếp (chủ SP 16/10): camera trong app, bấm chụp là xong một tấm, chụp tiếp tấm sau rồi bấm Xong.
// Máy không mở được camera trong app (chưa cho quyền, trình duyệt cũ) → dùng camera của máy, mỗi lần một tấm, vẫn chụp tiếp được.
// Hiệu ứng chụp chỉ đổi opacity một lần (không animation lặp — bài học Safari #117).

type Shot = { file: File; url: string };
const IMAGE_ACCEPT = 'image/*,application/pdf';

const grab = (video: HTMLVideoElement): Promise<File | null> => {
  const w = video.videoWidth; const h = video.videoHeight;
  if (!w || !h) return Promise.resolve(null);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(video, 0, 0, w, h);
  return new Promise(resolve => canvas.toBlob(b => resolve(b ? new File([b], `phieu-${Date.now()}.jpg`, { type: 'image/jpeg', lastModified: Date.now() }) : null), 'image/jpeg', 0.9));
};

export const CaptureCamera: React.FC<{ onDone: (files: File[]) => void; onClose: () => void }> = ({ onDone, onClose }) => {
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
  useEffect(() => () => shotsRef.current.forEach(s => URL.revokeObjectURL(s.url)), []);

  const add = useCallback((files: File[]) => {
    if (!files.length) return;
    setShots(list => [...list, ...files.map(file => ({ file, url: file.type.startsWith('image/') ? URL.createObjectURL(file) : '' }))]);
  }, []);
  const shoot = async () => {
    const v = videoRef.current;
    if (!v || busy) return;
    setBusy(true);
    setFlash(true); setTimeout(() => setFlash(false), 120);
    try { const f = await grab(v); if (f) add([f]); } finally { setBusy(false); }
  };
  const [pick, setPick] = useState(-1);
  const remove = (i: number) => { setPick(-1); setShots(list => { const s = list[i]; if (s?.url) URL.revokeObjectURL(s.url); return list.filter((_, j) => j !== i); }); };
  const finish = () => { const files = shots.map(s => s.file); setShots([]); onDone(files); };
  const pickFiles = (e: React.ChangeEvent<HTMLInputElement>) => { const list = Array.from(e.target.files || []); e.target.value = ''; add(list); };

  // Đã chụp mà bấm đóng: hỏi lại, tránh mất ảnh.
  const close = useCallback(() => { if (shotsRef.current.length) setLeaving(true); else onClose(); }, [onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  return createPortal(<div className="fixed inset-0 z-[300] flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label="Chụp phiếu giao">
    <div className="flex items-center justify-between px-3 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
      <button type="button" onClick={close} className="grid h-10 w-10 place-items-center rounded-full bg-white/10" aria-label="Đóng"><X size={20} /></button>
      <p className="text-sm font-semibold">{shots.length ? `Đã chụp ${shots.length}` : 'Chụp phiếu giao'}</p>
      <span className="w-10" />
    </div>

    <div className="relative min-h-0 flex-1 overflow-hidden">
      <video ref={videoRef} playsInline muted autoPlay className={`h-full w-full object-contain ${cam === 'live' ? '' : 'hidden'}`} />
      {cam === 'live' && <div className="pointer-events-none absolute inset-[6%] rounded-2xl border-2 border-dashed border-white/50" />}
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
      <button key={s.url || i} type="button" onClick={() => (pick === i ? remove(i) : setPick(i))} aria-label={pick === i ? `Bỏ ảnh ${i + 1}` : `Ảnh ${i + 1}`}
        className="relative h-[4.5rem] w-14 shrink-0 overflow-hidden rounded-md border border-white/30 bg-white/10">
        {s.url ? <img src={s.url} alt="" className="h-full w-full object-cover" /> : <span className="grid h-full place-items-center text-[10px]">PDF</span>}
        <span className="absolute left-0 top-0 rounded-br-md bg-black/60 px-1 text-[10px] font-semibold tabular-nums">{i + 1}</span>
        {pick === i && <span className="absolute inset-0 grid place-items-center bg-rose-600/80 text-[11px] font-semibold"><X size={16} />Bỏ</span>}
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
    <input ref={nativeRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={pickFiles} />
    <input ref={albumRef} type="file" accept={IMAGE_ACCEPT} multiple className="sr-only" onChange={pickFiles} />
  </div>, document.body);
};
