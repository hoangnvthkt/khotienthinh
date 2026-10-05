import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Building2, CalendarClock, Check, ClipboardCheck, Coins, FileText, HandCoins, History, Lock, Pencil, Plus, Receipt, RotateCcw,
  Send, Settings2, ShieldCheck, Undo2, Wallet, X,
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { useConfirm, useReasonConfirm } from '../../context/ConfirmContext';
import {
  EVENT_LABELS, SOURCE_LABELS, financeService, type FinanceSubcontracts, type SubcontractCostReview, type SubcontractDetail, type SubcontractIssue,
  type SubcontractRound, type SubcontractRoundStatus, type SubcontractSummary,
} from '../../lib/financeService';
import { Badge, StateBox, money, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { ENT, NUM, dueText, projectFinanceHref, shortMoney, toneOf, TONE_TEXT, viDate } from './financeUi';
import {
  CostReviewDrawer, DEDUCTION_LABELS, SubcontractAdvanceDrawer, SubcontractOpeningDrawer, SubcontractRoundDrawer, SubcontractTermsDrawer, WARN,
} from './SubcontractDrawers';

// Tài chính → Phải trả → Thầu phụ: HĐ thầu phụ → đợt nghiệm thu thanh toán → công nợ (trả bằng Đề nghị chi như NCC), giữ lại, tạm ứng, TNCN.
// Dự án chỉ xem phần này. Chưa chốt đầu kỳ MISA thì còn nợ / giữ lại / tạm ứng trước mốc là "chưa biết" — không hiện 0.

export const ISSUE_TEXT: Record<SubcontractIssue, string> = {
  no_partner: 'Chưa gắn đối tác nhận tiền', zero_value: 'HĐ giá trị 0 (khoán theo khối lượng thực tế)', no_signed_date: 'HĐ chưa có ngày ký',
  signed_future: 'Ngày ký ở tương lai — kiểm tra ở module Hợp đồng', no_project: 'HĐ chưa gắn dự án', status: 'HĐ chưa ký / đã hủy / hết hạn',
  no_retention_due: 'Có giữ lại nhưng HĐ chưa có ngày hoàn thành hoặc tháng bảo hành — giữ lại chưa có hạn trả',
  over_contract: 'Lũy kế nghiệm thu vượt giá trị HĐ', no_bank: 'Đối tác chưa có số tài khoản — chỉ chi tiền mặt được',
};
const ROUND_BADGE: Record<SubcontractRoundStatus, { label: string; cls: string }> = {
  draft: { label: 'Nháp', cls: 'border-slate-200 bg-slate-100 text-slate-700' },
  submitted: { label: 'Chờ ghi nhận', cls: 'border-amber-300 bg-amber-50 text-amber-800' },
  recognized: { label: 'Đã ghi nhận', cls: 'border-leaf-200 bg-leaf-50 text-leaf-800' },
  cancelled: { label: 'Đã hủy / đảo', cls: 'border-slate-200 bg-slate-50 text-slate-500 line-through' },
};
const OPENING_BADGE = {
  todo: { label: 'Chưa chốt đầu kỳ', cls: 'border-slate-200 bg-slate-100 text-slate-600' },
  submitted: { label: 'Đầu kỳ chờ chốt', cls: 'border-amber-300 bg-amber-50 text-amber-800' },
  confirmed: { label: 'Đã chốt đầu kỳ', cls: 'border-leaf-200 bg-leaf-50 text-leaf-800' },
};
const Unknown: React.FC<{ why: string }> = ({ why }) => <span className="text-sm font-semibold text-slate-500" title={why}>chưa biết</span>;
const Kpi: React.FC<{ icon: React.ElementType; label: string; value: React.ReactNode; hint: string; tone?: string; onClick?: () => void; active?: boolean; title?: string }> = ({ icon: I, label, value, hint, tone = 'text-leaf-700 dark:text-leaf-300', onClick, active, title }) => {
  const body = <><span className="flex items-start gap-1.5 text-xs font-semibold uppercase leading-tight tracking-wide text-muted-foreground"><I size={14} className="shrink-0 text-teal-700" />{label}</span>
    <span className={`mt-1 block text-xl font-bold tabular-nums ${tone}`}>{value}</span><span className="block text-xs text-muted-foreground">{hint}</span></>;
  return onClick ? <button type="button" onClick={onClick} title={title} aria-pressed={active} className={`rounded-2xl border bg-card p-3 text-left shadow-sm transition ${active ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-border hover:border-teal-300'}`}>{body}</button>
    : <article className="rounded-2xl border border-border bg-card p-3 shadow-sm">{body}</article>;
};
const scrollTo = (id: string) => setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }), 50);
type SFilter = 'all' | 'outstanding' | 'retention' | 'advance' | 'pit' | 'todo';
const S_LABEL: Record<SFilter, string> = { all: '', outstanding: 'Còn phải trả', retention: 'Đang giữ lại bảo hành', advance: 'Còn tạm ứng chưa thu hồi', pit: 'Có TNCN đã khấu trừ', todo: 'Chưa chốt đầu kỳ' };

// ---------- Danh sách ----------
export const SubcontractsView: React.FC<{ initialSubcontractId?: string | null; onChanged: () => void }> = ({ initialSubcontractId, onChanged }) => {
  const [data, setData] = useState<FinanceSubcontracts | null>(null);
  const [error, setError] = useState<{ msg: string; denied: boolean } | null>(null);
  const [sel, setSel] = useState<string | null>(initialSubcontractId || null);
  const [mobile, setMobile] = useState(Boolean(initialSubcontractId));
  const [review, setReview] = useState<SubcontractCostReview | null>(null);
  const [panelKey, setPanelKey] = useState(0);
  const [sf, setSf] = useState<SFilter>('all');
  const toggle = (k: SFilter) => setSf(cur => cur === k ? 'all' : k);
  const load = useCallback(() => {
    setError(null);
    financeService.subcontracts().then(d => { setData(d); setSel(cur => cur || d.contracts[0]?.id || null); })
      .catch(e => setError({ msg: e instanceof Error ? e.message : String(e), denied: (e as { code?: string })?.code === 'FINANCE_VIEW_DENIED' }));
  }, []);
  useEffect(load, [load]);
  if (error) return <StateBox kind={error.denied ? 'denied' : 'error'} title="Chưa tải được Thầu phụ" message={error.msg} onRetry={error.denied ? undefined : load} />;
  if (!data) return <StateBox kind="loading" title="Đang tải hợp đồng thầu phụ…" />;
  const t = data.totals;
  const shown = data.contracts.filter(c => { const m = c.metrics; return sf === 'all' || (sf === 'outstanding' && m.outstanding > 0.5) || (sf === 'retention' && m.retentionHeld > 0.5)
    || (sf === 'advance' && m.advanceRemaining > 0.5) || (sf === 'pit' && m.pitWithheld > 0.5) || (sf === 'todo' && m.opening !== 'confirmed'); });
  const todo = data.contracts.filter(c => c.metrics.opening !== 'confirmed');
  const allUnknown = data.contracts.length > 0 && todo.length === data.contracts.length;
  const withValue = data.contracts.filter(c => (c.value || 0) > 0).length;
  const open = (id: string) => { setSel(id); setMobile(true); window.scrollTo({ top: 0 }); };
  const cards: Array<{ tone: 'rose' | 'amber' | 'slate'; title: string; text: string; onClick?: () => void }> = [];
  if (t.roundsWaitingMe > 0) cards.push({ tone: 'amber', title: `${t.roundsWaitingMe} đợt chờ bạn ghi nhận`, text: 'Kiểm biên bản, số lũy kế và khấu trừ rồi ghi nhận hoặc trả lại.',
    onClick: () => { const c = data.contracts.find(x => x.metrics.openRound === 'submitted'); if (c) open(c.id); } });
  if (t.openingsPendingMe > 0) cards.push({ tone: 'amber', title: `${t.openingsPendingMe} đầu kỳ chờ bạn chốt`, text: 'Đối chiếu với sổ MISA rồi chốt hoặc trả lại.',
    onClick: () => { const c = data.contracts.find(x => x.metrics.opening === 'submitted'); if (c) open(c.id); } });
  if (t.openingsTodo > 0) cards.push({ tone: 'amber', title: `${t.openingsTodo}/${t.contracts} HĐ chưa khai đầu kỳ 30/09`, text: `Tiền đã trả thầu phụ trước 01/10 chỉ có ở MISA → còn nợ / giữ lại / tạm ứng đang chưa biết. Phải chốt đầu kỳ (khai 0 nếu chưa phát sinh) mới lập đợt được.`,
    onClick: () => open(todo[0].id) });
  if (data.reviewCosts.length > 0) cards.push({ tone: 'rose', title: `${data.reviewCosts.length} khoản chi phí nhân công ghi tay cần soát xét — ${shortMoney(data.reviewCosts.reduce((s, x) => s + x.amount, 0))}`,
    text: 'Có thể trùng số MISA đã nhập (VD ghi "lũy kế"). Xem danh sách bên dưới.', onClick: () => document.getElementById('cost-review')?.scrollIntoView({ behavior: 'smooth' }) });
  if (t.retentionDue > 0) cards.push({ tone: 'slate', title: `${t.retentionDue} khoản giữ lại bảo hành đến hạn trong 30 ngày`, text: 'Kiểm tra bảo hành rồi lập đề nghị chi.' });
  if (data.withoutContract.length > 0) cards.push({ tone: 'slate', title: `${data.withoutContract.length} đối tác có chi phí nhân công nhưng chưa có HĐ thầu phụ`,
    text: `${data.withoutContract.slice(0, 3).map(w => `${w.name} (${w.projectCode}, ${shortMoney(w.amount)})`).join(' · ')} — lập HĐ ở module Hợp đồng nếu còn trả tiền.` });
  const CLS = { rose: 'border-rose-200 bg-rose-50/70 dark:border-rose-900 dark:bg-rose-950/30', amber: 'border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/30', slate: 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900' };
  const unknownHint = allUnknown ? 'chờ đầu kỳ MISA' : todo.length ? `chưa gồm ${todo.length} HĐ chưa chốt đầu kỳ` : '';
  return <div className="space-y-3">
    <section className={`grid grid-cols-2 gap-2 lg:grid-cols-5 ${mobile ? 'hidden md:grid' : ''}`}>
      <Kpi active={sf === 'all'} onClick={() => setSf('all')} title="Xem tất cả HĐ" icon={FileText} label="Giá trị HĐ (gồm VAT)" value={shortMoney(t.value)} hint={`${withValue}/${t.contracts} HĐ có giá trị · còn lại khoán`} />
      <Kpi active={sf === (allUnknown ? 'todo' : 'outstanding')} onClick={() => toggle(allUnknown ? 'todo' : 'outstanding')} icon={Wallet} label="Còn phải trả" value={allUnknown ? <Unknown why="Chưa chốt đầu kỳ MISA" /> : shortMoney(t.outstanding)} hint={unknownHint || (t.overdue > 0 ? `${shortMoney(t.overdue)} quá hạn` : 'đã ghi nhận, chưa chi')}
        tone={t.overdue > 0 ? 'text-rose-700 dark:text-rose-300' : undefined} />
      <Kpi active={sf === (allUnknown ? 'todo' : 'retention')} onClick={() => toggle(allUnknown ? 'todo' : 'retention')} icon={ShieldCheck} label="Giữ lại bảo hành" value={allUnknown ? <Unknown why="Chưa chốt đầu kỳ MISA" /> : shortMoney(t.retentionHeld)} hint={unknownHint || 'trả khi hết bảo hành'} tone="text-foreground" />
      <Kpi active={sf === (allUnknown ? 'todo' : 'advance')} onClick={() => toggle(allUnknown ? 'todo' : 'advance')} icon={HandCoins} label="Tạm ứng còn thu hồi" value={allUnknown ? <Unknown why="Chưa chốt đầu kỳ MISA" /> : shortMoney(t.advanceRemaining)} hint={unknownHint || 'trừ dần qua các đợt'} tone="text-teal-700 dark:text-teal-300" />
      <Kpi active={sf === 'pit'} onClick={() => toggle('pit')} icon={Receipt} label="TNCN đã khấu trừ" value={shortMoney(t.pitWithheld)} hint="tổ đội cá nhân · công ty nộp thay" tone="text-foreground" />
    </section>
    {cards.length > 0 && <section className={`rounded-2xl border border-border bg-card p-4 shadow-sm ${mobile ? 'hidden md:block' : ''}`}>
      <h3 className="flex items-center gap-1.5 font-bold"><CalendarClock size={16} className="text-amber-600" />Cần làm</h3>
      <ul className="mt-2 grid gap-2 text-sm md:grid-cols-2">{cards.map((a, i) => <li key={i}>{a.onClick
        ? <button type="button" onClick={a.onClick} className={`w-full rounded-xl border p-3 text-left hover:shadow ${CLS[a.tone]}`}><b className="block">{a.title}</b><span className="text-xs text-muted-foreground">{a.text}</span></button>
        : <div className={`rounded-xl border p-3 ${CLS[a.tone]}`}><b className="block">{a.title}</b><span className="text-xs text-muted-foreground">{a.text}</span></div>}</li>)}</ul>
    </section>}
    {data.contracts.length === 0 ? <StateBox kind="empty" title="Chưa có hợp đồng thầu phụ" message="Lập HĐ thầu phụ ở module Hợp đồng (trạng thái Đã ký / Đang thi công); nghiệm thu thanh toán làm ở đây." />
      : <div className="grid gap-4 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <ul className={`h-fit overflow-hidden rounded-2xl border border-border bg-card shadow-sm ${mobile ? 'hidden md:block' : ''}`}>
          {sf !== 'all' && <li className="flex items-center gap-2 border-b border-border bg-teal-50/60 px-3 py-2 text-xs"><span className="flex-1">Đang lọc: <b>{S_LABEL[sf]}</b> · {shown.length}/{data.contracts.length} HĐ</span>
            <button type="button" onClick={() => setSf('all')} className="font-semibold text-teal-700 hover:underline">Bỏ lọc</button></li>}
          {shown.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">Không có HĐ nào khớp.</li>}
          {shown.map(c => <ContractRow key={c.id} c={c} active={sel === c.id} onClick={() => open(c.id)} />)}
        </ul>
        <section className={`min-w-0 ${mobile ? '' : 'hidden md:block'}`}>
          {sel ? <SubcontractPanel key={`${sel}:${panelKey}`} id={sel} onBack={() => setMobile(false)} onChanged={() => { load(); onChanged(); }} />
            : <StateBox kind="empty" title="Chọn một hợp đồng" message="Chọn HĐ thầu phụ ở danh sách để xem đợt nghiệm thu, công nợ, tạm ứng." />}
        </section>
      </div>}
    {data.reviewCosts.length > 0 && <section id="cost-review" className={`overflow-hidden rounded-2xl border border-rose-200 bg-card shadow-sm dark:border-rose-900 ${mobile ? 'hidden md:block' : ''}`}>
      <div className="border-b border-rose-200 bg-rose-50/70 px-4 py-2.5 dark:border-rose-900 dark:bg-rose-950/30"><h3 className="flex items-center gap-1.5 font-semibold"><AlertTriangle size={15} className="text-rose-600" />Soát xét chi phí nhân công ghi tay</h3>
        <p className="text-xs text-muted-foreground">Không xóa dòng cũ. Trùng với số MISA đã nhập thì đảo đúng phần trùng (dòng âm, có lý do); không trùng thì xác nhận giữ nguyên.</p></div>
      <ul className="divide-y divide-border text-sm">{data.reviewCosts.map(r => <li key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
        <span className="min-w-[14rem] flex-1"><b className={ENT}>{r.counterparty || r.description}</b> <span className="text-xs text-muted-foreground">· {r.projectCode} · {r.createdByName || '—'} nhập {viDate(r.createdAt)}</span>
          <span className="block text-xs text-muted-foreground">{r.description}</span>
          <span className="block text-xs">{r.misa.length ? <span className="text-amber-700 dark:text-amber-300">MISA đã nhập cho cùng đối tác: {r.misa.length} dòng · {shortMoney(r.misa.reduce((s, x) => s + x.amount, 0))}</span>
            : <span className="text-muted-foreground">Không thấy dòng MISA trùng tên</span>}</span></span>
        <span className={`whitespace-nowrap ${NUM}`}>{shortMoney(r.amount)}</span>
        {data.can.record ? <button type="button" className={secondaryBtn} onClick={() => setReview(r)}><ClipboardCheck size={14} />Soát xét</button>
          : <span className="text-xs text-muted-foreground">Cần quyền Ghi nhận</span>}
      </li>)}</ul>
    </section>}
    <p className={`flex items-center gap-1.5 text-xs text-muted-foreground ${mobile ? 'hidden md:flex' : ''}`}><Lock size={13} />Nghiệm thu thanh toán, tạm ứng, giữ lại của HĐ thầu phụ chỉ lập ở đây; Dự án chỉ xem.</p>
    {review && <CostReviewDrawer item={review} onClose={() => setReview(null)} onDone={() => { setReview(null); load(); setPanelKey(k => k + 1); onChanged(); }} />}
  </div>;
};

const ContractRow: React.FC<{ c: SubcontractSummary; active: boolean; onClick: () => void }> = ({ c, active, onClick }) => {
  const m = c.metrics; const ob = OPENING_BADGE[m.opening];
  return <li><button type="button" onClick={onClick}
    className={`block w-full border-b border-l-4 border-border px-3 py-3 text-left ${m.overdue > 0.5 ? 'border-l-rose-500' : m.opening !== 'confirmed' ? 'border-l-slate-300' : m.outstanding > 0.5 ? 'border-l-amber-400' : 'border-l-leaf-500'} ${active ? 'bg-teal-50/70 dark:bg-teal-950/20' : 'hover:bg-muted/40'}`}>
    <span className="flex items-start gap-2"><span className="min-w-0 flex-1"><b className={`block truncate ${ENT}`}>{c.partnerName || c.subcontractorName}</b>
      <span className="block truncate text-xs text-muted-foreground">{c.code} · {c.projectCode || 'chưa gắn dự án'}</span>
      <span className="mt-1 flex flex-wrap gap-1"><Badge className={ob.cls}>{ob.label}</Badge>
        {m.openRound === 'submitted' && <Badge className="border-amber-300 bg-amber-50 text-amber-800">Đợt chờ ghi nhận</Badge>}
        {m.openRound === 'draft' && <Badge className="border-teal-200 bg-teal-50 text-teal-800">Đợt nháp</Badge>}
        {c.withholdPit && <Badge className="border-slate-200 bg-slate-50 text-slate-600">TNCN</Badge>}
        {m.issues.length > 0 && <Badge className={WARN} title={m.issues.map(i => ISSUE_TEXT[i]).join('\n')}>{m.issues.length} cần xem</Badge>}</span></span>
      <span className="text-right"><span className="block text-[11px] text-muted-foreground">còn phải trả</span>
        {m.opening === 'confirmed' ? <b className={`text-sm ${NUM}`}>{shortMoney(m.outstanding)}</b> : <Unknown why="Chưa chốt đầu kỳ MISA" />}
        <span className="block text-[11px] text-muted-foreground">{(c.value || 0) > 0 ? `HĐ ${shortMoney(m.grossValue || 0)}` : 'HĐ khoán'}</span></span></span>
  </button></li>;
};

// ---------- Chi tiết một HĐ ----------
export const SubcontractPanel: React.FC<{ id: string; onBack: () => void; onChanged: () => void }> = ({ id, onBack, onChanged }) => {
  const toast = useToast(); const confirm = useConfirm(); const askReason = useReasonConfirm();
  const [d, setD] = useState<SubcontractDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState<null | { kind: 'terms' | 'opening' | 'advance' } | { kind: 'round'; round: SubcontractRound | null }>(null);
  const [showHistory, setShowHistory] = useState(false);
  const load = useCallback(() => { setError(null); financeService.subcontract(id).then(setD).catch(e => setError(e instanceof Error ? e.message : String(e))); }, [id]);
  useEffect(load, [load]);
  if (error) return <StateBox kind="error" title="Chưa tải được HĐ thầu phụ" message={error} onRetry={load} />;
  if (!d) return <StateBox kind="loading" title="Đang tải HĐ thầu phụ…" />;
  const c = d.contract; const m = d.metrics; const can = d.can;
  const done = (msg?: string) => { setDrawer(null); if (msg) toast.success('Thầu phụ', msg); load(); onChanged(); };
  const exec = async (fn: () => Promise<unknown>, ok: string, failTitle: string) => {
    setBusy(true);
    try { await fn(); toast.success('Thầu phụ', ok); load(); onChanged(); }
    catch (e) { toast.error(failTitle, e instanceof Error ? e.message : ''); } finally { setBusy(false); }
  };
  const openRound = d.rounds.find(r => r.status === 'draft' || r.status === 'submitted') || null;
  // Điều kiện để lập đợt: hiện rõ thiếu gì thay vì để bấm rồi lỗi.
  const roundBlockers = [
    !c.partnerId && 'HĐ chưa gắn đối tác nhận tiền (Quản trị Tài chính khai ở Điều khoản)',
    !c.projectId && 'HĐ chưa gắn dự án (sửa ở module Hợp đồng)',
    !['signed', 'active', 'completed'].includes(c.status) && 'HĐ chưa ở trạng thái Đã ký / Đang thi công / Hoàn thành',
    m.opening !== 'confirmed' && (m.opening === 'submitted' ? 'Đầu kỳ đang chờ người khác chốt' : 'Chưa chốt đầu kỳ 30/09 theo MISA'),
    openRound && `Đang có đợt ${openRound.sequenceNo} ${openRound.status === 'draft' ? 'nháp' : 'chờ ghi nhận'} — xử lý xong rồi lập đợt mới`,
  ].filter(Boolean) as string[];
  const advanceBlockers = [!c.partnerId && 'HĐ chưa gắn đối tác', !c.projectId && 'HĐ chưa gắn dự án', !['signed', 'active'].includes(c.status) && 'HĐ không còn thi công'].filter(Boolean) as string[];
  const opening = d.openings.find(o => o.status === 'submitted' || o.status === 'confirmed') || null;
  const docs = d.documents.filter(x => x.outstanding > 0.5 || x.pendingExternal > 0);

  const actRound = async (r: SubcontractRound, action: 'submit' | 'withdraw' | 'return' | 'cancel' | 'recognize' | 'reverse') => {
    const base = { id: r.id, expectedRowVersion: r.rowVersion, action };
    const label = `${c.code} · đợt ${r.sequenceNo}`;
    if (action === 'submit') {
      if (await confirm({ title: 'Gửi ghi nhận đợt này?', targetName: label, confirmText: 'Gửi ghi nhận', subtitle: `Phải trả ${money(r.payable)} đ`, warningText: 'Người có quyền Xác nhận (khác bạn) kiểm và ghi nhận. Sau khi gửi không sửa được — muốn sửa thì rút về nháp.', actionLabel: 'Gửi', intent: 'success', countdownSeconds: 0 }))
        void exec(() => financeService.transitionSubcontractRound(base), `Đã gửi đợt ${r.sequenceNo} — chờ ghi nhận.`, 'Chưa gửi được đợt');
    } else if (action === 'withdraw') {
      if (await confirm({ title: 'Rút đợt về nháp?', targetName: label, confirmText: 'Rút về nháp', warningText: 'Đợt quay về nháp để sửa; người ghi nhận không còn thấy đợt này trong việc chờ.', actionLabel: 'Rút về nháp', intent: 'warning', countdownSeconds: 0 }))
        void exec(() => financeService.transitionSubcontractRound(base), 'Đã rút về nháp.', 'Chưa rút được');
    } else if (action === 'recognize') {
      if (await confirm({ title: 'Ghi nhận đợt nghiệm thu?', targetName: label, confirmText: 'Ghi nhận',
        subtitle: `Chi phí nhân công ${money(r.gross)} đ · phải trả ${money(r.payable)} đ (hạn +${m.paymentTermDays} ngày)${r.retention > 0 ? ` · giữ lại ${money(r.retention)} đ` : ''}`,
        warningText: 'Ghi chi phí dự án (CPNC), sinh công nợ phải trả và khoản giữ lại; thu hồi tạm ứng nếu có. Đã kiểm biên bản nghiệm thu và số lũy kế.', actionLabel: 'Ghi nhận', intent: 'success', countdownSeconds: 0 }))
        void exec(() => financeService.transitionSubcontractRound(base), `Đã ghi nhận đợt ${r.sequenceNo} — công nợ ở Phải trả, lập Đề nghị chi để trả.`, 'Chưa ghi nhận được');
    } else {
      const cfg = {
        return: { title: 'Trả lại đợt cho người lập', subtitle: 'Người lập sửa rồi gửi lại.', actionLabel: 'Trả lại', intent: 'warning' as const, ok: 'Đã trả lại — người lập được báo.', fail: 'Chưa trả lại được' },
        cancel: { title: 'Hủy đợt', subtitle: 'Đợt chưa ghi nhận — không ảnh hưởng công nợ, chi phí.', actionLabel: 'Hủy đợt', intent: 'warning' as const, ok: 'Đã hủy đợt.', fail: 'Chưa hủy được' },
        reverse: { title: 'Đảo đợt đã ghi nhận', subtitle: 'Hủy công nợ, khoản giữ lại; ghi dòng âm chi phí; trả lại phần tạm ứng đã cấn trừ. Chỉ đảo được khi chưa chi tiền.', actionLabel: 'Đảo đợt', intent: 'danger' as const, ok: 'Đã đảo đợt — có thể lập lại.', fail: 'Chưa đảo được' },
      }[action];
      const reason = await askReason({ title: cfg.title, targetName: label, subtitle: cfg.subtitle, reasonLabel: 'Lý do (bắt buộc)', actionLabel: cfg.actionLabel, intent: cfg.intent, minLength: 3 });
      if (reason) void exec(() => financeService.transitionSubcontractRound({ ...base, reason }), cfg.ok, cfg.fail);
    }
  };
  const actOpening = async (oid: string, action: 'confirm' | 'reject' | 'cancel') => {
    if (action === 'confirm') {
      if (await confirm({ title: 'Chốt đầu kỳ theo MISA?', targetName: c.code, confirmText: 'Chốt đầu kỳ của', warningText: 'Đã đối chiếu với sổ chi tiết MISA. Sinh công nợ đầu kỳ và khoản giữ lại; không ghi chi phí.', actionLabel: 'Chốt', intent: 'success', countdownSeconds: 0 }))
        void exec(() => financeService.decideSubcontractOpening({ id: oid, action }), 'Đã chốt đầu kỳ — lập được đợt nghiệm thu.', 'Chưa chốt được đầu kỳ');
    } else {
      const reason = await askReason({ title: action === 'reject' ? 'Trả lại đầu kỳ' : 'Hủy đầu kỳ đã chốt', targetName: c.code,
        subtitle: action === 'cancel' ? 'Chỉ hủy được khi chưa có đợt nghiệm thu và chưa chi tiền đầu kỳ.' : undefined, reasonLabel: 'Lý do (bắt buộc)', actionLabel: action === 'reject' ? 'Trả lại' : 'Hủy', intent: action === 'cancel' ? 'danger' : 'warning', minLength: 3 });
      if (reason) void exec(() => financeService.decideSubcontractOpening({ id: oid, action, reason }), action === 'reject' ? 'Đã trả lại đầu kỳ.' : 'Đã hủy đầu kỳ.', 'Chưa thực hiện được');
    }
  };

  return <div className="space-y-3">
    <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm font-semibold text-teal-700 md:hidden"><ArrowLeft size={15} />Danh sách thầu phụ</button>
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700 dark:bg-teal-950/40"><Building2 size={20} /></span>
        <div className="min-w-0 flex-1"><h2 className={`text-lg ${ENT}`}>{c.partner?.name || c.subcontractorName}</h2>
          <p className="text-sm text-muted-foreground">{c.code} · {c.projectCode || 'chưa gắn dự án'}{c.scopeOfWork ? ` · ${c.scopeOfWork}` : ''}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Giá trị {(c.value || 0) > 0 ? `${money(c.value)} đ trước VAT` : 'khoán theo khối lượng thực tế'} · ký {viDate(c.signedDate)} · hoàn thành {viDate(c.completionDate)}
            {c.partner ? ` · TK ${c.partner.bankAccount || 'chưa có'}` : ''}</p></div>
        <div className="flex flex-wrap gap-2">
          {can.manage && <button type="button" className={secondaryBtn} onClick={() => setDrawer({ kind: 'terms' })}><Settings2 size={15} />Điều khoản</button>}
          {can.record && m.opening === 'todo' && <button type="button" className={secondaryBtn} disabled={!c.partnerId} title={!c.partnerId ? 'Gắn đối tác ở Điều khoản trước' : undefined} onClick={() => setDrawer({ kind: 'opening' })}><ClipboardCheck size={15} />Khai đầu kỳ</button>}
          {can.record && <button type="button" className={secondaryBtn} disabled={advanceBlockers.length > 0} title={advanceBlockers.join(' · ') || undefined} onClick={() => setDrawer({ kind: 'advance' })}><HandCoins size={15} />Tạm ứng</button>}
          {can.record && <button type="button" className={primaryBtn} disabled={roundBlockers.length > 0} title={roundBlockers.join(' · ') || undefined} onClick={() => setDrawer({ kind: 'round', round: null })}><Plus size={15} />Lập đợt nghiệm thu</button>}
        </div>
      </div>
      {can.record && roundBlockers.length > 0 && <div className={`mt-3 rounded-xl border px-3 py-2 text-sm ${WARN}`}><b className="flex items-center gap-1"><AlertTriangle size={14} />Chưa lập đợt được:</b>
        <ul className="mt-0.5 list-disc pl-5 text-xs">{roundBlockers.map(b => <li key={b}>{b}</li>)}</ul></div>}
      {m.issues.length > 0 && <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
        <b>Dữ liệu cần xem:</b> {m.issues.map(i => ISSUE_TEXT[i]).join(' · ')}</div>}
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
        {[['VAT', `${m.vatPercent}%`, m.vatSource === 'contract' ? '' : 'chưa khai'], ['Giữ lại bảo hành', `${m.retentionPercent}%${m.warrantyMonths ? ` · ${m.warrantyMonths} th` : ''}`, m.retentionDueDate ? `đến ${viDate(m.retentionDueDate)}` : 'chưa có hạn'],
          ['Thu hồi tạm ứng', `${Number(m.recoveryPercent).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}%`, m.recoveryPercentSource === 'contract' ? 'theo HĐ' : 'tự tính'],
          ['Thuế TNCN', m.withholdPit ? `${m.pitPercent}%` : 'Không', m.withholdPit ? 'tổ đội cá nhân' : ''], ['Hạn trả', `${m.paymentTermDays} ngày`, m.paymentTermSource === 'contract' ? 'theo HĐ' : 'mặc định'],
          ['Đầu kỳ', OPENING_BADGE[m.opening].label, opening ? viDate(opening.cutoverDate) : '']].map(([k, v, h]) =>
          <div key={k} className="rounded-xl bg-muted/50 px-3 py-2"><dt className="text-[11px] text-muted-foreground">{k}</dt><dd className="font-semibold">{v}{h && <span className="ml-1 text-[11px] font-normal text-muted-foreground">({h})</span>}</dd></div>)}
      </dl>
    </section>

    <section className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
      <Kpi onClick={() => scrollTo('sub-rounds')} title="Xem các đợt nghiệm thu" icon={ClipboardCheck} label="Lũy kế nghiệm thu" value={m.hasRounds ? shortMoney(m.cumulativeNet) : <Unknown why="Chưa chốt đầu kỳ" />} hint={m.cumulativePercent != null ? `${m.cumulativePercent}% giá trị HĐ (trước VAT)` : 'trước VAT'}
        tone={m.cumulativePercent != null && m.cumulativePercent > 100 ? 'text-amber-700 dark:text-amber-300' : undefined} />
      <Kpi onClick={() => scrollTo('sub-docs')} title="Xem công nợ đang mở" icon={Wallet} label="Còn phải trả" value={m.opening === 'confirmed' ? shortMoney(m.outstanding) : <Unknown why="Chưa chốt đầu kỳ" />} hint={m.overdue > 0 ? `${shortMoney(m.overdue)} quá hạn` : 'đã ghi nhận, chưa chi'} tone={m.overdue > 0 ? 'text-rose-700 dark:text-rose-300' : undefined} />
      <Kpi onClick={() => scrollTo('sub-docs')} title="Xem khoản giữ lại" icon={ShieldCheck} label="Giữ lại bảo hành" value={m.opening === 'confirmed' ? shortMoney(m.retentionHeld) : <Unknown why="Chưa chốt đầu kỳ" />} hint={m.retentionDue ? `hạn ${viDate(m.retentionDue)}` : m.retentionHeld > 0 ? 'chưa có hạn' : '—'} tone="text-foreground" />
      <Kpi onClick={() => scrollTo(d.advances.length ? 'sub-advances' : 'sub-rounds')} title="Xem tạm ứng" icon={HandCoins} label="Tạm ứng còn thu hồi" value={m.opening === 'confirmed' ? shortMoney(m.advanceRemaining) : shortMoney(m.advanceRemainingVioo)} hint={m.opening === 'confirmed' ? `trước mốc ${shortMoney(m.advanceRemainingOpening)} · qua Vioo ${shortMoney(m.advanceRemainingVioo)}` : 'chỉ phần chi qua Vioo — chưa có đầu kỳ'} tone="text-teal-700 dark:text-teal-300" />
      <Kpi onClick={() => scrollTo('sub-rounds')} title="Xem các đợt (cột TNCN)" icon={Receipt} label="TNCN đã khấu trừ" value={shortMoney(m.pitWithheld)} hint="công ty nộp thay" tone="text-foreground" />
      <Kpi onClick={c.projectId ? () => { window.location.hash = projectFinanceHref(c.projectId!, 'ledger', { item: 'CPNC' }).slice(1); } : undefined} title="Mở Sổ giao dịch — chi phí nhân công của dự án" icon={Coins} label="Chi phí nhân công đã ghi" value={shortMoney(m.cost)} hint={d.budget?.budget != null ? `dự án: ${shortMoney(d.budget.projected)} / ngân sách ${shortMoney(d.budget.budget)}` : 'từ các đợt ghi nhận · dự án chưa lập ngân sách CPNC'} />
    </section>

    {opening?.status === 'submitted' && <section className={`flex flex-wrap items-center gap-2 rounded-2xl border px-4 py-3 text-sm ${WARN}`}>
      <span className="min-w-[14rem] flex-1"><b>Đầu kỳ chờ chốt</b> — {opening.createdByName} gửi {viDate(opening.createdAt)}: lũy kế {shortMoney(opening.cumulativeNet)}, còn nợ {shortMoney(opening.outstanding)},
        giữ lại {shortMoney(opening.retentionHeld)}, tạm ứng {shortMoney(opening.advanceRemaining)}. {opening.attachments.length} file.</span>
      {opening.canDecide ? <><button type="button" disabled={busy} className={secondaryBtn} onClick={() => void actOpening(opening.id, 'reject')}><Undo2 size={14} />Trả lại</button>
        <button type="button" disabled={busy} className={primaryBtn} onClick={() => void actOpening(opening.id, 'confirm')}><Check size={14} />Chốt đầu kỳ</button></>
        : <span className="text-xs">{opening.createdBy === d.currentUserId ? 'Chờ người khác có quyền Xác nhận chốt.' : 'Cần quyền Tài chính — Xác nhận để chốt.'}</span>}
    </section>}

    <section id="sub-rounds" className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5"><h3 className="mr-auto font-semibold">Các đợt nghiệm thu thanh toán</h3>
        <span className="text-xs text-muted-foreground">lũy kế · kỳ này · khấu trừ · phải trả</span></div>
      {d.rounds.length === 0 ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">Chưa có đợt nào. {m.opening !== 'confirmed' ? 'Chốt đầu kỳ 30/09 trước, rồi lập đợt đầu tiên theo biên bản nghiệm thu.' : 'Bấm "Lập đợt nghiệm thu" khi có biên bản.'}</p>
        : <ul className="divide-y divide-border text-sm">{[...d.rounds].reverse().map(r => <RoundRow key={r.id} r={r} busy={busy} onEdit={() => setDrawer({ kind: 'round', round: r })} onAct={a => void actRound(r, a)} currentUserId={d.currentUserId} />)}</ul>}
    </section>

    {(docs.length > 0 || d.advances.length > 0) && <section className="grid gap-3 lg:grid-cols-2">
      {docs.length > 0 && <article id="sub-docs" className="rounded-2xl border border-border bg-card p-4 shadow-sm"><h3 className="font-semibold">Công nợ đang mở</h3>
        <ul className="mt-2 divide-y divide-border text-sm">{docs.map(x => { const tone = toneOf(x.dueDate, x.outstanding, d.today);
          return <li key={x.id} className="flex flex-wrap items-center gap-2 py-2"><span className="min-w-0 flex-1"><b className={ENT}>{x.documentNo}</b>
            <span className="block text-xs text-muted-foreground">{SOURCE_LABELS[x.sourceType] || x.sourceType} · <span className={TONE_TEXT[tone]}>{x.sourceType === 'subcontract_retention' && !x.dueDate ? 'chưa có hạn (chưa trả được)' : dueText(x.dueDate, x.outstanding, d.today)}</span>
              {x.pendingExternal > 0 ? ` · đang chờ xác nhận chi ${shortMoney(x.pendingExternal)}` : ''}</span></span>
            <span className={NUM}>{shortMoney(x.outstanding)}</span></li>; })}</ul>
        <p className="mt-1 text-xs text-muted-foreground">Trả bằng Đề nghị chi ở Phải trả → Đang nợ (chọn đối tác này). Giữ lại chưa đến hạn không chọn được.</p></article>}
      {d.advances.length > 0 && <article id="sub-advances" className="rounded-2xl border border-border bg-card p-4 shadow-sm"><h3 className="font-semibold">Tạm ứng qua Vioo</h3>
        <ul className="mt-2 divide-y divide-border text-sm">{d.advances.map(a => <li key={a.id} className="flex flex-wrap items-center gap-2 py-2"><span className="min-w-0 flex-1"><b className={ENT}>{a.code}</b>
          <span className="block text-xs text-muted-foreground">{a.status === 'paid' ? `chi ${viDate(a.paidDate)} · đã thu hồi ${shortMoney(a.offset)}${a.refunded ? ` · hoàn ${shortMoney(a.refunded)}` : ''}` : 'đang duyệt / chờ chi'} · hạn hoàn {viDate(a.repayDueDate)}</span></span>
          <span className={NUM}>{a.status === 'paid' ? `còn ${shortMoney(a.remaining)}` : shortMoney(a.amount)}</span></li>)}</ul></article>}
    </section>}

    {d.openings.filter(o => o.status === 'confirmed').map(o => <p key={o.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
      <FileText size={13} />Đầu kỳ {viDate(o.cutoverDate)} đã chốt bởi {o.decidedByName}: lũy kế {shortMoney(o.cumulativeNet)} · đã trả {shortMoney(o.paidTotal)} · còn nợ {shortMoney(o.outstanding)} · giữ lại {shortMoney(o.retentionHeld)} · tạm ứng {shortMoney(o.advanceRemaining)}
      {o.canCancel && !d.rounds.some(r => r.kind === 'progress' && r.status !== 'cancelled') && <button type="button" className="ml-auto font-semibold text-rose-700 hover:underline" onClick={() => void actOpening(o.id, 'cancel')}><RotateCcw size={12} className="mr-0.5 inline" />Hủy đầu kỳ</button>}</p>)}

    <section className="rounded-2xl border border-border bg-card shadow-sm">
      <button type="button" onClick={() => setShowHistory(v => !v)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left font-semibold"><History size={15} className="text-teal-700" />Lịch sử ({d.events.length})<span className="ml-auto text-xs text-muted-foreground">{showHistory ? 'Ẩn' : 'Xem'}</span></button>
      {showHistory && <ul className="divide-y divide-border border-t border-border text-sm">{d.events.length === 0 ? <li className="px-4 py-3 text-muted-foreground">Chưa có thao tác nào.</li>
        : d.events.map((e, i) => <li key={i} className="px-4 py-2"><b>{EVENT_LABELS[e.action] || e.action}</b> <span className="text-xs text-muted-foreground">· {e.actorName || '—'} · {new Date(e.at).toLocaleString('vi-VN')}</span>
          {e.reason && <span className="block text-xs">Lý do: {e.reason}</span>}</li>)}</ul>}
    </section>

    {drawer?.kind === 'terms' && <SubcontractTermsDrawer d={d} onClose={() => setDrawer(null)} onSaved={() => done()} />}
    {drawer?.kind === 'opening' && <SubcontractOpeningDrawer d={d} onClose={() => setDrawer(null)} onSaved={() => done()} />}
    {drawer?.kind === 'round' && <SubcontractRoundDrawer d={d} round={drawer.round} onClose={() => setDrawer(null)} onSaved={() => done()} />}
    {drawer?.kind === 'advance' && <SubcontractAdvanceDrawer subcontractId={c.id} title={`${c.partner?.name || c.subcontractorName} · ${c.code}`} today={d.today} hasBank={Boolean(c.partner?.bankAccount)}
      onClose={() => setDrawer(null)} onSaved={() => done()} />}
  </div>;
};

const RoundRow: React.FC<{ r: SubcontractRound; busy: boolean; currentUserId: string; onEdit: () => void;
  onAct: (a: 'submit' | 'withdraw' | 'return' | 'cancel' | 'recognize' | 'reverse') => void }> = ({ r, busy, currentUserId, onEdit, onAct }) => {
  const b = ROUND_BADGE[r.status];
  if (r.kind === 'opening') return <li className={`flex flex-wrap items-center gap-2 px-4 py-3 ${r.status === 'cancelled' ? 'opacity-60' : ''}`}>
    <span className="grid h-7 w-7 place-items-center rounded-full bg-muted text-xs font-bold">0</span>
    <span className="min-w-0 flex-1"><b>Số dư đầu kỳ theo MISA</b><span className="block text-xs text-muted-foreground">Lũy kế nghiệm thu {money(r.cumulativeNet)} đ (trước VAT) — không ghi chi phí</span></span>
    <Badge className={b.cls}>{r.status === 'cancelled' ? 'Đã hủy' : 'Đã chốt'}</Badge></li>;
  const deductions = [r.advanceRecovery > 0 && `thu hồi tạm ứng ${shortMoney(r.advanceRecovery)}`, r.retention > 0 && `giữ lại ${shortMoney(r.retention)}`, r.pit > 0 && `TNCN ${shortMoney(r.pit)}`,
    ...r.deductions.map(x => `${DEDUCTION_LABELS[x.kind].toLowerCase()} ${shortMoney(x.amount)}`)].filter(Boolean).join(' · ');
  return <li className={`px-4 py-3 ${r.status === 'cancelled' ? 'opacity-60' : ''}`}>
    <div className="flex flex-wrap items-center gap-2">
      <span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-bold ${r.status === 'recognized' ? 'bg-teal-700 text-white' : 'bg-muted'}`}>{r.sequenceNo}</span>
      <span className="min-w-0 flex-1"><b>{r.description}</b> <span className="text-xs text-muted-foreground">{viDate(r.periodStart)} – {viDate(r.periodEnd)} · {r.createdByName} lập</span>
        <span className="block text-xs text-muted-foreground">Lũy kế {shortMoney(r.cumulativeNet)} → kỳ này {shortMoney(r.netAmount)}{r.vatAmount > 0 ? ` + VAT ${shortMoney(r.vatAmount)}` : ''}{deductions ? ` · ${deductions}` : ''}</span>
        {r.status === 'recognized' && <span className="block text-xs text-muted-foreground">Ghi nhận {viDate(r.recognizedDate)} bởi {r.recognizedByName} · hạn trả {viDate(r.dueDate)} · đã chi {shortMoney(r.paid)} · còn {shortMoney(r.outstanding)}</span>}
        {r.returnReason && r.status === 'draft' && <span className="block text-xs font-semibold text-amber-700 dark:text-amber-300">Bị trả lại ({r.returnedByName}): {r.returnReason}</span>}
        {r.cancelReason && <span className="block text-xs text-muted-foreground">Lý do hủy / đảo: {r.cancelReason}</span>}
        {(r.adjustReason || r.overContractReason) && <span className="block text-xs text-muted-foreground">Ghi chú điều chỉnh: {[r.overContractReason, r.adjustReason].filter(Boolean).join(' · ')}</span>}</span>
      <span className="text-right"><b className={NUM}>{money(r.payable)} đ</b><span className="block text-[11px] text-muted-foreground">phải trả</span></span>
      <Badge className={b.cls}>{b.label}</Badge>
    </div>
    <div className="mt-2 flex flex-wrap justify-end gap-2">
      {r.canEdit && <button type="button" disabled={busy} className={secondaryBtn} onClick={onEdit}><Pencil size={14} />Sửa</button>}
      {r.canCancel && <button type="button" disabled={busy} className={secondaryBtn} onClick={() => onAct('cancel')}><X size={14} />Hủy đợt</button>}
      {r.canSubmit && <button type="button" disabled={busy || r.attachments.length === 0} title={r.attachments.length === 0 ? 'Đính kèm biên bản trước (bấm Sửa)' : undefined} className={primaryBtn} onClick={() => onAct('submit')}><Send size={14} />Gửi ghi nhận</button>}
      {r.canWithdraw && <button type="button" disabled={busy} className={secondaryBtn} onClick={() => onAct('withdraw')}><Undo2 size={14} />Rút về nháp</button>}
      {r.canDecide && <><button type="button" disabled={busy} className={secondaryBtn} onClick={() => onAct('return')}><Undo2 size={14} />Trả lại</button>
        <button type="button" disabled={busy} className={primaryBtn} onClick={() => onAct('recognize')}><Check size={14} />Ghi nhận</button></>}
      {r.status === 'submitted' && !r.canDecide && r.createdBy !== currentUserId && <span className="text-xs text-muted-foreground">Cần quyền Tài chính — Xác nhận để ghi nhận.</span>}
      {r.status === 'submitted' && r.createdBy === currentUserId && <span className="text-xs text-muted-foreground">Chờ người khác ghi nhận.</span>}
      {r.canReverse && r.paid <= 0.5 && <button type="button" disabled={busy} className="text-sm font-semibold text-rose-700 hover:underline" onClick={() => onAct('reverse')}><RotateCcw size={13} className="mr-0.5 inline" />Đảo đợt</button>}
      {r.attachments.map(a => <button key={a.path} type="button" className="inline-flex items-center gap-1 text-xs text-teal-700 hover:underline" onClick={() => void financeService.openAttachment(a.path)}><FileText size={12} />{a.name}</button>)}
    </div>
  </li>;
};

