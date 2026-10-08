import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Hash, Loader2, X } from 'lucide-react';
import { StateBox, inputCls, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { useToast } from '../../context/ToastContext';
import {
  INVENTORY_MODE_HINTS, INVENTORY_MODE_LABELS, catalogErrorMessage, catalogNameKey, guessInventoryMode, wmsCatalogService,
  type CatalogCreateOptions, type CatalogItem, type InventoryMode,
} from '../../lib/wmsCatalogService';

// Tạo vật tư mới ngay, không qua bước đề xuất mã (chủ SP 08/10/2026): ô quyền nhạy cảm "Tạo mã vật tư" (Admin luôn có).
// Dùng ở Danh mục vật tư và ô "Thêm vật tư" của đơn chủ động. Hộp thoại giữa màn hình, nằm trên ngăn đang mở:
// Esc chỉ đóng hộp thoại, không đóng ngăn bên dưới.

export interface SimilarItem { id: string; sku: string | null; name: string; unit: string | null }
const MODES: InventoryMode[] = ['stock', 'use', 'service'];

export function QuickCreateItemDialog<T extends SimilarItem>({ initialName = '', findSimilar, useExistingLabel = 'Dùng mã này', onUseExisting, onClose, onCreated }: {
  initialName?: string;
  /** Mã gần giống theo tên đang gõ (từ 3 ký tự). */
  findSimilar?: (name: string) => Promise<T[]> | T[];
  useExistingLabel?: string;
  onUseExisting?: (item: T) => void;
  onClose: () => void;
  onCreated: (item: CatalogItem) => void;
}) {
  const toast = useToast();
  const [opts, setOpts] = useState<CatalogCreateOptions | null>(null);
  const [loadError, setLoadError] = useState('');
  const [f, setF] = useState({ name: initialName.trim(), category: '', unit: '', altUnit: false, purchaseUnit: '', factor: '1' });
  const [mode, setMode] = useState<InventoryMode | null>(null);
  const [similar, setSimilar] = useState<T[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const findRef = useRef(findSimilar);
  findRef.current = findSimilar;

  const load = () => { setLoadError(''); wmsCatalogService.createOptions().then(setOpts).catch(e => setLoadError(catalogErrorMessage(e, 'Chưa tải được danh sách nhóm, đơn vị.'))); };
  useEffect(load, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  useEffect(() => {
    const name = f.name.trim();
    if (!findRef.current || name.length < 3) { setSimilar([]); return; }
    let alive = true;
    const t = setTimeout(() => { Promise.resolve(findRef.current!(name)).then(r => alive && setSimilar(r.slice(0, 5))).catch(() => alive && setSimilar([])); }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [f.name]);

  const exact = similar.find(s => catalogNameKey(s.name) === catalogNameKey(f.name));
  const effectiveMode = mode || guessInventoryMode(f.name, f.unit, f.category);
  const factor = Number(f.factor.replace(',', '.'));
  const missing = !f.name.trim() ? 'Nhập tên vật tư' : !f.category ? 'Chọn nhóm' : !f.unit ? 'Chọn đơn vị tính kho'
    : f.altUnit && !f.purchaseUnit ? 'Chọn đơn vị mua' : f.altUnit && !(factor > 0) ? 'Hệ số quy đổi phải lớn hơn 0' : exact ? `Đã có mã ${exact.sku || ''} trùng tên` : '';

  const submit = async () => {
    if (missing) { setError(missing); return; }
    setBusy(true); setError('');
    try {
      const item = await wmsCatalogService.issue({ name: f.name.trim(), category: f.category, unit: f.unit, inventoryMode: effectiveMode,
        purchaseUnit: f.altUnit ? f.purchaseUnit : null, purchaseConversionFactor: f.altUnit ? factor : 1, reason: 'Tạo nhanh, không qua đề xuất mã' });
      toast.success(`Đã tạo mã ${item.sku}`, `“${item.name}” dùng được ngay ở mọi màn.`);
      onCreated(item);
    } catch (e) { setError(catalogErrorMessage(e, 'Chưa tạo được mã.')); } finally { setBusy(false); }
  };

  return <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Tạo vật tư mới">
    <button type="button" aria-label="Đóng" onClick={onClose} className="absolute inset-0 bg-slate-950/50" />
    <div className="relative flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-background shadow-2xl sm:rounded-2xl">
      <header className="flex items-start gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">Danh mục vật tư</p>
          <h2 className="text-lg font-bold text-foreground">Tạo vật tư mới</h2>
          <p className="text-sm text-muted-foreground">Mã tự sinh VT + số tiếp theo, dùng được ngay. Không cần chờ duyệt đề xuất.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Đóng" className="rounded-lg p-2 text-muted-foreground hover:bg-muted"><X size={18} /></button>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {loadError ? <StateBox kind="error" message={loadError} onRetry={load} />
          : !opts ? <StateBox kind="loading" title="Đang tải nhóm, đơn vị…" />
          : !opts.canCreate ? <StateBox kind="denied" message='Tạo mã cần ô quyền nhạy cảm "Tạo mã vật tư" — nhờ Admin cấp. Bạn vẫn gửi được Đề xuất mã mới ở Vật tư → Danh mục.' />
          : <>
            <label className="block text-sm font-medium">Tên vật tư
              <input autoFocus value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))} placeholder="VD: Thép hình chấn U250x250x10"
                className={`mt-1 w-full ${inputCls} ${exact ? 'border-rose-400 ring-2 ring-rose-400/30' : ''}`} /></label>
            {similar.length > 0 && <section className={`rounded-xl border p-3 text-sm ${exact ? 'border-rose-300 bg-rose-50/80 dark:bg-rose-950/30' : 'border-amber-300 bg-amber-50/70 dark:bg-amber-950/30'}`}>
              <p className={`flex items-center gap-1.5 font-semibold ${exact ? 'text-rose-800 dark:text-rose-200' : 'text-amber-900 dark:text-amber-200'}`}><AlertTriangle size={14} />
                {exact ? 'Đã có mã trùng tên — dùng mã đó, không tạo mới' : 'Có thể đã có — kiểm tra trước khi tạo'}</p>
              <ul className="mt-2 space-y-1.5">{similar.map(s => <li key={s.id} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1"><b className="text-mint-700 dark:text-mint-300">{s.sku || '—'}</b> · {s.name} <span className="text-xs text-muted-foreground">({s.unit || '—'})</span></span>
                {onUseExisting && <button type="button" onClick={() => onUseExisting(s)} className="rounded-lg border border-border bg-card px-2 py-1 text-xs font-semibold hover:bg-muted">{useExistingLabel}</button>}
              </li>)}</ul>
            </section>}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium">Nhóm
                <select value={f.category} onChange={e => setF(x => ({ ...x, category: e.target.value }))} className={`mt-1 w-full ${inputCls}`}>
                  <option value="">Chọn…</option>{opts.categories.map(c => <option key={c}>{c}</option>)}</select></label>
              <label className="text-sm font-medium">Đơn vị tính kho
                <select value={f.unit} onChange={e => setF(x => ({ ...x, unit: e.target.value }))} className={`mt-1 w-full ${inputCls}`}>
                  <option value="">Chọn…</option>{opts.units.map(u => <option key={u}>{u}</option>)}</select></label>
            </div>
            {f.altUnit ? <div className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-2">
              <label className="text-sm font-medium">Đơn vị mua
                <select value={f.purchaseUnit} onChange={e => setF(x => ({ ...x, purchaseUnit: e.target.value }))} className={`mt-1 w-full ${inputCls}`}>
                  <option value="">Chọn…</option>{opts.units.filter(u => u !== f.unit).map(u => <option key={u}>{u}</option>)}</select></label>
              <label className="text-sm font-medium">1 {f.purchaseUnit || 'ĐV mua'} = ? {f.unit || 'ĐVT kho'}
                <input inputMode="decimal" value={f.factor} onChange={e => setF(x => ({ ...x, factor: e.target.value }))} className={`mt-1 w-full text-right tabular-nums ${inputCls}`} /></label>
              <button type="button" onClick={() => setF(x => ({ ...x, altUnit: false, purchaseUnit: '', factor: '1' }))} className="text-left text-xs font-semibold text-muted-foreground hover:underline sm:col-span-2">Bỏ, mua theo đơn vị kho</button>
            </div>
              : <button type="button" onClick={() => setF(x => ({ ...x, altUnit: true }))} className="text-xs font-semibold text-teal-700 hover:underline dark:text-teal-300">+ Mua theo đơn vị khác (VD mua kg, kho tính cây)</button>}
            <div>
              <p className="text-sm font-medium">Cách quản lý kho <span className="font-normal text-muted-foreground">{mode ? '' : '· gợi ý theo tên, đổi được'}</span></p>
              <div className="mt-1 grid gap-2 sm:grid-cols-3">{MODES.map(m =>
                <label key={m} className={`cursor-pointer rounded-xl border px-3 py-2 text-sm ${effectiveMode === m ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-border'}`}>
                  <input type="radio" className="mr-1.5" checked={effectiveMode === m} onChange={() => setMode(m)} /><b>{INVENTORY_MODE_LABELS[m]}</b>
                  <span className="block text-xs text-muted-foreground">{INVENTORY_MODE_HINTS[m]}</span></label>)}</div>
            </div>
            <p className="text-xs text-muted-foreground">Khác kích thước, khác giá hoặc khác hệ số quy đổi với mã có sẵn → mã mới. Chỉ khác thương hiệu, màu, xuất xứ → dùng mã có sẵn và ghi ở quy cách.</p>
          </>}
      </div>
      {opts?.canCreate && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
        {error && <p role="alert" className="mr-auto flex items-center gap-1.5 text-sm text-rose-700 dark:text-rose-300"><AlertTriangle size={15} />{error}</p>}
        <button type="button" onClick={onClose} className={secondaryBtn}>Hủy</button>
        <button type="button" onClick={() => void submit()} disabled={busy} title={missing || undefined} className={primaryBtn}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Hash size={15} />}Tạo mã</button>
      </footer>}
    </div>
  </div>;
}

export default QuickCreateItemDialog;
