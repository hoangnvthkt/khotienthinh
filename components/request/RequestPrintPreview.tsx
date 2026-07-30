import React, { useState } from 'react';
import { Download, Loader2, Printer, X } from 'lucide-react';
import { saveAs } from 'file-saver';
import type { RequestDetail } from '../../lib/requestRuntimeService';
import { buildBrowserPrintModel, getRequestDocxTemplateBytes, recordRequestExportAudit, renderRequestDocx } from '../../lib/requestPrintService';

const id = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

export const RequestPrintPreview: React.FC<{ detail: RequestDetail; onClose: () => void }> = ({ detail, onClose }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const model = buildBrowserPrintModel(detail);
  const print = async (format: 'PRINT' | 'PDF') => {
    setBusy(true); setError(null);
    try { await recordRequestExportAudit({ requestId: detail.id, format, result: 'SUCCEEDED', clientActionId: id() }); window.setTimeout(() => window.print(), 0); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể ghi nhận thao tác in.'); }
    finally { setBusy(false); }
  };
  const word = async () => {
    setBusy(true); setError(null);
    try {
      const template = await getRequestDocxTemplateBytes(detail.id);
      const document = await renderRequestDocx(detail, template);
      await recordRequestExportAudit({ requestId: detail.id, format: 'WORD', result: 'SUCCEEDED', clientActionId: id() });
      saveAs(new Blob([document.bytes], { type: document.mimeType }), document.fileName);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Không thể tạo DOCX.';
      setError(message);
      try { await recordRequestExportAudit({ requestId: detail.id, format: 'WORD', result: 'FAILED', errorMessage: message, clientActionId: id() }); } catch { /* Primary error remains visible. */ }
    } finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-[90] overflow-y-auto bg-slate-950/50 p-4 print:static print:bg-white print:p-0"><style>{`@media print { body * { visibility: hidden; } [data-request-print-root], [data-request-print-root] * { visibility: visible; } [data-request-print-root] { position: absolute; inset: 0; color: #111827; background: #fff; padding: 24px; } [data-no-print] { display: none !important; } }`}</style><div data-request-print-root className="mx-auto max-w-3xl rounded-xl bg-white p-6 shadow-2xl dark:bg-slate-900 print:max-w-none print:rounded-none print:shadow-none"><header data-no-print className="mb-5 flex items-center justify-between border-b border-slate-200 pb-4 dark:border-slate-700"><div><h2 className="text-lg font-bold text-slate-900 dark:text-white">Xem trước bản in</h2><p className="text-xs text-slate-500">Audit ghi nhận thao tác khởi tạo in/lưu PDF, không xác nhận việc in vật lý.</p></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X size={18} /></button></header>{error && <p data-no-print className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}<div className="border-b-2 border-emerald-700 pb-4"><p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">Vioo · Đề xuất</p><h1 className="mt-2 text-2xl font-bold text-slate-900">{model.title}</h1><p className="mt-2 text-sm text-slate-500">Mã: {model.code} · Người tạo: {model.creatorName}</p></div><section className="py-5"><h3 className="text-sm font-bold text-slate-900">Nội dung</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{model.description || 'Không có mô tả.'}</p></section><section className="border-t border-slate-200 py-5"><h3 className="text-sm font-bold text-slate-900">Thông tin đề xuất</h3><dl className="mt-3 divide-y divide-slate-200 border border-slate-200">{model.fields.map(field => <div key={field.label} className="grid grid-cols-3 gap-3 px-3 py-2 text-sm"><dt className="text-slate-500">{field.label}</dt><dd className="col-span-2 font-medium text-slate-800">{field.value}</dd></div>)}</dl></section><section className="border-t border-slate-200 py-5"><h3 className="text-sm font-bold text-slate-900">Kết quả phê duyệt</h3><div className="mt-3 space-y-2">{model.approvals.map(item => <div key={item.blockName} className="text-sm"><span className="font-semibold">{item.blockName}</span><span className="text-slate-500"> · {item.status} · {item.approvers}</span></div>)}</div></section><footer className="mt-8 text-xs text-slate-400">In từ Vioo · {model.code}</footer><div data-no-print className="mt-6 flex flex-wrap justify-end gap-3"><button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600">Đóng</button>{detail.printConfig.docxStoragePath && <button type="button" disabled={busy} onClick={() => void word()} className="inline-flex items-center gap-2 rounded-lg border border-emerald-600 px-3 py-2 text-sm font-semibold text-emerald-700 disabled:opacity-60"><Download size={15} />DOCX</button>}<button type="button" disabled={busy} onClick={() => void print('PRINT')} className="inline-flex items-center gap-2 rounded-lg border border-emerald-600 px-3 py-2 text-sm font-semibold text-emerald-700 disabled:opacity-60">{busy && <Loader2 size={15} className="animate-spin" />}<Printer size={15} />In</button><button type="button" disabled={busy} onClick={() => void print('PDF')} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">Lưu PDF</button></div></div></div>;
};
