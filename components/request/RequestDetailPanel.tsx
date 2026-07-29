import React, { useState } from 'react';
import { ChevronLeft, Copy, Loader2, Printer } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import type { RequestDetail } from '../../lib/requestRuntimeService';
import { buildRequestRoute } from '../../lib/requestRoutes';
import { RequestActionBar } from './RequestActionBar';
import { RequestApprovalInspector } from './RequestApprovalInspector';
import { RequestStatusBadge } from './RequestTable';
import { RequestPrintPreview } from './RequestPrintPreview';

const displayValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return JSON.stringify(value);
};

export const RequestDetailPanel: React.FC<{
  detail: RequestDetail | null;
  loading: boolean;
  forbiddenOrMissing: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  onBack?: () => void;
}> = ({ detail, loading, forbiddenOrMissing, error, refresh, onBack }) => {
  const toast = useToast();
  const [copying, setCopying] = useState(false);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  if (loading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="animate-spin text-emerald-600" /></div>;
  if (forbiddenOrMissing) return <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-slate-500">Không tìm thấy đề xuất hoặc bạn không có quyền xem đề xuất này.</div>;
  if (error || !detail) return <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-rose-600">Không thể tải chi tiết đề xuất.</div>;
  const copyLink = async () => {
    setCopying(true);
    try {
      await navigator.clipboard.writeText(new URL(buildRequestRoute(detail.id), window.location.origin).toString());
      toast.success('Đã sao chép liên kết', detail.code);
    } catch { toast.error('Không thể sao chép liên kết'); } finally { setCopying(false); }
  };
  return <><div className="flex min-w-0 flex-1 overflow-hidden"><article className="min-w-0 flex-1 overflow-y-auto bg-white p-5 dark:bg-slate-900 md:p-7"><div className="mb-5 flex items-start gap-3">{onBack && <button type="button" onClick={onBack} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 md:hidden dark:hover:bg-slate-800" aria-label="Quay về danh sách"><ChevronLeft size={20} /></button>}<div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-semibold text-emerald-700">{detail.code}</p><h1 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{detail.title}</h1></div><div className="flex shrink-0 gap-2"><button type="button" onClick={() => setShowPrintPreview(true)} disabled={!detail.printConfig.browserPrintEnabled} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300"><Printer size={14} />In</button><button type="button" onClick={() => void copyLink()} disabled={copying} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"><Copy size={14} />Sao chép link</button></div></div><div className="mt-3"><RequestStatusBadge status={detail.status} /></div></div></div><RequestActionBar detail={detail} onChanged={refresh} /><dl className="mt-5 grid gap-4 border-y border-slate-100 py-5 text-sm sm:grid-cols-2 dark:border-slate-800"><div><dt className="text-slate-500">Người tạo</dt><dd className="mt-1 font-medium text-slate-800 dark:text-white">{detail.creator.name}</dd></div><div><dt className="text-slate-500">Mẫu đề xuất</dt><dd className="mt-1 font-medium text-slate-800 dark:text-white">{detail.templateName} · v{detail.templateVersionNumber}</dd></div><div><dt className="text-slate-500">Thời điểm tạo</dt><dd className="mt-1 font-medium text-slate-800 dark:text-white">{new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(detail.createdAt))}</dd></div><div><dt className="text-slate-500">Cập nhật gần nhất</dt><dd className="mt-1 font-medium text-slate-800 dark:text-white">{new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(detail.updatedAt))}</dd></div></dl><section className="mt-6"><h2 className="text-sm font-bold text-slate-900 dark:text-white">Nội dung đề xuất</h2><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-200">{detail.description || 'Không có mô tả.'}</p></section><section className="mt-8"><h2 className="text-sm font-bold text-slate-900 dark:text-white">Thông tin đề xuất</h2><dl className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-100 dark:divide-slate-800 dark:border-slate-800">{[...detail.formSchema].sort((a, b) => a.sortOrder - b.sortOrder).map(field => <div key={field.key} className="grid gap-1 px-4 py-3 sm:grid-cols-3"><dt className="text-sm text-slate-500">{field.label}</dt><dd className="break-words text-sm font-medium text-slate-800 sm:col-span-2 dark:text-white">{displayValue(detail.formData[field.key])}</dd></div>)}</dl></section></article><div className="hidden xl:block"><RequestApprovalInspector detail={detail} /></div></div>{showPrintPreview && <RequestPrintPreview detail={detail} onClose={() => setShowPrintPreview(false)} />}</>;
};
