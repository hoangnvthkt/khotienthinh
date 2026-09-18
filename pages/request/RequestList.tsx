import React, { useEffect, useState } from 'react';
import { AlertCircle, Loader2, Plus, Search } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { RequestContextNav } from '../../components/request/RequestContextNav';
import { RequestCreateDialog } from '../../components/request/RequestCreateDialog';
import { RequestDetailPanel } from '../../components/request/RequestDetailPanel';
import { RequestMasterList } from '../../components/request/RequestMasterList';
import { RequestStatusBadge, RequestTable } from '../../components/request/RequestTable';
import { useRequestDetail } from '../../hooks/useRequestDetail';
import { useRequestList, type RequestListFilter } from '../../hooks/useRequestList';
import { requestRuntimeService, type RequestSummary } from '../../lib/requestRuntimeService';
import { buildRequestRoute } from '../../lib/requestRoutes';
import { getRequestWorkspaceMode } from '../../lib/requestWorkspace';

const STATUS_FILTERS: Array<{ label: string; status?: RequestListFilter['status']; overdue?: boolean }> = [
  { label: 'Tất cả' },
  { label: 'Quá hạn', overdue: true },
  { label: 'Chờ duyệt', status: 'PENDING' },
  { label: 'Đã chấp thuận', status: 'APPROVED' },
  { label: 'Đã từ chối', status: 'REJECTED' },
  { label: 'Đã trả lại', status: 'RETURNED' },
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

  // Column collapse states for maximum Column 3 display area
  const [isNavCollapsed, setIsNavCollapsed] = useState(false);
  const [isMasterListCollapsed, setIsMasterListCollapsed] = useState(false);
  const [isInspectorCollapsed, setIsInspectorCollapsed] = useState(false);

  const filter: RequestListFilter = { view, status, overdue: overdue || undefined, search };
  const list = useRequestList(filter);
  const detail = useRequestDetail(requestId);
  const workspaceMode = getRequestWorkspaceMode(width, Boolean(requestId));

  useEffect(() => {
    void requestRuntimeService.getSummary().then(setSummary).catch(() => setSummary(null));
  }, [view]);

  const select = (id: string) => navigate(buildRequestRoute(id));
  const clearSelection = () => navigate('/rq');

  const refreshAfterAction = async () => {
    await Promise.all([detail.refresh(), list.refresh()]);
    void requestRuntimeService.getSummary().then(setSummary).catch(() => setSummary(null));
  };

  const listContent = list.loading ? (
    <div className="flex flex-1 items-center justify-center">
      <Loader2 className="animate-spin text-emerald-600" />
    </div>
  ) : list.error ? (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <AlertCircle className="text-rose-500" />
      <p className="text-sm text-slate-600 dark:text-slate-300">{list.error.message}</p>
      <button
        type="button"
        onClick={() => void list.refresh()}
        className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white"
      >
        Thử lại
      </button>
    </div>
  ) : (
    <>
      <RequestTable items={list.items} onSelect={select} />
      <div className="space-y-2.5 p-3 md:hidden">
        {list.items.map(item => (
          <button
            type="button"
            key={item.id}
            onClick={() => select(item.id)}
            className="w-full text-left rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-sm transition-all active:scale-[0.99] active:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:active:bg-slate-800/80"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                {item.code}
              </span>
              <div className="shrink-0">
                <RequestStatusBadge status={item.status} />
              </div>
            </div>
            <p className="mt-1.5 text-sm font-semibold leading-snug text-slate-900 line-clamp-2 dark:text-white">
              {item.title}
            </p>
            <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <span className="truncate">{item.templateName}</span>
            </div>
          </button>
        ))}
      </div>
      {list.items.length === 0 && (
        <div className="p-10 text-center text-sm text-slate-500">Không có đề xuất phù hợp.</div>
      )}
    </>
  );

  const detailPanel = (
    <RequestDetailPanel
      detail={detail.detail}
      loading={detail.loading}
      error={detail.error}
      forbiddenOrMissing={detail.forbiddenOrMissing}
      refresh={refreshAfterAction}
      onBack={clearSelection}
      isInspectorCollapsed={isInspectorCollapsed}
      onToggleInspectorCollapse={() => setIsInspectorCollapsed(prev => !prev)}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-100 dark:bg-slate-950">
      {/* Header Bar */}
      <header className="flex shrink-0 flex-col gap-2.5 border-b border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:gap-3 sm:px-4 sm:py-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="truncate text-lg sm:text-xl font-bold text-slate-900 dark:text-white">Danh sách đề xuất</h1>
            <p className="hidden text-xs text-slate-500 sm:block">Phê duyệt tự động theo mẫu yêu cầu</p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateDialog(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs sm:text-sm font-semibold text-white shadow-sm shadow-emerald-600/20 transition hover:bg-emerald-700 active:scale-95 shrink-0"
          >
            <Plus size={16} /> <span>Tạo đề xuất</span>
          </button>
        </div>

        <div className="relative w-full sm:ml-auto sm:w-72">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Tìm mã, tiêu đề..."
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none transition focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>
      </header>

      {/* 4-Column Workspace Layout with maximized Column 3 Area */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row overflow-hidden">
        {/* Column 1: Context Nav */}
        <RequestContextNav
          view={view}
          onChange={setView}
          summary={summary}
          isCollapsed={isNavCollapsed}
          onToggleCollapse={() => setIsNavCollapsed(prev => !prev)}
        />

        {/* Main Content Area */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Status Filter Bar */}
          <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 no-scrollbar sm:px-4 sm:gap-2 dark:border-slate-800 dark:bg-slate-900">
            {STATUS_FILTERS.map(item => {
              const active = status === item.status && overdue === Boolean(item.overdue);
              return (
                <button
                  type="button"
                  key={item.label}
                  onClick={() => {
                    setStatus(item.status);
                    setOverdue(Boolean(item.overdue));
                  }}
                  className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                    active
                      ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/25 font-semibold'
                      : 'bg-slate-100/90 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          {/* Desktop / Tablet / Mobile Workspace Split */}
          {workspaceMode === 'DESKTOP_MASTER_DETAIL' && requestId ? (
            <div className="flex min-h-0 flex-1 overflow-hidden">
              {/* Column 2: Master List */}
              <RequestMasterList
                items={list.items}
                selectedId={requestId}
                onSelect={select}
                isCollapsed={isMasterListCollapsed}
                onToggleCollapse={() => setIsMasterListCollapsed(prev => !prev)}
              />

              {/* Column 3 (+ Column 4 inside detailPanel): Primary Content Column */}
              <div className="flex min-w-0 flex-1 overflow-hidden">
                {detailPanel}
              </div>
            </div>
          ) : workspaceMode === 'MOBILE_DETAIL' && requestId ? (
            detailPanel
          ) : (
            <div className="min-h-0 flex-1 overflow-auto bg-white dark:bg-slate-900">{listContent}</div>
          )}

          {!requestId && list.nextCursor && (
            <div className="shrink-0 border-t border-slate-200 bg-white p-3 text-center dark:border-slate-800 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => void list.loadMore()}
                disabled={list.loadingMore}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300"
              >
                {list.loadingMore ? 'Đang tải...' : 'Tải thêm'}
              </button>
            </div>
          )}
        </main>
      </div>

      <RequestCreateDialog isOpen={showCreateDialog} onClose={() => setShowCreateDialog(false)} />
    </div>
  );
};

export default RequestList;
