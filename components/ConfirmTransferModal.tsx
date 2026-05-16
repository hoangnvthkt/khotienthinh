import React from 'react';
import { ArrowRightLeft, X, Check, AlertCircle, Loader2 } from 'lucide-react';
import { InventoryItem, Warehouse } from '../types';

interface ConfirmTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  sourceWarehouse?: Warehouse;
  targetWarehouse?: Warehouse;
  items: { product: InventoryItem; quantity: number }[];
  isLoading?: boolean;
}

const ConfirmTransferModal: React.FC<ConfirmTransferModalProps> = ({ 
  isOpen, 
  onClose, 
  onConfirm, 
  sourceWarehouse, 
  targetWarehouse, 
  items,
  isLoading = false
}) => {
  if (!isOpen) return null;

  const totalQty = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in duration-300">
        {/* Header */}
        <div className="bg-blue-600 p-6 text-white text-center relative">
          <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3 backdrop-blur-md">
            <ArrowRightLeft size={32} className="text-white" />
          </div>
          <h3 className="text-xl font-bold">Xác nhận chuyển kho</h3>
          <p className="text-blue-100 text-sm mt-1 opacity-90">Vui lòng kiểm tra kỹ thông tin trước khi thực hiện</p>
          <button onClick={onClose} className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          <div className="flex items-center justify-between mb-6 bg-slate-50 p-4 rounded-xl border border-slate-100">
            <div className="text-center flex-1">
              <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Từ kho</p>
              <p className="font-bold text-slate-700">{sourceWarehouse?.name}</p>
            </div>
            <div className="px-4 text-blue-500 animate-pulse">
              <ArrowRightLeft size={20} />
            </div>
            <div className="text-center flex-1">
              <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Đến kho</p>
              <p className="font-bold text-blue-600">{targetWarehouse?.name}</p>
            </div>
          </div>

          <div className="space-y-3 mb-6">
            <p className="text-sm font-medium text-slate-600 flex items-center">
              <AlertCircle size={16} className="mr-2 text-blue-500" />
              Bạn đang yêu cầu chuyển <span className="font-bold text-slate-800 mx-1">{totalQty}</span> đơn vị vật tư:
            </p>
            <div className="max-h-48 overflow-y-auto border border-slate-100 rounded-lg divide-y divide-slate-50">
              {items.map((item, idx) => (
                <div key={idx} className="p-3 flex justify-between items-center text-sm">
                  <div>
                    <p className="font-bold text-slate-700">{item.product.name}</p>
                    <p className="text-xs text-slate-400">{item.product.sku}</p>
                  </div>
                  <div className="text-right">
                    <span className="font-mono font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                      {item.quantity} {item.product.unit}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-slate-500 italic text-center mb-6">
            (*) Sau khi xác nhận, tồn kho sẽ được cập nhật tự động tại cả hai kho.
          </p>

          {/* Buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button 
              onClick={onClose}
              disabled={isLoading}
              className="py-3 px-4 border border-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-50 transition-colors"
            >
              Hủy thao tác
            </button>
            <button 
              onClick={onConfirm}
              disabled={isLoading}
              className="py-3 px-4 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors flex items-center justify-center shadow-lg shadow-blue-500/30 disabled:opacity-60"
            >
              {isLoading ? <Loader2 size={20} className="mr-2 animate-spin" /> : <Check size={20} className="mr-2" />} {isLoading ? 'Đang gửi...' : 'Xác nhận chuyển'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfirmTransferModal;
