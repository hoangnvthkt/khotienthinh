import React from 'react';
import { Warehouse, WarehouseType, WarehouseTypeConfig } from '../../types';
import { Building, MapPin, Plus, X, Save, Edit2, Trash2, Tags, Palette, CheckCircle2, PauseCircle } from 'lucide-react';

type WarehouseTypeForm = {
  code: string;
  name: string;
  description: string;
  color: string;
  isActive: boolean;
};

interface SettingsWarehousesProps {
  warehouses: Warehouse[];
  warehouseTypes: WarehouseTypeConfig[];
  defaultWarehouseType: WarehouseType;
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
  editingWarehouseType: WarehouseTypeConfig | null;
  warehouseTypeForm: WarehouseTypeForm;
  handleWarehouseTypeFormChange: (patch: Partial<WarehouseTypeForm>) => void;
  handleSaveWarehouseType: (e: React.FormEvent) => void;
  handleEditWarehouseType: (warehouseType: WarehouseTypeConfig) => void;
  handleDeleteWarehouseType: (warehouseType: WarehouseTypeConfig) => void;
  resetWarehouseTypeForm: () => void;
}

const TYPE_COLOR_STYLES: Record<string, { label: string; badge: string; swatch: string; icon: string }> = {
  blue: { label: 'Xanh dương', badge: 'bg-blue-50 text-blue-600 border-blue-100', swatch: 'bg-blue-500', icon: 'bg-blue-50 text-blue-600' },
  orange: { label: 'Cam', badge: 'bg-orange-50 text-orange-600 border-orange-100', swatch: 'bg-orange-500', icon: 'bg-orange-50 text-orange-600' },
  emerald: { label: 'Xanh lá', badge: 'bg-emerald-50 text-emerald-600 border-emerald-100', swatch: 'bg-emerald-500', icon: 'bg-emerald-50 text-emerald-600' },
  violet: { label: 'Tím', badge: 'bg-violet-50 text-violet-600 border-violet-100', swatch: 'bg-violet-500', icon: 'bg-violet-50 text-violet-600' },
  rose: { label: 'Hồng', badge: 'bg-rose-50 text-rose-600 border-rose-100', swatch: 'bg-rose-500', icon: 'bg-rose-50 text-rose-600' },
  amber: { label: 'Vàng', badge: 'bg-amber-50 text-amber-700 border-amber-100', swatch: 'bg-amber-500', icon: 'bg-amber-50 text-amber-700' },
  slate: { label: 'Xám', badge: 'bg-slate-50 text-slate-600 border-slate-200', swatch: 'bg-slate-500', icon: 'bg-slate-50 text-slate-600' },
};

const getTypeColorStyle = (color?: string) => TYPE_COLOR_STYLES[color || 'slate'] || TYPE_COLOR_STYLES.slate;

const SettingsWarehouses: React.FC<SettingsWarehousesProps> = ({
  warehouses, warehouseTypes, defaultWarehouseType,
  isWhModalOpen, setIsWhModalOpen, editingWarehouse, setEditingWarehouse,
  newWhName, setNewWhName, newWhAddress, setNewWhAddress, newWhType, setNewWhType,
  handleAddWarehouse, handleEditWarehouse, handleDeleteWarehouse,
  editingWarehouseType, warehouseTypeForm, handleWarehouseTypeFormChange,
  handleSaveWarehouseType, handleEditWarehouseType, handleDeleteWarehouseType, resetWarehouseTypeForm
}) => {
  const sortedWarehouseTypes = [...warehouseTypes].sort((a, b) => (a.sortOrder ?? 100) - (b.sortOrder ?? 100) || a.name.localeCompare(b.name));
  const selectableWarehouseTypes = sortedWarehouseTypes.filter(type => type.isActive !== false || type.code === newWhType);

  const getWarehouseType = (code: WarehouseType) =>
    sortedWarehouseTypes.find(type => type.code === code) || {
      code,
      name: code,
      color: 'slate',
      isActive: false,
    };

  return (
    <>
      <div className="space-y-6">
        <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex flex-col xl:flex-row xl:items-start gap-6">
            <div className="xl:w-80 flex-shrink-0">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-slate-50 text-slate-500 flex items-center justify-center">
                  <Tags size={20} />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-800">Loại hình kho</h2>
                  <p className="text-xs text-slate-500 font-medium">Danh mục dùng cho phân loại kho bãi.</p>
                </div>
              </div>

              <form onSubmit={handleSaveWarehouseType} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-3">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Mã loại</label>
                    <input
                      type="text"
                      value={warehouseTypeForm.code}
                      disabled={!!editingWarehouseType}
                      onChange={(e) => handleWarehouseTypeFormChange({ code: e.target.value.toUpperCase() })}
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-accent outline-none font-bold text-xs disabled:text-slate-400 disabled:bg-slate-100"
                      placeholder="VD: TEMP"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tên loại</label>
                    <input
                      type="text"
                      value={warehouseTypeForm.name}
                      onChange={(e) => handleWarehouseTypeFormChange({ name: e.target.value })}
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-accent outline-none font-bold text-xs"
                      placeholder="Kho tạm"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Mô tả</label>
                  <textarea
                    value={warehouseTypeForm.description}
                    onChange={(e) => handleWarehouseTypeFormChange({ description: e.target.value })}
                    rows={2}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-accent outline-none resize-none font-medium text-xs"
                    placeholder="Ghi chú ngắn về phạm vi sử dụng"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    <Palette size={12} /> Màu nhãn
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(TYPE_COLOR_STYLES).map(([color, style]) => (
                      <button
                        key={color}
                        type="button"
                        title={style.label}
                        onClick={() => handleWarehouseTypeFormChange({ color })}
                        className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition ${warehouseTypeForm.color === color ? 'border-slate-800 scale-105' : 'border-white shadow-sm'}`}
                      >
                        <span className={`w-5 h-5 rounded-full ${style.swatch}`} />
                      </button>
                    ))}
                  </div>
                </div>

                <label className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
                  <span className="text-xs font-bold text-slate-600">Cho phép chọn khi tạo kho mới</span>
                  <input
                    type="checkbox"
                    checked={warehouseTypeForm.isActive}
                    onChange={(e) => handleWarehouseTypeFormChange({ isActive: e.target.checked })}
                    className="w-4 h-4 accent-blue-600"
                  />
                </label>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <button type="button" onClick={resetWarehouseTypeForm} className="py-3 border border-slate-200 text-slate-500 rounded-xl font-bold text-xs hover:bg-slate-50 transition">
                    Huỷ
                  </button>
                  <button type="submit" className="py-3 bg-slate-800 text-white rounded-xl font-bold text-xs hover:bg-slate-700 transition flex items-center justify-center">
                    <Save size={15} className="mr-2" /> {editingWarehouseType ? 'Cập nhật' : 'Thêm loại'}
                  </button>
                </div>
              </form>
            </div>

            <div className="flex-1 min-w-0">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {sortedWarehouseTypes.map((type) => {
                  const usageCount = warehouses.filter(warehouse => warehouse.type === type.code).length;
                  const style = getTypeColorStyle(type.color);

                  return (
                    <div key={type.code} className="border border-slate-100 rounded-2xl p-4 bg-slate-50/40">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <span className={`text-[9px] font-black px-2 py-1 rounded-lg uppercase border ${style.badge}`}>
                              {type.code}
                            </span>
                            {type.isSystem && (
                              <span className="text-[9px] font-black px-2 py-1 rounded-lg uppercase bg-white text-slate-500 border border-slate-200">
                                Hệ thống
                              </span>
                            )}
                            <span className={`text-[9px] font-black px-2 py-1 rounded-lg uppercase border ${type.isActive === false ? 'bg-slate-100 text-slate-400 border-slate-200' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`}>
                              {type.isActive === false ? 'Tạm tắt' : 'Đang dùng'}
                            </span>
                          </div>
                          <h3 className="font-black text-slate-800 text-sm truncate">{type.name}</h3>
                          {type.description && <p className="text-xs text-slate-500 mt-1 leading-relaxed">{type.description}</p>}
                          <p className="text-[10px] font-bold text-slate-400 mt-3">{usageCount} kho đang dùng</p>
                        </div>
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${style.icon}`}>
                          {type.isActive === false ? <PauseCircle size={18} /> : <CheckCircle2 size={18} />}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 mt-4">
                        <button onClick={() => handleEditWarehouseType(type)} className="py-2 bg-white text-slate-600 rounded-lg text-[10px] font-bold hover:bg-blue-50 hover:text-accent transition-colors flex items-center justify-center border border-slate-100">
                          <Edit2 size={12} className="mr-1" /> Sửa
                        </button>
                        <button onClick={() => handleDeleteWarehouseType(type)} className="py-2 bg-white text-slate-600 rounded-lg text-[10px] font-bold hover:bg-red-50 hover:text-red-600 transition-colors flex items-center justify-center border border-slate-100">
                          <Trash2 size={12} className="mr-1" /> Xoá
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-4">
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
                setNewWhType(defaultWarehouseType);
                setIsWhModalOpen(true);
              }}
              className="flex items-center px-4 py-2 bg-slate-800 text-white rounded-xl hover:bg-slate-700 transition font-bold text-xs"
            >
              <Plus className="w-4 h-4 mr-2" /> Thêm kho
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {warehouses.map((wh) => {
              const warehouseType = getWarehouseType(wh.type);
              const style = getTypeColorStyle(warehouseType.color);

              return (
                <div key={wh.id} className={`bg-white p-5 rounded-2xl shadow-sm border group relative transition-all ${wh.isArchived ? 'opacity-60 border-dashed border-slate-300 bg-slate-50' : 'border-slate-100 hover:border-accent/30'}`}>
                  <div className="flex items-start justify-between mb-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${wh.isArchived ? 'bg-slate-200 text-slate-400' : 'bg-slate-50 text-slate-400 group-hover:text-accent'}`}>
                      <Building size={20} />
                    </div>
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      {wh.isArchived && (
                        <span className="text-[9px] font-black px-2 py-1 rounded-lg uppercase bg-red-50 text-red-600 border border-red-100">
                          Đã lưu trữ (Còn tồn)
                        </span>
                      )}
                      <span className={`text-[9px] font-black px-2 py-1 rounded-lg uppercase border ${style.badge}`}>
                        {warehouseType.name}
                      </span>
                    </div>
                  </div>
                  <h3 className={`font-bold mb-1 ${wh.isArchived ? 'text-slate-500' : 'text-slate-800'}`}>{wh.name}</h3>
                  <div className="flex items-start text-slate-400 text-[11px] leading-relaxed mb-4">
                    <MapPin className="w-3 h-3 mr-1 mt-0.5 flex-shrink-0" />{wh.address}
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
              );
            })}
          </div>
        </section>
      </div>

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
                  {selectableWarehouseTypes.map(type => (
                    <option key={type.code} value={type.code}>{type.name}</option>
                  ))}
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
};

export default SettingsWarehouses;
