import React, { useEffect, useState } from 'react';
import { AlertCircle, ChevronLeft, Loader2, Plus, Search } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { RequestContextNav } from '../../components/request/RequestContextNav';
import { RequestCreateDialog } from '../../components/request/RequestCreateDialog';
import { RequestMasterList } from '../../components/request/RequestMasterList';
import { RequestStatusBadge, RequestTable } from '../../components/request/RequestTable';
import { useRequestDetail } from '../../hooks/useRequestDetail';
import { useRequestList, type RequestListFilter } from '../../hooks/useRequestList';
import { requestRuntimeService, type RequestSummary } from '../../lib/requestRuntimeService';
import { buildRequestRoute } from '../../lib/requestRoutes';
import { getRequestWorkspaceMode } from '../../lib/requestWorkspace';

const STATUS_FILTERS: Array<{ label: string; status?: RequestListFilter['status']; overdue?: boolean }> = [
  { label: 'Tất cả' }, { label: 'Quá hạn', overdue: true }, { label: 'Chờ duyệt', status: 'PENDING' },
  { label: 'Đã chấp thuận', status: 'APPROVED' }, { label: 'Đã từ chối', status: 'REJECTED' }, { label: 'Đã trả lại', status: 'RETURNED' },
];

const useViewportWidth = () => {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const listener = () => setWidth(window.innerWidth);
    window.addEventListener('resize', listener);
    return () => window.removeEventListener('resize', listener);
  }, []);
  return width;
};

const RequestSelectedPreview: React.FC<{ requestId: string; onBack?: () => void }> = ({ requestId, onBack }) => {
  const { detail, loading, forbiddenOrMissing, error } = useRequestDetail(requestId);
  if (loading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="animate-spin text-emerald-600" /></div>;
  if (forbiddenOrMissing) return <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-slate-500">Không tìm thấy đề xuất hoặc bạn không có quyền xem đề xuất này.</div>;
  if (error || !detail) return <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-rose-600">Không thể tải chi tiết đề xuất.</div>;
  return <section className="min-w-0 flex-1 overflow-y-auto bg-white p-5 dark:bg-slate-900 md:p-7"><div className="mb-5 flex items-start gap-3">{onBack && <button type="button" onClick={onBack} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 md:hidden dark:hover:bg-slate-800" aria-label="Quay về danh sách"><ChevronLeft size={20} /></button>}<div className="min-w-0"><p className="text-xs font-semibold text-emerald-700">{detail.code}</p><h1 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{detail.title}</h1><div className="mt-3"><RequestStatusBadge status={detail.status} /></div></div></div><dl className="grid gap-4 border-y border-slate-100 py-5 text-sm sm:grid-cols-2 dark:border-slate-800"><div><dt className="text-slate-500">Người tạo</dt><dd className="mt-1 font-medium text-slate-800 dark:text-white">{detail.creator.name}</dd></div><div><dt className="text-slate-500">Mẫu đề xuất</dt><dd className="mt-1 font-medium text-slate-800 dark:text-white">{detail.templateName} · v{detail.templateVersionNumber}</dd></div></dl><p className="mt-6 whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-200">{detail.description || 'Không có mô tả.'}</p><section className="mt-8"><h2 className="text-sm font-bold text-slate-900 dark:text-white">Thông tin đề xuất</h2><dl className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-100 dark:divide-slate-800 dark:border-slate-800">{[...detail.formSchema].sort((a, b) => a.sortOrder - b.sortOrder).map(field => <div key={field.key} className="grid gap-1 px-4 py-3 sm:grid-cols-3"><dt className="text-sm text-slate-500">{field.label}</dt><dd className="break-words text-sm font-medium text-slate-800 sm:col-span-2 dark:text-white">{String(detail.formData[field.key] ?? '—')}</dd></div>)}</dl></section></section>;
};

const RequestList: React.FC = () => {
  const navigate = useNavigate();
  const { requestId } = useParams<{ requestId: string }>();
  const width = useViewportWidth();
  const [view, setView] = useState<RequestListFilter['view']>('ALL');
  const [status, setStatus] = useState<RequestListFilter['status']>();
  const [overdue, setOverdue] = useState(false);
  const [search, setSearch] = useState('');
  const [summary, setSummary] = useState<RequestSummary | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const filter: RequestListFilter = { view, status, overdue: overdue || undefined, search };
  const { items, loading, loadingMore, error, nextCursor, loadMore, refresh } = useRequestList(filter);
  const workspaceMode = getRequestWorkspaceMode(width, Boolean(requestId));

  useEffect(() => { void requestRuntimeService.getSummary().then(setSummary).catch(() => setSummary(null)); }, [view]);
  const select = (id: string) => navigate(buildRequestRoute(id));
  const clearSelection = () => navigate('/rq');

  const listContent = loading ? <div className="flex flex-1 items-center justify-center"><Loader2 className="animate-spin text-emerald-600" /></div>
    : error ? <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"><AlertCircle className="text-rose-500" /><p className="text-sm text-slate-600 dark:text-slate-300">{error.message}</p><button type="button" onClick={() => void refresh()} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white">Thử lại</button></div>
      : <><RequestTable items={items} onSelect={select} /><div className="divide-y divide-slate-100 md:hidden dark:divide-slate-800">{items.map(item => <button type="button" key={item.id} onClick={() => select(item.id)} className="block w-full px-4 py-3 text-left"><p className="truncate text-sm font-semibold text-slate-800 dark:text-white">{item.title}</p><p className="mt-1 truncate text-xs text-slate-500">{item.code} · {item.templateName}</p><div className="mt-2"><RequestStatusBadge status={item.status} /></div></button>)}</div>{items.length === 0 && <div className="p-10 text-center text-sm text-slate-500">Không có đề xuất phù hợp.</div>}</>;

  return <div className="flex h-full min-h-0 flex-col bg-slate-100 dark:bg-slate-950"><header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900"><div className="min-w-0 flex-1"><h1 className="truncate text-xl font-bold text-slate-900 dark:text-white">Danh sách đề xuất</h1><p className="hidden text-xs text-slate-500 sm:block">Phê duyệt tự động theo mẫu yêu cầu</p></div><div className="relative order-3 w-full sm:order-none sm:w-72"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Tìm mã, tiêu đề..." className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white" /></div><button type="button" onClick={() => setShowCreateDialog(true)} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"><Plus size={16} />Tạo đề xuất</button></header><div className="flex min-h-0 flex-1 flex-col md:flex-row"><RequestContextNav view={view} onChange={setView} summary={summary} /><main className="flex min-w-0 flex-1 flex-col overflow-hidden"><div className="flex shrink-0 gap-2 overflow-x-auto border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">{STATUS_FILTERS.map(item => { const active = status === item.status && overdue === Boolean(item.overdue); return <button type="button" key={item.label} onClick={() => { setStatus(item.status); setOverdue(Boolean(item.overdue)); }} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold ${active ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{item.label}</button>; })}</div>{workspaceMode === 'DESKTOP_MASTER_DETAIL' && requestId ? <div className="flex min-h-0 flex-1"><RequestMasterList items={items} selectedId={requestId} onSelect={select} /><RequestSelectedPreview requestId={requestId} /></div> : workspaceMode === 'MOBILE_DETAIL' && requestId ? <RequestSelectedPreview requestId={requestId} onBack={clearSelection} /> : <div className="min-h-0 flex-1 overflow-auto bg-white dark:bg-slate-900">{listContent}</div>}{!requestId && nextCursor && <div className="shrink-0 border-t border-slate-200 bg-white p-3 text-center dark:border-slate-800 dark:bg-slate-900"><button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300">{loadingMore ? 'Đang tải...' : 'Tải thêm'}</button></div>}</main></div><RequestCreateDialog isOpen={showCreateDialog} onClose={() => setShowCreateDialog(false)} /></div>;
};

export default RequestList;
