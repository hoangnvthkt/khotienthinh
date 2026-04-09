import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';

// ══════════════════════════════════════════
//  VIRTUAL LIST — High-performance virtualized rendering
//  Only renders visible items for lists of 100+ items
// ══════════════════════════════════════════

interface VirtualListProps<T> {
  items: T[];
  itemHeight: number;
  containerHeight?: number;  // defaults to container's actual height
  overscan?: number;         // extra items to render above/below viewport
  renderItem: (item: T, index: number) => React.ReactNode;
  keyExtractor: (item: T, index: number) => string;
  className?: string;
  emptyMessage?: string;
}

function VirtualList<T>({
  items,
  itemHeight,
  containerHeight,
  overscan = 5,
  renderItem,
  keyExtractor,
  className = '',
  emptyMessage = 'Không có dữ liệu',
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(containerHeight || 500);

  // Observe container height changes
  useEffect(() => {
    if (containerHeight) {
      setHeight(containerHeight);
      return;
    }
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [containerHeight]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const totalHeight = items.length * itemHeight;
  
  const { startIndex, endIndex, visibleItems } = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const visibleCount = Math.ceil(height / itemHeight) + 2 * overscan;
    const end = Math.min(items.length - 1, start + visibleCount);
    
    return {
      startIndex: start,
      endIndex: end,
      visibleItems: items.slice(start, end + 1),
    };
  }, [items, scrollTop, height, itemHeight, overscan]);

  if (items.length === 0) {
    return (
      <div className={`flex items-center justify-center py-12 text-slate-400 text-sm ${className}`}>
        {emptyMessage}
      </div>
    );
  }

  // For small lists, just render normally
  if (items.length <= 50) {
    return (
      <div className={className}>
        {items.map((item, i) => (
          <div key={keyExtractor(item, i)}>{renderItem(item, i)}</div>
        ))}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`overflow-auto ${className}`}
      style={{ height: containerHeight || '100%' }}
      onScroll={handleScroll}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        {visibleItems.map((item, i) => {
          const actualIndex = startIndex + i;
          return (
            <div
              key={keyExtractor(item, actualIndex)}
              style={{
                position: 'absolute',
                top: actualIndex * itemHeight,
                left: 0,
                right: 0,
                height: itemHeight,
              }}
            >
              {renderItem(item, actualIndex)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default VirtualList;

// ═════════ Utility: Debounced search hook ═════════

export function useDebouncedValue<T>(value: T, delay: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

// ═════════ Utility: Intersection Observer hook ═════════

export function useLazyLoad(ref: React.RefObject<HTMLElement | null>): boolean {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setIsVisible(true); observer.disconnect(); } },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return isVisible;
}
