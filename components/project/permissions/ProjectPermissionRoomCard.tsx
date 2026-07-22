import React from 'react';
import { AlertTriangle, ChevronRight, Users } from 'lucide-react';
import type { ProjectPermissionRoomCode } from '../../../lib/permissions/projectPermissionRooms';
import type { ProjectPermissionRoomSummary } from '../../../lib/projectPermissionRoomService';

interface Props {
  room: ProjectPermissionRoomSummary;
  onOpen: (roomCode: ProjectPermissionRoomCode) => void;
}

const ACTION_LABELS: Record<string, string> = {
  approve: 'Duyệt', confirm: 'Xác nhận', verify: 'Kiểm tra', submit: 'Gửi', edit: 'Sửa', delete: 'Xóa', view: 'Xem', view_available_stock: 'Xem tồn',
};

const avatarColor = (value: string) => ['bg-indigo-600', 'bg-sky-600', 'bg-emerald-600', 'bg-amber-600', 'bg-rose-600'][value.charCodeAt(0) % 5];

const ProjectPermissionRoomCard: React.FC<Props> = ({ room, onOpen }) => {
  const primaryCounts = Object.entries(room.actionCounts)
    .filter(([action]) => ['approve', 'confirm', 'verify'].includes(action))
    .slice(0, 3);

  return <button type="button" onClick={() => onOpen(room.roomCode)} className="group relative flex min-h-56 w-full flex-col rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 active:translate-y-0 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-indigo-700">
    <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">{room.groupCode}</p><h3 className="mt-1 text-sm font-black text-slate-800 dark:text-white">{room.roomName}</h3></div><ChevronRight size={17} className="mt-1 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-indigo-500" /></div>
    <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-300">{room.description}</p>
    <div className="mt-4 flex items-center justify-between"><span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-200"><Users size={14} className="text-slate-400" />{room.memberCount} thành viên</span><div className="flex -space-x-2">{room.memberPreview.map(member => member.userAvatar ? <img key={member.userId} src={member.userAvatar} alt={member.userName} className="h-7 w-7 rounded-full border-2 border-white object-cover dark:border-slate-800" /> : <span key={member.userId} title={member.userName} className={`flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-[10px] font-black text-white dark:border-slate-800 ${avatarColor(member.userName || member.userId)}`}>{(member.userName || '?').slice(0, 1).toUpperCase()}</span>)}{room.memberCount > room.memberPreview.length && <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-slate-100 text-[9px] font-black text-slate-600 dark:border-slate-800 dark:bg-slate-700 dark:text-slate-200">+{room.memberCount - room.memberPreview.length}</span>}</div></div>
    <div className="mt-auto pt-4"><div className="flex flex-wrap gap-1.5">{primaryCounts.length > 0 ? primaryCounts.map(([action, count]) => <span key={action} className="rounded-lg border border-indigo-100 bg-indigo-50 px-2 py-1 text-[10px] font-bold text-indigo-700 dark:border-indigo-900/70 dark:bg-indigo-950/30 dark:text-indigo-200">{ACTION_LABELS[action] || action} {count}</span>) : <span className="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500 dark:bg-slate-700 dark:text-slate-300">Chưa gán quyền nghiệp vụ</span>}</div>{room.missingRequiredActions.length > 0 && <div className="mt-3 flex items-start gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] font-bold text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200"><AlertTriangle size={13} className="mt-0.5 shrink-0" />Thiếu người {room.missingRequiredActions.map(action => ACTION_LABELS[action] || action).join(', ')}</div>}</div>
  </button>;
};

export default ProjectPermissionRoomCard;
