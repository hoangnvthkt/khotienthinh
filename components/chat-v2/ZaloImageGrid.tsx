import React, { useState } from 'react';
import { Eye } from 'lucide-react';
import type { ChatV2Attachment } from '../../lib/chatV2Service';

interface ZaloImageGridProps {
  attachments: ChatV2Attachment[];
}

export const ZaloImageGrid: React.FC<ZaloImageGridProps> = ({ attachments }) => {
  const [activePreview, setActivePreview] = useState<string | null>(null);

  if (!attachments || attachments.length === 0) return null;

  const count = attachments.length;

  return (
    <>
      <div className="my-1 overflow-hidden rounded-xl border border-slate-200/80 dark:border-slate-700/60 max-w-[420px] bg-slate-900/5">
        {count === 1 && (
          <div className="relative group cursor-pointer overflow-hidden max-h-[360px]" onClick={() => setActivePreview(attachments[0].signedUrl || '')}>
            <img src={attachments[0].signedUrl} alt={attachments[0].fileName} className="w-full h-full object-cover rounded-xl hover:scale-105 transition duration-300" />
            <span className="absolute top-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-black text-white backdrop-blur border border-white/20">HD</span>
          </div>
        )}

        {count === 2 && (
          <div className="grid grid-cols-2 gap-1 max-h-[220px]">
            {attachments.map(att => (
              <div key={att.id} className="relative group cursor-pointer overflow-hidden h-[180px]" onClick={() => setActivePreview(att.signedUrl || '')}>
                <img src={att.signedUrl} alt={att.fileName} className="w-full h-full object-cover hover:scale-105 transition duration-300" />
                <span className="absolute top-1.5 left-1.5 rounded bg-black/60 px-1 py-0.5 text-[8px] font-black text-white border border-white/20">HD</span>
              </div>
            ))}
          </div>
        )}

        {count === 3 && (
          <div className="grid grid-cols-2 gap-1 h-[240px]">
            <div className="relative group cursor-pointer overflow-hidden h-full" onClick={() => setActivePreview(attachments[0].signedUrl || '')}>
              <img src={attachments[0].signedUrl} alt={attachments[0].fileName} className="w-full h-full object-cover hover:scale-105 transition duration-300" />
              <span className="absolute top-1.5 left-1.5 rounded bg-black/60 px-1 py-0.5 text-[8px] font-black text-white border border-white/20">HD</span>
            </div>
            <div className="grid grid-rows-2 gap-1 h-full">
              {attachments.slice(1, 3).map(att => (
                <div key={att.id} className="relative group cursor-pointer overflow-hidden h-full" onClick={() => setActivePreview(att.signedUrl || '')}>
                  <img src={att.signedUrl} alt={att.fileName} className="w-full h-full object-cover hover:scale-105 transition duration-300" />
                  <span className="absolute top-1.5 left-1.5 rounded bg-black/60 px-1 py-0.5 text-[8px] font-black text-white border border-white/20">HD</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {count === 4 && (
          <div className="grid grid-cols-2 gap-1 h-[260px]">
            {attachments.map(att => (
              <div key={att.id} className="relative group cursor-pointer overflow-hidden h-[128px]" onClick={() => setActivePreview(att.signedUrl || '')}>
                <img src={att.signedUrl} alt={att.fileName} className="w-full h-full object-cover hover:scale-105 transition duration-300" />
                <span className="absolute top-1.5 left-1.5 rounded bg-black/60 px-1 py-0.5 text-[8px] font-black text-white border border-white/20">HD</span>
              </div>
            ))}
          </div>
        )}

        {count >= 5 && (
          <div className="space-y-1">
            {/* Top row: 2 images */}
            <div className="grid grid-cols-2 gap-1 h-[130px]">
              {attachments.slice(0, 2).map(att => (
                <div key={att.id} className="relative group cursor-pointer overflow-hidden h-full" onClick={() => setActivePreview(att.signedUrl || '')}>
                  <img src={att.signedUrl} alt={att.fileName} className="w-full h-full object-cover hover:scale-105 transition duration-300" />
                  <span className="absolute top-1.5 left-1.5 rounded bg-black/60 px-1 py-0.5 text-[8px] font-black text-white border border-white/20">HD</span>
                </div>
              ))}
            </div>
            {/* Middle row: 2 images */}
            <div className="grid grid-cols-2 gap-1 h-[130px]">
              {attachments.slice(2, 4).map(att => (
                <div key={att.id} className="relative group cursor-pointer overflow-hidden h-full" onClick={() => setActivePreview(att.signedUrl || '')}>
                  <img src={att.signedUrl} alt={att.fileName} className="w-full h-full object-cover hover:scale-105 transition duration-300" />
                  <span className="absolute top-1.5 left-1.5 rounded bg-black/60 px-1 py-0.5 text-[8px] font-black text-white border border-white/20">HD</span>
                </div>
              ))}
            </div>
            {/* Bottom row: 5th image (or overflow counter) */}
            <div className="relative group cursor-pointer overflow-hidden h-[140px]" onClick={() => setActivePreview(attachments[4].signedUrl || '')}>
              <img src={attachments[4].signedUrl} alt={attachments[4].fileName} className="w-full h-full object-cover hover:scale-105 transition duration-300" />
              <span className="absolute top-1.5 left-1.5 rounded bg-black/60 px-1 py-0.5 text-[8px] font-black text-white border border-white/20">HD</span>
              {count > 5 && (
                <div className="absolute inset-0 bg-black/65 flex items-center justify-center text-white font-bold text-lg backdrop-blur-xs">
                  +{count - 5} ảnh khác
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Lightbox Modal */}
      {activePreview && (
        <div className="fixed inset-0 z-[150] bg-black/90 flex items-center justify-center p-4 backdrop-blur-md animate-in fade-in" onClick={() => setActivePreview(null)}>
          <div className="relative max-w-4xl max-h-[90vh] overflow-hidden rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
            <img src={activePreview} alt="Full view" className="w-full h-full object-contain max-h-[85vh]" />
            <button
              type="button"
              onClick={() => setActivePreview(null)}
              className="absolute top-3 right-3 rounded-full bg-black/60 p-2 text-white hover:bg-white/20 transition"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default ZaloImageGrid;
