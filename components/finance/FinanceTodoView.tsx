import React from 'react';
import { Wallet, AlertTriangle, ArrowLeftRight, Banknote, Building2, Calculator, CalendarClock, CheckCircle2, ChevronRight, ClipboardList, FileCheck2, FileWarning, HandCoins, HardHat, PiggyBank, RotateCcw, Scale, ShieldCheck } from 'lucide-react';
import type { FinanceAdvances, FinanceAllocation, FinanceCost, FinanceReceivables, FinanceSiteFunds, FinanceSubcontracts } from '../../lib/financeService';
import { shortMoney } from './financeUi';

// Việc cần làm của kế toán: mỗi ô là một hàng đợi, bấm để mở đúng chỗ xử lý ở Phải trả.

export type TodoTarget = 'opening' | 'overdue' | 'soon' | 'issues' | 'direct' | 'statements' | 'request' | 'approved' | 'transfers'
  | 'advance_overdue' | 'advance_refund' | 'advance_adjust' | 'receivable_overdue' | 'receivable_sent' | 'receivable_receipts' | 'receivable_opening' | 'receivable_guarantee' | 'cash_setup' | 'cash_confirm' | 'cash_forecast'
  | 'cost_decide' | 'cost_over' | 'cost_fund_setup' | 'cost_fund_negative' | 'cost_stale' | 'cost_allocation' | 'cash_site' | 'sub_rounds' | 'sub_opening' | 'sub_review' | 'sub_retention';

export const FinanceTodoView: React.FC<{
  totals: { overdue: number; overdueCount: number; soon: number; soonCount: number; issues: number; openingPendingSuppliers: number; supplierCount: number };
  direct: { count: number; amount: number; missing: number } | null;
  pendingStatements: { count: number; amount: number };
  requests: { request: number; approved: number; approvedAmount: number; waitingMe: number } | null;
  transferCount: number;
  advances?: FinanceAdvances['totals'] | null;
  receivables?: FinanceReceivables['totals'] | null;
  cash?: { waitingMe: number; openings: number; reconciliations: number; movements: number; accountsWithoutOpening: number; accounts: number; belowMinWeek: string | null; lowest: number | null; minBalance: number } | null;
  cost?: FinanceCost | null; allocation?: FinanceAllocation | null; site?: FinanceSiteFunds | null;
  subcontracts?: (FinanceSubcontracts['totals'] & { reviews: number; reviewAmount: number }) | null;
  canRecord: boolean; canConfirm: boolean;
  onGo: (target: TodoTarget) => void;
}> = ({ totals, direct, pendingStatements, requests, transferCount, advances, receivables: rc, cash, cost, allocation: al, site, subcontracts: sc, canRecord, canConfirm, onGo }) => {
  const allocDue = al ? (al.run?.status === 'submitted' && al.run.canDecide ? 'confirm' : al.can.record && al.lastClosableMonth >= al.firstMonth && (!al.run || al.run.status === 'draft') ? 'record' : null) : null;
  const sitePending = site ? site.funds.reduce((s, f) => s + f.expenses.filter(x => x.status === 'submitted' && x.canDecide).length, 0) : null;
  const cp = cost?.projects || [];
  const decide = cost ? cost.poBudget.filter(o => o.canDecide).length + cp.filter(p => p.pendingBudget?.canDecide || p.openingCanDecide).length : null;
  const over = cp.filter(p => p.overItems > 0 || p.warnItems > 0);
  const negative = cp.filter(p => p.balance != null && p.balance < -0.5);
  const noOpening = cp.filter(p => p.openingStatus === 'none');
  const items: Array<{ key: TodoTarget; title: string; count: number | null; value: string; hint: string; icon: React.ElementType; urgent?: boolean; who?: string }> = [
    { key: 'opening', title: 'Đối chiếu đầu kỳ NCC', count: totals.openingPendingSuppliers, value: `${totals.openingPendingSuppliers}/${totals.supplierCount} NCC`,
      hint: 'Chốt theo sổ MISA 30/09 — làm trước để cảnh báo quá hạn đúng', icon: FileWarning, urgent: true },
    { key: 'direct', title: 'Phiếu nhập trực tiếp chờ ghi nợ', count: direct?.count ?? null, value: direct ? `${direct.count} phiếu` : '…',
      hint: direct ? `${shortMoney(direct.amount)}${direct.missing ? ` · ${direct.missing} phiếu thiếu giá` : ''} — chi phí dự án đang ghi thiếu` : 'đang đếm…', icon: Building2, urgent: true, who: canRecord ? undefined : 'Cần quyền Tài chính — Ghi nhận' },
    { key: 'statements', title: 'Bảng đối soát HĐ chờ ghi nợ', count: pendingStatements.count, value: `${pendingStatements.count} bảng`, hint: pendingStatements.count ? shortMoney(pendingStatements.amount) : 'Mua hàng chốt xong sẽ hiện ở đây', icon: Scale },
    { key: 'overdue', title: 'Nợ NCC quá hạn', count: totals.overdueCount, value: `${totals.overdueCount} chứng từ`, hint: `${shortMoney(totals.overdue)} · lập đề nghị chi`, icon: AlertTriangle, urgent: true },
    { key: 'soon', title: 'Đến hạn trong 7 ngày', count: totals.soonCount, value: `${totals.soonCount} chứng từ`, hint: shortMoney(totals.soon), icon: CalendarClock },
    { key: 'request', title: 'Đề nghị chi đang duyệt', count: requests?.request ?? null, value: requests ? `${requests.request} đề nghị` : '…',
      hint: requests?.waitingMe ? `${requests.waitingMe} chờ bạn duyệt` : 'theo ma trận duyệt chi', icon: FileCheck2, urgent: Boolean(requests?.waitingMe) },
    { key: 'approved', title: 'Đã duyệt, chờ xác nhận đã chi', count: requests?.approved ?? null, value: requests ? `${requests.approved} đề nghị` : '…',
      hint: requests ? `${shortMoney(requests.approvedAmount)} · cần UNC + file` : '', icon: Banknote, who: canConfirm ? undefined : 'Cần quyền Tài chính — Xác nhận' },
    { key: 'cash_setup', title: 'Khai tài khoản tiền & số dư đầu kỳ', count: cash ? (cash.accounts === 0 ? 1 : cash.accountsWithoutOpening) : null,
      value: cash ? (cash.accounts === 0 ? 'Chưa khai' : `${cash.accountsWithoutOpening} tài khoản`) : '…', hint: 'theo MISA 30/09 — cần để biết số tiền thật và dự báo', icon: Wallet, urgent: true },
    { key: 'cash_confirm', title: 'Thu chi chờ xác nhận', count: cash ? cash.openings + cash.reconciliations + cash.movements : null,
      value: cash ? `${cash.openings + cash.reconciliations + cash.movements} phiếu` : '…', hint: cash?.waitingMe ? `${cash.waitingMe} chờ bạn` : 'đầu kỳ, đối chiếu sao kê, thu khác, chuyển tiền', icon: Banknote },
    { key: 'cash_forecast', title: 'Dự báo thiếu tiền', count: cash ? (cash.belowMinWeek ? 1 : 0) : null, value: cash?.belowMinWeek ? `Tuần ${cash.belowMinWeek.slice(8, 10)}/${cash.belowMinWeek.slice(5, 7)}` : 'Không',
      hint: cash?.belowMinWeek ? `xuống dưới tồn quỹ tối thiểu ${shortMoney(cash.minBalance)}` : '', icon: AlertTriangle, urgent: true },
    { key: 'cost_decide', title: 'Ngân sách / vượt ngân sách chờ bạn', count: decide, value: decide == null ? '…' : `${decide} việc`,
      hint: cost ? `${cost.poBudget.length} đơn mua vượt dự toán · ${cp.filter(p => p.pendingBudget).length} ngân sách · ${cp.filter(p => p.openingCanDecide).length} đầu kỳ quỹ` : '', icon: Calculator, urgent: true },
    { key: 'cost_allocation', title: 'Phân bổ tháng', count: al ? (allocDue ? 1 : 0) : null, value: al ? (allocDue === 'confirm' ? 'Chờ bạn chốt' : allocDue === 'record' ? (al.run ? 'Đang lập' : 'Chưa lập') : 'Không') : '…',
      hint: al ? `Tháng ${al.month.slice(5, 7)}/${al.month.slice(0, 4)} · lương công trường + chi phí chung → chi phí dự án${al.readiness.timesheet?.status !== 'closed' ? ' · chờ HR chốt công' : ''}` : '', icon: ClipboardList, urgent: allocDue === 'confirm' },
    { key: 'cash_site', title: 'Khoản chi quỹ công trường chờ duyệt', count: sitePending, value: sitePending == null ? '…' : `${sitePending} khoản`,
      hint: site ? `${site.funds.length} quỹ công trường · CHT gửi kèm ảnh hóa đơn` : '', icon: Wallet, who: canRecord ? undefined : 'Cần quyền Tài chính — Ghi nhận' },
    { key: 'cost_over', title: 'Dự án vượt / sắp vượt ngân sách', count: cost ? over.length : null, value: cost ? `${over.length} dự án` : '…',
      hint: over.map(p => `${p.code}: ${p.overItems ? `vượt ${p.overItems}` : ''}${p.overItems && p.warnItems ? ', ' : ''}${p.warnItems ? `≥ ${cost?.warnPercent}% ${p.warnItems}` : ''} khoản mục`).join(' · '), icon: Scale, urgent: over.some(p => p.overItems > 0) },
    { key: 'cost_fund_setup', title: 'Khai đầu kỳ quỹ dự án', count: cost ? noOpening.length : null, value: cost ? `${noOpening.length} dự án` : '…',
      hint: 'tiền CĐT đã trả − tiền đã chi đến 30/09 theo MISA', icon: PiggyBank, who: canRecord ? undefined : 'Cần quyền Tài chính — Ghi nhận' },
    { key: 'cost_fund_negative', title: 'Quỹ dự án âm', count: cost ? negative.length : null, value: cost ? `${negative.length} dự án` : '…',
      hint: cost ? `${negative.map(p => p.code).join(', ')} — ${cost.capitalProviders.join(', ') || 'người cấp vốn'} ghi cấp vốn` : '', icon: HandCoins, urgent: true },
    { key: 'cost_stale', title: 'Đơn mua quá hẹn giao > 30 ngày', count: cost ? cost.stale.count : null, value: cost ? `${cost.stale.count} đơn` : '…',
      hint: cost ? `${shortMoney(cost.stale.amount)} chưa nhận — nhắc Mua hàng kết thúc đơn NCC không giao` : '', icon: ClipboardList },
    { key: 'sub_rounds', title: 'Đợt nghiệm thu thầu phụ chờ ghi nhận', count: sc ? sc.roundsSubmitted : null, value: sc ? `${sc.roundsSubmitted} đợt` : '…',
      hint: sc ? (sc.roundsWaitingMe ? `${sc.roundsWaitingMe} chờ bạn ghi nhận` : 'người khác người lập ghi nhận') + (sc.roundsDraft ? ` · ${sc.roundsDraft} đợt nháp` : '') : '', icon: HardHat,
      urgent: Boolean(sc?.roundsWaitingMe), who: canConfirm ? undefined : 'Cần quyền Tài chính — Xác nhận' },
    { key: 'sub_opening', title: 'Đầu kỳ thầu phụ theo MISA', count: sc ? sc.openingsTodo + sc.openingsPending : null, value: sc ? `${sc.openingsTodo + sc.openingsPending} HĐ` : '…',
      hint: sc ? `${sc.openingsTodo} chưa khai · ${sc.openingsPending} chờ chốt — chưa chốt thì chưa lập đợt được` : '', icon: FileWarning, urgent: true },
    { key: 'sub_review', title: 'Chi phí nhân công ghi tay cần soát xét', count: sc ? sc.reviews : null, value: sc ? `${sc.reviews} khoản` : '…',
      hint: sc ? `${shortMoney(sc.reviewAmount)} — có thể trùng số MISA đã nhập` : '', icon: AlertTriangle, urgent: true },
    { key: 'sub_retention', title: 'Giữ lại bảo hành thầu phụ đến hạn', count: sc ? sc.retentionDue : null, value: sc ? `${sc.retentionDue} khoản` : '…', hint: 'trong 30 ngày tới — kiểm bảo hành rồi lập đề nghị chi', icon: ShieldCheck },
    { key: 'receivable_overdue', title: 'Phải thu CĐT quá hạn', count: rc ? rc.overdueCount : null, value: rc ? `${rc.overdueCount} đợt` : '…',
      hint: rc ? `${shortMoney(rc.overdue)} · CĐT đã xác nhận chưa trả — đôn đốc thu` : '', icon: AlertTriangle, urgent: true },
    { key: 'receivable_receipts', title: 'Phiếu thu CĐT chờ xác nhận', count: rc ? rc.receiptsPending : null, value: rc ? `${rc.receiptsPending} phiếu` : '…',
      hint: rc?.receiptsPendingMe ? `${rc.receiptsPendingMe} chờ bạn xác nhận` : 'người khác người lập xác nhận', icon: Banknote, who: canConfirm ? undefined : 'Cần quyền Tài chính — Xác nhận' },
    { key: 'receivable_sent', title: 'Đợt gửi CĐT quá 15 ngày chưa xác nhận', count: rc ? rc.sentStale : null, value: rc ? `${rc.sentStale} đợt` : '…', hint: 'liên hệ CĐT chốt số', icon: CalendarClock },
    { key: 'receivable_opening', title: 'Đối chiếu đầu kỳ phải thu', count: rc ? rc.openingsTodo + rc.openingsPending : null, value: rc ? `${rc.openingsTodo + rc.openingsPending} HĐ` : '…',
      hint: rc ? `${rc.openingsTodo} chưa làm · ${rc.openingsPending} chờ chốt — theo sổ MISA 30/09` : '', icon: FileWarning, urgent: true },
    { key: 'receivable_guarantee', title: 'Bảo lãnh cần khai / sắp hết hạn', count: rc ? rc.guaranteesExpiring + rc.guaranteesMissing : null, value: rc ? `${rc.guaranteesExpiring + rc.guaranteesMissing} bảo lãnh` : '…',
      hint: rc ? `${rc.guaranteesExpiring} hết hạn trong 30 ngày · ${rc.guaranteesMissing} chưa khai` : '', icon: FileCheck2, urgent: Boolean(rc?.guaranteesExpiring) },
    { key: 'advance_overdue', title: 'Tạm ứng NCC quá hạn hoàn ứng', count: advances ? advances.overdueCount : null, value: advances ? `${advances.overdueCount} khoản` : '…',
      hint: advances ? `${shortMoney(advances.overdue)} · NCC chưa giao hàng — nhờ Mua hàng đôn đốc` : '', icon: HandCoins, urgent: true },
    { key: 'advance_refund', title: 'Tạm ứng chờ hoàn', count: advances ? advances.refundDueCount : null, value: advances ? `${advances.refundDueCount} khoản` : '…',
      hint: advances ? `${shortMoney(advances.refundDue)} · đơn đã kết thúc — thu hồi hoặc chuyển đơn` : '', icon: RotateCcw, urgent: true },
    { key: 'advance_adjust', title: 'Hoàn / chuyển tạm ứng chờ xác nhận', count: advances ? advances.adjustmentsWaiting : null, value: advances ? `${advances.adjustmentsWaiting} phiếu` : '…',
      hint: advances?.adjustmentsWaitingMe ? `${advances.adjustmentsWaitingMe} chờ bạn xác nhận` : 'người khác người lập xác nhận', icon: HandCoins, who: canConfirm ? undefined : 'Cần quyền Tài chính — Xác nhận' },
    { key: 'transfers', title: 'Chuyển kho chờ xác nhận giá vốn', count: transferCount, value: `${transferCount} phiếu`, hint: 'giá kho gửi chưa tin được → chưa ghi chi phí dự án', icon: ArrowLeftRight },
    { key: 'issues', title: 'Chứng từ cần soát xét', count: totals.issues, value: `${totals.issues} chứng từ`, hint: 'đơn vị nội bộ, số tiền bất thường, cùng người lập + ghi', icon: FileWarning },
  ];
  const open = items.filter(i => i.count == null || i.count > 0);
  const done = items.filter(i => i.count === 0);
  return <div className="space-y-4">
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {open.map(i => <button key={i.key} type="button" onClick={() => onGo(i.key)}
        className={`group rounded-2xl border p-4 text-left shadow-sm transition hover:shadow ${i.urgent ? 'border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20' : 'border-border bg-card'}`}>
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <i.icon size={15} className={i.urgent ? 'text-amber-600' : 'text-teal-700 dark:text-teal-300'} />{i.title}</span>
        <span className="mt-1.5 flex items-center justify-between gap-2"><span className="text-2xl font-bold tabular-nums">{i.value}</span>
          <ChevronRight size={18} className="text-muted-foreground transition group-hover:translate-x-0.5" /></span>
        <span className="block text-xs text-muted-foreground">{i.hint}</span>
        {i.who && <span className="mt-1 block text-xs text-amber-800 dark:text-amber-200">{i.who}</span>}
      </button>)}
    </section>
    {done.length > 0 && <section className="rounded-2xl border border-border bg-card p-3 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Không có việc</p>
      <ul className="mt-1 flex flex-wrap gap-2">{done.map(i => <li key={i.key} className="inline-flex items-center gap-1 rounded-full border border-leaf-200 bg-leaf-50 px-2.5 py-1 text-xs font-semibold text-leaf-800 dark:border-leaf-900 dark:bg-leaf-950/30 dark:text-leaf-200">
        <CheckCircle2 size={13} />{i.title}</li>)}</ul>
    </section>}
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <h3 className="font-bold">Thứ tự làm gợi ý</h3>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
        <li>Chốt đối chiếu đầu kỳ từng NCC theo sổ MISA 30/09.</li>
        <li>Ghi nợ phiếu nhập trực tiếp và bảng đối soát đang chờ (sửa phiếu thiếu giá trước).</li>
        <li>Lập đề nghị chi cho nợ quá hạn và đến hạn trong tuần → duyệt → xác nhận đã chi (UNC).</li>
        <li>Xác nhận giá vốn chuyển kho để chi phí dự án đủ.</li>
        <li>Theo dõi tạm ứng NCC quá hạn hoàn ứng / chờ hoàn: nhờ Mua hàng đôn đốc giao, thu hồi tiền hoặc chuyển sang đơn khác.</li>
      </ol>
    </section>
  </div>;
};

export default FinanceTodoView;
