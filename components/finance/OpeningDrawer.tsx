import React, { useMemo, useState } from 'react';
import { AlertTriangle, Banknote, ClipboardCheck, Loader2, RotateCcw, ShieldCheck, Undo2 } from 'lucide-react';
import { useReasonConfirm } from '../../context/ConfirmContext';
import { financeService, type FinanceAttachment, type FinanceOpening, type FinanceSupplierDetail } from '../../lib/financeService';
import { Badge, Drawer, inputCls, money, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { AttachmentPicker, ENT, FieldError, NUM, moneyInput, parseMoney, viDate } from './financeUi';

// Đối chiếu đầu kỳ theo NCC × dự án tại mốc (30/09): số dư Vioo = sổ MISA = biên bản đối chiếu NCC.
// Không sửa chứng từ cũ — chỉ ghi chi ngoài hệ thống (Vioo cao hơn) hoặc số dư đầu kỳ (MISA cao hơn).

const STATUS_LABEL: Record<FinanceOpening['status'], string> = {
  draft: 'Nháp', submitted: 'Chờ xác nhận', confirmed: 'Đã chốt', rejected: 'Bị trả lại', cancelled: 'Đã hủy',
};
const STATUS_TONE: Record<FinanceOpening['status'], string> = {
  draft: 'border-slate-200 bg-slate-100 text-slate-700', submitted: 'border-amber-300 bg-amber-50 text-amber-800',
  confirmed: 'border-leaf-200 bg-leaf-50 text-leaf-800', rejected: 'border-rose-200 bg-rose-50 text-rose-700', cancelled: 'border-border bg-muted text-muted-foreground',
};

export const OpeningDrawer: React.FC<{
  detail: FinanceSupplierDetail; projectId?: string | null; onClose: () => void; onChanged: (message: string) => void; onExternalPayment: (documentId: string) => void;
}> = ({ detail, projectId: initialProject, onClose, onChanged, onExternalPayment }) => {
  const askReason = useReasonConfirm();
  const cutover = detail.cutoverDate;
  const asOf = (() => { const [y, m, d] = cutover.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10); })();
  const preDocs = detail.documents.filter(d => d.documentDate < cutover && d.sourceType !== 'opening_balance');
  const projects = Array.from(new Map(preDocs.map(d => [d.projectId || '', d.projectCode || 'Không gắn dự án'])).entries());
  const [projectId, setProjectId] = useState(initialProject || projects.find(([id]) => !detail.openings.some(o => o.projectId === id && o.status !== 'cancelled'))?.[0] || projects[0]?.[0] || '');
  const opening = detail.openings.find(o => o.projectId === projectId && o.status !== 'cancelled') || null;
  const editable = !opening || opening.status === 'draft' || opening.status === 'rejected';
  const [misa, setMisa] = useState(moneyInput(opening?.misaAmount));
  const [note, setNote] = useState(opening?.note || '');
  const [files, setFiles] = useState<FinanceAttachment[]>(opening?.attachments || []);
  const [reviewed, setReviewed] = useState<Set<string>>(new Set(opening?.reviewedDocumentIds || []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const docs = preDocs.filter(d => (d.projectId || '') === projectId);
  const vioo = docs.reduce((s, d) => s + d.outstanding, 0);
  const pending = docs.filter(d => d.pendingExternal > 0 || d.issues.includes('pending_cancel'));
  const reviewNeeded = docs.filter(d => d.issues.includes('same_person_statement'));
  const misaNum = parseMoney(misa);
  const diff = misa.trim() && Number.isFinite(misaNum) ? misaNum - vioo : null;
  const me = detail.currentUserId;
  const canDecide = opening?.status === 'submitted' && detail.can.confirm && opening.createdBy !== me;

  const pickProject = (id: string) => {
    const o = detail.openings.find(x => x.projectId === id && x.status !== 'cancelled');
    setProjectId(id); setMisa(moneyInput(o?.misaAmount)); setNote(o?.note || ''); setFiles(o?.attachments || []); setReviewed(new Set(o?.reviewedDocumentIds || [])); setError(null);
  };
  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true); setError(null);
    try { await fn(); onChanged(message); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const save = async (submit: boolean) => {
    if (!Number.isFinite(misaNum) || misaNum < 0) { setError(`Nhập số dư theo sổ MISA tại ${viDate(asOf)} (0 nếu không còn nợ).`); return; }
    if (submit && pending.length) { setError('Còn khoản chi ngoài hoặc đề xuất hủy chờ xác nhận — xử lý xong rồi gửi.'); return; }
    if (submit && diff != null && diff < -0.5) { setError('Vioo đang ghi nợ cao hơn MISA. Ghi các khoản đã trả ngoài hệ thống trước khi gửi.'); return; }
    if (submit && reviewNeeded.some(d => !reviewed.has(d.id))) { setError('Tick soát xét các bảng đối soát do cùng một người lập và ghi nợ.'); return; }
    setBusy(true); setError(null);
    try {
      const r = await financeService.saveOpening({ id: opening?.id, expectedRevision: opening?.revision, supplierId: detail.supplier.id, projectId,
        misaAmount: misaNum, note: note.trim() || undefined, attachments: files, reviewedDocumentIds: [...reviewed] });
      if (submit) await financeService.transitionOpening({ id: r.id, expectedRevision: r.revision, action: 'submit' });
      onChanged(submit ? `Đã gửi đối chiếu đầu kỳ ${detail.supplier.name} — chờ người khác xác nhận.` : 'Đã lưu nháp đối chiếu đầu kỳ.');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const footer = <>
    <FieldError error={error} />
    {!error && <span className="mr-auto text-xs text-muted-foreground">Người lập không tự xác nhận. Người xác nhận: kế toán khác hoặc Kế toán trưởng.</span>}
    {editable && <>
      <button type="button" disabled={busy || !projectId} onClick={() => void save(false)} className={secondaryBtn}>Lưu nháp</button>
      <button type="button" disabled={busy || !projectId} onClick={() => void save(true)} className={primaryBtn}>{busy ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}Gửi xác nhận</button>
    </>}
    {opening?.status === 'submitted' && opening.createdBy === me && <span className="text-sm text-muted-foreground">Đang chờ người khác xác nhận.</span>}
    {canDecide && <>
      <button type="button" disabled={busy} className={secondaryBtn} onClick={async () => {
        const reason = await askReason({ title: 'Trả lại đối chiếu đầu kỳ', targetName: `${detail.supplier.name} · ${opening!.projectCode}`, reasonLabel: 'Lý do', reasonPlaceholder: 'VD: Số MISA chưa gồm hóa đơn tháng 9…', actionLabel: 'Trả lại', intent: 'warning' });
        if (reason) void run(() => financeService.transitionOpening({ id: opening!.id, expectedRevision: opening!.revision, action: 'reject', reason }), 'Đã trả lại đối chiếu đầu kỳ cho người lập.');
      }}><Undo2 size={15} />Trả lại</button>
      <button type="button" disabled={busy} className={primaryBtn} onClick={() => void run(() => financeService.transitionOpening({ id: opening!.id, expectedRevision: opening!.revision, action: 'confirm' }),
        opening!.openingAmount && opening!.openingAmount > 0 ? `Đã chốt đầu kỳ — ghi số dư đầu kỳ ${money(opening!.openingAmount)} đ.` : 'Đã chốt đầu kỳ — Vioo khớp sổ MISA.')}>
        <ClipboardCheck size={15} />Xác nhận chốt</button>
    </>}
    {opening?.status === 'confirmed' && detail.can.confirm && <button type="button" disabled={busy} className={secondaryBtn} onClick={async () => {
      const reason = await askReason({ title: 'Đảo đối chiếu đầu kỳ', targetName: `${detail.supplier.name} · ${opening.projectCode}`, subtitle: 'Số dư đầu kỳ đã ghi sẽ bị hủy (chỉ khi chưa có khoản chi).', reasonLabel: 'Lý do', actionLabel: 'Đảo', intent: 'danger' });
      if (reason) void run(() => financeService.transitionOpening({ id: opening.id, expectedRevision: opening.revision, action: 'cancel', reason }), 'Đã đảo đối chiếu đầu kỳ.');
    }}><RotateCcw size={15} />Đảo đối chiếu</button>}
  </>;

  return <Drawer wide label={`Đối chiếu đầu kỳ ${detail.supplier.name}`} onClose={onClose} footer={footer}
    header={<>
      <p className="text-xs font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">Đối chiếu đầu kỳ tại {viDate(asOf)}</p>
      <h2 className={`mt-1 text-lg ${ENT}`}>{detail.supplier.name}</h2>
      <p className="text-sm text-muted-foreground">Mục tiêu: số dư Vioo = sổ MISA = biên bản đối chiếu với NCC. Không sửa chứng từ cũ — chỉ ghi chi ngoài hệ thống hoặc số dư đầu kỳ.</p>
    </>}>
    {projects.length === 0 ? <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">NCC này không có chứng từ trước mốc — không cần đối chiếu đầu kỳ.</p> : <>
      <div className="flex flex-wrap items-center gap-2">
        {projects.map(([id, code]) => { const o = detail.openings.find(x => x.projectId === id && x.status !== 'cancelled');
          return <button key={id} type="button" aria-pressed={projectId === id} onClick={() => pickProject(id)}
            className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm font-semibold ${projectId === id ? 'border-teal-500 bg-teal-50 ring-2 ring-teal-500/20 dark:bg-teal-950/30' : 'border-border bg-card'}`}>
            <span className={ENT}>{code}</span><Badge className={o ? STATUS_TONE[o.status] : 'border-slate-200 bg-slate-100 text-slate-600'}>{o ? STATUS_LABEL[o.status] : 'Chưa đối chiếu'}</Badge></button>; })}
      </div>
      {opening?.status === 'rejected' && opening.decisionNote && <p className="flex gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800"><AlertTriangle size={15} className="mt-0.5 shrink-0" /><span><b>Bị trả lại:</b> {opening.decisionNote} · {opening.decidedByName}</span></p>}
      {opening?.status === 'confirmed' && <p className="rounded-xl border border-leaf-200 bg-leaf-50 px-3 py-2 text-sm text-leaf-900">
        <b>Đã chốt</b> {viDate(opening.decidedAt)} · {opening.decidedByName}. {opening.openingAmount && opening.openingAmount > 0 ? <>Ghi số dư đầu kỳ <b>{money(opening.openingAmount)} đ</b>.</> : 'Vioo khớp sổ MISA, không ghi thêm.'}</p>}

      <section className="grid gap-3 rounded-2xl border border-border bg-card p-4 md:grid-cols-3">
        <label className="text-xs font-semibold text-muted-foreground">Số dư theo sổ MISA tại {viDate(asOf)} <span className="text-rose-600">*</span>
          <input inputMode="numeric" value={misa} disabled={!editable} onChange={e => setMisa(e.target.value)} placeholder="VD: 390.866.500"
            className={`mt-1 w-full text-right tabular-nums ${inputCls}`} /></label>
        <div className="text-xs font-semibold text-muted-foreground">Vioo đang ghi nợ (trước mốc)<p className={`mt-2 text-lg ${NUM}`}>{money(opening && !editable ? opening.viooOutstanding ?? vioo : vioo)} đ</p></div>
        <div className="text-xs font-semibold text-muted-foreground">Chênh lệch (MISA − Vioo)
          <p className={`mt-2 text-lg font-bold tabular-nums ${diff == null ? 'text-muted-foreground' : Math.abs(diff) < 1 ? 'text-leaf-700' : diff > 0 ? 'text-teal-700' : 'text-rose-700'}`}>
            {diff == null ? 'Nhập số MISA' : `${money(diff)} đ`}</p></div>
        <div className="md:col-span-3"><AttachmentPicker supplierId={detail.supplier.id} value={files} onChange={setFiles} disabled={!editable}
          label="Biên bản đối chiếu với NCC / sổ chi tiết công nợ MISA (nên có)" /></div>
        <label className="text-xs font-semibold text-muted-foreground md:col-span-3">Ghi chú
          <input value={note} disabled={!editable} onChange={e => setNote(e.target.value)} placeholder="VD: Sổ chi tiết TK 331 tại 30/09, đã khớp biên bản ký ngày 03/10" className={`mt-1 w-full ${inputCls}`} /></label>
      </section>
      {diff != null && Math.abs(diff) >= 1 && editable && <p className={`rounded-xl border px-3 py-2.5 text-sm ${diff > 0 ? 'border-teal-200 bg-teal-50 text-teal-900' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
        {diff > 0 ? <>MISA còn <b>{money(diff)} đ</b> nợ chưa có chứng từ trong Vioo → khi chốt sẽ ghi <b>số dư đầu kỳ</b> ngày {viDate(asOf)} (không sinh thêm chi phí dự án vì chi phí đã có từ MISA).</>
          : <>Vioo cao hơn MISA <b>{money(-diff)} đ</b> → thường là đã trả ngoài hệ thống. Bấm "Ghi đã trả" ở chứng từ tương ứng bên dưới.</>}</p>}
      {pending.length > 0 && <p className="flex gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"><AlertTriangle size={15} className="mt-0.5 shrink-0" />
        {pending.length} chứng từ có khoản chi ngoài / đề xuất hủy đang chờ xác nhận — xử lý xong mới gửi đối chiếu.</p>}

      <section>
        <h3 className="mb-1 font-semibold text-foreground">Chứng từ Vioo trước mốc ({docs.length})</h3>
        {reviewNeeded.length > 0 && <p className="mb-2 text-xs text-amber-800 dark:text-amber-200">Tick <b>Đã soát xét</b> các bảng đối soát do cùng một người lập và ghi nợ (người soát xét là bạn — khác người lập bảng).</p>}
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">{docs.map(d => <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-card px-3 py-2 text-sm">
          <span className="min-w-0 flex-1"><span className={ENT}>{d.documentNo}</span><span className="ml-2 text-xs text-muted-foreground">{viDate(d.documentDate)}{d.paid > 0 ? ` · đã trả ${money(d.paid)} đ` : ''}{d.pendingExternal > 0 ? ` · chờ xác nhận ${money(d.pendingExternal)} đ` : ''}</span></span>
          {d.issues.includes('same_person_statement') && <label className="flex items-center gap-1.5 text-xs text-amber-800"><input type="checkbox" disabled={!editable} checked={reviewed.has(d.id)} className="h-4 w-4 accent-teal-600"
            onChange={() => setReviewed(cur => { const n = new Set(cur); if (n.has(d.id)) n.delete(d.id); else n.add(d.id); return n; })} />Đã soát xét</label>}
          {editable && detail.can.record && d.outstanding - d.pendingExternal > 0.5 && <button type="button" onClick={() => onExternalPayment(d.id)} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold text-teal-700 hover:bg-muted"><Banknote size={12} />Ghi đã trả</button>}
          <span className={`w-32 text-right ${NUM}`}>{money(d.outstanding)} đ</span>
        </li>)}</ul>
      </section>
      {opening && <p className="text-xs text-muted-foreground">Lập: {opening.createdByName} · {viDate(opening.createdAt)}{opening.submittedByName ? ` · Gửi: ${opening.submittedByName} ${viDate(opening.submittedAt)}` : ''}</p>}
    </>}
  </Drawer>;
};
