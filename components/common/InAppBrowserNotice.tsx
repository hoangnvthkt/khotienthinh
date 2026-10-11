import React, { useState } from 'react';
import { Copy, ExternalLink } from 'lucide-react';
import { chromeIntentUrl } from '../../lib/attendancePasskey';

/**
 * Vioo đang mở trong trình duyệt của Zalo / Facebook…: không giữ đăng nhập, không nhớ quyền
 * camera / vị trí, không có vân tay / Face ID. Đưa người dùng sang Chrome / Safari.
 */
const InAppBrowserNotice: React.FC<{
  appName: string;
  isIos: boolean;
  /** Đường dẫn trong app (hash route), ví dụ "/hrm/checkin". */
  path: string;
  message?: string;
  dark?: boolean;
}> = ({ appName, isIos, path, message, dark = false }) => {
  const [copied, setCopied] = useState(false);
  const browser = isIos ? 'Safari' : 'Chrome';
  const link = `${window.location.origin}/#${path}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      window.prompt(`Sao chép đường dẫn này rồi dán vào ${browser}:`, link);
    }
  };

  return (
    <div className={`space-y-2 rounded-xl border p-3 ${dark
      ? 'border-amber-300/30 bg-amber-400/10 text-amber-100'
      : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200'}`}
    >
      <p className="text-xs font-bold">
        {message || `Bạn đang mở Vioo trong ${appName}: đăng nhập và quyền camera / vị trí không được lưu. Hãy mở bằng ${browser}.`}
      </p>
      <div className="flex gap-2">
        {!isIos && (
          <a
            href={chromeIntentUrl(window.location.origin)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-leaf-600 px-3 py-2.5 text-xs font-black text-white active:scale-[0.98]"
          >
            <ExternalLink size={14} /> Mở bằng Chrome
          </a>
        )}
        <button
          type="button"
          onClick={() => void copyLink()}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-xs font-bold ${dark
            ? 'border-white/20 text-white'
            : 'border-amber-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'}`}
        >
          <Copy size={14} /> {copied ? `Đã sao chép, dán vào ${browser}` : 'Sao chép đường dẫn'}
        </button>
      </div>
      <p className="text-[11px] font-semibold opacity-80">
        Hoặc bấm {isIos ? '•••' : '⋮'} ở góc trên → “Mở bằng trình duyệt”.
      </p>
    </div>
  );
};

export default InAppBrowserNotice;
