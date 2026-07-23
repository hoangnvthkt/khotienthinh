import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  BarChart3,
  CalendarClock,
  CreditCard,
  Download,
  Edit2,
  ExternalLink,
  FileText,
  Filter,
  Landmark,
  Loader2,
  Paperclip,
  Plus,
  QrCode,
  ReceiptText,
  RefreshCcw,
  RotateCcw,
  Search,
  Save,
  Trash2,
  Upload,
  WalletCards,
  X,
} from 'lucide-react';
import CostAnalysisPanel from '../../components/project/CostAnalysisPanel';
import PartnerSearchSelect from '../../components/PartnerSearchSelect';
import {
  Attachment,
  BusinessPartner,
  PaymentDossierStatus,
  PaymentQualityStatus,
  PaymentSchedule,
  PaymentScheduleMilestoneType,
  PaymentScheduleStatus,
  ContractCostItem,
  ProjectCostCategory,
  ProjectTransaction,
  ProjectTxType,
  CashFund,
  SupplierPayableDocument,
  SupplierPaymentAllocation,
  SupplierPaymentAllocationMode,
  SupplierPaymentBatch,
  SupplierPaymentMethod,
  SiteCashSettlementBatch,
  SiteCashSettlementLine,
} from '../../types';
import {
  ProjectFinanceLedgerRow,
  ProjectFinancePayableRow,
  ProjectFinanceReceivableRow,
  ProjectFinanceSupplierControlIssue,
  ProjectFinanceSupplierControlSummary,
  ProjectFinanceSourceRoute,
  ProjectFinanceWorkspaceData,
  ProjectFinanceWorkspaceTab,
  projectFinanceWorkspaceService,
} from '../../lib/projectFinanceWorkspaceService';
import { allocateSupplierPayment, assertSupplierPaymentBatchCanPost, supplierPaymentBatchService } from '../../lib/supplierPaymentBatchService';
import { supplierPayableService } from '../../lib/supplierPayableService';
import {
  calculateSiteCashSettlementSummary,
  siteCashSettlementService,
} from '../../lib/siteCashSettlementService';
import { cashFundService } from '../../lib/cashFundService';
import { contractCostItemService } from '../../lib/contractMetadataService';
import {
  applyContractCostItemToTransaction,
  buildContractCostItemOptions,
  clearContractCostItemSnapshot,
  inferProjectCostCategoryFromCostItem,
  type ContractCostItemOption,
} from '../../lib/contractCostItemOptions';
import { loadXlsx } from '../../lib/loadXlsx';
import { partnerService } from '../../lib/partnerService';
import { paymentService } from '../../lib/projectService';
import {
  buildProjectTransactionsFromImportRows,
  parseProjectTransactionImportPreviewRows,
  ProjectTransactionImportPreviewResult,
  PROJECT_TRANSACTION_IMPORT_HEADERS,
  PROJECT_TRANSACTION_IMPORT_SAMPLE_ROWS,
} from '../../lib/projectTransactionImport';
import { ProjectTransactionImportPreviewModal } from '../../components/project/ProjectTransactionImportPreviewModal';
import { buildDocumentTracePath } from '../../lib/documentTraceService';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../context/AppContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useToast } from '../../context/ToastContext';
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

interface PurchaseOrderPaymentForm {
  row: ProjectFinancePayableRow;
  amount: number;
  date: string;
  documentRef: string;
  note: string;
}

interface SupplierPaymentBatchFormState {
  batchId: string;
  supplierId: string;
  supplierName: string;
  amount: number;
  paymentDate: string;
  periodMonth: string;
  paymentMethod: SupplierPaymentMethod;
  documentRef: string;
  note: string;
  allocationMode: SupplierPaymentAllocationMode;
  documents: SupplierPayableDocument[];
  manualAllocations: Record<string, number>;
  lockedDocumentIds?: string[];
  loadingDocuments: boolean;
  documentError?: string | null;
}

interface SupplierPaymentBatchDetailState {
  batchId: string;
  batch?: SupplierPaymentBatch | null;
  allocations: SupplierPaymentAllocation[];
  loading: boolean;
  error?: string | null;
}

interface SupplierPayableDocumentDrawerState {
  row: ProjectFinancePayableRow;
  documents: SupplierPayableDocument[];
  loading: boolean;
  error?: string | null;
}

interface SiteCashSettlementDetailState {
  batchId: string;
  batch?: SiteCashSettlementBatch | null;
  lines: SiteCashSettlementLine[];
  loading: boolean;
  error?: string | null;
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
const todayIso = () => new Date().toISOString().slice(0, 10);
const toPeriodMonth = (date: string) => `${(date || todayIso()).slice(0, 7)}-01`;
const fmtPeriodMonth = (value?: string | null) => value ? `T${value.slice(5, 7)}/${value.slice(0, 4)}` : '-';

const parseMoneyInput = (value: string): number => {
  const parsed = Number(value.replace(/[^\d]/g, ''));
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
};

const buildSupplierPaymentBatchCode = (paymentDate: string, batchId: string) =>
  `PAY-${(paymentDate || todayIso()).replaceAll('-', '')}-${batchId.slice(0, 8).toUpperCase()}`;

const buildSiteCashSettlementCode = (periodMonth: string, batchId: string) =>
  `HU-${(periodMonth || todayIso()).slice(0, 7).replace('-', '')}-${batchId.slice(0, 8).toUpperCase()}`;

const paymentMilestoneOptions: Array<{ value: PaymentScheduleMilestoneType; label: string }> = [
  { value: 'advance', label: 'Tạm ứng' },
  { value: 'progress', label: 'Tiến độ' },
  { value: 'settlement', label: 'Quyết toán' },
  { value: 'retention', label: 'Giữ lại' },
  { value: 'other', label: 'Khác' },
];

const paymentStatusOptions: Array<{ value: PaymentScheduleStatus; label: string }> = [
  { value: 'pending', label: 'Chờ xử lý' },
  { value: 'paid', label: 'Đã thanh toán' },
  { value: 'overdue', label: 'Quá hạn' },
];

const supplierPaymentMethodOptions: Array<{ value: SupplierPaymentMethod; label: string }> = [
  { value: 'bank_transfer', label: 'Chuyển khoản' },
  { value: 'cash', label: 'Tiền mặt' },
  { value: 'site_cash', label: 'Quỹ công trường' },
  { value: 'offset', label: 'Bù trừ' },
  { value: 'other', label: 'Khác' },
];

const supplierPaymentAllocationModeOptions: Array<{ value: SupplierPaymentAllocationMode; label: string }> = [
  { value: 'fifo', label: 'FIFO' },
  { value: 'manual', label: 'Thủ công' },
  { value: 'proportional', label: 'Theo tỷ lệ' },
];

const dossierStatusOptions: Array<{ value: PaymentDossierStatus; label: string }> = [
  { value: 'not_started', label: 'Chưa lập' },
  { value: 'preparing', label: 'Đang chuẩn bị' },
  { value: 'submitted', label: 'Đã trình' },
  { value: 'approved', label: 'Đã duyệt' },
];

const qualityStatusOptions: Array<{ value: PaymentQualityStatus; label: string }> = [
  { value: 'not_applicable', label: 'Không áp dụng' },
  { value: 'not_confirmed', label: 'Chưa xác nhận' },
  { value: 'passed', label: 'Đạt' },
  { value: 'failed', label: 'Không đạt' },
];

const txTypeOptions: Array<{ value: ProjectTxType; label: string }> = [
  { value: 'expense', label: 'Chi phí' },
  { value: 'revenue_received', label: 'Thu đã nhận' },
  { value: 'revenue_pending', label: 'Thu chờ nghiệm thu' },
];

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
    open: 'Đang mở',
    submitted: 'Đã trình',
    approved: 'Đã duyệt',
    reviewing: 'Đang review',
    accepted: 'Chấp nhận',
    adjusted: 'Điều chỉnh',
    rejected: 'Từ chối',
    closed: 'Đã đóng',
    cancelled: 'Đã hủy',
    reversed: 'Đã đảo',
  };
  return labels[status] || status;
};

const statusTone = (status: string) => {
  if (['paid', 'received', 'approved', 'accepted', 'closed'].includes(status)) return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  if (['overdue', 'payable', 'receivable', 'open', 'rejected'].includes(status)) return 'bg-red-50 text-red-700 border-red-100';
  if (['partial', 'waiting_receipt', 'pending', 'submitted', 'reviewing', 'adjusted'].includes(status)) return 'bg-amber-50 text-amber-700 border-amber-100';
  return 'bg-slate-50 text-slate-600 border-slate-100';
};

const supplierPayableSourceLabel = (sourceType: SupplierPayableDocument['sourceType']) => {
  const labels: Record<SupplierPayableDocument['sourceType'], string> = {
    purchase_order: 'PO',
    site_direct_purchase: 'Mua nóng',
    supplier_delivery_statement: 'Đối soát HĐ NCC',
    supplier_return_credit: 'Bù trừ/hoàn trả',
    opening_balance: 'Đầu kỳ',
    manual_adjustment: 'Điều chỉnh',
  };
  return labels[sourceType] || sourceType;
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

const controlToneClass = (tone: 'slate' | 'green' | 'red' | 'blue' | 'amber') => ({
  slate: 'text-slate-700 bg-slate-50',
  green: 'text-emerald-700 bg-emerald-50',
  red: 'text-red-700 bg-red-50',
  blue: 'text-blue-700 bg-blue-50',
  amber: 'text-amber-700 bg-amber-50',
}[tone]);

const FinanceControlMetric = ({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'slate',
  money = false,
  onClick,
}: {
  label: string;
  value: number;
  hint?: string;
  icon: React.ElementType;
  tone?: 'slate' | 'green' | 'red' | 'blue' | 'amber';
  money?: boolean;
  onClick?: () => void;
}) => {
  const toneClass = controlToneClass(tone);
  const content = (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</div>
        <span className={`flex h-7 w-7 items-center justify-center rounded-md ${toneClass}`}>
          <Icon size={15} />
        </span>
      </div>
      <div className={`mt-2 text-base font-black ${toneClass.split(' ')[0]}`}>
        {money ? fmtMoney(value) : value.toLocaleString('vi-VN')}
      </div>
      {hint && <div className="mt-1 text-[11px] font-bold text-slate-400">{hint}</div>}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="min-h-[96px] rounded-md bg-slate-50 p-3 text-left transition hover:bg-orange-50 dark:bg-slate-800/60 dark:hover:bg-slate-800"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="min-h-[96px] rounded-md bg-slate-50 p-3 dark:bg-slate-800/60">
      {content}
    </div>
  );
};

const supplierControlIssueToneClass = (tone: ProjectFinanceSupplierControlIssue['tone']) => {
  if (tone === 'danger') return 'border-red-100 bg-red-50 text-red-700';
  if (tone === 'warning') return 'border-amber-100 bg-amber-50 text-amber-700';
  return 'border-blue-100 bg-blue-50 text-blue-700';
};

const FinanceSupplierControlPanel = ({
  summary,
  onOpenPayables,
  onOpenSupplierPayments,
  onOpenMaterialDirect,
  onOpenIssueSource,
  onOpenTrace,
}: {
  summary: ProjectFinanceSupplierControlSummary;
  onOpenPayables: () => void;
  onOpenSupplierPayments: () => void;
  onOpenMaterialDirect: () => void;
  onOpenIssueSource: (route?: ProjectFinanceSourceRoute | null) => void;
  onOpenTrace: (trace: NonNullable<ProjectFinanceSupplierControlIssue['trace']>) => void;
}) => {
  const issues = summary.issues.slice(0, 5);
  const openDirect = summary.waitingStatementCount > 0 || summary.wmsPendingExportCount > 0 || summary.blockedCount > 0
    ? onOpenMaterialDirect
    : undefined;
  return (
    <section className="rounded-lg border border-slate-100 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="text-sm font-black text-slate-900 dark:text-white">Kiểm soát cung ứng - công nợ</h4>
          <p className="mt-0.5 text-[11px] font-bold text-slate-400">AP, thanh toán NCC và trạng thái gọi hàng HĐ NCC.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onOpenPayables} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-black text-orange-600 hover:bg-orange-50">
            <ReceiptText size={13} /> AP
          </button>
          <button type="button" onClick={onOpenSupplierPayments} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-black text-emerald-700 hover:bg-emerald-50">
            <CreditCard size={13} /> Thanh toán NCC
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
        <FinanceControlMetric
          label="CP vật tư ghi nhận"
          value={summary.recognizedMaterialCost}
          hint={`${summary.apDocumentCount.toLocaleString('vi-VN')} AP${summary.openingMaterialCost > 0 ? ' + đầu kỳ' : ''}`}
          icon={ReceiptText}
          tone="blue"
          money
          onClick={onOpenPayables}
        />
        <FinanceControlMetric
          label="Đã thanh toán NCC"
          value={summary.supplierPaidAmount}
          hint={`${summary.paymentBatchCount.toLocaleString('vi-VN')} đợt`}
          icon={CreditCard}
          tone="green"
          money
          onClick={onOpenSupplierPayments}
        />
        <FinanceControlMetric
          label="Công nợ NCC"
          value={summary.supplierOutstanding}
          icon={WalletCards}
          tone={summary.supplierOutstanding > 0 ? 'amber' : 'green'}
          money
          onClick={onOpenPayables}
        />
        <FinanceControlMetric
          label="Chờ đối soát/AP"
          value={summary.waitingStatementCount}
          icon={CalendarClock}
          tone={summary.waitingStatementCount > 0 ? 'amber' : 'slate'}
          onClick={openDirect}
        />
        <FinanceControlMetric
          label="Chờ xuất dùng"
          value={summary.wmsPendingExportCount}
          icon={ArrowDownRight}
          tone={summary.wmsPendingExportCount > 0 ? 'amber' : 'slate'}
          onClick={openDirect}
        />
        <FinanceControlMetric
          label="Bị chặn"
          value={summary.blockedCount}
          icon={AlertTriangle}
          tone={summary.blockedCount > 0 ? 'red' : 'slate'}
          onClick={openDirect}
        />
      </div>

      {issues.length > 0 && (
        <div className="mt-4 grid gap-2 lg:grid-cols-2">
          {issues.map(issue => (
            <div key={issue.id} className={`rounded-md border p-3 ${supplierControlIssueToneClass(issue.tone)}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs font-black"><AlertTriangle size={14} /> {issue.title}</div>
                  <p className="mt-1 text-[11px] font-bold leading-5 opacity-85">{issue.message}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {issue.sourceRoute && (
                    <button
                      type="button"
                      onClick={() => onOpenIssueSource(issue.sourceRoute)}
                      className="inline-flex items-center gap-1 rounded-md bg-white/70 px-2 py-1 text-[10px] font-black hover:bg-white"
                    >
                      <ExternalLink size={11} /> Mở
                    </button>
                  )}
                  {issue.trace && (
                    <button
                      type="button"
                      onClick={() => onOpenTrace(issue.trace!)}
                      className="inline-flex items-center gap-1 rounded-md bg-white/70 px-2 py-1 text-[10px] font-black hover:bg-white"
                    >
                      <QrCode size={11} /> Truy vết
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

const FieldLabel = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</span>
    {children}
  </label>
);

const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';

const PaymentScheduleFormModal = ({
  form,
  saving,
  onChange,
  onClose,
  onSave,
}: {
  form: PaymentSchedule;
  saving: boolean;
  onChange: (next: PaymentSchedule) => void;
  onClose: () => void;
  onSave: () => void;
}) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
    <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
        <div>
          <div className="text-sm font-black text-slate-900 dark:text-white">
            {form.type === 'receivable' ? 'Khoản phải thu' : 'Khoản phải trả'}
          </div>
          <div className="mt-0.5 text-[11px] font-bold text-slate-400">Lưu vào lịch thanh toán công trình</div>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-700 dark:hover:bg-slate-800">
          <X size={16} />
        </button>
      </div>
      <div className="grid gap-3 p-5 md:grid-cols-2">
        <FieldLabel label="Loại dòng tiền">
          <select className={inputClass} value={form.type} onChange={event => onChange({ ...form, type: event.target.value as PaymentSchedule['type'] })}>
            <option value="receivable">Phải thu</option>
            <option value="payable">Phải trả</option>
          </select>
        </FieldLabel>
        <FieldLabel label="Mốc thanh toán">
          <select className={inputClass} value={form.milestoneType || 'progress'} onChange={event => onChange({ ...form, milestoneType: event.target.value as PaymentScheduleMilestoneType })}>
            {paymentMilestoneOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </FieldLabel>
        <FieldLabel label="Mô tả">
          <input className={inputClass} value={form.description} onChange={event => onChange({ ...form, description: event.target.value })} placeholder="VD: Đợt 1 - tạm ứng 30%" />
        </FieldLabel>
        <FieldLabel label="Đối tác">
          <input className={inputClass} value={form.contactName || ''} onChange={event => onChange({ ...form, contactName: event.target.value })} placeholder="Tên CĐT/NTP/NCC" />
        </FieldLabel>
        <FieldLabel label="Giá trị">
          <input
            className={inputClass}
            inputMode="numeric"
            value={form.amount ? Math.round(form.amount).toLocaleString('vi-VN') : ''}
            onChange={event => onChange({ ...form, amount: parseMoneyInput(event.target.value) })}
            placeholder="0"
          />
        </FieldLabel>
        <FieldLabel label="Ngày dự kiến">
          <input type="date" className={inputClass} value={form.dueDate || todayIso()} onChange={event => onChange({ ...form, dueDate: event.target.value })} />
        </FieldLabel>
        <FieldLabel label="Trạng thái">
          <select className={inputClass} value={form.status || 'pending'} onChange={event => onChange({ ...form, status: event.target.value as PaymentScheduleStatus })}>
            {paymentStatusOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </FieldLabel>
        <FieldLabel label="Đã thanh toán">
          <input
            className={inputClass}
            inputMode="numeric"
            value={form.paidAmount ? Math.round(form.paidAmount).toLocaleString('vi-VN') : ''}
            onChange={event => onChange({ ...form, paidAmount: parseMoneyInput(event.target.value) })}
            placeholder="0"
          />
        </FieldLabel>
        <FieldLabel label="Ngày thanh toán">
          <input type="date" className={inputClass} value={form.paidDate || ''} onChange={event => onChange({ ...form, paidDate: event.target.value || undefined })} />
        </FieldLabel>
        <FieldLabel label="Hồ sơ">
          <select className={inputClass} value={form.dossierStatus || 'not_started'} onChange={event => onChange({ ...form, dossierStatus: event.target.value as PaymentDossierStatus })}>
            {dossierStatusOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </FieldLabel>
        <FieldLabel label="Chất lượng">
          <select className={inputClass} value={form.qualityStatus || 'not_confirmed'} onChange={event => onChange({ ...form, qualityStatus: event.target.value as PaymentQualityStatus })}>
            {qualityStatusOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </FieldLabel>
        <FieldLabel label="Ghi chú">
          <input className={inputClass} value={form.note || ''} onChange={event => onChange({ ...form, note: event.target.value })} placeholder="Ghi chú nội bộ" />
        </FieldLabel>
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4 dark:border-slate-800">
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Hủy</button>
        <button type="button" onClick={onSave} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-4 py-2 text-xs font-black text-white hover:bg-orange-600 disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Lưu
        </button>
      </div>
    </div>
  </div>
);

const TransactionFormModal = ({
  form,
  saving,
  costItemOptions,
  partners,
  pendingFiles,
  onChange,
  onAddFiles,
  onRemovePendingFile,
  onRemoveAttachment,
  onClose,
  onSave,
}: {
  form: ProjectTransaction;
  saving: boolean;
  costItemOptions: ContractCostItemOption[];
  partners: BusinessPartner[];
  pendingFiles: File[];
  onChange: (next: ProjectTransaction) => void;
  onAddFiles: (files: File[]) => void;
  onRemovePendingFile: (index: number) => void;
  onRemoveAttachment: (index: number) => void;
  onClose: () => void;
  onSave: () => void;
}) => {
  const isExpense = form.type === 'expense';
  const handleTypeChange = (value: ProjectTxType) => {
    onChange(value === 'expense'
      ? { ...form, type: value }
      : { ...form, type: value, ...clearContractCostItemSnapshot() });
  };
  const handleCostItemChange = (id: string) => {
    const selected = costItemOptions.find(option => option.id === id)?.item;
    onChange(selected
      ? { ...applyContractCostItemToTransaction(form, selected), category: inferProjectCostCategoryFromCostItem(selected) }
      : { ...form, ...clearContractCostItemSnapshot() });
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div>
            <div className="text-sm font-black text-slate-900 dark:text-white">Giao dịch tài chính</div>
            <div className="mt-0.5 text-[11px] font-bold text-slate-400">Lưu vào sổ giao dịch công trình</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-700 dark:hover:bg-slate-800">
            <X size={16} />
          </button>
        </div>
        <div className="grid gap-3 p-5 md:grid-cols-2">
          <FieldLabel label="Loại giao dịch">
            <select className={inputClass} value={form.type} onChange={event => handleTypeChange(event.target.value as ProjectTxType)}>
              {txTypeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </FieldLabel>
          {isExpense && (
            <div className="md:col-span-2">
              <FieldLabel label="Khoản mục chi phí *">
                <select className={inputClass} value={form.contractCostItemId || ''} onChange={event => handleCostItemChange(event.target.value)}>
                  <option value="">Chọn khoản mục chi phí</option>
                  {costItemOptions.map(option => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </FieldLabel>
            </div>
          )}
          <FieldLabel label="Ngày">
            <input type="date" className={inputClass} value={form.date || todayIso()} onChange={event => onChange({ ...form, date: event.target.value })} />
          </FieldLabel>
          <FieldLabel label="Số tiền">
            <input
              className={inputClass}
              inputMode="numeric"
              value={form.amount ? Math.round(form.amount).toLocaleString('vi-VN') : ''}
              onChange={event => onChange({ ...form, amount: parseMoneyInput(event.target.value) })}
              placeholder="0"
            />
          </FieldLabel>
          <div className="md:col-span-2">
            <FieldLabel label="Nội dung">
              <input className={inputClass} value={form.description} onChange={event => onChange({ ...form, description: event.target.value })} placeholder="VD: Chi phí phát sinh công trường" />
            </FieldLabel>
          </div>
          <FieldLabel label="Đối tác">
            <PartnerSearchSelect
              value={form.counterpartyPartnerId || ''}
              partners={partners}
              legacyName={form.counterpartyName}
              onChange={partner => onChange({
                ...form,
                counterpartyPartnerId: partner?.id || null,
                counterpartyName: partner?.name || '',
              })}
              className="w-full"
              inputClassName="rounded-lg py-2.5 text-sm"
            />
          </FieldLabel>
          <FieldLabel label="Số hóa đơn/chứng từ">
            <input className={inputClass} value={form.invoiceNo || ''} onChange={event => onChange({ ...form, invoiceNo: event.target.value })} placeholder="VD: HD-001, UNC-001" />
          </FieldLabel>
          <FieldLabel label="Ngày hóa đơn/chứng từ">
            <input type="date" className={inputClass} value={form.invoiceDate || ''} onChange={event => onChange({ ...form, invoiceDate: event.target.value || null })} />
          </FieldLabel>
          <FieldLabel label="Mã tham chiếu">
            <input className={inputClass} value={form.sourceRef || ''} onChange={event => onChange({ ...form, sourceRef: event.target.value })} placeholder="Số chứng từ, phiếu thu/chi..." />
          </FieldLabel>
          <div className="md:col-span-2">
            <FieldLabel label="Tệp đính kèm">
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 px-3 py-3 text-xs font-black text-slate-500 hover:border-orange-300 hover:bg-orange-50 dark:border-slate-700 dark:hover:bg-slate-800">
                <Paperclip size={14} /> Chọn tệp đính kèm
                <input
                  type="file"
                  multiple
                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                  className="hidden"
                  onChange={event => {
                    onAddFiles(Array.from(event.target.files || []));
                    event.target.value = '';
                  }}
                />
              </label>
            </FieldLabel>
            {Boolean((form.attachments || []).length || pendingFiles.length) && (
              <div className="mt-2 flex flex-wrap gap-2">
                {(form.attachments || []).map((attachment, index) => (
                  <span key={`${attachment.url}-${index}`} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    <FileText size={11} /> {attachment.name}
                    <button type="button" onClick={() => onRemoveAttachment(index)} className="rounded p-0.5 text-slate-400 hover:bg-white hover:text-red-500 dark:hover:bg-slate-700">
                      <X size={10} />
                    </button>
                  </span>
                ))}
                {pendingFiles.map((file, index) => (
                  <span key={`${file.name}-${index}`} className="inline-flex items-center gap-1 rounded-md bg-orange-50 px-2 py-1 text-[10px] font-bold text-orange-700 dark:bg-orange-950/30 dark:text-orange-300">
                    <Upload size={11} /> {file.name}
                    <button type="button" onClick={() => onRemovePendingFile(index)} className="rounded p-0.5 text-orange-400 hover:bg-white hover:text-red-500 dark:hover:bg-slate-700">
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4 dark:border-slate-800">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Hủy</button>
          <button type="button" onClick={onSave} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-4 py-2 text-xs font-black text-white hover:bg-orange-600 disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Lưu
          </button>
        </div>
      </div>
    </div>
  );
};

const PurchaseOrderPaymentModal = ({
  form,
  saving,
  onChange,
  onClose,
  onSave,
}: {
  form: PurchaseOrderPaymentForm;
  saving: boolean;
  onChange: (next: PurchaseOrderPaymentForm) => void;
  onClose: () => void;
  onSave: () => void;
}) => {
  const row = form.row;
  const metricClass = 'rounded-lg border border-slate-100 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div>
            <div className="text-[11px] font-black uppercase tracking-wide text-emerald-600">Ghi thanh toán NCC</div>
            <div className="mt-1 text-base font-black text-slate-900 dark:text-white">{row.documentNo}</div>
            <div className="mt-0.5 text-xs font-bold text-slate-400">{row.counterpartyName}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-700 dark:hover:bg-slate-800">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className={metricClass}>
              <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Giá trị</div>
              <div className="mt-1 text-sm font-black text-slate-800 dark:text-slate-100">{fmtMoney(row.committedAmount)}</div>
            </div>
            <div className={metricClass}>
              <div className="text-[10px] font-black uppercase tracking-wide text-blue-500">Được ghi nhận</div>
              <div className="mt-1 text-sm font-black text-blue-700">{fmtMoney(row.recognizedAmount)}</div>
            </div>
            <div className={metricClass}>
              <div className="text-[10px] font-black uppercase tracking-wide text-emerald-500">Đã thanh toán</div>
              <div className="mt-1 text-sm font-black text-emerald-700">{fmtMoney(row.paidAmount)}</div>
            </div>
            <div className={metricClass}>
              <div className="text-[10px] font-black uppercase tracking-wide text-red-500">Còn phải trả</div>
              <div className="mt-1 text-sm font-black text-red-700">{fmtMoney(row.outstandingAmount)}</div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <FieldLabel label="Ngày thanh toán">
              <input type="date" className={inputClass} value={form.date || todayIso()} onChange={event => onChange({ ...form, date: event.target.value })} />
            </FieldLabel>
            <FieldLabel label="Số tiền thanh toán">
              <input
                className={inputClass}
                inputMode="numeric"
                value={form.amount ? Math.round(form.amount).toLocaleString('vi-VN') : ''}
                onChange={event => onChange({ ...form, amount: parseMoneyInput(event.target.value) })}
                placeholder="0"
              />
              <div className="mt-1 text-[10px] font-bold text-slate-400">Tối đa {fmtMoney(row.outstandingAmount)}</div>
            </FieldLabel>
            <FieldLabel label="Mã chứng từ">
              <input className={inputClass} value={form.documentRef} onChange={event => onChange({ ...form, documentRef: event.target.value })} placeholder="VD: UNC-001, PC-001" />
            </FieldLabel>
            <FieldLabel label="Ghi chú">
              <input className={inputClass} value={form.note} onChange={event => onChange({ ...form, note: event.target.value })} placeholder="Ghi chú thanh toán" />
            </FieldLabel>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4 dark:border-slate-800">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Hủy</button>
          <button type="button" onClick={onSave} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Ghi thanh toán
          </button>
        </div>
      </div>
    </div>
  );
};

const SupplierPaymentBatchModal = ({
  form,
  supplierRows,
  saving,
  onClose,
  onSelectSupplier,
  onChange,
  onManualAllocationChange,
  onSave,
}: {
  form: SupplierPaymentBatchFormState;
  supplierRows: ProjectFinancePayableRow[];
  saving: boolean;
  onClose: () => void;
  onSelectSupplier: (supplierId: string) => void;
  onChange: (next: SupplierPaymentBatchFormState) => void;
  onManualAllocationChange: (documentId: string, amount: number) => void;
  onSave: () => void;
}) => {
  const documents = form.documents.filter(document => Number(document.outstandingAmount || 0) > 0);
  const allocations = allocateSupplierPayment({
    mode: form.allocationMode,
    paymentBatchId: form.batchId,
    amount: form.amount,
    documents,
    manualAllocations: form.manualAllocations,
  });
  const allocatedByDocument = new Map(allocations.map(allocation => [allocation.payableDocumentId, allocation.allocatedAmount]));
  const totalAllocated = allocations.reduce((sum, allocation) => sum + Number(allocation.allocatedAmount || 0), 0);
  const allocationDiff = form.amount - totalAllocated;
  const supplierLocked = Boolean(form.lockedDocumentIds?.length);

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div>
            <div className="text-[11px] font-black uppercase tracking-wide text-emerald-600">Thanh toán NCC theo đợt</div>
            <div className="mt-1 text-base font-black text-slate-900 dark:text-white">{form.supplierName || 'Chọn nhà cung cấp'}</div>
            <div className="mt-0.5 text-xs font-bold text-slate-400">Phân bổ theo AP document, post qua RPC atomic.</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-700 dark:hover:bg-slate-800">
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
            <div className="space-y-3 rounded-lg border border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/40">
              <FieldLabel label="Nhà cung cấp">
                <select
                  className={inputClass}
                  value={form.supplierId}
                  disabled={supplierLocked}
                  onChange={event => onSelectSupplier(event.target.value)}
                >
                  <option value="">Chọn NCC còn công nợ</option>
                  {supplierRows.map(row => (
                    <option key={row.id} value={row.sourceId}>
                      {row.counterpartyName} - còn {fmtMoney(row.outstandingAmount)}
                    </option>
                  ))}
                </select>
              </FieldLabel>
              <div className="grid grid-cols-2 gap-3">
                <FieldLabel label="Ngày thanh toán">
                  <input
                    type="date"
                    className={inputClass}
                    value={form.paymentDate}
                    onChange={event => onChange({ ...form, paymentDate: event.target.value, periodMonth: toPeriodMonth(event.target.value) })}
                  />
                </FieldLabel>
                <FieldLabel label="Kỳ">
                  <input
                    type="month"
                    className={inputClass}
                    value={(form.periodMonth || toPeriodMonth(form.paymentDate)).slice(0, 7)}
                    onChange={event => onChange({ ...form, periodMonth: `${event.target.value}-01` })}
                  />
                </FieldLabel>
              </div>
              <FieldLabel label="Số tiền thanh toán">
                <input
                  className={inputClass}
                  inputMode="numeric"
                  value={form.amount ? Math.round(form.amount).toLocaleString('vi-VN') : ''}
                  onChange={event => onChange({ ...form, amount: parseMoneyInput(event.target.value) })}
                  placeholder="0"
                />
              </FieldLabel>
              <FieldLabel label="Phương thức">
                <select className={inputClass} value={form.paymentMethod} onChange={event => onChange({ ...form, paymentMethod: event.target.value as SupplierPaymentMethod })}>
                  {supplierPaymentMethodOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </FieldLabel>
              <FieldLabel label="Chế độ phân bổ">
                <select
                  className={inputClass}
                  value={form.allocationMode}
                  onChange={event => {
                    const nextMode = event.target.value as SupplierPaymentAllocationMode;
                    const nextAllocations = allocateSupplierPayment({
                      mode: nextMode === 'manual' ? form.allocationMode : nextMode,
                      paymentBatchId: form.batchId,
                      amount: form.amount,
                      documents,
                      manualAllocations: form.manualAllocations,
                    });
                    const manualAllocations = nextMode === 'manual'
                      ? Object.fromEntries(nextAllocations.map(allocation => [allocation.payableDocumentId, allocation.allocatedAmount]))
                      : form.manualAllocations;
                    onChange({ ...form, allocationMode: nextMode, manualAllocations });
                  }}
                >
                  {supplierPaymentAllocationModeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </FieldLabel>
              <FieldLabel label="Mã chứng từ">
                <input className={inputClass} value={form.documentRef} onChange={event => onChange({ ...form, documentRef: event.target.value })} placeholder="VD: UNC-001, PC-001" />
              </FieldLabel>
              <FieldLabel label="Ghi chú">
                <textarea className={`${inputClass} min-h-20 resize-none`} value={form.note} onChange={event => onChange({ ...form, note: event.target.value })} placeholder="Ghi chú thanh toán" />
              </FieldLabel>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-lg bg-white p-3 dark:bg-slate-900">
                  <div className="text-[10px] font-black uppercase text-slate-400">Số tiền</div>
                  <div className="mt-1 font-black text-slate-800 dark:text-slate-100">{fmtMoney(form.amount)}</div>
                </div>
                <div className="rounded-lg bg-white p-3 dark:bg-slate-900">
                  <div className="text-[10px] font-black uppercase text-emerald-500">Phân bổ</div>
                  <div className="mt-1 font-black text-emerald-700">{fmtMoney(totalAllocated)}</div>
                </div>
                <div className="rounded-lg bg-white p-3 dark:bg-slate-900">
                  <div className="text-[10px] font-black uppercase text-amber-500">Lệch</div>
                  <div className={`mt-1 font-black ${allocationDiff === 0 ? 'text-emerald-700' : 'text-amber-700'}`}>{fmtMoney(allocationDiff)}</div>
                </div>
              </div>
            </div>

            <div className="min-w-0 rounded-lg border border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-950">
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <div>
                  <div className="text-xs font-black text-slate-800 dark:text-slate-100">Chứng từ AP còn phải trả</div>
                  <div className="mt-0.5 text-[10px] font-bold text-slate-400">Preview outstanding sau thanh toán theo từng chứng từ.</div>
                </div>
                {form.loadingDocuments && <Loader2 size={16} className="animate-spin text-orange-500" />}
              </div>
              <div className="max-h-[520px] overflow-auto">
                {form.documentError && <div className="m-4 rounded-lg border border-red-100 bg-red-50 p-3 text-xs font-bold text-red-700">{form.documentError}</div>}
                {!form.loadingDocuments && !form.documentError && documents.length === 0 && (
                  <div className="p-4"><EmptyState label="Chưa có chứng từ AP còn nợ cho NCC này." /></div>
                )}
                {documents.length > 0 && (
                  <table className="w-full min-w-[760px] text-left text-xs">
                    <thead className="sticky top-0 bg-slate-50 text-[10px] font-black uppercase text-slate-400 dark:bg-slate-900">
                      <tr>
                        <th className="px-3 py-2">Chứng từ</th>
                        <th className="px-3 py-2 text-right">Ghi nhận</th>
                        <th className="px-3 py-2 text-right">Đã TT</th>
                        <th className="px-3 py-2 text-right">Còn nợ</th>
                        <th className="px-3 py-2 text-right">Phân bổ</th>
                        <th className="px-3 py-2 text-right">Sau TT</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                      {documents.map(document => {
                        const allocatedAmount = allocatedByDocument.get(document.id) || 0;
                        return (
                          <tr key={document.id}>
                            <td className="px-3 py-3">
                              <div className="font-black text-slate-800 dark:text-slate-100">{document.code || document.documentNo}</div>
                              <div className="mt-0.5 text-[10px] font-bold text-slate-400">{supplierPayableSourceLabel(document.sourceType)} • {fmtDate(document.documentDate)}</div>
                            </td>
                            <td className="px-3 py-3 text-right font-bold text-blue-700">{fmtMoney(document.recognizedAmount)}</td>
                            <td className="px-3 py-3 text-right text-emerald-700">{fmtMoney(document.paidAmount)}</td>
                            <td className="px-3 py-3 text-right font-black text-red-600">{fmtMoney(document.outstandingAmount)}</td>
                            <td className="px-3 py-3 text-right">
                              {form.allocationMode === 'manual' ? (
                                <input
                                  className="w-28 rounded-lg border border-slate-200 px-2 py-1.5 text-right text-xs font-black text-emerald-700 outline-none focus:border-emerald-300 dark:border-slate-700 dark:bg-slate-900"
                                  inputMode="numeric"
                                  value={allocatedAmount ? Math.round(allocatedAmount).toLocaleString('vi-VN') : ''}
                                  onChange={event => onManualAllocationChange(document.id, parseMoneyInput(event.target.value))}
                                />
                              ) : (
                                <span className="font-black text-emerald-700">{fmtMoney(allocatedAmount)}</span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-right font-black text-slate-700 dark:text-slate-200">
                              {fmtMoney(Math.max(0, Number(document.outstandingAmount || 0) - allocatedAmount))}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-100 px-5 py-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
          <div className={`text-xs font-bold ${allocationDiff === 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
            {allocationDiff === 0 ? 'Số tiền và phân bổ đã khớp.' : `Cần phân bổ khớp số tiền, còn lệch ${fmtMoney(allocationDiff)}.`}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Hủy</button>
            <button type="button" onClick={onSave} disabled={saving || form.loadingDocuments} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-50">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Ghi thanh toán
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const SupplierPaymentBatchPanel = ({
  batches,
  loading,
  canManage,
  onCreate,
  onOpenDetail,
  onOpenTrace,
}: {
  batches: SupplierPaymentBatch[];
  loading: boolean;
  canManage?: boolean;
  onCreate: () => void;
  onOpenDetail: (batchId: string) => void;
  onOpenTrace: (batch: SupplierPaymentBatch) => void;
}) => (
  <section className="space-y-3">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h4 className="text-sm font-black text-slate-800 dark:text-white">Thanh toán NCC</h4>
        <p className="mt-0.5 text-[11px] font-bold text-slate-400">Tạo đợt thanh toán và xem phân bổ theo từng chứng từ AP.</p>
      </div>
      {canManage && (
        <button type="button" onClick={onCreate} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700">
          <Plus size={14} /> Tạo đợt thanh toán
        </button>
      )}
    </div>
    {loading ? (
      <div className="rounded-lg border border-slate-100 bg-white p-8 text-center text-sm font-bold text-slate-400 dark:border-slate-700 dark:bg-slate-900">
        <Loader2 size={18} className="mx-auto mb-2 animate-spin text-emerald-600" /> Đang tải đợt thanh toán...
      </div>
    ) : batches.length === 0 ? (
      <EmptyState label="Chưa có đợt thanh toán NCC trong phạm vi này." />
    ) : (
      <div className="overflow-x-auto rounded-lg border border-slate-100 bg-white dark:border-slate-700 dark:bg-slate-900">
        <table className="w-full min-w-[880px] text-left text-xs">
          <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wide text-slate-400 dark:bg-slate-800">
            <tr>
              <th className="px-3 py-2">Batch</th>
              <th className="px-3 py-2">NCC</th>
              <th className="px-3 py-2">Kỳ</th>
              <th className="px-3 py-2">Ngày TT</th>
              <th className="px-3 py-2 text-right">Số tiền</th>
              <th className="px-3 py-2 text-center">Trạng thái</th>
              <th className="px-3 py-2 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
            {batches.map(batch => (
              <tr key={batch.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/60">
                <td className="px-3 py-3 font-mono font-black text-slate-800 dark:text-slate-100">{batch.code}</td>
                <td className="px-3 py-3 font-bold text-slate-600 dark:text-slate-300">{batch.supplierNameSnapshot}</td>
                <td className="px-3 py-3 font-bold text-slate-500">{fmtPeriodMonth(batch.periodMonth)}</td>
                <td className="px-3 py-3 font-bold text-slate-500">{fmtDate(batch.paymentDate)}</td>
                <td className="px-3 py-3 text-right font-black text-emerald-700">{fmtMoney(batch.paymentAmount || batch.amount)}</td>
                <td className="px-3 py-3 text-center"><span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-black ${statusTone(batch.status)}`}>{statusLabel(batch.status)}</span></td>
                <td className="px-3 py-3 text-right">
                  <div className="flex justify-end gap-1">
                    <button type="button" onClick={() => onOpenTrace(batch)} className="rounded-md px-2 py-1 text-[10px] font-black text-blue-700 hover:bg-blue-50">
                      <QrCode size={11} className="inline" /> Truy vết
                    </button>
                    <button type="button" onClick={() => onOpenDetail(batch.id)} className="rounded-md px-2 py-1 text-[10px] font-black text-emerald-700 hover:bg-emerald-50">
                      Chi tiết
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </section>
);

const SiteCashSettlementPanel = ({
  batches,
  loading,
  canManage,
  onCreate,
  onOpenDetail,
  onOpenTrace,
}: {
  batches: SiteCashSettlementBatch[];
  loading: boolean;
  canManage?: boolean;
  onCreate: () => void;
  onOpenDetail: (batchId: string) => void;
  onOpenTrace: (batch: SiteCashSettlementBatch) => void;
}) => (
  <section className="space-y-3">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h4 className="text-sm font-black text-slate-800 dark:text-white">Hoàn ứng công trường</h4>
        <p className="mt-0.5 text-[11px] font-bold text-slate-400">Đối chiếu quỹ công trường, cá nhân ứng trước và các phiếu mua nóng.</p>
      </div>
      {canManage && (
        <button type="button" onClick={onCreate} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-black text-white hover:bg-blue-700">
          <Plus size={14} /> Tạo bộ hoàn ứng
        </button>
      )}
    </div>
    {loading ? (
      <div className="rounded-lg border border-slate-100 bg-white p-8 text-center text-sm font-bold text-slate-400 dark:border-slate-700 dark:bg-slate-900">
        <Loader2 size={18} className="mx-auto mb-2 animate-spin text-blue-600" /> Đang tải bộ hoàn ứng...
      </div>
    ) : batches.length === 0 ? (
      <EmptyState label="Chưa có bộ hoàn ứng công trường trong phạm vi này." />
    ) : (
      <div className="overflow-x-auto rounded-lg border border-slate-100 bg-white dark:border-slate-700 dark:bg-slate-900">
        <table className="w-full min-w-[980px] text-left text-xs">
          <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wide text-slate-400 dark:bg-slate-800">
            <tr>
              <th className="px-3 py-2">Bộ hoàn ứng</th>
              <th className="px-3 py-2">Kỳ</th>
              <th className="px-3 py-2 text-right">Chi quỹ</th>
              <th className="px-3 py-2 text-right">Cá nhân ứng</th>
              <th className="px-3 py-2 text-right">Đã hoàn</th>
              <th className="px-3 py-2 text-right">Tồn cuối</th>
              <th className="px-3 py-2 text-center">Trạng thái</th>
              <th className="px-3 py-2 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
            {batches.map(batch => (
              <tr key={batch.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/60">
                <td className="px-3 py-3 font-mono font-black text-slate-800 dark:text-slate-100">{batch.code}</td>
                <td className="px-3 py-3 font-bold text-slate-500">{fmtPeriodMonth(batch.periodMonth)}</td>
                <td className="px-3 py-3 text-right font-black text-blue-700">{fmtMoney(batch.approvedSiteCashSpend || 0)}</td>
                <td className="px-3 py-3 text-right font-bold text-amber-700">{fmtMoney(batch.approvedStaffPaidAmount || 0)}</td>
                <td className="px-3 py-3 text-right font-bold text-emerald-700">{fmtMoney(batch.staffReimbursedAmount || 0)}</td>
                <td className="px-3 py-3 text-right font-black text-slate-800 dark:text-slate-100">{fmtMoney(batch.closingBalance || 0)}</td>
                <td className="px-3 py-3 text-center"><span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-black ${statusTone(batch.status)}`}>{statusLabel(batch.status)}</span></td>
                <td className="px-3 py-3 text-right">
                  <div className="flex justify-end gap-1">
                    <button type="button" onClick={() => onOpenTrace(batch)} className="rounded-md px-2 py-1 text-[10px] font-black text-blue-700 hover:bg-blue-50">
                      <QrCode size={11} className="inline" /> Truy vết
                    </button>
                    <button type="button" onClick={() => onOpenDetail(batch.id)} className="rounded-md px-2 py-1 text-[10px] font-black text-blue-700 hover:bg-blue-50">
                      Chi tiết
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </section>
);

const SiteCashSettlementDetailDrawer = ({
  state,
  saving,
  posting,
  onClose,
  onBatchChange,
  onLineChange,
  onSave,
  onPost,
  onReverse,
  onOpenSource,
  onOpenTrace,
  cashFunds,
  loadingCashFunds,
}: {
  state: SiteCashSettlementDetailState | null;
  saving: boolean;
  posting: boolean;
  cashFunds: CashFund[];
  loadingCashFunds: boolean;
  onClose: () => void;
  onBatchChange: (batch: SiteCashSettlementBatch) => void;
  onLineChange: (line: SiteCashSettlementLine) => void;
  onSave: () => void;
  onPost: () => void;
  onReverse: () => void;
  onOpenSource: (line: SiteCashSettlementLine) => void;
  onOpenTrace: (batch: SiteCashSettlementBatch) => void;
}) => {
  if (!state) return null;
  const batch = state.batch || null;
  const summary = batch ? calculateSiteCashSettlementSummary({
    openingBalance: batch.openingBalance,
    topupAmount: batch.topupAmount,
    lines: state.lines,
  }) : null;
  const isLocked = batch ? ['approved', 'closed', 'reversed', 'cancelled'].includes(batch.status) : true;
  const selectedCashFund = batch?.cashFundId ? cashFunds.find(fund => fund.id === batch.cashFundId) : null;
  return (
    <div className="fixed inset-0 z-[1000] flex justify-end bg-slate-950/40" onClick={event => event.target === event.currentTarget && onClose()}>
      <div className="flex h-full w-full max-w-[920px] flex-col bg-white shadow-2xl dark:bg-slate-950">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[11px] font-black uppercase tracking-wide text-blue-600">Hoàn ứng công trường</div>
              <h3 className="mt-1 truncate text-base font-black text-slate-900 dark:text-white">{batch?.code || state.batchId}</h3>
              <p className="mt-0.5 text-xs font-bold text-slate-500">{batch ? `${fmtPeriodMonth(batch.periodMonth)} • ${statusLabel(batch.status)}` : 'Đang tải...'}</p>
            </div>
            <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
              <X size={18} />
            </button>
          </div>
          {batch && (
            <button
              type="button"
              onClick={() => onOpenTrace(batch)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-black text-blue-700 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300"
            >
              <QrCode size={14} /> Truy vết
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/70 p-5 dark:bg-slate-900/40">
          {state.loading && (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-100 bg-white p-8 text-sm font-bold text-slate-400 dark:border-slate-800 dark:bg-slate-950">
              <Loader2 size={16} className="animate-spin text-blue-600" /> Đang tải bộ hoàn ứng...
            </div>
          )}
          {!state.loading && state.error && <div className="rounded-lg border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-700">{state.error}</div>}
          {!state.loading && !state.error && batch && summary && (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-5">
                <label className="rounded-lg border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                  <span className="text-[10px] font-black uppercase text-slate-400">Quỹ</span>
                  <select
                    disabled={isLocked || loadingCashFunds}
                    value={batch.cashFundId || ''}
                    onChange={event => onBatchChange({ ...batch, cashFundId: event.target.value || null })}
                    className="mt-1 w-full bg-transparent text-xs font-black text-slate-800 outline-none dark:text-white"
                  >
                    <option value="">{loadingCashFunds ? 'Đang tải quỹ...' : 'Chưa chọn quỹ'}</option>
                    {cashFunds.map(fund => <option key={fund.id} value={fund.id}>{fund.name}</option>)}
                  </select>
                  {selectedCashFund && <div className="mt-1 truncate text-[10px] font-bold text-slate-400">{fmtMoney(selectedCashFund.openingBalance)}</div>}
                </label>
                <label className="rounded-lg border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                  <span className="text-[10px] font-black uppercase text-slate-400">Tồn đầu</span>
                  <input
                    disabled={isLocked}
                    value={batch.openingBalance.toLocaleString('vi-VN')}
                    onChange={event => onBatchChange({ ...batch, openingBalance: parseMoneyInput(event.target.value) })}
                    className="mt-1 w-full bg-transparent text-sm font-black text-slate-800 outline-none dark:text-white"
                  />
                </label>
                <label className="rounded-lg border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                  <span className="text-[10px] font-black uppercase text-slate-400">Nạp thêm</span>
                  <input
                    disabled={isLocked}
                    value={batch.topupAmount.toLocaleString('vi-VN')}
                    onChange={event => onBatchChange({ ...batch, topupAmount: parseMoneyInput(event.target.value) })}
                    className="mt-1 w-full bg-transparent text-sm font-black text-slate-800 outline-none dark:text-white"
                  />
                </label>
                <div className="rounded-lg border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                  <div className="text-[10px] font-black uppercase text-slate-400">Đã hoàn cá nhân</div>
                  <div className="mt-1 text-sm font-black text-emerald-700">{fmtMoney(summary.staffReimbursedAmount)}</div>
                </div>
                <div className="rounded-lg border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                  <div className="text-[10px] font-black uppercase text-slate-400">Tồn cuối</div>
                  <div className={`mt-1 text-sm font-black ${summary.endingBalance < 0 ? 'text-red-600' : 'text-blue-700'}`}>{fmtMoney(summary.endingBalance)}</div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <KpiCard label="Claim" value={summary.claimedAmount} icon={ReceiptText} tone="slate" />
                <KpiCard label="Chi quỹ duyệt" value={summary.approvedSiteCashSpend} icon={Banknote} tone="blue" />
                <KpiCard label="Cá nhân ứng duyệt" value={summary.approvedStaffPaidAmount} icon={WalletCards} tone="amber" />
                <KpiCard label="Còn phải hoàn" value={summary.staffOutstandingAmount} icon={AlertTriangle} tone={summary.staffOutstandingAmount > 0 ? 'red' : 'green'} />
              </div>

              <div className="rounded-lg border border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-950">
                <div className="border-b border-slate-100 px-4 py-3 text-xs font-black text-slate-800 dark:border-slate-800 dark:text-slate-100">Dòng chứng từ</div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] text-left text-xs">
                    <thead className="bg-slate-50 text-[10px] font-black uppercase text-slate-400 dark:bg-slate-900">
                      <tr>
                        <th className="px-3 py-2">Chứng từ</th>
                        <th className="px-3 py-2">Nguồn tiền</th>
                        <th className="px-3 py-2 text-right">Claim</th>
                        <th className="px-3 py-2 text-right">Duyệt</th>
                        <th className="px-3 py-2 text-right">Hoàn cá nhân</th>
                        <th className="px-3 py-2 text-center">Trạng thái</th>
                        <th className="px-3 py-2 text-right">Nguồn</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                      {state.lines.map(line => (
                        <tr key={line.id}>
                          <td className="px-3 py-3">
                            <div className="font-mono font-black text-slate-800 dark:text-slate-100">{line.documentNoSnapshot || line.sourceId}</div>
                            <div className="mt-0.5 text-[10px] font-bold text-slate-400">{line.supplierNameSnapshot || line.description || '-'}</div>
                          </td>
                          <td className="px-3 py-3 font-bold text-slate-500">
                            {line.paymentSource === 'staff_paid' ? 'Cá nhân ứng trước' : line.paymentSource === 'site_cash' ? 'Quỹ công trường' : line.paymentSource || '-'}
                          </td>
                          <td className="px-3 py-3 text-right font-bold text-slate-700 dark:text-slate-200">{fmtMoney(line.claimedAmount)}</td>
                          <td className="px-3 py-3 text-right">
                            <input
                              disabled={isLocked || line.status === 'rejected'}
                              value={(line.approvedAmount || 0).toLocaleString('vi-VN')}
                              onChange={event => {
                                const approvedAmount = parseMoneyInput(event.target.value);
                                onLineChange({
                                  ...line,
                                  approvedAmount,
                                  fundSpendAmount: line.paymentSource === 'site_cash' ? approvedAmount : 0,
                                  staffClaimAmount: line.paymentSource === 'staff_paid' ? Math.max(line.staffClaimAmount || 0, approvedAmount) : 0,
                                  staffReimbursedAmount: line.paymentSource === 'staff_paid' ? Math.min(line.staffReimbursedAmount || 0, approvedAmount) : 0,
                                });
                              }}
                              className="w-28 rounded-md border border-slate-200 bg-white px-2 py-1 text-right font-black text-blue-700 outline-none focus:border-blue-300 disabled:bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
                            />
                          </td>
                          <td className="px-3 py-3 text-right">
                            <input
                              disabled={isLocked || line.paymentSource !== 'staff_paid' || line.status === 'rejected'}
                              value={(line.staffReimbursedAmount || 0).toLocaleString('vi-VN')}
                              onChange={event => onLineChange({ ...line, staffReimbursedAmount: Math.min(parseMoneyInput(event.target.value), line.approvedAmount || 0) })}
                              className="w-28 rounded-md border border-slate-200 bg-white px-2 py-1 text-right font-black text-emerald-700 outline-none focus:border-emerald-300 disabled:bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
                            />
                          </td>
                          <td className="px-3 py-3 text-center">
                            <select
                              disabled={isLocked}
                              value={line.status}
                              onChange={event => {
                                const status = event.target.value as SiteCashSettlementLine['status'];
                                onLineChange({
                                  ...line,
                                  status,
                                  approvedAmount: status === 'rejected' ? 0 : line.approvedAmount,
                                  fundSpendAmount: status === 'rejected' ? 0 : line.fundSpendAmount,
                                  staffReimbursedAmount: status === 'rejected' ? 0 : line.staffReimbursedAmount,
                                });
                              }}
                              className={`rounded-full border px-2 py-1 text-[10px] font-black outline-none ${statusTone(line.status)}`}
                            >
                              <option value="pending">Chờ review</option>
                              <option value="accepted">Chấp nhận</option>
                              <option value="adjusted">Điều chỉnh</option>
                              <option value="rejected">Từ chối</option>
                            </select>
                          </td>
                          <td className="px-3 py-3 text-right">
                            <button type="button" onClick={() => onOpenSource(line)} className="rounded-md px-2 py-1 text-[10px] font-black text-blue-700 hover:bg-blue-50">
                              <ExternalLink size={11} className="inline" /> Mở
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
        {batch && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-4 dark:border-slate-800">
            {!isLocked && (
              <button type="button" onClick={onSave} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Lưu nháp
              </button>
            )}
            {!isLocked && (
              <button type="button" onClick={onPost} disabled={posting} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-black text-white hover:bg-blue-700 disabled:opacity-50">
                {posting ? <Loader2 size={14} className="animate-spin" /> : <CreditCard size={14} />} Duyệt hoàn ứng
              </button>
            )}
            {['approved', 'closed'].includes(batch.status) && (
              <button type="button" onClick={onReverse} disabled={posting} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs font-black text-red-700 hover:bg-red-100 disabled:opacity-50">
                {posting ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />} Đảo hoàn ứng
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const SupplierPaymentBatchDetailDrawer = ({
  state,
  reversing,
  onClose,
  onReverse,
  onOpenTrace,
}: {
  state: SupplierPaymentBatchDetailState | null;
  reversing: boolean;
  onClose: () => void;
  onReverse: (batch: SupplierPaymentBatch) => void;
  onOpenTrace: (batch: SupplierPaymentBatch) => void;
}) => {
  if (!state) return null;
  const batch = state.batch || null;
  return (
    <div className="fixed inset-0 z-[1000] flex justify-end bg-slate-950/40" onClick={event => event.target === event.currentTarget && onClose()}>
      <div className="flex h-full w-full max-w-[760px] flex-col bg-white shadow-2xl dark:bg-slate-950">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[11px] font-black uppercase tracking-wide text-emerald-600">Chi tiết thanh toán NCC</div>
              <h3 className="mt-1 truncate text-base font-black text-slate-900 dark:text-white">{batch?.code || state.batchId}</h3>
              <p className="mt-0.5 text-xs font-bold text-slate-500">{batch?.supplierNameSnapshot || 'Đang tải...'}</p>
            </div>
            <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
              <X size={18} />
            </button>
          </div>
          {batch && (
            <button
              type="button"
              onClick={() => onOpenTrace(batch)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-black text-blue-700 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300"
            >
              <QrCode size={14} /> Truy vết
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/70 p-5 dark:bg-slate-900/40">
          {state.loading && (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-100 bg-white p-8 text-sm font-bold text-slate-400 dark:border-slate-800 dark:bg-slate-950">
              <Loader2 size={16} className="animate-spin text-emerald-600" /> Đang tải batch...
            </div>
          )}
          {!state.loading && state.error && <div className="rounded-lg border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-700">{state.error}</div>}
          {!state.loading && !state.error && batch && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                  <div className="text-[10px] font-black uppercase text-slate-400">Số tiền</div>
                  <div className="mt-1 text-sm font-black text-emerald-700">{fmtMoney(batch.paymentAmount || batch.amount)}</div>
                </div>
                <div className="rounded-lg border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                  <div className="text-[10px] font-black uppercase text-slate-400">Trạng thái</div>
                  <span className={`mt-1 inline-flex rounded-full border px-2 py-1 text-[10px] font-black ${statusTone(batch.status)}`}>{statusLabel(batch.status)}</span>
                </div>
                <div className="rounded-lg border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                  <div className="text-[10px] font-black uppercase text-slate-400">Ngày TT</div>
                  <div className="mt-1 text-sm font-black text-slate-700 dark:text-slate-200">{fmtDate(batch.paymentDate)}</div>
                </div>
                <div className="rounded-lg border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                  <div className="text-[10px] font-black uppercase text-slate-400">Giao dịch</div>
                  <div className="mt-1 truncate text-xs font-black text-slate-700 dark:text-slate-200">{batch.projectTransactionId || '-'}</div>
                </div>
              </div>
              <div className="rounded-lg border border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-950">
                <div className="border-b border-slate-100 px-4 py-3 text-xs font-black text-slate-800 dark:border-slate-800 dark:text-slate-100">Phân bổ AP</div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-left text-xs">
                    <thead className="bg-slate-50 text-[10px] font-black uppercase text-slate-400 dark:bg-slate-900">
                      <tr>
                        <th className="px-3 py-2">Chứng từ</th>
                        <th className="px-3 py-2">Nguồn</th>
                        <th className="px-3 py-2 text-right">Trước TT</th>
                        <th className="px-3 py-2 text-right">Phân bổ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                      {state.allocations.map(allocation => (
                        <tr key={allocation.id}>
                          <td className="px-3 py-3 font-black text-slate-800 dark:text-slate-100">{allocation.documentNoSnapshot || allocation.payableDocumentId}</td>
                          <td className="px-3 py-3 font-bold text-slate-500">{allocation.sourceType ? supplierPayableSourceLabel(allocation.sourceType) : '-'}</td>
                          <td className="px-3 py-3 text-right font-bold text-red-600">{fmtMoney(allocation.outstandingBeforeSnapshot || 0)}</td>
                          <td className="px-3 py-3 text-right font-black text-emerald-700">{fmtMoney(allocation.allocatedAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
        {batch?.status === 'paid' && (
          <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4 dark:border-slate-800">
            <button type="button" onClick={() => onReverse(batch)} disabled={reversing} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs font-black text-red-700 hover:bg-red-100 disabled:opacity-50">
              {reversing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />} Đảo thanh toán
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const SupplierPayableDocumentsDrawer = ({
  state,
  onClose,
  onOpenDocumentSource,
  onOpenTrace,
}: {
  state: SupplierPayableDocumentDrawerState | null;
  onClose: () => void;
  onOpenDocumentSource: (document: SupplierPayableDocument) => void;
  onOpenTrace: (document: SupplierPayableDocument) => void;
}) => {
  if (!state) return null;
  const { row, documents, loading, error } = state;
  return (
    <div className="fixed inset-0 z-[1000] flex justify-end bg-slate-950/40" onClick={event => event.target === event.currentTarget && onClose()}>
      <div className="flex h-full w-full max-w-[720px] flex-col bg-white shadow-2xl dark:bg-slate-950">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full border border-orange-100 bg-orange-50 px-2 py-0.5 text-[10px] font-black text-orange-700">
                  <FileText size={11} /> AP NCC
                </span>
                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${statusTone(row.status)}`}>{statusLabel(row.status)}</span>
              </div>
              <h3 className="mt-2 truncate text-base font-black text-slate-900 dark:text-white">{row.counterpartyName}</h3>
              <p className="mt-0.5 text-xs font-bold text-slate-500">{row.description}</p>
            </div>
            <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 border-b border-slate-100 px-5 py-3 text-xs dark:border-slate-800">
          <div>
            <div className="text-[10px] font-black uppercase text-slate-400">Ghi nhận</div>
            <div className="mt-1 font-black text-blue-700">{fmtMoney(row.recognizedAmount)}</div>
          </div>
          <div>
            <div className="text-[10px] font-black uppercase text-slate-400">Đã TT</div>
            <div className="mt-1 font-black text-emerald-700">{fmtMoney(row.paidAmount)}</div>
          </div>
          <div>
            <div className="text-[10px] font-black uppercase text-slate-400">Còn phải trả</div>
            <div className="mt-1 font-black text-red-600">{fmtMoney(row.outstandingAmount)}</div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/70 p-5 dark:bg-slate-900/40">
          {loading && (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-100 bg-white p-8 text-sm font-bold text-slate-400 dark:border-slate-800 dark:bg-slate-950">
              <Loader2 size={16} className="animate-spin text-orange-500" /> Đang tải chứng từ AP...
            </div>
          )}
          {!loading && error && (
            <div className="rounded-lg border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-700">
              {error}
            </div>
          )}
          {!loading && !error && documents.length === 0 && (
            <EmptyState label="Chưa tìm thấy chứng từ AP chi tiết cho NCC này." />
          )}
          {!loading && !error && documents.length > 0 && (
            <div className="space-y-2">
              {documents.map(document => (
                <div key={document.id} className="rounded-lg border border-slate-100 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-black text-slate-800 dark:text-slate-100">{document.code || document.documentNo}</span>
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-black ${statusTone(document.status)}`}>{statusLabel(document.status)}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-black text-slate-500 dark:bg-slate-800">
                          {supplierPayableSourceLabel(document.sourceType)}
                        </span>
                      </div>
                      <div className="mt-1 text-xs font-bold text-slate-600 dark:text-slate-300">
                        Nguồn: {document.documentNo || document.sourceId}
                        {document.invoiceNumber ? ` • HĐ: ${document.invoiceNumber}` : ''}
                      </div>
                      <div className="mt-1 text-[10px] font-bold text-slate-400">
                        Ngày CT: {fmtDate(document.documentDate)} • Hạn TT: {fmtDate(document.dueDate)}
                      </div>
                    </div>
                    <div className="shrink-0 text-left sm:text-right">
                      <div className="text-xs font-black text-blue-700">{fmtMoney(document.recognizedAmount)}</div>
                      <div className="text-[10px] font-bold text-red-500">Còn {fmtMoney(document.outstandingAmount)}</div>
                    </div>
                  </div>
                  <div className="mt-3 flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => onOpenTrace(document)}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-black text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                    >
                      <QrCode size={11} /> Truy vết
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenDocumentSource(document)}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-black text-orange-700 hover:bg-orange-50 dark:hover:bg-orange-950/30"
                    >
                      <ExternalLink size={11} /> Mở chứng từ nguồn
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const PayablesTable = ({
  rows,
  canManage,
  canRecordPoPayment,
  onOpenSource,
  onEditSchedule,
  onDeleteSchedule,
  onPayPurchaseOrder,
}: {
  rows: ProjectFinancePayableRow[];
  canManage?: boolean;
  canRecordPoPayment?: boolean;
  onOpenSource: (row: ProjectFinancePayableRow) => void;
  onEditSchedule?: (row: ProjectFinancePayableRow) => void;
  onDeleteSchedule?: (row: ProjectFinancePayableRow) => void;
  onPayPurchaseOrder?: (row: ProjectFinancePayableRow) => void;
}) => {
  if (rows.length === 0) return <EmptyState label="Chưa có khoản phải trả trong phạm vi công trình này." />;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-100 bg-white dark:border-slate-700 dark:bg-slate-900">
      <table className="w-full min-w-[950px] text-left">
        <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wide text-slate-400 dark:bg-slate-800">
          <tr>
            <th className="px-3 py-2 whitespace-nowrap">Chứng từ</th>
            <th className="px-3 py-2 whitespace-nowrap">Đối tác</th>
            <th className="px-3 py-2 text-right whitespace-nowrap">Cam kết</th>
            <th className="px-3 py-2 text-right whitespace-nowrap">Được ghi nhận</th>
            <th className="px-3 py-2 text-right whitespace-nowrap">Đã TT</th>
            <th className="px-3 py-2 text-right whitespace-nowrap">Còn phải trả</th>
            <th className="px-3 py-2 text-center whitespace-nowrap">Trạng thái</th>
            <th className="px-3 py-2 text-right whitespace-nowrap">Thao tác</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
          {rows.map(row => {
            const isSupplierPayable = row.sourceType === 'purchase_order' || row.sourceType === 'supplier_payable';
            const canPayPurchaseOrder = Boolean(canRecordPoPayment && isSupplierPayable && row.recognizedAmount > 0 && row.outstandingAmount > 0);
            const isPurchaseOrderPaid = isSupplierPayable && row.recognizedAmount > 0 && row.outstandingAmount <= 0;
            const sourceLabel = row.sourceLabel || 'Nguồn';
            return (
            <tr key={row.id} className="text-xs hover:bg-slate-50/70 dark:hover:bg-slate-800/60">
              <td className="px-3 py-3">
                <button onClick={() => onOpenSource(row)} className="text-left font-black text-slate-800 hover:text-orange-600 dark:text-slate-100 whitespace-nowrap">
                  {row.documentNo}
                </button>
                <div className="mt-0.5 text-[10px] font-bold text-slate-400">{row.description}</div>
              </td>
              <td className="px-3 py-3 font-bold text-slate-600 dark:text-slate-300">{row.counterpartyName}</td>
              <td className="px-3 py-3 text-right font-bold whitespace-nowrap">{fmtMoney(row.committedAmount)}</td>
              <td className="px-3 py-3 text-right font-black text-blue-700 whitespace-nowrap">{fmtMoney(row.recognizedAmount)}</td>
              <td className="px-3 py-3 text-right text-emerald-700 whitespace-nowrap">{fmtMoney(row.paidAmount)}</td>
              <td className="px-3 py-3 text-right font-black text-red-600 whitespace-nowrap">{fmtMoney(row.outstandingAmount)}</td>
              <td className="px-3 py-3 text-center whitespace-nowrap">
                <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-black ${statusTone(row.status)}`}>{statusLabel(row.status)}</span>
              </td>
              <td className="px-3 py-3 text-right whitespace-nowrap">
                {canManage && row.sourceType === 'payment_schedule' ? (
                  <div className="flex justify-end gap-1">
                    <button type="button" onClick={() => onEditSchedule?.(row)} className="rounded-md px-2 py-1 text-[10px] font-black text-blue-600 hover:bg-blue-50">
                      <Edit2 size={11} className="inline" /> Sửa
                    </button>
                    <button type="button" onClick={() => onDeleteSchedule?.(row)} className="rounded-md px-2 py-1 text-[10px] font-black text-red-600 hover:bg-red-50">
                      <Trash2 size={11} className="inline" /> Xóa
                    </button>
                  </div>
                ) : isSupplierPayable ? (
                  <div className="flex flex-wrap justify-end gap-1">
                    {canPayPurchaseOrder && (
                      <button type="button" onClick={() => onPayPurchaseOrder?.(row)} className="rounded-md px-2 py-1 text-[10px] font-black text-emerald-700 hover:bg-emerald-50">
                        <CreditCard size={11} className="inline" /> {row.paidAmount > 0 ? 'Thanh toán tiếp' : 'Thanh toán NCC'}
                      </button>
                    )}
                    {isPurchaseOrderPaid && (
                      <span className="inline-flex rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">
                        Đã thanh toán
                      </span>
                    )}
                    <button type="button" onClick={() => onOpenSource(row)} className="rounded-md px-2 py-1 text-[10px] font-black text-slate-500 hover:bg-slate-50">
                      {sourceLabel}
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => onOpenSource(row)} className="rounded-md px-2 py-1 text-[10px] font-black text-slate-500 hover:bg-slate-50">
                    {sourceLabel}
                  </button>
                )}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const ReceivablesTable = ({
  rows,
  canManage,
  onOpenSource,
  onEditSchedule,
  onDeleteSchedule,
}: {
  rows: ProjectFinanceReceivableRow[];
  canManage?: boolean;
  onOpenSource: (tab: string) => void;
  onEditSchedule?: (row: ProjectFinanceReceivableRow) => void;
  onDeleteSchedule?: (row: ProjectFinanceReceivableRow) => void;
}) => {
  if (rows.length === 0) return <EmptyState label="Chưa có khoản phải thu trong phạm vi công trình này." />;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-100 bg-white dark:border-slate-700 dark:bg-slate-900">
      <table className="w-full min-w-[950px] text-left">
        <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wide text-slate-400 dark:bg-slate-800">
          <tr>
            <th className="px-3 py-2 whitespace-nowrap">Chứng từ</th>
            <th className="px-3 py-2 whitespace-nowrap">Chủ đầu tư</th>
            <th className="px-3 py-2 text-right whitespace-nowrap">Giá trị</th>
            <th className="px-3 py-2 text-right whitespace-nowrap">Được ghi nhận</th>
            <th className="px-3 py-2 text-right whitespace-nowrap">Đã thu</th>
            <th className="px-3 py-2 text-right whitespace-nowrap">Còn phải thu</th>
            <th className="px-3 py-2 text-center whitespace-nowrap">Trạng thái</th>
            <th className="px-3 py-2 text-right whitespace-nowrap">Thao tác</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
          {rows.map(row => (
            <tr key={row.id} className="text-xs hover:bg-slate-50/70 dark:hover:bg-slate-800/60">
              <td className="px-3 py-3">
                <button onClick={() => onOpenSource(row.sourceTab)} className="text-left font-black text-slate-800 hover:text-orange-600 dark:text-slate-100 whitespace-nowrap">
                  {row.documentNo}
                </button>
                <div className="mt-0.5 text-[10px] font-bold text-slate-400">{row.description}</div>
              </td>
              <td className="px-3 py-3 font-bold text-slate-600 dark:text-slate-300">{row.counterpartyName}</td>
              <td className="px-3 py-3 text-right font-bold whitespace-nowrap">{fmtMoney(row.contractAmount)}</td>
              <td className="px-3 py-3 text-right font-black text-blue-700 whitespace-nowrap">{fmtMoney(row.recognizedAmount)}</td>
              <td className="px-3 py-3 text-right text-emerald-700 whitespace-nowrap">{fmtMoney(row.receivedAmount)}</td>
              <td className="px-3 py-3 text-right font-black text-red-600 whitespace-nowrap">{fmtMoney(row.outstandingAmount)}</td>
              <td className="px-3 py-3 text-center whitespace-nowrap">
                <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-black ${statusTone(row.status)}`}>{statusLabel(row.status)}</span>
              </td>
              <td className="px-3 py-3 text-right whitespace-nowrap">
                {canManage && row.sourceType === 'payment_schedule' ? (
                  <div className="flex justify-end gap-1">
                    <button type="button" onClick={() => onEditSchedule?.(row)} className="rounded-md px-2 py-1 text-[10px] font-black text-blue-600 hover:bg-blue-50">
                      <Edit2 size={11} className="inline" /> Sửa
                    </button>
                    <button type="button" onClick={() => onDeleteSchedule?.(row)} className="rounded-md px-2 py-1 text-[10px] font-black text-red-600 hover:bg-red-50">
                      <Trash2 size={11} className="inline" /> Xóa
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => onOpenSource(row.sourceTab)} className="rounded-md px-2 py-1 text-[10px] font-black text-slate-500 hover:bg-slate-50">
                    Nguồn
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const CATEGORY_LABEL_MAP: Record<ProjectCostCategory, string> = {
  materials: '🧱 Vật tư / Vật liệu',
  labor: '👷 Nhân công',
  machinery: '⚙️ Máy móc / Máy thi công',
  subcontract: '🏗️ Thầu phụ / Giao thầu',
  overhead: '📋 Quản lý chung / Lương',
  other: '📦 Phát sinh / Chi phí khác',
};

const SOURCE_LABEL_MAP: Record<string, string> = {
  manual: '✍️ Nhập tay',
  import: '📥 Import Excel',
  workflow: '⚡ Duyệt Workflow',
};

const LedgerTable = ({
  rows,
  costItems = [],
  partners = [],
  canManage,
  onCreate,
  onDownloadTemplate,
  onImportClick,
  onEdit,
  onDelete,
}: {
  rows: ProjectFinanceLedgerRow[];
  costItems?: ContractCostItem[];
  partners?: BusinessPartner[];
  canManage?: boolean;
  onCreate?: () => void;
  onDownloadTemplate?: () => void;
  onImportClick?: () => void;
  onEdit?: (row: ProjectFinanceLedgerRow) => void;
  onDelete?: (row: ProjectFinanceLedgerRow) => void;
}) => {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ProjectCostCategory | 'all'>('all');
  const [selectedCostItemId, setSelectedCostItemId] = useState<string>('');
  const [selectedSource, setSelectedSource] = useState<'all' | 'manual' | 'import' | 'workflow'>('all');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [showAdvancedFilter, setShowAdvancedFilter] = useState(false);

  const costItemOptions = useMemo(() => buildContractCostItemOptions(costItems), [costItems]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (search.trim()) count++;
    if (selectedCategory !== 'all') count++;
    if (selectedCostItemId) count++;
    if (selectedSource !== 'all') count++;
    if (fromDate) count++;
    if (toDate) count++;
    return count;
  }, [search, selectedCategory, selectedCostItemId, selectedSource, fromDate, toDate]);

  const resetFilters = () => {
    setSearch('');
    setSelectedCategory('all');
    setSelectedCostItemId('');
    setSelectedSource('all');
    setFromDate('');
    setToDate('');
  };

  const setShortcutDateRange = (type: 'this_month' | 'last_month' | 'all') => {
    if (type === 'all') {
      setFromDate('');
      setToDate('');
      return;
    }
    const now = new Date();
    if (type === 'this_month') {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      setFromDate(first.toISOString().slice(0, 10));
      setToDate(last.toISOString().slice(0, 10));
    } else if (type === 'last_month') {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      setFromDate(first.toISOString().slice(0, 10));
      setToDate(last.toISOString().slice(0, 10));
    }
  };

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter(row => {
      // 1. Keyword search
      if (query) {
        const matchesKeyword = [
          row.description,
          row.sourceRef,
          row.category,
          row.type,
          row.contractCostItemSymbolSnapshot,
          row.contractCostItemNameSnapshot,
          row.counterpartyName,
          row.invoiceNo,
        ].some(value => String(value || '').toLowerCase().includes(query));
        if (!matchesKeyword) return false;
      }

      // 2. Category filter
      if (selectedCategory !== 'all' && row.category !== selectedCategory) {
        return false;
      }

      // 3. Cost Item filter
      if (selectedCostItemId) {
        const targetCostItem = costItems.find(c => c.id === selectedCostItemId);
        const matchesCostItem = row.contractCostItemId === selectedCostItemId
          || (targetCostItem && (
            row.contractCostItemSymbolSnapshot === targetCostItem.symbol
            || row.contractCostItemNameSnapshot === targetCostItem.name
          ));
        if (!matchesCostItem) return false;
      }

      // 4. Source filter
      if (selectedSource !== 'all' && row.source !== selectedSource) {
        return false;
      }

      // 5. Date range filter
      if (fromDate && row.date < fromDate) return false;
      if (toDate && row.date > toDate) return false;

      return true;
    });
  }, [rows, search, selectedCategory, selectedCostItemId, selectedSource, fromDate, toDate, costItems]);

  const filteredExpenseTotal = useMemo(() =>
    filtered.filter(r => r.type === 'expense').reduce((s, r) => s + Math.abs(r.amount), 0),
  [filtered]);

  const filteredRevenueTotal = useMemo(() =>
    filtered.filter(r => r.type !== 'expense').reduce((s, r) => s + Math.abs(r.amount), 0),
  [filtered]);

  return (
    <div className="space-y-3">
      {/* Search & Actions Bar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <div className="relative min-w-[240px] max-w-sm flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Tìm nội dung, mã chứng từ, đối tác..."
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-8 text-xs font-bold outline-none focus:border-orange-300 dark:border-slate-700 dark:bg-slate-900"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Toggle Advanced Filter Button */}
          <button
            type="button"
            onClick={() => setShowAdvancedFilter(prev => !prev)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition-all ${
              showAdvancedFilter || activeFilterCount > 0
                ? 'border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-300'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
            }`}
          >
            <Filter size={14} />
            <span>Bộ lọc</span>
            {activeFilterCount > 0 && (
              <span className="ml-0.5 rounded-full bg-orange-500 px-1.5 py-0.2 text-[10px] font-black text-white">
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* Quick Date Range Shortcuts */}
          <div className="hidden md:inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg">
            <button
              type="button"
              onClick={() => setShortcutDateRange('this_month')}
              className="px-2 py-1 text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 rounded-md"
            >
              Tháng này
            </button>
            <button
              type="button"
              onClick={() => setShortcutDateRange('last_month')}
              className="px-2 py-1 text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 rounded-md"
            >
              Tháng trước
            </button>
            <button
              type="button"
              onClick={() => setShortcutDateRange('all')}
              className="px-2 py-1 text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 rounded-md"
            >
              Tất cả
            </button>
          </div>

          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg"
              title="Xóa toàn bộ bộ lọc"
            >
              <RotateCcw size={13} /> Đặt lại
            </button>
          )}
        </div>

        {canManage && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onDownloadTemplate} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800">
              <Download size={14} /> Tải mẫu
            </button>
            <button type="button" onClick={onImportClick} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-black text-orange-700 hover:bg-orange-100 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-300">
              <Upload size={14} /> Import Excel
            </button>
            <button type="button" onClick={onCreate} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-xs font-black text-white hover:bg-orange-600">
              <Plus size={14} /> Thêm giao dịch
            </button>
          </div>
        )}
      </div>

      {/* Advanced Filter Panel */}
      {showAdvancedFilter && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/60 p-3.5 space-y-3 animate-in fade-in duration-150">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            {/* Nhóm chi phí */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Nhóm chi phí
              </label>
              <select
                value={selectedCategory}
                onChange={e => setSelectedCategory(e.target.value as any)}
                className="w-full rounded-lg border border-slate-200 bg-white p-2 font-bold text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
              >
                <option value="all">Tất cả nhóm chi phí</option>
                {Object.entries(CATEGORY_LABEL_MAP).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>

            {/* Khoản mục chi phí */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Khoản mục chi phí
              </label>
              <select
                value={selectedCostItemId}
                onChange={e => setSelectedCostItemId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white p-2 font-bold text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
              >
                <option value="">Tất cả khoản mục</option>
                {costItemOptions.map(opt => (
                  <option key={opt.item.id} value={opt.item.id}>
                    {`${'-- '.repeat(opt.depth)}${opt.displayIndex} - ${opt.item.symbol} - ${opt.item.name}`}
                  </option>
                ))}
              </select>
            </div>

            {/* Nguồn phát sinh */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Nguồn phát sinh
              </label>
              <select
                value={selectedSource}
                onChange={e => setSelectedSource(e.target.value as any)}
                className="w-full rounded-lg border border-slate-200 bg-white p-2 font-bold text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
              >
                <option value="all">Tất cả nguồn</option>
                {Object.entries(SOURCE_LABEL_MAP).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>

            {/* Khoảng thời gian */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Từ ngày - Đến ngày
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                <input
                  type="date"
                  value={fromDate}
                  onChange={e => setFromDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-xs font-bold outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                />
                <input
                  type="date"
                  value={toDate}
                  onChange={e => setToDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-xs font-bold outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filtered Metrics Summary Row */}
      {activeFilterCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 rounded-xl bg-orange-50/60 dark:bg-orange-950/20 border border-orange-200/60 dark:border-orange-900/40 text-xs">
          <div className="font-bold text-slate-700 dark:text-slate-300">
            Kết quả lọc: <span className="font-black text-orange-600">{filtered.length}</span> / {rows.length} giao dịch
          </div>
          <div className="flex items-center gap-4 text-xs font-black">
            {filteredExpenseTotal > 0 && (
              <span className="text-red-600">Tổng chi: -{fmtMoney(filteredExpenseTotal)}</span>
            )}
            {filteredRevenueTotal > 0 && (
              <span className="text-emerald-600">Tổng thu: +{fmtMoney(filteredRevenueTotal)}</span>
            )}
          </div>
        </div>
      )}

      {filtered.length === 0 ? <EmptyState label="Chưa có giao dịch tài chính phù hợp bộ lọc." /> : (
        <div className="overflow-x-auto rounded-lg border border-slate-100 bg-white dark:border-slate-700 dark:bg-slate-900">
          <table className="w-full min-w-[780px] text-left">
            <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wide text-slate-400 dark:bg-slate-800">
              <tr>
                <th className="px-3 py-2 whitespace-nowrap">Ngày</th>
                <th className="px-3 py-2 whitespace-nowrap">Nội dung</th>
                <th className="px-3 py-2 whitespace-nowrap">Khoản mục</th>
                <th className="px-3 py-2 whitespace-nowrap">Nguồn</th>
                <th className="px-3 py-2 text-right whitespace-nowrap">Số tiền</th>
                <th className="px-3 py-2 text-right whitespace-nowrap">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
              {filtered.map(row => (
                <tr key={row.id} className="text-xs">
                  <td className="px-3 py-3 font-bold text-slate-500 whitespace-nowrap">{fmtDate(row.date)}</td>
                  <td className="px-3 py-3">
                    <div className="font-black text-slate-800 dark:text-slate-100">{row.description}</div>
                    <div className="mt-0.5 text-[10px] font-bold text-slate-400">
                      {row.category} • {row.counterpartyName || row.sourceRef || row.source}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    {row.contractCostItemSymbolSnapshot || row.contractCostItemNameSnapshot ? (
                      <div>
                        <div className="font-black text-slate-700 dark:text-slate-200">{row.contractCostItemSymbolSnapshot || '-'}</div>
                        <div className="mt-0.5 max-w-[180px] truncate text-[10px] font-bold text-slate-400">{row.contractCostItemNameSnapshot || '-'}</div>
                      </div>
                    ) : (
                      <span className="text-[10px] font-bold text-slate-300">-</span>
                    )}
                  </td>
                  <td className="px-3 py-3 font-bold text-slate-500 whitespace-nowrap">{row.source}</td>
                  <td className={`px-3 py-3 text-right font-black whitespace-nowrap ${row.type === 'expense' ? 'text-red-600' : 'text-emerald-700'}`}>
                    {row.type === 'expense' ? '-' : '+'}{fmtMoney(Math.abs(row.amount))}
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    {canManage && row.source === 'manual' ? (
                      <div className="flex justify-end gap-1">
                        <button type="button" onClick={() => onEdit?.(row)} className="rounded-md px-2 py-1 text-[10px] font-black text-blue-600 hover:bg-blue-50">
                          <Edit2 size={11} className="inline" /> Sửa
                        </button>
                        <button type="button" onClick={() => onDelete?.(row)} className="rounded-md px-2 py-1 text-[10px] font-black text-red-600 hover:bg-red-50">
                          <Trash2 size={11} className="inline" /> Xóa
                        </button>
                      </div>
                    ) : (
                      <span className="text-[10px] font-bold text-slate-300">Khóa</span>
                    )}
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
  const toast = useToast();
  const confirm = useConfirm();
  const {
    addProjectTransaction,
    addProjectTransactions,
    updateProjectTransaction,
    removeProjectTransaction,
    user,
  } = useApp();
  const ledgerImportInputRef = useRef<HTMLInputElement>(null);
  const queryParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const [activeTab, setActiveTab] = useState<ProjectFinanceWorkspaceTab>(() => {
    const paramTab = queryParams.get('financeTab');
    return validTab(paramTab) ? paramTab : initialTab;
  });
  const [data, setData] = useState<ProjectFinanceWorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contractCostItems, setContractCostItems] = useState<ContractCostItem[]>([]);
  const [partners, setPartners] = useState<BusinessPartner[]>([]);
  const [scheduleForm, setScheduleForm] = useState<PaymentSchedule | null>(null);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [transactionForm, setTransactionForm] = useState<ProjectTransaction | null>(null);
  const [transactionFiles, setTransactionFiles] = useState<File[]>([]);
  const [savingTransaction, setSavingTransaction] = useState(false);
  const [importPreviewResult, setImportPreviewResult] = useState<ProjectTransactionImportPreviewResult | null>(null);
  const [savingImportTransactions, setSavingImportTransactions] = useState(false);
  const [poPaymentForm, setPoPaymentForm] = useState<PurchaseOrderPaymentForm | null>(null);
  const [savingPoPayment, setSavingPoPayment] = useState(false);
  const [supplierPayableDrawer, setSupplierPayableDrawer] = useState<SupplierPayableDocumentDrawerState | null>(null);
  const [payablesView, setPayablesView] = useState<'documents' | 'payments' | 'settlements'>('documents');
  const [ledgerView, setLedgerView] = useState<'paid' | 'received'>('paid');
  const [supplierPaymentBatches, setSupplierPaymentBatches] = useState<SupplierPaymentBatch[]>([]);
  const [loadingSupplierPaymentBatches, setLoadingSupplierPaymentBatches] = useState(false);
  const [supplierPaymentForm, setSupplierPaymentForm] = useState<SupplierPaymentBatchFormState | null>(null);
  const [savingSupplierPaymentBatch, setSavingSupplierPaymentBatch] = useState(false);
  const [supplierPaymentBatchDetail, setSupplierPaymentBatchDetail] = useState<SupplierPaymentBatchDetailState | null>(null);
  const [reversingSupplierPaymentBatch, setReversingSupplierPaymentBatch] = useState(false);
  const [siteCashSettlementBatches, setSiteCashSettlementBatches] = useState<SiteCashSettlementBatch[]>([]);
  const [loadingSiteCashSettlements, setLoadingSiteCashSettlements] = useState(false);
  const [siteCashSettlementDetail, setSiteCashSettlementDetail] = useState<SiteCashSettlementDetailState | null>(null);
  const [savingSiteCashSettlement, setSavingSiteCashSettlement] = useState(false);
  const [postingSiteCashSettlement, setPostingSiteCashSettlement] = useState(false);
  const [cashFunds, setCashFunds] = useState<CashFund[]>([]);
  const [loadingCashFunds, setLoadingCashFunds] = useState(false);
  const canManageSchedules = canManageFinance || canManagePayment;
  const canManageLedger = canManageFinance;
  const canRecordPoPayment = canManageFinance;
  const supplierPaymentRows = useMemo(
    () => (data?.payables || [])
      .filter(row => row.sourceType === 'supplier_payable' && row.outstandingAmount > 0)
      .sort((a, b) => b.outstandingAmount - a.outstandingAmount || a.counterpartyName.localeCompare(b.counterpartyName)),
    [data?.payables],
  );
  const costItemOptions = useMemo(() => buildContractCostItemOptions(contractCostItems), [contractCostItems]);
  const openPayableRows = useMemo(
    () => (data?.payables || []).filter(row => Number(row.outstandingAmount || 0) > 0),
    [data?.payables],
  );
  const openReceivableRows = useMemo(
    () => (data?.receivables || []).filter(row => Number(row.outstandingAmount || 0) > 0),
    [data?.receivables],
  );
  const paidLedgerRows = useMemo(
    () => (data?.ledger || []).filter(row => row.type === 'expense'),
    [data?.ledger],
  );
  const receivedLedgerRows = useMemo(
    () => (data?.ledger || []).filter(row => row.type === 'revenue_received'),
    [data?.ledger],
  );
  const visibleLedgerRows = ledgerView === 'paid' ? paidLedgerRows : receivedLedgerRows;

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

  const loadContractCostItems = useCallback(async () => {
    try {
      setContractCostItems(await contractCostItemService.list());
    } catch (err: any) {
      toast.error('Không tải được khoản mục chi phí', err?.message || 'Vui lòng kiểm tra danh mục /hd/catalogs.');
    }
  }, [toast]);

  useEffect(() => { loadContractCostItems(); }, [loadContractCostItems]);

  const loadPartners = useCallback(async () => {
    try {
      setPartners(await partnerService.list());
    } catch (err: any) {
      toast.error('Không tải được đối tác', err?.message || 'Vui lòng kiểm tra danh mục /hd/partners.');
    }
  }, [toast]);

  useEffect(() => { loadPartners(); }, [loadPartners]);

  const loadSupplierPaymentBatches = useCallback(async () => {
    setLoadingSupplierPaymentBatches(true);
    try {
      setSupplierPaymentBatches(await supplierPaymentBatchService.listBatches({
        projectId: projectId || null,
        constructionSiteId,
      }));
    } catch (err: any) {
      toast.error('Không tải được đợt thanh toán NCC', err?.message || 'Vui lòng thử lại.');
      setSupplierPaymentBatches([]);
    } finally {
      setLoadingSupplierPaymentBatches(false);
    }
  }, [constructionSiteId, projectId, toast]);

  const loadSiteCashSettlements = useCallback(async () => {
    setLoadingSiteCashSettlements(true);
    try {
      setSiteCashSettlementBatches(await siteCashSettlementService.listBatches({
        projectId: projectId || null,
        constructionSiteId,
      }));
    } catch (err: any) {
      toast.error('Không tải được bộ hoàn ứng', err?.message || 'Vui lòng thử lại.');
      setSiteCashSettlementBatches([]);
    } finally {
      setLoadingSiteCashSettlements(false);
    }
  }, [constructionSiteId, projectId, toast]);

  const loadCashFunds = useCallback(async () => {
    setLoadingCashFunds(true);
    try {
      setCashFunds(await cashFundService.listActive());
    } catch (err: any) {
      toast.error('Không tải được danh sách quỹ', err?.message || 'Vui lòng thử lại.');
      setCashFunds([]);
    } finally {
      setLoadingCashFunds(false);
    }
  }, [toast]);

  useEffect(() => {
    if (activeTab === 'payables') void loadSupplierPaymentBatches();
  }, [activeTab, loadSupplierPaymentBatches]);

  useEffect(() => {
    if (activeTab === 'payables') void loadSiteCashSettlements();
  }, [activeTab, loadSiteCashSettlements]);

  useEffect(() => {
    if (activeTab === 'payables') void loadCashFunds();
  }, [activeTab, loadCashFunds]);

  const openTab = useCallback((tab: ProjectFinanceWorkspaceTab) => {
    setActiveTab(tab);
    const params = new URLSearchParams(location.search);
    params.set('tab', 'finance');
    params.set('financeTab', tab);
    navigate(`${location.pathname}?${params.toString()}`, { replace: true });
  }, [location.pathname, location.search, navigate]);

  const openSourceRoute = useCallback((route?: ProjectFinanceSourceRoute | null, fallbackTab?: string) => {
    const params = new URLSearchParams(location.search);
    const tab = route?.tab || fallbackTab || 'finance';
    if (tab === 'payment') {
      params.set('tab', 'finance');
      params.set('financeTab', 'payments');
    } else if (tab === 'cashflow') {
      params.set('tab', 'finance');
      params.set('financeTab', 'cashflow');
    } else if (tab === 'finance') {
      params.set('tab', 'finance');
      params.set('financeTab', route?.params?.financeTab || 'overview');
    } else {
      params.set('tab', tab);
      params.delete('financeTab');
    }
    Object.entries(route?.params || {}).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    navigate(`${location.pathname}?${params.toString()}`);
  }, [location.pathname, location.search, navigate]);

  const openSource = useCallback((tab: string) => {
    openSourceRoute(null, tab);
  }, [openSourceRoute]);

  const openSupplierPaymentsTab = useCallback(() => {
    setPayablesView('payments');
    openTab('payables');
  }, [openTab]);

  const openMaterialDirectTab = useCallback(() => {
    openSourceRoute({
      tab: 'material',
      params: {
        materialTab: 'direct',
      },
    });
  }, [openSourceRoute]);

  const openSupplierControlTrace = useCallback((trace: NonNullable<ProjectFinanceSupplierControlIssue['trace']>) => {
    navigate(buildDocumentTracePath(trace.type, trace.id, trace.qrToken));
  }, [navigate]);

  const openPayableSource = useCallback(async (row: ProjectFinancePayableRow) => {
    if (row.sourceType !== 'supplier_payable') {
      openSourceRoute(row.sourceRoute, row.sourceTab);
      return;
    }

    setSupplierPayableDrawer({ row, documents: [], loading: true, error: null });
    try {
      const documents = await supplierPayableService.listDocuments({
        projectId: projectId || null,
        constructionSiteId,
        supplierId: row.sourceRoute?.params?.supplierId || null,
      });
      setSupplierPayableDrawer({ row, documents, loading: false, error: null });
    } catch (err: any) {
      setSupplierPayableDrawer({
        row,
        documents: [],
        loading: false,
        error: err?.message || 'Không tải được danh sách chứng từ AP.',
      });
    }
  }, [constructionSiteId, openSourceRoute, projectId]);

  const openSupplierPayableDocumentSource = useCallback((document: SupplierPayableDocument) => {
    if (document.sourceType === 'purchase_order' && document.sourceId) {
      setSupplierPayableDrawer(null);
      openSourceRoute({
        tab: 'material',
        params: {
          materialTab: 'po',
          poId: document.sourceId,
        },
      });
      return;
    }
    if (document.sourceType === 'site_direct_purchase' && document.sourceId) {
      setSupplierPayableDrawer(null);
      openSourceRoute({
        tab: 'material',
        params: {
          materialTab: 'po',
          siteDirectPurchaseId: document.sourceId,
        },
      });
      return;
    }
    if (document.sourceType === 'supplier_delivery_statement' && document.sourceId) {
      setSupplierPayableDrawer(null);
      openSourceRoute({
        tab: 'material',
        params: {
          materialTab: 'direct',
          supplierDeliveryStatementId: document.sourceId,
          ...(document.supplierContractId ? { supplierContractId: document.supplierContractId } : {}),
        },
      });
      return;
    }
    toast.info('Chưa có màn nguồn riêng', 'Chứng từ này chưa có màn chi tiết nguồn trong phiên bản hiện tại.');
  }, [openSourceRoute, toast]);

  const openSupplierPayableDocumentTrace = useCallback((document: SupplierPayableDocument) => {
    navigate(buildDocumentTracePath('supplier_payable_document', document.id, document.qrToken));
  }, [navigate]);

  const openSupplierPaymentBatchTrace = useCallback((batch: SupplierPaymentBatch) => {
    navigate(buildDocumentTracePath('supplier_payment_batch', batch.id, batch.qrToken));
  }, [navigate]);

  const openSiteCashSettlementTrace = useCallback((batch: SiteCashSettlementBatch) => {
    navigate(buildDocumentTracePath('site_cash_settlement_batch', batch.id, batch.qrToken));
  }, [navigate]);

  const createDefaultSchedule = (type: PaymentSchedule['type']): PaymentSchedule => ({
    id: crypto.randomUUID(),
    projectId: projectId || null,
    constructionSiteId,
    sequenceNo: ((data?.paymentSchedules || []).filter(item => item.type === type).length || 0) + 1,
    milestoneType: 'progress',
    description: '',
    amount: 0,
    dueDate: todayIso(),
    paidAmount: 0,
    status: 'pending',
    type,
    contactName: '',
    plannedTaskIds: [],
    dossierStatus: 'not_started',
    qualityStatus: 'not_confirmed',
  });

  const openNewSchedule = (type: PaymentSchedule['type']) => {
    setScheduleForm(createDefaultSchedule(type));
  };

  const openEditSchedule = (row: ProjectFinancePayableRow | ProjectFinanceReceivableRow) => {
    const schedule = data?.paymentSchedules.find(item => item.id === row.sourceId);
    if (!schedule) {
      toast.info('Mở nguồn chứng từ', 'Dòng này không phải lịch thanh toán nhập tay, hãy mở phân hệ nguồn để sửa.');
      openSource(row.sourceTab);
      return;
    }
    setScheduleForm({ ...schedule });
  };

  const saveSchedule = async () => {
    if (!scheduleForm) return;
    if (!scheduleForm.description.trim()) {
      toast.warning('Thiếu mô tả', 'Nhập mô tả khoản thanh toán trước khi lưu.');
      return;
    }
    if (Number(scheduleForm.amount || 0) <= 0) {
      toast.warning('Thiếu giá trị', 'Nhập giá trị khoản thanh toán lớn hơn 0.');
      return;
    }
    setSavingSchedule(true);
    try {
      await paymentService.upsert({
        ...scheduleForm,
        projectId: projectId || null,
        constructionSiteId,
        paidAmount: Number(scheduleForm.paidAmount || 0),
        paidDate: scheduleForm.status === 'paid' ? (scheduleForm.paidDate || todayIso()) : scheduleForm.paidDate,
      });
      setScheduleForm(null);
      toast.success('Đã lưu khoản thanh toán');
      await load();
    } catch (err: any) {
      toast.error('Không lưu được khoản thanh toán', err?.message || 'Vui lòng thử lại.');
    } finally {
      setSavingSchedule(false);
    }
  };

  const deleteSchedule = async (row: ProjectFinancePayableRow | ProjectFinanceReceivableRow) => {
    const schedule = data?.paymentSchedules.find(item => item.id === row.sourceId);
    if (!schedule) {
      toast.info('Không xoá tại đây', 'Dòng này phát sinh từ phân hệ nguồn, không phải lịch thanh toán nhập tay.');
      return;
    }
    const ok = await confirm({
      title: 'Xóa khoản thanh toán',
      targetName: schedule.description,
      warningText: 'Khoản này sẽ bị xoá khỏi lịch phải thu/phải trả của công trình.',
      actionLabel: 'Xóa',
      countdownSeconds: 0,
    });
    if (!ok) return;
    try {
      await paymentService.remove(schedule.id);
      toast.success('Đã xóa khoản thanh toán');
      await load();
    } catch (err: any) {
      toast.error('Không xóa được khoản thanh toán', err?.message || 'Vui lòng thử lại.');
    }
  };

  const createSupplierPaymentBatchForm = (patch: Partial<SupplierPaymentBatchFormState> = {}): SupplierPaymentBatchFormState => {
    const paymentDate = patch.paymentDate || todayIso();
    const batchId = patch.batchId || crypto.randomUUID();
    return {
      batchId,
      supplierId: '',
      supplierName: '',
      amount: 0,
      paymentDate,
      periodMonth: patch.periodMonth || toPeriodMonth(paymentDate),
      paymentMethod: 'bank_transfer',
      documentRef: '',
      note: '',
      allocationMode: 'fifo',
      documents: [],
      manualAllocations: {},
      loadingDocuments: false,
      documentError: null,
      ...patch,
    };
  };

  const loadSupplierPaymentDocumentsIntoForm = useCallback(async (
    batchId: string,
    supplierId: string,
    defaultAmount?: number,
  ) => {
    if (!supplierId) return;
    setSupplierPaymentForm(prev => prev?.batchId === batchId ? {
      ...prev,
      loadingDocuments: true,
      documentError: null,
      documents: [],
      manualAllocations: {},
    } : prev);
    try {
      const documents = (await supplierPayableService.listDocuments({
        projectId: projectId || null,
        constructionSiteId,
        supplierId,
      })).filter(document => Number(document.outstandingAmount || 0) > 0);
      const totalOutstanding = documents.reduce((sum, document) => sum + Number(document.outstandingAmount || 0), 0);
      setSupplierPaymentForm(prev => prev?.batchId === batchId ? {
        ...prev,
        documents,
        amount: defaultAmount != null ? defaultAmount : (prev.amount || totalOutstanding),
        loadingDocuments: false,
        documentError: null,
        manualAllocations: {},
      } : prev);
    } catch (err: any) {
      setSupplierPaymentForm(prev => prev?.batchId === batchId ? {
        ...prev,
        documents: [],
        loadingDocuments: false,
        documentError: err?.message || 'Không tải được chứng từ AP.',
      } : prev);
    }
  }, [constructionSiteId, projectId]);

  const openSupplierPaymentBatchForm = useCallback(async (row?: ProjectFinancePayableRow) => {
    if (!canRecordPoPayment) return;
    const batchId = crypto.randomUUID();
    if (!row) {
      setSupplierPaymentForm(createSupplierPaymentBatchForm({ batchId }));
      return;
    }
    if (row.sourceType !== 'purchase_order' && row.sourceType !== 'supplier_payable') {
      openSource(row.sourceTab);
      return;
    }
    if (row.recognizedAmount <= 0) {
      toast.info('Chưa có giá trị phải trả', 'Chứng từ này chưa có phần được ghi nhận để thanh toán.');
      return;
    }
    if (row.outstandingAmount <= 0) {
      toast.success('Khoản phải trả đã thanh toán đủ');
      return;
    }

    if (row.sourceType === 'supplier_payable') {
      const supplierId = row.sourceRoute?.params?.supplierId || row.sourceId;
      setSupplierPaymentForm(createSupplierPaymentBatchForm({
        batchId,
        supplierId,
        supplierName: row.counterpartyName,
        amount: row.outstandingAmount,
        loadingDocuments: true,
      }));
      await loadSupplierPaymentDocumentsIntoForm(batchId, supplierId, row.outstandingAmount);
      return;
    }

    setSupplierPaymentForm(createSupplierPaymentBatchForm({
      batchId,
      supplierId: row.sourceId,
      supplierName: row.counterpartyName,
      amount: row.outstandingAmount,
      loadingDocuments: true,
      lockedDocumentIds: [row.sourceId],
    }));
    try {
      const document = await supplierPayableService.syncPurchaseOrderById(row.sourceId);
      setSupplierPaymentForm(prev => prev?.batchId === batchId ? {
        ...prev,
        supplierId: document.supplierId || row.sourceId,
        supplierName: document.supplierNameSnapshot || row.counterpartyName,
        documents: Number(document.outstandingAmount || 0) > 0 ? [document] : [],
        amount: Math.min(row.outstandingAmount, Number(document.outstandingAmount || row.outstandingAmount)),
        loadingDocuments: false,
        documentError: null,
        lockedDocumentIds: [document.id],
      } : prev);
    } catch (err: any) {
      setSupplierPaymentForm(prev => prev?.batchId === batchId ? {
        ...prev,
        documents: [],
        loadingDocuments: false,
        documentError: err?.message || 'Không đồng bộ được AP từ PO.',
      } : prev);
    }
  }, [canRecordPoPayment, loadSupplierPaymentDocumentsIntoForm, openSource, toast]);

  const selectSupplierForPaymentForm = (supplierId: string) => {
    if (!supplierPaymentForm) return;
    const batchId = supplierPaymentForm.batchId;
    const row = supplierPaymentRows.find(item => item.sourceId === supplierId);
    setSupplierPaymentForm(prev => prev ? {
      ...prev,
      supplierId,
      supplierName: row?.counterpartyName || '',
      amount: row?.outstandingAmount || 0,
      documents: [],
      manualAllocations: {},
      documentError: null,
    } : prev);
    if (supplierId) void loadSupplierPaymentDocumentsIntoForm(batchId, supplierId, row?.outstandingAmount || 0);
  };

  const updateSupplierManualAllocation = (documentId: string, amount: number) => {
    setSupplierPaymentForm(prev => prev ? {
      ...prev,
      manualAllocations: {
        ...prev.manualAllocations,
        [documentId]: amount,
      },
    } : prev);
  };

  const saveSupplierPaymentBatch = async () => {
    if (!supplierPaymentForm) return;
    const form = supplierPaymentForm;
    const amount = Math.round(Number(form.amount || 0));
    const documents = form.documents.filter(document => Number(document.outstandingAmount || 0) > 0);
    if (!form.supplierId) {
      toast.warning('Thiếu nhà cung cấp', 'Chọn NCC cần thanh toán.');
      return;
    }
    if (amount <= 0) {
      toast.warning('Thiếu số tiền', 'Nhập số tiền thanh toán lớn hơn 0.');
      return;
    }
    if (documents.length === 0) {
      toast.warning('Không có chứng từ AP', 'NCC này chưa có chứng từ AP còn phải trả.');
      return;
    }
    const allocations = allocateSupplierPayment({
      mode: form.allocationMode,
      paymentBatchId: form.batchId,
      amount,
      documents,
      manualAllocations: form.manualAllocations,
    });
    const totalAllocated = Math.round(allocations.reduce((sum, allocation) => sum + Number(allocation.allocatedAmount || 0), 0));
    if (allocations.length === 0) {
      toast.warning('Chưa phân bổ thanh toán', 'Chọn ít nhất một chứng từ AP để phân bổ.');
      return;
    }
    if (totalAllocated !== amount) {
      toast.warning('Phân bổ chưa khớp', `Tổng phân bổ phải bằng số tiền thanh toán. Hiện lệch ${fmtMoney(amount - totalAllocated)}.`);
      return;
    }
    try {
      assertSupplierPaymentBatchCanPost({ amount, allocations, documents });
    } catch (err: any) {
      toast.warning('Phân bổ không hợp lệ', err?.message || 'Kiểm tra lại số tiền phân bổ.');
      return;
    }

    setSavingSupplierPaymentBatch(true);
    try {
      const now = new Date().toISOString();
      const batchCode = buildSupplierPaymentBatchCode(form.paymentDate, form.batchId);
      await supplierPaymentBatchService.updateDraft({
        id: form.batchId,
        code: batchCode,
        projectId: projectId || null,
        constructionSiteId,
        supplierId: form.supplierId || null,
        supplierNameSnapshot: form.supplierName || documents[0]?.supplierNameSnapshot || 'Nhà cung cấp',
        periodMonth: form.periodMonth || toPeriodMonth(form.paymentDate),
        paymentDate: form.paymentDate || todayIso(),
        paymentMethod: form.paymentMethod,
        documentRef: form.documentRef.trim() || null,
        totalRecognizedSnapshot: documents.reduce((sum, document) => sum + Number(document.recognizedAmount || 0), 0),
        amount,
        paymentAmount: amount,
        currency: 'VND',
        status: 'draft',
        allocationMode: form.allocationMode,
        qrToken: `pay_${form.batchId.replaceAll('-', '')}`,
        attachments: [],
        metadata: { note: form.note.trim() },
        createdBy: user?.id || null,
        createdAt: now,
        updatedAt: now,
        note: form.note.trim() || null,
      }, allocations);
      await supplierPaymentBatchService.post(form.batchId, user?.id || null);
      setSupplierPaymentForm(null);
      toast.success('Đã tạo đợt thanh toán NCC', `${form.supplierName || documents[0]?.supplierNameSnapshot} đã thanh toán ${fmtMoney(amount)}.`);
      await Promise.all([load(), loadSupplierPaymentBatches()]);
    } catch (err: any) {
      toast.error('Không ghi được thanh toán NCC', err?.message || 'Vui lòng thử lại.');
    } finally {
      setSavingSupplierPaymentBatch(false);
    }
  };

  const openSupplierPaymentBatchDetail = async (batchId: string) => {
    setSupplierPaymentBatchDetail({ batchId, batch: null, allocations: [], loading: true, error: null });
    try {
      const detail = await supplierPaymentBatchService.getBatchDetail(batchId);
      setSupplierPaymentBatchDetail({ batchId, batch: detail.batch, allocations: detail.allocations, loading: false, error: null });
    } catch (err: any) {
      setSupplierPaymentBatchDetail({ batchId, batch: null, allocations: [], loading: false, error: err?.message || 'Không tải được chi tiết batch.' });
    }
  };

  const reverseSupplierPaymentBatch = async (batch: SupplierPaymentBatch) => {
    const ok = await confirm({
      title: 'Đảo thanh toán NCC',
      targetName: batch.code,
      warningText: 'Hệ thống sẽ tạo giao dịch đảo và khôi phục công nợ AP theo RPC.',
      actionLabel: 'Đảo thanh toán',
      countdownSeconds: 0,
    });
    if (!ok) return;
    setReversingSupplierPaymentBatch(true);
    try {
      await supplierPaymentBatchService.reverse(batch.id, user?.id || null);
      toast.success('Đã đảo thanh toán NCC', batch.code);
      setSupplierPaymentBatchDetail(null);
      await Promise.all([load(), loadSupplierPaymentBatches()]);
    } catch (err: any) {
      toast.error('Không đảo được thanh toán NCC', err?.message || 'Vui lòng thử lại.');
    } finally {
      setReversingSupplierPaymentBatch(false);
    }
  };

  const openSiteCashSettlementDetail = async (batchId: string) => {
    setSiteCashSettlementDetail({ batchId, batch: null, lines: [], loading: true, error: null });
    try {
      const detail = await siteCashSettlementService.getBatchDetail(batchId);
      setSiteCashSettlementDetail({ batchId, batch: detail.batch, lines: detail.lines, loading: false, error: null });
    } catch (err: any) {
      setSiteCashSettlementDetail({ batchId, batch: null, lines: [], loading: false, error: err?.message || 'Không tải được chi tiết hoàn ứng.' });
    }
  };

  const createSiteCashSettlementBatch = async () => {
    if (!canManageFinance) return;
    const batchId = crypto.randomUUID();
    const periodMonth = toPeriodMonth(todayIso());
    const now = new Date().toISOString();
    const batch: SiteCashSettlementBatch = {
      id: batchId,
      code: buildSiteCashSettlementCode(periodMonth, batchId),
      projectId: projectId || null,
      constructionSiteId,
      periodMonth,
      cashFundId: cashFunds[0]?.id || null,
      openingBalance: 0,
      topupAmount: 0,
      acceptedSpendAmount: 0,
      rejectedSpendAmount: 0,
      approvedSiteCashSpend: 0,
      approvedStaffPaidAmount: 0,
      staffReimbursedAmount: 0,
      staffOutstandingAmount: 0,
      closingBalance: 0,
      status: 'draft',
      qrToken: `site_cash_settlement_${batchId.replaceAll('-', '')}`,
      createdBy: user?.id || null,
      createdAt: now,
      updatedAt: now,
      note: null,
      metadata: {},
    };
    setSavingSiteCashSettlement(true);
    try {
      let lines = await siteCashSettlementService.buildDraftFromDirectPurchases({
        settlementBatchId: batchId,
        projectId: projectId || null,
        constructionSiteId,
        periodMonth,
      });
      lines = lines.map(line => ({
        ...line,
        status: 'pending',
      }));
      const saved = await siteCashSettlementService.upsert(batch, lines);
      toast.success('Đã tạo bộ hoàn ứng', `${saved.code} có ${lines.length} dòng chờ review.`);
      await loadSiteCashSettlements();
      setPayablesView('settlements');
      setSiteCashSettlementDetail({ batchId, batch: saved, lines, loading: false, error: null });
    } catch (err: any) {
      toast.error('Không tạo được bộ hoàn ứng', err?.message || 'Vui lòng thử lại.');
    } finally {
      setSavingSiteCashSettlement(false);
    }
  };

  const updateSiteCashSettlementBatch = (batch: SiteCashSettlementBatch) => {
    setSiteCashSettlementDetail(prev => prev ? { ...prev, batch } : prev);
  };

  const updateSiteCashSettlementLine = (line: SiteCashSettlementLine) => {
    setSiteCashSettlementDetail(prev => prev ? {
      ...prev,
      lines: prev.lines.map(item => item.id === line.id ? line : item),
    } : prev);
  };

  const saveSiteCashSettlementDraft = async () => {
    const detail = siteCashSettlementDetail;
    if (!detail?.batch) return;
    setSavingSiteCashSettlement(true);
    try {
      const saved = await siteCashSettlementService.upsert(detail.batch, detail.lines);
      const refreshed = await siteCashSettlementService.getBatchDetail(saved.id);
      setSiteCashSettlementDetail({ batchId: saved.id, batch: refreshed.batch, lines: refreshed.lines, loading: false, error: null });
      toast.success('Đã lưu bộ hoàn ứng', saved.code);
      await loadSiteCashSettlements();
    } catch (err: any) {
      toast.error('Không lưu được hoàn ứng', err?.message || 'Vui lòng thử lại.');
    } finally {
      setSavingSiteCashSettlement(false);
    }
  };

  const postSiteCashSettlement = async () => {
    const detail = siteCashSettlementDetail;
    if (!detail?.batch) return;
    const summary = calculateSiteCashSettlementSummary({
      openingBalance: detail.batch.openingBalance,
      topupAmount: detail.batch.topupAmount,
      lines: detail.lines,
    });
    if (summary.endingBalance < 0) {
      toast.warning('Quỹ âm', 'Tồn cuối sau hoàn ứng đang âm, cần điều chỉnh tồn đầu/nạp thêm hoặc số duyệt.');
      return;
    }
    if (detail.lines.some(line => line.status === 'pending')) {
      toast.warning('Còn dòng chưa review', 'Mỗi dòng chứng từ cần được chấp nhận, điều chỉnh hoặc từ chối trước khi duyệt.');
      return;
    }
    if (detail.lines.some(line => line.paymentSource === 'staff_paid' && (line.staffReimbursedAmount || 0) > (line.approvedAmount || 0))) {
      toast.warning('Số hoàn cá nhân chưa hợp lệ', 'Số hoàn cá nhân không được vượt số đã duyệt.');
      return;
    }
    setPostingSiteCashSettlement(true);
    try {
      await siteCashSettlementService.upsert(detail.batch, detail.lines);
      const posted = await siteCashSettlementService.post(detail.batch.id, user?.id || null);
      toast.success('Đã duyệt hoàn ứng', posted.code);
      setSiteCashSettlementDetail(null);
      await Promise.all([load(), loadSiteCashSettlements()]);
    } catch (err: any) {
      toast.error('Không duyệt được hoàn ứng', err?.message || 'Vui lòng thử lại.');
    } finally {
      setPostingSiteCashSettlement(false);
    }
  };

  const reverseSiteCashSettlement = async () => {
    const batch = siteCashSettlementDetail?.batch;
    if (!batch) return;
    const ok = await confirm({
      title: 'Đảo bộ hoàn ứng',
      targetName: batch.code,
      warningText: 'Hệ thống sẽ tạo giao dịch đảo, hủy phiếu chi quỹ liên quan và mở lại link phiếu mua nóng.',
      actionLabel: 'Đảo hoàn ứng',
      countdownSeconds: 0,
    });
    if (!ok) return;
    setPostingSiteCashSettlement(true);
    try {
      await siteCashSettlementService.reverse(batch.id, user?.id || null);
      toast.success('Đã đảo bộ hoàn ứng', batch.code);
      setSiteCashSettlementDetail(null);
      await Promise.all([load(), loadSiteCashSettlements()]);
    } catch (err: any) {
      toast.error('Không đảo được hoàn ứng', err?.message || 'Vui lòng thử lại.');
    } finally {
      setPostingSiteCashSettlement(false);
    }
  };

  const openSiteCashSettlementSource = (line: SiteCashSettlementLine) => {
    if (line.sourceType === 'site_direct_purchase') {
      openSourceRoute({
        tab: 'material',
        params: {
          materialTab: 'direct',
          siteDirectPurchaseId: line.sourceId,
        },
      });
    }
  };

  const openPoPayment = (row: ProjectFinancePayableRow) => {
    void openSupplierPaymentBatchForm(row);
  };

  const savePoPayment = async () => {
    if (!poPaymentForm) return;
    const amount = Math.round(Number(poPaymentForm.amount || 0));
    const outstandingAmount = Math.round(Number(poPaymentForm.row.outstandingAmount || 0));
    if (amount <= 0) {
      toast.warning('Thiếu số tiền', 'Nhập số tiền thanh toán lớn hơn 0.');
      return;
    }
    if (amount > outstandingAmount) {
      toast.warning('Vượt số tiền còn phải trả', `Số tiền tối đa có thể ghi là ${fmtMoney(outstandingAmount)}.`);
      return;
    }

    const paymentId = crypto.randomUUID();
    const documentRef = poPaymentForm.documentRef.trim();
    const note = poPaymentForm.note.trim();
    const description = [
      `Thanh toán PO ${poPaymentForm.row.documentNo} - ${poPaymentForm.row.counterpartyName}`,
      documentRef ? `CT: ${documentRef}` : '',
      note,
    ].filter(Boolean).join(' - ');
    const nextTransaction: ProjectTransaction = {
      id: paymentId,
      projectId: projectId || null,
      projectFinanceId: '',
      constructionSiteId,
      type: 'expense',
      category: 'materials',
      amount,
      description,
      date: poPaymentForm.date || todayIso(),
      source: 'manual',
      sourceRef: `purchase_order:${poPaymentForm.row.sourceId}:payment:${paymentId}`,
      attachments: [],
      createdBy: user?.id,
      createdAt: new Date().toISOString(),
    };

    setSavingPoPayment(true);
    try {
      if (poPaymentForm.row.sourceType === 'supplier_payable' || poPaymentForm.row.sourceType === 'purchase_order') {
        try {
          const batchId = crypto.randomUUID();
          const payableDocuments = poPaymentForm.row.sourceType === 'purchase_order'
            ? [await supplierPayableService.syncPurchaseOrderById(poPaymentForm.row.sourceId)]
            : await supplierPayableService.listDocuments({
              projectId: projectId || null,
              constructionSiteId,
              supplierId: poPaymentForm.row.sourceId,
            });
          const openDocuments = payableDocuments.filter(document => Number(document.outstandingAmount || 0) > 0);
          const allocations = allocateSupplierPayment({
            mode: 'fifo',
            paymentBatchId: batchId,
            amount,
            documents: openDocuments,
          });
          if (allocations.length === 0) throw new Error('Không tìm thấy chứng từ AP còn phải trả để phân bổ.');
          const batchCode = `PAY-${(poPaymentForm.date || todayIso()).replaceAll('-', '')}-${batchId.slice(0, 8).toUpperCase()}`;
          await supplierPaymentBatchService.createDraft({
            id: batchId,
            code: batchCode,
            projectId: projectId || null,
            constructionSiteId,
            supplierId: poPaymentForm.row.sourceType === 'supplier_payable' ? poPaymentForm.row.sourceId : openDocuments[0]?.supplierId || null,
            supplierNameSnapshot: poPaymentForm.row.counterpartyName,
            periodMonth: `${(poPaymentForm.date || todayIso()).slice(0, 7)}-01`,
            paymentDate: poPaymentForm.date || todayIso(),
            paymentMethod: 'bank_transfer',
            documentRef: documentRef || null,
            totalRecognizedSnapshot: poPaymentForm.row.recognizedAmount,
            amount,
            paymentAmount: amount,
            currency: 'VND',
            allocationMode: 'fifo',
            status: 'draft',
            qrToken: `pay_${batchId.replaceAll('-', '')}`,
            attachments: [],
            metadata: {
              shortcut: poPaymentForm.row.sourceType,
              note,
            },
            createdBy: user?.id || null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            note: note || null,
          }, allocations);
          await supplierPaymentBatchService.post(batchId, user?.id || null);
          setPoPaymentForm(null);
          toast.success('Đã tạo đợt thanh toán NCC', `${poPaymentForm.row.counterpartyName} đã được ghi nhận qua AP batch.`);
          await load();
          return;
        } catch (batchError: any) {
          if (poPaymentForm.row.sourceType === 'supplier_payable') throw batchError;
          console.warn('Fallback to legacy PO payment transaction', batchError);
        }
      }

      await addProjectTransaction(nextTransaction);
      setPoPaymentForm(null);
      toast.success('Đã ghi thanh toán PO', `${poPaymentForm.row.documentNo} đã được cập nhật trong công nợ phải trả.`);
      const nextTransactions = [nextTransaction, ...transactions.filter(item => item.id !== nextTransaction.id)];
      try {
        setData(await projectFinanceWorkspaceService.getWorkspace({
          projectId,
          constructionSiteId,
          transactions: nextTransactions,
        }));
      } catch (refreshError) {
        console.warn('Cannot refresh finance workspace after PO payment', refreshError);
      }
    } catch (err: any) {
      toast.error('Không ghi được thanh toán PO', err?.message || 'Vui lòng thử lại.');
    } finally {
      setSavingPoPayment(false);
    }
  };

  const uploadTransactionFiles = async (files: File[]): Promise<Attachment[]> => {
    if (files.length === 0) return [];
    const uploaded: Attachment[] = [];
    for (const file of files) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${projectId || constructionSiteId}/finance-transactions/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
      const { error } = await supabase.storage.from('project-attachments').upload(path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type || undefined,
      });
      if (error) throw error;
      const { data: publicUrl } = supabase.storage.from('project-attachments').getPublicUrl(path);
      uploaded.push({
        name: file.name,
        url: publicUrl.publicUrl,
        fileType: file.type,
      });
    }
    return uploaded;
  };

  const downloadBlob = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const downloadTransactionImportTemplate = async () => {
    try {
      const XLSX = await loadXlsx();
      const rows = PROJECT_TRANSACTION_IMPORT_SAMPLE_ROWS.map(row => ({ ...row }));
      const ws = XLSX.utils.json_to_sheet(rows, { header: [...PROJECT_TRANSACTION_IMPORT_HEADERS] });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Giao dịch');
      const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      downloadBlob(new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'Mau_import_giao_dich_tai_chinh.xlsx');
    } catch (err: any) {
      toast.error('Không tạo được file mẫu', err?.message || 'Vui lòng thử lại.');
    }
  };

  const importLedgerTransactions = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const XLSX = await loadXlsx();
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, unknown>[];
      const importCostItems = contractCostItems.length > 0 ? contractCostItems : await contractCostItemService.list();
      const importPartners = partners.length > 0 ? partners : await partnerService.list();
      if (contractCostItems.length === 0 && importCostItems.length > 0) setContractCostItems(importCostItems);
      if (partners.length === 0 && importPartners.length > 0) setPartners(importPartners);

      const previewResult = parseProjectTransactionImportPreviewRows(rows, {
        projectId: projectId || null,
        projectFinanceId: '',
        constructionSiteId,
        costItems: importCostItems,
        partners: importPartners,
        createdBy: user?.id,
      });

      if (previewResult.items.length === 0) {
        toast.warning('File rỗng', 'File Excel không chứa dòng dữ liệu nào.');
        return;
      }

      setImportPreviewResult(previewResult);
    } catch (err: any) {
      toast.error('Không import được giao dịch', err?.message || 'Vui lòng kiểm tra file Excel.');
    }
  };

  const confirmImportPreview = async (selectedTransactions: ProjectTransaction[]) => {
    setSavingImportTransactions(true);
    try {
      await addProjectTransactions(selectedTransactions);
      toast.success(`Đã import thành công ${selectedTransactions.length} giao dịch`, 'Các giao dịch đã được ghi nhận vào Sổ giao dịch.');
      setImportPreviewResult(null);
    } catch (err: any) {
      toast.error('Lỗi khi import giao dịch', err?.message || 'Không thể lưu các giao dịch đã chọn.');
    } finally {
      setSavingImportTransactions(false);
    }
  };

  const openNewTransaction = () => {
    setTransactionFiles([]);
    setTransactionForm({
      id: crypto.randomUUID(),
      projectId: projectId || null,
      projectFinanceId: '',
      constructionSiteId,
      type: 'expense',
      category: 'other',
      amount: 0,
      description: '',
      date: todayIso(),
      source: 'manual',
      sourceRef: '',
      ...clearContractCostItemSnapshot(),
      counterpartyPartnerId: null,
      counterpartyName: '',
      invoiceNo: '',
      invoiceDate: null,
      attachments: [],
      createdBy: user?.id,
      createdAt: new Date().toISOString(),
    });
  };

  const openEditTransaction = (row: ProjectFinanceLedgerRow) => {
    if (row.source !== 'manual') {
      toast.info('Giao dịch khóa', 'Giao dịch này phát sinh từ workflow/import, hãy sửa tại nguồn.');
      return;
    }
    const source = transactions.find(item => item.id === row.id);
    setTransactionFiles([]);
    setTransactionForm({
      id: row.id,
      projectId: projectId || source?.projectId || null,
      projectFinanceId: source?.projectFinanceId || '',
      constructionSiteId,
      type: row.type,
      category: row.category,
      amount: row.amount,
      description: row.description,
      date: row.date || todayIso(),
      source: 'manual',
      sourceRef: row.sourceRef || '',
      contractCostItemId: source?.contractCostItemId || row.contractCostItemId || null,
      contractCostItemSymbolSnapshot: source?.contractCostItemSymbolSnapshot || row.contractCostItemSymbolSnapshot || null,
      contractCostItemNameSnapshot: source?.contractCostItemNameSnapshot || row.contractCostItemNameSnapshot || null,
      costClassificationStatus: source?.costClassificationStatus || row.costClassificationStatus || 'unclassified',
      counterpartyPartnerId: source?.counterpartyPartnerId || row.counterpartyPartnerId || null,
      counterpartyName: source?.counterpartyName || row.counterpartyName || '',
      invoiceNo: source?.invoiceNo || row.invoiceNo || '',
      invoiceDate: source?.invoiceDate || row.invoiceDate || null,
      attachments: source?.attachments || [],
      createdBy: source?.createdBy || user?.id,
      createdAt: source?.createdAt || row.createdAt || new Date().toISOString(),
    });
  };

  const saveTransaction = async () => {
    if (!transactionForm) return;
    if (!transactionForm.description.trim()) {
      toast.warning('Thiếu nội dung', 'Nhập nội dung giao dịch trước khi lưu.');
      return;
    }
    if (Number(transactionForm.amount || 0) <= 0) {
      toast.warning('Thiếu số tiền', 'Nhập số tiền giao dịch lớn hơn 0.');
      return;
    }
    const selectedCostItem = transactionForm.type === 'expense'
      ? contractCostItems.find(item => item.status === 'active' && item.id === transactionForm.contractCostItemId)
      : null;
    if (transactionForm.type === 'expense' && !selectedCostItem) {
      toast.warning('Vui lòng chọn khoản mục chi phí');
      return;
    }
    setSavingTransaction(true);
    try {
      const exists = transactions.some(item => item.id === transactionForm.id);
      const uploadedAttachments = await uploadTransactionFiles(transactionFiles);
      const normalizedTransaction = selectedCostItem
        ? {
            ...applyContractCostItemToTransaction(transactionForm, selectedCostItem),
            category: inferProjectCostCategoryFromCostItem(selectedCostItem),
          }
        : { ...transactionForm, ...clearContractCostItemSnapshot(), category: 'other' as const };
      const next = {
        ...normalizedTransaction,
        projectId: projectId || null,
        constructionSiteId,
        source: 'manual' as const,
        attachments: [...(normalizedTransaction.attachments || []), ...uploadedAttachments],
      };
      if (exists) await updateProjectTransaction(next);
      else await addProjectTransaction(next);
      setTransactionForm(null);
      setTransactionFiles([]);
      toast.success('Đã lưu giao dịch');
    } catch (err: any) {
      toast.error('Không lưu được giao dịch', err?.message || 'Vui lòng thử lại.');
    } finally {
      setSavingTransaction(false);
    }
  };

  const deleteTransaction = async (row: ProjectFinanceLedgerRow) => {
    if (row.source !== 'manual') {
      toast.info('Giao dịch khóa', 'Giao dịch này phát sinh từ workflow/import, không xoá tại sổ giao dịch.');
      return;
    }
    const ok = await confirm({
      title: 'Xóa giao dịch',
      targetName: row.description,
      warningText: 'Giao dịch thủ công này sẽ bị xoá khỏi sổ tài chính công trình.',
      actionLabel: 'Xóa',
      countdownSeconds: 0,
    });
    if (!ok) return;
    try {
      await removeProjectTransaction(row.id);
      toast.success('Đã xóa giao dịch');
    } catch (err: any) {
      toast.error('Không xóa được giao dịch', err?.message || 'Vui lòng thử lại.');
    }
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
                <KpiCard label="Tổng thu" value={summary.cashIn} icon={Banknote} tone="green" hint="Tiền đã thu" />
                <KpiCard label="Doanh thu xác nhận" value={summary.certifiedRevenue} icon={ReceiptText} tone="blue" />
                <KpiCard label="Tạm ứng còn treo" value={summary.advanceOutstanding} icon={CalendarClock} tone="amber" hint="Chưa tất toán" />
                <KpiCard label="Biên tạm tính" value={summary.estimatedMargin} icon={BarChart3} tone={summary.estimatedMargin >= 0 ? 'green' : 'red'} hint="Giá trị HĐ - chi phí" />
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

              <FinanceSupplierControlPanel
                summary={summary.supplierControl}
                onOpenPayables={() => openTab('payables')}
                onOpenSupplierPayments={openSupplierPaymentsTab}
                onOpenMaterialDirect={openMaterialDirectTab}
                onOpenIssueSource={route => openSourceRoute(route)}
                onOpenTrace={openSupplierControlTrace}
              />

              <div className="grid gap-5 xl:grid-cols-2">
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-black text-slate-800 dark:text-white">Phải trả gần nhất</h4>
                    <button onClick={() => openTab('payables')} className="text-xs font-black text-orange-600">Xem tất cả</button>
                  </div>
                  <PayablesTable
                    rows={openPayableRows.slice(0, 5)}
                    canManage={false}
                    onOpenSource={openPayableSource}
                  />
                </section>
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-black text-slate-800 dark:text-white">Phải thu gần nhất</h4>
                    <button onClick={() => openTab('receivables')} className="text-xs font-black text-orange-600">Xem tất cả</button>
                  </div>
                  <ReceivablesTable
                    rows={openReceivableRows.slice(0, 5)}
                    canManage={false}
                    onOpenSource={openSource}
                  />
                </section>
              </div>
            </div>
          )}

          {activeTab === 'budget' && <CostAnalysisPanel constructionSiteId={constructionSiteId} projectId={projectId} />}
          {activeTab === 'payables' && (
            <section className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h4 className="text-sm font-black text-slate-800 dark:text-white">Khoản phải trả</h4>
                  <p className="mt-0.5 text-[11px] font-bold text-slate-400">Theo dõi AP NCC và các đợt thanh toán đã post.</p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
                    <button
                      type="button"
                      onClick={() => setPayablesView('documents')}
                      className={`rounded-md px-3 py-1.5 text-xs font-black ${payablesView === 'documents' ? 'bg-orange-500 text-white' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                    >
                      Chứng từ phải trả
                    </button>
                    <button
                      type="button"
                      onClick={() => setPayablesView('payments')}
                      className={`rounded-md px-3 py-1.5 text-xs font-black ${payablesView === 'payments' ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                    >
                      Thanh toán NCC
                    </button>
                    <button
                      type="button"
                      onClick={() => setPayablesView('settlements')}
                      className={`rounded-md px-3 py-1.5 text-xs font-black ${payablesView === 'settlements' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                    >
                      Hoàn ứng
                    </button>
                  </div>
                  {payablesView === 'documents' && canManageSchedules && (
                    <button type="button" onClick={() => openNewSchedule('payable')} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-xs font-black text-white hover:bg-orange-600">
                      <Plus size={14} /> Thêm phải trả
                    </button>
                  )}
                  {payablesView === 'payments' && canRecordPoPayment && (
                    <button type="button" onClick={() => openSupplierPaymentBatchForm()} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700">
                      <Plus size={14} /> Tạo đợt thanh toán
                    </button>
                  )}
                  {payablesView === 'settlements' && canManageFinance && (
                    <button type="button" onClick={() => void createSiteCashSettlementBatch()} disabled={savingSiteCashSettlement} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-black text-white hover:bg-blue-700 disabled:opacity-50">
                      {savingSiteCashSettlement ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Tạo bộ hoàn ứng
                    </button>
                  )}
                </div>
              </div>
              {payablesView === 'documents' ? (
                <PayablesTable
                  rows={openPayableRows}
                  canManage={canManageSchedules}
                  canRecordPoPayment={canRecordPoPayment}
                  onOpenSource={openPayableSource}
                  onEditSchedule={openEditSchedule}
                  onDeleteSchedule={deleteSchedule}
                  onPayPurchaseOrder={openPoPayment}
                />
              ) : payablesView === 'payments' ? (
                <SupplierPaymentBatchPanel
                  batches={supplierPaymentBatches}
                  loading={loadingSupplierPaymentBatches}
                  canManage={canRecordPoPayment}
                  onCreate={() => openSupplierPaymentBatchForm()}
                  onOpenDetail={openSupplierPaymentBatchDetail}
                  onOpenTrace={openSupplierPaymentBatchTrace}
                />
              ) : (
                <SiteCashSettlementPanel
                  batches={siteCashSettlementBatches}
                  loading={loadingSiteCashSettlements}
                  canManage={canManageFinance}
                  onCreate={() => void createSiteCashSettlementBatch()}
                  onOpenDetail={openSiteCashSettlementDetail}
                  onOpenTrace={openSiteCashSettlementTrace}
                />
              )}
            </section>
          )}
          {activeTab === 'receivables' && (
            <section className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h4 className="text-sm font-black text-slate-800 dark:text-white">Khoản phải thu</h4>
                  <p className="mt-0.5 text-[11px] font-bold text-slate-400">Sửa trực tiếp các khoản nhập tay từ lịch thanh toán.</p>
                </div>
                {canManageSchedules && (
                  <button type="button" onClick={() => openNewSchedule('receivable')} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-xs font-black text-white hover:bg-orange-600">
                    <Plus size={14} /> Thêm phải thu
                  </button>
                )}
              </div>
              <ReceivablesTable
                rows={openReceivableRows}
                canManage={canManageSchedules}
                onOpenSource={openSource}
                onEditSchedule={openEditSchedule}
                onDeleteSchedule={deleteSchedule}
              />
            </section>
          )}
          {activeTab === 'payments' && <PaymentWorkbenchTab constructionSiteId={constructionSiteId} projectId={projectId || undefined} canManageTab={canManageFinance || canManagePayment} />}
          {activeTab === 'cashflow' && (
            <CashFlowTab
              constructionSiteId={constructionSiteId}
              projectId={projectId || undefined}
              transactions={transactions}
              contractValue={summary.contractValue || contractValue}
            />
          )}
          {activeTab === 'ledger' && (
            <section className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h4 className="text-sm font-black text-slate-800 dark:text-white">Sổ giao dịch</h4>
                  <p className="mt-0.5 text-[11px] font-bold text-slate-400">Giao dịch đã hoàn tất, tách riêng tiền đã trả và tiền đã thu.</p>
                </div>
                <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
                  <button
                    type="button"
                    onClick={() => setLedgerView('paid')}
                    className={`rounded-md px-3 py-1.5 text-xs font-black ${ledgerView === 'paid' ? 'bg-red-600 text-white' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                  >
                    Đã trả
                  </button>
                  <button
                    type="button"
                    onClick={() => setLedgerView('received')}
                    className={`rounded-md px-3 py-1.5 text-xs font-black ${ledgerView === 'received' ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                  >
                    Đã thu
                  </button>
                </div>
              </div>
              <LedgerTable
                rows={visibleLedgerRows}
                costItems={contractCostItems}
                partners={partners}
                canManage={canManageLedger}
                onCreate={openNewTransaction}
                onDownloadTemplate={downloadTransactionImportTemplate}
                onImportClick={() => ledgerImportInputRef.current?.click()}
                onEdit={openEditTransaction}
                onDelete={deleteTransaction}
              />
            </section>
          )}
        </>
      )}
      {scheduleForm && (
        <PaymentScheduleFormModal
          form={scheduleForm}
          saving={savingSchedule}
          onChange={setScheduleForm}
          onClose={() => setScheduleForm(null)}
          onSave={saveSchedule}
        />
      )}
      {transactionForm && (
        <TransactionFormModal
          form={transactionForm}
          saving={savingTransaction}
          costItemOptions={costItemOptions}
          partners={partners}
          pendingFiles={transactionFiles}
          onChange={setTransactionForm}
          onAddFiles={files => setTransactionFiles(prev => [...prev, ...files])}
          onRemovePendingFile={index => setTransactionFiles(prev => prev.filter((_, currentIndex) => currentIndex !== index))}
          onRemoveAttachment={index => setTransactionForm(prev => prev ? {
            ...prev,
            attachments: (prev.attachments || []).filter((_, currentIndex) => currentIndex !== index),
          } : prev)}
          onClose={() => {
            setTransactionForm(null);
            setTransactionFiles([]);
          }}
          onSave={saveTransaction}
        />
      )}
      <input
        ref={ledgerImportInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={importLedgerTransactions}
      />
      {importPreviewResult && (
        <ProjectTransactionImportPreviewModal
          isOpen={Boolean(importPreviewResult)}
          costItems={contractCostItems}
          partners={partners}
          initialResult={importPreviewResult}
          saving={savingImportTransactions}
          onClose={() => setImportPreviewResult(null)}
          onConfirm={confirmImportPreview}
        />
      )}
      {poPaymentForm && (
        <PurchaseOrderPaymentModal
          form={poPaymentForm}
          saving={savingPoPayment}
          onChange={setPoPaymentForm}
          onClose={() => setPoPaymentForm(null)}
          onSave={savePoPayment}
        />
      )}
      {supplierPaymentForm && (
        <SupplierPaymentBatchModal
          form={supplierPaymentForm}
          supplierRows={supplierPaymentRows}
          saving={savingSupplierPaymentBatch}
          onClose={() => setSupplierPaymentForm(null)}
          onSelectSupplier={selectSupplierForPaymentForm}
          onChange={setSupplierPaymentForm}
          onManualAllocationChange={updateSupplierManualAllocation}
          onSave={saveSupplierPaymentBatch}
        />
      )}
      <SupplierPaymentBatchDetailDrawer
        state={supplierPaymentBatchDetail}
        reversing={reversingSupplierPaymentBatch}
        onClose={() => setSupplierPaymentBatchDetail(null)}
        onReverse={reverseSupplierPaymentBatch}
        onOpenTrace={openSupplierPaymentBatchTrace}
      />
      <SiteCashSettlementDetailDrawer
        state={siteCashSettlementDetail}
        saving={savingSiteCashSettlement}
        posting={postingSiteCashSettlement}
        cashFunds={cashFunds}
        loadingCashFunds={loadingCashFunds}
        onClose={() => setSiteCashSettlementDetail(null)}
        onBatchChange={updateSiteCashSettlementBatch}
        onLineChange={updateSiteCashSettlementLine}
        onSave={saveSiteCashSettlementDraft}
        onPost={postSiteCashSettlement}
        onReverse={reverseSiteCashSettlement}
        onOpenSource={openSiteCashSettlementSource}
        onOpenTrace={openSiteCashSettlementTrace}
      />
      <SupplierPayableDocumentsDrawer
        state={supplierPayableDrawer}
        onClose={() => setSupplierPayableDrawer(null)}
        onOpenDocumentSource={openSupplierPayableDocumentSource}
        onOpenTrace={openSupplierPayableDocumentTrace}
      />
    </div>
  );
};

export default ProjectFinanceWorkspace;
