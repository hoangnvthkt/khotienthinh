import React from 'react';
import { Eye, FileText, Image as ImageIcon } from 'lucide-react';
import { SafetyAttachment } from '../../../types';
import { safetyService } from '../../../lib/safetyService';

interface Props {
  attachments?: SafetyAttachment[] | null;
  label: string;
  onPreview?: (attachments: SafetyAttachment[], index: number) => void;
  compact?: boolean;
}

const SafetyAttachmentList: React.FC<Props> = ({ attachments, label, onPreview, compact }) => {
  const rows = (attachments || []).filter(item => item?.url || item?.previewUrl);
  if (rows.length === 0) return null;

  const open = (index: number) => {
    if (onPreview) {
      onPreview(rows, index);
      return;
    }
    const url = rows[index]?.previewUrl || rows[index]?.url;
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className={`${compact ? 'mt-2' : 'mt-3 border-t border-slate-50 pt-2'} space-y-1.5`}>
      <div className="text-[10px] font-black uppercase text-slate-400">{label} ({rows.length})</div>
      <div className="flex flex-wrap gap-1.5">
        {rows.map((file, index) => {
          const isImg = Boolean(safetyService.isImageAttachment(file));
          return (
            <button
              key={`${file.storagePath || file.url || file.name}-${index}`}
              type="button"
              onClick={() => open(index)}
              className="inline-flex max-w-full items-center gap-1 rounded-md border border-slate-100 bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              title={`Xem ${file.name || file.fileName || 'file đính kèm'}`}
            >
              {isImg ? <ImageIcon size={10} /> : <FileText size={10} />}
              <span className="max-w-[140px] truncate">{file.name || file.fileName || 'File đính kèm'}</span>
              <Eye size={10} className="text-slate-400" />
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default SafetyAttachmentList;
