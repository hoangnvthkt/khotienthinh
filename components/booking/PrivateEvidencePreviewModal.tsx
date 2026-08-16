import React from 'react';
import { ExternalLink, ImageOff, X } from 'lucide-react';

export type PrivateEvidencePreviewItem = {
  label: string;
  url: string;
};

type Props = {
  title: string;
  items: PrivateEvidencePreviewItem[];
  error?: string;
  onClose: () => void;
};

const PrivateEvidencePreviewModal: React.FC<Props> = ({ title, items, error, onClose }) => (
  <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal="true" aria-label={title}>
    <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-800">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-700">
        <div>
          <h3 className="font-bold text-slate-900 dark:text-white">{title}</h3>
          <p className="mt-1 text-xs text-slate-500">Ảnh bảo mật, liên kết xem sẽ tự hết hạn.</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700" aria-label="Đóng trình xem ảnh">
          <X className="h-5 w-5" />
        </button>
      </div>

      {error ? (
        <div className="mt-5 flex flex-col items-center rounded-2xl border border-dashed border-rose-200 bg-rose-50 p-8 text-center text-sm text-rose-700">
          <ImageOff className="mb-3 h-8 w-8" />
          {error}
        </div>
      ) : items.length === 0 ? (
        <div className="mt-5 rounded-2xl bg-slate-50 p-8 text-center text-sm text-slate-500 dark:bg-slate-900">
          Đang tải ảnh bảo mật...
        </div>
      ) : (
        <div className={`mt-5 grid gap-5 ${items.length > 1 ? 'md:grid-cols-2' : ''}`}>
          {items.map(item => (
            <figure key={`${item.label}-${item.url}`} className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900">
              <img src={item.url} alt={item.label} className="max-h-[65vh] w-full object-contain" />
              <figcaption className="flex items-center justify-between gap-3 border-t border-slate-200 p-3 text-xs font-semibold dark:border-slate-700">
                <span>{item.label}</span>
                <a href={item.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-amber-600 hover:underline">
                  Mở ảnh gốc <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  </div>
);

export default PrivateEvidencePreviewModal;
