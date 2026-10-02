import React, { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Search, Users } from 'lucide-react';
import {
  getProjectPermissionRoomActionLabel,
  type ProjectPermissionRoomCode,
  type ProjectRoomActionCode,
} from '../../../lib/permissions/projectPermissionRooms';
import type { ProjectPermissionRoomOverview } from '../../../lib/projectPermissionRoomService';

interface Props {
  overview: ProjectPermissionRoomOverview;
  /** Project members who can hold Rooms now (still on the project, account active). */
  eligibleStaffIds: ReadonlySet<string>;
  /** Opens the person in the editor above. */
  onEditPerson: (staffId: string) => void;
  /** Removes a leftover entry (person no longer on the project or account locked). */
  onRemoveStale: (roomCode: ProjectPermissionRoomCode, staffId: string) => void;
}

const GROUP_LABELS: Record<string, string> = {
  all: 'Tất cả', daily_log: 'Nhật ký', material: 'Vật tư', progress: 'Tiến độ', finance: 'Tài chính',
  quality: 'Chất lượng', safety: 'An toàn', subcontract: 'Nhà thầu',
};

const avatarColor = (value: string) => ['bg-indigo-600', 'bg-sky-600', 'bg-emerald-600', 'bg-amber-600', 'bg-rose-600'][value.charCodeAt(0) % 5];

// Room-by-Room view of who holds what in this project. Read-only: people are changed in the
// editor above, so one place decides what a person may do.
const ProjectRoomOverview: React.FC<Props> = ({ overview, eligibleStaffIds, onEditPerson, onRemoveStale }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('all');
  const [openRoom, setOpenRoom] = useState<ProjectPermissionRoomCode | null>(null);

  const groups = useMemo(() => ['all', ...new Set(overview.rooms.map(room => room.groupCode))], [overview.rooms]);
  // Only people who can still act count: a Room whose only approver left must show as missing.
  const stats = useMemo(() => new Map(overview.rooms.map(room => {
    const members = overview.membersByRoom[room.roomCode] || [];
    const active = members.filter(member => eligibleStaffIds.has(member.staffId));
    const actionCounts: Partial<Record<ProjectRoomActionCode, number>> = {};
    active.forEach(member => member.actionCodes.forEach(action => { actionCounts[action] = (actionCounts[action] || 0) + 1; }));
    return [room.roomCode, {
      active,
      stale: members.filter(member => !eligibleStaffIds.has(member.staffId)),
      actionCounts,
      missingRequiredActions: room.requiredActions.filter(action => !actionCounts[action]),
    }];
  })), [overview, eligibleStaffIds]);
  const missing = overview.rooms
    .map(room => ({ room, missingRequiredActions: stats.get(room.roomCode)?.missingRequiredActions || [] }))
    .filter(item => item.missingRequiredActions.length > 0);
  const visibleRooms = useMemo(() => overview.rooms.filter(room => {
    const query = searchQuery.trim().toLocaleLowerCase('vi-VN');
    return (selectedGroup === 'all' || room.groupCode === selectedGroup)
      && (!query || `${room.roomName} ${room.description}`.toLocaleLowerCase('vi-VN').includes(query));
  }), [overview.rooms, searchQuery, selectedGroup]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-base font-black text-slate-900 dark:text-white">Ai đang có quyền trong từng Room</h3>
          <p className="text-xs text-slate-500 dark:text-slate-300">Bấm một Room để xem người và quyền; chọn “Sửa quyền” để chỉnh cho người đó.</p>
        </div>
      </div>

      {missing.length > 0 && (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-bold text-amber-800">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Chưa có người {missing.map(({ room, missingRequiredActions }) => `${missingRequiredActions.map(action => getProjectPermissionRoomActionLabel(room.roomCode, action).toLocaleLowerCase('vi-VN')).join(', ')} (${room.roomName})`).join('; ')}.
          </span>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-800/60">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {groups.map(group => (
              <button key={group} type="button" onClick={() => setSelectedGroup(group)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${selectedGroup === group ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 dark:bg-slate-900 dark:text-slate-200'}`}>
                {GROUP_LABELS[group] || group}
              </button>
            ))}
          </div>
          <div className="relative w-full lg:max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Tìm Room..."
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
          </div>
        </div>
      </div>

      {visibleRooms.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-sm font-medium text-slate-500 dark:border-slate-700">
          Không có Room phù hợp với bộ lọc hiện tại.
        </div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleRooms.map(room => {
            const roomStats = stats.get(room.roomCode)!;
            const members = [...roomStats.active, ...roomStats.stale];
            const open = openRoom === room.roomCode;
            const primaryActionCodes: ProjectRoomActionCode[] = room.roomCode === 'weekly_progress' ? ['edit', 'confirm'] : ['approve', 'confirm', 'verify'];
            const primaryCounts = Object.entries(roomStats.actionCounts)
              .filter(([action]) => primaryActionCodes.includes(action as ProjectRoomActionCode))
              .slice(0, 3);
            return (
              <div key={room.roomCode} className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
                <button type="button" aria-expanded={open} onClick={() => setOpenRoom(open ? null : room.roomCode)}
                  className="flex w-full flex-col gap-3 rounded-2xl p-4 text-left focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">{GROUP_LABELS[room.groupCode] || room.groupCode}</p>
                      <h4 className="mt-0.5 text-sm font-black text-slate-800 dark:text-white">{room.roomName}</h4>
                    </div>
                    {open ? <ChevronDown size={17} className="mt-1 text-indigo-500" /> : <ChevronRight size={17} className="mt-1 text-slate-300" />}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-200"><Users size={14} className="text-slate-400" />{roomStats.active.length} thành viên</span>
                    <div className="flex -space-x-2">
                      {roomStats.active.slice(0, 5).map(member => member.userAvatar
                        ? <img key={member.userId} src={member.userAvatar} alt={member.userName} className="h-7 w-7 rounded-full border-2 border-white object-cover dark:border-slate-800" />
                        : <span key={member.userId} title={member.userName} className={`flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-[10px] font-black text-white dark:border-slate-800 ${avatarColor(member.userName || member.userId)}`}>{(member.userName || '?').slice(0, 1).toUpperCase()}</span>)}
                      {roomStats.active.length > 5 && <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-slate-100 text-[9px] font-black text-slate-600 dark:border-slate-800 dark:bg-slate-700 dark:text-slate-200">+{roomStats.active.length - 5}</span>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {primaryCounts.length > 0
                      ? primaryCounts.map(([action, count]) => <span key={action} className="rounded-lg border border-indigo-100 bg-indigo-50 px-2 py-1 text-[10px] font-bold text-indigo-700">{getProjectPermissionRoomActionLabel(room.roomCode, action as ProjectRoomActionCode)} {count}</span>)
                      : <span className="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500 dark:bg-slate-700 dark:text-slate-300">Chưa gán quyền nghiệp vụ</span>}
                    {roomStats.stale.length > 0 && <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-500">{roomStats.stale.length} dòng cũ không còn hiệu lực</span>}
                    {room.fallbackOnlyUserCount > 0 && <span className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-800">{room.fallbackOnlyUserCount} user chỉ có PBAC</span>}
                  </div>
                  {roomStats.missingRequiredActions.length > 0 && (
                    <div className="flex items-start gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] font-bold text-amber-800">
                      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                      Thiếu người {roomStats.missingRequiredActions.map(action => getProjectPermissionRoomActionLabel(room.roomCode, action)).join(', ')}
                    </div>
                  )}
                </button>
                {open && (
                  <div className="border-t border-slate-100 px-4 py-3 dark:border-slate-700">
                    {members.length === 0 ? (
                      <p className="text-xs font-semibold text-slate-500">Chưa có ai trong Room này.</p>
                    ) : (
                      <ul className="space-y-2.5">
                        {members.map(member => {
                          const stale = !eligibleStaffIds.has(member.staffId);
                          return (
                          <li key={member.roomMemberId} className="flex flex-col gap-1">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-xs font-black text-slate-800 dark:text-white">{member.userName}</p>
                                <p className={`${stale ? '' : 'truncate'} text-[10px] text-slate-500 dark:text-slate-300`}>
                                  {stale ? 'Đã rời dự án hoặc tài khoản bị khóa — quyền này không còn hiệu lực' : member.positionName || 'Chưa xác định vị trí'}
                                </p>
                              </div>
                              {stale ? (
                                <button type="button" onClick={() => onRemoveStale(room.roomCode, member.staffId)}
                                  className="shrink-0 rounded-lg border border-rose-200 px-2 py-1 text-[10px] font-black text-rose-700 hover:bg-rose-50">Gỡ dòng cũ</button>
                              ) : (
                                <button type="button" onClick={() => onEditPerson(member.staffId)}
                                  className="shrink-0 rounded-lg border border-indigo-200 px-2 py-1 text-[10px] font-black text-indigo-700 hover:bg-indigo-50">Sửa quyền</button>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {member.actionCodes.map(action => (
                                <span key={action} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-200">
                                  {getProjectPermissionRoomActionLabel(room.roomCode, action)}
                                  {member.actionGrantSources[action] === 'pbac_backfill' ? ' · PBAC' : ''}
                                </span>
                              ))}
                              {member.legacyPermissionCodes.length > 0 && (
                                <span title={member.legacyPermissionCodes.join(', ')} className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-black text-amber-800">PBAC ngoại lệ</span>
                              )}
                            </div>
                          </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default ProjectRoomOverview;
