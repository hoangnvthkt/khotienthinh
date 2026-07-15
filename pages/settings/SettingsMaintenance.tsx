import React from 'react';
import { AlertCircle, Trash2 } from 'lucide-react';

interface SettingsMaintenanceProps {
  triggerAction: (title: string, message: string, type: 'danger' | 'warning' | 'success', actionLabel: string, onConfirm: () => void | Promise<void>, countdown?: boolean) => void;
  clearAllData: () => Promise<void>;
}

const SettingsMaintenance: React.FC<SettingsMaintenanceProps> = () => {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
    <div className="p-6 border-b border-slate-100 bg-red-50/30">
      <h2 className="text-lg font-bold text-red-800 flex items-center">
        <AlertCircle size={20} className="mr-2" /> Khu vực nguy hiểm
      </h2>
      <p className="text-xs text-red-500 font-medium">Dữ liệu đã posted được bảo vệ bằng ledger bất biến.</p>
    </div>
    <div className="p-8 space-y-8">
      <div className="flex flex-col md:flex-row items-center justify-between gap-6 p-6 rounded-2xl border border-red-100 bg-red-50/10">
        <div className="space-y-1 text-center md:text-left">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">Xóa toàn bộ dữ liệu vật tư & giao dịch</h3>
          <p className="text-xs text-slate-500 max-w-md">Đã vô hiệu hóa xóa hàng loạt. Sai lệch phải đi qua reversal hoặc WMS reconciliation có phê duyệt.</p>
        </div>
        <button
          disabled
          title="Giao dịch posted và ledger không được phép xóa"
          className="px-6 py-3 bg-slate-200 text-slate-500 rounded-xl font-black text-[10px] uppercase tracking-widest cursor-not-allowed flex items-center gap-2"
        >
          <Trash2 size={16} /> Đã khóa để bảo toàn ledger
        </button>
      </div>
    </div>
    </div>
  );
};

export default SettingsMaintenance;
