import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Globe2, Lock, RefreshCw, Search, UserPlus, Wallet, FileSignature } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { useToast } from '../../../context/ToastContext';
import ReasonConfirmModal from '../../ReasonConfirmModal';
import SearchableSelect from '../../common/SearchableSelect';
import { getApiErrorMessage } from '../../../lib/apiError';
import {
  projectSensitiveAccessService,
  type SensitiveViewAccessRow,
  type SensitiveViewDomain,
} from '../../../lib/projectSensitiveAccessService';
import type { User } from '../../../types';

interface Props {
  projectId: string;
}

const DOMAIN_LABEL: Record<SensitiveViewDomain, string> = { finance: 'Tài chính', contract: 'Hợp đồng' };

type Filter = 'all' | 'viewing' | 'not_viewing';

interface PendingChange {
  row: SensitiveViewAccessRow;
  domain: SensitiveViewDomain;
  enabled: boolean;
  allProjects: boolean;
}

const emptyRow = (user: User, inProject: boolean): SensitiveViewAccessRow => ({
  userId: user.id,
  userName: user.name,
  userEmail: user.email,
  userAvatar: user.avatar || null,
  isSystemAdmin: false,
  inProject,
  financeProject: false,
  contractProject: false,
  financeAll: false,
  contractAll: false,
  financeRoom: false,
  contractManager: false,
});

/** Why a switch is on without a project-level grant; null means it is editable. */
export const inheritedReason = (row: SensitiveViewAccessRow, domain: SensitiveViewDomain, allProjects: boolean): string | null => {
  if (row.isSystemAdmin) return 'Admin hệ thống';
  if (allProjects) return domain === 'contract' && row.contractManager ? 'Quản trị hợp đồng' : null;
  if (domain === 'finance' ? row.financeAll : row.contractAll) return 'Tất cả dự án';
  if (row.financeRoom) return 'Xử lý thanh toán / nghiệm thu';
  if (domain === 'contract' && row.contractManager) return 'Quản trị hợp đồng';
  return null;
};

export const isOn = (row: SensitiveViewAccessRow, domain: SensitiveViewDomain, allProjects: boolean): boolean => {
  if (inheritedReason(row, domain, allProjects)) return true;
  if (allProjects) return domain === 'finance' ? row.financeAll : row.contractAll;
  return domain === 'finance' ? row.financeProject : row.contractProject;
};

const Avatar: React.FC<{ row: SensitiveViewAccessRow }> = ({ row }) => (row.userAvatar
  ? <img src={row.userAvatar} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
  : <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-black text-white">{(row.userName || '?').slice(0, 1).toUpperCase()}</span>);

const Switch: React.FC<{
  checked: boolean;
  label: string;
  lockedReason: string | null;
  disabled: boolean;
  onToggle: () => void;
}> = ({ checked, label, lockedReason, disabled, onToggle }) => (
  <div className="flex min-w-0 flex-col items-start gap-1">
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled || Boolean(lockedReason)}
      onClick={onToggle}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed ${checked ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'} ${lockedReason ? 'opacity-60' : ''}`}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
    {lockedReason && <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400"><Lock size={10} />{lockedReason}</span>}
  </div>
);

const AccessList: React.FC<{
  rows: SensitiveViewAccessRow[];
  allProjects: boolean;
  busy: boolean;
  onToggle: (row: SensitiveViewAccessRow, domain: SensitiveViewDomain) => void;
}> = ({ rows, allProjects, busy, onToggle }) => (
  <ul className="divide-y divide-slate-100 dark:divide-slate-700">
    {rows.map(row => (
      <li key={row.userId} className="grid grid-cols-1 gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_150px_150px] sm:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar row={row} />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-800 dark:text-white">{row.userName || 'Chưa có tên'}</p>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
              {row.userEmail}
              {!allProjects && !row.inProject && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-slate-700 dark:text-slate-300">Ngoài dự án</span>}
            </p>
          </div>
        </div>
        {(['finance', 'contract'] as SensitiveViewDomain[]).map(domain => (
          <div key={domain} className="flex items-center gap-2 sm:block">
            <span className="w-20 text-xs font-semibold text-slate-500 sm:hidden">{DOMAIN_LABEL[domain]}</span>
            <Switch
              checked={isOn(row, domain, allProjects)}
              label={`${DOMAIN_LABEL[domain]} — ${row.userName}`}
              lockedReason={inheritedReason(row, domain, allProjects)}
              disabled={busy}
              onToggle={() => onToggle(row, domain)}
            />
          </div>
        ))}
      </li>
    ))}
  </ul>
);

const ProjectSensitiveAccessPanel: React.FC<Props> = ({ projectId }) => {
  const { users } = useApp();
  const toast = useToast();
  const [projectRows, setProjectRows] = useState<SensitiveViewAccessRow[]>([]);
  const [allProjectRows, setAllProjectRows] = useState<SensitiveViewAccessRow[]>([]);
  const [addedProjectRows, setAddedProjectRows] = useState<SensitiveViewAccessRow[]>([]);
  const [addedAllRows, setAddedAllRows] = useState<SensitiveViewAccessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [projectData, allData] = await Promise.all([
        projectSensitiveAccessService.list(projectId),
        projectSensitiveAccessService.list(null),
      ]);
      setProjectRows(projectData);
      setAllProjectRows(allData.filter(row => row.financeAll || row.contractAll));
    } catch (loadError) {
      setError(getApiErrorMessage(loadError, 'Không tải được danh sách quyền xem.'));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setAddedProjectRows([]); setAddedAllRows([]); }, [projectId]);

  const mergedProjectRows = useMemo(() => {
    const known = new Set(projectRows.map(row => row.userId));
    return [...projectRows, ...addedProjectRows.filter(row => !known.has(row.userId))];
  }, [addedProjectRows, projectRows]);

  const mergedAllRows = useMemo(() => {
    const known = new Set(allProjectRows.map(row => row.userId));
    return [...allProjectRows, ...addedAllRows.filter(row => !known.has(row.userId))];
  }, [addedAllRows, allProjectRows]);

  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('vi-VN');
    return mergedProjectRows.filter(row => {
      const viewing = isOn(row, 'finance', false) || isOn(row, 'contract', false);
      if (filter === 'viewing' && !viewing) return false;
      if (filter === 'not_viewing' && viewing) return false;
      return !normalized || `${row.userName} ${row.userEmail}`.toLocaleLowerCase('vi-VN').includes(normalized);
    });
  }, [filter, mergedProjectRows, query]);

  const counts = useMemo(() => ({
    finance: mergedProjectRows.filter(row => isOn(row, 'finance', false)).length,
    contract: mergedProjectRows.filter(row => isOn(row, 'contract', false)).length,
  }), [mergedProjectRows]);

  const candidateUsers = useCallback((excluded: SensitiveViewAccessRow[]) => {
    const taken = new Set(excluded.map(row => row.userId));
    return users.filter(candidate => candidate.isActive !== false && !taken.has(candidate.id));
  }, [users]);

  const requestToggle = (row: SensitiveViewAccessRow, domain: SensitiveViewDomain, allProjects: boolean) => {
    setPending({ row, domain, enabled: !isOn(row, domain, allProjects), allProjects });
  };

  const confirmToggle = async (reason: string) => {
    if (!pending) return;
    if (reason.trim().length < 10) {
      toast.warning('Lý do quá ngắn', 'Nhập ít nhất 10 ký tự để lưu lịch sử thay đổi quyền.');
      return;
    }
    setSaving(true);
    try {
      await projectSensitiveAccessService.setGrant({
        userId: pending.row.userId,
        projectId: pending.allProjects ? null : projectId,
        domain: pending.domain,
        enabled: pending.enabled,
        reason,
      });
      toast.success(
        pending.enabled ? 'Đã mở quyền xem' : 'Đã tắt quyền xem',
        `${DOMAIN_LABEL[pending.domain]} · ${pending.row.userName}${pending.allProjects ? ' · tất cả dự án' : ''}`,
      );
      setPending(null);
      await load();
    } catch (saveError) {
      toast.error('Chưa lưu được thay đổi', getApiErrorMessage(saveError, 'Máy chủ từ chối thao tác.'));
    } finally {
      setSaving(false);
    }
  };

  const filterButton = (value: Filter, label: string) => (
    <button
      type="button"
      onClick={() => setFilter(value)}
      className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${filter === value ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 dark:bg-slate-900 dark:text-slate-200'}`}
    >{label}</button>
  );

  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-indigo-600"><Wallet size={16} /><span className="text-[10px] font-black uppercase tracking-widest">Dữ liệu nhạy cảm</span></div>
        <h2 className="mt-1 text-lg font-black text-slate-900 dark:text-white">Ai được xem Tài chính & Hợp đồng</h2>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500 dark:text-slate-300">
          Người chưa được bật sẽ không thấy dòng tiền, chi phí, tạm ứng và hợp đồng của dự án này.
          Admin, người xử lý chứng từ trong Room Thanh toán / Nghiệm thu và người được mở "Tất cả dự án" luôn xem được. Người chỉ có quyền Xem trong Room vẫn cần bật ở đây.
        </p>
      </div>
      <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Tải lại
      </button>
    </div>

    {loading ? (
      <div className="space-y-2">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-14 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-700" />)}</div>
    ) : error ? (
      <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-center">
        <p className="text-sm font-bold text-red-800">Không tải được danh sách quyền xem</p>
        <p className="mt-1 text-xs text-red-700">{error}</p>
        <button type="button" onClick={load} className="mt-3 rounded-xl bg-red-700 px-3 py-2 text-xs font-black text-white hover:bg-red-800">Thử lại</button>
      </div>
    ) : (
      <>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/20">
            <p className="flex items-center gap-1.5 text-[10px] font-black uppercase text-emerald-700 dark:text-emerald-300"><Wallet size={12} />Xem tài chính</p>
            <p className="mt-1 text-xl font-black text-emerald-800 dark:text-emerald-200">{counts.finance} <span className="text-xs font-bold">người</span></p>
          </div>
          <div className="rounded-xl border border-sky-100 bg-sky-50/70 p-3 dark:border-sky-900/50 dark:bg-sky-950/20">
            <p className="flex items-center gap-1.5 text-[10px] font-black uppercase text-sky-700 dark:text-sky-300"><FileSignature size={12} />Xem hợp đồng</p>
            <p className="mt-1 text-xl font-black text-sky-800 dark:text-sky-200">{counts.contract} <span className="text-xs font-bold">người</span></p>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-900/40 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {filterButton('all', 'Tất cả')}
            {filterButton('viewing', 'Đang được xem')}
            {filterButton('not_viewing', 'Chưa được xem')}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-56">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm người..." className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
            </div>
            <div className="w-full sm:w-64">
              <SearchableSelect<User>
                value={null}
                options={candidateUsers(mergedProjectRows)}
                onChange={candidate => candidate && setAddedProjectRows(current => [...current, emptyRow(candidate, false)])}
                getOptionValue={candidate => candidate.id}
                getOptionLabel={candidate => candidate.name}
                getOptionSearchText={candidate => `${candidate.name} ${candidate.email}`}
                placeholder="Thêm người ngoài dự án..."
                emptyLabel="Không còn người phù hợp"
              />
            </div>
          </div>
        </div>

        <div className="hidden grid-cols-[minmax(0,1fr)_150px_150px] px-1 text-[10px] font-black uppercase tracking-wider text-slate-400 sm:grid">
          <span>Người</span><span>Tài chính</span><span>Hợp đồng</span>
        </div>
        {visibleRows.length > 0
          ? <AccessList rows={visibleRows} allProjects={false} busy={saving} onToggle={(row, domain) => requestToggle(row, domain, false)} />
          : <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
              {mergedProjectRows.length === 0
                ? <><UserPlus size={20} className="mx-auto mb-2 text-slate-400" />Dự án chưa có nhân sự. Dùng ô "Thêm người" để cấp quyền xem.</>
                : 'Không có người phù hợp với bộ lọc.'}
            </div>}

        <details className="group rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm font-black text-slate-800 dark:text-white"><Globe2 size={16} className="text-indigo-600" />Xem tất cả dự án</span>
            <span className="text-xs font-bold text-slate-500">{mergedAllRows.length} người</span>
          </summary>
          <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-300">Dành cho Ban lãnh đạo, Kế toán trưởng… Bật ở đây có hiệu lực với mọi dự án.</p>
          <div className="mt-3 w-full sm:w-72">
            <SearchableSelect<User>
              value={null}
              options={candidateUsers(mergedAllRows)}
              onChange={candidate => candidate && setAddedAllRows(current => [...current, emptyRow(candidate, false)])}
              getOptionValue={candidate => candidate.id}
              getOptionLabel={candidate => candidate.name}
              getOptionSearchText={candidate => `${candidate.name} ${candidate.email}`}
              placeholder="Thêm người xem tất cả dự án..."
              emptyLabel="Không còn người phù hợp"
            />
          </div>
          {mergedAllRows.length > 0
            ? <AccessList rows={mergedAllRows} allProjects busy={saving} onToggle={(row, domain) => requestToggle(row, domain, true)} />
            : <p className="mt-3 text-xs text-slate-500">Chưa có ai được xem tất cả dự án.</p>}
        </details>
      </>
    )}

    <ReasonConfirmModal
      isOpen={Boolean(pending)}
      onClose={() => { if (!saving) setPending(null); }}
      onConfirm={confirmToggle}
      title={pending?.enabled ? 'Mở quyền xem' : 'Tắt quyền xem'}
      targetName={pending ? `${DOMAIN_LABEL[pending.domain]} · ${pending.row.userName}` : ''}
      subtitle={pending?.allProjects ? 'Áp dụng cho tất cả dự án' : 'Áp dụng cho dự án này'}
      warningText={pending?.enabled
        ? 'Người này sẽ xem được số liệu nhạy cảm. Thay đổi được ghi lịch sử kèm lý do.'
        : 'Người này sẽ không còn thấy số liệu nhạy cảm. Thay đổi được ghi lịch sử kèm lý do.'}
      reasonLabel="Lý do (tối thiểu 10 ký tự)"
      reasonPlaceholder="Ví dụ: Kế toán dự án phụ trách thanh toán"
      actionLabel={pending?.enabled ? 'Mở quyền' : 'Tắt quyền'}
      intent={pending?.enabled ? 'success' : 'warning'}
      countdownSeconds={0}
      isSubmitting={saving}
    />
  </section>;
};

export default ProjectSensitiveAccessPanel;
