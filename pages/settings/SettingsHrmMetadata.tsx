import React, { useMemo, useState } from 'react';
import {
  Blocks,
  Briefcase,
  CheckCircle2,
  GraduationCap,
  HeartPulse,
  Layers,
  ListTree,
  Medal,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  HrmCatalogItem,
  HrmCompetencyGroup,
  HrmCompetencyLevel,
  HrmOrgBlock,
  HrmPosition,
  HrmPositionGroup,
  HrmPositionLevel,
  OrgUnit,
  OrgUnitType,
} from '../../types';

type SectionKind =
  | 'org_units'
  | 'catalog'
  | 'position_groups'
  | 'position_levels'
  | 'positions'
  | 'competency_groups'
  | 'competency_levels';

type FormState = {
  id?: string;
  code: string;
  name: string;
  description: string;
  sortOrder: string;
  isActive: boolean;
  blockCode: string;
  orgType: OrgUnitType;
  groupCode: string;
  levelCode: string;
  suggestedOrgUnitCode: string;
  allowanceFactor: string;
  titleAllowanceAmount: string;
  phoneAllowanceAmount: string;
};

type SectionConfig = {
  key: string;
  label: string;
  table?: string;
  kind: SectionKind;
  catalogKey?: string;
  items: any[];
  icon: React.ComponentType<{ size?: number; className?: string }>;
};

const emptyForm = (): FormState => ({
  code: '',
  name: '',
  description: '',
  sortOrder: '',
  isActive: true,
  blockCode: '',
  orgType: 'department',
  groupCode: '',
  levelCode: '',
  suggestedOrgUnitCode: '',
  allowanceFactor: '',
  titleAllowanceAmount: '',
  phoneAllowanceAmount: '',
});

const toNumberOrUndefined = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const sortMetadata = <T extends { sortOrder?: number; name?: string; code?: string }>(items: T[]) =>
  [...items].sort((a, b) =>
    (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    || String(a.code || '').localeCompare(String(b.code || ''), 'vi')
    || String(a.name || '').localeCompare(String(b.name || ''), 'vi')
  );

const SettingsHrmMetadata: React.FC = () => {
  const {
    orgUnits,
    addOrgUnit,
    updateOrgUnit,
    removeOrgUnit,
    hrmOrgBlocks,
    hrmPositionGroups,
    hrmPositionLevels,
    hrmPositions,
    hrmCompetencyGroups,
    hrmCompetencyLevels,
    hrmCatalogItems,
    getHrmCatalogItems,
    addHrmItem,
    updateHrmItem,
    removeHrmItem,
  } = useApp();

  const sections = useMemo<SectionConfig[]>(() => [
    { key: 'org_units', label: 'Phòng/tổ', kind: 'org_units', items: orgUnits, icon: Blocks },
    { key: 'employment_status', label: 'Tình trạng', kind: 'catalog', catalogKey: 'employment_status', table: 'hrm_catalog_items', items: getHrmCatalogItems('employment_status'), icon: CheckCircle2 },
    { key: 'labor_contract_type', label: 'Loại HĐLĐ', kind: 'catalog', catalogKey: 'labor_contract_type', table: 'hrm_catalog_items', items: getHrmCatalogItems('labor_contract_type'), icon: ShieldCheck },
    { key: 'position_groups', label: 'Nhóm VTCV', kind: 'position_groups', table: 'hrm_position_groups', items: hrmPositionGroups, icon: Layers },
    { key: 'position_levels', label: 'Level & phụ cấp', kind: 'position_levels', table: 'hrm_position_levels', items: hrmPositionLevels, icon: Medal },
    { key: 'positions', label: 'Vị trí', kind: 'positions', table: 'hrm_positions', items: hrmPositions, icon: Briefcase },
    { key: 'education_level', label: 'Trình độ', kind: 'catalog', catalogKey: 'education_level', table: 'hrm_catalog_items', items: getHrmCatalogItems('education_level'), icon: GraduationCap },
    { key: 'social_insurance_status', label: 'BHXH', kind: 'catalog', catalogKey: 'social_insurance_status', table: 'hrm_catalog_items', items: getHrmCatalogItems('social_insurance_status'), icon: HeartPulse },
    { key: 'competency_groups', label: 'Nhóm năng lực', kind: 'competency_groups', table: 'hrm_competency_groups', items: hrmCompetencyGroups, icon: ListTree },
    { key: 'competency_levels', label: 'Cấp năng lực', kind: 'competency_levels', table: 'hrm_competency_levels', items: hrmCompetencyLevels, icon: Medal },
  ], [
    getHrmCatalogItems,
    hrmCompetencyGroups,
    hrmCompetencyLevels,
    hrmPositionGroups,
    hrmPositionLevels,
    hrmPositions,
    orgUnits,
  ]);

  const [activeKey, setActiveKey] = useState(sections[0].key);
  const [form, setForm] = useState<FormState>(emptyForm);
  const activeSection = sections.find(section => section.key === activeKey) || sections[0];
  const activeItems = sortMetadata(activeSection.items);

  const resetForm = () => setForm(emptyForm());

  const startEdit = (item: any) => {
    setForm({
      id: item.id,
      code: item.code || '',
      name: item.name || '',
      description: item.description || '',
      sortOrder: String(item.sortOrder ?? item.orderIndex ?? ''),
      isActive: item.isActive !== false,
      blockCode: item.blockCode || '',
      orgType: item.type || 'department',
      groupCode: item.groupCode || '',
      levelCode: item.levelCode || '',
      suggestedOrgUnitCode: item.suggestedOrgUnitCode || '',
      allowanceFactor: String(item.allowanceFactor ?? ''),
      titleAllowanceAmount: String(item.titleAllowanceAmount ?? ''),
      phoneAllowanceAmount: String(item.phoneAllowanceAmount ?? ''),
    });
  };

  const save = async () => {
    if (!form.name.trim() || !form.code.trim()) return;
    const sortOrder = toNumberOrUndefined(form.sortOrder);
    const id = form.id || crypto.randomUUID();
    const existingItem = activeItems.find(item => item.id === id);
    const source = form.id ? existingItem?.source : 'custom';

    if (activeSection.kind === 'org_units') {
      const item: OrgUnit = {
        id,
        code: form.code.trim() || undefined,
        name: form.name.trim(),
        type: form.orgType,
        blockCode: form.blockCode || undefined,
        source,
        aliasNames: [],
        isActive: form.isActive,
        parentId: null,
        description: form.description.trim(),
        orderIndex: sortOrder ?? 0,
      };
      if (form.id) await updateOrgUnit({ ...(existingItem as OrgUnit), ...item });
      else await addOrgUnit(item);
      resetForm();
      return;
    }

    if (!activeSection.table) return;

    if (activeSection.kind === 'catalog') {
      const item: HrmCatalogItem = {
        id,
        catalogKey: activeSection.catalogKey || '',
        code: form.code.trim(),
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        sortOrder: sortOrder ?? 0,
        isActive: form.isActive,
        source,
      };
      if (form.id) await updateHrmItem(activeSection.table, { ...(existingItem as HrmCatalogItem), ...item });
      else await addHrmItem(activeSection.table, item);
      resetForm();
      return;
    }

    if (activeSection.kind === 'positions') {
      const item: HrmPosition = {
        id,
        code: form.code.trim(),
        name: form.name.trim(),
        groupCode: form.groupCode || undefined,
        levelCode: form.levelCode || undefined,
        suggestedOrgUnitCode: form.suggestedOrgUnitCode || undefined,
        level: form.levelCode ? Number(form.levelCode.replace(/\D/g, '')) || undefined : undefined,
        sortOrder: sortOrder ?? 0,
        isActive: form.isActive,
        source,
      };
      if (form.id) await updateHrmItem(activeSection.table, { ...(existingItem as HrmPosition), ...item });
      else await addHrmItem(activeSection.table, item);
      resetForm();
      return;
    }

    if (activeSection.kind === 'position_levels') {
      const item: HrmPositionLevel = {
        id,
        code: form.code.trim(),
        name: form.name.trim(),
        groupCode: form.groupCode || undefined,
        description: form.description.trim() || undefined,
        allowanceFactor: toNumberOrUndefined(form.allowanceFactor),
        titleAllowanceAmount: toNumberOrUndefined(form.titleAllowanceAmount),
        phoneAllowanceAmount: toNumberOrUndefined(form.phoneAllowanceAmount),
        sortOrder: sortOrder ?? 0,
        isActive: form.isActive,
        source,
      };
      if (form.id) await updateHrmItem(activeSection.table, { ...(existingItem as HrmPositionLevel), ...item });
      else await addHrmItem(activeSection.table, item);
      resetForm();
      return;
    }

    const baseItem = {
      id,
      code: form.code.trim(),
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      sortOrder: sortOrder ?? 0,
      isActive: form.isActive,
      source,
    } as HrmOrgBlock | HrmPositionGroup | HrmCompetencyGroup | HrmCompetencyLevel;
    if (form.id) await updateHrmItem(activeSection.table, { ...existingItem, ...baseItem });
    else await addHrmItem(activeSection.table, baseItem);
    resetForm();
  };

  const remove = async (item: any) => {
    if (!window.confirm(`Xoá "${item.name}" khỏi metadata HRM?`)) return;
    if (activeSection.kind === 'org_units') await removeOrgUnit(item.id);
    else if (activeSection.table) await removeHrmItem(activeSection.table, item.id);
  };

  return (
    <div className="animate-in slide-in-from-right-4 duration-300 space-y-5">
      <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-4">
        <div className="flex flex-wrap gap-2">
          {sections.map(section => {
            const Icon = section.icon;
            const isActive = section.key === activeSection.key;
            return (
              <button
                key={section.key}
                onClick={() => { setActiveKey(section.key); resetForm(); }}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-black uppercase tracking-wide transition ${isActive
                  ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                  : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                  }`}
              >
                <Icon size={14} />
                <span>{section.label}</span>
                <span className="rounded-md bg-white/70 px-1.5 py-0.5 text-[10px]">{section.items.length}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)] gap-5">
        <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-5 space-y-4 h-fit">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-black uppercase tracking-wide text-slate-800">{form.id ? 'Cập nhật' : 'Thêm mới'}</h3>
              <p className="text-xs text-slate-400 font-medium">{activeSection.label}</p>
            </div>
            {form.id && (
              <button onClick={resetForm} className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <X size={16} />
              </button>
            )}
          </div>

          <div className="space-y-3">
            <input
              value={form.code}
              onChange={event => setForm(prev => ({ ...prev, code: event.target.value }))}
              placeholder="Mã"
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <input
              value={form.name}
              onChange={event => setForm(prev => ({ ...prev, name: event.target.value }))}
              placeholder="Tên"
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <input
              value={form.description}
              onChange={event => setForm(prev => ({ ...prev, description: event.target.value }))}
              placeholder="Mô tả / ghi chú"
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500"
            />

            {activeSection.kind === 'org_units' && (
              <div className="grid grid-cols-2 gap-3">
                <select value={form.blockCode} onChange={event => setForm(prev => ({ ...prev, blockCode: event.target.value }))} className="rounded-xl border border-slate-200 px-3 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">Khối</option>
                  {sortMetadata(hrmOrgBlocks).map(block => <option key={block.id} value={block.code}>{block.code} - {block.name}</option>)}
                </select>
                <select value={form.orgType} onChange={event => setForm(prev => ({ ...prev, orgType: event.target.value as OrgUnitType }))} className="rounded-xl border border-slate-200 px-3 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="department">Phòng/tổ</option>
                  <option value="factory">Nhà máy</option>
                  <option value="construction_site">Công trường</option>
                  <option value="custom">Khác</option>
                </select>
              </div>
            )}

            {(activeSection.kind === 'positions' || activeSection.kind === 'position_levels') && (
              <select value={form.groupCode} onChange={event => setForm(prev => ({ ...prev, groupCode: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">Nhóm VTCV</option>
                {sortMetadata(hrmPositionGroups).map(group => <option key={group.id} value={group.code}>{group.code} - {group.name}</option>)}
              </select>
            )}

            {activeSection.kind === 'positions' && (
              <div className="grid grid-cols-2 gap-3">
                <select value={form.levelCode} onChange={event => setForm(prev => ({ ...prev, levelCode: event.target.value }))} className="rounded-xl border border-slate-200 px-3 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">Level</option>
                  {sortMetadata(hrmPositionLevels).map(level => <option key={level.id} value={level.code}>{level.code} - {level.name}</option>)}
                </select>
                <select value={form.suggestedOrgUnitCode} onChange={event => setForm(prev => ({ ...prev, suggestedOrgUnitCode: event.target.value }))} className="rounded-xl border border-slate-200 px-3 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">Phòng/tổ gợi ý</option>
                  {sortMetadata(orgUnits.filter(unit => unit.code)).map(unit => <option key={unit.id} value={unit.code}>{unit.code} - {unit.name}</option>)}
                </select>
              </div>
            )}

            {activeSection.kind === 'position_levels' && (
              <div className="grid grid-cols-3 gap-3">
                <input value={form.allowanceFactor} onChange={event => setForm(prev => ({ ...prev, allowanceFactor: event.target.value }))} placeholder="Hệ số PC" className="rounded-xl border border-slate-200 px-3 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500" />
                <input value={form.titleAllowanceAmount} onChange={event => setForm(prev => ({ ...prev, titleAllowanceAmount: event.target.value }))} placeholder="PC chức danh" className="rounded-xl border border-slate-200 px-3 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500" />
                <input value={form.phoneAllowanceAmount} onChange={event => setForm(prev => ({ ...prev, phoneAllowanceAmount: event.target.value }))} placeholder="PC điện thoại" className="rounded-xl border border-slate-200 px-3 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            )}

            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-center">
              <input
                value={form.sortOrder}
                onChange={event =>
                  setForm(prev => ({ ...prev, sortOrder: event.target.value }))
                }
                placeholder="Thứ tự"
                className="min-w-0 rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500"
              />

              <label className="flex shrink-0 items-center gap-2 px-3 py-3 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={event =>
                    setForm(prev => ({ ...prev, isActive: event.target.checked }))
                  }
                />
                <span>Active</span>
              </label>
            </div>

            <button
              onClick={save}
              disabled={!form.name.trim() || !form.code.trim()}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50"
            >
              {form.id ? <Save size={16} /> : <Plus size={16} />}
              {form.id ? 'Cập nhật' : 'Thêm mới'}
            </button>
          </div>
        </div>

        <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="grid grid-cols-[120px_minmax(180px,1fr)_minmax(160px,1fr)_110px] gap-3 px-5 py-3 bg-slate-50 border-b border-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-400">
            <span>Mã</span>
            <span>Tên</span>
            <span>Metadata</span>
            <span className="text-right">Thao tác</span>
          </div>
          <div className="divide-y divide-slate-100 max-h-[620px] overflow-y-auto">
            {activeItems.map(item => (
              <div key={item.id} className="grid grid-cols-[120px_minmax(180px,1fr)_minmax(160px,1fr)_110px] gap-3 px-5 py-4 items-center group">
                <span className="font-mono text-xs font-black text-indigo-700">{item.code || '--'}</span>
                <div className="min-w-0">
                  <p className="text-sm font-black text-slate-800 truncate">{item.name}</p>
                  {item.description && <p className="text-xs text-slate-400 truncate">{item.description}</p>}
                </div>
                <div className="flex flex-wrap gap-1.5 text-[10px] font-bold text-slate-500">
                  {item.blockCode && <span className="rounded-md bg-slate-100 px-2 py-1">{item.blockCode}</span>}
                  {item.groupCode && <span className="rounded-md bg-amber-50 text-amber-700 px-2 py-1">{item.groupCode}</span>}
                  {item.levelCode && <span className="rounded-md bg-blue-50 text-blue-700 px-2 py-1">{item.levelCode}</span>}
                  {item.suggestedOrgUnitCode && <span className="rounded-md bg-emerald-50 text-emerald-700 px-2 py-1">{item.suggestedOrgUnitCode}</span>}
                  {item.allowanceFactor !== undefined && <span className="rounded-md bg-rose-50 text-rose-700 px-2 py-1">PC {item.allowanceFactor}</span>}
                  {item.source && <span className="rounded-md bg-slate-100 px-2 py-1">{item.source}</span>}
                  {item.isActive === false && <span className="rounded-md bg-red-50 text-red-700 px-2 py-1">Inactive</span>}
                </div>
                <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => startEdit(item)} className="p-2 rounded-lg text-slate-400 hover:bg-indigo-50 hover:text-indigo-700">
                    <Save size={15} />
                  </button>
                  <button onClick={() => remove(item)} className="p-2 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
            {activeItems.length === 0 && (
              <div className="py-14 text-center text-sm font-bold text-slate-400">
                Chưa có dữ liệu
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsHrmMetadata;
