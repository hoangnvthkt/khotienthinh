import React, { useRef } from 'react';
import { File as FileIcon, Paperclip, Trash2, Upload } from 'lucide-react';
import {
  CONTRACT_ATTACHMENT_ACCEPT,
  createContractAttachmentDrafts,
  type ContractAttachmentDraft,
} from '../../lib/contractAttachmentService';

interface ContractAttachmentDraftPickerProps {
  drafts: ContractAttachmentDraft[];
  onAddDrafts: (drafts: ContractAttachmentDraft[]) => void;
  onRemoveDraft: (draftId: string) => void;
  disabled?: boolean;
  tone?: 'emerald' | 'blue' | 'amber';
}

const TONE_CLASSES = {
  emerald: {
    icon: 'text-emerald-500',
    border: 'border-emerald-200 hover:border-emerald-400 hover:bg-emerald-50/50 dark:border-emerald-800 dark:hover:bg-emerald-900/10',
    badge: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  },
  blue: {
    icon: 'text-blue-500',
    border: 'border-blue-200 hover:border-blue-400 hover:bg-blue-50/50 dark:border-blue-800 dark:hover:bg-blue-900/10',
    badge: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  },
  amber: {
    icon: 'text-amber-500',
    border: 'border-amber-200 hover:border-amber-400 hover:bg-amber-50/50 dark:border-amber-800 dark:hover:bg-amber-900/10',
    badge: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  },
} as const;

const formatFileSize = (size: number) => {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
};

const ContractAttachmentDraftPicker: React.FC<ContractAttachmentDraftPickerProps> = ({
  drafts,
  onAddDrafts,
  onRemoveDraft,
  disabled,
  tone = 'blue',
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const classes = TONE_CLASSES[tone];

  const openPicker = () => {
    inputRef.current?.click();
  };

  const handleFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length > 0) onAddDrafts(createContractAttachmentDrafts(files));
    event.target.value = '';
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="flex items-center gap-2 text-sm font-black text-slate-700 dark:text-slate-200">
          <Paperclip size={15} className={classes.icon} /> Tệp đính kèm
        </h4>
        {drafts.length > 0 && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-black ${classes.badge}`}>
            {drafts.length} file
          </span>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        accept={CONTRACT_ATTACHMENT_ACCEPT}
        onChange={handleFiles}
        disabled={disabled}
      />

      <button
        type="button"
        onClick={openPicker}
        disabled={disabled}
        className={`flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-4 text-sm font-bold text-slate-600 transition disabled:opacity-50 dark:text-slate-300 ${classes.border}`}
      >
        <Upload size={18} className={classes.icon} />
        Tải tệp đính kèm
      </button>

      {drafts.length > 0 && (
        <div className="space-y-2">
          {drafts.map(draft => (
            <div key={draft.id} className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
              <FileIcon size={18} className={`shrink-0 ${classes.icon}`} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-slate-800 dark:text-white">{draft.file.name}</p>
                <p className="text-xs text-slate-400">Tệp đính kèm · {formatFileSize(draft.file.size)}</p>
              </div>
              <button
                type="button"
                onClick={() => onRemoveDraft(draft.id)}
                disabled={disabled}
                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-900/20"
                title="Xóa khỏi danh sách"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

export default ContractAttachmentDraftPicker;
