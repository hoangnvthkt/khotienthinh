import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

export interface MediaItem {
  url: string;
  name: string;
  type: 'image' | 'pdf' | 'other';
}

interface MediaViewerProps {
  isOpen: boolean;
  onClose: () => void;
  items: MediaItem[];
  initialIndex?: number;
}

const MediaViewer: React.FC<MediaViewerProps> = ({
  isOpen,
  onClose,
  items,
  initialIndex = 0,
}) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

  // Reset index if initialIndex changes
  useEffect(() => {
    setCurrentIndex(initialIndex);
  }, [initialIndex]);

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      const originalStyle = window.getComputedStyle(document.body).overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalStyle;
      };
    }
  }, [isOpen]);

  const activeItem = items[currentIndex];

  const resetZoom = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  // Reset zoom when index changes
  useEffect(() => {
    resetZoom();
  }, [currentIndex, resetZoom]);

  const handlePrev = useCallback(() => {
    if (items.length <= 1) return;
    setCurrentIndex(prev => (prev === 0 ? items.length - 1 : prev - 1));
  }, [items.length]);

  const handleNext = useCallback(() => {
    if (items.length <= 1) return;
    setCurrentIndex(prev => (prev === items.length - 1 ? 0 : prev + 1));
  }, [items.length]);

  // Keyboard navigation & Close
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft') {
        if (activeItem?.type === 'image') {
          handlePrev();
        }
      } else if (e.key === 'ArrowRight') {
        if (activeItem?.type === 'image') {
          handleNext();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, activeItem, onClose, handlePrev, handleNext]);

  // Mouse drag pan handlers (for images when zoomed)
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (scale <= 1 || activeItem?.type !== 'image') return;
    setIsDragging(true);
    dragStart.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging || scale <= 1) return;
    setOffset({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Touch drag pan handlers (for mobile)
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (scale <= 1 || activeItem?.type !== 'image') return;
    setIsDragging(true);
    const touch = e.touches[0];
    dragStart.current = { x: touch.clientX - offset.x, y: touch.clientY - offset.y };
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isDragging || scale <= 1) return;
    const touch = e.touches[0];
    setOffset({
      x: touch.clientX - dragStart.current.x,
      y: touch.clientY - dragStart.current.y,
    });
  };

  // Double click toggles zoom (1x <-> 2x)
  const handleDoubleClick = () => {
    if (scale > 1) {
      resetZoom();
    } else {
      setScale(2);
    }
  };

  // Wheel zoom helper
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (activeItem?.type !== 'image') return;
    e.preventDefault();
    const delta = e.deltaY;
    setScale(prev => {
      const next = Math.max(0.5, Math.min(4, prev - delta * 0.005));
      if (next <= 1) setOffset({ x: 0, y: 0 });
      return next;
    });
  };

  const handleDownload = async (url: string, name: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = name || 'file';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      // Fallback
      window.open(url, '_blank');
    }
  };

  if (!isOpen || !activeItem) return null;

  return (
    <div className="fixed inset-0 z-[1100] flex flex-col bg-slate-950/95 transition-opacity duration-300">
      {/* Lightbox / View Area */}
      {activeItem.type === 'image' && (
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Controls Header */}
          <div className="flex items-center justify-between border-b border-white/5 bg-slate-950/60 px-5 py-3 text-white backdrop-blur-md z-10">
            <div className="min-w-0">
              <h4 className="truncate text-sm font-black text-slate-200">{activeItem.name}</h4>
              {items.length > 1 && (
                <p className="text-[10px] font-bold text-slate-400">
                  {currentIndex + 1} / {items.length} hình ảnh
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* Zoom Out */}
              <button
                onClick={() => setScale(prev => {
                  const next = Math.max(0.5, prev - 0.25);
                  if (next <= 1) setOffset({ x: 0, y: 0 });
                  return next;
                })}
                disabled={scale <= 0.5}
                className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-30 transition"
                title="Thu nhỏ"
              >
                <ZoomOut size={16} />
              </button>
              {/* Zoom level */}
              <span className="min-w-[48px] text-center text-xs font-mono font-bold text-slate-400">
                {Math.round(scale * 100)}%
              </span>
              {/* Zoom In */}
              <button
                onClick={() => setScale(prev => Math.min(4, prev + 0.25))}
                disabled={scale >= 4}
                className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-30 transition"
                title="Phóng to"
              >
                <ZoomIn size={16} />
              </button>
              {/* Reset zoom */}
              {(scale !== 1 || offset.x !== 0 || offset.y !== 0) && (
                <button
                  onClick={resetZoom}
                  className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white transition"
                  title="Đặt lại"
                >
                  <RotateCcw size={16} />
                </button>
              )}
              <div className="mx-1 h-5 w-[1px] bg-white/10" />
              {/* Download */}
              <button
                onClick={() => handleDownload(activeItem.url, activeItem.name)}
                className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white transition"
                title="Tải xuống"
              >
                <Download size={16} />
              </button>
              {/* Close */}
              <button
                onClick={onClose}
                className="rounded-lg p-2 text-slate-400 hover:bg-red-500/20 hover:text-red-400 transition"
                title="Đóng (Esc)"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Image viewport */}
          <div
            className={`relative flex flex-1 items-center justify-center overflow-hidden p-4 select-none ${
              scale > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
            }`}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleMouseUp}
            onWheel={handleWheel}
          >
            <img
              src={activeItem.url}
              alt={activeItem.name}
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                transition: isDragging ? 'none' : 'transform 150ms ease-out',
              }}
              onDoubleClick={handleDoubleClick}
              className="max-h-[82vh] max-w-[94vw] object-contain pointer-events-none select-none shadow-2xl"
            />

            {/* Navigation controls */}
            {items.length > 1 && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); handlePrev(); }}
                  className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full border border-white/10 bg-slate-900/50 p-3 text-white backdrop-blur-sm transition hover:bg-slate-900/80 hover:scale-105 active:scale-95"
                  title="Trước đó"
                >
                  <ChevronLeft size={24} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleNext(); }}
                  className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full border border-white/10 bg-slate-900/50 p-3 text-white backdrop-blur-sm transition hover:bg-slate-900/80 hover:scale-105 active:scale-95"
                  title="Tiếp theo"
                >
                  <ChevronRight size={24} />
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* PDF View Area */}
      {activeItem.type === 'pdf' && (
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* PDF Header */}
          <div className="flex items-center justify-between border-b border-white/5 bg-slate-950 px-5 py-3 text-white z-10">
            <div className="min-w-0">
              <h4 className="truncate text-sm font-black text-slate-200">{activeItem.name}</h4>
              <p className="text-[10px] font-bold text-slate-400">Xem trước tài liệu PDF</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => handleDownload(activeItem.url, activeItem.name)}
                className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white transition"
                title="Tải xuống"
              >
                <Download size={16} />
              </button>
              <button
                onClick={onClose}
                className="rounded-lg p-2 text-slate-400 hover:bg-red-500/20 hover:text-red-400 transition"
                title="Đóng"
              >
                <X size={18} />
              </button>
            </div>
          </div>
          {/* PDF Iframe */}
          <div className="flex-1 w-full bg-slate-800">
            <iframe
              src={`${activeItem.url}#toolbar=1`}
              title={activeItem.name}
              className="w-full h-full border-none"
            />
          </div>
        </div>
      )}

      {/* Unsupported Document View Area */}
      {activeItem.type === 'other' && (
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Unsupported Header */}
          <div className="flex items-center justify-between border-b border-white/5 bg-slate-950 px-5 py-3 text-white z-10">
            <div className="min-w-0">
              <h4 className="truncate text-sm font-black text-slate-200">{activeItem.name}</h4>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white transition"
              title="Đóng"
            >
              <X size={18} />
            </button>
          </div>
          {/* Unsupported Body */}
          <div className="flex-1 flex flex-col justify-center items-center p-6 text-center text-white">
            <div className="bg-slate-800 p-5 rounded-full text-amber-500 mb-4 shadow-lg border border-slate-700">
              <FileText size={48} />
            </div>
            <h4 className="text-lg font-black mb-2">{activeItem.name}</h4>
            <p className="text-sm text-slate-400 max-w-md mb-6 leading-relaxed">
              Giao diện xem trước trực tiếp không hỗ trợ định dạng này. Quý khách vui lòng tải tệp tin về thiết bị để mở bằng ứng dụng tương ứng.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleDownload(activeItem.url, activeItem.name)}
                className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-slate-950 px-6 py-2.5 rounded-xl text-sm font-black transition-colors shadow-lg active:scale-95"
              >
                <Download size={16} />
                Tải xuống tệp tin
              </button>
              <button
                onClick={onClose}
                className="inline-flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-6 py-2.5 rounded-xl text-sm font-black transition-colors border border-slate-700 active:scale-95"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MediaViewer;
