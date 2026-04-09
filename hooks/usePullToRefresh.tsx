import { useState, useRef, useCallback, useEffect } from 'react';

// ══════════════════════════════════════════
//  PULL TO REFRESH — Mobile gesture hook
// ══════════════════════════════════════════

interface PullToRefreshOptions {
  onRefresh: () => Promise<void>;
  threshold?: number; // px to trigger refresh (default 60)
  resistance?: number; // pull resistance factor (default 2.5)
}

interface PullToRefreshResult {
  isRefreshing: boolean;
  pullDistance: number;
  containerRef: React.RefObject<HTMLDivElement>;
  indicatorStyle: React.CSSProperties;
}

export const usePullToRefresh = ({
  onRefresh,
  threshold = 60,
  resistance = 2.5,
}: PullToRefreshOptions): PullToRefreshResult => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null!);
  const startY = useRef(0);
  const isPulling = useRef(false);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const el = containerRef.current;
    if (!el || el.scrollTop > 0 || isRefreshing) return;
    startY.current = e.touches[0].clientY;
    isPulling.current = true;
  }, [isRefreshing]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!isPulling.current || isRefreshing) return;
    const el = containerRef.current;
    if (!el || el.scrollTop > 0) {
      isPulling.current = false;
      setPullDistance(0);
      return;
    }
    const deltaY = e.touches[0].clientY - startY.current;
    if (deltaY > 0) {
      e.preventDefault();
      setPullDistance(Math.min(deltaY / resistance, threshold * 1.5));
    }
  }, [isRefreshing, resistance, threshold]);

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling.current) return;
    isPulling.current = false;

    if (pullDistance >= threshold && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(threshold * 0.5); // shrink to spinner state
      try {
        await onRefresh();
      } catch (err) {
        console.error('Pull-to-refresh error:', err);
      }
      setIsRefreshing(false);
    }
    setPullDistance(0);
  }, [pullDistance, threshold, isRefreshing, onRefresh]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  const indicatorStyle: React.CSSProperties = {
    transform: `translateY(${pullDistance}px)`,
    transition: isPulling.current ? 'none' : 'transform 0.3s ease-out',
  };

  return {
    isRefreshing,
    pullDistance,
    containerRef,
    indicatorStyle,
  };
};

// ═════════ Pull Indicator Component ═════════
export const PullRefreshIndicator: React.FC<{
  pullDistance: number;
  isRefreshing: boolean;
  threshold?: number;
}> = ({ pullDistance, isRefreshing, threshold = 60 }) => {
  if (pullDistance <= 0 && !isRefreshing) return null;

  const progress = Math.min(pullDistance / threshold, 1);

  return (
    <div
      className="flex items-center justify-center overflow-hidden transition-all"
      style={{ height: pullDistance > 0 ? `${pullDistance}px` : isRefreshing ? '40px' : '0px' }}
    >
      {isRefreshing ? (
        <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      ) : (
        <div
          className="w-5 h-5 text-indigo-500 transition-transform"
          style={{ transform: `rotate(${progress * 180}deg)`, opacity: progress }}
        >
          ↓
        </div>
      )}
    </div>
  );
};
