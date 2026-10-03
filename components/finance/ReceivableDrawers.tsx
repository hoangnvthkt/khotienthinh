import React, { useMemo, useState } from 'react';
import { Banknote, CheckCircle2, ClipboardCheck, Landmark, Loader2, Save, Settings2 } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import {
  financeService, type ContractGuarantee, type CustomerContractDetail, type FinanceAttachment, type ReceivableRound, type ReceivableRoundKind,
} from '../../lib/financeService';
import { Drawer, inputCls, money, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { AttachmentPicker, ENT, FieldError, NUM, moneyInput, parseMoney, viDate } from './financeUi';

// Các form của Phải thu CĐT. Máy chủ tính lại và kiểm tra mọi số; ở đây chỉ gợi ý để người dùng thấy trước.

export const KIND_LABELS: Record<ReceivableRoundKind, string> = {
  advance: 'Tạm ứng', progress: 'Nghiệm thu khối lượng', settlement: 'Quyết toán', retention: 'Trả tiền giữ lại', other: 'Khác', opening: 'Số dư đầu kỳ',
};
const DEDUCT_KINDS: ReceivableRoundKind[] = ['progress', 'settlement', 'other'];
const r2 = (n: number) => Math.round(n * 100) / 100;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Gợi ý thu hồi tạm ứng / giữ lại như máy chủ (finance_round_suggest). */
export const suggestDeductions = (d: CustomerContractDetail, kind: ReceivableRoundKind, gross: number, round?: ReceivableRound | null) => {
  if (!DEDUCT_KINDS.includes(kind)) return { recovery: 0, retention: 0 };
  const remaining = d.metrics.advanceRemaining + (round?.status === 'confirmed' ? round.advanceRecovery : 0);
  return { recovery: Math.min(r2(gross * d.metrics.recoveryPercent / 100), remaining), retention: r2(gross * d.metrics.retentionPercent / 100) };
};

const Field: React.FC<{ label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }> = ({ label, hint, children, className = '' }) =>
  <label className={`block text-sm font-medium ${className}`}>{label}{children}{hint && <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{hint}</span>}</label>;

const Deductions: React.FC<{ d: CustomerContractDetail; gross: number; rec: number; ret: number; sug: { recovery: number; retention: number };
  recInput: string; retInput: string; setRec: (v: string) => void; setRet: (v: string) => void; enabled: boolean }> = ({ d, gross, rec, ret, sug, recInput, retInput, setRec, setRet, enabled }) =>
  <section className="rounded-xl border border-border p-3 text-sm"><h3 className="font-semibold">Tính phải thu</h3>
    <dl className="mt-2 space-y-1.5">
      <div className="flex justify-between gap-2"><dt>Giá trị đợt gồm VAT</dt><dd className="tabular-nums">{money(gross)}</dd></div>
      <div className="flex items-center justify-between gap-2"><dt>Thu hồi tạm ứng <span className="text-xs text-muted-foreground">
        ({Number(d.metrics.recoveryPercent).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}% {d.metrics.recoveryPercentSource === 'contract' ? 'theo HĐ' : '= tạm ứng ÷ HĐ'} · còn phải thu hồi {money(d.metrics.advanceRemaining)})</span></dt>
        <dd>{enabled ? <input value={recInput} onChange={e => setRec(e.target.value)} placeholder={moneyInput(sug.recovery)} inputMode="numeric" aria-label="Thu hồi tạm ứng" className={`w-40 text-right tabular-nums ${inputCls}`} /> : <span className="tabular-nums">0</span>}</dd></div>
      <div className="flex items-center justify-between gap-2"><dt>Giữ lại bảo hành <span className="text-xs text-muted-foreground">
        ({Number(d.metrics.retentionPercent)}% {d.metrics.retentionPercentSource === 'contract' ? 'theo HĐ' : '— HĐ chưa khai, đang dùng mặc định'})</span></dt>
        <dd>{enabled ? <input value={retInput} onChange={e => setRet(e.target.value)} placeholder={moneyInput(sug.retention)} inputMode="numeric" aria-label="Giữ lại bảo hành" className={`w-40 text-right tabular-nums ${inputCls}`} /> : <span className="tabular-nums">0</span>}</dd></div>
      <div className="flex justify-between gap-2 border-t border-border pt-1.5 font-bold"><dt>Phải thu đợt này</dt><dd className={NUM}>{money(Math.max(0, gross - rec - ret))} đ</dd></div>
    </dl>
    {enabled && <p className="mt-1 text-xs text-muted-foreground">Để trống = theo gợi ý. Khác gợi ý phải ghi lý do.</p>}
  </section>;

// ---------- Lập / sửa đợt ----------
export const RoundDrawer: React.FC<{ d: CustomerContractDetail; round?: ReceivableRound | null; onClose: () => void; onSaved: (msg: string) => void }> = ({ d, round, onClose, onSaved }) => {
  const toast = useToast();
  const [kind, setKind] = useState<ReceivableRoundKind>(round?.kind || 'progress');
  const [desc, setDesc] = useState(round?.description || '');
  const [net, setNet] = useState(round ? moneyInput(round.netAmount) : '');
  const [vat, setVat] = useState(String(round?.vatPercent ?? d.contract.vatPercent));
  const [rec, setRec] = useState(round && round.suggestedRecovery != null && Math.abs(round.advanceRecovery - round.suggestedRecovery) > 1 ? moneyInput(round.advanceRecovery) : '');
  const [ret, setRet] = useState(round && round.suggestedRetention != null && Math.abs(round.retention - round.suggestedRetention) > 1 ? moneyInput(round.retention) : '');
  const [reason, setReason] = useState(round?.adjustReason || '');
  const [files, setFiles] = useState<FinanceAttachment[]>(round?.attachments || []);
  const [note, setNote] = useState(round?.note || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const netV = parseMoney(net) || 0; const vatV = Number(vat.replace(',', '.')) || 0;
  const gross = r2(netV + r2(netV * vatV / 100));
  const sug = suggestDeductions(d, kind, gross, round);
  const enabled = DEDUCT_KINDS.includes(kind);
  const recV = enabled && rec.trim() ? parseMoney(rec) : sug.recovery; const retV = enabled && ret.trim() ? parseMoney(ret) : sug.retention;
  const differs = Math.abs(recV - sug.recovery) > 1 || Math.abs(retV - sug.retention) > 1;
  const blockers = [!desc.trim() && 'Nhập nội dung', !(netV > 0) && 'Nhập giá trị khối lượng', recV + retV > gross && 'Khấu trừ lớn hơn giá trị đợt',
    differs && !reason.trim() && 'Ghi lý do khi khác gợi ý', kind === 'retention' && gross > d.metrics.retentionHeld + 0.5 && `Vượt số đang giữ lại (${money(d.metrics.retentionHeld)} đ)`].filter(Boolean) as string[];
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await financeService.saveRound({ id: round?.id, expectedRowVersion: round?.rowVersion, contractId: d.contract.id, kind, description: desc.trim(), netAmount: netV, vatPercent: vatV,
        advanceRecovery: enabled && rec.trim() ? recV : null, retention: enabled && ret.trim() ? retV : null, adjustReason: reason.trim() || undefined, attachments: files, note: note.trim() || undefined });
      toast.success(`Đợt ${r.sequenceNo}`, round ? 'Đã lưu.' : 'Đã lập đợt nháp — gửi hồ sơ CĐT xong thì bấm "Đã gửi CĐT".'); onSaved(`Đã lưu đợt ${r.sequenceNo}.`);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return <Drawer label="Đợt đề nghị thanh toán" wide onClose={onClose}
    header={<><p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">{round ? `Sửa đợt ${round.sequenceNo}` : 'Lập đợt đề nghị thanh toán'}</p>
      <h2 className={`text-lg ${ENT}`}>{d.contract.projectCode || d.contract.code} · {d.contract.customerName}</h2>
      <p className="text-sm text-muted-foreground">Giá trị theo hồ sơ gửi CĐT. CĐT xác nhận số tiền thì mới thành phải thu.</p></>}
    footer={<><FieldError error={err} />{!err && blockers.length > 0 && <span className="mr-auto text-xs text-amber-700 dark:text-amber-300">{blockers.join(' · ')}</span>}
      <button type="button" className={secondaryBtn} onClick={onClose}>Đóng</button>
      <button type="button" className={primaryBtn} disabled={busy || blockers.length > 0} onClick={() => void save()}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}Lưu đợt nháp</button></>}>
    <div className="grid gap-3 md:grid-cols-2">
      <Field label="Loại đợt"><select value={kind} onChange={e => setKind(e.target.value as ReceivableRoundKind)} className={`mt-1 w-full ${inputCls}`}>
        {(['progress', 'advance', 'settlement', 'retention', 'other'] as const).map(k => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}</select></Field>
      <Field label="Nội dung"><input value={desc} onChange={e => setDesc(e.target.value)} placeholder="VD: Nghiệm thu lần 3 — thép mái, bao che" className={`mt-1 w-full ${inputCls}`} /></Field>
      <Field label="Giá trị (trước VAT)" hint={kind === 'retention' ? `Đang giữ lại ${money(d.metrics.retentionHeld)} đ` : 'Theo bảng tính / biên bản nghiệm thu gửi CĐT'}>
        <input value={net} onChange={e => setNet(e.target.value)} onBlur={() => setNet(moneyInput(netV))} inputMode="numeric" className={`mt-1 w-full text-right tabular-nums ${inputCls}`} /></Field>
      <Field label="VAT (%)" hint={`HĐ: ${d.contract.vatPercent}%`}><input value={vat} onChange={e => setVat(e.target.value)} inputMode="decimal" className={`mt-1 w-full text-right ${inputCls}`} /></Field>
    </div>
    <Deductions d={d} gross={gross} rec={recV} ret={retV} sug={sug} recInput={rec} retInput={ret} setRec={setRec} setRet={setRet} enabled={enabled} />
    {differs && <Field label="Lý do khác gợi ý"><input value={reason} onChange={e => setReason(e.target.value)} placeholder="VD: CĐT yêu cầu thu hồi tạm ứng 40% đợt này" className={`mt-1 w-full ${inputCls}`} /></Field>}
    <AttachmentPicker supplierId={`customer/${d.contract.id}`} value={files} onChange={setFiles} label="Hồ sơ (biên bản nghiệm thu, bảng tính, ảnh)" />
    <Field label="Ghi chú"><input value={note} onChange={e => setNote(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></Field>
  </Drawer>;
};

// ---------- CĐT xác nhận ----------
export const ConfirmRoundDrawer: React.FC<{ d: CustomerContractDetail; round: ReceivableRound; onClose: () => void; onDone: (msg: string) => void }> = ({ d, round, onClose, onDone }) => {
  const [date, setDate] = useState(d.today);
  const [gross, setGross] = useState(moneyInput(round.gross));
  const [rec, setRec] = useState(''); const [ret, setRet] = useState(''); const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const g = parseMoney(gross) || 0; const changed = Math.abs(g - round.gross) > 0.5;
  const sug = changed ? suggestDeductions(d, round.kind, g, round) : { recovery: round.advanceRecovery, retention: round.retention };
  const enabled = DEDUCT_KINDS.includes(round.kind);
  const recV = enabled && rec.trim() ? parseMoney(rec) : sug.recovery; const retV = enabled && ret.trim() ? parseMoney(ret) : sug.retention;
  const blockers = [!(g > 0) && 'Nhập số CĐT xác nhận', changed && !reason.trim() && 'CĐT duyệt khác số gửi — ghi lý do', recV + retV > g && 'Khấu trừ lớn hơn giá trị', date > d.today && 'Ngày không được sau hôm nay'].filter(Boolean) as string[];
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await financeService.transitionRound({ id: round.id, expectedRowVersion: round.rowVersion, action: 'confirm', date, confirmedGross: g,
        advanceRecovery: enabled && rec.trim() ? recV : null, retention: enabled && ret.trim() ? retV : null, reason: reason.trim() || undefined });
      onDone(`Đợt ${round.sequenceNo}: phải thu ${money(r.receivable)} đ, hạn ${viDate(r.dueDate)}.`);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return <Drawer label="CĐT xác nhận" onClose={onClose}
    header={<><p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">CĐT xác nhận đợt {round.sequenceNo}</p>
      <h2 className={`text-lg ${ENT}`}>{round.description}</h2><p className="text-sm text-muted-foreground">Đã gửi {viDate(round.sentDate)} · số gửi {money(round.gross)} đ gồm VAT</p></>}
    footer={<><FieldError error={err} />{!err && blockers.length > 0 && <span className="mr-auto text-xs text-amber-700 dark:text-amber-300">{blockers.join(' · ')}</span>}
      <button type="button" className={secondaryBtn} onClick={onClose}>Đóng</button>
      <button type="button" className={primaryBtn} disabled={busy || blockers.length > 0} onClick={() => void submit()}>{busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}Ghi CĐT xác nhận</button></>}>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Ngày CĐT xác nhận" hint={`Hạn thu = ngày này + ${d.metrics.paymentTermDays} ngày → ${viDate(addDays(date, d.metrics.paymentTermDays))}`}>
        <input type="date" max={d.today} value={date} onChange={e => setDate(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></Field>
      <Field label="Số CĐT xác nhận (gồm VAT)" hint={changed ? <span className="text-amber-700 dark:text-amber-300">Khác số gửi {money(g - round.gross)} đ — chênh lệch không thành phải thu</span> : 'Mặc định bằng số đã gửi'}>
        <input value={gross} onChange={e => setGross(e.target.value)} onBlur={() => setGross(moneyInput(g))} inputMode="numeric" className={`mt-1 w-full text-right tabular-nums ${inputCls}`} /></Field>
    </div>
    <Deductions d={d} gross={g} rec={recV} ret={retV} sug={sug} recInput={rec} retInput={ret} setRec={setRec} setRet={setRet} enabled={enabled} />
    <Field label={changed ? 'Lý do CĐT duyệt khác (bắt buộc)' : 'Ghi chú của CĐT'}><input value={reason} onChange={e => setReason(e.target.value)} placeholder="VD: CĐT trừ khối lượng sơn chưa đạt" className={`mt-1 w-full ${inputCls}`} /></Field>
  </Drawer>;
};

// ---------- Phiếu thu ----------
export const ReceiptDrawer: React.FC<{ d: CustomerContractDetail; onClose: () => void; onSaved: (msg: string) => void }> = ({ d, onClose, onSaved }) => {
  const open = useMemo(() => d.rounds.filter(r => r.status === 'confirmed' && r.outstanding - r.pending > 0.5)
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999')), [d.rounds]);
  const [amount, setAmount] = useState(''); const [date, setDate] = useState(d.today); const [ref, setRef] = useState('');
  const [files, setFiles] = useState<FinanceAttachment[]>([]); const [note, setNote] = useState('');
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const amt = parseMoney(amount) || 0;
  // Gợi ý: trừ vào đợt hạn sớm trước cho tới khi hết tiền.
  const fifo = () => { let left = amt; const next: Record<string, string> = {}; open.forEach(r => { const take = Math.max(0, Math.min(left, r.outstanding - r.pending)); if (take > 0) next[r.id] = moneyInput(take); left -= take; }); setAlloc(next); };
  const lines = open.map(r => ({ roundId: r.id, amount: parseMoney(alloc[r.id] || '') || 0, max: r.outstanding - r.pending })).filter(l => l.amount > 0);
  const allocated = lines.reduce((s, l) => s + l.amount, 0);
  const blockers = [!(amt > 0) && 'Nhập số tiền', !ref.trim() && 'Nhập số giấy báo có', !files.length && 'Đính giấy báo có / sao kê', date > d.today && 'Ngày không được sau hôm nay',
    allocated > amt + 0.5 && 'Trừ vào đợt nhiều hơn số tiền nhận', lines.some(l => l.amount > l.max + 0.5) && 'Trừ quá phần còn phải thu của đợt'].filter(Boolean) as string[];
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await financeService.saveCustomerReceipt({ contractId: d.contract.id, amount: amt, receiptDate: date, documentRef: ref.trim(), attachments: files, note: note.trim() || undefined,
        allocations: lines.map(l => ({ roundId: l.roundId, amount: l.amount })) });
      onSaved(`Đã ghi ${r.code} — chờ người khác xác nhận.${r.unallocated > 0.5 ? ` ${money(r.unallocated)} đ là CĐT trả trước.` : ''}`);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return <Drawer label="Ghi CĐT trả tiền" onClose={onClose}
    header={<><p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">Phiếu thu</p><h2 className={`text-lg ${ENT}`}>{d.contract.customerName}</h2>
      <p className="text-sm text-muted-foreground">Ghi theo giấy báo có. Người khác có quyền Xác nhận đối chiếu rồi xác nhận mới ghi dòng tiền vào của dự án.</p></>}
    footer={<><FieldError error={err} />{!err && blockers.length > 0 && amt > 0 && <span className="mr-auto text-xs text-amber-700 dark:text-amber-300">{blockers.join(' · ')}</span>}
      <button type="button" className={secondaryBtn} onClick={onClose}>Đóng</button>
      <button type="button" className={primaryBtn} disabled={busy || blockers.length > 0} onClick={() => void save()}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Banknote size={15} />}Gửi xác nhận</button></>}>
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Số tiền nhận"><input value={amount} onChange={e => setAmount(e.target.value)} onBlur={() => { setAmount(moneyInput(amt)); if (!Object.keys(alloc).length) fifo(); }} inputMode="numeric" className={`mt-1 w-full text-right tabular-nums ${inputCls}`} /></Field>
      <Field label="Ngày nhận"><input type="date" max={d.today} value={date} onChange={e => setDate(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></Field>
      <Field label="Số giấy báo có"><input value={ref} onChange={e => setRef(e.target.value)} placeholder="VD: GBC 0310-12" className={`mt-1 w-full ${inputCls}`} /></Field>
    </div>
    <section className="rounded-xl border border-border p-3 text-sm">
      <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Trừ vào đợt</h3>{open.length > 0 && amt > 0 && <button type="button" onClick={fifo} className="text-xs font-semibold text-teal-700 hover:underline">Gợi ý: hạn sớm trước</button>}</div>
      {open.length === 0 ? <p className="mt-1 text-muted-foreground">Chưa có đợt nào CĐT xác nhận còn phải thu — toàn bộ tiền ghi là CĐT trả trước, trừ vào đợt sau.</p>
        : <ul className="mt-2 space-y-1.5">{open.map(r => <li key={r.id} className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1"><b>Đợt {r.sequenceNo}</b> {r.description}<span className="block text-xs text-muted-foreground">còn {money(r.outstanding - r.pending)} đ{r.pending > 0 ? ` (đã có ${money(r.pending)} đ chờ xác nhận)` : ''} · hạn {viDate(r.dueDate)}</span></span>
          <input value={alloc[r.id] || ''} onChange={e => setAlloc(a => ({ ...a, [r.id]: e.target.value }))} inputMode="numeric" aria-label={`Trừ vào đợt ${r.sequenceNo}`} className={`w-40 text-right tabular-nums ${inputCls}`} /></li>)}</ul>}
      <p className="mt-2 flex justify-between text-xs text-muted-foreground"><span>Trừ vào đợt {money(allocated)} đ</span>{amt - allocated > 0.5 && <span className="font-semibold text-teal-800 dark:text-teal-200">CĐT trả trước {money(amt - allocated)} đ</span>}</p>
    </section>
    <AttachmentPicker supplierId={`customer/${d.contract.id}`} value={files} onChange={setFiles} label="Giấy báo có / sao kê" required />
    <Field label="Ghi chú"><input value={note} onChange={e => setNote(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></Field>
  </Drawer>;
};

// ---------- Đối chiếu đầu kỳ ----------
export const CustomerOpeningDrawer: React.FC<{ d: CustomerContractDetail; onClose: () => void; onSaved: (msg: string) => void }> = ({ d, onClose, onSaved }) => {
  const [rcv, setRcv] = useState(''); const [due, setDue] = useState(''); const [adv, setAdv] = useState(moneyInput(d.metrics.advanceRemaining));
  const [ret, setRet] = useState('0'); const [note, setNote] = useState(''); const [files, setFiles] = useState<FinanceAttachment[]>([]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const misaDate = viDate(addDays(d.cutoverDate, -1));
  const blockers = [rcv.trim() === '' && 'Nhập phải thu còn lại (0 nếu không còn)', !files.length && 'Đính sổ chi tiết MISA / biên bản đối chiếu'].filter(Boolean) as string[];
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await financeService.saveCustomerOpening({ contractId: d.contract.id, receivableAmount: parseMoney(rcv) || 0, receivableDueDate: due || null,
        advanceRemaining: parseMoney(adv) || 0, retentionHeld: parseMoney(ret) || 0, note: note.trim() || undefined, attachments: files });
      onSaved('Đã gửi đối chiếu đầu kỳ — chờ người khác chốt.');
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return <Drawer label="Đối chiếu đầu kỳ phải thu" onClose={onClose}
    header={<><p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">Đối chiếu đầu kỳ với MISA {misaDate}</p><h2 className={`text-lg ${ENT}`}>{d.contract.projectCode} · {d.contract.customerName}</h2>
      <p className="text-sm text-muted-foreground">Các đợt thu cũ trong Vioo chưa tách thu hồi tạm ứng / giữ lại. Lấy số theo sổ MISA để từ nay tính đúng. Người khác chốt.</p></>}
    footer={<><FieldError error={err} />{!err && blockers.length > 0 && <span className="mr-auto text-xs text-amber-700 dark:text-amber-300">{blockers.join(' · ')}</span>}
      <button type="button" className={secondaryBtn} onClick={onClose}>Đóng</button>
      <button type="button" className={primaryBtn} disabled={busy || blockers.length > 0} onClick={() => void save()}>{busy ? <Loader2 size={15} className="animate-spin" /> : <ClipboardCheck size={15} />}Gửi chốt</button></>}>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={`Phải thu còn lại tại ${misaDate}`} hint="CĐT đã xác nhận nhưng chưa trả (đợt nghiệm thu cũ)"><input value={rcv} onChange={e => setRcv(e.target.value)} onBlur={() => rcv && setRcv(moneyInput(parseMoney(rcv) || 0))} inputMode="numeric" className={`mt-1 w-full text-right tabular-nums ${inputCls}`} /></Field>
      <Field label="Hạn của phần còn phải thu" hint="Để trống = ngày mốc"><input type="date" value={due} onChange={e => setDue(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></Field>
      <Field label="Tạm ứng CĐT chưa thu hồi" hint={`Vioo đang tạm tính ${money(d.metrics.advanceRemaining)} đ (chưa trừ phần đã thu hồi trong các đợt cũ)`}><input value={adv} onChange={e => setAdv(e.target.value)} onBlur={() => setAdv(moneyInput(parseMoney(adv) || 0))} inputMode="numeric" className={`mt-1 w-full text-right tabular-nums ${inputCls}`} /></Field>
      <Field label="Tiền CĐT đang giữ lại bảo hành"><input value={ret} onChange={e => setRet(e.target.value)} onBlur={() => setRet(moneyInput(parseMoney(ret) || 0))} inputMode="numeric" className={`mt-1 w-full text-right tabular-nums ${inputCls}`} /></Field>
    </div>
    <AttachmentPicker supplierId={`customer/${d.contract.id}`} value={files} onChange={setFiles} label="Sổ chi tiết MISA / biên bản đối chiếu với CĐT" required />
    <Field label="Ghi chú"><input value={note} onChange={e => setNote(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></Field>
  </Drawer>;
};

// ---------- Điều khoản HĐ ----------
export const CustomerTermsDrawer: React.FC<{ d: CustomerContractDetail; onClose: () => void; onSaved: (msg: string) => void }> = ({ d, onClose, onSaved }) => {
  const c = d.contract;
  const [rec, setRec] = useState(c.advanceRecoveryPercent != null ? String(c.advanceRecoveryPercent) : '');
  const [ret, setRet] = useState(c.retentionPercent != null ? String(c.retentionPercent) : '');
  const [days, setDays] = useState(c.paymentTermDays != null ? String(c.paymentTermDays) : '');
  const [war, setWar] = useState(c.warrantyMonths ? String(c.warrantyMonths) : '');
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const num = (v: string) => v.trim() === '' ? null : Number(v.replace(',', '.'));
  const save = async () => {
    setBusy(true); setErr(null);
    try { await financeService.saveCustomerTerms({ contractId: c.id, advanceRecoveryPercent: num(rec), retentionPercent: num(ret), paymentTermDays: num(days), warrantyMonths: num(war), reason: reason.trim() }); onSaved('Đã lưu điều khoản HĐ — áp cho các đợt lập sau.'); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return <Drawer label="Điều khoản thanh toán HĐ" onClose={onClose}
    header={<><p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">Điều khoản thanh toán</p><h2 className={`text-lg ${ENT}`}>{c.code}</h2>
      <p className="text-sm text-muted-foreground">Dùng để gợi ý từng đợt; kế toán vẫn sửa được từng đợt (có lý do).</p></>}
    footer={<><FieldError error={err} /><button type="button" className={secondaryBtn} onClick={onClose}>Đóng</button>
      <button type="button" className={primaryBtn} disabled={busy || !reason.trim()} onClick={() => void save()}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Settings2 size={15} />}Lưu</button></>}>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="% thu hồi tạm ứng mỗi đợt" hint={`Để trống = tạm ứng đã nhận ÷ HĐ (đang là ${Number(d.metrics.recoveryPercent).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}%)`}><input value={rec} onChange={e => setRec(e.target.value)} inputMode="decimal" className={`mt-1 w-full text-right ${inputCls}`} /></Field>
      <Field label="% giữ lại bảo hành" hint="Để trống = 5%"><input value={ret} onChange={e => setRet(e.target.value)} inputMode="decimal" className={`mt-1 w-full text-right ${inputCls}`} /></Field>
      <Field label="Hạn thanh toán (ngày sau CĐT xác nhận)" hint="Để trống = 30 ngày"><input value={days} onChange={e => setDays(e.target.value)} inputMode="numeric" className={`mt-1 w-full text-right ${inputCls}`} /></Field>
      <Field label="Thời gian bảo hành (tháng)"><input value={war} onChange={e => setWar(e.target.value)} inputMode="numeric" className={`mt-1 w-full text-right ${inputCls}`} /></Field>
    </div>
    <Field label="Lý do (bắt buộc)"><input value={reason} onChange={e => setReason(e.target.value)} placeholder="VD: Theo điều 5 HĐ 2512/2025" className={`mt-1 w-full ${inputCls}`} /></Field>
  </Drawer>;
};

// ---------- Bảo lãnh ----------
export const GuaranteeDrawer: React.FC<{ g: ContractGuarantee; onClose: () => void; onSaved: (msg: string) => void }> = ({ g, onClose, onSaved }) => {
  const [amount, setAmount] = useState(g.amount ? moneyInput(g.amount) : ''); const [bank, setBank] = useState(g.bankName || ''); const [no, setNo] = useState(g.number || '');
  const [issue, setIssue] = useState(g.issueDate || ''); const [expiry, setExpiry] = useState(g.expiryDate || '');
  const [status, setStatus] = useState(g.status === 'draft' ? 'active' : g.status); const [note, setNote] = useState(g.note || '');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const amt = parseMoney(amount) || 0;
  const blockers = [status === 'active' && !(amt > 0) && 'Nhập số tiền', status === 'active' && !expiry && 'Nhập ngày hết hạn', issue && expiry && expiry < issue && 'Hết hạn trước ngày phát hành'].filter(Boolean) as string[];
  const save = async () => {
    setBusy(true); setErr(null);
    try { await financeService.saveGuarantee({ id: g.id, amount: amt, bankName: bank, number: no, issueDate: issue || null, expiryDate: expiry || null, status, note }); onSaved(`Đã lưu ${g.name.toLowerCase()}.`); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return <Drawer label="Bảo lãnh" onClose={onClose}
    header={<><p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">Bảo lãnh</p><h2 className={`text-lg ${ENT}`}>{g.name}</h2>
      <p className="text-sm text-muted-foreground">Hết hạn trong 30 ngày sẽ nhắc ở Việc cần làm và Tổng quan.</p></>}
    footer={<><FieldError error={err} />{!err && blockers.length > 0 && <span className="mr-auto text-xs text-amber-700 dark:text-amber-300">{blockers.join(' · ')}</span>}
      <button type="button" className={secondaryBtn} onClick={onClose}>Đóng</button>
      <button type="button" className={primaryBtn} disabled={busy || blockers.length > 0} onClick={() => void save()}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Landmark size={15} />}Lưu</button></>}>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Số tiền bảo lãnh"><input value={amount} onChange={e => setAmount(e.target.value)} onBlur={() => setAmount(amt ? moneyInput(amt) : '')} inputMode="numeric" className={`mt-1 w-full text-right tabular-nums ${inputCls}`} /></Field>
      <Field label="Trạng thái"><select value={status} onChange={e => setStatus(e.target.value)} className={`mt-1 w-full ${inputCls}`}>
        <option value="active">Đang hiệu lực</option><option value="draft">Chưa phát hành</option><option value="released">Đã giải tỏa</option><option value="expired">Hết hạn</option></select></Field>
      <Field label="Ngân hàng"><input value={bank} onChange={e => setBank(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></Field>
      <Field label="Số bảo lãnh"><input value={no} onChange={e => setNo(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></Field>
      <Field label="Ngày phát hành"><input type="date" value={issue} onChange={e => setIssue(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></Field>
      <Field label="Ngày hết hạn"><input type="date" value={expiry} onChange={e => setExpiry(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></Field>
    </div>
    <Field label="Ghi chú"><input value={note} onChange={e => setNote(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></Field>
  </Drawer>;
};
