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
import { ContractItemType, QuantityAcceptance } from '../../types';
import { quantityAcceptanceService, QuantityAcceptanceUnmappedVolume } from '../../lib/quantityAcceptanceService';
import { paymentCertificateService } from '../../lib/paymentCertificateService';
import { ProjectPermissionCode, projectStaffService } from '../../lib/projectStaffService';
import { projectDocumentActionLogService } from '../../lib/projectDocumentActionLogService';
import { projectDocumentDependencyService } from '../../lib/projectDocumentDependencyService';
import { formatPolicyMessage, getProjectDocumentPolicy } from '../../lib/projectDocumentPolicy';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useApp } from '../../context/AppContext';

interface Props {
  contractId: string;
  contractType: ContractItemType;
  projectId?: string;
  constructionSiteId: string;
}

const fmt = (n: number) => n.toLocaleString('vi-VN');
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
  const { user } = useApp();
  const [items, setItems] = useState<QuantityAcceptance[]>([]);
  const [periodStart, setPeriodStart] = useState(today().slice(0, 8) + '01');
  const [periodEnd, setPeriodEnd] = useState(today());
  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [unmapped, setUnmapped] = useState<QuantityAcceptanceUnmappedVolume[]>([]);

  const load = useCallback(async () => {
    setItems(await quantityAcceptanceService.listByContract(contractId, contractType));
  }, [contractId, contractType]);

  const loadUnmapped = useCallback(async () => {
    setUnmapped(await quantityAcceptanceService.listUnmappedVerifiedVolumes({
      contractId,
      contractType,
      constructionSiteId,
      periodStart,
      periodEnd,
    }));
  }, [contractId, contractType, constructionSiteId, periodStart, periodEnd]);

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
      });
      await load();
      await loadUnmapped();
      toast.success('Đã tạo nghiệm thu nháp', `${acceptance.items.length} hạng mục từ nhật ký đã xác nhận`);
    } catch (e: any) {
      await loadUnmapped().catch(console.error);
      toast.error('Không tạo được nghiệm thu', e?.message);
    } finally {
      setCreating(false);
    }
  };

  const handleSetStatus = async (item: QuantityAcceptance, status: 'submitted' | 'returned' | 'approved' | 'cancelled') => {
    const labels: Record<string, string> = {
      submitted: 'Gửi duyệt',
      returned: 'Trả lại',
      approved: 'Phê duyệt',
      cancelled: 'Huỷ nghiệm thu',
    };
    const warningTexts: Record<string, string | undefined> = {
      approved: 'Duyệt nghiệm thu sẽ khóa các hạng mục BOQ liên quan và cập nhật KL hoàn thành.',
      cancelled: 'Huỷ sẽ mở khoá hạng mục BOQ và hoàn trả KL hoàn thành về trạng thái trước.',
    };
    const reason = status === 'returned' || status === 'cancelled'
      ? window.prompt(status === 'returned' ? 'Nhập lý do trả lại nghiệm thu' : 'Nhập lý do huỷ/rollback nghiệm thu')?.trim()
      : undefined;
    if ((status === 'returned' || status === 'cancelled') && !reason) {
      toast.warning('Cần nhập lý do', 'Thao tác trả lại/huỷ cần lý do để truy vết.');
      return;
    }
    const ok = await confirm({
      title: labels[status] || status,
      targetName: `Nghiệm thu Đợt ${item.periodNumber}`,
      warningText: warningTexts[status],
    });
    if (!ok) return;

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
      await quantityAcceptanceService.setStatus(item.id, status, user.id, reason, user, projectId);
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
      toast.success(`${labels[status]} thành công`);
    } catch (e: any) {
      toast.error('Lỗi', e?.message);
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

  const handleUpdateLine = async (acceptance: QuantityAcceptance, itemIdx: number, acceptedQuantity: number) => {
    if (acceptance.status !== 'draft' && acceptance.status !== 'returned') return;
    const updatedItems = acceptance.items.map((line, idx) => {
      if (idx !== itemIdx) return line;
      const safeQty = Math.max(0, Number(acceptedQuantity || 0));
      const cumulativeAcceptedQuantity = line.previousAcceptedQuantity + safeQty;
      return {
        ...line,
        acceptedQuantity: safeQty,
        cumulativeAcceptedQuantity,
        acceptedAmount: safeQty * line.unitPrice,
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
        items: acceptance.items.map(item => ({
          contractItemId: item.contractItemId,
          contractItemCode: item.contractItemCode,
          contractItemName: item.contractItemName,
          unit: item.unit,
          contractQuantity: item.cumulativeAcceptedQuantity,
          revisedContractQuantity: item.cumulativeAcceptedQuantity,
          previousQuantity: item.previousAcceptedQuantity,
          currentQuantity: item.acceptedQuantity,
          certifiedQuantity: item.acceptedQuantity,
          cumulativeQuantity: item.cumulativeAcceptedQuantity,
          unitPrice: item.unitPrice,
          currentAmount: item.acceptedAmount,
          cumulativeAmount: item.cumulativeAcceptedQuantity * item.unitPrice,
          sourceAcceptanceItemId: item.id,
        })),
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
            <ClipboardCheck size={13} className="text-emerald-500" /> Nghiệm thu khối lượng
          </h4>
          <div className="flex items-center gap-2">
            <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} className="px-2 py-1.5 rounded-lg border border-slate-200 text-[10px]" />
            <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className="px-2 py-1.5 rounded-lg border border-slate-200 text-[10px]" />
            <button onClick={createDraft} disabled={creating} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 disabled:opacity-50">
              <Plus size={10} /> Tạo từ nhật ký verified
            </button>
          </div>
        </div>

        {unmapped.length > 0 && (
          <div className="m-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-black text-amber-700">Có {unmapped.length} dòng khối lượng verified chưa đối chiếu BOQ</div>
                <div className="mt-0.5 text-[10px] font-medium text-amber-700">Các dòng này chưa được đưa vào nghiệm thu cho tới khi thuộc nhóm đối chiếu reviewed/locked.</div>
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
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded border ${
                    item.status === 'approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                    item.status === 'submitted' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                    item.status === 'cancelled' ? 'bg-slate-100 text-slate-500 border-slate-200' :
                    'bg-slate-50 text-slate-600 border-slate-200'
                  }`}>{item.status === 'cancelled' ? 'Đã huỷ' : item.status}</span>
                  <span className="text-xs font-black text-emerald-600">{fmt(item.totalAcceptedAmount)} đ</span>
                  {(item.status === 'draft' || item.status === 'returned') && (
                    <button onClick={() => handleSetStatus(item, 'submitted')} title="Gửi duyệt" className="text-amber-500 hover:text-amber-700 transition-colors">
                      <Send size={13} />
                    </button>
                  )}
                  {item.status === 'draft' && (
                    <button onClick={() => handleDelete(item)} title="Xoá nghiệm thu" className="text-slate-400 hover:text-red-600 transition-colors">
                      <Trash2 size={13} />
                    </button>
                  )}
                  {item.status === 'returned' && (
                    <button onClick={() => handleSetStatus(item, 'cancelled')} title="Huỷ nghiệm thu" className="text-slate-400 hover:text-red-600 transition-colors">
                      <XCircle size={13} />
                    </button>
                  )}
                  {item.status === 'submitted' && (
                    <>
                      <button onClick={() => handleSetStatus(item, 'returned')} title="Trả lại" className="text-red-500 hover:text-red-700 transition-colors">
                        <RotateCcw size={13} />
                      </button>
                      <button onClick={() => handleSetStatus(item, 'approved')} title="Phê duyệt" className="text-emerald-500 hover:text-emerald-700 transition-colors">
                        <Check size={13} />
                      </button>
                    </>
                  )}
                  {item.status === 'approved' && (
                    <>
                      <button onClick={() => createPayment(item)} title="Tạo thanh toán" className="text-indigo-500 hover:text-indigo-700 transition-colors">
                        <CreditCard size={13} />
                      </button>
                      <button onClick={() => handleSetStatus(item, 'cancelled')} title="Huỷ nghiệm thu" className="text-slate-400 hover:text-red-600 transition-colors">
                        <XCircle size={13} />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {expandedId === item.id && item.items.length > 0 && (
                <div className="mt-2 rounded-lg bg-slate-50 overflow-hidden">
                  {item.items.map((line, idx) => (
                    <div key={idx} className="px-2 py-1 flex items-center justify-between text-[10px] border-b border-white">
                      <span className="font-bold text-slate-600">{line.contractItemCode} - {line.contractItemName}</span>
                      {(item.status === 'draft' || item.status === 'returned') ? (
                        <input
                          type="number"
                          min={0}
                          value={line.acceptedQuantity || ''}
                          onChange={e => handleUpdateLine(item, idx, Number(e.target.value))}
                          className="w-24 rounded border border-emerald-200 bg-white px-1 py-0.5 text-right text-[10px] font-bold outline-none focus:ring-1 focus:ring-emerald-300"
                        />
                      ) : (
                        <span>{fmt(line.acceptedQuantity)} {line.unit}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {expandedId === item.id && item.items.length === 0 && (
                <div className="mt-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-700">
                  Phiếu này chưa có hạng mục. Cần tạo lại sau khi hoàn tất đối chiếu BOQ.
                </div>
              )}
            </div>
          ))}
          {items.length === 0 && <div className="p-6 text-center text-xs font-bold text-slate-400">Chưa có nghiệm thu</div>}
        </div>
      </div>
    </div>
  );
};

export default QuantityAcceptancePanel;
