import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, FilePlus2, Loader2, Plus, RotateCcw, Send, X } from 'lucide-react';
import { ContractItem, ContractItemType, ContractVariation, ContractVariationItem, ProjectSubmissionTarget } from '../../types';
import { contractItemService } from '../../lib/contractItemService';
import { variationService } from '../../lib/variationService';
import { ProjectPermissionCode, projectStaffService } from '../../lib/projectStaffService';
import { useToast } from '../../context/ToastContext';
import { useConfirm, useReasonConfirm } from '../../context/ConfirmContext';
import { useApp } from '../../context/AppContext';
import { getApiErrorMessage, logApiError } from '../../lib/apiError';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import ProjectSubmissionDialog from './ProjectSubmissionDialog';
import { formatPolicyMessage, getProjectDocumentPolicy } from '../../lib/projectDocumentPolicy';
import { projectDocumentActionLogService } from '../../lib/projectDocumentActionLogService';

interface Props {
  contractId: string;
  contractType: ContractItemType;
  projectId?: string;
  constructionSiteId: string;
}

type DraftAction = 'update_quantity' | 'update_price' | 'add_item' | 'reduce_remove';

interface DraftLine {
  actionType: DraftAction;
  contractItemId: string;
  code: string;
  name: string;
  unit: string;
  afterQuantity: number;
  afterUnitPrice: number;
  note: string;
}

const fmt = (n: number) => n.toLocaleString('vi-VN') + ' đ';
const num = (value: unknown) => Number(value || 0);

const STATUS_PERMISSION: Record<string, ProjectPermissionCode> = {
  submitted: 'submit',
  approved: 'approve',
  rejected: 'approve',
};

const emptyLine = (): DraftLine => ({
  actionType: 'update_quantity',
  contractItemId: '',
  code: '',
  name: '',
  unit: '',
  afterQuantity: 0,
  afterUnitPrice: 0,
  note: '',
});

const ContractVariationPanel: React.FC<Props> = ({ contractId, contractType, projectId, constructionSiteId }) => {
  const toast = useToast();
  const confirm = useConfirm();
  const reasonConfirm = useReasonConfirm();
  const { user } = useApp();
  const { loading: saving, run } = useAsyncAction({
    errorTitle: 'Không thể lưu điều chỉnh BOQ',
    fallbackError: 'Không thể lưu phiếu điều chỉnh lên Supabase.',
    logScope: 'boqAdjustment.save',
  });
  const [items, setItems] = useState<ContractVariation[]>([]);
  const [boq, setBoq] = useState<ContractItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [reason, setReason] = useState('');
  const [adjustmentDate, setAdjustmentDate] = useState(new Date().toISOString().slice(0, 10));
  const [discountPercent, setDiscountPercent] = useState(0);
  const [overheadCost, setOverheadCost] = useState(0);
  const [vatPercent, setVatPercent] = useState(0);
  const [attachmentName, setAttachmentName] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [statusLoadingId, setStatusLoadingId] = useState<string | null>(null);
  const [submittingVariation, setSubmittingVariation] = useState<ContractVariation | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [vars, boqItems] = await Promise.all([
        variationService.listByContract(contractId, contractType),
        contractItemService.listByContract(contractId, contractType),
      ]);
      setItems(vars);
      setBoq(boqItems);
    } catch (error) {
      logApiError('boqAdjustment.load', error);
      toast.error('Không thể tải điều chỉnh BOQ', getApiErrorMessage(error, 'Không thể tải dữ liệu điều chỉnh BOQ.'));
    } finally {
      setLoading(false);
    }
  }, [contractId, contractType, toast]);

  useEffect(() => { load(); }, [load]);

  const baseContractValue = useMemo(
    () => boq.reduce((sum, item) => sum + num(item.revisedTotalPrice ?? item.totalPrice), 0),
    [boq],
  );

  const computedLines = useMemo<ContractVariationItem[]>(() => {
    return lines.map(line => {
      const selected = boq.find(item => item.id === line.contractItemId);
      const beforeQuantity = selected ? num(selected.revisedQuantity ?? selected.quantity) : 0;
      const beforeUnitPrice = selected ? num(selected.revisedUnitPrice ?? selected.unitPrice) : 0;
      const beforeAmount = selected ? num(selected.revisedTotalPrice ?? selected.totalPrice) : 0;
      const afterQuantity = line.actionType === 'add_item' ? num(line.afterQuantity) : num(line.afterQuantity || beforeQuantity);
      const afterUnitPrice = num(line.afterUnitPrice || beforeUnitPrice);
      const afterAmount = afterQuantity * afterUnitPrice;
      return {
        contractItemId: selected?.id,
        actionType: line.actionType,
        code: selected?.code || line.code,
        name: selected?.name || line.name,
        unit: selected?.unit || line.unit,
        quantityDelta: afterQuantity - beforeQuantity,
        unitPrice: afterUnitPrice,
        amountDelta: afterAmount - beforeAmount,
        beforeQuantity,
        afterQuantity,
        beforeUnitPrice,
        afterUnitPrice,
        beforeAmount,
        afterAmount,
        note: line.note,
        metadata: {},
      };
    }).filter(line => line.code && line.name && line.unit);
  }, [boq, lines]);

  const totals = useMemo(() => {
    const totalAmountDelta = computedLines.reduce((sum, line) => sum + num(line.amountDelta), 0);
    const discountAmount = Math.round(Math.max(0, totalAmountDelta) * num(discountPercent) / 100);
    const beforeVat = totalAmountDelta - discountAmount + num(overheadCost);
    const vatAmount = Math.round(beforeVat * num(vatPercent) / 100);
    const netDelta = beforeVat + vatAmount;
    return {
      totalAmountDelta,
      discountAmount,
      vatAmount,
      netDelta,
      contractValueAfter: baseContractValue + netDelta,
    };
  }, [baseContractValue, computedLines, discountPercent, overheadCost, vatPercent]);

  const reset = () => {
    setShowForm(false);
    setTitle('');
    setReason('');
    setAdjustmentDate(new Date().toISOString().slice(0, 10));
    setDiscountPercent(0);
    setOverheadCost(0);
    setVatPercent(0);
    setAttachmentName('');
    setAttachmentUrl('');
    setLines([emptyLine()]);
  };

  const updateLine = (index: number, patch: Partial<DraftLine>) => {
    setLines(prev => prev.map((line, i) => i === index ? { ...line, ...patch } : line));
  };

  const selectBoqItem = (index: number, itemId: string) => {
    const selected = boq.find(item => item.id === itemId);
    updateLine(index, {
      contractItemId: itemId,
      code: selected?.code || '',
      name: selected?.name || '',
      unit: selected?.unit || '',
      afterQuantity: num(selected?.revisedQuantity ?? selected?.quantity),
      afterUnitPrice: num(selected?.revisedUnitPrice ?? selected?.unitPrice),
    });
  };

  const handleCreate = async () => {
    if (!title.trim()) {
      toast.warning('Thiếu nội dung điều chỉnh', 'Vui lòng nhập nội dung/lý do điều chỉnh BOQ.');
      return;
    }
    if (computedLines.length === 0) {
      toast.warning('Chưa có dòng điều chỉnh', 'Vui lòng nhập ít nhất một hạng mục điều chỉnh.');
      return;
    }
    const invalidLine = computedLines.find(line => line.actionType !== 'add_item' && !line.contractItemId);
    if (invalidLine) {
      toast.warning('Dòng điều chỉnh chưa hợp lệ', `Hạng mục ${invalidLine.code || invalidLine.name} cần liên kết BOQ hiện có.`);
      return;
    }
    await run(async () => {
      await projectStaffService.requireProjectPermission({
        userId: user?.id,
        projectId,
        constructionSiteId,
        code: 'edit',
        actionLabel: 'tạo điều chỉnh BOQ',
      });
      await variationService.create({
        contractId,
        contractType,
        constructionSiteId,
        code: `BOQ-V${items.length + 1}`,
        title: title.trim(),
        reason,
        adjustmentDate,
        discountPercent,
        discountAmount: totals.discountAmount,
        overheadCost,
        vatPercent,
        vatAmount: totals.vatAmount,
        contractValueAfter: totals.contractValueAfter,
        attachments: attachmentUrl ? [{
          id: crypto.randomUUID(),
          name: attachmentName || attachmentUrl,
          fileName: attachmentName || attachmentUrl,
          storagePath: attachmentUrl,
          fileType: '',
          fileSize: 0,
          category: 'other',
          uploadedAt: new Date().toISOString(),
          uploadedBy: user?.name || user?.username || '',
        }] : [],
        items: computedLines,
      });
      reset();
      await load();
    }, { successTitle: 'Đã tạo điều chỉnh BOQ' });
  };

  const setStatus = async (
    item: ContractVariation,
    status: 'submitted' | 'approved' | 'rejected',
    submissionTarget?: ProjectSubmissionTarget,
  ) => {
    if (status === 'submitted' && !submissionTarget) {
      setSubmittingVariation(item);
      return;
    }
    const labels = { submitted: 'Gửi duyệt', approved: 'Duyệt điều chỉnh BOQ', rejected: 'Từ chối điều chỉnh BOQ' };
    const reason = status === 'rejected'
      ? await reasonConfirm({
        title: 'Từ chối điều chỉnh BOQ',
        targetName: `${item.code} - ${item.title}`,
        warningText: 'Lý do trả lại sẽ được lưu để người lập chỉnh đúng nội dung.',
        reasonPlaceholder: 'Nhập lý do trả lại/từ chối điều chỉnh BOQ...',
        actionLabel: 'Từ chối',
        intent: 'danger',
      })
      : undefined;
    if (status === 'rejected' && !reason) return;
    if (!(status === 'submitted' && submissionTarget) && status !== 'rejected') {
      const ok = await confirm({
        title: labels[status],
        targetName: `${item.code} - ${item.title}`,
        warningText: status === 'approved'
          ? 'Khi duyệt, version này sẽ được áp dụng vào BOQ hiện hành và dùng cho nghiệm thu/thanh toán.'
          : undefined,
        intent: status === 'approved' ? 'success' : 'warning',
        actionLabel: status === 'approved' ? 'Duyệt' : 'Xác nhận',
        countdownSeconds: status === 'approved' ? 1 : 0,
      });
      if (!ok) return;
    }
    setStatusLoadingId(item.id);
    try {
      await projectStaffService.requireProjectPermission({
        userId: user?.id,
        projectId,
        constructionSiteId,
        code: STATUS_PERMISSION[status],
        actionLabel: labels[status].toLowerCase(),
      });
      const policy = getProjectDocumentPolicy({
        action: status === 'submitted' ? 'submit' : status === 'approved' ? 'approve' : 'return',
        documentType: 'boq_item',
        status: item.status,
        user,
        permissions: user?.role === 'ADMIN'
          ? ['view', 'edit', 'delete', 'submit', 'verify', 'confirm', 'approve']
          : ['view', STATUS_PERMISSION[status]],
        currentHandlerIds: [item.submittedToUserId],
        relatedUserIds: [item.submittedBy],
        reason,
        everSubmitted: item.everSubmitted,
        documentLabel: `${item.code} - ${item.title}`,
      });
      if (!policy.allowed) {
        await projectDocumentActionLogService.logBlocked({
          projectId,
          constructionSiteId,
          documentType: 'boq_item',
          documentId: item.id,
          documentLabel: `${item.code} - ${item.title}`,
          action: status === 'submitted' ? 'submit' : status === 'approved' ? 'approve' : 'return',
          fromStatus: item.status,
          reason,
          blockedReason: policy.reason,
          requiredRollbackSteps: policy.requiredRollbackSteps,
          createdBy: user?.id,
        });
        toast.error('Không thể xử lý điều chỉnh BOQ', formatPolicyMessage(policy));
        return;
      }
      await variationService.setStatus(item.id, status, user?.id, reason, user, projectId, submissionTarget);
      await projectDocumentActionLogService.log({
        projectId,
        constructionSiteId,
        documentType: 'boq_item',
        documentId: item.id,
        documentLabel: `${item.code} - ${item.title}`,
        action: status === 'rejected' ? 'return' : status,
        fromStatus: item.status,
        toStatus: status,
        reason,
        warningAcknowledged: true,
        createdBy: user?.id,
      });
      await load();
      if (status === 'submitted') setSubmittingVariation(null);
      toast.success(labels[status] + ' thành công');
    } catch (error) {
      logApiError('boqAdjustment.status', error);
      toast.error('Không thể cập nhật điều chỉnh BOQ', getApiErrorMessage(error, 'Không thể cập nhật trạng thái điều chỉnh BOQ.'));
      if (status === 'submitted' && submissionTarget) throw error;
    } finally {
      setStatusLoadingId(null);
    }
  };

  return (
    <div className="space-y-3 mt-3">
      <div className="rounded-xl border border-slate-100 bg-white overflow-hidden">
        <div className="p-3 border-b border-slate-100 flex items-center justify-between">
          <h4 className="text-xs font-black text-slate-700 flex items-center gap-1.5">
            <FilePlus2 size={13} className="text-violet-500" /> Điều chỉnh BOQ
          </h4>
          <button onClick={() => setShowForm(!showForm)} className="text-[10px] font-bold text-violet-600 flex items-center gap-1">
            <Plus size={10} /> Tạo version
          </button>
        </div>

        {showForm && (
          <div className="p-3 bg-violet-50/50 border-b border-violet-100 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Nội dung/lý do điều chỉnh *" className="md:col-span-2 px-2 py-1.5 rounded-lg border border-violet-200 text-xs" />
              <input type="date" value={adjustmentDate} onChange={e => setAdjustmentDate(e.target.value)} className="px-2 py-1.5 rounded-lg border border-violet-200 text-xs" />
              <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Ghi chú nội bộ" className="px-2 py-1.5 rounded-lg border border-violet-200 text-xs" />
              <input type="number" value={discountPercent || ''} onChange={e => setDiscountPercent(num(e.target.value))} placeholder="% Chiết khấu" className="px-2 py-1.5 rounded-lg border border-violet-200 text-xs" />
              <input type="number" value={overheadCost || ''} onChange={e => setOverheadCost(num(e.target.value))} placeholder="Chi phí chung" className="px-2 py-1.5 rounded-lg border border-violet-200 text-xs" />
              <input type="number" value={vatPercent || ''} onChange={e => setVatPercent(num(e.target.value))} placeholder="VAT (%)" className="px-2 py-1.5 rounded-lg border border-violet-200 text-xs" />
              <input value={attachmentUrl} onChange={e => setAttachmentUrl(e.target.value)} placeholder="Link đính kèm/phụ lục" className="px-2 py-1.5 rounded-lg border border-violet-200 text-xs" />
            </div>

            <div className="space-y-2">
              {lines.map((line, index) => {
                const selected = boq.find(item => item.id === line.contractItemId);
                const beforeQty = num(selected?.revisedQuantity ?? selected?.quantity);
                const beforePrice = num(selected?.revisedUnitPrice ?? selected?.unitPrice);
                return (
                  <div key={index} className="grid grid-cols-12 gap-2 rounded-xl bg-white border border-violet-100 p-2 items-center">
                    <select value={line.actionType} onChange={e => updateLine(index, { actionType: e.target.value as DraftAction, contractItemId: '', code: '', name: '', unit: '', afterQuantity: 0, afterUnitPrice: 0 })}
                      className="col-span-12 md:col-span-2 px-2 py-1.5 rounded-lg border border-slate-200 text-xs">
                      <option value="update_quantity">Chỉnh KL</option>
                      <option value="update_price">Chỉnh đơn giá</option>
                      <option value="add_item">Thêm mới</option>
                      <option value="reduce_remove">Giảm/xoá</option>
                    </select>
                    {line.actionType === 'add_item' ? (
                      <>
                        <input value={line.code} onChange={e => updateLine(index, { code: e.target.value })} placeholder="Mã" className="col-span-4 md:col-span-1 px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                        <input value={line.name} onChange={e => updateLine(index, { name: e.target.value })} placeholder="Tên hạng mục" className="col-span-8 md:col-span-3 px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                      </>
                    ) : (
                      <select value={line.contractItemId} onChange={e => selectBoqItem(index, e.target.value)}
                        className="col-span-12 md:col-span-4 px-2 py-1.5 rounded-lg border border-slate-200 text-xs">
                        <option value="">Chọn hạng mục BOQ...</option>
                        {boq.map(item => <option key={item.id} value={item.id}>{item.code} - {item.name}</option>)}
                      </select>
                    )}
                    <input value={line.unit} onChange={e => updateLine(index, { unit: e.target.value })} placeholder="ĐVT" className="col-span-3 md:col-span-1 px-2 py-1.5 rounded-lg border border-slate-200 text-xs" />
                    <input type="number" value={line.afterQuantity || ''} onChange={e => updateLine(index, { afterQuantity: num(e.target.value) })} placeholder={beforeQty ? `KL ${beforeQty}` : 'KL sau'} className="col-span-3 md:col-span-1 px-2 py-1.5 rounded-lg border border-slate-200 text-xs text-right" />
                    <input type="number" value={line.afterUnitPrice || ''} onChange={e => updateLine(index, { afterUnitPrice: num(e.target.value) })} placeholder={beforePrice ? `ĐG ${beforePrice}` : 'Đơn giá'} className="col-span-4 md:col-span-2 px-2 py-1.5 rounded-lg border border-slate-200 text-xs text-right" />
                    <button onClick={() => setLines(prev => prev.length > 1 ? prev.filter((_, i) => i !== index) : [emptyLine()])} className="col-span-2 md:col-span-1 text-red-400 hover:text-red-600 flex justify-center">
                      <X size={14} />
                    </button>
                  </div>
                );
              })}
              <button onClick={() => setLines(prev => [...prev, emptyLine()])} className="text-[10px] font-bold text-violet-600 flex items-center gap-1">
                <Plus size={10} /> Thêm dòng điều chỉnh
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-[10px]">
              <div className="rounded-lg bg-white p-2"><span className="text-slate-400 block">Tổng delta</span><b>{fmt(totals.totalAmountDelta)}</b></div>
              <div className="rounded-lg bg-white p-2"><span className="text-slate-400 block">Chiết khấu</span><b>{fmt(totals.discountAmount)}</b></div>
              <div className="rounded-lg bg-white p-2"><span className="text-slate-400 block">VAT</span><b>{fmt(totals.vatAmount)}</b></div>
              <div className="rounded-lg bg-white p-2"><span className="text-slate-400 block">Delta sau thuế</span><b>{fmt(totals.netDelta)}</b></div>
              <div className="rounded-lg bg-white p-2"><span className="text-slate-400 block">GT sau chỉnh</span><b>{fmt(totals.contractValueAfter)}</b></div>
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={reset} disabled={saving} className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:bg-white disabled:opacity-50">Huỷ</button>
              <button onClick={handleCreate} disabled={saving} className="px-4 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-bold flex items-center gap-1 disabled:opacity-50">
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Lưu version
              </button>
            </div>
          </div>
        )}

        <div className="divide-y divide-slate-50">
          {loading ? (
            <div className="p-6 text-center text-xs font-bold text-slate-400">Đang tải...</div>
          ) : items.length === 0 ? (
            <div className="p-6 text-center text-xs font-bold text-slate-400">Chưa có điều chỉnh BOQ</div>
          ) : items.map(item => (
            <div key={item.id} className="px-3 py-2">
              <div className="flex items-center justify-between text-xs gap-3">
                <div>
                  <div className="font-bold text-slate-700">V{item.versionNumber || '?'} • {item.code} - {item.title}</div>
                  <div className="text-[10px] text-slate-400">{item.adjustmentDate || item.createdAt?.slice(0, 10)} • {item.reason || 'Không có lý do'} • {item.items.length} dòng</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded border ${item.status === 'approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : item.status === 'submitted' ? 'bg-amber-50 text-amber-700 border-amber-200' : item.status === 'rejected' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                    {item.status}
                  </span>
                  <span className={`font-black ${num(item.totalAmountDelta) >= 0 ? 'text-violet-600' : 'text-red-600'}`}>{fmt(item.totalAmountDelta)}</span>
                  {statusLoadingId === item.id ? <Loader2 size={13} className="animate-spin text-slate-400" /> : (
                    <>
                      {item.status === 'draft' && <button onClick={() => setStatus(item, 'submitted')} className="text-amber-500"><Send size={13} /></button>}
                      {item.status === 'submitted' && (
                        <>
                          <button onClick={() => setStatus(item, 'rejected')} className="text-red-500"><RotateCcw size={13} /></button>
                          <button onClick={() => setStatus(item, 'approved')} className="text-emerald-500"><Check size={13} /></button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
              {item.items.length > 0 && (
                <div className="mt-2 rounded-lg bg-slate-50 overflow-hidden">
                  {item.items.slice(0, 4).map((line, idx) => (
                    <div key={idx} className="px-2 py-1 flex items-center justify-between text-[10px] border-b border-white">
                      <span className="font-bold text-slate-600">{line.code} - {line.name}</span>
                      <span className={num(line.amountDelta) >= 0 ? 'text-emerald-600 font-bold' : 'text-red-600 font-bold'}>{fmt(line.amountDelta)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      {submittingVariation && (
        <ProjectSubmissionDialog
          title="Gửi điều chỉnh BOQ"
          actionLabel="Gửi duyệt"
          documentLabel="Phát sinh BOQ"
          documentName={`${submittingVariation.code} • ${submittingVariation.title}`}
          documentSubtitle={`Version ${submittingVariation.versionNumber || '?'} • Trạng thái hiện tại: ${submittingVariation.status}`}
          projectId={projectId}
          constructionSiteId={constructionSiteId}
          recipientPermissionCodes={['approve']}
          recipientHint="Chọn đích danh người có quyền phê duyệt phát sinh BOQ."
          details={[
            { label: 'Giá trị phát sinh', value: fmt(submittingVariation.totalAmountDelta) },
            { label: 'Số dòng', value: `${submittingVariation.items.length} hạng mục` },
            { label: 'Ngày điều chỉnh', value: submittingVariation.adjustmentDate || submittingVariation.createdAt?.slice(0, 10) },
            { label: 'Lý do', value: submittingVariation.reason || '-' },
          ]}
          onCancel={() => setSubmittingVariation(null)}
          onConfirm={target => setStatus(submittingVariation, 'submitted', target)}
        />
      )}
    </div>
  );
};

export default ContractVariationPanel;
