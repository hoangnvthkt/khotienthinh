import React, { useEffect } from 'react';
import { ArrowLeft, ArrowRight, Download, ExternalLink, FileText, Image as ImageIcon, X } from 'lucide-react';
import { SafetyAttachment } from '../../../types';
import { safetyService } from '../../../lib/safetyService';

interface Props {
  attachments: SafetyAttachment[];
  currentIndex: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
}

const isPdfAttachment = (attachment: SafetyAttachment) =>
  String(`${attachment.fileType || ''} ${attachment.name || ''}`).toLowerCase().includes('pdf');

const isTextPreviewAttachment = (attachment: SafetyAttachment) => {
  const value = String(`${attachment.fileType || ''} ${attachment.name || ''}`).toLowerCase();
  return value.includes('text/') || /\.(txt|csv|json|log)$/i.test(value);
};

const formatFileSize = (value?: number) => {
  if (!value) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
};

const SafetyAttachmentPreviewModal: React.FC<Props> = ({ attachments, currentIndex, onClose, onIndexChange }) => {
  const current = attachments[currentIndex];
  const url = current?.previewUrl || current?.url;
  const isImage = current ? Boolean(safetyService.isImageAttachment(current)) : false;
  const canInlinePreview = current ? isImage || isPdfAttachment(current) || isTextPreviewAttachment(current) : false;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if ((event.key === 'ArrowLeft' || event.key === 'Left') && currentIndex > 0) onIndexChange(currentIndex - 1);
      if ((event.key === 'ArrowRight' || event.key === 'Right') && currentIndex < attachments.length - 1) onIndexChange(currentIndex + 1);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [attachments.length, currentIndex, onClose, onIndexChange]);

  if (!current || !url) return null;

  const download = () => {
    const link = document.createElement('a');
    link.href = url;
    link.download = current.name || current.fileName || 'safety-attachment';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-slate-950/95 p-4">
      <div className="flex items-center justify-between gap-4 py-2 text-white">
        <div className="min-w-0">
          <p className="text-xs font-black text-slate-400">Xem file ({currentIndex + 1} / {attachments.length})</p>
          <h4 className="mt-0.5 truncate text-sm font-black">{current.name || current.fileName || 'Tệp đính kèm'}</h4>
          <p className="mt-0.5 text-[11px] font-bold text-slate-500">{[current.fileType, formatFileSize(current.fileSize)].filter(Boolean).join(' • ')}</p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center rounded-xl bg-slate-800/80 p-2.5 text-slate-200 hover:bg-slate-700 hover:text-white"
            title="Mở tab mới"
          >
            <ExternalLink size={18} />
          </a>
          <button
            type="button"
            onClick={download}
            className="flex items-center justify-center rounded-xl bg-slate-800/80 p-2.5 text-slate-200 hover:bg-slate-700 hover:text-white"
            title="Tải xuống"
          >
            <Download size={18} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center rounded-xl bg-slate-800/80 p-2.5 text-slate-200 hover:bg-slate-700 hover:text-white"
            title="Đóng"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden py-4">
        {currentIndex > 0 && (
          <button
            type="button"
            onClick={() => onIndexChange(currentIndex - 1)}
            className="absolute left-2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-slate-800/80 text-white shadow-lg transition-transform hover:scale-105 hover:bg-slate-700 md:left-4"
            title="File trước"
          >
            <ArrowLeft size={20} />
          </button>
        )}

        {isImage ? (
          <img src={url} alt={current.name} className="max-h-[78vh] max-w-full select-none rounded-lg object-contain shadow-2xl" />
        ) : canInlinePreview ? (
          <iframe key={url} src={url} title={current.name} className="h-[78vh] w-full max-w-6xl rounded-lg border border-slate-800 bg-white shadow-2xl" />
        ) : (
          <div className="flex w-full max-w-lg flex-col items-center justify-center rounded-lg border border-slate-800 bg-slate-900 p-8 text-center text-slate-300 shadow-2xl">
            {safetyService.isImageAttachment(current) ? <ImageIcon size={44} className="mb-4 text-slate-500" /> : <FileText size={44} className="mb-4 text-slate-500" />}
            <div className="text-sm font-black text-white">{current.name || current.fileName || 'Tệp đính kèm'}</div>
            <p className="mt-2 text-xs font-bold leading-5 text-slate-500">Định dạng này không hỗ trợ preview trực tiếp trong trình duyệt. Có thể mở tab mới hoặc tải xuống để xem.</p>
          </div>
        )}

        {currentIndex < attachments.length - 1 && (
          <button
            type="button"
            onClick={() => onIndexChange(currentIndex + 1)}
            className="absolute right-2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-slate-800/80 text-white shadow-lg transition-transform hover:scale-105 hover:bg-slate-700 md:right-4"
            title="File tiếp theo"
          >
            <ArrowRight size={20} />
          </button>
        )}
      </div>

      <div className="py-2 text-center text-xs font-bold text-slate-500">
        Dùng Esc để đóng, ← / → để chuyển file
      </div>
    </div>
  );
};

export default SafetyAttachmentPreviewModal;
