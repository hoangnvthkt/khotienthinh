import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, ShieldCheck } from 'lucide-react';
import type { ProjectPermissionRoomCode } from '../../../lib/permissions/projectPermissionRooms';
import { projectPermissionRoomService, type ProjectPermissionRoomSummary } from '../../../lib/projectPermissionRoomService';
import ProjectPermissionRoomCard from './ProjectPermissionRoomCard';
import ProjectPermissionRoomDrawer from './ProjectPermissionRoomDrawer';

interface Props {
  projectId: string;
  constructionSiteId?: string | null;
}

const GROUP_LABELS: Record<string, string> = { all: 'Tất cả', daily_log: 'Nhật ký', material: 'Vật tư', progress: 'Tiến độ', finance: 'Tài chính', quality: 'Chất lượng', safety: 'An toàn', subcontract: 'Nhà thầu' };

const ProjectPermissionRoomsPanel: React.FC<Props> = ({ projectId, constructionSiteId }) => {
  const [rooms, setRooms] = useState<ProjectPermissionRoomSummary[]>([]);
  const [selectedRoomCode, setSelectedRoomCode] = useState<ProjectPermissionRoomCode | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRooms = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRooms(await projectPermissionRoomService.listRooms(projectId, constructionSiteId));
    } catch (loadError: any) {
      setError(loadError?.message || 'Không thể tải danh sách Room.');
    } finally {
      setLoading(false);
    }
  }, [constructionSiteId, projectId]);

  useEffect(() => { loadRooms(); }, [loadRooms]);

  const groups = useMemo(() => ['all', ...new Set(rooms.map(room => room.groupCode))], [rooms]);
  const visibleRooms = useMemo(() => rooms.filter(room => {
    const matchesGroup = selectedGroup === 'all' || room.groupCode === selectedGroup;
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase('vi-VN');
    return matchesGroup && (!normalizedQuery || `${room.roomName} ${room.description}`.toLocaleLowerCase('vi-VN').includes(normalizedQuery));
  }), [rooms, searchQuery, selectedGroup]);

  return <div className="space-y-6"><div className="flex flex-wrap items-end justify-between gap-4"><div><div className="flex items-center gap-2 text-indigo-600"><ShieldCheck size={16} /><span className="text-[10px] font-black uppercase tracking-widest">Phân quyền theo Room</span></div><h2 className="mt-1 text-xl font-black tracking-tight text-slate-900 dark:text-white">Đúng người, đúng nghiệp vụ</h2><p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-300">Mỗi Room tách riêng người xử lý theo luồng công việc. Quyền “Duyệt” PO sẽ không xuất hiện trong Nhật ký công trường.</p></div><button type="button" onClick={loadRooms} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Tải lại</button></div><div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-800/60"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div className="flex flex-wrap gap-1.5">{groups.map(group => <button key={group} type="button" onClick={() => setSelectedGroup(group)} className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${selectedGroup === group ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 dark:bg-slate-900 dark:text-slate-200'}`}>{GROUP_LABELS[group] || group}</button>)}</div><div className="relative w-full lg:max-w-xs"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Tìm Room..." className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></div></div></div>{loading ? <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <div key={index} className="h-56 animate-pulse rounded-2xl border border-slate-100 bg-slate-50 dark:border-slate-700 dark:bg-slate-800" />)}</div> : error ? <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center"><p className="text-sm font-bold text-red-800">Không tải được Room phân quyền</p><p className="mt-1 text-xs text-red-700">{error}</p><button type="button" onClick={loadRooms} className="mt-4 rounded-xl bg-red-700 px-3 py-2 text-xs font-black text-white hover:bg-red-800">Thử lại</button></div> : visibleRooms.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-200 p-12 text-center text-sm font-medium text-slate-500 dark:border-slate-700">Không có Room phù hợp với bộ lọc hiện tại.</div> : <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{visibleRooms.map(room => <ProjectPermissionRoomCard key={room.roomCode} room={room} onOpen={setSelectedRoomCode} />)}</div>}{selectedRoomCode && <ProjectPermissionRoomDrawer projectId={projectId} constructionSiteId={constructionSiteId} roomCode={selectedRoomCode} onClose={() => setSelectedRoomCode(null)} onSaved={async () => { await loadRooms(); setSelectedRoomCode(null); }} />}</div>;
};

export default ProjectPermissionRoomsPanel;
