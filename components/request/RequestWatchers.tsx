import React, { useState } from 'react';
import { Eye, Loader2, Plus, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { mapRequestRpcError, requestRuntimeService, type RequestDetail } from '../../lib/requestRuntimeService';
import UserSearchSelect from '../common/UserSearchSelect';

export const RequestWatchers: React.FC<{ detail: RequestDetail; onChanged: () => Promise<void> }> = ({ detail, onChanged }) => {
  const { users, user } = useApp();
  const toast = useToast();
  const [isAdding, setIsAdding] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const excluded = [detail.creator.id, ...detail.watchers.map(watcher => watcher.id)];

  const add = async () => {
    if (!selected.length) return;
    setBusyId('add'); setError(null);
    try {
      await requestRuntimeService.addWatchers(detail.id, selected);
      toast.success('Đã thêm người theo dõi', `${selected.length} người sẽ nhận thông báo và xem được đề xuất.`);
      setSelected([]); setIsAdding(false);
      await onChanged();
    } catch (cause) {
      setError(mapRequestRpcError(cause).message);
    } finally { setBusyId(null); }
  };

  const remove = async (userId: string) => {
    setBusyId(userId); setError(null);
    try {
      await requestRuntimeService.removeWatcher(detail.id, userId);
      toast.success(userId === user.id ? 'Đã bỏ theo dõi' : 'Đã bỏ người theo dõi');
      await onChanged();
    } catch (cause) {
      setError(mapRequestRpcError(cause).message);
    } finally { setBusyId(null); }
  };

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/90">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
          <Eye size={14} /> Người theo dõi ({detail.watchers.length})
        </h3>
        {detail.capabilities.canAddWatcher && !isAdding && (
          <button type="button" onClick={() => setIsAdding(true)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-mint-700 hover:bg-mint-50 dark:text-mint-300 dark:hover:bg-mint-900/40">
            <Plus size={14} /> Thêm
          </button>
        )}
      </div>

      {error && <p className="mb-2 rounded-lg bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{error}</p>}

      {isAdding && (
        <div className="mb-3 space-y-2 rounded-xl border border-slate-200 p-2.5 dark:border-slate-700">
          <UserSearchSelect users={users} multiple values={selected} onValuesChange={setSelected} excludeUserIds={excluded} placeholder="Gõ tên để thêm người theo dõi..." />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setIsAdding(false); setSelected([]); }} disabled={busyId === 'add'} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Hủy</button>
            <button type="button" onClick={() => void add()} disabled={!selected.length || busyId === 'add'} className="inline-flex items-center gap-1.5 rounded-lg bg-leaf-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-leaf-700 disabled:opacity-50">
              {busyId === 'add' && <Loader2 size={13} className="animate-spin" />} Thêm {selected.length > 0 ? `(${selected.length})` : ''}
            </button>
          </div>
        </div>
      )}

      {detail.watchers.length === 0 ? (
        <p className="text-xs text-slate-400">Chưa có người theo dõi.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {detail.watchers.map(watcher => (
            <li key={watcher.id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-0.5 pl-2.5 pr-1 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200" title={watcher.source === 'TEMPLATE' ? 'Theo dõi cố định theo mẫu' : undefined}>
              <span className="truncate">{watcher.id === user.id ? 'Bạn' : watcher.name}</span>
              {watcher.source === 'TEMPLATE' && <span className="text-[10px] text-slate-400">· mẫu</span>}
              {watcher.canRemove ? (
                <button type="button" onClick={() => void remove(watcher.id)} disabled={busyId === watcher.id} aria-label={`Bỏ theo dõi ${watcher.name}`} className="rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-rose-600 dark:hover:bg-slate-700">
                  {busyId === watcher.id ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                </button>
              ) : <span className="w-1" />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
