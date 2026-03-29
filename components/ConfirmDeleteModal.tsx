import React, { useState, useEffect } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';

interface ConfirmDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  /** Tên đối tượng sẽ bị xoá (hiện màu đỏ đậm) */
  targetName: string;
  /** Thông tin phụ hiển thị bên dưới tên (VD: mã nhân viên, mã tài sản...) */
  subtitle?: string;
  /** Cảnh báo chi tiết bên trong khung đỏ */
  warningText?: string;
  /** Thời gian chờ trước khi nút Xoá được kích hoạt (giây, mặc định 3) */
  countdownSeconds?: number;
}

const ConfirmDeleteModal: React.FC<ConfirmDeleteModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title = 'Xác nhận xoá',
  targetName,
  subtitle,
  warningText = 'Hành động này không thể hoàn tác. Toàn bộ dữ liệu liên quan cũng sẽ bị xoá.',
  countdownSeconds = 3,
}) => {
  const [timeLeft, setTimeLeft] = useState(countdownSeconds);

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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in duration-300">
        <div className="p-6 flex flex-col items-center text-center">
          <div className="w-16 h-16 bg-red-50 dark:bg-red-900/30 rounded-full flex items-center justify-center mb-4 border-4 border-red-100 dark:border-red-800">
            <AlertTriangle size={32} className="text-red-600" />
          </div>

          <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-2">{title}</h3>

          <p className="text-slate-600 dark:text-slate-300 mb-2 leading-relaxed">
            Bạn có chắc chắn muốn xoá <span className="font-bold text-red-600">"{targetName}"</span>?
          </p>

          {subtitle && (
            <p className="text-[11px] text-slate-400 mb-1">{subtitle}</p>
          )}

          <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-100 dark:border-red-800 mb-6 w-full">
            <p className="text-xs text-red-700 dark:text-red-400 font-medium">
              ⚠️ {warningText}
            </p>
          </div>

          <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full mb-6 overflow-hidden">
            <div
              className="h-full bg-red-500 transition-all duration-1000 ease-linear"
              style={{ width: `${((countdownSeconds - timeLeft) / countdownSeconds) * 100}%` }}
            />
          </div>

          <div className="flex gap-3 w-full">
            <button
              onClick={onClose}
              className="flex-1 py-3 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              Huỷ, giữ lại
            </button>
            <button
              disabled={timeLeft > 0}
              onClick={onConfirm}
              className={`flex-1 py-3 rounded-xl font-bold transition-all flex items-center justify-center ${
                timeLeft > 0
                  ? 'bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed'
                  : 'bg-red-600 text-white hover:bg-red-700 shadow-lg shadow-red-500/30'
              }`}
            >
              {timeLeft > 0 ? (
                <span>Chờ {timeLeft}s...</span>
              ) : (
                <>
                  <Trash2 size={18} className="mr-2" /> Xoá vĩnh viễn
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
