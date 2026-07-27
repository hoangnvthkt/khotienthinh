import React, { useRef } from 'react';
import {
  Smile,
  Image as ImageIcon,
  Paperclip,
  UserPlus,
  Crop,
  Type,
  MessageSquare,
  AlertCircle,
  ThumbsUp,
  MoreHorizontal
} from 'lucide-react';

interface ZaloInputToolbarProps {
  onSelectImage: (files: FileList) => void;
  onSelectFile: (files: FileList) => void;
  onToggleEmoji: () => void;
  onQuickLike: () => void;
  onSendUrgent?: () => void;
  onOpenCard?: () => void;
}

export const ZaloInputToolbar: React.FC<ZaloInputToolbarProps> = ({
  onSelectImage,
  onSelectFile,
  onToggleEmoji,
  onQuickLike,
  onSendUrgent,
  onOpenCard,
}) => {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex h-10 items-center justify-between border-t border-slate-200 bg-white px-3 dark:border-slate-800 dark:bg-[#1e1f22] select-none">
      {/* Left Icon Toolbar */}
      <div className="flex items-center gap-1">
        {/* Hidden inputs */}
        <input
          type="file"
          ref={imageInputRef}
          accept="image/*"
          multiple
          className="hidden"
          onChange={e => e.target.files && onSelectImage(e.target.files)}
        />
        <input
          type="file"
          ref={fileInputRef}
          multiple
          className="hidden"
          onChange={e => e.target.files && onSelectFile(e.target.files)}
        />

        {/* Emoji picker */}
        <button
          type="button"
          onClick={onToggleEmoji}
          title="Biểu tượng cảm xúc (Sticker / Emoji)"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white transition"
        >
          <Smile size={18} />
        </button>

        {/* Send Image */}
        <button
          type="button"
          onClick={() => imageInputRef.current?.click()}
          title="Gửi hình ảnh"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white transition"
        >
          <ImageIcon size={18} />
        </button>

        {/* Send File */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="Gửi tập tin"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white transition"
        >
          <Paperclip size={18} />
        </button>

        {/* Send Contact / Danh thiếp */}
        <button
          type="button"
          onClick={onOpenCard}
          title="Gửi danh thiếp"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white transition"
        >
          <UserPlus size={18} />
        </button>

        {/* Screenshot tool */}
        <button
          type="button"
          title="Chụp màn hình (Chụp ảnh màn hình)"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white transition"
        >
          <Crop size={18} />
        </button>

        {/* Format Text */}
        <button
          type="button"
          title="Định dạng văn bản"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white transition"
        >
          <Type size={18} />
        </button>

        {/* Template message */}
        <button
          type="button"
          title="Tin nhắn mẫu"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white transition"
        >
          <MessageSquare size={18} />
        </button>

        {/* Urgent message */}
        <button
          type="button"
          onClick={onSendUrgent}
          title="Tin nhắn quan trọng"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-[#0068ff] dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-blue-400 transition"
        >
          <AlertCircle size={18} />
        </button>
      </div>

      {/* Right Quick Actions */}
      <div className="flex items-center gap-1">
        {/* Quick Like ThumbsUp Button (Zalo Signature Blue Thumb) */}
        <button
          type="button"
          onClick={onQuickLike}
          title="Thích nhanh (Thả Like 👍)"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[#0068ff] hover:bg-blue-50 dark:hover:bg-blue-950/40 transition active:scale-125"
        >
          <ThumbsUp size={19} className="fill-[#0068ff]/10" />
        </button>
      </div>
    </div>
  );
};

export default ZaloInputToolbar;
