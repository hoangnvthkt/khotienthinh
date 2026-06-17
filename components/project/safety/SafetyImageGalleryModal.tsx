import React, { useEffect } from 'react';
import { ArrowLeft, ArrowRight, Download, X } from 'lucide-react';
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
  const images = attachments.filter(item =>
    String(item.fileType || item.name || '').toLowerCase().match(/image|\.png|\.jpe?g|\.webp|\.gif/)
  );

  const currentImage = images[currentIndex];

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
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [currentIndex, images.length, onClose, onIndexChange]);

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

  return (
    <div className="fixed inset-0 z-[100] flex flex-col justify-between bg-slate-950/95 p-4 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 py-2 text-white">
        <div className="min-w-0">
          <p className="text-xs font-black text-slate-400">Xem ảnh ({currentIndex + 1} / {images.length})</p>
          <h4 className="mt-0.5 truncate text-sm font-black">{currentImage.name}</h4>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleDownload}
            className="flex items-center justify-center rounded-xl bg-slate-800/80 p-2.5 text-slate-200 hover:bg-slate-700 hover:text-white"
            title="Tải xuống"
          >
            <Download size={18} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center rounded-xl bg-slate-800/80 p-2.5 text-slate-200 hover:bg-slate-700 hover:text-white"
            title="Đóng (Esc)"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Main Body */}
      <div className="relative flex flex-1 items-center justify-center py-4">
        {currentIndex > 0 && (
          <button
            type="button"
            onClick={() => onIndexChange(currentIndex - 1)}
            className="absolute left-2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-slate-800/80 text-white shadow-lg backdrop-blur-sm transition-transform hover:scale-105 hover:bg-slate-700 md:left-4"
          >
            <ArrowLeft size={20} />
          </button>
        )}

        <img
          src={currentImage.url}
          alt={currentImage.name}
          className="max-h-[78vh] max-w-full rounded-lg object-contain shadow-2xl select-none"
        />

        {currentIndex < images.length - 1 && (
          <button
            type="button"
            onClick={() => onIndexChange(currentIndex + 1)}
            className="absolute right-2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-slate-800/80 text-white shadow-lg backdrop-blur-sm transition-transform hover:scale-105 hover:bg-slate-700 md:right-4"
          >
            <ArrowRight size={20} />
          </button>
        )}
      </div>

      {/* Thumbnails list or helper text */}
      <div className="py-2 text-center text-xs font-bold text-slate-500">
        Dùng phím điều hướng ← / → để di chuyển giữa các ảnh
      </div>
    </div>
  );
};

export default SafetyImageGalleryModal;
