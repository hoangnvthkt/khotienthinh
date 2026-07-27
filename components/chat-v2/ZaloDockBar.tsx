import React from 'react';
import {
  MessageSquare,
  Contact,
  CheckSquare,
  Cloud,
  FolderOpen,
  Settings,
  Plus
} from 'lucide-react';
import type { User } from '../../types';

interface ZaloDockBarProps {
  currentUser: User;
  unreadCount: number;
  activeNav: 'chat' | 'contacts' | 'tasks';
  setActiveNav: (nav: 'chat' | 'contacts' | 'tasks') => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
}

export const ZaloDockBar: React.FC<ZaloDockBarProps> = ({
  currentUser,
  unreadCount,
  activeNav,
  setActiveNav,
  onNewChat,
  onOpenSettings,
}) => {
  return (
    <aside className="w-[64px] bg-[#0068ff] flex flex-col items-center py-3.5 justify-between shrink-0 select-none text-white shadow-md z-30">
      {/* Top Section */}
      <div className="flex flex-col items-center gap-5 w-full">
        {/* Profile Avatar */}
        <div className="relative group cursor-pointer" onClick={onOpenSettings} title={currentUser.name || currentUser.email}>
          {currentUser.avatar ? (
            <img
              src={currentUser.avatar}
              alt={currentUser.name}
              className="w-10 h-10 rounded-full object-cover ring-2 ring-white/40 group-hover:ring-white transition"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center font-bold text-sm text-white ring-2 ring-white/40 group-hover:ring-white transition">
              {(currentUser.name || currentUser.email || 'U').charAt(0).toUpperCase()}
            </div>
          )}
          <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-[#0068ff]" />
        </div>

        {/* Divider */}
        <div className="w-8 h-[1px] bg-white/15" />

        {/* Main Nav Items */}
        <div className="flex flex-col items-center gap-2 w-full px-2">
          {/* Chat Icon */}
          <button
            type="button"
            onClick={() => setActiveNav('chat')}
            title="Tin nhắn (Zalo Chat)"
            className={`w-11 h-11 rounded-xl flex items-center justify-center transition relative group ${
              activeNav === 'chat'
                ? 'bg-black/20 text-white font-bold'
                : 'text-white/70 hover:text-white hover:bg-white/10'
            }`}
          >
            <MessageSquare size={22} className={activeNav === 'chat' ? 'stroke-[2.5]' : 'stroke-2'} />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white ring-2 ring-[#0068ff]">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
            <span className="absolute left-[70px] bg-slate-900 text-white text-[11px] font-medium py-1 px-2.5 rounded shadow-xl hidden group-hover:block whitespace-nowrap z-50 pointer-events-none">
              Tin nhắn
            </span>
          </button>

          {/* Contacts Icon */}
          <button
            type="button"
            onClick={() => setActiveNav('contacts')}
            title="Danh bạ"
            className={`w-11 h-11 rounded-xl flex items-center justify-center transition relative group ${
              activeNav === 'contacts'
                ? 'bg-black/20 text-white font-bold'
                : 'text-white/70 hover:text-white hover:bg-white/10'
            }`}
          >
            <Contact size={22} className={activeNav === 'contacts' ? 'stroke-[2.5]' : 'stroke-2'} />
            <span className="absolute left-[70px] bg-slate-900 text-white text-[11px] font-medium py-1 px-2.5 rounded shadow-xl hidden group-hover:block whitespace-nowrap z-50 pointer-events-none">
              Danh bạ
            </span>
          </button>

          {/* Tasks Icon */}
          <button
            type="button"
            onClick={() => setActiveNav('tasks')}
            title="Giao việc / To-do"
            className={`w-11 h-11 rounded-xl flex items-center justify-center transition relative group ${
              activeNav === 'tasks'
                ? 'bg-black/20 text-white font-bold'
                : 'text-white/70 hover:text-white hover:bg-white/10'
            }`}
          >
            <CheckSquare size={22} className={activeNav === 'tasks' ? 'stroke-[2.5]' : 'stroke-2'} />
            <span className="absolute left-[70px] bg-slate-900 text-white text-[11px] font-medium py-1 px-2.5 rounded shadow-xl hidden group-hover:block whitespace-nowrap z-50 pointer-events-none">
              Giao việc
            </span>
          </button>
        </div>
      </div>

      {/* Bottom Section */}
      <div className="flex flex-col items-center gap-3 w-full px-2">
        {/* Create New Chat (+) */}
        <button
          type="button"
          onClick={onNewChat}
          title="Tạo cuộc hội thoại mới"
          className="w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-white transition group relative"
        >
          <Plus size={20} />
          <span className="absolute left-[70px] bg-slate-900 text-white text-[11px] font-medium py-1 px-2.5 rounded shadow-xl hidden group-hover:block whitespace-nowrap z-50 pointer-events-none">
            Tạo trò chuyện mới
          </span>
        </button>

        {/* Cloud Storage */}
        <button
          type="button"
          title="Cloud của tôi (Lưu trữ)"
          className="w-10 h-10 rounded-xl text-white/70 hover:text-white hover:bg-white/10 flex items-center justify-center transition relative group"
        >
          <Cloud size={20} />
          <span className="absolute left-[70px] bg-slate-900 text-white text-[11px] font-medium py-1 px-2.5 rounded shadow-xl hidden group-hover:block whitespace-nowrap z-50 pointer-events-none">
            Cloud của tôi
          </span>
        </button>

        {/* File Collection */}
        <button
          type="button"
          title="Bộ sưu tập tệp"
          className="w-10 h-10 rounded-xl text-white/70 hover:text-white hover:bg-white/10 flex items-center justify-center transition relative group"
        >
          <FolderOpen size={20} />
          <span className="absolute left-[70px] bg-slate-900 text-white text-[11px] font-medium py-1 px-2.5 rounded shadow-xl hidden group-hover:block whitespace-nowrap z-50 pointer-events-none">
            Tài liệu & Tệp
          </span>
        </button>

        {/* Settings */}
        <button
          type="button"
          onClick={onOpenSettings}
          title="Cài đặt"
          className="w-10 h-10 rounded-xl text-white/70 hover:text-white hover:bg-white/10 flex items-center justify-center transition relative group"
        >
          <Settings size={20} />
          <span className="absolute left-[70px] bg-slate-900 text-white text-[11px] font-medium py-1 px-2.5 rounded shadow-xl hidden group-hover:block whitespace-nowrap z-50 pointer-events-none">
            Cài đặt
          </span>
        </button>
      </div>
    </aside>
  );
};

export default ZaloDockBar;
