import React, { useCallback, useEffect, useState } from 'react';
import { CalendarRange, Save } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { financeService, type FinanceCostCutovers } from '../../lib/financeService';
import { StateBox, inputCls, money, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { ENT, NUM, viDate } from './financeUi';

// Mốc chi phí MISA theo dự án: trước mốc chi phí dự án lấy từ MISA; chi phí vật tư Vioo tự sinh trước mốc về 0
// (giữ số gốc để truy vết); nhập file MISA không nhận dòng vật tư từ mốc trở đi.

export const CostCutoverSection: React.FC<{ canManage: boolean }> = ({ canManage }) => {
  const toast = useToast();
  const [data, setData] = useState<FinanceCostCutovers | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ projectId: string; date: string; note: string; reason: string; isNew: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const load = useCallback(() => { setError(null); financeService.costCutovers().then(setData).catch(e => setError(e instanceof Error ? e.message : String(e))); }, []);
  useEffect(load, [load]);
  const save = async (remove = false) => {
    if (!form) return;
    if (!form.projectId || (!remove && !form.date)) { setFormError('Chọn dự án và ngày mốc.'); return; }
    if (!form.reason.trim()) { setFormError('Nhập lý do (VD: kế toán xác nhận MISA đầy đủ đến ngày nào).'); return; }
    setBusy(true); setFormError(null);
    try {
      const r = await financeService.saveCostCutover({ projectId: form.projectId, cutoverDate: remove ? null : form.date, note: form.note.trim() || undefined, reason: form.reason.trim() });
      toast.success('Đã lưu mốc chi phí MISA', `Tổng chi phí dự án ${money(r.expenseBefore)} → ${money(r.expenseAfter)} đ.`);
      setForm(null); load();
    } catch (e) { setFormError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="flex items-center gap-2 font-semibold text-foreground"><CalendarRange size={16} className="text-teal-700" />Mốc chi phí MISA theo dự án</h3>
      {canManage && !form && <button type="button" onClick={() => setForm({ projectId: '', date: '', note: '', reason: '', isNew: true })} className={`${secondaryBtn} ml-auto`}>Thêm mốc</button>}
    </div>
    <p className="mt-1 text-sm text-muted-foreground">Trước mốc: chi phí dự án lấy từ file MISA đã nhập. Từ mốc: Vioo tự ghi chi phí vật tư khi nhận hàng, file MISA không nhập dòng vật tư nữa (chặn tính hai lần).</p>
    {error ? <StateBox kind="error" message={error} onRetry={load} /> : !data ? <StateBox kind="loading" title="Đang tải…" /> : <>
      {data.cutovers.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Chưa dự án nào có mốc.</p>
        : <ul className="mt-2 divide-y divide-border">{data.cutovers.map(c => <li key={c.projectId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
          <span className={ENT}>{c.projectCode}</span><span className="text-muted-foreground">từ</span><b className={NUM}>{viDate(c.cutoverDate)}</b>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={c.note}>{c.note}</span>
          {c.overlapCount > 0 && <span className="text-xs text-amber-800">{c.overlapCount} dòng Vioo trước mốc (đã có trong MISA): {money(c.overlapAmount)} đ</span>}
          {canManage && <button type="button" onClick={() => setForm({ projectId: c.projectId, date: c.cutoverDate, note: c.note, reason: '', isNew: false })} className="text-xs font-semibold text-teal-700 hover:underline">Sửa</button>}
        </li>)}</ul>}
      {form && <div className="mt-3 grid gap-2 rounded-xl border border-border p-3 md:grid-cols-4">
        <select value={form.projectId} disabled={!form.isNew} onChange={e => setForm({ ...form, projectId: e.target.value })} className={inputCls} aria-label="Dự án">
          <option value="">Chọn dự án…</option>{data.projects.map(p => <option key={p.id} value={p.id}>{p.code || p.name}</option>)}</select>
        <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className={inputCls} aria-label="Ngày mốc" />
        <input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="Ghi chú (VD: MISA nhập đến 31/07)" className={inputCls} />
        <input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder="Lý do (bắt buộc)" className={inputCls} />
        {formError && <p role="alert" className="text-sm text-rose-700 md:col-span-4">{formError}</p>}
        <div className="flex flex-wrap justify-end gap-2 md:col-span-4">
          {!form.isNew && <button type="button" disabled={busy} onClick={() => void save(true)} className={`${secondaryBtn} mr-auto text-rose-700`}>Bỏ mốc</button>}
          <button type="button" onClick={() => { setForm(null); setFormError(null); }} className={secondaryBtn}>Thôi</button>
          <button type="button" disabled={busy} onClick={() => void save()} className={primaryBtn}><Save size={15} />Lưu mốc</button>
        </div>
      </div>}
    </>}
  </section>;
};
