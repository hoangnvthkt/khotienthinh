
import React, { useState, useEffect } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import { User } from '../types';

interface DeleteUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  targetUser: User | null;
}

const DeleteUserModal: React.FC<DeleteUserModalProps> = ({ isOpen, onClose, onConfirm, targetUser }) => {
  const [timeLeft, setTimeLeft] = useState(6);

  useEffect(() => {
    if (!isOpen) return;
    
    setTimeLeft(6);
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
  }, [isOpen]);

  if (!isOpen || !targetUser) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in duration-300">
        <div className="p-6 flex flex-col items-center text-center">
          <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-4 border-4 border-red-100">
            <AlertTriangle size={32} className="text-red-600" />
          </div>
          
          <h3 className="text-xl font-bold text-slate-800 mb-2">Xác nhận xoá nhân sự</h3>
          <p className="text-slate-600 mb-2 leading-relaxed">
            Bạn có chắc chắn muốn xoá tài khoản của <span className="font-bold text-red-600">"{targetUser.name}"</span>?
          </p>
          <div className="bg-red-50 p-3 rounded-lg border border-red-100 mb-8 w-full">
            <p className="text-xs text-red-700 font-medium">
              Hành động này không thể hoàn tác. Mọi quyền truy cập của nhân viên này sẽ bị tước bỏ ngay lập tức.
            </p>
          </div>

          <div className="w-full h-1.5 bg-slate-100 rounded-full mb-8 overflow-hidden">
            <div 
              className="h-full bg-red-500 transition-all duration-1000 ease-linear"
              style={{ width: `${((6 - timeLeft) / 6) * 100}%` }}
            />
          </div>
          
          <div className="flex gap-3 w-full">
            <button 
              onClick={onClose}
              className="flex-1 py-3 border border-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-50 transition-colors"
            >
              Huỷ, giữ lại
            </button>
            <button 
              disabled={timeLeft > 0}
              onClick={onConfirm}
              className={`flex-1 py-3 rounded-xl font-bold transition-all flex items-center justify-center
                ${timeLeft > 0 
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed' 
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
        
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
        >
          <X size={20} />
        </button>
      </div>
    </div>
  );
};

export default DeleteUserModal;
