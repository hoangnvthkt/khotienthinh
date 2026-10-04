import React, { useMemo, useState } from 'react';
import { ClipboardCheck, HandCoins, Loader2, Send, Undo2 } from 'lucide-react';
import { financeService, type FinanceAttachment, type FinanceProjectCost } from '../../lib/financeService';
import { Drawer, inputCls, money, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { AttachmentPicker, ENT, FieldError, NUM, moneyInput, parseMoney, shortMoney } from './financeUi';

// Các form của Chi phí & ngân sách. Máy chủ kiểm tra mọi số, quyền và tách nhiệm; ở đây chỉ gợi ý.

export const signedMoney = (n: number) => `${n < 0 ? '−' : ''}${shortMoney(Math.abs(n))}`;

const F: React.FC<{ label: string; hint?: React.ReactNode; className?: string; children: React.ReactNode }> = ({ label, hint, className = '', children }) =>
  <label className={`block text-sm font-medium ${className}`}>{label}{children}{hint && <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{hint}</span>}</label>;
const Footer: React.FC<{ err: string | null; blockers: string[]; busy: boolean; onClose: () => void; onSave: () => void; label: string; icon: React.ElementType }> = ({ err, blockers, busy, onClose, onSave, label, icon: I }) =>
  <><FieldError error={err} />{!err && blockers.length > 0 && <span className="mr-auto text-xs text-amber-700 dark:text-amber-300">{blockers.join(' · ')}</span>}
    <button type="button" className={secondaryBtn} onClick={onClose}>Đóng</button>
    <button type="button" className={primaryBtn} disabled={busy || blockers.length > 0} onClick={onSave}>{busy ? <Loader2 size={15} className="animate-spin" /> : <I size={15} />}{label}</button></>;
const useRun = (onSaved: (m: string) => void) => {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, msg: string) => { setBusy(true); setErr(null); try { await fn(); onSaved(msg); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  return { busy, err, run };
};

// ---------- Lập / điều chỉnh ngân sách ----------
export const BudgetDrawer: React.FC<{ data: FinanceProjectCost; onClose: () => void; onSaved: (m: string) => void }> = ({ data, onClose, onSaved }) => {
  const current = data.budgets.find(b => b.status === 'approved') || null;
  const lineOf = (id: string) => data.lines.find(l => l.costItemId === id);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(data.items.filter(i => i.symbol !== 'CPNVL').map(i => {
    const a = current?.lines.find(l => l.costItemId === i.id)?.amount; return [i.id, a == null ? '' : moneyInput(a)];
  })));
  const [reason, setReason] = useState('');
  const { busy, err, run } = useRun(onSaved);
  const mat = data.lines.find(l => l.symbol === 'CPNVL')?.budget ?? null;
  const lines = data.items.filter(i => i.symbol !== 'CPNVL' && values[i.id]?.trim() !== '' && values[i.id] != null).map(i => ({ costItemId: i.id, amount: parseMoney(values[i.id]) }));
  const other = lines.reduce((s, l) => s + (Number.isFinite(l.amount) ? l.amount : 0), 0);
  const blockers = [!lines.length && 'Nhập ít nhất một khoản mục', lines.some(l => !(l.amount >= 0)) && 'Có số tiền không hợp lệ', !reason.trim() && 'Ghi lý do lập / điều chỉnh'].filter(Boolean) as string[];
  const groups = useMemo(() => { const g: Array<{ name: string; items: typeof data.items }> = [];
    for (const i of data.items) { const last = g[g.length - 1]; if (last && last.name === i.groupName) last.items.push(i); else g.push({ name: i.groupName, items: [i] }); } return g; }, [data.items]);
  return <Drawer label="Ngân sách" wide onClose={onClose}
    header={<><p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">Ngân sách {data.project.code} · phiên bản {(data.budgets[0]?.versionNo || 0) + 1}</p>
      <h2 className={`text-lg ${ENT}`}>{current ? 'Điều chỉnh ngân sách theo khoản mục' : 'Lập ngân sách theo khoản mục'}</h2>
      <p className="text-sm text-muted-foreground">Kế toán / QS lập; Quản trị Tài chính duyệt (khác người lập). Duyệt xong thay bản đang áp dụng — bản cũ vẫn giữ trong lịch sử.</p></>}
    footer={<Footer err={err} blockers={blockers} busy={busy} onClose={onClose} label="Gửi duyệt" icon={Send}
      onSave={() => void run(() => financeService.saveProjectBudget({ projectId: data.project.id, reason: reason.trim(), lines }), 'Đã gửi ngân sách — chờ Quản trị Tài chính duyệt.')} />}>
    {groups.map(g => <section key={g.name} className="space-y-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.name}</h3>
      {g.items.map(i => { const l = lineOf(i.id); const used = (l?.actual || 0) + (l?.committed || 0);
        return <div key={i.id} className="grid items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_11rem_11rem]">
          <span className="min-w-0"><b>{i.name}</b> <span className="text-xs text-muted-foreground">{i.symbol}</span>
            {i.symbol === 'CPNVL' && <span className="block text-xs text-muted-foreground">Lấy từ dự toán vật tư — sửa dự toán ở Dự án → Vật tư</span>}</span>
          <span className="text-xs text-muted-foreground sm:text-right">đã dùng {shortMoney(used)}{l?.committed ? ` (gồm ${shortMoney(l.committed)} đơn chưa nhận)` : ''}</span>
          {i.symbol === 'CPNVL'
            ? <span className={`rounded-lg border border-border bg-muted px-2 py-1.5 text-right ${mat == null ? 'text-amber-700' : 'tabular-nums'}`}>{mat == null ? 'Chưa có dự toán' : money(mat)}</span>
            : <input value={values[i.id] ?? ''} onChange={e => setValues({ ...values, [i.id]: e.target.value })} onBlur={() => values[i.id] && setValues({ ...values, [i.id]: moneyInput(parseMoney(values[i.id]) || 0) })}
              placeholder="Chưa lập" inputMode="numeric" aria-label={`Ngân sách ${i.name}`}
              className={`text-right tabular-nums ${inputCls} ${values[i.id] && parseMoney(values[i.id]) < used ? 'border-amber-400' : ''}`} />}
        </div>; })}
    </section>)}
    <p className="rounded-xl bg-muted/50 px-3 py-2 text-sm">Tổng ngân sách: <b className={NUM}>{money((mat || 0) + other)} đ</b>
      <span className="text-xs text-muted-foreground"> = vật tư {mat == null ? '(chưa có dự toán)' : shortMoney(mat)} + khoản mục khác {shortMoney(other)}. Để trống = chưa lập (không tính là 0).</span></p>
    <F label="Lý do lập / điều chỉnh" hint="VD: Ngân sách ban đầu theo dự toán HĐ · Bổ sung nhân công theo biên bản phát sinh số 05">
      <input value={reason} onChange={e => setReason(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></F>
  </Drawer>;
};

// ---------- Đầu kỳ quỹ dự án ----------
export const FundOpeningDrawer: React.FC<{ data: FinanceProjectCost; onClose: () => void; onSaved: (m: string) => void }> = ({ data, onClose, onSaved }) => {
  const [inn, setInn] = useState(''); const [out, setOut] = useState(''); const [note, setNote] = useState(''); const [files, setFiles] = useState<FinanceAttachment[]>([]);
  const { busy, err, run } = useRun(onSaved);
  const a = parseMoney(inn); const b = parseMoney(out);
  const blockers = [inn.trim() === '' && 'Nhập tiền CĐT đã trả', out.trim() === '' && 'Nhập tiền đã chi', (a < 0 || b < 0) && 'Số không âm', !files.length && 'Đính sổ chi tiết MISA'].filter(Boolean) as string[];
  return <Drawer label="Đầu kỳ quỹ dự án" onClose={onClose}
    header={<><p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">Đầu kỳ quỹ dự án · đến hết 30/09/2026</p><h2 className={`text-lg ${ENT}`}>{data.project.code}</h2>
      <p className="text-sm text-muted-foreground">Theo MISA: tổng tiền chủ đầu tư đã trả − tổng tiền đã chi cho dự án đến 30/09. Người khác có quyền Xác nhận đối chiếu rồi chốt.</p></>}
    footer={<Footer err={err} blockers={blockers} busy={busy} onClose={onClose} label="Gửi chốt" icon={ClipboardCheck}
      onSave={() => void run(() => financeService.saveFundOpening({ projectId: data.project.id, receivedToDate: a, spentToDate: b, note: note.trim() || undefined, attachments: files }), 'Đã gửi đầu kỳ quỹ — chờ người khác chốt.')} />}>
    <div className="grid gap-3 sm:grid-cols-2">
      <F label="Tiền CĐT đã trả đến 30/09" hint={`Vioo đang ghi ${shortMoney(data.project.receivedAll)} tiền CĐT trả (toàn bộ) — đối chiếu MISA`}>
        <input value={inn} onChange={e => setInn(e.target.value)} onBlur={() => inn && setInn(moneyInput(parseMoney(inn) || 0))} inputMode="numeric" className={`mt-1 w-full text-right tabular-nums ${inputCls}`} /></F>
      <F label="Tiền đã chi cho dự án đến 30/09" hint="Tiền thật đã trả (NCC, nhân công, chi khác), không phải chi phí ghi nhận">
        <input value={out} onChange={e => setOut(e.target.value)} onBlur={() => out && setOut(moneyInput(parseMoney(out) || 0))} inputMode="numeric" className={`mt-1 w-full text-right tabular-nums ${inputCls}`} /></F>
    </div>
    {inn.trim() !== '' && out.trim() !== '' && a >= 0 && b >= 0 && <p className="rounded-xl bg-muted/50 px-3 py-2 text-sm">Số dư quỹ đầu kỳ: <b className={a - b >= 0 ? NUM : 'font-semibold tabular-nums text-rose-700'}>{signedMoney(a - b)}</b>
      {a - b < 0 && <span className="block text-xs text-rose-700">Âm = công ty đã ứng vốn cho dự án đến 30/09.</span>}</p>}
    <AttachmentPicker supplierId={`cost/${data.project.id}`} value={files} onChange={setFiles} label="Sổ chi tiết MISA theo dự án" required />
    <F label="Ghi chú"><input value={note} onChange={e => setNote(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></F>
  </Drawer>;
};

// ---------- Cấp vốn / thu hồi vốn ----------
export const CapitalDrawer: React.FC<{ data: FinanceProjectCost; kind: 'topup' | 'return'; onClose: () => void; onSaved: (m: string) => void }> = ({ data, kind: initial, onClose, onSaved }) => {
  const [kind, setKind] = useState(initial); const [amount, setAmount] = useState(''); const [date, setDate] = useState(data.today); const [reason, setReason] = useState('');
  const { busy, err, run } = useRun(onSaved);
  const amt = parseMoney(amount) || 0; const net = data.fund.capital; const bal = data.fund.balance;
  const blockers = [!(amt > 0) && 'Nhập số tiền', kind === 'return' && amt > net + 0.5 && `Tối đa ${shortMoney(Math.max(net, 0))}`, !reason.trim() && 'Ghi lý do', date < data.cutoverDate && 'Ngày từ 01/10'].filter(Boolean) as string[];
  return <Drawer label="Cấp vốn dự án" onClose={onClose}
    header={<><p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">{kind === 'topup' ? 'Cấp vốn dự án' : 'Thu hồi vốn'}</p><h2 className={`text-lg ${ENT}`}>{data.project.code}</h2>
      <p className="text-sm text-muted-foreground">Không chuyển tiền thật — ghi nhận công ty ứng vốn cho dự án (hoặc lấy lại khi CĐT đã trả). Ghi người, ngày, lý do.</p></>}
    footer={<Footer err={err} blockers={blockers} busy={busy} onClose={onClose} label={kind === 'topup' ? 'Cấp vốn' : 'Thu hồi vốn'} icon={kind === 'topup' ? HandCoins : Undo2}
      onSave={() => void run(() => financeService.saveCapital({ projectId: data.project.id, kind, amount: amt, date, reason: reason.trim() }), kind === 'topup' ? 'Đã ghi cấp vốn.' : 'Đã ghi thu hồi vốn.')} />}>
    <div role="radiogroup" aria-label="Loại" className="inline-flex rounded-xl border border-border bg-card p-1">
      {([['topup', 'Cấp vốn'], ['return', 'Thu hồi vốn']] as const).map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
        className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${kind === k ? 'bg-teal-700 text-white' : 'text-muted-foreground'}`}>{l}</button>)}
    </div>
    <dl className="grid grid-cols-2 gap-2 text-sm">
      <div className="rounded-xl bg-muted/50 px-3 py-2"><dt className="text-xs text-muted-foreground">Số dư quỹ hiện tại</dt><dd className={bal == null ? 'text-amber-700' : bal < 0 ? 'font-semibold tabular-nums text-rose-700' : NUM}>{bal == null ? 'Chưa chốt đầu kỳ' : signedMoney(bal)}</dd></div>
      <div className="rounded-xl bg-muted/50 px-3 py-2"><dt className="text-xs text-muted-foreground">Vốn công ty đang ứng</dt><dd className={NUM}>{shortMoney(Math.max(net, 0))}</dd></div>
    </dl>
    <div className="grid gap-3 sm:grid-cols-2">
      <F label="Số tiền"><input value={amount} onChange={e => setAmount(e.target.value)} onBlur={() => amount && setAmount(moneyInput(amt))} inputMode="numeric" className={`mt-1 w-full text-right tabular-nums ${inputCls}`} /></F>
      <F label="Ngày"><input type="date" value={date} min={data.cutoverDate} max={data.today} onChange={e => setDate(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></F>
    </div>
    <F label="Lý do" hint={kind === 'topup' ? 'VD: Ứng vốn trả NCC thép mái trong khi chờ CĐT thanh toán đợt 3' : 'VD: CĐT đã trả đợt 3 — thu hồi phần vốn đã ứng'}>
      <input value={reason} onChange={e => setReason(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></F>
  </Drawer>;
};
