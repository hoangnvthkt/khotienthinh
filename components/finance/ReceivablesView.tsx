import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CalendarClock, FileCheck2, HandCoins, Landmark, ShieldCheck, Wallet } from 'lucide-react';
import { financeService, type FinanceReceivables } from '../../lib/financeService';
import { Badge, StateBox } from '../procurement/hub/hubUi';
import { ENT, NUM, shortMoney, viDate } from './financeUi';
import { CustomerContractPanel, LifeBar } from './CustomerContractPanel';

// Tài chính → Phải thu chủ đầu tư: số lớn toàn công ty, việc cần chú ý, từng HĐ; bấm HĐ để lập đợt, ghi thu, đối chiếu đầu kỳ, bảo lãnh.

const Kpi: React.FC<{ icon: React.ElementType; label: string; value: string; hint: string; tone?: string; blink?: boolean; active?: boolean; onClick?: () => void }> = ({ icon: I, label, value, hint, tone = 'text-leaf-700 dark:text-leaf-300', blink, active, onClick }) =>
  <button type="button" onClick={onClick} aria-pressed={active} className={`rounded-2xl border bg-card p-3 text-left shadow-sm transition ${active ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-border hover:border-teal-300'}`}><span className="flex items-start gap-1.5 text-xs font-semibold uppercase leading-tight tracking-wide text-muted-foreground"><I size={14} className="shrink-0 text-teal-700" />{label}</span>
    <span className={`mt-1 block text-xl font-bold tabular-nums ${tone} ${blink ? 'overdue-blink' : ''}`}>{value}</span><span className="block text-xs text-muted-foreground">{hint}</span></button>;
type KFilter = 'all' | 'outstanding' | 'overdue' | 'unbilled' | 'advance' | 'retention';
const K_LABEL: Record<KFilter, string> = { all: '', outstanding: 'Còn phải thu', overdue: 'Quá hạn thu', unbilled: 'Có sản lượng chưa đề nghị', advance: 'Còn tạm ứng CĐT chưa thu hồi', retention: 'CĐT đang giữ lại bảo hành' };

export const ReceivablesView: React.FC<{ initialContractId?: string | null; onChanged: () => void }> = ({ initialContractId, onChanged }) => {
  const [data, setData] = useState<FinanceReceivables | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(initialContractId || null);
  const [mobile, setMobile] = useState(Boolean(initialContractId));
  const [kf, setKf] = useState<KFilter>('all');
  const toggle = (k: KFilter) => setKf(cur => cur === k ? 'all' : k);
  const load = useCallback(() => { setError(null); financeService.receivables().then(d => { setData(d); setSel(cur => cur || d.contracts[0]?.id || null); }).catch(e => setError(e instanceof Error ? e.message : String(e))); }, []);
  useEffect(load, [load]);
  if (error) return <StateBox kind="error" title="Chưa tải được Phải thu" message={error} onRetry={load} />;
  if (!data) return <StateBox kind="loading" title="Đang tải phải thu…" />;
  const t = data.totals;
  const shown = data.contracts.filter(c => { const m = c.metrics; return kf === 'all' || (kf === 'outstanding' && m.outstanding > 0.5) || (kf === 'overdue' && m.overdue > 0.5)
    || (kf === 'unbilled' && (m.unbilled || 0) > 0.5) || (kf === 'advance' && m.advanceRemaining > 0.5) || (kf === 'retention' && m.retentionHeld > 0.5); });
  const alerts: Array<{ tone: 'rose' | 'amber' | 'slate'; title: string; text: string; onClick?: () => void }> = [];
  data.contracts.forEach(c => {
    const m = c.metrics;
    if (m.overdue > 0.5) alerts.push({ tone: 'rose', title: `${c.projectCode || c.code}: ${shortMoney(m.overdue)} quá hạn thu`, text: `CĐT ${c.customerName} đã xác nhận nhưng chưa trả — đôn đốc thu.`, onClick: () => setSel(c.id) });
    if (c.endDate && m.gross - m.received > 0.5 && c.endDate >= data.today && Date.parse(c.endDate) - Date.parse(data.today) < 45 * 86400000)
      alerts.push({ tone: 'amber', title: `${c.projectCode || c.code}: HĐ kết thúc ${viDate(c.endDate)}, còn ${shortMoney(m.gross - m.received)} chưa thu`, text: m.unbilled ? `Sản lượng ước tính chưa đề nghị thanh toán ${shortMoney(m.unbilled)} — nên lập đợt.` : 'Lập đợt đề nghị thanh toán / quyết toán.', onClick: () => setSel(c.id) });
    else if (m.unbilled && m.unbilled > Math.max(1e9, m.gross * 0.1)) alerts.push({ tone: 'amber', title: `${c.projectCode || c.code}: ${shortMoney(m.unbilled)} sản lượng chưa đề nghị thanh toán`, text: `Ước tính theo tiến độ Gantt ${m.progress}% — kiểm tra khối lượng để lập đợt.`, onClick: () => setSel(c.id) });
  });
  if (t.sentStale > 0) alerts.push({ tone: 'amber', title: `${t.sentStale} đợt gửi CĐT quá 15 ngày chưa xác nhận`, text: 'Liên hệ CĐT để chốt số, tránh kéo dài hạn thu.' });
  if (t.openingsTodo > 0) alerts.push({ tone: 'amber', title: `${t.openingsTodo} HĐ chưa đối chiếu đầu kỳ với MISA`, text: 'Đợt thu cũ chưa tách thu hồi tạm ứng / giữ lại — số tạm ứng còn thu hồi đang tạm tính.' });
  if (t.guaranteesExpiring > 0) alerts.push({ tone: 'rose', title: `${t.guaranteesExpiring} bảo lãnh hết hạn trong 30 ngày`, text: 'Gia hạn hoặc giải tỏa kịp thời.' });
  if (t.guaranteesMissing > 0) alerts.push({ tone: 'slate', title: `${t.guaranteesMissing} bảo lãnh chưa khai số tiền, hạn`, text: 'Khai để được nhắc trước khi hết hạn.' });
  if (data.reviewRevenues.length) alerts.push({ tone: 'slate', title: `${data.reviewRevenues.length} khoản thu ghi tay cần soát xét`,
    text: data.reviewRevenues.slice(0, 2).map(r => `${r.projectCode} ${viDate(r.date)} ${shortMoney(r.amount)}: ${r.description || ''}`).join(' · ') + ' — kiểm tra có phải tiền CĐT trả không.' });
  const CLS = { rose: 'border-rose-200 bg-rose-50/70 dark:border-rose-900 dark:bg-rose-950/30', amber: 'border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/30', slate: 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900' };

  return <div className="space-y-3">
    <section className={`grid grid-cols-2 gap-2 lg:grid-cols-5 ${mobile ? 'hidden md:grid' : ''}`}>
      <Kpi active={kf === 'outstanding'} onClick={() => toggle('outstanding')} icon={Wallet} label="Phải thu" value={shortMoney(t.outstanding)} hint="CĐT đã xác nhận, chưa trả" />
      <Kpi active={kf === 'overdue'} onClick={() => toggle('overdue')} icon={AlertTriangle} label="Quá hạn thu" value={shortMoney(t.overdue)} hint={t.overdueCount ? `${t.overdueCount} đợt` : 'không có'} tone={t.overdue > 0 ? 'text-rose-700 dark:text-rose-300' : 'text-muted-foreground'} blink={t.overdue > 0} />
      <Kpi active={kf === 'unbilled'} onClick={() => toggle('unbilled')} icon={FileCheck2} label="Sản lượng chưa đề nghị" value={t.unbilled == null ? 'Chưa có dữ liệu' : shortMoney(t.unbilled)} hint="ước tính theo tiến độ Gantt" tone="text-amber-700 dark:text-amber-300" />
      <Kpi active={kf === 'advance'} onClick={() => toggle('advance')} icon={HandCoins} label="Tạm ứng CĐT chưa thu hồi" value={shortMoney(t.advanceRemaining)} hint={t.openingsTodo ? 'tạm tính — chưa đối chiếu đầu kỳ' : 'trừ dần qua các đợt'} tone="text-teal-700 dark:text-teal-300" />
      <Kpi active={kf === 'retention'} onClick={() => toggle('retention')} icon={ShieldCheck} label="Giữ lại bảo hành" value={shortMoney(t.retentionHeld)} hint={t.prepayment ? `CĐT trả trước chưa trừ ${shortMoney(t.prepayment)}` : 'CĐT đang giữ'} tone="text-foreground" />
    </section>
    {alerts.length > 0 && <section className={`rounded-2xl border border-border bg-card p-4 shadow-sm ${mobile ? 'hidden md:block' : ''}`}>
      <h3 className="flex items-center gap-1.5 font-bold"><CalendarClock size={16} className="text-amber-600" />Cần chú ý</h3>
      <ul className="mt-2 grid gap-2 text-sm md:grid-cols-2">{alerts.map((a, i) => <li key={i}>{a.onClick
        ? <button type="button" onClick={() => { a.onClick!(); setMobile(true); }} className={`w-full rounded-xl border p-3 text-left hover:shadow ${CLS[a.tone]}`}><b className="block">{a.title}</b><span className="text-xs text-muted-foreground">{a.text}</span></button>
        : <div className={`rounded-xl border p-3 ${CLS[a.tone]}`}><b className="block">{a.title}</b><span className="text-xs text-muted-foreground">{a.text}</span></div>}</li>)}</ul>
    </section>}
    {data.contracts.length === 0 ? <StateBox kind="empty" title="Chưa có hợp đồng chủ đầu tư" message="Khai hợp đồng với chủ đầu tư ở Dự án → Hợp đồng; đợt thu và phiếu thu làm ở đây." />
      : <div className="grid gap-4 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <ul className={`h-fit overflow-hidden rounded-2xl border border-border bg-card shadow-sm ${mobile ? 'hidden md:block' : ''}`}>
          {kf !== 'all' && <li className="flex items-center gap-2 border-b border-border bg-teal-50/60 px-3 py-2 text-xs"><span className="flex-1">Đang lọc: <b>{K_LABEL[kf]}</b> · {shown.length}/{data.contracts.length} HĐ</span>
            <button type="button" onClick={() => setKf('all')} className="font-semibold text-teal-700 hover:underline">Bỏ lọc</button></li>}
          {shown.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">Không có HĐ nào khớp.</li>}
          {shown.map(c => { const m = c.metrics;
            return <li key={c.id}><button type="button" onClick={() => { setSel(c.id); setMobile(true); window.scrollTo({ top: 0 }); }}
              className={`block w-full border-b border-l-4 border-border px-3 py-3 text-left ${m.overdue > 0.5 ? 'border-l-rose-500' : m.outstanding > 0.5 ? 'border-l-amber-400' : 'border-l-leaf-500'} ${sel === c.id ? 'bg-teal-50/70 dark:bg-teal-950/20' : 'hover:bg-muted/40'}`}>
              <span className="flex items-start gap-2"><span className="min-w-0 flex-1"><b className={ENT}>{c.projectCode || c.code}</b>
                <span className="block truncate text-sm">{c.customerName}</span>
                <span className="mt-0.5 flex flex-wrap gap-1">{m.opening === 'todo' && <Badge className="border-slate-200 bg-slate-100 text-slate-600">Chưa đối chiếu đầu kỳ</Badge>}
                  {m.opening === 'submitted' && <Badge className="border-amber-300 bg-amber-50 text-amber-800">Đầu kỳ chờ chốt</Badge>}
                  {c.draftRounds > 0 && <Badge className="border-teal-200 bg-teal-50 text-teal-800">{c.draftRounds} đợt đang làm</Badge>}</span></span>
                <span className="text-right"><span className="block text-[11px] text-muted-foreground">còn theo HĐ</span><b className={`text-sm ${NUM}`}>{shortMoney(Math.max(0, m.gross - m.received))}</b>
                  {m.overdue > 0.5 && <span className="block text-xs font-semibold text-rose-700">{shortMoney(m.overdue)} quá hạn</span>}</span></span>
              <span className="mt-2 block"><LifeBar m={m} /></span>
            </button></li>; })}
        </ul>
        <section className={`min-w-0 ${mobile ? '' : 'hidden md:block'}`}>
          {sel ? <CustomerContractPanel key={sel} contractId={sel} onBack={() => setMobile(false)} onChanged={() => { load(); onChanged(); }} />
            : <StateBox kind="empty" title="Chọn một hợp đồng" message="Chọn HĐ ở danh sách để xem đợt thu và phiếu thu." />}
        </section>
      </div>}
    <p className={`flex items-center gap-1.5 text-xs text-muted-foreground ${mobile ? 'hidden md:flex' : ''}`}><Landmark size={13} />Đợt thu và phiếu thu của HĐ chủ đầu tư chỉ lập ở đây; Dự án → Hợp đồng chỉ xem.</p>
  </div>;
};
