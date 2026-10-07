import React from 'react';
import { useNavigate } from 'react-router-dom';
import { PanelsTopLeft } from 'lucide-react';
import { CENTER_ROUTE } from '../../lib/center/centerPermissions';
import type { UiMode } from '../../lib/center/centerMode';

/** Trạng thái điều hướng báo CenterPage chạy lời chào + chuyển cảnh (chỉ khi vừa bật). */
export const CENTER_INTRO_STATE = { vccIntro: true } as const;

/** Bật / tắt giao diện Trung tâm điều hành rồi đưa người dùng tới đúng trang chính của giao diện đó. */
export const useUiModeSwitch = (setMode: (mode: UiMode) => void) => {
  const navigate = useNavigate();
  return {
    enterCenter: () => { setMode('center'); navigate(CENTER_ROUTE, { state: CENTER_INTRO_STATE }); },
    exitCenter: (options?: { replace?: boolean }) => { setMode('classic'); navigate('/', options); },
  };
};

/**
 * Công tắc "Trung tâm điều hành" (mặc định tắt = giao diện hiện tại).
 * row = dòng có nhãn trong khối người dùng của thanh bên; icon = nút vuông (thanh bên thu gọn, header điện thoại).
 */
const UiModeSwitch: React.FC<{ active: boolean; onChange: (next: boolean) => void; variant?: 'row' | 'icon'; isDark?: boolean }> = ({ active, onChange, variant = 'row', isDark }) => {
  const label = active ? 'Đang dùng Trung tâm điều hành — bấm để về giao diện hiện tại' : 'Chuyển sang giao diện Trung tâm điều hành';
  if (variant === 'icon') {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={active}
        aria-label="Giao diện Trung tâm điều hành"
        title={label}
        onClick={() => onChange(!active)}
        className={`relative flex items-center justify-center w-9 h-9 rounded-lg border transition-colors ${active
          ? 'bg-teal-600 border-teal-600 text-white'
          : isDark ? 'bg-slate-800/50 border-white/10 text-slate-300' : 'bg-white/50 border-white/60 text-slate-600'}`}
      >
        <PanelsTopLeft size={15} />
      </button>
    );
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label="Giao diện Trung tâm điều hành"
      title={label}
      onClick={() => onChange(!active)}
      className={`mt-2 flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${isDark
        ? 'border-white/10 bg-slate-800/50 hover:bg-slate-700/50'
        : 'border-white/60 bg-white/50 hover:bg-white'}`}
    >
      <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-gradient-to-br from-teal-500 to-cyan-600 text-white shadow-sm">
        <PanelsTopLeft size={14} />
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-[12px] font-bold text-slate-700 dark:text-slate-200">Trung tâm điều hành</span>
        <span className="block truncate text-[10px] text-slate-500 dark:text-slate-400">{active ? 'Đang bật' : 'Giao diện mới — thử ngay'}</span>
      </span>
      <span aria-hidden="true" className={`relative h-5 w-9 flex-none rounded-full transition-colors ${active ? 'bg-teal-600' : 'bg-slate-300 dark:bg-slate-600'}`}>
        <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${active ? 'translate-x-4' : ''}`} />
      </span>
    </button>
  );
};

export default UiModeSwitch;
