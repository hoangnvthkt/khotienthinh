import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileCheck2, Loader2, RefreshCcw, X } from 'lucide-react';
import type { SupplierInvoiceMatchingCandidates } from '../../lib/supplierFinanceControlService';
import { parseNonNegativeLocaleNumber } from '../../lib/localeNumberInput';

export interface SupplierInvoiceMatchingSubmit {
  invoiceNumber: string;
  invoiceDate: string;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  documentId: string;
  receiptLineId?: string;
  quantity?: number;
}

const localDateIso = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const money = (value: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value);

export const SupplierInvoiceMatchingModal = ({
  supplierName,
  candidates,
  loading,
  error,
  saving,
  onRetry,
  onClose,
  onSubmit,
}: {
  supplierName: string;
  candidates: SupplierInvoiceMatchingCandidates | null;
  loading: boolean;
  error?: string | null;
  saving: boolean;
  onRetry: () => void;
  onClose: () => void;
  onSubmit: (input: SupplierInvoiceMatchingSubmit) => void;
}) => {
  const today = localDateIso();
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [net, setNet] = useState('');
  const [vat, setVat] = useState('0');
  const [gross, setGross] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [receiptLineId, setReceiptLineId] = useState('');
  const [quantity, setQuantity] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const savingRef = useRef(saving);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { savingRef.current = saving; }, [saving]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !savingRef.current) onCloseRef.current();
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ) || []).filter(element => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    if (!loading && !error && candidates?.documents.some(row => row.uninvoicedAmount > 0)) {
      firstInputRef.current?.focus();
    }
  }, [candidates, error, loading]);

  const selectedDocument = candidates?.documents.find(row => row.id === documentId) || null;
  const eligibleLines = useMemo(() => (candidates?.receiptLines || []).filter(line =>
    selectedDocument?.sourceType === 'purchase_delivery_receipt'
      ? line.deliveryBatchId === selectedDocument.sourceId
      : selectedDocument?.sourceType === 'purchase_order'
        ? line.purchaseOrderId === selectedDocument.sourceId
        : false
  ), [candidates?.receiptLines, selectedDocument]);
  const selectedLine = eligibleLines.find(line => line.deliveryLineId === receiptLineId) || null;
  const requiresReceiptLine = eligibleLines.length > 0;
  const netAmount = parseNonNegativeLocaleNumber(net);
  const vatAmount = parseNonNegativeLocaleNumber(vat);
  const grossAmount = parseNonNegativeLocaleNumber(gross);
  const quantityAmount = parseNonNegativeLocaleNumber(quantity);
  const invalid = !invoiceNumber.trim() || !invoiceDate || !selectedDocument || grossAmount <= 0
    || Math.round((netAmount + vatAmount) * 100) !== Math.round(grossAmount * 100)
    || grossAmount > (selectedDocument?.uninvoicedAmount || 0)
    || (requiresReceiptLine && (!selectedLine || quantityAmount <= 0 || quantityAmount > selectedLine.uninvoicedQty));

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-950/50 p-3" onMouseDown={event => event.target === event.currentTarget && !saving && onClose()}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="supplier-invoice-title" className="flex max-h-[94vh] min-w-0 w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-950 [&_input]:min-w-0 [&_select]:min-w-0">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div>
            <div className="text-[10px] font-black uppercase tracking-wider text-teal-700 dark:text-teal-400">Đối soát hóa đơn theo AP / dòng nhận</div>
            <h3 id="supplier-invoice-title" className="mt-1 text-base font-black text-slate-900 dark:text-white">{supplierName}</h3>
            <p className="mt-1 text-xs font-medium text-slate-500">Hóa đơn một phần chỉ tăng “đã đối soát”; không tự tạo credit cho phần còn lại.</p>
          </div>
          <button ref={closeButtonRef} type="button" aria-label="Đóng" onClick={onClose} disabled={saving} className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"><X size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {loading && <div className="flex min-h-40 items-center justify-center gap-2 text-sm font-bold text-slate-400"><Loader2 size={17} className="animate-spin" /> Đang tải AP và dòng nhận mua...</div>}
          {!loading && error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}<button type="button" onClick={onRetry} className="ml-3 inline-flex items-center gap-1 font-black underline"><RefreshCcw size={13} /> Thử lại</button></div>}
          {!loading && !error && candidates && candidates.documents.every(row => row.uninvoicedAmount <= 0) && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              Không còn chứng từ AP cần đối soát cho nhà cung cấp này.
            </div>
          )}
          {!loading && !error && candidates && candidates.documents.some(row => row.uninvoicedAmount > 0) && (
            <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="min-w-0 space-y-3">
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">Số hóa đơn
                  <input ref={firstInputRef} value={invoiceNumber} onChange={event => setInvoiceNumber(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold outline-none focus:border-teal-500 dark:border-slate-700 dark:bg-slate-900" placeholder="VD: AA/26E-000123" />
                </label>
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">Ngày hóa đơn
                  <input type="date" value={invoiceDate} onChange={event => setInvoiceDate(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold outline-none focus:border-teal-500 dark:border-slate-700 dark:bg-slate-900" />
                </label>
                <div className="grid min-w-0 grid-cols-3 gap-2">
                  {[['Trước thuế', net, setNet], ['VAT', vat, setVat], ['Tổng HĐ', gross, setGross]].map(([label, value, setter]) => (
                    <label key={label as string} className="block min-w-0 text-[10px] font-black uppercase text-slate-500">{label as string}
                      <input inputMode="decimal" value={value as string} onChange={event => (setter as React.Dispatch<React.SetStateAction<string>>)(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-right text-xs font-bold outline-none focus:border-teal-500 dark:border-slate-700 dark:bg-slate-900" placeholder="0" />
                    </label>
                  ))}
                </div>
                {grossAmount > 0 && Math.round((netAmount + vatAmount) * 100) !== Math.round(grossAmount * 100) && <p className="text-xs font-semibold text-red-600">Trước thuế + VAT phải bằng tổng hóa đơn.</p>}
              </div>
              <div className="min-w-0 space-y-3">
                <label className="flex min-w-0 flex-col text-xs font-bold text-slate-600 dark:text-slate-300">Chứng từ AP
                  <select value={documentId} onChange={event => { setDocumentId(event.target.value); setReceiptLineId(''); setQuantity(''); }} className="mt-1 w-full max-w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold outline-none focus:border-teal-500 dark:border-slate-700 dark:bg-slate-900">
                    <option value="">Chọn AP cần đối soát</option>
                    {candidates.documents.filter(row => row.uninvoicedAmount > 0).map(row => <option key={row.id} value={row.id}>{row.documentNo} · chưa HĐ {money(row.uninvoicedAmount)} {row.currency}</option>)}
                  </select>
                </label>
                {selectedDocument && <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-900"><div><span className="text-slate-400">Đã đối soát</span><strong className="mt-1 block">{money(selectedDocument.invoicedToDate)}</strong></div><div><span className="text-slate-400">Còn đối soát</span><strong className="mt-1 block text-amber-700">{money(selectedDocument.uninvoicedAmount)}</strong></div></div>}
                {selectedDocument && eligibleLines.length > 0 && <>
                  <label className="flex min-w-0 flex-col text-xs font-bold text-slate-600 dark:text-slate-300">Dòng nhận mua
                    <select value={receiptLineId} onChange={event => { const id = event.target.value; setReceiptLineId(id); const line = eligibleLines.find(item => item.deliveryLineId === id); setQuantity(line ? String(line.uninvoicedQty) : ''); }} className="mt-1 w-full max-w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold outline-none focus:border-teal-500 dark:border-slate-700 dark:bg-slate-900">
                      <option value="">Chọn dòng receipt</option>
                      {eligibleLines.map(line => <option key={line.deliveryLineId} value={line.deliveryLineId}>{line.itemId} · còn {line.uninvoicedQty} {line.unit}</option>)}
                    </select>
                  </label>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">Số lượng trên hóa đơn ({selectedLine?.unit || 'ĐVT receipt'})
                    <input inputMode="decimal" value={quantity} onChange={event => setQuantity(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold outline-none focus:border-teal-500 dark:border-slate-700 dark:bg-slate-900" />
                  </label>
                </>}
                {selectedDocument && grossAmount > selectedDocument.uninvoicedAmount && <p className="text-xs font-semibold text-red-600">Tổng hóa đơn vượt giá trị AP chưa đối soát.</p>}
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 px-5 py-4 sm:flex-row sm:justify-end dark:border-slate-800">
          <button type="button" onClick={onClose} disabled={saving} className="min-h-11 rounded-xl border border-slate-200 px-4 text-xs font-bold text-slate-600 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300">Hủy</button>
          <button type="button" disabled={invalid || saving || loading || Boolean(error)} onClick={() => onSubmit({ invoiceNumber: invoiceNumber.trim(), invoiceDate, netAmount, vatAmount, grossAmount, documentId, receiptLineId: receiptLineId || undefined, quantity: receiptLineId ? quantityAmount : undefined })} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-teal-700 px-5 text-xs font-black text-white shadow-sm hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-40">{saving ? <Loader2 size={15} className="animate-spin" /> : <FileCheck2 size={15} />} Ghi nhận đối soát</button>
        </div>
      </div>
    </div>
  );
};

export default SupplierInvoiceMatchingModal;
