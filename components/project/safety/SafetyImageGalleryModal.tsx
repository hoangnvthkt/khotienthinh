import React, { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, ArrowRight, Download, X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { SafetyAttachment } from '../../../types';

interface Props {
  attachments: SafetyAttachment[];
  currentIndex: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
}

const SafetyImageGalleryModal: React.FC<Props> = ({
  attachments,
  currentIndex,
  onClose,
  onIndexChange,
}) => {
  const [zoomScale, setZoomScale] = useState(1);

  const images = attachments.filter(item =>
    String(item.fileType || item.name || '').toLowerCase().match(/image|\.png|\.jpe?g|\.webp|\.gif/)
  );

  const currentImage = images[currentIndex];

  // Reset zoom when image changes
  useEffect(() => {
    setZoomScale(1);
  }, [currentIndex]);

  const handleZoomIn = useCallback(() => {
    setZoomScale(s => Math.min(4, Number((s + 0.25).toFixed(2))));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoomScale(s => Math.max(0.5, Number((s - 0.25).toFixed(2))));
  }, []);

  const handleResetZoom = useCallback(() => {
    setZoomScale(1);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      } else if (event.key === 'ArrowLeft' || event.key === 'Left') {
        if (currentIndex > 0) {
          onIndexChange(currentIndex - 1);
        }
      } else if (event.key === 'ArrowRight' || event.key === 'Right') {
        if (currentIndex < images.length - 1) {
          onIndexChange(currentIndex + 1);
        }
      } else if (event.key === '+' || event.key === '=') {
        handleZoomIn();
      } else if (event.key === '-') {
        handleZoomOut();
      } else if (event.key === '0') {
        handleResetZoom();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [currentIndex, handleResetZoom, handleZoomIn, handleZoomOut, images.length, onClose, onIndexChange]);

  if (!currentImage) return null;

  const handleDownload = () => {
    const url = currentImage.url;
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = currentImage.name || 'download-image';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (e.deltaY < 0) {
      handleZoomIn();
    } else {
      handleZoomOut();
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex flex-col justify-between bg-zinc-950/95 p-4 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 py-2 text-white">
        <div className="min-w-0">
          <p className="text-xs font-bold text-zinc-400">Xem ảnh ({currentIndex + 1} / {images.length})</p>
          <h4 className="mt-0.5 truncate text-sm font-bold">{currentImage.name}</h4>
        </div>
        <div className="flex items-center gap-2">
          {/* Zoom Controls */}
          <div className="flex items-center gap-1 bg-zinc-800/80 rounded-xl p-1 border border-zinc-700/60">
            <button
              type="button"
              onClick={handleZoomOut}
              disabled={zoomScale <= 0.5}
              className="p-1.5 text-zinc-300 hover:text-white hover:bg-zinc-700 rounded-lg transition-colors disabled:opacity-40"
              title="Thu nhỏ (-)"
            >
              <ZoomOut size={16} />
            </button>
            <button
              type="button"
              onClick={handleResetZoom}
              className="px-2 py-1 text-[11px] font-mono font-semibold text-teal-400 hover:bg-zinc-700 rounded-lg transition-colors"
              title="Đặt lại zoom (100%)"
            >
              {Math.round(zoomScale * 100)}%
            </button>
            <button
              type="button"
              onClick={handleZoomIn}
              disabled={zoomScale >= 4}
              className="p-1.5 text-zinc-300 hover:text-white hover:bg-zinc-700 rounded-lg transition-colors disabled:opacity-40"
              title="Phóng to (+)"
            >
              <ZoomIn size={16} />
            </button>
          </div>

          <button
            type="button"
            onClick={handleDownload}
            className="flex items-center justify-center rounded-xl bg-zinc-800/80 p-2 text-zinc-200 hover:bg-zinc-700 hover:text-white transition-colors"
            title="Tải xuống"
          >
            <Download size={18} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center rounded-xl bg-zinc-800/80 p-2 text-zinc-200 hover:bg-zinc-700 hover:text-white transition-colors"
            title="Đóng (Esc)"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Main Body */}
      <div className="relative flex flex-1 items-center justify-center py-4 overflow-hidden select-none cursor-grab active:cursor-grabbing" onWheel={handleWheel}>
        {currentIndex > 0 && (
          <button
            type="button"
            onClick={() => onIndexChange(currentIndex - 1)}
            className="absolute left-2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-zinc-800/80 text-white shadow-lg backdrop-blur-sm transition-transform hover:scale-105 hover:bg-zinc-700 md:left-4"
          >
            <ArrowLeft size={20} />
          </button>
        )}

        <img
          src={currentImage.url}
          alt={currentImage.name}
          style={{ transform: `scale(${zoomScale})` }}
          onDoubleClick={() => setZoomScale(s => (s > 1 ? 1 : 2))}
          className="max-h-[78vh] max-w-full rounded-lg object-contain shadow-2xl transition-transform duration-150 ease-out"
        />

        {currentIndex < images.length - 1 && (
          <button
            type="button"
            onClick={() => onIndexChange(currentIndex + 1)}
            className="absolute right-2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-zinc-800/80 text-white shadow-lg backdrop-blur-sm transition-transform hover:scale-105 hover:bg-zinc-700 md:right-4"
          >
            <ArrowRight size={20} />
          </button>
        )}
      </div>

      {/* Helper text */}
      <div className="py-2 text-center text-xs font-medium text-zinc-400">
        Phím ← / → di chuyển ảnh · Cuộn chuột hoặc nút +/- để Phóng to / Thu nhỏ · Nút 100% để reset
      </div>
    </div>
  );
};

export default SafetyImageGalleryModal;
