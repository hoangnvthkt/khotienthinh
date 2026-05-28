import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  CreditCard,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react';
import { ContractItemType, ProjectSubmissionTarget, QuantityAcceptance, QuantityAcceptanceScope } from '../../types';
import { quantityAcceptanceService, QuantityAcceptanceUnmappedVolume } from '../../lib/quantityAcceptanceService';
import { paymentCertificateService } from '../../lib/paymentCertificateService';
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
const fmtMoney = (n: number) => Number(n || 0).toLocaleString('vi-VN');
const fmtPct = (n?: number | null) => Number(n || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
const clampPercent = (value: number) => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
const nonNegative = (value: number) => Math.max(0, Number.isFinite(value) ? value : 0);
const today = () => new Date().toISOString().slice(0, 10);

const STATUS_PERMISSION: Record<string, ProjectPermissionCode> = {
  submitted: 'submit',
  returned: 'verify',
  approved: 'approve',
  cancelled: 'approve',
};

const ADMIN_PROJECT_PERMS: ProjectPermissionCode[] = ['view', 'edit', 'delete', 'submit', 'verify', 'confirm', 'approve'];

const QuantityAcceptancePanel: React.FC<Props> = ({ contractId, contractType, projectId, constructionSiteId }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const reasonConfirm = useReasonConfirm();
  const { user } = useApp();
  const [items, setItems] = useState<QuantityAcceptance[]>([]);
  const [periodStart, setPeriodStart] = useState(today().slice(0, 8) + '01');
  const [periodEnd, setPeriodEnd] = useState(today());
  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [unmapped, setUnmapped] = useState<QuantityAcceptanceUnmappedVolume[]>([]);
  const [submittingAcceptance, setSubmittingAcceptance] = useState<QuantityAcceptance | null>(null);
  const [acceptanceScope, setAcceptanceScope] = useState<QuantityAcceptanceScope>('internal');

  const isInternalScope = acceptanceScope === 'internal';

  const load = useCallback(async () => {
    setItems(await quantityAcceptanceService.listByContract(contractId, contractType, acceptanceScope));
  }, [acceptanceScope, contractId, contractType]);

  const loadUnmapped = useCallback(async () => {
    setUnmapped(await quantityAcceptanceService.listUnmappedVerifiedVolumes({
      contractId,
      contractType,
      constructionSiteId,
      periodStart,
      periodEnd,
      scope: acceptanceScope,
    }));
  }, [acceptanceScope, contractId, contractType, constructionSiteId, periodStart, periodEnd]);

  useEffect(() => { load().catch(console.error); }, [load]);
  useEffect(() => { loadUnmapped().catch(console.error); }, [loadUnmapped]);

  const createDraft = async () => {
    setCreating(true);
    try {
      if (user?.role !== 'ADMIN') {
        await projectStaffService.requireProjectPermission({
          userId: user?.id,
          projectId,
          constructionSiteId,
          code: 'edit',
          actionLabel: 'tạo nghiệm thu',
        });
      }
      const acceptance = await quantityAcceptanceService.createDraftFromVerifiedLogs({
        contractId,
        contractType,
        constructionSiteId,
        periodStart,
        periodEnd,
        scope: acceptanceScope,
      });
      await load();
      await loadUnmapped();
      toast.success(
        'Đã tạo nghiệm thu nháp',
        `${acceptance.items.length} hạng mục ${isInternalScope ? 'nội bộ' : 'hợp đồng'} từ nhật ký đã xác nhận`,
      );
    } catch (e: any) {
      await loadUnmapped().catch(console.error);
      toast.error('Không tạo được nghiệm thu', e?.message);
    } finally {
      setCreating(false);
    }
  };

  const handleSetStatus = async (
    item: QuantityAcceptance,
    status: 'submitted' | 'returned' | 'approved' | 'cancelled',
    submissionTarget?: ProjectSubmissionTarget,
  ) => {
    if (status === 'submitted' && !submissionTarget) {
      setSubmittingAcceptance(item);
      return;
    }
    const labels: Record<string, string> = {
      submitted: 'Gửi duyệt',
      returned: 'Trả lại',
      approved: 'Phê duyệt',
      cancelled: 'Huỷ nghiệm thu',
    };
    const warningTexts: Record<string, string | undefined> = {
      approved: item.acceptanceScope === 'internal'
        ? 'Duyệt nghiệm thu nội bộ chỉ ghi nhận khối lượng theo tiến độ/BOQ thi công, chưa khóa BOQ hợp đồng và chưa dùng để thanh toán.'
        : 'Duyệt nghiệm thu sẽ khóa các hạng mục BOQ liên quan và cập nhật KL hoàn thành.',
      cancelled: item.acceptanceScope === 'internal'
        ? 'Huỷ sẽ rollback trạng thái phiếu nghiệm thu nội bộ, không ảnh hưởng BOQ hợp đồng.'
        : 'Huỷ sẽ mở khoá hạng mục BOQ và hoàn trả KL hoàn thành về trạng thái trước.',
    };
    const reason = status === 'returned' || status === 'cancelled'
      ? await reasonConfirm({
        title: status === 'returned' ? 'Trả lại nghiệm thu' : 'Huỷ/Rollback nghiệm thu',
        targetName: `Nghiệm thu Đợt ${item.periodNumber}`,
        warningText: status === 'returned'
          ? 'Lý do trả lại sẽ được lưu để người lập chỉnh đúng nội dung.'
          : warningTexts.cancelled,
        reasonPlaceholder: status === 'returned'
          ? 'Nhập lý do trả lại nghiệm thu...'
          : 'Nhập lý do huỷ/rollback nghiệm thu...',
        actionLabel: status === 'returned' ? 'Trả lại' : 'Huỷ nghiệm thu',
        intent: 'danger',
        countdownSeconds: status === 'cancelled' ? 1 : 0,
      })
      : undefined;
    if ((status === 'returned' || status === 'cancelled') && !reason) return;
    if (!(status === 'submitted' && submissionTarget) && status !== 'returned' && status !== 'cancelled') {
      const ok = await confirm({
        title: labels[status] || status,
        targetName: `Nghiệm thu Đợt ${item.periodNumber}`,
        warningText: warningTexts[status],
      });
      if (!ok) return;
    }

    try {
      if (user?.role !== 'ADMIN') {
        await projectStaffService.requireProjectPermission({
          userId: user?.id,
          projectId,
          constructionSiteId,
          code: STATUS_PERMISSION[status],
          actionLabel: labels[status].toLowerCase(),
        });
      }
      const policyAction = status === 'submitted'
        ? 'submit'
        : status === 'returned'
          ? 'return'
          : status === 'approved'
            ? 'approve'
            : 'cancel';
      const statusPolicy = getProjectDocumentPolicy({
        action: policyAction,
        documentType: 'quantity_acceptance',
        status: item.status,
        user,
        permissions: user?.role === 'ADMIN'
          ? ADMIN_PROJECT_PERMS
          : ['view', STATUS_PERMISSION[status]],
        reason,
        currentHandlerIds: [item.submittedToUserId],
        relatedUserIds: [item.submittedBy],
        everSubmitted: item.everSubmitted,
        documentLabel: `Nghiệm thu Đợt ${item.periodNumber}`,
      });
      if (!statusPolicy.allowed) {
        await projectDocumentActionLogService.logBlocked({
          projectId,
          constructionSiteId,
          documentType: 'quantity_acceptance',
          documentId: item.id,
          documentLabel: `Nghiệm thu Đợt ${item.periodNumber}`,
          action: policyAction,
          fromStatus: item.status,
          reason,
          blockedReason: statusPolicy.reason,
          requiredRollbackSteps: statusPolicy.requiredRollbackSteps,
          createdBy: user?.id,
        });
        toast.error('Không thể xử lý nghiệm thu', formatPolicyMessage(statusPolicy));
        return;
      }
      if (status === 'returned' || status === 'cancelled') {
        const deps = status === 'cancelled'
          ? await projectDocumentDependencyService.getQuantityAcceptanceDependencies(item)
          : null;
        const policy = getProjectDocumentPolicy({
          action: status === 'returned' ? 'return' : 'cancel',
          documentType: 'quantity_acceptance',
          status: item.status,
          user,
          permissions: user?.role === 'ADMIN' ? ADMIN_PROJECT_PERMS : ['view', STATUS_PERMISSION[status]],
          dependencies: deps,
          reason,
          currentHandlerIds: [item.submittedToUserId],
          everSubmitted: item.everSubmitted,
          documentLabel: `Nghiệm thu Đợt ${item.periodNumber}`,
        });
        if (!policy.allowed) {
          await projectDocumentActionLogService.logBlocked({
            projectId,
            constructionSiteId,
            documentType: 'quantity_acceptance',
            documentId: item.id,
            documentLabel: `Nghiệm thu Đợt ${item.periodNumber}`,
            action: status === 'returned' ? 'return' : 'cancel',
            fromStatus: item.status,
            reason,
            blockedReason: policy.reason,
            requiredRollbackSteps: policy.requiredRollbackSteps,
            metadata: deps?.metadata,
            createdBy: user?.id,
          });
          toast.error(status === 'returned' ? 'Không thể trả lại nghiệm thu' : 'Không thể huỷ nghiệm thu', formatPolicyMessage(policy));
          return;
        }
      }
      await quantityAcceptanceService.setStatus(item.id, status, user.id, reason, user, projectId, submissionTarget);
      await projectDocumentActionLogService.log({
        projectId,
        constructionSiteId,
        documentType: 'quantity_acceptance',
        documentId: item.id,
        documentLabel: `Nghiệm thu Đợt ${item.periodNumber}`,
        action: status === 'returned' ? 'return' : status,
        fromStatus: item.status,
        toStatus: status,
        reason,
        warningAcknowledged: true,
        createdBy: user?.id,
      });
      await load();
      if (status === 'submitted') setSubmittingAcceptance(null);
      toast.success(`${labels[status]} thành công`);
    } catch (e: any) {
      toast.error('Lỗi', e?.message);
      if (status === 'submitted' && submissionTarget) throw e;
    }
  };

  const handleDelete = async (item: QuantityAcceptance) => {
    try {
      if (user?.role !== 'ADMIN') {
        await projectStaffService.requireProjectPermission({
          userId: user?.id,
          projectId,
          constructionSiteId,
          code: 'delete',
          actionLabel: 'xoá nghiệm thu',
        });
      }
      const deps = await projectDocumentDependencyService.getQuantityAcceptanceDependencies(item);
      const policy = getProjectDocumentPolicy({
        action: 'delete',
        documentType: 'quantity_acceptance',
        status: item.status,
        user,
        permissions: user?.role === 'ADMIN' ? ADMIN_PROJECT_PERMS : ['view', 'delete'],
        dependencies: deps,
        everSubmitted: item.everSubmitted,
        documentLabel: `Nghiệm thu Đợt ${item.periodNumber}`,
      });
      if (!policy.allowed) {
        await projectDocumentActionLogService.logBlocked({
          projectId,
          constructionSiteId,
          documentType: 'quantity_acceptance',
          documentId: item.id,
          documentLabel: `Nghiệm thu Đợt ${item.periodNumber}`,
          action: 'delete',
          fromStatus: item.status,
          blockedReason: policy.reason,
          requiredRollbackSteps: policy.requiredRollbackSteps,
          metadata: deps.metadata,
          createdBy: user?.id,
        });
        toast.warning('Không thể xoá nghiệm thu', formatPolicyMessage(policy));
        return;
      }
      const ok = await confirm({ title: 'Xoá nghiệm thu', targetName: `Đợt ${item.periodNumber}` });
      if (!ok) return;
      await quantityAcceptanceService.remove(item.id);
      if (expandedId === item.id) setExpandedId(null);
      await projectDocumentActionLogService.log({
        projectId,
        constructionSiteId,
        documentType: 'quantity_acceptance',
        documentId: item.id,
        documentLabel: `Nghiệm thu Đợt ${item.periodNumber}`,
        action: 'delete',
        fromStatus: item.status,
        warningAcknowledged: true,
        metadata: deps.metadata,
        createdBy: user?.id,
      });
      await load();
      toast.success('Đã xoá nghiệm thu');
    } catch (e: any) {
      toast.error('Không thể xoá nghiệm thu', e?.message);
    }
  };

  const handleUpdateLine = async (
    acceptance: QuantityAcceptance,
    itemIdx: number,
    updates: { acceptedPercent?: number; acceptedAmount?: number; amountNote?: string },
  ) => {
    if (acceptance.status !== 'draft' && acceptance.status !== 'returned') return;
    const updatedItems = acceptance.items.map((line, idx) => {
      if (idx !== itemIdx) return line;
      const acceptedPercent = updates.acceptedPercent !== undefined
        ? clampPercent(updates.acceptedPercent)
        : Number(line.acceptedPercent || 0);
      const acceptedAmount = updates.acceptedAmount !== undefined
        ? nonNegative(updates.acceptedAmount)
        : Number(line.acceptedAmount || 0);
      return {
        ...line,
        acceptedPercent,
        acceptedAmount,
        amountNote: updates.amountNote !== undefined ? updates.amountNote : line.amountNote,
      };
    });
    try {
      if (user?.role !== 'ADMIN') {
        await projectStaffService.requireProjectPermission({
          userId: user?.id,
          projectId,
          constructionSiteId,
          code: 'edit',
          actionLabel: 'cập nhật nghiệm thu',
        });
      }
      await quantityAcceptanceService.update(acceptance.id, { items: updatedItems });
      await load();
    } catch (e: any) {
      toast.error('Không thể cập nhật nghiệm thu', e?.message);
    }
  };

  const createPayment = async (acceptance: QuantityAcceptance) => {
    if (acceptance.acceptanceScope === 'internal') {
      toast.warning('Chưa thể tạo thanh toán', 'Nghiệm thu nội bộ không dùng để lập chứng từ thanh toán. Hãy tạo nghiệm thu hợp đồng khi cần thanh toán thật.');
      return;
    }
    if (acceptance.status !== 'approved') {
      toast.warning('Chưa thể tạo thanh toán', 'Nghiệm thu cần được duyệt trước.');
      return;
    }
    const ok = await confirm({
      title: 'Tạo chứng từ thanh toán',
      targetName: `từ Nghiệm thu Đợt ${acceptance.periodNumber}`,
      warningText: `Sẽ tạo đợt thanh toán với ${acceptance.items.length} hạng mục, GT: ${fmt(acceptance.totalAcceptedAmount)} đ`,
    });
    if (!ok) return;

    try {
      await paymentCertificateService.create(contractId, contractType, constructionSiteId, {
        acceptanceId: acceptance.id,
        periodStart: acceptance.periodStart,
        periodEnd: acceptance.periodEnd,
        description: `Thanh toán từ nghiệm thu đợt ${acceptance.periodNumber}`,
      });
      await load();
      toast.success('Đã tạo chứng từ thanh toán từ nghiệm thu');
    } catch (e: any) {
      toast.error('Lỗi tạo chứng từ', e?.message);
    }
  };

  return (
    <div className="space-y-3 mt-3">
      <div className="rounded-xl border border-slate-100 bg-white overflow-hidden">
        <div className="p-3 border-b border-slate-100 flex items-center justify-between gap-2 flex-wrap">
          <h4 className="text-xs font-black text-slate-700 flex items-center gap-1.5">
            <ClipboardCheck size={13} className="text-emerald-500" /> {isInternalScope ? 'Nghiệm thu nội bộ' : 'Nghiệm thu khối lượng hợp đồng'}
          </h4>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              {([
                ['internal', 'Nội bộ'],
                ['contract', 'Hợp đồng'],
              ] as [QuantityAcceptanceScope, string][]).map(([scope, label]) => (
                <button
                  key={scope}
                  onClick={() => {
                    setAcceptanceScope(scope);
                    setExpandedId(null);
                  }}
                  className={`rounded-md px-2 py-1 text-[10px] font-black transition ${
                    acceptanceScope === scope
                      ? 'bg-white text-emerald-700 shadow-sm'
                      : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} className="px-2 py-1.5 rounded-lg border border-slate-200 text-[10px]" />
            <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className="px-2 py-1.5 rounded-lg border border-slate-200 text-[10px]" />
            <button onClick={createDraft} disabled={creating} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 disabled:opacity-50">
              <Plus size={10} /> {isInternalScope ? 'Tạo nghiệm thu nội bộ' : 'Tạo từ nhật ký verified'}
            </button>
          </div>
        </div>

        {unmapped.length > 0 && (
          <div className="m-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-black text-amber-700">
                  Có {unmapped.length} dòng khối lượng verified chưa đủ liên kết {isInternalScope ? 'tiến độ nội bộ' : 'BOQ hợp đồng'}
                </div>
                <div className="mt-0.5 text-[10px] font-medium text-amber-700">
                  {isInternalScope
                    ? 'Các dòng này chưa được đưa vào nghiệm thu nội bộ vì nhật ký chưa chọn task/BOQ thi công trong tiến độ.'
                    : 'Các dòng này chưa được đưa vào nghiệm thu vì task/BOQ thi công chưa gắn dòng BOQ hợp đồng trong tiến độ.'}
                </div>
                <div className="mt-2 divide-y divide-amber-100 rounded-lg bg-white/60">
                  {unmapped.slice(0, 5).map((row, idx) => (
                    <div key={`${row.dailyLogId}-${idx}`} className="flex items-center justify-between gap-3 px-2 py-1.5 text-[10px]">
                      <div className="min-w-0">
                        <div className="truncate font-bold text-slate-700">{row.workBoqItemName || row.taskName || row.taskId || 'Chưa rõ đầu mục'}</div>
                        <div className="truncate text-slate-400">{new Date(row.dailyLogDate).toLocaleDateString('vi-VN')} • {row.reason}</div>
                      </div>
                      <div className="shrink-0 font-black text-amber-700">{fmt(row.quantity)} {row.unit || ''}</div>
                    </div>
                  ))}
                  {unmapped.length > 5 && (
                    <div className="px-2 py-1 text-center text-[9px] font-bold text-amber-600">+{unmapped.length - 5} dòng khác</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="divide-y divide-slate-50">
          {items.map(item => (
            <div key={item.id} className="p-3">
              <div className="flex items-center justify-between gap-3">
                <button onClick={() => setExpandedId(expandedId === item.id ? null : item.id)} className="min-w-0 flex flex-1 items-start gap-2 text-left">
                  {expandedId === item.id ? <ChevronDown size={13} className="mt-0.5 text-slate-400" /> : <ChevronRight size={13} className="mt-0.5 text-slate-400" />}
                  <div className="min-w-0">
                    <div className="truncate text-xs font-bold text-slate-800">Đợt {item.periodNumber} • {item.description}</div>
                    <div className="text-[10px] text-slate-400">{new Date(item.periodStart).toLocaleDateString('vi-VN')} - {new Date(item.periodEnd).toLocaleDateString('vi-VN')} • {item.items.length} hạng mục</div>
                  </div>
                </button>
                <div className="flex items-center gap-2">
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded border ${item.status === 'approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                      item.status === 'submitted' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                        item.status === 'cancelled' ? 'bg-slate-100 text-slate-500 border-slate-200' :
                          'bg-slate-50 text-slate-600 border-slate-200'
                    }`}>{item.status === 'cancelled' ? 'Đã huỷ' : item.status}</span>
                  <span className="text-xs font-black text-emerald-600">{fmt(item.totalAcceptedAmount)} đ</span>
                </div>
              </div>

              {expandedId === item.id && item.items.length > 0 && (
                <div className="mt-2 overflow-x-auto rounded-lg bg-slate-50">
                  <table className="w-full min-w-[860px] text-[10px]">
                    <thead className="bg-slate-100 text-[9px] font-black uppercase text-slate-400">
                      <tr>
                        <th className="px-2 py-2 text-left">{item.acceptanceScope === 'internal' ? 'Hạng mục nội bộ' : 'BOQ hợp đồng'}</th>
                        <th className="px-2 py-2 text-right">KL quy đổi</th>
                        <th className="px-2 py-2 text-right">GT gợi ý</th>
                        <th className="px-2 py-2 text-right">% nghiệm thu</th>
                        <th className="px-2 py-2 text-right">{item.acceptanceScope === 'internal' ? 'GT nội bộ' : 'GT nghiệm thu'}</th>
                        <th className="px-2 py-2 text-left">Ghi chú</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white">
                      {item.items.map((line, idx) => {
                        const editable = item.status === 'draft' || item.status === 'returned';
                        const fallbackAmount = Number(line.acceptedQuantity || 0) * Number(line.unitPrice || 0);
                        const rawSuggestedAmount = Number(line.suggestedAmount ?? fallbackAmount);
                        const suggestedAmount = Number.isFinite(rawSuggestedAmount) ? rawSuggestedAmount : 0;
                        return (
                          <tr key={idx}>
                            <td className="px-2 py-1.5 font-bold text-slate-600">
                              {line.contractItemCode ? `${line.contractItemCode} - ` : ''}{line.contractItemName || line.workBoqItemName || line.taskName || 'Hạng mục nội bộ'}
                            </td>
                            <td className="px-2 py-1.5 text-right font-bold text-slate-500">
                              {fmt(line.proposedQuantity)} {line.unit || ''}
                            </td>
                            <td className="px-2 py-1.5 text-right font-bold text-slate-500">
                              {fmtMoney(suggestedAmount)} đ
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              {editable ? (
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  step="0.01"
                                  value={line.acceptedPercent || ''}
                                  onChange={e => handleUpdateLine(item, idx, { acceptedPercent: Number(e.target.value) })}
                                  className="w-20 rounded border border-emerald-200 bg-white px-1 py-0.5 text-right text-[10px] font-bold outline-none focus:ring-1 focus:ring-emerald-300"
                                />
                              ) : (
                                <span className="font-bold">{fmtPct(line.acceptedPercent)}%</span>
                              )}
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              {editable ? (
                                <input
                                  type="number"
                                  min={0}
                                  value={line.acceptedAmount || ''}
                                  onChange={e => handleUpdateLine(item, idx, { acceptedAmount: Number(e.target.value) })}
                                  className="w-28 rounded border border-emerald-200 bg-white px-1 py-0.5 text-right text-[10px] font-bold outline-none focus:ring-1 focus:ring-emerald-300"
                                />
                              ) : (
                                <span className="font-black text-emerald-700">{fmtMoney(line.acceptedAmount)} đ</span>
                              )}
                            </td>
                            <td className="px-2 py-1.5">
                              {editable ? (
                                <input
                                  value={line.amountNote || ''}
                                  onChange={e => handleUpdateLine(item, idx, { amountNote: e.target.value })}
                                  placeholder="Lý do/chốt tay..."
                                  className="w-full rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] outline-none focus:ring-1 focus:ring-emerald-300"
                                />
                              ) : (
                                <span className="text-slate-500">{line.amountNote || line.note || '—'}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {expandedId === item.id && item.items.length === 0 && (
                <div className="mt-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-700">
                  {item.acceptanceScope === 'internal'
                    ? 'Phiếu này chưa có hạng mục. Cần tạo lại sau khi nhật ký verified có liên kết task/BOQ thi công.'
                    : 'Phiếu này chưa có hạng mục. Cần tạo lại sau khi nhật ký verified có liên kết task/BOQ hợp đồng.'}
                </div>
              )}
              {expandedId === item.id && (
                <div className="mt-2 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-2">
                  {(item.status === 'draft' || item.status === 'returned') && (
                    <button onClick={() => handleSetStatus(item, 'submitted')} className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 text-[10px] font-bold text-white hover:bg-amber-600">
                      <Send size={11} /> Gửi duyệt
                    </button>
                  )}
                  {item.status === 'draft' && (
                    <button onClick={() => handleDelete(item)} className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[10px] font-bold text-red-600 hover:bg-red-100">
                      <Trash2 size={11} /> Xoá
                    </button>
                  )}
                  {item.status === 'returned' && (
                    <button onClick={() => handleSetStatus(item, 'cancelled')} className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[10px] font-bold text-red-600 hover:bg-red-100">
                      <XCircle size={11} /> Huỷ
                    </button>
                  )}
                  {item.status === 'submitted' && (
                    <>
                      <button onClick={() => handleSetStatus(item, 'returned')} className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[10px] font-bold text-red-600 hover:bg-red-100">
                        <RotateCcw size={11} /> Trả lại
                      </button>
                      <button onClick={() => handleSetStatus(item, 'approved')} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-[10px] font-bold text-white hover:bg-emerald-700">
                        <Check size={11} /> Phê duyệt
                      </button>
                    </>
                  )}
                  {item.status === 'approved' && (
                    <>
                      {item.acceptanceScope !== 'internal' && (
                        <button onClick={() => createPayment(item)} className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-[10px] font-bold text-white hover:bg-indigo-700">
                          <CreditCard size={11} /> Tạo thanh toán
                        </button>
                      )}
                      <button onClick={() => handleSetStatus(item, 'cancelled')} className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[10px] font-bold text-red-600 hover:bg-red-100">
                        <XCircle size={11} /> Huỷ/Rollback
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
          {items.length === 0 && (
            <div className="p-6 text-center text-xs font-bold text-slate-400">
              {isInternalScope ? 'Chưa có nghiệm thu nội bộ' : 'Chưa có nghiệm thu hợp đồng'}
            </div>
          )}
        </div>
      </div>
      {submittingAcceptance && (
        <ProjectSubmissionDialog
          title={submittingAcceptance.acceptanceScope === 'internal' ? 'Gửi nghiệm thu nội bộ' : 'Gửi nghiệm thu khối lượng'}
          actionLabel="Gửi duyệt"
          documentLabel="Nghiệm thu"
          documentName={`Đợt ${submittingAcceptance.periodNumber} • ${submittingAcceptance.description || (submittingAcceptance.acceptanceScope === 'internal' ? 'Nghiệm thu nội bộ' : 'Nghiệm thu khối lượng')}`}
          documentSubtitle={`Trạng thái hiện tại: ${submittingAcceptance.status}`}
          projectId={projectId}
          constructionSiteId={constructionSiteId}
          recipientPermissionCodes={['approve']}
          recipientHint="Chọn đích danh người có quyền phê duyệt nghiệm thu."
          details={[
            { label: submittingAcceptance.acceptanceScope === 'internal' ? 'Giá trị nội bộ' : 'Giá trị nghiệm thu', value: `${fmt(submittingAcceptance.totalAcceptedAmount)} đ` },
            { label: 'Số dòng', value: `${submittingAcceptance.items.length} hạng mục` },
            { label: 'Kỳ', value: `${new Date(submittingAcceptance.periodStart).toLocaleDateString('vi-VN')} - ${new Date(submittingAcceptance.periodEnd).toLocaleDateString('vi-VN')}` },
            { label: 'Loại nghiệm thu', value: submittingAcceptance.acceptanceScope === 'internal' ? 'Nội bộ theo tiến độ' : (submittingAcceptance.contractType === 'customer' ? 'Hợp đồng khách hàng' : 'Hợp đồng thầu phụ') },
          ]}
          onCancel={() => setSubmittingAcceptance(null)}
          onConfirm={target => handleSetStatus(submittingAcceptance, 'submitted', target)}
        />
      )}
    </div>
  );
};

export default QuantityAcceptancePanel;
