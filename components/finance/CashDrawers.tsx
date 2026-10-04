import React, { useEffect, useState } from 'react';
import { ArrowLeftRight, CalendarClock, ClipboardCheck, Landmark, Loader2, Save, Send, ShieldCheck } from 'lucide-react';
import { financeService, type CashAccount, type CashAccountKind, type CashPlan, type FinanceAttachment, type FinanceCash, type FinancePaymentRequest, type FinanceRoutePreview } from '../../lib/financeService';
import { Drawer, inputCls, money, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { AttachmentPicker, ENT, FieldError, RouteExtrasNote, moneyInput, parseMoney } from './financeUi';

// Các form của Thu chi & quỹ. Máy chủ kiểm tra mọi số, quyền và tách nhiệm; ở đây chỉ gợi ý.

export const EXPENSE_CATEGORIES: Record<string, string> = {
  salary: 'Lương', tax: 'Thuế', insurance: 'Bảo hiểm', office: 'Chi phí văn phòng', utilities: 'Điện, nước', interest: 'Lãi vay', loan_repay: 'Trả nợ vay',
  staff_advance: 'Tạm ứng nhân viên', bank_fee: 'Phí ngân hàng', other: 'Chi khác',
};
export const RECEIPT_CATEGORIES: Record<string, string> = { loan: 'Vay ngân hàng', interest: 'Lãi tiền gửi', asset_sale: 'Thanh lý tài sản', staff_refund: 'Nhân viên hoàn ứng', other: 'Thu khác' };
export const COST_CATEGORIES: Record<string, string> = { labor: 'Nhân công', machinery: 'Máy thi công', overhead: 'Chi phí chung', materials: 'Vật tư', other: 'Khác' };
export const ACCOUNT_KINDS: Record<CashAccountKind, string> = { bank: 'Ngân hàng', cash: 'Tiền mặt', site: 'Quỹ công trường' };

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
const AccountOptions: React.FC<{ data: FinanceCash; exclude?: string }> = ({ data, exclude }) => <>{data.accounts.filter(a => a.active && a.id !== exclude).map(a =>
  <option key={a.id} value={a.id}>{a.name} — số dư {money(a.balance)}</option>)}</>;

// ---------- Tài khoản ----------
export const AccountDrawer: React.FC<{ data: FinanceCash; account?: CashAccount | null; onClose: () => void; onSaved: (m: string) => void }> = ({ data, account, onClose, onSaved }) => {
  const [kind, setKind] = useState<CashAccountKind>(account?.kind || 'bank'); const [name, setName] = useState(account?.name || '');
  const [bank, setBank] = useState(account?.bankName || ''); const [no, setNo] = useState(account?.accountNo || ''); const [project, setProject] = useState(account?.projectId || '');
  const [holder, setHolder] = useState(account?.holderName || ''); const [note, setNote] = useState(account?.note || ''); const [active, setActive] = useState(account?.active ?? true);
  const { busy, err, run } = useRun(onSaved);
  const blockers = [!name.trim() && 'Nhập tên', kind === 'bank' && !no.trim() && 'Nhập số tài khoản', kind === 'site' && !project && 'Chọn dự án'].filter(Boolean) as string[];
  return <Drawer label="Tài khoản tiền" onClose={onClose}
    header={<><p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">{account ? 'Sửa tài khoản tiền' : 'Khai tài khoản tiền'}</p>
      <h2 className={`text-lg ${ENT}`}>{name || 'Tài khoản mới'}</h2><p className="text-sm text-muted-foreground">Sau khi khai, gửi số dư đầu kỳ theo MISA 30/09 để người khác chốt.</p></>}
    footer={<Footer err={err} blockers={blockers} busy={busy} onClose={onClose} label="Lưu" icon={Save}
      onSave={() => void run(() => financeService.saveCashAccount({ id: account?.id, name: name.trim(), kind, bankName: bank, accountNo: no, projectId: kind === 'site' ? project : null, holderName: holder, note, isActive: active }), account ? 'Đã lưu tài khoản.' : 'Đã khai tài khoản — gửi số dư đầu kỳ.')} />}>
    <div className="grid gap-3 sm:grid-cols-2">
      <F label="Loại"><select value={kind} onChange={e => setKind(e.target.value as CashAccountKind)} className={`mt-1 w-full ${inputCls}`}>
        {(Object.keys(ACCOUNT_KINDS) as CashAccountKind[]).map(k => <option key={k} value={k}>{ACCOUNT_KINDS[k]}</option>)}</select></F>
      <F label="Tên hiển thị"><input value={name} onChange={e => setName(e.target.value)} placeholder="VD: Vietcombank — TK chính" className={`mt-1 w-full ${inputCls}`} /></F>
      {kind === 'bank' && <><F label="Ngân hàng"><input value={bank} onChange={e => setBank(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></F>
        <F label="Số tài khoản"><input value={no} onChange={e => setNo(e.target.value)} className={`mt-1 w-full tabular-nums ${inputCls}`} /></F></>}
      {kind === 'site' && <><F label="Dự án"><select value={project} onChange={e => setProject(e.target.value)} className={`mt-1 w-full ${inputCls}`}><option value="">Chọn dự án…</option>
        {data.projects.map(p => <option key={p.id} value={p.id}>{p.code}</option>)}</select></F>
        <F label="Người giữ quỹ"><input value={holder} onChange={e => setHolder(e.target.value)} placeholder="VD: CHT Nguyễn Văn An" className={`mt-1 w-full ${inputCls}`} /></F></>}
      <F label="Ghi chú" className="sm:col-span-2"><input value={note} onChange={e => setNote(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></F>
    </div>
    {account && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!active} onChange={e => setActive(!e.target.checked)} className="accent-teal-600" />Ngừng dùng (chỉ khi số dư 0 và không còn phiếu chờ)</label>}
  </Drawer>;
};

// ---------- Số dư đầu kỳ ----------
export const CashOpeningDrawer: React.FC<{ account: CashAccount; onClose: () => void; onSaved: (m: string) => void }> = ({ account, onClose, onSaved }) => {
  const [bal, setBal] = useState(''); const [note, setNote] = useState(''); const [files, setFiles] = useState<FinanceAttachment[]>([]);
  const { busy, err, run } = useRun(onSaved);
  const blockers = [bal.trim() === '' && 'Nhập số dư (0 nếu không có)', !files.length && 'Đính sổ quỹ / sao kê 30/09'].filter(Boolean) as string[];
  return <Drawer label="Số dư đầu kỳ" onClose={onClose}
    header={<><p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">Số dư đầu kỳ (MISA 30/09/2026)</p><h2 className={`text-lg ${ENT}`}>{account.name}</h2>
      <p className="text-sm text-muted-foreground">Người khác có quyền Xác nhận đối chiếu rồi chốt. Chưa chốt thì số dư tài khoản chưa tính đầu kỳ.</p></>}
    footer={<Footer err={err} blockers={blockers} busy={busy} onClose={onClose} label="Gửi chốt" icon={ClipboardCheck}
      onSave={() => void run(() => financeService.saveCashOpening({ accountId: account.id, balance: parseMoney(bal) || 0, note: note.trim() || undefined, attachments: files }), 'Đã gửi số dư đầu kỳ — chờ người khác chốt.')} />}>
    <F label="Số dư tại 30/09/2026" hint="Theo sổ quỹ / sổ tiền gửi MISA, khớp sao kê ngân hàng"><input value={bal} onChange={e => setBal(e.target.value)} onBlur={() => bal && setBal(moneyInput(parseMoney(bal) || 0))} inputMode="numeric" className={`mt-1 w-full text-right tabular-nums ${inputCls}`} /></F>
    <AttachmentPicker supplierId={`cash/${account.id}`} value={files} onChange={setFiles} label="Sổ quỹ / sao kê 30/09" required />
    <F label="Ghi chú"><input value={note} onChange={e => setNote(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></F>
  </Drawer>;
};

// ---------- Thu khác / chuyển tiền ----------
export const MovementDrawer: React.FC<{ data: FinanceCash; kind: 'receipt' | 'transfer'; onClose: () => void; onSaved: (m: string) => void }> = ({ data, kind, onClose, onSaved }) => {
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [amount, setAmount] = useState(''); const [date, setDate] = useState(data.today);
  const [cat, setCat] = useState(kind === 'receipt' ? 'interest' : 'transfer'); const [ref, setRef] = useState(''); const [party, setParty] = useState('');
  const [desc, setDesc] = useState(''); const [files, setFiles] = useState<FinanceAttachment[]>([]); const { busy, err, run } = useRun(onSaved);
  const amt = parseMoney(amount) || 0;
  const blockers = [!(amt > 0) && 'Nhập số tiền', !to && 'Chọn tài khoản nhận', kind === 'transfer' && !from && 'Chọn tài khoản chuyển', kind === 'transfer' && from && from === to && 'Hai tài khoản phải khác nhau',
    !desc.trim() && 'Nhập nội dung', kind === 'receipt' && !files.length && 'Đính chứng từ', date < data.cutoverDate && 'Trước mốc 01/10'].filter(Boolean) as string[];
  return <Drawer label={kind === 'receipt' ? 'Thu khác' : 'Chuyển tiền'} onClose={onClose}
    header={<><p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">{kind === 'receipt' ? 'Phiếu thu khác' : 'Chuyển tiền giữa tài khoản'}</p>
      <h2 className={`text-lg ${ENT}`}>{kind === 'receipt' ? 'Tiền vào không phải từ chủ đầu tư' : 'Rút tiền mặt, nộp tiền, chuyển ngân hàng, cấp quỹ công trường'}</h2>
      <p className="text-sm text-muted-foreground">{kind === 'transfer' ? 'Không phải thu, không phải chi: tổng tiền công ty không đổi, không tính chi phí.' : 'Thu từ CĐT ghi ở Phải thu; NCC hoàn tạm ứng ghi ở Tạm ứng NCC.'} Người khác xác nhận mới vào sổ.</p></>}
    footer={<Footer err={err} blockers={blockers} busy={busy} onClose={onClose} label="Gửi xác nhận" icon={kind === 'transfer' ? ArrowLeftRight : Send}
      onSave={() => void run(() => financeService.saveCashMovement({ kind, category: cat, fromAccountId: kind === 'transfer' ? from : null, toAccountId: to, amount: amt, date,
        documentRef: ref, counterparty: party, description: desc.trim(), attachments: files }), 'Đã gửi — chờ người khác xác nhận.')} />}>
    <div className="grid gap-3 sm:grid-cols-2">
      {kind === 'transfer' ? <F label="Từ tài khoản"><select value={from} onChange={e => setFrom(e.target.value)} className={`mt-1 w-full ${inputCls}`}><option value="">Chọn…</option><AccountOptions data={data} /></select></F>
        : <F label="Loại thu"><select value={cat} onChange={e => setCat(e.target.value)} className={`mt-1 w-full ${inputCls}`}>{Object.entries(RECEIPT_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></F>}
      <F label={kind === 'transfer' ? 'Đến tài khoản' : 'Vào tài khoản'}><select value={to} onChange={e => setTo(e.target.value)} className={`mt-1 w-full ${inputCls}`}><option value="">Chọn…</option><AccountOptions data={data} exclude={kind === 'transfer' ? from : undefined} /></select></F>
      <F label="Số tiền"><input value={amount} onChange={e => setAmount(e.target.value)} onBlur={() => setAmount(amt ? moneyInput(amt) : '')} inputMode="numeric" className={`mt-1 w-full text-right tabular-nums ${inputCls}`} /></F>
      <F label="Ngày"><input type="date" value={date} min={data.cutoverDate} max={data.today} onChange={e => setDate(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></F>
      <F label="Số chứng từ"><input value={ref} onChange={e => setRef(e.target.value)} placeholder="VD: GBC 0310-02" className={`mt-1 w-full ${inputCls}`} /></F>
      {kind === 'receipt' && <F label="Nộp tiền"><input value={party} onChange={e => setParty(e.target.value)} placeholder="VD: Vietcombank" className={`mt-1 w-full ${inputCls}`} /></F>}
      <F label="Nội dung" className="sm:col-span-2"><input value={desc} onChange={e => setDesc(e.target.value)} placeholder={kind === 'transfer' ? 'VD: Cấp quỹ công trường SMB tháng 10' : 'VD: Lãi tiền gửi tháng 9'} className={`mt-1 w-full ${inputCls}`} /></F>
    </div>
    <AttachmentPicker supplierId="cash" value={files} onChange={setFiles} label="Chứng từ (giấy báo có, phiếu thu, ủy nhiệm)" required={kind === 'receipt'} />
  </Drawer>;
};

// ---------- Đối chiếu sao kê ----------
export const ReconDrawer: React.FC<{ data: FinanceCash; account: CashAccount; onClose: () => void; onSaved: (m: string) => void }> = ({ data, account, onClose, onSaved }) => {
  const prev = new Date(Date.parse(`${data.today.slice(0, 7)}-01T00:00:00Z`) - 86400000).toISOString().slice(0, 7);
  const [month, setMonth] = useState(prev); const [stmt, setStmt] = useState(''); const [expl, setExpl] = useState(''); const [files, setFiles] = useState<FinanceAttachment[]>([]);
  const { busy, err, run } = useRun(onSaved);
  const blockers = [stmt.trim() === '' && 'Nhập số dư sao kê', !files.length && 'Đính sao kê', `${month}-01` >= `${data.today.slice(0, 7)}-01` && 'Chỉ đối chiếu tháng đã kết thúc'].filter(Boolean) as string[];
  return <Drawer label="Đối chiếu sao kê" onClose={onClose}
    header={<><p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">Đối chiếu sao kê</p><h2 className={`text-lg ${ENT}`}>{account.name}</h2>
      <p className="text-sm text-muted-foreground">Máy chủ tính số dư sổ cuối tháng; lệch phải giải thích. Người khác chốt — chốt xong khóa tháng (không ghi lùi ngày).</p></>}
    footer={<Footer err={err} blockers={blockers} busy={busy} onClose={onClose} label="Gửi chốt tháng" icon={ShieldCheck}
      onSave={() => void run(() => financeService.saveCashReconciliation({ accountId: account.id, month: `${month}-01`, statementBalance: parseMoney(stmt) || 0, explanation: expl.trim() || undefined, attachments: files }), 'Đã gửi đối chiếu — chờ người khác chốt.')} />}>
    <div className="grid gap-3 sm:grid-cols-2">
      <F label="Tháng"><input type="month" value={month} max={prev} onChange={e => setMonth(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></F>
      <F label="Số dư cuối tháng trên sao kê"><input value={stmt} onChange={e => setStmt(e.target.value)} onBlur={() => stmt && setStmt(moneyInput(parseMoney(stmt) || 0))} inputMode="numeric" className={`mt-1 w-full text-right tabular-nums ${inputCls}`} /></F>
    </div>
    <F label="Giải thích chênh lệch (nếu có)"><input value={expl} onChange={e => setExpl(e.target.value)} placeholder="VD: Phí ngân hàng 18 tr chưa ghi — đã lập phiếu chi khác" className={`mt-1 w-full ${inputCls}`} /></F>
    <AttachmentPicker supplierId={`cash/${account.id}`} value={files} onChange={setFiles} label="Sao kê ngân hàng / biên bản kiểm quỹ" required />
  </Drawer>;
};

// ---------- Khoản định kỳ (dự báo) ----------
export const PlanDrawer: React.FC<{ data: FinanceCash; plan?: CashPlan | null; onClose: () => void; onSaved: (m: string) => void }> = ({ data, plan, onClose, onSaved }) => {
  const [name, setName] = useState(plan?.name || ''); const [dir, setDir] = useState<'in' | 'out'>(plan?.direction || 'out'); const [cat, setCat] = useState(plan?.category || 'salary');
  const [amount, setAmount] = useState(plan ? moneyInput(plan.amount) : ''); const [day, setDay] = useState(String(plan?.dayOfMonth || 5));
  const [start, setStart] = useState((plan?.startMonth || data.today).slice(0, 7)); const [end, setEnd] = useState(plan?.endMonth?.slice(0, 7) || ''); const [active, setActive] = useState(plan?.active ?? true);
  const { busy, err, run } = useRun(onSaved); const amt = parseMoney(amount) || 0;
  const blockers = [!name.trim() && 'Nhập tên', !(amt > 0) && 'Nhập số tiền', !(Number(day) >= 1 && Number(day) <= 28) && 'Ngày 1–28'].filter(Boolean) as string[];
  const cats = dir === 'out' ? EXPENSE_CATEGORIES : RECEIPT_CATEGORIES;
  return <Drawer label="Khoản định kỳ" onClose={onClose}
    header={<><p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">Khoản thu / chi định kỳ</p><h2 className={`text-lg ${ENT}`}>{name || 'Khoản mới'}</h2>
      <p className="text-sm text-muted-foreground">Chỉ dùng cho dự báo dòng tiền (lương, thuê văn phòng, trả nợ vay…). Khi chi thật vẫn lập phiếu chi khác.</p></>}
    footer={<Footer err={err} blockers={blockers} busy={busy} onClose={onClose} label="Lưu" icon={CalendarClock}
      onSave={() => void run(() => financeService.saveCashPlan({ id: plan?.id, name: name.trim(), direction: dir, category: cat, amount: amt, dayOfMonth: Number(day), startMonth: `${start}-01`, endMonth: end ? `${end}-01` : null, active }), 'Đã lưu khoản định kỳ.')} />}>
    <div className="grid gap-3 sm:grid-cols-2">
      <F label="Tên"><input value={name} onChange={e => setName(e.target.value)} placeholder="VD: Lương khối văn phòng" className={`mt-1 w-full ${inputCls}`} /></F>
      <F label="Thu / chi"><select value={dir} onChange={e => { setDir(e.target.value as 'in' | 'out'); setCat(e.target.value === 'out' ? 'salary' : 'other'); }} className={`mt-1 w-full ${inputCls}`}><option value="out">Chi</option><option value="in">Thu</option></select></F>
      <F label="Loại"><select value={cat} onChange={e => setCat(e.target.value)} className={`mt-1 w-full ${inputCls}`}>{Object.entries(cats).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></F>
      <F label="Số tiền mỗi tháng"><input value={amount} onChange={e => setAmount(e.target.value)} onBlur={() => setAmount(amt ? moneyInput(amt) : '')} inputMode="numeric" className={`mt-1 w-full text-right tabular-nums ${inputCls}`} /></F>
      <F label="Ngày trong tháng (1–28)"><input value={day} onChange={e => setDay(e.target.value)} inputMode="numeric" className={`mt-1 w-full text-right ${inputCls}`} /></F>
      <F label="Từ tháng"><input type="month" value={start} onChange={e => setStart(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></F>
      <F label="Đến tháng" hint="Để trống = không kết thúc"><input type="month" value={end} onChange={e => setEnd(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></F>
    </div>
    {plan && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!active} onChange={e => setActive(!e.target.checked)} className="accent-teal-600" />Tạm dừng</label>}
  </Drawer>;
};

// ---------- Phiếu chi khác (đề nghị chi loại expense) ----------
export const ExpenseDrawer: React.FC<{ projects?: Array<{ id: string; code: string | null }>; request?: FinancePaymentRequest | null; onClose: () => void; onSaved: (m: string) => void }> = ({ projects: given, request, onClose, onSaved }) => {
  const [projects, setProjects] = useState(given || []);
  useEffect(() => { if (!given) financeService.cash().then(d => setProjects(d.projects)).catch(() => undefined); }, [given]);
  const [cat, setCat] = useState(request?.expense?.category || 'salary'); const [party, setParty] = useState(request?.supplierName || '');
  const [amount, setAmount] = useState(request ? moneyInput(request.amount) : ''); const [date, setDate] = useState(request?.plannedDate || new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<'bank_transfer' | 'cash'>(request?.method || 'bank_transfer'); const [note, setNote] = useState(request?.note || '');
  const [project, setProject] = useState(request?.expense?.projectId || ''); const [cost, setCost] = useState(request?.expense?.costCategory || 'overhead');
  const [preview, setPreview] = useState<{ route: FinanceRoutePreview['route']; canRecord: boolean } | null>(null);
  const { busy, err, run } = useRun(onSaved); const amt = parseMoney(amount) || 0;
  useEffect(() => { if (!(amt > 0)) { setPreview(null); return; } const t = setTimeout(() => { financeService.previewExpense({ amount: amt, requestId: request?.id, projectId: project || null, costCategory: project ? cost : null }).then(setPreview).catch(() => setPreview(null)); }, 350); return () => clearTimeout(t); }, [amt, request?.id, project, cost]);
  const blockers = [!party.trim() && 'Nhập người nhận', !(amt > 0) && 'Nhập số tiền', !note.trim() && 'Nhập nội dung', preview?.route.problemStep && `Bước "${preview.route.problemStep}" chưa có người duyệt`,
    preview && !preview.canRecord && 'Cần quyền Tài chính — Ghi nhận'].filter(Boolean) as string[];
  return <Drawer label="Phiếu chi khác" wide onClose={onClose}
    header={<><p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">{request ? `Sửa và gửi lại ${request.code}` : 'Phiếu chi khác'}</p>
      <h2 className={`text-lg ${ENT}`}>Khoản chi không qua NCC</h2>
      <p className="text-sm text-muted-foreground">Lương, thuế, bảo hiểm, văn phòng, lãi vay, trả nợ vay, tạm ứng nhân viên… Duyệt theo ma trận như đề nghị chi; người khác người lập và người duyệt xác nhận đã chi (chọn tài khoản).</p></>}
    footer={<Footer err={err} blockers={blockers} busy={busy} onClose={onClose} label={`${request ? 'Gửi lại' : 'Gửi duyệt'} ${amt ? `${money(amt)} đ` : ''}`} icon={Send}
      onSave={() => void run(() => financeService.saveExpense({ requestId: request?.id, expectedRowVersion: request?.rowVersion, counterparty: party.trim(), category: cat, amount: amt, plannedDate: date,
        method, note: note.trim(), projectId: project || null, costCategory: project ? cost : null }), request ? 'Đã gửi lại — chờ duyệt.' : 'Đã gửi duyệt — xem ở Phải trả → Đề nghị chi.')} />}>
    <div className="grid gap-3 md:grid-cols-3">
      <F label="Loại chi"><select value={cat} onChange={e => setCat(e.target.value)} className={`mt-1 w-full ${inputCls}`}>{Object.entries(EXPENSE_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></F>
      <F label="Người / nơi nhận"><input value={party} onChange={e => setParty(e.target.value)} placeholder="VD: Nhân viên khối văn phòng · Chi cục thuế" className={`mt-1 w-full ${inputCls}`} /></F>
      <F label="Số tiền"><input value={amount} onChange={e => setAmount(e.target.value)} onBlur={() => setAmount(amt ? moneyInput(amt) : '')} inputMode="numeric" className={`mt-1 w-full text-right tabular-nums ${inputCls}`} /></F>
      <F label="Ngày dự kiến chi"><input type="date" value={date} onChange={e => setDate(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></F>
      <F label="Hình thức"><select value={method} onChange={e => setMethod(e.target.value as 'bank_transfer' | 'cash')} className={`mt-1 w-full ${inputCls}`}><option value="bank_transfer">Chuyển khoản</option><option value="cash">Tiền mặt</option></select></F>
      <F label="Tính vào chi phí dự án" hint={project ? 'Ghi chi phí dự án khi xác nhận đã chi' : 'Chi phí chung công ty'}><select value={project} onChange={e => setProject(e.target.value)} className={`mt-1 w-full ${inputCls}`}>
        <option value="">Không — chi phí chung</option>{projects.map(p => <option key={p.id} value={p.id}>{p.code}</option>)}</select></F>
      {project && <F label="Khoản mục chi phí"><select value={cost} onChange={e => setCost(e.target.value)} className={`mt-1 w-full ${inputCls}`}>{Object.entries(COST_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></F>}
      <F label="Nội dung" className="md:col-span-3"><input value={note} onChange={e => setNote(e.target.value)} placeholder="VD: Lương tháng 9 khối văn phòng" className={`mt-1 w-full ${inputCls}`} /></F>
    </div>
    <section className="rounded-xl border border-border p-3 text-sm"><h3 className="flex items-center gap-1.5 font-semibold"><ShieldCheck size={15} className="text-teal-700" />Luồng duyệt</h3>
      {!preview ? <p className="mt-1 text-muted-foreground">Nhập số tiền để xem ai duyệt.</p>
        : <ol className="mt-2 flex flex-wrap items-center gap-2">{preview.route.steps.map((s, i) => <li key={i} className="flex items-center gap-2">{i > 0 && <span className="text-muted-foreground">→</span>}
          <span className={`rounded-lg border px-2 py-1 ${s.eligibleIds.length ? 'border-border' : 'border-rose-300 bg-rose-50'}`}><b>{i + 1}. {s.label}</b><span className="block text-xs text-muted-foreground">{s.eligibleNames.join(' hoặc ') || 'Không còn người hợp lệ'}</span></span></li>)}
          <li className="flex items-center gap-2"><span className="text-muted-foreground">→</span><span className="rounded-lg border border-dashed border-border px-2 py-1"><b>Xác nhận đã chi</b><span className="block text-xs text-muted-foreground">người thứ ba · chọn tài khoản · UNC</span></span></li></ol>}
      <RouteExtrasNote route={preview?.route} />
    </section>
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Landmark size={13} />Khoản lặp lại hằng tháng: khai thêm ở "Khoản định kỳ" để dự báo dòng tiền tính trước.</p>
  </Drawer>;
};
