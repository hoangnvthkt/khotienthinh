import React, { useState } from 'react';
import { Download, Loader2, Printer, X } from 'lucide-react';
import { saveAs } from 'file-saver';
import type { RequestDetail } from '../../lib/requestRuntimeService';
import { buildBrowserPrintModel, getRequestDocxTemplateBytes, recordRequestExportAudit, renderRequestDocx } from '../../lib/requestPrintService';
import { getApiErrorMessage } from '../../lib/apiError';

const id = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

export const RequestPrintPreview: React.FC<{ detail: RequestDetail; onClose: () => void }> = ({ detail, onClose }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const model = buildBrowserPrintModel(detail);

  const scalarFields = model.fields.filter(f => !f.isTable);
  const tableFields = model.fields.filter(f => f.isTable);

  const print = async (format: 'PRINT' | 'PDF') => {
    setBusy(true);
    setError(null);
    try {
      await recordRequestExportAudit({ requestId: detail.id, format, result: 'SUCCEEDED', clientActionId: id() });
      window.setTimeout(() => window.print(), 0);
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'Không thể ghi nhận thao tác in.'));
    } finally {
      setBusy(false);
    }
  };

  const word = async () => {
    setBusy(true);
    setError(null);
    try {
      const template = await getRequestDocxTemplateBytes(detail.id);
      const document = await renderRequestDocx(detail, template);
      await recordRequestExportAudit({ requestId: detail.id, format: 'WORD', result: 'SUCCEEDED', clientActionId: id() });
      saveAs(new Blob([document.bytes as unknown as BlobPart], { type: document.mimeType }), document.fileName);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Không thể tạo DOCX.';
      setError(message);
      try {
        await recordRequestExportAudit({ requestId: detail.id, format: 'WORD', result: 'FAILED', errorMessage: message, clientActionId: id() });
      } catch {
        /* Primary error remains visible. */
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] overflow-y-auto bg-slate-950/60 p-4 sm:p-6 print:static print:bg-white print:p-0">
      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 12mm 15mm 15mm 15mm;
          }
          body * {
            visibility: hidden;
          }
          [data-request-print-root], [data-request-print-root] * {
            visibility: visible;
          }
          [data-request-print-root] {
            position: absolute;
            inset: 0;
            width: 100%;
            color: #111827;
            background: #fff;
            padding: 0;
            margin: 0;
          }
          [data-no-print] {
            display: none !important;
          }
          table {
            border-collapse: collapse !important;
            width: 100% !important;
          }
          th, td {
            border: 1px solid #cbd5e1 !important;
            color: #111827 !important;
          }
          thead {
            display: table-header-group;
          }
          tr {
            page-break-inside: avoid;
          }
        }
      `}</style>
      <div
        data-request-print-root
        className="mx-auto max-w-4xl rounded-2xl bg-white p-6 sm:p-8 shadow-2xl dark:bg-slate-900 print:max-w-none print:rounded-none print:shadow-none print:p-0"
      >
        <header data-no-print className="mb-5 flex items-center justify-between border-b border-slate-200 pb-4 dark:border-slate-700">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Xem trước bản in</h2>
            <p className="text-xs text-slate-500">Audit ghi nhận thao tác khởi tạo in/lưu PDF, không xác nhận việc in vật lý.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <X size={18} />
          </button>
        </header>

        {error && <p data-no-print className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

        {/* Document Header */}
        <div className="border-b-2 border-emerald-700 pb-4">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">Vioo · Đề xuất</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">{model.title}</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Mã: <span className="font-semibold text-slate-700 dark:text-slate-200">{model.code}</span> · Người tạo:{' '}
            <span className="font-semibold text-slate-700 dark:text-slate-200">{model.creatorName}</span>
          </p>
        </div>

        {/* Nội dung đề xuất */}
        <section className="py-5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white">Nội dung</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-300">
            {model.description || 'Không có mô tả.'}
          </p>
        </section>

        {/* Thông tin đề xuất */}
        {(scalarFields.length > 0 || tableFields.length > 0) && (
          <section className="border-t border-slate-200 py-5 dark:border-slate-800">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white mb-3">
              Thông tin đề xuất
            </h3>

            {/* Scalar fields as a structured summary table */}
            {scalarFields.length > 0 && (
              <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 mb-4">
                <dl className="divide-y divide-slate-200 dark:divide-slate-700">
                  {scalarFields.map(field => (
                    <div key={field.key || field.label} className="grid grid-cols-1 sm:grid-cols-3 gap-2 px-4 py-2.5 text-sm bg-white dark:bg-slate-900">
                      <dt className="text-slate-500 dark:text-slate-400 font-medium">{field.label}</dt>
                      <dd className="sm:col-span-2 font-semibold text-slate-800 dark:text-slate-200">{field.value || '—'}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {/* Table fields as real structured tables */}
            {tableFields.map(field => {
              const cols = field.tableColumns && field.tableColumns.length > 0 ? field.tableColumns : ['Nội dung'];
              const rows = field.tableRows || [];

              return (
                <div key={field.key || field.label} className="mt-5 first:mt-0 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-400">
                      {field.label}
                    </h4>
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 print:hidden">
                      {rows.length} dòng × {cols.length} cột
                    </span>
                  </div>

                  <div className="overflow-x-auto rounded-lg border border-slate-300 dark:border-slate-700 print:border-slate-400">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200 font-bold border-b border-slate-300 dark:border-slate-700 print:bg-slate-100 print:text-slate-900 print:border-slate-400">
                          <th className="w-10 px-3 py-2.5 text-center font-bold text-slate-700 dark:text-slate-300 border-r border-slate-300 dark:border-slate-700 print:border-slate-400">
                            STT
                          </th>
                          {cols.map((col, idx) => (
                            <th
                              key={idx}
                              className="px-3.5 py-2.5 font-bold uppercase tracking-wider text-[11px] border-r border-slate-300 dark:border-slate-700 last:border-r-0 print:border-slate-400"
                            >
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800 print:divide-slate-300">
                        {rows.length === 0 ? (
                          <tr>
                            <td
                              colSpan={cols.length + 1}
                              className="px-3.5 py-4 text-center text-slate-400 dark:text-slate-500 italic"
                            >
                              Không có dữ liệu
                            </td>
                          </tr>
                        ) : (
                          rows.map((row, rIdx) => (
                            <tr
                              key={rIdx}
                              className={rIdx % 2 === 1 ? 'bg-slate-50/60 dark:bg-slate-800/30 print:bg-transparent' : 'bg-white dark:bg-slate-900'}
                            >
                              <td className="px-3 py-2 text-center font-medium text-slate-500 dark:text-slate-400 border-r border-slate-300 dark:border-slate-700 print:border-slate-400">
                                {rIdx + 1}
                              </td>
                              {cols.map((col, cIdx) => (
                                <td
                                  key={cIdx}
                                  className="px-3.5 py-2 text-slate-800 dark:text-slate-200 border-r border-slate-300 dark:border-slate-700 last:border-r-0 print:border-slate-400"
                                >
                                  {row[col] !== undefined && row[col] !== '' ? String(row[col]) : '—'}
                                </td>
                              ))}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {/* Kết quả phê duyệt */}
        <section className="border-t border-slate-200 py-5 dark:border-slate-800">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white mb-3">
            Kết quả phê duyệt
          </h3>
          <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
            {model.approvals.map(item => (
              <div key={item.blockName} className="flex flex-col sm:flex-row sm:items-center justify-between px-4 py-2.5 text-sm gap-2">
                <span className="font-semibold text-slate-800 dark:text-slate-200">{item.blockName}</span>
                <div className="flex items-center gap-2 text-xs">
                  <span
                    className={`inline-flex items-center rounded-md px-2 py-0.5 font-semibold text-[11px] ${
                      item.status === 'COMPLETED'
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                        : item.status === 'ACTIVE'
                        ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                        : item.status === 'RETURNED'
                        ? 'bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300 border border-orange-200 dark:border-orange-800'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    {item.statusLabel || item.status}
                  </span>
                  <span className="text-slate-600 dark:text-slate-300">{item.approvers}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Bình luận / ghi chú */}
        {model.notes.length > 0 && (
          <section className="border-t border-slate-200 py-5 dark:border-slate-800">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white mb-3">
              Bình luận / ghi chú
            </h3>
            <div className="space-y-3">
              {model.notes.map(note => (
                <div
                  key={note.createdAt + note.eventType + note.actorName}
                  className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30"
                >
                  <p className="font-semibold text-slate-800 dark:text-slate-200 text-xs">
                    {note.eventType} · {note.actorName}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-slate-700 dark:text-slate-300 text-xs leading-5">
                    {note.comment}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        <footer className="mt-8 pt-4 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-400 flex items-center justify-between">
          <span>In từ Vioo · {model.code}</span>
          <span className="print:hidden text-[11px] text-slate-400">Tự động điều chỉnh kích thước cho trang in A4</span>
        </footer>

        {/* Action Buttons (Excluded from print) */}
        <div data-no-print className="mt-6 flex flex-wrap justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 transition"
          >
            Đóng
          </button>
          {detail.printConfig.docxStoragePath && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void word()}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 dark:border-emerald-500 dark:text-emerald-400 dark:hover:bg-emerald-950/30 transition"
            >
              <Download size={15} />
              DOCX
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void print('PRINT')}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-600 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 dark:border-emerald-500 dark:text-emerald-400 dark:hover:bg-emerald-950/30 transition"
          >
            {busy && <Loader2 size={15} className="animate-spin" />}
            <Printer size={15} />
            In
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void print('PDF')}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 transition shadow-sm"
          >
            Lưu PDF
          </button>
        </div>
      </div>
    </div>
  );
};
