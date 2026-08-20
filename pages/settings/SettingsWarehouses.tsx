import React, { useState } from 'react';
import { HrmConstructionSite, Project, Warehouse, WarehouseType, WarehouseTypeConfig } from '../../types';
import { Building, MapPin, Plus, X, Save, Edit2, Trash2, Tags, Palette, CheckCircle2, PauseCircle, Link2, LockKeyhole, Filter } from 'lucide-react';
import { filterProjectsForConstructionSite, getWarehouseBindingLabel, suggestConstructionSiteForWarehouse } from '../../lib/warehouseSiteBinding';

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
  constructionSites: HrmConstructionSite[];
  projects: Project[];
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
  newWhProjectId: string;
  setNewWhProjectId: (v: string) => void;
  newWhConstructionSiteId: string;
  setNewWhConstructionSiteId: (v: string) => void;
  newWhIsDefaultForSite: boolean;
  setNewWhIsDefaultForSite: (v: boolean) => void;
  warehouseBindingBusyId: string | null;
  usedWarehouseIds: Set<string>;
  handleAddWarehouse: (e: React.FormEvent) => void | Promise<void>;
  handleEditWarehouse: (wh: Warehouse) => void;
  handleSuggestWarehouseBinding: (wh: Warehouse, constructionSiteId: string) => void;
  handleSetWarehouseEnforcement: (constructionSiteId: string, enforced: boolean) => void;
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
  warehouses, warehouseTypes, constructionSites, projects, defaultWarehouseType,
  isWhModalOpen, setIsWhModalOpen, editingWarehouse, setEditingWarehouse,
  newWhName, setNewWhName, newWhAddress, setNewWhAddress, newWhType, setNewWhType,
  newWhProjectId, setNewWhProjectId,
  newWhConstructionSiteId, setNewWhConstructionSiteId,
  newWhIsDefaultForSite, setNewWhIsDefaultForSite, warehouseBindingBusyId, usedWarehouseIds,
  handleAddWarehouse, handleEditWarehouse, handleSuggestWarehouseBinding, handleSetWarehouseEnforcement, handleDeleteWarehouse,
  editingWarehouseType, warehouseTypeForm, handleWarehouseTypeFormChange,
  handleSaveWarehouseType, handleEditWarehouseType, handleDeleteWarehouseType, resetWarehouseTypeForm
}) => {
  const [showUnlinkedOnly, setShowUnlinkedOnly] = useState(false);
  const sortedWarehouseTypes = [...warehouseTypes].sort((a, b) => (a.sortOrder ?? 100) - (b.sortOrder ?? 100) || a.name.localeCompare(b.name));
  const selectableWarehouseTypes = sortedWarehouseTypes.filter(type => type.isActive !== false || type.code === newWhType);
  const visibleWarehouses = showUnlinkedOnly
    ? warehouses.filter(warehouse => !warehouse.constructionSiteId)
    : warehouses;
  const selectableProjects = filterProjectsForConstructionSite(projects, newWhConstructionSiteId);
  const editingScopeLocked = Boolean(editingWarehouse && usedWarehouseIds.has(editingWarehouse.id));

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

        <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <LockKeyhole size={19} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Khóa kho theo công trường</h2>
              <p className="text-xs text-slate-500 font-medium">Chỉ bật sau khi công trường có ít nhất một kho SITE hoạt động và đúng một kho mặc định.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {constructionSites.map(site => {
              const linked = warehouses.filter(warehouse => warehouse.constructionSiteId === site.id);
              const eligible = linked.filter(warehouse => warehouse.type === 'SITE' && !warehouse.isArchived);
              const defaultWarehouse = eligible.find(warehouse => warehouse.isDefaultForSite);
              const canEnable = eligible.length > 0 && Boolean(defaultWarehouse);
              const busy = warehouseBindingBusyId === site.id;
              return (
                <div key={site.id} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-black text-slate-800">{site.name}</h3>
                      <p className="mt-1 text-[10px] font-bold text-slate-500">
                        {eligible.length} kho hợp lệ · Mặc định: {defaultWarehouse?.name || 'Chưa chọn'}
                      </p>
                    </div>
                    <span className={`rounded-lg border px-2 py-1 text-[9px] font-black uppercase ${site.warehouseBindingEnforced ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                      {site.warehouseBindingEnforced ? 'Đã khóa' : 'Chưa khóa'}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={busy || (!site.warehouseBindingEnforced && !canEnable)}
                    onClick={() => handleSetWarehouseEnforcement(site.id, !site.warehouseBindingEnforced)}
                    className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black text-slate-700 transition hover:border-indigo-200 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy ? 'Đang cập nhật...' : site.warehouseBindingEnforced ? 'Tắt khóa kho' : 'Bật khóa kho cho công trường'}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex flex-col gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-100 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-800">Danh mục Kho bãi</h2>
              <p className="text-xs text-slate-500 font-medium">Hệ thống quản lý địa điểm lưu trữ.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setShowUnlinkedOnly(value => !value)}
                className={`flex items-center rounded-xl border px-4 py-2 text-xs font-bold transition ${showUnlinkedOnly ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                <Filter className="w-4 h-4 mr-2" /> Kho chưa liên kết
              </button>
              <button
                onClick={() => {
                  setEditingWarehouse(null);
                  setNewWhName('');
                  setNewWhAddress('');
                  setNewWhType(defaultWarehouseType);
                  setNewWhProjectId('');
                  setNewWhConstructionSiteId('');
                  setNewWhIsDefaultForSite(false);
                  setIsWhModalOpen(true);
                }}
                className="flex items-center px-4 py-2 bg-slate-800 text-white rounded-xl hover:bg-slate-700 transition font-bold text-xs"
              >
                <Plus className="w-4 h-4 mr-2" /> Thêm kho
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {visibleWarehouses.map((wh) => {
              const warehouseType = getWarehouseType(wh.type);
              const style = getTypeColorStyle(warehouseType.color);
              const bindingLabel = getWarehouseBindingLabel(wh, constructionSites);
              const linkedSite = constructionSites.find(site => site.id === wh.constructionSiteId);
              const linkedProject = projects.find(project => project.id === wh.projectId);
              const scopeLocked = usedWarehouseIds.has(wh.id);
              const suggestion = suggestConstructionSiteForWarehouse(wh, constructionSites);

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
                      <span className={`text-[9px] font-black px-2 py-1 rounded-lg uppercase border ${bindingLabel === 'Đã khóa' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : bindingLabel === 'Đã liên kết' ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                        {bindingLabel}
                      </span>
                      {scopeLocked && (
                        <span className="text-[9px] font-black px-2 py-1 rounded-lg uppercase border border-violet-200 bg-violet-50 text-violet-700">
                          Đã khóa scope
                        </span>
                      )}
                    </div>
                  </div>
                  <h3 className={`font-bold mb-1 ${wh.isArchived ? 'text-slate-500' : 'text-slate-800'}`}>{wh.name}</h3>
                  <div className="flex items-start text-slate-400 text-[11px] leading-relaxed mb-4">
                    <MapPin className="w-3 h-3 mr-1 mt-0.5 flex-shrink-0" />{wh.address}
                  </div>
                  {linkedSite && (
                    <div className="mb-3 flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-[10px] font-bold text-blue-700">
                      <Link2 size={12} /> {linkedSite.name}{wh.isDefaultForSite ? ' · Kho mặc định' : ''}
                    </div>
                  )}
                  {linkedProject && (
                    <div className="mb-3 flex items-center gap-2 rounded-xl border border-violet-100 bg-violet-50 px-3 py-2 text-[10px] font-bold text-violet-700">
                      <LockKeyhole size={12} /> {linkedProject.code} · {linkedProject.name}
                    </div>
                  )}
                  {suggestion && (
                    <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                      <span className="text-[10px] font-bold text-amber-800">Gợi ý: {suggestion.name}</span>
                      <button type="button" onClick={() => handleSuggestWarehouseBinding(wh, suggestion.id)} className="shrink-0 rounded-lg bg-white px-2 py-1 text-[9px] font-black text-amber-700 shadow-sm">
                        Xác nhận gán
                      </button>
                    </div>
                  )}
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
            {visibleWarehouses.length === 0 && (
              <div className="col-span-full rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-xs font-bold text-slate-400">
                Không có kho chưa liên kết.
              </div>
            )}
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
                <select value={newWhType} disabled={editingScopeLocked} onChange={(e) => {
                  const nextType = e.target.value as WarehouseType;
                  setNewWhType(nextType);
                  if (nextType !== 'SITE') {
                    setNewWhProjectId('');
                    setNewWhConstructionSiteId('');
                    setNewWhIsDefaultForSite(false);
                  }
                }} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-accent outline-none font-bold">
                  {selectableWarehouseTypes.map(type => (
                    <option key={type.code} value={type.code}>{type.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Địa chỉ vật lý</label>
                <textarea value={newWhAddress} onChange={(e) => setNewWhAddress(e.target.value)} rows={3} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-accent outline-none resize-none font-medium text-xs" />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Công trường liên kết</label>
                <select
                  value={newWhConstructionSiteId}
                  disabled={editingScopeLocked || newWhType !== 'SITE'}
                  onChange={event => {
                    setNewWhConstructionSiteId(event.target.value);
                    setNewWhProjectId('');
                    if (!event.target.value) setNewWhIsDefaultForSite(false);
                  }}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-accent outline-none font-bold"
                >
                  <option value="">Chọn công trường</option>
                  {constructionSites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Dự án sở hữu kho</label>
                <select
                  value={newWhProjectId}
                  disabled={editingScopeLocked || newWhType !== 'SITE' || !newWhConstructionSiteId}
                  onChange={event => setNewWhProjectId(event.target.value)}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-accent outline-none font-bold disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="">Chọn dự án thuộc công trường</option>
                  {selectableProjects.map(project => (
                    <option key={project.id} value={project.id}>{project.code} · {project.name}</option>
                  ))}
                </select>
                {editingScopeLocked && (
                  <p className="text-[10px] font-bold text-violet-600">Kho đã phát sinh nghiệp vụ; scope dự án/công trường không thể thay đổi.</p>
                )}
              </div>
              <label className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${newWhType === 'SITE' && newWhConstructionSiteId ? 'cursor-pointer border-blue-100 bg-blue-50' : 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-60'}`}>
                <span>
                  <span className="block text-xs font-black text-slate-700">Kho nhận mặc định</span>
                  <span className="mt-0.5 block text-[10px] font-medium text-slate-500">Tự chọn khi tạo phiếu giao HĐ NCC.</span>
                </span>
                <input
                  type="checkbox"
                  checked={newWhIsDefaultForSite}
                  disabled={newWhType !== 'SITE' || !newWhConstructionSiteId}
                  onChange={event => setNewWhIsDefaultForSite(event.target.checked)}
                  className="h-4 w-4 accent-blue-600"
                />
              </label>
              <div className="pt-2 grid grid-cols-2 gap-3">
                <button type="button" onClick={() => setIsWhModalOpen(false)} className="py-3 border border-slate-200 text-slate-500 rounded-xl font-bold text-xs hover:bg-slate-50 transition">Hủy bỏ</button>
                <button type="submit" disabled={Boolean(warehouseBindingBusyId)} className="py-3 bg-accent text-white rounded-xl font-bold text-xs hover:bg-blue-700 transition shadow-lg shadow-blue-500/20 flex items-center justify-center disabled:cursor-not-allowed disabled:opacity-60">
                  <Save size={16} className="mr-2" /> {warehouseBindingBusyId ? 'Đang lưu...' : editingWarehouse ? 'Cập nhật' : 'Lưu thông tin'}
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
