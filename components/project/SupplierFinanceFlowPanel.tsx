import React from 'react';
import { Banknote, Boxes, CircleDollarSign, Loader2, PackageCheck, RefreshCcw } from 'lucide-react';
import type { SupplierFinanceControlSnapshot, SupplierFinanceLayer } from '../../types';

const labels: Record<SupplierFinanceLayer, { title: string; hint: string; icon: React.ElementType }> = {
  purchase_receipt: { title: 'Nhận mua', hint: 'Giá trị receipt đã ghi nhận', icon: PackageCheck },
  inventory: { title: 'Tồn kho', hint: 'Giá trị còn trên sổ kho', icon: Boxes },
  consumption: { title: 'Tiêu hao', hint: 'Giá trị đã xuất dùng', icon: CircleDollarSign },
  ap: { title: 'Công nợ AP', hint: 'Số dư còn phải trả', icon: RefreshCcw },
  cash: { title: 'Tiền đã chi', hint: 'Payment batch đã post', icon: Banknote },
};

const money = (amount: number, currency: string) => new Intl.NumberFormat('vi-VN', {
  style: 'currency', currency, maximumFractionDigits: currency === 'VND' ? 0 : 2,
}).format(amount);

const issueLabels: Record<string, string> = {
  MULTI_CURRENCY_REQUIRES_BREAKDOWN: 'Có nhiều loại tiền; cần xem riêng theo từng loại tiền',
  INVENTORY_VALUATION_SOURCE_MISSING: 'Một số bút toán tồn kho thiếu nguồn giá',
  CONSUMPTION_VALUATION_SOURCE_MISSING: 'Một số bút toán tiêu hao thiếu nguồn giá',
  INVOICE_VARIANCE_PENDING_POLICY: 'Chênh lệch hóa đơn đang chờ chính sách xử lý',
  VALUATION_SOURCE_MISSING: 'Thiếu nguồn giá để xác định giá trị',
};

const issueLabel = (issue: string) => issueLabels[issue] || 'Có dữ liệu cần đối chiếu nguồn';

export const SupplierFinanceFlowPanel = ({
  snapshot,
  loading,
  error,
  onRetry,
}: {
  snapshot: SupplierFinanceControlSnapshot | null;
  loading: boolean;
  error?: string | null;
  onRetry: () => void;
}) => (
  <section aria-label="Luồng giá trị nhà cung cấp" className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="text-[11px] font-black uppercase tracking-wider text-teal-700 dark:text-teal-400">Luồng giá trị nhà cung cấp</div>
        <h4 className="mt-1 text-sm font-bold text-zinc-900 dark:text-white">Nhận mua → tồn kho → tiêu hao → công nợ → tiền chi</h4>
        <p className="mt-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">Mỗi lớp dùng nguồn chứng từ riêng; số chưa đủ nguồn được giữ là “Chưa xác định”.</p>
      </div>
      <button type="button" onClick={onRetry} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-2 text-xs font-bold text-zinc-600 hover:border-teal-500 hover:text-teal-700 dark:border-zinc-700 dark:text-zinc-300">
        <RefreshCcw size={14} className={loading ? 'animate-spin' : ''} /> Làm mới
      </button>
    </div>
    {loading && <div className="mt-4 flex min-h-28 items-center justify-center gap-2 rounded-xl bg-zinc-50 text-sm font-semibold text-zinc-400 dark:bg-zinc-950"><Loader2 size={17} className="animate-spin" /> Đang đối chiếu các lớp giá trị...</div>}
    {!loading && error && <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</div>}
    {!loading && !error && snapshot && (
      <>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {snapshot.layers.map(metric => {
            const config = labels[metric.layer];
            const Icon = config.icon;
            const unknown = metric.amount == null || metric.completeness !== 'complete';
            return (
              <div key={`${metric.layer}-${metric.currency}`} className={`rounded-xl border p-3 ${unknown ? 'border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20' : 'border-zinc-200 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-950/50'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-black uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{config.title}</span>
                  <Icon size={15} className={unknown ? 'text-amber-600' : 'text-teal-700 dark:text-teal-400'} />
                </div>
                <div className={`mt-2 text-base font-black ${unknown ? 'text-amber-700 dark:text-amber-300' : 'text-zinc-900 dark:text-white'}`}>{metric.amount == null ? 'Chưa xác định' : money(metric.amount, metric.currency)}</div>
                <div className="mt-1 text-[10px] font-semibold leading-4 text-zinc-500 dark:text-zinc-400">{config.hint} · {metric.documentCount} chứng từ</div>
              </div>
            );
          })}
        </div>
        {snapshot.issues.length > 0 && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
            Dữ liệu cần đối chiếu: {snapshot.issues.map(issueLabel).join(' · ')}
          </div>
        )}
      </>
    )}
  </section>
);

export default SupplierFinanceFlowPanel;
