import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Banknote, ClipboardCheck, Loader2, Plus, Save, Send, Settings2, ShieldCheck, Trash2, Undo2 } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import {
  financeService, type FinanceAdvancePreview, type FinanceAttachment, type FinancePaymentRequest, type SubcontractCostReview, type SubcontractDeduction,
  type SubcontractDeductionKind, type SubcontractDetail, type SubcontractRound, type SubcontractRoundPreview,
} from '../../lib/financeService';
import { Drawer, inputCls, money, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { AttachmentPicker, ENT, FieldError, NUM, RouteExtrasNote, moneyInput, parseMoney, shortMoney, viDate } from './financeUi';

// Các form của Tài chính → Phải trả → Thầu phụ. Máy chủ tính lại và kiểm mọi số; ở đây xem trước để người dùng thấy trước khi lưu.

export const WARN = 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100';
export const DEDUCTION_LABELS: Record<SubcontractDeductionKind, string> = {
  material: 'Vật tư công ty cấp', service: 'Chi hộ (điện, nước, máy…)', penalty: 'Phạt vi phạm', other: 'Khác',
};
const folder = (d: SubcontractDetail) => `subcontract/${d.contract.id}`;
const num = (v: string) => v.trim() === '' ? null : Number(v.replace(',', '.'));
const Field: React.FC<{ label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; className?: string }> = ({ label, hint, children, className = '' }) =>
  <label className={`block text-sm font-medium ${className}`}>{label}{children}{hint && <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{hint}</span>}</label>;
const MoneyField: React.FC<{ label: React.ReactNode; value: string; onChange: (v: string) => void; hint?: React.ReactNode; placeholder?: string }> = ({ label, value, onChange, hint, placeholder }) =>
  <Field label={label} hint={hint}><input value={value} onChange={e => onChange(e.target.value)} onBlur={() => value.trim() && onChange(moneyInput(parseMoney(value) || 0))}
    inputMode="numeric" placeholder={placeholder} className={`mt-1 w-full text-right tabular-nums ${inputCls}`} /></Field>;
const Blockers: React.FC<{ err: string | null; blockers: string[] }> = ({ err, blockers }) => <>
  <FieldError error={err} />{!err && blockers.length > 0 && <span className="mr-auto text-xs text-amber-700 dark:text-amber-300">{blockers.join(' · ')}</span>}</>;

// ---------- Điều khoản thanh toán HĐ thầu phụ (Quản trị Tài chính) ----------
export const SubcontractTermsDrawer: React.FC<{ d: SubcontractDetail; onClose: () => void; onSaved: (msg: string) => void }> = ({ d, onClose, onSaved }) => {
  const c = d.contract; const toast = useToast();
  const locked = d.rounds.some(r => r.status !== 'cancelled') || d.advances.length > 0;
  const [partner, setPartner] = useState(c.partnerId || '');
  const [vat, setVat] = useState(c.vatPercent != null ? String(c.vatPercent) : '');
  const [ret, setRet] = useState(c.retentionPercent != null ? String(c.retentionPercent) : '');
  const [rec, setRec] = useState(c.advanceRecoveryPercent != null ? String(c.advanceRecoveryPercent) : '');
  const [days, setDays] = useState(c.paymentTermDays != null ? String(c.paymentTermDays) : '');
  const [war, setWar] = useState(c.warrantyMonths != null ? String(c.warrantyMonths) : '');
  const [pit, setPit] = useState(c.withholdPit); const [pitP, setPitP] = useState(String(c.pitPercent ?? 10));
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const blockers = [!partner && 'Chọn đối tác nhận tiền', !reason.trim() && 'Ghi lý do (VD điều khoản HĐ)'].filter(Boolean) as string[];
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await financeService.saveSubcontractTerms({ subcontractId: c.id, partnerId: partner || null, vatPercent: num(vat), retentionPercent: num(ret), advanceRecoveryPercent: num(rec),
        paymentTermDays: num(days), warrantyMonths: num(war), withholdPit: pit, pitPercent: num(pitP) ?? 10, reason: reason.trim() });
      toast.success('Đã lưu điều khoản', 'Áp cho các đợt lập sau; hạn giữ lại của các đợt đã ghi nhận đi theo HĐ.'); onSaved('Đã lưu điều khoản thanh toán.');
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); toast.error('Chưa lưu được điều khoản', e instanceof Error ? e.message : ''); } finally { setBusy(false); }
  };
  return <Drawer label="Điều khoản thanh toán HĐ thầu phụ" onClose={onClose}
    header={<><p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">Điều khoản thanh toán</p><h2 className={`text-lg ${ENT}`}>{c.code}</h2>
      <p className="text-sm text-muted-foreground">Dùng để gợi ý từng đợt; kế toán sửa được từng đợt nhưng phải ghi lý do. Thông tin HĐ (giá trị, ngày, file) sửa ở module Hợp đồng.</p></>}
    footer={<><Blockers err={err} blockers={blockers} /><button type="button" className={secondaryBtn} onClick={onClose}>Đóng</button>
      <button type="button" className={primaryBtn} disabled={busy || blockers.length > 0} onClick={() => void save()}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Settings2 size={15} />}Lưu</button></>}>
    <Field label="Đối tác nhận tiền (thầu phụ / tổ đội)" hint={locked ? 'Đã có đợt / tạm ứng — không đổi đối tác được.' : `Tên trên HĐ: ${c.subcontractorName}`}>
      <select value={partner} disabled={locked && Boolean(c.partnerId)} onChange={e => setPartner(e.target.value)} className={`mt-1 w-full ${inputCls} ${!partner ? 'border-amber-400' : ''}`}>
        <option value="">Chọn đối tác…</option>{d.partners.map(p => <option key={p.id} value={p.id}>{p.name}{p.taxCode ? ` · ${p.taxCode}` : ''}</option>)}</select></Field>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="VAT (%)" hint="Để trống = 0% (tổ đội không xuất hóa đơn)"><input value={vat} onChange={e => setVat(e.target.value)} inputMode="decimal" className={`mt-1 w-full text-right ${inputCls}`} /></Field>
      <Field label="% giữ lại bảo hành mỗi đợt"><input value={ret} onChange={e => setRet(e.target.value)} inputMode="decimal" className={`mt-1 w-full text-right ${inputCls}`} /></Field>
      <Field label="% thu hồi tạm ứng mỗi đợt" hint={`Để trống = tạm ứng ÷ giá trị HĐ (đang ${Number(d.metrics.recoveryPercent).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}%)`}>
        <input value={rec} onChange={e => setRec(e.target.value)} inputMode="decimal" className={`mt-1 w-full text-right ${inputCls}`} /></Field>
      <Field label="Hạn trả (ngày sau ghi nhận)" hint="Để trống = mặc định công ty"><input value={days} onChange={e => setDays(e.target.value)} inputMode="numeric" className={`mt-1 w-full text-right ${inputCls}`} /></Field>
      <Field label="Thời gian bảo hành (tháng)" hint={c.completionDate ? `Hoàn thành ${viDate(c.completionDate)} → hạn trả giữ lại = ngày đó + số tháng` : 'HĐ chưa có ngày hoàn thành — giữ lại chưa có hạn'}>
        <input value={war} onChange={e => setWar(e.target.value)} inputMode="numeric" className={`mt-1 w-full text-right ${inputCls}`} /></Field>
      <article className="text-sm"><span className="font-medium">Thuế TNCN</span>
        <label className="mt-1 flex items-center gap-2 rounded-lg border border-border px-2 py-1.5"><input type="checkbox" checked={pit} onChange={e => setPit(e.target.checked)} className="accent-teal-600" />
          Tổ đội cá nhân — khấu trừ<input value={pitP} onChange={e => setPitP(e.target.value)} disabled={!pit} inputMode="decimal" aria-label="% thuế TNCN" className={`w-14 text-right ${inputCls}`} />%</label>
        <span className="mt-0.5 block text-xs text-muted-foreground">Công ty giữ lại để nộp thay; không trả cho tổ.</span></article>
    </div>
    <Field label="Lý do (bắt buộc)"><input value={reason} onChange={e => setReason(e.target.value)} placeholder="VD: Theo điều 4 HĐ 0106/2026" className={`mt-1 w-full ${inputCls}`} /></Field>
  </Drawer>;
};

// ---------- Đầu kỳ 30/09 theo MISA ----------
export const SubcontractOpeningDrawer: React.FC<{ d: SubcontractDetail; onClose: () => void; onSaved: (msg: string) => void }> = ({ d, onClose, onSaved }) => {
  const toast = useToast();
  const [cum, setCum] = useState(''); const [paid, setPaid] = useState(''); const [out, setOut] = useState(''); const [outDue, setOutDue] = useState('');
  const [ret, setRet] = useState('0'); const [retDue, setRetDue] = useState(d.metrics.retentionDueDate || ''); const [adv, setAdv] = useState('0');
  const [note, setNote] = useState(''); const [files, setFiles] = useState<FinanceAttachment[]>([]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const misaDate = viDate(new Date(Date.parse(`${d.cutoverDate}T00:00:00Z`) - 86400000).toISOString().slice(0, 10));
  const blockers = [!d.contract.partnerId && 'HĐ chưa gắn đối tác — khai ở Điều khoản trước', cum.trim() === '' && 'Nhập lũy kế nghiệm thu (0 nếu chưa có)',
    out.trim() === '' && 'Nhập số còn nợ (0 nếu đã trả hết)', !files.length && 'Đính sổ chi tiết MISA / biên bản đối chiếu'].filter(Boolean) as string[];
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await financeService.saveSubcontractOpening({ subcontractId: d.contract.id, cumulativeNet: parseMoney(cum) || 0, paidTotal: parseMoney(paid) || 0, outstanding: parseMoney(out) || 0,
        outstandingDueDate: outDue || null, retentionHeld: parseMoney(ret) || 0, retentionDueDate: retDue || null, advanceRemaining: parseMoney(adv) || 0, note: note.trim() || undefined, attachments: files });
      toast.success('Đã gửi đầu kỳ', 'Chờ người có quyền Xác nhận (khác bạn) chốt.'); onSaved('Đã gửi đầu kỳ — chờ người khác chốt.');
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); toast.error('Chưa gửi được đầu kỳ', e instanceof Error ? e.message : ''); } finally { setBusy(false); }
  };
  return <Drawer label="Đầu kỳ thầu phụ theo MISA" onClose={onClose}
    header={<><p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">Đầu kỳ theo MISA đến {misaDate}</p><h2 className={`text-lg ${ENT}`}>{d.contract.code}</h2>
      <p className="text-sm text-muted-foreground">Lấy theo sổ chi tiết MISA. Không ghi chi phí (chi phí trước mốc đã có từ MISA). Người khác chốt. Chưa phát sinh thì nhập 0.</p></>}
    footer={<><Blockers err={err} blockers={blockers} /><button type="button" className={secondaryBtn} onClick={onClose}>Đóng</button>
      <button type="button" className={primaryBtn} disabled={busy || blockers.length > 0} onClick={() => void save()}>{busy ? <Loader2 size={15} className="animate-spin" /> : <ClipboardCheck size={15} />}Gửi chốt</button></>}>
    <div className="grid gap-3 sm:grid-cols-2">
      <MoneyField label="Lũy kế nghiệm thu (trước VAT)" value={cum} onChange={setCum} hint="Đợt đầu trong Vioo sẽ trừ số này" />
      <MoneyField label="Đã trả (để đối chiếu)" value={paid} onChange={setPaid} />
      <MoneyField label={`Còn nợ tại ${misaDate}`} value={out} onChange={setOut} hint="Chưa gồm tiền giữ lại bảo hành" />
      <Field label="Hạn của phần còn nợ" hint={`Để trống = mốc + ${d.metrics.paymentTermDays} ngày (hạn trả trên HĐ)`}><input type="date" value={outDue} onChange={e => setOutDue(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></Field>
      <MoneyField label="Tiền đang giữ lại bảo hành" value={ret} onChange={setRet} />
      <Field label="Hạn trả tiền giữ lại" hint={d.metrics.retentionDueDate ? 'Theo HĐ (ngày hoàn thành + bảo hành)' : 'HĐ chưa có ngày hoàn thành / bảo hành — để trống = chưa có hạn'}>
        <input type="date" value={retDue} onChange={e => setRetDue(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></Field>
      <MoneyField label="Tạm ứng chưa thu hồi" value={adv} onChange={setAdv} hint="Thu hồi dần ở các đợt sau (trước tạm ứng chi qua Vioo)" />
    </div>
    <AttachmentPicker supplierId={folder(d)} value={files} onChange={setFiles} label="Sổ chi tiết MISA / biên bản đối chiếu với thầu phụ" required />
    <Field label="Ghi chú"><input value={note} onChange={e => setNote(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></Field>
  </Drawer>;
};

// ---------- Lập / sửa đợt nghiệm thu thanh toán ----------
export const SubcontractRoundDrawer: React.FC<{ d: SubcontractDetail; round?: SubcontractRound | null; onClose: () => void; onSaved: (msg: string, submitted: boolean) => void }> = ({ d, round, onClose, onSaved }) => {
  const toast = useToast(); const m = d.metrics;
  const [start, setStart] = useState(round?.periodStart || ''); const [end, setEnd] = useState(round?.periodEnd || '');
  const [desc, setDesc] = useState(round?.description || ''); const [cum, setCum] = useState(round ? moneyInput(round.cumulativeNet) : '');
  const [vat, setVat] = useState(round ? String(round.vatPercent) : String(m.vatPercent));
  const differs = (a: number | undefined, b: number | null | undefined) => round && b != null && Math.abs((a || 0) - b) > 1;
  const [rec, setRec] = useState(differs(round?.advanceRecovery, round?.suggestedRecovery) ? moneyInput(round!.advanceRecovery) : '');
  const [ret, setRet] = useState(differs(round?.retention, round?.suggestedRetention) ? moneyInput(round!.retention) : '');
  const [pit, setPit] = useState(differs(round?.pit, round?.suggestedPit) ? moneyInput(round!.pit) : '');
  const [deds, setDeds] = useState<Array<{ kind: SubcontractDeductionKind; amount: string; reason: string }>>((round?.deductions || []).map(x => ({ kind: x.kind, amount: moneyInput(x.amount), reason: x.reason })));
  const [reason, setReason] = useState(round?.adjustReason || ''); const [over, setOver] = useState(round?.overContractReason || '');
  const [files, setFiles] = useState<FinanceAttachment[]>(round?.attachments || []); const [note, setNote] = useState(round?.note || '');
  const [preview, setPreview] = useState<SubcontractRoundPreview | null>(null); const [previewErr, setPreviewErr] = useState<string | null>(null); const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const cumV = parseMoney(cum) || 0; const prev = round ? round.previousNet : m.cumulativeNet;
  const deductions: SubcontractDeduction[] = deds.map(x => ({ kind: x.kind, amount: parseMoney(x.amount) || 0, reason: x.reason.trim() }));
  const input = useMemo(() => ({ id: round?.id, expectedRowVersion: round?.rowVersion, subcontractId: d.contract.id, periodStart: start || null, periodEnd: end, description: desc.trim() || 'x',
    cumulativeNet: cumV, vatPercent: num(vat), advanceRecovery: rec.trim() ? parseMoney(rec) : null, retention: ret.trim() ? parseMoney(ret) : null, pit: pit.trim() ? parseMoney(pit) : null,
    deductions: deductions.filter(x => x.amount > 0 && x.reason), adjustReason: reason.trim() || undefined, overContractReason: over.trim() || 'xem-truoc', attachments: files, note: note.trim() || undefined }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [cumV, vat, rec, ret, pit, JSON.stringify(deds), reason, end, start]);
  // Xem trước: máy chủ tính kỳ này, gợi ý khấu trừ, ngân sách CPNC.
  useEffect(() => {
    if (!(cumV > prev) || !end) { setPreview(null); setPreviewErr(null); return; }
    setPreviewing(true); const t = window.setTimeout(() => {
      financeService.previewSubcontractRound({ ...input, adjustReason: input.adjustReason || 'xem-truoc' })
        .then(p => { setPreview(p); setPreviewErr(null); }).catch(e => { setPreview(null); setPreviewErr(e instanceof Error ? e.message : String(e)); }).finally(() => setPreviewing(false));
    }, 400);
    return () => window.clearTimeout(t);
  }, [input, cumV, prev, end]);
  const p = preview;
  const adjusted = p && (Math.abs(p.advanceRecovery - p.suggestedRecovery) > 1 || Math.abs(p.retention - p.suggestedRetention) > 1 || Math.abs(p.pit - p.suggestedPit) > 1);
  const overContract = d.contract.value != null && d.contract.value > 0 && cumV > d.contract.value + 0.5;
  const badDed = deds.some(x => !(parseMoney(x.amount) > 0) || !x.reason.trim());
  const blockers = [!end && 'Chọn ngày kết thúc kỳ', !desc.trim() && 'Nhập nội dung đợt', !(cumV > prev) && `Lũy kế phải lớn hơn ${money(prev)} đ (lũy kế đến đợt trước)`,
    overContract && !over.trim() && 'Lũy kế vượt giá trị HĐ — ghi lý do / số phụ lục', adjusted && !reason.trim() && 'Khấu trừ khác gợi ý — ghi lý do',
    badDed && 'Khoản khấu trừ cần số tiền và lý do', p && p.payable < 0 && 'Khấu trừ lớn hơn giá trị kỳ này', previewErr].filter(Boolean) as string[];
  const save = async (andSubmit: boolean) => {
    setBusy(true); setErr(null);
    try {
      const r = await financeService.saveSubcontractRound({ ...input, description: desc.trim(), adjustReason: reason.trim() || undefined, overContractReason: over.trim() || undefined,
        attachments: files, note: note.trim() || undefined });
      if (andSubmit) {
        await financeService.transitionSubcontractRound({ id: r.id, expectedRowVersion: r.rowVersion, action: 'submit' });
        toast.success(`Đã gửi đợt ${r.sequenceNo}`, `Phải trả ${money(r.payable)} đ — chờ người có quyền Xác nhận ghi nhận.`);
      } else toast.success(`Đã lưu đợt ${r.sequenceNo}`, 'Đợt nháp — kiểm lại rồi bấm "Gửi ghi nhận".');
      onSaved(andSubmit ? `Đã gửi đợt ${r.sequenceNo}.` : `Đã lưu đợt ${r.sequenceNo}.`, andSubmit);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); toast.error(andSubmit ? 'Chưa gửi được đợt' : 'Chưa lưu được đợt', e instanceof Error ? e.message : ''); } finally { setBusy(false); }
  };
  const row = (label: React.ReactNode, value: React.ReactNode, cls = '') => <div className={`flex items-center justify-between gap-2 ${cls}`}><dt>{label}</dt><dd className="tabular-nums">{value}</dd></div>;
  const over1 = (v: string, set: (x: string) => void, sug: number | undefined, label: string) =>
    <input value={v} onChange={e => set(e.target.value)} onBlur={() => v.trim() && set(moneyInput(parseMoney(v) || 0))} placeholder={sug != null ? moneyInput(sug) : ''} inputMode="numeric" aria-label={label} className={`w-36 text-right tabular-nums ${inputCls}`} />;
  return <Drawer label="Đợt nghiệm thu thanh toán thầu phụ" wide onClose={onClose}
    header={<><p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">{round ? `Sửa đợt ${round.sequenceNo}` : 'Lập đợt nghiệm thu thanh toán'}</p>
      <h2 className={`text-lg ${ENT}`}>{d.contract.partner?.name || d.contract.subcontractorName}</h2>
      <p className="text-sm text-muted-foreground">{d.contract.code} · {d.contract.projectCode}. Nhập đúng số trên biên bản nghiệm thu đã ký. Người khác ghi nhận thì mới thành công nợ và chi phí.</p>
      {round?.returnReason && <p className={`mt-1 rounded-lg border px-2 py-1 text-xs ${WARN}`}>Bị trả lại: {round.returnReason}</p>}</>}
    footer={<><Blockers err={err} blockers={blockers} /><button type="button" className={secondaryBtn} onClick={onClose}>Đóng</button>
      <button type="button" className={secondaryBtn} disabled={busy || blockers.length > 0} onClick={() => void save(false)}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}Lưu nháp</button>
      <button type="button" className={primaryBtn} disabled={busy || blockers.length > 0 || !files.length} title={!files.length ? 'Đính kèm biên bản trước khi gửi' : undefined} onClick={() => void save(true)}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}Lưu và gửi ghi nhận</button></>}>
    <div className="grid gap-3 md:grid-cols-3">
      <Field label="Từ ngày"><input type="date" value={start} onChange={e => setStart(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></Field>
      <Field label="Đến ngày *"><input type="date" value={end} onChange={e => setEnd(e.target.value)} className={`mt-1 w-full ${inputCls} ${!end ? 'border-amber-400' : ''}`} /></Field>
      <Field label="VAT (%)" hint={m.vatSource === 'contract' ? 'Theo HĐ' : 'HĐ chưa khai VAT — đang 0%'}><input value={vat} onChange={e => setVat(e.target.value)} inputMode="decimal" className={`mt-1 w-full text-right ${inputCls}`} /></Field>
      <Field label="Nội dung *" className="md:col-span-3"><input value={desc} onChange={e => setDesc(e.target.value)} placeholder="VD: Nghiệm thu nhân công ván khuôn, cốt thép T10/2026" className={`mt-1 w-full ${inputCls}`} /></Field>
      <Field label="Giá trị nghiệm thu LŨY KẾ đến kỳ này (trước VAT) *" className="md:col-span-2"
        hint={<>Lũy kế đến đợt trước {money(prev)} đ{d.contract.value ? ` · giá trị HĐ ${money(d.contract.value)} đ` : ' · HĐ khoán theo khối lượng thực tế (giá trị 0)'}
          {d.manDays.lines > 0 ? ` · nhật ký: ${d.manDays.lines} dòng nhân công gắn HĐ (${d.manDays.people} lượt người)` : ' · nhật ký thi công chưa có dòng nhân công gắn HĐ này'}</>}>
        <input value={cum} onChange={e => setCum(e.target.value)} onBlur={() => cum && setCum(moneyInput(cumV))} inputMode="numeric" className={`mt-1 w-full text-right text-base font-semibold tabular-nums ${inputCls}`} /></Field>
    </div>
    {overContract && <div className={`rounded-xl border px-3 py-2 text-sm ${WARN}`}><b className="flex items-center gap-1"><AlertTriangle size={14} />Lũy kế vượt giá trị HĐ ({Math.round(cumV * 100 / (d.contract.value || 1))}%)</b>
      <input value={over} onChange={e => setOver(e.target.value)} placeholder="Lý do / số phụ lục HĐ (bắt buộc)" className={`mt-1 w-full ${inputCls}`} /></div>}

    <section className="rounded-xl border border-border p-3 text-sm"><h3 className="flex items-center gap-2 font-semibold">Tính phải trả {previewing && <Loader2 size={14} className="animate-spin text-muted-foreground" />}</h3>
      {!p ? <p className="mt-1 text-muted-foreground">{previewErr || 'Nhập lũy kế và ngày kết thúc kỳ để xem số kỳ này.'}</p> : <dl className="mt-2 space-y-1.5">
        {row('Giá trị kỳ này (trước VAT)', <span className={NUM}>{money(p.netAmount)} đ</span>)}
        {p.vatAmount > 0 && row(`VAT ${p.vatPercent}%`, `${money(p.vatAmount)} đ`)}
        {row(<b>Giá trị kỳ này → ghi chi phí nhân công (CPNC)</b>, <b>{money(p.gross)} đ</b>)}
        {row(<span className="pl-3">− Thu hồi tạm ứng <span className="text-xs text-muted-foreground">({Number(m.recoveryPercent).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}% · còn {money(m.advanceRemaining)} đ)</span></span>, over1(rec, setRec, p.suggestedRecovery, 'Thu hồi tạm ứng'))}
        {row(<span className="pl-3">− Giữ lại bảo hành <span className="text-xs text-muted-foreground">({m.retentionPercent}% · hạn {m.retentionDueDate ? viDate(m.retentionDueDate) : 'chưa có'})</span></span>, over1(ret, setRet, p.suggestedRetention, 'Giữ lại bảo hành'))}
        {(m.withholdPit || p.pit > 0) && row(<span className="pl-3">− Thuế TNCN khấu trừ <span className="text-xs text-muted-foreground">({m.pitPercent}% · công ty nộp thay)</span></span>, over1(pit, setPit, p.suggestedPit, 'Thuế TNCN'))}
        {deds.map((x, i) => <div key={i} className="flex flex-wrap items-center gap-2 pl-3">
          <select value={x.kind} onChange={e => setDeds(deds.map((y, j) => j === i ? { ...y, kind: e.target.value as SubcontractDeductionKind } : y))} aria-label="Loại khấu trừ" className={inputCls}>
            {(Object.keys(DEDUCTION_LABELS) as SubcontractDeductionKind[]).map(k => <option key={k} value={k}>− {DEDUCTION_LABELS[k]}</option>)}</select>
          <input value={x.reason} onChange={e => setDeds(deds.map((y, j) => j === i ? { ...y, reason: e.target.value } : y))} placeholder="Lý do (bắt buộc)" className={`min-w-[10rem] flex-1 ${inputCls}`} />
          <input value={x.amount} onChange={e => setDeds(deds.map((y, j) => j === i ? { ...y, amount: e.target.value } : y))} inputMode="numeric" aria-label="Số tiền khấu trừ" className={`w-36 text-right tabular-nums ${inputCls}`} />
          <button type="button" aria-label="Bỏ khoản khấu trừ" onClick={() => setDeds(deds.filter((_, j) => j !== i))} className="rounded p-1 text-muted-foreground hover:bg-muted"><Trash2 size={14} /></button></div>)}
        <button type="button" onClick={() => setDeds([...deds, { kind: 'material', amount: '', reason: '' }])} className="ml-3 inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:underline"><Plus size={13} />Thêm khấu trừ (vật tư cấp, chi hộ, phạt…)</button>
        {row(<b className="text-base">Phải trả kỳ này</b>, <b className={`text-base ${NUM}`}>{money(p.payable)} đ</b>, 'border-t border-border pt-1.5')}
      </dl>}
      {p && <p className="mt-1 text-xs text-muted-foreground">Để trống ô khấu trừ = theo gợi ý HĐ. Khác gợi ý phải ghi lý do.
        {p.budget.budget == null ? ' Ngân sách nhân công dự án: chưa lập — không cảnh báo được vượt ngân sách.' : p.budget.over ? '' : ` Ngân sách nhân công: ${shortMoney(p.budget.projected)} / ${shortMoney(p.budget.budget)}.`}</p>}
      {p?.budget.over && <p className={`mt-1 rounded-lg border px-2 py-1 text-xs ${WARN}`}>Vượt ngân sách {p.budget.item}: sau đợt này {shortMoney(p.budget.projected)} / {shortMoney(p.budget.budget || 0)}. Đề nghị chi sẽ thêm bước "Duyệt vượt ngân sách".</p>}
    </section>
    {adjusted && <Field label="Lý do khấu trừ khác gợi ý (bắt buộc)"><input value={reason} onChange={e => setReason(e.target.value)} placeholder="VD: Tổ đề nghị thu hồi tạm ứng 50% đợt này" className={`mt-1 w-full ${inputCls}`} /></Field>}
    <AttachmentPicker supplierId={folder(d)} value={files} onChange={setFiles} label="Biên bản nghiệm thu / bảng xác nhận khối lượng (bắt buộc khi gửi)" required />
    <Field label="Ghi chú"><input value={note} onChange={e => setNote(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></Field>
  </Drawer>;
};

// ---------- Tạm ứng thầu phụ ----------
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const SubcontractAdvanceDrawer: React.FC<{ subcontractId: string; title: string; today: string; hasBank: boolean; request?: FinancePaymentRequest | null;
  onClose: () => void; onSaved: (code: string) => void }> = ({ subcontractId, title, today, hasBank, request, onClose, onSaved }) => {
  const toast = useToast();
  const [amount, setAmount] = useState(request ? moneyInput(request.amount) : ''); const [due, setDue] = useState(request?.advance?.repayDueDate || addDays(today, 30));
  const [note, setNote] = useState(request?.note || ''); const [method, setMethod] = useState<'bank_transfer' | 'cash'>(request?.method || (hasBank ? 'bank_transfer' : 'cash'));
  const [plannedDate, setPlannedDate] = useState(request?.plannedDate || today);
  const [preview, setPreview] = useState<Omit<FinanceAdvancePreview, 'internal'> | null>(null); const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const value = parseMoney(amount) || 0;
  useEffect(() => {
    if (!(value > 0)) { setPreview(null); return; }
    const t = window.setTimeout(() => financeService.previewSubcontractAdvance({ subcontractId, requestId: request?.id, amount: value })
      .then(p => { setPreview(p); setPreviewErr(null); }).catch(e => setPreviewErr(e instanceof Error ? e.message : String(e))), 350);
    return () => window.clearTimeout(t);
  }, [subcontractId, value, request?.id]);
  const available = preview?.target.available ?? null;
  const blockers = [!(value > 0) && 'Nhập số tiền', available != null && value > available + 0.5 && `Vượt phần còn ứng được ${money(available)} đ`, !due && 'Chọn hạn hoàn ứng',
    !note.trim() && 'Ghi lý do tạm ứng', !plannedDate && 'Chọn ngày dự kiến chi', method === 'bank_transfer' && !hasBank && 'Thầu phụ chưa có số tài khoản — chọn tiền mặt',
    preview?.route.problemStep && `Bước "${preview.route.problemStep}" chưa có người duyệt hợp lệ`, preview && !preview.canRecord && 'Cần quyền Tài chính — Ghi nhận', previewErr].filter(Boolean) as string[];
  const submit = async () => {
    setBusy(true);
    try {
      const r = await financeService.saveSubcontractAdvance({ requestId: request?.id, expectedRowVersion: request?.rowVersion, subcontractId, amount: value, method, plannedDate, repayDueDate: due, note: note.trim() });
      toast.success(request ? `Đã gửi lại ${r.code}` : `Đã gửi ${r.code}`, `Tạm ứng ${money(r.amount)} đ — chờ ${preview?.route.steps[0]?.eligibleNames.join(' hoặc ') || 'người duyệt'}.`); onSaved(r.code);
    } catch (e) { toast.error('Chưa gửi được đề nghị tạm ứng', e instanceof Error ? e.message : ''); } finally { setBusy(false); }
  };
  return <Drawer label="Đề nghị tạm ứng thầu phụ" onClose={onClose}
    header={<><p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">{request ? `Sửa và gửi lại ${request.code}` : 'Đề nghị tạm ứng thầu phụ'}</p>
      <h2 className={`text-lg ${ENT}`}>{title}</h2>
      <p className="text-sm text-muted-foreground">Tạm ứng không phải chi phí. Mỗi đợt nghiệm thu thu hồi dần theo % trên HĐ; HĐ kết thúc còn dư thì thầu phụ hoàn tiền.</p></>}
    footer={<>{blockers.length > 0 && value > 0 && <span className="mr-auto text-xs text-amber-700 dark:text-amber-300">{blockers.join(' · ')}</span>}
      <button type="button" className={secondaryBtn} onClick={onClose}>Đóng</button>
      <button type="button" className={primaryBtn} disabled={busy || blockers.length > 0 || !preview} onClick={() => void submit()}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}{request ? 'Gửi lại' : 'Gửi duyệt'} {value > 0 ? `${money(value)} đ` : ''}</button></>}>
    {!hasBank && <p className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm ${WARN}`}><AlertTriangle size={15} className="mt-0.5 shrink-0" />Thầu phụ chưa có số tài khoản — chi tiền mặt, hoặc nhờ cập nhật hồ sơ đối tác.</p>}
    <div className="grid gap-3 sm:grid-cols-2">
      <MoneyField label="Số tiền tạm ứng" value={amount} onChange={setAmount} hint={available != null ? `Còn ứng được ${money(available)} đ (giá trị HĐ gồm VAT ${money(preview?.target.base || 0)} đ)` : 'HĐ khoán (giá trị 0) — không giới hạn theo HĐ'} />
      <Field label="Hạn hoàn ứng"><input type="date" value={due} min={today} onChange={e => setDue(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></Field>
      <Field label="Lý do tạm ứng" className="sm:col-span-2"><input value={note} onChange={e => setNote(e.target.value)} placeholder="VD: Tổ đội ứng mua dụng cụ, trả công tháng 10" className={`mt-1 w-full ${inputCls}`} /></Field>
      <Field label="Hình thức"><select value={method} onChange={e => setMethod(e.target.value as 'bank_transfer' | 'cash')} className={`mt-1 w-full ${inputCls}`}><option value="bank_transfer">Chuyển khoản</option><option value="cash">Tiền mặt</option></select></Field>
      <Field label="Ngày dự kiến chi"><input type="date" value={plannedDate} onChange={e => setPlannedDate(e.target.value)} className={`mt-1 w-full ${inputCls}`} /></Field>
    </div>
    <section className="rounded-xl border border-border p-3"><h3 className="flex items-center gap-2 text-sm font-bold"><ShieldCheck size={16} className="text-teal-700" />Luồng duyệt
      <span className="font-normal text-muted-foreground">(ma trận đề nghị chi)</span></h3>
      {previewErr ? <p className="mt-1 text-sm text-rose-700 dark:text-rose-300">{previewErr}</p> : !preview ? <p className="mt-1 text-sm text-muted-foreground">Nhập số tiền để xem ai duyệt.</p> : <>
        <ol className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          {preview.route.steps.map((s, i) => <li key={i} className="flex items-center gap-2">{i > 0 && <span className="text-muted-foreground">→</span>}
            <span className={`rounded-lg border px-2 py-1 ${!s.eligibleIds.length ? 'border-rose-300 bg-rose-50' : s.extra ? 'border-amber-300 bg-amber-50/60' : 'border-border'}`}><b>{i + 1}. {s.label}</b>
              <span className="block text-xs text-muted-foreground">{s.eligibleNames.length ? s.eligibleNames.join(' hoặc ') : 'Không còn người hợp lệ'}</span></span></li>)}
          <li className="flex items-center gap-2"><span className="text-muted-foreground">→</span><span className="rounded-lg border border-dashed border-border px-2 py-1"><b className="inline-flex items-center gap-1"><Banknote size={13} />Xác nhận đã chi</b>
            <span className="block text-xs text-muted-foreground">kế toán khác người lập và người duyệt</span></span></li></ol>
        <RouteExtrasNote route={preview.route} /></>}
    </section>
  </Drawer>;
};

// ---------- Soát xét chi phí nhân công ghi tay ----------
export const CostReviewDrawer: React.FC<{ item: SubcontractCostReview; onClose: () => void; onDone: (msg: string) => void }> = ({ item, onClose, onDone }) => {
  const toast = useToast();
  const [pick, setPick] = useState<string[]>(item.misa.map(x => x.id));
  const overlap = item.misa.filter(x => pick.includes(x.id)).reduce((s, x) => s + x.amount, 0);
  const [amount, setAmount] = useState(moneyInput(Math.min(overlap, item.amount)));
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setAmount(moneyInput(Math.min(overlap, item.amount))); }, [overlap, item.amount]);
  const amt = parseMoney(amount) || 0;
  const run = async (action: 'keep' | 'reverse') => {
    setBusy(true); setErr(null);
    try {
      const r = await financeService.reviewManualCost({ transactionId: item.id, action, amount: action === 'reverse' ? amt : undefined, reason: reason.trim(), misaIds: pick });
      const msg = action === 'reverse' ? `Đã đảo ${money(r.reversed)} đ phần trùng MISA — chi phí dự án giảm tương ứng.` : 'Đã ghi nhận: không trùng MISA.';
      toast.success('Đã soát xét', msg); onDone(msg);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); toast.error('Chưa soát xét được', e instanceof Error ? e.message : ''); } finally { setBusy(false); }
  };
  return <Drawer label="Soát xét chi phí nhân công ghi tay" wide onClose={onClose}
    header={<><p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">Soát xét chi phí ghi tay · {item.projectCode}</p>
      <h2 className={`text-lg ${ENT}`}>{item.counterparty || item.description}</h2>
      <p className="text-sm text-muted-foreground">{item.description} · {viDate(item.date)} · {item.createdByName || '—'} nhập {viDate(item.createdAt)}</p></>}
    footer={<><Blockers err={err} blockers={!reason.trim() ? ['Ghi lý do'] : []} /><button type="button" className={secondaryBtn} onClick={onClose}>Đóng</button>
      <button type="button" className={secondaryBtn} disabled={busy || !reason.trim()} onClick={() => void run('keep')}>Không trùng — giữ nguyên</button>
      <button type="button" className={primaryBtn} disabled={busy || !reason.trim() || !(amt > 0) || amt > item.amount} onClick={() => void run('reverse')}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Undo2 size={15} />}Đảo {amt > 0 ? `${money(amt)} đ` : 'phần trùng'}</button></>}>
    <p className="rounded-xl bg-muted/50 px-3 py-2 text-sm">Dòng ghi tay: <b className={NUM}>{money(item.amount)} đ</b>. Không xóa dòng cũ — nếu trùng, Vioo ghi một dòng âm đúng phần trùng (ngày như dòng gốc), có lý do và lịch sử.</p>
    <section className="text-sm"><h3 className="font-semibold">MISA đã nhập cho cùng tổ đội / thầu phụ (trước ngày dòng ghi tay)</h3>
      {item.misa.length === 0 ? <p className="mt-1 rounded-xl border border-dashed border-border px-3 py-4 text-center text-muted-foreground">Không thấy dòng MISA nào khớp tên — nhiều khả năng không trùng.</p>
        : <ul className="mt-1 divide-y divide-border rounded-xl border border-border">{item.misa.map(x => <li key={x.id}><label className="flex cursor-pointer items-center gap-2 px-3 py-2">
          <input type="checkbox" checked={pick.includes(x.id)} onChange={e => setPick(e.target.checked ? [...pick, x.id] : pick.filter(y => y !== x.id))} className="accent-teal-600" />
          <span className="min-w-0 flex-1"><span className="block truncate">{x.description}</span><span className="text-xs text-muted-foreground">{viDate(x.date)}</span></span>
          <span className={`whitespace-nowrap ${NUM}`}>{money(x.amount)} đ</span></label></li>)}</ul>}
      {item.misa.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Tích các dòng nằm trong số "lũy kế" của dòng ghi tay. Tổng đã tích: <b>{money(overlap)} đ</b>.</p>}
    </section>
    <div className="grid gap-3 sm:grid-cols-2">
      <MoneyField label="Số đảo (phần trùng)" value={amount} onChange={setAmount} hint={amt > item.amount ? <span className="text-rose-700">Lớn hơn dòng ghi tay</span> : 'Mặc định = tổng các dòng MISA đã tích'} />
      <Field label="Lý do (bắt buộc)"><input value={reason} onChange={e => setReason(e.target.value)} placeholder="VD: Lũy kế 28/9 đã gồm 1,86 tỷ MISA đến 15/07" className={`mt-1 w-full ${inputCls}`} /></Field>
    </div>
  </Drawer>;
};
