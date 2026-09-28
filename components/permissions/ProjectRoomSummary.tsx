import React, { useMemo } from 'react';
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import type { AuthorizationRoomAction } from '../../types';
import {
  getProjectPermissionRoom,
  getProjectPermissionRoomActionLabel,
  type ProjectPermissionRoomCode,
  type ProjectRoomActionCode,
} from '../../lib/permissions/projectPermissionRooms';
import { getScopeEntityLabel, usePermissionScopeEntities } from '../../lib/permissions/permissionScopeEntities';

interface ProjectRoomSummaryProps {
  state: 'loading' | 'ready' | 'error';
  roomActions: readonly AuthorizationRoomAction[];
  isAdmin: boolean;
  onRetry: () => void;
}

interface RoomGroup {
  projectId: string;
  rooms: Array<{ key: string; roomCode: string; siteId: string | null; actions: string[] }>;
}

const ROOM_ORDER = (code: string) => getProjectPermissionRoom(code as ProjectPermissionRoomCode)?.sortOrder ?? 999;

// What the edited person can do in each project Room; changes happen in the
// project's own Permissions tab (opened in a new tab so this draft survives).
const ProjectRoomSummary: React.FC<ProjectRoomSummaryProps> = ({ state, roomActions, isAdmin, onRetry }) => {
  const { entities } = usePermissionScopeEntities();
  const groups = useMemo<RoomGroup[]>(() => {
    const byProject = new Map<string, Map<string, RoomGroup['rooms'][number]>>();
    for (const action of roomActions) {
      if (action.source === 'admin') continue;
      const rooms = byProject.get(action.projectId) || new Map();
      const key = `${action.roomCode}::${action.constructionSiteId || '*'}`;
      const room = rooms.get(key) || { key, roomCode: action.roomCode, siteId: action.constructionSiteId || null, actions: [] };
      if (!room.actions.includes(action.actionCode)) room.actions.push(action.actionCode);
      rooms.set(key, room);
      byProject.set(action.projectId, rooms);
    }
    return [...byProject.entries()]
      .map(([projectId, rooms]) => ({
        projectId,
        rooms: [...rooms.values()].sort((a, b) => ROOM_ORDER(a.roomCode) - ROOM_ORDER(b.roomCode)),
      }))
      .sort((a, b) => getScopeEntityLabel(entities, 'project', a.projectId)
        .localeCompare(getScopeEntityLabel(entities, 'project', b.projectId), 'vi'));
  }, [roomActions, entities]);

  const roomCount = groups.reduce((sum, group) => sum + group.rooms.length, 0);

  return (
    <section className="rounded-xl border border-indigo-100 bg-white p-3">
      <div className="text-xs font-black uppercase tracking-wide text-indigo-700">Quyền trong Room dự án</div>
      <p className="mt-1 text-[11px] text-slate-500">
        Room được phân tại tab Phân quyền của từng dự án. Bấm tên dự án để mở ở thẻ mới, bản đang sửa ở đây vẫn giữ nguyên.
      </p>

      {state === 'loading' && (
        <p className="mt-3 flex items-center gap-2 text-xs font-bold text-slate-400"><Loader2 size={14} className="animate-spin" /> Đang tải quyền Room…</p>
      )}
      {state === 'error' && (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">
          Không tải được quyền Room của người này.
          <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 font-black">
            <RefreshCw size={12} /> Thử lại
          </button>
        </div>
      )}
      {state === 'ready' && isAdmin && (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
          Quản trị viên có toàn quyền trong mọi dự án, không cần phân Room.
        </p>
      )}
      {state === 'ready' && !isAdmin && groups.length === 0 && (
        <p className="mt-3 rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs font-bold text-slate-500">
          Chưa được phân Room ở dự án nào.
        </p>
      )}
      {state === 'ready' && !isAdmin && groups.length > 0 && (
        <>
          <p className="mt-2 text-xs font-black text-slate-700">{roomCount} Room ở {groups.length} dự án</p>
          <ul className="mt-2 space-y-2">
            {groups.map(group => (
              <li key={group.projectId} className="rounded-lg border border-slate-100 bg-slate-50/60 p-2.5">
                <a
                  href={`#/da?projectId=${encodeURIComponent(group.projectId)}&tab=permissions`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-black text-indigo-700 hover:text-indigo-900"
                >
                  {getScopeEntityLabel(entities, 'project', group.projectId)} <ExternalLink size={11} />
                </a>
                <ul className="mt-1.5 space-y-1">
                  {group.rooms.map(room => (
                    <li key={room.key} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11px]">
                      <span className="font-bold text-slate-700">
                        {getProjectPermissionRoom(room.roomCode as ProjectPermissionRoomCode)?.name || room.roomCode}
                        {room.siteId && <span className="font-medium text-slate-400"> · {getScopeEntityLabel(entities, 'construction_site', room.siteId)}</span>}
                      </span>
                      <span className="text-slate-500">
                        {room.actions
                          .map(action => getProjectPermissionRoomActionLabel(room.roomCode as ProjectPermissionRoomCode, action as ProjectRoomActionCode) || action)
                          .join(', ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
};

export default ProjectRoomSummary;
