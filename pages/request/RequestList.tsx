import React, { useEffect, useState } from 'react';
import { AlertCircle, Inbox, Loader2, Plus, Search, X } from 'lucide-react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { RequestContextNav } from '../../components/request/RequestContextNav';
import { RequestCreateDialog } from '../../components/request/RequestCreateDialog';
import { RequestDetailPanel } from '../../components/request/RequestDetailPanel';
import { RequestMasterList } from '../../components/request/RequestMasterList';
import { ApproverStack, RequestStatusBadge, RequestTable } from '../../components/request/RequestTable';
import { useRequestHoverPreview } from '../../components/request/RequestHoverPreview';
import { useRequestDetail } from '../../hooks/useRequestDetail';
import { useRequestList, type RequestListFilter } from '../../hooks/useRequestList';
import { requestRuntimeService, type RequestSummary } from '../../lib/requestRuntimeService';
import { buildRequestRoute } from '../../lib/requestRoutes';
import { getRequestWorkspaceMode } from '../../lib/requestWorkspace';
import { buildRequestListParams, parseRequestListParams } from '../../lib/requestQueryState';

const STATUS_FILTERS: Array<{ label: string; status?: RequestListFilter['status']; overdue?: boolean }> = [
  { label: 'Tất cả' },
  { label: 'Quá hạn', overdue: true },
  { label: 'Chờ duyệt', status: 'PENDING' },
  { label: 'Trả lại', status: 'RETURNED' },
  { label: 'Hoàn thành', status: 'APPROVED' },
  { label: 'Từ chối', status: 'REJECTED' },
  { label: 'Đã hủy', status: 'CANCELLED' },
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
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { view, status, overdue, search } = parseRequestListParams(searchParams);
  const updateFilter = (patch: Partial<{ view: RequestListFilter['view']; status: RequestListFilter['status']; overdue: boolean; search: string }>) => {
    setSearchParams(buildRequestListParams({ view, status, overdue, search, ...patch }), { replace: true });
  };
  const setView = (next: RequestListFilter['view']) => updateFilter({ view: next });
  const [summary, setSummary] = useState<RequestSummary | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // Column collapse states for maximum Column 3 display area
  const [isNavCollapsed, setIsNavCollapsed] = useState(false);
  const [isMasterListCollapsed, setIsMasterListCollapsed] = useState(false);
  const [isInspectorCollapsed, setIsInspectorCollapsed] = useState(false);

  const filter: RequestListFilter = { view, status, overdue: overdue || undefined, search };
  const list = useRequestList(filter);
  const cardPreview = useRequestHoverPreview('below');
  const detail = useRequestDetail(requestId);
  const workspaceMode = getRequestWorkspaceMode(width, Boolean(requestId));

  useEffect(() => {
    void requestRuntimeService.getSummary().then(setSummary).catch(() => setSummary(null));
  }, [view]);

  // Carry the filters across list <-> detail, which are separate routes.
  const select = (id: string) => navigate({ pathname: buildRequestRoute(id), search: location.search });
  const clearSelection = () => navigate({ pathname: '/rq', search: location.search });

  const refreshAfterAction = async () => {
    await Promise.all([detail.refresh(), list.refresh()]);
    void requestRuntimeService.getSummary().then(setSummary).catch(() => setSummary(null));
  };

  const listContent = list.loading ? (
    <div className="flex flex-1 items-center justify-center">
      <Loader2 className="animate-spin text-teal-600" />
    </div>
  ) : list.error ? (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <AlertCircle className="text-rose-500" />
      <p className="text-sm text-muted-foreground">{list.error.message}</p>
      <button
        type="button"
        onClick={() => void list.refresh()}
        className="rounded-lg bg-leaf-600 px-3 py-2 text-sm font-semibold text-white hover:bg-leaf-700"
      >
        Thử lại
      </button>
    </div>
  ) : (
    <>
      <RequestTable items={list.items} onSelect={select} />
      <ul className="divide-y divide-border md:hidden">
        {list.items.map(item => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => select(item.id)}
              className="group block w-full px-4 py-3 text-left transition-colors active:bg-mint-50 hover:bg-mint-50/60 dark:hover:bg-mint-900/20"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono text-[11px] font-semibold text-muted-foreground">{item.code}</span>
                <RequestStatusBadge status={item.status} />
              </div>
              <p className="mt-1 line-clamp-2 text-sm font-semibold leading-snug">
                <span {...cardPreview.bind(item)} className="text-foreground group-hover:text-teal-700 dark:group-hover:text-teal-300">{item.title}</span>
              </p>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-xs text-muted-foreground">{item.templateName} · <span className="font-medium text-mint-700 dark:text-mint-300">{item.creator.name}</span></span>
                <ApproverStack item={item} max={3} />
              </div>
            </button>
          </li>
        ))}
      </ul>
      {list.items.length === 0 && (
        <div className="flex flex-col items-center p-10 text-center text-sm text-muted-foreground"><Inbox size={26} className="mb-2 text-mint-500" />{search || status || overdue ? 'Không có đề xuất khớp bộ lọc.' : 'Chưa có đề xuất nào.'}</div>
      )}
      {cardPreview.preview}
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
      onDeleted={() => {
        clearSelection();
        void list.refresh();
        void requestRuntimeService.getSummary().then(setSummary).catch(() => setSummary(null));
      }}
      isInspectorCollapsed={isInspectorCollapsed}
      onToggleInspectorCollapse={() => setIsInspectorCollapsed(prev => !prev)}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Header Bar */}
      <header className="flex shrink-0 flex-col gap-2.5 border-b border-border bg-card p-3 sm:flex-row sm:items-center sm:gap-3 sm:px-4">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold text-foreground sm:text-xl">Danh sách đề xuất</h1>
            <p className="hidden text-xs text-muted-foreground sm:block">Gửi, theo dõi và duyệt đề xuất theo mẫu</p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateDialog(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-leaf-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-leaf-700"
          >
            <Plus size={16} /> <span>Tạo đề xuất</span>
          </button>
        </div>

        <label className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-2.5 focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500/20 sm:ml-auto sm:w-80">
          <Search size={15} className="shrink-0 text-muted-foreground" />
          <input
            value={search}
            onChange={event => updateFilter({ search: event.target.value })}
            aria-label="Tìm đề xuất"
            placeholder="Tìm mã, tiêu đề đề xuất…"
            className="w-full bg-transparent py-2 text-sm text-foreground outline-none"
          />
          {search && <button type="button" onClick={() => updateFilter({ search: '' })} aria-label="Xóa tìm kiếm" className="text-muted-foreground hover:text-foreground"><X size={14} /></button>}
        </label>
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
          <div className="shrink-0 border-b border-border bg-card px-3 py-2 sm:px-4"><div className="flex w-max max-w-full gap-1 overflow-x-auto rounded-xl border border-border bg-background p-1 no-scrollbar" role="tablist" aria-label="Lọc theo trạng thái">
            {STATUS_FILTERS.map(item => {
              const active = status === item.status && overdue === Boolean(item.overdue);
              return (
                <button
                  type="button"
                  key={item.label}
                  onClick={() => {
                    updateFilter({ status: item.status, overdue: Boolean(item.overdue) });
                  }}
                  role="tab"
                  aria-selected={active}
                  className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    active ? 'bg-teal-700 text-white' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div></div>

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
            <div className="min-h-0 flex-1 overflow-auto bg-card">{listContent}</div>
          )}

          {!requestId && list.nextCursor && (
            <div className="shrink-0 border-t border-border bg-card p-3 text-center">
              <button
                type="button"
                onClick={() => void list.loadMore()}
                disabled={list.loadingMore}
                className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-teal-700 hover:bg-muted disabled:opacity-50 dark:text-teal-300"
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
