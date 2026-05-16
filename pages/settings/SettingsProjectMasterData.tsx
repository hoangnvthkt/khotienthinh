import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Edit2, FolderKanban, Layers, Plus, Save, Tags, Trash2, X } from 'lucide-react';
import { Project, ProjectGroup, ProjectMasterCategory, ProjectSector, ProjectTypeMaster } from '../../types';
import { projectMasterDataService } from '../../lib/projectMasterDataService';
import { projectMasterService } from '../../lib/projectMasterService';

type CategoryKind = 'groups' | 'types' | 'sectors';
type CategoryItem = ProjectGroup | ProjectTypeMaster | ProjectSector;

const KIND_CONFIG: Record<CategoryKind, {
  label: string;
  desc: string;
  icon: React.ElementType;
  color: string;
  idField: keyof Project;
}> = {
  groups: {
    label: 'Nhóm dự án',
    desc: 'Gom dự án theo portfolio, chi nhánh, chủ đầu tư hoặc gói triển khai.',
    icon: FolderKanban,
    color: 'orange',
    idField: 'projectGroupId',
  },
  types: {
    label: 'Loại dự án',
    desc: 'Chuẩn hoá loại dự án để lọc, báo cáo và khởi tạo cấu hình mặc định.',
    icon: Layers,
    color: 'blue',
    idField: 'projectTypeId',
  },
  sectors: {
    label: 'Lĩnh vực',
    desc: 'Phân loại lĩnh vực thi công như dân dụng, công nghiệp, MEP, giao thông.',
    icon: Tags,
    color: 'emerald',
    idField: 'projectSectorId',
  },
};

const emptyDraft = (): ProjectMasterCategory => ({
  id: '',
  code: '',
  name: '',
  description: '',
  sortOrder: 0,
  isActive: true,
});

const colorClasses: Record<string, { icon: string; button: string; ring: string }> = {
  orange: { icon: 'bg-orange-50 text-orange-600', button: 'bg-orange-500 hover:bg-orange-600', ring: 'focus:ring-orange-400' },
  blue: { icon: 'bg-blue-50 text-blue-600', button: 'bg-blue-500 hover:bg-blue-600', ring: 'focus:ring-blue-400' },
  emerald: { icon: 'bg-emerald-50 text-emerald-600', button: 'bg-emerald-500 hover:bg-emerald-600', ring: 'focus:ring-emerald-400' },
};

const SettingsProjectMasterData: React.FC = () => {
  const [activeKind, setActiveKind] = useState<CategoryKind | null>(null);
  const [groups, setGroups] = useState<ProjectGroup[]>([]);
  const [types, setTypes] = useState<ProjectTypeMaster[]>([]);
  const [sectors, setSectors] = useState<ProjectSector[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<ProjectMasterCategory>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [groupRows, typeRows, sectorRows, projectRows] = await Promise.all([
        projectMasterDataService.listGroups(),
        projectMasterDataService.listTypes(),
        projectMasterDataService.listSectors(),
        projectMasterService.list(),
      ]);
      setGroups(groupRows);
      setTypes(typeRows);
      setSectors(sectorRows);
      setProjects(projectRows);
    } catch (error: any) {
      alert(`Không tải được danh mục dự án: ${error?.message || 'Lỗi không xác định'}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const itemsByKind: Record<CategoryKind, CategoryItem[]> = useMemo(() => ({
    groups,
    types,
    sectors,
  }), [groups, types, sectors]);

  const getUsageCount = useCallback((kind: CategoryKind, itemId: string): number => {
    const field = KIND_CONFIG[kind].idField;
    return projects.filter(project => project[field] === itemId).length;
  }, [projects]);

  const resetDraft = () => {
    setDraft(emptyDraft());
    setEditingId(null);
  };

  const openEdit = (item: CategoryItem) => {
    setDraft({ ...item });
    setEditingId(item.id);
  };

  const save = async () => {
    if (!activeKind || !draft.name.trim()) return;
    setSaving(true);
    try {
      if (activeKind === 'groups') {
        if (editingId) await projectMasterDataService.updateGroup(draft as ProjectGroup);
        else await projectMasterDataService.createGroup(draft);
      } else if (activeKind === 'types') {
        if (editingId) await projectMasterDataService.updateType(draft as ProjectTypeMaster);
        else await projectMasterDataService.createType(draft);
      } else {
        if (editingId) await projectMasterDataService.updateSector(draft as ProjectSector);
        else await projectMasterDataService.createSector(draft);
      }
      resetDraft();
      await load();
    } catch (error: any) {
      alert(`Không lưu được danh mục: ${error?.message || 'Lỗi không xác định'}`);
    } finally {
      setSaving(false);
    }
  };

  const setActive = async (kind: CategoryKind, item: CategoryItem, isActive: boolean) => {
    const next = { ...item, isActive };
    try {
      if (kind === 'groups') await projectMasterDataService.updateGroup(next as ProjectGroup);
      else if (kind === 'types') await projectMasterDataService.updateType(next as ProjectTypeMaster);
      else await projectMasterDataService.updateSector(next as ProjectSector);
      await load();
    } catch (error: any) {
      alert(`Không cập nhật trạng thái: ${error?.message || 'Lỗi không xác định'}`);
    }
  };

  const removeOrArchive = async (kind: CategoryKind, item: CategoryItem) => {
    const used = getUsageCount(kind, item.id);
    const actionLabel = used > 0 ? 'ẩn' : 'xoá';
    if (!confirm(`Bạn muốn ${actionLabel} "${item.name}"?${used > 0 ? ` Danh mục này đang được ${used} dự án sử dụng.` : ''}`)) return;
    try {
      if (used > 0) {
        if (kind === 'groups') await projectMasterDataService.archiveGroup(item.id);
        else if (kind === 'types') await projectMasterDataService.archiveType(item.id);
        else await projectMasterDataService.archiveSector(item.id);
      } else {
        try {
          if (kind === 'groups') await projectMasterDataService.removeGroup(item.id);
          else if (kind === 'types') await projectMasterDataService.removeType(item.id);
          else await projectMasterDataService.removeSector(item.id);
        } catch {
          if (kind === 'groups') await projectMasterDataService.archiveGroup(item.id);
          else if (kind === 'types') await projectMasterDataService.archiveType(item.id);
          else await projectMasterDataService.archiveSector(item.id);
        }
      }
      if (editingId === item.id) resetDraft();
      await load();
    } catch (error: any) {
      alert(`Không xử lý được danh mục: ${error?.message || 'Lỗi không xác định'}`);
    }
  };

  if (!activeKind) {
    return (
      <div className="animate-in slide-in-from-right-4 duration-300">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {(Object.keys(KIND_CONFIG) as CategoryKind[]).map(kind => {
            const cfg = KIND_CONFIG[kind];
            const Icon = cfg.icon;
            const classes = colorClasses[cfg.color];
            return (
              <button
                key={kind}
                onClick={() => setActiveKind(kind)}
                className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm hover:shadow-xl hover:border-slate-200 transition-all group text-left"
              >
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform ${classes.icon}`}>
                  <Icon size={28} />
                </div>
                <h3 className="text-xl font-black text-slate-800 mb-2">{cfg.label}</h3>
                <p className="text-sm text-slate-500 font-medium">{cfg.desc}</p>
                <div className="mt-6 flex items-center justify-between">
                  <span className="text-slate-700 font-bold text-xs uppercase tracking-widest flex items-center">
                    Thiết lập ngay <Plus size={14} className="ml-1" />
                  </span>
                  <span className="text-xs font-black text-slate-400 bg-slate-100 px-2 py-1 rounded-lg">
                    {itemsByKind[kind].length} mục
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const cfg = KIND_CONFIG[activeKind];
  const Icon = cfg.icon;
  const classes = colorClasses[cfg.color];
  const items = itemsByKind[activeKind];

  return (
    <div className="animate-in slide-in-from-right-4 duration-300">
      <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden min-h-[600px]">
        <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => { setActiveKind(null); resetDraft(); }}
              className="p-2 hover:bg-white rounded-xl text-slate-400 hover:text-slate-800 transition-all border border-transparent hover:border-slate-200"
            >
              <X size={20} />
            </button>
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${classes.icon}`}>
              <Icon size={20} />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-800">Quản lý {cfg.label}</h2>
              <p className="text-xs text-slate-500 font-medium">Thêm, sửa, ẩn hoặc xoá danh mục dự án.</p>
            </div>
          </div>
          {loading && <span className="text-xs font-bold text-slate-400">Đang tải...</span>}
        </div>

        <div className="p-8 grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-6">
          <div className="bg-slate-50 p-5 rounded-3xl border border-slate-200 space-y-4 h-fit">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">
              {editingId ? `Cập nhật ${cfg.label}` : `Thêm ${cfg.label} mới`}
            </h3>
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Tên</label>
              <input
                value={draft.name}
                onChange={e => setDraft(prev => ({ ...prev, name: e.target.value }))}
                placeholder={`Nhập ${cfg.label.toLowerCase()}...`}
                className={`w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 ${classes.ring}`}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Mã</label>
                <input
                  value={draft.code || ''}
                  onChange={e => setDraft(prev => ({ ...prev, code: e.target.value }))}
                  placeholder="Tự sinh nếu trống"
                  className={`w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 ${classes.ring}`}
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Thứ tự</label>
                <input
                  type="number"
                  value={draft.sortOrder}
                  onChange={e => setDraft(prev => ({ ...prev, sortOrder: Number(e.target.value) || 0 }))}
                  className={`w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 ${classes.ring}`}
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Mô tả</label>
              <textarea
                rows={3}
                value={draft.description || ''}
                onChange={e => setDraft(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Mô tả ngắn..."
                className={`w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 resize-none ${classes.ring}`}
              />
            </div>
            <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={e => setDraft(prev => ({ ...prev, isActive: e.target.checked }))}
                className="rounded border-slate-300"
              />
              Đang sử dụng
            </label>
            <div className="flex gap-2">
              {editingId && (
                <button
                  onClick={resetDraft}
                  className="px-4 py-3 rounded-2xl border border-slate-200 text-xs font-black text-slate-500 hover:bg-white transition"
                >
                  Hủy
                </button>
              )}
              <button
                onClick={save}
                disabled={!draft.name.trim() || saving}
                className={`flex-1 px-5 py-3 rounded-2xl text-xs font-black text-white disabled:opacity-50 flex items-center justify-center gap-2 transition ${classes.button}`}
              >
                {editingId ? <Save size={15} /> : <Plus size={15} />}
                {saving ? 'Đang lưu...' : editingId ? 'Cập nhật' : 'Thêm mới'}
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {items.length === 0 ? (
              <div className="p-10 rounded-3xl border border-dashed border-slate-200 text-center text-sm font-bold text-slate-400">
                Chưa có danh mục nào
              </div>
            ) : (
              items.map(item => {
                const used = getUsageCount(activeKind, item.id);
                return (
                  <div key={item.id} className={`p-5 rounded-3xl border transition-all ${item.isActive ? 'bg-white border-slate-100 hover:shadow-md' : 'bg-slate-50 border-slate-200 opacity-75'}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-black text-slate-800">{item.name}</span>
                          {item.code && <span className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-slate-100 text-slate-500">{item.code}</span>}
                          <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black ${item.isActive ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-200 text-slate-500'}`}>
                            {item.isActive ? 'Đang dùng' : 'Đã ẩn'}
                          </span>
                          {used > 0 && <span className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-orange-50 text-orange-600">{used} dự án</span>}
                        </div>
                        {item.description && <p className="mt-1 text-xs font-medium text-slate-400">{item.description}</p>}
                        <p className="mt-1 text-[10px] font-bold text-slate-400">Thứ tự: {item.sortOrder}</p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => openEdit(item)} className="p-2 rounded-xl text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition">
                          <Edit2 size={15} />
                        </button>
                        <button
                          onClick={() => setActive(activeKind, item, !item.isActive)}
                          className="p-2 rounded-xl text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition"
                          title={item.isActive ? 'Ẩn' : 'Hiện'}
                        >
                          <Archive size={15} />
                        </button>
                        <button onClick={() => removeOrArchive(activeKind, item)} className="p-2 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsProjectMasterData;
