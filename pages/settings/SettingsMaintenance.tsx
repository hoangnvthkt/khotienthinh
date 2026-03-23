import React from 'react';
import { AlertCircle, Trash2 } from 'lucide-react';

interface SettingsMaintenanceProps {
  triggerAction: (title: string, message: string, type: 'danger' | 'warning' | 'success', actionLabel: string, onConfirm: () => void, countdown?: boolean) => void;
  clearAllData: () => void;
}

const SettingsMaintenance: React.FC<SettingsMaintenanceProps> = ({ triggerAction, clearAllData }) => (
  <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
    <div className="p-6 border-b border-slate-100 bg-red-50/30">
      <h2 className="text-lg font-bold text-red-800 flex items-center">
        <AlertCircle size={20} className="mr-2" /> Khu vực nguy hiểm
      </h2>
      <p className="text-xs text-red-500 font-medium">Các thao tác tại đây không thể hoàn tác. Hãy cẩn trọng.</p>
    </div>
    <div className="p-8 space-y-8">
      <div className="flex flex-col md:flex-row items-center justify-between gap-6 p-6 rounded-2xl border border-red-100 bg-red-50/10">
        <div className="space-y-1 text-center md:text-left">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">Xóa toàn bộ dữ liệu vật tư & giao dịch</h3>
          <p className="text-xs text-slate-500 max-w-md">Xóa sạch danh sách vật tư, lịch sử nhập/xuất kho, yêu cầu vật tư và nhật ký hoạt động. Danh mục kho bãi và người dùng sẽ được giữ lại.</p>
        </div>
        <button
          onClick={() => {
            triggerAction(
              "Xác nhận XÓA SẠCH dữ liệu",
              "Hành động này sẽ xóa toàn bộ vật tư và lịch sử giao dịch. Bạn sẽ không thể khôi phục lại dữ liệu này.",
              'danger',
              'XÓA VĨNH VIỄN',
              () => { clearAllData(); alert("Đã xóa sạch dữ liệu vật tư và giao dịch."); },
              true
            );
          }}
          className="px-6 py-3 bg-red-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-red-700 transition shadow-lg shadow-red-500/20 flex items-center gap-2"
        >
          <Trash2 size={16} /> Xóa dữ liệu
        </button>
      </div>
    </div>
  </div>
);

export default SettingsMaintenance;
