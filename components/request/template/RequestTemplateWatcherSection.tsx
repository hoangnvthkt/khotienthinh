import React from 'react';
import { Eye, X } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import type { RequestTemplateDraftAction } from '../../../lib/requestTemplateEditorModel';

interface Props { watcherIds: string[]; dispatch: (action: RequestTemplateDraftAction) => void; }

const RequestTemplateWatcherSection: React.FC<Props> = ({ watcherIds, dispatch }) => {
  const { users } = useApp();
  const selected = users.filter(user => watcherIds.includes(user.id));
  const remaining = users.filter(user => !watcherIds.includes(user.id));
  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"><header className="border-b border-slate-200 px-5 py-4 dark:border-slate-700"><h2 className="flex items-center gap-2 text-lg font-bold text-slate-800 dark:text-white"><Eye size={19} className="text-accent" /> Người theo dõi</h2><p className="mt-1 text-sm text-slate-500">Người theo dõi cố định có thể xem đề xuất và nhận báo cáo liên quan.</p></header><div className="space-y-4 p-5"><div className="flex flex-wrap gap-2">{selected.length === 0 ? <span className="text-sm text-slate-400">Chưa có người theo dõi cố định.</span> : selected.map(user => <span key={user.id} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-bold text-emerald-700 dark:bg-emerald-900/25 dark:text-emerald-300">{user.name}<button type="button" aria-label={`Bỏ ${user.name} khỏi người theo dõi`} onClick={() => dispatch({ type: 'SET_WATCHERS', userIds: watcherIds.filter(id => id !== user.id) })}><X size={14} /></button></span>)}</div><label className="block max-w-lg"><span className="mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-200">Thêm người theo dõi</span><select value="" onChange={event => { if (event.target.value) dispatch({ type: 'SET_WATCHERS', userIds: [...watcherIds, event.target.value] }); }} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent dark:border-slate-700 dark:bg-slate-800"><option value="">Chọn nhân viên</option>{remaining.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label><p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/70">Người tạo và người duyệt được runtime cấp quyền qua vai trò tham gia; không cần thêm vào đây.</p></div></section>;
};

export default RequestTemplateWatcherSection;
