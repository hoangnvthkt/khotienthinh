import React, { useRef, useState } from 'react';
import { Image as ImageIcon, Paperclip, Upload, X } from 'lucide-react';
import { SafetyAttachment } from '../../../types';
import { safetyService } from '../../../lib/safetyService';

interface Props {
  projectId: string;
  recordType: string;
  recordId: string;
  attachments: SafetyAttachment[];
  onChange: (attachments: SafetyAttachment[]) => void;
  uploadedBy?: string;
  imageOnly?: boolean;
  label?: string;
}

const isImage = (item: SafetyAttachment) =>
  String(item.fileType || item.name || '').toLowerCase().match(/image|\.png|\.jpe?g|\.webp|\.gif/);

const SafetyAttachmentUploader: React.FC<Props> = ({
  projectId,
  recordType,
  recordId,
  attachments,
  onChange,
  uploadedBy,
  imageOnly = false,
  label = 'Tệp đính kèm',
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const uploaded: SafetyAttachment[] = [];
      for (const file of Array.from(files)) {
        uploaded.push(await safetyService.uploadAttachment({
          projectId,
          recordType,
          recordId,
          file,
          uploadedBy,
          category: imageOnly ? 'photo' : 'attachment',
        }));
      }
      onChange([...attachments, ...uploaded]);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = (index: number) => {
    onChange(attachments.filter((_, idx) => idx !== index));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-black uppercase text-slate-400">{label}</div>
          <div className="text-[11px] font-bold text-slate-500">{attachments.length} mục đã thêm</div>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          <Upload size={14} /> {uploading ? 'Đang tải...' : imageOnly ? 'Thêm ảnh' : 'Thêm file'}
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={imageOnly ? 'image/*' : undefined}
        className="hidden"
        onChange={event => handleFiles(event.target.files)}
      />
      {attachments.length > 0 && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {attachments.map((item, index) => (
            <div key={`${item.storagePath || item.url}-${index}`} className="group relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
              {isImage(item) && item.url ? (
                <img src={item.previewUrl || item.url} alt={item.name} className="h-24 w-full object-cover" />
              ) : (
                <div className="flex h-24 flex-col items-center justify-center gap-2 text-slate-400">
                  {isImage(item) ? <ImageIcon size={20} /> : <Paperclip size={20} />}
                  <span className="max-w-full truncate px-2 text-[10px] font-bold">{item.name}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => remove(index)}
                className="absolute right-1 top-1 rounded-full bg-white/90 p-1 text-slate-500 opacity-100 shadow-sm hover:text-red-600 md:opacity-0 md:group-hover:opacity-100"
                title="Gỡ khỏi hồ sơ"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SafetyAttachmentUploader;
