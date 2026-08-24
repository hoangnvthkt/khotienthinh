import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight, Eye, Plus, RefreshCw, Search, UserRound } from 'lucide-react';
import type { SafetyMembershipStatus, SafetyWorkerRosterPage, User } from '../../../../types';
import type { SafetyWorkforceRequestScope } from '../../../../lib/safetyWorkforceApi';
import { useSafetyRoster, useSafetyWorkforceOptions } from '../../../../hooks/useSafetyWorkforce';
import SafetyWorkerProfileForm from './SafetyWorkerProfileForm';
import SafetyPassportWorkerDetailModal from '../SafetyPassportWorkerDetailModal';

interface ScopedViewProps {
  scope: SafetyWorkforceRequestScope;
  currentUser: User;
}

interface RosterContentProps {
  page: SafetyWorkerRosterPage | null;
  loading: boolean;
  error: { message: string } | null;
  onRetry: () => void;
  search?: string;
  membershipStatus?: SafetyMembershipStatus | '';
  onSearchChange?: (value: string) => void;
  onMembershipStatusChange?: (value: SafetyMembershipStatus | '') => void;
  onCreate?: () => void;
  onOpen?: (membershipId: string) => void;
  onLoadMore?: () => void;
}

const membershipLabel = (status: string): string => {
  if (status === 'active') return 'Đang tham gia';
  if (status === 'candidate') return 'Chờ gán';
  return 'Đã rời công trường';
};

export const SafetyWorkerRosterContent: React.FC<RosterContentProps> = ({
  page,
  loading,
  error,
  onRetry,
  search = '',
  membershipStatus = '',
  onSearchChange,
  onMembershipStatusChange,
  onCreate,
  onOpen,
  onLoadMore,
}) => {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-black text-slate-900 dark:text-slate-100">Hồ sơ nhân công</h2>
          <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">Hồ sơ gốc và trạng thái tại công trường đang chọn.</p>
        </div>
        {page?.capabilities.canManageWorker && (
          <button type="button" onClick={onCreate} className="inline-flex min-h-9 items-center gap-2 whitespace-nowrap rounded-lg bg-slate-900 px-3 text-xs font-black text-white active:translate-y-px dark:bg-slate-100 dark:text-slate-900">
            <Plus size={14} /> Tạo hồ sơ
          </button>
        )}
      </div>

      {(onSearchChange || onMembershipStatusChange) && (
        <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-[minmax(0,1fr)_200px] dark:border-slate-800 dark:bg-slate-900">
          <label className="relative block">
            <span className="sr-only">Tìm hồ sơ nhân công</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
            <input
              value={search}
              onChange={event => onSearchChange?.(event.target.value)}
              className="min-h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs font-semibold text-slate-800 outline-none focus:border-orange-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              placeholder="Tìm theo mã, tên, điện thoại"
            />
          </label>
          <label>
            <span className="sr-only">Lọc trạng thái hồ sơ tại công trường</span>
            <select
              value={membershipStatus}
              onChange={event => onMembershipStatusChange?.(event.target.value as SafetyMembershipStatus | '')}
              className="min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none focus:border-orange-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
            >
              <option value="">Tất cả trạng thái</option>
              <option value="candidate">Chờ gán</option>
              <option value="active">Đang tham gia</option>
              <option value="inactive">Đã rời công trường</option>
            </select>
          </label>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900/60 dark:bg-red-950/20">
          <AlertTriangle className="mt-0.5 text-red-600" size={17} />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-black text-red-900 dark:text-red-200">Không tải được hồ sơ nhân công</div>
            <p className="mt-1 text-xs text-red-700 dark:text-red-300">{error.message}</p>
          </div>
          <button type="button" onClick={onRetry} className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-black text-red-700 active:translate-y-px dark:bg-slate-950">
            <RefreshCw size={13} /> Thử lại
          </button>
        </div>
      )}

      {loading && !page ? (
        <div className="space-y-2" aria-label="Đang tải hồ sơ nhân công">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="h-16 animate-pulse rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800" />
          ))}
        </div>
      ) : !error && (page?.items.length || 0) === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center dark:border-slate-700 dark:bg-slate-900">
          <UserRound className="mx-auto text-slate-400" size={22} />
          <h3 className="mt-3 text-sm font-black text-slate-800 dark:text-slate-100">Chưa có hồ sơ nhân công</h3>
          <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">Tạo hồ sơ gốc để sẵn sàng gán vào công trường.</p>
        </div>
      ) : !error && page ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3 font-black">Nhân công</th>
                <th className="px-4 py-3 font-black">Nhà thầu / Tổ đội</th>
                <th className="px-4 py-3 font-black">Điện thoại</th>
                <th className="px-4 py-3 font-black">Hồ sơ</th>
                <th className="px-4 py-3 font-black">Phân công hiện tại</th>
                <th className="px-4 py-3 font-black">Trạng thái</th>
                {onOpen && <th className="w-12 px-4 py-3"><span className="sr-only">Thao tác</span></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {page.items.map(item => (
                <tr key={item.membership.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                        {item.worker.photoUrl
                          ? <img src={item.worker.photoUrl} alt={`Ảnh ${item.worker.fullName}`} className="h-full w-full object-cover" />
                          : <div className="flex h-full items-center justify-center font-black text-slate-400">{item.worker.fullName.slice(0, 1)}</div>}
                      </div>
                      <div>
                        <div className="font-black text-slate-800 dark:text-slate-100">{item.worker.fullName}</div>
                        <div className="mt-0.5 font-mono text-[11px] font-bold text-orange-700 dark:text-orange-300">{item.worker.workerCode}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-600 dark:text-slate-300">{item.team?.name || item.subcontractor?.name || 'Cán bộ công ty'}</td>
                  <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-300">{item.worker.phone || '-'}</td>
                  <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-300">{item.identityNumberMasked}</td>
                  <td className="px-4 py-3 font-medium text-slate-600 dark:text-slate-300">{item.activeAssignment ? 'Đang làm tại công trường' : 'Chưa gán'}</td>
                  <td className="px-4 py-3"><span className="rounded-md bg-slate-100 px-2 py-1 font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{membershipLabel(item.membership.status)}</span></td>
                  {onOpen && (
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => onOpen(item.membership.id)} aria-label={`Xem hồ sơ ${item.worker.fullName}`} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-orange-600 dark:hover:bg-slate-800"><Eye size={15} /></button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {page.nextCursor && onLoadMore && (
            <div className="flex justify-center border-t border-slate-100 p-3 dark:border-slate-800">
              <button type="button" disabled={loading} onClick={onLoadMore} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-black text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800">
                Xem thêm <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
};

const SafetyWorkerRosterView: React.FC<ScopedViewProps> = ({ scope }) => {
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [membershipStatus, setMembershipStatus] = useState<SafetyMembershipStatus | ''>('');
  const [cursor, setCursor] = useState<SafetyWorkerRosterPage['nextCursor']>(null);
  const [accumulatedPage, setAccumulatedPage] = useState<SafetyWorkerRosterPage | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedMembershipId, setSelectedMembershipId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchDraft.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  const baseKey = `${scope.userId}|${scope.projectId}|${scope.constructionSiteId}|${search}|${membershipStatus}`;
  useEffect(() => {
    setCursor(null);
    setAccumulatedPage(null);
  }, [baseKey]);

  const filters = useMemo(() => ({
    limit: 50,
    ...(search ? { search } : {}),
    ...(membershipStatus ? { membershipStatus } : {}),
    ...(cursor ? { cursor } : {}),
  }), [cursor, membershipStatus, search]);

  const state = useSafetyRoster(scope, filters);
  const optionsState = useSafetyWorkforceOptions(scope, createOpen);

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

  return (
    <>
      <SafetyWorkerRosterContent
        page={accumulatedPage || state.data}
        loading={state.loading}
        error={state.error}
        search={searchDraft}
        membershipStatus={membershipStatus}
        onSearchChange={setSearchDraft}
        onMembershipStatusChange={setMembershipStatus}
        onCreate={() => setCreateOpen(true)}
        onOpen={setSelectedMembershipId}
        onLoadMore={() => setCursor((accumulatedPage || state.data)?.nextCursor || null)}
        onRetry={() => { void state.reload(); }}
      />
      {createOpen && (
        <SafetyWorkerProfileForm
          scope={scope}
          options={optionsState.data}
          optionsLoading={optionsState.loading}
          onClose={() => setCreateOpen(false)}
          onCreated={() => { void state.reload(); }}
        />
      )}
      {selectedMembershipId && (
        <SafetyPassportWorkerDetailModal
          scope={scope}
          membershipId={selectedMembershipId}
          onClose={() => setSelectedMembershipId(null)}
        />
      )}
    </>
  );
};

export default SafetyWorkerRosterView;
