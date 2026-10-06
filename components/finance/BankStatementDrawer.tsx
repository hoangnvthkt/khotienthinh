import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, CheckCircle2, FileSpreadsheet, Link2, Loader2, RefreshCw, RotateCcw, Send, Undo2, Unlink, Upload } from 'lucide-react';
import { useConfirm, useReasonConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
import { readBankStatementFile } from '../../lib/bankStatementImport';
import { financeService, type BankLine, type FinanceBankStatement, type FinanceCash } from '../../lib/financeService';
import { Badge, Drawer, StateBox, money, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { CASH_SOURCE, ExpenseDrawer, MovementDrawer, type MovementPrefill } from './CashDrawers';
import { ENT, shortMoney, viDate } from './financeUi';

// Sao kê ngân hàng của một tài khoản: nhập file Excel, máy chủ tự khớp với sổ thu chi (cùng chiều, cùng số tiền, lệch ngày ≤ 5),
// kế toán xử lý phần còn lại — khớp tay theo gợi ý, lập phiếu thu / chi từ dòng sao kê, hoặc bỏ qua có lý do.

const PAGE = 50;
const STATUS: Record<BankLine['status'], { label: string; cls: string }> = {
  unmatched: { label: 'Chưa khớp', cls: 'border-amber-300 bg-amber-50 text-amber-800' },
  matched: { label: 'Đã khớp', cls: 'border-leaf-200 bg-leaf-50 text-leaf-800' },
  ignored: { label: 'Bỏ qua', cls: 'border-slate-200 bg-slate-100 text-slate-600' },
};
const signed = (dir: 'in' | 'out', n: number) => `${dir === 'in' ? '+' : '−'}${money(n)}`;

export const BankStatementDrawer: React.FC<{ cash: FinanceCash; accountId: string; onClose: () => void; onChanged: () => void }> = ({ cash, accountId, onClose, onChanged }) => {
  const toast = useToast(); const confirm = useConfirm(); const askReason = useReasonConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<FinanceBankStatement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState<'unmatched' | 'matched' | 'ignored' | 'all'>('unmatched');
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState<string | null>(null);
  const [sub, setSub] = useState<{ kind: 'receipt'; prefill: MovementPrefill } | { kind: 'expense'; prefill: { amount: number; date: string; counterparty: string; note: string; category: string } } | null>(null);
  const load = useCallback(() => { setError(null); financeService.bankStatement(accountId).then(setData).catch(e => setError(e instanceof Error ? e.message : String(e))); }, [accountId]);
  useEffect(load, [load]);

  const act = async (key: string, fn: () => Promise<unknown>, msg: string) => {
    setBusy(key);
    try { await fn(); toast.success('Sao kê ngân hàng', msg); load(); onChanged(); }
    catch (e) { toast.error('Chưa thực hiện được', e instanceof Error ? e.message : ''); }
    finally { setBusy(null); }
  };
  const importFile = async (file: File) => {
    setBusy('import');
    try {
      const p = await readBankStatementFile(await file.arrayBuffer());
      if (!p.rows.length) {
        toast.error('Không đọc được dòng giao dịch nào', p.headerRow ? `Đã thấy tiêu đề ở dòng ${p.headerRow} nhưng không có dòng có ngày và số tiền.` : 'Không tìm thấy dòng tiêu đề có cột Ngày và Ghi nợ / Ghi có (hoặc Số tiền). Xuất lại sao kê dạng Excel từ ngân hàng.');
        return;
      }
      const tin = p.rows.filter(r => r.direction === 'in').reduce((a, r) => a + r.amount, 0); const tout = p.rows.filter(r => r.direction === 'out').reduce((a, r) => a + r.amount, 0);
      const from = p.rows.reduce((a, r) => r.date < a ? r.date : a, p.rows[0].date); const to = p.rows.reduce((a, r) => r.date > a ? r.date : a, p.rows[0].date);
      if (!await confirm({ title: 'Nhập sao kê?', targetName: `${file.name} → ${data?.account.name}`, confirmText: 'Nhập', actionLabel: 'Nhập', intent: 'success', countdownSeconds: 0,
        warningText: `${p.rows.length} dòng từ ${viDate(from)} đến ${viDate(to)} · vào +${shortMoney(tin)} · ra −${shortMoney(tout)}.${p.skipped.length ? ` Bỏ ${p.skipped.length} dòng không đọc được (dòng ${p.skipped.slice(0, 5).map(s => s.row).join(', ')}${p.skipped.length > 5 ? '…' : ''}).` : ''} Dòng đã nhập trước tự bỏ; Vioo tự khớp với sổ thu chi.` })) return;
      const att = await financeService.upload(`bank/${accountId}`, [file]).catch(() => []);
      const r = await financeService.importBankStatement({ accountId, fileName: file.name, filePath: att[0]?.path || null, rows: p.rows });
      toast.success('Đã nhập sao kê', `${r.inserted} dòng mới · tự khớp ${r.matched}${r.duplicates ? ` · bỏ ${r.duplicates} dòng đã nhập trước` : ''}.`);
      setShow('unmatched'); load(); onChanged();
    } catch (e) { toast.error('Chưa nhập được sao kê', e instanceof Error ? e.message : ''); }
    finally { setBusy(null); }
  };
  const match = async (l: BankLine, c: NonNullable<BankLine['candidates']>[number]) => {
    let reason: string | undefined;
    if (c.amount != null && Math.abs(c.amount - l.amount) > 0.5) {
      const r = await askReason({ title: 'Khớp khi số tiền lệch', targetName: `Sao kê ${money(l.amount)} đ · sổ ${money(c.amount)} đ (${c.code || CASH_SOURCE[c.sourceType] || c.sourceType})`,
        subtitle: `Lệch ${money(Math.abs(l.amount - c.amount))} đ. Ghi lý do (VD ngân hàng trừ phí chuyển tiền) — phần lệch cần lập phiếu riêng nếu là chi phí.`, reasonLabel: 'Lý do lệch', actionLabel: 'Khớp', intent: 'warning' });
      if (!r) return; reason = r;
    }
    void act(l.id, () => financeService.decideBankLine({ action: 'match', lineId: l.id, entryId: c.id, reason }), 'Đã khớp dòng sao kê với sổ.');
  };

  if (error) return <Drawer label="Sao kê ngân hàng" wide onClose={onClose} header={<h2 className="text-lg font-bold">Sao kê ngân hàng</h2>}><StateBox kind="error" title="Chưa tải được sao kê" message={error} onRetry={load} /></Drawer>;
  if (!data) return <Drawer label="Sao kê ngân hàng" wide onClose={onClose} header={<h2 className="text-lg font-bold">Sao kê ngân hàng</h2>}><StateBox kind="loading" title="Đang tải sao kê…" /></Drawer>;
  const k = data.counts; const can = data.can; const sb = data.statementBalance;
  const lines = data.lines.filter(l => show === 'all' || l.status === show);
  // File sao kê đã lưu dùng luôn làm chứng từ cho phiếu thu lập từ dòng sao kê.
  const stmtFile = (id: string) => { const st = data.statements.find(x => x.id === id); return st?.filePath ? [{ name: st.fileName || 'Sao kê', path: st.filePath, size: 0, type: '', uploadedAt: st.createdAt }] : []; };
  const diff = sb ? sb.balance - sb.book : null;

  return <Drawer label="Sao kê ngân hàng" wide onClose={onClose}
    header={<><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Thu chi & quỹ · sao kê ngân hàng</p>
      <h2 className={`text-lg ${ENT}`}>{data.account.name}</h2>
      <p className="text-sm text-muted-foreground">{[data.account.bankName, data.account.accountNo].filter(Boolean).join(' · ') || 'Tài khoản ngân hàng'}{data.period.from ? ` · sao kê đã nhập ${viDate(data.period.from)} – ${viDate(data.period.to)}` : ''}</p></>}
    footer={<>{can.record && <button type="button" disabled={Boolean(busy)} onClick={() => void act('rematch', () => financeService.decideBankLine({ action: 'rematch', accountId }), 'Đã chạy tự khớp lại.')} className={secondaryBtn}>
        {busy === 'rematch' ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}Tự khớp lại</button>}
      {can.record && <button type="button" disabled={Boolean(busy)} onClick={() => fileRef.current?.click()} className={primaryBtn}>{busy === 'import' ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}Nhập file sao kê</button>}</>}>
    <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }} />

    {k.total === 0 ? <section className="rounded-2xl border border-dashed border-teal-300 bg-teal-50/40 p-5 text-center dark:border-teal-900 dark:bg-teal-950/20">
      <FileSpreadsheet size={28} className="mx-auto text-teal-700" />
      <p className="mt-2 font-semibold">Chưa nhập sao kê nào cho tài khoản này</p>
      <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">Tải sao kê dạng Excel từ internet banking (Vietcombank, BIDV, VietinBank, Techcombank, MB, ACB…) rồi bấm <b>Nhập file sao kê</b>.
        Vioo tự nhận cột Ngày, Ghi nợ / Ghi có, Nội dung, Số tham chiếu và tự khớp với các khoản thu chi đã ghi.</p>
    </section> : <>
      <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {([['unmatched', 'Chưa khớp', `${k.unmatched} dòng`, `vào +${shortMoney(k.unmatchedIn)} · ra −${shortMoney(k.unmatchedOut)}`, k.unmatched ? 'text-amber-700' : 'text-leaf-700'],
          ['matched', 'Đã khớp', `${k.matched} dòng`, `${k.total ? Math.round(k.matched * 100 / k.total) : 0}% sao kê`, 'text-leaf-700'],
          ['ignored', 'Bỏ qua', `${k.ignored} dòng`, 'có lý do', 'text-foreground']] as const).map(([key, l, v, h, tone]) =>
          <button key={key} type="button" aria-pressed={show === key} onClick={() => { setShow(key); setLimit(PAGE); }}
            className={`rounded-xl border bg-card p-3 text-left ${show === key ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-border hover:border-teal-300'}`}>
            <span className="block text-xs text-muted-foreground">{l}</span><b className={`block text-lg tabular-nums ${tone}`}>{v}</b><span className="text-[11px] text-muted-foreground">{h}</span></button>)}
        <button type="button" onClick={() => document.getElementById('bank-book-only')?.scrollIntoView({ behavior: 'smooth' })} className="rounded-xl border border-border bg-card p-3 text-left hover:border-teal-300">
          <span className="block text-xs text-muted-foreground">Sổ chưa thấy trên sao kê</span><b className={`block text-lg tabular-nums ${data.bookOnly.length ? 'text-amber-700' : 'text-leaf-700'}`}>{data.bookOnly.length} dòng</b>
          <span className="text-[11px] text-muted-foreground">trong kỳ sao kê đã nhập</span></button>
      </section>
      {sb && <p className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm ${diff != null && Math.abs(diff) > 0.5 ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100' : 'border-leaf-200 bg-leaf-50 text-leaf-900'}`}>
        {diff != null && Math.abs(diff) > 0.5 ? <AlertTriangle size={15} className="shrink-0" /> : <CheckCircle2 size={15} className="shrink-0" />}
        <span className="min-w-0 flex-1">Số dư ngày {viDate(sb.date)}: sao kê <b className="tabular-nums">{money(sb.balance)} đ</b> · sổ Vioo <b className="tabular-nums">{money(sb.book)} đ</b>
          {diff != null && Math.abs(diff) > 0.5 ? <> · lệch <b>{money(Math.abs(diff))} đ</b> — xử lý các dòng chưa khớp / sổ chưa thấy trên sao kê, rồi Đối chiếu sao kê cuối tháng.</> : ' · khớp.'}</span></p>}

      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-2">
          <div role="tablist" aria-label="Lọc dòng" className="inline-flex rounded-lg border border-border p-0.5 text-sm">
            {([['unmatched', `Chưa khớp ${k.unmatched}`], ['matched', `Đã khớp ${k.matched}`], ['ignored', `Bỏ qua ${k.ignored}`], ['all', 'Tất cả']] as const).map(([key, l]) =>
              <button key={key} type="button" role="tab" aria-selected={show === key} onClick={() => { setShow(key); setLimit(PAGE); }} className={`rounded-md px-2.5 py-1 font-semibold ${show === key ? 'bg-teal-700 text-white' : 'text-muted-foreground'}`}>{l}</button>)}</div>
          <span className="ml-auto text-xs text-muted-foreground">{lines.length.toLocaleString('vi-VN')} dòng</span>
        </div>
        {lines.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">{show === 'unmatched' ? 'Đã khớp hết — không còn dòng sao kê nào chờ xử lý.' : 'Không có dòng nào.'}</p>
          : <ul className="divide-y divide-border text-sm">{lines.slice(0, limit).map(l => { const st = STATUS[l.status]; const b = busy === l.id;
            return <li key={l.id} className="px-3 py-2.5">
              <p className="flex items-start gap-2">{l.direction === 'in' ? <ArrowDownLeft size={15} className="mt-0.5 shrink-0 text-leaf-700" /> : <ArrowUpRight size={15} className="mt-0.5 shrink-0 text-rose-700" />}
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{l.description || '(không có nội dung)'}</span>
                  <span className="block text-xs text-muted-foreground">{viDate(l.date)}{l.reference ? ` · ${l.reference}` : ''}{l.counterparty ? ` · ${l.counterparty}` : ''}</span></span>
                <span className={`shrink-0 font-semibold tabular-nums ${l.direction === 'in' ? 'text-leaf-700' : 'text-rose-700'}`}>{signed(l.direction, l.amount)}</span>
                <Badge className={st.cls}>{l.status === 'matched' ? (l.matchKind === 'auto' ? 'Tự khớp' : 'Khớp tay') : st.label}</Badge></p>
              {l.status === 'matched' && l.entry && <p className="mt-1 flex flex-wrap items-center gap-2 pl-6 text-xs text-muted-foreground"><Link2 size={12} />
                <span className="min-w-0 flex-1">Sổ: <b className="text-foreground">{l.entry.code || CASH_SOURCE[l.entry.sourceType] || l.entry.sourceType}</b> · {viDate(l.entry.date)} · {l.entry.description || ''}{l.note ? ` · ${l.note}` : ''}</span>
                {can.record && <button type="button" disabled={b} onClick={() => void act(l.id, () => financeService.decideBankLine({ action: 'unmatch', lineId: l.id }), 'Đã bỏ khớp.')} className="font-semibold text-rose-700 hover:underline"><Unlink size={11} className="mr-0.5 inline" />Bỏ khớp</button>}</p>}
              {l.status === 'ignored' && <p className="mt-1 flex flex-wrap items-center gap-2 pl-6 text-xs text-muted-foreground"><span className="min-w-0 flex-1">Lý do: {l.note}</span>
                {can.record && <button type="button" disabled={b} onClick={() => void act(l.id, () => financeService.decideBankLine({ action: 'unignore', lineId: l.id }), 'Đã đưa lại vào chờ khớp.')} className="font-semibold text-teal-700 hover:underline"><Undo2 size={11} className="mr-0.5 inline" />Khôi phục</button>}</p>}
              {l.status === 'unmatched' && can.record && <div className="mt-1.5 space-y-1 pl-6">
                {(l.candidates || []).length > 0 ? <div className="flex flex-wrap gap-1.5">{(l.candidates || []).map(c => <button key={c.id} type="button" disabled={b} onClick={() => void match(l, c)}
                  className="inline-flex max-w-full items-center gap-1 rounded-lg border border-teal-200 bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-800 hover:bg-teal-100 disabled:opacity-50">
                  <Link2 size={12} className="shrink-0" /><span className="truncate">Khớp {c.code || CASH_SOURCE[c.sourceType] || c.sourceType} · {viDate(c.date)}{c.amount != null && Math.abs(c.amount - l.amount) > 0.5 ? ` · ${money(c.amount)} đ` : ''}{c.counterparty ? ` · ${c.counterparty}` : ''}</span></button>)}</div>
                  : <p className="text-xs text-muted-foreground">Sổ chưa có khoản {l.direction === 'in' ? 'thu' : 'chi'} nào cùng số tiền quanh ngày này.</p>}
                <p className="flex flex-wrap gap-3 text-xs font-semibold">
                  {l.direction === 'in' ? <button type="button" disabled={b} className="text-teal-700 hover:underline" onClick={() => setSub({ kind: 'receipt', prefill: { toAccountId: accountId, amount: l.amount, date: l.date,
                      documentRef: l.reference || undefined, counterparty: l.counterparty || undefined, description: l.description || '', attachments: stmtFile(l.statementId) } })}><ArrowDownLeft size={11} className="mr-0.5 inline" />Ghi phiếu thu khác</button>
                    : <button type="button" disabled={b} className="text-teal-700 hover:underline" onClick={() => setSub({ kind: 'expense', prefill: { amount: l.amount, date: l.date, counterparty: l.counterparty || data.account.bankName || '',
                      note: l.description || '', category: /phi|phí|fee|sms/i.test(l.description || '') ? 'bank_fee' : 'other' } })}><Send size={11} className="mr-0.5 inline" />Lập phiếu chi khác</button>}
                  <button type="button" disabled={b} className="text-muted-foreground hover:underline" onClick={async () => {
                    const r = await askReason({ title: 'Bỏ qua dòng sao kê', targetName: `${viDate(l.date)} · ${signed(l.direction, l.amount)} đ`, reasonLabel: 'Lý do',
                      reasonPlaceholder: l.direction === 'in' ? 'VD: tiền CĐT — ghi ở Phải thu sau' : 'VD: phí ngân hàng — gộp ghi cuối tháng', actionLabel: 'Bỏ qua', intent: 'warning' });
                    if (r) void act(l.id, () => financeService.decideBankLine({ action: 'ignore', lineId: l.id, reason: r }), 'Đã bỏ qua dòng sao kê.');
                  }}>Bỏ qua</button>
                  {l.direction === 'in' && <a href="#/finance/receivables" className="text-muted-foreground hover:underline">Tiền CĐT? Ghi ở Phải thu</a>}</p>
              </div>}
            </li>; })}</ul>}
        {lines.length > limit && <button type="button" onClick={() => setLimit(n => n + PAGE)} className="w-full border-t border-border py-2 text-sm font-semibold text-teal-700 hover:bg-muted/40">Xem thêm (còn {lines.length - limit} dòng)</button>}
      </section>

      <section id="bank-book-only" className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h3 className="font-semibold">Sổ Vioo chưa thấy trên sao kê ({data.bookOnly.length})</h3>
        <p className="text-xs text-muted-foreground">Khoản đã ghi vào tài khoản này trong kỳ sao kê nhưng ngân hàng chưa có — có thể chọn nhầm tài khoản, chưa chi thật, hoặc khớp tay ở dòng sao kê tương ứng.</p>
        {data.bookOnly.length === 0 ? <p className="mt-1 text-sm text-leaf-700">Không có.</p>
          : <ul className="mt-2 divide-y divide-border text-sm">{data.bookOnly.map(e => <li key={e.id} className="flex flex-wrap items-center gap-2 py-2">
            <span className="w-24 shrink-0 whitespace-nowrap tabular-nums text-muted-foreground">{viDate(e.date)}</span>
            <span className="min-w-0 flex-1"><b>{e.code || CASH_SOURCE[e.sourceType] || e.sourceType}</b> <span className="text-xs text-muted-foreground">{CASH_SOURCE[e.sourceType] || e.sourceType}{e.counterparty ? ` · ${e.counterparty}` : ''}{e.description ? ` · ${e.description}` : ''}</span></span>
            <span className={`font-semibold tabular-nums ${e.direction === 'in' ? 'text-leaf-700' : 'text-rose-700'}`}>{signed(e.direction, e.amount)}</span></li>)}</ul>}
      </section>
    </>}

    {data.statements.length > 0 && <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <h3 className="font-semibold">File sao kê đã nhập</h3>
      <ul className="mt-2 divide-y divide-border text-sm">{data.statements.map(s => <li key={s.id} className={`flex flex-wrap items-center gap-2 py-2 ${s.cancelledAt ? 'opacity-60' : ''}`}>
        <FileSpreadsheet size={14} className="text-muted-foreground" />
        <span className="min-w-0 flex-1">{s.filePath ? <button type="button" onClick={() => void financeService.openAttachment(s.filePath!)} className="font-semibold text-teal-700 hover:underline">{s.fileName || 'Sao kê'}</button> : <b>{s.fileName || 'Sao kê'}</b>}
          {s.cancelledAt && <Badge className="ml-1 border-slate-200 bg-slate-100 text-slate-600">đã huỷ</Badge>}
          <span className="block text-xs text-muted-foreground">{viDate(s.from)} – {viDate(s.to)} · {s.lines} dòng{s.duplicates ? ` · bỏ ${s.duplicates} trùng` : ''} · {s.createdBy || '—'} {viDate(s.createdAt)}
            {s.cancelledAt ? ` · huỷ: ${s.cancelledBy || '—'} — ${s.cancelReason || ''}` : ''}</span></span>
        {!s.cancelledAt && can.confirm && <button type="button" disabled={Boolean(busy)} className="text-xs font-semibold text-rose-700 hover:underline" onClick={async () => {
          const r = await askReason({ title: 'Huỷ file sao kê', targetName: `${s.fileName || 'Sao kê'} · ${s.lines} dòng`, subtitle: 'Xoá các dòng sao kê của file này (kể cả dòng đã khớp). Sổ thu chi không đổi. Lưu đủ trong nhật ký.',
            reasonLabel: 'Lý do', reasonPlaceholder: 'VD: nhập nhầm tài khoản', actionLabel: 'Huỷ file', intent: 'danger' });
          if (r) void act(s.id, () => financeService.cancelBankStatement({ statementId: s.id, reason: r }), 'Đã huỷ file sao kê.');
        }}><RotateCcw size={11} className="mr-0.5 inline" />Huỷ</button>}</li>)}</ul>
    </section>}

    {sub?.kind === 'receipt' && <MovementDrawer data={cash} kind="receipt" prefill={sub.prefill} onClose={() => setSub(null)}
      onSaved={m => { setSub(null); toast.success('Phiếu thu khác', `${m} Khi được xác nhận, bấm "Tự khớp lại".`); onChanged(); }} />}
    {sub?.kind === 'expense' && <ExpenseDrawer projects={cash.projects} prefill={sub.prefill} onClose={() => setSub(null)}
      onSaved={m => { setSub(null); toast.success('Phiếu chi khác', `${m} Khi xác nhận đã chi (chọn tài khoản này), bấm "Tự khớp lại".`); onChanged(); }} />}
  </Drawer>;
};
