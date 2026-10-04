import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, ClipboardCheck, Pencil, Plus, RefreshCw, RotateCcw, Send, Trash2, Undo2, Users, X } from 'lucide-react';
import { useConfirm, useReasonConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import { financeService, type FinanceAllocation, type FinanceAllocationStatus } from '../../lib/financeService';
import { Badge, StateBox, inputCls, money, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { ENT, NUM, moneyInput, parseMoney, shortMoney, viDate } from './financeUi';
import { EXPENSE_CATEGORIES } from './CashDrawers';

// Chi phí & ngân sách → Phân bổ tháng: lương nhân viên ở công trường + chi phí chung công ty → chi phí từng dự án, trừ quỹ dự án.
// Kế toán lập, người khác chốt. Máy chủ tính số; ở đây chỉ hiển thị và gửi thao tác.

const STATUS: Record<FinanceAllocationStatus, { label: string; cls: string }> = {
  draft: { label: 'Đang lập', cls: 'border-slate-200 bg-slate-100 text-slate-700' },
  submitted: { label: 'Chờ chốt', cls: 'border-amber-300 bg-amber-50 text-amber-800' },
  confirmed: { label: 'Đã chốt', cls: 'border-leaf-200 bg-leaf-50 text-leaf-800' },
  reversed: { label: 'Đã đảo', cls: 'border-rose-200 bg-rose-50 text-rose-700' },
  cancelled: { label: 'Đã hủy', cls: 'border-border bg-muted text-muted-foreground' },
};
const mm = (d: string) => `${d.slice(5, 7)}/${d.slice(0, 4)}`;
const monthsBetween = (from: string, to: string) => { const out: string[] = []; let d = new Date(`${from.slice(0, 7)}-01T00:00:00Z`); const end = new Date(`${to.slice(0, 7)}-01T00:00:00Z`);
  while (d <= end) { out.push(d.toISOString().slice(0, 10)); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)); } return out.reverse(); };

const Step: React.FC<{ ok: boolean | null; title: string; hint: React.ReactNode }> = ({ ok, title, hint }) =>
  <li className={`rounded-xl border bg-card p-2.5 ${ok ? 'border-leaf-200' : ok === null ? 'border-border' : 'border-amber-300'}`}>
    <b className="flex items-center gap-1.5 text-sm">{ok ? <CheckCircle2 size={15} className="text-leaf-600" /> : <AlertTriangle size={15} className="text-amber-600" />}{title}</b>
    <span className="block text-xs text-muted-foreground">{hint}</span></li>;

export const AllocationView: React.FC<{ onChanged: () => void }> = ({ onChanged }) => {
  const toast = useToast(); const confirm = useConfirm(); const askReason = useReasonConfirm();
  const [month, setMonth] = useState<string | undefined>(undefined);
  const [data, setData] = useState<FinanceAllocation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<{ employeeId: string; days: Record<string, string>; office: string } | null>(null);
  const [add, setAdd] = useState<{ description: string; amount: string; reason: string } | null>(null);
  const load = useCallback(() => { setError(null); financeService.allocation(month).then(setData).catch(e => setError(e instanceof Error ? e.message : String(e))); }, [month]);
  useEffect(load, [load]);
  if (error) return <StateBox kind="error" title="Chưa tải được phân bổ tháng" message={error} onRetry={load} />;
  if (!data) return <StateBox kind="loading" title="Đang tải phân bổ tháng…" />;
  const run = data.run; const rd = data.readiness; const can = data.can;
  const exec = async (fn: () => Promise<unknown>, msg: string) => { setBusy(true); try { await fn(); toast.success('Phân bổ tháng', msg); setEdit(null); setAdd(null); load(); onChanged(); } catch (e) { toast.error('Chưa thực hiện được', e instanceof Error ? e.message : ''); } finally { setBusy(false); } };
  const tsOk = rd.timesheet?.status === 'closed'; const payOk = rd.payroll.confirmed > 0;
  const months = data.lastClosableMonth >= data.firstMonth ? monthsBetween(data.firstMonth, data.lastClosableMonth) : [];
  const canCreate = can.record && !run && data.month >= data.firstMonth && data.month <= data.lastClosableMonth;
  const projCode = (id: string) => data.projects.find(p => p.id === id)?.code || id;
  const projIds = run ? Array.from(new Set([...data.projects.map(p => p.id), ...run.staff.flatMap(s => Object.keys(s.siteDays))])) : [];
  const shareOf = (s: NonNullable<typeof run>['staff'][number], pid: string) => { const tot = s.officeDays + Object.values(s.siteDays).reduce((a, b) => a + Number(b), 0); return tot ? s.gross * Number(s.siteDays[pid] || 0) / tot : 0; };
  const totals = run ? data.projects.map(p => ({ ...p, salary: run.lines.find(l => l.projectId === p.id && l.kind === 'salary')?.amount || 0,
    overhead: run.lines.find(l => l.projectId === p.id && l.kind === 'overhead')?.amount || 0, receipts: rd.receipts.find(r => r.projectId === p.id)?.amount || 0 })) : [];

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3 shadow-sm">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-teal-50 text-teal-700"><Users size={18} /></span>
      <div className="min-w-0 flex-1"><b className="block">Phân bổ tháng {mm(data.month)}</b>
        <span className="text-xs text-muted-foreground">Lương nhân viên ở công trường → khoản mục lương BCH công trường; chi phí chung công ty theo tiền CĐT trả → chi phí quản lý chung.</span></div>
      {months.length > 0 && <select value={data.month} onChange={e => setMonth(e.target.value)} className={inputCls} aria-label="Tháng">
        {months.map(m => <option key={m} value={m}>Tháng {mm(m)}</option>)}</select>}
      {run && <Badge className={STATUS[run.status].cls}>{run.code} · {STATUS[run.status].label}</Badge>}
    </div>

    {data.lastClosableMonth < data.firstMonth && <p className="rounded-2xl border border-teal-200 bg-teal-50/60 px-4 py-3 text-sm text-teal-950">
      Phân bổ bắt đầu từ tháng {mm(data.firstMonth)} (trước đó MISA đã phân bổ). Tháng {mm(data.firstMonth)} chưa kết thúc — kế toán lập phân bổ từ đầu tháng sau, khi HR đã chốt công và duyệt bảng lương.</p>}

    <ul className="grid gap-2 md:grid-cols-3">
      <Step ok={tsOk} title={tsOk ? `Bảng công đã chốt (lần ${rd.timesheet?.version})` : rd.timesheet ? 'Bảng công đang rà soát' : 'Bảng công chưa chốt'}
        hint={tsOk ? `Chốt ${viDate(rd.timesheet?.decidedAt)} — số công lấy theo bản chốt, công trường theo chấm công.` : 'HR chốt công tháng (Nhân sự → Chốt công) trước khi gửi chốt phân bổ.'} />
      <Step ok={payOk} title={payOk ? `Bảng lương đã duyệt: ${rd.payroll.confirmed} người` : 'Bảng lương chưa duyệt'}
        hint={payOk ? `Lương gộp ${shortMoney(rd.payroll.gross)}${rd.payroll.draft ? ` · còn ${rd.payroll.draft} phiếu nháp chưa tính` : ''}` : `${rd.payroll.draft ? `${rd.payroll.draft} phiếu lương còn nháp. ` : ''}HR lập và duyệt bảng lương tháng.`} />
      <Step ok={rd.receipts.length > 0 ? true : null} title={rd.receipts.length ? `Tiền CĐT trả: ${rd.receipts.map(r => `${r.projectCode} ${shortMoney(r.amount)}`).join(' · ')}` : 'Tháng không có tiền CĐT trả'}
        hint={rd.receipts.length ? 'Căn cứ chia chi phí chung công ty.' : 'Chi phí chung để lại công ty, không phân bổ (theo quyết định 04/10).'} />
    </ul>

    {!run ? <section className="rounded-2xl border border-dashed border-border bg-card p-6 text-center text-sm">
      <p className="text-muted-foreground">{data.runs.some(r => r.month === data.month && r.status === 'reversed') ? 'Kỳ trước của tháng này đã đảo. ' : ''}Chưa lập phân bổ tháng {mm(data.month)}.</p>
      {canCreate && <button type="button" disabled={busy} onClick={() => void exec(() => financeService.createAllocation(data.month), 'Đã lập kỳ phân bổ — kiểm số công, chi phí chung rồi gửi chốt.')} className={`${primaryBtn} mt-3`}><Plus size={15} />Lập phân bổ tháng {mm(data.month)}</button>}
    </section> : <>
      {run.status === 'draft' && run.decisionNote && <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-900"><b>Bị trả lại:</b> {run.decisionNote}</p>}
      <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {([['Lương nhân viên', run.payrollTotal, `${run.payrollCount} người trong bảng lương`], ['→ Các công trường', run.siteTotal, 'lương BCH công trường'],
          ['Chi phí chung', run.poolTotal, `gồm lương văn phòng ${shortMoney(run.officeTotal)}`], ['Tiền CĐT trả trong tháng', run.receiptsTotal, run.receiptsTotal > 0 ? 'căn cứ chia chi phí chung' : 'không có — để lại công ty']] as const).map(([l, v, h]) =>
          <div key={l} className="rounded-2xl border border-border bg-card p-3 shadow-sm"><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{l}</span>
            <span className={`mt-1 block text-xl font-bold ${NUM}`}>{shortMoney(v)}</span><span className="block text-xs text-muted-foreground">{h}</span></div>)}
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5"><h3 className="mr-auto font-semibold">1. Lương nhân viên theo công trường</h3>
          <span className="text-xs text-muted-foreground">Lương gộp × công ở công trường ÷ tổng công. Văn phòng, nhà máy, dự án chưa có HĐ CĐT → chi phí chung.</span></div>
        {run.staff.length === 0 ? <p className="px-4 py-5 text-center text-sm text-muted-foreground">{tsOk ? 'Bảng lương tháng chưa có người nào đã duyệt.' : 'Chưa có số công — HR chưa chốt bảng công tháng này.'}</p>
          : <div className="overflow-x-auto"><table className="w-full min-w-[48rem] text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left">Nhân viên</th><th className="px-2 text-right">Lương gộp</th>
              {projIds.map(p => <th key={p} className="px-2 text-right">Công {projCode(p)}</th>)}<th className="px-2 text-right">Văn phòng</th>
              {projIds.map(p => <th key={`a${p}`} className="px-2 text-right">→ {projCode(p)}</th>)}<th className="w-16" /></tr></thead>
            <tbody className="divide-y divide-border">{run.staff.map(s => { const e = edit?.employeeId === s.employeeId ? edit : null;
              return <tr key={s.employeeId} className={s.edited ? 'bg-amber-50/40' : ''}>
                <td className="px-3 py-2"><b>{s.name}</b>{s.edited && <span className="block text-[11px] text-amber-800">đã sửa (gợi ý: {Object.entries(s.autoSiteDays).map(([k, d]) => `${projCode(k)} ${d}`).join(', ') || 'không công trường'}, VP {s.autoOfficeDays}): {s.editReason}</span>}</td>
                <td className="px-2 text-right tabular-nums">{shortMoney(s.gross)}</td>
                {projIds.map(p => <td key={p} className="px-2 text-right tabular-nums">{e ? <input value={e.days[p] ?? ''} onChange={ev => setEdit({ ...e, days: { ...e.days, [p]: ev.target.value } })} inputMode="decimal" className={`w-14 text-right ${inputCls}`} aria-label={`Công ${projCode(p)}`} /> : (s.siteDays[p] || '—')}</td>)}
                <td className="px-2 text-right tabular-nums">{e ? <input value={e.office} onChange={ev => setEdit({ ...e, office: ev.target.value })} inputMode="decimal" className={`w-14 text-right ${inputCls}`} aria-label="Công văn phòng" /> : s.officeDays}</td>
                {projIds.map(p => <td key={`a${p}`} className="px-2 text-right tabular-nums">{shareOf(s, p) ? shortMoney(shareOf(s, p)) : '—'}</td>)}
                <td className="px-2 text-right">{run.canEdit && (e ? <span className="inline-flex gap-1">
                  <button type="button" aria-label="Lưu" disabled={busy} className="rounded p-1 text-leaf-700 hover:bg-muted" onClick={async () => {
                    const r = await askReason({ title: 'Sửa số công', targetName: s.name, subtitle: 'Ghi lý do — người chốt thấy số gợi ý và số đã sửa.', reasonLabel: 'Lý do', actionLabel: 'Lưu', intent: 'warning' });
                    if (r) void exec(() => financeService.saveAllocation({ runId: run.id, expectedRowVersion: run.rowVersion, action: 'staff', employeeId: s.employeeId,
                      siteDays: Object.fromEntries(Object.entries(e.days).filter(([, d]) => d.trim() !== '').map(([k, d]) => [k, Number(d.replace(',', '.'))])), officeDays: Number(e.office.replace(',', '.')) || 0, reason: r }), 'Đã sửa số công.');
                  }}><Check size={15} /></button>
                  <button type="button" aria-label="Thôi" className="rounded p-1 hover:bg-muted" onClick={() => setEdit(null)}><X size={15} /></button></span>
                  : <button type="button" aria-label={`Sửa công ${s.name}`} className="rounded p-1 text-teal-700 hover:bg-muted" onClick={() => setEdit({ employeeId: s.employeeId, office: String(s.officeDays), days: Object.fromEntries(projIds.map(p => [p, s.siteDays[p] ? String(s.siteDays[p]) : ''])) })}><Pencil size={14} /></button>)}</td>
              </tr>; })}</tbody></table></div>}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2"><h3 className="mr-auto font-semibold">2. Chi phí chung công ty</h3>
          {run.canEdit && !add && <button type="button" onClick={() => setAdd({ description: '', amount: '', reason: '' })} className="text-xs font-semibold text-teal-700 hover:underline"><Plus size={12} className="mr-0.5 inline" />Thêm khoản</button>}</div>
        <p className="text-xs text-muted-foreground">Tự lấy phiếu chi khác không gắn dự án đã chi trong tháng + phần lương văn phòng. Trả nợ gốc vay, tạm ứng nhân viên, thuế, lương (đã tính ở bước 1) mặc định không tính.</p>
        <ul className="mt-2 divide-y divide-border text-sm">{run.pool.map(p => <li key={p.id} className={`flex flex-wrap items-center gap-2 py-1.5 ${p.included ? '' : 'opacity-60'}`}>
          <input type="checkbox" checked={p.included} disabled={!run.canEdit || busy || p.sourceType === 'office_salary'} aria-label={p.description}
            onChange={ev => void exec(() => financeService.saveAllocation({ runId: run.id, expectedRowVersion: run.rowVersion, action: 'pool', itemId: p.id, included: ev.target.checked }), ev.target.checked ? 'Đã tính khoản này.' : 'Đã bỏ khoản này.')} className="accent-teal-600" />
          <span className="min-w-0 flex-1">{p.description}{p.sourceType === 'expense_request' && p.category && <span className="text-xs text-muted-foreground"> · {EXPENSE_CATEGORIES[p.category] || p.category}</span>}{p.sourceType === 'manual' && <Badge className="ml-1 border-amber-300 bg-amber-50 text-amber-800">thêm tay</Badge>}{p.note && <span className="block text-xs text-muted-foreground">{p.note}</span>}</span>
          <span className="tabular-nums">{money(p.amount)}</span>
          {run.canEdit && p.sourceType === 'manual' && <button type="button" aria-label="Xóa" disabled={busy} className="rounded p-1 text-rose-700 hover:bg-muted" onClick={() => void exec(() => financeService.saveAllocation({ runId: run.id, expectedRowVersion: run.rowVersion, action: 'pool_remove', itemId: p.id }), 'Đã xóa.')}><Trash2 size={14} /></button>}</li>)}</ul>
        {add && <div className="mt-2 grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-[minmax(0,1fr)_10rem_minmax(0,1fr)_auto]">
          <input value={add.description} onChange={e => setAdd({ ...add, description: e.target.value })} placeholder="Nội dung (VD: Khấu hao xe con tháng 10)" className={inputCls} />
          <input value={add.amount} onChange={e => setAdd({ ...add, amount: e.target.value })} onBlur={() => add.amount && setAdd({ ...add, amount: moneyInput(parseMoney(add.amount) || 0) })} placeholder="Số tiền" inputMode="numeric" className={`text-right ${inputCls}`} />
          <input value={add.reason} onChange={e => setAdd({ ...add, reason: e.target.value })} placeholder="Lý do / chứng từ (bắt buộc)" className={inputCls} />
          <span className="flex gap-1"><button type="button" disabled={busy || !add.description.trim() || !(parseMoney(add.amount) > 0) || !add.reason.trim()} className={primaryBtn}
            onClick={() => void exec(() => financeService.saveAllocation({ runId: run.id, expectedRowVersion: run.rowVersion, action: 'pool_add', description: add.description.trim(), amount: parseMoney(add.amount), reason: add.reason.trim() }), 'Đã thêm khoản.')}>Thêm</button>
            <button type="button" className={secondaryBtn} onClick={() => setAdd(null)}>Thôi</button></span></div>}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h3 className="font-semibold">3. Kết quả theo dự án</h3>
        <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[34rem] text-sm">
          <thead className="text-xs text-muted-foreground"><tr><th className="py-1 text-left">Dự án</th><th className="text-right">Tiền CĐT trả</th><th className="text-right">Lương công trường</th><th className="text-right">Chi phí chung</th><th className="text-right">Cộng</th></tr></thead>
          <tbody className="divide-y divide-border">{totals.map(p => <tr key={p.id}><td className={`py-1.5 ${ENT}`}>{p.code}</td><td className="text-right tabular-nums">{p.receipts ? shortMoney(p.receipts) : '—'}</td>
            <td className="text-right tabular-nums">{p.salary ? shortMoney(p.salary) : '—'}</td><td className="text-right tabular-nums">{p.overhead ? shortMoney(p.overhead) : '—'}</td>
            <td className={`text-right ${NUM}`}>{shortMoney(p.salary + p.overhead)}</td></tr>)}</tbody></table></div>
        {run.receiptsTotal <= 0 && run.poolTotal > 0 && <p className="mt-1 text-xs text-amber-800">Tháng không có tiền CĐT trả: chi phí chung {shortMoney(run.poolTotal)} để lại công ty.</p>}
        <p className="mt-1 text-xs text-muted-foreground">Chốt xong: ghi chi phí dự án ngày cuối tháng (khoản mục lương BCH công trường / chi phí quản lý chung) và trừ quỹ dự án. Sai thì đảo cả kỳ rồi lập lại.</p>
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <span className="mr-auto text-xs text-muted-foreground">Lập: {run.createdByName} {viDate(run.createdAt)}{run.decidedByName ? ` · chốt: ${run.decidedByName} ${viDate(run.decidedAt)}` : ''}</span>
          {run.canCancel && <button type="button" disabled={busy} className={secondaryBtn} onClick={async () => { const r = await askReason({ title: 'Hủy kỳ phân bổ', targetName: run.code, reasonLabel: 'Lý do', actionLabel: 'Hủy kỳ', intent: 'warning' }); if (r) void exec(() => financeService.decideAllocation({ id: run.id, expectedRowVersion: run.rowVersion, action: 'cancel', reason: r }), 'Đã hủy kỳ.'); }}><X size={15} />Hủy kỳ</button>}
          {run.canEdit && <button type="button" disabled={busy} className={secondaryBtn} onClick={() => void exec(() => financeService.saveAllocation({ runId: run.id, expectedRowVersion: run.rowVersion, action: 'refresh' }), 'Đã làm mới số liệu (giữ số công đã sửa).')}><RefreshCw size={15} />Làm mới số liệu</button>}
          {run.canSubmit && <button type="button" disabled={busy || !tsOk || !payOk} title={!tsOk || !payOk ? 'Cần bảng công đã chốt và bảng lương đã duyệt' : undefined} className={primaryBtn}
            onClick={() => void exec(() => financeService.decideAllocation({ id: run.id, expectedRowVersion: run.rowVersion, action: 'submit' }), 'Đã gửi chốt — chờ người có quyền Xác nhận.')}><Send size={15} />Gửi chốt</button>}
          {run.canDecide && <><button type="button" disabled={busy} className={secondaryBtn} onClick={async () => { const r = await askReason({ title: 'Trả lại phân bổ', targetName: run.code, reasonLabel: 'Lý do', actionLabel: 'Trả lại', intent: 'warning' }); if (r) void exec(() => financeService.decideAllocation({ id: run.id, expectedRowVersion: run.rowVersion, action: 'return', reason: r }), 'Đã trả lại.'); }}><Undo2 size={15} />Trả lại</button>
            <button type="button" disabled={busy} className={primaryBtn} onClick={async () => { if (await confirm({ title: 'Chốt phân bổ tháng?', targetName: `${run.code} · ${shortMoney(run.siteTotal + (run.receiptsTotal > 0 ? run.poolTotal : 0))}`, confirmText: 'Chốt', actionLabel: 'Chốt', intent: 'success', countdownSeconds: 0, warningText: 'Ghi chi phí dự án và trừ quỹ dự án. Đã kiểm số công và các khoản chi phí chung.' })) void exec(() => financeService.decideAllocation({ id: run.id, expectedRowVersion: run.rowVersion, action: 'confirm' }), 'Đã chốt — chi phí dự án đã ghi.'); }}><ClipboardCheck size={15} />Chốt phân bổ</button></>}
          {run.canReverse && <button type="button" disabled={busy} className="text-sm font-semibold text-rose-700 hover:underline" onClick={async () => { const r = await askReason({ title: 'Đảo phân bổ tháng', targetName: run.code, subtitle: 'Ghi dòng âm vào chi phí dự án và hoàn lại quỹ dự án; sau đó lập kỳ mới.', reasonLabel: 'Lý do', actionLabel: 'Đảo', intent: 'danger' }); if (r) void exec(() => financeService.decideAllocation({ id: run.id, expectedRowVersion: run.rowVersion, action: 'reverse', reason: r }), 'Đã đảo kỳ.'); }}><RotateCcw size={14} className="mr-0.5 inline" />Đảo kỳ</button>}
        </div>
      </section>
    </>}

    {data.runs.length > 0 && <section className="rounded-2xl border border-border bg-card p-4 text-sm shadow-sm">
      <h3 className="font-semibold">Các kỳ phân bổ</h3>
      <ul className="mt-1 divide-y divide-border">{data.runs.map(r => <li key={r.id} className="flex flex-wrap items-center gap-2 py-1.5">
        <button type="button" onClick={() => setMonth(r.month)} className={`font-semibold ${ENT} hover:underline`}>{r.code}</button><span>tháng {mm(r.month)}</span>
        <Badge className={STATUS[r.status].cls}>{STATUS[r.status].label}</Badge>
        <span className="min-w-0 flex-1 text-xs text-muted-foreground">lương công trường {shortMoney(r.siteTotal)} · chi phí chung {shortMoney(r.poolTotal)} · lập {r.createdByName}{r.reverseReason ? ` · đảo: ${r.reverseReason}` : ''}</span></li>)}</ul>
    </section>}
  </div>;
};
