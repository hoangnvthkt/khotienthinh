import React, { useMemo, useState } from 'react';
import { Plus, X, Package, Users, Wrench, Layers, Paperclip, ClipboardCheck } from 'lucide-react';
import {
  DailyLogVolume, DailyLogMaterial, DailyLogLabor, DailyLogMachine,
  Attachment, BusinessPartner, ContractLaborCatalogItem, ContractMachineCatalogItem, InventoryItem, ProjectTask, ProjectWorkBoqItem,
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
  workBoqItems?: ProjectWorkBoqItem[];
  laborCatalogs?: ContractLaborCatalogItem[];
  machineCatalogs?: ContractMachineCatalogItem[];
  businessPartners?: BusinessPartner[];
  inventoryItems?: InventoryItem[];
  siteWarehouseId?: string;
  siteWarehouseName?: string;
  verifiedQuantityByTaskId?: Record<string, number>;
  verifiedQuantityByWorkBoqItemId?: Record<string, number>;
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

const getWarehouseStock = (item: InventoryItem, warehouseId?: string) =>
  warehouseId ? Number(item.stockByWarehouse?.[warehouseId] || 0) : 0;

const formatQuantity = (value?: number | null) =>
  Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 });

const parseNonNegative = (value: string) => Math.max(0, Number(value || 0));

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  pdf: 'application/pdf',
};

const inferMimeType = (file: File) => {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  return MIME_BY_EXTENSION[ext] || 'application/octet-stream';
};

const normalizeDataUrlMime = (url: string, mimeType: string) => {
  if (!url.startsWith('data:') || !mimeType) return url;
  const commaIndex = url.indexOf(',');
  if (commaIndex === -1) return url;
  const prefix = url.slice(0, commaIndex);
  const needsMime = /^data:(?:;base64)?$/i.test(prefix) || /^data:application\/octet-stream(?:;base64)?$/i.test(prefix);
  return needsMime ? `data:${mimeType};base64${url.slice(commaIndex)}` : url;
};

const fileToBase64 = (file: File, mimeType: string): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(normalizeDataUrlMime(reader.result as string, mimeType));
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const filesToAttachments = async (files: FileList | null): Promise<Attachment[]> => {
  if (!files?.length) return [];
  const result: Attachment[] = [];
  for (const file of Array.from(files)) {
    const mimeType = inferMimeType(file);
    result.push({
      id: crypto.randomUUID(),
      name: file.name,
      fileName: file.name,
      url: await fileToBase64(file, mimeType),
      fileType: mimeType,
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
  workBoqItems = [],
  laborCatalogs = [],
  machineCatalogs = [],
  businessPartners = [],
  inventoryItems = [],
  siteWarehouseId,
  siteWarehouseName,
  verifiedQuantityByTaskId = {},
  verifiedQuantityByWorkBoqItemId = {},
}) => {
  const [tab, setTab] = useState<TabKey>('volumes');
  const [laborModes, setLaborModes] = useState<Record<number, 'catalog' | 'partner'>>({});
  const taskOptions = useMemo<SearchOption<ProjectTask>[]>(() => tasks.map(task => ({
    item: task,
    label: `${task.wbsCode ? `${task.wbsCode} - ` : ''}${task.name}`,
    meta: [task.fallbackUnit, task.assignee].filter(Boolean).join(' • '),
  })), [tasks]);
  const workBoqOptions = useMemo<SearchOption<ProjectWorkBoqItem>[]>(() => workBoqItems.map(item => ({
    item,
    label: `${item.wbsCode ? `${item.wbsCode} - ` : ''}${item.name}`,
    meta: [item.unit, item.sourceTaskId ? 'Từ tiến độ' : 'Nhập tay'].filter(Boolean).join(' • '),
  })), [workBoqItems]);
  const materialOptions = useMemo<SearchOption<InventoryItem>[]>(() => inventoryItems
    .filter(item => !siteWarehouseId || getWarehouseStock(item, siteWarehouseId) > 0)
    .map(item => ({
      item,
      label: `${item.sku ? `${item.sku} - ` : ''}${item.name}`,
      meta: siteWarehouseId
        ? `Tồn ${formatQuantity(getWarehouseStock(item, siteWarehouseId))} ${item.unit} tại ${siteWarehouseName || 'kho công trường'}`
        : `Tổng tồn ${formatQuantity(Object.values(item.stockByWarehouse || {}).reduce((sum, qty) => sum + Number(qty || 0), 0))} ${item.unit}`,
    })), [inventoryItems, siteWarehouseId, siteWarehouseName]);
  const workBoqByTaskId = useMemo(() => new Map(workBoqItems.filter(item => item.sourceTaskId).map(item => [item.sourceTaskId as string, item])), [workBoqItems]);
  const taskById = useMemo(() => new Map(tasks.map(task => [task.id, task])), [tasks]);
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
            const workBoqItem = v.workBoqItemId ? workBoqItems.find(item => item.id === v.workBoqItemId) : undefined;
            const taskPlannedQty = Number(task?.provisionalQuantity || 0);
            const workBoqPlannedQty = Number(workBoqItem?.plannedQty || 0);
            const plannedQty = taskPlannedQty > 0 ? taskPlannedQty : workBoqPlannedQty;
            const verifiedByTask = v.taskId ? Number(verifiedQuantityByTaskId[v.taskId] || 0) : 0;
            const verifiedByWorkBoq = v.workBoqItemId ? Number(verifiedQuantityByWorkBoqItemId[v.workBoqItemId] || 0) : 0;
            const verifiedQty = Math.max(verifiedByTask, verifiedByWorkBoq);
            const remainingQty = Math.max(0, plannedQty - verifiedQty);
            const hasQuantityLimit = plannedQty > 0;
            const attachments = v.attachments || [];

            return (
              <div key={i} className="rounded-2xl border border-amber-100 bg-white shadow-sm overflow-hidden">
                <div className="px-3 py-2.5 bg-amber-50/60 border-b border-amber-100 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <ClipboardCheck size={15} className="text-amber-600 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[11px] font-black text-slate-700 truncate">Khối lượng hoàn thành</div>
                      <div className="text-[10px] font-bold text-slate-400 truncate">
                        {v.workBoqItemName || v.taskName || v.contractItemName || 'Chưa chọn hạng mục tiến độ'}
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
                        workBoqItemId: undefined,
                        workBoqItemName: undefined,
                        contractItemId: undefined,
                        contractItemName: value,
                      };
                      onVolumesChange(u);
                    }}
                    onPick={task => {
                      const updated = [...volumes];
                      const matchedWorkBoq = workBoqByTaskId.get(task.id);
                      updated[i] = {
                        ...v,
                        taskId: task.id,
                        taskName: task.name,
                        workBoqItemId: matchedWorkBoq?.id,
                        workBoqItemName: matchedWorkBoq?.name,
                        contractItemId: undefined,
                        contractItemName: task.name,
                        unit: matchedWorkBoq?.unit || task.fallbackUnit || v.unit,
                      };
                      onVolumesChange(updated);
                    }}
                  />

                  <SearchablePicker
                    value={v.workBoqItemName || ''}
                    placeholder="Gắn đầu mục BOQ thi công để đối chiếu hợp đồng..."
                    options={workBoqOptions}
                    onTextChange={value => {
                      const u = [...volumes];
                      u[i] = {
                        ...v,
                        workBoqItemId: undefined,
                        workBoqItemName: value,
                      };
                      onVolumesChange(u);
                    }}
                    onPick={item => {
                      const u = [...volumes];
                      u[i] = {
                        ...v,
                        workBoqItemId: item.id,
                        workBoqItemName: item.name,
                        taskId: item.sourceTaskId || v.taskId,
                        taskName: item.sourceTaskId ? taskById.get(item.sourceTaskId)?.name || v.taskName : v.taskName,
                        unit: item.unit || v.unit,
                      };
                      onVolumesChange(u);
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
                      <input type="number" min={0} max={hasQuantityLimit ? remainingQty : undefined} step="0.001" placeholder="0" value={v.quantity || ''}
                        disabled={hasQuantityLimit && remainingQty <= 0}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                        onChange={e => {
                          const inputQty = parseNonNegative(e.target.value);
                          const u = [...volumes];
                          u[i] = { ...v, quantity: hasQuantityLimit ? Math.min(inputQty, remainingQty) : inputQty };
                          onVolumesChange(u);
                        }} />
                      {hasQuantityLimit ? (
                        <p className={`mt-1 text-[10px] font-bold ${remainingQty <= 0 ? 'text-red-500' : 'text-amber-600'}`}>
                          Tối đa được nhập {formatQuantity(remainingQty)} {v.unit || task?.fallbackUnit || workBoqItem?.unit || ''}; phần vượt phải tách thành phát sinh/đầu mục khác.
                        </p>
                      ) : (
                        <p className="mt-1 text-[10px] font-bold text-slate-400">
                          Hạng mục chưa có KL tạm tính nên hệ thống chưa giới hạn khối lượng.
                        </p>
                      )}
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
          <button onClick={() => onVolumesChange([...volumes, { taskId: '', taskName: '', workBoqItemId: undefined, workBoqItemName: '', contractItemId: undefined, contractItemName: '', quantity: 0, unit: 'm2', attachments: [] }])}
            className="flex items-center gap-1 text-[10px] font-bold text-teal-600 bg-teal-50 hover:bg-teal-100 px-3 py-1.5 rounded-lg border border-teal-200">
            <Plus size={10} /> Thêm khối lượng
          </button>
        </div>
      )}

      {/* Materials Tab */}
      {tab === 'materials' && (
        <div className="space-y-3">
          {!siteWarehouseId && (
            <div className="rounded-xl border border-orange-100 bg-orange-50 px-3 py-2 text-[10px] font-bold text-orange-700">
              Chưa xác định được kho công trường nên danh sách vật tư chỉ dùng để tra cứu. Khi liên kết đúng kho công trường, tồn sẽ lấy theo kho đó.
            </div>
          )}
          {materials.map((m, i) => {
            const selectedItem = m.materialId ? inventoryItems.find(item => item.id === m.materialId) : undefined;
            const selectedStock = selectedItem ? getWarehouseStock(selectedItem, siteWarehouseId) : 0;
            const hasSelectedWarehouseStock = !!selectedItem && !!siteWarehouseId;
            return (
              <div key={i} className="rounded-2xl border border-orange-100 bg-orange-50/50 p-3 space-y-2">
                <div className="flex gap-2 items-start">
                  <SearchablePicker
                    value={m.itemName}
                    placeholder={siteWarehouseId ? `Chọn vật tư tồn tại ${siteWarehouseName || 'kho công trường'}...` : 'Gõ/chọn vật tư...'}
                    options={materialOptions}
                    onTextChange={value => {
                      const u = [...materials];
                      u[i] = { ...m, materialId: undefined, itemName: value };
                      onMaterialsChange(u);
                    }}
                    onPick={item => {
                      const stock = getWarehouseStock(item, siteWarehouseId);
                      const u = [...materials];
                      u[i] = {
                        ...m,
                        materialId: item.id,
                        itemName: item.name,
                        unit: item.unit,
                        quantity: siteWarehouseId ? Math.min(Number(m.quantity || 0), stock) : Number(m.quantity || 0),
                      };
                      onMaterialsChange(u);
                    }}
                  />
                  <button onClick={() => onMaterialsChange(materials.filter((_, idx) => idx !== i))} className="mt-1 text-slate-400 hover:text-red-500"><X size={14} /></button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_96px_96px] gap-2">
                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Ghi chú vật tư</label>
                    <input placeholder="Vị trí sử dụng, quy cách, ghi chú..." value={m.note || ''} className={inputCls}
                      onChange={e => { const u = [...materials]; u[i] = { ...m, note: e.target.value }; onMaterialsChange(u); }} />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">Số lượng</label>
                    <input
                      type="number"
                      min={0}
                      max={hasSelectedWarehouseStock ? selectedStock : undefined}
                      placeholder="SL"
                      value={m.quantity || ''}
                      className={inputCls}
                      onChange={e => {
                        const inputQty = Math.max(0, Number(e.target.value || 0));
                        const u = [...materials];
                        u[i] = { ...m, quantity: hasSelectedWarehouseStock ? Math.min(inputQty, selectedStock) : inputQty };
                        onMaterialsChange(u);
                      }}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase block mb-1">ĐVT</label>
                    <input placeholder="ĐVT" value={m.unit} className={inputCls}
                      onChange={e => { const u = [...materials]; u[i] = { ...m, unit: e.target.value }; onMaterialsChange(u); }} />
                  </div>
                </div>
                {hasSelectedWarehouseStock && (
                  <div className={`text-[10px] font-bold ${Number(m.quantity || 0) >= selectedStock && selectedStock > 0 ? 'text-amber-600' : selectedStock <= 0 ? 'text-red-500' : 'text-orange-600'}`}>
                    Tồn tại {siteWarehouseName || 'kho công trường'}: {formatQuantity(selectedStock)} {selectedItem?.unit}. Nhật ký chỉ ghi nhận vật tư trong kho công trường này.
                  </div>
                )}
              </div>
            );
          })}
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
