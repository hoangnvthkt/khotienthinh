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
  Edit2,
  FileText,
  Landmark,
  Loader2,
  Plus,
  ReceiptText,
  RefreshCcw,
  Search,
  Save,
  Trash2,
  WalletCards,
  X,
} from 'lucide-react';
import CostAnalysisPanel from '../../components/project/CostAnalysisPanel';
import {
  PaymentDossierStatus,
  PaymentQualityStatus,
  PaymentSchedule,
  PaymentScheduleMilestoneType,
  PaymentScheduleStatus,
  ProjectCostCategory,
  ProjectTransaction,
  ProjectTxType,
} from '../../types';
import {
  ProjectFinanceLedgerRow,
  ProjectFinancePayableRow,
  ProjectFinanceReceivableRow,
  ProjectFinanceWorkspaceData,
  ProjectFinanceWorkspaceTab,
  projectFinanceWorkspaceService,
} from '../../lib/projectFinanceWorkspaceService';
import { paymentService } from '../../lib/projectService';
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

const parseMoneyInput = (value: string): number => {
  const parsed = Number(value.replace(/[^\d]/g, ''));
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
};

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

const costCategoryOptions: Array<{ value: ProjectCostCategory; label: string }> = [
  { value: 'materials', label: 'Vật tư' },
  { value: 'labor', label: 'Nhân công' },
  { value: 'subcontract', label: 'Thầu phụ' },
  { value: 'machinery', label: 'Máy móc' },
  { value: 'overhead', label: 'Quản lý chung' },
  { value: 'other', label: 'Khác' },
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
        <FieldLabel label="Đối tượng">
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
  onChange,
  onClose,
  onSave,
}: {
  form: ProjectTransaction;
  saving: boolean;
  onChange: (next: ProjectTransaction) => void;
  onClose: () => void;
  onSave: () => void;
}) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
    <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
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
          <select className={inputClass} value={form.type} onChange={event => onChange({ ...form, type: event.target.value as ProjectTxType })}>
            {txTypeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </FieldLabel>
        <FieldLabel label="Nhóm chi phí">
          <select className={inputClass} value={form.category} onChange={event => onChange({ ...form, category: event.target.value as ProjectCostCategory })}>
            {costCategoryOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </FieldLabel>
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
        <div className="md:col-span-2">
          <FieldLabel label="Mã tham chiếu">
            <input className={inputClass} value={form.sourceRef || ''} onChange={event => onChange({ ...form, sourceRef: event.target.value })} placeholder="Số chứng từ, phiếu thu/chi..." />
          </FieldLabel>
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
            <div className="text-[11px] font-black uppercase tracking-wide text-emerald-600">Ghi thanh toán PO</div>
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
              <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Tổng PO</div>
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
  onOpenSource: (tab: string) => void;
  onEditSchedule?: (row: ProjectFinancePayableRow) => void;
  onDeleteSchedule?: (row: ProjectFinancePayableRow) => void;
  onPayPurchaseOrder?: (row: ProjectFinancePayableRow) => void;
}) => {
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
            <th className="px-3 py-2 text-right">Thao tác</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
          {rows.map(row => {
            const isPurchaseOrder = row.sourceType === 'purchase_order';
            const canPayPurchaseOrder = Boolean(canRecordPoPayment && isPurchaseOrder && row.recognizedAmount > 0 && row.outstandingAmount > 0);
            const isPurchaseOrderPaid = isPurchaseOrder && row.recognizedAmount > 0 && row.outstandingAmount <= 0;
            return (
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
              <td className="px-3 py-3 text-right">
                {canManage && row.sourceType === 'payment_schedule' ? (
                  <div className="flex justify-end gap-1">
                    <button type="button" onClick={() => onEditSchedule?.(row)} className="rounded-md px-2 py-1 text-[10px] font-black text-blue-600 hover:bg-blue-50">
                      <Edit2 size={11} className="inline" /> Sửa
                    </button>
                    <button type="button" onClick={() => onDeleteSchedule?.(row)} className="rounded-md px-2 py-1 text-[10px] font-black text-red-600 hover:bg-red-50">
                      <Trash2 size={11} className="inline" /> Xóa
                    </button>
                  </div>
                ) : isPurchaseOrder ? (
                  <div className="flex flex-wrap justify-end gap-1">
                    {canPayPurchaseOrder && (
                      <button type="button" onClick={() => onPayPurchaseOrder?.(row)} className="rounded-md px-2 py-1 text-[10px] font-black text-emerald-700 hover:bg-emerald-50">
                        <CreditCard size={11} className="inline" /> {row.paidAmount > 0 ? 'Thanh toán tiếp' : 'Ghi thanh toán'}
                      </button>
                    )}
                    {isPurchaseOrderPaid && (
                      <span className="inline-flex rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">
                        Đã thanh toán
                      </span>
                    )}
                    <button type="button" onClick={() => onOpenSource(row.sourceTab)} className="rounded-md px-2 py-1 text-[10px] font-black text-slate-500 hover:bg-slate-50">
                      Nguồn
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => onOpenSource(row.sourceTab)} className="rounded-md px-2 py-1 text-[10px] font-black text-slate-500 hover:bg-slate-50">
                    Nguồn
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
            <th className="px-3 py-2 text-right">Thao tác</th>
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
              <td className="px-3 py-3 text-right">
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

const LedgerTable = ({
  rows,
  canManage,
  onCreate,
  onEdit,
  onDelete,
}: {
  rows: ProjectFinanceLedgerRow[];
  canManage?: boolean;
  onCreate?: () => void;
  onEdit?: (row: ProjectFinanceLedgerRow) => void;
  onDelete?: (row: ProjectFinanceLedgerRow) => void;
}) => {
  const [search, setSearch] = useState('');
  const filtered = rows.filter(row => [row.description, row.sourceRef, row.category, row.type].some(value => String(value || '').toLowerCase().includes(search.toLowerCase())));
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Tìm giao dịch..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs font-bold outline-none focus:border-orange-300 dark:border-slate-700 dark:bg-slate-900"
          />
        </div>
        {canManage && (
          <button type="button" onClick={onCreate} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-xs font-black text-white hover:bg-orange-600">
            <Plus size={14} /> Thêm giao dịch
          </button>
        )}
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
                <th className="px-3 py-2 text-right">Thao tác</th>
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
                  <td className="px-3 py-3 text-right">
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
    updateProjectTransaction,
    removeProjectTransaction,
    user,
  } = useApp();
  const queryParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const [activeTab, setActiveTab] = useState<ProjectFinanceWorkspaceTab>(() => {
    const paramTab = queryParams.get('financeTab');
    return validTab(paramTab) ? paramTab : initialTab;
  });
  const [data, setData] = useState<ProjectFinanceWorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scheduleForm, setScheduleForm] = useState<PaymentSchedule | null>(null);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [transactionForm, setTransactionForm] = useState<ProjectTransaction | null>(null);
  const [savingTransaction, setSavingTransaction] = useState(false);
  const [poPaymentForm, setPoPaymentForm] = useState<PurchaseOrderPaymentForm | null>(null);
  const [savingPoPayment, setSavingPoPayment] = useState(false);
  const canManageSchedules = canManageFinance || canManagePayment;
  const canManageLedger = canManageFinance;
  const canRecordPoPayment = canManageFinance;

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

  const openPoPayment = (row: ProjectFinancePayableRow) => {
    if (!canRecordPoPayment) return;
    if (row.sourceType !== 'purchase_order') {
      openSource(row.sourceTab);
      return;
    }
    if (row.recognizedAmount <= 0) {
      toast.info('Chưa có giá trị phải trả', 'PO này chưa có phần nhận hàng được ghi nhận để thanh toán.');
      return;
    }
    if (row.outstandingAmount <= 0) {
      toast.success('PO đã thanh toán đủ');
      return;
    }
    setPoPaymentForm({
      row,
      amount: row.outstandingAmount,
      date: todayIso(),
      documentRef: '',
      note: '',
    });
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

  const openNewTransaction = () => {
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
    setSavingTransaction(true);
    try {
      const exists = transactions.some(item => item.id === transactionForm.id);
      const next = {
        ...transactionForm,
        projectId: projectId || null,
        constructionSiteId,
        source: 'manual' as const,
      };
      if (exists) await updateProjectTransaction(next);
      else await addProjectTransaction(next);
      setTransactionForm(null);
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
                  <PayablesTable
                    rows={data.payables.slice(0, 5)}
                    canManage={false}
                    onOpenSource={openSource}
                  />
                </section>
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-black text-slate-800 dark:text-white">Phải thu gần nhất</h4>
                    <button onClick={() => openTab('receivables')} className="text-xs font-black text-orange-600">Xem tất cả</button>
                  </div>
                  <ReceivablesTable
                    rows={data.receivables.slice(0, 5)}
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
                  <p className="mt-0.5 text-[11px] font-bold text-slate-400">Sửa trực tiếp các khoản nhập tay từ lịch thanh toán.</p>
                </div>
                {canManageSchedules && (
                  <button type="button" onClick={() => openNewSchedule('payable')} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-xs font-black text-white hover:bg-orange-600">
                    <Plus size={14} /> Thêm phải trả
                  </button>
                )}
              </div>
              <PayablesTable
                rows={data.payables}
                canManage={canManageSchedules}
                canRecordPoPayment={canRecordPoPayment}
                onOpenSource={openSource}
                onEditSchedule={openEditSchedule}
                onDeleteSchedule={deleteSchedule}
                onPayPurchaseOrder={openPoPayment}
              />
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
                rows={data.receivables}
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
            <LedgerTable
              rows={data.ledger}
              canManage={canManageLedger}
              onCreate={openNewTransaction}
              onEdit={openEditTransaction}
              onDelete={deleteTransaction}
            />
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
          onChange={setTransactionForm}
          onClose={() => setTransactionForm(null)}
          onSave={saveTransaction}
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
    </div>
  );
};

export default ProjectFinanceWorkspace;
