import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react';

type ReasonConfirmIntent = 'danger' | 'warning' | 'success';

interface ReasonConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void | Promise<void>;
  title?: string;
  targetName: string;
  subtitle?: string;
  warningText?: string;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  actionLabel?: string;
  cancelLabel?: string;
  intent?: ReasonConfirmIntent;
  countdownSeconds?: number;
  isSubmitting?: boolean;
}

const stylesByIntent = {
  danger: {
    iconWrap: 'bg-red-50 dark:bg-red-900/30 border-red-100 dark:border-red-800',
    icon: <AlertTriangle size={30} className="text-red-600" />,
    panel: 'bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-800',
    panelText: 'text-red-700 dark:text-red-400',
    button: 'bg-red-600 text-white hover:bg-red-700 shadow-lg shadow-red-500/30',
    progress: 'bg-red-500',
  },
  warning: {
    iconWrap: 'bg-amber-50 dark:bg-amber-900/30 border-amber-100 dark:border-amber-800',
    icon: <AlertTriangle size={30} className="text-amber-600" />,
    panel: 'bg-amber-50 dark:bg-amber-900/20 border-amber-100 dark:border-amber-800',
    panelText: 'text-amber-700 dark:text-amber-400',
    button: 'bg-amber-600 text-white hover:bg-amber-600 shadow-lg shadow-amber-500/30',
    progress: 'bg-amber-500',
  },
  success: {
    iconWrap: 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-100 dark:border-emerald-800',
    icon: <CheckCircle2 size={30} className="text-emerald-600" />,
    panel: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-800',
    panelText: 'text-emerald-700 dark:text-emerald-400',
    button: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-lg shadow-emerald-500/30',
    progress: 'bg-emerald-500',
  },
};

const ReasonConfirmModal: React.FC<ReasonConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title = 'Xác nhận thao tác',
  targetName,
  subtitle,
  warningText = 'Thao tác này sẽ được ghi nhận vào nhật ký hệ thống.',
  reasonLabel = 'Lý do',
  reasonPlaceholder = 'Nhập lý do để truy vết...',
  actionLabel = 'Xác nhận',
  cancelLabel = 'Huỷ',
  intent = 'warning',
  countdownSeconds = 0,
  isSubmitting = false,
}) => {
  const [timeLeft, setTimeLeft] = useState(countdownSeconds);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const styles = stylesByIntent[intent];

  useEffect(() => {
    if (!isOpen) return;
    setReason('');
    setTouched(false);
    setTimeLeft(countdownSeconds);
    if (countdownSeconds <= 0) return;
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isOpen, countdownSeconds]);

  if (!isOpen) return null;

  const trimmedReason = reason.trim();
  const canSubmit = trimmedReason.length > 0 && timeLeft <= 0 && !isSubmitting;

  const submit = () => {
    setTouched(true);
    if (!canSubmit) return;
    onConfirm(trimmedReason);
  };

  return (
    <div className="fixed inset-0 z-[1210] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-800 animate-in zoom-in duration-300">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-700">
          <div className="flex items-start gap-3">
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-4 ${styles.iconWrap}`}>
              {styles.icon}
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-800 dark:text-white">{title}</h3>
              <p className="mt-1 text-sm font-bold text-slate-600 dark:text-slate-300">{targetName}</p>
              {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-700"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {warningText && (
            <div className={`rounded-xl border px-3 py-2 ${styles.panel}`}>
              <p className={`text-xs font-semibold leading-relaxed ${styles.panelText}`}>{warningText}</p>
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-[10px] font-black uppercase text-slate-400">{reasonLabel}</label>
            <textarea
              rows={4}
              value={reason}
              onChange={event => setReason(event.target.value)}
              onBlur={() => setTouched(true)}
              placeholder={reasonPlaceholder}
              className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            />
            {touched && !trimmedReason && (
              <p className="mt-1 text-xs font-bold text-red-500">Cần nhập lý do để tiếp tục.</p>
            )}
          </div>

          {countdownSeconds > 0 && (
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
              <div
                className={`h-full transition-all duration-1000 ease-linear ${styles.progress}`}
                style={{ width: `${((countdownSeconds - timeLeft) / countdownSeconds) * 100}%` }}
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4 dark:border-slate-700">
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            {cancelLabel}
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className={`inline-flex items-center justify-center rounded-xl px-4 py-2 text-xs font-black transition-colors disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-700 ${styles.button}`}
          >
            {isSubmitting ? (
              <>
                <Loader2 size={14} className="mr-2 animate-spin" /> Đang xử lý...
              </>
            ) : timeLeft > 0 ? (
              `Chờ ${timeLeft}s...`
            ) : (
              actionLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReasonConfirmModal;
