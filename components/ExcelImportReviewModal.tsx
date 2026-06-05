import React, { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, Download, Loader2, RefreshCcw, X, XCircle } from 'lucide-react';
import { ExcelImportPreview, ExcelImportPreviewRow, defaultImportFormat } from '../lib/excelImport';
import { loadXlsx } from '../lib/loadXlsx';

interface ExcelImportReviewModalProps<TRecord extends Record<string, any>> {
  title: string;
  preview: ExcelImportPreview<TRecord>;
  loading?: boolean;
  onClose: () => void;
  onConfirm: (options: { validOnly: boolean }) => void | Promise<void>;
}

const statusLabels: Record<string, { label: string; cls: string }> = {
  create: { label: 'Sẽ thêm mới', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  update: { label: 'Sẽ cập nhật', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  unchanged: { label: 'Không đổi', cls: 'bg-slate-50 text-slate-500 border-slate-200' },
  error: { label: 'Lỗi', cls: 'bg-red-50 text-red-600 border-red-200' },
};

const StatCard: React.FC<{ label: string; value: number; tone?: string }> = ({ label, value, tone = 'text-slate-700' }) => (
  <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3">
    <div className={`text-lg font-black ${tone}`}>{value.toLocaleString('vi-VN')}</div>
    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</div>
  </div>
);

const ErrorText: React.FC<{ row: ExcelImportPreviewRow<any> }> = ({ row }) => (
  <div className="space-y-1">
    {row.errors.map((error, index) => (
      <div key={index} className="text-xs font-bold text-red-600 flex items-start gap-1.5">
        <XCircle size={12} className="mt-0.5 shrink-0" /> {error}
      </div>
    ))}
  </div>
);

const ExcelImportReviewModal = <TRecord extends Record<string, any>>({
  title,
  preview,
  loading,
  onClose,
  onConfirm,
}: ExcelImportReviewModalProps<TRecord>) => {
  const confirmableRows = preview.mode === 'create' ? preview.createRows : preview.updateRows;
  const hasErrors = preview.errorRows > 0;
  const hasConfirmableRows = confirmableRows > 0;

  const summaryText = useMemo(() => {
    const parts = [
      `${preview.totalRows} dòng`,
      `${preview.validRows} hợp lệ`,
      `${preview.errorRows} lỗi`,
      `${preview.updateRows} cập nhật`,
      `${preview.createRows} thêm mới`,
      `${preview.unchangedRows} không đổi`,
    ];
    return parts.join(' • ');
  }, [preview]);

  const exportErrors = async () => {
    const errorRows = preview.rows
      .filter(row => row.status === 'error')
      .map(row => ({
        'Dòng': row.rowNumber,
        [preview.keyLabel]: row.keyValue,
        'Lỗi': row.errors.join(' | '),
      }));
    if (errorRows.length === 0) return;
    const XLSX = await loadXlsx();
    const ws = XLSX.utils.json_to_sheet(errorRows);
    ws['!cols'] = [{ wch: 8 }, { wch: 24 }, { wch: 80 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Loi_import');
    const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Loi_import_excel.xlsx';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-6xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-black text-slate-800 dark:text-white">{title}</h3>
            <p className="text-xs font-bold text-slate-400 mt-0.5">{summaryText}</p>
          </div>
          <button onClick={onClose} disabled={loading} className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 bg-slate-50/70 dark:bg-slate-950/40 border-b border-slate-100 dark:border-slate-800 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          <StatCard label="Tổng dòng" value={preview.totalRows} />
          <StatCard label="Hợp lệ" value={preview.validRows} tone="text-emerald-600" />
          <StatCard label="Lỗi" value={preview.errorRows} tone="text-red-600" />
          <StatCard label="Trùng mã" value={preview.duplicateRows} tone="text-amber-600" />
          <StatCard label="Sai mã" value={preview.missingRows} tone="text-orange-600" />
          <StatCard label="Đã tồn tại" value={preview.conflictRows} tone="text-violet-600" />
          <StatCard label="Sẽ cập nhật" value={preview.updateRows} tone="text-blue-600" />
          <StatCard label="Không đổi" value={preview.unchangedRows} />
        </div>

        {hasErrors && (
          <div className="mx-5 mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800 flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            File có dòng lỗi. Hệ thống sẽ không ghi các dòng lỗi; anh có thể tải file lỗi để sửa rồi import lại.
          </div>
        )}

        <div className="flex-1 overflow-auto p-5">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white dark:bg-slate-900 text-[10px] uppercase font-black tracking-widest text-slate-400 border-b border-slate-100">
              <tr>
                <th className="px-3 py-3 text-left w-16">Dòng</th>
                <th className="px-3 py-3 text-left w-44">{preview.keyLabel}</th>
                <th className="px-3 py-3 text-left w-36">Trạng thái</th>
                <th className="px-3 py-3 text-left">Thay đổi / Lỗi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {preview.rows.map(row => {
                const status = statusLabels[row.status];
                return (
                  <tr key={`${row.rowNumber}-${row.keyValue}`} className="align-top hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-3 py-3 font-mono font-bold text-slate-500">{row.rowNumber}</td>
                    <td className="px-3 py-3 font-mono font-black text-slate-800 dark:text-white">{row.keyValue || '-'}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-black uppercase ${status.cls}`}>
                        {row.status === 'error' ? <XCircle size={12} /> : <CheckCircle2 size={12} />}
                        {status.label}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {row.status === 'error' ? (
                        <ErrorText row={row} />
                      ) : row.changes.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {row.changes.map(change => (
                            <div key={change.fieldKey} className="rounded-xl border border-blue-100 bg-blue-50/50 px-3 py-2">
                              <div className="text-[10px] font-black uppercase text-blue-500">{change.fieldLabel}</div>
                              <div className="text-xs font-bold text-slate-700 mt-1">
                                <span className="text-slate-400">{change.oldDisplay || defaultImportFormat(change.oldValue)}</span>
                                <span className="mx-2 text-blue-400">→</span>
                                <span className="text-blue-700">{change.newDisplay || defaultImportFormat(change.newValue)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs font-bold text-slate-400">Không có thay đổi dữ liệu.</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex flex-col md:flex-row gap-3 justify-between">
          <button
            onClick={exportErrors}
            disabled={!hasErrors || loading}
            className="px-4 py-2.5 rounded-xl border border-amber-200 bg-amber-50 text-amber-700 text-xs font-black uppercase tracking-wider disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Download size={14} /> Tải file lỗi
          </button>
          <div className="flex flex-col sm:flex-row gap-3">
            <button onClick={onClose} disabled={loading} className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-bold disabled:opacity-50">
              Huỷ
            </button>
            {hasErrors && (
              <button
                onClick={() => onConfirm({ validOnly: true })}
                disabled={loading || !hasConfirmableRows}
                className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCcw size={15} />}
                {preview.mode === 'create' ? 'Nhập dòng hợp lệ' : 'Cập nhật dòng hợp lệ'}
              </button>
            )}
            <button
              onClick={() => onConfirm({ validOnly: false })}
              disabled={loading || hasErrors || !hasConfirmableRows}
              className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
              {preview.mode === 'create' ? 'Xác nhận nhập mới' : 'Xác nhận cập nhật'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExcelImportReviewModal;
