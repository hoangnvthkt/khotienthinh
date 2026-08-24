import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight, Plus, RefreshCw, Search } from 'lucide-react';
import type {
  SafetyPassportAssignmentStatus,
  SafetyRosterFilters,
  SafetyWorkerRosterItem,
  SafetyWorkerRosterPage,
  User,
} from '../../../../types';
import type { SafetyWorkforceRequestScope } from '../../../../lib/safetyWorkforceApi';
import { useSafetyActiveWorkforce } from '../../../../hooks/useSafetyWorkforce';
import SafetyPassportWorkerTable from '../SafetyPassportWorkerTable';
import SafetyPassportWorkerDetailModal from '../SafetyPassportWorkerDetailModal';
import SafetyWorkerAssignmentDialog from './SafetyWorkerAssignmentDialog';

interface ScopedViewProps {
  scope: SafetyWorkforceRequestScope;
  currentUser: User;
}

interface ActiveWorkforceContentProps {
  page: SafetyWorkerRosterPage | null;
  loading: boolean;
  error: { message: string } | null;
  onRetry: () => void;
  search?: string;
  eligibilityStatus?: SafetyPassportAssignmentStatus | '';
  documentStatus?: '' | 'missing' | 'expired';
  onSearchChange?: (value: string) => void;
  onEligibilityStatusChange?: (value: SafetyPassportAssignmentStatus | '') => void;
  onDocumentStatusChange?: (value: '' | 'missing' | 'expired') => void;
  onAssign?: () => void;
  onOpenDetail?: (item: SafetyWorkerRosterItem) => void;
  onEnd?: (item: SafetyWorkerRosterItem) => void;
  onIssueCard?: (item: SafetyWorkerRosterItem) => void;
  onLoadMore?: () => void;
}

export const SafetyActiveWorkforceContent: React.FC<ActiveWorkforceContentProps> = ({
  page,
  loading,
  error,
  onRetry,
  search = '',
  eligibilityStatus = '',
  documentStatus = '',
  onSearchChange,
  onEligibilityStatusChange,
  onDocumentStatusChange,
  onAssign,
  onOpenDetail,
  onEnd,
  onIssueCard,
  onLoadMore,
}) => (
  <section className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-black text-slate-900 dark:text-slate-100">Nhân công công trường</h2>
        <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">Chỉ hiển thị nhân công đang được gán vào công trường này.</p>
      </div>
      {page?.capabilities.canManageWorker && onAssign && <button type="button" onClick={onAssign} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-slate-900 px-3 text-xs font-black text-white dark:bg-slate-100 dark:text-slate-900"><Plus size={14} /> Gán nhân công</button>}
    </div>

    {(onSearchChange || onEligibilityStatusChange || onDocumentStatusChange) && (
      <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 md:grid-cols-[minmax(0,1fr)_190px_170px] dark:border-slate-800 dark:bg-slate-900">
        <label className="relative block"><span className="sr-only">Tìm nhân công đang làm việc</span><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} /><input value={search} onChange={event => onSearchChange?.(event.target.value)} className="min-h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs font-semibold outline-none focus:border-orange-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" placeholder="Tìm mã, tên, điện thoại" /></label>
        <select value={eligibilityStatus} onChange={event => onEligibilityStatusChange?.(event.target.value as SafetyPassportAssignmentStatus | '')} className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"><option value="">Tất cả điều kiện</option><option value="eligible">Đủ điều kiện</option><option value="missing_profile">Thiếu hồ sơ</option><option value="missing_certificate">Thiếu chứng chỉ</option><option value="expired_certificate">Chứng chỉ hết hạn</option><option value="missing_site_requirement">Thiếu yêu cầu công trường</option><option value="suspended">Tạm khóa</option></select>
        <select value={documentStatus} onChange={event => onDocumentStatusChange?.(event.target.value as '' | 'missing' | 'expired')} className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"><option value="">Tất cả hồ sơ</option><option value="missing">Thiếu hồ sơ</option><option value="expired">Hồ sơ hết hạn</option></select>
      </div>
    )}

    {error && (
      <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900/60 dark:bg-red-950/20">
        <AlertTriangle className="mt-0.5 text-red-600" size={17} />
        <div className="min-w-0 flex-1"><div className="text-xs font-black text-red-900 dark:text-red-200">Không tải được nhân công công trường</div><p className="mt-1 text-xs text-red-700 dark:text-red-300">{error.message}</p></div>
        <button type="button" onClick={onRetry} className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-black text-red-700 dark:bg-slate-950"><RefreshCw size={13} /> Thử lại</button>
      </div>
    )}

    {loading && !page ? (
      <div className="space-y-2" aria-label="Đang tải nhân công công trường">{Array.from({ length: 5 }, (_, index) => <div key={index} className="h-16 animate-pulse rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800" />)}</div>
    ) : !error && page ? (
      <div className="space-y-3">
        <SafetyPassportWorkerTable
          items={page.items}
          loading={loading}
          canManage={page.capabilities.canManageWorker}
          onCreateAssignment={onAssign || (() => undefined)}
          onOpenDetail={onOpenDetail || (() => undefined)}
          onEnd={onEnd || (() => undefined)}
          onIssueCard={onIssueCard || (() => undefined)}
        />
        {page.nextCursor && onLoadMore && (
          <div className="flex justify-center">
            <button type="button" disabled={loading} onClick={onLoadMore} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-black text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800">
              Xem thêm <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>
    ) : null}
  </section>
);

const SafetyActiveWorkforceView: React.FC<ScopedViewProps> = ({ scope }) => {
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [eligibilityStatus, setEligibilityStatus] = useState<SafetyPassportAssignmentStatus | ''>('');
  const [documentStatus, setDocumentStatus] = useState<'' | 'missing' | 'expired'>('');
  const [cursor, setCursor] = useState<SafetyWorkerRosterPage['nextCursor']>(null);
  const [accumulatedPage, setAccumulatedPage] = useState<SafetyWorkerRosterPage | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [endItem, setEndItem] = useState<SafetyWorkerRosterItem | null>(null);
  const [detailMembershipId, setDetailMembershipId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchDraft.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  const baseKey = `${scope.userId}|${scope.projectId}|${scope.constructionSiteId}|${search}|${eligibilityStatus}|${documentStatus}`;
  useEffect(() => {
    setCursor(null);
    setAccumulatedPage(null);
  }, [baseKey]);

  const filters = useMemo<SafetyRosterFilters>(() => ({
    limit: 50,
    assignmentStatus: 'active',
    ...(search ? { search } : {}),
    ...(eligibilityStatus ? { eligibilityStatus } : {}),
    ...(documentStatus ? { documentStatus } : {}),
    ...(cursor ? { cursor } : {}),
  }), [cursor, documentStatus, eligibilityStatus, search]);
  const state = useSafetyActiveWorkforce(scope, filters);

  useEffect(() => {
    if (!state.data) return;
    setAccumulatedPage(current => {
      if (!cursor || !current) return state.data;
      const existingIds = new Set(current.items.map(item => item.membership.id));
      return {
        ...state.data,
        items: [...current.items, ...state.data.items.filter(item => !existingIds.has(item.membership.id))],
      };
    });
  }, [cursor, state.data]);

  const completed = (): void => { void state.reload(); };
  return (
    <>
      <SafetyActiveWorkforceContent
        page={accumulatedPage || state.data}
        loading={state.loading}
        error={state.error}
        search={searchDraft}
        eligibilityStatus={eligibilityStatus}
        documentStatus={documentStatus}
        onSearchChange={setSearchDraft}
        onEligibilityStatusChange={setEligibilityStatus}
        onDocumentStatusChange={setDocumentStatus}
        onAssign={() => setAssignOpen(true)}
        onOpenDetail={item => setDetailMembershipId(item.membership.id)}
        onEnd={setEndItem}
        onIssueCard={item => setDetailMembershipId(item.membership.id)}
        onLoadMore={() => setCursor((accumulatedPage || state.data)?.nextCursor || null)}
        onRetry={() => { void state.reload(); }}
      />
      {assignOpen && <SafetyWorkerAssignmentDialog scope={scope} mode="assign" onClose={() => setAssignOpen(false)} onCompleted={completed} />}
      {endItem && <SafetyWorkerAssignmentDialog scope={scope} mode="end" item={endItem} onClose={() => setEndItem(null)} onCompleted={completed} />}
      {detailMembershipId && <SafetyPassportWorkerDetailModal scope={scope} membershipId={detailMembershipId} onClose={() => setDetailMembershipId(null)} />}
    </>
  );
};

export default SafetyActiveWorkforceView;
