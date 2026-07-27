import React, { useState } from 'react';
import { MessageSquare, Pin, ChevronDown, MoreHorizontal, FileText, PinOff } from 'lucide-react';
import type { ChatV2Message, ChatV2Conversation } from '../../lib/chatV2Service';

interface ZaloPinnedBannerProps {
  conversation: ChatV2Conversation;
  pinnedMessages?: ChatV2Message[];
  onUnpin?: (messageId: string) => void;
}

export const ZaloPinnedBanner: React.FC<ZaloPinnedBannerProps> = ({
  conversation,
  pinnedMessages = [],
  onUnpin,
}) => {
  const [showDropdown, setShowDropdown] = useState(false);

  if (!conversation.metadata?.pinnedMessageId && pinnedMessages.length === 0) {
    return null;
  }

  const firstPinned = pinnedMessages[0];
  const pinnedCount = pinnedMessages.length || (conversation.metadata?.pinnedMessageId ? 1 : 0);

  return (
    <div className="relative border-b border-blue-100 bg-[#e5efff] px-3.5 py-2 dark:border-blue-900/50 dark:bg-[#1b2738] flex items-center justify-between text-xs text-slate-800 dark:text-slate-200 select-none shadow-xs">
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#0068ff] text-white shadow-xs">
          <Pin size={13} className="rotate-45" />
        </div>
        <div className="min-w-0 flex-1 font-medium">
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-[#0068ff] dark:text-blue-400">
            <span>Tin nhắn đã ghim</span>
            {pinnedCount > 1 && (
              <span className="rounded-full bg-blue-500/15 px-1.5 py-0.2 text-[9px]">
                {pinnedCount} tin
              </span>
            )}
          </div>
          <div className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100 leading-snug">
            {firstPinned?.body || conversation.metadata?.pinnedMessagePreview || 'Nội dung tin nhắn được ghim'}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0 ml-2">
        {pinnedCount > 1 && (
          <button
            type="button"
            onClick={() => setShowDropdown(!showDropdown)}
            className="flex items-center gap-0.5 rounded-lg border border-blue-200 bg-white/70 px-2 py-1 text-[11px] font-bold text-[#0068ff] hover:bg-white dark:border-blue-800 dark:bg-blue-900/40 dark:text-blue-300 transition"
          >
            +{pinnedCount - 1} ghim <ChevronDown size={12} />
          </button>
        )}

        <button
          type="button"
          onClick={() => firstPinned && onUnpin && onUnpin(firstPinned.id)}
          title="Bỏ ghim"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-blue-200/50 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-blue-900/50 dark:hover:text-white transition"
        >
          <PinOff size={14} />
        </button>
      </div>

      {showDropdown && pinnedMessages.length > 1 && (
        <div className="absolute right-3 top-full mt-1 z-50 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-[#2b2d31]">
          <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Danh sách tin đã ghim
          </div>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {pinnedMessages.map(msg => (
              <div key={msg.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition text-xs">
                <span className="truncate flex-1 font-medium">{msg.body}</span>
                {onUnpin && (
                  <button
                    type="button"
                    onClick={() => onUnpin(msg.id)}
                    className="text-slate-400 hover:text-red-500 ml-2"
                  >
                    <PinOff size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ZaloPinnedBanner;
