import React from 'react';
import { Warehouse, WarehouseType } from '../../types';
import { Building, MapPin, Plus, X, Save, Edit2, Trash2 } from 'lucide-react';

interface SettingsWarehousesProps {
  warehouses: Warehouse[];
  isWhModalOpen: boolean;
  setIsWhModalOpen: (v: boolean) => void;
  editingWarehouse: Warehouse | null;
  setEditingWarehouse: (v: Warehouse | null) => void;
  newWhName: string;
  setNewWhName: (v: string) => void;
  newWhAddress: string;
  setNewWhAddress: (v: string) => void;
  newWhType: WarehouseType;
  setNewWhType: (v: WarehouseType) => void;
  handleAddWarehouse: (e: React.FormEvent) => void;
  handleEditWarehouse: (wh: Warehouse) => void;
  handleDeleteWarehouse: (wh: Warehouse) => void;
}

const SettingsWarehouses: React.FC<SettingsWarehousesProps> = ({
  warehouses, isWhModalOpen, setIsWhModalOpen, editingWarehouse, setEditingWarehouse,
  newWhName, setNewWhName, newWhAddress, setNewWhAddress, newWhType, setNewWhType,
  handleAddWarehouse, handleEditWarehouse, handleDeleteWarehouse
}) => (
  <>
    <div className="space-y-4">
      <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Danh mục Kho bãi</h2>
          <p className="text-xs text-slate-500 font-medium">Hệ thống quản lý địa điểm lưu trữ.</p>
        </div>
        <button
          onClick={() => {
            setEditingWarehouse(null);
            setNewWhName('');
            setNewWhAddress('');
            setNewWhType('SITE');
            setIsWhModalOpen(true);
          }}
          className="flex items-center px-4 py-2 bg-slate-800 text-white rounded-xl hover:bg-slate-700 transition font-bold text-xs"
        >
          <Plus className="w-4 h-4 mr-2" /> Thêm kho
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {warehouses.map((wh) => (
          <div key={wh.id} className={`bg-white p-5 rounded-2xl shadow-sm border group relative transition-all ${wh.isArchived ? 'opacity-60 border-dashed border-slate-300 bg-slate-50' : 'border-slate-100 hover:border-accent/30'}`}>
            <div className="flex items-start justify-between mb-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${wh.isArchived ? 'bg-slate-200 text-slate-400' : 'bg-slate-50 text-slate-400 group-hover:text-accent'}`}>
                <Building size={20} />
              </div>
              <div className="flex items-center gap-2">
                {wh.isArchived && (
                  <span className="text-[9px] font-black px-2 py-1 rounded-lg uppercase bg-red-50 text-red-600 border border-red-100">
                    Đã lưu trữ (Còn tồn)
                  </span>
                )}
                <span className={`text-[9px] font-black px-2 py-1 rounded-lg uppercase border ${wh.type === 'GENERAL' ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-orange-50 text-orange-600 border-orange-100'}`}>
                  {wh.type === 'GENERAL' ? 'Kho Tổng' : 'Công trình'}
                </span>
              </div>
            </div>
            <h3 className={`font-bold mb-1 ${wh.isArchived ? 'text-slate-500' : 'text-slate-800'}`}>{wh.name}</h3>
            <div className="flex items-start text-slate-400 text-[11px] leading-relaxed mb-4">
              <MapPin className="w-3 h-3 mr-1 mt-0.5" />{wh.address}
            </div>
            <div className="flex gap-2 pt-3 border-t border-slate-50 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => handleEditWarehouse(wh)} className="flex-1 py-2 bg-slate-50 text-slate-600 rounded-lg text-[10px] font-bold hover:bg-blue-50 hover:text-accent transition-colors flex items-center justify-center">
                <Edit2 size={12} className="mr-1" /> Chỉnh sửa
              </button>
              <button onClick={() => handleDeleteWarehouse(wh)} className="flex-1 py-2 bg-slate-50 text-slate-600 rounded-lg text-[10px] font-bold hover:bg-red-50 hover:text-red-600 transition-colors flex items-center justify-center">
                <Trash2 size={12} className="mr-1" /> Xoá kho
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>

    {/* Warehouse Modal */}
    {isWhModalOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
        <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50">
            <h3 className="font-black text-xs uppercase tracking-widest text-slate-800">
              {editingWarehouse ? 'Cập nhật kho bãi' : 'Thêm kho bãi mới'}
            </h3>
            <button onClick={() => setIsWhModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
          </div>
          <form onSubmit={handleAddWarehouse} className="p-6 space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tên kho nhận diện</label>
              <input type="text" value={newWhName} onChange={(e) => setNewWhName(e.target.value)} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-accent outline-none font-bold" />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Loại hình kho</label>
              <select value={newWhType} onChange={(e) => setNewWhType(e.target.value as WarehouseType)} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-accent outline-none font-bold">
                <option value="SITE">Kho Công Trình</option>
                <option value="GENERAL">Kho Tổng</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Địa chỉ vật lý</label>
              <textarea value={newWhAddress} onChange={(e) => setNewWhAddress(e.target.value)} rows={3} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-accent outline-none resize-none font-medium text-xs" />
            </div>
            <div className="pt-2 grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setIsWhModalOpen(false)} className="py-3 border border-slate-200 text-slate-500 rounded-xl font-bold text-xs hover:bg-slate-50 transition">Hủy bỏ</button>
              <button type="submit" className="py-3 bg-accent text-white rounded-xl font-bold text-xs hover:bg-blue-700 transition shadow-lg shadow-blue-500/20 flex items-center justify-center">
                <Save size={16} className="mr-2" /> {editingWarehouse ? 'Cập nhật' : 'Lưu thông tin'}
              </button>
            </div>
          </form>
        </div>
      </div>
    )}
  </>
);

export default SettingsWarehouses;
