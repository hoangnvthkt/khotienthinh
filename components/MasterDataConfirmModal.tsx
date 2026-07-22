
import React, { useState, useEffect } from 'react';
import { AlertTriangle, ShieldAlert, Trash2, Save, X, RotateCcw, Loader2 } from 'lucide-react';

interface MasterDataConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message: string;
  type: 'danger' | 'warning' | 'success';
  actionLabel: string;
  countdownRequired?: boolean;
  isLoading?: boolean;
  children?: React.ReactNode;
}

const MasterDataConfirmModal: React.FC<MasterDataConfirmModalProps> = ({ 
  isOpen, onClose, onConfirm, title, message, type, actionLabel, countdownRequired = true, isLoading = false, children
}) => {
  const [timeLeft, setTimeLeft] = useState(6);

  useEffect(() => {
    if (!isOpen) return;
    
    setTimeLeft(countdownRequired ? 6 : 0);
    if (!countdownRequired) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen, countdownRequired]);

  if (!isOpen) return null;

  const typeStyles = {
    danger: {
      bg: 'bg-red-50',
      border: 'border-red-100',
      text: 'text-red-700',
      icon: <Trash2 className="text-red-600" size={32} />,
      button: 'bg-red-600 hover:bg-red-700 shadow-red-500/30'
    },
    warning: {
      bg: 'bg-orange-50',
      border: 'border-orange-100',
      text: 'text-orange-700',
      icon: <ShieldAlert className="text-orange-600" size={32} />,
      button: 'bg-orange-600 hover:bg-orange-700 shadow-orange-500/30'
    },
    success: {
      bg: 'bg-green-50',
      border: 'border-green-100',
      text: 'text-green-700',
      icon: <Save className="text-green-600" size={32} />,
      button: 'bg-green-600 hover:bg-green-700 shadow-green-500/30'
    }
  };

  const style = typeStyles[type];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in duration-300">
        <div className="p-6 flex flex-col items-center text-center">
          <div className={`w-16 h-16 ${style.bg} rounded-full flex items-center justify-center mb-4 border-4 ${style.border}`}>
            {style.icon}
          </div>
          
          <h3 className="text-xl font-bold text-slate-800 mb-2">{title}</h3>
          <p className="text-slate-600 mb-6 leading-relaxed px-4">{message}</p>
          {children && <div className="mb-6 w-full text-left">{children}</div>}
          
          <div className={`${style.bg} p-4 rounded-xl border ${style.border} mb-8 w-full text-left`}>
            <p className="text-[11px] font-bold uppercase tracking-wider mb-2 text-slate-400">Ràng buộc hệ thống:</p>
            <p className="text-[12px] font-medium leading-relaxed">
                Hành động này sẽ cập nhật dữ liệu gốc của toàn bộ hệ thống. Mọi báo cáo, tồn kho liên quan sẽ bị thay đổi theo.
            </p>
          </div>

          {countdownRequired && (
            <div className="w-full h-1.5 bg-slate-100 rounded-full mb-8 overflow-hidden relative">
              <div 
                className={`h-full transition-all duration-1000 ease-linear ${type === 'danger' ? 'bg-red-500' : 'bg-orange-500'}`}
                style={{ width: `${((6 - timeLeft) / 6) * 100}%` }}
              />
            </div>
          )}
          
          <div className="flex gap-3 w-full">
            <button 
              onClick={onClose}
              className="flex-1 py-3 border border-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-50 transition-colors flex items-center justify-center"
            >
              <RotateCcw size={18} className="mr-2" /> Huỷ
            </button>
            <button 
              disabled={timeLeft > 0 || isLoading}
              onClick={onConfirm}
              className={`flex-1 py-3 rounded-xl font-bold transition-all flex items-center justify-center text-white
                ${timeLeft > 0 
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none' 
                  : `${style.button} shadow-lg`
                }`}
            >
              {isLoading ? (
                <>
                  <Loader2 size={18} className="mr-2 animate-spin" /> Đang xử lý...
                </>
              ) : timeLeft > 0 ? (
                <span>Đợi {timeLeft}s...</span>
              ) : (
                <>{actionLabel}</>
              )}
            </button>
          </div>
        </div>
        
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-300 hover:text-slate-500 transition-colors"
        >
          <X size={20} />
        </button>
      </div>
    </div>
  );
};

export default MasterDataConfirmModal;
