import React, { useEffect, useState } from 'react';
import { ArrowRight, Wallet } from 'lucide-react';
import { financeService, type FinanceProjectSummary } from '../../lib/financeService';
import { projectFinanceHref, shortMoney, type LedgerFilter } from './financeUi';

// Dự án → Điều hành: thẻ tóm tắt số tài chính lấy từ module Tài chính (chủ SP duyệt doc 14 câu 2, 05/10/2026).
// Chỉ hiện với người được xem tài chính dự án; người khác không thấy gì (máy chủ trả null). Mỗi ô mở Tài chính dự án đúng phần / bộ lọc.
export const ProjectFinanceSummaryCard: React.FC<{ projectId: string }> = ({ projectId }) => {
  const [s, setS] = useState<FinanceProjectSummary | null | undefined>(undefined);
  useEffect(() => { let alive = true; setS(undefined);
    financeService.projectSummary(projectId).then(x => alive && setS(x)).catch(() => alive && setS(null));
    return () => { alive = false; }; }, [projectId]);
  if (!s) return null;
  const go = (tab: string, f?: LedgerFilter) => { window.location.hash = projectFinanceHref(projectId, tab, f).slice(1); };
  const unknown = <span className="text-slate-500">chưa biết</span>;
  const tiles: Array<[string, React.ReactNode, string, () => void, string?]> = [
    ['CĐT đã trả', shortMoney(s.received), s.contractGross ? `${Math.round(s.received * 100 / s.contractGross)}% HĐ ${shortMoney(s.contractGross)}` : 'chưa có HĐ chủ đầu tư', () => go('ledger', { kind: 'revenue_received' })],
    ['Phải thu đang mở', shortMoney(s.receivable), s.openingTodo ? 'tạm tính — chưa chốt đầu kỳ' : s.receivableOverdue > 0.5 ? `${shortMoney(s.receivableOverdue)} quá hạn` : 'CĐT đã xác nhận', () => go('receivables'), s.receivableOverdue > 0.5 ? 'text-rose-700' : undefined],
    ['Chi phí đã ghi nhận', shortMoney(s.cost), `cam kết thêm ${shortMoney(s.committed)}${s.overItems ? ` · ${s.overItems} khoản mục vượt` : ''}`, () => go('ledger', { kind: 'expense' }), s.overItems ? 'text-rose-700' : undefined],
    ['Sản lượng − chi phí', s.margin == null ? unknown : shortMoney(s.margin), 'tạm tính, trước VAT', () => go('cost'), s.margin != null && s.margin < 0 ? 'text-rose-700' : undefined],
    ['Còn phải trả', shortMoney(s.payable), s.payableOverdue > 0.5 ? `${shortMoney(s.payableOverdue)} quá hạn` : 'NCC, thầu phụ', () => go('payables'), s.payableOverdue > 0.5 ? 'text-rose-700' : undefined],
    ['Quỹ dự án', s.fundBalance == null ? unknown : shortMoney(s.fundBalance), s.fundBalance == null ? 'chưa chốt đầu kỳ' : 'tiền CĐT trả − đã chi', () => go('cost')],
  ];
  return <section className="rounded-2xl border border-teal-200 bg-gradient-to-br from-teal-50 to-white p-4 shadow-sm dark:border-teal-900/70 dark:from-teal-950/40 dark:to-zinc-900">
    <div className="flex flex-wrap items-center gap-2"><Wallet size={17} className="text-teal-700" /><h3 className="mr-auto text-sm font-bold text-zinc-900 dark:text-zinc-100">Tài chính dự án</h3>
      <button type="button" onClick={() => go('overview')} className="inline-flex items-center gap-1 text-xs font-bold text-teal-700 hover:underline">Mở ở Tài chính <ArrowRight size={13} /></button></div>
    <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
      {tiles.map(([label, value, hint, onClick, tone]) => <button key={label} type="button" onClick={onClick}
        className="rounded-xl border border-teal-100 bg-white p-2.5 text-left transition hover:border-teal-400 hover:shadow dark:border-teal-900 dark:bg-zinc-900">
        <span className="block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</span>
        <span className={`mt-0.5 block text-lg font-bold tabular-nums ${tone || 'text-leaf-700 dark:text-leaf-300'}`}>{value}</span>
        <span className="block text-[11px] text-zinc-500">{hint}</span></button>)}
    </div>
    <p className="mt-2 text-[11px] text-zinc-500">Chỉ xem. Thu, chi, công nợ, ngân sách ghi ở module Tài chính; bấm vào ô để xem chi tiết.</p>
  </section>;
};
