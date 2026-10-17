import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Save, Wand2 } from 'lucide-react';
import { StateBox, inputCls, primaryBtn } from '../procurement/hub/hubUi';
import { ENT, moneyInput, parseMoney } from '../finance/financeUi';
import { useToast } from '../../context/ToastContext';
import { isVppConflict, officeSupplyService, vppErrorMessage, type VppSettings } from '../../lib/officeSupplyService';

// Quản trị VPP: người duyệt từng phòng (trưởng phòng) + người duyệt thay, ngưỡng tiền và người duyệt vượt ngưỡng.

type Row = { approverId: string; deputyId: string };

const PersonSelect: React.FC<{ value: string; people: VppSettings['people']; onChange: (v: string) => void; label: string; empty: string }> = ({ value, people, onChange, label, empty }) =>
  <select value={value} onChange={e => onChange(e.target.value)} aria-label={label} className={`w-full ${inputCls} text-[13px]`}>
    <option value="">{empty}</option>
    {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
  </select>;

export const VppSettingsView: React.FC = () => {
  const toast = useToast();
  const [data, setData] = useState<VppSettings | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [message, setMessage] = useState('');
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [threshold, setThreshold] = useState('');
  const [thresholdApprover, setThresholdApprover] = useState('');
  const [fallback, setFallback] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = (s: VppSettings) => {
    setData(s);
    setRows(Object.fromEntries(s.departments.map(d => [d.orgUnitId, { approverId: d.approverId || '', deputyId: d.deputyId || '' }])));
    setThreshold(moneyInput(s.thresholdAmount));
    setThresholdApprover(s.thresholdApproverId || '');
    setFallback(s.fallbackApproverId || '');
  };
  const load = useCallback(async () => {
    setState('loading');
    try { apply(await officeSupplyService.settings()); setState('ready'); }
    catch (e) { setMessage(vppErrorMessage(e)); setState((e as { code?: string })?.code === '42501' ? 'denied' : 'error'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const name = useMemo(() => new Map((data?.people || []).map(p => [p.id, p.name])), [data]);
  const missing = data?.departments.filter(d => !rows[d.orgUnitId]?.approverId).length ?? 0;
  const amount = parseMoney(threshold);
  const dirty = !!data && (amount !== data.thresholdAmount || thresholdApprover !== (data.thresholdApproverId || '') || fallback !== (data.fallbackApproverId || '')
    || data.departments.some(d => rows[d.orgUnitId]?.approverId !== (d.approverId || '') || rows[d.orgUnitId]?.deputyId !== (d.deputyId || '')));
  const problem = !Number.isFinite(amount) || amount < 0 ? 'Ngưỡng tiền chưa hợp lệ'
    : data?.departments.find(d => rows[d.orgUnitId]?.deputyId && rows[d.orgUnitId]?.deputyId === rows[d.orgUnitId]?.approverId)
      ? 'Người duyệt thay phải khác người duyệt' : null;

  const save = async () => {
    if (!data || problem) return;
    setBusy(true);
    try {
      const next = await officeSupplyService.saveSettings({
        expectedRowVersion: data.rowVersion, thresholdAmount: amount, thresholdApproverId: thresholdApprover || null, fallbackApproverId: fallback || null,
        approvers: data.departments.filter(d => rows[d.orgUnitId]?.approverId !== (d.approverId || '') || rows[d.orgUnitId]?.deputyId !== (d.deputyId || ''))
          .map(d => ({ orgUnitId: d.orgUnitId, approverId: rows[d.orgUnitId].approverId || null, deputyId: rows[d.orgUnitId].deputyId || null })),
      });
      apply(next);
      toast.success('Đã lưu thiết lập VPP', 'Phiếu đang chờ duyệt đã chuyển theo người duyệt mới');
    } catch (e) {
      toast.error('Chưa lưu được', vppErrorMessage(e));
      if (isVppConflict(e)) void load();
    } finally { setBusy(false); }
  };

  if (state !== 'ready' || !data) return <StateBox kind={state === 'ready' ? 'loading' : state} title={state === 'denied' ? 'Cần quyền Quản trị VPP' : undefined} message={message} onRetry={state === 'error' ? load : undefined} />;

  return <div className="space-y-4">
    <section className="grid gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm md:grid-cols-3">
      <label className="block text-sm font-semibold">Ngưỡng duyệt thêm (đ)
        <input inputMode="numeric" value={threshold} onChange={e => setThreshold(e.target.value)} onBlur={() => Number.isFinite(amount) && setThreshold(moneyInput(amount))}
          className={`mt-1 w-full ${inputCls} text-right tabular-nums`} /></label>
      <label className="block text-sm font-semibold" title="Phiếu có giá trị lớn hơn ngưỡng cần thêm người này duyệt">Người duyệt vượt ngưỡng
        <div className="mt-1"><PersonSelect value={thresholdApprover} people={data.people} onChange={setThresholdApprover} label="Người duyệt vượt ngưỡng" empty="Chưa đặt — Quản trị VPP duyệt" /></div></label>
      <label className="block text-sm font-semibold" title="Duyệt thay mọi phòng; nhận phiếu của phòng chưa đặt người duyệt và người không có quản lý trực tiếp">Người duyệt thay chung
        <div className="mt-1"><PersonSelect value={fallback} people={data.people} onChange={setFallback} label="Người duyệt thay chung" empty="Chưa đặt" /></div></label>
    </section>

    <section className="rounded-2xl border border-border bg-card shadow-sm">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <h3 className="font-bold">Người duyệt theo phòng</h3>
        {missing > 0 && <span className="inline-flex items-center gap-1 text-sm font-semibold text-rose-700 dark:text-rose-300"><AlertTriangle size={14} />{missing} phòng chưa đặt</span>}
      </header>
      <ul className="divide-y divide-border">
        {data.departments.map(d => {
          const r = rows[d.orgUnitId] || { approverId: '', deputyId: '' };
          const set = (patch: Partial<Row>) => setRows(x => ({ ...x, [d.orgUnitId]: { ...r, ...patch } }));
          return <li key={d.orgUnitId} className="grid items-center gap-2 px-4 py-2.5 md:grid-cols-[minmax(0,1fr)_16rem_16rem]">
            <span className="min-w-0"><span className={ENT}>{d.name}</span>
              <span className="ml-2 text-[12px] text-muted-foreground">{d.code ? `${d.code} · ` : ''}{d.members} người</span>
              {!r.approverId && d.suggestedId && <button type="button" onClick={() => set({ approverId: d.suggestedId! })}
                className="ml-2 inline-flex items-center gap-1 text-[12px] font-semibold text-teal-700 dark:text-teal-300" title="Người được nhiều thành viên phòng nhận làm quản lý trực tiếp nhất">
                <Wand2 size={12} />Dùng {name.get(d.suggestedId) || 'gợi ý'}</button>}</span>
            <PersonSelect value={r.approverId} people={data.people} onChange={v => set({ approverId: v })} label={`Người duyệt ${d.name}`} empty="Chọn người duyệt…" />
            <PersonSelect value={r.deputyId} people={data.people} onChange={v => set({ deputyId: v })} label={`Người duyệt thay ${d.name}`} empty="Duyệt thay (tùy chọn)" />
          </li>;
        })}
      </ul>
    </section>

    <div className="sticky bottom-3 flex justify-end">
      <button type="button" onClick={save} disabled={!dirty || !!problem || busy} title={problem || (!dirty ? 'Chưa có thay đổi' : undefined)} className={`${primaryBtn} shadow-lg`}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}Lưu thiết lập</button>
    </div>
  </div>;
};
