import React, { useMemo, useState } from 'react';
import { CircleDollarSign, Edit2, Loader2, Save } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { buildProjectActualProductionUpdate } from '../../lib/projectActualProduction';

// Chốt sản lượng thực tế (giá trị đã thực hiện) — chuyển từ tab Tài chính của Dự án sang Chốt tiến độ (chủ SP duyệt doc 14 câu 3, 05/10/2026).
// Dữ liệu và cách lưu giữ nguyên như trước (project_finances.actualProductionValue); dùng cho "tiến độ theo giá trị".

const fmtMoney = (value: number) => `${Math.round(Number(value || 0)).toLocaleString('vi-VN')} đ`;
const parseMoneyInput = (value: string): number => { const n = Number(value.replace(/[^\d]/g, '')); return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0; };

export const ActualProductionCard: React.FC<{ projectId: string; constructionSiteId: string; contractValue: number; canEdit: boolean }> = ({ projectId, constructionSiteId, contractValue, canEdit }) => {
  const { projectFinances, addProjectFinance, updateProjectFinance, user, users } = useApp();
  const toast = useToast();
  const current = useMemo(() => projectFinances.find(f => projectId && f.projectId === projectId) || projectFinances.find(f => f.constructionSiteId === constructionSiteId) || null,
    [constructionSiteId, projectFinances, projectId]);
  const updater = useMemo(() => users.find(u => u.id === current?.actualProductionUpdatedBy), [current?.actualProductionUpdatedBy, users]);
  const [form, setForm] = useState<{ value: string; note: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const value = current?.actualProductionValue || 0;
  const save = async () => {
    if (!form || saving) return;
    const amount = parseMoneyInput(form.value);
    if (amount <= 0) { toast.error('Chưa chốt được sản lượng', 'Nhập giá trị sản lượng đã thực hiện (lớn hơn 0).'); return; }
    setSaving(true);
    try {
      const next = buildProjectActualProductionUpdate({ current, projectId, constructionSiteId, value: amount, note: form.note, actorId: user.id,
        updatedAt: new Date().toISOString(), newId: crypto.randomUUID() });
      if (current) await updateProjectFinance(next); else await addProjectFinance(next);
      setForm(null);
      toast.success('Đã chốt sản lượng thực tế', `${fmtMoney(next.actualProductionValue || 0)} — dùng cho tiến độ theo giá trị.`);
    } catch (err) {
      toast.error('Không chốt được sản lượng thực tế', err instanceof Error ? err.message : 'Vui lòng thử lại.');
    } finally { setSaving(false); }
  };
  return <section className="rounded-2xl border border-teal-200 bg-gradient-to-br from-teal-50 to-white p-4 shadow-sm dark:border-teal-900/70 dark:from-teal-950/40 dark:to-zinc-900">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-teal-200 bg-white text-teal-700 dark:border-teal-900 dark:bg-zinc-900"><CircleDollarSign size={19} /></span>
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-wider text-teal-700 dark:text-teal-400">Sản lượng thực tế đã chốt</div>
          <div className="mt-1 text-2xl font-black text-zinc-900 dark:text-white">{value ? fmtMoney(value) : <span className="text-base text-zinc-500">Chưa chốt</span>}</div>
          <div className="mt-1 text-xs font-semibold text-zinc-500">Giá trị hợp đồng: {contractValue > 0 ? fmtMoney(contractValue) : 'chưa có'}
            {contractValue > 0 && value > 0 ? ` · ${Math.min(100, Math.round(value * 100 / contractValue))}% theo giá trị` : ''}</div>
          {current?.actualProductionNote && <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">{current.actualProductionNote}</p>}
          {current?.actualProductionUpdatedAt && <p className="mt-1 text-[11px] text-zinc-400">Chốt lúc {new Date(current.actualProductionUpdatedAt).toLocaleString('vi-VN')}
            {current.actualProductionUpdatedBy ? ` bởi ${updater?.name || current.actualProductionUpdatedBy}` : ''}</p>}
        </div>
      </div>
      {canEdit && !form && <button type="button" onClick={() => setForm({ value: value ? String(value) : '', note: current?.actualProductionNote || '' })}
        className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-teal-700 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-teal-800">
        <Edit2 size={14} />{current?.actualProductionUpdatedAt ? 'Cập nhật sản lượng' : 'Chốt sản lượng'}</button>}
    </div>
    {canEdit && form && <div className="mt-4 grid gap-3 border-t border-teal-200 pt-4 dark:border-teal-900/70 lg:grid-cols-[minmax(220px,0.7fr)_minmax(280px,1.3fr)_auto] lg:items-end">
      <label className="block"><span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-zinc-500">Giá trị sản lượng (VNĐ)</span>
        <input type="text" inputMode="numeric" autoFocus value={form.value} onChange={e => setForm(f => f ? { ...f, value: e.target.value } : f)} placeholder="Nhập giá trị đã thực hiện"
          className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm font-bold text-zinc-900 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white" /></label>
      <label className="block"><span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-zinc-500">Ghi chú chốt</span>
        <input type="text" value={form.note} onChange={e => setForm(f => f ? { ...f, note: e.target.value } : f)} placeholder="Ví dụ: Khối lượng xác nhận đến tuần 32"
          className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white" /></label>
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={() => setForm(null)} disabled={saving} className="rounded-xl border border-zinc-200 px-3 py-2.5 text-xs font-bold text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300">Huỷ</button>
        <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-1.5 rounded-xl bg-teal-700 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-teal-800 disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}Lưu chốt</button>
      </div>
    </div>}
  </section>;
};
