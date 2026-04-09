import React from 'react';
import { WifiOff, RefreshCw, CloudOff, CheckCircle2 } from 'lucide-react';

// ══════════════════════════════════════════
//  OFFLINE INDICATOR — Banner + Badge
// ══════════════════════════════════════════

interface OfflineIndicatorProps {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  onSync: () => void;
}

const OfflineIndicator: React.FC<OfflineIndicatorProps> = ({ isOnline, isSyncing, pendingCount, onSync }) => {
  // Fully online, nothing pending → don't show anything
  if (isOnline && pendingCount === 0) return null;

  // Online but has pending mutations → show sync bar
  if (isOnline && pendingCount > 0) {
    return (
      <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[60] animate-slide-up">
        <div className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-amber-500 text-white shadow-xl shadow-amber-500/25 text-xs font-bold">
          {isSyncing ? (
            <>
              <RefreshCw size={14} className="animate-spin" />
              <span>Đang đồng bộ {pendingCount} thay đổi...</span>
            </>
          ) : (
            <>
              <CloudOff size={14} />
              <span>{pendingCount} thay đổi chờ đồng bộ</span>
              <button
                onClick={onSync}
                className="ml-1 px-2 py-0.5 rounded-lg bg-white/20 hover:bg-white/30 transition text-[10px]"
              >
                Sync ngay
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // Offline
  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[60] animate-slide-up">
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-red-500 text-white shadow-xl shadow-red-500/25 text-xs font-bold">
        <WifiOff size={14} className="animate-pulse" />
        <span>Đang offline</span>
        {pendingCount > 0 && (
          <span className="px-1.5 py-0.5 rounded-full bg-white/20 text-[10px]">
            {pendingCount} chờ sync
          </span>
        )}
        <span className="text-white/70 text-[10px]">Dữ liệu sẽ sync khi có mạng</span>
      </div>
    </div>
  );
};

// Badge for sidebar/nav
export const OfflineBadge: React.FC<{ isOnline: boolean; pendingCount: number }> = ({ isOnline, pendingCount }) => {
  if (isOnline && pendingCount === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-500">
        <CheckCircle2 size={10} /> Online
      </span>
    );
  }
  if (!isOnline) {
    return (
      <span className="inline-flex items-center gap-1 text-[9px] font-bold text-red-500 animate-pulse">
        <WifiOff size={10} /> Offline
        {pendingCount > 0 && <span className="px-1 rounded bg-red-100 dark:bg-red-900/30">{pendingCount}</span>}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[9px] font-bold text-amber-500">
      <CloudOff size={10} /> {pendingCount} chờ sync
    </span>
  );
};

export default OfflineIndicator;
