import React, { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Trash2 } from 'lucide-react';

type ConfirmIntent = 'danger' | 'warning' | 'success';

interface ConfirmDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title?: string;
  /** Tên đối tượng cần xác nhận */
  targetName: string;
  /** Thông tin phụ hiển thị bên dưới tên (VD: mã nhân viên, mã tài sản...) */
  subtitle?: string;
  /** Cảnh báo chi tiết bên trong khung đỏ */
  warningText?: string;
  confirmText?: string;
  actionLabel?: string;
  cancelLabel?: string;
  intent?: ConfirmIntent;
  /** Thời gian chờ trước khi nút Xoá được kích hoạt (giây, mặc định 3) */
  countdownSeconds?: number;
  isDeleting?: boolean;
}

const ConfirmDeleteModal: React.FC<ConfirmDeleteModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title = 'Xác nhận xoá',
  targetName,
  subtitle,
  warningText = 'Hành động này không thể hoàn tác. Toàn bộ dữ liệu liên quan cũng sẽ bị xoá.',
  confirmText = 'Bạn có chắc chắn muốn xoá',
  actionLabel,
  cancelLabel = 'Huỷ, giữ lại',
  intent = 'danger',
  countdownSeconds = 3,
  isDeleting = false,
}) => {
  const [timeLeft, setTimeLeft] = useState(countdownSeconds);

  const styles = {
    danger: {
      iconWrap: 'bg-red-50 dark:bg-red-900/30 border-red-100 dark:border-red-800',
      icon: <AlertTriangle size={32} className="text-red-600" />,
      target: 'text-red-600',
      panel: 'bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-800',
      panelText: 'text-red-700 dark:text-red-400',
      progress: 'bg-red-500',
      button: 'bg-red-600 text-white hover:bg-red-700 shadow-lg shadow-red-500/30',
      defaultActionLabel: 'Xoá vĩnh viễn',
      loadingLabel: 'Đang xoá...',
      actionIcon: <Trash2 size={18} className="mr-2" />,
    },
    warning: {
      iconWrap: 'bg-amber-50 dark:bg-amber-900/30 border-amber-100 dark:border-amber-800',
      icon: <AlertTriangle size={32} className="text-amber-600" />,
      target: 'text-amber-700 dark:text-amber-400',
      panel: 'bg-amber-50 dark:bg-amber-900/20 border-amber-100 dark:border-amber-800',
      panelText: 'text-amber-700 dark:text-amber-400',
      progress: 'bg-amber-500',
      button: 'bg-amber-600 text-white hover:bg-amber-700 shadow-lg shadow-amber-500/30',
      defaultActionLabel: 'Xác nhận',
      loadingLabel: 'Đang xử lý...',
      actionIcon: <AlertTriangle size={18} className="mr-2" />,
    },
    success: {
      iconWrap: 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-100 dark:border-emerald-800',
      icon: <CheckCircle2 size={32} className="text-emerald-600" />,
      target: 'text-emerald-700 dark:text-emerald-400',
      panel: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-800',
      panelText: 'text-emerald-700 dark:text-emerald-400',
      progress: 'bg-emerald-500',
      button: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-lg shadow-emerald-500/30',
      defaultActionLabel: 'Xác nhận',
      loadingLabel: 'Đang xử lý...',
      actionIcon: <CheckCircle2 size={18} className="mr-2" />,
    },
  }[intent];

  useEffect(() => {
    if (!isOpen) return;
    setTimeLeft(countdownSeconds);
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) { clearInterval(timer); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isOpen, countdownSeconds]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in duration-300">
        <div className="p-6 flex flex-col items-center text-center">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 border-4 ${styles.iconWrap}`}>
            {styles.icon}
          </div>

          <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-2">{title}</h3>

          <p className="text-slate-600 dark:text-slate-300 mb-2 leading-relaxed">
            {confirmText} <span className={`font-bold ${styles.target}`}>"{targetName}"</span>?
          </p>

          {subtitle && (
            <p className="text-[11px] text-slate-400 mb-1">{subtitle}</p>
          )}

          <div className={`p-3 rounded-lg border mb-6 w-full ${styles.panel}`}>
            <p className={`text-xs font-medium ${styles.panelText}`}>
              {warningText}
            </p>
          </div>

          <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full mb-6 overflow-hidden">
            <div
              className={`h-full transition-all duration-1000 ease-linear ${styles.progress}`}
              style={{ width: countdownSeconds > 0 ? `${((countdownSeconds - timeLeft) / countdownSeconds) * 100}%` : '100%' }}
            />
          </div>

          <div className="flex gap-3 w-full">
            <button
              onClick={onClose}
              className="flex-1 py-3 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              {cancelLabel}
            </button>
            <button
              disabled={timeLeft > 0 || isDeleting}
              onClick={onConfirm}
              className={`flex-1 py-3 rounded-xl font-bold transition-all flex items-center justify-center ${
                timeLeft > 0
                  ? 'bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed'
                  : styles.button
              }`}
            >
              {isDeleting ? (
                <>
                  <Loader2 size={18} className="mr-2 animate-spin" /> {styles.loadingLabel}
                </>
              ) : timeLeft > 0 ? (
                <span>Chờ {timeLeft}s...</span>
              ) : (
                <>
                  {styles.actionIcon} {actionLabel || styles.defaultActionLabel}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDeleteModal;
