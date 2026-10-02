import React, { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Loader2, Plus, Save, ShieldCheck, Trash2, UserPlus, X } from 'lucide-react';
import { useReasonConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import { financeService, type FinanceSettings } from '../../lib/financeService';
import { Badge, StateBox, inputCls, money, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { ENT, NUM, moneyInput, parseMoney, viDate } from './financeUi';

// Thiết lập Tài chính: hạn thanh toán mặc định, ma trận duyệt chi (có phiên bản), ủy quyền duyệt.
// Admin / Quản trị Tài chính sửa; mỗi lần sửa ghi nhật ký và báo cho Admin, Quản trị Tài chính.

type Tier = { max: string; steps: Array<{ label: string; approverIds: string[] }> };

export const FinanceSettingsView: React.FC<{ currentUserId: string }> = ({ currentUserId }) => {
  const toast = useToast();
  const askReason = useReasonConfirm();
  const [data, setData] = useState<FinanceSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState<{ value: string; reason: string; apply: boolean } | null>(null);
  const [tiers, setTiers] = useState<Tier[] | null>(null);
  const [matrixNote, setMatrixNote] = useState('');
  const [deleg, setDeleg] = useState<{ from: string; to: string; validFrom: string; validTo: string; reason: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const load = useCallback(() => { setError(null); financeService.settings().then(setData).catch(e => setError(e instanceof Error ? e.message : String(e))); }, []);
  useEffect(load, [load]);
  const run = async (fn: () => Promise<unknown>, message: string, after?: () => void) => {
    setBusy(true); setFormError(null);
    try { await fn(); toast.success('Thiết lập Tài chính', message); after?.(); load(); }
    catch (e) { setFormError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  if (error) return <StateBox kind="error" message={error} onRetry={load} />;
  if (!data) return <StateBox kind="loading" title="Đang tải thiết lập…" />;
  const manage = data.can.manage;
  const userName = (id: string) => data.users.find(u => u.id === id)?.name || id;
  const startEditMatrix = () => {
    setTiers(data.matrix.rules.map(r => ({ max: r.maxAmount == null ? '' : moneyInput(r.maxAmount), steps: r.steps.map(s => ({ label: s.label, approverIds: s.approvers.map(a => a.id) })) })));
    setMatrixNote(''); setFormError(null);
  };
  const saveMatrix = () => {
    if (!tiers) return;
    let min = 0; const rules = [];
    for (let i = 0; i < tiers.length; i += 1) {
      const last = i === tiers.length - 1; const max = last ? null : parseMoney(tiers[i].max);
      if (!last && (!Number.isFinite(max) || (max as number) <= min)) { setFormError(`Mức ${i + 1}: "đến" phải lớn hơn "từ".`); return; }
      if (tiers[i].steps.some(s => !s.label.trim() || !s.approverIds.length)) { setFormError(`Mức ${i + 1}: mỗi bước cần tên và ít nhất một người duyệt.`); return; }
      rules.push({ minAmount: min, maxAmount: max, steps: tiers[i].steps.map(s => ({ label: s.label.trim(), approverIds: s.approverIds })) });
      if (max != null) min = max;
    }
    if (!matrixNote.trim()) { setFormError('Nhập lý do thay đổi.'); return; }
    void run(() => financeService.saveMatrix({ note: matrixNote.trim(), rules }), 'Đã lưu ma trận duyệt chi phiên bản mới — áp cho đề nghị chi gửi sau thời điểm này.', () => setTiers(null));
  };
  const patchTier = (i: number, patch: Partial<Tier>) => setTiers(cur => cur!.map((t, k) => k === i ? { ...t, ...patch } : t));

  return <div className="space-y-4">
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <h3 className="flex items-center gap-2 font-semibold text-foreground"><CalendarClock size={16} className="text-teal-700" />Hạn thanh toán mặc định</h3>
      <p className="mt-1 text-sm text-muted-foreground">Áp khi HĐ và NCC chưa khai số ngày trả chậm. Mốc công nợ (bắt đầu ghi chi trong Vioo): <b className="text-foreground">{viDate(data.settings.cutoverDate)}</b>.</p>
      {days ? <div className="mt-3 flex flex-wrap items-center gap-2">
        <input inputMode="numeric" value={days.value} onChange={e => setDays({ ...days, value: e.target.value })} className={`w-24 text-right ${inputCls}`} aria-label="Số ngày" /> ngày
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={days.apply} onChange={e => setDays({ ...days, apply: e.target.checked })} className="h-4 w-4 accent-teal-600" />Tính lại chứng từ đang mở theo mặc định</label>
        <input value={days.reason} onChange={e => setDays({ ...days, reason: e.target.value })} placeholder="Lý do (bắt buộc)" className={`min-w-[14rem] flex-1 ${inputCls}`} />
        <button type="button" disabled={busy || !days.reason.trim()} className={primaryBtn} onClick={() => void run(() => financeService.saveSettings({ defaultPaymentDays: Number(days.value), expectedRowVersion: data.settings.rowVersion,
          applyToOpen: days.apply, reason: days.reason.trim() }), 'Đã đổi hạn mặc định.', () => setDays(null))}><Save size={15} />Lưu</button>
        <button type="button" className={secondaryBtn} onClick={() => setDays(null)}>Thôi</button>
      </div> : <p className="mt-2 text-sm"><b className={NUM}>{data.settings.defaultPaymentDays} ngày</b> từ ngày ghi nợ
        {data.settings.updatedByName && <span className="text-muted-foreground"> · sửa bởi {data.settings.updatedByName} {viDate(data.settings.updatedAt)}</span>}
        {manage && <button type="button" onClick={() => setDays({ value: String(data.settings.defaultPaymentDays), reason: '', apply: false })} className="ml-2 font-semibold text-teal-700 hover:underline">Sửa</button>}</p>}
    </section>

    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 font-semibold text-foreground"><ShieldCheck size={16} className="text-teal-700" />Ma trận duyệt chi</h3>
        <Badge className="border-teal-200 bg-teal-50 text-teal-800">Phiên bản {data.matrix.versionNo}</Badge>
        <span className="text-xs text-muted-foreground">Dùng khi có Đề nghị chi (K3b). Người duyệt luôn khác người lập; đổi ma trận không ảnh hưởng đề nghị đang chờ.</span>
        {manage && !tiers && <button type="button" onClick={startEditMatrix} className={`${secondaryBtn} ml-auto`}>Sửa ma trận</button>}
      </div>
      {!tiers ? <ul className="mt-3 space-y-2">{data.matrix.rules.map(r => <li key={r.tierNo} className="rounded-xl border border-border px-3 py-2.5">
        <p className="text-sm font-semibold text-foreground">{r.maxAmount == null ? <>Từ <span className={NUM}>{money(r.minAmount)} đ</span> trở lên</> : <>Từ <span className={NUM}>{money(r.minAmount)}</span> đến <span className={NUM}>{money(r.maxAmount)} đ</span></>}</p>
        <ol className="mt-1 flex flex-wrap items-center gap-2 text-sm">{r.steps.map((s, i) => <li key={i} className="flex items-center gap-1.5">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-muted text-[11px] font-bold">{i + 1}</span>{s.label}:
          {s.approvers.map(a => <span key={a.id} className={`${ENT} ${a.active ? '' : 'line-through opacity-60'}`}>{a.name}</span>).reduce<React.ReactNode[]>((acc, el, k) => k ? [...acc, <span key={`o${k}`} className="text-muted-foreground">hoặc</span>, el] : [el], [])}
          {i < r.steps.length - 1 && <span className="text-muted-foreground">→</span>}</li>)}</ol>
      </li>)}</ul>
        : <div className="mt-3 space-y-3">
          {tiers.map((t, i) => { const min = i === 0 ? 0 : parseMoney(tiers[i - 1].max); const last = i === tiers.length - 1;
            return <div key={i} className="rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <b>Mức {i + 1}:</b> từ <span className={NUM}>{Number.isFinite(min) ? money(min) : '?'}</span> đến
                {last ? <span className="text-muted-foreground">không giới hạn</span>
                  : <input inputMode="numeric" value={t.max} onChange={e => patchTier(i, { max: e.target.value })} className={`w-40 text-right ${inputCls}`} aria-label={`Đến mức ${i + 1}`} />}
                {tiers.length > 1 && <button type="button" aria-label={`Bỏ mức ${i + 1}`} onClick={() => setTiers(cur => cur!.filter((_, k) => k !== i).map((x, k, arr) => k === arr.length - 1 ? { ...x, max: '' } : x))}
                  className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted hover:text-rose-700"><Trash2 size={14} /></button>}
              </div>
              {t.steps.map((s, j) => <div key={j} className="mt-2 flex flex-wrap items-center gap-2 pl-4">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-muted text-[11px] font-bold">{j + 1}</span>
                <input value={s.label} onChange={e => patchTier(i, { steps: t.steps.map((x, k) => k === j ? { ...x, label: e.target.value } : x) })} placeholder="Tên bước, VD: Kế toán trưởng duyệt" className={`w-56 ${inputCls}`} />
                {s.approverIds.map(id => <span key={id} className="inline-flex items-center gap-1 rounded-full border border-mint-200 bg-mint-50 px-2 py-0.5 text-xs font-semibold text-mint-800">{userName(id)}
                  <button type="button" aria-label={`Bỏ ${userName(id)}`} onClick={() => patchTier(i, { steps: t.steps.map((x, k) => k === j ? { ...x, approverIds: x.approverIds.filter(a => a !== id) } : x) })}><X size={12} /></button></span>)}
                <select value="" aria-label="Thêm người duyệt" onChange={e => e.target.value && patchTier(i, { steps: t.steps.map((x, k) => k === j ? { ...x, approverIds: [...x.approverIds, e.target.value] } : x) })} className={inputCls}>
                  <option value="">+ Người duyệt…</option>{data.users.filter(u => !s.approverIds.includes(u.id)).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                {t.steps.length > 1 && <button type="button" aria-label="Bỏ bước" onClick={() => patchTier(i, { steps: t.steps.filter((_, k) => k !== j) })} className="rounded p-1 text-muted-foreground hover:text-rose-700"><X size={14} /></button>}
              </div>)}
              <button type="button" onClick={() => patchTier(i, { steps: [...t.steps, { label: '', approverIds: [] }] })} className="mt-2 pl-4 text-xs font-semibold text-teal-700 hover:underline">+ Thêm bước</button>
            </div>; })}
          <button type="button" onClick={() => setTiers(cur => [...cur!.map((x, k, arr) => k === arr.length - 1 && !x.max ? { ...x, max: '' } : x), { max: '', steps: [{ label: '', approverIds: [] }] }])} className={secondaryBtn}><Plus size={14} />Thêm mức tiền</button>
          <input value={matrixNote} onChange={e => setMatrixNote(e.target.value)} placeholder="Lý do thay đổi (bắt buộc) — VD: TGĐ duyệt từ 1 tỷ theo quyết định ngày 02/10" className={`w-full ${inputCls}`} />
          {formError && <p role="alert" className="text-sm text-rose-700">{formError}</p>}
          <div className="flex justify-end gap-2"><button type="button" onClick={() => { setTiers(null); setFormError(null); }} className={secondaryBtn}>Thôi</button>
            <button type="button" disabled={busy} onClick={saveMatrix} className={primaryBtn}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}Lưu phiên bản mới</button></div>
        </div>}
      {data.versions.length > 1 && <details className="mt-3 text-sm"><summary className="cursor-pointer font-semibold text-muted-foreground">Lịch sử phiên bản ({data.versions.length})</summary>
        <ul className="mt-1 space-y-0.5 text-muted-foreground">{data.versions.map(v => <li key={v.versionNo}>Phiên bản {v.versionNo}{v.current ? ' (đang dùng)' : ''} · {viDate(v.createdAt)} · {v.createdByName || 'hệ thống'} — {v.note}</li>)}</ul></details>}
    </section>

    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 font-semibold text-foreground"><UserPlus size={16} className="text-teal-700" />Ủy quyền duyệt chi</h3>
        <span className="text-xs text-muted-foreground">Người duyệt vắng thì ủy quyền có thời hạn; hết hạn tự hết hiệu lực.</span>
        {!deleg && <button type="button" onClick={() => setDeleg({ from: manage ? '' : currentUserId, to: '', validFrom: '', validTo: '', reason: '' })} className={`${secondaryBtn} ml-auto`}><Plus size={14} />Ủy quyền</button>}
      </div>
      {deleg && <div className="mt-3 grid gap-2 rounded-xl border border-border p-3 md:grid-cols-5">
        <select value={deleg.from} disabled={!manage} onChange={e => setDeleg({ ...deleg, from: e.target.value })} className={inputCls} aria-label="Người ủy quyền">
          <option value="">Người ủy quyền…</option>{data.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        <select value={deleg.to} onChange={e => setDeleg({ ...deleg, to: e.target.value })} className={inputCls} aria-label="Người nhận">
          <option value="">Người nhận ủy quyền…</option>{data.users.filter(u => u.id !== deleg.from).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        <input type="date" value={deleg.validFrom} onChange={e => setDeleg({ ...deleg, validFrom: e.target.value })} className={inputCls} aria-label="Từ ngày" />
        <input type="date" value={deleg.validTo} min={deleg.validFrom} onChange={e => setDeleg({ ...deleg, validTo: e.target.value })} className={inputCls} aria-label="Đến ngày" />
        <input value={deleg.reason} onChange={e => setDeleg({ ...deleg, reason: e.target.value })} placeholder="Lý do (bắt buộc)" className={inputCls} />
        {formError && <p role="alert" className="text-sm text-rose-700 md:col-span-5">{formError}</p>}
        <div className="flex justify-end gap-2 md:col-span-5"><button type="button" onClick={() => setDeleg(null)} className={secondaryBtn}>Thôi</button>
          <button type="button" disabled={busy || !deleg.from || !deleg.to || !deleg.validFrom || !deleg.validTo || !deleg.reason.trim()} className={primaryBtn}
            onClick={() => void run(() => financeService.saveDelegation({ fromUserId: deleg.from, toUserId: deleg.to, validFrom: deleg.validFrom, validTo: deleg.validTo, reason: deleg.reason.trim() }),
              'Đã tạo ủy quyền duyệt chi.', () => setDeleg(null))}>Lưu ủy quyền</button></div>
      </div>}
      {data.delegations.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Chưa có ủy quyền nào.</p>
        : <ul className="mt-2 divide-y divide-border text-sm">{data.delegations.map(d => <li key={d.id} className={`flex flex-wrap items-center gap-2 py-2 ${d.revokedAt ? 'opacity-60' : ''}`}>
          <span className={ENT}>{d.fromName}</span> → <span className={ENT}>{d.toName}</span>
          <span className="text-muted-foreground">{viDate(d.validFrom)} – {viDate(d.validTo)} · {d.reason}{d.revokedAt ? ` · đã thu hồi: ${d.revokeReason}` : ''}</span>
          {!d.revokedAt && (manage || d.fromUserId === currentUserId) && <button type="button" disabled={busy} className="ml-auto text-xs font-semibold text-rose-700 hover:underline" onClick={async () => {
            const reason = await askReason({ title: 'Thu hồi ủy quyền', targetName: `${d.fromName} → ${d.toName}`, reasonLabel: 'Lý do', actionLabel: 'Thu hồi', intent: 'warning' });
            if (reason) void run(() => financeService.revokeDelegation({ id: d.id, reason }), 'Đã thu hồi ủy quyền.');
          }}>Thu hồi</button>}
        </li>)}</ul>}
    </section>
  </div>;
};
