
import React, { useState, useEffect } from 'react';
import { AlertTriangle, Loader2, Trash2, X } from 'lucide-react';
import { InventoryItem } from '../types';

interface DeleteInventoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  targetItem: InventoryItem | null;
  isDeleting?: boolean;
}

const DeleteInventoryModal: React.FC<DeleteInventoryModalProps> = ({ isOpen, onClose, onConfirm, targetItem, isDeleting = false }) => {
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

  if (!isOpen || !targetItem) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in duration-300">
        <div className="p-6 flex flex-col items-center text-center">
          <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-4 border-4 border-red-100 text-red-600">
            <AlertTriangle size={32} />
          </div>
          
          <h3 className="text-xl font-bold text-slate-800 mb-2">Xoá vật tư vĩnh viễn</h3>
          <p className="text-slate-600 mb-2 leading-relaxed">
            Bạn có chắc chắn muốn xoá vật tư <span className="font-bold text-red-600">"{targetItem.name}"</span>?
          </p>
          <div className="bg-red-50 p-3 rounded-lg border border-red-100 mb-8 w-full text-left">
            <p className="text-[11px] text-red-700 font-medium">
                Hành động này sẽ:
                <br />• Gỡ bỏ danh mục vật tư khỏi toàn hệ thống.
                <br />• Làm biến mất số liệu tồn kho tại mọi kho bãi.
                <br />• Không thể hoàn tác sau khi xác nhận.
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
              disabled={timeLeft > 0 || isDeleting}
              onClick={onConfirm}
              className={`flex-1 py-3 rounded-xl font-bold transition-all flex items-center justify-center
                ${timeLeft > 0 
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed' 
                  : 'bg-red-600 text-white hover:bg-red-700 shadow-lg shadow-red-500/30'
                }`}
            >
              {isDeleting ? (
                <>
                  <Loader2 size={18} className="mr-2 animate-spin" /> Đang xoá...
                </>
              ) : timeLeft > 0 ? (
                <span>Chờ {timeLeft}s...</span>
              ) : (
                <>
                  <Trash2 size={18} className="mr-2" /> Xoá ngay
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

export default DeleteInventoryModal;
