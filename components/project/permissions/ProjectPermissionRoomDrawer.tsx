import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Search, Users, X } from 'lucide-react';
import type { ProjectPermissionRoomCode, ProjectRoomActionCode } from '../../../lib/permissions/projectPermissionRooms';
import { getProjectPermissionRoom } from '../../../lib/permissions/projectPermissionRooms';
import { projectPermissionRoomService, type ProjectPermissionRoomMember, type ProjectRoomStaffCandidate } from '../../../lib/projectPermissionRoomService';
import { useToast } from '../../../context/ToastContext';

interface Props {
  projectId: string;
  constructionSiteId?: string | null;
  roomCode: ProjectPermissionRoomCode;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

type DraftMembers = Record<string, ProjectRoomActionCode[]>;

const ACTION_LABELS: Record<ProjectRoomActionCode, string> = {
  view: 'Xem', edit: 'Sửa', delete: 'Xóa', submit: 'Gửi', verify: 'Kiểm tra', confirm: 'Xác nhận', approve: 'Duyệt', view_available_stock: 'Xem tồn khả dụng',
};

const ProjectPermissionRoomDrawer: React.FC<Props> = ({ projectId, constructionSiteId, roomCode, onClose, onSaved }) => {
  const toast = useToast();
  const room = getProjectPermissionRoom(roomCode)!;
  const [members, setMembers] = useState<ProjectPermissionRoomMember[]>([]);
  const [candidates, setCandidates] = useState<ProjectRoomStaffCandidate[]>([]);
  const [draftMembers, setDraftMembers] = useState<DraftMembers>({});
  const [selectedStaffIds, setSelectedStaffIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [roomMembers, roomCandidates] = await Promise.all([
        projectPermissionRoomService.getRoom(projectId, constructionSiteId, roomCode),
        projectPermissionRoomService.listCandidates(projectId, constructionSiteId, roomCode),
      ]);
      setMembers(roomMembers);
      setCandidates(roomCandidates);
      setDraftMembers(Object.fromEntries(roomMembers.map(member => [member.staffId, member.actionCodes])));
      setSelectedStaffIds(new Set());
    } catch (error: any) {
      toast.error('Không thể tải Room', error?.message);
    } finally {
      setLoading(false);
    }
  }, [constructionSiteId, projectId, roomCode, toast]);

  useEffect(() => { load(); }, [load]);

  const filteredCandidates = useMemo(() => candidates.filter(candidate =>
    !searchQuery || `${candidate.userName} ${candidate.positionName || ''}`.toLocaleLowerCase('vi-VN').includes(searchQuery.toLocaleLowerCase('vi-VN')),
  ), [candidates, searchQuery]);

  const toggleSelected = (staffId: string) => setSelectedStaffIds(current => {
    const next = new Set(current);
    next.has(staffId) ? next.delete(staffId) : next.add(staffId);
    return next;
  });

  const toggleMemberAction = (staffId: string, action: ProjectRoomActionCode) => setDraftMembers(current => {
    const actions = current[staffId] || [];
    const nextActions = actions.includes(action) ? actions.filter(item => item !== action) : [...actions, action];
    return { ...current, [staffId]: nextActions };
  });

  const applyBulkAction = (action: ProjectRoomActionCode, enabled: boolean) => setDraftMembers(current => {
    const next = { ...current };
    selectedStaffIds.forEach(staffId => {
      const actions = next[staffId] || [];
      next[staffId] = enabled ? [...new Set([...actions, action])] : actions.filter(item => item !== action);
    });
    return next;
  });

  const removeSelectedMembers = () => {
    setDraftMembers(current => {
      const next = { ...current };
      selectedStaffIds.forEach(staffId => { delete next[staffId]; });
      return next;
    });
    setSelectedStaffIds(new Set());
  };

  const save = async () => {
    setSaving(true);
    try {
      await projectPermissionRoomService.replaceMembers(projectId, constructionSiteId, roomCode,
        Object.entries(draftMembers)
          .filter(([, actionCodes]) => actionCodes.length > 0)
          .map(([staffId, actionCodes]) => ({ staffId, actionCodes })),
      );
      await onSaved();
      toast.success('Đã lưu Room', 'Quyền của các nhân viên trong Room đã được cập nhật.');
    } catch (error: any) {
      toast.error('Không thể lưu Room', error?.message);
    } finally {
      setSaving(false);
    }
  };

  const selectedCount = selectedStaffIds.size;
  const assignedCount = Object.values(draftMembers).filter(actions => actions.length > 0).length;

  return <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/35 backdrop-blur-[1px]" role="dialog" aria-modal="true" aria-label={`Phân quyền ${room.name}`}><aside className="flex h-full w-full max-w-3xl flex-col bg-white shadow-2xl dark:bg-slate-900"><header className="border-b border-slate-200 px-6 py-5 dark:border-slate-700"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Room phân quyền</p><h2 className="mt-1 text-lg font-black text-slate-900 dark:text-white">{room.name}</h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-300">{room.description} · {assignedCount} thành viên đang có quyền.</p></div><button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"><X size={18} /></button></div></header><div className="border-b border-slate-200 px-6 py-4 dark:border-slate-700"><div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Tìm nhân viên hoặc vị trí..." className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-800 dark:text-white" /></div>{selectedCount > 0 && <div className="mt-3 flex flex-wrap items-center gap-2"><span className="text-xs font-bold text-slate-600 dark:text-slate-300">Đã chọn {selectedCount}</span>{room.actions.map(action => <button key={action} type="button" onClick={() => applyBulkAction(action, true)} className="rounded-lg border border-indigo-100 bg-indigo-50 px-2 py-1 text-[10px] font-bold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200">+ {ACTION_LABELS[action]}</button>)}<button type="button" onClick={removeSelectedMembers} className="rounded-lg border border-red-100 bg-red-50 px-2 py-1 text-[10px] font-bold text-red-700 hover:bg-red-100">Gỡ khỏi Room</button></div>}</div><main className="flex-1 overflow-y-auto px-6 py-4">{loading ? <div className="space-y-3">{Array.from({ length: 5 }, (_, index) => <div key={index} className="h-24 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />)}</div> : filteredCandidates.length === 0 ? <div className="py-16 text-center"><Users size={32} className="mx-auto mb-3 text-slate-300" /><p className="text-sm font-bold text-slate-500">Không tìm thấy nhân viên phù hợp</p></div> : <div className="space-y-3">{filteredCandidates.map(candidate => { const actions = draftMembers[candidate.staffId] || []; const selected = selectedStaffIds.has(candidate.staffId); return <section key={candidate.staffId} className={`rounded-2xl border p-4 transition ${selected ? 'border-indigo-300 bg-indigo-50/50 dark:border-indigo-700 dark:bg-indigo-950/20' : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800'}`}><div className="flex items-start gap-3"><button type="button" onClick={() => toggleSelected(candidate.staffId)} aria-label={`Chọn ${candidate.userName}`} className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${selected ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900'}`}>{selected && <Check size={13} />}</button><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-sm font-black text-slate-600 dark:bg-slate-700 dark:text-slate-200">{candidate.userAvatar ? <img src={candidate.userAvatar} alt={candidate.userName} className="h-full w-full rounded-xl object-cover" /> : candidate.userName.slice(0, 1).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-black text-slate-800 dark:text-white">{candidate.userName}</p><p className="text-xs text-slate-500 dark:text-slate-300">{candidate.positionName || 'Chưa xác định vị trí'}</p><div className="mt-3 flex flex-wrap gap-2">{room.actions.map(action => <button key={action} type="button" onClick={() => toggleMemberAction(candidate.staffId, action)} className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-bold transition ${actions.includes(action) ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:text-indigo-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200'}`}>{ACTION_LABELS[action]}</button>)}</div></div></div></section>; })}</div>}</main><footer className="flex items-center justify-between border-t border-slate-200 px-6 py-4 dark:border-slate-700"><p className="text-xs text-slate-500 dark:text-slate-300">Các thay đổi chỉ được ghi khi bấm lưu.</p><div className="flex gap-2"><button type="button" onClick={onClose} disabled={saving} className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200">Hủy thay đổi</button><button type="button" onClick={save} disabled={saving || loading} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-black text-white shadow-sm shadow-indigo-500/25 hover:bg-indigo-700 disabled:opacity-50 active:scale-[0.98]">{saving ? 'Đang lưu...' : 'Lưu thay đổi'}</button></div></footer></aside></div>;
};

export default ProjectPermissionRoomDrawer;
