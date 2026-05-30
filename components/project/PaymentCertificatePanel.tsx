import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, FileText, CheckCircle2, Clock, DollarSign, AlertTriangle,
  ChevronDown, ChevronRight, X, Send, Check, CreditCard, XCircle,
} from 'lucide-react';
import { PaymentCertificate, PaymentCertificateStatus, ContractItemType, AdvancePayment, ProjectSubmissionTarget } from '../../types';
import { paymentCertificateService } from '../../lib/paymentCertificateService';
import { advancePaymentService } from '../../lib/advancePaymentService';
import { ProjectPermissionCode, projectStaffService } from '../../lib/projectStaffService';
import { projectDocumentActionLogService } from '../../lib/projectDocumentActionLogService';
import { projectDocumentDependencyService } from '../../lib/projectDocumentDependencyService';
import { formatPolicyMessage, getProjectDocumentPolicy } from '../../lib/projectDocumentPolicy';
import { useToast } from '../../context/ToastContext';
import { useConfirm, useReasonConfirm } from '../../context/ConfirmContext';
import { useApp } from '../../context/AppContext';
import ProjectSubmissionDialog from './ProjectSubmissionDialog';

interface Props {
  contractId: string;
  contractType: ContractItemType;
  projectId?: string;
  constructionSiteId: string;
}

const fmt = (n: number) => n.toLocaleString('vi-VN');
const fmtM = (n: number) => {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' tỷ';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' tr';
  return fmt(n) + ' đ';
};
const fmtPct = (n?: number | null) => Number(n || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
const nonNegative = (value: number) => Math.max(0, Number.isFinite(value) ? value : 0);
const linePreviousAmount = (item: { cumulativeAmount?: number; currentAmount?: number }) =>
  Math.max(0, Number(item.cumulativeAmount || 0) - Number(item.currentAmount || 0));

const STATUS_CFG: Record<PaymentCertificateStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  draft:     { label: 'Nháp',       color: 'text-slate-600',   bg: 'bg-slate-50 border-slate-200',     icon: <Clock size={11} /> },
  submitted: { label: 'Chờ duyệt',  color: 'text-amber-600',   bg: 'bg-amber-50 border-amber-200',     icon: <Send size={11} /> },
  returned:  { label: 'Trả lại',     color: 'text-red-600',     bg: 'bg-red-50 border-red-200',         icon: <AlertTriangle size={11} /> },
  approved:  { label: 'Đã duyệt',   color: 'text-blue-600',    bg: 'bg-blue-50 border-blue-200',       icon: <Check size={11} /> },
  paid:      { label: 'Đã thanh toán', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', icon: <CreditCard size={11} /> },
  cancelled: { label: 'Đã hủy',      color: 'text-slate-500',   bg: 'bg-slate-100 border-slate-200',    icon: <X size={11} /> },
};

const STATUS_PERMISSION: Partial<Record<PaymentCertificateStatus, ProjectPermissionCode>> = {
  submitted: 'submit',
  returned: 'verify',
  approved: 'approve',
  paid: 'confirm',
  cancelled: 'approve',
};

const ADMIN_PROJECT_PERMS: ProjectPermissionCode[] = ['view', 'edit', 'delete', 'submit', 'verify', 'confirm', 'approve'];

const PaymentCertificatePanel: React.FC<Props> = ({ contractId, contractType, projectId, constructionSiteId }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const reasonConfirm = useReasonConfirm();
  const { user } = useApp();
  const [certs, setCerts] = useState<PaymentCertificate[]>([]);
  const [advances, setAdvances] = useState<AdvancePayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingCert, setEditingCert] = useState<PaymentCertificate | null>(null);
  const [submittingCert, setSubmittingCert] = useState<PaymentCertificate | null>(null);
  const [confirmingCert, setConfirmingCert] = useState<PaymentCertificate | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, a] = await Promise.all([
        paymentCertificateService.listByContract(contractId, contractType),
        advancePaymentService.listByContract(contractId, contractType),
      ]);
      setCerts(c);
      setAdvances(a);
    } catch (e: any) { toast.error('Lỗi tải', e?.message); }
    finally { setLoading(false); }
  }, [contractId, contractType]);

  useEffect(() => { load(); }, [load]);

  // Summary
  const totalPaid = certs.filter(c => c.status === 'paid').reduce((s, c) => s + (c.payableThisPeriod ?? c.currentPayableAmount), 0);
  const totalApproved = certs.filter(c => c.status === 'approved' || c.status === 'paid').reduce((s, c) => s + (c.payableThisPeriod ?? c.currentPayableAmount), 0);
  const totalContract = certs[0]?.totalContractValue || 0;
  const advanceBalance = advances.filter(a => a.status === 'active').reduce((s, a) => s + a.remainingAmount, 0);

  const handleCreateCert = async () => {
    try {
      if (user?.role !== 'ADMIN') {
        await projectStaffService.requireProjectPermission({
          userId: user?.id,
          projectId,
          constructionSiteId,
          code: 'edit',
          actionLabel: 'tạo đợt thanh toán',
        });
      }
      const ok = await confirm({
        title: 'Tạo chứng từ thanh toán',
        targetName: `Hợp đồng ${contractId}`,
        warningText: 'Chứng từ mới sẽ lấy dữ liệu nghiệm thu/BOQ hiện tại để lập đợt thanh toán nháp.',
        intent: 'warning',
        actionLabel: 'Tạo chứng từ',
        countdownSeconds: 0,
      });
      if (!ok) return;
      await paymentCertificateService.create(contractId, contractType, constructionSiteId, { projectId });
      await load();
      toast.success('Tạo đợt thanh toán mới');
    } catch (e: any) { toast.error('Lỗi tạo đợt TT', e?.message); }
  };

  const handleStatusChange = async (
    cert: PaymentCertificate,
    newStatus: PaymentCertificateStatus,
    submissionTarget?: ProjectSubmissionTarget,
  ) => {
    if (newStatus === 'submitted' && !submissionTarget) {
      setSubmittingCert(cert);
      return;
    }
    if (newStatus === 'approved' && !submissionTarget) {
      setConfirmingCert(cert);
      return;
    }
    const labels: Record<string, string> = { submitted: 'Gửi duyệt', returned: 'Trả lại', approved: 'Phê duyệt', paid: 'Xác nhận thanh toán', cancelled: 'Huỷ/Rollback chứng từ' };
    const warningText = newStatus === 'cancelled'
      ? 'Rollback chứng từ sẽ hủy trạng thái thanh toán/phê duyệt và mở khóa BOQ liên quan nếu không còn chứng từ paid khác dùng cùng hạng mục.'
      : undefined;
    const reason = newStatus === 'returned' || newStatus === 'cancelled'
      ? await reasonConfirm({
        title: newStatus === 'returned' ? 'Trả lại chứng từ' : 'Huỷ/Rollback chứng từ',
        targetName: `Đợt ${cert.periodNumber}`,
        warningText: newStatus === 'returned'
          ? 'Lý do trả lại sẽ được lưu vào audit trail để người lập chỉnh đúng nội dung.'
          : warningText,
        reasonPlaceholder: newStatus === 'returned'
          ? 'Nhập lý do trả lại chứng từ...'
          : 'Nhập lý do huỷ/rollback chứng từ...',
        actionLabel: newStatus === 'returned' ? 'Trả lại' : 'Huỷ/Rollback',
        intent: 'danger',
        countdownSeconds: newStatus === 'cancelled' ? 1 : 0,
      })
      : undefined;
    if ((newStatus === 'returned' || newStatus === 'cancelled') && !reason) return;
    if (!(newStatus === 'submitted' && submissionTarget) && newStatus !== 'returned' && newStatus !== 'cancelled') {
      const ok = await confirm({ title: labels[newStatus] || newStatus, targetName: `Đợt ${cert.periodNumber}`, warningText });
      if (!ok) return;
    }
    try {
      const requiredPermission = STATUS_PERMISSION[newStatus];
      if (requiredPermission && user?.role !== 'ADMIN') {
        await projectStaffService.requireProjectPermission({
          userId: user?.id,
          projectId,
          constructionSiteId,
          code: requiredPermission,
          actionLabel: (labels[newStatus] || newStatus).toLowerCase(),
        });
      }
      const policyAction = newStatus === 'submitted'
        ? 'submit'
        : newStatus === 'returned'
          ? 'return'
          : newStatus === 'approved'
            ? 'approve'
            : newStatus === 'paid'
              ? 'confirm'
              : 'cancel';
      const statusPolicy = getProjectDocumentPolicy({
        action: policyAction,
        documentType: 'payment_certificate',
        status: cert.status,
        user,
        permissions: user?.role === 'ADMIN'
          ? ADMIN_PROJECT_PERMS
          : ['view', requiredPermission || 'approve'],
        reason,
        currentHandlerIds: [cert.submittedToUserId],
        relatedUserIds: [cert.submittedBy],
        everSubmitted: cert.everSubmitted,
        documentLabel: `Đợt ${cert.periodNumber}`,
      });
      if (!statusPolicy.allowed) {
        await projectDocumentActionLogService.logBlocked({
          projectId,
          constructionSiteId,
          documentType: 'payment_certificate',
          documentId: cert.id,
          documentLabel: `Đợt ${cert.periodNumber}`,
          action: policyAction,
          fromStatus: cert.status,
          reason,
          blockedReason: statusPolicy.reason,
          requiredRollbackSteps: statusPolicy.requiredRollbackSteps,
          createdBy: user?.id,
        });
        toast.error('Không thể xử lý chứng từ', formatPolicyMessage(statusPolicy));
        return;
      }
      if (newStatus === 'returned' || newStatus === 'cancelled') {
        const deps = await projectDocumentDependencyService.getPaymentCertificateDependencies(cert);
        const policy = getProjectDocumentPolicy({
          action: newStatus === 'returned' ? 'return' : 'cancel',
          documentType: 'payment_certificate',
          status: cert.status,
          user,
          permissions: user?.role === 'ADMIN' ? ADMIN_PROJECT_PERMS : ['view', requiredPermission || 'approve'],
          dependencies: deps,
          reason,
          currentHandlerIds: [cert.submittedToUserId],
          everSubmitted: cert.everSubmitted,
          documentLabel: `Đợt ${cert.periodNumber}`,
        });
        if (!policy.allowed) {
          await projectDocumentActionLogService.logBlocked({
            projectId,
            constructionSiteId,
            documentType: 'payment_certificate',
            documentId: cert.id,
            documentLabel: `Đợt ${cert.periodNumber}`,
            action: newStatus === 'returned' ? 'return' : 'cancel',
            fromStatus: cert.status,
            reason,
            blockedReason: policy.reason,
            requiredRollbackSteps: policy.requiredRollbackSteps,
            metadata: deps.metadata,
            createdBy: user?.id,
          });
          toast.error(newStatus === 'returned' ? 'Không thể trả lại chứng từ' : 'Không thể huỷ chứng từ', formatPolicyMessage(policy));
          return;
        }
      }
      await paymentCertificateService.setStatus(cert.id, newStatus, user.id, reason, { approverUser: user, projectId, submissionTarget });
      await projectDocumentActionLogService.log({
        projectId,
        constructionSiteId,
        documentType: 'payment_certificate',
        documentId: cert.id,
        documentLabel: `Đợt ${cert.periodNumber}`,
        action: newStatus === 'returned' ? 'return' : newStatus,
        fromStatus: cert.status,
        toStatus: newStatus,
        reason,
        warningAcknowledged: true,
        createdBy: user?.id,
      });
      await load();
      if (newStatus === 'submitted') setSubmittingCert(null);
      if (newStatus === 'approved') setConfirmingCert(null);
      toast.success(`${labels[newStatus]} thành công`);
    } catch (e: any) {
      toast.error('Lỗi', e?.message);
      if (newStatus === 'submitted' && submissionTarget) throw e;
      if (newStatus === 'approved' && submissionTarget) throw e;
    }
  };

  const handleUpdateItem = async (
    cert: PaymentCertificate,
    itemIdx: number,
    updates: { currentAmount?: number; paymentPercent?: number; paymentNote?: string },
  ) => {
    const updatedItems = cert.items.map((item, i) => {
      if (i !== itemIdx) return item;
      const currentAmount = updates.currentAmount !== undefined
        ? nonNegative(updates.currentAmount)
        : Number(item.currentAmount || 0);
      const previousAmount = linePreviousAmount(item);
      return {
        ...item,
        currentAmount,
        cumulativeAmount: previousAmount + currentAmount,
        paymentPercent: updates.paymentPercent !== undefined
          ? Math.max(0, Number(updates.paymentPercent || 0))
          : item.paymentPercent,
        paymentNote: updates.paymentNote !== undefined ? updates.paymentNote : item.paymentNote,
      };
    });

    try {
      if (user?.role !== 'ADMIN') {
        await projectStaffService.requireProjectPermission({
          userId: user?.id,
          projectId,
          constructionSiteId,
          code: 'edit',
          actionLabel: 'cập nhật chứng từ thanh toán',
        });
      }
      await paymentCertificateService.update(cert.id, {
        items: updatedItems,
      });
      await load();
    } catch (e: any) { toast.error('Lỗi cập nhật', e?.message); }
  };

  const handleUpdateCertificateAmounts = async (cert: PaymentCertificate, updates: Partial<PaymentCertificate>) => {
    try {
      if (user?.role !== 'ADMIN') {
        await projectStaffService.requireProjectPermission({
          userId: user?.id,
          projectId,
          constructionSiteId,
          code: 'edit',
          actionLabel: 'cập nhật chứng từ thanh toán',
        });
      }
      await paymentCertificateService.update(cert.id, updates);
      await load();
    } catch (e: any) { toast.error('Lỗi cập nhật', e?.message); }
  };

  const handleDeleteCert = async (cert: PaymentCertificate) => {
    try {
      if (user?.role !== 'ADMIN') {
        await projectStaffService.requireProjectPermission({
          userId: user?.id,
          projectId,
          constructionSiteId,
          code: 'delete',
          actionLabel: 'xoá đợt thanh toán',
        });
      }
      const deps = await projectDocumentDependencyService.getPaymentCertificateDependencies(cert);
      const policy = getProjectDocumentPolicy({
        action: 'delete',
        documentType: 'payment_certificate',
        status: cert.status,
        user,
        permissions: user?.role === 'ADMIN' ? ADMIN_PROJECT_PERMS : ['view', 'delete'],
        dependencies: deps,
        everSubmitted: cert.everSubmitted,
        documentLabel: `Đợt ${cert.periodNumber}`,
      });
      if (!policy.allowed) {
        await projectDocumentActionLogService.logBlocked({
          projectId,
          constructionSiteId,
          documentType: 'payment_certificate',
          documentId: cert.id,
          documentLabel: `Đợt ${cert.periodNumber}`,
          action: 'delete',
          fromStatus: cert.status,
          blockedReason: policy.reason,
          requiredRollbackSteps: policy.requiredRollbackSteps,
          metadata: deps.metadata,
          createdBy: user?.id,
        });
        toast.warning('Không thể xoá chứng từ', formatPolicyMessage(policy));
        return;
      }
      const ok = await confirm({ title: 'Xoá đợt thanh toán', targetName: `Đợt ${cert.periodNumber}` });
      if (!ok) return;
      await paymentCertificateService.remove(cert.id);
      await projectDocumentActionLogService.log({
        projectId,
        constructionSiteId,
        documentType: 'payment_certificate',
        documentId: cert.id,
        documentLabel: `Đợt ${cert.periodNumber}`,
        action: 'delete',
        fromStatus: cert.status,
        warningAcknowledged: true,
        metadata: deps.metadata,
        createdBy: user?.id,
      });
      await load();
      toast.success('Đã xoá');
    } catch (e: any) { toast.error('Lỗi', e?.message); }
  };

  // Advance payment handlers
  const [showAddAdvance, setShowAddAdvance] = useState(false);
  const [advForm, setAdvForm] = useState({ amount: 0, date: new Date().toISOString().slice(0, 10), recoveryPercent: 30, note: '' });

  const handleAddAdvance = async () => {
    if (advForm.amount <= 0) { toast.warning('Nhập số tiền tạm ứng'); return; }
    try {
      const ok = await confirm({
        title: 'Ghi nhận tạm ứng',
        targetName: fmtM(advForm.amount),
        subtitle: `Ngày ${advForm.date} - Thu hồi ${fmtPct(advForm.recoveryPercent)}%`,
        warningText: 'Khoản tạm ứng sẽ được dùng để tính thu hồi trong các chứng từ thanh toán sau.',
        intent: 'warning',
        actionLabel: 'Ghi nhận',
        countdownSeconds: 0,
      });
      if (!ok) return;
      await advancePaymentService.create({ contractId, contractType, constructionSiteId, amount: advForm.amount, date: advForm.date, recoveryPercent: advForm.recoveryPercent, note: advForm.note });
      setShowAddAdvance(false);
      setAdvForm({ amount: 0, date: new Date().toISOString().slice(0, 10), recoveryPercent: 30, note: '' });
      await load();
      toast.success('Thêm tạm ứng thành công');
    } catch (e: any) { toast.error('Lỗi', e?.message); }
  };

  return (
    <div className="space-y-4 mt-3">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'GT Hợp đồng', value: fmtM(totalContract), color: 'text-slate-800 dark:text-white', icon: <FileText size={11} /> },
          { label: 'Đã thanh toán', value: fmtM(totalPaid), color: 'text-emerald-600', icon: <CreditCard size={11} /> },
          { label: 'Đã duyệt', value: fmtM(totalApproved), color: 'text-blue-600', icon: <CheckCircle2 size={11} /> },
          { label: 'TU còn lại', value: fmtM(advanceBalance), color: 'text-amber-600', icon: <DollarSign size={11} /> },
        ].map((k, i) => (
          <div key={i} className="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-100 dark:border-slate-700">
            <div className="text-[9px] font-bold text-slate-400 uppercase flex items-center gap-1 mb-1">{k.icon} {k.label}</div>
            <div className={`text-lg font-black ${k.color}`}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Advance Payments Section */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-black text-slate-700 dark:text-white flex items-center gap-1.5">
            <DollarSign size={13} className="text-amber-500" /> Tạm ứng
          </h4>
          <button onClick={() => setShowAddAdvance(!showAddAdvance)}
            className="text-[10px] font-bold text-amber-600 hover:text-amber-700 flex items-center gap-1">
            <Plus size={10} /> Thêm TU
          </button>
        </div>
        {showAddAdvance && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
            <input type="number" placeholder="Số tiền" value={advForm.amount || ''} onChange={e => setAdvForm({ ...advForm, amount: Number(e.target.value) })}
              className="px-2 py-1.5 rounded-lg border border-amber-300 text-xs outline-none" />
            <input type="date" value={advForm.date} onChange={e => setAdvForm({ ...advForm, date: e.target.value })}
              className="px-2 py-1.5 rounded-lg border border-amber-300 text-xs outline-none" />
            <input type="number" placeholder="% thu hồi" value={advForm.recoveryPercent} onChange={e => setAdvForm({ ...advForm, recoveryPercent: Number(e.target.value) })}
              className="px-2 py-1.5 rounded-lg border border-amber-300 text-xs outline-none" />
            <input placeholder="Ghi chú" value={advForm.note} onChange={e => setAdvForm({ ...advForm, note: e.target.value })}
              className="px-2 py-1.5 rounded-lg border border-amber-300 text-xs outline-none" />
            <div className="flex gap-1">
              <button onClick={handleAddAdvance} className="flex-1 px-2 py-1.5 rounded-lg text-[10px] font-bold text-white bg-amber-500 hover:bg-amber-600">Lưu</button>
              <button onClick={() => setShowAddAdvance(false)} className="px-2 py-1.5 rounded-lg text-[10px] font-bold text-slate-500 hover:bg-slate-100"><X size={12} /></button>
            </div>
          </div>
        )}
        {advances.length === 0 ? (
          <p className="text-[10px] text-slate-400">Chưa có tạm ứng</p>
        ) : (
          <div className="space-y-1.5">
            {advances.map(a => (
              <div key={a.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-700/50 text-xs">
                <div className="flex items-center gap-3">
                  <span className="font-bold text-amber-600">{fmtM(a.amount)}</span>
                  <span className="text-slate-400">{new Date(a.date).toLocaleDateString('vi-VN')}</span>
                  <span className="text-[9px] text-slate-400">Thu hồi {a.recoveryPercent}%</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-emerald-600">Đã thu: {fmtM(a.recoveredAmount)}</span>
                  <span className="text-[10px] font-bold text-red-500">Còn: {fmtM(a.remainingAmount)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Payment Certificates List */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
          <h4 className="text-xs font-black text-slate-700 dark:text-white flex items-center gap-1.5">
            <FileText size={13} className="text-indigo-500" /> Đợt thanh toán ({certs.length})
          </h4>
          <button onClick={handleCreateCert}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100">
            <Plus size={10} /> Tạo đợt mới
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-slate-400">Đang tải...</div>
        ) : certs.length === 0 ? (
          <div className="p-8 text-center">
            <FileText size={32} className="mx-auto mb-2 text-slate-200" />
            <p className="text-xs font-bold text-slate-400">Chưa có đợt thanh toán</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50 dark:divide-slate-700">
            {certs.map(cert => {
              const st = STATUS_CFG[cert.status];
              const isExpanded = expandedId === cert.id;
              const certEditable = cert.status === 'draft' || cert.status === 'returned';
              return (
                <div key={cert.id}>
                  {/* Cert Header */}
                  <div className="flex items-center justify-between px-4 py-3 hover:bg-slate-50/50 dark:hover:bg-slate-700/30 cursor-pointer group"
                    onClick={() => setExpandedId(isExpanded ? null : cert.id)}>
                    <div className="flex items-center gap-3">
                      {isExpanded ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                      <div>
                        <div className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-2">
                          Đợt {cert.periodNumber}
                          <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[9px] font-bold border ${st.bg} ${st.color}`}>
                            {st.icon} {st.label}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400">{cert.description}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-black text-emerald-600">{fmtM(cert.payableThisPeriod ?? cert.currentPayableAmount)}</div>
                      <div className="text-[10px] text-slate-400">GT thanh toán</div>
                    </div>
                  </div>

                  {/* Cert Detail */}
                  {isExpanded && (
                    <div className="px-4 pb-4 bg-slate-50/30 dark:bg-slate-700/20 border-t border-slate-100 dark:border-slate-700 space-y-3">
                      {/* Items Table */}
                      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-600 mt-3">
                        <table className="w-full min-w-[980px] text-left">
                          <thead>
                            <tr className="bg-indigo-50/50 dark:bg-slate-700">
                              <th className="px-2 py-2 text-[8px] font-black text-slate-500 uppercase">Mã</th>
                              <th className="px-2 py-2 text-[8px] font-black text-slate-500 uppercase">Hạng mục</th>
                              <th className="px-2 py-2 text-[8px] font-black text-slate-500 uppercase text-right">GT HĐ</th>
                              <th className="px-2 py-2 text-[8px] font-black text-slate-500 uppercase text-right">GT nghiệm thu</th>
                              <th className="px-2 py-2 text-[8px] font-black text-slate-500 uppercase text-right">Đã TT trước</th>
                              <th className="px-2 py-2 text-[8px] font-black text-slate-500 uppercase text-right">% TT</th>
                              <th className="px-2 py-2 text-[8px] font-black text-slate-500 uppercase text-right">GT đề nghị TT</th>
                              <th className="px-2 py-2 text-[8px] font-black text-slate-500 uppercase text-left">Ghi chú</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50 dark:divide-slate-700">
                            {cert.items.map((item, idx) => {
                              const contractAmount = Number(item.contractAmount ?? 0)
                                || Number(item.revisedContractQuantity ?? item.contractQuantity ?? 0) * Number(item.unitPrice || 0);
                              const previousAmount = linePreviousAmount(item);
                              const sourceAcceptedAmount = Number(item.sourceAcceptedAmount || item.currentAmount || 0);
                              return (
                                <tr key={idx} className="hover:bg-indigo-50/20">
                                  <td className="px-2 py-1.5 text-[10px] font-bold text-indigo-600">{item.contractItemCode}</td>
                                  <td className="px-2 py-1.5 text-[10px] text-slate-700 dark:text-slate-300">
                                    <div className="font-bold">{item.contractItemName}</div>
                                    <div className="text-[9px] text-slate-400">KL tham chiếu {fmt(item.currentQuantity)} {item.unit || ''} • ĐG {fmt(item.unitPrice)}</div>
                                  </td>
                                  <td className="px-2 py-1.5 text-[10px] text-right">{fmtM(contractAmount)}</td>
                                  <td className="px-2 py-1.5 text-[10px] text-right font-bold text-blue-600">{fmtM(sourceAcceptedAmount)}</td>
                                  <td className="px-2 py-1.5 text-[10px] text-right text-slate-500">{fmtM(previousAmount)}</td>
                                  <td className="px-2 py-1.5 text-right">
                                    {certEditable ? (
                                      <input
                                        type="number"
                                        min={0}
                                        step="0.01"
                                        value={item.paymentPercent || ''}
                                        onChange={e => handleUpdateItem(cert, idx, { paymentPercent: Number(e.target.value) })}
                                        className="w-20 px-1 py-0.5 rounded border border-indigo-300 text-[10px] text-right outline-none focus:ring-1 focus:ring-indigo-400"
                                      />
                                    ) : (
                                      <span className="text-[10px] font-bold">{fmtPct(item.paymentPercent)}%</span>
                                    )}
                                  </td>
                                  <td className="px-2 py-1.5 text-right">
                                    {certEditable ? (
                                      <input
                                        type="number"
                                        min={0}
                                        value={item.currentAmount || ''}
                                        onChange={e => handleUpdateItem(cert, idx, { currentAmount: Number(e.target.value) })}
                                        className="w-28 px-1 py-0.5 rounded border border-indigo-300 text-[10px] text-right font-bold outline-none focus:ring-1 focus:ring-indigo-400"
                                      />
                                    ) : (
                                      <span className="text-[10px] font-black text-emerald-600">{fmtM(item.currentAmount)}</span>
                                    )}
                                  </td>
                                  <td className="px-2 py-1.5">
                                    {certEditable ? (
                                      <input
                                        value={item.paymentNote || ''}
                                        onChange={e => handleUpdateItem(cert, idx, { paymentNote: e.target.value })}
                                        placeholder="Lý do/chốt số tiền..."
                                        className="w-full px-2 py-0.5 rounded border border-slate-200 text-[10px] outline-none focus:ring-1 focus:ring-indigo-400"
                                      />
                                    ) : (
                                      <span className="text-[10px] text-slate-500">{item.paymentNote || item.note || '—'}</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                            {cert.items.length === 0 && (
                              <tr>
                                <td colSpan={8} className="px-3 py-4 text-center text-[10px] font-bold text-amber-600">
                                  Chứng từ này chưa có hạng mục. Cần tạo lại sau khi có BOQ/nghiệm thu hợp lệ.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>

                      {/* Calculation Block */}
                      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-600 p-4 space-y-2">
                        <h5 className="text-[10px] font-black text-slate-500 uppercase mb-2">Tính toán thanh toán</h5>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-500">GT đề nghị thanh toán kỳ này</span>
                          <span className="text-sm font-bold text-slate-800 dark:text-white">{fmtM(cert.grossThisPeriod ?? cert.currentCompletedValue)}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-500">GT đề nghị lũy kế</span>
                          <span className="font-bold text-blue-600">{fmtM(cert.grossCumulative ?? cert.totalCompletedValue)}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-500">Đã TT đợt trước</span>
                          <span className="font-bold text-slate-500">{fmtM(cert.previousCertifiedAmount)}</span>
                        </div>
                        {[
                          {
                            label: '(−) Thu hồi tạm ứng nhập tay',
                            value: cert.advanceRecoveryThisPeriod ?? cert.advanceRecovery,
                            updates: (value: number) => ({ advanceRecoveryThisPeriod: value, advanceRecovery: value }),
                          },
                          {
                            label: '(−) Giữ lại bảo hành nhập tay',
                            value: cert.retentionThisPeriod ?? cert.retentionAmount,
                            updates: (value: number) => ({ retentionThisPeriod: value, retentionAmount: value }),
                          },
                        ].map(row => (
                          <div key={row.label} className="flex items-center justify-between gap-3 text-xs">
                            <span className="text-slate-500">{row.label}</span>
                            {certEditable ? (
                              <input
                                type="number"
                                min={0}
                                value={row.value || ''}
                                onChange={e => handleUpdateCertificateAmounts(cert, row.updates(nonNegative(Number(e.target.value))))}
                                className="w-32 rounded border border-indigo-300 px-2 py-1 text-right text-[10px] font-bold outline-none focus:ring-1 focus:ring-indigo-400"
                              />
                            ) : (
                              <span className="font-bold text-red-500">{fmtM(row.value)}</span>
                            )}
                          </div>
                        ))}
                        <div className="grid gap-2 md:grid-cols-[1fr_9rem_1.4fr] md:items-center text-xs">
                          <span className="text-slate-500">(−) Phạt</span>
                          {certEditable ? (
                            <>
                              <input
                                type="number"
                                min={0}
                                value={cert.penaltyAmount || ''}
                                onChange={e => handleUpdateCertificateAmounts(cert, { penaltyAmount: nonNegative(Number(e.target.value)) })}
                                className="rounded border border-indigo-300 px-2 py-1 text-right text-[10px] font-bold outline-none focus:ring-1 focus:ring-indigo-400"
                              />
                              <input
                                value={cert.penaltyReason || ''}
                                onChange={e => handleUpdateCertificateAmounts(cert, { penaltyReason: e.target.value })}
                                placeholder="Lý do phạt..."
                                className="rounded border border-slate-200 px-2 py-1 text-[10px] outline-none focus:ring-1 focus:ring-indigo-400"
                              />
                            </>
                          ) : (
                            <>
                              <span className="text-right font-bold text-red-500">{fmtM(cert.penaltyAmount)}</span>
                              <span className="text-[10px] italic text-slate-400">{cert.penaltyReason || '—'}</span>
                            </>
                          )}
                        </div>
                        <div className="grid gap-2 md:grid-cols-[1fr_9rem_1.4fr] md:items-center text-xs">
                          <span className="text-slate-500">(−) Khấu trừ khác</span>
                          {certEditable ? (
                            <>
                              <input
                                type="number"
                                min={0}
                                value={cert.deductionAmount || ''}
                                onChange={e => handleUpdateCertificateAmounts(cert, { deductionAmount: nonNegative(Number(e.target.value)) })}
                                className="rounded border border-indigo-300 px-2 py-1 text-right text-[10px] font-bold outline-none focus:ring-1 focus:ring-indigo-400"
                              />
                              <input
                                value={cert.deductionReason || ''}
                                onChange={e => handleUpdateCertificateAmounts(cert, { deductionReason: e.target.value })}
                                placeholder="Lý do khấu trừ..."
                                className="rounded border border-slate-200 px-2 py-1 text-[10px] outline-none focus:ring-1 focus:ring-indigo-400"
                              />
                            </>
                          ) : (
                            <>
                              <span className="text-right font-bold text-red-500">{fmtM(cert.deductionAmount)}</span>
                              <span className="text-[10px] italic text-slate-400">{cert.deductionReason || '—'}</span>
                            </>
                          )}
                        </div>
                        <div className="border-t-2 border-indigo-200 dark:border-indigo-800 pt-2 mt-2 flex items-center justify-between">
                          <span className="text-xs font-black text-indigo-700 dark:text-indigo-300 uppercase">GT thanh toán đợt này</span>
                          <span className="text-lg font-black text-indigo-700 dark:text-indigo-300">{fmtM(cert.payableThisPeriod ?? cert.currentPayableAmount)}</span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2 justify-end">
                        {(cert.status === 'draft' || cert.status === 'returned') && (
                          <>
                            {cert.status === 'draft' && <button onClick={() => handleDeleteCert(cert)} className="px-3 py-1.5 rounded-lg text-[10px] font-bold text-red-500 hover:bg-red-50 border border-red-200">Xoá</button>}
                            <button onClick={() => handleStatusChange(cert, 'submitted')} className="px-3 py-1.5 rounded-lg text-[10px] font-bold text-white bg-amber-500 hover:bg-amber-600 flex items-center gap-1">
                              <Send size={10} /> Gửi duyệt
                            </button>
                          </>
                        )}
                        {cert.status === 'submitted' && (
                          <>
                            <button onClick={() => handleStatusChange(cert, 'returned')} className="px-3 py-1.5 rounded-lg text-[10px] font-bold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 flex items-center gap-1">
                              <AlertTriangle size={10} /> Trả lại
                            </button>
                            <button onClick={() => handleStatusChange(cert, 'approved')} className="px-3 py-1.5 rounded-lg text-[10px] font-bold text-white bg-blue-500 hover:bg-blue-600 flex items-center gap-1">
                              <Check size={10} /> Phê duyệt
                            </button>
                          </>
                        )}
                        {cert.status === 'approved' && (
                          <>
                            <button onClick={() => handleStatusChange(cert, 'cancelled')} className="px-3 py-1.5 rounded-lg text-[10px] font-bold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 flex items-center gap-1">
                              <XCircle size={10} /> Huỷ/Rollback
                            </button>
                            <button onClick={() => handleStatusChange(cert, 'paid')} className="px-3 py-1.5 rounded-lg text-[10px] font-bold text-white bg-emerald-500 hover:bg-emerald-600 flex items-center gap-1">
                              <CreditCard size={10} /> Xác nhận thanh toán
                            </button>
                          </>
                        )}
                        {cert.status === 'paid' && (
                          <button onClick={() => handleStatusChange(cert, 'cancelled')} className="px-3 py-1.5 rounded-lg text-[10px] font-bold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 flex items-center gap-1">
                            <XCircle size={10} /> Huỷ/Rollback
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {submittingCert && (
        <ProjectSubmissionDialog
          title="Gửi chứng từ thanh toán"
          actionLabel="Gửi duyệt"
          documentLabel="Thanh toán"
          documentName={`Đợt ${submittingCert.periodNumber} • ${submittingCert.description || 'Chứng từ thanh toán'}`}
          documentSubtitle={`Trạng thái hiện tại: ${STATUS_CFG[submittingCert.status].label}`}
          projectId={projectId}
          constructionSiteId={constructionSiteId}
          recipientPermissionCodes={['approve']}
          recipientHint="Chọn đích danh người có quyền phê duyệt chứng từ thanh toán."
          details={[
            { label: 'Giá trị đề nghị', value: fmtM(submittingCert.grossThisPeriod ?? submittingCert.currentCompletedValue) },
            { label: 'Giá trị thanh toán', value: fmtM(submittingCert.payableThisPeriod ?? submittingCert.currentPayableAmount) },
            { label: 'Số dòng', value: `${submittingCert.items.length} hạng mục` },
            { label: 'Kỳ', value: `${new Date(submittingCert.periodStart).toLocaleDateString('vi-VN')} - ${new Date(submittingCert.periodEnd).toLocaleDateString('vi-VN')}` },
          ]}
          onCancel={() => setSubmittingCert(null)}
          onConfirm={target => handleStatusChange(submittingCert, 'submitted', target)}
        />
      )}
      {confirmingCert && (
        <ProjectSubmissionDialog
          title="Phê duyệt chứng từ thanh toán"
          actionLabel="Duyệt và chuyển xác nhận"
          documentLabel="Thanh toán"
          documentName={`Đợt ${confirmingCert.periodNumber} • ${confirmingCert.description || 'Chứng từ thanh toán'}`}
          documentSubtitle={`Trạng thái hiện tại: ${STATUS_CFG[confirmingCert.status].label}`}
          projectId={projectId}
          constructionSiteId={constructionSiteId}
          recipientPermissionCodes={['confirm']}
          recipientHint="Chọn đích danh người xác nhận thanh toán/chi tiền ở bước tiếp theo."
          details={[
            { label: 'Giá trị đề nghị', value: fmtM(confirmingCert.grossThisPeriod ?? confirmingCert.currentCompletedValue) },
            { label: 'Giá trị thanh toán', value: fmtM(confirmingCert.payableThisPeriod ?? confirmingCert.currentPayableAmount) },
            { label: 'Số dòng', value: `${confirmingCert.items.length} hạng mục` },
            { label: 'Kỳ', value: `${new Date(confirmingCert.periodStart).toLocaleDateString('vi-VN')} - ${new Date(confirmingCert.periodEnd).toLocaleDateString('vi-VN')}` },
          ]}
          onCancel={() => setConfirmingCert(null)}
          onConfirm={target => handleStatusChange(confirmingCert, 'approved', target)}
        />
      )}
    </div>
  );
};

export default PaymentCertificatePanel;
