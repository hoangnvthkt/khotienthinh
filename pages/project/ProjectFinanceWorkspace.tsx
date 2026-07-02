import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  BarChart3,
  CalendarClock,
  CreditCard,
  FileText,
  Landmark,
  Loader2,
  ReceiptText,
  RefreshCcw,
  Search,
  WalletCards,
} from 'lucide-react';
import CostAnalysisPanel from '../../components/project/CostAnalysisPanel';
import { ProjectTransaction } from '../../types';
import {
  ProjectFinanceLedgerRow,
  ProjectFinancePayableRow,
  ProjectFinanceReceivableRow,
  ProjectFinanceWorkspaceData,
  ProjectFinanceWorkspaceTab,
  projectFinanceWorkspaceService,
} from '../../lib/projectFinanceWorkspaceService';
import CashFlowTab from './CashFlowTab';
import PaymentWorkbenchTab from './PaymentWorkbenchTab';

interface ProjectFinanceWorkspaceProps {
  projectId?: string | null;
  constructionSiteId: string;
  transactions: ProjectTransaction[];
  contractValue: number;
  canManageFinance?: boolean;
  canManagePayment?: boolean;
  initialTab?: ProjectFinanceWorkspaceTab;
}

const tabs: Array<{ key: ProjectFinanceWorkspaceTab; label: string; icon: React.ElementType }> = [
  { key: 'overview', label: 'Tổng quan', icon: BarChart3 },
  { key: 'budget', label: 'Ngân sách', icon: Landmark },
  { key: 'payables', label: 'Phải trả', icon: ArrowDownRight },
  { key: 'receivables', label: 'Phải thu', icon: ArrowUpRight },
  { key: 'payments', label: 'Thanh toán', icon: CreditCard },
  { key: 'cashflow', label: 'Dòng tiền', icon: Banknote },
  { key: 'ledger', label: 'Sổ giao dịch', icon: ReceiptText },
];

const validTab = (value?: string | null): value is ProjectFinanceWorkspaceTab =>
  tabs.some(tab => tab.key === value);

const fmtMoney = (value: number) => {
  const amount = Number(value || 0);
  if (Math.abs(amount) >= 1_000_000_000) return `${(amount / 1_000_000_000).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} tỷ`;
  if (Math.abs(amount) >= 1_000_000) return `${(amount / 1_000_000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tr`;
  return `${amount.toLocaleString('vi-VN')} đ`;
};

const fmtDate = (value?: string | null) => value ? new Date(value).toLocaleDateString('vi-VN') : '-';

const statusLabel = (status: string) => {
  const labels: Record<string, string> = {
    paid: 'Đã thanh toán',
    received: 'Đã thu',
    partial: 'Một phần',
    payable: 'Phải trả',
    receivable: 'Phải thu',
    waiting_receipt: 'Chờ thực nhận',
    planned: 'Kế hoạch',
    pending: 'Chờ xử lý',
    overdue: 'Quá hạn',
    draft: 'Nháp',
    submitted: 'Đã trình',
    approved: 'Đã duyệt',
  };
  return labels[status] || status;
};

const statusTone = (status: string) => {
  if (['paid', 'received', 'approved'].includes(status)) return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  if (['overdue', 'payable', 'receivable'].includes(status)) return 'bg-red-50 text-red-700 border-red-100';
  if (['partial', 'waiting_receipt', 'pending', 'submitted'].includes(status)) return 'bg-amber-50 text-amber-700 border-amber-100';
  return 'bg-slate-50 text-slate-600 border-slate-100';
};

const EmptyState = ({ label }: { label: string }) => (
  <div className="rounded-lg border border-dashed border-slate-200 bg-white p-8 text-center text-sm font-bold text-slate-400 dark:border-slate-700 dark:bg-slate-900">
    {label}
  </div>
);

const KpiCard = ({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'slate',
}: {
  label: string;
  value: number;
  hint?: string;
  icon: React.ElementType;
  tone?: 'slate' | 'green' | 'red' | 'blue' | 'amber';
}) => {
  const toneClass = {
    slate: 'text-slate-700 bg-slate-50',
    green: 'text-emerald-700 bg-emerald-50',
    red: 'text-red-700 bg-red-50',
    blue: 'text-blue-700 bg-blue-50',
    amber: 'text-amber-700 bg-amber-50',
  }[tone];
  return (
    <div className="rounded-lg border border-slate-100 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</div>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${toneClass}`}>
          <Icon size={16} />
        </span>
      </div>
      <div className={`mt-2 text-lg font-black ${toneClass.split(' ')[0]}`}>{fmtMoney(value)}</div>
      {hint && <div className="mt-1 text-[11px] font-bold text-slate-400">{hint}</div>}
    </div>
  );
};

const PayablesTable = ({ rows, onOpenSource }: { rows: ProjectFinancePayableRow[]; onOpenSource: (tab: string) => void }) => {
  if (rows.length === 0) return <EmptyState label="Chưa có khoản phải trả trong phạm vi công trình này." />;
  return (
    <div className="overflow-hidden rounded-lg border border-slate-100 bg-white dark:border-slate-700 dark:bg-slate-900">
      <table className="w-full text-left">
        <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wide text-slate-400 dark:bg-slate-800">
          <tr>
            <th className="px-3 py-2">Chứng từ</th>
            <th className="px-3 py-2">Đối tượng</th>
            <th className="px-3 py-2 text-right">Cam kết</th>
            <th className="px-3 py-2 text-right">Được ghi nhận</th>
            <th className="px-3 py-2 text-right">Đã TT</th>
            <th className="px-3 py-2 text-right">Còn phải trả</th>
            <th className="px-3 py-2 text-center">Trạng thái</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
          {rows.map(row => (
            <tr key={row.id} className="text-xs hover:bg-slate-50/70 dark:hover:bg-slate-800/60">
              <td className="px-3 py-3">
                <button onClick={() => onOpenSource(row.sourceTab)} className="text-left font-black text-slate-800 hover:text-orange-600 dark:text-slate-100">
                  {row.documentNo}
                </button>
                <div className="mt-0.5 text-[10px] font-bold text-slate-400">{row.description}</div>
              </td>
              <td className="px-3 py-3 font-bold text-slate-600 dark:text-slate-300">{row.counterpartyName}</td>
              <td className="px-3 py-3 text-right font-bold">{fmtMoney(row.committedAmount)}</td>
              <td className="px-3 py-3 text-right font-black text-blue-700">{fmtMoney(row.recognizedAmount)}</td>
              <td className="px-3 py-3 text-right text-emerald-700">{fmtMoney(row.paidAmount)}</td>
              <td className="px-3 py-3 text-right font-black text-red-600">{fmtMoney(row.outstandingAmount)}</td>
              <td className="px-3 py-3 text-center">
                <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-black ${statusTone(row.status)}`}>{statusLabel(row.status)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const ReceivablesTable = ({ rows, onOpenSource }: { rows: ProjectFinanceReceivableRow[]; onOpenSource: (tab: string) => void }) => {
  if (rows.length === 0) return <EmptyState label="Chưa có khoản phải thu trong phạm vi công trình này." />;
  return (
    <div className="overflow-hidden rounded-lg border border-slate-100 bg-white dark:border-slate-700 dark:bg-slate-900">
      <table className="w-full text-left">
        <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wide text-slate-400 dark:bg-slate-800">
          <tr>
            <th className="px-3 py-2">Chứng từ</th>
            <th className="px-3 py-2">Chủ đầu tư</th>
            <th className="px-3 py-2 text-right">Giá trị</th>
            <th className="px-3 py-2 text-right">Được ghi nhận</th>
            <th className="px-3 py-2 text-right">Đã thu</th>
            <th className="px-3 py-2 text-right">Còn phải thu</th>
            <th className="px-3 py-2 text-center">Trạng thái</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
          {rows.map(row => (
            <tr key={row.id} className="text-xs hover:bg-slate-50/70 dark:hover:bg-slate-800/60">
              <td className="px-3 py-3">
                <button onClick={() => onOpenSource(row.sourceTab)} className="text-left font-black text-slate-800 hover:text-orange-600 dark:text-slate-100">
                  {row.documentNo}
                </button>
                <div className="mt-0.5 text-[10px] font-bold text-slate-400">{row.description}</div>
              </td>
              <td className="px-3 py-3 font-bold text-slate-600 dark:text-slate-300">{row.counterpartyName}</td>
              <td className="px-3 py-3 text-right font-bold">{fmtMoney(row.contractAmount)}</td>
              <td className="px-3 py-3 text-right font-black text-blue-700">{fmtMoney(row.recognizedAmount)}</td>
              <td className="px-3 py-3 text-right text-emerald-700">{fmtMoney(row.receivedAmount)}</td>
              <td className="px-3 py-3 text-right font-black text-red-600">{fmtMoney(row.outstandingAmount)}</td>
              <td className="px-3 py-3 text-center">
                <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-black ${statusTone(row.status)}`}>{statusLabel(row.status)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const LedgerTable = ({ rows }: { rows: ProjectFinanceLedgerRow[] }) => {
  const [search, setSearch] = useState('');
  const filtered = rows.filter(row => [row.description, row.sourceRef, row.category, row.type].some(value => String(value || '').toLowerCase().includes(search.toLowerCase())));
  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder="Tìm giao dịch..."
          className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs font-bold outline-none focus:border-orange-300 dark:border-slate-700 dark:bg-slate-900"
        />
      </div>
      {filtered.length === 0 ? <EmptyState label="Chưa có giao dịch tài chính phù hợp." /> : (
        <div className="overflow-hidden rounded-lg border border-slate-100 bg-white dark:border-slate-700 dark:bg-slate-900">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wide text-slate-400 dark:bg-slate-800">
              <tr>
                <th className="px-3 py-2">Ngày</th>
                <th className="px-3 py-2">Nội dung</th>
                <th className="px-3 py-2">Nguồn</th>
                <th className="px-3 py-2 text-right">Số tiền</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
              {filtered.map(row => (
                <tr key={row.id} className="text-xs">
                  <td className="px-3 py-3 font-bold text-slate-500">{fmtDate(row.date)}</td>
                  <td className="px-3 py-3">
                    <div className="font-black text-slate-800 dark:text-slate-100">{row.description}</div>
                    <div className="mt-0.5 text-[10px] font-bold text-slate-400">{row.category} • {row.sourceRef || row.source}</div>
                  </td>
                  <td className="px-3 py-3 font-bold text-slate-500">{row.source}</td>
                  <td className={`px-3 py-3 text-right font-black ${row.type === 'expense' ? 'text-red-600' : 'text-emerald-700'}`}>
                    {row.type === 'expense' ? '-' : '+'}{fmtMoney(Math.abs(row.amount))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const ProjectFinanceWorkspace: React.FC<ProjectFinanceWorkspaceProps> = ({
  projectId,
  constructionSiteId,
  transactions,
  contractValue,
  canManageFinance = false,
  canManagePayment = false,
  initialTab = 'overview',
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const [activeTab, setActiveTab] = useState<ProjectFinanceWorkspaceTab>(() => {
    const paramTab = queryParams.get('financeTab');
    return validTab(paramTab) ? paramTab : initialTab;
  });
  const [data, setData] = useState<ProjectFinanceWorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const paramTab = queryParams.get('financeTab');
    const next = validTab(paramTab) ? paramTab : initialTab;
    setActiveTab(next);
  }, [initialTab, queryParams]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await projectFinanceWorkspaceService.getWorkspace({
        projectId,
        constructionSiteId,
        transactions,
      }));
    } catch (err: any) {
      setError(err?.message || 'Không tải được dữ liệu tài chính công trình.');
    } finally {
      setLoading(false);
    }
  }, [constructionSiteId, projectId, transactions]);

  useEffect(() => { load(); }, [load]);

  const openTab = (tab: ProjectFinanceWorkspaceTab) => {
    setActiveTab(tab);
    const params = new URLSearchParams(location.search);
    params.set('tab', 'finance');
    params.set('financeTab', tab);
    navigate(`${location.pathname}?${params.toString()}`, { replace: true });
  };

  const openSource = (tab: string) => {
    const params = new URLSearchParams(location.search);
    if (tab === 'payment') {
      params.set('tab', 'finance');
      params.set('financeTab', 'payments');
    } else if (tab === 'cashflow') {
      params.set('tab', 'finance');
      params.set('financeTab', 'cashflow');
    } else {
      params.set('tab', tab);
      params.delete('financeTab');
    }
    navigate(`${location.pathname}?${params.toString()}`);
  };

  const summary = data?.summary;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-black text-slate-900 dark:text-white">Tài chính công trình</h3>
          <p className="mt-0.5 text-xs font-bold text-slate-400">Tổng hợp ngân sách, công nợ, thanh toán và dòng tiền từ chứng từ hiện có.</p>
        </div>
        <button onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 hover:border-orange-200 hover:text-orange-600 dark:border-slate-700 dark:bg-slate-900">
          <RefreshCcw size={14} className={loading ? 'animate-spin' : ''} /> Tải lại
        </button>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-lg border border-slate-100 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900 [&::-webkit-scrollbar]:hidden">
        {tabs.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => openTab(tab.key)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-xs font-black transition ${activeTab === tab.key
                ? 'bg-orange-500 text-white shadow-sm'
                : 'text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800'
              }`}
            >
              <Icon size={14} /> {tab.label}
            </button>
          );
        })}
      </div>

      {loading && (
        <div className="rounded-lg border border-slate-100 bg-white p-10 text-center text-sm font-bold text-slate-400 dark:border-slate-700 dark:bg-slate-900">
          <Loader2 size={22} className="mx-auto mb-2 animate-spin text-orange-500" />
          Đang tổng hợp tài chính...
        </div>
      )}

      {!loading && error && (
        <div className="rounded-lg border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && data && summary && (
        <>
          {activeTab === 'overview' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <KpiCard label="Giá trị HĐ" value={summary.contractValue || contractValue} icon={FileText} tone="blue" />
                <KpiCard label="Chi phí thực tế" value={summary.actualCost} icon={ArrowDownRight} tone="red" hint={`NS: ${fmtMoney(summary.budgetAmount)}`} />
                <KpiCard label="Còn phải thu" value={summary.receivableOutstanding} icon={ArrowUpRight} tone="green" />
                <KpiCard label="Còn phải trả" value={summary.payableOutstanding} icon={WalletCards} tone="amber" />
                <KpiCard label="Dòng tiền ròng" value={summary.cashPosition} icon={Banknote} tone={summary.cashPosition >= 0 ? 'green' : 'red'} />
                <KpiCard label="Doanh thu xác nhận" value={summary.certifiedRevenue} icon={ReceiptText} tone="blue" />
                <KpiCard label="Tạm ứng còn treo" value={summary.advanceOutstanding} icon={CalendarClock} tone="amber" />
                <KpiCard label="Biên tạm tính" value={summary.estimatedMargin} icon={BarChart3} tone={summary.estimatedMargin >= 0 ? 'green' : 'red'} />
              </div>

              {summary.alerts.length > 0 && (
                <div className="grid gap-3 lg:grid-cols-3">
                  {summary.alerts.map(alert => (
                    <div key={alert.id} className={`rounded-lg border p-3 ${
                      alert.tone === 'danger' ? 'border-red-100 bg-red-50 text-red-700' :
                      alert.tone === 'warning' ? 'border-amber-100 bg-amber-50 text-amber-700' :
                      'border-blue-100 bg-blue-50 text-blue-700'
                    }`}>
                      <div className="flex items-center gap-2 text-xs font-black"><AlertTriangle size={14} /> {alert.title}</div>
                      <p className="mt-1 text-[11px] font-bold leading-5 opacity-80">{alert.message}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid gap-5 xl:grid-cols-2">
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-black text-slate-800 dark:text-white">Phải trả gần nhất</h4>
                    <button onClick={() => openTab('payables')} className="text-xs font-black text-orange-600">Xem tất cả</button>
                  </div>
                  <PayablesTable rows={data.payables.slice(0, 5)} onOpenSource={openSource} />
                </section>
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-black text-slate-800 dark:text-white">Phải thu gần nhất</h4>
                    <button onClick={() => openTab('receivables')} className="text-xs font-black text-orange-600">Xem tất cả</button>
                  </div>
                  <ReceivablesTable rows={data.receivables.slice(0, 5)} onOpenSource={openSource} />
                </section>
              </div>
            </div>
          )}

          {activeTab === 'budget' && <CostAnalysisPanel constructionSiteId={constructionSiteId} projectId={projectId} />}
          {activeTab === 'payables' && <PayablesTable rows={data.payables} onOpenSource={openSource} />}
          {activeTab === 'receivables' && <ReceivablesTable rows={data.receivables} onOpenSource={openSource} />}
          {activeTab === 'payments' && <PaymentWorkbenchTab constructionSiteId={constructionSiteId} projectId={projectId || undefined} canManageTab={canManageFinance || canManagePayment} />}
          {activeTab === 'cashflow' && (
            <CashFlowTab
              constructionSiteId={constructionSiteId}
              projectId={projectId || undefined}
              transactions={transactions}
              contractValue={summary.contractValue || contractValue}
            />
          )}
          {activeTab === 'ledger' && <LedgerTable rows={data.ledger} />}
        </>
      )}
    </div>
  );
};

export default ProjectFinanceWorkspace;
