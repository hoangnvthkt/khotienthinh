import React, { useState } from 'react';
import { Calendar, ChevronLeft, Clock, Copy, FileSpreadsheet, FileText, Loader2, PanelRightClose, PanelRightOpen, Printer, Table2, User } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import type { RequestDetail } from '../../lib/requestRuntimeService';
import { buildRequestRoute } from '../../lib/requestRoutes';
import { RequestActionBar } from './RequestActionBar';
import { RequestApprovalInspector } from './RequestApprovalInspector';
import { RequestStatusBadge } from './RequestTable';
import { RequestPrintPreview } from './RequestPrintPreview';

const displayValue = (value: unknown, fieldType?: string, options?: string[]): React.ReactNode => {
  if (value === null || value === undefined || value === '') return <span className="text-slate-400 font-normal italic">—</span>;
  
  if ((fieldType === 'table' || Array.isArray(value)) && Array.isArray(value)) {
    const cols = (options && options.filter(Boolean).length > 0)
      ? options.filter(Boolean)
      : (value.length > 0 && typeof value[0] === 'object' && value[0] !== null ? Object.keys(value[0]) : []);
    
    if (cols.length === 0) return <span className="text-slate-400 font-normal italic">—</span>;
    
    const rows = value as Array<Record<string, string>>;
    return (
      <div className="mt-2 overflow-hidden rounded-2xl border border-emerald-200/80 bg-white shadow-sm dark:border-emerald-800/40 dark:bg-slate-900">
        <div className="overflow-x-auto max-h-[300px]">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 z-10 bg-emerald-100/90 backdrop-blur dark:bg-emerald-950/80 text-emerald-950 dark:text-emerald-100 font-bold border-b border-emerald-200 dark:border-emerald-800">
              <tr>
                <th className="w-10 px-3 py-2 text-center text-emerald-700 dark:text-emerald-400 font-extrabold border-r border-emerald-200/60 dark:border-emerald-800/60">#</th>
                {cols.map(c => (
                  <th key={c} className="px-3.5 py-2 font-bold uppercase tracking-wider text-[11px] whitespace-nowrap">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((row, idx) => (
                <tr key={idx} className={idx % 2 === 0 ? 'bg-white dark:bg-slate-900' : 'bg-slate-50/60 dark:bg-slate-850/40'}>
                  <td className="px-3 py-2 text-center font-bold text-slate-400 border-r border-slate-100 dark:border-slate-800">{idx + 1}</td>
                  {cols.map(c => (
                    <td key={c} className="px-3.5 py-2 text-slate-800 dark:text-slate-200 whitespace-nowrap">
                      {row[c] || '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-1.5 px-3.5 py-2 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 border-t border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40">
          <FileSpreadsheet size={13} />
          <span>Bảng dữ liệu: {rows.length} dòng × {cols.length} cột</span>
        </div>
      </div>
    );
  }
  
  if (typeof value === 'string' || typeof value === 'number') {
    return <span className="font-semibold text-slate-800 dark:text-slate-100">{String(value)}</span>;
  }
  
  return <pre className="text-xs bg-slate-100 p-2 rounded dark:bg-slate-800 overflow-x-auto">{JSON.stringify(value, null, 2)}</pre>;
};

export const RequestDetailPanel: React.FC<{
  detail: RequestDetail | null;
  loading: boolean;
  forbiddenOrMissing: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  onBack?: () => void;
  isInspectorCollapsed?: boolean;
  onToggleInspectorCollapse?: () => void;
}> = ({
  detail,
  loading,
  forbiddenOrMissing,
  error,
  refresh,
  onBack,
  isInspectorCollapsed = false,
  onToggleInspectorCollapse,
}) => {
  const toast = useToast();
  const [copying, setCopying] = useState(false);
  const [showPrintPreview, setShowPrintPreview] = useState(false);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="animate-spin text-emerald-600" size={32} />
          <p className="text-xs font-semibold text-slate-500">Đang tải chi tiết đề xuất...</p>
        </div>
      </div>
    );
  }

  if (forbiddenOrMissing) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center min-h-[400px]">
        <div className="rounded-full bg-slate-100 p-4 dark:bg-slate-800">
          <FileText className="text-slate-400" size={32} />
        </div>
        <p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-300">
          Không tìm thấy đề xuất hoặc bạn không có quyền xem đề xuất này.
        </p>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center min-h-[400px]">
        <p className="text-sm font-semibold text-rose-600">Không thể tải chi tiết đề xuất.</p>
      </div>
    );
  }

  const copyLink = async () => {
    setCopying(true);
    try {
      await navigator.clipboard.writeText(new URL(buildRequestRoute(detail.id), window.location.origin).toString());
      toast.success('Đã sao chép liên kết', detail.code);
    } catch {
      toast.error('Không thể sao chép liên kết');
    } finally {
      setCopying(false);
    }
  };

  return (
    <>
      <div className="flex min-w-0 flex-1 overflow-hidden h-full">
        {/* Column 3: Primary Content Display Area (Maximized area) */}
        <article className="min-w-0 flex-1 overflow-y-auto bg-slate-50/50 p-4 dark:bg-slate-950 md:p-6 lg:p-7 space-y-6">
          
          {/* Hero Header Card */}
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start gap-3">
              {onBack && (
                <button
                  type="button"
                  onClick={onBack}
                  className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 md:hidden dark:hover:bg-slate-800 transition"
                  aria-label="Quay về danh sách"
                >
                  <ChevronLeft size={20} />
                </button>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center rounded-lg bg-emerald-100/90 px-2.5 py-1 text-xs font-mono font-extrabold text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300">
                      {detail.code}
                    </span>
                    <RequestStatusBadge status={detail.status} />
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowPrintPreview(true)}
                      disabled={!detail.printConfig.browserPrintEnabled}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 transition"
                    >
                      <Printer size={14} /> In
                    </button>

                    <button
                      type="button"
                      onClick={() => void copyLink()}
                      disabled={copying}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 transition"
                    >
                      <Copy size={14} /> Sao chép link
                    </button>

                    {onToggleInspectorCollapse && (
                      <button
                        type="button"
                        onClick={onToggleInspectorCollapse}
                        className="hidden xl:inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-900 transition"
                        title={isInspectorCollapsed ? 'Mở quy trình duyệt' : 'Thu gọn quy trình duyệt'}
                      >
                        {isInspectorCollapsed ? <PanelRightOpen size={14} /> : <PanelRightClose size={14} />}
                        <span className="hidden xl:inline">{isInspectorCollapsed ? 'Hiện luồng duyệt' : 'Ẩn luồng duyệt'}</span>
                      </button>
                    )}
                  </div>
                </div>

                <h1 className="mt-3 text-xl font-extrabold text-slate-900 dark:text-white md:text-2xl leading-tight">
                  {detail.title}
                </h1>
              </div>
            </div>

            {/* Action Bar */}
            <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800">
              <RequestActionBar detail={detail} onChanged={refresh} />
            </div>
          </div>

          {/* Section 1: Executive Overview Cards (Responsive 2x2 or 4 grid) */}
          <div className="grid grid-cols-2 sm:grid-cols-2 2xl:grid-cols-4 gap-3">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900 min-w-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="shrink-0 rounded-xl bg-emerald-50 p-2 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
                  <User size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 truncate">Người tạo</p>
                  <p className="mt-0.5 text-xs font-extrabold text-slate-800 dark:text-white truncate" title={detail.creator.name}>
                    {detail.creator.name}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900 min-w-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="shrink-0 rounded-xl bg-blue-50 p-2 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
                  <FileText size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 truncate">Mẫu đề xuất</p>
                  <p className="mt-0.5 text-xs font-extrabold text-slate-800 dark:text-white truncate" title={`${detail.templateName} v${detail.templateVersionNumber}`}>
                    {detail.templateName} <span className="font-normal text-slate-400">v{detail.templateVersionNumber}</span>
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900 min-w-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="shrink-0 rounded-xl bg-purple-50 p-2 text-purple-600 dark:bg-purple-950/60 dark:text-purple-400">
                  <Calendar size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 truncate">Thời điểm tạo</p>
                  <p className="mt-0.5 text-xs font-extrabold text-slate-800 dark:text-white truncate">
                    {new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(detail.createdAt))}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900 min-w-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="shrink-0 rounded-xl bg-amber-50 p-2 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
                  <Clock size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 truncate">Cập nhật gần nhất</p>
                  <p className="mt-0.5 text-xs font-extrabold text-slate-800 dark:text-white truncate">
                    {new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(detail.updatedAt))}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Request Description Card */}
          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h2 className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-slate-500">
              <FileText size={15} className="text-emerald-600" /> Nội dung & Lý do đề xuất
            </h2>
            <div className="mt-3 rounded-xl bg-slate-50/80 p-4 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800 dark:text-slate-200 font-normal">
                {detail.description || 'Không có mô tả chi tiết.'}
              </p>
            </div>
          </section>

          {/* Section 3 & 4: Form Data & Attachment Tables */}
          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h2 className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-slate-500 mb-4">
              <Table2 size={15} className="text-emerald-600" /> Thông tin dữ liệu phiếu
            </h2>

            <div className="space-y-4">
              {[...detail.formSchema].sort((a, b) => a.sortOrder - b.sortOrder).map(field => {
                const rawValue = detail.formData[field.key];
                const isTable = field.fieldType === 'table' || Array.isArray(rawValue);

                if (isTable) {
                  return (
                    <div key={field.key} className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
                      <p className="text-xs font-extrabold uppercase tracking-wider text-emerald-800 dark:text-emerald-400">
                        {field.label}
                      </p>
                      {displayValue(rawValue, field.fieldType, field.options)}
                    </div>
                  );
                }

                return (
                  <div key={field.key} className="grid grid-cols-1 sm:grid-cols-3 gap-2 p-3.5 rounded-xl bg-slate-50/60 border border-slate-100 dark:bg-slate-800/40 dark:border-slate-800 items-center">
                    <dt className="text-xs font-bold text-slate-500">{field.label}</dt>
                    <dd className="sm:col-span-2 text-sm">
                      {displayValue(rawValue, field.fieldType, field.options)}
                    </dd>
                  </div>
                );
              })}
            </div>
          </section>
        </article>

        {/* Column 4: Approval Inspector Side Panel */}
        <div className="hidden xl:block">
          <RequestApprovalInspector
            detail={detail}
            isCollapsed={isInspectorCollapsed}
            onToggleCollapse={onToggleInspectorCollapse}
          />
        </div>
      </div>

      {showPrintPreview && (
        <RequestPrintPreview detail={detail} onClose={() => setShowPrintPreview(false)} />
      )}
    </>
  );
};

