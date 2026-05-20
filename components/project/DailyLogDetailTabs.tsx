import React, { useMemo, useState } from 'react';
import { Plus, X, Package, Users, Wrench, Layers, Paperclip, ClipboardCheck } from 'lucide-react';
import {
  DailyLogVolume, DailyLogMaterial, DailyLogLabor, DailyLogMachine,
  Attachment, BusinessPartner, ContractLaborCatalogItem, ContractMachineCatalogItem, ProjectTask,
} from '../../types';

interface Props {
  volumes: DailyLogVolume[];
  materials: DailyLogMaterial[];
  laborDetails: DailyLogLabor[];
  machines: DailyLogMachine[];
  onVolumesChange: (v: DailyLogVolume[]) => void;
  onMaterialsChange: (v: DailyLogMaterial[]) => void;
  onLaborChange: (v: DailyLogLabor[]) => void;
  onMachinesChange: (v: DailyLogMachine[]) => void;
  tasks?: ProjectTask[];
  laborCatalogs?: ContractLaborCatalogItem[];
  machineCatalogs?: ContractMachineCatalogItem[];
  businessPartners?: BusinessPartner[];
  verifiedQuantityByTaskId?: Record<string, number>;
}

type TabKey = 'volumes' | 'materials' | 'labor' | 'machines';
const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'volumes', label: 'Khối lượng', icon: <Layers size={12} /> },
  { key: 'materials', label: 'Vật tư', icon: <Package size={12} /> },
  { key: 'labor', label: 'Nhân công', icon: <Users size={12} /> },
  { key: 'machines', label: 'Máy TC', icon: <Wrench size={12} /> },
];

const inputCls = 'w-full px-2 py-1.5 rounded-lg border border-slate-200 text-xs outline-none focus:ring-1 focus:ring-teal-400 bg-white dark:bg-slate-700';

const partnerClassLabel: Record<string, string> = {
  owner: 'Chủ đầu tư',
  contractor: 'Nhà thầu',
  supplier: 'Nhà cung cấp',
};

const describePartner = (partner: BusinessPartner) =>
  (partner.classifications || []).map(value => partnerClassLabel[value] || value).join(', ') || 'Đối tác';

const formatQuantity = (value?: number | null) =>
  Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 });

const parseNonNegative = (value: string) => Math.max(0, Number(value || 0));

const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result as string);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const filesToAttachments = async (files: FileList | null): Promise<Attachment[]> => {
  if (!files?.length) return [];
  const result: Attachment[] = [];
  for (const file of Array.from(files)) {
    result.push({
      id: crypto.randomUUID(),
      name: file.name,
      fileName: file.name,
      url: await fileToBase64(file),
      fileType: file.type,
      fileSize: file.size,
      category: 'daily_log_volume',
      uploadedAt: new Date().toISOString(),
    });
  }
  return result;
};

interface SearchOption<T> {
  item: T;
  label: string;
  meta?: string;
}

const SearchablePicker = <T,>({
  value,
  placeholder,
  options,
  onPick,
  onTextChange,
}: {
  value: string;
  placeholder: string;
  options: SearchOption<T>[];
  onPick: (item: T) => void;
  onTextChange?: (value: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const keyword = value.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!keyword) return options.slice(0, 8);
    return options
      .filter(option => `${option.label} ${option.meta || ''}`.toLowerCase().includes(keyword))
      .slice(0, 8);
  }, [keyword, options]);

  return (
    <div className="relative flex-1 min-w-[170px]">
      <input
        value={value}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={event => {
          onTextChange?.(event.target.value);
          setOpen(true);
        }}
        placeholder={placeholder}
        className={`${inputCls} pr-7`}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-30 mt-1 w-full max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
          {filtered.map((option, index) => (
            <button
              key={`${option.label}-${index}`}
              type="button"
              onMouseDown={event => event.preventDefault()}
              onClick={() => {
                onPick(option.item);
                setOpen(false);
              }}
              className="w-full px-3 py-2 text-left text-xs hover:bg-teal-50 border-b border-slate-50 last:border-b-0"
            >
              <div className="font-bold text-slate-700 truncate">{option.label}</div>
              {option.meta && <div className="text-[10px] text-slate-400 truncate">{option.meta}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const DailyLogDetailTabs: React.FC<Props> = ({
  volumes, materials, laborDetails, machines,
  onVolumesChange, onMaterialsChange, onLaborChange, onMachinesChange,
  tasks = [],
  laborCatalogs = [],
  machineCatalogs = [],
  businessPartners = [],
  verifiedQuantityByTaskId = {},
}) => {
  const [tab, setTab] = useState<TabKey>('volumes');
  const [laborModes, setLaborModes] = useState<Record<number, 'catalog' | 'partner'>>({});
  const taskOptions = useMemo<SearchOption<ProjectTask>[]>(() => tasks.map(task => ({
    item: task,
    label: `${task.wbsCode ? `${task.wbsCode} - ` : ''}${task.name}`,
    meta: [task.fallbackUnit, task.assignee].filter(Boolean).join(' • '),
  })), [tasks]);
  const laborOptions = useMemo<SearchOption<ContractLaborCatalogItem>[]>(() => laborCatalogs
    .filter(item => item.status !== 'inactive')
    .map(item => ({
      item,
      label: `${item.code ? `${item.code} - ` : ''}${item.name}`,
      meta: [item.groupName, item.partnerName, item.unit].filter(Boolean).join(' • '),
    })), [laborCatalogs]);
  const partnerOptions = useMemo<SearchOption<BusinessPartner>[]>(() => businessPartners
    .filter(item => item.isActive !== false)
    .map(item => ({
      item,
      label: item.name,
      meta: [item.code, item.phone, describePartner(item)].filter(Boolean).join(' • '),
    })), [businessPartners]);
  const machineOptions = useMemo<SearchOption<ContractMachineCatalogItem>[]>(() => machineCatalogs
    .filter(item => item.status !== 'inactive')
    .map(item => ({
      item,
      label: `${item.code ? `${item.code} - ` : ''}${item.name}`,
      meta: [item.groupName, item.unit].filter(Boolean).join(' • '),
    })), [machineCatalogs]);

  return (
    <div className="border-t border-slate-100 pt-4">
      <label className="text-[10px] font-black text-slate-500 uppercase block mb-2">Chi tiết thi công (FastCons)</label>
      {/* Tab bar */}
      <div className="flex gap-1 mb-3">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
              tab === t.key
                ? 'text-teal-700 bg-teal-100 border border-teal-200'
                : 'text-slate-500 hover:bg-slate-100'
            }`}>
            {t.icon} {t.label}
            {t.key === 'volumes' && volumes.length > 0 && <span className="ml-1 w-4 h-4 rounded-full bg-teal-500 text-white text-[8px] flex items-center justify-center">{volumes.length}</span>}
            {t.key === 'materials' && materials.length > 0 && <span className="ml-1 w-4 h-4 rounded-full bg-orange-500 text-white text-[8px] flex items-center justify-center">{materials.length}</span>}
            {t.key === 'labor' && laborDetails.length > 0 && <span className="ml-1 w-4 h-4 rounded-full bg-blue-500 text-white text-[8px] flex items-center justify-center">{laborDetails.length}</span>}
            {t.key === 'machines' && machines.length > 0 && <span className="ml-1 w-4 h-4 rounded-full bg-purple-500 text-white text-[8px] flex items-center justify-center">{machines.length}</span>}
          </button>
        ))}
      </div>

      {/* Volumes Tab */}
      {tab === 'volumes' && (
        <div className="space-y-3">
          {volumes.map((v, i) => {
            const task = tasks.find(item => item.id === v.taskId);
            const plannedQty = Number(task?.provisionalQuantity || 0);
            const verifiedQty = v.taskId ? Number(verifiedQuantityByTaskId[v.taskId] || 0) : 0;
            const remainingQty = Math.max(0, plannedQty - verifiedQty);
            const attachments = v.attachments || [];

            return (
              <div key={i} className="rounded-2xl border border-amber-100 bg-white shadow-sm overflow-hidden">
                <div className="px-3 py-2.5 bg-amber-50/60 border-b border-amber-100 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <ClipboardCheck size={15} className="text-amber-600 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[11px] font-black text-slate-700 truncate">Khối lượng hoàn thành</div>
                      <div className="text-[10px] font-bold text-slate-400 truncate">
                        {v.taskName || v.contractItemName || 'Chưa chọn hạng mục tiến độ'}
                      </div>
                    </div>
                  </div>
                  <button onClick={() => onVolumesChange(volumes.filter((_, idx) => idx !== i))}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-white">
                    <X size={14} />
                  </button>
                </div>

                <div className="p-3 space-y-3">
                  <SearchablePicker
                    value={v.taskName || v.contractItemName || ''}
                    placeholder="Gõ để tìm hạng mục trong Tiến độ..."
                    options={taskOptions}
                    onTextChange={value => {
                      const u = [...volumes];
                      u[i] = {
                        ...v,
                        taskId: undefined,
                        taskName: value,
                        contractItemId: undefined,
                        contractItemName: value,
                      };
                      onVolumesChange(u);
                    }}
                    onPick={task => {
                      const updated = [...volumes];
                      updated[i] = {
                        ...v,
                        taskId: task.id,
                        taskName: task.name,
                        contractItemId: undefined,
                        contractItemName: task.name,
                        unit: task.fallbackUnit || v.unit,
                      };
                      onVolumesChange(updated);
                    }}
                  />

                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-xl bg-slate-50 p-2">
                      <p className="text-[9px] font-black text-slate-400 uppercase">KL tạm tính</p>
                      <p className="text-base font-black text-slate-700">{formatQuantity(plannedQty)}</p>
                    </div>
                    <div className="rounded-xl bg-emerald-50 p-2">
                      <p className="text-[9px] font-black text-emerald-500 uppercase">Đã xác nhận</p>
                      <p className="text-base font-black text-emerald-700">{formatQuantity(verifiedQty)}</p>
                    </div>
                    <div className="rounded-xl bg-amber-50 p-2">
                      <p className="text-[9px] font-black text-amber-500 uppercase">Còn lại</p>
                      <p className="text-base font-black text-amber-700">{formatQuantity(remainingQty)}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-[1fr_120px] gap-2">
                    <div>
                      <label className="text-[10px] font-black text-slate-500 uppercase block mb-1.5">Khối lượng hoàn thành</label>
                      <input type="number" min={0} step="0.001" placeholder="0" value={v.quantity || ''}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                        onChange={e => {
                          const u = [...volumes];
                          u[i] = { ...v, quantity: parseNonNegative(e.target.value) };
                          onVolumesChange(u);
                        }} />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-500 uppercase block mb-1.5">ĐVT</label>
                      <input placeholder="ĐVT" value={v.unit || ''} className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                        onChange={e => {
                          const u = [...volumes];
                          u[i] = { ...v, unit: e.target.value };
                          onVolumesChange(u);
                        }} />
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-1.5">Ghi chú</label>
                    <textarea value={v.note || ''} rows={3}
                      placeholder="Mô tả phần việc đã hoàn thành, vị trí, điều kiện thi công..."
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-amber-400 resize-none bg-white"
                      onChange={e => {
                        const u = [...volumes];
                        u[i] = { ...v, note: e.target.value };
                        onVolumesChange(u);
                      }} />
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-1.5">Bằng chứng</label>
                    <label className="flex items-center justify-center gap-2 px-3 py-3 rounded-xl border border-dashed border-amber-200 bg-amber-50/60 text-xs font-black text-amber-700 cursor-pointer hover:bg-amber-100 transition-colors">
                      <Paperclip size={14} /> Chọn ảnh/file
                      <input type="file" multiple className="hidden" onChange={async e => {
                        const nextAttachments = await filesToAttachments(e.target.files);
                        const u = [...volumes];
                        u[i] = {
                          ...v,
                          attachments: [...attachments, ...nextAttachments],
                          photoUrl: v.photoUrl || nextAttachments[0]?.url,
                        };
                        onVolumesChange(u);
                        e.target.value = '';
                      }} />
                    </label>
                    {attachments.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {attachments.map(file => (
                          <div key={file.id || `${file.name}-${file.fileSize}`} className="flex items-center justify-between gap-2 text-[10px] font-bold text-slate-500 bg-slate-50 rounded-lg px-2 py-1">
                            <span className="truncate">{file.name || file.fileName}</span>
                            <div className="flex items-center gap-2 shrink-0">
                              {file.fileSize !== undefined && <span>{Math.round(file.fileSize / 1024)} KB</span>}
                              <button type="button" onClick={() => {
                                const u = [...volumes];
                                const filtered = attachments.filter(item => item !== file);
                                u[i] = { ...v, attachments: filtered, photoUrl: filtered[0]?.url || '' };
                                onVolumesChange(u);
                              }} className="text-slate-300 hover:text-red-500">
                                <X size={12} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <button onClick={() => onVolumesChange([...volumes, { taskId: '', taskName: '', contractItemId: undefined, contractItemName: '', quantity: 0, unit: 'm2', attachments: [] }])}
            className="flex items-center gap-1 text-[10px] font-bold text-teal-600 bg-teal-50 hover:bg-teal-100 px-3 py-1.5 rounded-lg border border-teal-200">
            <Plus size={10} /> Thêm khối lượng
          </button>
        </div>
      )}

      {/* Materials Tab */}
      {tab === 'materials' && (
        <div className="space-y-2">
          {materials.map((m, i) => (
            <div key={i} className="flex gap-2 items-center p-2 rounded-lg bg-orange-50/50 border border-orange-100">
              <input placeholder="Tên vật tư" value={m.itemName} className={`${inputCls} flex-1`}
                onChange={e => { const u = [...materials]; u[i] = { ...m, itemName: e.target.value }; onMaterialsChange(u); }} />
              <input type="number" placeholder="SL" value={m.quantity || ''} className={`${inputCls} w-20`}
                onChange={e => { const u = [...materials]; u[i] = { ...m, quantity: Number(e.target.value) }; onMaterialsChange(u); }} />
              <input placeholder="ĐVT" value={m.unit} className={`${inputCls} w-14`}
                onChange={e => { const u = [...materials]; u[i] = { ...m, unit: e.target.value }; onMaterialsChange(u); }} />
              <button onClick={() => onMaterialsChange(materials.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-red-500"><X size={14} /></button>
            </div>
          ))}
          <button onClick={() => onMaterialsChange([...materials, { itemName: '', unit: 'kg', quantity: 0 }])}
            className="flex items-center gap-1 text-[10px] font-bold text-orange-600 bg-orange-50 hover:bg-orange-100 px-3 py-1.5 rounded-lg border border-orange-200">
            <Plus size={10} /> Thêm vật tư
          </button>
        </div>
      )}

      {/* Labor Tab */}
      {tab === 'labor' && (
        <div className="space-y-2">
          {laborDetails.map((l, i) => {
            const mode = laborModes[i] || (l.partnerId && !l.catalogItemId ? 'partner' : 'catalog');
            return (
              <div key={i} className="flex gap-2 items-center p-2 rounded-lg bg-blue-50/50 border border-blue-100 flex-wrap">
                <div className="flex items-center p-0.5 rounded-lg bg-white border border-blue-100">
                  <button
                    type="button"
                    onClick={() => setLaborModes(prev => ({ ...prev, [i]: 'catalog' }))}
                    className={`px-2 py-1 rounded-md text-[9px] font-black transition-colors ${mode === 'catalog' ? 'bg-blue-100 text-blue-700' : 'text-slate-400 hover:text-slate-600'}`}
                  >
                    HĐ danh mục
                  </button>
                  <button
                    type="button"
                    onClick={() => setLaborModes(prev => ({ ...prev, [i]: 'partner' }))}
                    className={`px-2 py-1 rounded-md text-[9px] font-black transition-colors ${mode === 'partner' ? 'bg-blue-100 text-blue-700' : 'text-slate-400 hover:text-slate-600'}`}
                  >
                    HĐ đối tác
                  </button>
                </div>
                {mode === 'partner' ? (
                  <SearchablePicker
                    value={l.partnerName || l.groupName || ''}
                    placeholder="Tìm tổ đội/NCC từ HĐ đối tác..."
                    options={partnerOptions}
                    onTextChange={value => {
                      const u = [...laborDetails];
                      u[i] = {
                        ...l,
                        laborType: 'Tổ đội',
                        groupName: value,
                        partnerId: undefined,
                        partnerName: undefined,
                        catalogItemId: undefined,
                        catalogCode: undefined,
                        catalogName: undefined,
                      };
                      onLaborChange(u);
                    }}
                    onPick={partner => {
                      const u = [...laborDetails];
                      u[i] = {
                        ...l,
                        laborType: 'Tổ đội',
                        groupName: partner.name,
                        partnerId: partner.id,
                        partnerName: partner.name,
                        catalogItemId: undefined,
                        catalogCode: undefined,
                        catalogName: undefined,
                      };
                      onLaborChange(u);
                    }}
                  />
                ) : (
                  <SearchablePicker
                    value={l.catalogName || String(l.laborType || '')}
                    placeholder="Tìm nhân công trong HĐ danh mục..."
                    options={laborOptions}
                    onTextChange={value => { const u = [...laborDetails]; u[i] = { ...l, laborType: value, catalogName: value }; onLaborChange(u); }}
                    onPick={item => {
                      const u = [...laborDetails];
                      u[i] = {
                        ...l,
                        laborType: item.name,
                        catalogItemId: item.id,
                        catalogCode: item.code,
                        catalogName: item.name,
                        groupName: item.groupName,
                        partnerId: item.partnerId,
                        partnerName: item.partnerName,
                      };
                      onLaborChange(u);
                    }}
                  />
                )}
                <SearchablePicker
                  value={l.taskName || ''}
                  placeholder="Hạng mục..."
                  options={taskOptions}
                  onTextChange={value => { const u = [...laborDetails]; u[i] = { ...l, taskName: value }; onLaborChange(u); }}
                  onPick={task => { const u = [...laborDetails]; u[i] = { ...l, taskId: task.id, taskName: task.name }; onLaborChange(u); }}
                />
                <input type="number" placeholder={mode === 'partner' ? 'Số người' : 'SL'} value={l.count || ''} className={`${inputCls} w-20`}
                  onChange={e => { const u = [...laborDetails]; u[i] = { ...l, count: Number(e.target.value) }; onLaborChange(u); }} />
                <input type="number" placeholder="Giờ" value={l.hours || ''} className={`${inputCls} w-16`}
                  onChange={e => { const u = [...laborDetails]; u[i] = { ...l, hours: Number(e.target.value) }; onLaborChange(u); }} />
                <input type="number" placeholder="Đơn giá" value={l.unitCost || ''} className={`${inputCls} w-24`}
                  onChange={e => { const u = [...laborDetails]; u[i] = { ...l, unitCost: Number(e.target.value) }; onLaborChange(u); }} />
                <button onClick={() => onLaborChange(laborDetails.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-red-500"><X size={14} /></button>
              </div>
            );
          })}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => {
              setLaborModes(prev => ({ ...prev, [laborDetails.length]: 'catalog' }));
              onLaborChange([...laborDetails, { laborType: '', catalogName: '', count: 0, hours: 8 }]);
            }}
              className="flex items-center gap-1 text-[10px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg border border-blue-200">
              <Plus size={10} /> Thêm từ HĐ danh mục
            </button>
            <button onClick={() => {
              setLaborModes(prev => ({ ...prev, [laborDetails.length]: 'partner' }));
              onLaborChange([...laborDetails, { laborType: 'Tổ đội', groupName: '', count: 0, hours: 8 }]);
            }}
              className="flex items-center gap-1 text-[10px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg border border-indigo-200">
              <Plus size={10} /> Thêm từ HĐ đối tác
            </button>
          </div>
        </div>
      )}

      {/* Machines Tab */}
      {tab === 'machines' && (
        <div className="space-y-2">
          {machines.map((m, i) => (
            <div key={i} className="flex gap-2 items-center p-2 rounded-lg bg-purple-50/50 border border-purple-100 flex-wrap">
              <SearchablePicker
                value={m.catalogName || m.machineName || ''}
                placeholder="Tìm máy thi công trong HĐ danh mục..."
                options={machineOptions}
                onTextChange={value => { const u = [...machines]; u[i] = { ...m, machineName: value, catalogName: value }; onMachinesChange(u); }}
                onPick={item => {
                  const u = [...machines];
                  u[i] = {
                    ...m,
                    machineName: item.name,
                    machineType: item.code || 'other',
                    catalogItemId: item.id,
                    catalogCode: item.code,
                    catalogName: item.name,
                    groupName: item.groupName,
                  };
                  onMachinesChange(u);
                }}
              />
              <SearchablePicker
                value={m.taskName || ''}
                placeholder="Hạng mục..."
                options={taskOptions}
                onTextChange={value => { const u = [...machines]; u[i] = { ...m, taskName: value }; onMachinesChange(u); }}
                onPick={task => { const u = [...machines]; u[i] = { ...m, taskId: task.id, taskName: task.name }; onMachinesChange(u); }}
              />
              <input type="number" step="0.5" placeholder="Số ca" value={m.shifts || ''} className={`${inputCls} w-16`}
                onChange={e => { const u = [...machines]; u[i] = { ...m, shifts: Number(e.target.value) }; onMachinesChange(u); }} />
              <input type="number" placeholder="ĐG/ca" value={m.unitCost || ''} className={`${inputCls} w-24`}
                onChange={e => { const u = [...machines]; u[i] = { ...m, unitCost: Number(e.target.value) }; onMachinesChange(u); }} />
              <button onClick={() => onMachinesChange(machines.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-red-500"><X size={14} /></button>
            </div>
          ))}
          <button onClick={() => onMachinesChange([...machines, { machineName: '', machineType: 'other', catalogName: '', shifts: 1 }])}
            className="flex items-center gap-1 text-[10px] font-bold text-purple-600 bg-purple-50 hover:bg-purple-100 px-3 py-1.5 rounded-lg border border-purple-200">
            <Plus size={10} /> Thêm máy thi công
          </button>
        </div>
      )}
    </div>
  );
};

export default DailyLogDetailTabs;
