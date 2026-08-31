import React, { useRef, useState } from 'react';
import { Download, FileSpreadsheet, Loader2, ShieldAlert, Upload, X } from 'lucide-react';
import type { User } from '../../types';
import { useToast } from '../../context/ToastContext';
import { canPerform } from '../../lib/permissions/permissionService';
import {
  createHrmPersonnelExportBytes,
  createHrmPersonnelTemplateBytes,
  readHrmPersonnelWorkbook,
} from '../../lib/hrmPersonnelWorkbook';
import {
  hrmPersonnelImportExportService,
  type HrmImportPreview,
} from '../../lib/hrmPersonnelImportExportService';

interface Props {
  user: User;
  employeeIds: string[];
  onApplied: () => Promise<void> | void;
}

const ERROR_LABELS: Record<string, string> = {
  EMPLOYEE_CODE_REQUIRED: 'Thiếu employee_code',
  EMPLOYEE_NOT_FOUND: 'Không tìm thấy employee_code',
  RECORD_TYPE_UNSUPPORTED: 'record_type không hỗ trợ',
  RECORD_CODE_REQUIRED: 'Thiếu record_code',
  DUPLICATE_RECORD_CODE: 'Trùng record_code trong file',
  REQUIRED_FIELD: 'Thiếu trường bắt buộc',
  INVALID_DATE: 'Ngày không đúng yyyy-mm-dd',
  INVALID_NUMBER: 'Giá trị số không hợp lệ',
  INVALID_BOOLEAN: 'Giá trị boolean không hợp lệ',
  MASTER_CODE_NOT_FOUND: 'Mã danh mục không tồn tại',
  EFFECTIVE_DATE_OVERLAP: 'Khoảng hiệu lực bị chồng lấn',
  UNSUPPORTED_PROJECTION_FIELD: 'Trường projection không được import',
  UNSUPPORTED_DEPOSIT_FIELD: 'Trường ký quỹ không hỗ trợ',
  HRM_IMPORT_C4_MANAGE_REQUIRED: 'Cần quyền HR Manage để apply C4',
};

const downloadBytes = (bytes: ArrayBuffer, fileName: string) => {
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const HrmPersonnelImportExportPanel: React.FC<Props> = ({ user, employeeIds, onApplied }) => {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canImport = canPerform(user, 'hrm.employee.import');
  const canExport = canPerform(user, 'hrm.employee.export')
    && canPerform(user, 'hrm.compensation.manage');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<HrmImportPreview | null>(null);
  const [reason, setReason] = useState('');
  const [exportOpen, setExportOpen] = useState(false);

  const downloadTemplate = async () => {
    setLoading(true);
    try {
      downloadBytes(await createHrmPersonnelTemplateBytes(), 'Mau_ho_so_nhan_su_8_nhom_v1.xlsx');
      toast.success('Đã tạo workbook mẫu 8 nhóm');
    } catch (error) {
      toast.error('Không thể tạo workbook mẫu', error instanceof Error ? error.message : 'Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  const chooseFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setLoading(true);
    try {
      const rows = await readHrmPersonnelWorkbook(file);
      if (rows.length === 0) throw new Error('Workbook chưa có dòng dữ liệu để kiểm tra.');
      const nextPreview = await hrmPersonnelImportExportService.uploadAndPreview({
        appUserId: user.id, file, rows,
      });
      setPreview(nextPreview);
      setReason('');
    } catch (error) {
      toast.error('Không thể dry-run workbook', error instanceof Error ? error.message : 'Vui lòng kiểm tra lại file.');
    } finally {
      setLoading(false);
    }
  };

  const applyImport = async () => {
    if (!preview || preview.errorRows !== 0 || reason.trim().length < 10) return;
    setLoading(true);
    try {
      const result = await hrmPersonnelImportExportService.apply(
        preview.batchId, reason.trim(), preview.fingerprint,
      );
      await onApplied();
      setPreview(null);
      setReason('');
      toast.success('Import hồ sơ thành công', `${result.appliedRows} dòng đã được áp dụng.`);
    } catch (error) {
      toast.error('Không thể apply workbook', error instanceof Error ? error.message : 'Vui lòng dry-run lại file.');
    } finally {
      setLoading(false);
    }
  };

  const exportProfiles = async () => {
    if (reason.trim().length < 10 || employeeIds.length === 0) return;
    setLoading(true);
    try {
      const manifest = await hrmPersonnelImportExportService.exportProfiles(employeeIds, reason.trim());
      const date = new Date().toISOString().slice(0, 10);
      downloadBytes(await createHrmPersonnelExportBytes(manifest), `Ho_so_nhan_su_8_nhom_${date}.xlsx`);
      setExportOpen(false);
      setReason('');
      toast.success('Đã xuất workbook hồ sơ có manifest');
    } catch (error) {
      toast.error('Không thể xuất hồ sơ', error instanceof Error ? error.message : 'Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  if (!canImport && !canExport) return null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {canImport && (
          <>
            <input ref={fileInputRef} type="file" accept=".xlsx" onChange={chooseFile} className="hidden" />
            <button type="button" onClick={() => void downloadTemplate()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
              <Download size={15} /> Mẫu 8 nhóm
            </button>
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl bg-sky-700 px-3 py-2.5 text-sm font-bold text-white disabled:opacity-50">
              {loading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Import có dry-run
            </button>
          </>
        )}
        {canExport && (
          <button type="button" onClick={() => { setReason(''); setExportOpen(true); }} disabled={loading || employeeIds.length === 0} className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-bold text-emerald-700 disabled:opacity-50 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
            <FileSpreadsheet size={15} /> Xuất hồ sơ bảo mật
          </button>
        )}
      </div>

      {preview && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-label="Dry-run import hồ sơ">
          <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-black text-slate-950 dark:text-white">Kết quả dry-run</h2>
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  {preview.totalRows} dòng, {preview.validRows} hợp lệ, {preview.errorRows} lỗi
                </p>
              </div>
              <button type="button" onClick={() => setPreview(null)} disabled={loading} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Đóng"><X size={18} /></button>
            </div>

            {preview.errorRows > 0 ? (
              <div className="mt-6 space-y-2">
                <div className="flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                  <ShieldAlert size={17} /> Batch có lỗi nên toàn bộ thao tác apply đang bị khóa.
                </div>
                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs font-black text-slate-500 dark:bg-slate-800">
                      <tr><th className="px-3 py-2">Sheet</th><th className="px-3 py-2">Dòng</th><th className="px-3 py-2">Cột</th><th className="px-3 py-2">Mã lỗi</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {preview.errors.map((error, index) => (
                        <tr key={`${error.sheetCode}-${error.rowNumber}-${error.column}-${index}`}>
                          <td className="px-3 py-2 font-mono text-xs">{error.sheetCode}</td>
                          <td className="px-3 py-2 font-mono">{error.rowNumber}</td>
                          <td className="px-3 py-2 font-mono text-xs">{error.column}</td>
                          <td className="px-3 py-2 font-bold text-rose-700 dark:text-rose-300">{ERROR_LABELS[error.errorCode] || error.errorCode}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="mt-6 rounded-xl bg-emerald-50 p-4 text-sm font-bold text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                Tất cả dòng đã vượt qua kiểm tra kiểu dữ liệu, mã bản ghi, danh mục và quyền domain.
              </div>
            )}

            <label className="mt-6 block space-y-2">
              <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Lý do apply *</span>
              <textarea value={reason} onChange={event => setReason(event.target.value)} rows={3} disabled={preview.errorRows > 0} className="w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold outline-none focus:border-sky-600 dark:border-slate-700 dark:bg-slate-800 dark:text-white" placeholder="Tối thiểu 10 ký tự" />
            </label>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setPreview(null)} disabled={loading} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-700 dark:border-slate-700 dark:text-slate-200">Đóng</button>
              <button type="button" onClick={() => void applyImport()} disabled={loading || preview.errorRows !== 0 || reason.trim().length < 10} className="inline-flex items-center gap-2 rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50">
                {loading && <Loader2 size={15} className="animate-spin" />} Xác nhận apply toàn batch
              </button>
            </div>
          </div>
        </div>
      )}

      {exportOpen && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-label="Xuất hồ sơ bảo mật">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <h2 className="text-xl font-black text-slate-950 dark:text-white">Xuất hồ sơ bảo mật</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">Workbook gồm dữ liệu C1 đến C4, watermark và manifest. Thao tác được ghi audit.</p>
            <label className="mt-5 block space-y-2">
              <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Lý do xuất *</span>
              <textarea value={reason} onChange={event => setReason(event.target.value)} rows={3} className="w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold outline-none focus:border-emerald-600 dark:border-slate-700 dark:bg-slate-800 dark:text-white" placeholder="Tối thiểu 10 ký tự" />
            </label>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setExportOpen(false)} disabled={loading} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-700 dark:border-slate-700 dark:text-slate-200">Hủy</button>
              <button type="button" onClick={() => void exportProfiles()} disabled={loading || reason.trim().length < 10} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50">
                {loading ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />} Xuất workbook
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default HrmPersonnelImportExportPanel;
