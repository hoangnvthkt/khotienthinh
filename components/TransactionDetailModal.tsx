
import React, { useState, useEffect } from 'react';
import { X, Calendar, User, Package, MapPin, Truck, ArrowRight, CheckCircle, Loader2, AlertTriangle, Paperclip, ExternalLink, Download } from 'lucide-react';
import { Transaction, TransactionStatus, TransactionType, WmsTransactionAttachment } from '../types';
import { useApp } from '../context/AppContext';
import { canApproveWmsTransaction, canReceiveWmsTransaction, isFulfillmentBatchTransaction } from '../lib/wmsPermissions';
import { useToast } from '../context/ToastContext';
import { getApiErrorMessage, logApiError } from '../lib/apiError';
import { materialRequestFulfillmentService } from '../lib/materialRequestFulfillmentService';
import { formatQuantityInput, parseQuantityInput, sanitizeQuantityInput } from '../lib/quantityInput';
import { dateInputToTransactionTimestamp } from '../lib/transactionVoucherDates';
import { canEditTransactionVoucher } from '../lib/transactionVoucherMetadata';
import { buildActualReceiptItems, validateReceiptQuantityLines } from '../lib/poActualReceipt';
import {
  cleanupTransactionAttachmentPaths,
  getTransactionAttachmentUrl,
  persistTransactionAttachments,
  uploadTransactionAttachments,
} from '../lib/wmsTransactionAttachmentService';

interface TransactionDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: Transaction | null;
  onUpdated?: (transaction: Transaction) => void;
}

const TransactionDetailModal: React.FC<TransactionDetailModalProps> = ({ isOpen, onClose, transaction, onUpdated }) => {
  const { items, warehouses, users, suppliers, transactions, user, updateTransactionStatus, updateTransactionVoucher } = useApp();
  const toast = useToast();
  const [quantityDrafts, setQuantityDrafts] = useState<Record<number, { quantity: string; reason: string }>>({});
  const [processing, setProcessing] = useState(false);
  const [voucherDate, setVoucherDate] = useState('');
  const [voucherNote, setVoucherNote] = useState('');
  const [savingVoucher, setSavingVoucher] = useState(false);
  const [attachmentDrafts, setAttachmentDrafts] = useState<File[]>([]);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const [attachmentLoadingId, setAttachmentLoadingId] = useState<string | null>(null);

  useEffect(() => {
    if (transaction) {
      setQuantityDrafts(Object.fromEntries(
        transaction.items.map((ti, index) => [index, { quantity: formatQuantityInput(ti.quantity), reason: ti.varianceReason || '' }])
      ));
      setVoucherDate(transaction.date.slice(0, 10));
      setVoucherNote(transaction.note || '');
      setAttachmentDrafts([]);
      setAttachmentUrls({});
    }
  }, [transaction]);

  if (!isOpen || !transaction) return null;

  const isPending = transaction.status === TransactionStatus.PENDING;
  const isApproved = transaction.status === TransactionStatus.APPROVED;
  const canApprove = isPending && canApproveWmsTransaction(user, transaction);
  const canEditVoucher = canEditTransactionVoucher(transaction, user.id, canApprove);
  const canReceive = isApproved
    && (transaction.type === TransactionType.IMPORT || transaction.type === TransactionType.TRANSFER)
    && canReceiveWmsTransaction(user, transaction);
  const actionMode: 'approval' | 'receipt' | null = canApprove ? 'approval' : canReceive ? 'receipt' : null;
  const canAdjustQuantities = !!actionMode && (transaction.type === TransactionType.IMPORT || transaction.type === TransactionType.TRANSFER);
  const isFulfillmentTx = isFulfillmentBatchTransaction(transaction);
  const isPoDeliveryTx = transaction.sourceType === 'po_delivery_batch';
  const isQualityApprovalTx = isFulfillmentTx || isPoDeliveryTx;

  const requester = users.find(u => u.id === transaction.requesterId);
  const approver = users.find(u => u.id === transaction.approverId);
  const sourceWh = warehouses.find(w => w.id === transaction.sourceWarehouseId);
  const targetWh = warehouses.find(w => w.id === transaction.targetWarehouseId);
  const supplier = suppliers.find(s => s.id === transaction.supplierId);
  const supplyName = transaction.businessPartnerNameSnapshot || supplier?.name;
  const supplySourceLabel = transaction.sourceType === 'supplier_contract'
    ? 'HĐ nhà cung cấp'
    : transaction.sourceType === 'business_partner'
      ? 'Đối tác'
      : 'Nhà cung cấp';

  const updateQuantityDraft = (index: number, patch: Partial<{ quantity: string; reason: string }>) => {
    setQuantityDrafts(prev => ({
      ...prev,
      [index]: {
        quantity: prev[index]?.quantity ?? formatQuantityInput(transaction.items[index]?.quantity),
        reason: prev[index]?.reason ?? '',
        ...patch,
      },
    }));
  };

  const updateQuantityValue = (index: number, rawValue: string) => {
    updateQuantityDraft(index, {
      quantity: sanitizeQuantityInput(rawValue, {
        previousValue: quantityDrafts[index]?.quantity ?? '0',
      }),
    });
  };

  const buildQuantityLines = (sourceTransaction: Transaction = transaction) => {
    const drafts = sourceTransaction.id === transaction.id ? quantityDrafts : Object.fromEntries(
      sourceTransaction.items.map((ti, index) => [index, { quantity: formatQuantityInput(ti.quantity), reason: ti.varianceReason || '' }]),
    );
    const lines = sourceTransaction.items.map((ti, index) => {
      const draft = drafts[index] || { quantity: formatQuantityInput(ti.quantity), reason: '' };
      const quantity = parseQuantityInput(draft.quantity);
      const reason = draft.reason.trim();
      return { index, quantity, reason };
    });
    validateReceiptQuantityLines(sourceTransaction, lines);
    return lines;
  };

  const openAttachment = async (attachment: WmsTransactionAttachment, download = false) => {
    setAttachmentLoadingId(attachment.id);
    try {
      const url = attachmentUrls[attachment.id] || await getTransactionAttachmentUrl(attachment.storagePath);
      setAttachmentUrls(prev => ({ ...prev, [attachment.id]: url }));
      if (download) {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = attachment.fileName;
        anchor.target = '_blank';
        anchor.rel = 'noreferrer';
        anchor.click();
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (err: any) {
      toast.error('Không thể mở tệp', getApiErrorMessage(err, 'Không thể tạo đường dẫn tệp đính kèm.'));
    } finally {
      setAttachmentLoadingId(null);
    }
  };

  const handlePrimaryAction = async () => {
    setProcessing(true);
    let uploadedPaths: string[] = [];
    const latestTransaction = transactions.find(candidate => candidate.id === transaction.id) || transaction;
    const previousAttachments = latestTransaction.attachments || [];
    try {
      if (actionMode === 'approval' && latestTransaction.status !== TransactionStatus.PENDING) {
        throw new Error('Phiếu kho đã thay đổi trạng thái. Vui lòng đóng và mở lại để xử lý dữ liệu mới nhất.');
      }
      if (canAdjustQuantities) {
        await materialRequestFulfillmentService.updateTransactionReceiptQuantities({
          transaction: latestTransaction,
          stage: actionMode || 'approval',
          lines: buildQuantityLines(latestTransaction),
        });
      }

      if (actionMode === 'approval' && attachmentDrafts.length > 0) {
        const uploadResult = await uploadTransactionAttachments({
          transactionId: latestTransaction.id,
          actorUserId: user.id,
          files: attachmentDrafts,
          existing: previousAttachments,
        });
        uploadedPaths = uploadResult.uploadedPaths;
        await persistTransactionAttachments(latestTransaction.id, uploadResult.attachments);
      }

      const nextStatus = actionMode === 'receipt'
        ? TransactionStatus.COMPLETED
        : (transaction.type === TransactionType.IMPORT || transaction.type === TransactionType.TRANSFER)
          ? TransactionStatus.APPROVED
          : TransactionStatus.COMPLETED;

      await updateTransactionStatus(latestTransaction.id, nextStatus, user.id);
      onClose();
      toast.success(actionMode === 'receipt' ? 'Đã xác nhận nhập kho' : 'Đã duyệt phiếu kho');
    } catch (err: any) {
      if (uploadedPaths.length > 0) {
        try {
          await cleanupTransactionAttachmentPaths(uploadedPaths);
          await persistTransactionAttachments(latestTransaction.id, previousAttachments);
        } catch (cleanupError) {
          console.warn('Cannot roll back WMS approval attachments', cleanupError);
        }
      }
      logApiError('transactionDetail.primaryAction', err);
      toast.error(
        actionMode === 'receipt' ? 'Không thể xác nhận nhập kho' : 'Không thể phê duyệt phiếu',
        getApiErrorMessage(err, 'Không thể cập nhật phiếu kho trên Supabase.'),
      );
    } finally {
      setProcessing(false);
    }
  };

  const handleRejectAll = async () => {
    setProcessing(true);
    try {
      await updateTransactionStatus(transaction.id, TransactionStatus.CANCELLED, user.id);
      onClose();
      toast.success('Đã từ chối phiếu');
    } catch (err: any) {
      logApiError('transactionDetail.reject', err);
      toast.error('Không thể từ chối phiếu', getApiErrorMessage(err, 'Không thể cập nhật trạng thái phiếu kho.'));
    } finally {
      setProcessing(false);
    }
  };

  const handleSaveVoucher = async () => {
    const transactionDate = dateInputToTransactionTimestamp(voucherDate);
    if (!transactionDate) {
      toast.warning('Thiếu ngày tạo', 'Chọn ngày tạo phiếu trước khi lưu.');
      return;
    }
    setSavingVoucher(true);
    try {
      const updated = await updateTransactionVoucher(transaction.id, {
        date: transactionDate,
        note: voucherNote,
      });
      onUpdated?.(updated);
      toast.success('Đã cập nhật phiếu', 'Ngày tạo và ghi chú phiếu đã được lưu.');
    } catch (err: any) {
      logApiError('transactionDetail.updateVoucher', err);
      toast.error('Không thể cập nhật phiếu', getApiErrorMessage(err, 'Vui lòng kiểm tra quyền chỉnh sửa phiếu.'));
    } finally {
      setSavingVoucher(false);
    }
  };

  const getStatusInfo = (status: TransactionStatus) => {
    switch (status) {
      case TransactionStatus.COMPLETED: return { label: 'Đã phê duyệt', color: 'bg-green-100 text-green-700 border-green-200' };
      case TransactionStatus.CANCELLED: return { label: 'Đã từ chối', color: 'bg-red-100 text-red-700 border-red-200' };
      case TransactionStatus.PENDING: return { label: 'Đang chờ duyệt', color: 'bg-orange-100 text-orange-700 border-orange-200' };
      case TransactionStatus.APPROVED: return { label: 'Chờ xác nhận nhập', color: 'bg-blue-100 text-blue-700 border-blue-200' };
      default: return { label: 'Khác', color: 'bg-slate-100 text-slate-700 border-slate-200' };
    }
  };

  const getTxTypeLabel = (type: TransactionType) => {
    switch (type) {
      case TransactionType.IMPORT: return 'Phiếu Nhập kho';
      case TransactionType.EXPORT: return 'Phiếu Xuất kho';
      case TransactionType.TRANSFER: return 'Phiếu Chuyển kho';
      default: return 'Phiếu kho';
    }
  };

  const statusInfo = getStatusInfo(transaction.status);
  const primaryActionLabel = actionMode === 'receipt'
    ? 'Xác nhận nhập'
    : isQualityApprovalTx
      ? 'Duyệt SL/CL'
      : 'Duyệt phiếu';

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Chi tiết phiếu</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusInfo.color}`}>
                {statusInfo.label}
              </span>
            </div>
            <h3 className="font-bold text-xl text-slate-800">{getTxTypeLabel(transaction.type)}</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-8 bg-slate-50/30">
          {canEditVoucher && (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4 space-y-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-indigo-500">Chỉnh phiếu</p>
                <p className="mt-0.5 text-xs font-semibold text-slate-500">Có thể chỉnh ngày tạo và ghi chú khi phiếu đang chờ duyệt.</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-[180px_minmax(0,1fr)] gap-3 items-end">
                <label className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Ngày tạo</span>
                  <input
                    type="date"
                    value={voucherDate}
                    onChange={event => setVoucherDate(event.target.value)}
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none focus:border-indigo-400"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Ghi chú phiếu</span>
                  <textarea
                    value={voucherNote}
                    onChange={event => setVoucherNote(event.target.value)}
                    rows={2}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 outline-none focus:border-indigo-400"
                    placeholder="Nhập ghi chú phiếu"
                  />
                </label>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleSaveVoucher}
                  disabled={savingVoucher}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  {savingVoucher && <Loader2 size={14} className="animate-spin" />} Lưu chỉnh sửa
                </button>
              </div>
            </div>
          )}
          {/* Info Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <Calendar size={18} className="text-slate-400 mt-0.5" />
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Ngày tạo</p>
                  <p className="text-sm font-medium text-slate-700">{new Date(transaction.date).toLocaleString('vi-VN')}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <User size={18} className="text-slate-400 mt-0.5" />
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Người lập phiếu</p>
                  <p className="text-sm font-medium text-slate-700">{requester?.name || 'Hệ thống'}</p>
                </div>
              </div>
              {approver && (
                <div className="flex items-start gap-3">
                  <CheckCircle size={18} className="text-green-500 mt-0.5" />
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase">Người phê duyệt</p>
                    <p className="text-sm font-medium text-slate-700">{approver?.name}</p>
                  </div>
                </div>
              )}
              {(transaction.approvedAt || transaction.approvalNote) && (
                <div className="flex items-start gap-3">
                  <Calendar size={18} className="text-orange-500 mt-0.5" />
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase">Thông tin duyệt</p>
                    {transaction.approvedAt && (
                      <p className="text-sm font-medium text-slate-700">{new Date(transaction.approvedAt).toLocaleDateString('vi-VN')}</p>
                    )}
                    {transaction.approvalNote && <p className="mt-0.5 text-xs text-slate-500">{transaction.approvalNote}</p>}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-4">
              {transaction.type === TransactionType.IMPORT && supplyName && (
                <div className="flex items-start gap-3">
                  <Truck size={18} className="text-blue-500 mt-0.5" />
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase">Nguồn cung cấp</p>
                    <p className="text-sm font-medium text-slate-700">{supplyName}</p>
                    <p className="text-[10px] font-bold text-slate-400">{supplySourceLabel}</p>
                  </div>
                </div>
              )}
              <div className="flex items-start gap-3">
                <MapPin size={18} className="text-slate-400 mt-0.5" />
                <div className="flex-1">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Luồng hàng hoá</p>
                  <div className="flex items-center gap-2 mt-1">
                    {sourceWh && <span className="text-xs font-bold text-slate-600 bg-white border border-slate-200 px-2 py-1 rounded">{sourceWh.name}</span>}
                    {sourceWh && targetWh && <ArrowRight size={14} className="text-slate-300" />}
                    {targetWh && <span className="text-xs font-bold text-blue-600 bg-blue-50 border border-blue-100 px-2 py-1 rounded">{targetWh.name}</span>}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Items List */}
       <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <h4 className="text-sm font-bold text-slate-700 flex items-center">
                <Package size={16} className="mr-2" /> Danh mục vật tư
              </h4>
              <span className="text-[10px] font-bold text-slate-400">{transaction.items.length} hạng mục</span>
            </div>
            <table className="w-full text-left text-sm">
              <thead className="text-[10px] uppercase font-bold text-slate-400 border-b border-slate-100">
                <tr>
                  <th className="px-4 py-3">Vật tư</th>
                  <th className="px-4 py-3 text-right">SL phiếu</th>
                  {canAdjustQuantities && <th className="px-4 py-3 text-right">SL thực tế</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
               {transaction.items.map((ti, idx) => {
                 const item = items.find(i => i.id === ti.itemId) || transaction.pendingItems?.find(i => i.id === ti.itemId);
                 const draft = quantityDrafts[idx] || { quantity: formatQuantityInput(ti.quantity), reason: '' };
                 const draftQty = parseQuantityInput(draft.quantity);
                 const orderedQty = Number(ti.orderedQty ?? ti.quantity ?? 0);
                 const hasVariance = Number.isFinite(draftQty) && draftQty !== orderedQty;
                  return (
                    <tr key={`${ti.fulfillmentBatchId || ''}-${ti.requestLineId || ti.itemId}-${idx}`}>
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-700">{item?.name || 'Vật tư mới'}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{item?.sku || 'Đang chờ duyệt'}</div>
                      </td>
                       <td className="px-4 py-3 text-right font-bold text-slate-800">
                         {orderedQty} <span className="text-[10px] text-slate-400 ml-1">{item?.unit}</span>
                         {hasVariance && canAdjustQuantities && (
                           <div className="text-[10px] font-bold text-amber-600">Lệch: {(Number.isFinite(draftQty) ? draftQty : 0) - orderedQty}</div>
                         )}
                      </td>
                      {canAdjustQuantities && (
                        <td className="px-4 py-3 text-right">
                          <div className="flex flex-col items-end gap-2">
                            <div className="flex items-center justify-end gap-2">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={draft.quantity}
                                onChange={(event) => updateQuantityValue(idx, event.target.value)}
                                className="w-28 rounded-lg border border-slate-200 bg-white px-3 py-2 text-right text-sm font-black text-slate-800 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/10"
                              />
                              <span className="w-8 text-left text-[10px] font-bold text-slate-400">{item?.unit}</span>
                            </div>
                            {hasVariance && (
                              <div className="flex items-center gap-2 w-full justify-end">
                                <AlertTriangle size={14} className="text-amber-500 shrink-0" />
                                <input
                                  type="text"
                                  value={draft.reason}
                                  onChange={(event) => updateQuantityDraft(idx, { reason: event.target.value })}
                                  placeholder="Lý do lệch"
                                  className="w-52 max-w-full rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 placeholder:text-amber-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
                                />
                              </div>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {(transaction.attachments?.length || 0) > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-black text-slate-700">
                <Paperclip size={16} /> Tệp đính kèm ({transaction.attachments?.length || 0})
              </div>
              <div className="space-y-2">
                {transaction.attachments?.map(attachment => (
                  <div key={attachment.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-bold text-slate-700">{attachment.fileName}</div>
                      <div className="text-[10px] text-slate-400">{attachment.mimeType} • {(attachment.fileSize / 1024).toFixed(1)} KB</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void openAttachment(attachment)}
                        disabled={attachmentLoadingId === attachment.id}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-black text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                      >
                        <ExternalLink size={12} /> Xem tệp
                      </button>
                      <button
                        type="button"
                        onClick={() => void openAttachment(attachment, true)}
                        disabled={attachmentLoadingId === attachment.id}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-black text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                      >
                        <Download size={12} /> Tải xuống
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {canApprove && isQualityApprovalTx && (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-black text-indigo-700">
                <Paperclip size={16} /> Chứng từ thực nhận
              </div>
              <p className="text-[11px] font-semibold text-slate-500">Có thể đính kèm phiếu cân, biên bản giao nhận hoặc ảnh chất lượng trước khi Duyệt SL/CL.</p>
              <input
                type="file"
                multiple
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                onChange={event => setAttachmentDrafts(Array.from(event.target.files || []))}
                disabled={processing}
                className="block w-full text-xs font-semibold text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-2 file:text-xs file:font-black file:text-white hover:file:bg-indigo-700"
              />
              {attachmentDrafts.length > 0 && (
                <div className="text-[10px] font-bold text-indigo-700">Đã chọn {attachmentDrafts.length} tệp; tệp sẽ tải lên khi bấm Duyệt SL/CL.</div>
              )}
            </div>
          )}

          {!canEditVoucher && transaction.note && (
            <div className="bg-slate-100 p-4 rounded-xl border-l-4 border-slate-400">
              <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Ghi chú phiếu</p>
              <p className="text-sm text-slate-600 italic">"{transaction.note}"</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-white border-t border-slate-100 flex justify-between items-center">
          <div className="flex gap-2">
            {(canApprove || canReceive) && (
              <>
                {canApprove && (
                  <button
                    onClick={handleRejectAll}
                    disabled={processing}
                    className="px-6 py-2.5 bg-white border border-red-200 text-red-600 rounded-xl font-bold hover:bg-red-50 transition-all text-sm uppercase tracking-widest disabled:opacity-60"
                  >
                    {processing ? 'Đang xử lý...' : 'Từ chối phiếu'}
                  </button>
                )}
                <button 
                  onClick={handlePrimaryAction}
                  disabled={processing}
                  className="px-6 py-2.5 bg-slate-800 text-white rounded-xl font-bold hover:bg-slate-700 transition-all shadow-lg shadow-slate-900/20 text-sm uppercase tracking-widest flex items-center gap-2 disabled:opacity-60"
                >
                  {processing ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />} {primaryActionLabel}
                </button>
              </>
            )}
          </div>
          <button onClick={onClose} className="px-8 py-2.5 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-all text-sm">
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};

export default TransactionDetailModal;
