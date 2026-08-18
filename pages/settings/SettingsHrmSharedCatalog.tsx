import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BriefcaseBusiness, Building2,
  ChevronsDown, ChevronsUp, Database, GitBranch, Layers3, Loader2, Pencil, Plus,
  RefreshCcw, Search, ShieldCheck, Sparkles, Trash2, UsersRound, X,
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { getApiErrorMessage } from '../../lib/apiError';
import { buildHrmOrgForest, buildHrmStaffingRows } from '../../lib/hrmSharedCatalogModel';
import {
  hrmSharedCatalogService,
  type HrmCodeCatalogTable,
} from '../../lib/hrmSharedCatalogService';
import HrmEmployeeAssignmentDialog from '../../components/hrm/organization/HrmEmployeeAssignmentDialog';
import HrmOrgChartOverview from '../../components/hrm/organization/HrmOrgChartOverview';
import HrmStaffingDialog from '../../components/hrm/organization/HrmStaffingDialog';
import HrmStaffingPanel from '../../components/hrm/organization/HrmStaffingPanel';
import type {
  HrmSharedCatalogBundle, HrmSharedCodeItem, HrmSharedOrgUnit, HrmSharedPosition,
  HrmStaffingRow,
} from '../../types/hrmSharedCatalog';

type MainView = 'organization' | 'positions' | 'job-framework' | 'competency' | 'employee-catalogs';
type DialogType = 'unit' | 'position' | 'code-item' | 'catalog-item' | null;

const EMPTY_BUNDLE: HrmSharedCatalogBundle = {
  orgUnits: [], slots: [], assignments: [], employees: [], positions: [],
  positionGroups: [], positionLevels: [], competencyGroups: [], competencyLevels: [],
  employmentStatuses: [], contractTypes: [], educationLevels: [], socialInsuranceStatuses: [],
};

const VIEW_ITEMS: Array<{ id: MainView; label: string; icon: typeof GitBranch }> = [
  { id: 'organization', label: 'Sơ đồ tổng quan', icon: GitBranch },
  { id: 'positions', label: 'Vị trí công việc', icon: BriefcaseBusiness },
  { id: 'job-framework', label: 'Nhóm & cấp bậc', icon: Layers3 },
  { id: 'competency', label: 'Khung năng lực', icon: Sparkles },
  { id: 'employee-catalogs', label: 'Danh mục hồ sơ', icon: Database },
];

const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100';
const labelClass = 'mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-500';

const CatalogCard: React.FC<{
  title: string;
  note: string;
  items: HrmSharedCodeItem[];
  onAdd: () => void;
  canManage: boolean;
}> = ({ title, note, items, onAdd, canManage }) => (
  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h3 className="font-black text-slate-800">{title}</h3>
        <p className="mt-1 text-xs font-medium text-slate-400">{note}</p>
      </div>
      {canManage && (
        <button onClick={onAdd} className="rounded-xl bg-indigo-50 p-2 text-indigo-600 transition hover:bg-indigo-100" title={`Thêm ${title}`}>
          <Plus size={16} />
        </button>
      )}
    </div>
    <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
      {items.map(item => (
        <div key={item.id} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5">
          <span className="min-w-12 rounded-lg bg-white px-2 py-1 text-center text-xs font-black text-indigo-700 shadow-sm">{item.code}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-slate-700">{item.name}</p>
            {item.description && <p className="truncate text-[11px] text-slate-400">{item.description}</p>}
          </div>
          {!item.isActive && <span className="text-[10px] font-black text-slate-400">NGƯNG</span>}
        </div>
      ))}
      {!items.length && <p className="py-8 text-center text-xs font-semibold text-slate-400">Chưa có dữ liệu</p>}
    </div>
  </section>
);

interface SettingsHrmSharedCatalogProps { actorId: string; canManage: boolean; }

const SettingsHrmSharedCatalog: React.FC<SettingsHrmSharedCatalogProps> = ({ canManage }) => {
  const toast = useToast();
  const [bundle, setBundle] = useState(EMPTY_BUNDLE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<MainView>('organization');
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<DialogType>(null);
  const [targetUnit, setTargetUnit] = useState<HrmSharedOrgUnit | null>(null);
  const [targetPosition, setTargetPosition] = useState<HrmSharedPosition | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [staffingDialogRow, setStaffingDialogRow] = useState<HrmStaffingRow | null | undefined>(undefined);
  const [assignmentDialogRow, setAssignmentDialogRow] = useState<HrmStaffingRow | null>(null);
  const [treeExpansion, setTreeExpansion] = useState({ expanded: false, version: 0 });
  const [legacyTargetById, setLegacyTargetById] = useState<Record<string, string>>({});
  const [migrationBusyId, setMigrationBusyId] = useState<string | null>(null);
  const [catalogTarget, setCatalogTarget] = useState<{ title: string; table?: HrmCodeCatalogTable; key?: 'employment_status' | 'labor_contract_type' | 'education_level' | 'social_insurance_status' } | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    setLoading(true);
    try { setBundle(await hrmSharedCatalogService.load()); }
    catch (error) { toast.error('Không tải được Danh mục dùng chung HRM', getApiErrorMessage(error, 'Vui lòng thử lại.')); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { void reload(); }, [reload]);

  const orgForest = useMemo(() => buildHrmOrgForest(bundle.orgUnits), [bundle.orgUnits]);
  const staffingRows = useMemo(
    () => buildHrmStaffingRows(bundle.slots, bundle.assignments, bundle.orgUnits),
    [bundle.assignments, bundle.orgUnits, bundle.slots],
  );
  const officialSlotIds = useMemo(
    () => new Set(bundle.slots.filter(slot => slot.source === 'workforce_plan' && slot.status === 'ACTIVE').map(slot => slot.id)),
    [bundle.slots],
  );
  const activeEmployeeIds = useMemo(() => new Set(bundle.assignments
    .filter(item => item.status === 'ACTIVE' && item.assignmentType === 'PRIMARY' && officialSlotIds.has(item.slotId))
    .map(item => item.employeeId)), [bundle.assignments, officialSlotIds]);
  const occupiedCount = useMemo(
    () => staffingRows.reduce((total, row) => total + row.occupiedCount, 0),
    [staffingRows],
  );
  const approvedPositions = useMemo(() => bundle.positions.filter(item => item.isActive && item.source !== 'legacy'), [bundle.positions]);
  const legacyPositions = useMemo(() => bundle.positions
    .filter(item => item.isActive && item.source === 'legacy')
    .map(position => ({
      position,
      employees: bundle.employees.filter(employee => employee.positionId === position.id),
      slots: bundle.slots.filter(slot => slot.positionId === position.id && slot.status !== 'ARCHIVED'),
    }))
    .sort((a, b) => (b.employees.length + b.slots.length) - (a.employees.length + a.slots.length)),
  [bundle.positions, bundle.employees, bundle.slots]);

  const selectedUnit = bundle.orgUnits.find(unit => unit.id === selectedUnitId)
    || orgForest[0]
    || null;
  const selectedUnitRows = selectedUnit
    ? staffingRows.filter(row => row.orgUnitId === selectedUnit.id)
    : [];

  useEffect(() => {
    if (!selectedUnitId && orgForest[0]) setSelectedUnitId(orgForest[0].id);
  }, [orgForest, selectedUnitId]);

  const closeDialog = () => { setDialog(null); setTargetUnit(null); setTargetPosition(null); setCatalogTarget(null); setForm({}); };
  const openUnit = (parent?: HrmSharedOrgUnit | null) => { setTargetUnit(parent || null); setForm({ parentId: parent?.id || '', type: 'department', blockCode: parent?.blockCode || (parent?.code?.startsWith('K') ? parent.code : '') || '' }); setDialog('unit'); };
  const openPosition = (position?: HrmSharedPosition) => {
    setTargetPosition(position || null);
    setForm(position ? {
      code: position.code || '', name: position.name, groupCode: position.groupCode || '',
      levelCode: position.levelCode || '', suggestedOrgUnitCode: position.suggestedOrgUnitCode || '',
    } : {});
    setDialog('position');
  };
  const openCode = (title: string, table: HrmCodeCatalogTable) => { setCatalogTarget({ title, table }); setForm({}); setDialog('code-item'); };
  const openCatalog = (title: string, key: NonNullable<typeof catalogTarget>['key']) => { setCatalogTarget({ title, key }); setForm({}); setDialog('catalog-item'); };

  const save = async () => {
    setSaving(true);
    try {
      if (dialog === 'unit') {
        if (!form.code?.trim() || !form.name?.trim()) throw new Error('Cần nhập mã và tên đơn vị.');
        await hrmSharedCatalogService.createOrgUnit({ code: form.code, name: form.name, type: form.type || 'department', parentId: form.parentId, blockCode: form.blockCode, description: form.description });
      } else if (dialog === 'position') {
        if (!form.code?.trim() || !form.name?.trim() || !form.groupCode || !form.levelCode) throw new Error('Cần nhập đủ mã, tên, nhóm và cấp bậc.');
        const positionInput = { code: form.code, name: form.name, groupCode: form.groupCode, levelCode: form.levelCode, suggestedOrgUnitCode: form.suggestedOrgUnitCode };
        if (targetPosition) await hrmSharedCatalogService.updatePosition(targetPosition.id, positionInput);
        else await hrmSharedCatalogService.createPosition(positionInput);
      } else if (dialog === 'code-item' && catalogTarget?.table) {
        if (!form.code?.trim() || !form.name?.trim()) throw new Error('Cần nhập mã và tên danh mục.');
        await hrmSharedCatalogService.createCodeItem({ table: catalogTarget.table, code: form.code, name: form.name, description: form.description });
      } else if (dialog === 'catalog-item' && catalogTarget?.key) {
        if (!form.code?.trim() || !form.name?.trim()) throw new Error('Cần nhập mã và tên danh mục.');
        await hrmSharedCatalogService.createCatalogItem({ catalogKey: catalogTarget.key, code: form.code, name: form.name, description: form.description });
      }
      toast.success('Đã cập nhật Danh mục dùng chung HRM');
      closeDialog();
      await reload();
    } catch (error) { toast.error('Không lưu được dữ liệu', getApiErrorMessage(error, 'Vui lòng kiểm tra thông tin.')); }
    finally { setSaving(false); }
  };

  const saveStaffing = async (input: {
    positionId: string;
    levelCode: string | null;
    targetCount: number;
    reportsToSlotId: string | null;
    note: string;
  }) => {
    if (!selectedUnit) throw new Error('Chưa chọn đơn vị tổ chức.');
    await hrmSharedCatalogService.adjustStaffing({
      orgUnitId: selectedUnit.id,
      positionId: input.positionId,
      levelCode: input.levelCode,
      reportsToSlotId: input.reportsToSlotId,
      targetCount: input.targetCount,
      note: input.note,
    });
    setStaffingDialogRow(undefined);
    toast.success('Đã cập nhật định biên nhân sự');
    await reload();
  };

  const assignEmployee = async (input: {
    employeeId: string;
    row: HrmStaffingRow;
    effectiveFrom: string;
    note: string;
  }) => {
    await hrmSharedCatalogService.assignEmployeeToStaffing({
      employeeId: input.employeeId,
      orgUnitId: input.row.orgUnitId,
      positionId: input.row.positionId,
      levelCode: input.row.levelCode,
      reportsToSlotId: input.row.reportsToSlotId,
      effectiveFrom: input.effectiveFrom,
      note: input.note,
    });
    setAssignmentDialogRow(null);
    toast.success('Đã phân bổ nhân sự vào cơ cấu tổ chức');
    await reload();
  };

  const setUnitManagerStaffing = async (row: HrmStaffingRow) => {
    try {
      await hrmSharedCatalogService.setUnitManagerStaffing({
        orgUnitId: row.orgUnitId,
        positionId: row.positionId,
        levelCode: row.levelCode,
        reportsToSlotId: row.reportsToSlotId,
      });
      toast.success('Đã thiết lập vị trí quản lý trực tiếp');
      await reload();
    } catch (error) {
      toast.error('Không cập nhật được quản lý', getApiErrorMessage(error, 'Vui lòng thử lại.'));
    }
  };

  const archivePosition = async (position: HrmSharedPosition) => {
    if (!window.confirm(`Ngưng sử dụng vị trí "${position.name}"? Dữ liệu nhân sự và slot hiện có vẫn được giữ nguyên.`)) return;
    setSaving(true);
    try {
      await hrmSharedCatalogService.archivePosition(position.id);
      toast.success('Đã ngưng sử dụng vị trí công việc');
      await reload();
    } catch (error) {
      toast.error('Không cập nhật được vị trí', getApiErrorMessage(error, 'Vui lòng thử lại.'));
    } finally {
      setSaving(false);
    }
  };

  const migrateLegacyPosition = async (legacy: HrmSharedPosition) => {
    const targetId = legacyTargetById[legacy.id];
    const target = approvedPositions.find(position => position.id === targetId);
    const impact = legacyPositions.find(item => item.position.id === legacy.id);
    if (!target) return toast.warning('Chưa chọn vị trí mới', 'Anh hãy chọn vị trí đích trước khi chuyển đổi.');
    if (!window.confirm(`Chuyển ${impact?.employees.length || 0} nhân viên và ${impact?.slots.length || 0} slot từ vị trí LEGACY sang "${target.name}"?`)) return;

    setMigrationBusyId(legacy.id);
    try {
      const result = await hrmSharedCatalogService.migrateLegacyPosition(legacy.id, target.id);
      toast.success('Đã chuyển đổi vị trí LEGACY', `${result.employeesMigrated} nhân viên và ${result.slotsMigrated} slot đã chuyển sang ${target.name}.`);
      setLegacyTargetById(current => {
        const next = { ...current };
        delete next[legacy.id];
        return next;
      });
      await reload();
    } catch (error) {
      toast.error('Không chuyển đổi được vị trí', getApiErrorMessage(error, 'Vui lòng thử lại.'));
    } finally {
      setMigrationBusyId(null);
    }
  };

  const updateForm = (key: string, value: string) => setForm(current => ({ ...current, [key]: value }));
  const plannedCount = staffingRows.reduce((total, row) => total + row.plannedCount, 0);
  const statCards = [
    { label: 'Đơn vị tổ chức', value: bundle.orgUnits.length, note: 'K1-K3 đang hoạt động', icon: Building2, tone: 'bg-indigo-50 text-indigo-600' },
    { label: 'Định biên chính thức', value: plannedCount, note: `${occupiedCount} đã bố trí`, icon: GitBranch, tone: 'bg-emerald-50 text-emerald-600' },
    { label: 'Vị trí công việc', value: approvedPositions.length, note: legacyPositions.length ? `${legacyPositions.length} vị trí LEGACY cần chuyển` : 'Không còn vị trí LEGACY', icon: BriefcaseBusiness, tone: 'bg-amber-50 text-amber-600' },
    { label: 'Nhân sự chờ phân bổ', value: bundle.employees.filter(item => !activeEmployeeIds.has(item.id)).length, note: `Tổng ${bundle.employees.length} đang làm việc`, icon: UsersRound, tone: 'bg-rose-50 text-rose-600' },
  ];

  return (
    <div className="animate-in slide-in-from-right-4 space-y-5 duration-300">
      <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 p-6 text-white shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-indigo-300"><ShieldCheck size={15} /> Bộ khung nhân sự dùng chung</div>
            <h2 className="text-2xl font-black">Danh mục dùng chung HRM</h2>
            <p className="mt-2 max-w-3xl text-sm font-medium text-slate-300">Một nguồn dữ liệu cho cơ cấu tổ chức, slot biên chế, vị trí, cấp bậc và tuyến quản lý trực tiếp. P3 chưa thay đổi cho tới khi có thang bảng lương chính thức.</p>
          </div>
          <button onClick={() => void reload()} disabled={loading} className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-xs font-black backdrop-blur hover:bg-white/20 disabled:opacity-50"><RefreshCcw size={14} className={loading ? 'animate-spin' : ''} /> Làm mới</button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {statCards.map(card => <div key={card.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center gap-3"><div className={`flex h-10 w-10 items-center justify-center rounded-xl ${card.tone}`}><card.icon size={19} /></div><div><p className="text-2xl font-black text-slate-800">{card.value}</p><p className="text-xs font-black text-slate-600">{card.label}</p></div></div><p className="mt-3 text-[11px] font-semibold text-slate-400">{card.note}</p></div>)}
      </div>

      <div className="flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        {VIEW_ITEMS.map(item => <button key={item.id} onClick={() => setView(item.id)} className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition ${view === item.id ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}`}><item.icon size={15} /> {item.label}</button>)}
      </div>

      {loading ? <div className="flex min-h-80 items-center justify-center rounded-3xl border border-slate-200 bg-white"><Loader2 size={28} className="animate-spin text-indigo-600" /></div> : (
        <>
          {view === 'organization' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative min-w-64 flex-1">
                  <Search size={16} className="absolute left-3 top-3 text-slate-400" />
                  <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm đơn vị tổ chức..." className={`${inputClass} pl-9`} />
                </div>
                <div className="flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
                  <button onClick={() => setTreeExpansion(current => ({ expanded: true, version: current.version + 1 }))} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-black text-slate-600 hover:bg-indigo-50 hover:text-indigo-700">
                    <ChevronsDown size={14} /> Mở toàn bộ
                  </button>
                  <button onClick={() => setTreeExpansion(current => ({ expanded: false, version: current.version + 1 }))} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-100">
                    <ChevronsUp size={14} /> Thu gọn
                  </button>
                </div>
                {canManage && <button onClick={() => openUnit(selectedUnit)} className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-xs font-black text-white hover:bg-slate-800"><Plus size={15} /> Thêm đơn vị trực thuộc</button>}
              </div>
              <div aria-label="Định biên & nhân sự" className="grid items-start gap-4 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,2fr)]">
                <HrmOrgChartOverview
                  roots={orgForest}
                  selectedUnitId={selectedUnit?.id || null}
                  query={query}
                  expansionCommand={treeExpansion}
                  onSelectUnit={unit => setSelectedUnitId(unit.id)}
                />
                {selectedUnit ? (
                  <HrmStaffingPanel
                    unit={selectedUnit}
                    rows={selectedUnitRows}
                    positions={approvedPositions}
                    canManage={canManage}
                    onAdjust={row => setStaffingDialogRow(row || null)}
                    onAssign={row => setAssignmentDialogRow(row)}
                    onSetManager={row => void setUnitManagerStaffing(row)}
                  />
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-16 text-center text-sm font-semibold text-slate-500">
                    Chọn một đơn vị để xem định biên &amp; nhân sự.
                  </div>
                )}
              </div>
            </div>
          )}

          {view === 'positions' && (
            <div className="space-y-4">
            {legacyPositions.length > 0 && (
              <details className="overflow-hidden rounded-3xl border border-amber-200 bg-amber-50/40 shadow-sm">
                <summary className="cursor-pointer bg-amber-50 px-5 py-4 text-sm font-black text-amber-900">
                  Lịch sử dữ liệu cũ ({legacyPositions.length} vị trí cần xử lý)
                </summary>
                <div className="border-b border-amber-200 bg-amber-50 p-5">
                  <h3 className="font-black text-amber-900">Chuyển đổi vị trí LEGACY</h3>
                  <p className="mt-1 text-xs font-medium text-amber-700">Chọn vị trí mới cho từng vị trí cũ. Hệ thống sẽ chuyển đồng thời nhân viên và slot, sau đó ngưng vị trí LEGACY.</p>
                </div>
                <div className="divide-y divide-amber-100">
                  {legacyPositions.map(({ position, employees, slots }) => {
                    const employeeTitles = [...new Set(employees.map(employee => employee.title).filter(Boolean))];
                    return (
                      <div key={position.id} className="grid gap-3 p-4 lg:grid-cols-[minmax(220px,1fr)_140px_minmax(280px,1.4fr)_110px] lg:items-center">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2"><span className="rounded-lg bg-amber-200 px-2 py-1 text-[10px] font-black text-amber-900">LEGACY</span><span className="truncate text-sm font-black text-slate-800">{position.code || position.name || 'Không có mã'}</span></div>
                          <p className="mt-1 truncate text-xs font-semibold text-slate-500">{employeeTitles.length ? employeeTitles.slice(0, 3).join(' · ') : 'Không còn nhân viên trực tiếp'}</p>
                        </div>
                        <div className="flex gap-2 text-[11px] font-black"><span className="rounded-lg bg-white px-2 py-1.5 text-slate-600">{employees.length} nhân viên</span><span className="rounded-lg bg-white px-2 py-1.5 text-slate-600">{slots.length} slot</span></div>
                        {canManage ? <select className={inputClass} value={legacyTargetById[position.id] || ''} onChange={event => setLegacyTargetById(current => ({ ...current, [position.id]: event.target.value }))}><option value="">Chọn vị trí mới...</option>{approvedPositions.map(target => <option key={target.id} value={target.id}>{target.code || 'Chưa có mã'} - {target.name} ({target.groupCode || 'chưa nhóm'}, {target.levelCode || 'chưa cấp bậc'})</option>)}</select> : <span className="text-xs font-semibold text-slate-400">Cần quyền quản trị HRM</span>}
                        {canManage && <button onClick={() => void migrateLegacyPosition(position)} disabled={!legacyTargetById[position.id] || migrationBusyId === position.id} className="flex items-center justify-center gap-2 rounded-xl bg-amber-600 px-3 py-2.5 text-xs font-black text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-40">{migrationBusyId === position.id && <Loader2 size={14} className="animate-spin" />} Chuyển</button>}
                      </div>
                    );
                  })}
                </div>
              </details>
            )}
            <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 p-5">
                <div><h3 className="font-black text-slate-800">Vị trí công việc</h3><p className="mt-1 text-xs font-medium text-slate-400">Mỗi vị trí gắn nhóm VTCV và cấp bậc E1-E11.</p></div>
                {canManage && <button onClick={() => openPosition()} className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-black text-white"><Plus size={15} /> Thêm vị trí</button>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-400"><tr><th className="px-5 py-3">Mã</th><th className="px-5 py-3">Tên vị trí</th><th className="px-5 py-3">Nhóm VTCV</th><th className="px-5 py-3">Cấp bậc</th><th className="px-5 py-3">Đơn vị gợi ý</th>{canManage && <th className="px-5 py-3 text-right">Thao tác</th>}</tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {approvedPositions.map(position => (
                      <tr key={position.id} className="hover:bg-slate-50">
                        <td className="px-5 py-3 font-black text-indigo-600">{position.code || 'Chưa có'}</td>
                        <td className="px-5 py-3 font-bold text-slate-700">{position.name}</td>
                        <td className="px-5 py-3 text-slate-500">{position.groupCode || 'Chưa có'}</td>
                        <td className="px-5 py-3"><span className="rounded-lg bg-indigo-50 px-2 py-1 text-xs font-black text-indigo-700">{position.levelCode || 'Chưa có'}</span></td>
                        <td className="px-5 py-3 text-slate-500">{position.suggestedOrgUnitCode || 'Để trống'}</td>
                        {canManage && <td className="px-5 py-3"><div className="flex justify-end gap-1"><button onClick={() => openPosition(position)} className="rounded-lg p-2 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600" title="Sửa vị trí"><Pencil size={15} /></button><button onClick={() => void archivePosition(position)} disabled={saving} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40" title="Ngưng sử dụng"><Trash2 size={15} /></button></div></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            </div>
          )}

          {view === 'job-framework' && <div className="grid gap-4 lg:grid-cols-2"><CatalogCard title="Nhóm vị trí công việc" note="Bao gồm nhóm CG đã bổ sung" items={bundle.positionGroups} canManage={canManage} onAdd={() => openCode('Nhóm vị trí công việc', 'hrm_position_groups')} /><CatalogCard title="Cấp bậc E1-E11" note="Không sử dụng mã L1-L11" items={bundle.positionLevels} canManage={canManage} onAdd={() => openCode('Cấp bậc', 'hrm_position_levels')} /></div>}

          {view === 'competency' && <div className="grid gap-4 lg:grid-cols-2"><CatalogCard title="Nhóm năng lực" note="Nhóm năng lực dùng chung" items={bundle.competencyGroups} canManage={canManage} onAdd={() => openCode('Nhóm năng lực', 'hrm_competency_groups')} /><CatalogCard title="Cấp độ năng lực" note="C6 đã ngưng sử dụng theo xác nhận" items={bundle.competencyLevels.filter(item => item.code !== 'C6')} canManage={canManage} onAdd={() => openCode('Cấp độ năng lực', 'hrm_competency_levels')} /></div>}

          {view === 'employee-catalogs' && <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><CatalogCard title="Trạng thái làm việc" note="Trạng thái hồ sơ nhân sự" items={bundle.employmentStatuses} canManage={canManage} onAdd={() => openCatalog('Trạng thái làm việc', 'employment_status')} /><CatalogCard title="Loại hợp đồng" note="Mã 36T chỉ giữ một bản ghi" items={bundle.contractTypes} canManage={canManage} onAdd={() => openCatalog('Loại hợp đồng', 'labor_contract_type')} /><CatalogCard title="Trình độ" note="Trình độ học vấn/chuyên môn" items={bundle.educationLevels} canManage={canManage} onAdd={() => openCatalog('Trình độ', 'education_level')} /><CatalogCard title="Trạng thái BHXH" note="Danh mục bảo hiểm xã hội" items={bundle.socialInsuranceStatuses} canManage={canManage} onAdd={() => openCatalog('Trạng thái BHXH', 'social_insurance_status')} /></div>}
        </>
      )}

      {dialog && <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget) closeDialog(); }}><div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl"><div className="mb-5 flex items-start justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-indigo-500">Danh mục dùng chung HRM</p><h3 className="mt-1 text-xl font-black text-slate-800">{dialog === 'unit' ? 'Thêm đơn vị tổ chức' : dialog === 'position' ? (targetPosition ? 'Cập nhật vị trí công việc' : 'Thêm vị trí công việc') : `Thêm ${catalogTarget?.title || 'danh mục'}`}</h3></div><button onClick={closeDialog} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button></div><div className="grid gap-4 sm:grid-cols-2">
        {(dialog === 'unit' || dialog === 'position' || dialog === 'code-item' || dialog === 'catalog-item') && <><label><span className={labelClass}>Mã</span><input className={inputClass} value={form.code || ''} onChange={event => updateForm('code', event.target.value.toUpperCase())} placeholder="VD: HCNS" /></label><label><span className={labelClass}>Tên</span><input className={inputClass} value={form.name || ''} onChange={event => updateForm('name', event.target.value)} placeholder="Nhập tên" /></label></>}
        {dialog === 'unit' && <><label><span className={labelClass}>Loại đơn vị</span><select className={inputClass} value={form.type || 'department'} onChange={event => updateForm('type', event.target.value)}><option value="department">Phòng / Ban</option><option value="construction_site">Công trường</option><option value="factory">Nhà máy</option><option value="custom">Khối</option></select></label><label><span className={labelClass}>Thuộc đơn vị</span><select className={inputClass} value={form.parentId || ''} onChange={event => updateForm('parentId', event.target.value)}><option value="">Không có cấp trên</option>{bundle.orgUnits.map(unit => <option key={unit.id} value={unit.id}>{unit.code} - {unit.name}</option>)}</select></label><label><span className={labelClass}>Khối</span><select className={inputClass} value={form.blockCode || ''} onChange={event => updateForm('blockCode', event.target.value)}><option value="">Để trống</option><option value="K1">K1 · Khối văn phòng</option><option value="K2">K2 · Khối công trường</option><option value="K3">K3 · Khối nhà máy</option></select></label></>}
        {dialog === 'position' && <><label><span className={labelClass}>Nhóm VTCV</span><select className={inputClass} value={form.groupCode || ''} onChange={event => updateForm('groupCode', event.target.value)}><option value="">Chọn nhóm</option>{bundle.positionGroups.filter(item => item.isActive).map(item => <option key={item.id} value={item.code}>{item.code} - {item.name}</option>)}</select></label><label><span className={labelClass}>Cấp bậc</span><select className={inputClass} value={form.levelCode || ''} onChange={event => updateForm('levelCode', event.target.value)}><option value="">Chọn E1-E11</option>{bundle.positionLevels.filter(item => item.isActive).map(item => <option key={item.id} value={item.code}>{item.code} - {item.name}</option>)}</select></label><label className="sm:col-span-2"><span className={labelClass}>Mã đơn vị gợi ý</span><select className={inputClass} value={form.suggestedOrgUnitCode || ''} onChange={event => updateForm('suggestedOrgUnitCode', event.target.value)}><option value="">Để trống nếu không tồn tại</option>{bundle.orgUnits.filter(item => item.code).map(item => <option key={item.id} value={item.code!}>{item.code} - {item.name}</option>)}</select></label></>}
        {(dialog === 'unit' || dialog === 'code-item' || dialog === 'catalog-item') && <label className="sm:col-span-2"><span className={labelClass}>Mô tả</span><textarea className={`${inputClass} min-h-20 resize-y`} value={form.description || ''} onChange={event => updateForm('description', event.target.value)} /></label>}
      </div><div className="mt-6 flex justify-end gap-3"><button onClick={closeDialog} className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-black text-slate-600">Hủy</button><button onClick={() => void save()} disabled={saving} className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-50">{saving && <Loader2 size={14} className="animate-spin" />} Lưu dữ liệu</button></div></div></div>}

      <HrmStaffingDialog
        isOpen={staffingDialogRow !== undefined}
        unit={selectedUnit}
        row={staffingDialogRow || null}
        positions={approvedPositions}
        positionLevels={bundle.positionLevels}
        reportingRows={staffingRows}
        onClose={() => setStaffingDialogRow(undefined)}
        onSubmit={saveStaffing}
      />

      <HrmEmployeeAssignmentDialog
        isOpen={assignmentDialogRow !== null}
        employees={bundle.employees}
        orgUnits={bundle.orgUnits}
        positions={approvedPositions}
        rows={staffingRows}
        initialRow={assignmentDialogRow && assignmentDialogRow.vacantCount > 0 ? assignmentDialogRow : null}
        onClose={() => setAssignmentDialogRow(null)}
        onSubmit={assignEmployee}
      />
    </div>
  );
};

export default SettingsHrmSharedCatalog;
