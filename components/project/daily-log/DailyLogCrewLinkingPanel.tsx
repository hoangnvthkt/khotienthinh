import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Link2, Loader2, Unlink, Users } from 'lucide-react';
import { dailyLogWbsService } from '../../../lib/projectService';
import type { DailyLogCrewLaborLinks } from '../../../types';

interface Props { projectId: string; constructionSiteId?: string | null }

const num = (value: number) => Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 1 });
const shortDate = (value?: string | null) => value ? new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString('vi-VN') : '';
const fieldClass = 'h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';

// QS links engineers' crew labor to a labor subcontract line (batch 2C-2).
// Hidden for people without Room quantity_acceptance "edit" (the list is refused).
export function DailyLogCrewLinkingPanel({ projectId, constructionSiteId }: Props) {
  const [data, setData] = useState<DailyLogCrewLaborLinks | null>(null);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lineId, setLineId] = useState('');
  const [reason, setReason] = useState('');
  const [unlinking, setUnlinking] = useState<{ id: string; reason: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await dailyLogWbsService.listCrewLaborLinks({ projectId, constructionSiteId }));
      setError(null);
    } catch (caught) {
      const code = (caught as { code?: string })?.code;
      if (code === 'DAILY_LOG_CONTRACT_LINK_DENIED' || /42501/.test(String((caught as Error)?.message))) setDenied(true);
      else setError(caught instanceof Error ? caught.message : 'Không tải được danh sách nhân công.');
    }
  }, [projectId, constructionSiteId]);
  useEffect(() => { load(); }, [load]);

  const groups = data?.pending || [];
  const chosen = useMemo(() => groups.filter(group => selected.has(group.key)), [groups, selected]);
  const chosenLines = chosen.reduce((sum, group) => sum + group.lines, 0);
  if (denied || (!data && !error)) return null;

  const link = async () => {
    if (!lineId || chosen.length === 0) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await dailyLogWbsService.linkLaborToContract({ projectId, constructionSiteId, lineIds: chosen.flatMap(group => group.lineIds), contractItemId: lineId, reason });
      setNotice(`Đã ghép ${result.linked} dòng nhân công vào hợp đồng.`);
      setSelected(new Set()); setReason('');
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Không ghép được.'); }
    finally { setBusy(false); }
  };
  const unlink = async (lineIds: string[]) => {
    if (!unlinking?.reason.trim()) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await dailyLogWbsService.unlinkLaborContract({ projectId, constructionSiteId, lineIds, reason: unlinking.reason });
      setNotice(`Đã bỏ ghép ${result.unlinked} dòng; chúng quay lại danh sách chờ.`);
      setUnlinking(null);
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Không bỏ ghép được.'); }
    finally { setBusy(false); }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white dark:border-slate-700/60 dark:bg-slate-800" aria-label="Nhân công chờ gắn hợp đồng">
      <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left">
        <span className="flex items-center gap-2">
          <Users size={16} className="text-teal-600" aria-hidden />
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Nhân công từ nhật ký chờ gắn hợp đồng</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${groups.length ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'}`}>
            {groups.length ? `${groups.length} tổ chờ ghép` : 'Đã ghép hết'}
          </span>
        </span>
        <ChevronDown size={16} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && <div className="space-y-4 border-t border-slate-100 px-5 py-4 dark:border-slate-700/60">
        <p className="text-sm text-slate-600 dark:text-slate-300">Chọn các nhóm là cùng một tổ, chọn dòng công nhật trong hợp đồng giao khoán rồi bấm Ghép. Chỉ dòng đã ghép và nằm trong nhật ký CHT đã duyệt mới được tính khi nghiệm thu theo công.</p>
        {error && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{error}</p>}
        {notice && <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">{notice}</p>}

        {groups.length === 0 ? <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700">Không còn nhân công nào chờ ghép. Dòng chỉ ghi chung "Tổ đội" không xác định được tổ nên không hiện ở đây.</p> : <>
          <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
            {groups.map(group => (
              <li key={group.key}>
                <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-900/60">
                  <input type="checkbox" className="mt-1" checked={selected.has(group.key)}
                    onChange={event => setSelected(current => { const next = new Set(current); if (event.target.checked) next.add(group.key); else next.delete(group.key); return next; })} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">{group.names.join(' · ')}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                      {group.lines} dòng · {num(group.people)} lượt người · {num(group.laborHours)} giờ công{group.firstDate ? ` · ${shortDate(group.firstDate)}${group.lastDate && group.lastDate !== group.firstDate ? ` – ${shortDate(group.lastDate)}` : ''}` : ''}{group.legacyLines ? ` · gồm ${group.legacyLines} dòng nhật ký cũ` : ''}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {data!.contractLines.length === 0
            ? <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">Dự án chưa có hợp đồng giao khoán nào có dòng công việc. Nhờ bộ phận hợp đồng nhập dòng (đơn vị "công") trước khi ghép.</p>
            : <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] md:items-end">
              <label className="grid gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">Ghép vào dòng hợp đồng
                <select value={lineId} onChange={event => setLineId(event.target.value)} className={fieldClass}>
                  <option value="">Chọn hợp đồng và dòng công việc</option>
                  {data!.contractLines.map(line => <option key={line.id} value={line.id}>{[line.contractCode, line.crewName].filter(Boolean).join(' · ')} — {[line.code, line.name].filter(Boolean).join(' ')}{line.unit ? ` (${line.unit})` : ''}</option>)}
                </select>
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300"><span>Ghi chú <span className="font-normal text-slate-400">(không bắt buộc)</span></span>
                <input value={reason} onChange={event => setReason(event.target.value)} className={fieldClass} placeholder="Ví dụ: xác nhận với CHT" />
              </label>
              <button type="button" onClick={link} disabled={busy || !lineId || chosen.length === 0}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Link2 size={15} aria-hidden />}
                {chosenLines ? `Ghép ${chosenLines} dòng` : 'Ghép'}
              </button>
            </div>}
        </>}

        {data!.linked.length > 0 && <details className="rounded-xl border border-slate-200 dark:border-slate-700">
          <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200">Đã ghép ({data!.linked.length} dòng hợp đồng)</summary>
          <ul className="divide-y divide-slate-100 dark:divide-slate-700">
            {data!.linked.map(group => (
              <li key={group.contractItemId} className="space-y-2 px-3 py-2.5 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 dark:text-slate-100">{[group.contractCode, group.crewName].filter(Boolean).join(' · ')} — {[group.lineCode, group.lineName].filter(Boolean).join(' ')}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{group.lines} dòng · {num(group.people)} lượt người · {num(group.laborHours)} giờ công · tên trong nhật ký: {group.names.join(', ')}</p>
                  </div>
                  {unlinking?.id !== group.contractItemId && <button type="button" onClick={() => setUnlinking({ id: group.contractItemId, reason: '' })} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 dark:border-slate-600 dark:text-slate-200"><Unlink size={13} aria-hidden />Bỏ ghép</button>}
                </div>
                {unlinking?.id === group.contractItemId && <div className="flex flex-wrap gap-2">
                  <input autoFocus value={unlinking.reason} onChange={event => setUnlinking({ id: group.contractItemId, reason: event.target.value })} placeholder="Lý do bỏ ghép (bắt buộc)" className={`${fieldClass} flex-1`} />
                  <button type="button" disabled={busy || !unlinking.reason.trim()} onClick={() => unlink(group.lineIds)} className="rounded-xl border border-amber-300 px-3 text-sm font-medium text-amber-900 disabled:opacity-50 dark:text-amber-200">Xác nhận bỏ ghép</button>
                  <button type="button" onClick={() => setUnlinking(null)} className="rounded-xl px-3 text-sm text-slate-600 dark:text-slate-300">Hủy</button>
                </div>}
              </li>
            ))}
          </ul>
        </details>}
      </div>}
    </section>
  );
}
