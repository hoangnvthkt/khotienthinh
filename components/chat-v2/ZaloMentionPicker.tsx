import React, { useMemo } from 'react';
import { AtSign, Users } from 'lucide-react';
import type { User } from '../../types';
import type { ChatV2Conversation } from '../../lib/chatV2Service';

export interface MentionCandidate {
  id: string;
  name: string;
  avatarUrl?: string;
  role?: string;
  isAll?: boolean;
}

interface ZaloMentionPickerProps {
  conversation: ChatV2Conversation | null;
  users: User[];
  employees: any[];
  currentUserId: string;
  query: string;
  selectedIndex: number;
  onSelect: (candidate: MentionCandidate) => void;
  onClose: () => void;
}

export const ZaloMentionPicker: React.FC<ZaloMentionPickerProps> = ({
  conversation,
  users,
  employees,
  currentUserId,
  query,
  selectedIndex,
  onSelect,
}) => {
  const candidates = useMemo(() => {
    const list: MentionCandidate[] = [];
    const q = query.toLowerCase().trim();

    // In group conversations, allow @All option
    if (conversation?.type === 'group') {
      if (!q || 'all'.includes(q) || 'mọi người'.includes(q) || 'nhóm'.includes(q)) {
        list.push({
          id: 'ALL_MEMBERS',
          name: 'All (Tất cả mọi người)',
          isAll: true,
          role: 'Nhắc đến tất cả thành viên nhóm',
        });
      }
    }

    // Filter participants in conversation
    const participantIds = conversation?.participants
      ? new Set(conversation.participants.map(p => p.userId))
      : new Set(users.map(u => u.id));

    users.forEach(u => {
      if (u.id === currentUserId) return; // Skip self
      if (participantIds.has(u.id)) {
        const emp = employees.find(e => e.userId === u.id);
        const displayName = emp?.fullName || u.name || u.email;
        const role = emp?.position || emp?.department || u.role || '';

        if (
          !q ||
          displayName.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          role.toLowerCase().includes(q)
        ) {
          list.push({
            id: u.id,
            name: displayName,
            avatarUrl: emp?.avatarUrl || u.avatar,
            role,
          });
        }
      }
    });

    return list;
  }, [conversation, users, employees, currentUserId, query]);

  if (candidates.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 mb-2 z-[100] w-72 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-2xl dark:border-slate-700 dark:bg-[#2b2d31] animate-in fade-in slide-in-from-bottom-2 duration-150">
      <div className="px-2 py-1 text-[10px] font-bold tracking-wider text-slate-400 uppercase flex items-center gap-1 border-b border-slate-100 dark:border-slate-750 mb-1">
        <AtSign size={11} className="text-blue-500" /> Nhắc đến ai đó trong nhóm
      </div>
      <div className="space-y-0.5">
        {candidates.map((item, idx) => {
          const isSelected = idx === selectedIndex;
          return (
            <button
              key={item.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault(); // Prevent blur on input
                onSelect(item);
              }}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                isSelected
                  ? 'bg-blue-500 text-white font-medium shadow-sm'
                  : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-[#35373c]'
              }`}
            >
              {item.isAll ? (
                <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${isSelected ? 'bg-white/20 text-white' : 'bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-300'}`}>
                  <Users size={14} />
                </div>
              ) : item.avatarUrl ? (
                <img src={item.avatarUrl} alt={item.name} className="h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-700" />
              ) : (
                <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-bold text-[11px] ${isSelected ? 'bg-white/20 text-white' : 'bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300'}`}>
                  {item.name.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-xs leading-snug">{item.name}</div>
                {item.role && (
                  <div className={`truncate text-[10px] ${isSelected ? 'text-blue-100' : 'text-slate-400 dark:text-slate-500'}`}>
                    {item.role}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ZaloMentionPicker;
